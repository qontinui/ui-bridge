/**
 * The relay owns a command stream's end (plan
 * 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
 * Phase 2, D1 and D2).
 *
 * Measured on the deployed relay (finding 8e6b94f2): a tab whose browser was
 * killed kept its listener for 118 s and eight pings, because the platform sent
 * neither a `request.signal` abort nor a failing enqueue. So the server ends
 * every stream itself:
 *
 * - a client that declared `rotate` is sent a `rotate` frame at the lease and
 *   is closed with an `end` frame once its replacement registers, or as
 *   `rotate_unanswered` `rotateGraceMs` later;
 * - a legacy client is closed once, at the legacy lease, and its listener is
 *   removed at once;
 * - a consumer cancel, a failing enqueue and a consumer that stopped reading
 *   are each an end the relay hears at once;
 * - every end logs exactly one `stream.ended` line.
 *
 * Every stream here is opened through the Next.js route, as a relay tab opens
 * it. Literals throughout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const BASE = '/api/ui-bridge';

/** Every relay a test built; each is destroyed when its test ends. */
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

/** A relay with its own globalThis prefix and no warm-up snapshot, and its routes. */
function rig(options?: Partial<ConstructorParameters<typeof CommandRelay>[0]>): {
  relay: CommandRelay;
  routes: Routes;
} {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeLease_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
    ...(options ?? {}),
  });
  relays.push(relay);
  return { relay, routes: createNextRouteHandlers(createRelayHandlers(relay), { relay }) };
}

/** One SSE frame: its `event:` name, when it has one, and its `data:` payload parsed. */
interface Frame {
  event?: string;
  data: Record<string, unknown> | null;
}

/** A command stream as a relay tab holds one. */
interface Stream {
  status: number;
  /** Every frame received so far. */
  frames: Frame[];
  /** Whether the stream has ended (the reader saw `done`). */
  done: () => boolean;
  /** The `streamId` its `connected` event named. */
  streamId: () => string | undefined;
  /** Read one frame by hand (only for a stream opened with `read: false`). */
  readOne: () => Promise<Frame | null>;
  /** Cancel the stream from the consumer's side. */
  cancel: () => Promise<void>;
  /** Abort the request that opened the stream. */
  abort: () => void;
}

/** Parse one SSE block (`event: x\ndata: {...}`). */
function parseFrame(block: string): Frame {
  let event: string | undefined;
  let data: Record<string, unknown> | null = null;
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice('event: '.length);
    if (line.startsWith('data: ')) {
      data = JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;
    }
  }
  return event === undefined ? { data } : { event, data };
}

/**
 * Open `GET <base>/commands/stream` for `tabId`. `caps` and `cid` go in the
 * query, as a client that declares them sends them. Unless `read` is false, a
 * background reader takes every frame as it arrives, as a live tab does.
 */
async function openStream(
  routes: Routes,
  tabId: string,
  options: { caps?: string; cid?: string; read?: boolean } = {}
): Promise<Stream> {
  const query = new URLSearchParams({ tabId });
  if (options.caps !== undefined) query.set('caps', options.caps);
  if (options.cid !== undefined) query.set('cid', options.cid);
  const url = `http://app.test${BASE}/commands/stream?${query.toString()}`;
  const controller = new AbortController();
  const nextUrl = new URL(url);
  const request = Object.assign(new Request(url, { method: 'GET', signal: controller.signal }), {
    nextUrl,
  });
  const response = await routes.GET(
    request as never,
    {
      params: { path: ['commands', 'stream'] },
    } as never
  );
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let ended = false;
  let buffer = '';
  const pending: Frame[] = [];
  const take = async (): Promise<boolean> => {
    const { value, done } = await reader.read();
    if (done) {
      ended = true;
      return false;
    }
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf('\n\n')) !== -1) {
      const frame = parseFrame(buffer.slice(0, at));
      buffer = buffer.slice(at + 2);
      frames.push(frame);
      pending.push(frame);
    }
    return true;
  };
  if (options.read !== false) {
    void (async () => {
      try {
        while (await take());
      } catch {
        ended = true;
      }
    })();
  }
  await vi.advanceTimersByTimeAsync(0);
  return {
    status: response.status,
    frames,
    done: () => ended,
    streamId: () =>
      frames.find((frame) => frame.data?.type === 'connected')?.data?.streamId as
        | string
        | undefined,
    readOne: async () => {
      if (pending.length === 0) await take();
      return pending.shift() ?? null;
    },
    cancel: async () => {
      await reader.cancel();
      await vi.advanceTimersByTimeAsync(0);
    },
    abort: () => controller.abort(),
  };
}

