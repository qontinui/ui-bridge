/**
 * `POST /commands` answers 404 `COMMAND_UNKNOWN` for a result no relay
 * instance awaits, and publishes nothing on the bus for it (plan
 * 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
 * Phase 4, D2). Before it, the route answered 200 `{ success: true }` whatever
 * the relay did with the result, and the relay re-published it on the bus.
 *
 * The fleet: A dispatches, B holds tab-1's stream, C is any other instance;
 * every POST below lands on C (or B where the case says so).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createNextRouteHandlers } from './nextjs';
import type { RelayBus, RelayCommandEnvelope } from './relay-bus';
import { InMemoryBusHub } from './__fixtures__/in-memory-relay-bus';

const relays: CommandRelay[] = [];
afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
  vi.restoreAllMocks();
});

function relayOn(bus: RelayBus | undefined, sseTimeoutMs?: number): CommandRelay {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeUnknown_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
    ...(bus ? { bus } : {}),
    ...(sseTimeoutMs !== undefined ? { sseTimeoutMs } : {}),
  });
  relays.push(relay);
  return relay;
}

function fleet(sseTimeoutMs?: number) {
  const hub = new InMemoryBusHub();
  const [busA, busB, busC] = [hub.bus('A'), hub.bus('B'), hub.bus('C')];
  const a = relayOn(busA, sseTimeoutMs);
  const b = relayOn(busB);
  const c = relayOn(busC);
  const received: RelayCommandEnvelope[] = [];
  b.subscribeToCommands((cmd) => {
    received.push(cmd as RelayCommandEnvelope);
  }, 'tab-1');
  return { a, b, c, busB, busC, received };
}

/** POST /commands on `relay`'s Next.js catch-all. */
async function postResult(
  relay: CommandRelay,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const routes = createNextRouteHandlers({}, { relay });
  const url = 'https://test.local/api/ui-bridge/commands';
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, 'nextUrl', { value: new URL(url), writable: false });
  const res = await routes.POST(request as never, { params: { path: ['commands'] } } as never);
  const json = (await res.json()) as Record<string, unknown>;
  delete json.timestamp;
  return { status: res.status, json };
}

const UNKNOWN = {
  status: 404,
  json: {
    success: false,
    code: 'COMMAND_UNKNOWN',
    error: 'No relay instance is awaiting this command.',
  },
};

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('POST /commands · a result no instance awaits', () => {
  it('(1) a result for a command another instance dispatched settles it and answers 200', async () => {
    const { a, c, received } = fleet();
    const pending = a.queueCommand<{ v: number }>('testAction', {}, { targetTabId: 'tab-1' });
    await tick();
    expect(received).toHaveLength(1);
    expect(
      await postResult(c, {
        commandId: received[0].commandId,
        success: true,
        result: { v: 9 },
        tabId: 'tab-1',
      })
    ).toEqual({ status: 200, json: { success: true } });
    await expect(pending).resolves.toEqual({ v: 9 });
  });

  it('(2) a result for an id no instance dispatched → 404 COMMAND_UNKNOWN, nothing published', async () => {
    const { c, busC } = fleet();
    const publish = vi.spyOn(busC, 'publishResponse');
    expect(
      await postResult(c, {
        commandId: 'never-dispatched',
        success: true,
        result: {},
        tabId: 'tab-1',
      })
    ).toEqual(UNKNOWN);
    expect(publish).toHaveBeenCalledTimes(0);
  });

  it('(3) a result posted after the dispatcher timed out → 404 COMMAND_UNKNOWN', async () => {
    const { a, c, busC, received } = fleet(30);
    await a.queueCommand('testAction', {}, { targetTabId: 'tab-1' }).catch(() => undefined);
    expect(received).toHaveLength(1);
    const publish = vi.spyOn(busC, 'publishResponse');
    expect(
      await postResult(c, {
        commandId: received[0].commandId,
        success: true,
        result: { late: true },
        tabId: 'tab-1',
      })
    ).toEqual(UNKNOWN);
    expect(publish).toHaveBeenCalledTimes(0);
  });

  it('(4) a `success: false` post for an id no instance awaits → 404, nothing published', async () => {
    const { c, busC } = fleet();
    const publish = vi.spyOn(busC, 'publishResponse');
    expect(
      await postResult(c, {
        commandId: 'never-dispatched',
        success: false,
        error: 'Element x not found',
        tabId: 'tab-1',
      })
    ).toEqual(UNKNOWN);
    expect(publish).toHaveBeenCalledTimes(0);
  });

  it('(5) a registry read that fails forwards the result, logs it, and answers 200', async () => {
    const { c, busC } = fleet();
    const publish = vi.spyOn(busC, 'publishResponse');
    vi.spyOn(busC, 'isCommandKnown').mockRejectedValue(new Error('redis down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      await postResult(c, {
        commandId: 'cmd-unverified',
        success: true,
        result: {},
        tabId: 'tab-1',
      })
    ).toEqual({ status: 200, json: { success: true } });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(
      warn.mock.calls.map((args) => String(args[0])).filter((l) => l.includes('cmd-unverified'))
    ).toEqual([
      '[ui-bridge] result_forward_unverified commandId=cmd-unverified: the command registry could not be read; forwarding the result over the bus',
    ]);
  });

  it('(6) with no bus and nothing pending → 404 COMMAND_UNKNOWN', async () => {
    const relay = relayOn(undefined);
    expect(
      await postResult(relay, {
        commandId: 'never-dispatched',
        success: true,
        result: {},
        tabId: 'tab-1',
      })
    ).toEqual(UNKNOWN);
  });

  it('(7) a refused result on a live bus delivery → 403, the registry never read', async () => {
    const { a, b, busB, received } = fleet();
    a.queueCommand('testAction', {}, { targetTabId: 'tab-1' }).catch(() => undefined);
    await tick();
    expect(received).toHaveLength(1);
    const known = vi.spyOn(busB, 'isCommandKnown');
    const publish = vi.spyOn(busB, 'publishResponse');
    expect(
      await postResult(b, {
        commandId: received[0].commandId,
        success: true,
        result: {},
        tabId: 'tab-2',
      })
    ).toEqual({
      status: 403,
      json: {
        success: false,
        code: 'COMMAND_RESPONSE_REFUSED',
        error: 'This result does not come from the stream the command was delivered on.',
      },
    });
    expect(known).toHaveBeenCalledTimes(0);
    expect(publish).toHaveBeenCalledTimes(0);
  });
});
