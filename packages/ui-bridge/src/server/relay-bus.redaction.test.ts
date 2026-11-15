/**
 * RedisRelayBus never lets a Redis credential reach a log or an unhandled-error
 * printer. ioredis puts the secret on error PROPERTIES (`ReplyError.command.args`
 * for a rejected AUTH, `ERR_INVALID_URL`'s `input`), never in `message`, so a
 * logger that serialises the error object prints it.
 *
 * The first block drives the bus with a fake client (the error shapes ioredis
 * produces). The second runs the REAL ioredis against a local socket server that
 * answers the handshake with -WRONGPASS and captures every console / stdio byte.
 */
import net from 'node:net';
import util from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RedisRelayBus,
  createRedisRelayBus,
  redactRedisUserinfo,
  summarizeRedisError,
  type RelayBusErrorSummary,
} from './relay-bus';

const SECRET = 'SECRETPW123';

type Listener = (...args: unknown[]) => void;

function fakeClient() {
  const listeners = new Map<string, Listener[]>();
  const client = {
    on(event: string, cb: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    },
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    zadd: vi.fn(async () => 0),
    zrem: vi.fn(async () => 0),
    zremrangebyscore: vi.fn(async () => 0),
    zcount: vi.fn(async () => 0),
    zscore: vi.fn(async () => null),
    eval: vi.fn(async () => 1),
    zrange: vi.fn(async () => []),
    pexpireat: vi.fn(async () => 1),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    exists: vi.fn(async () => 0),
    quit: vi.fn(async () => 'OK'),
    duplicate: vi.fn(),
  };
  return client;
}

/** The shape ioredis gives a rejected AUTH: secret on `command`, none in message/stack. */
function replyErrorWithCommand(): Error {
  const err = new Error('WRONGPASS invalid username-password pair or user is disabled.');
  err.name = 'ReplyError';
  Object.assign(err, { command: { name: 'auth', args: ['default', SECRET] } });
  return err;
}

function makeBus(onError?: (s: RelayBusErrorSummary) => void) {
  const pub = fakeClient();
  const sub = fakeClient();
  const bus = new (RedisRelayBus as unknown as new (
    p: unknown,
    s: unknown,
    o: { onError?: (s: RelayBusErrorSummary) => void }
  ) => RedisRelayBus)(pub, sub, { onError });
  return { bus, pub, sub };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('redactRedisUserinfo / summarizeRedisError', () => {
  it('redacts scheme userinfo and scheme-less user:pass@', () => {
    expect(
      redactRedisUserinfo(`getaddrinfo ENOTFOUND redis://default:${SECRET}@h:6379`)
    ).not.toContain(SECRET);
    expect(redactRedisUserinfo(`bad url default:${SECRET}@host:6379`)).not.toContain(SECRET);
    // a password holding `@` is cut by the generic pattern unless known secrets go first
    expect(
      redactRedisUserinfo('connect ECONNREFUSED p@ss' + SECRET + '@h:6379', ['p@ss' + SECRET])
    ).not.toContain(SECRET);
    // a long message is bounded
    expect(redactRedisUserinfo('=,'.repeat(40_000)).length).toBeLessThanOrEqual(600);
    // ioredis' ENOENT message for a password holding `/`
    expect(redactRedisUserinfo(`connect ENOENT /:SEC/RET${SECRET}@127.0.0.1:6379`)).not.toContain(
      SECRET
    );
  });

  it('builds a summary from scalar fields only, never the command or input', () => {
    const err = replyErrorWithCommand();
    Object.assign(err, { input: `redis://default:${SECRET}@h:6379` });
    const summary = summarizeRedisError(err, 'pub');
    expect(Object.keys(summary).sort()).toEqual(['code', 'message', 'name', 'role']);
    expect(util.inspect(summary)).not.toContain(SECRET);
    expect(summary.name).toBe('ReplyError');
  });
});

describe('RedisRelayBus with a fake client', () => {
  it('reports a ReplyError carrying command.args through onError with no secret', () => {
    const seen: RelayBusErrorSummary[] = [];
    const { pub, sub } = makeBus((s) => seen.push(s));
    pub.emit('error', replyErrorWithCommand());
    sub.emit('error', replyErrorWithCommand());
    expect(seen.map((s) => s.role)).toEqual(['pub', 'sub']);
    expect(util.inspect(seen, { depth: 10 })).not.toContain(SECRET);
  });

  it('default onError is a rate-limited console.warn with no secret', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { pub } = makeBus();
    pub.emit('error', replyErrorWithCommand());
    pub.emit('error', replyErrorWithCommand());
    expect(warn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    pub.emit('error', replyErrorWithCommand());
    expect(warn).toHaveBeenCalledTimes(2);
    expect(util.inspect(warn.mock.calls, { depth: 10 })).not.toContain(SECRET);
  });

  it('a rejected publish is swallowed and reported sanitised, not left unhandled', async () => {
    const seen: RelayBusErrorSummary[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { bus, pub } = makeBus((s) => seen.push(s));
      pub.publish.mockReturnValue(Promise.reject(replyErrorWithCommand()));
      bus.publishResponse({ commandId: 'c1' } as never);
      bus.publishCommand({ id: 'c1' } as never);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      expect(seen.length).toBeGreaterThan(0);
      expect(util.inspect(seen, { depth: 10 })).not.toContain(SECRET);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a throwing onError does not escape', () => {
    const { pub } = makeBus(() => {
      throw new Error('reporter bug');
    });
    expect(() => pub.emit('error', replyErrorWithCommand())).not.toThrow();
  });
});

/** Capture every byte the process would print while `fn` runs. */
async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const push = (...args: unknown[]) => {
    chunks.push(
      args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 10 }))).join(' ')
    );
  };
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(push)
  );
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
    push(String(c));
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
    push(String(c));
    return true;
  });
  const onUnhandled = (reason: unknown) => push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await fn();
  } finally {
    process.off('unhandledRejection', onUnhandled);
    for (const s of spies) s.mockRestore();
    out.mockRestore();
    err.mockRestore();
  }
  return chunks.join('\n');
}