/** Every `stream.ended` line the relay has logged since this was called. */
function streamEnds(): () => Array<Record<string, unknown>> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return () =>
    log.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.startsWith('[ui-bridge] {'))
      .map((line) => JSON.parse(line.slice('[ui-bridge] '.length)) as Record<string, unknown>)
      .filter((entry) => entry.event === 'stream.ended');
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

/** Make the next `enqueue` on any stream throw, as one on a stream the runtime broke does. */
function failNextEnqueue(): void {
  vi.spyOn(ReadableStreamDefaultController.prototype, 'enqueue').mockImplementationOnce(() => {
    throw new TypeError('Invalid state: Controller is already closed');
  });
}

/**
 * The relay's not-delivered message for a command sent to `tab-a` while its
 * stream, closed at its lease, has not reopened (review A1).
 */
function notDeliveredAtLease(action: string, reason: string): string {
  return (
    `No active UI Bridge SDK client received the ${action} command. ` +
    `Tab "tab-a"'s command stream closed at its lease (${reason}) and has not reopened yet. ` +
    'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.'
  );
}

/** The frames of `stream` whose payload is a `rotate`. */
function rotateFrames(stream: Stream): Frame[] {
  return stream.frames.filter((frame) => frame.data?.type === 'rotate');
}

describe('relay stream lease · a rotate-capable stream rotates make-before-break', () => {
  it('1 · is sent a rotate frame at the lease, and is ended `replaced` when its replacement registers', async () => {
    const ends = streamEnds();
    const { relay, routes } = rig();
    const first = await openStream(routes, 'tab-a', { caps: 'rotate,dedupe', cid: 'page-1' });

    await vi.advanceTimersByTimeAsync(49_999);
    expect(rotateFrames(first)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(rotateFrames(first)).toEqual([
      {
        event: 'rotate',
        data: { type: 'rotate', streamId: first.streamId(), graceMs: 10_000 },
      },
    ]);
    // Make-before-break: the stream stays open while the client opens the next one.
    expect(first.done()).toBe(false);
    expect(ends()).toEqual([]);

    const second = await openStream(routes, 'tab-a', { caps: 'rotate,dedupe', cid: 'page-1' });

    expect(first.frames.at(-1)).toEqual({
      event: 'end',
      data: { type: 'end', reason: 'replaced' },
    });
    expect(first.done()).toBe(true);
    expect(second.done()).toBe(false);
    expect(ends()).toEqual([
      { event: 'stream.ended', id: 'tab-a', reason: 'replaced', age_ms: 50_000 },
    ]);
    expect(relay.getTransportDiagnostics().connectedTabs).toEqual(['tab-a']);
  });

  it('2 · with no replacement it is ended `rotate_unanswered` at the lease plus 10 000 ms; the tab is awaited, not parked, and a command for it is refused at once', async () => {
    const ends = streamEnds();
    const { relay, routes } = rig();
    const first = await openStream(routes, 'tab-a', { caps: 'rotate,dedupe', cid: 'page-1' });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(rotateFrames(first)).toHaveLength(1);
    expect(first.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(first.frames.at(-1)).toEqual({
      event: 'end',
      data: { type: 'end', reason: 'rotate_unanswered' },
    });
    expect(first.done()).toBe(true);
    expect(ends()).toEqual([
      { event: 'stream.ended', id: 'tab-a', reason: 'rotate_unanswered', age_ms: 60_000 },
    ]);
    const diag = relay.getTransportDiagnostics();
    expect({ connectedTabs: diag.connectedTabs, parkedTabs: diag.parkedTabs }).toEqual({
      connectedTabs: [],
      parkedTabs: [],
    });
    const outcome = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect({
      settled: outcome.settled,
      message: (outcome.error as Error | undefined)?.message,
    }).toEqual({ settled: true, message: notDeliveredAtLease('getTabInfo', 'rotate_unanswered') });
  });

  it.each([
    ['no caps at all', undefined, false],
    ['`dedupe` alone', 'dedupe', false],
    ['`rotate` alone', 'rotate', true],
    ['`rotate,dedupe`', 'rotate,dedupe', true],
    ['`dedupe,rotate` with a space and an unknown cap', 'dedupe, rotate,frobnicate', true],
  ])(
    'a stream that declares %s is sent a rotate frame at the lease: %s',
    async (_label, caps, rotates) => {
      const { routes } = rig();
      const stream = await openStream(routes, 'tab-a', caps === undefined ? {} : { caps });

      await vi.advanceTimersByTimeAsync(50_000);

      expect(rotateFrames(stream).length).toBe(rotates ? 1 : 0);
    }
  );
});

describe('relay stream lease · a legacy stream is closed once, at the legacy lease', () => {
  it('3 · is sent no rotate frame and is ended `lease` at the legacy lease', async () => {
    const ends = streamEnds();
    const { routes } = rig();
    const first = await openStream(routes, 'tab-a');

    await vi.advanceTimersByTimeAsync(269_999);
    expect(first.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(
      first.frames.some((frame) => frame.event === 'rotate' || frame.data?.type === 'rotate')
    ).toBe(false);
    expect(first.frames.at(-1)).toEqual({ event: 'end', data: { type: 'end', reason: 'lease' } });
    expect(first.done()).toBe(true);
    expect(ends()).toEqual([
      { event: 'stream.ended', id: 'tab-a', reason: 'lease', age_ms: 270_000 },
    ]);
  });

  it('12 · the legacy-lease close removes the listener at once: nothing is parked, a command for the tab is refused at once while it is awaited, and TAB_NOT_FOUND after', async () => {
    const { relay, routes } = rig();
    await openStream(routes, 'tab-a');

    await vi.advanceTimersByTimeAsync(270_000);

    const diag = relay.getTransportDiagnostics();
    expect({ connectedTabs: diag.connectedTabs, parkedTabs: diag.parkedTabs }).toEqual({
      connectedTabs: [],
      parkedTabs: [],
    });
    const awaited = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect({
      settled: awaited.settled,
      message: (awaited.error as Error | undefined)?.message,
    }).toEqual({ settled: true, message: notDeliveredAtLease('getTabInfo', 'lease') });

    // 15 000 ms after the close (the client's 10 s reconnect delay, plus 5 s), it is gone.
    await vi.advanceTimersByTimeAsync(15_000);
    const gone = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect((gone.error as { code?: unknown } | undefined)?.code).toBe('TAB_NOT_FOUND');
  });
});

describe('relay stream lease · a newer stream closes the old one only for the same page, or after a rotate (review A4)', () => {
  /** The `getTabInfo` commands `stream` was sent. */
  function tabInfoCommands(stream: Stream): Frame[] {
    return stream.frames.filter((frame) => frame.data?.action === 'getTabInfo');
  }

  it.each([
    ['another page instance (a duplicated browser tab)', 'page-x', 'page-y'],
    ['two legacy clients (no cid)', undefined, undefined],
  ])(
    'a second stream on one tab id from %s leaves the first open: no end, so no reopen loop; the newer stream holds the tab',
    async (_label, firstCid, secondCid) => {
      const ends = streamEnds();
      const { relay, routes } = rig();
      const first = await openStream(routes, 'tab-a', {
        caps: 'rotate,dedupe',
        ...(firstCid === undefined ? {} : { cid: firstCid }),
      });
      const second = await openStream(routes, 'tab-a', {
        caps: 'rotate,dedupe',
        ...(secondCid === undefined ? {} : { cid: secondCid }),
      });

      expect(first.done()).toBe(false);
      expect(first.frames.filter((frame) => frame.event === 'end')).toEqual([]);
      expect(ends()).toEqual([]);
      relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect({
        first: tabInfoCommands(first).length,
        second: tabInfoCommands(second).length,
      }).toEqual({ first: 0, second: 1 });
    }
  );

  it('the same page reopening before any rotate (same cid) closes its old stream `replaced` (control)', async () => {
    const ends = streamEnds();
    const { routes } = rig();
    const first = await openStream(routes, 'tab-a', { caps: 'rotate,dedupe', cid: 'page-x' });
    await vi.advanceTimersByTimeAsync(10_000);
    await openStream(routes, 'tab-a', { caps: 'rotate,dedupe', cid: 'page-x' });

    expect(first.done()).toBe(true);
    expect(ends()).toEqual([
      { event: 'stream.ended', id: 'tab-a', reason: 'replaced', age_ms: 10_000 },
    ]);
  });

  it('a stream told to rotate is closed `replaced` by its tab’s next stream, whatever cid that names (control)', async () => {
    const ends = streamEnds();
    const { routes } = rig();
    const first = await openStream(routes, 'tab-a', { caps: 'rotate,dedupe', cid: 'page-x' });
    await vi.advanceTimersByTimeAsync(50_000);
    await openStream(routes, 'tab-a', { caps: 'rotate,dedupe', cid: 'page-y' });

    expect(first.done()).toBe(true);
    expect(ends()).toEqual([
      { event: 'stream.ended', id: 'tab-a', reason: 'replaced', age_ms: 50_000 },
    ]);
  });
});

describe('relay stream lease · the ends the relay hears at once', () => {
  it('4 · a consumer cancel makes the listener dead at once, reason `cancel`', async () => {
    const ends = streamEnds();
    const { relay, routes } = rig();
    const first = await openStream(routes, 'tab-a', { caps: 'rotate,dedupe', cid: 'page-1' });

    await first.cancel();

    expect(ends()).toEqual([{ event: 'stream.ended', id: 'tab-a', reason: 'cancel', age_ms: 0 }]);
    const diag = relay.getTransportDiagnostics();
    expect({ connectedTabs: diag.connectedTabs, parkedTabs: diag.parkedTabs }).toEqual({
      connectedTabs: [],
      parkedTabs: ['tab-a'],
    });
  });

  it('5 · a command whose write throws is not counted as notified: it is rejected at once, reason `enqueue_failed`', async () => {
    const ends = streamEnds();
    const { relay, routes } = rig();
    await openStream(routes, 'tab-a', { caps: 'rotate,dedupe', cid: 'page-1' });

    failNextEnqueue();
    const outcome = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);

    // Rejected now, as a broadcast that reached nobody is: never an 8 s
    // timeout claiming "1 client(s) were notified".
    expect({
      settled: outcome.settled,
      message: (outcome.error as Error | undefined)?.message,
    }).toEqual({
      settled: true,
      message:
        'No active UI Bridge SDK client received the getTabInfo command. ' +
        '1 SSE listener(s) registered but none accepted the command. ' +
        'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.',
    });
    expect(ends()).toEqual([
      { event: 'stream.ended', id: 'tab-a', reason: 'enqueue_failed', age_ms: 0 },
    ]);
    expect(relay.getTransportDiagnostics().parkedTabs).toEqual(['tab-a']);
  });

  it('6 · a ping that finds the previous ping still unread ends the stream `consumer_stalled`', async () => {
    const ends = streamEnds();
    const { relay, routes } = rig();
    const first = await openStream(routes, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      read: false,
    });
    // The consumer reads the `connected` event, then stops reading.
    expect((await first.readOne())?.data?.type).toBe('connected');

    await vi.advanceTimersByTimeAsync(15_000); // the first ping is queued, unread
    expect(ends()).toEqual([]);
    await vi.advanceTimersByTimeAsync(15_000); // the second finds it still there

    expect(ends()).toEqual([
      { event: 'stream.ended', id: 'tab-a', reason: 'consumer_stalled', age_ms: 30_000 },
    ]);
    expect(relay.getTransportDiagnostics().parkedTabs).toEqual(['tab-a']);
  });

  it('6 · a consumer that reads on, a chunk behind, is not stalled (control)', async () => {
    const ends = streamEnds();
    const { relay, routes } = rig();
    const first = await openStream(routes, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      read: false,
    });
    // One frame per ping interval, always one behind: it is reading.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      await first.readOne();
    }

    expect(ends()).toEqual([]);
    expect(relay.getTransportDiagnostics().connectedTabs).toEqual(['tab-a']);
  });
});

