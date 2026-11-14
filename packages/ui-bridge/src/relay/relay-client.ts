/**
 * `startRelayClient` — framework-free SDK command-relay client
 *
 * The SSE-receive + execute + result-POST + heartbeat loop, lifted out of
 * `react/useCommandRelay.ts` so it can run in any browser context with no
 * React dependency — notably the injected runtime bundle (`injected/`), which
 * has no component tree to host a hook.
 *
 * `useCommandRelay` is now a thin React wrapper that owns the
 * `BridgeAccess`/registry wiring and the localhost phone-home registration,
 * then delegates the transport loop to this function inside a `useEffect`.
 * Both consumers share one implementation, so a relay-protocol change lands
 * in exactly one place.
 *
 * Wire contract:
 *   1. SSE  GET  `{basePath}/commands/stream?tabId=&caps=rotate,dedupe&cid=`
 *                (fetch-streaming)
 *   2. exec      `execute(action, payload)` — once per dedupe key
 *   3. POST      `{basePath}/commands`   — result envelope, naming the stream
 *                the command arrived on; a repeat delivery is answered too
 *                while the command's outcome is kept (`command-dedupe.ts`)
 *   4. POST      `{basePath}/heartbeat`  — every `heartbeatIntervalMs`
 *
 * Stream lifecycle (plan
 * `2026-11-09-a-dead-relay-tab-stays-the-operators-primary-and-a-command-sent-during-a-stream-reopen-is-lost`,
 * D4). `caps` declares that this client follows a relay's `rotate` frame and
 * dedupes a redelivered command; `cid` names this page instance (see
 * `command-dedupe.ts`). A relay that predates them ignores both.
 *
 * - A stream that received `connected` and lived {@link HEALTHY_STREAM_MIN_MS}
 *   is reopened at once when it ends; one that failed sooner waits
 *   `SSE_RECONNECT_DELAY_MS`. The exception is a stream its relay asked to
 *   rotate and then ended: it reopens at the open floor (see
 *   {@link HEALTHY_STREAM_MIN_MS}), even if it never connected.
 * - A `rotate` frame opens the next stream before the current one ends
 *   (make-before-break), once the current one has been connected
 *   {@link HEALTHY_STREAM_MIN_MS}. The replaced stream drains: it is read to
 *   its EOF, or, if its relay never ends it, aborted once its replacement
 *   has connected and the frame's `graceMs` (counted from the frame, at most
 *   60 s) has run out. At most one stream drains at a time, so a relay can
 *   hold at most two open.
 * - A replacement that fails before its `connected` hands the tab back to the
 *   stream it was replacing, which its relay still holds.
 *
 * `X-UI-Bridge-Tab-Key` rides on all three when an injector published a tab
 * key AND `basePath` is loopback; none of them is sent from an opaque-origin
 * (`"null"`) document.
 *
 * `Authorization: Bearer <token>` rides on all three requests when
 * `authHeader` resolves a token; `registrationMetadata` (the strict per-user
 * tab-scoping envelope) rides on every heartbeat when wired. Both are read
 * fresh on every call so token / sessionId rotation is picked up without
 * restarting the client.
 */

import { registerRelayTrafficBase } from './relay-traffic';
import { createCommandDedupe, dedupeKeyOf } from './command-dedupe';
import { randomUuid } from './random-uuid';
import { safeJsonStringify } from '../core/wire-json';

// SSE reconnection delay after a FAST failure: a refused open, or a stream
// that ended before it was healthy (10s to avoid Next.js route recompilation
// cascades, which fail fast).
const SSE_RECONNECT_DELAY_MS = 10_000;

/**
 * How long a command stream must have lived after its `connected` event to
 * count as healthy. A healthy stream that ends is reopened at once (plus up to
 * `HEALTHY_REOPEN_JITTER_MS`), because a command sent into a 10s gap outlives
 * the relay's answer timeout.
 *
 * It is also the floor between the streams the client opens on its own. A
 * reopen after a stream ends, and the replacement a `rotate` frame asks for,
 * each come at least this long after the previous open, and a rotation also
 * waits until the stream it replaces has been connected this long (a `rotate`
 * frame that arrives before `connected` waits for it). So those opens are
 * capped at 6 per tab per minute, the cadence the relay's stream lane is
 * sized for, whatever the relay does. Two opens are not floored: a call to
 * `forceReconnect` (the heartbeat's `tabRegistered: false` recovery makes
 * one) and a tab coming back into view with no stream open.
 *
 * A numeric literal on purpose, so qontinui-web's bundledNumber can read it
 * out of the bundle (Phase 7 adds that read).
 */
