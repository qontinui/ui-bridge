/**
 * Network Request Tracker
 *
 * Intercepts fetch() and XMLHttpRequest to track the full lifecycle of HTTP
 * requests: in-flight tracking, response capture (status, headers, body preview),
 * filtering, and event subscription.
 *
 * Modeled after:
 * - `NetworkChainTracker` (fetch interception, body previews, request ID extraction)
 * - `NetworkIdleDetector` (XHR patching, install/destroy lifecycle, event callbacks)
 */

import type {
  NetworkTrackerConfig,
  NetworkRequestEntry,
  NetworkRequestFilter,
  WaitForRequestOptions,
  WaitForRequestResult,
  NetworkEvent,
  NetworkEventCallback,
} from './types';
import { truncateCodePoints } from '../core/text';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Common request ID headers to extract (checked in priority order) */
const REQUEST_ID_HEADERS = [
  'x-request-id',
  'x-amzn-requestid',
  'x-amz-request-id',
  'cf-ray',
  'x-trace-id',
  'traceparent',
];

// ---------------------------------------------------------------------------
// NetworkRequestTracker
// ---------------------------------------------------------------------------

export class NetworkRequestTracker {
  private config: Required<NetworkTrackerConfig>;
  private inFlight = new Map<string, NetworkRequestEntry>();
  private completed: NetworkRequestEntry[] = [];
  private listeners: NetworkEventCallback[] = [];
  private installed = false;
  private requestCounter = 0;

  // Saved originals for restore
  private originalFetch: typeof fetch | null = null;
  private originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null;

  constructor(config?: NetworkTrackerConfig) {
    this.config = {
      ignorePatterns: config?.ignorePatterns ?? [],
      maxEntries: config?.maxEntries ?? 200,
      trackXHR: config?.trackXHR ?? true,
      maxBodyPreview: config?.maxBodyPreview ?? 500,
      errorBodiesOnly: config?.errorBodiesOnly ?? true,
      captureHeaders: config?.captureHeaders ?? true,
    };
  }

  // =========================================================================
  // Install / Destroy
  // =========================================================================

