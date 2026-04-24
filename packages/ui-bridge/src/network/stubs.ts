/**
 * Network Stub Registry (F2)
 *
 * Server-side registry of fetch-response stubs so tests can short-circuit
 * `window.fetch` calls without hand-rolling a monkey-patch through
 * `page/evaluate`.
 *
 * Design:
 *   - The registry is a module-level singleton (NOT React component state).
 *     Stubs must survive React re-renders, and — per F1 — soft navigations
 *     preserve `window.*` and module scope, so stubs registered before a
 *     `mode: "soft"` navigate keep matching afterwards.
 *   - Stubs clear on hard reload because module state is reinitialised with
 *     the SDK. This is the documented page-lifetime scope.
 *   - Matching is first-registered-wins (FIFO). `times: 1` entries are
 *     consumed on first match; `times: "always"` entries stay until deleted.
 */

// ============================================================================
// Public types
// ============================================================================

export type StubMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | '*';

/** Body options: exactly one of `body` / `bodyJson` is required. */
export interface StubResponseSpec {
  /** HTTP status code. Default 200. Must be in 100-599. */
  status?: number;
  /** Response headers. Merged with auto `content-type` when `bodyJson` is set. */
  headers?: Record<string, string>;
  /** Raw string body. Mutually exclusive with `bodyJson`. */
  body?: string;
  /** JSON body sugar — stringified & auto-sets `content-type: application/json`. */
  bodyJson?: unknown;
}

export interface StubRequestSpec {
  /** Substring match against the request URL (case-sensitive). Required. */
  urlPattern: string;
  /** HTTP method to match. `"*"` matches any. Default `"*"`. */
  method?: StubMethod;
  response: StubResponseSpec;
  /** `"always"` or a positive integer. Default `"always"`. */
  times?: number | 'always';
}

/** A registered stub as returned by `listStubs()`. */
export interface StubEntry {
  id: string;
  urlPattern: string;
  method: StubMethod;
  timesRemaining: number | 'always';
  hitCount: number;
}

/** Result of a match lookup. */
export interface StubMatch {
  id: string;
  buildResponse: () => Response;
}

// ============================================================================
// Validation
// ============================================================================

export interface StubValidationError {
  field: string;
  message: string;
}

/**
 * Validate a StubRequestSpec. Returns the first error (or null if valid).
 * Centralised so the SDK side + Rust handlers can share the same contract.
 */
export function validateStubRequest(input: unknown): StubValidationError | null {
  if (!input || typeof input !== 'object') {
    return { field: 'body', message: 'body must be an object' };
  }
  const spec = input as Partial<StubRequestSpec>;

  if (typeof spec.urlPattern !== 'string' || spec.urlPattern.length === 0) {
    return { field: 'urlPattern', message: 'urlPattern must be a non-empty string' };
  }

  if (spec.method !== undefined) {
    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', '*'].includes(spec.method as string)) {
      return {
        field: 'method',
        message: `method must be one of GET|POST|PUT|DELETE|PATCH|*, got "${spec.method}"`,
      };
    }
  }

  if (!spec.response || typeof spec.response !== 'object') {
    return { field: 'response', message: 'response is required' };
  }
  const resp = spec.response;

  if (resp.status !== undefined) {
    if (
      typeof resp.status !== 'number' ||
      !Number.isInteger(resp.status) ||
      resp.status < 100 ||
      resp.status > 599
    ) {
      return {
        field: 'response.status',
        message: `status must be an integer in 100-599, got ${resp.status}`,
      };
    }
  }

  const hasBody = typeof resp.body === 'string';
  const hasBodyJson = resp.bodyJson !== undefined;
  if (!hasBody && !hasBodyJson) {
    return {
      field: 'response.body',
      message: 'exactly one of response.body or response.bodyJson is required',
    };
  }
  if (hasBody && hasBodyJson) {
    return {
      field: 'response.body',
      message: 'response.body and response.bodyJson are mutually exclusive',
    };
  }

  if (spec.times !== undefined) {
    if (spec.times === 'always') {
      // ok
    } else if (typeof spec.times !== 'number' || !Number.isInteger(spec.times) || spec.times < 1) {
      return {
        field: 'times',
        message: `times must be "always" or a positive integer, got ${JSON.stringify(spec.times)}`,
      };
    }
  }

  return null;
}

