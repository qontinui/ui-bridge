/**
 * Tab liveness: the one ordering the relay ranks candidate tabs by when a
 * command names no tab (plan
 * 2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost,
 * D5). `CommandRelay` (command-relay.ts) sorts with {@link compareByLiveness}
 * in all three of its selectors: `getPrimaryTabId`, `selectPrimarySuccessor`,
 * and `rankOwnedTabs`, which orders the owner-scoped dispatch arm and the
 * `primaryTabId` a scoped `getTransportDiagnostics` reports. `getPrimaryTabId`
 * keeps its current primary only as {@link keepsPrimary} allows.
 *
 * A tab is LIVE when it holds an open command transport on this instance and
 * - this instance received its heartbeat within the active window, or
 * - it has never beaten here and its youngest open transport opened within
 *   that window. The warm-up is bounded on purpose: `CommandRelay.isTabActive`
 *   treats a tab that never beat as active for as long as its stream stays
 *   registered, which is forever for a stream whose end nobody reported.
 *
 * Ranking, best first: live before not-live, then the most recent command
 * success, then the most recent heartbeat. A not-live tab is ranked, never
 * refused: it is still chosen when no live candidate remains, so a hidden tab
 * whose throttled beats leave the window, or whose beats land on another
 * instance, stays reachable.
 *
 * Every read goes through a {@link FreshnessSnapshot} taken once per
 * selection, never through the relay's live maps inside the comparator: a
 * sort needs one consistent view, and a fleet-wide heartbeat source (a bus
 * read is async) can only be consulted before the sort begins.
 * {@link heartbeatAgeMs} is the one reader of heartbeat freshness, so feeding
 * it fleet-wide beats changes how the snapshot is filled and nothing that
 * reads it.
 */

/**
 * The relay state liveness is read from. Structural, so this module needs
 * nothing from command-relay.ts: `CommandRelay` passes its own maps.
 */
export interface LivenessSources {
  /** SSE command-stream listeners by tab id, each with the time it registered. */
  readonly listeners: ReadonlyMap<string, { readonly openedAt: number }>;
  /** WebSocket clients by tab id. Only a connected one is an open transport. */
  readonly wsClients: ReadonlyMap<
    string,
    { readonly connectedAt: number; readonly client: { isConnected(): boolean } }
  >;
  /** When this instance last received each tab's heartbeat. */
  readonly heartbeats: ReadonlyMap<string, number>;
  /** When a command to each tab last succeeded. */
  readonly lastSuccess: ReadonlyMap<string, number>;
}

/** What one selection knows about one candidate tab. */
export interface TabFreshness {
  /** Whether the tab holds an open command transport on this instance. */
  readonly open: boolean;
  /** When the tab's youngest open transport opened; absent when none is open. */
  readonly openedAt?: number;
  /** When this instance last received the tab's heartbeat; absent when it never has. */
  readonly lastBeatAt?: number;
  /** When a command to the tab last succeeded; absent when none has. */
  readonly lastSuccessAt?: number;
}

/** One selection's view of its candidate tabs, read once before it sorts. */
export interface FreshnessSnapshot {
  /** The instant every age in the snapshot is measured from. */
  readonly takenAt: number;
  /** The relay's `tabActiveWindowMs` (`CommandRelayOptions`) when the snapshot was taken. */
  readonly activeWindowMs: number;
  /** Each candidate tab, by id. */
  readonly tabs: ReadonlyMap<string, TabFreshness>;
}

/**
 * Read what liveness needs about each of `tabIds` from `sources`, once. A tab
 * listed twice is read once.
 */
export function takeFreshnessSnapshot(
  tabIds: Iterable<string>,
  sources: LivenessSources,
  options: { now: number; activeWindowMs: number }
): FreshnessSnapshot {
  const tabs = new Map<string, TabFreshness>();
  for (const tabId of tabIds) {
    if (tabs.has(tabId)) continue;
    const openTimes: number[] = [];
    const listener = sources.listeners.get(tabId);
    if (listener) openTimes.push(listener.openedAt);
    const ws = sources.wsClients.get(tabId);
    if (ws?.client.isConnected()) openTimes.push(ws.connectedAt);
    const lastBeatAt = sources.heartbeats.get(tabId);
    const lastSuccessAt = sources.lastSuccess.get(tabId);
    tabs.set(tabId, {
      open: openTimes.length > 0,
      ...(openTimes.length > 0 ? { openedAt: Math.max(...openTimes) } : {}),
      ...(lastBeatAt !== undefined ? { lastBeatAt } : {}),
      ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
    });
  }
  return { takenAt: options.now, activeWindowMs: options.activeWindowMs, tabs };
}

/**
 * How long before the snapshot was taken this instance last received
 * `tabId`'s heartbeat. `undefined` when it never has, and for a tab the
 * snapshot does not hold.
 */
export function heartbeatAgeMs(snapshot: FreshnessSnapshot, tabId: string): number | undefined {
  const lastBeatAt = snapshot.tabs.get(tabId)?.lastBeatAt;
  return lastBeatAt === undefined ? undefined : snapshot.takenAt - lastBeatAt;
}

/**
 * Whether `tabId` is live in `snapshot`: it holds an open transport, and its
 * heartbeat (or, when it never beat here, its youngest transport's opening)
 * is within the active window. The window is inclusive, as
 * `CommandRelay.isTabActive` reads it.
 */
export function isTabLive(snapshot: FreshnessSnapshot, tabId: string): boolean {
  const tab = snapshot.tabs.get(tabId);
  if (!tab?.open) return false;
  const beatAge = heartbeatAgeMs(snapshot, tabId);
  if (beatAge !== undefined) return beatAge <= snapshot.activeWindowMs;
  return tab.openedAt !== undefined && snapshot.takenAt - tab.openedAt <= snapshot.activeWindowMs;
}

/**
 * Whether `primary` keeps its place among `candidates`: while it is live, or
 * while no other candidate is. A registered listener alone does not keep it,
 * since a stream whose end nobody reported stays registered; a not-live
 * primary is outranked, never refused.
 */
export function keepsPrimary(
  snapshot: FreshnessSnapshot,
  primary: string,
  candidates: readonly string[]
): boolean {
  return (
    isTabLive(snapshot, primary) ||
    !candidates.some((id) => id !== primary && isTabLive(snapshot, id))
  );
}

/**
 * The comparator the relay's selectors sort candidate tab ids with, best
 * first: live before not-live, then the most recent command success, then the
 * most recent heartbeat, a tab that never beat here last. Tabs it cannot tell
 * apart keep their input order (`Array.prototype.sort` is stable).
 */
export function compareByLiveness(snapshot: FreshnessSnapshot): (a: string, b: string) => number {
  return (a, b) => {
    const liveA = isTabLive(snapshot, a);
    if (liveA !== isTabLive(snapshot, b)) return liveA ? -1 : 1;
    const tabA = snapshot.tabs.get(a);
    const tabB = snapshot.tabs.get(b);
    return (
      mostRecentFirst(tabA?.lastSuccessAt, tabB?.lastSuccessAt) ||
      mostRecentFirst(tabA?.lastBeatAt, tabB?.lastBeatAt)
    );
  };
}

/** Orders two optional instants most recent first, an absent one last. */
function mostRecentFirst(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
}
