/**
 * BaseTransport
 *
 * Abstract base class for every transport. Owns the shared `HandlerRegistry`
 * plus a small status + listener state machine. Subclasses implement:
 *
 *   - `kind`                  — static identifier
 *   - `onReady()`             — async setup (browser launch, ws handshake...)
 *   - `onClose()`             — async teardown
 *   - `buildContext(actionId, params)` — per-dispatch context passed to the
 *                                        registered handler (e.g. `{ page }`)
 *
 * `dispatch` is final; it coordinates `ready()` gating, then routes through
 * the registry. Subclasses that need to marshal dispatches over the wire
 * (like `LiveSessionTransport`) can override `dispatch` directly.
 */

import { HandlerRegistry, type WrapperHandler } from './handler-registry.js';
import type { WrapperTransport, WrapperTransportKind, WrapperTransportStatus } from './types.js';
import { WrapperTransportError } from './types.js';

export abstract class BaseTransport implements WrapperTransport {
  abstract readonly kind: WrapperTransportKind;

  protected _status: WrapperTransportStatus = 'idle';
  protected readonly listeners = new Set<(s: WrapperTransportStatus) => void>();
  protected readonly registry: HandlerRegistry;
  private readyPromise: Promise<void> | null = null;

  constructor(registry?: HandlerRegistry) {
    this.registry = registry ?? new HandlerRegistry();
  }

  get status(): WrapperTransportStatus {
    return this._status;
  }

  /** Expose the underlying registry so wrappers can register handlers. */
  get handlerRegistry(): HandlerRegistry {
    return this.registry;
  }

  /** Convenience: register a handler on the transport's registry. */
  register<TParams = unknown, TResult = unknown, TCtx = unknown>(
    actionId: string,
    fn: WrapperHandler<TParams, TResult, TCtx>
  ): void {
    this.registry.register(actionId, fn);
  }

  /**
   * Idempotent async setup. First call runs `onReady()`; subsequent calls
   * share the same promise until it settles, after which further calls
   * are no-ops if `status === 'ready'`, or re-run setup if it errored.
   */
  async ready(): Promise<void> {
    if (this._status === 'ready') return;
    if (this._status === 'closed') {
      throw new WrapperTransportError('TRANSPORT_CLOSED', `Transport '${this.kind}' is closed`);
    }
    if (this.readyPromise) return this.readyPromise;

    this.setStatus('connecting');
    this.readyPromise = this.onReady()
      .then(() => {
        this.setStatus('ready');
      })
      .catch((err: unknown) => {
        this.setStatus('error');
        this.readyPromise = null;
        throw err;
      });
    return this.readyPromise;
  }

  /** Default dispatch — waits for ready, builds ctx, delegates to registry. */
  async dispatch<TResult = unknown>(actionId: string, params?: unknown): Promise<TResult> {
    await this.ready();
    const ctx = await this.buildContext(actionId, params);
    return this.registry.dispatch<TResult>(actionId, params, ctx);
  }

  async close(): Promise<void> {
    if (this._status === 'closed') return;
    try {
      await this.onClose();
    } finally {
      this.setStatus('closed');
      this.listeners.clear();
      this.readyPromise = null;
    }
  }

  onStatusChange(listener: (s: WrapperTransportStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Update status and notify listeners. Safe to call from subclasses. */
  protected setStatus(next: WrapperTransportStatus): void {
    if (this._status === next) return;
    this._status = next;
    for (const l of this.listeners) {
      try {
        l(next);
      } catch {
        // Listener errors must not affect transport state.
      }
    }
  }

  /** Subclass hook: perform async setup. */
  protected abstract onReady(): Promise<void>;

  /** Subclass hook: tear down async resources. */
  protected abstract onClose(): Promise<void>;

  /**
   * Subclass hook: build the context object passed to handlers. Default is
   * `undefined` (api transport). Headless/headed override to provide the
   * Playwright `page`; live overrides to provide a response helper.
   */
  protected async buildContext(_actionId: string, _params: unknown): Promise<unknown> {
    return undefined;
  }
}
