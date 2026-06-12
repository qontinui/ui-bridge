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

export class NetworkRequestBuffer {
  private buffer: RingBuffer<NetworkRequestEntry>;
  private installed = false;
  private originalFetch?: FetchFn;
  private originalXhrOpen?: typeof XMLHttpRequest.prototype.open;
  private originalXhrSend?: typeof XMLHttpRequest.prototype.send;

  constructor(capacity = 100) {
    this.buffer = new RingBuffer<NetworkRequestEntry>(capacity);
  }

  install(): void {
    if (this.installed) return;
    const g = globalThis as PatchableGlobal;

    if (typeof g.fetch === 'function') {
      // Capture the original reference as-is so `uninstall()` restores the
      // exact function callers had before we patched.
      this.originalFetch = g.fetch;
      const buffer = this.buffer;
      const original = this.originalFetch;

      const patched: FetchFn = async (input, init) => {
        const start = Date.now();
        const url = extractUrl(input);
        const method = extractMethod(input, init);

        try {
          const res = await original.call(globalThis, input, init);
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

      // Stash method+url on the instance so `send` can record them.
      const origOpen = this.originalXhrOpen;
      Xhr.prototype.open = function (
        this: XMLHttpRequest & {
          __uiBridgeMethod?: string;
          __uiBridgeUrl?: string;
        },
        method: string,
        url: string | URL,
        ...rest: unknown[]
      ) {
        this.__uiBridgeMethod = method.toUpperCase();
        this.__uiBridgeUrl = typeof url === 'string' ? url : String(url);
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
        this: XMLHttpRequest & {
          __uiBridgeMethod?: string;
          __uiBridgeUrl?: string;
        },
        body?: Document | XMLHttpRequestBodyInit | null
      ) {
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