export const HEALTHY_STREAM_MIN_MS = 10_000;

// The most a healthy reopen is delayed by, chosen at random per reopen, so the
// tabs whose streams one relay instance ends together do not reopen together.
const HEALTHY_REOPEN_JITTER_MS = 250;

// How long a replaced stream may still be read when its `rotate` frame names
// no grace. Like a named grace, it is counted from the frame's arrival, so the
// time spent waiting to rotate is part of it. Once it has run out and the
// stream's replacement has connected, the stream is aborted, so a relay that
// never ends it cannot keep it open past that. Until the replacement connects
// (or fails, which hands the tab back), the stream is held, however long ago
// the grace ran out.
const DRAINING_STREAM_DEADLINE_MS = 15_000;

// The longest grace a `rotate` frame can buy the stream it replaces; a longer
// one is held to this.
const MAX_DRAINING_GRACE_MS = 60_000;

// What every command stream declares: it follows a `rotate` frame, and it
// dedupes a redelivered command.
const STREAM_CAPABILITIES = 'rotate,dedupe';

// Heartbeat interval.
//
// This is the REQUESTED period, not a guaranteed one: it is a plain
// `setInterval`, and browsers throttle timers in backgrounded tabs. Chrome's
// intensive throttling clamps them to roughly ONE FIRING PER MINUTE, so a
// hidden-but-perfectly-healthy tab beats every ~60s, not every 10s.
//
// The server MUST NOT treat heartbeat age as transport liveness for that
// reason — see `zombieTransportMs` in `server/command-relay.ts`, which is why
// the relay's destructive prune is gated well above the throttling clamp
// while `tabActiveWindowMs` keeps expressing staleness non-destructively.
const HEARTBEAT_INTERVAL_MS = 10_000;

/** sessionStorage key for the stable per-tab id. */
const TAB_ID_STORAGE_KEY = '__uiBridge_tabId';

/**
 * Resolve the current auth token from the consumer's hook, or `null` if no
 * token is available. Centralizes the null / empty-string / undefined / throw
 * normalization so each transport site doesn't have to repeat it.
 */
export function resolveAuthToken(
  authHeader: (() => string | null | undefined) | undefined
): string | null {
  if (!authHeader) return null;
  try {
    const value = authHeader();
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Produce the headers object for a transport POST, attaching
 * `Authorization: Bearer <token>` when a token is resolved.
 */
export function transportHeaders(
  authHeader: (() => string | null | undefined) | undefined
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = resolveAuthToken(authHeader);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Parse the `data:` payload out of a single SSE event block — the text
 * between `\n\n` delimiters. Returns the concatenated data string, or `null`
 * for blocks with no data field (e.g. `: heartbeat` keep-alive comments).
 * Mirrors the WhatWG SSE semantics for the fields the command stream uses:
 * `data:` lines are kept (one optional leading space stripped); `:` comment
 * lines and `event:`/`id:`/`retry:` lines are ignored.
 */
export function parseSSEDataBlock(block: string): string | null {
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    let value = line.slice(5);
    if (value.startsWith(' ')) value = value.slice(1);
    dataLines.push(value);
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

/** A parsed `data:` payload off the command stream: a control frame or a command. */
type StreamFrame = {
  type?: unknown;
  streamId?: unknown;
  graceMs?: unknown;
} & Partial<QueuedCommand>;

/**
 * Read an SSE body to its end, handing each event block's parsed `data:`
 * payload to `onFrame`. Stops early, releasing the body, when `onFrame`
 * returns `'end'`: the relay's own end frame is a normal EOF. A block that
 * does not parse, or whose handler throws, is reported and skipped. Rejects
 * when the read itself fails (an abort, a network drop).
 */
async function readSSEFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: StreamFrame) => 'end' | void,
  onError: (message: string, error?: unknown) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = parseSSEDataBlock(block);
      if (data == null) continue;
      let verdict: 'end' | void;
      try {
        verdict = onFrame(JSON.parse(data));
      } catch (e) {
        onError('[UIBridge] Failed to parse SSE message:', e);
        continue;
      }
      if (verdict === 'end') {
        reader.cancel().catch(() => {});
        return;
      }
    }
  }
}

