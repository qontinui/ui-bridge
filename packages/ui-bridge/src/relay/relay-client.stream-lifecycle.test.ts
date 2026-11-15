/**
 * The relay client's stream lifecycle — plan
 * `2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost`,
 * Phase 4 (D4).
 *
 * Measured 2026-11-09 (coord finding 8e6b94f2): a command sent while a tab's
 * command stream was reopening was lost. The client waited 10 s after EVERY
 * stream end, longer than the relay's 8 s answer timeout, so a command sent
 * into that gap could not be saved whatever the relay did. Now:
 *
 *   - every stream GET declares `caps=rotate,dedupe` and the page instance's
 *     `cid`, so a relay that knows them can rotate the stream and redeliver
 *     into its replacement, and one that does not ignores them;
 *   - a stream that received `connected` and lived 10 s reopens at once
 *     (0-250 ms jitter), while a fast failure keeps the 10 s delay;
 *   - a `rotate` frame opens the next stream WITHOUT aborting the current one.
 *     The old stream is read to EOF, and a command read off it is answered
 *     with ITS stream id, never the replacement's. A rotation waits until the
 *     current stream has been connected 10 s, at most one replaced stream is
 *     read at a time, and that one is aborted after the frame's grace, once
 *     its replacement has connected;
 *   - every open the client makes on its own comes at least 10 s after the
 *     previous one, so a relay that ends or rotates streams early gets at
 *     most 6 opens per tab per minute;
 *   - a replacement that fails before `connected` hands the tab back to the
 *     stream it was replacing;
 *   - one page instance executes one dedupe key (`redeliveryOf ?? commandId`)
 *     once, and answers EVERY delivery of it, under the delivery's own id and
 *     stream, with that one execution's result.
 *
 * A stub `fetch` serves scripted streams under fake timers. Each stream
 * honours its request's AbortSignal the way a real fetch body does (an abort
 * errors the body), so a test can tell an aborted stream from an open one.
 * Every timing below is a literal, never the module's own constant, so a
 * changed cadence fails here instead of moving the expectation with it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startRelayClient, type RelayClientHandle } from './relay-client';
import { createCommandDedupe, type CommandDedupe } from './command-dedupe';

// The real command memory, recorded, so a test can reach the one a client made.
vi.mock('./command-dedupe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./command-dedupe')>();
  return { ...actual, createCommandDedupe: vi.fn(actual.createCommandDedupe) };
});

/** The command memory the most recently started client made. */
function lastCommandMemory(): CommandDedupe<unknown> {
  return vi.mocked(createCommandDedupe).mock.results.at(-1)?.value as CommandDedupe<unknown>;
}

/** The real macrotask queue, captured before any test installs fake timers. */
const realSetImmediate = globalThis.setImmediate;

/** Let every promise chain the client started run to rest. No fake time passes. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => realSetImmediate(() => resolve()));
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const encoder = new TextEncoder();

/** One `GET /commands/stream` the client made, as the stub relay served it. */
interface ServedStream {
  readonly url: string;
  /** The fake-clock time the client opened it. */
  readonly openedAt: number;
  /** Whether the client aborted the request. */
  readonly aborted: boolean;
  /** Whether it is still open: not ended by the relay, aborted or cancelled. */
  readonly open: boolean;
  /** Write one SSE frame down the stream; a no-op once the stream has ended. */
  push(frame: string): void;
  /** End the stream from the relay's side: the client reads EOF. */
  close(): void;
  /** Break the stream from the relay's side: the client's read rejects. */
  fail(): void;
}

/** A command result the client posted back, and the relay received. */
interface PostedResult {
  commandId: string;
  success: boolean;
  streamId?: string;
  result?: { run?: number };
}

