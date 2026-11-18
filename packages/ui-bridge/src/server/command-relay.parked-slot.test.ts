/**
 * A dead listener is a parked slot, not a hole (plan
 * 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
 * Phase 2, D2).
 *
 * When the relay hears a stream end (here: its consumer cancels it), the
 * tab's listener is marked dead and kept for `reconnectGraceMs`:
 *
 * - a command for the tab is parked on the slot, never written, and the tab's
 *   next stream flushes it;
 * - with no next stream, the slot is removed at grace expiry and every parked
 *   command is rejected at once with the relay's not-delivered message;
 * - a dead slot is no connected transport to any reader, is listed in
 *   `parkedTabs`, answers `tabRegistered: false`, and gives up its bus
 *   membership at death, so another instance holding the tab is the one the
 *   fleet routes to.
 *
 * The two-instance cases run two `CommandRelay`s over two real
 * `RedisRelayBus`es that share one in-memory Redis, so per-holder presence is
 * the adapter's own, not a fake's. Literals throughout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { RedisRelayBus, type RelayBus } from './relay-bus';

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
type Handlers = ReturnType<typeof createRelayHandlers>;

/** A relay with its own globalThis prefix and no warm-up snapshot, its handlers and its routes. */
function rig(options?: Partial<ConstructorParameters<typeof CommandRelay>[0]>): {
  relay: CommandRelay;
  handlers: Handlers;
  routes: Routes;
} {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeSlot_${Math.random().toString(36).slice(2, 10)}`,
    proactiveSnapshot: false,
    ...(options ?? {}),
  });
  relays.push(relay);
  const handlers = createRelayHandlers(relay);
  return { relay, handlers, routes: createNextRouteHandlers(handlers, { relay }) };
}

/** A command stream as a relay tab holds one, answering what it is told to. */
interface Stream {
  /** Every command delivered down this stream, by action, in order. */
  actions: string[];
  /** The same commands with their ids, for a test that answers one itself. */
  commands: Array<{ commandId: string; action: string }>;
  done: () => boolean;
  streamId: () => string | undefined;
  /** Cancel the stream from the consumer's side: the relay hears the end. */
  cancel: () => Promise<void>;
}

/**
 * Open `GET <base>/commands/stream` for `tabId` and read it as a live tab
 * does. A command whose action `answer` names is answered with the result it
 * returns, presenting this stream's id, as the relay client posts it.
 */
async function openStream(
  routes: Routes,
  relay: CommandRelay,
  tabId: string,
  options: {
    caps?: string;
    cid?: string;
    caller?: string;
    answer?: Record<string, () => unknown>;
  } = {}
): Promise<Stream> {
  const query = new URLSearchParams({ tabId });
  if (options.caps !== undefined) query.set('caps', options.caps);
  if (options.cid !== undefined) query.set('cid', options.cid);
  const url = `http://app.test${BASE}/commands/stream?${query.toString()}`;
  const headers: Record<string, string> = {};
  if (options.caller) headers['X-Caller-User-Id'] = options.caller;
  const nextUrl = new URL(url);
  const request = Object.assign(new Request(url, { method: 'GET', headers }), { nextUrl });
  const response = await routes.GET(
    request as never,
    {
      params: { path: ['commands', 'stream'] },
    } as never
  );
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const actions: string[] = [];
  const commands: Array<{ commandId: string; action: string }> = [];
  let streamId: string | undefined;
  let ended = false;
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
            actions.push(data.action);
            commands.push({ commandId: data.commandId, action: data.action });
            const answer = options.answer?.[data.action];
            if (answer) {
              const accepted = relay.resolveCommand(data.commandId, answer(), tabId, {
                streamId,
                callerUserId: options.caller,
              });
              if (!accepted) actions.push(`refused:${data.action}`);
            }
          }
        }
      }
    } catch {
      /* cancelled */
    }
    ended = true;
  })();
  await vi.advanceTimersByTimeAsync(0);
  return {
    actions,
    commands,
    done: () => ended,
    streamId: () => streamId,
    cancel: async () => {
      await reader.cancel();
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

/** POST a strict-mode heartbeat for `tabId` from `userId`, and return its `data`. */
async function heartbeat(
  routes: Routes,
  tabId: string,
  userId: string
): Promise<Record<string, unknown>> {
  const url = `http://app.test${BASE}/heartbeat`;
  const nextUrl = new URL(url);
  const request = Object.assign(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Caller-User-Id': userId },
      body: JSON.stringify({
        tabId,
        url: `http://app.test/${tabId}`,
        title: tabId,
        visibility: 'visible',
        registrationMetadata: { userId, sessionId: `session-${tabId}` },
      }),
    }),
    { nextUrl }
  );
  const response = await routes.POST(
    request as never,
    {
      params: { path: ['heartbeat'] },
    } as never
  );
  return ((await response.json()) as { data: Record<string, unknown> }).data;
}

/** `GET <base><path>` as `caller` (unscoped when absent); the response, unawaited. */
function get(routes: Routes, path: string, caller?: string): Promise<Response> {
  const url = `http://app.test${BASE}${path}`;
  const nextUrl = new URL(url);
  const headers: Record<string, string> = caller ? { 'X-Caller-User-Id': caller } : {};
  const request = Object.assign(new Request(url, { method: 'GET', headers }), { nextUrl });
  return routes.GET(
    request as never,
    {
      params: { path: nextUrl.pathname.slice(BASE.length + 1).split('/') },
    } as never
  );
}

