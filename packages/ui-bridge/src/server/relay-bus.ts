/**
 * Cross-instance relay bus (P0a).
 *
 * The {@link CommandRelay} keeps its tab registry, pending-command promises and
 * SSE listeners in per-process memory (on `globalThis`). That is correct for a
 * single always-on server, but BREAKS on horizontally-scaled serverless
 * (Vercel): a tab's SSE stream is held open on one lambda instance while a
 * `/control/*` command POST round-robins to a different instance that has no
 * listener for it — so the command times out / 404s. Proven on staging
 * 2026-05-25: 6 consecutive `/health` calls hit 6 distinct `x-vercel-id`
 * instances, all reporting `connectedTabs=[]`.
 *
 * A `RelayBus` is an OPTIONAL shared message bus that bridges instances:
 *
 *  - The instance holding a tab's SSE stream subscribes to that tab's command
 *    channel ({@link subscribeCommands}). Any instance can {@link publishCommand}
 *    to deliver a command to whichever instance holds the stream.
 *  - The originating instance (holding the pending promise) subscribes to the
 *    command's response channel ({@link subscribeResponse}); whichever instance
 *    receives the browser's response POST {@link publishResponse}es it back.
 *
 * When no bus is configured the relay behaves EXACTLY as before (single-process
 * in-memory) — every bus call site in `CommandRelay` is guarded by `if (this.bus)`.
 * Activate by constructing a bus (e.g. {@link createRedisRelayBus}) and passing
 * it via `CommandRelayOptions.bus`.
 */

/** A command in flight to a tab, mirrored across instances. */
export interface RelayCommandEnvelope {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
  /** Target tab; absent = broadcast to all tabs. */
  targetTabId?: string;
  /**
   * Per-user tab scoping (§4.2): the userId of the authenticated caller
   * that originated this dispatch. The instance HOLDING the target tab
   * compares this value against its LOCAL `tabOwnership[targetTabId]`
   * before forwarding to the listener — necessary because the sending
   * instance may carry stale ownership metadata. Absent when the
   * caller is unscoped (admin / trusted server-side caller); receivers
   * skip the check in that case.
   */
  senderUserId?: string;
}

/** A browser response, routed back to the originating instance. */
export interface RelayResponseEnvelope {
  commandId: string;
  /** true = resolve with `result`; false = reject with `error`. */
  ok: boolean;
  result?: unknown;
  error?: string;
  /** Tab that produced the response (for success tracking). */
  tabId?: string;
  /**
   * The verified identity of the request that carried the response, and the
   * stream id it presented. The instance holding the pending command checks
   * both against where the command went (per-user tab scoping, §4.2).
   */
  responderUserId?: string;
  streamId?: string;
  /**
   * Set by the instance holding the tab when it refuses the sender's identity
   * (per-user tab scoping, §4.2). The sender rejects with `OwnerMismatchError`,
   * which the HTTP layer answers exactly like a tab that does not exist.
   */
  code?: 'OWNER_MISMATCH';
}

export interface RelayBus {
  /** Publish a command so the instance holding the target tab delivers it. */
  publishCommand(env: RelayCommandEnvelope): void;
  /**
   * Subscribe to commands targeted at `tabId` (plus broadcasts). Returns an
   * unsubscribe fn. The handler is invoked on the instance holding the tab.
   */
  subscribeCommands(tabId: string, handler: (env: RelayCommandEnvelope) => void): () => void;
  /** Publish a browser response back to the originating instance. */
  publishResponse(env: RelayResponseEnvelope): void;
  /** Subscribe to the response for `commandId`. Returns an unsubscribe fn. */
  subscribeResponse(commandId: string, handler: (env: RelayResponseEnvelope) => void): () => void;

  // --- Shared tab-presence registry (KV) ---------------------------------
  // Lets any instance answer "is this tab connected to SOME instance?" so the
  // per-tab routing guard doesn't reject a command for a tab held elsewhere.

