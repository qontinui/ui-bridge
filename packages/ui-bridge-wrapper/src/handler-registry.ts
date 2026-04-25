/**
 * HandlerRegistry
 *
 * Shared by every concrete transport. The transport's `dispatch` method
 * looks up a handler by `actionId`, invokes it with `(params, ctx)`, and
 * awaits the (possibly async) result.
 *
 * The registry deliberately knows nothing about the transport — transports
 * build their own `ctx` object (e.g. `{ page }` for headless, `{ send }` for
 * live) and hand it to the handler. This keeps action code transport-aware
 * only when it explicitly reads `ctx`, and transport-agnostic otherwise.
 */

import { WrapperTransportError } from './types.js';

/** Generic async handler signature used by every transport. */
export type WrapperHandler<TParams = unknown, TResult = unknown, TCtx = unknown> = (
  params: TParams | undefined,
  ctx: TCtx
) => TResult | Promise<TResult>;

/**
 * Map of `actionId` -> handler. Consumers register handlers during wrapper
 * setup, before the transport starts accepting dispatches.
 */
export class HandlerRegistry {
  private readonly handlers = new Map<string, WrapperHandler>();

  /**
   * Register (or replace) a handler for `actionId`. Replacement is explicit
   * rather than throwing because live reloading / hot module scenarios need
   * to update handlers without tearing the whole transport down.
   */
  register<TParams = unknown, TResult = unknown, TCtx = unknown>(
    actionId: string,
    fn: WrapperHandler<TParams, TResult, TCtx>
  ): void {
    this.handlers.set(actionId, fn as WrapperHandler);
  }

  /** Remove a handler. Returns `true` if a handler was removed. */
  unregister(actionId: string): boolean {
    return this.handlers.delete(actionId);
  }

  /** All registered action ids. Stable iteration order (insertion order). */
  list(): string[] {
    return Array.from(this.handlers.keys());
  }

  /** Check whether a handler is registered for `actionId`. */
  has(actionId: string): boolean {
    return this.handlers.has(actionId);
  }

  /**
   * Invoke the handler registered under `actionId`.
   *
   * Throws `WrapperTransportError("NO_HANDLER")` if no handler is registered.
   * Propagates handler errors wrapped as `WrapperTransportError("HANDLER_ERROR")`
   * so callers can uniformly check `err.code`.
   */
  async dispatch<TResult = unknown>(
    actionId: string,
    params?: unknown,
    ctx?: unknown
  ): Promise<TResult> {
    const handler = this.handlers.get(actionId);
    if (!handler) {
      throw new WrapperTransportError(
        'NO_HANDLER',
        `No handler registered for action '${actionId}'`
      );
    }
    try {
      const result = await handler(params, ctx);
      return result as TResult;
    } catch (err) {
      if (err instanceof WrapperTransportError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new WrapperTransportError('HANDLER_ERROR', message, { cause: err });
    }
  }
}