/** The tab ids a `/tabs` or `/tabs/wait` answer lists. */
async function listedTabs(response: Response): Promise<string[]> {
  const body = (await response.json()) as { data?: { tabs?: Array<{ tabId: string }> } };
  return (body.data?.tabs ?? []).map((tab) => tab.tabId);
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

// ---------------------------------------------------------------------------
// An in-memory Redis: just the commands `RedisRelayBus` sends, one keyspace
// and one pub/sub shared by every client, under the test's clock.
// ---------------------------------------------------------------------------

class FakeRedisServer {
  readonly strings = new Map<string, { value: string; expiresAt: number }>();
  readonly sortedSets = new Map<string, Map<string, number>>();
  readonly keyExpiry = new Map<string, number>();
  readonly channels = new Map<string, Set<FakeRedisClient>>();

  client(label: string): FakeRedisClient {
    return new FakeRedisClient(this, label);
  }

  /** The labels of the clients subscribed to `channel`. */
  subscribers(channel: string): string[] {
    return [...(this.channels.get(channel) ?? [])].map((client) => client.label).sort();
  }

  /** Drop `key` if its expiry has passed. */
  expire(key: string): void {
    const now = Date.now();
    const string = this.strings.get(key);
    if (string && string.expiresAt <= now) this.strings.delete(key);
    const at = this.keyExpiry.get(key);
    if (at !== undefined && at <= now) {
      this.sortedSets.delete(key);
      this.keyExpiry.delete(key);
    }
  }
}

/** A score bound as Redis spells one: `-inf`, `+inf`, `(n` (exclusive) or `n`. */
function inRange(score: number, min: number | string, max: number | string): boolean {
  const above = (bound: number | string): boolean => {
    if (bound === '-inf') return true;
    if (typeof bound === 'string' && bound.startsWith('(')) return score > Number(bound.slice(1));
    return score >= Number(bound);
  };
  const below = (bound: number | string): boolean => {
    if (bound === '+inf') return true;
    if (typeof bound === 'string' && bound.startsWith('(')) return score < Number(bound.slice(1));
    return score <= Number(bound);
  };
  return above(min) && below(max);
}

class FakeRedisClient {
  private readonly listeners: Array<(channel: string, message: string) => void> = [];

  constructor(
    private readonly server: FakeRedisServer,
    readonly label: string
  ) {}

  deliver(channel: string, message: string): void {
    for (const listener of this.listeners) listener(channel, message);
  }

  on(event: string, listener: (channel: string, message: string) => void): this {
    if (event === 'message') this.listeners.push(listener);
    return this;
  }

  async publish(channel: string, message: string): Promise<number> {
    const subscribers = [...(this.server.channels.get(channel) ?? [])];
    for (const client of subscribers) client.deliver(channel, message);
    return subscribers.length;
  }

  async subscribe(...channels: string[]): Promise<number> {
    for (const channel of channels) {
      let set = this.server.channels.get(channel);
      if (!set) this.server.channels.set(channel, (set = new Set()));
      set.add(this);
    }
    return channels.length;
  }

  async unsubscribe(...channels: string[]): Promise<number> {
    for (const channel of channels) this.server.channels.get(channel)?.delete(this);
    return channels.length;
  }

  async set(key: string, value: string, _mode: string, ttlSeconds: number): Promise<'OK'> {
    this.server.sortedSets.delete(key);
    this.server.strings.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return 'OK';
  }

  async exists(key: string): Promise<number> {
    this.server.expire(key);
    return this.server.strings.has(key) || (this.server.sortedSets.get(key)?.size ?? 0) > 0 ? 1 : 0;
  }

  private sortedSet(key: string, create: boolean): Map<string, number> | undefined {
    this.server.expire(key);
    if (this.server.strings.has(key)) {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    let set = this.server.sortedSets.get(key);
    if (!set && create) this.server.sortedSets.set(key, (set = new Map()));
    return set;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const set = this.sortedSet(key, true)!;
    const added = set.has(member) ? 0 : 1;
    set.set(member, Number(score));
    return added;
  }

  async zrem(key: string, member: string): Promise<number> {
    return this.sortedSet(key, false)?.delete(member) ? 1 : 0;
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const set = this.sortedSet(key, false);
    let removed = 0;
    for (const [member, score] of set ?? []) {
      if (inRange(score, min, max)) {
        set!.delete(member);
        removed++;
      }
    }
    return removed;
  }

  async zcount(key: string, min: number | string, max: number | string): Promise<number> {
    let count = 0;
    for (const score of this.sortedSet(key, false)?.values() ?? []) {
      if (inRange(score, min, max)) count++;
    }
    return count;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    this.server.keyExpiry.set(key, Date.now() + ms);
    return 1;
  }

  async zscore(key: string, member: string): Promise<string | null> {
    const score = this.sortedSet(key, false)?.get(member);
    return score === undefined ? null : String(score);
  }

  async pexpireat(key: string, unixTimeMs: number): Promise<number> {
    this.server.keyExpiry.set(key, Number(unixTimeMs));
    return 1;
  }

  /** ZRANGE by rank, ascending by score, `WITHSCORES` flattening each member and its score. */
  async zrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]> {
    const ranked = [...(this.sortedSet(key, false)?.entries() ?? [])].sort((a, b) => a[1] - b[1]);
    const at = (index: number) => (index < 0 ? ranked.length + index : index);
    const slice = ranked.slice(at(start), at(stop) + 1);
    return slice.flatMap(([member, score]) =>
      withScores === 'WITHSCORES' ? [member, String(score)] : [member]
    );
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }

  duplicate(): FakeRedisClient {
    return this.server.client(`${this.label}.sub`);
  }
}

/** A real `RedisRelayBus` for one instance, over `server`. */
function redisBus(server: FakeRedisServer, label: string): RelayBus {
  const pub = server.client(label);
  const Bus = RedisRelayBus as unknown as new (pub: unknown, sub: unknown) => RelayBus;
  return new Bus(pub, pub.duplicate());
}

/**
 * A WebSocket client for `tabId` on `relay` that answers every command it is
 * sent (as a page would, a turn later) and logs each action.
 */
function webSocketTab(
  relay: CommandRelay,
  tabId: string,
  answer: Record<string, () => unknown>
): { actions: string[] } {
  const actions: string[] = [];
  relay.registerWebSocketClient({
    clientId: tabId,
    isConnected: () => true,
    close: () => undefined,
    send: (message) => {
      const { commandId, action } = JSON.parse(message) as { commandId: string; action: string };
      actions.push(action);
      const result = answer[action]?.();
      if (result !== undefined) {
        void Promise.resolve().then(() => relay.resolveCommand(commandId, result, tabId));
      }
    },
  });
  return { actions };
}

const NOT_DELIVERED_GET_TAB_INFO =
  'No active UI Bridge SDK client received the getTabInfo command. ' +
  'Tab "tab-a"\'s command stream ended (cancel) and no new stream opened within 5000ms. ' +
  'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.';

describe('relay parked slot · what the relay knows it cannot send, it holds for the next stream', () => {
  it.each([
    ['from the same page instance', 'page-1'],
    ['from a reload of the page (another cid)', 'page-2'],
    ['from a client that names no page instance', undefined],
  ])(
    '7 · a command sent to a dead slot is parked, and flushed down the replacement %s within the grace',
    async (_label, replacementCid) => {
      const { relay, routes } = rig();
      const first = await openStream(routes, relay, 'tab-a', {
        caps: 'rotate,dedupe',
        cid: 'page-1',
      });
      await first.cancel();

      const outcome = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
      await vi.advanceTimersByTimeAsync(4_999);
      // Parked: neither written nor failed.
      expect(outcome.settled).toBe(false);

      const second = await openStream(routes, relay, 'tab-a', {
        caps: 'rotate,dedupe',
        ...(replacementCid === undefined ? {} : { cid: replacementCid }),
        answer: { getTabInfo: () => ({ title: 'answered down the replacement' }) },
      });

      // Bound to the stream it actually went down: the replacement's own
      // result, presenting the replacement's stream id, settles it.
      expect(second.actions).toEqual(['getTabInfo']);
      expect(outcome).toEqual({
        settled: true,
        value: { title: 'answered down the replacement' },
      });
      expect(relay.getTransportDiagnostics().parkedTabs).toEqual([]);
    }
  );

  it('8 · at grace expiry with no replacement, the parked command rejects at once with the not-delivered message, and the slot is gone', async () => {
    const { relay, routes } = rig();
    const first = await openStream(routes, relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
    });
    await first.cancel();

    const outcome = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect({
      settled: outcome.settled,
      message: (outcome.error as Error | undefined)?.message,
    }).toEqual({ settled: true, message: NOT_DELIVERED_GET_TAB_INFO });
    const diag = relay.getTransportDiagnostics();
    expect({ connectedTabs: diag.connectedTabs, parkedTabs: diag.parkedTabs }).toEqual({
      connectedTabs: [],
      parkedTabs: [],
    });
  });

  it('8 · noLiveAnswerCause classifies that message as no live answer: an unpinned getElement answers from the cache, marked with the cause', async () => {
    const { relay, handlers, routes } = rig();
    const first = await openStream(routes, relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: {
        getControlSnapshot: () => ({
          timestamp: T0,
          elements: [
            {
              id: 'save-btn',
              type: 'button',
              tagName: 'button',
              label: 'Save (cached)',
              actions: ['click'],
              state: { visible: true, enabled: true, focused: false },
            },
          ],
          components: [],
          workflows: [],
        }),
      },
    });
    const warm = track(handlers.getControlSnapshot!({ recency: 'current' } as never));
    await vi.advanceTimersByTimeAsync(0);
    expect(warm.settled).toBe(true);
    await first.cancel();

    const read = track(handlers.getElement!('save-btn'));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(read.settled).toBe(true);
    expect(read.value).toMatchObject({
      success: true,
      data: { id: 'save-btn', label: 'Save (cached)' },
      _meta: {
        fallback: true,
        reason:
          "Relay command 'getElement' got no live answer (no browser tab is connected to receive it) — " +
          "answered from the cached snapshot, which can be stale or another tab's.",
      },
    });
  });

  it('9 · a dead slot is no connected transport to any reader, is listed in parkedTabs, answers tabRegistered: false, and is not re-announced', async () => {
    const server = new FakeRedisServer();
    const bus = redisBus(server, 'A');
    const announce = vi.spyOn(bus, 'registerTab');
    const { relay, routes } = rig({ bus, pruneSweepIntervalMs: 1_000 });
    const first = await openStream(routes, relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      caller: 'u1',
    });
    expect((await heartbeat(routes, 'tab-a', 'u1')).tabRegistered).toBe(true);

    await first.cancel();
    announce.mockClear();

    const diag = relay.getTransportDiagnostics();
    expect({
      connectedTabs: diag.connectedTabs,
      commandListenerCount: diag.commandListenerCount,
      activeTabs: diag.activeTabs,
      getConnectedTabs: relay.getConnectedTabs(),
      hasCommandListeners: relay.hasCommandListeners(),
      parkedTabs: diag.parkedTabs,
    }).toEqual({
      connectedTabs: [],
      commandListenerCount: 0,
      activeTabs: [],
      getConnectedTabs: [],
      hasCommandListeners: false,
      parkedTabs: ['tab-a'],
    });
    expect(relay.adminListAllTabs()).toEqual([]);
    // The owner's view lists it as parked and nowhere else; another user's view not at all.
    const owner = relay.getTransportDiagnostics({ ownerCheck: { userId: 'u1' } });
    expect({
      connectedTabs: owner.connectedTabs,
      commandListenerCount: owner.commandListenerCount,
      activeTabs: owner.activeTabs,
      parkedTabs: owner.parkedTabs,
    }).toEqual({
      connectedTabs: [],
      commandListenerCount: 0,
      activeTabs: [],
      parkedTabs: ['tab-a'],
    });
    expect(relay.getTransportDiagnostics({ ownerCheck: { userId: 'u2' } }).parkedTabs).toEqual([]);
    // The client's silent-disconnect recovery reads this and reopens its stream.
    expect((await heartbeat(routes, 'tab-a', 'u1')).tabRegistered).toBe(false);
    // `/tabs`, unscoped and scoped, and the owner's `/tabs/wait` list it nowhere.
    expect(await listedTabs(await get(routes, '/tabs'))).toEqual([]);
    expect(await listedTabs(await get(routes, '/tabs', 'u1'))).toEqual([]);
    expect(await listedTabs(await get(routes, '/tabs?activeOnly=true', 'u1'))).toEqual([]);
    const wait = track(get(routes, '/tabs/wait?timeoutMs=100&pollMs=50', 'u1'));
    await vi.advanceTimersByTimeAsync(150);
    expect((wait.value as Response | undefined)?.status).toBe(504);

    // A presence sweep inside the grace does not re-announce it.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(announce.mock.calls.filter(([tabId]) => tabId === 'tab-a')).toEqual([]);
    expect(await bus.isTabKnown('tab-a')).toBe(false);
  });
});

