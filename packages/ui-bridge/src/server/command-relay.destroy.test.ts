/**
 * `destroy()` is a full teardown: once it returns, no timer the relay armed
 * can send a command or log, every pending command settles with a
 * `RelayDestroyedError`, and the open-subscription guard in `test-setup.ts`
 * counts the relay's transports as closed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay, RelayDestroyedError, type WebSocketClient } from './command-relay';
import { openRelaySubscriptions } from '../test-setup';

function uniquePrefix(): string {
  return `__uiBridgeDestroy_${Math.random().toString(36).slice(2, 10)}`;
}

function wsClient(clientId: string): WebSocketClient & { send: ReturnType<typeof vi.fn> } {
  return { clientId, send: vi.fn(), isConnected: () => true, close: vi.fn() };
}

/** Let the relay's async dispatch run up to the point a command is pending. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('CommandRelay.destroy()', () => {
  let relays: CommandRelay[] = [];

  function relay(options: { proactiveSnapshot?: boolean; globalPrefix?: string } = {}) {
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

    // A relay that still holds the first sweep's handle must not forget the
    // later relay's sweep when it is destroyed.
    sibling.destroy();
    expect(g[key]).toBe(secondSweep);
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
});
