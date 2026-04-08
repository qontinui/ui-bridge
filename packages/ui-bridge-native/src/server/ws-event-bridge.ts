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

// ── Glob pattern matching ───────────────────────────────────────────────────

/** Cache of compiled glob→RegExp to avoid recompiling hot patterns. */
const GLOB_CACHE = new Map<string, RegExp>();

/**
 * Convert a glob-style pattern (supports `*` / `**` wildcards) to a RegExp.
 * All other regex metacharacters are escaped, so colons and other
 * event-name characters pass through literally.
 *
 *   globToRegex("*")                 → /^.*$/
 *   globToRegex("element:*")         → /^element:.*$/
 *   globToRegex("*:stateChanged")    → /^.*:stateChanged$/
 */
export function globToRegex(pattern: string): RegExp {
  const cached = GLOB_CACHE.get(pattern);
  if (cached) return cached;

  // Normalize ** → * (same semantics for flat event names)
  const normalized = pattern.replace(/\*\*/g, '*');
  // Escape regex metacharacters except '*'
  const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // Replace '*' with '.*'
  const body = escaped.replace(/\*/g, '.*');
  const regex = new RegExp(`^${body}$`);
  GLOB_CACHE.set(pattern, regex);
  return regex;
}

/** Options for the WebSocketEventBridge constructor. */
export interface WebSocketEventBridgeOptions {
  /** Heartbeat ping interval in ms (default 30000) */
  heartbeatIntervalMs?: number;
  /** Max number of events to retain in the replay history buffer (default 100, 0 disables) */
  maxHistory?: number;
}

export class WebSocketEventBridge {
  private connections = new Map<string, WebSocketConnection>();
  private throttles = new Map<string, ThrottleState>();
  private unsubscribers: Array<() => void> = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private registry: NativeUIBridgeRegistry;
  private heartbeatIntervalMs: number;
  /**
   * True ring buffer for event replay history.
   *
   * `historyBuf` is a fixed-capacity slot array; `historyHead` points at the
   * NEXT write position; `historyCount` is the number of valid slots
   * (clamped to capacity). Append is O(1) — no array shifting.
   */
  private historyBuf: (JsonRpcEvent | undefined)[] = [];
  private historyHead = 0;
  private historyCount = 0;

  constructor(
    registry: NativeUIBridgeRegistry,
    optionsOrHeartbeatMs: WebSocketEventBridgeOptions | number = {}
  ) {
    this.registry = registry;
    // Accept legacy positional number form
    const opts: WebSocketEventBridgeOptions =
      typeof optionsOrHeartbeatMs === 'number'
        ? { heartbeatIntervalMs: optionsOrHeartbeatMs }
        : optionsOrHeartbeatMs;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 30000;
    const cap = Math.max(0, (opts.maxHistory ?? 100) | 0);
    this.historyBuf = cap > 0 ? new Array(cap) : [];
  }

  /** Effective ring buffer capacity. 0 means history is disabled. */
  private get historyCapacity(): number {
    return this.historyBuf.length;
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
    this.historyBuf.fill(undefined);
    this.historyHead = 0;
    this.historyCount = 0;
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
   *
   * Event names are stored as glob patterns. Supported forms:
   *   - Exact:  "element:registered"
   *   - Prefix: "element:*"
   *   - Suffix: "*:stateChanged"
   *   - All:    "*"
   *
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

  /**
   * Remove event subscriptions for a connection.
   * If all subscriptions are cleared, also drops the throttle entry
   * (and any pending flush timer) so a subsequent resubscribe starts clean.
   */
  handleUnsubscribe(connId: string, events: string[]): boolean {
    const conn = this.connections.get(connId);
    if (!conn) return false;
    for (const event of events) {
      conn.subscriptions.delete(event);
    }
    if (conn.subscriptions.size === 0) {
      const throttle = this.throttles.get(connId);
      if (throttle?.timer) clearTimeout(throttle.timer);
      this.throttles.delete(connId);
    }
    return true;
  }

  /**
   * Get the subscription set for a connection.
   * Returns the original pattern strings (not compiled regexes).
   */
  getSubscriptions(connId: string): string[] {
    const conn = this.connections.get(connId);
    return conn ? Array.from(conn.subscriptions) : [];
  }

  /**
   * Check if a connection is subscribed to a specific event.
   * Matches exact names first (fast path), then tests each stored
   * pattern as a glob against the event type.
   */
  isSubscribed(connId: string, eventType: string): boolean {
    const conn = this.connections.get(connId);
    if (!conn) return false;
    // Fast path: exact match
    if (conn.subscriptions.has(eventType)) return true;
    // Glob path: test each pattern
    for (const pattern of conn.subscriptions) {
      // Skip exact names with no wildcard — already tested above
      if (!pattern.includes('*')) continue;
      if (globToRegex(pattern).test(eventType)) return true;
    }
    return false;
  }

  /** Get the throttle window (in ms) configured for a connection, or undefined if none. */
  getThrottleMs(connId: string): number | undefined {
    return this.throttles.get(connId)?.ms;
  }

  /**
   * Get recent events from the replay history buffer.
   *
   * @param filter.events — optional list of glob patterns to match event types against
   * @param filter.since — optional timestamp (ms); only events at or after this time
   */
  getHistory(filter?: { events?: string[]; since?: number }): JsonRpcEvent[] {
    const cap = this.historyCapacity;
    if (cap === 0 || this.historyCount === 0) return [];

    const since = filter?.since;
    const regexes = filter?.events?.map((p) => globToRegex(p));

    // Walk the ring buffer in chronological (oldest → newest) order.
    const start = (this.historyHead - this.historyCount + cap) % cap;
    const out: JsonRpcEvent[] = [];
    for (let i = 0; i < this.historyCount; i++) {
      const e = this.historyBuf[(start + i) % cap];
      if (!e) continue;
      if (since !== undefined && e.timestamp < since) continue;
      if (regexes && regexes.length > 0 && !regexes.some((r) => r.test(e.event))) continue;
      out.push(e);
    }
    return out;
  }

  /**
   * Configure the max history buffer size at runtime. 0 disables history.
   * Reallocates the ring buffer, preserving the most recent
   * min(historyCount, newCapacity) events in chronological order.
   */
  setMaxHistory(maxHistory: number): void {
    const newCap = Math.max(0, maxHistory | 0);
    if (newCap === this.historyCapacity) return;

    if (newCap === 0) {
      this.historyBuf = [];
      this.historyHead = 0;
      this.historyCount = 0;
      return;
    }

    // Preserve the latest min(count, newCap) events.
    const oldCap = this.historyCapacity;
    const keep = Math.min(this.historyCount, newCap);
    const newBuf: (JsonRpcEvent | undefined)[] = new Array(newCap);
    if (keep > 0 && oldCap > 0) {
      // Source range: the last `keep` events ending just before historyHead.
      const start = (this.historyHead - keep + oldCap) % oldCap;
      for (let i = 0; i < keep; i++) {
        newBuf[i] = this.historyBuf[(start + i) % oldCap];
      }
    }
    this.historyBuf = newBuf;
    this.historyCount = keep;
    this.historyHead = keep % newCap;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private broadcastEvent(eventType: string, data: unknown): void {
    const event: JsonRpcEvent = {
      event: eventType,
      data,
      timestamp: Date.now(),
    };

    // Append to ring buffer — O(1), no shifting.
    const cap = this.historyCapacity;
    if (cap > 0) {
      this.historyBuf[this.historyHead] = event;
      this.historyHead = (this.historyHead + 1) % cap;
      if (this.historyCount < cap) this.historyCount++;
    }

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