/**
 * Resolve the current registration metadata from the consumer's hook. Returns
 * the live `{userId, sessionId}` shape ONLY when both fields are non-empty
 * strings; any other shape (null / partial / non-string) is normalized to
 * `null` so the heartbeat doesn't ship a half-valid envelope the strict server
 * would reject anyway. Defensive against throwing hooks for the same reason
 * `resolveAuthToken` is.
 */
export function resolveRegistrationMetadata(
  hook: (() => { userId: string; sessionId: string } | null | undefined) | undefined
): { userId: string; sessionId: string } | null {
  if (!hook) return null;
  try {
    const value = hook();
    if (!value || typeof value !== 'object') return null;
    const userId = (value as { userId?: unknown }).userId;
    const sessionId = (value as { sessionId?: unknown }).sessionId;
    if (typeof userId !== 'string' || userId.trim().length === 0) return null;
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) return null;
    return { userId: userId.trim(), sessionId: sessionId.trim() };
  } catch {
    return null;
  }
}

/** Write the resolved tab id to `sessionStorage`, best-effort. */
function persistTabId(tabId: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(TAB_ID_STORAGE_KEY, tabId);
    }
  } catch {
    /* SSR or quota */
  }
}

/**
 * Read the CALLER-OWNED tab-id pin published on THIS document, if any.
 *
 * Two publication points, both re-evaluated per document:
 *   - `window.__uiBridgeTabId` — the framework-agnostic pin.
 *   - `window.__uiBridgeInjectedConfig.tabId` — what `ui-bridge-inject
 *     --tab-id <id>` sets (the wrapper registers it via Playwright's
 *     `BrowserContext.addInitScript`, which re-runs on EVERY navigation in
 *     the context, cross-origin ones included).
 *
 * This is what makes a pin survive an origin change: `sessionStorage` is
 * partitioned per-origin, so it CANNOT carry an id across an OAuth hop —
 * the pin, republished on each document, can.
 */
function readPinnedTabId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const w = window as unknown as {
      __uiBridgeTabId?: unknown;
      __uiBridgeInjectedConfig?: { tabId?: unknown };
    };
    const explicit = w.__uiBridgeTabId;
    if (typeof explicit === 'string' && explicit.length > 0) return explicit;
    const injected = w.__uiBridgeInjectedConfig?.tabId;
    if (typeof injected === 'string' && injected.length > 0) return injected;
  } catch {
    /* hostile global / cross-realm access */
  }
  return null;
}

/**
 * Read the injector's tab key published on THIS document, if any.
 *
 * `ui-bridge-inject --tab-id` generates a random key once per launch and
 * publishes it as `window.__uiBridgeInjectedConfig.tabKey` beside the pinned
 * id, on every document. A pinned tab spans origins by design (an OAuth hop),
 * so the runner cannot bind it to an origin; it binds it to the key instead
 * (trust on first use). Only the injector process knows the key, so a page
 * that learns the pinned id still cannot attach as that tab.
 *
 * Never persisted: it lives only in the injected global, so no storage
 * artifact can capture it.
 */
function readPinnedTabKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const injected = (window as unknown as { __uiBridgeInjectedConfig?: { tabKey?: unknown } })
      .__uiBridgeInjectedConfig?.tabKey;
    if (typeof injected === 'string' && injected.length > 0) return injected;
  } catch {
    /* hostile global / cross-realm access */
  }
  return null;
}

/** Header the runner reads a pinned tab's key from. */
const TAB_KEY_HEADER = 'X-UI-Bridge-Tab-Key';

/**
 * The three spellings of the loopback interface a browser can put in a URL —
 * the same set the runner's origin guard treats as loopback.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether `basePath` resolves (against this document) to a loopback host. The
 * tab key is a credential for the LOCAL runner only; a remote SDK relay (e.g.
 * `https://qontinui.io/api/ui-bridge`) must never see it, and a custom header
 * would also widen that relay's CORS preflight.
 */