describe('relay parked slot · dispatch still sees a dead slot, behind every live tab', () => {
  it.each([
    ['unscoped', undefined],
    ['owner-scoped', 'u1'],
  ])(
    'an %s unpinned command goes to a live tab, not to a dead slot that was the primary',
    async (_label, userId) => {
      const { relay, routes } = rig();
      const answer = (tab: string) => ({ getTabInfo: () => ({ title: `answered by ${tab}` }) });
      await openStream(routes, relay, 'tab-b', {
        caps: 'rotate',
        cid: 'b',
        answer: answer('tab-b'),
      });
      const tabA = await openStream(routes, relay, 'tab-a', {
        caps: 'rotate',
        cid: 'a',
        answer: answer('tab-a'),
      });
      for (const tab of ['tab-a', 'tab-b']) {
        relay.recordRegistration(tab, { userId: 'u1', sessionId: `session-${tab}` });
        relay.receiveHeartbeat(tab);
      }
      // A answered last: first for both arms while it lives.
      const pinned = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(pinned).toEqual({ settled: true, value: { title: 'answered by tab-a' } });
      expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-a');
      expect(relay.getTransportDiagnostics({ ownerCheck: { userId: 'u1' } }).primaryTabId).toBe(
        'tab-a'
      );
      await tabA.cancel();

      const outcome = track(
        relay.queueCommand('getTabInfo', {}, userId ? { ownerCheck: { userId } } : undefined)
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(outcome).toEqual({ settled: true, value: { title: 'answered by tab-b' } });
    }
  );

  it('with only the dead slot, an unpinned command is parked on it and flushed down its next stream', async () => {
    const { relay, routes } = rig();
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await first.cancel();

    const outcome = track(relay.queueCommand('getTabInfo', {}));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(outcome.settled).toBe(false);
    const second = await openStream(routes, relay, 'tab-a', {
      caps: 'rotate',
      cid: 'page-1',
      answer: { getTabInfo: () => ({ title: 'answered down the replacement' }) },
    });

    expect(second.actions).toEqual(['getTabInfo']);
    expect(outcome).toEqual({ settled: true, value: { title: 'answered down the replacement' } });
  });

  it('a fire-and-forget command parked on a dead slot resolves when it is delivered down the next stream', async () => {
    const { relay, routes } = rig();
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await first.cancel();

    const navigate = track(
      relay.queueCommand('pageNavigate', { url: '/next' }, { targetTabId: 'tab-a' })
    );
    await vi.advanceTimersByTimeAsync(1_000);
    // Not delivered yet, so not resolved as delivered.
    expect(navigate.settled).toBe(false);
    const second = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });

    expect(second.actions).toEqual(['pageNavigate']);
    expect(navigate).toEqual({
      settled: true,
      value: {
        success: true,
        fireAndForget: true,
        delivered: true,
        executed: false,
        tabsNotified: 1,
        action: 'pageNavigate',
        timestamp: T0 + 1_000,
      },
    });
  });

  it('a fire-and-forget command parked on a dead slot fails at grace expiry with the not-delivered message', async () => {
    const { relay, routes } = rig();
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await first.cancel();

    const navigate = track(
      relay.queueCommand('pageNavigate', { url: '/next' }, { targetTabId: 'tab-a' })
    );
    await vi.advanceTimersByTimeAsync(5_000);

    expect({
      settled: navigate.settled,
      message: (navigate.error as Error | undefined)?.message,
    }).toEqual({
      settled: true,
      message:
        'No active UI Bridge SDK client received the pageNavigate command. ' +
        'Tab "tab-a"\'s command stream ended (cancel) and no new stream opened within 5000ms. ' +
        'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.',
    });
  });

  it('destroy() fails a parked command with RelayDestroyedError (control)', async () => {
    const { relay, routes } = rig();
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await first.cancel();
    const outcome = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);

    relay.destroy();
    await vi.advanceTimersByTimeAsync(0);

    expect((outcome.error as { code?: unknown } | undefined)?.code).toBe('RELAY_DESTROYED');
  });
});

