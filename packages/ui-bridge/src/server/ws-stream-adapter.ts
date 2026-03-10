/**
 * WebSocket Stream Adapter
 *
 * Thin adapter that connects BrowserEventStream (transport-agnostic event
 * filtering/classification) to UIBridgeWSHandler (WebSocket broadcast).
 *
 * The adapter manages a BrowserEventStream subscription lifecycle that is
 * tied to WebSocket client presence: it subscribes when the first WS client
 * connects and unsubscribes when the last client disconnects.
 *
 * Two usage modes:
 *
 * 1. **Callback mode** (recommended) — returns an `onBrowserEvent` callback
 *    to pass to `createHandlers`. The internal BrowserEventStream inside
 *    handlers.ts must have a default subscription (added when onBrowserEvent
 *    is provided). The adapter forwards classified BridgeEvents to broadcast.
 *
 * 2. **Direct mode** — accepts an external BrowserEventStream and manages
 *    subscriptions directly. Useful for custom server setups.
 */

import type { BridgeEvent } from '../core';
import type {
  BrowserEventStream,
  BrowserEventStreamMessage,
  StreamSubscription,
} from '../debug/ws-streaming';
import type { UIBridgeWSHandler } from './websocket-handler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WSStreamAdapterConfig {
  /** Minimum severity to forward (default: 'warning') */
  minSeverity?: 'crash' | 'error' | 'warning' | 'noise';
  /** Enable fingerprint-based deduplication (default: true) */
  deduplicate?: boolean;
  /** Optional log function for debug output */
  log?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Callback-mode adapter (works with internal BrowserEventStream in handlers)
// ---------------------------------------------------------------------------

/**
 * Create an `onBrowserEvent` callback that forwards BridgeEvents to a
 * UIBridgeWSHandler's broadcastEvent method.
 *
 * Pass the returned callback as `config.onBrowserEvent` when calling
 * `createHandlers()`. The internal BrowserEventStream in handlers.ts will
 * auto-create a default subscription when `onBrowserEvent` is provided,
 * so classified events flow through to this callback automatically.
 *
 * @example
 * ```ts
 * const server = new StandaloneServer(handlers, { websocket: true });
 * // After server is created, wire the adapter:
 * const broadcast = createWSStreamBroadcast(server.getWSHandler()!);
 *
 * // Or pass during handler creation:
 * const handlers = createHandlers(registry, executor, {
 *   onBrowserEvent: createWSStreamBroadcast(wsHandler),
 * });
 * ```
 */
export function createWSStreamBroadcast(
  wsHandler: UIBridgeWSHandler,
  config?: Pick<WSStreamAdapterConfig, 'log'>
): (event: BridgeEvent) => void {
  const log = config?.log;

  return (event: BridgeEvent) => {
    if (wsHandler.clientCount === 0) {
      return; // No clients connected — skip serialization overhead
    }

    if (log) {
      log(`[ws-stream] Broadcasting ${event.type} to ${wsHandler.clientCount} client(s)`);
    }

    wsHandler.broadcastEvent(event);
  };
}

// ---------------------------------------------------------------------------
// Direct-mode adapter (manages subscriptions on an external stream)
// ---------------------------------------------------------------------------

/**
 * Full adapter that owns a subscription on an external BrowserEventStream
 * and forwards matching events to a broadcast function.
 *
 * Manages subscription lifecycle: subscribes on `attach()`, unsubscribes
 * on `detach()`. Use `notifyClientChange()` to auto-manage based on
 * connected WS client count.
 *
 * @example
 * ```ts
 * const stream = new BrowserEventStream();
 * const adapter = new WSStreamAdapter(stream, {
 *   broadcast: (event) => wsHandler.broadcastEvent(event),
 *   minSeverity: 'warning',
 * });
 * adapter.attach();
 *
 * // When a WS client connects/disconnects:
 * adapter.notifyClientChange(wsHandler.clientCount);
 * ```
 */
export class WSStreamAdapter {
  private stream: BrowserEventStream;
  private broadcast: (event: BridgeEvent) => void;
  private subscription: StreamSubscription | null = null;
  private config: Required<Pick<WSStreamAdapterConfig, 'minSeverity' | 'deduplicate'>>;
  private log?: (message: string) => void;

  constructor(
    stream: BrowserEventStream,
    options: {
      broadcast: (event: BridgeEvent) => void;
    } & WSStreamAdapterConfig
  ) {
    this.stream = stream;
    this.broadcast = options.broadcast;
    this.config = {
      minSeverity: options.minSeverity ?? 'warning',
      deduplicate: options.deduplicate ?? true,
    };
    this.log = options.log;
  }

  /**
   * Create a subscription on the stream. Safe to call multiple times
   * (no-op if already subscribed).
   */
  attach(): StreamSubscription {
    if (this.subscription) {
      return this.subscription;
    }

    this.subscription = this.stream.subscribe({
      minSeverity: this.config.minSeverity,
      deduplicate: this.config.deduplicate,
    });

    if (this.log) {
      this.log(
        `[ws-stream] Attached subscription ${this.subscription.id} ` +
          `(minSeverity=${this.config.minSeverity}, deduplicate=${this.config.deduplicate})`
      );
    }

    return this.subscription;
  }

  /**
   * Remove the subscription from the stream. Safe to call multiple times
   * (no-op if not subscribed).
   */
  detach(): void {
    if (!this.subscription) {
      return;
    }

    const id = this.subscription.id;
    this.stream.unsubscribe(id);
    this.subscription = null;

    if (this.log) {
      this.log(`[ws-stream] Detached subscription ${id}`);
    }
  }

  /**
   * Update subscription based on WS client count.
   * Subscribes when the first client connects, unsubscribes when the last
   * client disconnects.
   */
  notifyClientChange(clientCount: number): void {
    if (clientCount > 0 && !this.subscription) {
      this.attach();
    } else if (clientCount === 0 && this.subscription) {
      this.detach();
    }
  }

  /**
   * Process a raw browser event through the stream and broadcast any
   * messages that pass subscription filters.
   *
   * Call this from the capture's onEvent callback when using direct mode.
   */
  processAndBroadcast(event: import('../debug/browser-capture-types').AnyCapturedEvent): void {
    if (!this.subscription) {
      return; // Not subscribed — nothing to do
    }

    const messages = this.stream.processEvent(event);
    if (messages.size === 0) {
      return;
    }

    // Forward each matching message as a BridgeEvent
    for (const [_subId, message] of messages) {
      this.broadcast(toBridgeEvent(message));
    }
  }

  /** Whether the adapter currently has an active subscription */
  get isAttached(): boolean {
    return this.subscription !== null;
  }

  /** The current subscription ID, or null */
  get subscriptionId(): string | null {
    return this.subscription?.id ?? null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a BrowserEventStreamMessage to a BridgeEvent for WS broadcast.
 */
function toBridgeEvent(message: BrowserEventStreamMessage): BridgeEvent {
  const eventType =
    message.severity === 'crash'
      ? 'browser:crash'
      : message.severity === 'error'
        ? 'browser:error'
        : 'browser:warning';

  return {
    type: eventType,
    timestamp: Date.now(),
    data: {
      event: message.event,
      severity: message.severity,
      reason: message.reason,
      fingerprint: message.fingerprint,
      ...(message.sourceLocation !== undefined ? { sourceLocation: message.sourceLocation } : {}),
    },
  };
}
