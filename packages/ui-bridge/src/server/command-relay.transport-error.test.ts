/**
 * Which relay rejections are TRANSPORT failures — `RelayTransportError`, no
 * tab could be reached — and which are answers: a failure a tab reported. A
 * handler that can fall back to a cache (`getElementState` in
 * `relay-handlers.ts`) does so on the first kind only, so a page that answered
 * "not found" never reads as a disconnected browser.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay, isRelayTransportError, RelayTransportError } from './command-relay';
import type { RelayBus } from './relay-bus';

const relays: CommandRelay[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const relay of relays.splice(0)) relay.destroy();
});

function freshRelay(options: ConstructorParameters<typeof CommandRelay>[0] = {}): CommandRelay {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeTransport_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
    ...options,
  });
  relays.push(relay);
  return relay;
}

/** A bus on which `tabId` is held by another instance that never answers. */
function silentBus(tabId: string): RelayBus {
  return {
    publishCommand: () => {},
    subscribeCommands: () => () => {},
    publishResponse: () => {},
    subscribeResponse: () => () => {},
    registerTab: () => {},
    unregisterTab: () => {},
    isTabKnown: async (id) => id === tabId,
    close: async () => {},
  };
}

/** What `promise` rejected with; a failure when it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the command to be rejected');
}

describe('a relay rejection says whether any tab was reached', () => {
  it('no tab of the caller connected: SDK_DISCONNECTED, a transport failure', async () => {
    const relay = freshRelay();
    const err = await rejectionOf(
      relay.queueCommand('getElementState', { id: 'x' }, { ownerCheck: { userId: 'alice' } })
    );
    expect(err).toBeInstanceOf(RelayTransportError);
    expect(isRelayTransportError(err)).toBe(true);
    expect(err.message).toContain('SDK_DISCONNECTED');
  });

  it("the caller's last tab gone between the check and the dispatch: a transport failure", async () => {
    const relay = freshRelay();
    // Seen by the entry check, gone by the time the command is routed.
    vi.spyOn(relay, 'listOwnedTabs').mockReturnValueOnce(['tab-a']).mockReturnValue([]);
    const err = await rejectionOf(
      relay.queueCommand('getElementState', { id: 'x' }, { ownerCheck: { userId: 'alice' } })
    );
    expect(isRelayTransportError(err)).toBe(true);
    expect(err.message).toContain('No browser connected to receive getElementState command');
  });

  it('no tab connected at all: the wait for one ends in a transport failure', async () => {
    vi.useFakeTimers();
    const relay = freshRelay();
    const pending = rejectionOf(relay.queueCommand('getElementState', { id: 'x' }));
    await vi.advanceTimersByTimeAsync(3_000);
    const err = await pending;
    expect(isRelayTransportError(err)).toBe(true);
    expect(err.message).toContain('SDK_DISCONNECTED');
  });

  it('a tab that is told but never answers: the timeout is a transport failure', async () => {
    const relay = freshRelay({ sseTimeoutMs: 50 });
    relay.subscribeToCommands(() => {}, 'tab-1');
    const err = await rejectionOf(relay.queueCommand('getElementState', { id: 'x' }));
    expect(isRelayTransportError(err)).toBe(true);
    expect(err.message).toContain('timed out');
  });

  // `pageNavigate` is fire-and-forget: it resolves on delivery, so it has a
  // delivery check of its own.
  it.each(['getElementState', 'pageNavigate'])(
    'no listener takes %s: a transport failure',
    async (action) => {
      const relay = freshRelay();
      relay.subscribeToCommands(() => {
        throw new Error('stream closed');
      }, 'tab-1');
      const err = await rejectionOf(relay.queueCommand(action, { id: 'x', url: '/' }));
      expect(isRelayTransportError(err)).toBe(true);
      expect(err.message).toContain('No active UI Bridge SDK client received');
    }
  );

  it('a WebSocket that cannot send, and no stream to fall back to: a transport failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const relay = freshRelay();
    relay.registerWebSocketClient({
      clientId: 'ws-1',
      send: () => {
        throw new Error('socket closed');
      },
      isConnected: () => true,
      close: () => {},
    });
    const err = await rejectionOf(relay.queueCommand('getElementState', { id: 'x' }));
    expect(isRelayTransportError(err)).toBe(true);
    expect(err.message).toContain('SDK_DISCONNECTED');
  });

  it('a tab held by another instance that never answers: the bus timeout is a transport failure', async () => {
    const relay = freshRelay({ sseTimeoutMs: 50, bus: silentBus('tab-remote') });
    const err = await rejectionOf(
      relay.queueCommand('getElementState', { id: 'x' }, { targetTabId: 'tab-remote' })
    );
    expect(isRelayTransportError(err)).toBe(true);
    expect(err.message).toContain('(bus)');
  });

  it('a command evicted by the pending cap: a transport failure', async () => {
    const relay = freshRelay({ maxPendingCommands: 1, sseTimeoutMs: 200 });
    relay.subscribeToCommands(() => {}, 'tab-1');
    const first = rejectionOf(relay.queueCommand('getElementState', { id: 'a' }));
    // The second pending command pushes the first out.
    void relay.queueCommand('getElementState', { id: 'b' }).catch(() => {});
    const err = await first;
    expect(isRelayTransportError(err)).toBe(true);
    expect(err.message).toContain('evicted');
  });

  it('a failure the tab reports is an answer, not a transport failure', async () => {
    const relay = freshRelay();
    relay.subscribeToCommands((command) => {
      setTimeout(() => relay.rejectCommand(command.commandId, 'Element x not found', 'tab-1'), 0);
    }, 'tab-1');
    const err = await rejectionOf(relay.queueCommand('getElementState', { id: 'x' }));
    expect(isRelayTransportError(err)).toBe(false);
    expect(err.message).toBe('Element x not found');
  });

  it('reads one from another copy of the module by its name, and nothing else', () => {
    const foreign = Object.assign(new Error('SDK_DISCONNECTED: elsewhere'), {
      name: 'RelayTransportError',
    });
    expect(isRelayTransportError(foreign)).toBe(true);
    // The prose alone does not make one: a tab may report any message.
    expect(isRelayTransportError(new Error('SDK_DISCONNECTED: a tab said so'))).toBe(false);
    expect(isRelayTransportError('SDK_DISCONNECTED')).toBe(false);
  });
});
