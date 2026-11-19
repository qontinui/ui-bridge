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
  /**
   * On `ok: true`, the answer. On `ok: false`, what the tab posted with its
   * failure (the dispatcher's `{ success: false, … }` envelope), when it
   * posted one: the sender rejects with a `TabReportedFailure` carrying it,
   * so the tab's own code and `failureDetails` reach the caller. Absent from
   * a `NOT_DELIVERED` reply and from a responder that predates it.
   */
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
   * `NOT_DELIVERED`: the instance holding the tab could not write the command
   * to its stream, so the sender fails at once instead of waiting out its
   * bus timeout. `error` carries the relay's not-delivered message.
   */
  code?: 'OWNER_MISMATCH' | 'NOT_DELIVERED';
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
  /**
   * True if an instance OTHER than this one holds `tabId` unexpired. A stream
   * sent its `rotate` frame asks it before delivering a bus command, so the
   * instance its replacement landed on delivers it instead.
   */
  holdsElsewhere(tabId: string): Promise<boolean>;

  // --- Shared command registry (KV) --------------------------------------
  // Lets an instance that holds no pending command for a result ask "does
  // SOME instance await this command?" before it publishes the result on the
  // bus (plan 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
  // D2). The dispatching instance registers every command it delivers or
  // publishes, and forgets it when it settles.

  /** Record that an instance awaits `commandId`, for `ttlSeconds` at most. */
  registerCommand(commandId: string, ttlSeconds: number): void;
  /** The command settled: no instance awaits it any more. */
  forgetCommand(commandId: string): void;
  /** True if some instance awaits `commandId`; `null` when the read failed. */
  isCommandKnown(commandId: string): Promise<boolean | null>;

  /** Release underlying connections. */
  close(): Promise<void>;
}

const CMD_TAB_PREFIX = 'uibridge:cmd:tab:';
const CMD_BROADCAST = 'uibridge:cmd:broadcast';
const RESP_PREFIX = 'uibridge:resp:';
/** One string key per command some instance awaits (see `RelayBus.registerCommand`). */
const CMD_KNOWN_PREFIX = 'uibridge:cmd:known:';

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
  on(event: 'error', cb: (err: unknown) => void): unknown;
  /** ZADD key score member. */
  zadd(key: string, score: number, member: string): Promise<unknown>;
  /** ZREM key member. */
  zrem(key: string, member: string): Promise<unknown>;
  /** ZREMRANGEBYSCORE key min max (`-inf`, `+inf` and `(n` bounds included). */
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
  /** ZCOUNT key min max. */
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
  /** ZSCORE key member: the member's score, or null when it is not in the set. */
  zscore(key: string, member: string): Promise<string | null>;
  /** ZRANGE key start stop WITHSCORES: each member, then its score. */
  zrange(key: string, start: number, stop: number, withScores: 'WITHSCORES'): Promise<string[]>;
  /** PEXPIREAT key unix-time-milliseconds. */
  pexpireat(key: string, unixTimeMs: number): Promise<unknown>;
  /** SET key value EX seconds. */
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  /** DEL key. */
  del(key: string): Promise<unknown>;
  /** EXISTS key: how many of the keys exist. */
  exists(key: string): Promise<number>;
  quit(): Promise<unknown>;
  duplicate(): RedisLike;
}

/**
 * Each instance holding a tab is one member of `uibridge:tab-holders:<tabId>`,
 * a sorted set scored by when that hold expires (ms since the epoch). An
 * instance adds and removes only its own member, so a dead stream's slot
 * letting go of a tab never erases the hold of the instance its replacement
 * landed on. Its prefix differs from the retired `uibridge:tab:<tabId>`
 * string key that held presence before it, so a stale one of those can never
 * turn a ZADD here into a WRONGTYPE error. That key is neither written nor
 * read any more.
 */
const TAB_HOLDERS_PREFIX = 'uibridge:tab-holders:';

/**
 * Send a write without awaiting it, and without leaving its rejection unhandled.
 * An unhandled rejection reaches the runtime's own printer, which inspects the
 * error object whole: for an ioredis `ReplyError` that includes the failed
 * command's arguments (an `AUTH` command's password). The failure is reported
 * through the bus's sanitised `onError` instead.
 */
