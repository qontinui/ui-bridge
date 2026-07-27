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
 * Two modes of operation:
 * 1. **Standalone** (default) — patches fetch/XHR directly.
 * 2. **Tracker-driven** — subscribes to a `NetworkRequestTracker` for events,
 *    eliminating redundant fetch/XHR patching when a tracker already exists.
 *
 * Implements Phase 3.10 (network chains) and Phase 4.16 (request ID correlation)
 * from the console capture plan.
 */

import type { AnyCapturedEvent, ConsoleCapturedEvent } from './browser-capture-types';
import type { NetworkRequestTracker } from '../network/tracker';
import type { NetworkRequestEntry } from '../network/types';
import { truncateCodePoints } from '../core/text';

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
  /**
   * Optional NetworkRequestTracker to subscribe to instead of patching
   * fetch/XHR directly. When provided, install() subscribes to tracker
   * events rather than installing its own interceptors.
   */
  tracker?: NetworkRequestTracker;
}

const DEFAULT_CONFIG: Required<Omit<NetworkChainConfig, 'tracker'>> = {
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
// XHR metadata (stored per-instance via WeakMap)
// ---------------------------------------------------------------------------

interface XHRMeta {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
}

/** WeakMap so metadata is GC'd when the XHR instance is collected. */
const xhrMetaMap = new WeakMap<XMLHttpRequest, XHRMeta>();

// ---------------------------------------------------------------------------
// NetworkChainTracker
// ---------------------------------------------------------------------------

export class NetworkChainTracker {
  private chains: NetworkChain[] = [];
  private config: Required<Omit<NetworkChainConfig, 'tracker'>>;
  private installed = false;
  private cleanup: (() => void) | null = null;

  // Tracker-driven mode
  private tracker: NetworkRequestTracker | null = null;
  private trackerUnsubscribe: (() => void) | null = null;

  constructor(config?: NetworkChainConfig) {
    const { tracker, ...rest } = config ?? {};
    this.config = { ...DEFAULT_CONFIG, ...rest };
    this.tracker = tracker ?? null;
  }

  // -------------------------------------------------------------------------
  // Install / Uninstall
  // -------------------------------------------------------------------------

  /**
   * Install the fetch and XHR interceptors (standalone mode), or subscribe
   * to a NetworkRequestTracker (tracker-driven mode).
   * No-ops in non-browser environments (SSR / Node).
   */
  install(): void {
    if (this.installed) return;

    // Tracker-driven mode: subscribe to events instead of patching globals
    if (this.tracker) {
      this.installTrackerSubscription();
      this.installed = true;
      return;
    }

    // Guard against SSR / Node environments
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
      return;
    }

    const cleanups: Array<() => void> = [];

    // ----- Fetch interceptor ------------------------------------------------

    const originalFetch = window.fetch;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
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

    cleanups.push(() => {
      window.fetch = originalFetch;
    });

    // ----- XHR interceptor --------------------------------------------------

    if (typeof XMLHttpRequest !== 'undefined') {
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

      XMLHttpRequest.prototype.open = function (
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        ...rest: unknown[]
      ) {
        // Stash method and url on the instance for use in `send`
        const meta: XHRMeta = {
          method: method.toUpperCase(),
          url: typeof url === 'object' && url instanceof URL ? url.href : String(url),
          requestHeaders: {},
        };
        xhrMetaMap.set(this, meta);

        // Call the original open with all arguments (async, user, pass are optional)
        return (originalOpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
      };

      XMLHttpRequest.prototype.setRequestHeader = function (
        this: XMLHttpRequest,
        name: string,
        value: string
      ) {
        const meta = xhrMetaMap.get(this);
        if (meta) {
          meta.requestHeaders[name.toLowerCase()] = value;
        }
        return originalSetRequestHeader.call(this, name, value);
      };

      XMLHttpRequest.prototype.send = function (
        this: XMLHttpRequest,
        body?: Document | XMLHttpRequestBodyInit | null
      ) {
        const meta = xhrMetaMap.get(this);

        // If we have no metadata (open wasn't intercepted) or URL is ignored,
        // just pass through.
        if (!meta || self.shouldIgnore(meta.url)) {
          return originalSend.call(this, body);
        }

        const request: NetworkRequest = {
          id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          method: meta.method,
          url: meta.url,
          startTime: Date.now(),
        };

        // Capture body preview for non-GET requests
        if (body && typeof body === 'string') {
          request.bodyPreview = self.truncateBody(body);
        }

        // Capture request headers if configured
        if (self.config.captureHeaders && Object.keys(meta.requestHeaders).length > 0) {
          request.headers = self.extractSelectedHeadersFromRecord(meta.requestHeaders);
        }

        const pushChain = (chain: NetworkChain) => {
          self.chains.push(chain);
          self.trim();
        };

        // --- Event handlers ---

        this.addEventListener('load', function () {
          const durationMs = Date.now() - request.startTime;
          const isError = this.status >= 400;

          const chain: NetworkChain = {
            request,
            response: {
              status: this.status,
              statusText: this.statusText,
              durationMs,
            },
            correlatedErrors: [],
            isFailure: isError,
            timestamp: request.startTime,
          };

          // Extract request ID from response headers
          chain.requestId = self.extractRequestIdFromXHR(this);

          // Capture response body preview
          if (isError || !self.config.errorBodiesOnly) {
            try {
              const text = typeof this.responseText === 'string' ? this.responseText : '';
              if (text) {
                chain.response!.bodyPreview = self.truncateBody(text);
              }
            } catch {
              /* responseText may throw for non-text responses */
            }
          }

          // Capture response headers if configured
          if (self.config.captureHeaders) {
            chain.response!.headers = self.extractSelectedHeadersFromXHR(this);
          }

          pushChain(chain);
        });

        this.addEventListener('error', function () {
          pushChain({
            request,
            error: 'Network error',
            correlatedErrors: [],
            isFailure: true,
            timestamp: request.startTime,
          });
        });

        this.addEventListener('timeout', function () {
          pushChain({
            request,
            error: `Timeout after ${this.timeout}ms`,
            correlatedErrors: [],
            isFailure: true,
            timestamp: request.startTime,
          });
        });

        this.addEventListener('abort', function () {
          pushChain({
            request,
            error: 'Request aborted',
            correlatedErrors: [],
            isFailure: true,
            timestamp: request.startTime,
          });
        });

        return originalSend.call(this, body);
      };

      cleanups.push(() => {
        XMLHttpRequest.prototype.open = originalOpen;
        XMLHttpRequest.prototype.send = originalSend;
        XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
      });
    }

    this.cleanup = () => {
      for (const fn of cleanups) fn();
    };
    this.installed = true;
  }

  /** Uninstall the fetch and XHR interceptors, restoring originals. */
  uninstall(): void {
    if (!this.installed) return;

    if (this.trackerUnsubscribe) {
      this.trackerUnsubscribe();
      this.trackerUnsubscribe = null;
    } else {
      this.cleanup?.();
      this.cleanup = null;
    }

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

  /**
   * Subscribe to a NetworkRequestTracker's events instead of patching
   * fetch/XHR directly. Converts each completed/errored event entry into
   * a NetworkChain and pushes it to the buffer.
   */
  private installTrackerSubscription(): void {
    this.trackerUnsubscribe = this.tracker!.onEvent((event) => {
      // We only care about completed/errored requests — not starts
      if (event.type === 'request-start') return;

      const url = event.entry.request.url;
      if (this.shouldIgnore(url)) return;

      const chain = this.entryToChain(event.entry);
      this.chains.push(chain);
      this.trim();
    });
  }

  /**
   * Convert a NetworkRequestEntry (from the tracker) to a NetworkChain.
   */
  private entryToChain(entry: NetworkRequestEntry): NetworkChain {
    const request: NetworkRequest = {
      id: entry.request.id,
      method: entry.request.method,
      url: entry.request.url,
      startTime: entry.request.startedAt,
      bodyPreview: entry.request.bodyPreview,
    };

    // Capture request headers if configured and available
    if (this.config.captureHeaders && entry.request.headers) {
      request.headers = this.extractSelectedHeadersFromRecord(entry.request.headers);
    }

    const chain: NetworkChain = {
      request,
      correlatedErrors: [],
      isFailure: entry.isFailure,
      timestamp: entry.request.startedAt,
    };

    if (entry.error) {
      chain.error = entry.error;
    }

    if (entry.response) {
      chain.response = {
        status: entry.response.statusCode,
        statusText: entry.response.statusText,
        durationMs: entry.response.durationMs,
      };

      // Capture response body preview according to this tracker's config
      if (entry.response.bodyPreview && (entry.isFailure || !this.config.errorBodiesOnly)) {
        chain.response.bodyPreview = this.truncateBody(entry.response.bodyPreview);
      }

      // Capture response headers if configured
      if (this.config.captureHeaders && entry.response.headers) {
        chain.response.headers = this.extractSelectedHeadersFromRecord(entry.response.headers);
      }
    }

    if (entry.requestId) {
      chain.requestId = entry.requestId;
    }

    return chain;
  }

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

  /**
   * Extract selected headers from a plain record (used by XHR interceptor for
   * request headers captured via setRequestHeader).
   */
  private extractSelectedHeadersFromRecord(
    headers: Record<string, string>
  ): Record<string, string> {
    const selected: Record<string, string> = {};
    for (const name of REQUEST_ID_HEADERS) {
      const value = headers[name];
      if (value) selected[name] = value;
    }
    const ct = headers['content-type'];
    if (ct) selected['content-type'] = ct;
    return selected;
  }

  /**
   * Extract a request ID from XHR response headers.
   * Uses `getResponseHeader` to check `REQUEST_ID_HEADERS` in priority order.
   */
  private extractRequestIdFromXHR(xhr: XMLHttpRequest): string | undefined {
    for (const name of REQUEST_ID_HEADERS) {
      try {
        const value = xhr.getResponseHeader(name);
        if (value) return value;
      } catch {
        /* getResponseHeader may throw if state is wrong */
      }
    }
    return undefined;
  }

  /**
   * Extract selected response headers from an XHR instance.
   */
  private extractSelectedHeadersFromXHR(xhr: XMLHttpRequest): Record<string, string> {
    const selected: Record<string, string> = {};
    for (const name of REQUEST_ID_HEADERS) {
      try {
        const value = xhr.getResponseHeader(name);
        if (value) selected[name] = value;
      } catch {
        /* ignore */
      }
    }
    try {
      const ct = xhr.getResponseHeader('content-type');
      if (ct) selected['content-type'] = ct;
    } catch {
      /* ignore */
    }
    return selected;
  }

  private truncateBody(body: string): string {
    if (body.length <= this.config.maxBodyPreview) return body;
    return truncateCodePoints(body, this.config.maxBodyPreview) + '…';
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
