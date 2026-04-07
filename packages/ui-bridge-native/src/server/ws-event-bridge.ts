/**
 * Bridges NativeUIBridgeRegistry events to WebSocket clients.
 *
 * Subscribes to all registry event types and broadcasts them as
 * JsonRpcEvent messages to connected WebSocket clients based on
 * their per-connection subscription sets.
 */

import type { NativeUIBridgeRegistry } from '../core/registry';
import type { BridgeEventType, BridgeEvent } from '../core/types';
import type { WebSocketConnection } from './ws-connection';
import type { JsonRpcEvent } from './ws-types';

/** All event types the bridge can subscribe to */
const BRIDGE_EVENT_TYPES: BridgeEventType[] = [
  'element:registered',
  'element:unregistered',
  'element:stateChanged',
  'component:registered',
  'component:unregistered',
  'action:started',
  'action:completed',
  'action:failed',
  'workflow:started',
  'workflow:stepCompleted',
  'workflow:completed',
  'workflow:failed',
  'render:snapshot',
  'error',
];

/** Per-connection throttle state for batching rapid events */
interface ThrottleState {
  ms: number;
  pending: JsonRpcEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

export class WebSocketEventBridge {
  private connections = new Map<string, WebSocketConnection>();
  private throttles = new Map<string, ThrottleState>();
  private unsubscribers: Array<() => void> = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private registry: NativeUIBridgeRegistry;
  private heartbeatIntervalMs: number;

  constructor(registry: NativeUIBridgeRegistry, heartbeatIntervalMs = 30000) {
    this.registry = registry;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  /**
   * Start listening to registry events and broadcasting to WS clients.
   * Also starts the heartbeat timer.
   */
  start(): void {
    for (const eventType of BRIDGE_EVENT_TYPES) {
      const unsub = this.registry.on(eventType, (event: BridgeEvent) => {
        this.broadcastEvent(eventType, event.data);
      });
      this.unsubscribers.push(unsub);
    }

    this.startHeartbeat();
  }

  /** Stop listening to registry events and clear connections. */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Clean up throttle timers
    for (const throttle of this.throttles.values()) {
      if (throttle.timer) clearTimeout(throttle.timer);
    }
    this.throttles.clear();

    // Close all connections
    for (const conn of this.connections.values()) {
      conn.close(1001, 'Server shutting down');
    }
    this.connections.clear();
  }

  /** Register a new WebSocket connection. */
  addConnection(conn: WebSocketConnection): void {
    this.connections.set(conn.id, conn);
  }

  /** Remove a WebSocket connection (called on disconnect). */
  removeConnection(connId: string): void {
    this.connections.delete(connId);
    const throttle = this.throttles.get(connId);
    if (throttle?.timer) clearTimeout(throttle.timer);
    this.throttles.delete(connId);
  }

  /** Get the number of active connections. */
  get connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Add event subscriptions for a connection.
   * Use '*' to subscribe to all events.
   * @param throttleMs — if >0, batch rapid events within this window before sending
   */
  handleSubscribe(connId: string, events: string[], throttleMs?: number): boolean {
    const conn = this.connections.get(connId);
    if (!conn) return false;
    for (const event of events) {
      conn.subscriptions.add(event);
    }
    if (throttleMs && throttleMs > 0) {
      this.throttles.set(connId, { ms: throttleMs, pending: [], timer: null });
    }
    return true;
  }

  /** Remove event subscriptions for a connection. */
  handleUnsubscribe(connId: string, events: string[]): boolean {
    const conn = this.connections.get(connId);
    if (!conn) return false;
    for (const event of events) {
      conn.subscriptions.delete(event);
    }
    return true;
  }

  /** Get the subscription set for a connection. */
  getSubscriptions(connId: string): string[] {
    const conn = this.connections.get(connId);
    return conn ? Array.from(conn.subscriptions) : [];
  }

  /** Check if a connection is subscribed to a specific event (or '*'). */
  isSubscribed(connId: string, eventType: string): boolean {
    const conn = this.connections.get(connId);
    if (!conn) return false;
    return conn.subscriptions.has(eventType) || conn.subscriptions.has('*');
  }

  /** Get the throttle window (in ms) configured for a connection, or undefined if none. */
  getThrottleMs(connId: string): number | undefined {
    return this.throttles.get(connId)?.ms;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private broadcastEvent(eventType: string, data: unknown): void {
    const event: JsonRpcEvent = {
      event: eventType,
      data,
      timestamp: Date.now(),
    };

    for (const [connId, conn] of this.connections) {
      const throttle = this.throttles.get(connId);
      if (throttle) {
        this.enqueueThrottled(connId, conn, throttle, event);
      } else {
        conn.sendEvent(event);
      }
    }
  }

  /** Queue an event for throttled delivery, flushing after the throttle window. */
  private enqueueThrottled(
    connId: string,
    conn: WebSocketConnection,
    throttle: ThrottleState,
    event: JsonRpcEvent
  ): void {
    throttle.pending.push(event);
    if (throttle.timer) return; // Flush already scheduled

    throttle.timer = setTimeout(() => {
      const events = throttle.pending.splice(0);
      throttle.timer = null;
      // Verify connection still exists
      if (!this.connections.has(connId)) return;
      for (const e of events) {
        conn.sendEvent(e);
      }
    }, throttle.ms);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [id, conn] of this.connections) {
        if (!conn.isOpen) {
          this.connections.delete(id);
          continue;
        }

        if (!conn.alive) {
          // Missed previous ping — connection is dead
          console.warn(`[ws-event-bridge] Connection ${id} missed heartbeat, closing`);
          conn.close(1001, 'Heartbeat timeout');
          this.connections.delete(id);
          continue;
        }

        // Mark as not-alive, send ping. If pong arrives, alive is set back to true.
        conn.alive = false;
        conn.ping();
      }
    }, this.heartbeatIntervalMs);
  }
}