// ============================================================================
// Registry
// ============================================================================

interface InternalStub {
  id: string;
  urlPattern: string;
  method: StubMethod;
  status: number;
  headers: Record<string, string>;
  body: string;
  timesRemaining: number | 'always';
  hitCount: number;
}

export class NetworkStubRegistry {
  private stubs: InternalStub[] = [];
  private counter = 0;

  /** Register a new stub. Returns the generated ID. Caller must validate first. */
  register(spec: StubRequestSpec): string {
    const id = this.generateId();
    const method: StubMethod = spec.method ?? '*';
    const resp = spec.response;
    const status = resp.status ?? 200;

    // Normalise headers (lowercase keys) and synthesise content-type for bodyJson.
    const headers: Record<string, string> = {};
    if (resp.headers) {
      for (const [k, v] of Object.entries(resp.headers)) {
        headers[k.toLowerCase()] = v;
      }
    }

    let body: string;
    if (resp.bodyJson !== undefined) {
      body = JSON.stringify(resp.bodyJson);
      if (!('content-type' in headers)) {
        headers['content-type'] = 'application/json';
      }
    } else {
      body = resp.body ?? '';
    }

    this.stubs.push({
      id,
      urlPattern: spec.urlPattern,
      method,
      status,
      headers,
      body,
      timesRemaining: spec.times ?? 'always',
      hitCount: 0,
    });

    return id;
  }

  /**
   * Look up the first matching stub (FIFO). Consumes a use from `times: N`
   * stubs; removes them when exhausted. Returns null on no match.
   */
  match(url: string, method: string): StubMatch | null {
    const upper = method.toUpperCase();
    for (let i = 0; i < this.stubs.length; i++) {
      const s = this.stubs[i];
      if (s.method !== '*' && s.method !== upper) continue;
      if (!url.includes(s.urlPattern)) continue;

      s.hitCount += 1;
      if (typeof s.timesRemaining === 'number') {
        s.timesRemaining -= 1;
        if (s.timesRemaining <= 0) {
          // Consume: remove this stub so subsequent matches pass through.
          this.stubs.splice(i, 1);
        }
      }

      const { status, headers, body } = s;
      return {
        id: s.id,
        buildResponse: () =>
          new Response(body, {
            status,
            headers: { ...headers },
          }),
      };
    }
    return null;
  }

  /**
   * Non-consuming lookup — N3 `verify-stub`.
   *
   * Same FIFO matching semantics as `match()` but does NOT mutate state:
   *   - `hitCount` is NOT incremented,
   *   - `timesRemaining` is NOT decremented,
   *   - `times: 1` stubs are NOT removed.
   *
   * Returns the same `StubMatch` shape so callers can call `buildResponse()`
   * and report the hypothetical response body/headers/status without
   * actually firing the stub. A snapshot of the matched stub's metadata is
   * exposed via the companion `peekEntry()` helper below — callers that
   * need both the response and the registry-state snapshot typically call
   * `peek()` and `peekEntry()` together.
   *
   * Intended for server-side verification endpoints (e.g.
   * `POST /control/network/verify-stub`) where tests want to ask "would
   * this URL get stubbed?" without consuming a `times: 1` entry.
   */
  peek(url: string, method: string): StubMatch | null {
    const upper = method.toUpperCase();
    for (const s of this.stubs) {
      if (s.method !== '*' && s.method !== upper) continue;
      if (!url.includes(s.urlPattern)) continue;

      const { status, headers, body } = s;
      return {
        id: s.id,
        buildResponse: () =>
          new Response(body, {
            status,
            headers: { ...headers },
          }),
      };
    }
    return null;
  }

  /**
   * Companion to `peek()` — returns the matched stub's registry entry
   * (the same shape `list()` returns per stub) without consuming it.
   *
   * Kept separate from `peek()` so the hot `StubMatch` path stays minimal,
   * and so callers that only need the response can skip the extra
   * allocation.
   */
  peekEntry(url: string, method: string): StubEntry | null {
    const upper = method.toUpperCase();
    for (const s of this.stubs) {
      if (s.method !== '*' && s.method !== upper) continue;
      if (!url.includes(s.urlPattern)) continue;
      return {
        id: s.id,
        urlPattern: s.urlPattern,
        method: s.method,
        timesRemaining: s.timesRemaining,
        hitCount: s.hitCount,
      };
    }
    return null;
  }