describe('relay resume · a returning stream resumes the same page only when both streams name it', () => {
  /** A snapshot with one element, so a warm-up is not retried. */
  const SNAPSHOT = () => ({
    timestamp: T0,
    elements: [{ id: 'e', type: 'button', tagName: 'button', label: 'e', actions: [], state: {} }],
    components: [],
    workflows: [],
  });

  it.each([
    ['its old stream still open, the same cid (a rotation)', 0, 'open', 'page-1'],
    ['its old stream still open, another cid (a reload)', 1, 'open', 'page-2'],
    ['its old stream still open, no cid (a legacy client)', 0, 'open', undefined],
    ['its old stream parked, the same cid (a reconnect)', 0, 'dead', 'page-1'],
    ['its old stream parked, another cid', 1, 'dead', 'page-2'],
    ['its old slot expired 1 s ago, the same cid', 0, 'expired', 'page-1'],
    ['its old slot expired 1 s ago, another cid', 1, 'expired', 'page-2'],
  ])(
    'a stream that returns to a tab with %s is sent %i warm-up snapshot(s)',
    async (_label, warmUps, prior, cid) => {
      const { relay, routes } = rig({ proactiveSnapshot: true });
      const first = await openStream(routes, relay, 'tab-a', {
        caps: 'rotate',
        cid: 'page-1',
        answer: { getControlSnapshot: SNAPSHOT },
      });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(first.actions).toEqual(['getControlSnapshot']);
      if (prior !== 'open') await first.cancel();
      if (prior === 'expired') await vi.advanceTimersByTimeAsync(6_000);

      const next = await openStream(routes, relay, 'tab-a', {
        caps: 'rotate',
        ...(cid === undefined ? {} : { cid }),
        answer: { getControlSnapshot: SNAPSHOT },
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(next.actions.filter((action) => action === 'getControlSnapshot')).toHaveLength(
        warmUps
      );
    }
  );

  it('a reload of a tab (another cid) does not take the primary from a live tab; a brand-new tab does (control)', async () => {
    const { relay, routes } = rig();
    await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'a-1' });
    await openStream(routes, relay, 'tab-b', { caps: 'rotate', cid: 'b-1' });
    relay.receiveHeartbeat('tab-a');
    relay.receiveHeartbeat('tab-b');
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-b');

    await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'a-2' });
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-b');

    await openStream(routes, relay, 'tab-c', { caps: 'rotate', cid: 'c-1' });
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-c');
  });
});

