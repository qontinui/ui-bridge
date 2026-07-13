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
 * Wire contract (unchanged from the hook):
 *   1. SSE  GET  `{basePath}/commands/stream?tabId=` (fetch-streaming)
 *   2. exec      `execute(action, payload)`
 *   3. POST      `{basePath}/commands`   — result envelope
 *   4. POST      `{basePath}/heartbeat`  — every `heartbeatIntervalMs`
 *
 * `Authorization: Bearer <token>` rides on all three requests when
 * `authHeader` resolves a token; `registrationMetadata` (the strict per-user
 * tab-scoping envelope) rides on every heartbeat when wired. Both are read
 * fresh on every call so token / sessionId rotation is picked up without
 * restarting the client.
 */

// SSE reconnection delay (10s to avoid Next.js route recompilation cascades)
const SSE_RECONNECT_DELAY_MS = 10_000;

// Heartbeat interval — kept alive even when the tab is hidden
const HEARTBEAT_INTERVAL_MS = 10_000;

/** sessionStorage key for the stable per-tab id. */
const TAB_ID_STORAGE_KEY = '__uiBridge_tabId';

/**
 * JSON.stringify replacer that strips DOM nodes and handles circular
 * references. Command handler results can contain HTMLElement refs (e.g. from
 * component getState() or action handlers), which create cycles via React's
 * `__reactFiber$`.
 */
export function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object') {
      // Strip DOM nodes — they're never meaningful in JSON responses
      if (typeof Node !== 'undefined' && val instanceof Node) {
        return `[${val.constructor.name}]`;
      }
      // Break circular references
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    // Strip functions
    if (typeof val === 'function') return undefined;
    return val;
  });
}

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
 * Resolve a stable per-tab id. Precedence:
 *
 *   1. A caller-owned pin published on this document ({@link readPinnedTabId}).
 *      Checked FIRST and on every document, so a pinned id survives a
 *      cross-origin navigation (an OAuth hop) instead of being silently
 *      replaced by a freshly minted per-origin uuid — which invalidated the
 *      id the caller had been handed and was addressing the tab by.
 *   2. The `sessionStorage` entry (per-origin, per-tab) — so an embedded app
 *      and a relay client in the same document agree on the id.
 *   3. A fresh `crypto.randomUUID()`, persisted for (2).
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
  const fresh = crypto.randomUUID();
  persistTabId(fresh);
  return fresh;
}

/** Command frame as delivered over the SSE stream. */
interface QueuedCommand {
  commandId: string;
  action: string;
  payload: unknown;
  timestamp?: number;
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
  /** Force the SSE stream to close and immediately reconnect. */
  forceReconnect(): void;
  /** Tear down the SSE stream + heartbeat loop. Idempotent. */
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
  // An explicit `config.tabId` IS a caller-owned pin — persist it so an
  // embedded hook that later calls `resolveTabId()` in this same document
  // adopts it rather than minting a competing id.
  const tabId = config.tabId ?? resolveTabId();
  if (config.tabId) persistTabId(config.tabId);

  let stopped = false;
  let abortController: AbortController | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // ----- Response sender -----
  const sendResponse = async (commandId: string, ok: boolean, result: unknown) => {
    try {
      await fetch(`${basePath}/commands`, {
        method: 'POST',
        headers: transportHeaders(authHeader),
        body: safeJsonStringify({
          commandId,
          success: ok,
          result,
          tabId,
          error: ok ? undefined : (result as { error?: string })?.error,
        }),
      });
    } catch (e) {
      onError('[UIBridge] Failed to send command response:', e);
    }
  };

  // ----- Command processor -----
  const processCommand = async (command: QueuedCommand) => {
    try {
      const result = await execute(command.action, command.payload as Record<string, unknown>);
      const resultObj = result as { success?: boolean };
      if (resultObj && resultObj.success === false) {
        await sendResponse(command.commandId, false, result);
        return;
      }
      await sendResponse(command.commandId, true, result);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      let errorCode = 'UNKNOWN_ERROR';
      if (errorMessage.includes('not found')) errorCode = 'ELEMENT_NOT_FOUND';
      else if (errorMessage.includes('timeout')) errorCode = 'ACTION_TIMEOUT';
      else if (errorMessage.includes('Unknown command')) errorCode = 'UNKNOWN_COMMAND';

      await sendResponse(command.commandId, false, {
        success: false,
        error: errorMessage,
        failureDetails: { errorCode, message: errorMessage, timestamp: Date.now() },
        durationMs: 0,
        timestamp: Date.now(),
      });
    }
  };

  // ----- SSE connection -----
  const closeStream = () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    if (reconnectTimeout) return; // already scheduled
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      if (!stopped) connect();
    }, SSE_RECONNECT_DELAY_MS);
  };

  const connect = () => {
    if (stopped) return;
    closeStream();
    const controller = new AbortController();
    abortController = controller;

    const url = `${basePath}/commands/stream${tabId ? `?tabId=${encodeURIComponent(tabId)}` : ''}`;
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const token = resolveAuthToken(authHeader);
    if (token) headers.Authorization = `Bearer ${token}`;

    fetch(url, { method: 'GET', headers, signal: controller.signal, cache: 'no-store' })
      .then(async (resp) => {
        if (!resp.ok || !resp.body) {
          if (abortController === controller) abortController = null;
          scheduleReconnect();
          return;
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) !== -1) {
              const block = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              const data = parseSSEDataBlock(block);
              if (data == null) continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'connected') continue;
                if (parsed.commandId && parsed.action) {
                  void processCommand(parsed as QueuedCommand);
                }
              } catch (e) {
                onError('[UIBridge] Failed to parse SSE message:', e);
              }
            }
          }
        } catch {
          /* stream read aborted or network drop — fall through to reconnect */
        }
        if (abortController === controller) abortController = null;
        if (!stopped && !controller.signal.aborted) scheduleReconnect();
      })
      .catch(() => {
        if (abortController === controller) abortController = null;
        if (!stopped && !controller.signal.aborted) scheduleReconnect();
      });
  };

  const forceReconnect = () => {
    if (stopped) return;
    closeStream();
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    connect();
  };

  const handleVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      // Reconnect immediately if the stream was dropped while hidden.
      if (!abortController) {
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
        connect();
      }
    }
    // Do NOT disconnect on hide — automation tools need background access
  };

  // ----- Heartbeat -----
  const sendHeartbeat = async () => {
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
        headers: transportHeaders(authHeader),
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
    }
  };

  // ----- Boot -----
  connect();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }
  void sendHeartbeat();
  heartbeatInterval = setInterval(() => void sendHeartbeat(), heartbeatIntervalMs);

  return {
    tabId,
    forceReconnect,
    stop() {
      if (stopped) return;
      stopped = true;
      closeStream();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
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
