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
import type { RelayBus, RelayCommandEnvelope, RelayResponseEnvelope } from './relay-bus';
import {
  compareByLiveness,
  heartbeatAgeMs,
  keepsPrimary,
  takeFreshnessSnapshot,
  type FreshnessSnapshot,
} from './tab-liveness';
import {
  LEASE_RETURN_GRACE_MS,
  streamLeaseTimings,
  type StreamEndReason,
  type StreamLeaseTimings,
} from './stream-lease';
import {
  DeadSlot,
  isOpenListener,
  notDeliveredMessage,
  type CommandStreamHandle,
  type CommandStreamOptions,
  type ListenerState,
  type ParkedCommand,
} from './stream-slot';
import { NoLiveAnswer, TabReportedFailure, noResultArrivedMessage } from './live-answer';
import {
  commandRegistryTtlSeconds,
  registryWrite,
  someInstanceAwaits,
  type CommandResultOutcome,
} from './command-registry';

// ============================================================================
// Types
// ============================================================================

export interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp: number;
  /**
   * Set on a redelivery (D3): the id of the command this one re-sends down the
   * tab's replacement stream. The client runs one dedupe key once, and the key
   * of a redelivery is this id.
   */
  redeliveryOf?: string;
}

/**
 * Receives a command for a tab. Returning `false` says the command could not
 * be written; any other return counts as delivered.
 */
export type CommandListener = (command: QueuedCommand) => boolean | void;

/** The `caps` entry a client declares when it runs one dedupe key once (`relay/command-dedupe.ts`). */
const DEDUPE_CAPABILITY = 'dedupe';

export interface TabListener {
  tabId: string;
  callback: CommandListener;
  /**
   * Fresh per subscription. A command delivered on this stream is answered
   * only by a response that presents this id, or one from the tab's verified
   * owner (see `resolveCommand`).
   */
  streamId?: string;
  /** The verified identity that opened this stream, when one was present. */
  userId?: string;
  /**
   * When this stream registered. Bounds the warm-up of a tab that has never
   * sent this instance a heartbeat (`isTabLive` in tab-liveness.ts).
   */
  openedAt: number;
  /**
   * Set when a cross-instance bus is configured: drops this stream's bus
   * command subscription and removes its tab from the shared presence
   * registry. Idempotent. Run by `destroy()`, which forgets the listener
   * without going through its unsubscribe, and with `keepPresence` by a newer
   * stream for the same tab that replaces this one: the presence is the
   * newer stream's from then on, but this stream's subscription would
   * deliver every bus command a second time.
   */
  releaseBus?: (options?: { keepPresence?: boolean }) => void;
  /** Ends the stream from the relay's side; called when a newer stream for the tab replaces it. */
  close?: () => void;
  /** The page instance that opened the stream (the client's `cid`), when it named one. */
  clientInstanceId?: string;
  /** The capabilities the stream's client declared (`caps`); empty for a legacy client. */
  caps: readonly string[];
  /**
   * `dead` once the relay heard the stream end (stream-slot.ts): no connected
   * transport to any reader, but dispatch still finds it and parks on it.
   */
  state: ListenerState;
  /** While `dead`: the commands held for the tab's next stream, and the expiry. */
  deadSlot?: DeadSlot;
  /**
   * When the stream was sent its `rotate` frame (stream-lease.ts), if it was.
   * A rotated stream delivers a bus command only when no other instance holds
   * the tab, and the tab's next stream closes it whatever page that stream
   * names (`addCommandListener`).
   */
  rotatedAt?: number;
}

/**
 * What the relay remembers of a tab's last SSE listener once it is gone: when,
 * and the page instance that held it, so a stream that reopens soon after
 * returns the tab (`addCommandListener`).
 */
interface ListenerTombstone {
  removedAt: number;
  clientInstanceId?: string;
  /** The stream that held the tab, so commands bound to it can be redelivered (D3). */
  streamId?: string;
  /**
   * Set when the server closed the stream at its lease (`lease`,
   * `rotate_unanswered`): the tab keeps its tombstone, standing and owner for
   * `graceMs` (`leaseReturnGraceMs`), awaiting its return, and `expiry` ends
   * the wait (`endLeaseReturn`).
   */
  leaseReturn?: {
    reason: StreamEndReason;
    graceMs: number;
    expiry: ReturnType<typeof setTimeout>;
  };
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
  /** The tab the command was dispatched to, when it was dispatched to one. */
  targetTabId?: string;
  /** The SSE stream the command went down, when it went down one on this instance. */
  streamId?: string;
  /** The verified identity bound to that stream when the command was delivered. */
  streamUserId?: string;
  /** The caller the command was dispatched for (its `ownerCheck`), when scoped. */
  ownerUserId?: string;
  /**
   * What a redelivery re-sends (D3), set only on a command whose caller awaits
   * its result. A fire-and-forget recorder carries none and is never redelivered.
   */
  redeliverable?: { action: string; payload: unknown };
  /**
   * Set on a redelivery's entry: the id of the original command it re-sends.
   * The entry is bound to the replacement stream, and a result is taken from
   * that stream only (`responseRefusal`).
   */
  redeliveryOf?: string;
  /**
   * Every id that shares this command's promise and timeout: the original and
   * each alias a redelivery made. The first settle of any drops them all
   * (`dropPending`), so the caller settles once.
   */
  aliasGroup?: Set<string>;
}

/**
 * Who is answering a command: the stream id the responder presents, and the
 * verified identity of the responding request (`X-Caller-User-Id`).
 */
export interface CommandResponder {
  streamId?: string;
  callerUserId?: string | null;
}

/** Where this instance delivered a command that another instance dispatched. */
interface BusDelivery {
  targetTabId: string;
  streamId?: string;
  streamUserId?: string;
  expiresAt: number;
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
  /**
   * The 500 ms warm-up snapshot timer armed at registration, while it is
   * armed. Cleared by `unregisterWebSocketClient`, by a re-registration of
   * the same client id, and by `destroy()`.
   */
  snapshotTimer?: ReturnType<typeof setTimeout>;
  /**
   * Drops the client's bus command subscription (`subscribeWebSocketTab`),
   * while it holds one. Released with the entry (`dropWebSocketEntry`).
   */
  busUnsub?: () => void;
}

/** A caller waiting for a transport to connect, and the timer that gives up on it. */
interface ConnectionWaiter {
  timer: ReturnType<typeof setTimeout>;
  fail: (error: Error) => void;
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
  /**
   * Number of OPEN command transports — SSE command-stream listeners PLUS
   * connected WebSocket clients. This is the population the dispatch path
   * (`queueCommandInner`) draws from, so a non-zero value here means a
   * command can actually be handed to a browser; zero is exactly the
   * condition that yields `SDK_DISCONNECTED`.
   *
   * It previously counted SSE listeners only (`tabListeners.size`), so a
   * WebSocket-only install reported `commandListenerCount: 0` while its
   * command transport was working — the field did not observe the state its
   * name claims.
   *
   * Freshness is a SEPARATE question: a transport can be open while the
   * tab's heartbeat is stale (browsers throttle background timers to ~1/min,
   * so this is the normal state of any hidden tab). Read `activeTabs` for
   * the fresh-heartbeat subset; do not infer liveness from this count alone.
   */
  commandListenerCount: number;
  connectedTabs: string[];
  /** Item #15 — subset of `connectedTabs` whose heartbeat is fresh. */
  activeTabs: string[];
  /**
   * Tabs whose SSE listener is a dead slot (stream-slot.ts): the relay heard
   * the stream end, and holds the tab's commands for its next stream for
   * `reconnectGraceMs`. A parked tab is in neither `connectedTabs` nor
   * `activeTabs`, and `commandListenerCount` does not count it.
   */
  parkedTabs: string[];
  /**
   * The tab an unpinned command goes to first. Unscoped, the relay's primary
   * (`getPrimaryTabId`). Scoped (`ownerCheck`), `ownedPrimaryTabId`: the first
   * of the caller's own tabs that holds an open transport, under
   * `compareByLiveness` (tab-liveness.ts) as the owner-scoped dispatch arm
   * ranks them, or `null` when the caller has none. Never a parked tab.
   */
  primaryTabId: string | null;
  demotedTabs: string[];
  buildId: string;
  wsClientCount: number;
  wsClientIds: string[];
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
  /**
   * The active-tab freshness window in force, for ops visibility. A tab whose
   * heartbeat is older than this is absent from `activeTabs` — which does NOT
   * mean it is unreachable; see `commandListenerCount`.
   */
  tabActiveWindowMs: number;
  /**
   * Destructive-prune threshold currently in force. Disclosed alongside
   * `tabActiveWindowMs` so an operator reading `/health` can tell which of the
   * two governs a disconnect without reading the source.
   */
  zombieTransportMs: number;
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
  /** Time after which a demoted tab with no heartbeat is cleaned up (default: 60000) */
  tabDemotionTtlMs?: number;
  /**
   * How recently a tab must have sent a heartbeat to count as ACTIVE.
   *
   * This is the relay's one non-destructive freshness window. It answers
   * "did this tab beat recently?" and nothing else, for all five callers:
   * `getActiveTabs()`, `isTabActive()`, `isAppResponsive()` (the `/health`
   * `responsive` bit), the re-promotion of a demoted tab in
   * `getPrimaryTabId()`, and the liveness every selector ranks candidate tabs
   * by (`isTabLive` in tab-liveness.ts), which also bounds the warm-up of a
   * tab that never beat. Nothing is disconnected on the strength of it, and
   * no tab is refused: selection ranks a stale tab last, never out.
   *
   * Defaults to 30_000 ms (3 missed heartbeats at the SDK's 10s cadence —
   * see `HEARTBEAT_INTERVAL_MS` in `relay/relay-client.ts`). Override via
   * `UI_BRIDGE_TAB_ACTIVE_WINDOW_MS` when bootstrapping from a runtime with
   * no constructor option (e.g. `next dev`).
   *
   * Do not reach for this to decide whether a tab is REACHABLE. A hidden
   * tab's beat is throttled to ~1/min by the browser, so it sits outside
   * this window for most of every minute while its transport works fine —
   * which is why the destructive prune is gated on `zombieTransportMs`
   * instead, and why `commandListenerCount` counts transports rather than
   * fresh tabs. The two thresholds are deliberately independent.
   */
  tabActiveWindowMs?: number;
  /**
   * How long after a tab's last SSE listener was removed a new stream for the
   * same tab still RESUMES it rather than introducing a new tab. A resumed
   * stream keeps the tab's standing (it does not take the primary) and, when
   * its tab's warm-up was already answered, is sent no warm-up snapshot; a
   * stream that opens while the tab still holds one is a resume too. See
   * `addCommandListener`.
   *
   * Defaults to 5_000 ms. Override via `UI_BRIDGE_RECONNECT_GRACE_MS`, with
   * the precedence `tabActiveWindowMs` has.
   *
   * It is also how long a dead slot holds the tab's commands for its next
   * stream before it is removed and they are failed (stream-slot.ts).
   */
  reconnectGraceMs?: number;
  /**
   * When a stream whose client declared `rotate` is sent its `rotate` frame
   * (stream-lease.ts). Floored at 15 000 ms (`STREAM_LEASE_FLOOR_MS`), above
   * the 10 s a client's stream must live to count as healthy.
   * Defaults to `STREAM_LEASE_MS` (50 000); override via
   * `UI_BRIDGE_STREAM_LEASE_MS`, with the precedence `tabActiveWindowMs` has.
   */
  streamLeaseMs?: number;
  /**
   * When a stream whose client declared no `rotate` is closed, and its listener
   * removed. Floored as `streamLeaseMs`. Defaults to 270 000 (the platform's
   * 300 s function limit, less 30 s); override via
   * `UI_BRIDGE_LEGACY_STREAM_LEASE_MS`.
   */
  legacyStreamLeaseMs?: number;
  /**
   * How long a stream sent its `rotate` frame waits for the tab's next stream
   * before it closes as `rotate_unanswered`. Defaults to 10 000; override via
   * `UI_BRIDGE_ROTATE_GRACE_MS`.
   */
  rotateGraceMs?: number;
  /**
   * How long a tab whose stream the server closed at its lease (a legacy
   * close, or a rotate nobody answered) keeps its place for its return: its
   * tombstone, its standing and its owner. A stream that reopens within it
   * returns the tab rather than introducing it, and a command for the tab
   * meanwhile is refused at once as not delivered, never parked. Defaults to
   * `LEASE_RETURN_GRACE_MS` (15 000: the client's 10 s reconnect delay plus
   * 5 s); override via `UI_BRIDGE_LEASE_RETURN_GRACE_MS`.
   */
  leaseReturnGraceMs?: number;
  /**
   * Whether a newly connected tab is sent one `getControlSnapshot` of its own
   * shortly after it connects (default true). A stream that resumes a tab
   * (see `reconnectGraceMs`) whose warm-up was already answered is not. Tests
   * that count which tab each command reached turn it off, since that warm-up
   * command lands at a time no request chose.
   */
  proactiveSnapshot?: boolean;
  /**
   * Threshold after which a tab that still holds an OPEN command transport
   * (SSE listener or connected WebSocket) but has not sent a heartbeat is
   * treated as a genuine zombie and forcibly disconnected.
   *
   * This is deliberately far larger than `tabActiveWindowMs`, because the
   * client heartbeat is a `setInterval` timer and browsers throttle timers
   * in backgrounded tabs — Chrome's intensive throttling clamps them to
   * roughly ONE FIRING PER MINUTE. A hidden-but-perfectly-healthy tab
   * therefore beats every ~60s, so any destructive threshold at or below
   * that is guaranteed to tear down working transports. A stream's end is
   * the transport's to report: an abort, a consumer cancel and a failed
   * enqueue mark its listener dead at once, and the server-owned stream lease
   * (stream-lease.ts) ends a stream whose end nothing reported — on the
   * deployed platform, measured, nothing did. So the heartbeat is only needed
   * for a tab whose stream is open but whose page is frozen.
   *
   * Defaults to 300_000 ms (5 minutes) — unambiguously beyond any browser
   * throttling clamp. Override via `UI_BRIDGE_ZOMBIE_TRANSPORT_MS`.
   */
  zombieTransportMs?: number;
  /**
   * Interval between stale-tab sweep passes. Lower values prune zombie tabs
   * faster at the cost of more wake-ups. Defaults to 10_000 ms.
   */
  pruneSweepIntervalMs?: number;
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
 * Error a command, or a wait for a transport, settles with when its relay is
 * destroyed before it completes. Distinct from a timeout, so a caller can tell
 * "the relay went away" from "the page never answered".
 */
export class RelayDestroyedError extends Error {
  readonly code = 'RELAY_DESTROYED' as const;

