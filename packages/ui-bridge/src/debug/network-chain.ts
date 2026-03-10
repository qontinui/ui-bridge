/**
 * Network Request-Response-Error Chains
 *
 * Tracks the full lifecycle of HTTP requests, including request/response
 * bodies (size-limited), and correlates network failures with console
 * errors that occur shortly after.
 *
 * Unlike `captures/network.ts` which only captures *failures*, this tracks
 * ALL requests and correlates them with console errors.
 *
 * Implements Phase 3.10 (network chains) and Phase 4.16 (request ID correlation)
 * from the console capture plan.
 */

import type { AnyCapturedEvent, ConsoleCapturedEvent } from './browser-capture-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Common request ID headers to extract (checked in priority order) */
const REQUEST_ID_HEADERS = [
  'x-request-id',
  'x-correlation-id',
  'x-trace-id',
  'traceparent',
  'x-amzn-requestid',
  'x-amzn-trace-id',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetworkRequest {
  /** Auto-generated unique identifier */
  id: string;
  method: string;
  url: string;
  /** Selected headers only (request ID headers + content-type) */
  headers?: Record<string, string>;
  /** First N chars of request body */
  bodyPreview?: string;
  startTime: number;
}

export interface NetworkResponse {
  status: number;
  statusText: string;
  /** Selected headers only (request ID headers + content-type) */
  headers?: Record<string, string>;
  /** First N chars of response body (for errors only by default) */
  bodyPreview?: string;
  durationMs: number;
}

export interface NetworkChain {
  request: NetworkRequest;
  response?: NetworkResponse; // undefined if network error (fetch threw)
  /** Error message if the request failed at the network level */
  error?: string;
  /** Request ID extracted from response headers (X-Request-ID, X-Correlation-ID, etc.) */
  requestId?: string;
  /** Console errors that occurred within a correlation window after this request */
  correlatedErrors: CorrelatedError[];
  /** Whether this chain represents a failure (4xx/5xx/network error) */
  isFailure: boolean;
  /** Timestamp for sorting (same as request.startTime) */
  timestamp: number;
}

export interface CorrelatedError {
  message: string;
  timestamp: number;
  /** How this error was correlated with the network chain */
  correlationType: 'url-mention' | 'timing' | 'request-id';
}

export interface NetworkChainConfig {
  /** Max body preview length in chars (default: 500) */
  maxBodyPreview?: number;
  /** Only capture bodies for error responses (default: true) */
  errorBodiesOnly?: boolean;
  /** Correlation window in ms for linking console errors to network events (default: 200) */
  correlationWindowMs?: number;
  /** URL patterns to ignore (default: UI Bridge endpoints, dev-debug, etc.) */
  ignorePatterns?: string[];
  /** Max chains to buffer (default: 200) */
  maxChains?: number;
  /** Whether to capture request/response headers (default: false for perf) */
  captureHeaders?: boolean;
}

const DEFAULT_CONFIG: Required<NetworkChainConfig> = {
  maxBodyPreview: 500,
  errorBodiesOnly: true,
  correlationWindowMs: 200,
  ignorePatterns: [
    '/api/ui-bridge/',
    '/__ui-bridge/',
    '/api/dev-debug/',
    'localhost:9876',
    'chrome-extension://',
  ],
  maxChains: 200,
  captureHeaders: false,
};

// ---------------------------------------------------------------------------
// NetworkChainTracker
// ---------------------------------------------------------------------------

export class NetworkChainTracker {
  private chains: NetworkChain[] = [];
  private config: Required<NetworkChainConfig>;
  private installed = false;
  private cleanup: (() => void) | null = null;

  constructor(config?: NetworkChainConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Install / Uninstall
  // -------------------------------------------------------------------------

  /**
   * Install the fetch interceptor.
   * Wraps `window.fetch` to capture all requests and responses.
   * No-ops in non-browser environments (SSR / Node).
   */
  install(): void {
    if (this.installed) return;

    // Guard against SSR / Node environments
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
      return;
    }

    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url = getUrl(input);

      if (self.shouldIgnore(url)) {
        return originalFetch.call(this, input, init);
      }

      const method = getMethod(input, init);

      const request: NetworkRequest = {
        id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method,
        url,
        startTime: Date.now(),
      };

      // Capture body preview for non-GET requests
      if (init?.body && typeof init.body === 'string') {
        request.bodyPreview = self.truncateBody(init.body);
      }

      // Capture request headers if configured
      if (self.config.captureHeaders && init?.headers) {
        request.headers = self.extractSelectedHeaders(new Headers(init.headers));
      }

      try {
        const response = await originalFetch.call(this, input, init);
        const durationMs = Date.now() - request.startTime;
        const isError = response.status >= 400;

        const chain: NetworkChain = {
          request,
          response: {
            status: response.status,
            statusText: response.statusText,
            durationMs,
          },
          requestId: self.extractRequestId(response.headers),
          correlatedErrors: [],
          isFailure: isError,
          timestamp: request.startTime,
        };

        // Capture response body preview:
        // - Always for error responses (4xx/5xx)
        // - For successful responses only when errorBodiesOnly is false
        if (isError || !self.config.errorBodiesOnly) {
          try {
            const cloned = response.clone();
            const text = await cloned.text();
            chain.response!.bodyPreview = self.truncateBody(text);
          } catch {
            /* ignore body read failures */
          }
        }

        // Capture response headers if configured
        if (self.config.captureHeaders) {
          chain.response!.headers = self.extractSelectedHeaders(response.headers);
        }

        self.chains.push(chain);
        self.trim();

        return response;
      } catch (err) {
        const chain: NetworkChain = {
          request,
          error: err instanceof Error ? err.message : String(err),
          correlatedErrors: [],
          isFailure: true,
          timestamp: request.startTime,
        };

        self.chains.push(chain);
        self.trim();

        throw err;
      }
    };

    this.cleanup = () => {
      window.fetch = originalFetch;
    };
    this.installed = true;
  }

  /** Uninstall the fetch interceptor and restore the original `window.fetch`. */
  uninstall(): void {
    if (!this.installed) return;
    this.cleanup?.();
    this.cleanup = null;
    this.installed = false;
  }

  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------

  /** Get all chains (oldest first). */
  getAll(): NetworkChain[] {
    return [...this.chains];
  }

  /** Get chains with a timestamp >= `ts`. */
  getSince(ts: number): NetworkChain[] {
    return this.chains.filter((c) => c.timestamp >= ts);
  }

  /** Get the most recent `n` chains (default: 50). */
  getRecent(n = 50): NetworkChain[] {
    return this.chains.slice(-n);
  }

  /** Get only failure chains (4xx/5xx/network errors). */
  getFailures(): NetworkChain[] {
    return this.chains.filter((c) => c.isFailure);
  }

  /** Get chains whose request URL contains `pattern`. */
  getByUrl(pattern: string): NetworkChain[] {
    return this.chains.filter((c) => c.request.url.includes(pattern));
  }

  /** Find the first chain matching a request ID (from response headers). */
  findByRequestId(requestId: string): NetworkChain | undefined {
    return this.chains.find((c) => c.requestId === requestId);
  }

  // -------------------------------------------------------------------------
  // Correlation
  // -------------------------------------------------------------------------

  /**
   * Correlate console errors with network chains.
   *
   * Call this after collecting console errors to link them with recent
   * network events. Each console error is checked against all chains using
   * three correlation strategies:
   *
   * 1. **URL mention** - the error message contains the request URL (or a
   *    recognizable suffix of it).
   * 2. **Timing** - the error occurred within `correlationWindowMs` of the
   *    network response.
   * 3. **Request ID** - the error message contains the chain's `requestId`.
   *
   * Correlations are pushed to each matching chain's `correlatedErrors` array.
   */
  correlateErrors(events: AnyCapturedEvent[]): void {
    // Filter to console-level error events only
    const consoleErrors = events.filter((e): e is ConsoleCapturedEvent => e.type === 'console');

    if (consoleErrors.length === 0) return;

    for (const chain of this.chains) {
      // Determine the response time for timing correlation
      const responseTime = chain.response
        ? chain.request.startTime + chain.response.durationMs
        : chain.request.startTime;

      // Extract a path suffix for more tolerant URL matching
      const urlSuffix = extractUrlPath(chain.request.url);

      for (const error of consoleErrors) {
        // Skip errors that are already correlated with this chain
        if (
          chain.correlatedErrors.some(
            (ce) => ce.message === error.message && ce.timestamp === error.timestamp
          )
        ) {
          continue;
        }

        // Strategy 1: URL mention
        if (urlSuffix && error.message.includes(urlSuffix)) {
          chain.correlatedErrors.push({
            message: error.message,
            timestamp: error.timestamp,
            correlationType: 'url-mention',
          });
          continue; // don't double-count
        }

        // Also check full URL
        if (error.message.includes(chain.request.url)) {
          chain.correlatedErrors.push({
            message: error.message,
            timestamp: error.timestamp,
            correlationType: 'url-mention',
          });
          continue;
        }

        // Strategy 3: Request ID (checked before timing since it's more specific)
        if (chain.requestId && error.message.includes(chain.requestId)) {
          chain.correlatedErrors.push({
            message: error.message,
            timestamp: error.timestamp,
            correlationType: 'request-id',
          });
          continue;
        }

        // Strategy 2: Timing (only for failure chains — timing correlation on
        // successful requests would produce too much noise)
        if (
          chain.isFailure &&
          Math.abs(error.timestamp - responseTime) <= this.config.correlationWindowMs
        ) {
          chain.correlatedErrors.push({
            message: error.message,
            timestamp: error.timestamp,
            correlationType: 'timing',
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Clear all buffered chains. */
  clear(): void {
    this.chains = [];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private shouldIgnore(url: string): boolean {
    return this.config.ignorePatterns.some((p) => url.includes(p));
  }

  /**
   * Extract a request ID from response headers.
   * Checks `REQUEST_ID_HEADERS` in priority order and returns the first match.
   */
  private extractRequestId(headers: Headers): string | undefined {
    for (const name of REQUEST_ID_HEADERS) {
      const value = headers.get(name);
      if (value) return value;
    }
    return undefined;
  }

  /**
   * Extract selected headers (request ID headers + content-type).
   */
  private extractSelectedHeaders(headers: Headers): Record<string, string> {
    const selected: Record<string, string> = {};
    for (const name of REQUEST_ID_HEADERS) {
      const value = headers.get(name);
      if (value) selected[name] = value;
    }
    const ct = headers.get('content-type');
    if (ct) selected['content-type'] = ct;
    return selected;
  }

  private truncateBody(body: string): string {
    if (body.length <= this.config.maxBodyPreview) return body;
    return body.slice(0, this.config.maxBodyPreview) + '…';
  }

  /** Trim the buffer to `maxChains`, dropping the oldest entries. */
  private trim(): void {
    if (this.chains.length > this.config.maxChains) {
      this.chains = this.chains.slice(this.chains.length - this.config.maxChains);
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers (kept outside the class for reuse / testing)
// ---------------------------------------------------------------------------

/** Extract method from fetch arguments, consistent with captures/network.ts */
function getMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

/** Extract URL string from fetch arguments, consistent with captures/network.ts */
function getUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

/**
 * Extract the pathname from a URL for tolerant matching.
 * Returns `undefined` if the URL cannot be parsed.
 */
function extractUrlPath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return undefined;
  }
}