describe('relay parked slot · the flush to a replacement, and the warm-up generation (Phase 3)', () => {
  /** A snapshot with one element: an answered warm-up marks its tab. */
  const SNAPSHOT = () => ({
    timestamp: T0,
    elements: [{ id: 'e', type: 'button', tagName: 'button', label: 'e', actions: [], state: {} }],
    components: [],
    workflows: [],
  });

  it.each([
    ['the same page (same cid)', 'page-1', ['getTabInfo']],
    ['a reload of the page (another cid)', 'page-2', ['getTabInfo', 'getControlSnapshot']],
  ])(
    'a dead slot replaced by %s: its held command is written first, and a warm-up follows only for a new page',
    async (_label, cid, expected) => {
      const { relay, routes } = rig({ proactiveSnapshot: true });
      const first = await openStream(routes, relay, 'tab-a', {
        caps: 'rotate',
        cid: 'page-1',
        answer: { getControlSnapshot: SNAPSHOT },
      });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(first.actions).toEqual(['getControlSnapshot']); // its warm-up, answered: marked
      await first.cancel();
      const held = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
      await vi.advanceTimersByTimeAsync(1_000);

      const next = await openStream(routes, relay, 'tab-a', {
        caps: 'rotate',
        cid,
        answer: { getTabInfo: () => ({ title: 'flushed' }), getControlSnapshot: SNAPSHOT },
      });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(next.actions).toEqual(expected);
      expect(held).toEqual({ settled: true, value: { title: 'flushed' } });
    }
  );

  it("a dead slot's held commands are written down the replacement once it is registered: its presence announced and its bus subscription made first", async () => {
    const server = new FakeRedisServer();
    const bus = redisBus(server, 'A');
    const { relay, routes } = rig({ bus });
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await first.cancel();
    const held = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(held.settled).toBe(false);

    const timeline: string[] = [];
    const announce = bus.registerTab.bind(bus);
    vi.spyOn(bus, 'registerTab').mockImplementation((tabId, ttlSeconds) => {
      timeline.push(`announce ${tabId}`);
      announce(tabId, ttlSeconds);
    });
    relay.openCommandStream(
      (command) => {
        const subscribers = server.subscribers('uibridge:cmd:tab:tab-a').join(',');
        timeline.push(`write ${command.action} (bus subscribers: ${subscribers})`);
      },
      'tab-a',
      undefined,
      { caps: ['rotate'], clientInstanceId: 'page-1' }
    );

    expect(timeline).toEqual(['announce tab-a', 'write getTabInfo (bus subscribers: A.sub)']);
  });

  it('a dead slot is a pause of its page, not a fresh open: the page returns in its generation, so a late reply to the warm-up it was sent before it died still marks the tab', async () => {
    const { relay, routes } = rig({ proactiveSnapshot: true });
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await vi.advanceTimersByTimeAsync(600);
    const warmUp = first.commands.find((command) => command.action === 'getControlSnapshot')!;
    const firstStream = first.streamId()!;
    await first.cancel();

    // Back within the grace, unmarked yet: sent a warm-up of its own, left unanswered.
    const second = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await vi.advanceTimersByTimeAsync(600);
    expect(second.actions).toEqual(['getControlSnapshot']);

    // The page answers the warm-up it was sent before its stream died.
    expect(
      relay.resolveCommand(warmUp.commandId, SNAPSHOT(), 'tab-a', { streamId: firstStream })
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    // Its generation is marked now: the next rotation is sent none.
    const third = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(third.actions).toEqual([]);
  });

  it("a reload (another cid) starts a new generation: a late reply to the old page's warm-up does not mark it, so the new page's own reconnect is still sent one", async () => {
    const { relay, routes } = rig({ proactiveSnapshot: true });
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await vi.advanceTimersByTimeAsync(600);
    const warmUp = first.commands.find((command) => command.action === 'getControlSnapshot')!;
    const firstStream = first.streamId()!;
    await first.cancel();

    // The page reloads: a new page instance, sent its own warm-up, left unanswered.
    const second = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-2' });
    await vi.advanceTimersByTimeAsync(600);
    expect(second.actions).toEqual(['getControlSnapshot']);

    // The old page's warm-up is answered late.
    expect(
      relay.resolveCommand(warmUp.commandId, SNAPSHOT(), 'tab-a', { streamId: firstStream })
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    // The new page's stream dies before its warm-up is answered, and it reconnects.
    await second.cancel();
    const third = await openStream(routes, relay, 'tab-a', {
      caps: 'rotate',
      cid: 'page-2',
      answer: { getControlSnapshot: SNAPSHOT },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(third.actions).toEqual(['getControlSnapshot']);
  });
});

describe('relay parked slot · a scoped primary is never a dead slot (ownedPrimaryTabId)', () => {
  it("the first open tab in the arm's ranking is reported, while the arm still parks for the dead tab it ranks first", async () => {
    const { relay, routes } = rig();
    const answer = (tab: string) => ({ getTabInfo: () => ({ title: `answered by ${tab}` }) });
    await openStream(routes, relay, 'tab-b', { caps: 'rotate', cid: 'b', answer: answer('tab-b') });
    const tabA = await openStream(routes, relay, 'tab-a', {
      caps: 'rotate',
      cid: 'a',
      answer: answer('tab-a'),
    });
    for (const tab of ['tab-a', 'tab-b']) {
      relay.recordRegistration(tab, { userId: 'u1', sessionId: `session-${tab}` });
      relay.receiveHeartbeat(tab);
    }
    // A answers last; both heartbeats then age out of the window, and A's stream dies.
    const pinned = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(pinned).toEqual({ settled: true, value: { title: 'answered by tab-a' } });
    await tabA.cancel();

    expect(relay.ownedPrimaryTabId('u1')).toBe('tab-b');
    expect(relay.getTransportDiagnostics({ ownerCheck: { userId: 'u1' } }).primaryTabId).toBe(
      'tab-b'
    );
    const listed = (await (await get(routes, '/tabs', 'u1')).json()) as {
      data: { tabs: Array<{ tabId: string; isPrimary: boolean }> };
    };
    expect(listed.data.tabs.map(({ tabId, isPrimary }) => ({ tabId, isPrimary }))).toEqual([
      { tabId: 'tab-b', isPrimary: true },
    ]);

    // The arm still ranks the dead slot first, by its later success, and parks
    // for it; at grace expiry it fails over to the tab reported.
    const outcome = track(relay.queueCommand('getTabInfo', {}, { ownerCheck: { userId: 'u1' } }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ settled: true, value: { title: 'answered by tab-b' } });
  });

  it('with only a dead slot, a scoped caller has no primary', async () => {
    const { relay, routes } = rig();
    const tabA = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'a' });
    relay.recordRegistration('tab-a', { userId: 'u1', sessionId: 'session-tab-a' });
    await tabA.cancel();

    expect(relay.ownedPrimaryTabId('u1')).toBeNull();
    expect(relay.getTransportDiagnostics({ ownerCheck: { userId: 'u1' } }).primaryTabId).toBeNull();
  });
});

describe('relay lease close · the tab keeps its place for its return (review A1)', () => {
  /** A snapshot with one element: an answered warm-up marks its tab. */
  const SNAPSHOT = () => ({
    timestamp: T0,
    elements: [{ id: 'e', type: 'button', tagName: 'button', label: 'e', actions: [], state: {} }],
    components: [],
    workflows: [],
  });

  /** The tab's warm-up generation (Phase 3), read off the relay. */
  function generationOf(relay: CommandRelay, tabId: string): number | undefined {
    return (relay as unknown as { tabGenerations: Map<string, number> }).tabGenerations.get(tabId);
  }

  /** Run the clock `ms` forward in 10 s steps, each tab in `tabIds` beating at every step. */
  async function beating(relay: CommandRelay, ms: number, ...tabIds: string[]): Promise<void> {
    for (let left = ms; left > 0; left -= 10_000) {
      await vi.advanceTimersByTimeAsync(Math.min(10_000, left));
      for (const tabId of tabIds) relay.receiveHeartbeat(tabId);
    }
  }

  it.each([
    [
      'a legacy lease close (no caps), reopened by the legacy client',
      undefined,
      undefined,
      270_000,
    ],
    ['a rotate nobody answered, reopened by the same page', 'rotate', 'page-a', 60_000],
  ])(
    '%s 10 s later: the same primary, the same owner, the same generation, and no warm-up',
    async (_label, caps, cid, closesAt) => {
      const { relay, routes } = rig({ proactiveSnapshot: true });
      // Another tab, on a WebSocket: it has no lease, and it is where an
      // unpinned command goes while tab-a is away.
      webSocketTab(relay, 'tab-b', {
        getControlSnapshot: SNAPSHOT,
        getTabInfo: () => ({ title: 'tab-b' }),
      });
      const stream = {
        ...(caps === undefined ? {} : { caps }),
        ...(cid === undefined ? {} : { cid }),
        answer: { getControlSnapshot: SNAPSHOT },
      };
      const first = await openStream(routes, relay, 'tab-a', stream);
      relay.recordRegistration('tab-a', { userId: 'u1', sessionId: 'session-a' });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(first.actions).toEqual(['getControlSnapshot']); // its warm-up, answered
      expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-a');
      const owner = { ...relay.getOwnership('tab-a') };
      const generation = generationOf(relay, 'tab-a');

      // Both tabs beat, so both are live, up to tab-a's lease close.
      await beating(relay, closesAt - 2_000, 'tab-a', 'tab-b');
      expect(first.done()).toBe(true);

      // While it is away, an unpinned command goes to tab-b, live, and still
      // nothing takes tab-a's standing.
      expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-b');
      const unpinned = track(relay.queueCommand('getTabInfo', {}));
      await vi.advanceTimersByTimeAsync(0);
      expect(unpinned).toEqual({ settled: true, value: { title: 'tab-b' } });

      await beating(relay, 10_000, 'tab-b');
      const second = await openStream(routes, relay, 'tab-a', stream);
      await vi.advanceTimersByTimeAsync(2_000);

      expect({
        primary: relay.getTransportDiagnostics().primaryTabId,
        owner: relay.getOwnership('tab-a'),
        generation: generationOf(relay, 'tab-a'),
        warmUps: second.actions,
      }).toEqual({ primary: 'tab-a', owner, generation, warmUps: [] });
    }
  );

  it('a tab that reopens after its lease close does not take the primary from a newer, live tab', async () => {
    const { relay, routes } = rig();
    await openStream(routes, relay, 'tab-a'); // a legacy stream: closed at 270 s
    await beating(relay, 20_000, 'tab-a');
    await openStream(routes, relay, 'tab-b'); // newer: the primary; closed at 290 s
    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-b');

    await beating(relay, 260_000, 'tab-a', 'tab-b'); // tab-a's lease closes at 270 s
    await openStream(routes, relay, 'tab-a'); // its client reopens at 280 s

    expect(relay.getTransportDiagnostics().primaryTabId).toBe('tab-b');
  });

  it('an awaited tab keeps its owner through the 15 000 ms window, however old its last heartbeat, and loses it when the window ends without its return', async () => {
    const { relay, routes } = rig();
    await openStream(routes, relay, 'tab-a');
    relay.recordRegistration('tab-a', { userId: 'u1', sessionId: 'session-a' });
    // Its last heartbeat: 270 s old at the lease close, past the 60 s after
    // which the sweep forgets a tab that holds no transport.
    relay.receiveHeartbeat('tab-a');

    await vi.advanceTimersByTimeAsync(270_000 + 14_999);
    expect(relay.getOwnership('tab-a')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(relay.getOwnership('tab-a')).toBeNull();
  });

  it('the window ends with the tab forgotten when the periodic sweep runs in the same millisecond', async () => {
    // The sweep runs every 10 s from the first registration. This lease closes
    // at 275 s, so the window ends at 290 s, on a sweep, which is due first.
    const { relay, routes } = rig({ legacyStreamLeaseMs: 275_000 });
    await openStream(routes, relay, 'tab-a');
    relay.recordRegistration('tab-a', { userId: 'u1', sessionId: 'session-a' });

    await vi.advanceTimersByTimeAsync(290_000);
    expect(relay.getOwnership('tab-a')).toBeNull();
  });

  it('S5 · a lease close that leaves no transport makes an unpinned command wait for one, and the tab’s own reopen takes it', async () => {
    const { relay, routes } = rig();
    const answer = { getTabInfo: () => ({ title: 'tab-a' }) };
    await openStream(routes, relay, 'tab-a', { answer }); // a legacy stream: closed at 270 s
    await vi.advanceTimersByTimeAsync(270_000);

    const unpinned = track(relay.queueCommand('getTabInfo', {}));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(unpinned.settled).toBe(false);

    await openStream(routes, relay, 'tab-a', { answer }); // its client reopens
    await vi.advanceTimersByTimeAsync(0);
    expect(unpinned).toEqual({ settled: true, value: { title: 'tab-a' } });
  });
});

describe('RedisRelayBus · tab presence is per holder', () => {
  it('an instance withdraws only its own hold, and a lapsed hold counts for nothing', async () => {
    const server = new FakeRedisServer();
    const [a, b] = [redisBus(server, 'A'), redisBus(server, 'B')];

    a.registerTab('tab-a', 60);
    b.registerTab('tab-a', 60);
    a.unregisterTab('tab-a');
    expect(await a.isTabKnown('tab-a')).toBe(true);
    b.unregisterTab('tab-a');
    expect(await a.isTabKnown('tab-a')).toBe(false);

    // A holder that never let go (its instance was killed) lapses with its TTL.
    b.registerTab('tab-a', 60);
    vi.setSystemTime(T0 + 59_999);
    expect(await a.isTabKnown('tab-a')).toBe(true);
    vi.setSystemTime(T0 + 60_000);
    expect(await a.isTabKnown('tab-a')).toBe(false);
  });
});

describe('RedisRelayBus · the retired `uibridge:tab:<id>` key, and the holder set’s life (review A7)', () => {
  it('the retired `uibridge:tab:<id>` presence key is neither written nor read', async () => {
    const server = new FakeRedisServer();
    const [a, b] = [redisBus(server, 'A'), redisBus(server, 'B')];
    const raw = server.client('raw');

    a.registerTab('tab-a', 60);
    await vi.advanceTimersByTimeAsync(0);
    expect(await raw.exists('uibridge:tab:tab-a')).toBe(0);
    expect(await b.isTabKnown('tab-a')).toBe(true);
    a.unregisterTab('tab-a');
    await vi.advanceTimersByTimeAsync(0);
    expect(await b.isTabKnown('tab-a')).toBe(false);

    // A stale key of the retired shape counts for nothing, on either read.
    await raw.set('uibridge:tab:tab-a', '1', 'EX', 60);
    expect(await b.isTabKnown('tab-a')).toBe(false);
    expect(await b.holdsElsewhere('tab-a')).toBe(false);
  });

  it('A7 · a holder refreshing with a shorter TTL cannot expire the key before another holder’s longer hold', async () => {
    const server = new FakeRedisServer();
    const [a, b] = [redisBus(server, 'A'), redisBus(server, 'B')];

    a.registerTab('tab-a', 60);
    await vi.advanceTimersByTimeAsync(0);
    b.registerTab('tab-a', 10);
    await vi.advanceTimersByTimeAsync(0);

    vi.setSystemTime(T0 + 30_000);
    expect(await b.isTabKnown('tab-a')).toBe(true);
    vi.setSystemTime(T0 + 60_000);
    expect(await b.isTabKnown('tab-a')).toBe(false);
  });
});

describe('relay parked slot · across instances, a dead slot gives up its bus membership at death', () => {
  /** Answers `getTabInfo`, logging which instance's stream ran it. */
  function answerOn(instance: string, ran: string[]): Record<string, () => unknown> {
    return {
      getTabInfo: () => {
        ran.push(instance);
        return { title: `answered on ${instance}` };
      },
    };
  }

  it('11 · A’s slot dies while the replacement holds the tab on B: A unsubscribes, the tab stays known through B, A’s expiry leaves B’s presence, and a command for the tab runs once, on B', async () => {
    const server = new FakeRedisServer();
    const busA = redisBus(server, 'A');
    const a = rig({ bus: busA });
    const b = rig({ bus: redisBus(server, 'B') });
    const ran: string[] = [];

    // The page's stream lands on A; at the lease A asks it to rotate, and the
    // page's next stream lands on B. The page then lets its old stream go (its
    // consumer cancels): A hears that end and parks the slot.
    const onA = await openStream(a.routes, a.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('A', ran),
    });
    await vi.advanceTimersByTimeAsync(50_000);
    await openStream(b.routes, b.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('B', ran),
    });
    await onA.cancel();
    expect(a.relay.getTransportDiagnostics().parkedTabs).toEqual(['tab-a']);

    // At death A holds no bus command subscription, and the tab is still
    // known to the fleet, through B.
    expect(server.subscribers('uibridge:cmd:tab:tab-a')).toEqual(['B.sub']);
    expect(await busA.isTabKnown('tab-a')).toBe(true);

    // A command dispatched on A while its slot is dead goes over the bus to B.
    const whileDead = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(whileDead).toEqual({ settled: true, value: { title: 'answered on B' } });

    // A's grace expiry removes A's slot and leaves B's presence standing.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(a.relay.getTransportDiagnostics().parkedTabs).toEqual([]);
    expect(await busA.isTabKnown('tab-a')).toBe(true);

    // A command published for the tab runs once, on B.
    const afterExpiry = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(afterExpiry).toEqual({ settled: true, value: { title: 'answered on B' } });
    expect(ran).toEqual(['B', 'B']);
  });

  it('11b · during a cross-instance rotation a command published from a third instance runs once, on the replacement: the rotated stream defers to the instance holding the tab too (review A2, W2)', async () => {
    const server = new FakeRedisServer();
    const a = rig({ bus: redisBus(server, 'A') });
    const b = rig({ bus: redisBus(server, 'B') });
    const c = rig({ bus: redisBus(server, 'C') });
    const ran: string[] = [];

    await openStream(a.routes, a.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('A', ran),
    });
    await vi.advanceTimersByTimeAsync(50_000); // A sends its rotate frame
    await openStream(b.routes, b.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('B', ran),
    });

    // Inside the window: A's stream is draining, B's is up, and both are
    // subscribed. C publishes; A sees B holding the tab and leaves it to B.
    expect(server.subscribers('uibridge:cmd:tab:tab-a')).toEqual(['A.sub', 'B.sub']);
    const fromC = track(c.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fromC).toEqual({ settled: true, value: { title: 'answered on B' } });
    expect(ran).toEqual(['B']);

    // A keeps its own dispatch until its stream ends: a command dispatched on
    // A goes down its draining stream.
    const onA = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onA).toEqual({ settled: true, value: { title: 'answered on A' } });
    expect(ran).toEqual(['B', 'A']);
  });

  it('11c · a rotate nobody answered on A while the page streams on B: A awaits the tab, and a command for it dispatched on A goes over the bus to B (control)', async () => {
    const server = new FakeRedisServer();
    const a = rig({ bus: redisBus(server, 'A') });
    const b = rig({ bus: redisBus(server, 'B') });
    const ran: string[] = [];

    const onA = await openStream(a.routes, a.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('A', ran),
    });
    await vi.advanceTimersByTimeAsync(50_000);
    await openStream(b.routes, b.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('B', ran),
    });
    await vi.advanceTimersByTimeAsync(10_000); // A: rotate_unanswered
    expect(onA.done()).toBe(true);

    const fromA = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fromA).toEqual({ settled: true, value: { title: 'answered on B' } });
    expect(ran).toEqual(['B']);
  });

  it('11d · a rotated stream whose replacement has not registered anywhere still takes a command published from another instance (review W2)', async () => {
    const server = new FakeRedisServer();
    const a = rig({ bus: redisBus(server, 'A') });
    const c = rig({ bus: redisBus(server, 'C') });
    const ran: string[] = [];

    await openStream(a.routes, a.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('A', ran),
    });
    await vi.advanceTimersByTimeAsync(50_000); // A sends its rotate frame; nothing replaces it yet

    const fromC = track(c.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fromC).toEqual({ settled: true, value: { title: 'answered on A' } });
    expect(ran).toEqual(['A']);
  });

  it('11e · a replacement that registers on the same instance while the rotated stream’s handler waits for holdsElsewhere gets the command, once (re-review)', async () => {
    const server = new FakeRedisServer();
    const busA = redisBus(server, 'A');
    const a = rig({ bus: busA });
    const c = rig({ bus: redisBus(server, 'C') });
    const ran: string[] = [];
    // A's answer to holdsElsewhere is held until the replacement has registered.
    const holdsElsewhere = busA.holdsElsewhere.bind(busA);
    let answer: () => void = () => undefined;
    busA.holdsElsewhere = (tabId) =>
      new Promise((resolve) => {
        answer = () => resolve(holdsElsewhere(tabId));
      });

    await openStream(a.routes, a.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('A, rotated', ran),
    });
    await vi.advanceTimersByTimeAsync(50_000); // A sends its rotate frame
    const fromC = track(c.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0); // A's rotated stream is waiting on holdsElsewhere
    await openStream(a.routes, a.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('A, replacement', ran),
    });
    answer();
    await vi.advanceTimersByTimeAsync(0);

    expect(fromC).toEqual({ settled: true, value: { title: 'answered on A, replacement' } });
    expect(ran).toEqual(['A, replacement']);
  });

  it('A5 · at grace expiry a command parked on A goes over the bus once the page streams on B, instead of failing (review A5)', async () => {
    const server = new FakeRedisServer();
    const a = rig({ bus: redisBus(server, 'A') });
    const b = rig({ bus: redisBus(server, 'B') });
    const ran: string[] = [];

    const onA = await openStream(a.routes, a.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('A', ran),
    });
    await onA.cancel(); // A parks the slot; no instance holds the tab now
    const parked = track(a.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(parked.settled).toBe(false);

    // The page's next stream lands on B; then A's grace ends.
    await openStream(b.routes, b.relay, 'tab-a', {
      caps: 'rotate,dedupe',
      cid: 'page-1',
      answer: answerOn('B', ran),
    });
    await vi.advanceTimersByTimeAsync(4_000);

    expect(parked).toEqual({ settled: true, value: { title: 'answered on B' } });
    expect(ran).toEqual(['B']);
  });
});

