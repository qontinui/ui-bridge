/**
 * The Redis relay bus's contract with the consumer that injects its client
 * (plan 2026-11-09-webpack-bundles-the-relay-sdks-ioredis-import-so-the-
 * deployed-relay-bus-never-starts, Phase 1).
 *
 * The bus used to load ioredis itself, through `await import(specifier)`. A
 * consumer that BUNDLES the SDK (qontinui-web, through webpack) turned that into
 * an expression context it could not resolve, so the deployed bus never started
 * and the relay reported `in-memory-degraded`. The bus now constructs the
 * consumer's own statically imported Redis class — REQUIRED — and never loads a
 * Redis client of its own; it reports readiness read live from both of its
 * connections; and it handles the rejection of every write it fires and forgets.
 *
 * Every client here is a fake that records how it was constructed and what it
 * was asked to do. `ioredis` itself is mocked with a factory that COUNTS its own
 * evaluations, and each test loads a fresh copy of the bus module, so a bus that
 * loads a Redis client of its own shows up as a count above zero.
 *
 * `npm run typecheck` compiles this file (packages/ui-bridge/tsconfig.type-tests.json),
 * so the `@ts-expect-error` below is a real assertion: the typecheck fails if a
 * call without the constructor ever type-checks again.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RedisConstructorLike, RelayBusReadiness } from './relay-bus';

const ioredisModule = vi.hoisted(() => ({ evaluations: 0 }));

vi.mock('ioredis', () => {
  ioredisModule.evaluations += 1;
  return {
    default: class {
      constructor() {
        throw new Error('the relay bus constructed a Redis client of its own');
      }
    },
  };
});

/** A fresh copy of the bus module, so no test can lean on another's cached `ioredis` evaluation. */
async function loadRelayBus() {
  vi.resetModules();
  ioredisModule.evaluations = 0;
  return import('./relay-bus');
}

/** ioredis's connection statuses (ioredis 5.11.1 `built/Redis.d.ts`, `RedisStatus`). */
type Status = 'wait' | 'reconnecting' | 'connecting' | 'connect' | 'ready' | 'close' | 'end';
/**
 * `never[]`, not `unknown[]`: TypeScript compares a callback's parameters
 * covariantly, so only `never` (or ioredis's own `any`) accepts both of
 * RedisLike's listener shapes, `(channel, message)` and `(err)`.
 */
type Listener = (...args: never[]) => void;

interface FakeBehaviour {
  /** When set, every write (publish, subscribe, unsubscribe, set, del) returns a promise rejected with it. */
  rejectWritesWith?: unknown;
}

/**
 * A structural Redis client: a settable `status`, `on` handlers that `emit`
 * fires, every write recorded, and a `duplicate()` that inherits the options it
 * was constructed with, as ioredis's does.
 */
class FakeClient {
  status: Status = 'wait';
  readonly writes: string[] = [];
  readonly duplicateCalls: unknown[][] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly url: string,
    readonly options: Record<string, unknown> | undefined,
    private readonly behaviour: FakeBehaviour,
    private readonly registry: FakeClient[]
  ) {
    registry.push(this);
  }

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  /** Fire `event` at its listeners; returns how many there were. */
  emit(event: string, ...args: unknown[]): number {
    const listeners = this.listeners.get(event) ?? [];
    for (const listener of listeners) (listener as (...received: unknown[]) => void)(...args);
    return listeners.length;
  }

  private write(name: string): Promise<unknown> {
    this.writes.push(name);
    if (this.behaviour.rejectWritesWith === undefined) return Promise.resolve('OK');
    return Promise.reject(this.behaviour.rejectWritesWith);
  }

  publish(_channel: string, _message: string): Promise<unknown> {
    return this.write('publish');
  }
  subscribe(..._channels: string[]): Promise<unknown> {
    return this.write('subscribe');
  }
  unsubscribe(..._channels: string[]): Promise<unknown> {
    return this.write('unsubscribe');
  }
  set(_key: string, _value: string, _mode: string, _ttlSeconds: number): Promise<unknown> {
    return this.write('set');
  }
  del(_key: string): Promise<unknown> {
    return this.write('del');
  }
  exists(_key: string): Promise<number> {
    return Promise.resolve(0);
  }
  quit(): Promise<unknown> {
    return Promise.resolve('OK');
  }
  duplicate(...args: unknown[]): FakeClient {
    this.duplicateCalls.push(args);
    return new FakeClient(this.url, this.options, this.behaviour, this.registry);
  }
}