  /** Mark `tabId` present (refreshes a TTL). Called by the instance holding it. */
  registerTab(tabId: string, ttlSeconds: number): void;
  /** Remove `tabId` from the shared registry (on disconnect). */
  unregisterTab(tabId: string): void;
  /** True if `tabId` is present in the shared registry (any instance). */
  isTabKnown(tabId: string): Promise<boolean>;

  /** Release underlying connections. */
  close(): Promise<void>;
}

const CMD_TAB_PREFIX = 'uibridge:cmd:tab:';
const CMD_BROADCAST = 'uibridge:cmd:broadcast';
const RESP_PREFIX = 'uibridge:resp:';

/**
 * The Redis client surface this adapter calls: a subset of an ioredis client,
 * declared structurally so the SDK depends on no Redis package at all. An
 * ioredis `Redis` instance satisfies it as it stands, with no cast.
 */
export interface RedisLike {
  /**
   * The connection's status, which {@link RedisRelayBus.readiness} reads. ioredis
   * reports `wait` | `reconnecting` | `connecting` | `connect` | `ready` |
   * `close` | `end`.
   */
  readonly status: string;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: 'message', cb: (channel: string, message: string) => void): unknown;
  /** Connection errors. Listening also stops ioredis printing "Unhandled error event". */
  on(event: 'error', cb: (err: Error) => void): unknown;
  /** SET key value with EX ttl (used: `set(key, '1', 'EX', ttl)`). */
  set(key: string, value: string, mode: string, ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  exists(key: string): Promise<number>;
  quit(): Promise<unknown>;
  /** A second connection with the same options: ioredis's `duplicate()` inherits them. */
  duplicate(): RedisLike;
}

/**
 * A Redis client class — in practice the consumer's own `import Redis from
 * 'ioredis'`, passed as {@link RedisRelayBusOptions.Redis}.
 *
 * WHY THE CONSUMER INJECTS IT. The bus used to load ioredis itself, through a
 * dynamic `import()` whose specifier sat in a variable so that ioredis could stay
 * an optional dependency of the SDK's own build. A consumer that BUNDLES the SDK
 * cannot resolve such an import: webpack turns it into an expression context
 * ("Critical dependency: the request of a dependency is an expression") whose
 * runtime lookup throws `Cannot find module 'ioredis'` even where ioredis is
 * installed — which is how qontinui-web's deployed relay bus never started. A
 * static `import Redis from 'ioredis'` in the consumer's OWN code is a
 * dependency its bundler and its file tracer both follow, so the SDK takes the
 * class from the consumer and makes no import of a Redis client at all.
 */
export type RedisConstructorLike = new (
  url: string,
  options?: Record<string, unknown>
) => RedisLike;

/** What {@link createRedisRelayBus} and {@link RedisRelayBus.create} build a bus from. */
export interface RedisRelayBusOptions {
  /**
   * The Redis client class to construct. REQUIRED, and there is no fallback: a
   * call without it is refused with {@link RelayBusInitError} rather than
   * resolving to a bus that can never connect (see {@link RedisConstructorLike}).
   */
  Redis: RedisConstructorLike;
  /**
   * Passed to `Redis` as its second argument — e.g. `{ lazyConnect: true }` for
   * a construction that must open no socket. The subscriber connection inherits
   * it through `duplicate()`.
   */
  redisOptions?: Record<string, unknown>;
}

/** {@link RedisRelayBus.readiness}: both connections' state, read without sending a Redis command. */
export interface RelayBusReadiness {
  /**
   * `ready` only when BOTH connections are `ready`; `closed` when EITHER has
   * ended for good (`end`: ioredis will not reconnect it); `not-ready` otherwise,
   * including while either is still connecting or reconnecting.
   */
  state: 'ready' | 'not-ready' | 'closed';
  /** The publisher connection's status. */
  pub: string;
  /** The subscriber connection's status. */
  sub: string;
  /**
   * The most recent connection error or failed write on either connection, or
   * `null` before the first. A closed shape that never carries text the client
   * derived from the URL: a Redis server reply as its text, a Node system error
   * as `<code> <syscall>` only, anything else as its `name`; credential spans
   * stripped, at most 160 characters.
   */
  lastError: string | null;
}