describe('relay parked slot · review fixes S A8, S A9', () => {
  it('A8 · a slot that dies while this instance holds a connected WebSocket client for the tab keeps the instance’s presence', async () => {
    const server = new FakeRedisServer();
    const busB = redisBus(server, 'B');
    const { relay, routes } = rig({ bus: redisBus(server, 'A') });
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    relay.registerWebSocketClient({
      clientId: 'tab-a',
      send: () => undefined,
      isConnected: () => true,
      close: () => undefined,
    });

    await first.cancel();
    // The dead slot dropped its own subscription; the one left is the
    // WebSocket client's, through which the instance still holds the tab.
    expect(server.subscribers('uibridge:cmd:tab:tab-a')).toEqual(['A.sub']);
    expect(await busB.isTabKnown('tab-a')).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000); // the dead slot's grace ends
    expect(await busB.isTabKnown('tab-a')).toBe(true);
  });

  it('A9 · a command flushed down the replacement gets a whole timeout from the flush', async () => {
    const { relay, routes } = rig();
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await first.cancel();
    const parked = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(4_000);

    // Flushed 4 s after it was sent, down a stream that never answers.
    const second = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    expect(second.actions).toEqual(['getTabInfo']);

    await vi.advanceTimersByTimeAsync(7_999);
    expect(parked.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect({
      settled: parked.settled,
      message: (parked.error as Error | undefined)?.message,
    }).toEqual({
      settled: true,
      message:
        'Command getTabInfo timed out after 8000ms (SSE). 1 client(s) were notified but none responded. ' +
        'The UI Bridge SDK may not be loaded or the page may be unresponsive.',
    });
  });
});