interface StubRelay {
  readonly streams: ServedStream[];
  readonly results: PostedResult[];
  /**
   * The HTTP status of each successive stream GET; `0` drops the request (a
   * network error). Once empty, every GET answers 200.
   */
  readonly statuses: number[];
  /** How many of the next result POSTs are dropped (a network error). */
  failResultPosts: number;
  /** Whether a 200 stream sends `connected` (streamId `s<n>`) as it opens. */
  autoConnect: boolean;
  /** Scripts each 200 stream as it opens, after its `connected`. */
  onOpen?: (stream: ServedStream) => void;
}

function serveStream(
  relay: StubRelay,
  url: string,
  signal: AbortSignal | null | undefined
): Promise<Response> {
  const status = relay.statuses.shift() ?? 200;
  let live = status === 200;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      live = false;
    },
  });
  const stream: ServedStream = {
    url,
    openedAt: Date.now(),
    get aborted() {
      return signal?.aborted === true;
    },
    get open() {
      return live;
    },
    push(frame) {
      if (live) controller?.enqueue(encoder.encode(frame));
    },
    close() {
      if (!live) return;
      live = false;
      controller?.close();
    },
    fail() {
      if (!live) return;
      live = false;
      controller?.error(new TypeError('network error'));
    },
  };
  signal?.addEventListener('abort', () => {
    if (!live) return;
    live = false;
    controller?.error(new DOMException('The operation was aborted.', 'AbortError'));
  });
  relay.streams.push(stream);
  if (status === 0) return Promise.reject(new TypeError('network error'));
  if (status !== 200)
    return Promise.resolve({ ok: false, status, body: null } as unknown as Response);
  if (relay.autoConnect) stream.push(connected(`s${relay.streams.length}`));
  relay.onOpen?.(stream);
  return Promise.resolve({ ok: true, status, body } as unknown as Response);
}

function stubRelay(): StubRelay {
  const relay: StubRelay = {
    streams: [],
    results: [],
    statuses: [],
    failResultPosts: 0,
    autoConnect: true,
  };
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/commands/stream')) return serveStream(relay, url, init?.signal);
    if (url.endsWith('/commands') && init?.method === 'POST') {
      if (relay.failResultPosts > 0) {
        relay.failResultPosts--;
        return Promise.reject(new TypeError('network error'));
      }
      relay.results.push(JSON.parse(String(init.body)) as PostedResult);
    }
    const payload = url.endsWith('/heartbeat') ? { tabRegistered: true } : {};
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    } as unknown as Response);
  });
  return relay;
}