  /** Patch fetch and optionally XHR to begin tracking requests. */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    this.installFetchInterceptor();
    if (this.config.trackXHR) {
      this.installXHRInterceptor();
    }
  }

  /** Restore original fetch/XHR and clear all state. */
  destroy(): void {
    if (!this.installed) return;
    this.installed = false;

    // Restore fetch
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }

    // Restore XHR
    if (this.originalXHROpen) {
      XMLHttpRequest.prototype.open = this.originalXHROpen;
      this.originalXHROpen = null;
    }
    if (this.originalXHRSend) {
      XMLHttpRequest.prototype.send = this.originalXHRSend;
      this.originalXHRSend = null;
    }

    this.inFlight.clear();
    this.completed = [];
    this.listeners = [];
    this.requestCounter = 0;
  }

  // =========================================================================
  // Query Methods
  // =========================================================================

  /** Return all currently in-flight request entries. */
  getInFlight(): NetworkRequestEntry[] {
    return [...this.inFlight.values()];
  }

  /** Return completed request entries, optionally filtered. */
  getCompleted(filter?: NetworkRequestFilter): NetworkRequestEntry[] {
    if (!filter) return [...this.completed];
    return this.applyFilter([...this.completed], filter);
  }

  /** Return all entries (in-flight + completed), optionally filtered. */
  getAll(filter?: NetworkRequestFilter): NetworkRequestEntry[] {
    const all = [...this.inFlight.values(), ...this.completed];
    if (!filter) return all;
    return this.applyFilter(all, filter);
  }

  /** Look up a single entry by its unique ID. */
  getById(id: string): NetworkRequestEntry | undefined {
    return this.inFlight.get(id) ?? this.completed.find((e) => e.request.id === id);
  }

  // =========================================================================
  // Wait
  // =========================================================================

  /**
   * Wait for a matching network request to complete.
   *
   * Modes:
   * - `existing` — only check currently in-flight requests.
   * - `next` — ignore existing, wait for the next matching request.
   * - `any` (default) — check in-flight first, then recently completed, then wait.
   */
  async waitForRequest(options?: WaitForRequestOptions): Promise<WaitForRequestResult> {
    const timeout = options?.timeout ?? 30000;
    const mode = options?.mode ?? 'any';

    return new Promise<WaitForRequestResult>((resolve, reject) => {
      const startTime = Date.now();

      // For 'existing' or 'any' mode, check in-flight requests first
      if (mode !== 'next') {
        for (const entry of this.inFlight.values()) {
          if (this.matchesWaitOptions(entry, options ?? {})) {
            // Found an in-flight match — wait for it to complete
            const unsub = this.onEvent((event) => {
              if (event.entry.request.id === entry.request.id && event.type !== 'request-start') {
                unsub();
                clearTimeout(timer);
                resolve({ entry: event.entry, timedOut: false });
              }
            });
            const timer = setTimeout(() => {
              unsub();
              resolve({ entry, timedOut: true });
            }, timeout);
            return;
          }
        }
      }

      // For 'any' mode, also check recently completed entries
      if (mode === 'any') {
        const match = [...this.completed]
          .reverse()
          .find(
            (e) =>
              this.matchesWaitOptions(e, options ?? {}) &&
              e.completedAt != null &&
              e.completedAt >= startTime - 1000
          );
        if (match) {
          resolve({ entry: match, timedOut: false });
          return;
        }
      }

      // Wait for the next matching request to complete
      const unsub = this.onEvent((event) => {
        if (event.type !== 'request-start' && this.matchesWaitOptions(event.entry, options ?? {})) {
          unsub();
          clearTimeout(timer);
          resolve({ entry: event.entry, timedOut: false });
        }
      });

      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`waitForRequest timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  // =========================================================================
  // Event Subscription
  // =========================================================================

  /** Subscribe to network events. Returns an unsubscribe function. */
  onEvent(callback: NetworkEventCallback): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** Clear the completed entries buffer (in-flight entries are preserved). */
  clear(): void {
    this.completed = [];
  }

  // =========================================================================
  // Private — Interceptors
  // =========================================================================

  private installFetchInterceptor(): void {
    const origFetch = globalThis.fetch;
    this.originalFetch = origFetch;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const tracker = this;

    globalThis.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url = getUrl(input);

      if (tracker.shouldIgnore(url)) {
        return origFetch.call(globalThis, input, init);
      }

      const method = getMethod(input, init);
      const id = tracker.generateId();

      const entry: NetworkRequestEntry = {
        request: {
          id,
          method,
          url,
          pathname: tryParsePathname(url),
          headers: tracker.extractHeaders(init?.headers, tracker.config.captureHeaders),
          bodyPreview: await tracker.captureBodyPreview(init?.body),
          startedAt: Date.now(),
          status: 'in-flight',
        },
        isFailure: false,
      };

      tracker.inFlight.set(id, entry);
      tracker.emitEvent({
        type: 'request-start',
        entry,
        pendingCount: tracker.inFlight.size,
        timestamp: Date.now(),
      });

      try {
        const response = await origFetch.call(globalThis, input, init);
        const durationMs = Date.now() - entry.request.startedAt;
        const isError = response.status >= 400;

        entry.request.status = isError ? 'failed' : 'completed';
        entry.response = {
          statusCode: response.status,
          statusText: response.statusText,
          headers: tracker.extractHeaders(response.headers, tracker.config.captureHeaders),
          durationMs,
        };
        entry.isFailure = isError;
        entry.completedAt = Date.now();
        entry.requestId = tracker.extractRequestId(response.headers);

        // Capture response body preview
        entry.response.bodyPreview = await tracker.captureResponsePreview(
          response.clone(),
          isError
        );

        tracker.inFlight.delete(id);
        tracker.completed.push(entry);
        tracker.trimCompleted();
        tracker.emitEvent({
          type: isError ? 'request-error' : 'request-complete',
          entry,
          pendingCount: tracker.inFlight.size,
          timestamp: Date.now(),
        });

        return response;
      } catch (err) {
        entry.request.status = 'failed';
        entry.error = err instanceof Error ? err.message : String(err);
        entry.isFailure = true;
        entry.completedAt = Date.now();

        tracker.inFlight.delete(id);
        tracker.completed.push(entry);
        tracker.trimCompleted();
        tracker.emitEvent({
          type: 'request-error',
          entry,
          pendingCount: tracker.inFlight.size,
          timestamp: Date.now(),
        });

        throw err;
      }
    };
  }

  private installXHRInterceptor(): void {
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const tracker = this;

    // Patch open to capture URL and method
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      const xhr = this as XMLHttpRequest & {
        __netTrackerMethod?: string;
        __netTrackerUrl?: string;
      };
      xhr.__netTrackerMethod = method;
      xhr.__netTrackerUrl = typeof url === 'string' ? url : url.href;
      return tracker.originalXHROpen!.call(this, method, url, async ?? true, username, password);
    };

    // Patch send to track the request
    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const xhr = this as XMLHttpRequest & {
        __netTrackerMethod?: string;
        __netTrackerUrl?: string;
        __netTrackerId?: string;
      };
      const url = xhr.__netTrackerUrl || '';
      const method = (xhr.__netTrackerMethod || 'GET').toUpperCase();

      if (tracker.shouldIgnore(url)) {
        return tracker.originalXHRSend!.call(this, body);
      }

      const id = tracker.generateId();
      xhr.__netTrackerId = id;

      const entry: NetworkRequestEntry = {
        request: {
          id,
          method,
          url,
          pathname: tryParsePathname(url),
          bodyPreview:
            typeof body === 'string' ? truncate(body, tracker.config.maxBodyPreview) : undefined,
          startedAt: Date.now(),
          status: 'in-flight',
        },
        isFailure: false,
      };

      tracker.inFlight.set(id, entry);
      tracker.emitEvent({
        type: 'request-start',
        entry,
        pendingCount: tracker.inFlight.size,
        timestamp: Date.now(),
      });

      // Handle completion
      xhr.addEventListener('loadend', () => {
        const durationMs = Date.now() - entry.request.startedAt;
        const isError = xhr.status === 0 || xhr.status >= 400;

        entry.request.status = isError ? 'failed' : 'completed';
        entry.response = {
          statusCode: xhr.status,
          statusText: xhr.statusText,
          durationMs,
        };
        entry.isFailure = isError;
        entry.completedAt = Date.now();

        // Capture response body preview for errors
        if (isError || !tracker.config.errorBodiesOnly) {
          try {
            const responseText =
              xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : undefined;
            if (responseText) {
              entry.response.bodyPreview = truncate(responseText, tracker.config.maxBodyPreview);
            }
          } catch {
            /* ignore — responseText may not be accessible for some responseTypes */
          }
        }

        // Try to extract request ID from response headers
        entry.requestId = tracker.extractRequestIdFromXHR(xhr);

        // Capture response headers if configured
        if (tracker.config.captureHeaders) {
          entry.response.headers = tracker.parseXHRResponseHeaders(xhr);
        }

        tracker.inFlight.delete(id);
        tracker.completed.push(entry);
        tracker.trimCompleted();
        tracker.emitEvent({
          type: isError ? 'request-error' : 'request-complete',
          entry,
          pendingCount: tracker.inFlight.size,
          timestamp: Date.now(),
        });
      });

      // Handle network-level errors (loadend also fires, but capture error message here)
      xhr.addEventListener('error', () => {
        entry.error = 'Network error';
      });

      // Handle aborted requests
      xhr.addEventListener('abort', () => {
        entry.request.status = 'cancelled';
        entry.error = 'Request aborted';
      });

      return tracker.originalXHRSend!.call(this, body);
    };
  }

  // =========================================================================
  // Private — Helpers
  // =========================================================================

  private shouldIgnore(url: string): boolean {
    return this.config.ignorePatterns.some((p) => url.includes(p));
  }

  private generateId(): string {
    return `net-${++this.requestCounter}`;
  }

  private extractHeaders(
    headers: HeadersInit | undefined,
    capture: boolean
  ): Record<string, string> | undefined {
    if (!capture || !headers) return undefined;

    const result: Record<string, string> = {};

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        result[key] = value;
      });
    } else if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        result[key] = value;
      }
    } else {
      // Record<string, string>
      for (const [key, value] of Object.entries(headers)) {
        result[key] = value;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  private async captureBodyPreview(body: BodyInit | null | undefined): Promise<string | undefined> {
    if (!body) return undefined;

    if (typeof body === 'string') {
      return truncate(body, this.config.maxBodyPreview);
    }

    // For Blob, ArrayBuffer, etc. we skip preview to avoid async overhead
    return undefined;
  }

  private async captureResponsePreview(
    response: Response,
    isError: boolean
  ): Promise<string | undefined> {
    if (!isError && this.config.errorBodiesOnly) return undefined;

    try {
      const text = await response.text();
      return truncate(text, this.config.maxBodyPreview);
    } catch {
      return undefined;
    }
  }

  private extractRequestId(headers: Headers): string | undefined {
    for (const name of REQUEST_ID_HEADERS) {
      const value = headers.get(name);
      if (value) return value;
    }
    return undefined;
  }

  private extractRequestIdFromXHR(xhr: XMLHttpRequest): string | undefined {
    for (const name of REQUEST_ID_HEADERS) {
      const value = xhr.getResponseHeader(name);
      if (value) return value;
    }
    return undefined;
  }

  private parseXHRResponseHeaders(xhr: XMLHttpRequest): Record<string, string> | undefined {
    const raw = xhr.getAllResponseHeaders();
    if (!raw) return undefined;

    const result: Record<string, string> = {};
    const lines = raw.trim().split(/[\r\n]+/);
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private trimCompleted(): void {
    if (this.completed.length > this.config.maxEntries) {
      this.completed = this.completed.slice(this.completed.length - this.config.maxEntries);
    }
  }

  private emitEvent(event: NetworkEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the tracker
      }
    }
  }

  private matchesFilter(entry: NetworkRequestEntry, filter: NetworkRequestFilter): boolean {
    // Status filter
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!statuses.includes(entry.request.status)) return false;
    }

    // Method filter
    if (filter.method) {
      const methods = Array.isArray(filter.method) ? filter.method : [filter.method];
      const upperMethods = methods.map((m) => m.toUpperCase());
      if (!upperMethods.includes(entry.request.method)) return false;
    }

    // URL pattern (substring match)
    if (filter.urlPattern) {
      if (!entry.request.url.includes(filter.urlPattern)) return false;
    }

    // URL regex
    if (filter.urlRegex) {
      const re = new RegExp(filter.urlRegex);
      if (!re.test(entry.request.url)) return false;
    }

    // Failures only
    if (filter.failuresOnly && !entry.isFailure) return false;

    // Since timestamp
    if (filter.since != null && entry.request.startedAt < filter.since) return false;

    // Status code range
    if (filter.minStatus != null && entry.response) {
      if (entry.response.statusCode < filter.minStatus) return false;
    }
    if (filter.maxStatus != null && entry.response) {
      if (entry.response.statusCode > filter.maxStatus) return false;
    }

    return true;
  }

  private applyFilter(
    entries: NetworkRequestEntry[],
    filter: NetworkRequestFilter
  ): NetworkRequestEntry[] {
    let result = entries.filter((e) => this.matchesFilter(e, filter));
    if (filter.limit != null && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }
    return result;
  }

  private matchesWaitOptions(entry: NetworkRequestEntry, options: WaitForRequestOptions): boolean {
    if (options.method && entry.request.method !== options.method.toUpperCase()) {
      return false;
    }

    if (options.urlPattern && !entry.request.url.includes(options.urlPattern)) {
      return false;
    }

    if (options.urlRegex) {
      const re = new RegExp(options.urlRegex);
      if (!re.test(entry.request.url)) return false;
    }

    return true;
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

function getUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function getMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function tryParsePathname(url: string): string | undefined {
  try {
    // Use a dummy base for relative URLs
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
    return parsed.pathname;
  } catch {
    return undefined;
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return truncateCodePoints(text, maxLength) + '...';
}