describe('RedisRelayBus with the real ioredis (tripwire)', () => {
  it('prints no credential when the server answers AUTH with -WRONGPASS', async () => {
    const server = net.createServer((socket) => {
      socket.on('data', () => socket.write('-WRONGPASS invalid username-password pair\r\n'));
      socket.on('error', () => undefined);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    let bus: RelayBus | null = null;
    type RelayBus = Awaited<ReturnType<typeof createRedisRelayBus>>;
    const summaries: RelayBusErrorSummary[] = [];
    try {
      const printed = await captureOutput(async () => {
        bus = await createRedisRelayBus(`default:${SECRET}@127.0.0.1:${port}`, {
          onError: (s) => summaries.push(s),
        });
        bus?.publishCommand({ id: 'c1' } as never);
        await new Promise((r) => setTimeout(r, 400));
      });
      // control: the failing connection really did produce reports, so an empty capture cannot pass
      expect(summaries.length).toBeGreaterThan(0);
      expect(printed).not.toContain(SECRET);
      expect(util.inspect(summaries, { depth: 10 })).not.toContain(SECRET);
    } finally {
      await (bus as RelayBus)?.close().catch(() => undefined);
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  // The bus refuses these before ioredis is built. Handed to ioredis they are not harmless: a `/` in the password makes
  // it connect to a unix socket path and echo the password in the ENOENT message on every
  // retry, a `#` or `?` can throw ERR_INVALID_URL with the URL on `input`. Whichever it does,
  // nothing it produces may reach output or an error the bus hands back.
  for (const pw of ['SEC/RET' + SECRET, 'SEC#RET' + SECRET, 'SEC?RET' + SECRET]) {
    it(`prints no credential for a password containing a reserved character (${pw.slice(0, 4)})`, async () => {
      let thrown: unknown;
      const summaries: RelayBusErrorSummary[] = [];
      let bus: Awaited<ReturnType<typeof createRedisRelayBus>> = null;
      const printed = await captureOutput(async () => {
        try {
          bus = await createRedisRelayBus(`default:${pw}@127.0.0.1:6399`, {
            onError: (s) => summaries.push(s),
          });
          await new Promise((r) => setTimeout(r, 400));
        } catch (e) {
          thrown = e;
        }
      });
      await bus?.close().catch(() => undefined);
      // control: the URL really was refused (or reported), so an empty capture cannot pass
      expect(thrown !== undefined || summaries.length > 0).toBe(true);
      expect(thrown).toBeInstanceOf(Error);
      expect(printed).not.toContain(SECRET);
      expect(util.inspect(summaries, { depth: 10 })).not.toContain(SECRET);
      if (thrown !== undefined) {
        const e = thrown as Error & { input?: unknown; command?: unknown; cause?: unknown };
        expect(e.message).toMatch(/^Redis relay bus init failed/);
        expect('input' in e).toBe(false);
        expect('command' in e).toBe(false);
        expect(e.cause).toBeUndefined();
        expect(util.inspect(e, { depth: 10 })).not.toContain(SECRET);
      }
    });
  }
});
