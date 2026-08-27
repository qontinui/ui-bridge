/**
 * UI Bridge Native — observability ring buffers.
 *
 * Two small last-N buffers backing the `/control/console-errors` and
 * `/sdk/network-requests` endpoints. Each buffer monkey-patches the relevant
 * global on `install()` and restores the original on `uninstall()`, so they
 * can be installed/torn-down with the server's lifecycle.
 *
 * Both buffers are gated behind `features.observability` by the caller (see
 * NativeUIBridgeServer), which defaults to the `features.testHooks` value.
 * Builds with both flags off never run these patches; release builds can
 * opt in with `observability: true` without enabling testHooks.
 *
 * Implementation notes:
 *   - Buffers default to capacity 100 entries and drop oldest on overflow.
 *   - Patches are idempotent: `install()` is a no-op when already installed;
 *     `uninstall()` is a no-op when not installed.
 *   - Patches only restore the *original* function captured at install time;
 *     if other code wraps `console.error` / `fetch` between install and
 *     uninstall, those wrappers will be lost. Acceptable for test hooks.
 */
import type { ConsoleErrorEntry, NetworkRequestEntry } from './types';

// ── Ring buffer ─────────────────────────────────────────────────────────────

/** A simple ring buffer that drops oldest on overflow. */
class RingBuffer<T extends { timestamp: number }> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {}

  push(entry: T): void {
    this.items.push(entry);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  /**
   * Return entries optionally filtered by `since` (timestamp ms) and capped
   * at `limit`. Newest-end is preserved when `limit` would otherwise truncate.
   */
  entries(opts: { since?: number; limit?: number } = {}): T[] {
    const { since, limit } = opts;
    let filtered = this.items;
    if (typeof since === 'number') {
      filtered = filtered.filter((e) => e.timestamp >= since);
    }
    if (typeof limit === 'number' && limit >= 0 && filtered.length > limit) {
      filtered = filtered.slice(filtered.length - limit);
    }
    return filtered.slice();
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}

// ── Console error buffer ────────────────────────────────────────────────────

interface PatchedConsole {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

/**
 * Format console arguments the same way `console.log` would (joined by
 * spaces, with errors stringified to their `message`).
 */
function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/** Pull the first `Error` from the args, if any, and return its `.stack`. */
function extractStack(args: unknown[]): string | undefined {
  for (const a of args) {
    if (a instanceof Error && a.stack) return a.stack;
  }
  return undefined;
}

export class ConsoleErrorBuffer {
  private buffer: RingBuffer<ConsoleErrorEntry>;
  private installed = false;
  private originalError?: PatchedConsole['error'];
  private originalWarn?: PatchedConsole['warn'];

  constructor(capacity = 100) {
    this.buffer = new RingBuffer<ConsoleErrorEntry>(capacity);
  }

  install(): void {
    if (this.installed) return;
    if (typeof console === 'undefined') return;

    // Capture the originals as-is (no .bind) so `uninstall()` restores the
    // exact reference callers had before we touched the global.
    this.originalError = console.error as PatchedConsole['error'];
    this.originalWarn = console.warn as PatchedConsole['warn'];

    const buffer = this.buffer;
    const origError = this.originalError;
    const origWarn = this.originalWarn;

    console.error = (...args: unknown[]): void => {
      try {
        buffer.push({
          timestamp: Date.now(),
          level: 'error',
          message: formatConsoleArgs(args),
          stack: extractStack(args),
        });
      } catch {
        // Never let the patch throw — fall through to the original.
      }
      origError.apply(console, args);
    };

    console.warn = (...args: unknown[]): void => {
      try {
        buffer.push({
          timestamp: Date.now(),
          level: 'warn',
          message: formatConsoleArgs(args),
          stack: extractStack(args),
        });
      } catch {
        // ignore
      }
      origWarn.apply(console, args);
    };

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;
    if (typeof console === 'undefined') return;

    if (this.originalError) console.error = this.originalError;
    if (this.originalWarn) console.warn = this.originalWarn;

    this.originalError = undefined;
    this.originalWarn = undefined;
    this.installed = false;
  }

  entries(opts: { since?: number; limit?: number } = {}): ConsoleErrorEntry[] {
    return this.buffer.entries(opts);
  }

  size(): number {
    return this.buffer.size();
  }

  clear(): void {
    this.buffer.clear();
  }

  isInstalled(): boolean {
    return this.installed;
  }
}

// ── Network request buffer ──────────────────────────────────────────────────

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Best-effort URL extraction from a `fetch` first-arg. Mirrors what RN's
 * polyfill accepts (string | URL | Request).
 */
function extractUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const obj = input as { url?: unknown; toString?: () => string };
    if (typeof obj.url === 'string') return obj.url;
    try {
      return String(input);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Best-effort method extraction. `fetch(url, {method})` overrides the
 * Request's method, so we check `init` first and fall back to the Request.
 */
function extractMethod(input: unknown, init?: RequestInit): string {
  if (init && typeof init.method === 'string') return init.method.toUpperCase();
  if (input && typeof input === 'object') {
    const obj = input as { method?: unknown };
    if (typeof obj.method === 'string') return obj.method.toUpperCase();
  }
  return 'GET';
}

/** Minimal shape of `globalThis` we patch. Avoids depending on DOM types. */
interface PatchableGlobal {
  fetch?: FetchFn;
  XMLHttpRequest?: typeof XMLHttpRequest;
}

/**
 * An XHR instance, plus the markers the patches hang on it.
 *
 * `__uiBridgeMethod` / `__uiBridgeUrl` carry method+url from `open` to `send`.
 * `__uiBridgeFromFetch` marks an XHR that the `fetch` polyfill created for
 * itself — see {@link NetworkRequestBuffer.install}.
 */
type MarkedXhr = XMLHttpRequest & {
  __uiBridgeMethod?: string;
  __uiBridgeUrl?: string;
  __uiBridgeFromFetch?: boolean;
};

export class NetworkRequestBuffer {
  private buffer: RingBuffer<NetworkRequestEntry>;
  private installed = false;
  private originalFetch?: FetchFn;
  private originalXhrOpen?: typeof XMLHttpRequest.prototype.open;
  private originalXhrSend?: typeof XMLHttpRequest.prototype.send;
  /**
   * Synchronous re-entrancy depth: non-zero while the ORIGINAL `fetch` is
   * executing, which is exactly the window in which React Native's whatwg-fetch
   * polyfill constructs and opens its internal `XMLHttpRequest`.
   *
   * A counter rather than a boolean so a `fetch` called from inside a `fetch`
   * (an interceptor, a retry wrapper) still unwinds to zero. Safe as a plain
   * number: JS is single-threaded and the only writes are the paired
   * increment/decrement around one synchronous call.
   */
  private fetchDepth = { value: 0 };

  constructor(capacity = 100) {
    this.buffer = new RingBuffer<NetworkRequestEntry>(capacity);
  }

  /**
   * Patch `fetch` and `XMLHttpRequest` so `GET /sdk/network-requests` can
   * report what the app talked to.
   *
   * ONE REQUEST MUST PRODUCE ONE ENTRY. React Native implements `fetch` **on
   * top of** XHR (whatwg-fetch), so both patches observe the same request and
   * the buffer used to carry every call twice — same url, timestamps ~1ms
   * apart, and on failure one `"Network request failed"` beside one
   * `"XMLHttpRequest error"`. A tester reads that as a double-fetch bug in the
   * app and chases a defect that does not exist.
   *
   * The de-dup: `fetchDepth` is raised across the synchronous call into the
   * original `fetch`, which is when the polyfill builds its XHR; `open` stamps
   * any XHR created in that window with `__uiBridgeFromFetch`, and `send`
   * skips recording those. The `fetch` patch keeps the entry, because it is
   * the layer the app actually called and the only one that sees `Response.ok`.
   *
   * Uninstalling both patches together keeps this sound: an XHR can only be
   * marked while the fetch patch is live.
   *
   * KNOWN LIMIT — it is coupled to the polyfill building its XHR SYNCHRONOUSLY,
   * which whatwg-fetch does (its work happens in the Promise executor). If the
   * host's `fetch` is wrapped by an interceptor that defers the real call to a
   * microtask or `setTimeout`, the depth is back to 0 by the time `open` runs
   * and every request duplicates again — the original symptom, with no signal
   * that the mechanism disengaged. Duplicates in `/sdk/network-requests` are
   * the thing to look for; they mean this assumption stopped holding, not that
   * the app double-fetched.
   */
  install(): void {
    if (this.installed) return;
    const g = globalThis as PatchableGlobal;

    if (typeof g.fetch === 'function') {
      // Capture the original reference as-is so `uninstall()` restores the
      // exact function callers had before we patched.
      this.originalFetch = g.fetch;
      const buffer = this.buffer;
      const original = this.originalFetch;
      const fetchDepth = this.fetchDepth;

      const patched: FetchFn = async (input, init) => {
        const start = Date.now();
        const url = extractUrl(input);
        const method = extractMethod(input, init);

        try {
          // The polyfill's `new XMLHttpRequest()` / `open` / `send` all happen
          // synchronously inside this call (whatwg-fetch does its work in the
          // Promise executor), so raising the depth across just the invocation
          // — not the await — covers exactly that window and nothing else.
          let pending: Promise<Response>;
          fetchDepth.value += 1;
          try {
            pending = original.call(globalThis, input, init);
          } finally {
            fetchDepth.value -= 1;
          }
          const res = await pending;
          buffer.push({
            timestamp: start,
            method,
            url,
            status: res.status,
            durationMs: Date.now() - start,
            ok: res.ok,
          });
          return res;
        } catch (err) {
          buffer.push({
            timestamp: start,
            method,
            url,
            status: 0,
            durationMs: Date.now() - start,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      };

      g.fetch = patched;
    }

    // Patch XMLHttpRequest if present (RN ships it; node doesn't unless polyfilled).
    if (typeof g.XMLHttpRequest === 'function') {
      const Xhr = g.XMLHttpRequest;
      this.originalXhrOpen = Xhr.prototype.open;
      this.originalXhrSend = Xhr.prototype.send;

      const buffer = this.buffer;
      const fetchDepth = this.fetchDepth;

      // Stash method+url on the instance so `send` can record them.
      const origOpen = this.originalXhrOpen;
      Xhr.prototype.open = function (
        this: MarkedXhr,
        method: string,
        url: string | URL,
        ...rest: unknown[]
      ) {
        this.__uiBridgeMethod = method.toUpperCase();
        this.__uiBridgeUrl = typeof url === 'string' ? url : String(url);
        // Opened while the original `fetch` was running: this XHR belongs to
        // the fetch polyfill, and the fetch patch already records it.
        //
        // KNOWN LIMIT — the window, not the identity, is what's tested, so an
        // UNRELATED xhr opened synchronously inside another wrapper's `fetch`
        // (an analytics beacon, an error-reporter transport) is dropped too.
        // Narrowing this to the polyfill's own XHR means matching on url, and
        // whatwg-fetch normalises the url it opens with — a mismatch there
        // would silently restore the duplicate-every-request bug rather than
        // lose one beacon. Pinned by a test in network-buffer-dedup.test.ts.
        if (fetchDepth.value > 0) {
          this.__uiBridgeFromFetch = true;
        }
        // origOpen has overloaded signatures; we forward the original args.
        return (origOpen as (...args: unknown[]) => unknown).call(
          this,
          method,
          url,
          ...rest
        ) as void;
      } as typeof XMLHttpRequest.prototype.open;

      const origSend = this.originalXhrSend;
      Xhr.prototype.send = function (
        this: MarkedXhr,
        body?: Document | XMLHttpRequestBodyInit | null
      ) {
        // The fetch patch owns this request's entry. Recording it here too is
        // what made every RN request appear twice in the buffer.
        //
        // The MARKER is the whole test, deliberately. A `fetchDepth > 0` check
        // here as well would also drop any UNRELATED xhr sent synchronously
        // during a `fetch` — an analytics beacon from a library that wrapped
        // `fetch` first, say — and a silently absent request is a worse answer
        // than a visible duplicate.
        if (this.__uiBridgeFromFetch === true) {
          return (origSend as (...args: unknown[]) => unknown).call(this, body) as void;
        }

        const start = Date.now();
        const method = this.__uiBridgeMethod ?? 'GET';
        const url = this.__uiBridgeUrl ?? '';

        const finalize = (status: number, ok: boolean, error?: string) => {
          buffer.push({
            timestamp: start,
            method,
            url,
            status,
            durationMs: Date.now() - start,
            ok,
            error,
          });
        };

        const onLoadEnd = () => {
          this.removeEventListener('loadend', onLoadEnd);
          this.removeEventListener('error', onError);
          finalize(this.status, this.status >= 200 && this.status < 300);
        };
        const onError = () => {
          this.removeEventListener('loadend', onLoadEnd);
          this.removeEventListener('error', onError);
          finalize(0, false, 'XMLHttpRequest error');
        };

        this.addEventListener('loadend', onLoadEnd);
        this.addEventListener('error', onError);

        return (origSend as (...args: unknown[]) => unknown).call(
          this,
          body
        ) as void;
      } as typeof XMLHttpRequest.prototype.send;
    }

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;
    const g = globalThis as PatchableGlobal;

    if (this.originalFetch) {
      g.fetch = this.originalFetch;
      this.originalFetch = undefined;
    }
    if (typeof g.XMLHttpRequest === 'function') {
      if (this.originalXhrOpen) {
        g.XMLHttpRequest.prototype.open = this.originalXhrOpen;
      }
      if (this.originalXhrSend) {
        g.XMLHttpRequest.prototype.send = this.originalXhrSend;
      }
    }
    this.originalXhrOpen = undefined;
    this.originalXhrSend = undefined;
    this.installed = false;
  }

  entries(opts: { since?: number; limit?: number } = {}): NetworkRequestEntry[] {
    return this.buffer.entries(opts);
  }

  size(): number {
    return this.buffer.size();
  }

  clear(): void {
    this.buffer.clear();
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