function fireAndForget(write: unknown, report?: (err: unknown) => void): void {
  if (write && typeof (write as Promise<unknown>).catch === 'function') {
    (write as Promise<unknown>).catch((err: unknown) => report?.(err));
  }
}

/** What {@link RedisRelayBus} reports about a Redis failure. Never the raw error. */
export interface RelayBusErrorSummary {
  /** Which connection failed. */
  role: 'pub' | 'sub' | 'init';
  name: string;
  code: string | null;
  /** The error message with any `user:password@` userinfo replaced by `***@`. */
  message: string;
}

export interface RedisRelayBusOptions {
  /**
   * Called with a sanitised summary of a Redis connection or command failure.
   * Default: a `console.warn` of the summary, at most once per 30 s per role.
   * The raw error, its `command` / `input` properties and its stack never reach it.
   */
  onError?: (summary: RelayBusErrorSummary) => void;
}

const MAX_ERROR_MESSAGE_CHARS = 300;

/**
 * The userinfo and password parts of a Redis URL, for redacting text that echoes
 * them back. ioredis builds some errors from a mis-parsed URL: a password holding
 * `/` is read as a unix socket path, and the failed connect then reports
 * `connect ENOENT /:pw@host:6379` with the password in the MESSAGE, on every retry.
 */
function urlSecrets(url: string): string[] {
  const trimmed = url.trim();
  const secrets: string[] = [];
  const add = (x: string | undefined) => {
    if (x && x.length >= 3) secrets.push(x);
  };
  try {
    const parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `redis://${trimmed}`
    );
    // ioredis hands AUTH the percent-DECODED password, so that is what an error can echo.
    for (const raw of [parsed.password, parsed.username]) {
      add(raw);
      try {
        add(decodeURIComponent(raw));
      } catch {
        /* not valid percent-encoding: the raw form above is all there is */
      }
    }
  } catch {
    /* unparseable: the greedy split below still names the userinfo */
  }
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(.*)@[^@]*$/is.exec(trimmed);
  if (m?.[1]) {
    add(m[1]);
    const colon = m[1].indexOf(':');
    if (colon !== -1) add(m[1].slice(colon + 1));
  }
  // Longest first, so a secret that contains another is replaced whole.
  return [...new Set(secrets)].sort((x, y) => y.length - x.length);
}

/**
 * Throw a credential-free error when `url` is not a URL Node can parse.
 *
 * Handing ioredis a URL it cannot parse is not harmless: it falls back to the
 * legacy `url.parse`, which makes Node itself print
 * `DeprecationWarning: The URL //user:pw@host is invalid` (DEP0170) with the
 * WHOLE URL, password included, on every construction, and a password holding
 * `/` is then taken for a unix socket path whose failed connect repeats the
 * password in the error message. A reserved character in a password needs
 * percent-encoding, so a URL that fails here is a configuration error to report
 * once, not a connection to retry.
 */
function assertParseableRedisUrl(url: string): void {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `redis://${url}`;
  let parsed = false;
  try {
    new URL(candidate);
    parsed = true;
  } catch {
    /* handled below, without the underlying error */
  }
  if (!parsed) {
    throw new Error(
      'Redis relay bus init failed: the URL is not parseable (a reserved character in the password probably needs percent-encoding)'
    );
  }
}

/**
 * Replace credentials in free text: `scheme://user:pw@host`, scheme-less
 * `user:pw@host` (any run of non-space characters ending in `@`, so a `/` inside
 * the password does not break it), and every `secrets` entry verbatim.
 */
export function redactRedisUserinfo(text: string, secrets: readonly string[] = []): string {
  // Known secrets first: a generic pattern cuts a password holding `@` at the wrong place and
  // leaves its tail behind. Then bound the work of the patterns on a long message.
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***');
  }
  out = out.slice(0, MAX_ERROR_MESSAGE_CHARS * 2);
  return out
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1***@')
    .replace(/(^|[\s'"(=,])[^\s@'"]*:[^\s@'"]*@/g, '$1***@');
}