/** Why {@link createRedisRelayBus} or {@link RedisRelayBus.create} refused to build a bus. */
export class RelayBusInitError extends Error {
  readonly code: 'RELAY_BUS_REDIS_CONSTRUCTOR_REQUIRED';

  constructor(code: 'RELAY_BUS_REDIS_CONSTRUCTOR_REQUIRED', message: string) {
    super(message);
    this.name = 'RelayBusInitError';
    this.code = code;
  }
}

const LAST_ERROR_MAX_CHARS = 160;
/** A URL's userinfo — `scheme://user:pass@` — cut back to `scheme://`, up to the last `@` in the run. */
const CREDENTIAL_SPAN = /([a-z][a-z0-9+.-]*:\/\/)\S*@/gi;
/** How ioredis words a refused ready check: `Ready check failed: <the server's reply>`. */
const READY_CHECK_FAILED = 'Ready check failed: ';

/** The unbounded, unstripped form of {@link renderRelayBusError}: which of the three shapes `error` takes. */
function describeRelayBusError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'non-Error value';
  const { name, message, code, syscall } = error as Record<string, unknown>;
  // Node system errors first: their message spells the host the client dialled.
  if (typeof code === 'string' && typeof syscall === 'string') return `${code} ${syscall}`;
  if (
    typeof message === 'string' &&
    (name === 'ReplyError' || message.startsWith(READY_CHECK_FAILED))
  ) {
    return message;
  }
  return typeof name === 'string' && name !== '' ? name : 'non-Error value';
}

/**
 * Render an error for {@link RelayBusReadiness.lastError}, which a consumer may
 * serve on a shared health endpoint. Only three shapes leave this function:
 *
 *  - a Redis server reply — a `ReplyError` (as redis-errors names its class), or
 *    ioredis's `Ready check failed: <reply>` — as its text. That text is the
 *    SERVER's, and it is how a provider's refusal (`ERR … rate-limited`)
 *    reaches an operator;
 *  - a Node system error as `<code> <syscall>` only (`ENOTFOUND getaddrinfo`),
 *    never its message, hostname, address or port: Node spells those from the
 *    host the client dialled, which ioredis took from the configured URL;
 *  - anything else as its `name`.
 *
 * Credential spans are stripped from all three before the cut to 160 characters,
 * and so is every occurrence of `secrets` — the configured URL's password — so a
 * server or proxy reply that repeats a bare AUTH argument cannot carry it out.
 */
function renderRelayBusError(error: unknown, secrets: readonly string[] = []): string {
  let described: string;
  try {
    described = describeRelayBusError(error);
  } catch {
    described = 'unreadable error'; // a throwing getter must not turn a handled failure into a thrown one
  }
  let rendered = described.replace(CREDENTIAL_SPAN, '$1');
  for (const secret of secrets) rendered = rendered.split(secret).join('[redacted]');
  return rendered.slice(0, LAST_ERROR_MAX_CHARS);
}

/** The password a `redis://` / `rediss://` URL carries, decoded and raw, for {@link renderRelayBusError}. */
function urlSecrets(url: string): string[] {
  try {
    const raw = new URL(url).password;
    if (raw === '') return [];
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      /* a malformed escape: the raw form is still redacted */
    }
    return [...new Set([raw, decoded])].filter((secret) => secret !== '');
  } catch {
    return []; // not a WHATWG-parseable URL; the constructor reports that itself
  }
}

const WARN_INTERVAL_MS = 60_000;
/** When this process last logged a relay bus error. Module state: one budget per process, every bus shares it. */
let lastWarnAt = Number.NEGATIVE_INFINITY;

/** `console.warn` at most once per minute per process; what is not logged is still in `lastError`. */
function warnAtMostOncePerMinute(line: string): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = now;
  console.warn(
    `${line} (further relay bus errors in the next 60 s are not logged; readiness().lastError keeps the latest)`
  );
}

const TAB_PRESENCE_PREFIX = 'uibridge:tab:';

