/**
 * Live wrapper relay content script.
 *
 * Independent of the visual annotator. Off by default — must be
 * explicitly enabled via the popup toggle (storage key
 * `qontinui_live_relay_enabled`). When enabled on a tab, this script
 * imports `@qontinui/ui-bridge-wrapper` lazily and constructs a
 * `LiveSessionTransport` pointing at the configured runner URL, so the
 * tab acts as a wrapper instance the runner can drive over WebSocket.
 *
 * Disabled tabs pay zero overhead beyond the storage probe in `boot()`.
 *
 * IMPORTANT: this script must not import the annotator code (and vice
 * versa) — they run in the same isolated world but are deliberately
 * independent so future changes to one cannot regress the other.
 */

import { STORAGE_KEYS, DEFAULT_LIVE_RELAY_RUNNER_URL } from '../shared/constants';

/** Minimal subset of the wrapper-package surface we use. */
interface LiveTransportLike {
  ready(): Promise<void>;
  close(): Promise<void>;
  register(actionId: string, fn: (params?: unknown, ctx?: unknown) => unknown): void;
}

interface WrapperModule {
  LiveSessionTransport: new (
    config: {
      kind: 'live';
      runnerUrl: string;
      appId?: string;
      appName?: string;
      options?: Record<string, unknown>;
    },
    registry?: unknown,
    injected?: { webSocketCtor?: typeof WebSocket }
  ) => LiveTransportLike;
}

/** Currently-active transport for this tab, if any. */
let transport: LiveTransportLike | null = null;
/** Guards against overlapping enable/disable transitions. */
let inFlight: Promise<void> | null = null;

/** Truncate an arbitrary string to a sane on-the-wire length. */
function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Derive a stable app id from the page URL. Examples:
 *   https://gmail.com/mail/u/0     -> "gmail.com-mail"
 *   https://example.com            -> "example.com"
 *   http://127.0.0.1:3001/builder  -> "127.0.0.1:3001-builder"
 */
function deriveAppId(): string {
  const host = location.host || 'unknown';
  const firstSegment = location.pathname.split('/').filter(Boolean)[0];
  return firstSegment ? `${host}-${firstSegment}` : host;
}

function deriveAppName(): string {
  const title = document.title?.trim();
  if (title) return truncate(title);
  return truncate(location.host || location.href);
}

/** Resolve the configured runner URL (or fall back to the default). */
async function loadRunnerUrl(): Promise<string> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.liveRelayRunnerUrl);
    const url = result[STORAGE_KEYS.liveRelayRunnerUrl] as string | undefined;
    return url && url.trim().length > 0 ? url.trim() : DEFAULT_LIVE_RELAY_RUNNER_URL;
  } catch {
    return DEFAULT_LIVE_RELAY_RUNNER_URL;
  }
}

/** Bring up a transport. Idempotent — no-op if one is already running. */
async function start(): Promise<void> {
  if (transport) return;

  const runnerUrl = await loadRunnerUrl();

  // Lazy-load the wrapper. Bundled via esbuild — see build.mjs.
  let mod: WrapperModule;
  try {
    mod = (await import('@qontinui/ui-bridge-wrapper')) as unknown as WrapperModule;
  } catch (err) {
    console.error('[ui-bridge live-relay] failed to load wrapper module', err);
    return;
  }

  const appId = deriveAppId();
  const appName = deriveAppName();

  let t: LiveTransportLike;
  try {
    t = new mod.LiveSessionTransport(
      {
        kind: 'live',
        runnerUrl,
        appId,
        appName,
        // Forward the page's origin and href so the runner's registry
        // surfaces a real URL to the integration tool. Without these,
        // the runner falls back to a synthetic "ws://runner/ui-bridge/ws"
        // placeholder that's useless on the card.
        options: {
          origin: location.origin,
          pageUrl: location.href,
          appType: 'wrapper',
        },
      },
      undefined,
      // Use the browser's native WebSocket. The wrapper picks this up
      // from globalThis automatically, but we pass it explicitly to be
      // robust against bundler-globals quirks in extension-isolated
      // worlds.
      { webSocketCtor: WebSocket }
    );
  } catch (err) {
    console.error('[ui-bridge live-relay] failed to construct transport', err);
    return;
  }

  // Register a single demo handler so the runner can prove the
  // round-trip end-to-end without a custom wrapper. Wrappers built on
  // top of this script are free to register more.
  try {
    t.register('ping', () => ({
      ok: true,
      href: location.href,
      ts: Date.now(),
    }));
  } catch (err) {
    // If the registry rejects us we still want to attempt connection;
    // surface the error but keep going.
    console.warn('[ui-bridge live-relay] register("ping") failed', err);
  }

  transport = t;

  try {
    await t.ready();
    console.info(`[ui-bridge live-relay] connected to ${runnerUrl} as appId=${appId}`);
  } catch (err) {
    console.error('[ui-bridge live-relay] handshake failed', err);
    // Surface but keep the reference so a subsequent disable cleanly
    // tears down whatever partial state exists.
  }
}

/** Tear down the transport, if any. */
async function stop(): Promise<void> {
  const t = transport;
  transport = null;
  if (!t) return;
  try {
    await t.close();
  } catch {
    // best-effort teardown
  }
}

/** Apply a desired enabled state, serializing transitions. */
function apply(enabled: boolean): Promise<void> {
  const next = (inFlight ?? Promise.resolve()).then(async () => {
    if (enabled) {
      await start();
    } else {
      await stop();
    }
  });
  inFlight = next.catch(() => undefined);
  return next;
}

/** Read the persisted enabled flag. Defaults to false. */
async function readEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.liveRelayEnabled);
    return result[STORAGE_KEYS.liveRelayEnabled] === true;
  } catch {
    return false;
  }
}

/**
 * Listen for the popup's `live-relay-toggle` broadcast. We only react
 * to messages that match our shape — everything else (the annotator's
 * existing message types in particular) is ignored explicitly.
 */
function installToggleListener(): void {
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === 'live-relay-toggle'
    ) {
      const enabled = (message as { enabled?: unknown }).enabled === true;
      void apply(enabled);
    }
    // Returning undefined / not calling sendResponse means we don't
    // intercept the response channel for messages we ignore.
    return undefined;
  });
}

/**
 * Boot. Runs at document_idle. If the toggle is off (default), exits
 * with no further work — disabled tabs incur a single
 * `chrome.storage.local.get` and the cost of installing one
 * `chrome.runtime.onMessage` listener so the popup can flip us on
 * without a tab reload.
 */
async function boot(): Promise<void> {
  installToggleListener();

  const enabled = await readEnabled();
  if (!enabled) {
    return; // zero further overhead
  }
  await apply(true);
}

void boot();

export {};