describe('relay · a tab held through a WebSocket client on the bus (review W3, S4)', () => {
  it('W3 · a command published for a tab another instance holds only through a WebSocket client reaches that client', async () => {
    const server = new FakeRedisServer();
    const a = rig({ bus: redisBus(server, 'A') });
    const b = rig({ bus: redisBus(server, 'B') });
    const onA = webSocketTab(a.relay, 'tab-w', {
      getTabInfo: () => ({ title: 'over A’s WebSocket' }),
    });

    const fromB = track(b.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-w' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fromB).toEqual({ settled: true, value: { title: 'over A’s WebSocket' } });
    expect(onA.actions).toEqual(['getTabInfo']);
  });

  it('W3 · a WebSocket client that disconnects withdraws its instance’s presence for the tab', async () => {
    const server = new FakeRedisServer();
    const busB = redisBus(server, 'B');
    const a = rig({ bus: redisBus(server, 'A') });
    webSocketTab(a.relay, 'tab-w', {});
    await vi.advanceTimersByTimeAsync(10_000); // a sweep re-announces it
    expect(await busB.isTabKnown('tab-w')).toBe(true);

    a.relay.unregisterWebSocketClient('tab-w');
    await vi.advanceTimersByTimeAsync(0);
    expect(await busB.isTabKnown('tab-w')).toBe(false);
  });

  it('W3 · the presence a dead slot kept for a WebSocket client is withdrawn when that client disconnects', async () => {
    const server = new FakeRedisServer();
    const busB = redisBus(server, 'B');
    const { relay, routes } = rig({ bus: redisBus(server, 'A') });
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    webSocketTab(relay, 'tab-a', {});
    await first.cancel();
    await vi.advanceTimersByTimeAsync(5_000); // the dead slot's grace ends
    expect(await busB.isTabKnown('tab-a')).toBe(true);

    relay.unregisterWebSocketClient('tab-a');
    await vi.advanceTimersByTimeAsync(0);
    expect(await busB.isTabKnown('tab-a')).toBe(false);
  });

  it('W3 · a tab held here through an SSE stream and a WebSocket client runs a published command once, down the stream (control)', async () => {
    const server = new FakeRedisServer();
    const a = rig({ bus: redisBus(server, 'A') });
    const b = rig({ bus: redisBus(server, 'B') });
    const ran: string[] = [];
    await openStream(a.routes, a.relay, 'tab-a', {
      answer: {
        getTabInfo: () => {
          ran.push('stream');
          return { title: 'down the stream' };
        },
      },
    });
    webSocketTab(a.relay, 'tab-a', {
      getTabInfo: () => {
        ran.push('websocket');
        return { title: 'over the WebSocket' };
      },
    });

    const fromB = track(b.relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fromB).toEqual({ settled: true, value: { title: 'down the stream' } });
    expect(ran).toEqual(['stream']);
  });

  it('W3 · a zombie stream the prune drops withdraws its instance’s presence at once', async () => {
    const server = new FakeRedisServer();
    const busB = redisBus(server, 'B');
    const { relay, routes } = rig({ bus: redisBus(server, 'A'), legacyStreamLeaseMs: 600_000 });
    await openStream(routes, relay, 'tab-a');
    relay.receiveHeartbeat('tab-a'); // its last: the prune drops it once that is over 300 s old
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await busB.isTabKnown('tab-a')).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000); // the sweep at 310 s prunes it
    expect(relay.getTransportDiagnostics().connectedTabs).toEqual([]);
    expect(await busB.isTabKnown('tab-a')).toBe(false);
  });

  it('S4 · at grace expiry a command parked on a dead slot goes to a WebSocket client of the tab that connected here meanwhile', async () => {
    const { relay, routes } = rig();
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await first.cancel();
    const parked = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(1_000);
    const ws = webSocketTab(relay, 'tab-a', {
      getTabInfo: () => ({ title: 'over the WebSocket' }),
    });
    expect(parked.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(4_000); // the dead slot's grace ends
    expect(parked).toEqual({ settled: true, value: { title: 'over the WebSocket' } });
    expect(ws.actions).toEqual(['getTabInfo']);
  });

  it('S4 · at grace expiry a tab known only through a stale retired `uibridge:tab:<id>` key is not held by another instance: the parked command fails at once', async () => {
    const server = new FakeRedisServer();
    const { relay, routes } = rig({ bus: redisBus(server, 'A') });
    const first = await openStream(routes, relay, 'tab-a', { caps: 'rotate', cid: 'page-1' });
    await first.cancel();
    const parked = track(relay.queueCommand('getTabInfo', {}, { targetTabId: 'tab-a' }));
    await vi.advanceTimersByTimeAsync(1_000);
    void server.client('O').set('uibridge:tab:tab-a', '1', 'EX', 60);

    await vi.advanceTimersByTimeAsync(4_000); // the dead slot's grace ends
    expect({
      settled: parked.settled,
      message: (parked.error as Error | undefined)?.message,
    }).toEqual({ settled: true, message: NOT_DELIVERED_GET_TAB_INFO });
  });
});