/**
 * Redis pub/sub implementation of {@link RelayBus}.
 *
 * Uses one publisher connection and one dedicated subscriber connection (Redis
 * requires a connection in subscribe mode to be used only for (un)subscribe).
 * Channels are subscribed/unsubscribed dynamically; handlers are routed by
 * channel name. Both connections come from the consumer's injected Redis class
 * ({@link RedisRelayBusOptions}); the bus imports no Redis client of its own.
 *
 * Construction never waits for a connection. {@link readiness} reports whether
 * both are up, and every write the bus fires and forgets records its rejection
 * there — and logs it, at most once a minute per process — instead of leaving
 * it unhandled: ioredis's offline queue rejects a queued command only after its
 * retry limit, long after the call that sent it returned.
 */
export class RedisRelayBus implements RelayBus {
  private readonly pub: RedisLike;
  private readonly sub: RedisLike;
  /** channel -> set of handlers (untyped envelope; narrowed per channel kind). */
  private readonly handlers = new Map<string, Set<(env: never) => void>>();
  /** See {@link RelayBusReadiness.lastError}. */
  private lastError: string | null = null;

  /** The configured URL's password, never rendered into {@link lastError} or a log line. */
  private readonly secrets: readonly string[];

  private constructor(pub: RedisLike, sub: RedisLike, secrets: readonly string[]) {
    this.pub = pub;
    this.sub = sub;
    this.secrets = secrets;
    this.pub.on('error', (err) => this.noteError('pub connection error', err));
    this.sub.on('error', (err) => this.noteError('sub connection error', err));
    this.sub.on('message', (channel, message) => {
      const set = this.handlers.get(channel);
      if (!set || set.size === 0) return;
      let env: unknown;
      try {
        env = JSON.parse(message);
      } catch {
        return;
      }
      for (const h of set) {
        try {
          (h as (e: unknown) => void)(env);
        } catch {
          /* handler is self-cleaning */
        }
      }
    });
  }

  /**
   * Construct a Redis-backed bus: `new options.Redis(url, options.redisOptions)`
   * for the publisher and its `duplicate()` for the subscriber. `url` is a
   * standard `redis://` / `rediss://` connection string.
   *
   * Async so that every refusal arrives as a rejection: {@link RelayBusInitError}
   * when `options.Redis` is missing (an untyped caller — the type requires it),
   * or whatever the constructor throws (ioredis throws synchronously on a URL it
   * cannot parse). It never waits for a connection; {@link readiness} does that.
   */
  static async create(url: string, options: RedisRelayBusOptions): Promise<RedisRelayBus> {
    const Redis = (options as Partial<RedisRelayBusOptions> | undefined)?.Redis;
    if (typeof Redis !== 'function') {
      throw new RelayBusInitError(
        'RELAY_BUS_REDIS_CONSTRUCTOR_REQUIRED',
        'createRedisRelayBus(url, { Redis }) needs the Redis client class to construct: pass your own ' +
          "`import Redis from 'ioredis'` as `Redis`. The SDK imports no Redis client itself, because a " +
          'bundler cannot resolve that import for it (see RedisConstructorLike).'
      );
    }
    const pub = new Redis(url, options.redisOptions);
    let sub: RedisLike;
    try {
      sub = pub.duplicate();
    } catch (error) {
      void Promise.resolve()
        .then(() => pub.quit())
        .catch(() => undefined); // never leave the publisher's socket open behind a refusal
      throw error;
    }
    return new RedisRelayBus(pub, sub, urlSecrets(url));
  }

  /**
   * Both connections' state, read synchronously from their `status`: it sends no
   * Redis command, so a health endpoint can call it on every read without
   * spending a rate-limited database's budget. Readiness is lost and regained
   * over a process's life, which is why this is read live rather than awaited
   * once at construction.
   */
  readiness(): RelayBusReadiness {
    const pub = this.pub.status;
    const sub = this.sub.status;
    const state: RelayBusReadiness['state'] =
      pub === 'end' || sub === 'end'
        ? 'closed'
        : pub === 'ready' && sub === 'ready'
          ? 'ready'
          : 'not-ready';
    return { state, pub, sub, lastError: this.lastError };
  }

