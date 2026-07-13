/**
 * CommandRelay — Server-side command relay for UI Bridge
 *
 * Manages the command queue between HTTP API handlers (server) and browser tabs
 * (clients). External tools call server handlers, which queue commands here.
 * Browser tabs connect via SSE or WebSocket, receive commands, execute them,
 * and POST results back.
 *
 * Key behaviors:
 * - Primary tab routing with automatic failover
 * - Multi-tab broadcast with grace period (first success wins)
 * - globalThis persistence for Next.js HMR survival
 * - Fire-and-forget mode for navigation commands
 * - Configurable timeouts per transport
 *
 * Extracted from qontinui-web's proven production relay.
 */

import type { ControlSnapshot } from '../control';
import type { DOMChangeEvent } from './types';
import type { RelayBus } from './relay-bus';

// ============================================================================
// Types
// ============================================================================

export interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
}

export type CommandListener = (command: QueuedCommand) => void;

export interface TabListener {
  tabId: string;
  callback: CommandListener;
}

export interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  tabsNotified: number;
  errorResponseCount: number;
  firstError?: Error;
  graceTimeout?: ReturnType<typeof setTimeout>;
  /**
   * Cross-instance bus cleanup (P0a): set when this command was dispatched via
   * the {@link RelayBus} to a tab on another instance. Unsubscribes the
   * per-command response channel once the command settles (resolve/reject/
   * timeout). Absent for same-instance commands.
   */
  busUnsub?: () => void;
}

export interface WebSocketClient {
  clientId: string;
  send: (message: string) => void;
  isConnected: () => boolean;
  close: () => void;
}

interface WebSocketClientEntry {
  client: WebSocketClient;
  connectedAt: number;
  lastActivity: number;
}

export interface TabInfo {
  tabId: string;
  url?: string;
  pathname?: string;
  title?: string;
}

export interface TransportDiagnostics {
  pendingCommandCount: number;
  pendingCommandIds: string[];
  commandListenerCount: number;
  connectedTabs: string[];
  /** Item #15 — subset of `connectedTabs` whose heartbeat is fresh. */
  activeTabs: string[];
  primaryTabId: string | null;
  demotedTabs: string[];
  buildId: string;
  wsClientCount: number;
  wsClientIds: string[];
  commandQueueLength: number;
  tabHeartbeats: Record<string, number>;
  tabMetadata: Record<string, { url: string; title: string; visibility: string; lastSeen: number }>;
  /**
   * Per-user tab scoping (§4.2): tab id → `{userId, sessionId}`. ONLY
   * populated for tabs whose strict-mode heartbeat carried
   * `registrationMetadata`. Surfaced here so the HTTP layer can filter
   * `/tabs` / `/tabs/wait` by the caller's `X-Caller-User-Id` without
   * reaching into the relay's private state. `sessionId` is included
   * for ops diagnostics — it MUST NOT be forwarded to other users.
   */
  tabOwnership: Record<string, TabOwnership>;
  /** Item #15 — heartbeat-staleness threshold currently in force, for ops visibility. */
  staleHeartbeatMs: number;
}

export interface CommandRelayOptions {
  /** Prefix for globalThis keys (default: '__uiBridge') */
  globalPrefix?: string;
  /** WebSocket command timeout in ms (default: 10000) */
  wsTimeoutMs?: number;
  /** SSE/HTTP command timeout in ms (default: 8000) */
  sseTimeoutMs?: number;
  /** Multi-tab grace period in ms (default: 3000) */
  multiTabGraceMs?: number;
  /** Max pending commands before eviction (default: 200) */
  maxPendingCommands?: number;
  /** Heartbeat stale threshold in ms (default: 30000) */
  heartbeatStaleMs?: number;
  /** Time after which a demoted tab with no heartbeat is cleaned up (default: 60000) */
  tabDemotionTtlMs?: number;
  /**
   * Threshold after which a tab whose heartbeat has gone silent is forcibly
   * disconnected ("pruned") by the relay — its SSE listener / WebSocket
   * entry are dropped, primary status is demoted, and `connectedTabs` no
   * longer reports it. Distinct from `tabDemotionTtlMs`, which only purges
   * the *metadata* of an already-disconnected tab.
   *
   * Defaults to 30_000 ms (≈ 6 missed heartbeats at the SDK's 5s cadence).
   * Override via the `UI_BRIDGE_STALE_HEARTBEAT_MS` env var when bootstrapping
   * from a runtime without a constructor option (e.g. `next dev`).
   */
  staleHeartbeatMs?: number;
  /**
   * Interval between stale-tab sweep passes. Lower values prune zombie tabs
   * faster at the cost of more wake-ups. Defaults to 10_000 ms.
   */
  staleHeartbeatSweepMs?: number;
  /**
   * Optional cross-instance message bus (P0a). When provided, commands whose
   * target tab is NOT connected to THIS process instance are delivered to the
   * instance that holds the tab via the bus, and the browser's response is
   * routed back to this instance. Required for correct operation on
   * horizontally-scaled serverless (Vercel) where each request may hit a
   * different lambda instance. When omitted, the relay is single-process
   * in-memory exactly as before. See {@link RelayBus}.
   */
  bus?: RelayBus;
}