  constructor(message = 'CommandRelay was destroyed before the command completed.') {
    super(message);
    this.name = 'RelayDestroyedError';
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
  private readonly tabDemotionTtlMs: number;
  private readonly tabActiveWindowMs: number;
  private readonly reconnectGraceMs: number;
  private readonly leaseReturnGraceMs: number;
  /** The command stream lease in force (stream-lease.ts), read for every stream the HTTP adapter opens. */
  readonly streamLeaseTimings: StreamLeaseTimings;
  private readonly zombieTransportMs: number;
  private readonly proactiveSnapshot: boolean;
  private readonly pruneSweepIntervalMs: number;

  // All state lives on globalThis for HMR survival
  private readonly pendingCommands: Map<string, PendingCommand>;
  private readonly tabListeners: Map<string, TabListener>;
  private readonly wsClients: Map<string, WebSocketClientEntry>;
  private readonly demotedTabs: Set<string>;
  private readonly tabHeartbeats: Map<string, number>;
  private readonly tabMetadata: Map<
    string,
    { url: string; title: string; visibility: string; lastSeen: number }
  >;
  private readonly tabLastSuccess: Map<string, number>;
  /**
   * When each tab's last SSE listener was removed (its stream ended, or the
   * zombie prune dropped it), and the page instance that held it, kept for
   * `reconnectGraceMs`, or `leaseReturnGraceMs` after a lease close, so a
   * stream that reopens within it returns the tab (`addCommandListener`).
   */
  private readonly listenerTombstones: Map<string, ListenerTombstone>;
  /**
   * Tabs whose SSE warm-up `getControlSnapshot` was answered with a snapshot.
   * Only a resume of one of these skips its own warm-up, so a stream that
   * ends or is replaced before its warm-up ran does not cost its tab the only
   * one it would get. A mark lasts while its tab holds a listener or a
   * tombstone (`cleanupStaleTabs`).
   */
  private readonly warmedUpTabs: Set<string>;
  /**
   * Each tab's generation: a fresh value from `tabGenerationSeq` on a FRESH
   * open of the tab id (one that resumes nothing), kept by a resume. A
   * warm-up marks its tab only if the tab is still in the generation the
   * warm-up was armed in, so a late reply to an earlier generation's warm-up
   * cannot mark a generation that never had one. Bounded like the marks
   * (`cleanupStaleTabs`, `destroy()`).
   */
  private readonly tabGenerations: Map<string, number>;
  /**
   * The one source of generation values, shared by every relay on the prefix
   * and never reset, not even by `destroy()`. Entries in `tabGenerations` are
   * dropped by the sweep and by `destroy()`; a per-tab counter would then
   * restart and hand a reopened tab a value an earlier generation's warm-up
   * still holds.
   */
  private readonly tabGenerationSeq: { n: number };
  /**
   * Per-user tab-scoping registry. Tracks which authenticated user a tab
   * was registered under via the strict heartbeat protocol. A tab is
   * "registered" — and therefore addressable by authenticated dispatch —
   * only when it has an entry here. Lives on `globalThis` alongside the
   * other relay state for Next.js HMR survival.
   */
  private readonly tabOwnership: Map<string, TabOwnership>;
  /** Commands this instance delivered for another instance, by command id. */
  private readonly busDeliveries: Map<string, BusDelivery>;
  /**
   * One-shot timers armed outside a pending command and a WebSocket entry
   * (the SSE warm-up snapshot and its retry, the tab-info probe bound), so
   * `destroy()` can clear them. Each removes itself when it fires.
   */
  private readonly relayTimers: Set<ReturnType<typeof setTimeout>>;
  /** Callers waiting for a transport to connect; `destroy()` fails them. */
  private readonly connectionWaiters: Set<ConnectionWaiter>;

  // Simple value state
  private primaryTabId: string | null;
  readonly buildId: string;

  /**
   * Optional cross-instance bus (P0a). `null` = single-process in-memory
   * (default, behavior unchanged). All bus call sites are guarded by `this.bus`.
   */
  private readonly bus: RelayBus | null;

  /**
   * Connection readiness gate. Both halves live on `globalThis` under the
   * prefix and are read there every time, never cached on the instance: a
   * sibling relay on the same prefix opens and resets the same gate, and a
   * cached copy would go stale the moment it did.
   */
  private get connectionReady(): Promise<void> {
    return this.prefixGlobal('ConnectionReady') as Promise<void>;
  }

  /** The resolver of an unopened gate; `null` once a transport opened it. */
  private get connectionReadyResolve(): (() => void) | null {
    return (this.prefixGlobal('ConnectionReadyResolve') as (() => void) | null) ?? null;
  }

  /**
   * How many times `destroy()` has run on this prefix. Captured before an
   * `await` in the dispatch path and compared after it, so a command whose
   * relay was destroyed while it was suspended settles with
   * {@link RelayDestroyedError} instead of dispatching on the torn-down relay.
   * Prefix-wide, because `destroy()` is.
   */
  private get destroyEpoch(): number {
    return (this.prefixGlobal('DestroyEpoch') as number | undefined) ?? 0;
  }

  /** The prefix-shared global `${prefix}${suffix}`. */
  private prefixGlobal(suffix: string): unknown {
    return (globalThis as Record<string, unknown>)[`${this.prefix}${suffix}`];
  }

  /** Open the connection gate, if it is not open already. */
  private openConnectionGate(): void {
    const resolve = this.connectionReadyResolve;
    if (!resolve) return;
    resolve();
    (globalThis as Record<string, unknown>)[`${this.prefix}ConnectionReadyResolve`] = null;
  }

  /** Throw {@link RelayDestroyedError} when `destroy()` ran since `epoch` was read. */
  private throwIfDestroyedSince(epoch: number): void {
    if (this.destroyEpoch !== epoch) throw new RelayDestroyedError();
  }

  /**
   * The command timeout a command can rely on whichever path delivers it: the
   * smaller of the WebSocket and SSE timeouts (a bus-routed command uses the
   * SSE one). A handler whose command waits in the page on its own bound (the
   * media override's decode wait) sizes that bound below this.
   */
  get commandBudgetMs(): number {
    return Math.min(this.wsTimeoutMs, this.sseTimeoutMs);
  }

  constructor(options?: CommandRelayOptions) {
    this.prefix = options?.globalPrefix ?? '__uiBridge';
    this.wsTimeoutMs = options?.wsTimeoutMs ?? 10_000;
    this.sseTimeoutMs = options?.sseTimeoutMs ?? 8_000;
    this.multiTabGraceMs = options?.multiTabGraceMs ?? 3_000;
    this.maxPendingCommands = options?.maxPendingCommands ?? 200;
    this.tabDemotionTtlMs = options?.tabDemotionTtlMs ?? 60_000;
    // Item #15 — non-destructive activity threshold. Precedence: explicit
    // option > UI_BRIDGE_TAB_ACTIVE_WINDOW_MS env > default 30s. Three missed
    // heartbeats at the SDK's 10s cadence.
    this.tabActiveWindowMs =
      options?.tabActiveWindowMs ?? envInt('UI_BRIDGE_TAB_ACTIVE_WINDOW_MS', 30_000);
    // How long a tab's ended stream can be resumed by its next one; same
    // precedence as the window above.
    this.reconnectGraceMs =
      options?.reconnectGraceMs ?? envInt('UI_BRIDGE_RECONNECT_GRACE_MS', 5_000);
    this.leaseReturnGraceMs =
      options?.leaseReturnGraceMs ??
      envInt('UI_BRIDGE_LEASE_RETURN_GRACE_MS', LEASE_RETURN_GRACE_MS);
    this.streamLeaseTimings = streamLeaseTimings(options ?? {}, envInt);
    this.proactiveSnapshot = options?.proactiveSnapshot ?? true;
    // Destructive prune threshold — must stay above the browser's background
    // timer clamp (~60s) or every hidden tab loses its working transport.
    this.zombieTransportMs =
      options?.zombieTransportMs ?? envInt('UI_BRIDGE_ZOMBIE_TRANSPORT_MS', 300_000);
    this.pruneSweepIntervalMs = options?.pruneSweepIntervalMs ?? 10_000;
    this.bus = options?.bus ?? null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const key = (suffix: string) => `${this.prefix}${suffix}`;

    if (!g[key('PendingCommands')]) g[key('PendingCommands')] = new Map();
    if (!g[key('TabListeners')]) g[key('TabListeners')] = new Map();
    if (!g[key('WsClients')]) g[key('WsClients')] = new Map();
    if (!g[key('DemotedTabs')]) g[key('DemotedTabs')] = new Set();
    if (!g[key('PrimaryTabId')]) g[key('PrimaryTabId')] = null;
    if (!g[key('TabHeartbeats')]) g[key('TabHeartbeats')] = new Map();
    if (!g[key('TabMetadata')]) g[key('TabMetadata')] = new Map();
    if (!g[key('TabLastSuccess')]) g[key('TabLastSuccess')] = new Map();
    if (!g[key('ListenerTombstones')]) g[key('ListenerTombstones')] = new Map();
    if (!g[key('WarmedUpTabs')]) g[key('WarmedUpTabs')] = new Set();
    if (!g[key('TabGenerations')]) g[key('TabGenerations')] = new Map();
    if (!g[key('TabGenerationSeq')]) g[key('TabGenerationSeq')] = { n: 0 };
    if (!g[key('TabOwnership')]) g[key('TabOwnership')] = new Map();
    if (!g[key('BusDeliveries')]) g[key('BusDeliveries')] = new Map();
    if (!g[key('RelayTimers')]) g[key('RelayTimers')] = new Set();
    if (!g[key('ConnectionWaiters')]) g[key('ConnectionWaiters')] = new Set();
    if (!g[key('BuildId')]) g[key('BuildId')] = Date.now().toString();

    if (!g[key('ConnectionReady')]) {
      let resolve: (() => void) | null = null;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      g[key('ConnectionReady')] = promise;
      g[key('ConnectionReadyResolve')] = resolve;
    }

    this.pendingCommands = g[key('PendingCommands')];
    this.tabListeners = g[key('TabListeners')];
    this.wsClients = g[key('WsClients')];
    this.demotedTabs = g[key('DemotedTabs')];
    this.primaryTabId = g[key('PrimaryTabId')];
    this.tabHeartbeats = g[key('TabHeartbeats')];
    this.tabMetadata = g[key('TabMetadata')];
    this.tabLastSuccess = g[key('TabLastSuccess')];
    this.listenerTombstones = g[key('ListenerTombstones')];
    this.warmedUpTabs = g[key('WarmedUpTabs')];
    this.tabGenerations = g[key('TabGenerations')];
    this.tabGenerationSeq = g[key('TabGenerationSeq')];
    this.tabOwnership = g[key('TabOwnership')];
    this.busDeliveries = g[key('BusDeliveries')];
    this.relayTimers = g[key('RelayTimers')];
    this.connectionWaiters = g[key('ConnectionWaiters')];
    this.buildId = g[key('BuildId')];

    this.ensureCleanupSweep();
  }

  /**
   * Arm the prefix's periodic cleanup sweep, unless one is armed already.
   * Runs at `pruneSweepIntervalMs` cadence and performs three passes: (a) the
   * legacy metadata GC for tabs that already lost their transport, (b) Item
   * #15 — active prune of zombie tabs whose heartbeat has gone stale despite
   * the transport still appearing connected, and (c) the bus presence
   * refresh. Bundled into one interval to avoid competing timers.
   *
   * Called at construction and whenever a transport registers: `destroy()`
   * clears the sweep, and a relay used again after it (or a sibling relay on
   * the prefix) must not run its transports with no prune and no presence
   * refresh until some other relay happens to be constructed.
   *
   * Limitation: the sweep is prefix-wide but runs as the relay that armed it.
   * Its cadence is that relay's `pruneSweepIntervalMs`, its prune thresholds
   * are that relay's, and the bus presence refresh goes to that relay's bus
   * only (none, when it has none). Sibling relays on one prefix are expected
   * to share their options and their bus; one that does not still has its
   * tabs pruned (the registries are prefix state) but its bus presence is
   * not refreshed. Under Next.js HMR, which re-builds the relay on every
   * reload without destroying the old one, the arming relay can be a
   * superseded one. A prefix-global set of live relays would lift the
   * sibling case but not that one: nothing removes a relay from the set short
   * of `destroy()`, so the set would grow by one relay per reload and the
   * sweep would call every superseded relay's bus.
   */
  private ensureCleanupSweep(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const intervalKey = `${this.prefix}CleanupInterval`;
    if (!g[intervalKey]) {
      g[intervalKey] = setInterval(() => {
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
      }, this.pruneSweepIntervalMs);
    }
  }

  // --------------------------------------------------------------------------
  // Item #15 — Stale-Tab Pruning
  // --------------------------------------------------------------------------

  /**
   * Forcibly disconnect tabs whose heartbeat has gone silent for longer
   * than `tabActiveWindowMs`. Removes their SSE listener entry, WebSocket
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
      // Destructive pruning is gated on `zombieTransportMs`, NOT on the
      // `tabActiveWindowMs` activity threshold.
      //
      // The client heartbeat is a `setInterval` timer, and browsers throttle
      // timers in backgrounded tabs — Chrome's intensive throttling clamps
      // them to ~1 firing per minute. Pruning at `tabActiveWindowMs` (30s)
      // therefore tore down the SSE command transport of every hidden tab on
      // a fixed cycle, even though that transport was open and working: the
      // relay would answer `SDK_DISCONNECTED` while bytes were still flowing
      // down the stream. `tabActiveWindowMs` still expresses staleness — but
      // non-destructively, via `getActiveTabs()` / `isTabActive()`.
      //
      // Transport liveness is the stream's to report (stream-lease.ts): an
      // abort, a consumer cancel or a failed enqueue marks the listener dead
      // at once, and the stream lease ends a stream whose end nothing
      // reported. The only case neither can see is a tab whose stream is open
      // and read but whose page is frozen — which is exactly what the much
      // larger `zombieTransportMs` window is for.
      if (ageMs <= this.zombieTransportMs) continue;

      // Drop the transport entries. Listeners that were registered via
      // `subscribeToCommands` had their unsubscribe stored in the SSE
      // stream closure; dropping the entry here means the callback is
      // never invoked again — the stream itself will tear down on the
      // next heartbeat-timeout from the client side, which is acceptable
      // since the tab is a genuine zombie at this point. Its hold on the bus
      // goes with it: its command subscription and this instance's presence.
      const zombie = this.tabListeners.get(tabId);
      if (zombie) this.releaseListenerBus(zombie, 'a pruned listener');
      this.dropTabListener(tabId);
      const wsEntry = this.wsClients.get(tabId);
      if (wsEntry) {
        try {
          wsEntry.client.close();
        } catch {
          /* connection may already be torn down */
        }
        this.dropWebSocketEntry(tabId);
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
          // The threshold that actually fired. `tabActiveWindowMs` is kept
          // alongside it so a log reader can see both without guessing which
          // one governed the decision.
          zombieTransportMs: this.zombieTransportMs,
          tabActiveWindowMs: this.tabActiveWindowMs,
        })}`
      );
    }

    // If we dropped the primary, recompute: the best remaining tab under
    // `compareByLiveness` (see `selectPrimarySuccessor`).
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
   * Pick a new primary: the best candidate under `compareByLiveness`
   * (tab-liveness.ts), so a live tab before a stale one. Returns `null` if no
   * candidate is connected.
   */
  private selectPrimarySuccessor(): string | null {
    const candidates = this.primaryCandidates();
    if (candidates.length === 0) return null;
    candidates.sort(compareByLiveness(this.freshness(candidates)));
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
      if (now - lastBeat <= this.tabActiveWindowMs) {
        active.push(id);
      }
    };
    for (const id of this.openListenerIds()) consider(id);
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
    const listener = this.tabListeners.get(tabId);
    const hasTransport =
      (listener !== undefined && isOpenListener(listener)) || this.wsClients.has(tabId);
    if (!hasTransport) return false;
    const lastBeat = this.tabHeartbeats.get(tabId);
    if (lastBeat === undefined) return true; // pre-heartbeat warmup
    return Date.now() - lastBeat <= this.tabActiveWindowMs;
  }

  /**
   * Remove entries from tabHeartbeats and demotedTabs for tabs no longer
   * connected (not those awaiting their return after a lease close), listener
   * tombstones too old to resume a tab (a lease close's ends on its own
   * timer), and the warm-up marks and generations of tabs left with neither a
   * listener nor a tombstone.
   */
  private cleanupStaleTabs(): void {
    const now = Date.now();
    for (const [tabId, tombstone] of this.listenerTombstones) {
      // A lease close's tombstone is ended by its own timer, which also
      // forgets the tab (`endLeaseReturn`); dropping it here first would
      // leave the tab's owner behind.
      if (tombstone.leaseReturn) continue;
      if (!this.recentTombstone(tabId, now)) this.listenerTombstones.delete(tabId);
    }
    for (const tabId of this.warmedUpTabs) {
      if (!this.tabListeners.has(tabId) && !this.listenerTombstones.has(tabId)) {
        this.warmedUpTabs.delete(tabId);
      }
    }
    for (const tabId of this.tabGenerations.keys()) {
      if (!this.tabListeners.has(tabId) && !this.listenerTombstones.has(tabId)) {
        this.tabGenerations.delete(tabId);
      }
    }
    for (const [tabId, lastBeat] of this.tabHeartbeats.entries()) {
      const hasListener = this.tabListeners.has(tabId);
      const hasWs = this.wsClients.has(tabId);
      // A tab awaiting its return after a lease close keeps its place
      // (`awaitReturn`); `endLeaseReturn` forgets it if it does not return.
      if (!hasListener && !hasWs && !this.leaseReturnOf(tabId)) {
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
      if (lastBeat && now - lastBeat < this.tabActiveWindowMs) {
        if (this.tabListeners.has(tabId) || this.wsClients.has(tabId)) {
          this.demotedTabs.delete(tabId);
          console.log(`[ui-bridge] Re-promoted tab with fresh heartbeat: ${tabId}`);
        }
      }
    }

    const candidates = this.primaryCandidates();
    const freshness = this.freshness(candidates);
    const current = this.primaryTabId;
    if (current && !this.demotedTabs.has(current)) {
      if (this.tabListeners.has(current) || this.wsClients.has(current)) {
        if (keepsPrimary(freshness, current, candidates)) return current;
        const age = heartbeatAgeMs(freshness, current);
        console.log(
          `[ui-bridge] Primary tab ${current} is not live ` +
            `(${age === undefined ? 'no heartbeat here' : `last heartbeat ${age}ms ago`}); re-selecting`
        );
      } else if (this.leaseReturnOf(current)) {
        // The primary's stream closed at its lease and has not reopened yet:
        // it keeps its standing for its return (`awaitReturn`). Meanwhile an
        // unpinned command goes to the best other tab, which is not made
        // primary for it.
        if (candidates.length === 0) return null;
        return candidates.sort(compareByLiveness(freshness))[0]!;
      } else {
        this.primaryTabId = null;
        this.persistPrimaryTab();
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort(compareByLiveness(freshness));
    this.setPrimaryTab(candidates[0]!);
    return this.primaryTabId;
  }

  /**
   * The tabs the primary is chosen from: each non-demoted tab holding an SSE
   * listener or a connected WebSocket client, once, in registration order.
   */
  private primaryCandidates(): string[] {
    const candidates: string[] = [];
    for (const id of this.tabListeners.keys()) {
      if (!this.demotedTabs.has(id)) candidates.push(id);
    }
    for (const [id, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected() && !this.demotedTabs.has(id) && !candidates.includes(id)) {
        candidates.push(id);
      }
    }
    return candidates;
  }

  /** The freshness of `tabIds`, read once for one selection (tab-liveness.ts). */
  private freshness(tabIds: Iterable<string>): FreshnessSnapshot {
    return takeFreshnessSnapshot(
      tabIds,
      {
        listeners: this.tabListeners,
        wsClients: this.wsClients,
        heartbeats: this.tabHeartbeats,
        lastSuccess: this.tabLastSuccess,
      },
      { now: Date.now(), activeWindowMs: this.tabActiveWindowMs }
    );
  }

  /**
   * `userId`'s own connected tabs, best first under `compareByLiveness`: the
   * order the owner-scoped dispatch arm tries them in, and so the tab a scoped
   * `getTransportDiagnostics` reports as `primaryTabId`.
   */
  private rankOwnedTabs(userId: string): string[] {
    const owned = this.listOwnedTabs(userId);
    return owned.sort(compareByLiveness(this.freshness(owned)));
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
    // Every `await` below is followed by a check against this: a `destroy()`
    // that lands while the command is suspended must not let it dispatch.
    const epoch = this.destroyEpoch;
    const ownedCount = hasOwnerCheck
      ? this.listOwnedTabs(ownerCheck!.userId).length
      : this.tabListeners.size + this.wsClients.size;

    // Wait for at least one transport if none available
    if (!options?.targetTabId && ownedCount === 0) {
      await this.waitForConnection(
        // Owner-scoped fallback: a same-user reconnect within ~3s is
        // plausible, but the cross-user "leak guard" cares about a
        // FAST `NO_BROWSER_CONNECTED` shape so the caller doesn't
        // infer "other users have tabs" from a 3s hang. Short-circuit
        // ownership-scoped misses immediately.
        hasOwnerCheck ? 0 : 3000,
        () =>
          new NoLiveAnswer(
            'SDK_DISCONNECTED: No browser connected — no WebSocket clients and no SSE listeners. ' +
              'Open the web app in a browser tab, or launch a headless one with ' +
              '`npx @qontinui/ui-bridge-headless --url <your-app-url>`. ' +
              'Use `GET /tabs/wait?timeoutMs=<ms>` to block until the tab registers.',
            'not_delivered'
          )
      );
      this.throwIfDestroyedSince(epoch);
    }

    // Attempt the command — if SDK_DISCONNECTED, wait for reconnection and retry once
    try {
      return await this.queueCommandInner<T>(action, payload, options, epoch);
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
          await this.waitForConnection(2000, () => new Error('Reconnection timeout'));
          this.throwIfDestroyedSince(epoch);
          console.log(`[ui-bridge] Reconnected, retrying ${action}`);
          return await this.queueCommandInner<T>(action, payload, options, epoch);
        } catch (retryErr) {
          // A relay destroyed mid-wait says so; any other retry failure
          // throws the original error.
          if (retryErr instanceof RelayDestroyedError) throw retryErr;
          throw err;
        }
      }
      throw err;
    }
  }

  /**
   * Wait until a transport is connected, or fail with `makeError()` after
   * `ms`. `destroy()` fails the wait with a {@link RelayDestroyedError} and
   * clears its timer. The timer is cleared however the wait ends, so a
   * connection that arrives in time leaves nothing armed.
   */
  private async waitForConnection(ms: number, makeError: () => Error): Promise<void> {
    let fail!: (error: Error) => void;
    const timedOut = new Promise<never>((_, reject) => {
      fail = reject;
    });
    const waiter: ConnectionWaiter = { fail, timer: setTimeout(() => fail(makeError()), ms) };
    this.connectionWaiters.add(waiter);
    try {
      await Promise.race([this.connectionReady, timedOut]);
    } finally {
      clearTimeout(waiter.timer);
      this.connectionWaiters.delete(waiter);
    }
  }

  /**
   * Arm a one-shot timer `destroy()` clears. It forgets itself when it fires.
   */
  private armTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const handle = setTimeout(() => {
      this.relayTimers.delete(handle);
      fn();
    }, ms);
    this.relayTimers.add(handle);
    return handle;
  }

  /** Clear a timer armed by {@link armTimer}. */
  private disarmTimer(handle: ReturnType<typeof setTimeout> | null | undefined): void {
    if (!handle) return;
    clearTimeout(handle);
    this.relayTimers.delete(handle);
  }

  /**
   * Settle a pending command with `error`: clear its timers, drop its bus
   * response subscription, reject it, and forget it.
   */
  private settlePending(id: string, error: Error): void {
    const pending = this.pendingCommands.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
    if (pending.busUnsub) pending.busUnsub();
    pending.reject(error);
    this.dropPending(id);
  }

  /**
   * Forget a settled command and every id that shares its promise (D3): a
   * redelivery's alias and the original are one command, so the first settle
   * of either leaves no entry for the other, whose late result then finds no
   * pending command.
   */
  private dropPending(id: string): void {
    const group = this.pendingCommands.get(id)?.aliasGroup;
    this.forgetPending(id);
    if (!group) return;
    for (const peer of group) this.forgetPending(peer);
  }

  /**
   * Delete one pending entry, drop its bus response subscription and withdraw
   * it from the bus's command registry.
   */
  private forgetPending(id: string): void {
    const pending = this.pendingCommands.get(id);
    if (pending?.busUnsub) {
      const unsub = pending.busUnsub;
      pending.busUnsub = undefined;
      unsub();
    }
    this.pendingCommands.delete(id);
    const bus = this.bus;
    if (bus) registryWrite('forgetting a command', () => bus.forgetCommand(id));
  }

  /**
   * Record in the bus's command registry that this instance awaits `id` for
   * `timeoutMs` plus `graceMs` (the multi-tab grace window by default), so a result landing on another
   * instance is forwarded here (D2 of plan
   * 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently).
   */
  private registerAwaited(id: string, timeoutMs: number, graceMs = this.multiTabGraceMs): void {
    const bus = this.bus;
    if (!bus) return;
    const ttl = commandRegistryTtlSeconds(timeoutMs, graceMs);
    registryWrite('registering a command', () => bus.registerCommand(id, ttl));
  }

  /**
   * A pending command's timer fired: forget it and reject it as timed out,
   * naming how many clients it reached and over which `transport`.
   */
  private timeOutPending(id: string, action: string, timeoutMs: number, transport: string): void {
    const pending = this.pendingCommands.get(id);
    if (!pending) return;
    if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
    this.dropPending(id);
    pending.reject(
      new NoLiveAnswer(
        noResultArrivedMessage(action, timeoutMs, transport, pending.tabsNotified),
        'unanswered'
      )
    );
  }

  /**
   * Inner command queue implementation (no retry logic). `epoch` is the
   * {@link destroyEpoch} the caller read before its first `await`; a dispatch
   * reached after a `destroy()` throws {@link RelayDestroyedError} instead.
   */
  private async queueCommandInner<T>(
    action: string,
    payload: unknown,
    options: { targetTabId?: string; ownerCheck?: { userId: string } } | undefined,
    epoch: number
  ): Promise<T> {
    this.throwIfDestroyedSince(epoch);
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
      const hasTransport = this.tabListeners.has(targetTabId) || this.wsClients.has(targetTabId);
      if (!hasTransport) {
        // Cross-instance (P0a): the tab may be connected to a DIFFERENT process
        // instance (Vercel serverless fan-out). Consult the shared presence
        // registry; if the tab is known elsewhere, dispatch via the bus (which
        // routes the command to the holding instance and the response back).
        if (this.bus) {
          const known = await this.bus.isTabKnown(targetTabId);
          this.throwIfDestroyedSince(epoch);
          if (known) return this.sendCommand<T>(action, payload, options);
        }
        // Its stream closed at its lease and has not reopened: the tab is
        // awaited, not gone, and nothing can carry the command until it
        // returns. Refused at once, never held: a legacy client waits 10 s
        // before it reopens (stream-slot.ts, `slotActionForEnd`).
        const awaited = this.leaseReturnOf(targetTabId);
        if (awaited) {
          throw new NoLiveAnswer(
            notDeliveredMessage(
              action,
              `Tab "${targetTabId}"'s command stream closed at its lease (${awaited.reason}) ` +
                'and has not reopened yet.'
            ),
            'not_delivered'
          );
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
      // Strict mode (§4.2): a scoped caller addresses only a tab registered to
      // it. A local tab with no ownership record yet (its stream is open, its
      // first heartbeat has not landed) is nobody's to a scoped caller, as bus
      // receivers already rule, so it is refused like another user's tab.
      if (ownerCheck && !this.isOwnedBy(targetTabId, ownerCheck.userId)) {
        throw new OwnerMismatchError(
          targetTabId,
          ownerCheck.userId,
          this.tabListeners.get(targetTabId)?.userId ?? ''
        );
      }
      // A dead slot holds the tab's commands for its next stream (D2): no
      // staleness verdict on it. `sendCommand` parks the command there.
      if (!this.deadSlotOf(targetTabId) && !this.isTabActive(targetTabId)) {
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
            `${ageMs}ms old (threshold ${this.tabActiveWindowMs}ms). ` +
            `Active tabs: [${active.join(', ')}]. ` +
            `The tab will be pruned on the next sweep — retry without pinning, or pick another tab.`
        );
      }
      return this.sendCommand<T>(action, payload, options);
    }

    // Owner-scoped unscoped fanout: the caller's own tabs, best first under
    // `compareByLiveness` (a live tab before a stale one, then the most
    // recently successful), with one failover to the best of the others at
    // retry time. Never touches another user's tabs. If the user has zero
    // tabs, surface SDK_DISCONNECTED — the no-leak fallback.
    if (ownerCheck) {
      const owned = this.rankOwnedTabs(ownerCheck.userId);
      if (owned.length === 0) {
        throw new NoLiveAnswer(
          `SDK_DISCONNECTED: No browser connected to receive ${action} command. ` +
            'No WebSocket clients and no SSE listeners registered. ' +
            'Open the web app in a browser tab, or launch a headless one with ' +
            '`npx @qontinui/ui-bridge-headless --url <your-app-url>`. ' +
            'Use `GET /tabs/wait?timeoutMs=<ms>` to block until the tab registers.',
          'not_delivered'
        );
      }
      const ownedPrimary = owned[0]!;
      return this.sendCommand<T>(action, payload, {
        targetTabId: ownedPrimary,
        ownerCheck,
      }).catch((firstError: Error) => {
        // A command settled by `destroy()` fails over to nothing.
        this.throwIfDestroyedSince(epoch);
        // One automatic failover across the user's other tabs, ranked again
        // now: the first attempt can have waited out its whole timeout, and a
        // tab the earlier ranking named may since have closed or gone stale.
        // Mirrors the global primary-tab failover, bounded to this user.
        const fallback = this.rankOwnedTabs(ownerCheck.userId).find((id) => id !== ownedPrimary);
        if (!fallback) throw firstError;
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
          // A command settled by `destroy()` fails over to nothing.
          this.throwIfDestroyedSince(epoch);
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
    options?: { targetTabId?: string; ownerCheck?: { userId: string }; busChecked?: boolean }
  ): Promise<T> {
    const targetTabId = options?.targetTabId;
    // D2: a tab whose stream died here may stream on another instance; ask
    // the bus before parking (`sendToDeadSlot`).
    if (targetTabId && this.bus && !options?.busChecked && this.deadSlotOf(targetTabId)) {
      return this.sendToDeadSlot<T>(action, payload, { ...options, targetTabId });
    }
    const senderUserId = options?.ownerCheck?.userId;
    const commandId = this.generateCommandId();
    const fireAndForget = DEFAULT_FIRE_AND_FORGET.has(action);
    console.log(
      `[ui-bridge] queueCommand: ${action} (ws=${this.wsClients.size}, sse=${this.tabListeners.size}${targetTabId ? `, target=${targetTabId}` : ''}${fireAndForget ? ', fire-and-forget' : ''})`
    );

    return new Promise((resolve, reject) => {
      // The registry write is ISSUED before any transport sends the command.
      // Only on the bus path does that order it against the send (the SET and
      // the PUBLISH share one connection); a WebSocket or SSE send is not
      // ordered against it. The write is fire-and-forget (a Redis SET not
      // awaited), so it is not confirmed to have landed when a fast tab's
      // result reaches another instance. A command that will go over the bus
      // is registered by the bus path itself, so a dispatch issues one SET.
      const registered = this.localDeliveryAvailable(targetTabId);
      if (registered) {
        this.registerBeforeSend(
          commandId,
          fireAndForget,
          Math.max(this.wsTimeoutMs, this.sseTimeoutMs)
        );
      }

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
        this.routeViaBus<T>(
          commandId,
          action,
          payload,
          targetTabId,
          senderUserId,
          resolve,
          reject,
          registered
        );
        return;
      }

      // D2: the target's stream died here, and no other instance holds it.
      // The command is parked on the slot below, never written: fire-and-
      // forget included, which then resolves when its parked command is
      // delivered (`flushParked`).
      const slot = !sentViaWebSocket && targetTabId ? this.deadSlotOf(targetTabId) : undefined;

      // Fail fast if no transport available
      if (!sentViaWebSocket && this.tabListeners.size === 0) {
        reject(
          new NoLiveAnswer(
            `SDK_DISCONNECTED: No browser connected to receive ${action} command. ` +
              'No WebSocket clients and no SSE listeners registered. ' +
              'Open the web app in a browser tab, or launch a headless one with ' +
              '`npx @qontinui/ui-bridge-headless --url <your-app-url>`. ' +
              'Use `GET /tabs/wait?timeoutMs=<ms>` to block until the tab registers.',
            'not_delivered'
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
      if (fireAndForget && !slot) {
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
          this.forgetPending(commandId);
          reject(
            new NoLiveAnswer(
              `No active UI Bridge SDK client received the ${action} command. ` +
                `${this.tabListeners.size} SSE listener(s) registered but none accepted the command` +
                `${targetTabId ? ` (target tab "${targetTabId}" has no live listener)` : ''}. ` +
                'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.',
              'not_delivered'
            )
          );
          return;
        }

        resolve(
          this.recordFireAndForget(commandId, action, notified, targetTabId, senderUserId) as T
        );
        return;
      }

      const timeout = setTimeout(
        () => this.timeOutPending(commandId, action, timeoutMs, transport),
        timeoutMs
      );

      // Evict oldest if at capacity
      if (this.pendingCommands.size >= this.maxPendingCommands) {
        const oldestKey = this.pendingCommands.keys().next().value;
        if (oldestKey) {
          this.settlePending(
            oldestKey,
            new NoLiveAnswer(
              'Command evicted: too many pending commands',
              'unanswered',
              'it was evicted from the pending queue under load before a tab answered'
            )
          );
        }
      }

      const pending: PendingCommand = {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        tabsNotified: sentViaWebSocket ? 1 : 0,
        errorResponseCount: 0,
        ...(sentViaWebSocket ? {} : { redeliverable: { action, payload } }),
        ...this.deliveryBinding(targetTabId, senderUserId),
      };
      this.pendingCommands.set(commandId, pending);
      // A result POSTed to another instance reaches this one over the bus, so
      // a command delivered here is subscribed as one dispatched over the bus
      // is. A fire-and-forget caller is already resolved: nothing awaits it.
      if (this.bus && !fireAndForget) {
        pending.busUnsub = this.subscribeBusResponse(commandId, action, targetTabId, senderUserId);
      }

      // If WebSocket failed, push via SSE
      if (!sentViaWebSocket) {
        const command: QueuedCommand = { commandId, action, payload, timestamp: Date.now() };

        if (this.tabListeners.size > 0) {
          transport = 'SSE';
          if (slot) {
            slot.park({ command, fireAndForget, ...(senderUserId ? { senderUserId } : {}) });
            return;
          }
          pending.tabsNotified = this.broadcastToListeners(command, targetTabId);

          // If broadcast reached no listeners, fail immediately
          if (pending.tabsNotified === 0) {
            clearTimeout(timeout);
            this.forgetPending(commandId);
            reject(
              new NoLiveAnswer(
                `No active UI Bridge SDK client received the ${action} command. ` +
                  `${this.tabListeners.size} SSE listener(s) registered but none accepted the command. ` +
                  'Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.',
                'not_delivered'
              )
            );
            return;
          }
        }
      }
    });
  }

  /**
   * Cross-instance (P0a): hand the command to whichever instance holds
   * `targetTabId`. A fire-and-forget command is published and resolved as
   * delivered — this instance cannot observe its execution, so `executed` is
   * not claimed, the envelope the local path returns; any other awaits its
   * response over the bus (`dispatchViaBus`).
   */
  private routeViaBus<T>(
    commandId: string,
    action: string,
    payload: unknown,
    targetTabId: string | undefined,
    senderUserId: string | undefined,
    resolve: (value: T) => void,
    reject: (error: Error) => void,
    registered = false
  ): void {
    if (!DEFAULT_FIRE_AND_FORGET.has(action)) {
      this.dispatchViaBus<T>(
        commandId,
        action,
        payload,
        targetTabId,
        senderUserId,
        resolve,
        reject,
        registered
      );
      return;
    }
    const timestamp = Date.now();
    // Nothing here awaits its result; the holder's recorder window is the
    // registry's, as for a fire-and-forget command delivered locally.
    if (!registered) this.registerAwaited(commandId, this.fireAndForgetRecorderMs(), 0);
    this.bus!.publishCommand({ commandId, action, payload, timestamp, targetTabId, senderUserId });
    resolve({
      success: true,
      fireAndForget: true,
      delivered: true,
      executed: false,
      action,
      timestamp,
    } as T);
  }

  /**
   * D2: a command for a tab whose stream died here goes over the bus when
   * another instance holds the tab — its newer stream may have opened there —
   * and is otherwise parked on the dead slot by `sendCommand`.
   */
  private async sendToDeadSlot<T>(
    action: string,
    payload: unknown,
    options: { targetTabId: string; ownerCheck?: { userId: string } }
  ): Promise<T> {
    const epoch = this.destroyEpoch;
    const elsewhere = await this.bus!.isTabKnown(options.targetTabId);
    this.throwIfDestroyedSince(epoch);
    if (elsewhere && this.deadSlotOf(options.targetTabId)) {
      return new Promise<T>((resolve, reject) =>
        this.routeViaBus<T>(
          this.generateCommandId(),
          action,
          payload,
          options.targetTabId,
          options.ownerCheck?.userId,
          resolve,
          reject
        )
      );
    }
    return this.sendCommand<T>(action, payload, { ...options, busChecked: true });
  }

  /**
   * A fire-and-forget command reached `notified` tabs: register a brief
   * recorder so the browser's execution POST (resolveCommand/rejectCommand) is
   * accepted rather than dropped, and return the caller's delivery envelope.
   * The recorder does NOT settle the caller (it is resolved on delivery); it
   * only lets the relay observe the real outcome (per-tab success tracking,
   * bus forwarding), and evicts itself after a short window, since a hard
   * navigation never reports back.
   */
  private recordFireAndForget(
    commandId: string,
    action: string,
    notified: number,
    targetTabId: string | undefined,
    senderUserId: string | undefined
  ): unknown {
    const recorderTtlMs = this.fireAndForgetRecorderMs();
    const recorderTimeout = setTimeout(() => {
      this.forgetPending(commandId);
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
      ...this.deliveryBinding(targetTabId, senderUserId),
    });
    return {
      success: true,
      fireAndForget: true,
      delivered: true,
      executed: false,
      tabsNotified: notified,
      action,
      timestamp: Date.now(),
    };
  }

  /**
   * Register `id` before a local send: a fire-and-forget command for its
   * result recorder's window, any other for `timeoutMs` plus the grace window.
   */
  private registerBeforeSend(id: string, fireAndForget: boolean, timeoutMs: number): void {
    if (fireAndForget) this.registerAwaited(id, this.fireAndForgetRecorderMs(), 0);
    else this.registerAwaited(id, timeoutMs);
  }

  /** How long a fire-and-forget command's result recorder stays (ms). */
  private fireAndForgetRecorderMs(): number {
    return Math.min(this.sseTimeoutMs, 2000);
  }

  /**
   * The dead slot `tabId`'s commands are parked on, when its SSE listener is
   * one (stream-slot.ts) and no connected WebSocket client can carry them.
   */
  private deadSlotOf(tabId: string): DeadSlot | undefined {
    if (this.wsClients.get(tabId)?.client.isConnected()) return undefined;
    return this.tabListeners.get(tabId)?.deadSlot;
  }

  /**
   * The tab's next stream registered: write every command parked on its dead
   * slot down it (D2), each bound to that stream, which is the one it went
   * down. A parked fire-and-forget command resolves now, on delivery; any
   * other gets the whole SSE timeout from its delivery, since the page could
   * not answer it before.
   */
  private flushParked(tabId: string, parked: ParkedCommand[], listener: TabListener): void {
    for (const { command, fireAndForget, senderUserId } of parked) {
      const pending = this.pendingCommands.get(command.commandId);
      if (!pending) continue; // settled meanwhile: timed out, evicted, or destroyed
      pending.streamId = listener.streamId;
      pending.streamUserId = listener.userId;
      this.registerBeforeSend(command.commandId, fireAndForget, this.sseTimeoutMs);
      if (!this.deliver(listener, command)) {
        const why = `Tab "${tabId}"'s new command stream did not accept it.`;
        this.settlePending(
          command.commandId,
          new NoLiveAnswer(notDeliveredMessage(command.action, why), 'not_delivered')
        );
      } else {
        this.settleParkedDelivery(
          tabId,
          { command, fireAndForget, ...(senderUserId ? { senderUserId } : {}) },
          pending,
          this.sseTimeoutMs,
          'SSE'
        );
      }
    }
  }

  /**
   * Re-send, down `listener`, every awaited command still pending on the
   * stream `priorStreamId` that this stream replaced (D3). Each goes under a
   * fresh alias id naming the original in `redeliveryOf`, bound to this stream
   * and sharing the original's promise and timeout (`aliasGroup`): the first
   * result of either id settles the caller and the other finds no pending
   * command. The original keeps its binding to the stream it went down, so each
   * id is still answered only from its own stream. Commands sent over a
   * WebSocket, bound to another user, or beyond the pending cap are skipped.
   */
  private redeliverPending(tabId: string, priorStreamId: string, listener: TabListener): void {
    for (const [pendingId, pending] of Array.from(this.pendingCommands)) {
      if (
        !pending.redeliverable ||
        pending.targetTabId !== tabId ||
        pending.streamId !== priorStreamId ||
        // Only the user the command was bound to (and dispatched for) may be
        // sent it, and then answer it.
        pending.streamUserId !== listener.userId ||
        (pending.ownerUserId !== undefined && pending.ownerUserId !== listener.userId) ||
        // An alias is a new pending entry: it respects the same cap.
        this.pendingCommands.size >= this.maxPendingCommands
      ) {
        continue;
      }
      const original = pending.redeliveryOf ?? pendingId;
      const aliasId = crypto.randomUUID();
      const group = pending.aliasGroup ?? new Set<string>([pendingId]);
      pending.aliasGroup = group;
      const alias: PendingCommand = {
        ...pending,
        tabsNotified: 1,
        errorResponseCount: 0,
        redeliveryOf: original,
        aliasGroup: group,
        streamId: listener.streamId,
        ...(listener.userId ? { streamUserId: listener.userId } : {}),
      };
      group.add(aliasId);
      // The spread carried the original's subscription: the alias has its own.
      delete alias.busUnsub;
      this.pendingCommands.set(aliasId, alias);
      if (this.bus) {
        alias.busUnsub = this.subscribeBusResponse(
          aliasId,
          pending.redeliverable.action,
          tabId,
          pending.ownerUserId
        );
      }
      this.registerAwaited(aliasId, this.sseTimeoutMs);
      const command: QueuedCommand = {
        commandId: aliasId,
        action: pending.redeliverable.action,
        payload: pending.redeliverable.payload,
        timestamp: Date.now(),
        redeliveryOf: original,
      };
      // A stream that refuses the write keeps the alias bound to it, so the
      // tab's next replacement redelivers from that stream in turn.
      if (this.deliver(listener, command)) {
        console.log(
          `[ui-bridge] redelivered ${pending.redeliverable.action} for ${tabId} ` +
            `(${original} as ${aliasId}) down its replacement stream`
        );
      }
    }
  }

  /**
   * A parked command reached its tab over `transport`: a fire-and-forget one
   * resolves now, on delivery; any other gets the whole `timeoutMs` from now,
   * since the page could not answer it before.
   */
  private settleParkedDelivery(
    tabId: string,
    parked: ParkedCommand,
    pending: PendingCommand,
    timeoutMs: number,
    transport: string
  ): void {
    const { command, fireAndForget, senderUserId } = parked;
    clearTimeout(pending.timeout);
    if (fireAndForget) {
      this.pendingCommands.delete(command.commandId);
      pending.resolve(
        this.recordFireAndForget(command.commandId, command.action, 1, tabId, senderUserId)
      );
      return;
    }
    pending.tabsNotified = 1;
    pending.timeout = setTimeout(
      () => this.timeOutPending(command.commandId, command.action, timeoutMs, transport),
      timeoutMs
    );
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
    reject: (error: Error) => void,
    registered = false
  ): void {
    const bus = this.bus!;
    const timeoutMs = this.sseTimeoutMs;

    const timeout = setTimeout(() => {
      this.forgetPending(commandId);
      // How many tabs the holder wrote it to is not known on this instance.
      reject(new NoLiveAnswer(noResultArrivedMessage(action, timeoutMs, 'bus'), 'unanswered'));
    }, timeoutMs);

    const busUnsub = this.subscribeBusResponse(commandId, action, targetTabId, senderUserId);

    this.pendingCommands.set(commandId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
      tabsNotified: 1,
      errorResponseCount: 0,
      busUnsub,
      ...this.deliveryBinding(targetTabId, senderUserId),
    });
    // `sendCommand` registered a command it expected to deliver locally.
    if (!registered) this.registerAwaited(commandId, timeoutMs);

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
   * Subscribe to the bus response channel of command `commandId`, which this
   * instance awaits: dispatched over the bus to a tab another instance holds,
   * or delivered to a tab this one holds. The result may be POSTed to ANY
   * instance, which forwards it here (`forwardUnpendingResult`). The returned
   * unsubscribe is stored on the pending entry; every settle path calls it
   * through `forgetPending`.
   */
  private subscribeBusResponse(
    commandId: string,
    action: string,
    targetTabId: string | undefined,
    senderUserId: string | undefined
  ): () => void {
    return this.bus!.subscribeResponse(commandId, (env) => {
      const pending = this.pendingCommands.get(commandId);
      if (!pending) return;
      // The responder's checks run here, where the command is pending. An
      // envelope that names no responder comes from an instance that predates
      // them and is taken as before.
      const responder =
        env.responderUserId !== undefined || env.streamId !== undefined
          ? { streamId: env.streamId, callerUserId: env.responderUserId }
          : undefined;
      // A tab's own failure is counted as a local one is: a command that went
      // to several tabs on this instance waits for the others (or the grace
      // window) before it fails, and a later success wins.
      if (!env.ok && env.code !== 'OWNER_MISMATCH' && env.code !== 'NOT_DELIVERED') {
        void this.rejectCommand(
          commandId,
          env.error || `Command ${action} failed`,
          env.tabId,
          responder,
          env.result
        );
        return;
      }
      if (this.responseRefusal(pending, env.tabId, responder)) return;
      clearTimeout(pending.timeout);
      if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
      this.dropPending(commandId);
      if (env.ok) {
        pending.resolve(env.result);
      } else if (env.code === 'OWNER_MISMATCH' && targetTabId !== undefined) {
        // The holding instance refused the sender's identity: answer it as a
        // local ownership refusal, so a tab held elsewhere and a tab that does
        // not exist read the same to a scoped caller.
        pending.reject(new OwnerMismatchError(targetTabId, senderUserId ?? '', ''));
      } else {
        // `NOT_DELIVERED` carries the relay's not-delivered message in `error`:
        // nothing ran. An `OWNER_MISMATCH` for a command that named no tab is
        // a relay refusal, not a tab's answer: it is answered as an ownership
        // refusal (the no-leak envelope, never the holder's tab-naming text),
        // which is never retried or answered from a cache. Any other
        // `ok: false` is a tab's own failure, whose verdict rides in `result`
        // (absent from a responder that predates it).
        const message = env.error || `Command ${action} failed`;
        pending.reject(
          env.code === 'NOT_DELIVERED'
            ? new NoLiveAnswer(message, 'not_delivered')
            : env.code === 'OWNER_MISMATCH'
              ? new OwnerMismatchError(env.tabId ?? '', senderUserId ?? '', '')
              : new TabReportedFailure(message, env.result, env.tabId)
        );
      }
    });
  }

  /**
   * TTL (seconds) for shared tab-presence registry entries. Comfortably longer
   * than the sweep cadence (which refreshes it) so a live tab never expires
   * between refreshes.
   */
  private busTabTtlSeconds(): number {
    return Math.ceil(Math.max(this.tabActiveWindowMs * 2, this.pruneSweepIntervalMs * 3) / 1000);
  }

  /**
   * Re-announce every tab connected to THIS instance in the shared presence
   * registry so its TTL doesn't lapse. Called from the periodic sweep. A dead
   * slot is never re-announced: it gave up its presence at death (D2).
   */
  private refreshBusTabPresence(): void {
    if (!this.bus) return;
    const ttl = this.busTabTtlSeconds();
    const ids = new Set<string>([...this.openListenerIds(), ...this.wsClients.keys()]);
    for (const id of ids) {
      this.bus.registerTab(id, ttl);
    }
  }

  /**
   * Write `command` to each open listener (to `targetTabId`'s only, when
   * given) and count the deliveries. A listener whose callback returns `false`
   * — its stream could not take the write — is not counted (D2).
   */
  private broadcastToListeners(command: QueuedCommand, targetTabId?: string): number {
    if (targetTabId) {
      const listener = this.tabListeners.get(targetTabId);
      return listener && isOpenListener(listener) && this.deliver(listener, command) ? 1 : 0;
    }
    let notified = 0;
    for (const listener of this.tabListeners.values()) {
      if (isOpenListener(listener) && this.deliver(listener, command)) notified++;
    }
    return notified;
  }

  /** Write `command` down `listener`'s stream: false when its callback reported, or threw, a failed write. */
  private deliver(listener: TabListener, command: QueuedCommand): boolean {
    try {
      return listener.callback(command) !== false;
    } catch {
      return false;
    }
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

  /**
   * Would a local send reach a transport this instance holds: a connected
   * WebSocket client, or an SSE listener (the target's own, or any)? The
   * side-effect-free mirror of the gate `sendCommandViaWebSocket` and
   * `deliverableLocally` apply; `getConnectedClient` cannot serve, as it
   * drops a dead entry.
   */
  private localDeliveryAvailable(targetTabId?: string): boolean {
    if (targetTabId) {
      if (this.wsClients.get(targetTabId)?.client.isConnected()) return true;
      return this.tabListeners.has(targetTabId);
    }
    for (const entry of this.wsClients.values()) {
      if (entry.client.isConnected()) return true;
    }
    return this.tabListeners.size > 0;
  }

  private getConnectedClient(targetTabId?: string): WebSocketClientEntry | null {
    if (targetTabId) {
      const entry = this.wsClients.get(targetTabId);
      if (entry) {
        if (entry.client.isConnected()) return entry;
        this.dropWebSocketEntry(targetTabId);
      }
      return null;
    }
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected()) return entry;
      this.dropWebSocketEntry(clientId);
    }
    return null;
  }

  /**
   * Register a WebSocket client for command delivery.
   */
  registerWebSocketClient(client: WebSocketClient): void {
    const now = Date.now();
    // A re-registration replaces the entry, so the old entry's warm-up timer
    // would otherwise be left armed with no handle to clear it.
    const previous = this.wsClients.get(client.clientId);
    if (previous?.snapshotTimer) clearTimeout(previous.snapshotTimer);
    // The replaced entry's bus subscription goes; this entry makes its own.
    previous?.busUnsub?.();
    const entry: WebSocketClientEntry = { client, connectedAt: now, lastActivity: now };
    this.wsClients.set(client.clientId, entry);
    this.ensureCleanupSweep();
    // Cross-instance: this instance now holds the tab through this client.
    // Announce it at once (the sweep keeps it fresh), and take the commands
    // other instances publish for it.
    if (this.bus) {
      this.bus.registerTab(client.clientId, this.busTabTtlSeconds());
      entry.busUnsub = this.subscribeWebSocketTab(client.clientId, entry);
    }

    // Signal that a transport is ready
    this.openConnectionGate();

    console.log(`[UIBridge] WebSocket client registered: ${client.clientId}`);

    // Proactive snapshot capture. The handle lives on the entry so
    // unregistering the client, or destroying the relay, clears it.
    entry.snapshotTimer = setTimeout(async () => {
      entry.snapshotTimer = undefined;
      if (!this.proactiveSnapshot || this.wsClients.get(client.clientId) !== entry) return;
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
    this.dropWebSocketEntry(clientId);
    // Same rationale as the SSE unsubscribe path: ownership rides on the
    // transport, so a closed transport invalidates the owner record.
    this.tabOwnership.delete(clientId);
    console.log(`[UIBridge] WebSocket client unregistered: ${clientId}`);
    this.resetConnectionGateIfEmpty();
  }

  /**
   * The bus commands other instances publish for `tabId`, a tab this instance
   * holds through `entry`'s WebSocket client, delivered to that client. While
   * an open SSE stream of the tab is registered here, that stream's own
   * subscription takes them instead, so each is delivered once by this
   * instance. Across instances it can run twice: a tab held through a
   * WebSocket client here and through an SSE stream on another instance is
   * subscribed on both, and each delivers it.
   */
  private subscribeWebSocketTab(tabId: string, entry: WebSocketClientEntry): () => void {
    return this.bus!.subscribeCommands(tabId, (env) => {
      if (this.wsClients.get(tabId) !== entry || !entry.client.isConnected()) return;
      const listener = this.tabListeners.get(tabId);
      if (listener && isOpenListener(listener)) return;
      if (this.refusesBusSender(tabId, env)) return;
      if (this.sendCommandViaWebSocket(env.commandId, env.action, env.payload, tabId)) {
        this.recordBusDelivery(env.commandId, tabId);
      } else {
        this.reportBusNotDelivered(tabId, env, 'Its WebSocket client did not accept the write.');
      }
    });
  }

  /**
   * Forget `clientId`'s WebSocket entry: clear its warm-up timer, drop its bus
   * subscription, and withdraw this instance's presence for the tab unless an
   * open SSE stream of the tab here still holds it. Every path that removes
   * an entry goes through here.
   */
  private dropWebSocketEntry(clientId: string): void {
    const entry = this.wsClients.get(clientId);
    if (!entry) return;
    this.wsClients.delete(clientId);
    if (entry.snapshotTimer) clearTimeout(entry.snapshotTimer);
    const unsub = entry.busUnsub;
    entry.busUnsub = undefined;
    // A failing bus is logged; it must not stop the removal (`destroy()` included).
    try {
      unsub?.();
    } catch (err) {
      console.error('[ui-bridge] releasing a WebSocket client from the bus failed:', err);
    }
    if (!this.bus) return;
    const listener = this.tabListeners.get(clientId);
    if (listener && isOpenListener(listener)) return;
    try {
      this.bus.unregisterTab(clientId);
    } catch (err) {
      console.error('[ui-bridge] withdrawing a WebSocket tab from the bus failed:', err);
    }
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
      if (!entry.client.isConnected()) this.dropWebSocketEntry(clientId);
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
          this.dropWebSocketEntry(clientId);
        }
      } else {
        this.dropWebSocketEntry(clientId);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Command Resolution
  // --------------------------------------------------------------------------

  /**
   * What a pending command records about where it went (per-user tab
   * scoping, §4.2): the tab it was dispatched to, the stream it went down on
   * this instance, and who it was dispatched for.
   */
  private deliveryBinding(
    targetTabId: string | undefined,
    ownerUserId: string | undefined
  ): Pick<PendingCommand, 'targetTabId' | 'streamId' | 'streamUserId' | 'ownerUserId'> {
    // A dead slot's stream takes no command (stream-slot.ts): a command
    // parked on it is bound when it is flushed, and one routed over the bus
    // goes down another instance's stream.
    const found = targetTabId ? this.tabListeners.get(targetTabId) : undefined;
    const listener = found && isOpenListener(found) ? found : undefined;
    return {
      ...(targetTabId ? { targetTabId } : {}),
      ...(listener?.streamId ? { streamId: listener.streamId } : {}),
      ...(listener?.userId ? { streamUserId: listener.userId } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
    };
  }

  /**
   * Why `responder` may not settle a command, or null when it may (per-user
   * tab scoping, §4.2). A result is taken only from the tab the command was
   * dispatched to; a presented stream id must be the stream the command went
   * down; and a verified responder must be the tab's owner (before the tab
   * registers: the identity its stream was opened under, else the caller the
   * command was dispatched for). A response that presents no stream id passes
   * on the identity check, so a client that predates stream ids keeps working
   * where identity is verified. With no responder at all (an in-process call)
   * nothing is checked, and with no identity a missing tab id is tolerated:
   * single-user mode is unchanged.
   */
  private responseRefusal(
    binding: Pick<PendingCommand, 'targetTabId' | 'streamId' | 'streamUserId' | 'ownerUserId'>,
    tabId: string | undefined,
    responder: CommandResponder | undefined
  ): 'TAB_MISMATCH' | 'STREAM_MISMATCH' | 'NOT_OWNER' | null {
    if (!responder) return null;
    const identity = responder.callerUserId || undefined;
    if (
      binding.targetTabId !== undefined &&
      (tabId !== undefined || identity !== undefined) &&
      tabId !== binding.targetTabId
    ) {
      return 'TAB_MISMATCH';
    }
    if (
      responder.streamId !== undefined &&
      binding.streamId !== undefined &&
      responder.streamId !== binding.streamId
    ) {
      return 'STREAM_MISMATCH';
    }
    if (identity !== undefined) {
      const owner = binding.targetTabId ? this.tabOwnership.get(binding.targetTabId) : undefined;
      const expected = owner?.userId ?? binding.streamUserId ?? binding.ownerUserId;
      if (expected !== undefined && expected !== identity) return 'NOT_OWNER';
    }
    return null;
  }

  /** This instance's record of delivering `commandId` for another instance, if live. */
  private liveBusDelivery(commandId: string): BusDelivery | undefined {
    const delivery = this.busDeliveries.get(commandId);
    if (delivery && delivery.expiresAt < Date.now()) {
      this.busDeliveries.delete(commandId);
      return undefined;
    }
    return delivery;
  }

  /** The responder fields a forwarded response carries over the bus. */
  private responderEnvelope(responder: CommandResponder | undefined): {
    responderUserId?: string;
    streamId?: string;
  } {
    return {
      ...(responder?.callerUserId ? { responderUserId: responder.callerUserId } : {}),
      ...(responder?.streamId !== undefined ? { streamId: responder.streamId } : {}),
    };
  }

  /**
   * Resolve a pending command with a response from the browser. `responder`
   * says who is answering (the HTTP layer passes it). The outcome says what
   * became of the result ({@link CommandResultOutcome}): a response the checks
   * in `responseRefusal` refuse is dropped as `refused`, and one no instance
   * awaits is dropped as `unknown`. Everything up to the registry read runs
   * synchronously, so a pending command is settled before this returns.
   */
  async resolveCommand(
    commandId: string,
    result: unknown,
    tabId?: string,
    responder?: CommandResponder
  ): Promise<CommandResultOutcome> {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) {
      return this.forwardUnpendingResult(commandId, tabId, responder, {
        commandId,
        ok: true,
        result,
        tabId,
        ...this.responderEnvelope(responder),
      });
    }
    if (this.responseRefusal(pending, tabId, responder)) return 'refused';

    clearTimeout(pending.timeout);
    if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
    if (pending.busUnsub) pending.busUnsub();
    this.dropPending(commandId);
    pending.resolve(result);

    // Track per-tab command success and remove from demoted set
    if (tabId) {
      this.tabLastSuccess.set(tabId, Date.now());
      this.demotedTabs.delete(tabId);
    }

    return 'settled';
  }

  /**
   * Cross-instance (P0a): a result landed on an instance holding no pending
   * command for it. Forward it over the bus to the instance that awaits it,
   * with who answered — but only when one does (D2). A delivery this
   * instance holds is proof the command is awaited, and the stream it went
   * down is checked first: a refused result never reaches the registry.
   * Otherwise the registry is read; a failed read forwards (logged).
   */
  private async forwardUnpendingResult(
    commandId: string,
    tabId: string | undefined,
    responder: CommandResponder | undefined,
    envelope: RelayResponseEnvelope
  ): Promise<CommandResultOutcome> {
    const bus = this.bus;
    if (!bus) return 'unknown';
    const delivery = this.liveBusDelivery(commandId);
    if (delivery) {
      if (this.responseRefusal(delivery, tabId, responder)) return 'refused';
      this.busDeliveries.delete(commandId);
      bus.publishResponse(envelope);
      return 'forwarded';
    }
    if (!(await someInstanceAwaits(bus, commandId))) return 'unknown';
    bus.publishResponse(envelope);
    return 'forwarded';
  }

  /**
   * Reject a pending command with a failure the browser reported. `result` is
   * what the tab posted (the dispatcher's `{ success: false, … }` envelope),
   * when it posted one: the rejection is a {@link TabReportedFailure} carrying
   * it, so the tab's own verdict reaches the caller, and across instances the
   * bus forwards it on `ok: false`. The settle semantics are those of every
   * rejection: it waits for every notified tab, and a later success wins.
   */
  async rejectCommand(
    commandId: string,
    errorMessage: string,
    tabId?: string,
    responder?: CommandResponder,
    result?: unknown
  ): Promise<CommandResultOutcome> {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) {
      // Cross-instance (P0a): forward the error to the instance awaiting it.
      return this.forwardUnpendingResult(commandId, tabId, responder, {
        commandId,
        ok: false,
        error: errorMessage,
        ...(result !== undefined ? { result } : {}),
        ...(tabId !== undefined ? { tabId } : {}),
        ...this.responderEnvelope(responder),
      });
    }
    if (this.responseRefusal(pending, tabId, responder)) return 'refused';

    pending.errorResponseCount++;
    if (!pending.firstError) {
      pending.firstError = new TabReportedFailure(errorMessage, result, tabId);
    }

    // All notified tabs responded with errors — reject immediately
    if (pending.errorResponseCount >= pending.tabsNotified) {
      clearTimeout(pending.timeout);
      if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
      this.dropPending(commandId);
      pending.reject(pending.firstError!);
      return 'settled';
    }

    // Start grace timer for tabs that may go silent
    if (!pending.graceTimeout) {
      pending.graceTimeout = setTimeout(() => {
        const stillPending = this.pendingCommands.get(commandId);
        if (stillPending) {
          clearTimeout(stillPending.timeout);
          this.dropPending(commandId);
          stillPending.reject(
            stillPending.firstError || new TabReportedFailure(errorMessage, result, tabId)
          );
        }
      }, this.multiTabGraceMs);
    }

    return 'settled';
  }

  // --------------------------------------------------------------------------
  // Tab / Client Management
  // --------------------------------------------------------------------------

  /**
   * Subscribe to commands via SSE. Returns an unsubscribe function. This is
   * the unscoped door (no caller identity); the HTTP layer opens streams for
   * a verified caller through {@link openCommandStream}.
   */
  subscribeToCommands(listener: CommandListener, tabId?: string): () => void {
    return this.addCommandListener(listener, tabId, undefined).unsubscribe;
  }

  /**
   * Open a command stream on behalf of a verified caller (per-user tab
   * scoping, §4.2). With no caller this is {@link subscribeToCommands}. With
   * one, the stream must name its tab, and that tab may not be registered to
   * another user, nor (before it registers) already be streaming to another
   * user. A refusal throws `OwnerMismatchError`, which the HTTP layer answers
   * as TAB_NOT_FOUND. The returned `streamId` is fresh per stream; see
   * `resolveCommand` for what it binds. `stream` is what the stream behind
   * the listener declared (stream-lease.ts), and the returned `park` is how
   * it reports an end the relay should hold the tab's commands across.
   */
  openCommandStream(
    listener: CommandListener,
    tabId: string | undefined,
    callerUserId?: string | null,
    stream?: CommandStreamOptions
  ): CommandStreamHandle {
    const userId = callerUserId || undefined;
    if (userId) {
      if (!tabId) {
        throw new Error('A command stream opened for a verified caller must name its tab');
      }
      const owner = this.tabOwnership.get(tabId);
      if (owner && owner.userId !== userId) {
        throw new OwnerMismatchError(tabId, userId, owner.userId);
      }
      const live = this.tabListeners.get(tabId);
      if (!owner && live?.userId && live.userId !== userId) {
        throw new OwnerMismatchError(tabId, userId, live.userId);
      }
    }
    return this.addCommandListener(listener, tabId, userId, stream);
  }

  private addCommandListener(
    listener: CommandListener,
    tabId: string | undefined,
    userId: string | undefined,
    stream?: CommandStreamOptions
  ): CommandStreamHandle {
    const id = tabId || `anon_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const streamId = crypto.randomUUID();
    const openedAt = Date.now();
    const tabListener: TabListener = {
      tabId: id,
      callback: listener,
      streamId,
      openedAt,
      caps: stream?.caps ?? [],
      state: 'open',
      ...(userId ? { userId } : {}),
      ...(stream?.clientInstanceId ? { clientInstanceId: stream.clientInstanceId } : {}),
      ...(stream?.close ? { close: stream.close } : {}),
    };
    const replaced = this.tabListeners.get(id);
    const tombstone = replaced ? undefined : this.recentTombstone(id, openedAt);
    // A stream for a tab that still holds a listener here (open or dead), or
    // lost its last one under `reconnectGraceMs` ago (`leaseReturnGraceMs`
    // after a lease close), RETURNS the tab (a rotation, a reconnect, a
    // reload) rather than introducing it.
    const returning = replaced !== undefined || tombstone !== undefined;
    // It RESUMES the same page when both it and the stream before it name the
    // page instance (`cid`) and the two agree; when either names none, by
    // returning alone.
    const priorPage = replaced ? replaced.clientInstanceId : tombstone?.clientInstanceId;
    const resumed =
      stream?.clientInstanceId !== undefined && priorPage !== undefined
        ? stream.clientInstanceId === priorPage
        : returning;
    this.tabListeners.set(id, tabListener);
    this.disarmTimer(this.listenerTombstones.get(id)?.leaseReturn?.expiry);
    this.listenerTombstones.delete(id);
    // A stream replaced before it unsubscribed leaves its bus subscription
    // behind, and `destroy()` reaches only the listener in the map. Drop it
    // here, at the source; the tab's presence now belongs to this stream.
    try {
      replaced?.releaseBus?.({ keepPresence: true });
    } catch (err) {
      console.error('[ui-bridge] releasing a replaced listener from the bus failed:', err);
    }
    // D1/D2: a replaced dead slot stops expiring, and its held commands go
    // down this stream once the stream is registered (below). A replaced open
    // stream is closed (its `end` frame tells its client) when this stream is
    // its page's next one: the same page instance (`cid`), or any stream after
    // a `rotate`. Otherwise another page holds the tab id too, a duplicated
    // browser tab or an unnamed legacy client, and its stream is left open,
    // unheard: closing it would make that page reopen and close this one in
    // turn, without end. This, the newer stream, holds the tab.
    const slot = replaced?.deadSlot;
    if (slot) {
      this.disarmTimer(slot.expiry);
    } else if (
      replaced &&
      (replaced.rotatedAt !== undefined ||
        (stream?.clientInstanceId !== undefined &&
          stream.clientInstanceId === replaced.clientInstanceId))
    ) {
      try {
        replaced.close?.();
      } catch (err) {
        console.error('[ui-bridge] closing a replaced stream failed:', err);
      }
    }

    this.ensureCleanupSweep();

    // A new tab becomes primary: the most-recently-registered rule the
    // nextjs.ts header documents. A returning tab keeps whatever standing it
    // had, so a reconnect or a rotation cannot take the primary from a live tab.
    this.demotedTabs.delete(id);
    if (!returning) this.setPrimaryTab(id);
    // A stream that does not resume the same page — a new tab, or a reload of
    // one under another `cid` — starts the tab's next generation, a value no
    // generation of any tab has had (`tabGenerationSeq`), without a warm-up
    // mark: neither a mark an earlier generation left (its tombstone past the
    // grace but not yet swept) nor a late reply to its warm-up may let a
    // resume of this generation skip a warm-up it never had. A resume of the
    // same page stays in its own generation, a dead slot's included: a dead
    // slot is a pause of its page, not a fresh open.
    if (!resumed) {
      this.warmedUpTabs.delete(id);
      this.tabGenerations.set(id, ++this.tabGenerationSeq.n);
    }
    const generation = this.tabGenerations.get(id) ?? 0;

    // Signal that a transport is ready
    this.openConnectionGate();

    console.log(`[ui-bridge] SSE listener connected: ${id} (total: ${this.tabListeners.size})`);

    // Cross-instance (P0a): this instance now holds the SSE stream for `id`.
    // Subscribe to the bus so commands dispatched from OTHER instances (which
    // have no local listener for this tab) are delivered down this stream.
    let busUnsubCmd: (() => void) | null = null;
    // Drops the bus command subscription at most once, whichever of
    // `unsubscribe` and `destroy()` reaches it first.
    const releaseBusCommands = () => {
      const unsub = busUnsubCmd;
      busUnsubCmd = null;
      if (unsub) unsub();
    };
    if (this.bus) {
      // Announce this tab in the shared presence registry so OTHER instances'
      // routing guard knows it exists here. TTL > sweep interval; refreshed by
      // the periodic cleanup sweep. Removed on unsubscribe.
      this.bus.registerTab(id, this.busTabTtlSeconds());
      const bus = this.bus;
      busUnsubCmd = bus.subscribeCommands(id, (env) => {
        // Deliver only if this tab's listener is still registered here, open.
        const current = this.tabListeners.get(id);
        if (!current || !isOpenListener(current)) return;
        if (current.rotatedAt === undefined) {
          this.deliverBusCommand(id, env, current);
          return;
        }
        // Sent its `rotate` frame: the client's next stream may hold the tab
        // on another instance, which then delivers the command. This stream
        // delivers it only when no other instance holds the tab, so a command
        // is neither run twice nor left with no deliverer while no
        // replacement has registered. Two races remain. The replacement
        // registers its hold (ZADD) and subscribes (SUBSCRIBE) over separate
        // connections, so a command published between the two runs twice
        // (subscribed, its hold not yet seen) or reaches nobody (its hold
        // seen, not yet subscribed). And on one instance, registering a
        // replacement releases this handler first, which can UNSUBSCRIBE the
        // channel before the replacement's SUBSCRIBE goes out, so a command
        // published between the two reaches no handler here; that gap
        // predates Phase 2.
        void bus
          .holdsElsewhere(id)
          .catch(() => false)
          .then((elsewhere) => {
            if (elsewhere) return;
            const holder = this.tabListeners.get(id);
            if (!holder || !isOpenListener(holder)) return;
            if (holder === current) {
              this.deliverBusCommand(id, env, current);
            } else if (holder.rotatedAt === undefined) {
              // The replacement registered here while this handler waited: it
              // subscribed after the publish, so it never saw the command. A
              // replacement that has itself rotated by the time the answer
              // comes is deliberately not handed it: that takes a rotation
              // inside one round trip, which the lease makes near-unreachable.
              this.deliverBusCommand(id, env, holder);
            }
          });
      });
      // The two halves are released independently, each at most once: a
      // release that keeps the presence (a replacement, or a WebSocket client
      // of the tab still connected here) leaves it to a later one.
      let presenceReleased = false;
      tabListener.releaseBus = (options) => {
        // Both halves run even when one throws: `destroy()` must finish.
        try {
          releaseBusCommands();
        } finally {
          if (!options?.keepPresence && !presenceReleased) {
            presenceReleased = true;
            bus.unregisterTab(id);
          }
        }
      };
    }

    // D2: the commands a replaced dead slot held go down this stream now that
    // it is fully registered — its standing, generation and presence settled
    // — so one answered at once finds the tab as it will stay. They are
    // written before any warm-up, which goes out on its own timer.
    if (slot) this.flushParked(id, slot.drain(), tabListener);

    // D3: a command still pending on the stream this one replaced may have
    // been written to a consumer that is gone. When the SAME page instance
    // that held that stream opened this one, and its client dedupes, the
    // command goes down this stream under an alias id. A page that reloaded
    // (another `cid`), or a client with no dedupe, is sent nothing: the
    // command may have run, and it times out as it always did.
    const priorStreamId = replaced ? replaced.streamId : tombstone?.streamId;
    if (
      priorStreamId !== undefined &&
      priorPage !== undefined &&
      stream?.clientInstanceId === priorPage &&
      tabListener.caps.includes(DEDUPE_CAPABILITY)
    ) {
      this.redeliverPending(id, priorStreamId, tabListener);
    }

    // Proactive snapshot capture. Both the capture and the retry ask whether
    // the registered listener is still THIS stream, not merely whether the
    // tab has one: a warm-up settled by `destroy()`, or by a newer stream
    // replacing this one, must not send a duplicate `getControlSnapshot` down
    // the newer stream for the same tab.
    const isOwnStream = (): boolean => this.tabListeners.get(id)?.streamId === streamId;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const captureSnapshot = async (): Promise<boolean> => {
      if (!isOwnStream()) return false;
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
          // Marked only while the tab is still in the generation this warm-up
          // was armed in. A later fresh open, `destroy()`, or the sweep
          // dropping the tab's tombstone all end that generation; a resume of
          // it does not, so a reply that lands after one still counts.
          if (this.tabGenerations.get(id) === generation) {
            this.warmedUpTabs.add(id);
          }
          return true;
        }
      } catch {
        /* Tab may have disconnected */
      }
      return false;
    };

    // Both warm-up timers are armed through `armTimer`, so `destroy()` clears
    // them along with the listener they look for. A stream that resumes the
    // same page, and whose tab's warm-up was already answered in this
    // generation, is sent none; any other stream is, including a resume whose
    // predecessor ended, died or was replaced before its own warm-up was
    // answered.
    const proactiveTimer =
      resumed && this.warmedUpTabs.has(id)
        ? null
        : this.armTimer(async () => {
            if (!this.proactiveSnapshot) return;
            const captured = await captureSnapshot();
            if (!captured && isOwnStream()) {
              retryTimer = this.armTimer(() => void captureSnapshot(), 1500);
            }
          }, 500);

    const unsubscribe = () => {
      this.disarmTimer(proactiveTimer);
      this.disarmTimer(retryTimer);
      // A newer stream for the same tab replaced this one: its state, and the
      // tab's presence in the shared registry, are not this stream's to
      // remove — only its own bus command subscription is.
      if (this.tabListeners.get(id)?.streamId !== streamId) {
        releaseBusCommands();
        return;
      }
      this.releaseListenerBus(tabListener, 'an unsubscribed listener');
      this.forgetTab(id);
    };
    const park = (reason: StreamEndReason) => {
      this.disarmTimer(proactiveTimer);
      this.disarmTimer(retryTimer);
      if (this.tabListeners.get(id) !== tabListener) {
        releaseBusCommands();
        return;
      }
      if (!isOpenListener(tabListener)) return;
      // D2: give up the bus membership at death, not at expiry: this
      // instance's command subscription and its own presence (kept only while
      // a WebSocket client of the tab is connected here). A holder of the
      // tab's newer stream elsewhere is then the only one the fleet routes
      // to, and this slot's expiry cannot touch that holder's presence.
      this.releaseListenerBus(tabListener, 'a dead listener');
      tabListener.state = 'dead';
      tabListener.deadSlot = new DeadSlot(
        reason,
        this.armTimer(() => {
          if (this.tabListeners.get(id) !== tabListener) return;
          this.releaseListenerBus(tabListener, 'an expired dead listener');
          this.forgetTab(id);
        }, this.reconnectGraceMs)
      );
      console.log(
        `[ui-bridge] SSE listener dead: ${id} (${reason}); its commands are held ` +
          `${this.reconnectGraceMs}ms for its next stream`
      );
    };
    const closedAtLease = (reason: StreamEndReason) => {
      this.disarmTimer(proactiveTimer);
      this.disarmTimer(retryTimer);
      if (this.tabListeners.get(id) !== tabListener) {
        releaseBusCommands();
        return;
      }
      if (!isOpenListener(tabListener)) return;
      this.releaseListenerBus(tabListener, 'a listener closed at its lease');
      this.awaitReturn(id, reason);
    };
    // The client is opening its next stream, which may land on another
    // instance. This stream keeps its presence, its bus subscription and the
    // commands this instance dispatches to it until it ends; from now on its
    // bus handler defers to an instance that holds the tab too (above).
    const rotated = () => {
      tabListener.rotatedAt = Date.now();
    };
    return { streamId, unsubscribe, park, closedAtLease, rotated };
  }

  /**
   * Deliver a command another instance published for `tabId` down `listener`,
   * this instance's SSE stream for the tab, once its sender is re-verified
   * (`refusesBusSender`).
   */
  private deliverBusCommand(tabId: string, env: RelayCommandEnvelope, listener: TabListener): void {
    if (this.refusesBusSender(tabId, env)) return;
    const command: QueuedCommand = {
      commandId: env.commandId,
      action: env.action,
      payload: env.payload,
      timestamp: env.timestamp,
    };
    // Remember where it went, so a response that lands here is held to the
    // stream that received the command (see `resolveCommand`).
    if (this.deliver(listener, command)) this.recordBusDelivery(env.commandId, tabId, listener);
    else this.reportBusNotDelivered(tabId, env, 'Its command stream did not accept the write.');
  }

  /**
   * This instance holds `tabId` but could not write bus command `env` to it:
   * tell the sender at once so it rejects with the relay's not-delivered
   * message rather than waiting out its bus timeout. Silent when the command
   * is a broadcast (another holder may still deliver it) or when another
   * instance holds the tab too (it delivers or reports for itself). Only a
   * command written to an open stream reaches here; one for a tab with no
   * open stream is parked by its sender's instance, never published as a
   * failure.
   */
  private reportBusNotDelivered(tabId: string, env: RelayCommandEnvelope, why: string): void {
    const bus = this.bus;
    if (!bus || env.targetTabId === undefined) return;
    const publish = () => {
      try {
        bus.publishResponse({
          commandId: env.commandId,
          ok: false,
          error: notDeliveredMessage(env.action, `Tab "${tabId}" is held here. ${why}`),
          code: 'NOT_DELIVERED',
        });
      } catch (err) {
        console.error('[ui-bridge] publishing a bus not-delivered reply failed:', err);
      }
    };
    // An unreadable holder registry stays silent: another instance may be
    // delivering, and the sender's bus timeout still ends the wait.
    const epoch = this.destroyEpoch;
    void bus
      .holdsElsewhere(tabId)
      .then((elsewhere) => {
        if (!elsewhere && this.destroyEpoch === epoch) publish();
      })
      .catch(() => undefined);
  }

  /**
   * Per-user tab scoping (§4.2): the sending instance MAY hold stale
   * ownership metadata, so its assertion is not trusted alone. A bus command
   * whose `senderUserId` is not `tabId`'s owner in the LOCAL registry is
   * refused back over the bus, with the generic prose `OwnerMismatchError`
   * uses, and not delivered. An envelope with no `senderUserId` (an admin
   * dispatch, the legacy path, a fire-and-forget broadcast) is not checked.
   */
  private refusesBusSender(tabId: string, env: RelayCommandEnvelope): boolean {
    if (env.senderUserId === undefined) return false;
    const owner = this.tabOwnership.get(tabId);
    if (owner && owner.userId === env.senderUserId) return false;
    this.bus?.publishResponse({
      commandId: env.commandId,
      ok: false,
      error: `tabId "${tabId}" is not addressable by the authenticated caller`,
      code: 'OWNER_MISMATCH',
    });
    return true;
  }

  /**
   * Release `listener`'s hold on the bus: its command subscription, and this
   * instance's presence for the tab unless a WebSocket client of the tab is
   * still connected here, through which this instance still holds the tab.
   * A failing bus is logged; it must not stop the transition.
   */
  private releaseListenerBus(listener: TabListener, what: string): void {
    try {
      listener.releaseBus?.({
        keepPresence: this.wsClients.get(listener.tabId)?.client.isConnected() === true,
      });
    } catch (err) {
      console.error(`[ui-bridge] releasing ${what} from the bus failed:`, err);
    }
  }

  /**
   * The server closed `tabId`'s stream at its lease (`lease`,
   * `rotate_unanswered`): forget the listener now, and keep the tab's place
   * for `leaseReturnGraceMs`. Its tombstone, standing, owner and metadata
   * stay, so the stream its client opens next returns the tab, and a command
   * for it meanwhile is refused at once (`queueCommandInner`).
   */
  private awaitReturn(tabId: string, reason: StreamEndReason): void {
    const listener = this.tabListeners.get(tabId);
    if (!listener) return;
    this.tabListeners.delete(tabId);
    const graceMs = this.leaseReturnGraceMs;
    const tombstone: ListenerTombstone = {
      removedAt: Date.now(),
      ...(listener.clientInstanceId ? { clientInstanceId: listener.clientInstanceId } : {}),
      ...(listener.streamId ? { streamId: listener.streamId } : {}),
    };
    tombstone.leaseReturn = {
      reason,
      graceMs,
      expiry: this.armTimer(() => this.endLeaseReturn(tabId, tombstone), graceMs),
    };
    this.listenerTombstones.set(tabId, tombstone);
    console.log(
      `[ui-bridge] SSE listener closed at its lease: ${tabId} (${reason}); ` +
        `the tab keeps its place ${graceMs}ms for its next stream`
    );
    // With no transport left, an unpinned command waits for one to connect
    // (`queueCommand`), as it does after any other last transport goes: the
    // tab's own reopen may be that one. A command pinned to the tab is still
    // refused at once.
    this.resetConnectionGateIfEmpty();
  }

  /**
   * `tabId` did not return within `leaseReturnGraceMs` of its lease close:
   * it is gone, unless a transport for it is held here by now.
   */
  private endLeaseReturn(tabId: string, tombstone: ListenerTombstone): void {
    if (this.listenerTombstones.get(tabId) !== tombstone) return;
    this.listenerTombstones.delete(tabId);
    if (this.tabListeners.has(tabId) || this.wsClients.has(tabId)) return;
    this.forgetTabState(tabId);
  }

  /**
   * `tabId`'s lease close, while the tab awaits its return: no SSE listener
   * here, and a lease-close tombstone younger than its grace.
   */
  private leaseReturnOf(tabId: string): ListenerTombstone['leaseReturn'] {
    if (this.tabListeners.has(tabId)) return undefined;
    return this.recentTombstone(tabId, Date.now())?.leaseReturn;
  }

  /**
   * The tab's SSE listener is gone for good (its stream ended, or its dead
   * slot expired): forget it and the tab state it carried.
   */
  private forgetTab(tabId: string): void {
    this.dropTabListener(tabId);
    this.forgetTabState(tabId);
  }

  /** Forget the tab state an SSE listener carried: its demotion, metadata and owner. */
  private forgetTabState(tabId: string): void {
    this.demotedTabs.delete(tabId);
    this.tabMetadata.delete(tabId);
    // Drop ownership when the transport closes. A future tab with the
    // SAME id must re-register before authenticated dispatch sees it.
    this.tabOwnership.delete(tabId);
    console.log(
      `[ui-bridge] SSE listener disconnected: ${tabId} (total: ${this.tabListeners.size})`
    );
    this.resetConnectionGateIfEmpty();
  }

  /**
   * Forget `tabId`'s SSE listener, remembering when, and its page instance,
   * for `reconnectGraceMs`: a stream that reopens within it resumes the tab
   * (`addCommandListener`). A dead slot's held commands fail now, with the
   * not-delivered message (D2).
   */
  private dropTabListener(tabId: string): void {
    const listener = this.tabListeners.get(tabId);
    if (!listener) return;
    this.tabListeners.delete(tabId);
    this.listenerTombstones.set(tabId, {
      removedAt: Date.now(),
      ...(listener.clientInstanceId ? { clientInstanceId: listener.clientInstanceId } : {}),
      ...(listener.streamId ? { streamId: listener.streamId } : {}),
    });
    const slot = listener.deadSlot;
    if (!slot) return;
    this.disarmTimer(slot.expiry);
    const parked = slot.drain();
    if (parked.length === 0) return;
    // A WebSocket client of the tab that connected here meanwhile carries them.
    const rest = this.sendParkedViaWebSocket(tabId, parked);
    if (rest.length === 0) return;
    if (this.bus) void this.settleExpiredParked(tabId, slot.reason, rest);
    else this.failParked(tabId, slot.reason, rest);
  }

  /**
   * Send each of `parked` to `tabId`'s WebSocket client, when one is
   * connected here, and return those it did not take.
   */
  private sendParkedViaWebSocket(tabId: string, parked: ParkedCommand[]): ParkedCommand[] {
    if (this.wsClients.get(tabId)?.client.isConnected() !== true) return parked;
    const rest: ParkedCommand[] = [];
    for (const item of parked) {
      const { command } = item;
      const pending = this.pendingCommands.get(command.commandId);
      if (!pending) continue; // settled meanwhile: timed out, evicted, or destroyed
      this.registerBeforeSend(command.commandId, item.fireAndForget, this.wsTimeoutMs);
      if (this.sendCommandViaWebSocket(command.commandId, command.action, command.payload, tabId)) {
        this.settleParkedDelivery(tabId, item, pending, this.wsTimeoutMs, 'WebSocket');
      } else {
        rest.push(item);
      }
    }
    return rest;
  }

  /**
   * A dead slot went with commands still held. The tab's next stream may
   * have opened on another instance meanwhile: when another instance holds
   * the tab, they go over the bus; otherwise they fail as not delivered.
   * Only another instance counts (`holdsElsewhere`): this instance's own
   * presence, when it still has one, has nothing here to carry them.
   */
  private async settleExpiredParked(
    tabId: string,
    reason: StreamEndReason,
    parked: ParkedCommand[]
  ): Promise<void> {
    const epoch = this.destroyEpoch;
    let elsewhere: boolean;
    try {
      elsewhere = await this.bus!.holdsElsewhere(tabId);
    } catch {
      elsewhere = false;
    }
    // `destroy()` settled them meanwhile.
    if (this.destroyEpoch !== epoch) return;
    if (!elsewhere) {
      this.failParked(tabId, reason, parked);
      return;
    }
    for (const { command, senderUserId } of parked) {
      const pending = this.pendingCommands.get(command.commandId);
      if (!pending) continue; // settled meanwhile: timed out or evicted
      clearTimeout(pending.timeout);
      if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
      // The bus path makes its own entry and subscription; the one the local
      // send made goes, and the id stays registered (queue time registered it).
      if (pending.busUnsub) {
        const unsub = pending.busUnsub;
        pending.busUnsub = undefined;
        unsub();
      }
      this.pendingCommands.delete(command.commandId);
      this.routeViaBus(
        command.commandId,
        command.action,
        command.payload,
        tabId,
        senderUserId,
        pending.resolve,
        pending.reject,
        true
      );
    }
  }

  /** Fail `parked`, held on `tabId`'s dead slot, with the not-delivered message. */
  private failParked(tabId: string, reason: StreamEndReason, parked: ParkedCommand[]): void {
    const why =
      `Tab "${tabId}"'s command stream ended (${reason}) and no new stream opened ` +
      `within ${this.reconnectGraceMs}ms.`;
    for (const { command } of parked) {
      this.settlePending(
        command.commandId,
        new NoLiveAnswer(notDeliveredMessage(command.action, why), 'not_delivered')
      );
    }
  }

  /**
   * `tabId`'s tombstone, when it lost its last SSE listener less than
   * `reconnectGraceMs` before `now`, or less than its `leaseReturn` grace when
   * it lost it to a lease close.
   */
  private recentTombstone(tabId: string, now: number): ListenerTombstone | undefined {
    const tombstone = this.listenerTombstones.get(tabId);
    if (tombstone === undefined) return undefined;
    const graceMs = tombstone.leaseReturn?.graceMs ?? this.reconnectGraceMs;
    return now - tombstone.removedAt < graceMs ? tombstone : undefined;
  }

  /** Tab ids holding an open SSE listener here (`isOpenListener`), in registration order. */
  private openListenerIds(): string[] {
    const ids: string[] = [];
    for (const [id, listener] of this.tabListeners) if (isOpenListener(listener)) ids.push(id);
    return ids;
  }

  /**
   * Record a bus-dispatched command this instance delivered down a local SSE
   * stream (`listener`), or to a local WebSocket client (no listener).
   */
  private recordBusDelivery(commandId: string, tabId: string, listener?: TabListener): void {
    const now = Date.now();
    if (this.busDeliveries.size > this.maxPendingCommands) {
      for (const [id, delivery] of this.busDeliveries) {
        if (delivery.expiresAt < now) this.busDeliveries.delete(id);
      }
    }
    this.busDeliveries.set(commandId, {
      targetTabId: tabId,
      ...(listener?.streamId ? { streamId: listener.streamId } : {}),
      ...(listener?.userId ? { streamUserId: listener.userId } : {}),
      expiresAt: now + this.sseTimeoutMs + this.multiTabGraceMs,
    });
  }

  /**
   * Check if any SSE listeners are connected. A dead slot is not one.
   */
  hasCommandListeners(): boolean {
    return this.openListenerIds().length > 0;
  }

  /**
   * Get list of connected tab IDs: those with an open SSE listener.
   */
  getConnectedTabs(): string[] {
    return this.openListenerIds();
  }

  /**
   * Get connected tabs with page info by querying each tab, or only the
   * connected tabs among `onlyTabIds` when given (a scoped caller's own).
   */
  async getTabsWithInfo(onlyTabIds?: readonly string[]): Promise<TabInfo[]> {
    const only = onlyTabIds ? new Set(onlyTabIds) : null;
    const tabIds = this.getConnectedTabs().filter((id) => !only || only.has(id));
    return Promise.all(
      tabIds.map(async (tabId): Promise<TabInfo> => {
        let bound: ReturnType<typeof setTimeout> | undefined;
        try {
          const info = await Promise.race([
            this.queueCommand<{ url?: string; pathname?: string; title?: string }>(
              'getTabInfo',
              {},
              { targetTabId: tabId }
            ),
            new Promise<null>((resolve) => {
              bound = this.armTimer(() => resolve(null), 3000);
            }),
          ]);
          return { tabId, url: info?.url, pathname: info?.pathname, title: info?.title };
        } catch {
          return { tabId };
        } finally {
          this.disarmTimer(bound);
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
      if (now - lastBeat < this.tabActiveWindowMs) return true;
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
   * Re-registration under a DIFFERENT `userId` (e.g. a tab survives a
   * re-login) is permitted ONLY when the new user is AUTH-PROVEN, not
   * merely asserted. `metadata.userId` rides in the (browser-supplied)
   * heartbeat body and is therefore untrusted on its own: without a
   * proof gate, anyone who learns a victim's `tabId` could POST a
   * heartbeat claiming any `userId` and silently seize ownership of the
   * tab (and with it the ability to drive it / settle its commands).
   *
   * `options.callerUserId` is the identity the consumer's auth gate
   * proved and injected as `X-Caller-User-Id` (never a browser value).
   * The rule:
   *
   *   - Same-owner heartbeat (existing owner === claimed userId): always
   *     a refresh — `sessionId`/`lastSeen` updated in place. No proof
   *     needed; you already hold the tab and the claim matches.
   *   - TRANSFER (a DIFFERENT user already owns the tab): the claimed
   *     `userId` MUST be auth-proven and equal to `callerUserId`. An
   *     unauthenticated (`callerUserId` absent) or mismatched claim is
   *     REFUSED and the prior owner is left untouched — this is the
   *     takeover primitive being closed. A genuine re-login carries the
   *     new user's proven identity and therefore still transfers, once
   *     the previous owner's own heartbeats for the tab have stopped for
   *     `tabActiveWindowMs` (`OWNER_SESSION_LIVE` until then).
   *   - First CLAIM (tab has no owner yet — bootstrap): honored, so a
   *     header-less / single-trust-domain deployment can still register
   *     tabs. A *present* proven identity must still match the claimed
   *     `userId` (you cannot bootstrap a tab under an identity you
   *     cannot back).
   *
   * Returns whether ownership was (re)assigned so the HTTP layer can
   * surface the refusal without bricking the heartbeat loop.
   */
  recordRegistration(
    tabId: string,
    metadata: { userId: string; sessionId: string },
    options?: { callerUserId?: string | null }
  ): {
    ownershipAssigned: boolean;
    rejectedReason?: 'OWNER_CHANGE_UNVERIFIED' | 'OWNER_SESSION_LIVE';
  } {
    const now = Date.now();
    const proven = options?.callerUserId;

    // Proof-vs-claim: the browser-asserted `metadata.userId` may never
    // differ from the auth-proven caller. This is checked FIRST so it also
    // covers a same-owner "refresh" spoof — an attacker proving `mallory`
    // but claiming `userId: alice` (the current owner) to overwrite her
    // session must not slip through the refresh branch below. Absent proof
    // (header-less deployment) skips this — see the transfer guard.
    if (proven != null && proven !== metadata.userId) {
      return { ownershipAssigned: false, rejectedReason: 'OWNER_CHANGE_UNVERIFIED' };
    }

    const existing = this.tabOwnership.get(tabId);
    if (existing && existing.userId === metadata.userId) {
      existing.sessionId = metadata.sessionId;
      existing.lastSeen = now;
      return { ownershipAssigned: true };
    }

    if (existing) {
      // TRANSFER of an already-owned tab. Given the proof-vs-claim check
      // above, a present proof already equals the claimed userId; the only
      // remaining refusal is an UNAUTHENTICATED transfer (no proof at all),
      // which is the takeover primitive — refuse, prior owner stands.
      if (proven == null) {
        return { ownershipAssigned: false, rejectedReason: 'OWNER_CHANGE_UNVERIFIED' };
      }
      // A proven identity still may not take a tab from an owner whose
      // session is live: the owner's own heartbeat for this tab arrived within
      // the active window. A re-login in the same tab stops the previous
      // owner's heartbeats, so the new owner takes over once they go quiet.
      if (now - existing.lastSeen < this.tabActiveWindowMs) {
        return { ownershipAssigned: false, rejectedReason: 'OWNER_SESSION_LIVE' };
      }
    }
    // First claim / bootstrap: allowed (a present proof already backs the
    // claimed userId via the check above; absent proof bootstraps a tab in
    // a header-less deployment) — unless it contradicts the verified user the
    // tab is already streaming to. Before it registers, a tab is the stream
    // opener's, as `openCommandStream` rules for a second stream.
    if (!existing) {
      const streamUserId = this.tabListeners.get(tabId)?.userId;
      if (streamUserId !== undefined && streamUserId !== metadata.userId) {
        return { ownershipAssigned: false, rejectedReason: 'OWNER_CHANGE_UNVERIFIED' };
      }
    }

    this.tabOwnership.set(tabId, {
      userId: metadata.userId,
      sessionId: metadata.sessionId,
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
    });
    return { ownershipAssigned: true };
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
   * Includes both SSE and WebSocket transports, and a dead SSE slot
   * (stream-slot.ts): the owner-scoped dispatch arm draws from this list and
   * parks a command on the slot, ranked behind every live tab. A reader that
   * answers "connected" intersects it with `connectedTabs`. Result order
   * tracks the listener map (insertion order) for stability.
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
   * The tab `userId`'s unpinned command reaches: the first of their own tabs
   * that holds an open transport, in the order the owner-scoped dispatch arm
   * ranks them (`compareByLiveness`, tab-liveness.ts), or `null` when none
   * does. A dead slot (stream-slot.ts) is never the primary: its stream is
   * gone. A command the arm parks on one ranked first reaches this tab unless
   * the slot's own tab reconnects within the grace. The one source of a scoped
   * caller's primary: the scoped `getTransportDiagnostics` `primaryTabId`, and
   * `isPrimary` in `/tabs` and `/tabs/wait` (nextjs.ts).
   */
  ownedPrimaryTabId(userId: string): string | null {
    return this.rankOwnedTabs(userId).find((id) => this.holdsOpenTransport(id)) ?? null;
  }

  /** Whether `tabId` holds an open command transport here: an open SSE listener, or a connected WebSocket client. */
  private holdsOpenTransport(tabId: string): boolean {
    const listener = this.tabListeners.get(tabId);
    if (listener !== undefined && isOpenListener(listener)) return true;
    return this.wsClients.get(tabId)?.client.isConnected() === true;
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
    for (const id of this.openListenerIds()) {
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
    const open = this.openListenerIds();
    const full: TransportDiagnostics = {
      pendingCommandCount: this.pendingCommands.size,
      pendingCommandIds: Array.from(this.pendingCommands.keys()),
      // Union of both command transports — see `TransportDiagnostics`.
      // A tab reachable over BOTH SSE and WS counts once; a dead slot not at all.
      commandListenerCount: new Set([...open, ...this.wsClients.keys()]).size,
      connectedTabs: open,
      activeTabs: this.getActiveTabs(),
      parkedTabs: Array.from(this.tabListeners.values())
        .filter((listener) => !isOpenListener(listener))
        .map((listener) => listener.tabId),
      primaryTabId: this.getPrimaryTabId(),
      demotedTabs: Array.from(this.demotedTabs),
      buildId: this.buildId,
      wsClientCount: this.wsClients.size,
      wsClientIds: Array.from(this.wsClients.keys()),
      tabHeartbeats: Object.fromEntries(this.tabHeartbeats),
      tabMetadata: Object.fromEntries(this.tabMetadata),
      tabOwnership: Object.fromEntries(this.tabOwnership),
      tabActiveWindowMs: this.tabActiveWindowMs,
      zombieTransportMs: this.zombieTransportMs,
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
      buildId: full.buildId,
      tabActiveWindowMs: full.tabActiveWindowMs,
      zombieTransportMs: full.zombieTransportMs,

      // Command ids are NOT attributable to a tab/owner, so they cannot be
      // filtered — and handing them to a foreign caller lets them settle
      // someone else's command via `POST /commands`. Withheld entirely
      // from the per-user view.
      pendingCommandIds: [],

      // Per-user view: tab-identifying fields, filtered through isOwnedBy.
      connectedTabs,
      activeTabs: full.activeTabs.filter(owns),
      parkedTabs: full.parkedTabs.filter(owns),
      demotedTabs: full.demotedTabs.filter(owns),
      wsClientIds,
      // Same union as the unfiltered view, restricted to this caller's tabs.
      // Previously `connectedTabs.length` (owned SSE tabs), which both
      // dropped WebSocket transports and re-used a tab count under a name
      // that promises a transport count.
      commandListenerCount: new Set([...connectedTabs, ...wsClientIds]).size,
      wsClientCount: wsClientIds.length,
      // Where this caller's unpinned command goes (the owner-scoped arm), not
      // the global primary: that one is chosen over every user's tabs, and a
      // scoped caller's command never reads it.
      primaryTabId: this.ownedPrimaryTabId(userId),
      tabHeartbeats: pickOwned(full.tabHeartbeats),
      tabMetadata: pickOwned(full.tabMetadata),
      tabOwnership: pickOwned(full.tabOwnership),
    };
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

  /**
   * Tear the relay down. Relay state is shared by every relay on the same
   * `globalPrefix`, so this acts prefix-wide, as it always has for the tab
   * maps. After it returns:
   *
   * - The prefix's cleanup sweep is cleared and its `globalThis` handle
   *   deleted, whichever relay armed it, so no interval is left running. The
   *   next relay built on the prefix, or the next transport registered on any
   *   relay of it (this one included), re-arms it.
   * - Every WebSocket client's warm-up timer is cleared and the clients are
   *   forgotten. With a cross-instance bus, each one's bus command
   *   subscription is dropped and its tab withdrawn from the shared presence
   *   registry. The sockets are NOT closed: the transport owner (the
   *   standalone server's connection set, a host's WS handler) owns them.
   * - Every SSE listener is forgotten. With a cross-instance bus, each one's
   *   bus command subscription is dropped and its tab removed from the shared
   *   presence registry. The streams themselves belong to their HTTP handlers.
   * - Every pending command (fire-and-forget recorders included) is settled
   *   with a {@link RelayDestroyedError}: its timeout and grace timers are
   *   cleared and its bus response subscription dropped. Every caller waiting
   *   for a transport fails the same way, and so does a command suspended at
   *   an `await` in `queueCommand` (a bus presence lookup, a connection wait)
   *   when it resumes, instead of dispatching. A command that fails over
   *   after being settled here does not fail over.
   * - The SSE warm-up timers and the tab-info probe bounds are cleared, and
   *   the bus deliveries, tab registries and change-event buffer are emptied.
   * - The connection gate is closed, so the next command waits for a
   *   transport to connect.
   *
   * A transport registered on the relay afterwards is live, and its timers
   * belong to it. The bus itself is not closed: its owner passed it in.
   */
  destroy(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    // First, so a dispatch resuming from any `await` below sees it.
    g[`${this.prefix}DestroyEpoch`] = this.destroyEpoch + 1;
    // Whatever sweep the prefix holds now, not the handle this relay last
    // saw: the teardown below is prefix-wide, and a sweep re-armed by a later
    // registration (on this relay or a sibling) would otherwise outlive it.
    const intervalKey = `${this.prefix}CleanupInterval`;
    const sweep = g[intervalKey] as ReturnType<typeof setInterval> | undefined;
    if (sweep) clearInterval(sweep);
    delete g[intervalKey];

    for (const clientId of Array.from(this.wsClients.keys())) this.dropWebSocketEntry(clientId);

    for (const id of Array.from(this.pendingCommands.keys())) {
      this.settlePending(id, new RelayDestroyedError());
    }
    this.busDeliveries.clear();

    for (const waiter of Array.from(this.connectionWaiters)) {
      clearTimeout(waiter.timer);
      waiter.fail(
        new RelayDestroyedError(
          'CommandRelay was destroyed while waiting for a browser to connect.'
        )
      );
    }
    this.connectionWaiters.clear();

    for (const timer of this.relayTimers) clearTimeout(timer);
    this.relayTimers.clear();

    this.tabHeartbeats.clear();
    this.tabMetadata.clear();
    this.tabLastSuccess.clear();
    this.tabOwnership.clear();
    this.demotedTabs.clear();
    for (const listener of this.tabListeners.values()) {
      // A failing bus must not stop the teardown.
      try {
        listener.releaseBus?.();
      } catch (err) {
        console.error('[ui-bridge] releasing a listener from the bus failed:', err);
      }
    }
    this.tabListeners.clear();
    this.listenerTombstones.clear();
    this.warmedUpTabs.clear();
    // `tabGenerationSeq` is deliberately left as it is: see its field.
    this.tabGenerations.clear();
    this.changeEventBuffer.length = 0;
    this.changeEventSubscribers.clear();
    // Every transport is gone, so the next command waits for one to connect.
    this.resetConnectionGateIfEmpty();
  }
}
