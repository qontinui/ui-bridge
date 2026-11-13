/**
 * `destroy()` is a full teardown: once it returns, no timer the relay armed
 * can send a command or log, every pending command settles with a
 * `RelayDestroyedError`, and the open-subscription guard in `test-setup.ts`
 * counts the relay's transports as closed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay, RelayDestroyedError, type WebSocketClient } from './command-relay';
import type { RelayBus } from './relay-bus';
import { openRelaySubscriptions } from '../test-setup';

function uniquePrefix(): string {
  return `__uiBridgeDestroy_${Math.random().toString(36).slice(2, 10)}`;
}

function wsClient(clientId: string): WebSocketClient & { send: ReturnType<typeof vi.fn> } {
  return { clientId, send: vi.fn(), isConnected: () => true, close: vi.fn() };
}

/** A bus whose every method is a spy; `isTabKnown` answers `false` unless overridden. */
function busStub(overrides: Partial<RelayBus> = {}) {
  return {
    publishCommand: vi.fn(),
    subscribeCommands: vi.fn(() => vi.fn()),
    publishResponse: vi.fn(),
    subscribeResponse: vi.fn(() => vi.fn()),
    registerTab: vi.fn(),
    unregisterTab: vi.fn(),
    isTabKnown: vi.fn(async () => false),
    close: vi.fn(async () => {}),
    ...overrides,
  } satisfies RelayBus;
}

/** A promise's outcome, readable synchronously once it has settled. */
function track<T>(promise: Promise<T>): { settled: boolean; value?: T; error?: unknown } {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error })
  );
  return state;
}