export function isLoopbackBase(basePath: string): boolean {
  try {
    const href = typeof window !== 'undefined' ? window.location.href : undefined;
    const url = href ? new URL(basePath, href) : new URL(basePath);
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Whether this document has an opaque origin (`location.origin === "null"`):
 * the pre-`goto` `about:blank` document an injector attaches to, a sandboxed
 * iframe, a `data:` URL. The runner refuses every relay request from such a
 * document (`UIB_OPAQUE_ORIGIN`), so the client does not send them.
 */
function isOpaqueOrigin(): boolean {
  try {
    return typeof window !== 'undefined' && window.location.origin === 'null';
  } catch {
    return false;
  }
}

/**
 * Resolve a stable per-tab id. Precedence:
 *
 *   1. A caller-owned pin published on this document ({@link readPinnedTabId}).
 *      Checked FIRST and on every document, so a pinned id survives a
 *      cross-origin navigation (an OAuth hop) instead of being silently
 *      replaced by a freshly minted per-origin uuid — which invalidated the
 *      id the caller had been handed and was addressing the tab by.
 *   2. The `sessionStorage` entry (per-origin, per-tab) — so an embedded app
 *      and a relay client in the same document agree on the id.
 *   3. A fresh v4 uuid ({@link randomUuid}, which also works on a non-secure
 *      page), persisted for (2).
 *
 * The resolved id is written back to `sessionStorage` in all three cases, so
 * everything in the document converges on it. Falls back to a non-persisted
 * uuid when `sessionStorage` is unavailable (SSR / quota / sandboxed contexts).
 */
export function resolveTabId(): string {
  const pinned = readPinnedTabId();
  if (pinned) {
    // Republish the caller's pin into this origin's sessionStorage so a
    // late-starting embedded hook in the same document adopts it too.
    persistTabId(pinned);
    return pinned;
  }

  let stored: string | null = null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      stored = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
    }
  } catch {
    /* access denied */
  }
  if (stored) return stored;
  const fresh = randomUuid();
  persistTabId(fresh);
  return fresh;
}

/** Command frame as delivered over the SSE stream. */
interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp?: number;
  /** On a relay's redelivered alias: the id of the command it re-sends. */
  redeliveryOf?: string;
}

/** What one execution of a command produced: every delivery of it is answered with this. */
interface CommandOutcome {
  ok: boolean;
  result: unknown;
}

/** One command stream a client opened, and what it has learned about itself. */
interface CommandStream {
  readonly controller: AbortController;
  /** Whether a `rotate` frame opened it, to replace the stream now draining. */
  readonly replacing: boolean;
  /** Its id, from its own `connected` event. */
  id?: string;
  /** When its `connected` event arrived. */
  connectedAt?: number;
  /**
   * Its relay's request to replace it: when the `rotate` frame arrived, and
   * the grace it named. Set from that frame on: while the rotation waits,
   * and still while the stream drains after its replacement opens. Cleared
   * only when a failed replacement hands the stream back. While it is set and
   * the stream is current, an end of this stream is its relay's own close,
   * not a failure.
   */
  rotation?: { requestedAt: number; graceMs: number };
}

/**
 * How long a stream a `rotate` frame replaces may still be read, counted from
 * the frame: the `graceMs` it names (at most `MAX_DRAINING_GRACE_MS`), or
 * `DRAINING_STREAM_DEADLINE_MS` when it names none usable.
 */
function drainingGraceMs(graceMs: unknown): number {
  if (typeof graceMs !== 'number' || !Number.isFinite(graceMs) || graceMs < 0) {
    return DRAINING_STREAM_DEADLINE_MS;
  }
  return Math.min(graceMs, MAX_DRAINING_GRACE_MS);
}

/** Configuration for {@link startRelayClient}. */
export interface RelayClientConfig {
  /** Base path for UI Bridge API routes (e.g. `/api/ui-bridge`). Required. */
  basePath: string;
  /**
   * Command dispatcher. Receives the relay action id + payload and returns
   * the result (or a `{ success: false }` envelope). For embedded apps this
   * is `(a, p) => executeCommand(a, p, bridge)`; injected mode passes the same.
   */
  execute: (action: string, payload: unknown) => Promise<unknown> | unknown;
  /** Stable per-tab id. Defaults to {@link resolveTabId}. */
  tabId?: string;
  /**
   * Pinned tab key sent as `X-UI-Bridge-Tab-Key` to a loopback `basePath`
   * only. Defaults to `__uiBridgeInjectedConfig.tabKey` on this document.
   */
  tabKey?: string;
  /** Heartbeat interval in ms (default 10000). */
  heartbeatIntervalMs?: number;
  /** Auth-token hook — see {@link resolveAuthToken}. */
  authHeader?: () => string | null | undefined;
  /** Strict per-user tab-scoping metadata hook — see {@link resolveRegistrationMetadata}. */
  registrationMetadata?: () => { userId: string; sessionId: string } | null | undefined;
  /** App classification reported on heartbeats. */
  appType?: string;
  /** Capability tags reported on heartbeats. */
  capabilities?: string[];
  /** Stable app id reported on heartbeats. */
  appId?: string;
  /** Display name reported on heartbeats. */
  appName?: string;
  /** Framework hint reported on heartbeats. */
  framework?: string;
  /** SDK / app version reported on heartbeats. */
  version?: string;
  /**
   * Optional logger for non-fatal transport errors. Defaults to
   * `console.error`. Pass a no-op to silence (injected mode forwards page
   * console to the driver, so the default is usually what you want).
   */
  onError?: (message: string, error?: unknown) => void;
}