/** Read a positive-integer env override, returning `fallback` on miss/invalid. */
function envInt(name: string, fallback: number): number {
  if (typeof process === 'undefined' || !process?.env) return fallback;
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Commands that cause the page to unload — resolved immediately after delivery
const DEFAULT_FIRE_AND_FORGET = new Set(['pageNavigate', 'pageRefresh']);

/**
 * Error subclass thrown when a `targetTabId` is supplied but the relay
 * cannot route the command to that tab. The `code` field surfaces the
 * specific failure mode so callers can render an actionable diagnostic
 * (`TAB_NOT_FOUND`, `TAB_STALE`) instead of inferring intent from the
 * prose message.
 */
export class TabRoutingError extends Error {
  readonly code: 'TAB_NOT_FOUND' | 'TAB_STALE';
  readonly tabId: string;
  readonly connectedTabs: string[];

  constructor(
    code: 'TAB_NOT_FOUND' | 'TAB_STALE',
    tabId: string,
    connectedTabs: string[],
    message: string
  ) {
    super(message);
    this.name = 'TabRoutingError';
    this.code = code;
    this.tabId = tabId;
    this.connectedTabs = connectedTabs;
  }
}

/**
 * Error subclass thrown when a caller asks the relay to dispatch a command
 * to a `targetTabId` whose stored ownership metadata does NOT match the
 * caller's authenticated `userId`. The relay surfaces this as
 * `TAB_NOT_FOUND` (404) at the HTTP layer — NOT `403` — because the
 * caller is not supposed to learn that the tab even exists. The
 * dedicated subclass exists so the HTTP layer can distinguish a real
 * `TAB_NOT_FOUND` from an ownership-mismatch redaction for metrics /
 * structured logging, without leaking the distinction to the wire.
 */
export class OwnerMismatchError extends Error {
  readonly code = 'OWNER_MISMATCH' as const;
  readonly tabId: string;
  /** The userId the caller authenticated as. */
  readonly callerUserId: string;
  /** The userId stored as the tab's owner (NEVER returned over the wire). */
  readonly storedUserId: string;

  constructor(tabId: string, callerUserId: string, storedUserId: string) {
    // Intentionally generic prose so the message itself doesn't leak the
    // existence of the tab — callers should re-stamp this as TAB_NOT_FOUND
    // at the HTTP boundary. The structured fields are for server-side
    // observability only.
    super(`tabId "${tabId}" is not addressable by the authenticated caller`);
    this.name = 'OwnerMismatchError';
    this.tabId = tabId;
    this.callerUserId = callerUserId;
    this.storedUserId = storedUserId;
  }
}

/**
 * Stored ownership record for a registered tab. Populated by
 * `recordRegistration` on first heartbeat carrying `registrationMetadata`
 * and refreshed on every subsequent heartbeat. A tab WITHOUT an entry
 * here is treated as un-registered by `listOwnedTabs`,
 * `assertOwnership`, and the bus-envelope receiver check.
 */
export interface TabOwnership {
  userId: string;
  sessionId: string;
  /** First heartbeat that supplied metadata. */
  firstSeen: number;
  /** Most recent heartbeat that supplied metadata. */
  lastSeen: number;
}

// ============================================================================
// CommandRelay
// ============================================================================

export class CommandRelay {
  private readonly prefix: string;
  private readonly wsTimeoutMs: number;
  private readonly sseTimeoutMs: number;
  private readonly multiTabGraceMs: number;
  private readonly maxPendingCommands: number;
  private readonly heartbeatStaleMs: number;
  private readonly tabDemotionTtlMs: number;
  private readonly staleHeartbeatMs: number;
  private readonly staleHeartbeatSweepMs: number;

  // All state lives on globalThis for HMR survival
  private readonly pendingCommands: Map<string, PendingCommand>;
  private readonly tabListeners: Map<string, TabListener>;
  private readonly wsClients: Map<string, WebSocketClientEntry>;
  private readonly demotedTabs: Set<string>;
  private readonly commandQueue: QueuedCommand[];
  private readonly tabHeartbeats: Map<string, number>;
  private readonly tabMetadata: Map<
    string,
    { url: string; title: string; visibility: string; lastSeen: number }
  >;
  private readonly tabLastSuccess: Map<string, number>;
  /**
   * Per-user tab-scoping registry. Tracks which authenticated user a tab
   * was registered under via the strict heartbeat protocol. A tab is
   * "registered" — and therefore addressable by authenticated dispatch —
   * only when it has an entry here. Lives on `globalThis` alongside the
   * other relay state for Next.js HMR survival.
   */
  private readonly tabOwnership: Map<string, TabOwnership>;

  // Simple value state
  private primaryTabId: string | null;
  readonly buildId: string;

  /**
   * Optional cross-instance bus (P0a). `null` = single-process in-memory
   * (default, behavior unchanged). All bus call sites are guarded by `this.bus`.
   */
  private readonly bus: RelayBus | null;

  // Cleanup interval handle
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Connection readiness gate
  private connectionReadyResolve: (() => void) | null;
  private connectionReady: Promise<void>;

  constructor(options?: CommandRelayOptions) {
    this.prefix = options?.globalPrefix ?? '__uiBridge';
    this.wsTimeoutMs = options?.wsTimeoutMs ?? 10_000;
    this.sseTimeoutMs = options?.sseTimeoutMs ?? 8_000;
    this.multiTabGraceMs = options?.multiTabGraceMs ?? 3_000;
    this.maxPendingCommands = options?.maxPendingCommands ?? 200;
    this.heartbeatStaleMs = options?.heartbeatStaleMs ?? 30_000;
    this.tabDemotionTtlMs = options?.tabDemotionTtlMs ?? 60_000;
    // Item #15 — tab pruning (forced disconnect of zombie tabs). Precedence:
    // explicit option > UI_BRIDGE_STALE_HEARTBEAT_MS env > default 30s. Six
    // missed heartbeats at the SDK's typical 5s cadence.
    this.staleHeartbeatMs =
      options?.staleHeartbeatMs ?? envInt('UI_BRIDGE_STALE_HEARTBEAT_MS', 30_000);
    this.staleHeartbeatSweepMs = options?.staleHeartbeatSweepMs ?? 10_000;
    this.bus = options?.bus ?? null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const key = (suffix: string) => `${this.prefix}${suffix}`;

    if (!g[key('PendingCommands')]) g[key('PendingCommands')] = new Map();
    if (!g[key('TabListeners')]) g[key('TabListeners')] = new Map();
    if (!g[key('WsClients')]) g[key('WsClients')] = new Map();
    if (!g[key('DemotedTabs')]) g[key('DemotedTabs')] = new Set();
    if (!g[key('CommandQueue')]) g[key('CommandQueue')] = [];
    if (!g[key('PrimaryTabId')]) g[key('PrimaryTabId')] = null;
    if (!g[key('TabHeartbeats')]) g[key('TabHeartbeats')] = new Map();
    if (!g[key('TabMetadata')]) g[key('TabMetadata')] = new Map();
    if (!g[key('TabLastSuccess')]) g[key('TabLastSuccess')] = new Map();
    if (!g[key('TabOwnership')]) g[key('TabOwnership')] = new Map();
    if (!g[key('BuildId')]) g[key('BuildId')] = Date.now().toString();

    if (!g[key('ConnectionReady')]) {
      let resolve: (() => void) | null = null;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      g[key('ConnectionReady')] = promise;
      g[key('ConnectionReadyResolve')] = resolve;
    }
    this.connectionReady = g[key('ConnectionReady')];
    this.connectionReadyResolve = g[key('ConnectionReadyResolve')];

    this.pendingCommands = g[key('PendingCommands')];
    this.tabListeners = g[key('TabListeners')];
    this.wsClients = g[key('WsClients')];
    this.demotedTabs = g[key('DemotedTabs')];
    this.commandQueue = g[key('CommandQueue')];
    this.primaryTabId = g[key('PrimaryTabId')];
    this.tabHeartbeats = g[key('TabHeartbeats')];
    this.tabMetadata = g[key('TabMetadata')];
    this.tabLastSuccess = g[key('TabLastSuccess')];
    this.tabOwnership = g[key('TabOwnership')];
    this.buildId = g[key('BuildId')];

    // Periodic cleanup. Runs at `staleHeartbeatSweepMs` cadence and performs
    // two passes: (a) the legacy metadata GC for tabs that already lost their
    // transport, and (b) Item #15 — active prune of zombie tabs whose
    // heartbeat has gone stale despite the transport still appearing
    // connected. Bundled into one interval to avoid two competing timers.
    if (!g[key('CleanupInterval')]) {
      g[key('CleanupInterval')] = setInterval(() => {
        try {
          this.pruneStaleTabs();
        } catch (err) {
          console.error('[ui-bridge] pruneStaleTabs failed:', err);
        }
        try {
          this.cleanupStaleTabs();
        } catch (err) {
          console.error('[ui-bridge] cleanupStaleTabs failed:', err);
        }
        if (this.bus) {
          try {
            this.refreshBusTabPresence();
          } catch (err) {
            console.error('[ui-bridge] refreshBusTabPresence failed:', err);
          }
        }
      }, this.staleHeartbeatSweepMs);
    }
    this.cleanupInterval = g[key('CleanupInterval')];
  }

  // --------------------------------------------------------------------------
  // Item #15 — Stale-Tab Pruning
  // --------------------------------------------------------------------------

  /**
   * Forcibly disconnect tabs whose heartbeat has gone silent for longer
   * than `staleHeartbeatMs`. Removes their SSE listener entry, WebSocket
   * client entry, heartbeat record, and metadata. If the pruned tab was
   * the current primary, demotes it and re-selects the most-recently
   * heartbeated alternative.
   *
   * Returns the list of pruned tab ids — exposed for tests and ops tooling
   * that want to drive a sweep deterministically without waiting for the
   * timer.
   */
  pruneStaleTabs(): string[] {
    const now = Date.now();
    const pruned: string[] = [];

    // Collect every connected tab id (SSE + WS) along with its last beat.
    const candidates = new Set<string>();
    for (const id of this.tabListeners.keys()) candidates.add(id);
    for (const id of this.wsClients.keys()) candidates.add(id);

    for (const tabId of candidates) {
      const lastBeat = this.tabHeartbeats.get(tabId);
      // Tabs that have never sent a heartbeat are NOT pruned — they may
      // still be in the proactive-snapshot warmup window before the SDK
      // emits its first beat. Heartbeat-aware pruning fires once the SDK
      // has demonstrated it knows the cadence and then went silent.
      if (lastBeat === undefined) continue;
      const ageMs = now - lastBeat;
      if (ageMs <= this.staleHeartbeatMs) continue;

      // Drop the transport entries. Listeners that were registered via
      // `subscribeToCommands` had their unsubscribe stored in the SSE
      // stream closure; dropping the entry here means the callback is
      // never invoked again — the stream itself will tear down on the
      // next heartbeat-timeout from the client side, which is acceptable
      // since the tab is already a zombie.
      this.tabListeners.delete(tabId);
      const wsEntry = this.wsClients.get(tabId);
      if (wsEntry) {
        try {
          wsEntry.client.close();
        } catch {
          /* connection may already be torn down */
        }
        this.wsClients.delete(tabId);
      }
      this.tabHeartbeats.delete(tabId);
      this.tabMetadata.delete(tabId);
      this.tabLastSuccess.delete(tabId);
      this.tabOwnership.delete(tabId);
      this.demotedTabs.delete(tabId);

      // If this was the primary, demote and pick a successor below.
      if (this.primaryTabId === tabId) {
        this.primaryTabId = null;
        this.persistPrimaryTab();
      }

      pruned.push(tabId);
      // Structured emission — JSON payload on a single line so log aggregators
      // can parse without multiline buffering.
      console.log(
        `[ui-bridge] ${JSON.stringify({
          event: 'tab.pruned',
          id: tabId,
          lastHeartbeatAt: lastBeat,
          age_ms: ageMs,
          staleHeartbeatMs: this.staleHeartbeatMs,
        })}`
      );
    }

    // If we dropped the primary, recompute. Picks the alternative with the
    // most recent heartbeat (falls back to insertion order via
    // `getPrimaryTabId`'s tabLastSuccess sort).
    if (pruned.length > 0 && this.primaryTabId === null) {
      const successor = this.selectPrimarySuccessor();
      if (successor) {
        this.setPrimaryTab(successor);
      }
    }

    if (pruned.length > 0) {
      this.resetConnectionGateIfEmpty();
    }

    return pruned;
  }

  /**
   * Pick the most-recently-heartbeated connected tab as the new primary.
   * Returns `null` if no candidate is connected.
   */
  private selectPrimarySuccessor(): string | null {
    const candidates: string[] = [];
    for (const id of this.tabListeners.keys()) {
      if (!this.demotedTabs.has(id)) candidates.push(id);
    }
    for (const [id, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected() && !this.demotedTabs.has(id) && !candidates.includes(id)) {
        candidates.push(id);
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const ah = this.tabHeartbeats.get(a) ?? 0;
      const bh = this.tabHeartbeats.get(b) ?? 0;
      return bh - ah;
    });
    return candidates[0]!;
  }

  /**
   * Return the set of currently active (non-stale) connected tab ids.
   * Used by `GET /tabs?activeOnly=true` and the "is this tab still
   * routable?" check inside `queueCommandInner`.
   */
  getActiveTabs(): string[] {
    const now = Date.now();
    const active: string[] = [];
    const seen = new Set<string>();
    const consider = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const lastBeat = this.tabHeartbeats.get(id);
      // A tab with no heartbeat yet (e.g. brand-new SSE connection that
      // hasn't beaten yet) is treated as active — same policy as
      // pruneStaleTabs(), which doesn't prune those tabs either.
      if (lastBeat === undefined) {
        active.push(id);
        return;
      }
      if (now - lastBeat <= this.staleHeartbeatMs) {
        active.push(id);
      }
    };
    for (const id of this.tabListeners.keys()) consider(id);
    for (const [id, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected()) consider(id);
    }
    return active;
  }

  /**
   * Check whether a specific tab id is currently active (connected and
   * fresh-heartbeated). Used by per-tab dispatch routing to reject
   * stale-tab targets fast.
   */
  isTabActive(tabId: string): boolean {
    const hasTransport = this.tabListeners.has(tabId) || this.wsClients.has(tabId);
    if (!hasTransport) return false;
    const lastBeat = this.tabHeartbeats.get(tabId);
    if (lastBeat === undefined) return true; // pre-heartbeat warmup
    return Date.now() - lastBeat <= this.staleHeartbeatMs;
  }

  /**
   * Remove entries from tabHeartbeats and demotedTabs for tabs no longer connected.
   */
  private cleanupStaleTabs(): void {
    const now = Date.now();
    for (const [tabId, lastBeat] of this.tabHeartbeats.entries()) {
      const hasListener = this.tabListeners.has(tabId);
      const hasWs = this.wsClients.has(tabId);
      if (!hasListener && !hasWs) {
        // Tab is no longer connected — remove if heartbeat is stale
        if (now - lastBeat > this.tabDemotionTtlMs) {
          this.tabHeartbeats.delete(tabId);
          this.demotedTabs.delete(tabId);
          this.tabLastSuccess.delete(tabId);
          this.tabMetadata.delete(tabId);
          // Ownership tracks the *transport* — once the transport is gone
          // and the heartbeat has aged out, drop the owner record too so
          // a future tab with a recycled id doesn't inherit a stale owner.
          this.tabOwnership.delete(tabId);
        }
      }
    }
    // Also clean demoted tabs that have no heartbeat entry and no connection
    for (const tabId of this.demotedTabs) {
      if (
        !this.tabListeners.has(tabId) &&
        !this.wsClients.has(tabId) &&
        !this.tabHeartbeats.has(tabId)
      ) {
        this.demotedTabs.delete(tabId);
      }
    }
  }

  /**
   * Reset the connection readiness gate when all transports have disconnected.
   * The next call to queueCommand() will block until a new transport connects.
   */
  private resetConnectionGateIfEmpty(): void {
    if (this.tabListeners.size === 0 && this.wsClients.size === 0 && !this.connectionReadyResolve) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as any;
      const key = (suffix: string) => `${this.prefix}${suffix}`;
      let resolve: (() => void) | null = null;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      g[key('ConnectionReady')] = promise;
      g[key('ConnectionReadyResolve')] = resolve;
      this.connectionReady = promise;
      this.connectionReadyResolve = resolve;
    }
  }

  // --------------------------------------------------------------------------
  // Primary Tab Routing
  // --------------------------------------------------------------------------

  private getPrimaryTabId(): string | null {
    // Re-promote demoted tabs whose heartbeat is fresh AND still have an active connection
    const now = Date.now();
    for (const tabId of Array.from(this.demotedTabs)) {
      const lastBeat = this.tabHeartbeats.get(tabId);
      if (lastBeat && now - lastBeat < this.heartbeatStaleMs) {
        if (this.tabListeners.has(tabId) || this.wsClients.has(tabId)) {
          this.demotedTabs.delete(tabId);
          console.log(`[ui-bridge] Re-promoted tab with fresh heartbeat: ${tabId}`);
        }
      }
    }

    if (this.primaryTabId && !this.demotedTabs.has(this.primaryTabId)) {
      if (this.tabListeners.has(this.primaryTabId) || this.wsClients.has(this.primaryTabId)) {
        return this.primaryTabId;
      }
      this.primaryTabId = null;
      this.persistPrimaryTab();
    }

    // Collect all candidate tabs (non-demoted, connected)
    const candidates: string[] = [];
    for (const tab of this.tabListeners.keys()) {
      if (!this.demotedTabs.has(tab)) {
        candidates.push(tab);
      }
    }
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (
        entry.client.isConnected() &&
        !this.demotedTabs.has(clientId) &&
        !candidates.includes(clientId)
      ) {
        candidates.push(clientId);
      }
    }

    if (candidates.length === 0) return null;

    // Sort candidates by tabLastSuccess (most recent first), then by insertion order
    candidates.sort((a, b) => {
      const aSuccess = this.tabLastSuccess.get(a) ?? 0;
      const bSuccess = this.tabLastSuccess.get(b) ?? 0;
      return bSuccess - aSuccess;
    });

    this.setPrimaryTab(candidates[0]!);
    return this.primaryTabId;
  }

  private setPrimaryTab(tabId: string): void {
    this.primaryTabId = tabId;
    this.persistPrimaryTab();
    console.log(`[ui-bridge] Primary tab: ${tabId}`);
  }

  private persistPrimaryTab(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any)[`${this.prefix}PrimaryTabId`] = this.primaryTabId;
  }

  private demotePrimaryTab(tabId: string): void {
    this.demotedTabs.add(tabId);
    if (this.primaryTabId === tabId) {
      this.primaryTabId = null;
      this.persistPrimaryTab();
      console.log(`[ui-bridge] Primary tab demoted: ${tabId}`);
    }
  }

  // --------------------------------------------------------------------------
  // Command Queue
  // --------------------------------------------------------------------------

  private generateCommandId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Queue a command with primary tab routing, automatic failover,
   * and retry-on-disconnect.
   *
   * Per-user tab scoping (§4.2): pass `options.ownerCheck = {userId}` to
   * enforce that the dispatched command can only reach tabs owned by the
   * given authenticated user. With `targetTabId`, a mismatch surfaces as
   * `TabRoutingError` / `TAB_NOT_FOUND` (deliberately the same shape as
   * an unknown-tab failure — see {@link OwnerMismatchError}). Without
   * `targetTabId`, the fanout is restricted to the user's tabs and
   * yields `SDK_DISCONNECTED` if none match (the no-leak fallback —
   * never disclose that other users have tabs).
   */
  async queueCommand<T>(
    action: string,
    payload: unknown,
    options?: { targetTabId?: string; ownerCheck?: { userId: string } }
  ): Promise<T> {
    // Owner-scoped fanout: when no targetTabId AND an ownerCheck is in
    // play, gate the "wait for any transport" branch on the caller's
    // OWN tabs, not the global registry. Without this, an unscoped
    // dispatch by a user with zero tabs would block waiting for someone
    // else's tab to connect.
    const ownerCheck = options?.ownerCheck;
    const hasOwnerCheck = !!ownerCheck;
    const ownedCount = hasOwnerCheck
      ? this.listOwnedTabs(ownerCheck!.userId).length
      : this.tabListeners.size + this.wsClients.size;

    // Wait for at least one transport if none available
    if (!options?.targetTabId && ownedCount === 0) {
      await Promise.race([
        this.connectionReady,
        new Promise<void>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'SDK_DISCONNECTED: No browser connected — no WebSocket clients and no SSE listeners. ' +
                    'Open the web app in a browser tab, or launch a headless one with ' +
                    '`npx @qontinui/ui-bridge-headless --url <your-app-url>`. ' +
                    'Use `GET /tabs/wait?timeoutMs=<ms>` to block until the tab registers.'
                )
              ),
            // Owner-scoped fallback: a same-user reconnect within ~3s is
            // plausible, but the cross-user "leak guard" cares about a
            // FAST `NO_BROWSER_CONNECTED` shape so the caller doesn't
            // infer "other users have tabs" from a 3s hang. Short-circuit
            // ownership-scoped misses immediately.
            hasOwnerCheck ? 0 : 3000
          )
        ),
      ]);
    }

    // Attempt the command — if SDK_DISCONNECTED, wait for reconnection and retry once
    try {
      return await this.queueCommandInner<T>(action, payload, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Ownership mismatch surfaces as TAB_NOT_FOUND at the HTTP layer.
      // Re-throw without a retry — the caller is not addressing a tab
      // they own, no reconnect will fix that.
      if (err instanceof OwnerMismatchError) throw err;
      if (msg.includes('SDK_DISCONNECTED') || msg.includes('No browser connected')) {
        // Owner-scoped misses don't retry — the reconnection branch
        // waits on the GLOBAL connection-ready gate, which would block
        // a per-user dispatch on a tab belonging to a different user.
        if (hasOwnerCheck) throw err;
        console.log(`[ui-bridge] ${action} failed (disconnected), waiting for reconnection...`);
        try {
          await Promise.race([
            this.connectionReady,
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('Reconnection timeout')), 2000)
            ),
          ]);
          console.log(`[ui-bridge] Reconnected, retrying ${action}`);
          return await this.queueCommandInner<T>(action, payload, options);
        } catch {
          // Retry failed — throw original error
          throw err;
        }
      }
      throw err;
    }
  }

  /**
   * Inner command queue implementation (no retry logic).
   */
  private async queueCommandInner<T>(
    action: string,
    payload: unknown,
    options?: { targetTabId?: string; ownerCheck?: { userId: string } }
  ): Promise<T> {
    const targetTabId = options?.targetTabId;
    const ownerCheck = options?.ownerCheck;

    // Explicit target — Item #4 (per-tab routing). Validate that the tab is
    // both registered AND not stale BEFORE attempting to send. Without this,
    // a caller pinning a zombie tab would either silently route to nobody
    // (broadcast-to-zero) or hang until the wsTimeoutMs/sseTimeoutMs grace
    // expired. We want a fast, structured failure with a code the upstream
    // multi-machine driver can branch on.
    if (targetTabId) {
      // Per-user tab scoping (§4.2): when an ownerCheck is in play, verify
      // the stored owner matches BEFORE the transport / heartbeat checks.
      // The mismatch surfaces as `TAB_NOT_FOUND` at the HTTP layer so the
      // caller cannot distinguish "tab does not exist" from "tab belongs
      // to someone else". `assertOwnership` is a no-op for tabs that have
      // no ownership record yet — those fall through to the TAB_NOT_FOUND
      // path below regardless.
      if (ownerCheck) {
        this.assertOwnership(targetTabId, ownerCheck.userId);
      }
      const hasTransport =
        this.tabListeners.has(targetTabId) || this.wsClients.has(targetTabId);
      if (!hasTransport) {
        // Cross-instance (P0a): the tab may be connected to a DIFFERENT process
        // instance (Vercel serverless fan-out). Consult the shared presence
        // registry; if the tab is known elsewhere, dispatch via the bus (which
        // routes the command to the holding instance and the response back).
        if (this.bus && (await this.bus.isTabKnown(targetTabId))) {
          return this.sendCommand<T>(action, payload, options);
        }
        // Owner-scoped TAB_NOT_FOUND: redact the connectedTabs list to the
        // caller's own tabs so the response doesn't reveal that other users
        // have tabs. Admin/no-owner callers continue to see the full list.
        const connected = ownerCheck
          ? this.listOwnedTabs(ownerCheck.userId)
          : Array.from(new Set([...this.tabListeners.keys(), ...this.wsClients.keys()]));
        throw new TabRoutingError(
          'TAB_NOT_FOUND',
          targetTabId,
          connected,
          `tabId "${targetTabId}" is not in connectedTabs (currently: [${connected.join(', ')}]). ` +
            `Use GET /tabs to discover live tab ids, or omit tabId to dispatch to the primary tab.`
        );
      }
      if (!this.isTabActive(targetTabId)) {
        const lastBeat = this.tabHeartbeats.get(targetTabId);
        const ageMs = lastBeat ? Date.now() - lastBeat : -1;
        const active = ownerCheck
          ? this.getActiveTabs().filter((id) => {
              const owner = this.tabOwnership.get(id);
              return owner?.userId === ownerCheck.userId;
            })
          : this.getActiveTabs();
        throw new TabRoutingError(
          'TAB_STALE',
          targetTabId,
          active,
          `tabId "${targetTabId}" is registered but its last heartbeat is ` +
            `${ageMs}ms old (threshold ${this.staleHeartbeatMs}ms). ` +
            `Active tabs: [${active.join(', ')}]. ` +
            `The tab will be pruned on the next sweep — retry without pinning, or pick another tab.`
        );
      }
      return this.sendCommand<T>(action, payload, options);
    }

    // Owner-scoped unscoped fanout: pick the caller's primary tab (the
    // most-recently-heartbeated of their own tabs), or fan out across
    // their tabs only. Never touches another user's tabs. If the user
    // has zero tabs, surface SDK_DISCONNECTED — the no-leak fallback.
    if (ownerCheck) {
      const owned = this.listOwnedTabs(ownerCheck.userId);
      if (owned.length === 0) {
        throw new Error(
          `SDK_DISCONNECTED: No browser connected to receive ${action} command. ` +
            'No WebSocket clients and no SSE listeners registered. ' +
            'Open the web app in a browser tab, or launch a headless one with ' +
            '`npx @qontinui/ui-bridge-headless --url <your-app-url>`. ' +
            'Use `GET /tabs/wait?timeoutMs=<ms>` to block until the tab registers.'
        );
      }
      // Prefer the user's most-recently-successful tab to stay sticky.
      owned.sort((a, b) => (this.tabLastSuccess.get(b) ?? 0) - (this.tabLastSuccess.get(a) ?? 0));
      const ownedPrimary = owned[0]!;
      return this.sendCommand<T>(action, payload, {
        targetTabId: ownedPrimary,
        ownerCheck,
      }).catch((firstError: Error) => {
        if (owned.length <= 1) throw firstError;
        // One automatic failover across the user's other tabs. Mirrors
        // the global primary-tab failover behavior, bounded to this user.
        const fallback = owned[1]!;
        console.log(
          `[ui-bridge] Owned tab ${ownedPrimary} failed for ${action}, retrying on ${fallback}`
        );
        return this.sendCommand<T>(action, payload, { targetTabId: fallback, ownerCheck });
      });
    }

    // Primary tab routing with automatic failover
    const primaryId = this.getPrimaryTabId();
    if (primaryId) {
      return this.sendCommand<T>(action, payload, { targetTabId: primaryId }).catch(
        (firstError: Error) => {
          this.demotePrimaryTab(primaryId);
          const newPrimaryId = this.getPrimaryTabId();
          if (newPrimaryId) {
            console.log(
              `[ui-bridge] Primary tab ${primaryId} failed for ${action}, retrying on ${newPrimaryId}`
            );
            return this.sendCommand<T>(action, payload, { targetTabId: newPrimaryId });
          }
          throw firstError;
        }
      );
    }

    // No primary tab — broadcast to all
    return this.sendCommand<T>(action, payload);
  }

  /**
   * Low-level: send a command to a specific tab or broadcast to all.
   * `ownerCheck` is threaded through to the cross-instance bus envelope
   * so the receiving instance re-verifies ownership against ITS local
   * registry (not whatever the sending instance "thinks" the owner is —
   * the sending instance may hold stale ownership metadata).
   */
  private sendCommand<T>(
    action: string,
    payload: unknown,
    options?: { targetTabId?: string; ownerCheck?: { userId: string } }
  ): Promise<T> {
    const targetTabId = options?.targetTabId;
    const senderUserId = options?.ownerCheck?.userId;
    const commandId = this.generateCommandId();
    const fireAndForget = DEFAULT_FIRE_AND_FORGET.has(action);
    console.log(
      `[ui-bridge] queueCommand: ${action} (ws=${this.wsClients.size}, sse=${this.tabListeners.size}${targetTabId ? `, target=${targetTabId}` : ''}${fireAndForget ? ', fire-and-forget' : ''})`
    );

    return new Promise((resolve, reject) => {
      // Try WebSocket delivery first
      const sentViaWebSocket = this.sendCommandViaWebSocket(
        commandId,
        action,
        payload,
        targetTabId
      );

      let transport = 'none';
      let timeoutMs = this.sseTimeoutMs;

      if (sentViaWebSocket) {
        transport = 'WebSocket';
        timeoutMs = this.wsTimeoutMs;
      }

      // Cross-instance (P0a): when the target tab is NOT reachable from this
      // instance but a bus is configured, route the command to the instance
      // holding the tab and await the response over the bus. Gated on
      // "not deliverable locally" so same-instance delivery never double-fires.
      const deliverableLocally =
        sentViaWebSocket ||
        (targetTabId ? this.tabListeners.has(targetTabId) : this.tabListeners.size > 0);
      if (!deliverableLocally && this.bus) {
        if (fireAndForget) {
          this.bus.publishCommand({
            commandId,
            action,
            payload,
            timestamp: Date.now(),
            targetTabId,
            senderUserId,
          });
          // Cross-instance fire-and-forget: the command is published to the bus
          // for the holding instance to deliver; we cannot observe its execution
          // from here, so report `delivered` without claiming `executed` — same
          // envelope shape the local path returns so the audit's execution-status
          // field stays consistent across single- and multi-instance topologies.
          resolve({
            success: true,
            fireAndForget: true,
            delivered: true,
            executed: false,
            action,
            timestamp: Date.now(),
          } as T);
        } else {
          this.dispatchViaBus<T>(
            commandId,
            action,
            payload,
            targetTabId,
            senderUserId,
            resolve,
            reject
          );
        }
        return;
      }

      // Fail fast if no transport available
      if (!sentViaWebSocket && this.tabListeners.size === 0) {
        reject(
          new Error(
            `SDK_DISCONNECTED: No browser connected to receive ${action} command. ` +
              'No WebSocket clients and no SSE listeners registered. ' +
              'Open the web app in a browser tab, or launch a headless one with ' +
              '`npx @qontinui/ui-bridge-headless --url <your-app-url>`. ' +
              'Use `GET /tabs/wait?timeoutMs=<ms>` to block until the tab registers.'
          )
        );
        return;
      }

      // Fire-and-forget: a navigation/refresh command unloads the page, so the
      // browser may never POST its execution result before the SSE/WS transport
      // tears down. We therefore resolve the HTTP caller as soon as the command
      // is DELIVERED rather than blocking on a response that may never arrive.
      //
      // Two co-pilot remediations vs. the previous implementation:
      //
      //   (1) Delivery verification. The old code discarded the
      //       `broadcastToListeners` notified count and ALWAYS resolved
      //       `{success:true}`. A `pageNavigate` routed to a `targetTabId` with
      //       no registered SSE listener therefore reached ZERO tabs yet was
      //       reported to the caller as HTTP 200 success — the page never
      //       navigated (acked-but-never-delivered). We now reject when nothing
      //       accepted the command.
      //
      //   (2) Honest execution-status envelope + a non-dropping result sink.
      //       We resolve with `delivered:true, executed:false` (NOT a bare
      //       `success:true` that implies the page ran the command) so the web
      //       audit's execution-status field can distinguish "delivered to the
      //       tab" from "the tab confirmed it executed". The browser still POSTs
      //       its real execution outcome back via POST /commands; previously
      //       that landed in `resolveCommand` with NO pending entry and was
      //       silently dropped. We register a short-lived recorder entry so the
      //       outcome is accepted — updating per-tab success health and (when a
      //       bus is configured) forwarded — instead of discarded.
      if (fireAndForget) {
        let notified = sentViaWebSocket ? 1 : 0;
        if (!sentViaWebSocket && this.tabListeners.size > 0) {
          const command: QueuedCommand = { commandId, action, payload, timestamp: Date.now() };
          notified = this.broadcastToListeners(command, targetTabId);
        }

        // Delivery verification — the primary co-pilot "navigate acked 200 but
        // route never changed" root cause: `targetTabId` pointed at a tab with
        // no live listener, so `broadcastToListeners` returned 0 and the
        // navigation was silently dropped while the relay still returned success.
        if (notified === 0) {
          reject(
            new Error(
              `No active UI Bridge SDK client received the ${action} command. ` +
                `${this.tabListeners.size} SSE listener(s) registered but none accepted the command` +
                `${targetTabId ? ` (target tab "${targetTabId}" has no live listener)` : ''}. ` +
                'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.'
            )
          );
          return;
        }

        // Non-dropping result sink: register a brief recorder so the browser's
        // execution POST (resolveCommand/rejectCommand) is accepted rather than
        // dropped. The recorder does NOT settle the caller's promise (already
        // resolved on delivery below) — it only lets the relay observe the
        // real outcome (per-tab success tracking / bus forwarding). Auto-evicts
        // after a short window since a hard navigation never reports back.
        const recorderTtlMs = Math.min(this.sseTimeoutMs, 2000);
        const recorderTimeout = setTimeout(() => {
          this.pendingCommands.delete(commandId);
        }, recorderTtlMs);
        this.pendingCommands.set(commandId, {
          resolve: () => {
            /* execution outcome recorded by resolveCommand bookkeeping; the
               fire-and-forget caller was already resolved on delivery */
          },
          reject: () => {
            /* execution failure surfaces on the browser side + the audit's
               execution-status field; nothing to settle here */
          },
          timeout: recorderTimeout,
          tabsNotified: notified,
          errorResponseCount: 0,
        });

        resolve({
          success: true,
          fireAndForget: true,
          delivered: true,
          executed: false,
          tabsNotified: notified,
          action,
          timestamp: Date.now(),
        } as T);
        return;
      }

      const timeout = setTimeout(() => {
        const pending = this.pendingCommands.get(commandId);
        if (pending?.graceTimeout) clearTimeout(pending.graceTimeout);
        const notified = pending?.tabsNotified ?? 0;
        this.pendingCommands.delete(commandId);
        reject(
          new Error(
            `Command ${action} timed out after ${timeoutMs}ms (${transport}). ` +
              `${notified} client(s) were notified but none responded. ` +
              'The UI Bridge SDK may not be loaded or the page may be unresponsive.'
          )
        );
      }, timeoutMs);

      // Evict oldest if at capacity
      if (this.pendingCommands.size >= this.maxPendingCommands) {
        const oldestKey = this.pendingCommands.keys().next().value;
        if (oldestKey) {
          const oldest = this.pendingCommands.get(oldestKey);
          if (oldest) {
            clearTimeout(oldest.timeout);
            if (oldest.graceTimeout) clearTimeout(oldest.graceTimeout);
            if (oldest.busUnsub) oldest.busUnsub();
            oldest.reject(new Error('Command evicted: too many pending commands'));
          }
          this.pendingCommands.delete(oldestKey);
        }
      }

      const pending: PendingCommand = {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        tabsNotified: sentViaWebSocket ? 1 : 0,
        errorResponseCount: 0,
      };
      this.pendingCommands.set(commandId, pending);

      // If WebSocket failed, push via SSE
      if (!sentViaWebSocket) {
        const command: QueuedCommand = { commandId, action, payload, timestamp: Date.now() };

        if (this.tabListeners.size > 0) {
          transport = 'SSE';
          pending.tabsNotified = this.broadcastToListeners(command, targetTabId);

          // If broadcast reached no listeners, fail immediately
          if (pending.tabsNotified === 0) {
            clearTimeout(timeout);
            this.pendingCommands.delete(commandId);
            reject(
              new Error(
                `No active UI Bridge SDK client received the ${action} command. ` +
                  `${this.tabListeners.size} SSE listener(s) registered but none accepted the command. ` +
                  'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.'
              )
            );
            return;
          }
        } else {
          transport = 'HTTP-poll';
          this.commandQueue.push(command);
          while (this.commandQueue.length > 100) {
            const dropped = this.commandQueue.shift();
            if (dropped) {
              const p = this.pendingCommands.get(dropped.commandId);
              if (p) {
                clearTimeout(p.timeout);
                p.reject(new Error('Command dropped from queue'));
                this.pendingCommands.delete(dropped.commandId);
              }
            }
          }
        }
      }
    });
  }

  /**
   * Cross-instance (P0a) dispatch: register the pending promise + a per-command
   * bus response subscription, THEN publish the command over the bus. Publishing
   * last guarantees no response can race ahead of the pending registration.
   * The browser's response POST may land on any instance; that instance forwards
   * it via {@link resolveCommand}/{@link rejectCommand} → bus → here.
   */
  private dispatchViaBus<T>(
    commandId: string,
    action: string,
    payload: unknown,
    targetTabId: string | undefined,
    senderUserId: string | undefined,
    resolve: (value: T) => void,
    reject: (error: Error) => void
  ): void {
    const bus = this.bus!;
    const timeoutMs = this.sseTimeoutMs;

    const timeout = setTimeout(() => {
      const pending = this.pendingCommands.get(commandId);
      if (pending?.busUnsub) pending.busUnsub();
      this.pendingCommands.delete(commandId);
      reject(
        new Error(
          `Command ${action} timed out after ${timeoutMs}ms (bus). ` +
            'No instance reported a response — the target tab may be disconnected.'
        )
      );
    }, timeoutMs);

    const busUnsub = bus.subscribeResponse(commandId, (env) => {
      const pending = this.pendingCommands.get(commandId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
      if (pending.busUnsub) pending.busUnsub();
      this.pendingCommands.delete(commandId);
      if (env.ok) {
        pending.resolve(env.result);
      } else {
        pending.reject(new Error(env.error || `Command ${action} failed`));
      }
    });

    this.pendingCommands.set(commandId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
      tabsNotified: 1,
      errorResponseCount: 0,
      busUnsub,
    });

    bus.publishCommand({
      commandId,
      action,
      payload,
      timestamp: Date.now(),
      targetTabId,
      senderUserId,
    });
  }

  /**
   * TTL (seconds) for shared tab-presence registry entries. Comfortably longer
   * than the sweep cadence (which refreshes it) so a live tab never expires
   * between refreshes.
   */
  private busTabTtlSeconds(): number {
    return Math.ceil(
      Math.max(this.staleHeartbeatMs * 2, this.staleHeartbeatSweepMs * 3) / 1000
    );
  }

  /**
   * Re-announce every tab connected to THIS instance in the shared presence
   * registry so its TTL doesn't lapse. Called from the periodic sweep.
   */
  private refreshBusTabPresence(): void {
    if (!this.bus) return;
    const ttl = this.busTabTtlSeconds();
    const ids = new Set<string>([...this.tabListeners.keys(), ...this.wsClients.keys()]);
    for (const id of ids) {
      this.bus.registerTab(id, ttl);
    }
  }

  private broadcastToListeners(command: QueuedCommand, targetTabId?: string): number {
    if (targetTabId) {
      const listener = this.tabListeners.get(targetTabId);
      if (listener) {
        try {
          listener.callback(command);
          return 1;
        } catch {
          /* self-cleaning */
        }
      }
      return 0;
    }
    let notified = 0;
    for (const listener of this.tabListeners.values()) {
      try {
        listener.callback(command);
        notified++;
      } catch {
        /* self-cleaning */
      }
    }
    return notified;
  }

  // --------------------------------------------------------------------------
  // WebSocket Client Registry
  // --------------------------------------------------------------------------

  private sendCommandViaWebSocket(
    commandId: string,
    action: string,
    payload: unknown,
    targetTabId?: string
  ): boolean {
    const clientEntry = this.getConnectedClient(targetTabId);
    if (!clientEntry) return false;

    try {
      clientEntry.client.send(
        JSON.stringify({
          type: 'command',
          commandId,
          action,
          payload,
          timestamp: Date.now(),
        })
      );
      clientEntry.lastActivity = Date.now();
      return true;
    } catch (e) {
      console.error('[UIBridge] Failed to send WebSocket command:', e);
      return false;
    }
  }

  private getConnectedClient(targetTabId?: string): WebSocketClientEntry | null {
    if (targetTabId) {
      const entry = this.wsClients.get(targetTabId);
      if (entry) {
        if (entry.client.isConnected()) return entry;
        this.wsClients.delete(targetTabId);
      }
      return null;
    }
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected()) return entry;
      this.wsClients.delete(clientId);
    }
    return null;
  }

  /**
   * Register a WebSocket client for command delivery.
   */
  registerWebSocketClient(client: WebSocketClient): void {
    const now = Date.now();
    this.wsClients.set(client.clientId, { client, connectedAt: now, lastActivity: now });

    // Signal that a transport is ready
    if (this.connectionReadyResolve) {
      this.connectionReadyResolve();
      this.connectionReadyResolve = null;
    }

    console.log(`[UIBridge] WebSocket client registered: ${client.clientId}`);

    // Proactive snapshot capture
    setTimeout(async () => {
      if (!this.wsClients.has(client.clientId)) return;
      try {
        const result = await this.queueCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          { targetTabId: client.clientId }
        );
        if (result.elements && result.elements.length > 0) {
          console.log(
            `[ui-bridge] Proactive WS snapshot captured: ${result.elements.length} elements`
          );
        }
      } catch {
        /* Client may have disconnected */
      }
    }, 500);
  }

  /**
   * Unregister a WebSocket client.
   */
  unregisterWebSocketClient(clientId: string): void {
    this.wsClients.delete(clientId);
    // Same rationale as the SSE unsubscribe path: ownership rides on the
    // transport, so a closed transport invalidates the owner record.
    this.tabOwnership.delete(clientId);
    console.log(`[UIBridge] WebSocket client unregistered: ${clientId}`);
    this.resetConnectionGateIfEmpty();
  }

  /**
   * Update WebSocket client activity timestamp.
   */
  updateClientActivity(clientId: string): void {
    const entry = this.wsClients.get(clientId);
    if (entry) entry.lastActivity = Date.now();
  }

  /**
   * Get connected WebSocket client count.
   */
  getWebSocketClientCount(): number {
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (!entry.client.isConnected()) this.wsClients.delete(clientId);
    }
    return this.wsClients.size;
  }

  /**
   * Broadcast an event to all connected WebSocket clients.
   */
  broadcastEvent(eventType: string, data: unknown): void {
    const message = JSON.stringify({ type: eventType, data, timestamp: Date.now() });
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected()) {
        try {
          entry.client.send(message);
          entry.lastActivity = Date.now();
        } catch {
          this.wsClients.delete(clientId);
        }
      } else {
        this.wsClients.delete(clientId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Command Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a pending command with a response from the browser.
   */
  resolveCommand(commandId: string, result: unknown, tabId?: string): boolean {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) {
      // Cross-instance (P0a): the browser's response landed on an instance that
      // did NOT originate the command. Forward it over the bus to the instance
      // holding the pending promise.
      if (this.bus) {
        this.bus.publishResponse({ commandId, ok: true, result, tabId });
        return true;
      }
      return false;
    }

    clearTimeout(pending.timeout);
    if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
    if (pending.busUnsub) pending.busUnsub();
    this.pendingCommands.delete(commandId);
    pending.resolve(result);

    // Track per-tab command success and remove from demoted set
    if (tabId) {
      this.tabLastSuccess.set(tabId, Date.now());
      this.demotedTabs.delete(tabId);
    }

    return true;
  }

  /**
   * Reject a pending command with an error from the browser.
   */
  rejectCommand(commandId: string, errorMessage: string): boolean {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) {
      // Cross-instance (P0a): forward the error to the originating instance.
      if (this.bus) {
        this.bus.publishResponse({ commandId, ok: false, error: errorMessage });
        return true;
      }
      return false;
    }

    pending.errorResponseCount++;
    if (!pending.firstError) {
      pending.firstError = new Error(errorMessage);
    }

    // All notified tabs responded with errors — reject immediately
    if (pending.errorResponseCount >= pending.tabsNotified) {
      clearTimeout(pending.timeout);
      if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
      this.pendingCommands.delete(commandId);
      pending.reject(pending.firstError!);
      return true;
    }

    // Start grace timer for tabs that may go silent
    if (!pending.graceTimeout) {
      pending.graceTimeout = setTimeout(() => {
        const stillPending = this.pendingCommands.get(commandId);
        if (stillPending) {
          clearTimeout(stillPending.timeout);
          this.pendingCommands.delete(commandId);
          stillPending.reject(stillPending.firstError || new Error(errorMessage));
        }
      }, this.multiTabGraceMs);
    }

    return true;
  }

  // --------------------------------------------------------------------------
  // Tab / Client Management
  // --------------------------------------------------------------------------

  /**
   * Subscribe to commands via SSE. Returns an unsubscribe function.
   */
  subscribeToCommands(listener: CommandListener, tabId?: string): () => void {
    const id = tabId || `anon_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.tabListeners.set(id, { tabId: id, callback: listener });

    // New tab becomes primary
    this.demotedTabs.delete(id);
    this.setPrimaryTab(id);

    // Signal that a transport is ready
    if (this.connectionReadyResolve) {
      this.connectionReadyResolve();
      this.connectionReadyResolve = null;
    }

    console.log(`[ui-bridge] SSE listener connected: ${id} (total: ${this.tabListeners.size})`);

    // Cross-instance (P0a): this instance now holds the SSE stream for `id`.
    // Subscribe to the bus so commands dispatched from OTHER instances (which
    // have no local listener for this tab) are delivered down this stream.
    let busUnsubCmd: (() => void) | null = null;
    if (this.bus) {
      // Announce this tab in the shared presence registry so OTHER instances'
      // routing guard knows it exists here. TTL > sweep interval; refreshed by
      // the periodic cleanup sweep. Removed on unsubscribe.
      this.bus.registerTab(id, this.busTabTtlSeconds());
      busUnsubCmd = this.bus.subscribeCommands(id, (env) => {
        // Deliver only if this tab's listener is still registered here.
        const current = this.tabListeners.get(id);
        if (!current) return;
        // Per-user tab scoping (§4.2): the sending instance MAY hold stale
        // ownership metadata, so we don't trust its assertion alone. Re-
        // verify against the LOCAL ownership registry before forwarding.
        // Mismatch → reject the command back over the bus with the same
        // generic prose `OwnerMismatchError` uses; do NOT deliver. When
        // the envelope carries no `senderUserId` (e.g. admin dispatch,
        // legacy path, fire-and-forget broadcast), the check is skipped.
        if (env.senderUserId !== undefined) {
          const owner = this.tabOwnership.get(id);
          if (!owner || owner.userId !== env.senderUserId) {
            if (this.bus) {
              this.bus.publishResponse({
                commandId: env.commandId,
                ok: false,
                error: `tabId "${id}" is not addressable by the authenticated caller`,
              });
            }
            return;
          }
        }
        try {
          current.callback({
            commandId: env.commandId,
            action: env.action,
            payload: env.payload,
            timestamp: env.timestamp,
          });
        } catch {
          /* self-cleaning */
        }
      });
    }

    // Proactive snapshot capture
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const captureSnapshot = async (): Promise<boolean> => {
      if (!this.tabListeners.has(id)) return false;
      try {
        const result = await this.queueCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          { targetTabId: id }
        );
        if (result.elements && result.elements.length > 0) {
          console.log(
            `[ui-bridge] Proactive snapshot captured: ${result.elements.length} elements`
          );
          return true;
        }
      } catch {
        /* Tab may have disconnected */
      }
      return false;
    };

    const proactiveTimer = setTimeout(async () => {
      const captured = await captureSnapshot();
      if (!captured && this.tabListeners.has(id)) {
        retryTimer = setTimeout(() => captureSnapshot(), 1500);
      }
    }, 500);

    return () => {
      clearTimeout(proactiveTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (busUnsubCmd) busUnsubCmd();
      if (this.bus) this.bus.unregisterTab(id);
      this.tabListeners.delete(id);
      this.demotedTabs.delete(id);
      this.tabMetadata.delete(id);
      // Drop ownership when the transport closes. A future tab with the
      // SAME id must re-register before authenticated dispatch sees it.
      this.tabOwnership.delete(id);
      console.log(
        `[ui-bridge] SSE listener disconnected: ${id} (total: ${this.tabListeners.size})`
      );
      this.resetConnectionGateIfEmpty();
    };
  }

  /**
   * Check if any SSE listeners are connected.
   */
  hasCommandListeners(): boolean {
    return this.tabListeners.size > 0;
  }

  /**
   * Get list of connected tab IDs.
   */
  getConnectedTabs(): string[] {
    return Array.from(this.tabListeners.keys());
  }

  /**
   * Get connected tabs with page info by querying each tab.
   */
  async getTabsWithInfo(): Promise<TabInfo[]> {
    const tabIds = this.getConnectedTabs();
    return Promise.all(
      tabIds.map(async (tabId): Promise<TabInfo> => {
        try {
          const info = await Promise.race([
            this.queueCommand<{ url?: string; pathname?: string; title?: string }>(
              'getTabInfo',
              {},
              { targetTabId: tabId }
            ),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          return { tabId, url: info?.url, pathname: info?.pathname, title: info?.title };
        } catch {
          return { tabId };
        }
      })
    );
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  /**
   * Record a heartbeat from the browser, optionally per-tab.
   */
  receiveHeartbeat(
    tabId?: string,
    metadata?: { url?: string; title?: string; visibility?: string }
  ): void {
    const now = Date.now();
    if (tabId) {
      this.tabHeartbeats.set(tabId, now);
      if (metadata) {
        this.tabMetadata.set(tabId, {
          url: metadata.url ?? '',
          title: metadata.title ?? '',
          visibility: metadata.visibility ?? 'unknown',
          lastSeen: now,
        });
      }
    } else {
      // Anonymous heartbeat — store under a synthetic key
      this.tabHeartbeats.set('__anonymous__', now);
    }
  }

  /**
   * Check if the browser app is responsive based on heartbeat freshness.
   * Returns true if ANY tab has a heartbeat within the stale threshold.
   *
   * Per-user tab scoping (§4.2): with `options.ownerCheck = {userId}`,
   * only the caller's OWN tabs are considered — otherwise a user with no
   * live tab would read `responsive: true` off a stranger's heartbeat.
   */
  isAppResponsive(options?: { ownerCheck?: { userId: string } }): boolean {
    const userId = options?.ownerCheck?.userId;
    const now = Date.now();
    for (const [tabId, lastBeat] of this.tabHeartbeats.entries()) {
      if (userId && !this.isOwnedBy(tabId, userId)) continue;
      if (now - lastBeat < this.heartbeatStaleMs) return true;
    }
    return false;
  }

  /**
   * Get the last heartbeat timestamp (max across all tabs).
   *
   * Per-user tab scoping (§4.2): with `options.ownerCheck = {userId}`,
   * the max is taken over the caller's OWN tabs only — a stranger's
   * heartbeat timestamp is a (weak) activity signal and must not bleed
   * into another user's `/health`.
   */
  getLastHeartbeat(options?: { ownerCheck?: { userId: string } }): number {
    const userId = options?.ownerCheck?.userId;
    let max = 0;
    for (const [tabId, lastBeat] of this.tabHeartbeats.entries()) {
      if (userId && !this.isOwnedBy(tabId, userId)) continue;
      if (lastBeat > max) max = lastBeat;
    }
    return max;
  }

  // --------------------------------------------------------------------------
  // Per-User Tab Scoping (§4.2)
  // --------------------------------------------------------------------------

  /**
   * Record the authenticated ownership of `tabId`. Called from the HTTP
   * heartbeat handler after extracting `registrationMetadata` from the
   * body. Updates an existing entry's `lastSeen` rather than rewriting
   * `firstSeen`.
   *
   * Strict-mode invariant: a tab is "registered" only after this method
   * has been called for it. `listOwnedTabs`, `assertOwnership`, and the
   * bus-envelope receiver check all key off this map.
   *
   * Re-registration under a DIFFERENT `userId` is permitted (e.g. a tab
   * survives a re-login) — the entry is overwritten in place. This is
   * the safe path: the alternative (reject + force a reconnect) would
   * leave the tab unaddressable until the SSE stream re-establishes,
   * which is strictly worse for the operator UX. The new ownership
   * takes effect on the next dispatch.
   */
  recordRegistration(tabId: string, metadata: { userId: string; sessionId: string }): void {
    const now = Date.now();
    const existing = this.tabOwnership.get(tabId);
    if (existing && existing.userId === metadata.userId) {
      existing.sessionId = metadata.sessionId;
      existing.lastSeen = now;
      return;
    }
    this.tabOwnership.set(tabId, {
      userId: metadata.userId,
      sessionId: metadata.sessionId,
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
    });
  }

  /**
   * Return the stored ownership record for a tab, or `null` if the tab
   * has not registered yet. The full record (including timestamps) is
   * exposed for observability tooling; the wire layer should never
   * forward `sessionId` to other users.
   */
  getOwnership(tabId: string): TabOwnership | null {
    return this.tabOwnership.get(tabId) ?? null;
  }

  /**
   * THE per-user scoping predicate (§4.2). A tab is visible to `userId`
   * only when the ownership registry holds an entry for it AND that
   * entry's `userId` matches. Strict mode: a tab with no ownership entry
   * is "not yours" for every caller.
   *
   * Every scoping path in the relay — `listOwnedTabs` (live transports),
   * `getTransportDiagnostics({ownerCheck})` (the `/health` view), and
   * `assertOwnership` (dispatch) — funnels through this one predicate so
   * there is exactly one definition of "owned".
   */
  private isOwnedBy(tabId: string, userId: string): boolean {
    const owner = this.tabOwnership.get(tabId);
    return !!owner && owner.userId === userId;
  }

  /**
   * Return connected tab ids whose stored ownership matches `userId`.
   * Tabs without an ownership entry are NOT included — strict mode
   * makes "unregistered" the same as "not yours". Used by `/tabs` and
   * `/tabs/wait` to scope the response to the authenticated caller.
   *
   * Includes both SSE and WebSocket transports. Result order tracks
   * `getConnectedTabs` (insertion order) for stability.
   */
  listOwnedTabs(userId: string): string[] {
    const owned: string[] = [];
    const seen = new Set<string>();
    const consider = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      if (this.isOwnedBy(id, userId)) owned.push(id);
    };
    for (const id of this.tabListeners.keys()) consider(id);
    for (const [id, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected()) consider(id);
    }
    return owned;
  }

  /**
   * Admin / trusted-caller bypass: return ALL connected tab ids
   * regardless of ownership. Intended for server-side callers that
   * don't know a userId (internal admin tooling, runner introspection).
   * Equivalent to `getConnectedTabs()` plus any WebSocket-only tabs.
   *
   * Distinct from `listOwnedTabs(userId)` deliberately so the call site
   * names the bypass — there is no `listOwnedTabs(null)` overload. Mis-
   * using a null userId would silently widen scope across every consumer.
   */
  adminListAllTabs(): string[] {
    const all: string[] = [];
    const seen = new Set<string>();
    for (const id of this.tabListeners.keys()) {
      if (!seen.has(id)) {
        seen.add(id);
        all.push(id);
      }
    }
    for (const [id, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected() && !seen.has(id)) {
        seen.add(id);
        all.push(id);
      }
    }
    return all;
  }

  /**
   * Throw {@link OwnerMismatchError} when `tabId` exists in the
   * ownership registry but its stored `userId` does not equal
   * `callerUserId`. Returns silently when:
   *
   *   - the tab has no ownership record yet (strict-mode dispatch
   *     against an unregistered tab is rejected one layer up via
   *     `TabRoutingError` / `TAB_NOT_FOUND` — this method is only
   *     reached after the per-tab routing guard succeeds, and a
   *     transport-only tab with no metadata should not be reachable
   *     here, but defending in depth is cheap);
   *   - the stored owner matches the caller.
   */
  assertOwnership(tabId: string, callerUserId: string): void {
    const stored = this.tabOwnership.get(tabId);
    if (!stored) return;
    if (stored.userId !== callerUserId) {
      throw new OwnerMismatchError(tabId, callerUserId, stored.userId);
    }
  }

  // --------------------------------------------------------------------------
  // Diagnostics
  // --------------------------------------------------------------------------

  /**
   * Get internal transport state for debugging.
   *
   * Per-user tab scoping (§4.2): pass `options.ownerCheck = {userId}` to
   * get the per-user view — every tab-identifying field is filtered
   * through {@link isOwnedBy}, the same predicate `/tabs` uses via
   * `listOwnedTabs`. This is what `GET /health` (and `/status`) MUST use
   * whenever the request carries an `X-Caller-User-Id`: without it the
   * endpoint hands every authenticated caller the FULL registry —
   * other users' tab ids, their urls/titles (`tabMetadata`), their
   * `{userId, sessionId}` (`tabOwnership`), and their in-flight
   * `pendingCommandIds` (a response-injection vector, since `POST
   * /commands` settles a command by id).
   *
   * Without `ownerCheck` the unfiltered admin/trusted-server view is
   * returned, exactly as `/tabs` behaves with no `X-Caller-User-Id`
   * header. Callers that legitimately need the global view (the stale-tab
   * sweep, the heartbeat handler's `tabRegistered` echo, `/tabs`' own
   * pre-filter base list) keep calling it with no argument.
   */
  getTransportDiagnostics(options?: { ownerCheck?: { userId: string } }): TransportDiagnostics {
    const full: TransportDiagnostics = {
      pendingCommandCount: this.pendingCommands.size,
      pendingCommandIds: Array.from(this.pendingCommands.keys()),
      commandListenerCount: this.tabListeners.size,
      connectedTabs: Array.from(this.tabListeners.keys()),
      activeTabs: this.getActiveTabs(),
      primaryTabId: this.getPrimaryTabId(),
      demotedTabs: Array.from(this.demotedTabs),
      buildId: this.buildId,
      wsClientCount: this.wsClients.size,
      wsClientIds: Array.from(this.wsClients.keys()),
      commandQueueLength: this.commandQueue.length,
      tabHeartbeats: Object.fromEntries(this.tabHeartbeats),
      tabMetadata: Object.fromEntries(this.tabMetadata),
      tabOwnership: Object.fromEntries(this.tabOwnership),
      staleHeartbeatMs: this.staleHeartbeatMs,
    };

    const userId = options?.ownerCheck?.userId;
    if (!userId) return full;

    const owns = (tabId: string): boolean => this.isOwnedBy(tabId, userId);
    const pickOwned = <V>(record: Record<string, V>): Record<string, V> =>
      Object.fromEntries(Object.entries(record).filter(([tabId]) => owns(tabId)));

    const connectedTabs = full.connectedTabs.filter(owns);
    const wsClientIds = full.wsClientIds.filter(owns);

    return {
      // Aggregates that name no tab and no user. A bare count of the
      // relay's in-flight work leaks nothing identifying, and ops
      // dashboards read it — keep it global.
      pendingCommandCount: full.pendingCommandCount,
      commandQueueLength: full.commandQueueLength,
      buildId: full.buildId,
      staleHeartbeatMs: full.staleHeartbeatMs,

      // Command ids are NOT attributable to a tab/owner, so they cannot be
      // filtered — and handing them to a foreign caller lets them settle
      // someone else's command via `POST /commands`. Withheld entirely
      // from the per-user view.
      pendingCommandIds: [],

      // Per-user view: tab-identifying fields, filtered through isOwnedBy.
      connectedTabs,
      activeTabs: full.activeTabs.filter(owns),
      demotedTabs: full.demotedTabs.filter(owns),
      wsClientIds,
      commandListenerCount: connectedTabs.length,
      wsClientCount: wsClientIds.length,
      primaryTabId:
        full.primaryTabId && owns(full.primaryTabId) ? full.primaryTabId : null,
      tabHeartbeats: pickOwned(full.tabHeartbeats),
      tabMetadata: pickOwned(full.tabMetadata),
      tabOwnership: pickOwned(full.tabOwnership),
    };
  }

  /**
   * Get pending commands for legacy HTTP polling fallback.
   */
  getPendingCommands(): QueuedCommand[] {
    return this.commandQueue.splice(0, this.commandQueue.length);
  }

  // --------------------------------------------------------------------------
  // Push-Based Change Events
  // --------------------------------------------------------------------------

  private changeEventBuffer: DOMChangeEvent[] = [];
  private changeEventSubscribers = new Set<(event: DOMChangeEvent) => void>();
  private readonly maxChangeEvents = 5000;

  /**
   * Push a change event from a browser tab into the relay's ring buffer
   * and notify all subscribers.
   */
  pushChangeEvent(event: DOMChangeEvent): void {
    this.changeEventBuffer.push(event);
    if (this.changeEventBuffer.length > this.maxChangeEvents) {
      this.changeEventBuffer.splice(0, this.changeEventBuffer.length - this.maxChangeEvents);
    }
    for (const sub of this.changeEventSubscribers) {
      try {
        sub(event);
      } catch {
        /* subscriber errors are non-fatal */
      }
    }
  }

  /**
   * Subscribe to push-based change events. Returns an unsubscribe function.
   */
  subscribeChanges(callback: (event: DOMChangeEvent) => void): () => void {
    this.changeEventSubscribers.add(callback);
    return () => {
      this.changeEventSubscribers.delete(callback);
    };
  }

  /**
   * Get buffered change events since a timestamp.
   */
  getChangeEventsSince(since: number, limit = 100): DOMChangeEvent[] {
    return this.changeEventBuffer.filter((e) => e.timestamp > since).slice(-limit);
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.tabHeartbeats.clear();
    this.tabMetadata.clear();
    this.tabLastSuccess.clear();
    this.tabOwnership.clear();
    this.demotedTabs.clear();
    this.tabListeners.clear();
    this.commandQueue.length = 0;
    this.changeEventBuffer.length = 0;
    this.changeEventSubscribers.clear();
  }
}
