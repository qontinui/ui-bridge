/**
 * Test fixture: a synchronous, in-memory {@link RelayBus}, shared by the tests
 * that run several `CommandRelay` instances as one fleet.
 *
 * One {@link InMemoryBusHub} is the fleet's Redis: the pub/sub channels, the
 * tab-presence registry and the command registry live on it. Each instance
 * gets its own view, either
 *
 * - `hub.bus(name)` — presence is PER HOLDER, as the Redis adapter keeps it:
 *   an instance registers and unregisters only its own hold on a tab, a tab is
 *   known while any instance holds it, and `holdsElsewhere` tells holders
 *   apart; or
 * - `hub.sharedBus()` — one view every instance shares: one presence set, so
 *   no holder is told apart from another and none counts as "elsewhere".
 *
 * `wire: 'json'` sends every response through JSON, as the Redis bus carries
 * it. Not part of the published package: only tests import it.
 */
import type { RelayBus, RelayCommandEnvelope, RelayResponseEnvelope } from '../relay-bus';

export interface InMemoryBusHubOptions {
  /** `'json'`: a published response reaches its subscribers through JSON. */
  wire?: 'json';
}

export class InMemoryBusHub {
  readonly cmdByTab = new Map<string, Set<(e: RelayCommandEnvelope) => void>>();
  readonly broadcast = new Set<(e: RelayCommandEnvelope) => void>();
  readonly respByCmd = new Map<string, Set<(e: RelayResponseEnvelope) => void>>();
  /** Each tab's holders: the views that registered it and have not let go. */
  readonly holders = new Map<string, Set<string>>();
  /** The command registry: each known command id and when it expires (ms epoch). */
  readonly knownCommands = new Map<string, number>();

  constructor(readonly options: InMemoryBusHubOptions = {}) {}

  /** The bus instance `name` is built with (per-holder presence). */
  bus(name: string): InMemoryBus {
    return new InMemoryBus(this, name);
  }

  /** One view every instance shares (one presence set; nothing is elsewhere). */
  sharedBus(): InMemoryBus {
    return new InMemoryBus(this, undefined);
  }

  clear(): void {
    this.cmdByTab.clear();
    this.broadcast.clear();
    this.respByCmd.clear();
    this.holders.clear();
    this.knownCommands.clear();
  }
}

/** The name every `sharedBus()` view holds a tab under. */
const SHARED_HOLDER = '__shared__';

export class InMemoryBus implements RelayBus {
  constructor(
    private readonly hub: InMemoryBusHub,
    /** This view's holder name; undefined for the shared view. */
    private readonly instance: string | undefined
  ) {}

  publishCommand(env: RelayCommandEnvelope): void {
    if (env.targetTabId) this.hub.cmdByTab.get(env.targetTabId)?.forEach((h) => h(env));
    else this.hub.broadcast.forEach((h) => h(env));
  }

  subscribeCommands(tabId: string, handler: (e: RelayCommandEnvelope) => void): () => void {
    let set = this.hub.cmdByTab.get(tabId);
    if (!set) this.hub.cmdByTab.set(tabId, (set = new Set()));
    set.add(handler);
    this.hub.broadcast.add(handler);
    return () => {
      set!.delete(handler);
      this.hub.broadcast.delete(handler);
    };
  }

  publishResponse(env: RelayResponseEnvelope): void {
    const delivered =
      this.hub.options.wire === 'json'
        ? (JSON.parse(JSON.stringify(env)) as RelayResponseEnvelope)
        : env;
    this.hub.respByCmd.get(env.commandId)?.forEach((h) => h(delivered));
  }

  subscribeResponse(commandId: string, handler: (e: RelayResponseEnvelope) => void): () => void {
    let set = this.hub.respByCmd.get(commandId);
    if (!set) this.hub.respByCmd.set(commandId, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  registerTab(tabId: string): void {
    let holders = this.hub.holders.get(tabId);
    if (!holders) this.hub.holders.set(tabId, (holders = new Set()));
    holders.add(this.instance ?? SHARED_HOLDER);
  }

  unregisterTab(tabId: string): void {
    this.hub.holders.get(tabId)?.delete(this.instance ?? SHARED_HOLDER);
  }

  async isTabKnown(tabId: string): Promise<boolean> {
    return (this.hub.holders.get(tabId)?.size ?? 0) > 0;
  }

  async holdsElsewhere(tabId: string): Promise<boolean> {
    if (this.instance === undefined) return false;
    return [...(this.hub.holders.get(tabId) ?? [])].some((holder) => holder !== this.instance);
  }

  registerCommand(commandId: string, ttlSeconds: number): void {
    this.hub.knownCommands.set(commandId, Date.now() + Math.max(1, ttlSeconds) * 1000);
  }

  forgetCommand(commandId: string): void {
    this.hub.knownCommands.delete(commandId);
  }

  async isCommandKnown(commandId: string): Promise<boolean | null> {
    const expiresAt = this.hub.knownCommands.get(commandId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
      this.hub.knownCommands.delete(commandId);
      return false;
    }
    return true;
  }

  async close(): Promise<void> {
    this.hub.clear();
  }
}
