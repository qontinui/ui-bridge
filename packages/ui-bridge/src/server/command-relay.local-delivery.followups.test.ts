/**
 * Follow-ups to ui-bridge#423 (plan
 * 2026-11-21-ui-bridge-relay-pr-423-follow-ups-local-delivery-registration-poll-branch-timeout-kind,
 * items 1-3):
 *
 * 1. A command delivered over THIS instance's own stream/WebSocket, on a bus
 *    deployment, has a response subscription, so a result POSTed to ANOTHER
 *    instance (which finds the id registered and publishes it) settles it.
 * 2. One registry SET per dispatch, whatever the route.
 * 3. The HTTP-poll queue is gone; a zero-listener dispatch still fails fast.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay, type WebSocketClient } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { InMemoryBusHub, type InMemoryBus } from './__fixtures__/in-memory-relay-bus';
import { isNoLiveAnswer } from './live-answer';
import type { RelayCommandEnvelope } from './relay-bus';

const relays: CommandRelay[] = [];

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
  vi.restoreAllMocks();
});

function relayOn(hub: InMemoryBusHub, name: string): { relay: CommandRelay; bus: InMemoryBus } {
  const bus = hub.bus(name);
  const relay = new CommandRelay({
    globalPrefix: `__localdeliv_${name}_${Math.random().toString(36).slice(2, 10)}`,
    bus,
    proactiveSnapshot: false,
  });
  relays.push(relay);
  return { relay, bus };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function track<T>(promise: Promise<T>): { settled: boolean; value?: T; error?: unknown } {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error })
  );
  return state;
}

describe('item 1 · a locally delivered command is subscribed on the bus', () => {
  it('SSE: a result POSTed to another instance settles the caller on the instance that delivered it', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const b = relayOn(hub, 'B');
    const delivered: Array<{ commandId: string }> = [];
    a.relay.subscribeToCommands((cmd) => {
      delivered.push(cmd as { commandId: string });
    }, 'tab-1');

    const outcome = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-1' }));
    await wait(5);
    expect(delivered).toHaveLength(1);

    // The tab's result lands on instance B, which holds no pending command.
    const accepted = await b.relay.resolveCommand(delivered[0].commandId, { v: 1 }, 'tab-1');
    expect(accepted).toBe('forwarded');
    await wait(5);
    expect(outcome).toEqual({ settled: true, value: { v: 1 } });
  });

  it('WebSocket: a failure POSTed to another instance rejects the caller', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const b = relayOn(hub, 'B');
    const sent: string[] = [];
    const client: WebSocketClient = {
      clientId: 'tab-1',
      isConnected: () => true,
      close: () => undefined,
      send: (data: string) => sent.push((JSON.parse(data) as { commandId: string }).commandId),
    };
    a.relay.registerWebSocketClient(client);

    const outcome = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-1' }));
    await wait(5);
    expect(sent).toHaveLength(1);

    await b.relay.rejectCommand(sent[0], 'tab blew up', 'tab-1');
    await wait(5);
    expect(outcome.settled).toBe(true);
    expect(String((outcome.error as Error).message)).toContain('tab blew up');
  });

  it('control: a same-instance result settles directly and publishes nothing on the bus', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const publish = vi.spyOn(a.bus, 'publishResponse');
    const delivered: Array<{ commandId: string }> = [];
    a.relay.subscribeToCommands((cmd) => {
      delivered.push(cmd as { commandId: string });
    }, 'tab-1');

    const outcome = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-1' }));
    await wait(5);
    await a.relay.resolveCommand(delivered[0].commandId, { v: 2 }, 'tab-1');
    await wait(5);

    expect(outcome).toEqual({ settled: true, value: { v: 2 } });
    expect(publish).not.toHaveBeenCalled();
    expect(hub.respByCmd.get(delivered[0].commandId)?.size ?? 0).toBe(0);
  });

  it('a settled command leaves no response subscription behind', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const delivered: Array<{ commandId: string }> = [];
    a.relay.subscribeToCommands((cmd) => {
      delivered.push(cmd as { commandId: string });
    }, 'tab-1');
    const outcome = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-1' }));
    await wait(5);
    expect(hub.respByCmd.get(delivered[0].commandId)?.size).toBe(1);
    await a.relay.resolveCommand(delivered[0].commandId, {}, 'tab-1');
    await wait(5);
    expect(outcome.settled).toBe(true);
    expect(hub.respByCmd.get(delivered[0].commandId)?.size ?? 0).toBe(0);
  });
});

describe('item 1 · a redelivered alias is subscribed on the bus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 1));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const BASE = '/api/ui-bridge';

  async function openStream(routes: ReturnType<typeof createNextRouteHandlers>, cid: string) {
    const url = `http://app.test${BASE}/commands/stream?tabId=tab-a&caps=${encodeURIComponent('rotate,dedupe')}&cid=${cid}`;
    const nextUrl = new URL(url);
    const request = Object.assign(new Request(url, { method: 'GET' }), { nextUrl });
    const response = await routes.GET(
      request as never,
      { params: { path: ['commands', 'stream'] } } as never
    );
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const commands: Array<{ commandId: string; redeliveryOf?: string }> = [];
    let streamId: string | undefined;
    let buffer = '';
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let at: number;
          while ((at = buffer.indexOf('\n\n')) !== -1) {
            const line = buffer
              .slice(0, at)
              .split('\n')
              .find((l) => l.startsWith('data: '));
            buffer = buffer.slice(at + 2);
            if (!line) continue;
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (data.type === 'connected') streamId = data.streamId as string;
            if (typeof data.commandId === 'string' && typeof data.action === 'string') {
              commands.push({
                commandId: data.commandId,
                ...(typeof data.redeliveryOf === 'string'
                  ? { redeliveryOf: data.redeliveryOf }
                  : {}),
              });
            }
          }
        }
      } catch {
        /* ended */
      }
    })();
    await vi.advanceTimersByTimeAsync(0);
    return { commands, streamId: () => streamId };
  }

  it('the alias result POSTed to another instance settles the caller', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const b = relayOn(hub, 'B');
    const routes = createNextRouteHandlers(createRelayHandlers(a.relay), { relay: a.relay });

    const first = await openStream(routes, 'page-1');
    const outcome = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(first.commands).toHaveLength(1);

    const second = await openStream(routes, 'page-1');
    expect(second.commands).toHaveLength(1);
    const alias = second.commands[0];
    expect(alias.redeliveryOf).toBe(first.commands[0].commandId);

    const accepted = await b.relay.resolveCommand(alias.commandId, { run: 'alias' }, 'tab-a', {
      streamId: second.streamId(),
    });
    expect(accepted).toBe('forwarded');
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toEqual({ settled: true, value: { run: 'alias' } });
    // The group teardown withdrew both subscriptions.
    expect(hub.respByCmd.get(alias.commandId)?.size ?? 0).toBe(0);
    expect(hub.respByCmd.get(first.commands[0].commandId)?.size ?? 0).toBe(0);
  });
});

