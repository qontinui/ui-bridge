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
 *   4. POST      `{basePath}/heartbeat`  — every `heartbeatIntervalMs`,
 *                naming the current stream (`streamId`) once it has connected
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
import { STREAM_CAPABILITIES, createStreamLifecycle, type QueuedCommand } from './stream-lifecycle';

// The stream lifecycle lives in `stream-lifecycle.ts`; these keep the public
// surface of this module as it was.
export { HEALTHY_STREAM_MIN_MS, parseSSEDataBlock } from './stream-lifecycle';

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

/** What one execution of a command produced: every delivery of it is answered with this. */
interface CommandOutcome {
  ok: boolean;
  result: unknown;
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
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  // This page instance. Its id rides on every stream GET, and its memory of
  // the commands it ran is what lets a relay redeliver into it safely.
  const outcomes = createCommandDedupe<CommandOutcome>();
  const clientInstanceId = randomUuid();
  const streamUrl =
    `${basePath}/commands/stream?` +
    (tabId ? `tabId=${encodeURIComponent(tabId)}&` : '') +
    `caps=${STREAM_CAPABILITIES}&cid=${encodeURIComponent(clientInstanceId)}`;
  const lifecycle = createStreamLifecycle({
    streamUrl,
    tabKeyHeader,
    resolveToken: () => resolveAuthToken(authHeader),
    onError,
    isStopped: () => stopped,
    isOpaqueOrigin,
    onCommand: (command, fromStream) => void processCommand(command, fromStream),
    onPing: () => maybeSendHeartbeat(),
  });
  const { connect, closeStreams, cancelReconnect } = lifecycle;

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
  const forceReconnect = () => {
    if (stopped) return;
    closeStreams();
    connect('replace');
  };

  const handleVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      // Reconnect immediately if the stream was dropped while hidden.
      if (!lifecycle.hasCurrent()) connect('replace');
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
  /** Whether the current run of heartbeats has had its ownership claim refused. */
  let ownershipRefused = false;

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
      // Names the stream this page holds (the CURRENT one, from its own
      // `connected` event), so the relay can tell its holder that the stream
      // is bound to another identity.
      const streamId = lifecycle.currentStreamId();
      if (streamId !== undefined) body.streamId = streamId;

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
          const payload = data?.data ?? data;
          const tabRegistered = payload?.tabRegistered ?? null;
          if (tabRegistered === false) forceReconnect();
          // A refused ownership claim leaves this tab unregistered, and a
          // scoped caller cannot reach an unregistered tab. Report it once
          // per run of refusals rather than failing silently on every beat.
          // `STREAM_IDENTITY_CHANGED` says the stream this page holds is
          // bound to an identity the page no longer has (a re-login):
          // reopening it under the current one is the fix.
          if (payload?.ownershipAssigned === false) {
            const reason =
              typeof payload.ownerChangeRejected === 'string'
                ? payload.ownerChangeRejected
                : 'unknown';
            if (reason === 'STREAM_IDENTITY_CHANGED') forceReconnect();
            if (!ownershipRefused) {
              ownershipRefused = true;
              onError(
                `[UIBridge] Relay refused this tab's ownership claim (${reason}); ` +
                  'scoped callers cannot reach the tab until it registers under the authenticated user.'
              );
            }
          } else {
            ownershipRefused = false;
          }
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
      return lifecycle.currentStreamId();
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
