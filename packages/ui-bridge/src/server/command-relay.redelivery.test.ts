/**
 * The relay redelivers a still-pending command on the same page instance's
 * replacement stream (plan
 * 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
 * Phase 5, D3).
 *
 * A stream whose consumer vanished without the relay hearing it still holds
 * the commands written to it. When the tab's page opens a replacement stream
 * (same `cid`, client declaring `dedupe`), each such command goes down the
 * replacement under a fresh alias id (`redeliveryOf: <original>`), bound to
 * the replacement and sharing the original's promise and timeout. The first
 * result of either id settles the caller; the page runs one dedupe key once.
 *
 * Literals throughout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { createCommandDedupe, dedupeKeyOf } from '../relay/command-dedupe';

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const BASE = '/api/ui-bridge';

const relays: CommandRelay[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type Routes = ReturnType<typeof createNextRouteHandlers>;

function rig(options: ConstructorParameters<typeof CommandRelay>[0] = {}): {
  relay: CommandRelay;
  routes: Routes;
} {
  const relay = new CommandRelay({
    ...options,
    globalPrefix: `__uiBridgeRedeliver_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
  });
  relays.push(relay);
  return { relay, routes: createNextRouteHandlers(createRelayHandlers(relay), { relay }) };
}

interface Delivered {
  commandId: string;
  action: string;
  redeliveryOf?: string;
}

interface Stream {
  /** Every command delivered down this stream, in order. */
  commands: Delivered[];
  streamId: () => string | undefined;
  /** The consumer cancels: the relay hears the end. */
  cancel: () => Promise<void>;
}

/**
 * Open `GET <base>/commands/stream` for `tabId` and read it as a tab does.
 * `onCommand` sees each command with this stream's id; it never answers
 * unless it chooses to. The stream is never cancelled: a consumer that
 * vanished says nothing.
 */
async function openStream(
  routes: Routes,
  tabId: string,
  options: {
    caps?: string;
    cid?: string;
    caller?: string;
    onCommand?: (command: Delivered, streamId: string | undefined) => void;
  } = {}
): Promise<Stream> {
  const query = new URLSearchParams({ tabId });
  if (options.caps !== undefined) query.set('caps', options.caps);
  if (options.cid !== undefined) query.set('cid', options.cid);
  const url = `http://app.test${BASE}/commands/stream?${query.toString()}`;
  const nextUrl = new URL(url);
  const headers: Record<string, string> = options.caller
    ? { 'X-Caller-User-Id': options.caller }
    : {};
  const request = Object.assign(new Request(url, { method: 'GET', headers }), { nextUrl });
  const response = await routes.GET(
    request as never,
    { params: { path: ['commands', 'stream'] } } as never
  );
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const commands: Delivered[] = [];
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
          const dataLine = buffer
            .slice(0, at)
            .split('\n')
            .find((line) => line.startsWith('data: '));
          buffer = buffer.slice(at + 2);
          if (!dataLine) continue;
          const data = JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>;
          if (data.type === 'connected') streamId = data.streamId as string;
          if (typeof data.commandId === 'string' && typeof data.action === 'string') {
            const command: Delivered = {
              commandId: data.commandId,
              action: data.action,
              ...(typeof data.redeliveryOf === 'string' ? { redeliveryOf: data.redeliveryOf } : {}),
            };
            commands.push(command);
            options.onCommand?.(command, streamId);
          }
        }
      }
    } catch {
      /* ended */
    }
  })();
  await vi.advanceTimersByTimeAsync(0);
  return {
    commands,
    streamId: () => streamId,
    cancel: async () => {
      await reader.cancel();
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

function track<T>(promise: Promise<T>): { settled: boolean; value?: T; error?: unknown } {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error })
  );
  return state;
}

const CAPS = 'rotate,dedupe';

