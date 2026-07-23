/**
 * Public type surface for `@qontinui/ui-bridge-wrapper`.
 *
 * Wrapper apps pick a single transport (api / headless / headed / live) at
 * runtime but ship the same action code against every one of them. Every
 * concrete transport implements `WrapperTransport` and dispatches action
 * ids to handlers registered on a shared `HandlerRegistry`.
 */

import type { HandlerRegistry, WrapperHandler } from './handler-registry.js';

/** Supported transport kinds for a wrapper runtime. */
export type WrapperTransportKind = 'api' | 'headless' | 'headed' | 'live' | 'injected';

/** Transport lifecycle states surfaced to callers (and React via `useWrapperStatus`). */
export type WrapperTransportStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'closed';

/** Configuration accepted by `createTransport`. */
export interface TransportConfig {
  /** Which transport to spin up. */
  kind: WrapperTransportKind;
  /**
   * Runner WebSocket URL. Required for the `live` transport. Ignored by
   * `api`, `headless`, and `headed` — they run locally.
   */
  runnerUrl?: string;
  /** Stable app id used on the runner registry (live transport). */
  appId?: string;
  /** Friendly display name used on the runner registry (live transport). */
  appName?: string;
  /**
   * Per-transport options. Shape depends on `kind`:
   *   - `api`:       `{ handler?: (actionId, params) => unknown }` — convenience only;
   *                   prefer registering handlers via the returned transport's
   *                   `handlerRegistry.register(...)`.
   *   - `headless` / `headed`:
   *                  `{ targetUrl: string; viewportWidth?: number; viewportHeight?: number;
   *                     uiBridgeBase?: string; forwardConsole?: boolean }`
   *   - `live`:      `{ handshakeTimeoutMs?: number; authToken?: string }`
   */
  options?: Record<string, unknown>;
}

/**
 * Normalized response envelope. Transports may choose to use this as their
 * dispatch return type for wrappers that prefer to branch on `success`
 * rather than catch thrown errors. Our transports throw on error by default
 * (closer to idiomatic JS); wrappers can wrap calls in `tryCommand` below
 * if they want an envelope instead.
 */
export interface CommandResponse<T = unknown> {
  success: boolean;
  result?: T;
  error?: { code: string; message: string; retryable?: boolean };
}

/**
 * Contract every transport implements.
 *
 * `dispatch` resolves with the handler's return value on success, or throws
 * a `WrapperTransportError` on failure. Status transitions are observable
 * via `onStatusChange`.
 */
export interface WrapperTransport {
  readonly kind: WrapperTransportKind;
  readonly status: WrapperTransportStatus;

  /**
   * The handler registry the transport dispatches through. Wrapper code
   * registers action handlers here during setup:
   *
   *     transport.handlerRegistry.register("list-unread", async (params, ctx) => {...});
   *
   * Equivalent to calling `transport.register(actionId, fn)` directly.
   */
  readonly handlerRegistry: HandlerRegistry;

  /** Convenience — delegates to `handlerRegistry.register`. */
  register<TParams = unknown, TResult = unknown, TCtx = unknown>(
    actionId: string,
    fn: WrapperHandler<TParams, TResult, TCtx>
  ): void;

  /** Complete any async setup (browser launch, websocket handshake). */
  ready(): Promise<void>;

  /** Invoke a registered action by id. */
  dispatch<TResult = unknown>(actionId: string, params?: unknown): Promise<TResult>;

  /** Tear everything down. Safe to call multiple times. */
  close(): Promise<void>;

  /**
   * Subscribe to status transitions. Returns an unsubscribe function that
   * consumers must call on unmount / shutdown.
   */
  onStatusChange(listener: (s: WrapperTransportStatus) => void): () => void;
}

/**
 * Structured error emitted by transport dispatch. Concrete transports
 * throw these so callers can introspect `code` / `retryable` without
 * string-matching error messages.
 */
export class WrapperTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
  /**
   * Optional structured diagnostic payload (error-code-specific shape) so
   * programmatic callers can branch on data instead of parsing the message —
   * e.g. `INJECTED_EXPECT_SELECTOR_UNMET` attaches
   * `{ registeredElements, elementCount }`.
   */
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; cause?: unknown; details?: unknown } = {}
  ) {
    super(message);
    this.name = 'WrapperTransportError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}
