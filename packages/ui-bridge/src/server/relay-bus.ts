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
  // Presence is PER HOLDER: during a stream rotation two instances can hold
  // the same tab, and one letting go must not erase the other's hold (plan
  // 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
  // D2).

  /** Mark THIS instance as holding `tabId` for `ttlSeconds` (a refresh extends it). */
  registerTab(tabId: string, ttlSeconds: number): void;
  /** Withdraw THIS instance's hold on `tabId`; another instance's hold stands. */
  unregisterTab(tabId: string): void;
  /** True if any instance holds `tabId` unexpired. */
  isTabKnown(tabId: string): Promise<boolean>;

  /** Release underlying connections. */
  close(): Promise<void>;
}

const CMD_TAB_PREFIX = 'uibridge:cmd:tab:';
const CMD_BROADCAST = 'uibridge:cmd:broadcast';
const RESP_PREFIX = 'uibridge:resp:';

/**
 * Minimal ioredis client surface this adapter needs. Declared structurally so
 * the package does not hard-depend on `ioredis` types (it is an
 * optionalDependency, dynamically imported only when a Redis bus is requested).
 */
interface RedisLike {
  publish(channel: string, message: string): unknown;
  subscribe(...channels: string[]): unknown;
  unsubscribe(...channels: string[]): unknown;
  on(event: 'message', cb: (channel: string, message: string) => void): unknown;
  /** ZADD key score member. */
  zadd(key: string, score: number, member: string): Promise<unknown>;
  /** ZREM key member. */
  zrem(key: string, member: string): Promise<unknown>;
  /** ZREMRANGEBYSCORE key min max (`-inf`, `+inf` and `(n` bounds included). */
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
  /** ZCOUNT key min max. */
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
  /** ZRANGE key start stop WITHSCORES: each member, then its score. */
  zrange(key: string, start: number, stop: number, withScores: 'WITHSCORES'): Promise<string[]>;
  /** PEXPIREAT key unix-time-milliseconds. */
  pexpireat(key: string, unixTimeMs: number): Promise<unknown>;
  /** SET key value EX ttl, on the previous version's presence key (used: `set(key, '1', 'EX', ttl)`). */
  set(key: string, value: string, mode: string, ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  exists(key: string): Promise<number>;
  quit(): Promise<unknown>;
  duplicate(): RedisLike;
}

/**
 * Each instance holding a tab is one member of `uibridge:tab-holders:<tabId>`,
 * a sorted set scored by when that hold expires (ms since the epoch). An
 * instance adds and removes only its own member, so a dead stream's slot
 * letting go of a tab never erases the hold of the instance its replacement
 * landed on. A key of its own, not the older `uibridge:tab:<tabId>` string: an
 * instance still running the older version SETs and DELs that key, which would
 * overwrite this set, or turn every ZADD into a WRONGTYPE error, mid-deploy.
 */
const TAB_HOLDERS_PREFIX = 'uibridge:tab-holders:';

/**
 * The previous version's presence: one string key per tab, which an instance
 * of that version SETs while it holds the tab, DELs when it lets go, and reads
 * with EXISTS. For one release, so a rolling deploy runs both versions side by
 * side, this version writes and reads that key beside its own holder set: each
 * version then sees the other's holders. A DEL here, like one there, can
 * erase another holder's mark on this key until that holder's next refresh;
 * the holder set, which this version reads first, is unaffected.
 * Delete with the release after this one (review A3).
 */
const PREVIOUS_TAB_PRESENCE_PREFIX = 'uibridge:tab:';

/** Send a write without awaiting it, and without leaving its rejection unhandled. */
function fireAndForget(write: Promise<unknown>): void {
  write.catch(() => undefined);
}

/**
 * Redis (ioredis) pub/sub implementation of {@link RelayBus}.
 *
 * Uses one publisher connection and one dedicated subscriber connection (Redis
 * requires a connection in subscribe mode to be used only for (un)subscribe).
 * Channels are subscribed/unsubscribed dynamically; handlers are routed by
 * channel name. `ioredis` is imported dynamically so it is only required when a
 * Redis bus is actually constructed.
 */
export class RedisRelayBus implements RelayBus {
  private readonly pub: RedisLike;
  private readonly sub: RedisLike;
  /** channel -> set of handlers (untyped envelope; narrowed per channel kind). */
  private readonly handlers = new Map<string, Set<(env: never) => void>>();
  /** This instance's member in a tab's holder set (see {@link TAB_HOLDERS_PREFIX}). */
  private readonly holderId = crypto.randomUUID();