  /** Record `error` as {@link RelayBusReadiness.lastError} and log it within the per-process budget. */
  private noteError(what: string, error: unknown): void {
    const rendered = renderRelayBusError(error, this.secrets);
    this.lastError = rendered;
    warnAtMostOncePerMinute(`[ui-bridge] relay bus ${what}: ${rendered}`);
  }

  /**
   * Fire and forget one write, handling its rejection. Every write this bus sends
   * without awaiting goes through here: an unhandled one would surface as an
   * `unhandledRejection` the moment the database refuses commands. It takes a
   * thunk, called at once, so that a client which throws synchronously is
   * handled the same way as one that rejects.
   */
  private fireAndForget(op: string, write: () => Promise<unknown>): void {
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(write());
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending.catch((error: unknown) => this.noteError(`${op} failed`, error));
  }

  private addHandler(channel: string, handler: (env: never) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      this.fireAndForget('subscribe', () => this.sub.subscribe(channel));
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        this.fireAndForget('unsubscribe', () => this.sub.unsubscribe(channel));
      }
    };
  }

  publishCommand(env: RelayCommandEnvelope): void {
    const channel = env.targetTabId ? `${CMD_TAB_PREFIX}${env.targetTabId}` : CMD_BROADCAST;
    this.fireAndForget('publish', () => this.pub.publish(channel, JSON.stringify(env)));
  }

  subscribeCommands(tabId: string, handler: (env: RelayCommandEnvelope) => void): () => void {
    const offTab = this.addHandler(`${CMD_TAB_PREFIX}${tabId}`, handler as (e: never) => void);
    const offBroadcast = this.addHandler(CMD_BROADCAST, handler as (e: never) => void);
    return () => {
      offTab();
      offBroadcast();
    };
  }

  publishResponse(env: RelayResponseEnvelope): void {
    this.fireAndForget('publish', () =>
      this.pub.publish(`${RESP_PREFIX}${env.commandId}`, JSON.stringify(env))
    );
  }

  subscribeResponse(commandId: string, handler: (env: RelayResponseEnvelope) => void): () => void {
    return this.addHandler(`${RESP_PREFIX}${commandId}`, handler as (e: never) => void);
  }

  registerTab(tabId: string, ttlSeconds: number): void {
    this.fireAndForget('set', () =>
      this.pub.set(`${TAB_PRESENCE_PREFIX}${tabId}`, '1', 'EX', Math.max(1, ttlSeconds))
    );
  }

  unregisterTab(tabId: string): void {
    this.fireAndForget('del', () => this.pub.del(`${TAB_PRESENCE_PREFIX}${tabId}`));
  }

  async isTabKnown(tabId: string): Promise<boolean> {
    try {
      return (await this.pub.exists(`${TAB_PRESENCE_PREFIX}${tabId}`)) > 0;
    } catch (error) {
      this.noteError('exists failed', error);
      return false;
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
    this.handlers.clear();
  }
}

/**
 * Build a {@link RedisRelayBus} from a Redis URL and the consumer's own Redis
 * client class, or `null` when `url` is empty or unset — the in-memory,
 * single-process default, for which nothing is constructed.
 *
 * `options.Redis` is REQUIRED and is constructed with the trimmed URL and
 * `options.redisOptions`; {@link RedisConstructorLike} says why the SDK takes it
 * from the consumer instead of importing a Redis client itself:
 *
 *   `createRedisRelayBus(process.env.REDIS_URL, { Redis })`, where the
 *   consumer's module has `import Redis from 'ioredis'`.
 *
 * Rejects with {@link RelayBusInitError} (`code:
 * 'RELAY_BUS_REDIS_CONSTRUCTOR_REQUIRED'`) when `options.Redis` is missing, and
 * with the constructor's own error when it throws. The bus it resolves to may
 * not be connected yet — read {@link RedisRelayBus.readiness} for that.
 */
export async function createRedisRelayBus(
  url: string | undefined | null,
  options: RedisRelayBusOptions
): Promise<RedisRelayBus | null> {
  if (!url || !url.trim()) return null;
  return RedisRelayBus.create(url.trim(), options);
}