/**
 * Reduce an ioredis/Node error to name, code and a redacted message. ioredis
 * puts the secret on PROPERTIES (`ReplyError.command.args`, `ERR_INVALID_URL`'s
 * `input`) and, for a mis-parsed URL, in `message` too, so a summary built only
 * from these three scalar fields, each redacted, cannot carry it.
 */
export function summarizeRedisError(
  err: unknown,
  role: RelayBusErrorSummary['role'],
  secrets: readonly string[] = []
): RelayBusErrorSummary {
  const e = (err ?? {}) as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const code = typeof e.code === 'string' ? e.code : null;
  const raw = typeof e.message === 'string' ? e.message : '';
  return {
    role,
    name: redactRedisUserinfo(name, secrets).slice(0, 80),
    code: code === null ? null : redactRedisUserinfo(code, secrets).slice(0, 80),
    message: redactRedisUserinfo(raw, secrets).slice(0, MAX_ERROR_MESSAGE_CHARS),
  };
}

const ERROR_LOG_INTERVAL_MS = 30_000;

function defaultOnError(): (summary: RelayBusErrorSummary) => void {
  const lastLoggedAt = new Map<string, number>();
  return (summary) => {
    const now = Date.now();
    const last = lastLoggedAt.get(summary.role);
    if (last !== undefined && now - last < ERROR_LOG_INTERVAL_MS) return;
    lastLoggedAt.set(summary.role, now);
    console.warn(
      `[ui-bridge relay] redis ${summary.role} error: ${summary.name}${summary.code ? ` (${summary.code})` : ''}: ${summary.message}`
    );
  };
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

  private readonly onError: (summary: RelayBusErrorSummary) => void;
  private readonly secrets: readonly string[];
  /** Reports a rejected fire-and-forget command through the sanitised `onError`. */
  private readonly reportCommandError = (err: unknown): void => {
    try {
      this.onError(summarizeRedisError(err, 'pub', this.secrets));
    } catch {
      /* a throwing reporter must not take the process down */
    }
  };

  private constructor(
    pub: RedisLike,
    sub: RedisLike,
    options: RedisRelayBusOptions = {},
    secrets: readonly string[] = []
  ) {
    this.secrets = secrets;
    this.pub = pub;
    this.sub = sub;
    const onError = options.onError ?? defaultOnError();
    this.onError = onError;
    // Without a listener ioredis prints its own `Unhandled error event` line, and an
    // embedder's handler would see the raw error. Both clients report sanitised.
    const report = (role: 'pub' | 'sub') => (err: unknown) => {
      try {
        onError(summarizeRedisError(err, role, secrets));
      } catch {
        /* a throwing reporter must not take the process down */
      }
    };
    this.pub.on('error', report('pub'));
    this.sub.on('error', report('sub'));
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
   * connection string. Throws if `ioredis` is not installed, or a sanitised
   * `Error` (no `cause`, `input` or `command`) when the URL cannot be used.
   */
  static async create(url: string, options: RedisRelayBusOptions = {}): Promise<RedisRelayBus> {
    // Dynamic import keeps ioredis an OPTIONAL dependency. The specifier is held
    // in a variable so TypeScript does not statically resolve it — the module is
    // only required at runtime when a Redis bus is actually constructed, and the
    // package typechecks/builds without `ioredis` present.
    assertParseableRedisUrl(url);
    const specifier = 'ioredis';
    const mod = (await import(specifier)) as unknown as {
      default: new (url: string) => RedisLike;
    };
    const Redis = mod.default;
    let pub: RedisLike | undefined;
    let sub: RedisLike;
    try {
      pub = new Redis(url);
      // A client with no `error` listener makes ioredis print its own raw error line, so the
      // listener goes on before anything else can fail.
      pub.on('error', () => undefined);
      sub = pub.duplicate();
    } catch (err) {
      // Do not leave a half-built client retrying in the background.
      try {
        (pub as unknown as { disconnect?: () => void } | undefined)?.disconnect?.();
      } catch {
        /* nothing more to do */
      }
      // ioredis' `ERR_INVALID_URL` carries the whole URL, password included, on `input`.
      const { code } = summarizeRedisError(err, 'init', urlSecrets(url));
      // No `cause`: it would carry the error's `input`, the URL with the password.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Redis relay bus init failed${code ? `: ${code}` : ''}`);
    }
    return new RedisRelayBus(pub, sub, options, urlSecrets(url));
  }

  private addHandler(channel: string, handler: (env: never) => void): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      fireAndForget(this.sub.subscribe(channel), this.reportCommandError);
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        fireAndForget(this.sub.unsubscribe(channel), this.reportCommandError);
      }
    };
  }

  publishCommand(env: RelayCommandEnvelope): void {
    const channel = env.targetTabId ? `${CMD_TAB_PREFIX}${env.targetTabId}` : CMD_BROADCAST;
    fireAndForget(this.pub.publish(channel, JSON.stringify(env)), this.reportCommandError);
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
    fireAndForget(
      this.pub.publish(`${RESP_PREFIX}${env.commandId}`, JSON.stringify(env)),
      this.reportCommandError
    );
  }

  subscribeResponse(commandId: string, handler: (env: RelayResponseEnvelope) => void): () => void {
    return this.addHandler(`${RESP_PREFIX}${commandId}`, handler as (e: never) => void);
  }

  registerTab(tabId: string, ttlSeconds: number): void {
    const key = `${TAB_HOLDERS_PREFIX}${tabId}`;
    const ttl = Math.max(1, ttlSeconds);
    const now = Date.now();
    const expiresAt = now + ttl * 1000;
    fireAndForget(this.pub.zadd(key, expiresAt, this.holderId), this.reportCommandError);
    // A holder that lapsed without letting go (its instance was killed) is
    // dropped here.
    fireAndForget(this.pub.zremrangebyscore(key, '-inf', now), this.reportCommandError);
    // The key lives as long as its longest hold, read back after this one was
    // added: a holder refreshing with a shorter TTL cannot expire it early, and
    // a key whose every holder lapsed expires with them (review A7). Two
    // instances whose refreshes interleave their read and their PEXPIREAT can
    // still leave the key the shorter expiry, until the longer holder's next
    // refresh (every sweep, a third of its TTL at most) restores it.
    fireAndForget(
      this.pub
        .zrange(key, -1, -1, 'WITHSCORES')
        .then((top) => this.pub.pexpireat(key, Math.max(expiresAt, Number(top[1] ?? 0)))),
      this.reportCommandError
    );
  }

  unregisterTab(tabId: string): void {
    fireAndForget(
      this.pub.zrem(`${TAB_HOLDERS_PREFIX}${tabId}`, this.holderId),
      this.reportCommandError
    );
  }

  async isTabKnown(tabId: string): Promise<boolean> {
    try {
      return (await this.pub.zcount(`${TAB_HOLDERS_PREFIX}${tabId}`, `(${Date.now()}`, '+inf')) > 0;
    } catch {
      return false;
    }
  }

  async holdsElsewhere(tabId: string): Promise<boolean> {
    const key = `${TAB_HOLDERS_PREFIX}${tabId}`;
    const now = Date.now();
    try {
      const [live, own] = await Promise.all([
        this.pub.zcount(key, `(${now}`, '+inf'),
        this.pub.zscore(key, this.holderId),
      ]);
      const ownLive = own !== null && Number(own) > now ? 1 : 0;
      return live - ownLive > 0;
    } catch {
      return false;
    }
  }

  registerCommand(commandId: string, ttlSeconds: number): void {
    fireAndForget(
      this.pub.set(
        `${CMD_KNOWN_PREFIX}${commandId}`,
        '1',
        'EX',
        Math.max(1, Math.ceil(ttlSeconds))
      ),
      this.reportCommandError
    );
  }

  forgetCommand(commandId: string): void {
    fireAndForget(this.pub.del(`${CMD_KNOWN_PREFIX}${commandId}`), this.reportCommandError);
  }

  async isCommandKnown(commandId: string): Promise<boolean | null> {
    try {
      return (await this.pub.exists(`${CMD_KNOWN_PREFIX}${commandId}`)) > 0;
    } catch {
      return null;
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
  url: string | undefined | null,
  options?: RedisRelayBusOptions
): Promise<RelayBus | null> {
  if (!url || !url.trim()) return null;
  return RedisRelayBus.create(url.trim(), options);
}