/** Let the relay's async dispatch run up to the point a command is pending. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('CommandRelay.destroy()', () => {
  let relays: CommandRelay[] = [];

  function relay(
    options: { proactiveSnapshot?: boolean; globalPrefix?: string; bus?: RelayBus } = {}
  ) {
    const r = new CommandRelay({ globalPrefix: uniquePrefix(), ...options });
    relays.push(r);
    return r;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const r of relays) r.destroy();
    relays = [];
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('leaves no timer armed after a WebSocket client registered with the warm-up snapshot on', async () => {
    const r = relay({ proactiveSnapshot: true });
    const client = wsClient('ws-1');
    r.registerWebSocketClient(client);
    // The cleanup sweep and the client's 500 ms warm-up snapshot.
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);

    r.destroy();

    expect(vi.getTimerCount()).toBe(0);
    expect(r.getTransportDiagnostics().wsClientCount).toBe(0);
    const log = vi.spyOn(console, 'log');
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.send).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    // The relay does not own the socket, so it does not close it.
    expect(client.close).not.toHaveBeenCalled();
  });

  it('leaves no SSE warm-up timer armed, and sends nothing down the stream afterwards', async () => {
    const r = relay({ proactiveSnapshot: true });
    const listener = vi.fn();
    r.subscribeToCommands(listener, 'tab-1');
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);

    r.destroy();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not let a warm-up settled by destroy() arm a retry down a newer stream for the same tab', async () => {
    const r = relay({ proactiveSnapshot: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const snapshots = (listener: ReturnType<typeof vi.fn>) =>
      listener.mock.calls.filter(
        ([command]) => (command as { action?: string }).action === 'getControlSnapshot'
      ).length;
    const first = vi.fn();
    r.subscribeToCommands(first, 'tab-1');
    // S1's warm-up fires and its getControlSnapshot is pending.
    await vi.advanceTimersByTimeAsync(500);
    expect(snapshots(first)).toBe(1);

    // destroy() settles it; S2 registers for the same tab in the same tick,
    // before the warm-up callback resumes from its await.
    r.destroy();
    const second = vi.fn();
    r.subscribeToCommands(second, 'tab-1');

    // Past S2's own 500 ms warm-up and S1's 1500 ms retry.
    await vi.advanceTimersByTimeAsync(2000);
    expect(snapshots(second)).toBe(1);
    expect(snapshots(first)).toBe(1);
  });

  it('rejects a pending command with RelayDestroyedError, not its timeout', async () => {
    const r = relay({ proactiveSnapshot: false });
    const client = wsClient('ws-1');
    r.registerWebSocketClient(client);
    const outcome = r.queueCommand('getControlSnapshot', {}).then(
      () => 'resolved',
      (err: unknown) => err
    );
    await flushMicrotasks();
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(r.getTransportDiagnostics().pendingCommandCount).toBe(1);

    r.destroy();

    const err = await outcome;
    expect(err).toBeInstanceOf(RelayDestroyedError);
    expect((err as RelayDestroyedError).code).toBe('RELAY_DESTROYED');
    expect((err as Error).name).toBe('RelayDestroyedError');
    expect(r.getTransportDiagnostics().pendingCommandCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails a caller waiting for a browser to connect with RelayDestroyedError, and clears its timer', async () => {
    const r = relay();
    const outcome = r.queueCommand('getControlSnapshot', {}).then(
      () => 'resolved',
      (err: unknown) => err
    );
    await flushMicrotasks();

    r.destroy();

    expect(vi.getTimerCount()).toBe(0);
    expect(await outcome).toBeInstanceOf(RelayDestroyedError);
  });

  it('forgets the commands it delivered for another instance', () => {
    const r = relay();
    const deliveries = (r as unknown as { busDeliveries: Map<string, unknown> }).busDeliveries;
    deliveries.set('cmd-1', { targetTabId: 'tab-1', expiresAt: Date.now() + 60_000 });

    r.destroy();

    expect(deliveries.size).toBe(0);
  });

  it('lets a relay built later on the same prefix arm its own cleanup sweep', () => {
    const prefix = uniquePrefix();
    const key = `${prefix}CleanupInterval`;
    const g = globalThis as unknown as Record<string, unknown>;
    const first = relay({ globalPrefix: prefix });
    // Built before the destroy() below, so it holds the first sweep's handle.
    const sibling = relay({ globalPrefix: prefix });
    const firstSweep = g[key];
    expect(firstSweep).toBeDefined();

    first.destroy();
    expect(g[key]).toBeUndefined();

    relay({ globalPrefix: prefix });
    const secondSweep = g[key];
    expect(secondSweep).toBeDefined();
    expect(secondSweep).not.toBe(firstSweep);
    expect(vi.getTimerCount()).toBe(1);

    // destroy() is prefix-wide, so a relay still holding the first sweep's
    // handle clears the later relay's sweep too: nothing is left running.
    sibling.destroy();
    expect(g[key]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a sweep a relay's own registration re-armed when a sibling holding a stale handle is destroyed", () => {
    const prefix = uniquePrefix();
    const key = `${prefix}CleanupInterval`;
    const g = globalThis as unknown as Record<string, unknown>;
    const a = relay({ globalPrefix: prefix, proactiveSnapshot: false });
    const b = relay({ globalPrefix: prefix, proactiveSnapshot: false });
    a.destroy();
    // a is reused: its registration re-arms the prefix sweep, which b never saw.
    a.registerWebSocketClient(wsClient('ws-1'));
    expect(g[key]).toBeDefined();

    b.destroy();

    expect(b.getTransportDiagnostics().wsClientCount).toBe(0);
    expect(g[key]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a sweep a sibling re-armed when an already-destroyed relay is destroyed again', () => {
    const prefix = uniquePrefix();
    const key = `${prefix}CleanupInterval`;
    const g = globalThis as unknown as Record<string, unknown>;
    const a = relay({ globalPrefix: prefix, proactiveSnapshot: false });
    const b = relay({ globalPrefix: prefix, proactiveSnapshot: false });
    a.destroy();
    // b's registration re-arms the sweep; a holds no handle at all now.
    b.registerWebSocketClient(wsClient('ws-1'));
    expect(g[key]).toBeDefined();

    a.destroy();

    expect(b.getTransportDiagnostics().wsClientCount).toBe(0);
    expect(g[key]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the guard records of the transports open at destroy() time, and only those', () => {
    const r = relay({ proactiveSnapshot: true });
    r.registerWebSocketClient(wsClient('ws-before'));
    r.subscribeToCommands(() => {}, 'tab-before');
    expect(openRelaySubscriptions(r)).toEqual([
      { door: 'ws', clientId: 'ws-before' },
      { door: 'sse' },
    ]);

    r.destroy();
    expect(openRelaySubscriptions(r)).toEqual([]);

    // A client registered after destroy() is live, and still flagged.
    r.registerWebSocketClient(wsClient('ws-after'));
    expect(openRelaySubscriptions(r)).toEqual([{ door: 'ws', clientId: 'ws-after' }]);
    r.unregisterWebSocketClient('ws-after');
    expect(openRelaySubscriptions(r)).toEqual([]);
  });

  it('fails a command suspended at the bus presence lookup with RelayDestroyedError, and dispatches nothing', async () => {
    let answer!: (known: boolean) => void;
    const bus = busStub({
      isTabKnown: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      ),
    });
    const r = relay({ bus, proactiveSnapshot: false });
    const outcome = track(r.queueCommand('getControlSnapshot', {}, { targetTabId: 'remote-tab' }));
    await flushMicrotasks();
    expect(bus.isTabKnown).toHaveBeenCalledWith('remote-tab');

    r.destroy();
    answer(true);
    await flushMicrotasks();

    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(RelayDestroyedError);
    expect(bus.publishCommand).not.toHaveBeenCalled();
    expect(r.getTransportDiagnostics().pendingCommandCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops each SSE listener's bus subscription and tab presence", () => {
    const unsubscribeCommands = vi.fn();
    const bus = busStub({ subscribeCommands: vi.fn(() => unsubscribeCommands) });
    const r = relay({ bus, proactiveSnapshot: false });
    const stream = r.openCommandStream(() => {}, 'tab-1');
    expect(bus.registerTab).toHaveBeenCalledWith('tab-1', expect.any(Number));

    r.destroy();

    expect(unsubscribeCommands).toHaveBeenCalledTimes(1);
    expect(bus.unregisterTab).toHaveBeenCalledWith('tab-1');
    // The stream's own unsubscribe, run after destroy(), releases nothing twice.
    stream.unsubscribe();
    expect(unsubscribeCommands).toHaveBeenCalledTimes(1);
    expect(bus.unregisterTab).toHaveBeenCalledTimes(1);
  });

  it('finishes the teardown when a bus unsubscribe throws', () => {
    const bus = busStub({
      subscribeCommands: vi.fn(() => () => {
        throw new Error('bus down');
      }),
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = relay({ bus, proactiveSnapshot: false });
    r.openCommandStream(() => {}, 'tab-1');
    r.openCommandStream(() => {}, 'tab-2');

    expect(() => r.destroy()).not.toThrow();

    expect(bus.unregisterTab).toHaveBeenCalledWith('tab-1');
    expect(bus.unregisterTab).toHaveBeenCalledWith('tab-2');
    expect(r.getTransportDiagnostics().commandListenerCount).toBe(0);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('closes the connection gate a sibling relay on the same prefix opened', async () => {
    const prefix = uniquePrefix();
    const a = relay({ globalPrefix: prefix, proactiveSnapshot: false });
    const b = relay({ globalPrefix: prefix, proactiveSnapshot: false });
    // b opens the prefix's gate; a, which never did, sees the last transport go.
    b.registerWebSocketClient(wsClient('ws-1'));
    a.unregisterWebSocketClient('ws-1');

    const outcome = track(a.queueCommand('getControlSnapshot', {}));
    await vi.advanceTimersByTimeAsync(1000);
    // Still waiting for a browser: the gate was closed again, not left open.
    expect(outcome.settled).toBe(false);

    const client = wsClient('ws-2');
    b.registerWebSocketClient(client);
    await flushMicrotasks();
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('closes the guard records of every relay sharing the destroyed prefix', () => {
    const prefix = uniquePrefix();
    const a = relay({ globalPrefix: prefix, proactiveSnapshot: true });
    const b = relay({ globalPrefix: prefix, proactiveSnapshot: true });
    b.registerWebSocketClient(wsClient('ws-b'));
    b.subscribeToCommands(() => {}, 'tab-b');
    expect(openRelaySubscriptions(b)).toHaveLength(2);

    // destroy() on a tears down b's transports too: they are prefix state.
    a.destroy();

    expect(b.getTransportDiagnostics().wsClientCount).toBe(0);
    expect(openRelaySubscriptions(b)).toEqual([]);
  });

  it("releases a replaced stream's bus subscription, keeping the tab's presence, and destroy() the newer one's", () => {
    const firstUnsub = vi.fn();
    const secondUnsub = vi.fn();
    const bus = busStub({
      subscribeCommands: vi.fn().mockReturnValueOnce(firstUnsub).mockReturnValueOnce(secondUnsub),
    });
    const r = relay({ bus, proactiveSnapshot: false });
    r.openCommandStream(() => {}, 'tab-1');
    // A second stream for the same tab replaces the first before it unsubscribed.
    r.openCommandStream(() => {}, 'tab-1');

    // Only one bus subscription is left for the tab, and its presence stands.
    expect(firstUnsub).toHaveBeenCalledTimes(1);
    expect(secondUnsub).not.toHaveBeenCalled();
    expect(bus.unregisterTab).not.toHaveBeenCalled();

    r.destroy();

    expect(firstUnsub).toHaveBeenCalledTimes(1);
    expect(secondUnsub).toHaveBeenCalledTimes(1);
    expect(bus.unregisterTab).toHaveBeenCalledTimes(1);
    expect(bus.unregisterTab).toHaveBeenCalledWith('tab-1');
  });

  it('re-arms the cleanup sweep when a transport registers after destroy(), and clears it again', () => {
    const prefix = uniquePrefix();
    const key = `${prefix}CleanupInterval`;
    const g = globalThis as unknown as Record<string, unknown>;
    const r = relay({ globalPrefix: prefix, proactiveSnapshot: false });
    const firstSweep = g[key];
    expect(firstSweep).toBeDefined();

    r.destroy();
    expect(g[key]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    // The relay is reused: its transport gets a stale-tab prune again.
    r.registerWebSocketClient(wsClient('ws-1'));
    expect(g[key]).toBeDefined();
    expect(g[key]).not.toBe(firstSweep);
    const prune = vi.spyOn(r, 'pruneStaleTabs');
    vi.advanceTimersByTime(60_000);
    expect(prune).toHaveBeenCalled();

    r.destroy();
    expect(g[key]).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    // The SSE door re-arms it too.
    const stream = r.openCommandStream(() => {}, 'tab-1');
    expect(g[key]).toBeDefined();
    stream.unsubscribe();
  });

  it('does not fail a primary-tab command over to a transport registered right after destroy()', async () => {
    const r = relay({ proactiveSnapshot: false });
    const primary = wsClient('tab-a');
    r.registerWebSocketClient(primary);
    const outcome = track(r.queueCommand('getControlSnapshot', {}));
    await flushMicrotasks();
    expect(primary.send).toHaveBeenCalledTimes(1);

    r.destroy();
    const later = wsClient('tab-c');
    r.registerWebSocketClient(later);
    await flushMicrotasks();

    expect(later.send).not.toHaveBeenCalled();
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(RelayDestroyedError);
  });

  it("does not fail an owner-scoped command over to the user's other tab registered right after destroy()", async () => {
    const r = relay({ proactiveSnapshot: false });
    const ownership = (r as unknown as { tabOwnership: Map<string, unknown> }).tabOwnership;
    const own = (tabId: string) =>
      ownership.set(tabId, { userId: 'u1', sessionId: 's1', firstSeen: 0, lastSeen: 0 });
    const first = wsClient('tab-a');
    r.registerWebSocketClient(first);
    r.registerWebSocketClient(wsClient('tab-b'));
    own('tab-a');
    own('tab-b');
    const outcome = track(
      r.queueCommand('getControlSnapshot', {}, { ownerCheck: { userId: 'u1' } })
    );
    await flushMicrotasks();
    expect(first.send).toHaveBeenCalledTimes(1);

    r.destroy();
    const fallback = wsClient('tab-b');
    r.registerWebSocketClient(fallback);
    own('tab-b');
    await flushMicrotasks();

    expect(fallback.send).not.toHaveBeenCalled();
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(RelayDestroyedError);
  });

  it('does not retry a disconnected command once destroy() ran during its reconnection wait', async () => {
    const r = relay({ proactiveSnapshot: false });
    // Counts as a transport, so the command skips the initial wait, but
    // delivers nothing: the dispatch fails with SDK_DISCONNECTED.
    r.registerWebSocketClient({ ...wsClient('ws-gone'), isConnected: () => false });
    const later = wsClient('ws-new');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const seams = r as unknown as {
      waitForConnection: (ms: number, makeError: () => Error) => Promise<void>;
      queueCommandInner: (...args: unknown[]) => Promise<unknown>;
    };
    // The only waitForConnection call is the reconnection wait (the stale
    // client skips the initial one). Model the order the real wait can
    // produce: the gate opens, so the wait RESOLVES; only then, before
    // queueCommand resumes from its `await`, destroy() runs and a fresh
    // transport registers. (A destroy() landing while the wait is still
    // pending rejects it with RelayDestroyedError instead, which never
    // reaches the retry.) The `.then` below is registered on the resolved
    // promise before queueCommand's own `await` is, so it runs first.
    const wait = vi.spyOn(seams, 'waitForConnection').mockImplementationOnce(() => {
      const opened = Promise.resolve();
      void opened.then(() => {
        r.destroy();
        r.registerWebSocketClient(later);
      });
      return opened;
    });
    const inner = vi.spyOn(seams, 'queueCommandInner');
    const outcome = track(r.queueCommand('getControlSnapshot', {}));
    await flushMicrotasks();

    expect(wait).toHaveBeenCalledTimes(1);
    expect(outcome.settled).toBe(true);
    expect(outcome.error).toBeInstanceOf(RelayDestroyedError);
    expect(later.send).not.toHaveBeenCalled();
    // Only the first attempt ran: the retry was refused before it began.
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