describe('relay stream lease · every end logs exactly one stream.ended line', () => {
  /** How each end reason is brought about on a fresh stream for `tab-a`. */
  const ENDINGS: Array<[string, (routes: Routes, relay: CommandRelay) => Promise<Stream>, number]> =
    [
      [
        'lease',
        async (routes) => {
          const stream = await openStream(routes, 'tab-a');
          await vi.advanceTimersByTimeAsync(270_000);
          return stream;
        },
        270_000,
      ],
      [
        'replaced',
        async (routes) => {
          const stream = await openStream(routes, 'tab-a', { caps: 'rotate', cid: 'page-1' });
          await vi.advanceTimersByTimeAsync(50_000);
          await openStream(routes, 'tab-a', { caps: 'rotate', cid: 'page-1' });
          return stream;
        },
        50_000,
      ],
      [
        'rotate_unanswered',
        async (routes) => {
          const stream = await openStream(routes, 'tab-a', { caps: 'rotate', cid: 'page-1' });
          await vi.advanceTimersByTimeAsync(60_000);
          return stream;
        },
        60_000,
      ],
      [
        'abort',
        async (routes) => {
          const stream = await openStream(routes, 'tab-a', { caps: 'rotate', cid: 'page-1' });
          stream.abort();
          await vi.advanceTimersByTimeAsync(0);
          return stream;
        },
        0,
      ],
      [
        'cancel',
        async (routes) => {
          const stream = await openStream(routes, 'tab-a', { caps: 'rotate', cid: 'page-1' });
          await stream.cancel();
          return stream;
        },
        0,
      ],
      [
        'enqueue_failed',
        async (routes, relay) => {
          const stream = await openStream(routes, 'tab-a', { caps: 'rotate', cid: 'page-1' });
          failNextEnqueue();
          relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }).catch(() => undefined);
          await vi.advanceTimersByTimeAsync(0);
          return stream;
        },
        0,
      ],
      [
        'consumer_stalled',
        async (routes) => {
          const stream = await openStream(routes, 'tab-a', {
            caps: 'rotate',
            cid: 'page-1',
            read: false,
          });
          await stream.readOne();
          await vi.advanceTimersByTimeAsync(30_000);
          return stream;
        },
        30_000,
      ],
    ];

  it.each(ENDINGS)(
    '10 · `%s` logs one line, and no later end signal for that stream logs another',
    async (reason, end, ageMs) => {
      const ends = streamEnds();
      const { relay, routes } = rig();
      const stream = await end(routes, relay);
      expect(ends()).toEqual([{ event: 'stream.ended', id: 'tab-a', reason, age_ms: ageMs }]);

      // Every other signal this stream can still produce.
      stream.abort();
      await stream.cancel();
      await vi.advanceTimersByTimeAsync(40_000);

      expect(ends()).toEqual([{ event: 'stream.ended', id: 'tab-a', reason, age_ms: ageMs }]);
    }
  );
});