  private constructor(pub: RedisLike, sub: RedisLike) {
    this.pub = pub;
    this.sub = sub;
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
   * Construct a Redis-backed bus. `url` is a standard `redis://` /`rediss://`
   * connection string. Throws if `ioredis` is not installed.
   */
  static async create(url: string): Promise<RedisRelayBus> {
    // Dynamic import keeps ioredis an OPTIONAL dependency. The specifier is held
    // in a variable so TypeScript does not statically resolve it — the module is
    // only required at runtime when a Redis bus is actually constructed, and the
    // package typechecks/builds without `ioredis` present.
    const specifier = 'ioredis';
    const mod = (await import(specifier)) as unknown as {
      default: new (url: string) => RedisLike;
    };
    const Redis = mod.default;
    const pub = new Redis(url);
    const sub = pub.duplicate();
    return new RedisRelayBus(pub, sub);
  }

  private addHandler(channel: string, handler: (env: never) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      void this.sub.subscribe(channel);
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        void this.sub.unsubscribe(channel);
      }
    };
  }

  publishCommand(env: RelayCommandEnvelope): void {
    const channel = env.targetTabId ? `${CMD_TAB_PREFIX}${env.targetTabId}` : CMD_BROADCAST;
    void this.pub.publish(channel, JSON.stringify(env));
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
    void this.pub.publish(`${RESP_PREFIX}${env.commandId}`, JSON.stringify(env));
  }

  subscribeResponse(commandId: string, handler: (env: RelayResponseEnvelope) => void): () => void {
    return this.addHandler(`${RESP_PREFIX}${commandId}`, handler as (e: never) => void);
  }

  registerTab(tabId: string, ttlSeconds: number): void {
    const key = `${TAB_HOLDERS_PREFIX}${tabId}`;
    const ttl = Math.max(1, ttlSeconds);
    const now = Date.now();
    const expiresAt = now + ttl * 1000;
    fireAndForget(this.pub.zadd(key, expiresAt, this.holderId));
    // A holder that lapsed without letting go (its instance was killed) is
    // dropped here.
    fireAndForget(this.pub.zremrangebyscore(key, '-inf', now));
    // The key lives as long as its longest hold, read back after this one was
    // added: a holder refreshing with a shorter TTL cannot expire it early, and
    // a key whose every holder lapsed expires with them (review A7). Two
    // instances whose refreshes interleave their read and their PEXPIREAT can
    // still leave the key the shorter expiry, until the longer holder's next
    // refresh (every sweep, a third of its TTL at most) restores it.
    fireAndForget(
      this.pub
        .zrange(key, -1, -1, 'WITHSCORES')
        .then((top) => this.pub.pexpireat(key, Math.max(expiresAt, Number(top[1] ?? 0))))
    );
    fireAndForget(this.pub.set(`${PREVIOUS_TAB_PRESENCE_PREFIX}${tabId}`, '1', 'EX', ttl));
  }

  unregisterTab(tabId: string): void {
    fireAndForget(this.pub.zrem(`${TAB_HOLDERS_PREFIX}${tabId}`, this.holderId));
    fireAndForget(this.pub.del(`${PREVIOUS_TAB_PRESENCE_PREFIX}${tabId}`));
  }

  async isTabKnown(tabId: string): Promise<boolean> {
    try {
      const [holders, previous] = await Promise.all([
        this.pub.zcount(`${TAB_HOLDERS_PREFIX}${tabId}`, `(${Date.now()}`, '+inf'),
        this.pub.exists(`${PREVIOUS_TAB_PRESENCE_PREFIX}${tabId}`),
      ]);
      return holders > 0 || previous > 0;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
    this.handlers.clear();
  }
}

/**
 * Build a {@link RelayBus} from a Redis URL, or `null` when `url` is empty/unset
 * (the in-memory single-process default). Returns a promise because the ioredis
 * import is dynamic.
 */
export async function createRedisRelayBus(
  url: string | undefined | null
): Promise<RelayBus | null> {
  if (!url || !url.trim()) return null;
  return RedisRelayBus.create(url.trim());
}