  /** Delete a stub by ID. Returns true if removed, false if unknown. */
  delete(id: string): boolean {
    const before = this.stubs.length;
    this.stubs = this.stubs.filter((s) => s.id !== id);
    return this.stubs.length < before;
  }

  /** Clear all stubs. Returns the count of stubs removed. */
  clear(): number {
    const count = this.stubs.length;
    this.stubs = [];
    return count;
  }

  /** Snapshot of all registered stubs in registration order. */
  list(): StubEntry[] {
    return this.stubs.map((s) => ({
      id: s.id,
      urlPattern: s.urlPattern,
      method: s.method,
      timesRemaining: s.timesRemaining,
      hitCount: s.hitCount,
    }));
  }

  /** Test helper: drop all state, reset the ID counter. */
  reset(): void {
    this.stubs = [];
    this.counter = 0;
  }

  private generateId(): string {
    // 6 random hex chars + counter keeps IDs readable but collision-free.
    this.counter += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    return `stub_${rand}${this.counter.toString(36)}`;
  }
}

// ============================================================================
// Module-level singleton
// ============================================================================

let globalRegistry: NetworkStubRegistry | null = null;

/**
 * Access the process-wide stub registry. Module-level so stubs survive
 * React re-renders and F1 soft navigations.
 */
export function getGlobalStubRegistry(): NetworkStubRegistry {
  if (!globalRegistry) {
    globalRegistry = new NetworkStubRegistry();
  }
  return globalRegistry;
}

/** Test helper: replace the singleton with a fresh registry. */
export function __resetGlobalStubRegistryForTest(): void {
  if (stubInterceptorInstalled && stubInterceptorRealFetch && typeof window !== 'undefined') {
    window.fetch = stubInterceptorRealFetch;
  }
  stubInterceptorInstalled = false;
  stubInterceptorRealFetch = null;
  globalRegistry = new NetworkStubRegistry();
}

// ============================================================================
// Standalone fetch interceptor — for runtimes that don't use commandHandlers
// ============================================================================
//
// The primary stub-match short-circuit lives inside `installNetworkInterceptor`
// in `react/commandHandlers.ts`, which the browser SDK installs lazily. Hosts
// like the Tauri runner have their own Tauri-IPC command dispatcher and never
// reach that function, so they need a separate minimal wrapper that only does
// stub-matching (no network-request tracking, which they already install
// elsewhere via `NetworkRequestTracker`).
//
// `installStubFetchInterceptor()` is idempotent: calling it repeatedly is safe
// and only wraps `window.fetch` once.

let stubInterceptorInstalled = false;
let stubInterceptorRealFetch: typeof fetch | null = null;

/**
 * Wrap `window.fetch` with a stub-matcher that short-circuits matching URLs.
 * Safe to call multiple times; only the first call replaces fetch. Unmatched
 * requests fall through to the real fetch. Intended for non-browser-SDK hosts
 * (e.g. the Tauri runner) that manage stub lifecycle via their own command
 * dispatcher and need the stub short-circuit without the full
 * `installNetworkInterceptor` (which also owns network-request tracking).
 */
export function installStubFetchInterceptor(): void {
  if (stubInterceptorInstalled) return;
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  stubInterceptorRealFetch = window.fetch.bind(window);
  const realFetch = stubInterceptorRealFetch;
  const registry = getGlobalStubRegistry();
  window.fetch = async (input, init) => {
    // Extract URL + method without constructing a Request (jsdom-safe).
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = (
      init?.method ??
      (typeof input === 'object' && input !== null && 'method' in input
        ? (input as Request).method
        : 'GET') ??
      'GET'
    ).toUpperCase();
    const match = registry.match(url, method);
    if (match) {
      return match.buildResponse();
    }
    return realFetch(input as RequestInfo, init);
  };
  stubInterceptorInstalled = true;
}