describe('relay stream lease · timings', () => {
  const ENV = [
    'UI_BRIDGE_STREAM_LEASE_MS',
    'UI_BRIDGE_LEGACY_STREAM_LEASE_MS',
    'UI_BRIDGE_ROTATE_GRACE_MS',
  ] as const;
  const original = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of ENV) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  /** When (ms after open) a stream for a client declaring `caps` first gets a rotate frame, or ends. */
  async function firstLeaseEvent(
    options: Partial<ConstructorParameters<typeof CommandRelay>[0]>,
    caps?: string
  ): Promise<{ at: number; what: string }> {
    const { routes } = rig(options);
    const stream = await openStream(routes, 'tab-a', caps === undefined ? {} : { caps });
    for (let at = 1_000; at <= 400_000; at += 1_000) {
      await vi.advanceTimersByTimeAsync(1_000);
      if (rotateFrames(stream).length > 0) return { at, what: 'rotate' };
      if (stream.done()) return { at, what: 'end' };
    }
    return { at: -1, what: 'none' };
  }

  it.each([
    ['the default lease', {}, {}, 'rotate', { at: 50_000, what: 'rotate' }],
    [
      'the lease from UI_BRIDGE_STREAM_LEASE_MS',
      { UI_BRIDGE_STREAM_LEASE_MS: '20000' },
      {},
      'rotate',
      { at: 20_000, what: 'rotate' },
    ],
    [
      'an explicit lease over the env var',
      { UI_BRIDGE_STREAM_LEASE_MS: '20000' },
      { streamLeaseMs: 30_000 },
      'rotate',
      { at: 30_000, what: 'rotate' },
    ],
    [
      'a lease floored at 15 000 ms, above the 10 s a client stream must live to count as healthy',
      {},
      { streamLeaseMs: 1_000 },
      'rotate',
      { at: 15_000, what: 'rotate' },
    ],
    ['the default legacy lease', {}, {}, undefined, { at: 270_000, what: 'end' }],
    [
      'a legacy lease floored at 15 000 ms too',
      {},
      { legacyStreamLeaseMs: 1_000 },
      undefined,
      { at: 15_000, what: 'end' },
    ],
    [
      'the legacy lease from UI_BRIDGE_LEGACY_STREAM_LEASE_MS',
      { UI_BRIDGE_LEGACY_STREAM_LEASE_MS: '120000' },
      {},
      undefined,
      { at: 120_000, what: 'end' },
    ],
    [
      'an explicit legacy lease over the env var',
      { UI_BRIDGE_LEGACY_STREAM_LEASE_MS: '120000' },
      { legacyStreamLeaseMs: 90_000 },
      undefined,
      { at: 90_000, what: 'end' },
    ],
  ])('%s', async (_label, env, options, caps, expected) => {
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    expect(await firstLeaseEvent(options, caps)).toEqual(expected);
  });

  it.each([
    ['the default grace', {}, {}, 60_000],
    ['the grace from UI_BRIDGE_ROTATE_GRACE_MS', { UI_BRIDGE_ROTATE_GRACE_MS: '4000' }, {}, 54_000],
    [
      'an explicit grace over the env var',
      { UI_BRIDGE_ROTATE_GRACE_MS: '4000' },
      { rotateGraceMs: 7_000 },
      57_000,
    ],
  ])(
    'a rotated stream with no replacement ends at the lease plus %s',
    async (_label, env, options, endsAt) => {
      for (const [key, value] of Object.entries(env)) process.env[key] = value;
      const ends = streamEnds();
      const { routes } = rig(options);
      await openStream(routes, 'tab-a', { caps: 'rotate' });
      await vi.advanceTimersByTimeAsync(endsAt - 1);
      expect(ends()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(ends()).toEqual([
        { event: 'stream.ended', id: 'tab-a', reason: 'rotate_unanswered', age_ms: endsAt },
      ]);
    }
  );
});