function sse(data: Record<string, unknown>, event?: string): string {
  return `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

function connected(streamId: string): string {
  return sse({ type: 'connected', buildId: 'build-1', streamId, timestamp: Date.now() });
}

/** A rotate frame naming `graceMs`, or naming no grace at all when it is null. */
function rotate(streamId: string, graceMs: number | null = 10_000): string {
  return sse(
    graceMs === null ? { type: 'rotate', streamId } : { type: 'rotate', streamId, graceMs },
    'rotate'
  );
}

function end(reason: string): string {
  return sse({ type: 'end', reason }, 'end');
}

/** A command frame. `payload.tag` names the delivery, so `execute` can record which ran. */
function command(commandId: string, extra: Record<string, unknown> = {}): string {
  return sse({
    commandId,
    action: 'getControlSnapshot',
    payload: { tag: commandId },
    timestamp: Date.now(),
    ...extra,
  });
}

let relay: StubRelay;
let executed: string[];
let clients: RelayClientHandle[];

/** Every execution is recorded by tag, and its result names its run number. */
async function recordExecution(_action: string, payload: unknown): Promise<unknown> {
  executed.push((payload as { tag: string }).tag);
  return { success: true, run: executed.length };
}

function boot(
  execute: (action: string, payload: unknown) => Promise<unknown> = recordExecution
): RelayClientHandle {
  const client = startRelayClient({
    basePath: '/api/ui-bridge',
    tabId: 'tab-1',
    heartbeatIntervalMs: 10_000,
    onError: () => {},
    execute,
  });
  clients.push(client);
  return client;
}

/** Each posted answer as `[commandId, streamId, run]`. */
function answers(): Array<[string, string | undefined, number | undefined]> {
  return relay.results.map((r) => [r.commandId, r.streamId, r.result?.run]);
}

function streamParams(stream: ServedStream): URLSearchParams {
  return new URL(stream.url, 'https://relay.example').searchParams;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  relay = stubRelay();
  executed = [];
  clients = [];
});

afterEach(() => {
  for (const client of clients) client.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('relay client · stream lifecycle (D4)', () => {
  describe('1 · a healthy stream that ends is reopened at once', () => {
    it.each([
      ['EOF', (s: ServedStream) => s.close()],
      ['an end frame', (s: ServedStream) => s.push(end('lease'))],
      ['a network error', (s: ServedStream) => s.fail()],
    ])(
      'a stream that lived 60 s and ends by %s → the next GET within 250 ms',
      async (_how, finish) => {
        // The top of the jitter range: the latest a healthy reopen may come.
        vi.spyOn(Math, 'random').mockReturnValue(0.999999);
        boot();
        await settle();
        await vi.advanceTimersByTimeAsync(60_000);
        const endedAt = Date.now();
        finish(relay.streams[0]);
        await settle();
        await vi.advanceTimersByTimeAsync(250);

        expect(relay.streams).toHaveLength(2);
        expect(relay.streams[1].openedAt - endedAt).toBeLessThanOrEqual(250);
      }
    );
  });

  it('2 · a non-ok answer → the next GET after 10 000 ms (control)', async () => {
    relay.statuses.push(503);
    boot();
    await settle();
    expect(relay.streams).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(relay.streams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.streams).toHaveLength(2);
    expect(relay.streams[1].openedAt - relay.streams[0].openedAt).toBe(10_000);
  });

  describe('3 · a stream that ends before it is healthy keeps the 10 000 ms delay', () => {
    it('a stream ending 3 s after connected → the next GET after 10 000 ms', async () => {
      boot();
      await settle();
      await vi.advanceTimersByTimeAsync(3_000);
      const endedAt = Date.now();
      relay.streams[0].close();
      await settle();

      await vi.advanceTimersByTimeAsync(9_999);
      expect(relay.streams).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.streams).toHaveLength(2);
      expect(relay.streams[1].openedAt - endedAt).toBe(10_000);
    });

    it('a stream that lived 60 s but never received connected → 10 000 ms', async () => {
      relay.autoConnect = false;
      boot();
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);
      const endedAt = Date.now();
      relay.streams[0].close();
      await settle();

      await vi.advanceTimersByTimeAsync(9_999);
      expect(relay.streams).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.streams).toHaveLength(2);
      expect(relay.streams[1].openedAt - endedAt).toBe(10_000);
    });
  });

  it('4 · a rotate frame opens the next stream while the first is still read; the first answers under its own id; its EOF opens nothing', async () => {
    const client = boot();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    relay.streams[0].push(rotate('s1'));
    await settle();

    // Make-before-break: the second stream is open and connected, the first
    // is still open, and the client-level id follows the second.
    expect(relay.streams).toHaveLength(2);
    expect(relay.streams[0].aborted).toBe(false);
    expect(client.streamId).toBe('s2');

    // Read off the FIRST stream after the second's `connected`.
    relay.streams[0].push(command('c-old'));
    relay.streams[1].push(command('c-new'));
    await settle();
    expect([...executed].sort()).toEqual(['c-new', 'c-old']);
    expect(relay.results.filter((r) => r.commandId === 'c-old').map((r) => r.streamId)).toEqual([
      's1',
    ]);
    expect(relay.results.filter((r) => r.commandId === 'c-new').map((r) => r.streamId)).toEqual([
      's2',
    ]);

    // The relay ends the replaced stream; that EOF opens nothing.
    relay.streams[0].push(end('replaced'));
    relay.streams[0].close();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(relay.streams).toHaveLength(2);
    expect(relay.streams[1].aborted).toBe(false);
    expect(client.streamId).toBe('s2');
  });

  describe('5 · the same command id twice is executed once and answered per delivery', () => {
    it('twice down one stream', async () => {
      boot();
      await settle();
      relay.streams[0].push(command('c1'));
      relay.streams[0].push(command('c1'));
      await settle();

      expect(executed).toEqual(['c1']);
      expect(answers()).toEqual([
        ['c1', 's1', 1],
        ['c1', 's1', 1],
      ]);
    });

    it('once down a rotated stream and again down its replacement, each answered on its own stream', async () => {
      boot();
      await settle();
      await vi.advanceTimersByTimeAsync(10_000);
      relay.streams[0].push(rotate('s1'));
      await settle();
      relay.streams[0].push(command('c1'));
      await settle();
      relay.streams[1].push(command('c1'));
      await settle();

      expect(executed).toEqual(['c1']);
      expect(answers()).toEqual([
        ['c1', 's1', 1],
        ['c1', 's2', 1],
      ]);
    });
  });

  describe('6 · a redelivered alias (redeliveryOf) runs nothing again and is answered with the first execution', () => {
    it('an alias of an executed command → not executed, answered under its own id', async () => {
      boot();
      await settle();
      relay.streams[0].push(command('c1'));
      await settle();
      relay.streams[0].push(command('a1', { redeliveryOf: 'c1' }));
      await settle();

      expect(executed).toEqual(['c1']);
      expect(answers()).toEqual([
        ['c1', 's1', 1],
        ['a1', 's1', 1],
      ]);
    });

    it('the alias first → it runs; the original is then answered with its result, on its own stream', async () => {
      boot();
      await settle();
      await vi.advanceTimersByTimeAsync(10_000);
      relay.streams[0].push(rotate('s1'));
      await settle();
      relay.streams[1].push(command('a1', { redeliveryOf: 'c1' }));
      await settle();
      relay.streams[0].push(command('c1'));
      await settle();

      expect(executed).toEqual(['a1']);
      expect(answers()).toEqual([
        ['a1', 's2', 1],
        ['c1', 's1', 1],
      ]);
    });

    it("the first answer's POST is lost → the alias is still answered, with that execution's result", async () => {
      boot();
      await settle();
      relay.failResultPosts = 1;
      relay.streams[0].push(command('c1'));
      await settle();
      expect(executed).toEqual(['c1']);
      expect(relay.results).toEqual([]);

      relay.streams[0].push(command('a1', { redeliveryOf: 'c1' }));
      await settle();
      expect(executed).toEqual(['c1']);
      expect(answers()).toEqual([['a1', 's1', 1]]);
    });

    it('an alias delivered while the first execution still runs → answered when it settles', async () => {
      let release: () => void = () => {};
      const running = new Promise<void>((resolve) => {
        release = resolve;
      });
      boot(async (action, payload) => {
        await running;
        return recordExecution(action, payload);
      });
      await settle();
      relay.streams[0].push(command('c1'));
      await settle();
      relay.streams[0].push(command('a1', { redeliveryOf: 'c1' }));
      await settle();
      expect(relay.results).toEqual([]);

      release();
      await settle();
      expect(executed).toEqual(['c1']);
      expect(answers()).toEqual([
        ['c1', 's1', 1],
        ['a1', 's1', 1],
      ]);
    });
  });

  it('7 · every stream GET carries caps=rotate,dedupe and a cid stable across reopens, fresh across startRelayClient calls', async () => {
    const first = boot();
    await settle();
    const cid = streamParams(relay.streams[0]).get('cid');
    expect(cid).toMatch(UUID);
    expect(relay.streams[0].url).toBe(
      `/api/ui-bridge/commands/stream?tabId=tab-1&caps=rotate,dedupe&cid=${cid}`
    );

    // Reopen 1: a healthy stream ends. Reopen 2: a forced reconnect.
    await vi.advanceTimersByTimeAsync(60_000);
    relay.streams[0].close();
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    first.forceReconnect();
    await settle();
    expect(relay.streams).toHaveLength(3);
    for (const stream of relay.streams) {
      expect(stream.url).toBe(
        `/api/ui-bridge/commands/stream?tabId=tab-1&caps=rotate,dedupe&cid=${cid}`
      );
    }

    first.stop();
    boot();
    await settle();
    expect(relay.streams).toHaveLength(4);
    const fresh = streamParams(relay.streams[3]);
    expect(fresh.get('caps')).toBe('rotate,dedupe');
    expect(fresh.get('cid')).toMatch(UUID);
    expect(fresh.get('cid')).not.toBe(cid);
  });

  describe('8 · the opens the client makes on its own are capped at 6 per minute', () => {
    // The plan's case is streams ending at 10 s; the shorter lifetimes are the
    // ones a client without the healthy floor would reopen faster than 6/min.
    it.each([1_000, 5_000, 9_999, 10_000])(
      'streams each ending %i ms after connected → at most 6 opens in 60 s',
      async (lifetime) => {
        // No jitter: the most opens a client can make.
        vi.spyOn(Math, 'random').mockReturnValue(0);
        relay.onOpen = (stream) => {
          setTimeout(() => stream.close(), lifetime);
        };
        const t0 = Date.now();
        boot();
        await vi.advanceTimersByTimeAsync(60_000);

        const opens = relay.streams.filter((s) => s.openedAt - t0 < 60_000);
        expect(opens.length).toBeGreaterThan(0);
        expect(opens.length).toBeLessThanOrEqual(6);
      }
    );

    it('a relay that rotates every stream 1 s after connected, and ends none → at most 6 opens in 60 s, never more than 2 open', async () => {
      relay.onOpen = (stream) => {
        setTimeout(() => stream.push(rotate('s-any')), 1_000);
      };
      const t0 = Date.now();
      boot();
      for (let elapsed = 0; elapsed < 60_000; elapsed += 1_000) {
        await vi.advanceTimersByTimeAsync(1_000);
        expect(relay.streams.filter((s) => s.open).length).toBeLessThanOrEqual(2);
      }

      const opens = relay.streams.filter((s) => s.openedAt - t0 < 60_000);
      expect(opens.length).toBeGreaterThan(1);
      expect(opens.length).toBeLessThanOrEqual(6);
    });
  });

  describe('9 · stopping or forcing a reconnect mid-rotation', () => {
    it('stop() aborts both streams and executes nothing afterwards', async () => {
      const client = boot();
      await settle();
      await vi.advanceTimersByTimeAsync(10_000);
      relay.streams[0].push(rotate('s1'));
      await settle();
      expect(relay.streams).toHaveLength(2);

      // Commands already on the wire as the page stops: read, never run.
      relay.streams[0].push(command('late-1'));
      relay.streams[1].push(command('late-2'));
      client.stop();
      await settle();

      expect(relay.streams[0].aborted).toBe(true);
      expect(relay.streams[1].aborted).toBe(true);
      expect(executed).toEqual([]);
      expect(relay.results).toEqual([]);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(relay.streams).toHaveLength(2);
      expect(executed).toEqual([]);
    });

    it('forceReconnect aborts both streams and opens exactly one new stream', async () => {
      const client = boot();
      await settle();
      await vi.advanceTimersByTimeAsync(10_000);
      relay.streams[0].push(rotate('s1'));
      await settle();
      client.forceReconnect();
      await settle();

      expect(relay.streams).toHaveLength(3);
      expect(relay.streams[0].aborted).toBe(true);
      expect(relay.streams[1].aborted).toBe(true);
      expect(relay.streams[2].aborted).toBe(false);
      expect(client.streamId).toBe('s3');

      await vi.advanceTimersByTimeAsync(60_000);
      expect(relay.streams).toHaveLength(3);
    });

    it('a command whose run ends after stop() posts no result', async () => {
      let release: () => void = () => {};
      const running = new Promise<void>((resolve) => {
        release = resolve;
      });
      const client = boot(async (action, payload) => {
        await running;
        return recordExecution(action, payload);
      });
      await settle();
      relay.streams[0].push(command('c1'));
      await settle();
      client.stop();
      release();
      await settle();

      expect(executed).toEqual(['c1']);
      expect(relay.results).toEqual([]);
    });
  });

  it('10 · a second rotation aborts the stream still draining from the first', async () => {
    boot();
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    relay.streams[0].push(rotate('s1', 60_000));
    await settle();
    expect(relay.streams).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(10_000);
    relay.streams[1].push(rotate('s2', 60_000));
    await settle();
    expect(relay.streams).toHaveLength(3);
    expect(relay.streams[0].aborted).toBe(true);
    expect(relay.streams[1].aborted).toBe(false);
    expect(relay.streams[2].aborted).toBe(false);
  });

  it.each([
    ["the frame's graceMs (4 000 ms)", 4_000, 4_000],
    ['15 000 ms when the frame names no grace', null, 15_000],
  ])(
    '11 · a draining stream its relay never ends is aborted after %s',
    async (_label, graceMs, deadline) => {
      boot();
      await settle();
      await vi.advanceTimersByTimeAsync(10_000);
      relay.streams[0].push(rotate('s1', graceMs));
      await settle();
      expect(relay.streams).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(relay.streams[0].aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.streams[0].aborted).toBe(true);
      expect(relay.streams[1].aborted).toBe(false);

      // Ending a replaced stream opens nothing.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(relay.streams).toHaveLength(2);
    }
  );

  it('11 · the drain deadline is counted from the rotate frame, so waiting to rotate uses it up', async () => {
    boot();
    await settle();
    const connectedAt = Date.now();
    await vi.advanceTimersByTimeAsync(1_000);
    relay.streams[0].push(rotate('s1', 15_000));
    await settle();
    // The rotation waits until the stream has been connected 10 000 ms...
    await vi.advanceTimersByTimeAsync(9_000);
    expect(relay.streams).toHaveLength(2);

    // ...and the 15 000 ms of grace ran from the frame, 1 000 ms after connected.
    await vi.advanceTimersByTimeAsync(5_999);
    expect(relay.streams[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.streams[0].aborted).toBe(true);
    expect(Date.now() - connectedAt).toBe(16_000);
  });

  it('11 · a rotate frame cannot keep its stream draining for more than 60 000 ms', async () => {
    boot();
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    relay.streams[0].push(rotate('s1', 120_000));
    await settle();
    expect(relay.streams).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(relay.streams[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.streams[0].aborted).toBe(true);
  });

  it.each([0, 1_000])(
    '12 · a rotate frame %i ms after connected waits until the stream has been connected 10 000 ms',
    async (after) => {
      boot();
      await settle();
      const connectedAt = Date.now();
      await vi.advanceTimersByTimeAsync(after);
      relay.streams[0].push(rotate('s1', 30_000));
      await settle();
      expect(relay.streams).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(10_000 - after - 1);
      expect(relay.streams).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.streams).toHaveLength(2);
      expect(relay.streams[1].openedAt - connectedAt).toBe(10_000);
      expect(relay.streams[0].aborted).toBe(false);
    }
  );

  it('12 · a rotate frame that arrives before connected waits until 10 000 ms after connected', async () => {
    relay.autoConnect = false;
    boot();
    await settle();
    // The relay asks for a rotation before it has announced the stream.
    relay.streams[0].push(rotate('s1', 30_000));
    await settle();
    await vi.advanceTimersByTimeAsync(4_000);
    relay.streams[0].push(connected('s1'));
    await settle();
    const connectedAt = Date.now();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(relay.streams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.streams).toHaveLength(2);
    expect(relay.streams[1].openedAt - connectedAt).toBe(10_000);
    expect(relay.streams[0].aborted).toBe(false);
  });

  describe('13 · a replacement that fails before connected hands the tab back to the draining stream', () => {
    it.each([
      ['answers 503', 503],
      ['drops the request', 0],
    ])('the replacement %s → the old stream is current again', async (_how, status) => {
      vi.spyOn(Math, 'random').mockReturnValue(0.999999);
      const client = boot();
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);
      relay.statuses.push(status);
      relay.streams[0].push(rotate('s1'));
      await settle();

      expect(relay.streams).toHaveLength(2);
      expect(client.streamId).toBe('s1');
      // No draining deadline and no reconnect: it is the current stream again.
      await vi.advanceTimersByTimeAsync(15_000);
      expect(relay.streams[0].aborted).toBe(false);
      expect(relay.streams).toHaveLength(2);

      // When its relay ends it, the tab reopens at once, not 10 s later.
      const endedAt = Date.now();
      relay.streams[0].close();
      await settle();
      await vi.advanceTimersByTimeAsync(250);
      expect(relay.streams).toHaveLength(3);
      expect(relay.streams[2].openedAt - endedAt).toBeLessThanOrEqual(250);
    });

    it("a replacement opened after the old stream's grace ran out still holds the old stream: its failure hands the tab back, with no 10 s gap", async () => {
      relay.autoConnect = false;
      const client = boot();
      await settle();
      relay.streams[0].push(rotate('s1', 4_000));
      await settle();
      // `connected` comes 6 000 ms after the rotate frame, past its 4 000 ms grace.
      await vi.advanceTimersByTimeAsync(6_000);
      relay.streams[0].push(connected('s1'));
      await settle();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(relay.streams).toHaveLength(2);

      // Make-before-break: the replacement has not connected, so the old
      // stream is held although its grace is spent.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(relay.streams[0].aborted).toBe(false);
      relay.streams[1].fail();
      await settle();
      expect(client.streamId).toBe('s1');
      expect(relay.streams[0].aborted).toBe(false);

      // The old stream carries commands meanwhile, and no 10 s reconnect waits.
      relay.streams[0].push(command('c1'));
      await settle();
      expect(answers()).toEqual([['c1', 's1', 1]]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(relay.streams).toHaveLength(2);
    });

    it('a held stream whose grace ran out is ended as soon as its replacement connects', async () => {
      relay.autoConnect = false;
      const client = boot();
      await settle();
      relay.streams[0].push(rotate('s1', 4_000));
      await settle();
      await vi.advanceTimersByTimeAsync(6_000);
      relay.streams[0].push(connected('s1'));
      await settle();
      await vi.advanceTimersByTimeAsync(11_000);
      expect(relay.streams).toHaveLength(2);
      expect(relay.streams[0].aborted).toBe(false);

      relay.streams[1].push(connected('s2'));
      await settle();
      expect(client.streamId).toBe('s2');
      expect(relay.streams[0].aborted).toBe(true);
      expect(relay.streams[1].aborted).toBe(false);
    });

    it('a spent grace is recorded by its deadline: a wall clock that steps back before the replacement connects still ends the held stream', async () => {
      relay.autoConnect = false;
      boot();
      await settle();
      relay.streams[0].push(rotate('s1', 4_000));
      await settle();
      await vi.advanceTimersByTimeAsync(6_000);
      relay.streams[0].push(connected('s1'));
      await settle();
      // The replacement opens, and the deadline fires and declines: the grace
      // is spent, but the replacement has not connected.
      await vi.advanceTimersByTimeAsync(11_000);
      expect(relay.streams).toHaveLength(2);
      expect(relay.streams[0].aborted).toBe(false);

      // The wall clock steps back to before the grace ran out.
      vi.setSystemTime(Date.now() - 20_000);
      relay.streams[1].push(connected('s2'));
      await settle();
      expect(relay.streams[0].aborted).toBe(true);
      expect(relay.streams[1].aborted).toBe(false);
    });

    it('the stream handed back can be rotated again, no sooner than 10 000 ms after the failed replacement opened', async () => {
      boot();
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);
      relay.statuses.push(503);
      relay.streams[0].push(rotate('s1'));
      await settle();
      const replacementOpenedAt = relay.streams[1].openedAt;

      // A grace that outlasts the 10 000 ms wait, so the old stream still
      // drains once the new replacement has connected.
      relay.streams[0].push(rotate('s1', 30_000));
      await settle();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(relay.streams).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.streams).toHaveLength(3);
      expect(relay.streams[2].openedAt - replacementOpenedAt).toBe(10_000);
      expect(relay.streams[0].aborted).toBe(false);
    });

    it('and its reopen still comes no sooner than 10 000 ms after the failed replacement opened', async () => {
      boot();
      await settle();
      await vi.advanceTimersByTimeAsync(60_000);
      relay.statuses.push(503);
      relay.streams[0].push(rotate('s1'));
      await settle();
      const replacementOpenedAt = relay.streams[1].openedAt;

      await vi.advanceTimersByTimeAsync(2_000);
      relay.streams[0].close();
      await settle();
      await vi.advanceTimersByTimeAsync(7_999);
      expect(relay.streams).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.streams).toHaveLength(3);
      expect(relay.streams[2].openedAt - replacementOpenedAt).toBe(10_000);
    });
  });

  it('15 · a young stream its relay asked to rotate and then ended reopens at the open floor, not 10 s after its end', async () => {
    boot();
    await settle();
    const openedAt = relay.streams[0].openedAt;
    await vi.advanceTimersByTimeAsync(2_000);
    relay.streams[0].push(rotate('s1', 4_000));
    await settle();
    // The relay gives up waiting for a replacement and ends the stream 6 s
    // after it connected, before the 10 s a rotation waits for.
    await vi.advanceTimersByTimeAsync(4_000);
    relay.streams[0].close();
    await settle();

    await vi.advanceTimersByTimeAsync(3_999);
    expect(relay.streams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.streams).toHaveLength(2);
    expect(relay.streams[1].openedAt - openedAt).toBe(10_000);
  });

  describe("14 · a command's outcome is kept 60 s after its run settles, to answer a redelivery with", () => {
    it('a duplicate 59 s after the run settled is answered with its outcome', async () => {
      boot();
      await settle();
      relay.streams[0].push(command('c1'));
      await settle();
      await vi.advanceTimersByTimeAsync(59_000);
      relay.streams[0].push(command('a1', { redeliveryOf: 'c1' }));
      await settle();

      expect(executed).toEqual(['c1']);
      expect(answers()).toEqual([
        ['c1', 's1', 1],
        ['a1', 's1', 1],
      ]);
    });

    it('61 s after, the outcome is released: the duplicate is neither run nor answered', async () => {
      boot();
      await settle();
      relay.streams[0].push(command('c1'));
      await settle();
      await vi.advanceTimersByTimeAsync(61_000);
      relay.streams[0].push(command('a1', { redeliveryOf: 'c1' }));
      await settle();

      expect(executed).toEqual(['c1']);
      expect(answers()).toEqual([['c1', 's1', 1]]);
    });

    it('stop() releases every kept outcome, and leaves no timer behind', async () => {
      const client = boot();
      await settle();
      relay.streams[0].push(command('c1'));
      await settle();
      expect(answers()).toEqual([['c1', 's1', 1]]);
      const memory = lastCommandMemory();
      client.stop();

      const run = vi.fn(async () => ({}));
      expect(memory.outcomeOf('c1', run)).toBeNull();
      expect(run).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