/** A tab with a first stream that took one command and was never heard from again, and the command's outcome. */
async function strandedCommand(
  relay: CommandRelay,
  routes: Routes,
  caller?: string
): Promise<{ first: Stream; outcome: ReturnType<typeof track>; originalId: string }> {
  const first = await openStream(routes, 'tab-a', {
    caps: CAPS,
    cid: 'page-1',
    ...(caller ? { caller } : {}),
  });
  const outcome = track(
    relay.queueCommand('getTabInfo', {}, {
      targetTabId: 'tab-a',
      ...(caller ? { senderUserId: caller } : {}),
    } as never)
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(first.commands.map((c) => c.action)).toEqual(['getTabInfo']);
  return { first, outcome, originalId: first.commands[0].commandId };
}

describe('relay redelivery · a pending command goes down the same page instance’s replacement stream', () => {
  it('1 · a command sent into a stream whose consumer vanished is redelivered to the same cid’s replacement and settled by the alias’s result', async () => {
    const { relay, routes } = rig();
    const { outcome, originalId } = await strandedCommand(relay, routes);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(outcome.settled).toBe(false);

    const second = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1' });

    expect(second.commands).toHaveLength(1);
    const [alias] = second.commands;
    expect(alias.action).toBe('getTabInfo');
    expect(alias.commandId).not.toBe(originalId);
    expect(alias.redeliveryOf).toBe(originalId);

    const accepted = relay.resolveCommand(alias.commandId, { title: 'from the alias' }, 'tab-a', {
      streamId: second.streamId(),
    });
    expect(accepted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toEqual({ settled: true, value: { title: 'from the alias' } });
  });

  it('2 · a different cid (a reloaded page) gets no redelivery, and the command times out as today', async () => {
    const { relay, routes } = rig();
    const { outcome } = await strandedCommand(relay, routes);
    await vi.advanceTimersByTimeAsync(1_000);

    const second = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-2' });

    expect(second.commands).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outcome.settled).toBe(true);
    expect(String((outcome.error as Error).message)).toContain('timed out');
  });

  it('3 · a client that does not declare dedupe gets no redelivery', async () => {
    const { relay, routes } = rig();
    const { outcome } = await strandedCommand(relay, routes);

    const second = await openStream(routes, 'tab-a', { caps: 'rotate', cid: 'page-1' });

    expect(second.commands).toEqual([]);
    expect(outcome.settled).toBe(false);
  });

  it('3 · a replacement naming no cid gets no redelivery', async () => {
    const { relay, routes } = rig();
    await strandedCommand(relay, routes);

    const second = await openStream(routes, 'tab-a', { caps: CAPS });

    expect(second.commands).toEqual([]);
  });

  it('4 · the original id’s result arriving after the alias’s finds no pending command, and the caller resolved once', async () => {
    const { relay, routes } = rig();
    const { first, outcome, originalId } = await strandedCommand(relay, routes);
    const second = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1' });
    const [alias] = second.commands;
    relay.resolveCommand(alias.commandId, { run: 'alias' }, 'tab-a', {
      streamId: second.streamId(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toEqual({ settled: true, value: { run: 'alias' } });

    const late = relay.resolveCommand(originalId, { run: 'original' }, 'tab-a', {
      streamId: first.streamId(),
    });

    expect(late).toBe(false);
    expect(relay.getTransportDiagnostics().pendingCommandCount).toBe(0);
    expect(outcome.value).toEqual({ run: 'alias' });
  });

  it('4 · the timeout of the shared promise drops the alias too', async () => {
    const { relay, routes } = rig();
    const { outcome } = await strandedCommand(relay, routes);
    await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1' });
    expect(relay.getTransportDiagnostics().pendingCommandCount).toBe(2);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(outcome.settled).toBe(true);
    expect(relay.getTransportDiagnostics().pendingCommandCount).toBe(0);
  });

  it('5 · the alias’s result presenting the OLD stream id is refused STREAM_MISMATCH and the binding is unchanged', async () => {
    const { relay, routes } = rig();
    const { first, outcome } = await strandedCommand(relay, routes);
    const second = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1' });
    const [alias] = second.commands;

    expect(
      relay.commandResponseRefusal(alias.commandId, 'tab-a', { streamId: first.streamId() })
    ).toBe('STREAM_MISMATCH');
    expect(
      relay.resolveCommand(alias.commandId, { forged: true }, 'tab-a', {
        streamId: first.streamId(),
      })
    ).toBe(false);
    expect(outcome.settled).toBe(false);

    expect(
      relay.resolveCommand(alias.commandId, { ok: true }, 'tab-a', { streamId: second.streamId() })
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toEqual({ settled: true, value: { ok: true } });
  });

  it('5 · the original id is still answered only from the stream it went down', async () => {
    const { relay, routes } = rig();
    const { originalId, outcome } = await strandedCommand(relay, routes);
    const second = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1' });

    expect(relay.commandResponseRefusal(originalId, 'tab-a', { streamId: second.streamId() })).toBe(
      'STREAM_MISMATCH'
    );
    expect(outcome.settled).toBe(false);
  });

  it('6 · a write whose first result was lost and which is redelivered runs once: the page answers the alias from the first run', async () => {
    const { relay, routes } = rig();
    const dedupe = createCommandDedupe<unknown>();
    let executions = 0;
    const page = (command: Delivered, streamId: string | undefined): void => {
      const outcomeOf = dedupe.outcomeOf(dedupeKeyOf(command), async () => {
        executions++;
        return { clicked: true };
      });
      void outcomeOf?.then((result) => {
        // The first stream's POST is lost: the consumer behind it is gone.
        if (command.redeliveryOf === undefined) return;
        relay.resolveCommand(command.commandId, result, 'tab-a', { streamId });
      });
    };
    const first = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1', onCommand: page });
    const outcome = track(
      relay.queueCommand('clickElement', { id: 'save' }, { targetTabId: 'tab-a' })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(first.commands).toHaveLength(1);
    expect(executions).toBe(1);
    expect(outcome.settled).toBe(false);

    await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1', onCommand: page });
    await vi.advanceTimersByTimeAsync(0);

    expect(executions).toBe(1);
    expect(outcome).toEqual({ settled: true, value: { clicked: true } });
  });

  it('a command pinned to another tab, and a fire-and-forget one, are not redelivered', async () => {
    const { relay, routes } = rig();
    await openStream(routes, 'tab-b', { caps: CAPS, cid: 'page-b' });
    const first = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1' });
    const toB = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-b' }));
    const nav = track(relay.queueCommand('pageNavigate', { url: '/x' }, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(first.commands.map((c) => c.action)).toEqual(['pageNavigate']);
    expect(nav.settled).toBe(true);

    const second = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1' });

    expect(second.commands).toEqual([]);
    expect(toB.settled).toBe(false);
  });

  it('a stream another user opens for the tab after its lease close is sent nothing (the tombstone names no user)', async () => {
    const { relay, routes } = rig({ sseTimeoutMs: 120_000, streamLeaseMs: 5_000 });
    const { first, outcome } = await strandedCommand(relay, routes, 'user-a');
    await first.cancel();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(relay.getTransportDiagnostics().parkedTabs).toEqual([]);
    expect(relay.getTransportDiagnostics().connectedTabs).toEqual([]);

    const second = await openStream(routes, 'tab-a', {
      caps: CAPS,
      cid: 'page-1',
      caller: 'user-b',
    });

    expect(second.streamId()).toBeDefined();
    expect(second.commands).toEqual([]);
    expect(outcome.settled).toBe(false);
  });

  it('the same user’s stream after a lease close is redelivered the command', async () => {
    const { relay, routes } = rig({ sseTimeoutMs: 120_000, streamLeaseMs: 5_000 });
    const { first, outcome, originalId } = await strandedCommand(relay, routes, 'user-a');
    await first.cancel();
    await vi.advanceTimersByTimeAsync(6_000);

    const second = await openStream(routes, 'tab-a', {
      caps: CAPS,
      cid: 'page-1',
      caller: 'user-a',
    });

    expect(second.commands.map((c) => c.redeliveryOf)).toEqual([originalId]);
    expect(outcome.settled).toBe(false);
  });

  it('a command the relay sent over a WebSocket is not redelivered over SSE', async () => {
    const { relay, routes } = rig();
    const first = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1' });
    relay.registerWebSocketClient({
      clientId: 'tab-a',
      send: () => {},
      isConnected: () => true,
      close: () => {},
    });
    const outcome = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(first.commands).toEqual([]);

    const second = await openStream(routes, 'tab-a', { caps: CAPS, cid: 'page-1' });

    expect(second.commands).toEqual([]);
    expect(outcome.settled).toBe(false);
  });
});
