/**
 * ApiTransport
 *
 * The thinnest of the four transports. It carries no I/O of its own — all
 * it does is hold a `HandlerRegistry`, go `ready` immediately, and route
 * dispatches through the registry. Wrappers that target a remote API
 * (REST, GraphQL, gRPC, SDK…) put their `fetch` / SDK calls inside the
 * registered handlers.
 *
 * For compatibility with the spec, `TransportConfig.options.handler` is
 * honored as a fallback for unregistered action ids.
 */

import { BaseTransport } from '../base-transport.js';
import { HandlerRegistry } from '../handler-registry.js';
import type { TransportConfig, WrapperTransportKind } from '../types.js';
import { WrapperTransportError } from '../types.js';

/**
 * Context shape passed to api-transport handlers. Empty by default; wrappers
 * can cast `ctx as ApiContext & { mySdk }` if they stash shared state on the
 * transport instance.
 */
export interface ApiContext {
  readonly kind: 'api';
}

/** Catch-all fallback handler signature, used for `options.handler` support. */
export type ApiFallbackHandler = (actionId: string, params?: unknown) => unknown | Promise<unknown>;

export class ApiTransport extends BaseTransport {
  readonly kind: WrapperTransportKind = 'api';
  private readonly fallback?: ApiFallbackHandler;

  constructor(config: TransportConfig = { kind: 'api' }, registry?: HandlerRegistry) {
    super(registry);
    const handler = (config.options as { handler?: unknown } | undefined)?.handler;
    if (typeof handler === 'function') {
      this.fallback = handler as ApiFallbackHandler;
    }
  }

  protected async onReady(): Promise<void> {
    // Nothing to warm up.
  }

  protected async onClose(): Promise<void> {
    // Nothing to tear down.
  }

  protected async buildContext(): Promise<ApiContext> {
    return { kind: 'api' };
  }

  /**
   * Override dispatch to fall back to `options.handler` when no explicit
   * registration exists for `actionId`.
   */
  async dispatch<TResult = unknown>(actionId: string, params?: unknown): Promise<TResult> {
    await this.ready();
    if (this.registry.has(actionId)) {
      const ctx = await this.buildContext();
      return this.registry.dispatch<TResult>(actionId, params, ctx);
    }
    if (this.fallback) {
      try {
        return (await this.fallback(actionId, params)) as TResult;
      } catch (err) {
        if (err instanceof WrapperTransportError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new WrapperTransportError('HANDLER_ERROR', message, { cause: err });
      }
    }
    throw new WrapperTransportError('NO_HANDLER', `No handler registered for action '${actionId}'`);
  }
}