interface FakeRedis {
  /** The constructor a consumer injects. */
  Redis: RedisConstructorLike;
  /** The arguments of every `new Redis(...)`, in order. `duplicate()` is not a construction. */
  constructed: Array<[string, Record<string, unknown> | undefined]>;
  /** Every client in existence: `[0]` the publisher, `[1]` its duplicate, the subscriber. */
  clients: FakeClient[];
}

function fakeRedis(behaviour: FakeBehaviour = {}): FakeRedis {
  const constructed: FakeRedis['constructed'] = [];
  const clients: FakeClient[] = [];
  class Redis extends FakeClient {
    constructor(url: string, options?: Record<string, unknown>) {
      super(url, options, behaviour, clients);
      constructed.push([url, options]);
    }
  }
  return { Redis, constructed, clients };
}

/**
 * What the bus sees of a Redis server's error reply: an Error named
 * `ReplyError`. That is redis-errors' `ReplyError` (ioredis's reply errors),
 * whose `name` getter returns its constructor's name.
 */
class ReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplyError';
  }
}

/** A Node system error: its message spells the host it dialled; `code`/`syscall` do not. */
function systemError(message: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error(message), fields);
}

/** Let rejection handlers — and Node's unhandled-rejection detection — run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const RATE_LIMITED = 'ERR Your database has been temporarily rate-limited';

describe('createRedisRelayBus — the consumer injects the Redis constructor', () => {
  it('(1) constructs the injected class once with the trimmed URL, duplicates it once, and never loads ioredis', async () => {
    const { createRedisRelayBus, RedisRelayBus } = await loadRelayBus();
    const { Redis, constructed, clients } = fakeRedis();

    const bus = await createRedisRelayBus(' redis://h:1 ', { Redis });

    expect(bus).toBeInstanceOf(RedisRelayBus);
    expect(constructed).toEqual([['redis://h:1', undefined]]);
    expect(clients).toHaveLength(2);
    expect(clients[0].duplicateCalls).toEqual([[]]);
    expect(clients[1].duplicateCalls).toEqual([]);
    expect(ioredisModule.evaluations).toBe(0);
  });

  it('(1) RedisRelayBus.create constructs the injected class the same way', async () => {
    const { RedisRelayBus } = await loadRelayBus();
    const { Redis, constructed, clients } = fakeRedis();

    const bus = await RedisRelayBus.create('redis://h:2', { Redis });

    expect(bus).toBeInstanceOf(RedisRelayBus);
    expect(constructed).toEqual([['redis://h:2', undefined]]);
    expect(clients).toHaveLength(2);
    expect(ioredisModule.evaluations).toBe(0);
  });

  it('(2) an untyped caller that passes no Redis constructor is refused with RelayBusInitError, and ioredis is never loaded', async () => {
    const { createRedisRelayBus, RedisRelayBus, RelayBusInitError } = await loadRelayBus();
    type Untyped = (url: string, options?: unknown) => Promise<unknown>;
    const untypedCreate = createRedisRelayBus as unknown as Untyped;
    const untypedStatic = RedisRelayBus.create.bind(RedisRelayBus) as unknown as Untyped;

    for (const options of [
      undefined,
      {},
      { Redis: undefined },
      { Redis: 'ioredis' },
      { redisOptions: {} },
    ]) {
      for (const create of [untypedCreate, untypedStatic]) {
        const refusal = create('redis://h:1', options);
        await expect(refusal).rejects.toBeInstanceOf(RelayBusInitError);
        await expect(refusal).rejects.toMatchObject({
          name: 'RelayBusInitError',
          code: 'RELAY_BUS_REDIS_CONSTRUCTOR_REQUIRED',
        });
      }
    }
    expect(ioredisModule.evaluations).toBe(0);
  });

  it('(3) a one-argument call does not type-check, and is refused at run time', async () => {
    const { createRedisRelayBus, RelayBusInitError } = await loadRelayBus();

    // @ts-expect-error -- the Redis constructor is required (plan D1); `npm run typecheck` enforces this line.
    const refusal = createRedisRelayBus('redis://h:1');

    await expect(refusal).rejects.toBeInstanceOf(RelayBusInitError);
    await expect(refusal).rejects.toMatchObject({ code: 'RELAY_BUS_REDIS_CONSTRUCTOR_REQUIRED' });
    expect(ioredisModule.evaluations).toBe(0);
  });

  it('(5) redisOptions reach the constructor as its second argument; the subscriber inherits them through duplicate()', async () => {
    const { createRedisRelayBus } = await loadRelayBus();
    const { Redis, constructed, clients } = fakeRedis();

    await createRedisRelayBus('redis://h:1', { Redis, redisOptions: { lazyConnect: true } });

    expect(constructed).toEqual([['redis://h:1', { lazyConnect: true }]]);
    expect(clients[0].duplicateCalls).toEqual([[]]);
    expect(clients[1].options).toEqual({ lazyConnect: true });
  });

  it('(8) an empty, whitespace or absent URL is the in-memory default: null, and nothing is constructed', async () => {
    const { createRedisRelayBus } = await loadRelayBus();
    const { Redis, constructed, clients } = fakeRedis();

    for (const url of ['', '   ', '\n\t', undefined, null]) {
      expect(await createRedisRelayBus(url, { Redis })).toBeNull();
    }
    expect(constructed).toEqual([]);
    expect(clients).toEqual([]);
    expect(ioredisModule.evaluations).toBe(0);
  });
});

describe('RedisRelayBus.readiness — read live from both connections, sending no Redis command', () => {
  const PAIRS: Array<[Status, Status, RelayBusReadiness['state']]> = [
    ['ready', 'ready', 'ready'],
    ['ready', 'connecting', 'not-ready'],
    ['reconnecting', 'ready', 'not-ready'],
    ['wait', 'wait', 'not-ready'],
    ['end', 'ready', 'closed'],
    ['ready', 'end', 'closed'],
    // Every other status, in each position.
    ['connect', 'ready', 'not-ready'],
    ['ready', 'close', 'not-ready'],
    ['close', 'reconnecting', 'not-ready'],
    ['end', 'end', 'closed'],
    ['reconnecting', 'end', 'closed'],
  ];

  it.each(PAIRS)('(4) pub %s, sub %s → %s', async (pub, sub, state) => {
    const { createRedisRelayBus } = await loadRelayBus();
    const { Redis, clients } = fakeRedis();
    const bus = await createRedisRelayBus('redis://h:1', { Redis });
    clients[0].status = pub;
    clients[1].status = sub;

    expect(bus?.readiness()).toEqual({ state, pub, sub, lastError: null });
    expect(clients[0].writes).toEqual([]);
    expect(clients[1].writes).toEqual([]);
  });

  it('(4) follows the connections as they change, with no re-construction', async () => {
    const { createRedisRelayBus } = await loadRelayBus();
    const { Redis, constructed, clients } = fakeRedis();
    const bus = await createRedisRelayBus('redis://h:1', { Redis });

    clients[0].status = 'ready';
    clients[1].status = 'ready';
    expect(bus?.readiness().state).toBe('ready');
    clients[1].status = 'reconnecting';
    expect(bus?.readiness().state).toBe('not-ready');
    clients[1].status = 'ready';
    expect(bus?.readiness().state).toBe('ready');
    expect(constructed).toHaveLength(1);
  });
});

describe('RedisRelayBus — every fire-and-forget write handles its rejection', () => {
  it('(6) a client whose every write rejects raises no unhandledRejection, and lastError carries the rendered error', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { createRedisRelayBus } = await loadRelayBus();
      const { Redis, clients } = fakeRedis({ rejectWritesWith: new ReplyError(RATE_LIMITED) });
      const bus = await createRedisRelayBus('redis://h:1', { Redis });
      if (!bus) throw new Error('expected a bus');

      const offCommands = bus.subscribeCommands('tab-1', () => undefined);
      const offResponse = bus.subscribeResponse('cmd-1', () => undefined);
      bus.publishCommand({
        commandId: 'cmd-1',
        action: 'click',
        payload: null,
        timestamp: 1,
        targetTabId: 'tab-1',
      });
      bus.publishCommand({ commandId: 'cmd-2', action: 'click', payload: null, timestamp: 2 });
      bus.publishResponse({ commandId: 'cmd-1', ok: true, result: null });
      bus.registerTab('tab-1', 30);
      bus.unregisterTab('tab-1');
      offCommands();
      offResponse();

      // Every write was attempted — the publisher's and the subscriber's.
      expect(clients[0].writes).toEqual(['publish', 'publish', 'publish', 'set', 'del']);
      expect(clients[1].writes).toEqual([
        'subscribe',
        'subscribe',
        'subscribe',
        'unsubscribe',
        'unsubscribe',
        'unsubscribe',
      ]);

      await settle();

      expect(unhandled).toEqual([]);
      expect(bus.readiness().lastError).toBe(RATE_LIMITED);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      warn.mockRestore();
    }
  });

  it('(6) logs failures at most once per minute per process, in the rendered (credential-free) form', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const { createRedisRelayBus } = await loadRelayBus();
      const refusal = new ReplyError(
        'ERR max requests limit exceeded for rediss://default:s3cr3t@top-yeti:6379'
      );
      const { Redis, clients } = fakeRedis({ rejectWritesWith: refusal });
      const bus = await createRedisRelayBus('redis://h:1', { Redis });
      if (!bus) throw new Error('expected a bus');

      bus.registerTab('tab-1', 30);
      bus.registerTab('tab-2', 30);
      await settle();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual([
        '[ui-bridge] relay bus set failed: ERR max requests limit exceeded for rediss://top-yeti:6379 ' +
          '(further relay bus errors in the next 60 s are not logged; readiness().lastError keeps the latest)',
      ]);

      // The same budget covers connection errors: still inside the minute, so not logged...
      now.mockReturnValue(1_000_000 + 59_999);
      clients[1].emit(
        'error',
        systemError('getaddrinfo ENOTFOUND top-yeti', { code: 'ENOTFOUND', syscall: 'getaddrinfo' })
      );
      bus.unregisterTab('tab-1');
      await settle();
      expect(warn).toHaveBeenCalledTimes(1);
      // ...but still recorded.
      expect(bus.readiness().lastError).toBe(
        'ERR max requests limit exceeded for rediss://top-yeti:6379'
      );

      // A minute after the last logged line, the next failure is logged again.
      now.mockReturnValue(1_000_000 + 60_000);
      clients[0].emit(
        'error',
        systemError('connect ECONNREFUSED 10.0.0.7:6399', {
          code: 'ECONNREFUSED',
          syscall: 'connect',
        })
      );
      bus.unregisterTab('tab-2');
      await settle();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[1]).toEqual([
        '[ui-bridge] relay bus pub connection error: ECONNREFUSED connect ' +
          '(further relay bus errors in the next 60 s are not logged; readiness().lastError keeps the latest)',
      ]);
      for (const call of warn.mock.calls) expect(String(call[0])).not.toContain('s3cr3t');
    } finally {
      warn.mockRestore();
      now.mockRestore();
    }
  });
});

describe('RedisRelayBus.readiness().lastError — a closed shape, never URL-derived client text', () => {
  async function busWithClients() {
    const { createRedisRelayBus } = await loadRelayBus();
    const fake = fakeRedis();
    const bus = await createRedisRelayBus('redis://h:1', { Redis: fake.Redis });
    if (!bus) throw new Error('expected a bus');
    return { bus, pub: fake.clients[0], sub: fake.clients[1] };
  }

  it('listens for `error` on both connections (ioredis prints an unhandled error event otherwise)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { bus, pub, sub } = await busWithClients();
      expect(pub.emit('error', new ReplyError('ERR from pub'))).toBe(1);
      expect(bus.readiness().lastError).toBe('ERR from pub');
      expect(sub.emit('error', new ReplyError('ERR from sub'))).toBe(1);
      expect(bus.readiness().lastError).toBe('ERR from sub');
    } finally {
      warn.mockRestore();
    }
  });

  it('(7) renders each error class in its closed shape', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { bus, pub, sub } = await busWithClients();
      const lastErrorAfter = (error: unknown, client = pub) => {
        client.emit('error', error);
        return bus.readiness().lastError;
      };

      // A server reply carrying a credential span: stripped, then cut to 160 characters.
      const long = new ReplyError(
        `ERR bad target rediss://user:s3cr3t@host:6379 ${'x'.repeat(300)}`
      );
      const rendered = lastErrorAfter(long);
      expect(rendered).not.toContain('s3cr3t');
      expect(rendered).not.toContain('user:');
      expect(rendered).toHaveLength(160);
      expect(rendered).toBe(`ERR bad target rediss://host:6379 ${'x'.repeat(300)}`.slice(0, 160));

      // A Node system error: `<code> <syscall>` only — never its hostname, address, port or message.
      expect(
        lastErrorAfter(
          systemError('getaddrinfo ENOTFOUND AXs3cr3t', {
            code: 'ENOTFOUND',
            syscall: 'getaddrinfo',
            hostname: 'AXs3cr3t',
            errno: -3008,
          })
        )
      ).toBe('ENOTFOUND getaddrinfo');
      expect(
        lastErrorAfter(
          systemError('connect ECONNREFUSED 10.0.0.7:6399', {
            code: 'ECONNREFUSED',
            syscall: 'connect',
            address: '10.0.0.7',
            port: 6399,
          }),
          sub
        )
      ).toBe('ECONNREFUSED connect');

      // The provider's refusal, as ioredis delivers it, and as its ready-check wrapper spells it.
      expect(lastErrorAfter(new ReplyError(RATE_LIMITED))).toBe(RATE_LIMITED);
      expect(lastErrorAfter(new Error(`Ready check failed: ${RATE_LIMITED}`))).toBe(
        `Ready check failed: ${RATE_LIMITED}`
      );
      expect(
        lastErrorAfter(new Error('Ready check failed: ERR auth rediss://user:s3cr3t@host:6379'))
      ).toBe('Ready check failed: ERR auth rediss://host:6379');

      // Anything else: its name, whatever its message says.
      expect(lastErrorAfter(new Error('connect to rediss://user:s3cr3t@host:6379 failed'))).toBe(
        'Error'
      );
      class MaxRetriesPerRequestError extends Error {
        constructor() {
          super('Reached the max retries per request limit (which is 20).');
          this.name = 'MaxRetriesPerRequestError';
        }
      }
      expect(lastErrorAfter(new MaxRetriesPerRequestError())).toBe('MaxRetriesPerRequestError');
      // Not an Error at all: a label, never the value.
      expect(lastErrorAfter('rediss://user:s3cr3t@host:6379')).toBe('non-Error value');
      expect(lastErrorAfter({ message: 'rediss://user:s3cr3t@host:6379' })).toBe('non-Error value');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('RedisRelayBus — the review follow-ups', () => {
  it('(7) never renders the configured password, even in a server reply that repeats it bare', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { createRedisRelayBus } = await loadRelayBus();
      const fake = fakeRedis();
      const bus = await createRedisRelayBus('rediss://default:pw%2Fs3cr3t@host:6379', {
        Redis: fake.Redis,
      });
      if (!bus) throw new Error('expected a bus');

      fake.clients[0].emit('error', new ReplyError('ERR invalid password pw/s3cr3t'));
      expect(bus.readiness().lastError).toBe('ERR invalid password [redacted]');
      fake.clients[1].emit('error', new ReplyError('ERR auth pw%2Fs3cr3t refused'));
      expect(bus.readiness().lastError).toBe('ERR auth [redacted] refused');
      for (const call of warn.mock.calls) expect(String(call[0])).not.toContain('s3cr3t');
    } finally {
      warn.mockRestore();
    }
  });

  it('a failed isTabKnown read is recorded in lastError and answers false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { createRedisRelayBus } = await loadRelayBus();
      const fake = fakeRedis();
      const bus = await createRedisRelayBus('redis://h:1', { Redis: fake.Redis });
      if (!bus) throw new Error('expected a bus');
      fake.clients[0].exists = () => Promise.reject(new ReplyError(RATE_LIMITED));

      expect(await bus.isTabKnown('tab-1')).toBe(false);
      expect(bus.readiness().lastError).toBe(RATE_LIMITED);
    } finally {
      warn.mockRestore();
    }
  });

  it('a client whose write throws synchronously does not throw out of the bus, and is recorded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { createRedisRelayBus } = await loadRelayBus();
      const fake = fakeRedis();
      const bus = await createRedisRelayBus('redis://h:1', { Redis: fake.Redis });
      if (!bus) throw new Error('expected a bus');
      fake.clients[0].publish = () => {
        throw new ReplyError('ERR thrown, not rejected');
      };

      expect(() =>
        bus.publishCommand({ commandId: 'c', action: 'click', payload: null, timestamp: 1 })
      ).not.toThrow();
      await settle();
      expect(bus.readiness().lastError).toBe('ERR thrown, not rejected');
    } finally {
      warn.mockRestore();
    }
  });

  it('a duplicate() that throws rejects the create and closes the publisher it built', async () => {
    const { createRedisRelayBus } = await loadRelayBus();
    const quits: string[] = [];
    class Redis extends fakeRedis().Redis {
      duplicate(): FakeClient {
        throw new Error('no second connection');
      }
      quit(): Promise<unknown> {
        quits.push('quit');
        return Promise.resolve('OK');
      }
    }

    await expect(createRedisRelayBus('redis://h:1', { Redis })).rejects.toThrow(
      'no second connection'
    );
    await settle();
    expect(quits).toEqual(['quit']);
  });
});
