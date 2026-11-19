/**
 * The command registry's lifecycle on the dispatching instance (plan
 * 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
 * D2): a command's registration is ISSUED before it is sent down any
 * transport — a fast tab's result can land on another instance whose
 * `isCommandKnown` read would otherwise be issued before the write — and every
 * way the command settles or fails to be delivered withdraws it. The write is
 * fire-and-forget on the Redis bus (not awaited), so issued-first is the
 * whole guarantee: these tests observe the synchronous in-memory registry at
 * the moment of send.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CommandRelay, type CommandRelayOptions, type WebSocketClient } from './command-relay';
import { InMemoryBusHub } from './__fixtures__/in-memory-relay-bus';

const relays: CommandRelay[] = [];
afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

function relayOn(hub: InMemoryBusHub, name: string, options: CommandRelayOptions = {}) {
  const relay = new CommandRelay({
    globalPrefix: `__registry_${name}_${Math.random().toString(36).slice(2, 10)}`,
    bus: hub.bus(name),
    proactiveSnapshot: false,
    ...options,
  });
  relays.push(relay);
  return relay;
}

/** A WebSocket client that records, as each command is sent, whether the registry knew it. */
function recordingWsClient(hub: InMemoryBusHub, clientId: string) {
  const seen: Array<{ commandId: string; knownAtSend: boolean }> = [];
  const client: WebSocketClient = {
    clientId,
    isConnected: () => true,
    close: () => undefined,
    send: (data: string) => {
      const { commandId } = JSON.parse(data) as { commandId: string };
      seen.push({ commandId, knownAtSend: hub.knownCommands.has(commandId) });
    },
  };
  return { client, seen };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('a command is registered before it is sent', () => {
  it('over a WebSocket (an awaited command)', async () => {
    const hub = new InMemoryBusHub();
    const relay = relayOn(hub, 'A');
    const { client, seen } = recordingWsClient(hub, 'tab-1');
    relay.registerWebSocketClient(client);

    relay.queueCommand('getControlSnapshot', {}).catch(() => undefined);
    await wait(5);
    expect(seen.map((s) => s.knownAtSend)).toEqual([true]);
  });

  it('over a WebSocket (a fire-and-forget command)', async () => {
    const hub = new InMemoryBusHub();
    const relay = relayOn(hub, 'A');
    const { client, seen } = recordingWsClient(hub, 'tab-1');
    relay.registerWebSocketClient(client);

    await relay.queueCommand('pageNavigate', { url: '/x' });
    expect(seen.map((s) => s.knownAtSend)).toEqual([true]);
  });

  it('down an SSE stream (a fire-and-forget command)', async () => {
    const hub = new InMemoryBusHub();
    const relay = relayOn(hub, 'A');
    const knownAtSend: boolean[] = [];
    relay.subscribeToCommands((cmd) => {
      knownAtSend.push(hub.knownCommands.has(cmd.commandId));
    }, 'tab-1');

    await relay.queueCommand('pageNavigate', { url: '/x' });
    expect(knownAtSend).toEqual([true]);
  });

  it('down an SSE stream (an awaited command)', async () => {
    const hub = new InMemoryBusHub();
    const relay = relayOn(hub, 'A');
    const knownAtSend: boolean[] = [];
    relay.subscribeToCommands((cmd) => {
      knownAtSend.push(hub.knownCommands.has(cmd.commandId));
    }, 'tab-1');

    relay.queueCommand('getControlSnapshot', {}).catch(() => undefined);
    await wait(5);
    expect(knownAtSend).toEqual([true]);
  });
});

describe('every way a command ends withdraws it from the registry', () => {
  it('an SSE broadcast no listener accepted', async () => {
    const hub = new InMemoryBusHub();
    const relay = relayOn(hub, 'A');
    const ids: string[] = [];
    relay.subscribeToCommands((cmd) => {
      ids.push(cmd.commandId);
      return false;
    }, 'tab-1');

    await expect(relay.queueCommand('getControlSnapshot', {})).rejects.toThrow(
      /No active UI Bridge SDK client received/
    );
    expect(ids).toHaveLength(1);
    expect(hub.knownCommands.has(ids[0])).toBe(false);
  });

  it('a fire-and-forget command no listener accepted', async () => {
    const hub = new InMemoryBusHub();
    const relay = relayOn(hub, 'A');
    const ids: string[] = [];
    relay.subscribeToCommands((cmd) => {
      ids.push(cmd.commandId);
      return false;
    }, 'tab-1');

    await expect(relay.queueCommand('pageNavigate', { url: '/x' })).rejects.toThrow(
      /No active UI Bridge SDK client received/
    );
    expect(ids).toHaveLength(1);
    expect(hub.knownCommands.has(ids[0])).toBe(false);
  });

  it('a fire-and-forget command whose result recorder expired', async () => {
    const hub = new InMemoryBusHub();
    const relay = relayOn(hub, 'A', { sseTimeoutMs: 40 });
    const ids: string[] = [];
    relay.subscribeToCommands((cmd) => {
      ids.push(cmd.commandId);
    }, 'tab-1');

    await relay.queueCommand('pageNavigate', { url: '/x' });
    expect(hub.knownCommands.has(ids[0])).toBe(true);
    // The recorder window is min(sseTimeoutMs, 2000) = 40 ms; the fixture's
    // own TTL floor is a second, so only the relay's forget clears it here.
    await wait(80);
    expect(hub.knownCommands.has(ids[0])).toBe(false);
  });

  it('a bus dispatch that timed out', async () => {
    const hub = new InMemoryBusHub();
    const sender = relayOn(hub, 'A', { sseTimeoutMs: 30 });
    const holder = relayOn(hub, 'B');
    const ids: string[] = [];
    holder.subscribeToCommands((cmd) => {
      ids.push(cmd.commandId);
    }, 'tab-1');

    await expect(
      sender.queueCommand('getControlSnapshot', {}, { targetTabId: 'tab-1' })
    ).rejects.toThrow(/timed out after 30ms \(bus\)/);
    expect(ids).toHaveLength(1);
    expect(hub.knownCommands.has(ids[0])).toBe(false);
  });

  it('destroy() of the dispatching instance', async () => {
    const hub = new InMemoryBusHub();
    const sender = relayOn(hub, 'A');
    const holder = relayOn(hub, 'B');
    const ids: string[] = [];
    holder.subscribeToCommands((cmd) => {
      ids.push(cmd.commandId);
    }, 'tab-1');

    sender.queueCommand('getControlSnapshot', {}, { targetTabId: 'tab-1' }).catch(() => undefined);
    await wait(5);
    expect(hub.knownCommands.has(ids[0])).toBe(true);
    sender.destroy();
    expect(hub.knownCommands.has(ids[0])).toBe(false);
  });

  it('eviction from a full pending table', async () => {
    const hub = new InMemoryBusHub();
    const relay = relayOn(hub, 'A', { maxPendingCommands: 1 });
    const ids: string[] = [];
    relay.subscribeToCommands((cmd) => {
      ids.push(cmd.commandId);
    }, 'tab-1');

    const first = relay.queueCommand('getControlSnapshot', {});
    first.catch(() => undefined);
    await wait(5);
    relay.queueCommand('getControlSnapshot', {}).catch(() => undefined);
    await expect(first).rejects.toThrow(/Command evicted/);
    expect(ids).toHaveLength(2);
    expect([hub.knownCommands.has(ids[0]), hub.knownCommands.has(ids[1])]).toEqual([false, true]);
  });
});
