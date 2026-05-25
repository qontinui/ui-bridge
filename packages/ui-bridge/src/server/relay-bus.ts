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
 * Minimal ioredis client surface this adapter needs. Declared structurally so
 * the package does not hard-depend on `ioredis` types (it is an
 * optionalDependency, dynamically imported only when a Redis bus is requested).
 */
interface RedisLike {
  publish(channel: string, message: string): unknown;
  subscribe(...channels: string[]): unknown;
  unsubscribe(...channels: string[]): unknown;
  on(event: 'message', cb: (channel: string, message: string) => void): unknown;
  /** SET key value with EX ttl (used: `set(key, '1', 'EX', ttl)`). */
  set(key: string, value: string, mode: string, ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  exists(key: string): Promise<number>;
  quit(): Promise<unknown>;
  duplicate(): RedisLike;
}

const TAB_PRESENCE_PREFIX = 'uibridge:tab:';

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
    void this.pub.set(`${TAB_PRESENCE_PREFIX}${tabId}`, '1', 'EX', Math.max(1, ttlSeconds));
  }

  unregisterTab(tabId: string): void {
    void this.pub.del(`${TAB_PRESENCE_PREFIX}${tabId}`);
  }

  async isTabKnown(tabId: string): Promise<boolean> {
    try {
      return (await this.pub.exists(`${TAB_PRESENCE_PREFIX}${tabId}`)) > 0;
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
export async function createRedisRelayBus(url: string | undefined | null): Promise<RelayBus | null> {
  if (!url || !url.trim()) return null;
  return RedisRelayBus.create(url.trim());
}
