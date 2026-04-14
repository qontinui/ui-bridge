/**
 * Tests for WebSocketEventBridge — focused on the event history ring buffer.
 *
 * Strategy: drive the bridge through a real NativeUIBridgeRegistry by
 * calling `registry.emit(type, data)` after `bridge.start()`. The bridge
 * subscribes to every entry in BRIDGE_EVENT_TYPES, so emitting any of
 * those types flows through the private `broadcastEvent` and into the
 * ring buffer.
 *
 * Timestamps are controlled by stubbing `Date.now`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NativeUIBridgeRegistry } from '../core/registry';
import { WebSocketEventBridge } from './ws-event-bridge';

// Helper: cast bridge to access private fields for white-box assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (b: WebSocketEventBridge) => b as unknown as any;

describe('WebSocketEventBridge — event history ring buffer', () => {
  let registry: NativeUIBridgeRegistry;
  let nowSpy: ReturnType<typeof vi.spyOn> | null;

  beforeEach(() => {
    registry = new NativeUIBridgeRegistry();
    nowSpy = null;
  });

  afterEach(() => {
    if (nowSpy) nowSpy.mockRestore();
  });

  /** Force Date.now() to return the next value from the supplied sequence. */
  const mockTimes = (times: number[]): void => {
    let i = 0;
    nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      const v = times[Math.min(i, times.length - 1)];
      i++;
      return v;
    });
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Append & basic retrieval
  // ──────────────────────────────────────────────────────────────────────────
  describe('append & basic retrieval', () => {
    it('returns [] for empty history', () => {
      const bridge = new WebSocketEventBridge(registry, { maxHistory: 10 });
      bridge.start();
      expect(bridge.getHistory()).toEqual([]);
    });

    it('returns events in emission order after 3 emits', () => {
      const bridge = new WebSocketEventBridge(registry, { maxHistory: 10 });
      bridge.start();
      registry.emit('element:registered', { id: 'a' });
      registry.emit('element:registered', { id: 'b' });
      registry.emit('element:registered', { id: 'c' });

      const history = bridge.getHistory();
      expect(history).toHaveLength(3);
      expect(history.map((e) => (e.data as { id: string }).id)).toEqual(['a', 'b', 'c']);
      expect(history.every((e) => e.event === 'element:registered')).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Capacity wrap
  // ──────────────────────────────────────────────────────────────────────────
  it('capacity wrap: keeps only the latest N events in chronological order', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 3 });
    bridge.start();
    for (let n = 1; n <= 5; n++) {
      registry.emit('element:registered', { id: `e${n}` });
    }

    const history = bridge.getHistory();
    expect(history.map((e) => (e.data as { id: string }).id)).toEqual(['e3', 'e4', 'e5']);
    expect(internals(bridge).historyCount).toBe(3);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Exact capacity boundary
  // ──────────────────────────────────────────────────────────────────────────
  it('exact capacity then one more: evicts the oldest', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 3 });
    bridge.start();
    registry.emit('element:registered', { id: 'e1' });
    registry.emit('element:registered', { id: 'e2' });
    registry.emit('element:registered', { id: 'e3' });

    let ids = bridge.getHistory().map((e) => (e.data as { id: string }).id);
    expect(ids).toEqual(['e1', 'e2', 'e3']);

    registry.emit('element:registered', { id: 'e4' });
    ids = bridge.getHistory().map((e) => (e.data as { id: string }).id);
    expect(ids).toEqual(['e2', 'e3', 'e4']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. History disabled
  // ──────────────────────────────────────────────────────────────────────────
  it('maxHistory: 0 disables history and allocates no buffer', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 0 });
    bridge.start();
    for (let n = 0; n < 20; n++) {
      registry.emit('element:registered', { id: `e${n}` });
    }
    expect(bridge.getHistory()).toEqual([]);
    expect(internals(bridge).historyBuf.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. since filter
  // ──────────────────────────────────────────────────────────────────────────
  it('since filter: returns only events at or after the cutoff', () => {
    // Each registry.emit consumes two Date.now() ticks: one for the
    // registry's own BridgeEvent.timestamp, then one for the bridge's
    // JsonRpcEvent.timestamp. Provide pairs so the bridge sees 100..500.
    mockTimes([0, 100, 0, 200, 0, 300, 0, 400, 0, 500]);
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 10 });
    bridge.start();
    for (let n = 1; n <= 5; n++) {
      registry.emit('element:registered', { id: `e${n}` });
    }

    const all = bridge.getHistory();
    expect(all.map((e) => e.timestamp)).toEqual([100, 200, 300, 400, 500]);

    const filtered = bridge.getHistory({ since: 300 });
    expect(filtered.map((e) => e.timestamp)).toEqual([300, 400, 500]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. events glob filter
  // ──────────────────────────────────────────────────────────────────────────
  describe('events glob filter', () => {
    let bridge: WebSocketEventBridge;
    beforeEach(() => {
      bridge = new WebSocketEventBridge(registry, { maxHistory: 20 });
      bridge.start();
      registry.emit('element:registered', { id: 'el-1' });
      registry.emit('element:stateChanged', { id: 'el-1' });
      registry.emit('element:registered', { id: 'el-2' });
      registry.emit('component:registered', { id: 'comp-1' });
      registry.emit('component:unregistered', { id: 'comp-1' });
    });

    it("'element:*' returns only element events", () => {
      const types = bridge.getHistory({ events: ['element:*'] }).map((e) => e.event);
      expect(types).toEqual(['element:registered', 'element:stateChanged', 'element:registered']);
    });

    it("'*:registered' returns both element:registered and component:registered", () => {
      const types = bridge.getHistory({ events: ['*:registered'] }).map((e) => e.event);
      expect(types).toEqual(['element:registered', 'element:registered', 'component:registered']);
    });

    it('explicit list works', () => {
      const types = bridge
        .getHistory({ events: ['element:registered', 'component:registered'] })
        .map((e) => e.event);
      expect(types).toEqual(['element:registered', 'element:registered', 'component:registered']);
    });

    it("'*' matches everything", () => {
      const all = bridge.getHistory({ events: ['*'] });
      expect(all).toHaveLength(5);
    });

    it("'nonexistent' returns []", () => {
      expect(bridge.getHistory({ events: ['nonexistent'] })).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Combined since + events filters (AND semantics)
  // ──────────────────────────────────────────────────────────────────────────
  it('combined since + events filters apply with AND semantics', () => {
    // Pairs: registry consumes one tick, bridge consumes the next.
    mockTimes([0, 100, 0, 200, 0, 300, 0, 400, 0, 500]);
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 10 });
    bridge.start();
    registry.emit('element:registered', { id: 'el-1' }); // t=100
    registry.emit('component:registered', { id: 'c-1' }); // t=200
    registry.emit('element:stateChanged', { id: 'el-1' }); // t=300
    registry.emit('element:registered', { id: 'el-2' }); // t=400
    registry.emit('component:unregistered', { id: 'c-1' }); // t=500

    const filtered = bridge.getHistory({ events: ['element:*'], since: 300 });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((e) => e.event)).toEqual(['element:stateChanged', 'element:registered']);
    expect(filtered.every((e) => e.timestamp >= 300)).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. setMaxHistory shrink
  // ──────────────────────────────────────────────────────────────────────────
  it('setMaxHistory shrink: keeps the LATEST N, not the first N', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 5 });
    bridge.start();
    for (let n = 1; n <= 5; n++) {
      registry.emit('element:registered', { id: `e${n}` });
    }
    bridge.setMaxHistory(3);
    const ids = bridge.getHistory().map((e) => (e.data as { id: string }).id);
    expect(ids).toEqual(['e3', 'e4', 'e5']);
    expect(internals(bridge).historyCount).toBe(3);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. setMaxHistory grow with partial fill
  // ──────────────────────────────────────────────────────────────────────────
  it('setMaxHistory grow with partial fill: preserves order and accepts new events', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 3 });
    bridge.start();
    registry.emit('element:registered', { id: 'e1' });
    registry.emit('element:registered', { id: 'e2' });
    bridge.setMaxHistory(10);

    let ids = bridge.getHistory().map((e) => (e.data as { id: string }).id);
    expect(ids).toEqual(['e1', 'e2']);

    registry.emit('element:registered', { id: 'e3' });
    registry.emit('element:registered', { id: 'e4' });
    registry.emit('element:registered', { id: 'e5' });

    ids = bridge.getHistory().map((e) => (e.data as { id: string }).id);
    expect(ids).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 10. setMaxHistory grow after wrap
  // ──────────────────────────────────────────────────────────────────────────
  it('setMaxHistory grow after wrap: chronological order preserved, accepts new events', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 3 });
    bridge.start();
    for (let n = 1; n <= 5; n++) {
      registry.emit('element:registered', { id: `e${n}` });
    }
    // Buffer wrapped; should hold e3, e4, e5
    bridge.setMaxHistory(10);
    let ids = bridge.getHistory().map((e) => (e.data as { id: string }).id);
    expect(ids).toEqual(['e3', 'e4', 'e5']);

    registry.emit('element:registered', { id: 'e6' });
    ids = bridge.getHistory().map((e) => (e.data as { id: string }).id);
    expect(ids).toEqual(['e3', 'e4', 'e5', 'e6']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 11. setMaxHistory(0) disables and clears
  // ──────────────────────────────────────────────────────────────────────────
  it('setMaxHistory(0) disables history and clears existing entries', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 5 });
    bridge.start();
    registry.emit('element:registered', { id: 'e1' });
    registry.emit('element:registered', { id: 'e2' });

    bridge.setMaxHistory(0);
    expect(bridge.getHistory()).toEqual([]);
    expect(internals(bridge).historyBuf.length).toBe(0);
    expect(internals(bridge).historyCount).toBe(0);

    // Subsequent emits should not be retained
    registry.emit('element:registered', { id: 'e3' });
    expect(bridge.getHistory()).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 12. setMaxHistory(current) is a no-op
  // ──────────────────────────────────────────────────────────────────────────
  it('setMaxHistory(current) is a no-op', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 5 });
    bridge.start();
    registry.emit('element:registered', { id: 'e1' });
    registry.emit('element:registered', { id: 'e2' });
    registry.emit('element:registered', { id: 'e3' });
    const before = bridge.getHistory();

    bridge.setMaxHistory(5);
    const after = bridge.getHistory();

    expect(after).toEqual(before);
    expect(internals(bridge).historyCount).toBe(3);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 13. stop() clears history
  // ──────────────────────────────────────────────────────────────────────────
  it('stop() clears history', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 5 });
    bridge.start();
    registry.emit('element:registered', { id: 'e1' });
    registry.emit('element:registered', { id: 'e2' });
    expect(bridge.getHistory()).toHaveLength(2);

    bridge.stop();
    expect(bridge.getHistory()).toEqual([]);
    expect(internals(bridge).historyCount).toBe(0);
    expect(internals(bridge).historyHead).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 14. Legacy positional constructor
  // ──────────────────────────────────────────────────────────────────────────
  it('legacy positional constructor (heartbeat ms) defaults maxHistory to 100', () => {
    const bridge = new WebSocketEventBridge(registry, 5000);
    bridge.start();
    expect(internals(bridge).heartbeatIntervalMs).toBe(5000);
    expect(internals(bridge).historyBuf.length).toBe(100);

    // Emit 150 events; should keep latest 100
    for (let n = 0; n < 150; n++) {
      registry.emit('element:registered', { id: `e${n}` });
    }
    const history = bridge.getHistory();
    expect(history).toHaveLength(100);
    expect((history[0].data as { id: string }).id).toBe('e50');
    expect((history[99].data as { id: string }).id).toBe('e149');

    bridge.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 15. Chronological order through multiple wraps
  // ──────────────────────────────────────────────────────────────────────────
  it('chronological order preserved across multiple buffer wraps', () => {
    const bridge = new WebSocketEventBridge(registry, { maxHistory: 4 });
    bridge.start();
    for (let n = 1; n <= 10; n++) {
      registry.emit('element:registered', { id: `e${n}` });
    }
    const ids = bridge.getHistory().map((e) => (e.data as { id: string }).id);
    expect(ids).toEqual(['e7', 'e8', 'e9', 'e10']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 16. handleUnsubscribe clears throttle state when all subs are removed
  // ──────────────────────────────────────────────────────────────────────────
  describe('handleUnsubscribe throttle cleanup', () => {
    const makeConn = (id: string) =>
      ({
        id,
        subscriptions: new Set<string>(),
        alive: true,
        isOpen: true,
        send: () => {},
        sendEvent: () => {},
        ping: () => {},
        close: () => {},
        destroy: () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;

    it('drops throttle entry when last subscription is removed', () => {
      const bridge = new WebSocketEventBridge(registry);
      bridge.start();
      const conn = makeConn('c1');
      bridge.addConnection(conn);

      bridge.handleSubscribe('c1', ['element:registered', 'element:stateChanged'], 100);
      expect(bridge.getThrottleMs('c1')).toBe(100);

      // Remove only one subscription — throttle should persist.
      bridge.handleUnsubscribe('c1', ['element:registered']);
      expect(bridge.getThrottleMs('c1')).toBe(100);
      expect(bridge.getSubscriptions('c1')).toEqual(['element:stateChanged']);

      // Remove the last subscription — throttle must be cleared.
      bridge.handleUnsubscribe('c1', ['element:stateChanged']);
      expect(bridge.getThrottleMs('c1')).toBeUndefined();
      expect(bridge.getSubscriptions('c1')).toEqual([]);
    });

    it('clearing all at once also drops throttle and any pending timer', () => {
      vi.useFakeTimers();
      try {
        const bridge = new WebSocketEventBridge(registry);
        bridge.start();
        const conn = makeConn('c2');
        bridge.addConnection(conn);

        bridge.handleSubscribe('c2', ['*'], 200);
        // Emit an event to schedule a flush timer
        registry.emit('element:registered', { id: 'x' });
        expect(internals(bridge).throttles.get('c2').timer).not.toBeNull();

        bridge.handleUnsubscribe('c2', ['*']);
        expect(bridge.getThrottleMs('c2')).toBeUndefined();
        expect(internals(bridge).throttles.has('c2')).toBe(false);

        // Advance time past the throttle window — no crash, no leaked flush.
        vi.advanceTimersByTime(500);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