describe('item 2 · one registry SET per dispatch', () => {
  function countRegistrations(bus: InMemoryBus) {
    const calls: Array<{ id: string; ttl: number }> = [];
    const original = bus.registerCommand.bind(bus);
    vi.spyOn(bus, 'registerCommand').mockImplementation((id: string, ttl: number) => {
      calls.push({ id, ttl });
      original(id, ttl);
    });
    return calls;
  }

  it('a bus-routed command (the tab is held by another instance) registers once', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const b = relayOn(hub, 'B');
    const calls = countRegistrations(a.bus);
    const received: RelayCommandEnvelope[] = [];
    b.relay.subscribeToCommands((cmd) => {
      received.push(cmd as RelayCommandEnvelope);
    }, 'tab-1');

    const outcome = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-1' }));
    await wait(5);
    expect(received).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe(received[0].commandId);

    await b.relay.resolveCommand(received[0].commandId, {}, 'tab-1');
    await wait(5);
    expect(outcome.settled).toBe(true);
  });

  it('a bus-routed fire-and-forget command registers once, with the recorder TTL', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const b = relayOn(hub, 'B');
    const calls = countRegistrations(a.bus);
    b.relay.subscribeToCommands(() => undefined, 'tab-1');

    await a.relay.queueCommand('pageRefresh', {}, { targetTabId: 'tab-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].ttl).toBe(2);
  });

  it('a command delivered over SSE registers once', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const calls = countRegistrations(a.bus);
    a.relay.subscribeToCommands(() => undefined, 'tab-1');
    track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-1' }));
    await wait(5);
    expect(calls).toHaveLength(1);
  });

  it('a command delivered over a WebSocket registers once', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const calls = countRegistrations(a.bus);
    a.relay.registerWebSocketClient({
      clientId: 'tab-1',
      isConnected: () => true,
      close: () => undefined,
      send: () => undefined,
    });
    track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-1' }));
    await wait(5);
    expect(calls).toHaveLength(1);
  });

  it('a locally delivered fire-and-forget command registers once, with the recorder TTL', async () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    const calls = countRegistrations(a.bus);
    a.relay.subscribeToCommands(() => undefined, 'tab-1');
    await a.relay.queueCommand('pageRefresh', {}, { targetTabId: 'tab-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].ttl).toBe(2);
  });
});

describe('item 3 · the HTTP-poll queue is gone', () => {
  it('getTransportDiagnostics no longer carries commandQueueLength', () => {
    const hub = new InMemoryBusHub();
    const a = relayOn(hub, 'A');
    expect(a.relay.getTransportDiagnostics()).not.toHaveProperty('commandQueueLength');
    expect(a.relay.getTransportDiagnostics({ ownerCheck: { userId: 'u1' } })).not.toHaveProperty(
      'commandQueueLength'
    );
    expect((a.relay as unknown as Record<string, unknown>).getPendingCommands).toBeUndefined();
  });

  it('a zero-listener dispatch still fails fast as SDK_DISCONNECTED / not_delivered', async () => {
    const relay = new CommandRelay({
      globalPrefix: `__localdeliv_nolisten_${Math.random().toString(36).slice(2, 10)}`,
      proactiveSnapshot: false,
    });
    relays.push(relay);
    const error = await relay.queueCommand('getTabInfo', {}).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(isNoLiveAnswer(error)).toBe(true);
    expect((error as { reason: string }).reason).toBe('not_delivered');
    expect((error as Error).message).toContain('SDK_DISCONNECTED');
  });
});