/** Handle returned by {@link startRelayClient}. */
export interface RelayClientHandle {
  /** The tab id this client registered under. */
  readonly tabId: string;
  /**
   * The id of the CURRENT command stream, from its own `connected` event, or
   * `undefined` until that arrives. While a replaced stream is still being
   * read, this is its replacement's id.
   */
  readonly streamId: string | undefined;
  /** Force every open SSE stream to close and immediately reconnect. */
  forceReconnect(): void;
  /** Tear down every SSE stream + the heartbeat loop. Idempotent. */
  stop(): void;
}

/**
 * Start the relay client: open the SSE command stream, execute inbound
 * commands, POST results, and beat a heartbeat. Returns a handle to stop it.
 *
 * Framework-agnostic — no React, no DOM-mount assumptions beyond `fetch`,
 * `TextDecoder`, `AbortController`, and (for the visibility-reconnect)
 * `document`. Safe to call from an injected init-script once the page realm
 * exists.
 */
export function startRelayClient(config: RelayClientConfig): RelayClientHandle {
  const {
    basePath,
    execute,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    authHeader,
    registrationMetadata,
    appType,
    capabilities,
    appId,
    appName,
    framework,
    version,
    onError = (message: string, error?: unknown) => console.error(message, error),
  } = config;
  // The relay's own traffic: a tracker the dispatcher creates ignores it.
  registerRelayTrafficBase(basePath);
  // An explicit `config.tabId` IS a caller-owned pin — persist it so an
  // embedded hook that later calls `resolveTabId()` in this same document
  // adopts it rather than minting a competing id.
  const tabId = config.tabId ?? resolveTabId();
  if (config.tabId) persistTabId(config.tabId);
  // The tab key rides only to a loopback relay (the local runner); see
  // `isLoopbackBase`. Resolved once: the injector republishes it on every
  // document, and each document starts its own client.
  const tabKey = config.tabKey ?? readPinnedTabKey();
  const tabKeyHeader: Record<string, string> =
    tabKey && isLoopbackBase(basePath) ? { [TAB_KEY_HEADER]: tabKey } : {};
  const postHeaders = (): Record<string, string> => ({
    ...transportHeaders(authHeader),
    ...tabKeyHeader,
  });

  let stopped = false;
  // The newest stream: the one a rotation or a reconnect replaces, and whose
  // id the handle reports. A command's result never reads it: each result
  // carries the id of the stream its command arrived on, so the relay can hold
  // the result to that stream.
  let current: CommandStream | null = null;
  // The stream a rotation replaced, still read to its EOF; the stream that
  // replaced it; whether its grace has run out; and the timer that records
  // that and aborts it then, if its relay never ends it and its replacement
  // has connected. There is at most one. While the replacement neither
  // connects nor fails, the hold is bounded by the relay (which ends a
  // stream it replaced) and the platform, not by this client.
  let draining: {
    stream: CommandStream;
    replacement: CommandStream;
    graceSpent: boolean;
    deadline: ReturnType<typeof setTimeout>;
  } | null = null;
  // A rotation the relay asked for before the current stream was healthy,
  // waiting until it is.
  let pendingRotation: ReturnType<typeof setTimeout> | null = null;
  // When the newest stream was opened: the floor every scheduled open waits on.
  let lastOpenAt: number | undefined;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  // This page instance. Its id rides on every stream GET, and its memory of
  // the commands it ran is what lets a relay redeliver into it safely.
  const outcomes = createCommandDedupe<CommandOutcome>();
  const clientInstanceId = randomUuid();
  const streamUrl =
    `${basePath}/commands/stream?` +
    (tabId ? `tabId=${encodeURIComponent(tabId)}&` : '') +
    `caps=${STREAM_CAPABILITIES}&cid=${encodeURIComponent(clientInstanceId)}`;

  // ----- Response sender -----
  const sendResponse = async (
    commandId: string,
    ok: boolean,
    result: unknown,
    fromStream: string | undefined
  ) => {
    if (isOpaqueOrigin()) return;
    try {
      await fetch(`${basePath}/commands`, {
        method: 'POST',
        headers: postHeaders(),
        body: safeJsonStringify({
          commandId,
          success: ok,
          result,
          tabId,
          streamId: fromStream,
          error: ok ? undefined : (result as { error?: string })?.error,
        }),
      });
    } catch (e) {
      onError('[UIBridge] Failed to send command response:', e);
    }
  };

  // ----- Command processor -----
  // Run one command, and turn whatever it produced (a thrown error included)
  // into the envelope every delivery of it is answered with.
  const runCommand = async (command: QueuedCommand): Promise<CommandOutcome> => {
    try {
      const result = await execute(command.action, command.payload as Record<string, unknown>);
      const resultObj = result as { success?: boolean };
      return { ok: !(resultObj && resultObj.success === false), result };
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      let errorCode = 'UNKNOWN_ERROR';
      if (errorMessage.includes('not found')) errorCode = 'ELEMENT_NOT_FOUND';
      else if (errorMessage.includes('timeout')) errorCode = 'ACTION_TIMEOUT';
      else if (errorMessage.includes('Unknown command')) errorCode = 'UNKNOWN_COMMAND';
      return {
        ok: false,
        result: {
          success: false,
          error: errorMessage,
          failureDetails: { errorCode, message: errorMessage, timestamp: Date.now() },
          durationMs: 0,
          timestamp: Date.now(),
        },
      };
    }
  };

  // `fromStream` is the stream the command arrived on; its result names that
  // stream even if the connection has been reopened or rotated since.
  const processCommand = async (command: QueuedCommand, fromStream: string | undefined) => {
    // A command read after `stop()` (its bytes were already on the wire) is
    // not run: the client is being torn down.
    if (stopped) return;
    // One page instance runs one command once, however many streams carried
    // it. A repeat delivery is answered, under its own id and stream, with
    // that run's outcome while the outcome is kept. After that it is neither
    // run nor answered (see `command-dedupe.ts`).
    const outcome = outcomes.outcomeOf(dedupeKeyOf(command), () => runCommand(command));
    if (!outcome) return;
    const { ok, result } = await outcome;
    // The client stopped while the command ran: it sends nothing more.
    if (stopped) return;
    await sendResponse(command.commandId, ok, result, fromStream);
  };

  // ----- SSE connection -----
  const cancelReconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  const cancelPendingRotation = () => {
    if (pendingRotation) {
      clearTimeout(pendingRotation);
      pendingRotation = null;
    }
  };

  /** Stop reading the stream a rotation replaced, if one is still open. */
  const endDraining = () => {
    if (!draining) return;
    clearTimeout(draining.deadline);
    draining.stream.controller.abort();
    draining = null;
  };

  /** Abort every open stream: the current one and a replaced one still read. */
  const closeStreams = () => {
    cancelPendingRotation();
    endDraining();
    current?.controller.abort();
    current = null;
  };

  /** How long until the next scheduled open: HEALTHY_STREAM_MIN_MS after the last one. */
  const untilOpenFloor = () =>
    lastOpenAt === undefined ? 0 : Math.max(0, lastOpenAt + HEALTHY_STREAM_MIN_MS - Date.now());

  const scheduleReconnect = (delayMs: number) => {
    if (stopped) return;
    if (reconnectTimeout) return; // already scheduled
    reconnectTimeout = setTimeout(
      () => {
        reconnectTimeout = null;
        if (!stopped) connect('replace');
      },
      Math.max(delayMs, untilOpenFloor())
    );
  };

  /**
   * Open the replacement `stream`'s relay asked for (`stream.rotation`), make-
   * before-break. `stream` then drains: it is read to its EOF, or aborted once
   * its replacement has connected and the grace its relay named, counted from
   * the `rotate` frame, has run out. A stream still draining from an earlier
   * rotation is aborted first, so a relay that rotates without ending streams
   * holds at most two open.
   */
  const replace = (stream: CommandStream) => {
    const rotation = stream.rotation;
    if (stopped || current !== stream || !rotation) return;
    endDraining();
    const replacement = connect('rotate');
    if (!replacement) return;
    // The deadline records that the grace is spent; that record, not the
    // clock, is what the replacement's `connected` reads. Make-before-break
    // even when the grace is already spent: the stream is held until its
    // replacement connects (whose `connected` then ends it) or fails (which
    // hands the tab back to it).
    const deadline = setTimeout(
      () => {
        if (draining?.stream !== stream) return;
        draining.graceSpent = true;
        if (replacement.connectedAt !== undefined) endDraining();
      },
      Math.max(0, rotation.requestedAt + rotation.graceMs - Date.now())
    );
    draining = { stream, replacement, graceSpent: false, deadline };
  };

  /**
   * Schedule the replacement the current `stream`'s relay asked for. It waits
   * until `stream` has been connected HEALTHY_STREAM_MIN_MS, and until that
   * long after the last open. A request that came before `stream`'s
   * `connected` waits for it: the `connected` branch calls this again.
   */
  const scheduleRotation = (stream: CommandStream) => {
    if (pendingRotation || !stream.rotation || stream.connectedAt === undefined) return;
    const wait = Math.max(
      untilOpenFloor(),
      stream.connectedAt + HEALTHY_STREAM_MIN_MS - Date.now()
    );
    if (wait > 0) {
      pendingRotation = setTimeout(() => {
        pendingRotation = null;
        replace(stream);
      }, wait);
    } else {
      replace(stream);
    }
  };

  /**
   * Open a command stream and make it the current one, returning it (null
   * when none is opened). `'rotate'` leaves the current stream open (it is
   * draining by then); `'replace'` aborts it.
   */
  const connect = (mode: 'replace' | 'rotate'): CommandStream | null => {
    if (stopped) return null;
    // An opaque-origin document is refused by the runner and is about to be
    // replaced by the navigation; the real document starts its own client.
    if (isOpaqueOrigin()) return null;
    cancelReconnect();
    cancelPendingRotation();
    if (mode === 'replace') current?.controller.abort();
    // This stream's own id and age. A command read off it is answered with
    // `stream.id`, whichever stream is current by then.
    const stream: CommandStream = {
      controller: new AbortController(),
      replacing: mode === 'rotate',
    };
    current = stream;
    lastOpenAt = Date.now();

    const onFrame = (frame: StreamFrame): 'end' | void => {
      if (frame.type === 'connected') {
        stream.id = typeof frame.streamId === 'string' ? frame.streamId : undefined;
        stream.connectedAt = Date.now();
        // The stream this one replaced was held for it; if its deadline has
        // recorded the grace as spent, it goes now.
        if (draining?.replacement === stream && draining.graceSpent) endDraining();
        // A rotation its relay asked for before this, counted from now.
        if (current === stream) scheduleRotation(stream);
        return;
      }
      // Throttle-immune heartbeat clock: arriving bytes are not subject to the
      // background-tab timer clamp, so a hidden tab stays registered on the
      // strength of these alone.
      if (frame.type === 'ping') {
        maybeSendHeartbeat();
        return;
      }
      // The relay is about to end this stream: open its replacement and keep
      // reading this one. Only the current stream rotates, once per request,
      // so a frame on a stream already replaced, or a repeat, opens nothing.
      if (frame.type === 'rotate') {
        if (current === stream && !stream.rotation) {
          stream.rotation = { requestedAt: Date.now(), graceMs: drainingGraceMs(frame.graceMs) };
          scheduleRotation(stream);
        }
        return;
      }
      // The relay's own close, sent just before it ends the stream: an EOF.
      if (frame.type === 'end') return 'end';
      if (frame.commandId && frame.action) {
        void processCommand(frame as QueuedCommand, stream.id);
      }
    };

    // However the stream ended: EOF, an end frame, a refused open, a dropped
    // connection, or an abort.
    const onEnded = () => {
      // A replaced stream ending completes its rotation: its replacement is
      // already open, so nothing reconnects.
      if (draining?.stream === stream) {
        clearTimeout(draining.deadline);
        draining = null;
        return;
      }
      if (current !== stream) return;
      current = null;
      cancelPendingRotation();
      if (stopped || stream.controller.signal.aborted) return;
      // A replacement that failed before its relay announced it hands the tab
      // back to the stream it was replacing, which that relay still holds.
      // The `draining?.replacement === stream` test is defensive: a replacing
      // stream is opened only by `replace()`, which records it as the
      // replacement of the one draining stream at once, and while it is
      // current and unconnected nothing else can replace that record (a
      // rotation of it waits for its `connected`; every other open aborts it
      // first). So `draining`, when set here, is always its own; the test
      // keeps the hand-back to the stream it replaced if that ever changes.
      if (
        stream.replacing &&
        stream.connectedAt === undefined &&
        draining?.replacement === stream
      ) {
        current = draining.stream;
        current.rotation = undefined;
        clearTimeout(draining.deadline);
        draining = null;
        return;
      }
      const healthy =
        stream.connectedAt !== undefined &&
        Date.now() - stream.connectedAt >= HEALTHY_STREAM_MIN_MS;
      // A stream whose relay asked to replace it and then ended it was closed
      // by that relay on purpose, so its end is not a failure, however young
      // the stream: it reopens as soon as the open floor allows.
      const closedByItsRelay = stream.rotation !== undefined;
      scheduleReconnect(
        healthy || closedByItsRelay
          ? Math.floor(Math.random() * (HEALTHY_REOPEN_JITTER_MS + 1))
          : SSE_RECONNECT_DELAY_MS
      );
    };

    const headers: Record<string, string> = { Accept: 'text/event-stream', ...tabKeyHeader };
    const token = resolveAuthToken(authHeader);
    if (token) headers.Authorization = `Bearer ${token}`;

    fetch(streamUrl, {
      method: 'GET',
      headers,
      signal: stream.controller.signal,
      cache: 'no-store',
    })
      .then((resp) => {
        if (!resp.ok || !resp.body) return;
        return readSSEFrames(resp.body, onFrame, onError);
      })
      .catch(() => {
        /* stream read aborted or network drop — fall through to reconnect */
      })
      .then(onEnded);
    return stream;
  };

  const forceReconnect = () => {
    if (stopped) return;
    closeStreams();
    connect('replace');
  };

  const handleVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      // Reconnect immediately if the stream was dropped while hidden.
      if (!current) connect('replace');
    }
    // Do NOT disconnect on hide — automation tools need background access
  };

  // ----- Heartbeat -----
  //
  // `setInterval` alone cannot hold this cadence: browsers clamp timers in
  // hidden tabs to ~1 firing per minute. So the beat is ALSO driven by the
  // server's `ping` events, which arrive as bytes on the open command stream
  // and are therefore not subject to timer throttling. `maybeSendHeartbeat`
  // is the shared entry point both paths go through; it collapses them to a
  // single cadence and prevents overlapping in-flight beats (a heartbeat POST
  // has been measured at 1-8s on a loaded dev server).
  let lastHeartbeatStartedAt = 0;
  let heartbeatInFlight = false;

  const sendHeartbeat = async () => {
    if (heartbeatInFlight || isOpaqueOrigin()) return;
    heartbeatInFlight = true;
    lastHeartbeatStartedAt = Date.now();
    try {
      const body: Record<string, unknown> = {
        timestamp: Date.now(),
        tabId,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        title: typeof document !== 'undefined' ? document.title : undefined,
        visibility: typeof document !== 'undefined' ? document.visibilityState : undefined,
      };
      if (appId !== undefined) body.appId = appId;
      if (appName !== undefined) body.appName = appName;
      if (appType !== undefined) body.appType = appType;
      if (framework !== undefined) body.framework = framework;
      if (capabilities !== undefined) body.capabilities = capabilities;
      if (version !== undefined) body.version = version;
      const meta = resolveRegistrationMetadata(registrationMetadata);
      if (meta !== null) body.registrationMetadata = meta;

      const resp = await fetch(`${basePath}/heartbeat`, {
        method: 'POST',
        headers: postHeaders(),
        body: JSON.stringify(body),
      });
      // Recovery: the server reports whether our tabId is a registered SSE
      // listener. If not (e.g. a silent stream drop), force a full reconnect.
      if (resp.ok) {
        try {
          const data = await resp.json();
          const tabRegistered = data?.tabRegistered ?? data?.data?.tabRegistered ?? null;
          if (tabRegistered === false) forceReconnect();
        } catch {
          /* older server — no recovery payload */
        }
      }
    } catch {
      /* non-fatal */
    } finally {
      heartbeatInFlight = false;
    }
  };

  /**
   * Send a heartbeat unless one was started within the last interval. Called
   * by the (throttleable) timer AND by every server `ping`, so whichever
   * clock is actually running keeps the tab registered.
   */
  const maybeSendHeartbeat = () => {
    if (stopped) return;
    if (Date.now() - lastHeartbeatStartedAt < heartbeatIntervalMs) return;
    void sendHeartbeat();
  };

  // ----- Boot -----
  connect('replace');
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }
  void sendHeartbeat();
  heartbeatInterval = setInterval(() => void sendHeartbeat(), heartbeatIntervalMs);

  return {
    tabId,
    get streamId() {
      return current?.id;
    },
    forceReconnect,
    stop() {
      if (stopped) return;
      stopped = true;
      closeStreams();
      cancelReconnect();
      outcomes.releaseOutcomes();
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    },
  };
}
