/**
 * Playwright-backed Chromium launcher for UI Bridge testing.
 *
 * Launches a real browser (headful or headless), navigates to the target
 * URL, and optionally blocks until the UI Bridge relay reports that a tab
 * has connected. Console messages and page errors are forwarded to stderr
 * so debugging failures doesn't require opening the visible browser.
 *
 * Output contract: this module never writes to stdout. stdout belongs to the
 * embedding process's machine output (e.g. inject-cli's `{action,result}`
 * NDJSON lines), so every forwarded `[browser.<type>]` line goes to stderr.
 */

import { readFileSync } from 'node:fs';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright';
import {
  restoreSessionStorageInitScript,
  splitSessionStorageArtifact,
  type StorageStateArtifact,
} from './storage-state.js';

/** The two `prefers-color-scheme` values a launch can emulate. */
export type LaunchColorScheme = 'light' | 'dark';

/**
 * HAR recording for the launch's browser context: Playwright's own
 * `recordHar` shape (`{ path, content?, mode?, urlFilter?, omitContent? }`),
 * passed to `browser.newContext` unchanged.
 *
 * Playwright writes the archive when the CONTEXT closes, which the tab's
 * `close()` does before it closes the browser. A `path` ending in `.zip` with
 * `content: 'attach'` stores response bodies as files inside the zip.
 */
export type LaunchRecordHarOptions = NonNullable<BrowserContextOptions['recordHar']>;

/** Whether the launch's context lets pages register service workers. */
export type LaunchServiceWorkersPolicy = NonNullable<BrowserContextOptions['serviceWorkers']>;

/**
 * Called with the launch's browser context after it is created and before its
 * first page exists, so whatever it installs (`context.route('**\/*', …)`,
 * `context.routeWebSocket(…)`, an extra init script) is in place for the very
 * first request the navigation makes. The launcher awaits it.
 */
export type LaunchInitRouter = (context: BrowserContext) => void | Promise<void>;

/**
 * Validate a requested device scale factor, returning it unchanged.
 *
 * Checked HERE, before any browser launches, rather than left to Playwright:
 * a NaN or a zero would otherwise surface as an opaque protocol error several
 * frames deep, after a Chromium process had already been spawned.
 *
 * @internal Exported for tests; not part of the package's public surface.
 */
export function validateDeviceScaleFactor(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`deviceScaleFactor must be a positive finite number (got ${String(value)})`);
  }
  return value;
}

export interface LaunchHeadlessTabOptions {
  /** URL the browser tab should navigate to. Required. */
  url: string;

  /**
   * If `true`, launch in headless mode with no visible window.
   * Defaults to `false` because the common case is an interactive
   * debugging session — the CLI should be usable without `--help`.
   */
  headless?: boolean;

  /**
   * Base URL of the UI Bridge relay to poll once the page loads.
   * If provided, the launcher blocks until the relay reports at least
   * one connected tab, or until `waitForUiBridgeMs` elapses.
   *
   * Examples:
   *   - `http://localhost:3001/api/ui-bridge`  (qontinui-web)
   *   - `http://localhost:9876/ui-bridge`      (qontinui-runner)
   */
  uiBridgeBase?: string;

  /**
   * Max time (ms) to wait for UI Bridge to register the tab after the
   * page loads. Defaults to 30 000 ms. Ignored when `uiBridgeBase` is
   * not set.
   */
  waitForUiBridgeMs?: number;

  /**
   * Bearer token for an auth-gated relay. Sent as `Authorization: Bearer
   * <token>` on the `<uiBridgeBase>/tabs` registration poll.
   *
   * REQUIRED against a gated relay: without it the poll is answered with 401,
   * which is indistinguishable from "no tab yet" — the launcher would spin to
   * `waitForUiBridgeMs` and report `tabId: null` even though the page-side
   * client (which HAS the token) registered fine.
   *
   * Backward-compatible: when unset, the poll is anonymous, as before.
   */
  authToken?: string;

  /**
   * Authenticated user id for the relay's per-user tab scoping (§4.2). Sent as
   * `X-Caller-User-Id` on the registration poll so `/tabs` returns THIS
   * driver's tab instead of an arbitrary entry from the global list. Normally
   * the `userId` from the same `registrationMetadata` the page-side client
   * heartbeats with.
   */
  callerUserId?: string;

  /**
   * The tab id the caller pinned on this launch (`ui-bridge-inject --tab-id`).
   * When set, the registration poll returns THAT tab only, never another tab
   * that happens to be registered on the same relay.
   */
  pinnedTabId?: string;

  /** Viewport width (px). Default 1280. */
  viewportWidth?: number;

  /** Viewport height (px). Default 720. */
  viewportHeight?: number;

  /**
   * Device scale factor of the browser CONTEXT — what the page reads as
   * `window.devicePixelRatio`, and how many screenshot pixels one CSS pixel
   * covers. Any positive finite number (`2` for a Retina laptop, `2.625` for
   * many phones). Default: Playwright's, which is `1`.
   *
   * It is a context option and not a launch flag on purpose. Chromium's
   * `--force-device-scale-factor` passed through `launchArgs` does NOT reach
   * the page: this launcher always creates the context with a `viewport`, and
   * Playwright's metrics emulation then overrides the flag, so
   * `devicePixelRatio` stays 1 (measured 2026-10-13, plan
   * 2026-10-13-image-generation-and-visual-judgment, Phase 1 item 5).
   */
  deviceScaleFactor?: number;

  /**
   * The `prefers-color-scheme` the context emulates. Default: no override, so
   * Playwright's own default (`light`) applies.
   */
  colorScheme?: LaunchColorScheme;

  /**
   * User agent string override. Defaults to Playwright's Chromium
   * default, which is a plain modern Chrome UA.
   */
  userAgent?: string;

  /**
   * Whether to forward page `console.*` messages and uncaught errors to
   * the Node process's stderr. Default `true`.
   *
   * Every console type (`log`, `info`, `debug`, `warning`, `error`, …) is
   * written to **stderr** as `[browser.<type>] <text>`, and uncaught page
   * errors as `[browser.pageerror] <message>`. Nothing is forwarded to stdout:
   * stdout is reserved for the embedding process's machine output, which a
   * browser `console.log` would otherwise corrupt.
   */
  forwardConsole?: boolean;

  /**
   * Optional callback invoked with each navigated URL. Useful for
   * logging during client-side routing.
   */
  onPageUrl?: (url: string) => void;

  /**
   * Scripts to register on the browser context via
   * `BrowserContext.addInitScript` BEFORE the first navigation. Each entry
   * is evaluated in the page realm before any of the page's own scripts run
   * and re-runs on every navigation in the context — the contract injected
   * mode relies on to define `window.__uiBridgeInjected` before first paint
   * (see the UI Bridge injected-transport plan §3.5).
   *
   * Backward-compatible: when unset, no init scripts are registered and
   * behavior is unchanged.
   */
  initScripts?: string[];

  /**
   * Extra Chromium command-line arguments passed to `chromium.launch({ args })`.
   *
   * The motivating case (plan 2026-06-12 item 2): Chromium's Local Network
   * Access checks block `fetch` from an https page to a loopback relay
   * (`https://example.com` → `http://127.0.0.1:9877`), so a driver that needs
   * that combination must pass
   * `--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults`.
   *
   * Backward-compatible: when unset or empty, no extra args are passed and
   * behavior is unchanged.
   */
  launchArgs?: string[];

  /**
   * Path to a Playwright `storageState` JSON file (cookies + localStorage +
   * sessionStorage) to seed the browser context with before the first
   * navigation. Produced by `BrowserContext.storageState({ path })` after an
   * authenticated drive (e.g. `ui-bridge-login-web --storage-state-out`).
   *
   * Seeding this lets an autonomous loop log in ONCE and then drive a
   * login-walled page MANY times without re-driving the hosted-UI login each
   * time — the saved session carries the auth past the login wall.
   *
   * Backward-compatible: when unset, the context is created with no auth
   * seeding and behavior is unchanged.
   *
   * sessionStorage parity: Playwright's native `storageState` carries only
   * cookies + localStorage. If the artifact was produced by
   * `ui-bridge-login-web --storage-state-out` it also carries a custom
   * `__sessionStorage` key (origin → key/value map). When present, this launcher
   * (1) STRIPS that custom key before handing the object to
   * `newContext({ storageState })` — Playwright validates the schema and rejects
   * unknown top-level keys — and (2) registers an `addInitScript` that
   * repopulates sessionStorage per-origin on every navigation, so an app that
   * reads its bearer token from sessionStorage (qontinui-web) lands
   * authenticated. A legacy artifact WITHOUT `__sessionStorage` is read + passed
   * through unchanged.
   *
   * BEFORE Chromium launches, the file is read, parsed as JSON and checked to
   * hold an object whose `cookies` and `origins` are arrays when present. A
   * file that fails any of those rejects the launch with no browser started:
   * with the read error, the JSON parse error, or an error naming the file and
   * what is wrong with its shape. Content past that shape (a malformed cookie
   * entry, say) is Playwright's to judge in `newContext`, after the launch; a
   * refusal there still closes the browser before the launch rejects.
   */
  storageStatePath?: string;

  /**
   * Record a HAR of every request the context makes, passed to
   * `newContext({ recordHar })` unchanged (see {@link LaunchRecordHarOptions}).
   * The file is written when the context closes: the tab's `close()` closes the
   * context before the browser, so it is complete once `close()` resolves. A
   * context close that fails (including a HAR that could not be written) is
   * reported on stderr, like a browser close that fails.
   *
   * Backward-compatible: when unset, no HAR is recorded.
   */
  recordHar?: LaunchRecordHarOptions;

  /**
   * `'block'` stops pages registering service workers, passed to
   * `newContext({ serviceWorkers })`. A service worker answers requests
   * itself, so they never reach `recordHar` or a route installed by
   * `initRouter`; block them when either must see every request.
   *
   * Default: unset, so Playwright's default (`'allow'`) applies.
   */
  serviceWorkers?: LaunchServiceWorkersPolicy;

  /**
   * Install routes on the context before the first page loads (see
   * {@link LaunchInitRouter}). Runs after the context and its init scripts are
   * set up and before `newPage`, so a `context.route('**\/*', …)` it installs
   * intercepts the first navigation's own document request. If it throws, the
   * launch fails like any other post-launch step: the browser is closed and the
   * error is rethrown.
   *
   * Backward-compatible: when unset, nothing is installed.
   */
  initRouter?: LaunchInitRouter;
}

export interface HeadlessTab {
  /** The Playwright page handle, for advanced drivers that need direct access. */
  page: Page;
  /** The Playwright browser context (one per tab; disposal closes all pages). */
  context: BrowserContext;
  /** The underlying browser instance. Closing this closes everything. */
  browser: Browser;
  /**
   * Close the context, then the browser and all associated resources. The
   * context is closed first so a `recordHar` archive is written before the
   * browser goes away. Safe to call multiple times: every call returns the
   * first close's promise, so a later caller also waits for it. Resolves even when closing the context or the browser fails:
   * that failure is reported on stderr, not thrown.
   */
  close(): Promise<void>;
  /**
   * Navigate to a new URL in the same tab. Resolves after `load`.
   */
  navigate(url: string): Promise<void>;
}

export interface LaunchHeadlessTabResult extends HeadlessTab {
  /** The URL the browser actually ended up at after navigation. */
  finalUrl: string;
  /** `true` if UI Bridge registration was confirmed before returning. */
  uiBridgeRegistered: boolean;
  /** The tab id the relay assigned, when registration was confirmed. */
  tabId: string | null;
}

/** How {@link waitForUiBridgeRegistration} recognises the launch's own tab. */
export interface RegistrationTabSelection {
  /** The tab id this launch pinned. When set, only that tab counts. */
  pinnedTabId?: string;
  /**
   * Origin of the page this launch navigated to. Against a runner that serves
   * `verifiedOrigin` per tab, only a tab whose verified origin matches counts.
   */
  expectedOrigin?: string;
}

/** One entry of the relay's `GET <uiBridgeBase>/tabs` list, as far as the poll reads it. */
interface RegisteredTab {
  tabId?: string;
  /**
   * The origin the runner bound the tab to. Present (possibly `null`, for a
   * key-bound or operator-trust tab) on a runner that binds relay tabs to their
   * principal; absent on an older runner or a remote SDK relay.
   */
  verifiedOrigin?: string | null;
}

/** Same loopback spellings as the runner's origin guard. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Origin equality as the runner judges a principal: exact after URL
 * normalisation, or the same scheme and port under two loopback spellings.
 */
function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.origin === ub.origin) return true;
    return (
      ua.protocol === ub.protocol &&
      ua.port === ub.port &&
      LOOPBACK_HOSTS.has(ua.hostname) &&
      LOOPBACK_HOSTS.has(ub.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Pick this launch's tab out of the relay's tab list, or `null` if it has not
 * registered yet. Any tab in the operator's browser can be registered on the
 * same runner, so `tabs[0]` is only a last resort:
 *
 *   1. A pinned launch returns the pinned tab only.
 *   2. When the relay serves `verifiedOrigin`, only a tab bound to the
 *      navigated origin counts — a foreign tab never does.
 *   3. Otherwise (an older runner, a remote relay, or no known origin) the
 *      first tab, as before.
 *
 * @internal Exported for tests; not part of the package's public surface.
 */
export function selectOwnTab(
  tabs: RegisteredTab[],
  selection?: RegistrationTabSelection
): RegisteredTab | null {
  if (selection?.pinnedTabId) {
    return tabs.find((t) => t.tabId === selection.pinnedTabId) ?? null;
  }
  const servesVerifiedOrigin = tabs.some((t) => 'verifiedOrigin' in t);
  if (servesVerifiedOrigin && selection?.expectedOrigin) {
    const expected = selection.expectedOrigin;
    return (
      tabs.find(
        (t) => typeof t.verifiedOrigin === 'string' && sameOrigin(t.verifiedOrigin, expected)
      ) ?? null
    );
  }
  return tabs[0] ?? null;
}

/**
 * Poll `<uiBridgeBase>/tabs` until it reports THIS launch's tab (see
 * {@link selectOwnTab}): the pinned tab, or the tab bound to the navigated
 * origin — never a foreign tab that happens to be registered on the relay.
 *
 * `authToken` is the SAME bearer the page-side relay client uses. Without it,
 * an auth-gated relay answers this poll with 401 — which the loop below cannot
 * distinguish from "not registered yet", so it spins to the deadline and
 * reports `tabId: null`. The tab HAD registered; only the poll was anonymous,
 * making a perfectly healthy launch look like a broken one.
 *
 * `callerUserId` is forwarded as `X-Caller-User-Id` when the driver supplied
 * registration metadata, so the relay's per-user tab scoping (§4.2) returns the
 * driver's OWN tab rather than an arbitrary first entry from the global list.
 *
 * `selection` narrows the pick further: `pinnedTabId` returns that tab only,
 * and `expectedOrigin` matches the runner-served `verifiedOrigin`.
 *
 * @internal Exported for tests; not part of the package's public surface.
 */
export async function waitForUiBridgeRegistration(
  uiBridgeBase: string,
  timeoutMs: number,
  auth?: { authToken?: string; callerUserId?: string },
  selection?: RegistrationTabSelection
): Promise<{ tabId: string | null; ok: boolean }> {
  const deadline = Date.now() + timeoutMs;
  const url = `${uiBridgeBase.replace(/\/$/, '')}/tabs`;
  const headers: Record<string, string> = {};
  if (auth?.authToken) headers.Authorization = `Bearer ${auth.authToken}`;
  if (auth?.callerUserId) headers['X-Caller-User-Id'] = auth.callerUserId;
  let lastStatus: number | null = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });
      lastStatus = res.status;
      if (res.ok) {
        const body = (await res.json()) as { data?: { tabs?: RegisteredTab[] } };
        const own = selectOwnTab(body?.data?.tabs ?? [], selection);
        if (own) {
          return { tabId: own.tabId ?? null, ok: true };
        }
      }
    } catch {
      // ignore — relay may not be ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Surface the auth failure rather than letting it masquerade as "no tab
  // ever registered" — the single most confusing failure this CLI can emit.
  if (lastStatus === 401 || lastStatus === 403) {
    process.stderr.write(
      `[ui-bridge] relay ${url} returned HTTP ${lastStatus} for the registration poll` +
        `${auth?.authToken ? ' (the supplied auth token was rejected)' : ' — the relay is auth-gated but no auth token was supplied (pass --auth-token)'}` +
        `. The tab may well have registered; the POLL could not read it.\n`
    );
  }
  return { tabId: null, ok: false };
}

/** The origin of `url`, or `undefined` for an opaque or unparseable one. */
function originOf(url: string): string | undefined {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

/** A JSON value as an error message names it: `null`, `an array`, `a string`, `an object`, … */
function describeJsonValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

/**
 * Read a `storageStatePath` file, BEFORE any browser launches.
 *
 * Exactly this is checked: the file reads, its content parses as JSON, and it
 * holds an object whose `cookies` and `origins` are arrays when present. A read
 * or parse failure throws that error unchanged; a shape failure throws an error
 * naming the file and what is wrong with it. Nothing deeper is checked here:
 * content past that shape (a malformed cookie entry, say) is Playwright's to
 * judge in `newContext`, after the launch, where a refusal closes the browser
 * like any other post-launch failure.
 */
function readStorageStateFile(path: string): StorageStateArtifact {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `storageState file ${path} must hold a JSON object, got ${describeJsonValue(parsed)}`
    );
  }
  for (const key of ['cookies', 'origins'] as const) {
    const value = (parsed as Record<string, unknown>)[key];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(
        `storageState file ${path}: "${key}" must be an array when present, got ${describeJsonValue(value)}`
      );
    }
  }
  return parsed as StorageStateArtifact;
}

/**
 * Close `browser`, and report a close that fails on stderr instead of throwing it.
 *
 * The one close path of this module: a tab's `close()` and a failed launch
 * both go through it. Neither may throw the close's own error (`close()` is
 * best-effort teardown, and a failed launch must reject with ITS error), and
 * neither stays silent about it, because a close that failed may have left a
 * Chromium running.
 */
async function closeBrowserReportingFailure(browser: Browser, what: string): Promise<void> {
  try {
    await browser.close();
  } catch (closeError) {
    const detail = closeError instanceof Error ? closeError.message : String(closeError);
    process.stderr.write(
      `[ui-bridge] could not close ${what}, so a Chromium may still be running: ${detail}\n`
    );
  }
}

/**
 * Close a tab's `context`, then its `browser`, reporting either failure on
 * stderr instead of throwing it.
 *
 * The context is closed explicitly, BEFORE the browser, because Playwright
 * writes a `recordHar` archive on `BrowserContext.close()`; a bare
 * `browser.close()` would end the context without writing it. The browser is
 * closed even when the context close fails.
 */
async function closeTabReportingFailure(context: BrowserContext, browser: Browser): Promise<void> {
  try {
    await context.close();
  } catch (closeError) {
    const detail = closeError instanceof Error ? closeError.message : String(closeError);
    process.stderr.write(
      `[ui-bridge] could not close the tab's browser context (a recordHar archive may be missing or incomplete): ${detail}\n`
    );
  }
  await closeBrowserReportingFailure(browser, "the tab's browser");
}

/**
 * Close the browser that a failed {@link launchHeadlessTab} launched.
 *
 * Awaited BEFORE the launch's original error is rethrown, so the browser is
 * already closed when the rejection reaches the caller. A close that fails is
 * reported, never thrown: the caller must see the error that failed the
 * launch, never the teardown's.
 */
function closeAfterFailedLaunch(browser: Browser): Promise<void> {
  return closeBrowserReportingFailure(browser, 'the browser of a failed launch');
}

/**
 * Launch a Playwright Chromium browser and keep the tab open until `close()`
 * is called. Resolves once the page has loaded and (optionally) UI Bridge
 * has confirmed the tab's registration.
 *
 * A launch that rejects owns its cleanup, so a caller never receives, and
 * never needs, a handle to close:
 *
 *   - BEFORE Chromium is spawned, `deviceScaleFactor` and `colorScheme` are
 *     validated, and the `storageStatePath` file is read, parsed as JSON and
 *     checked to hold an object whose `cookies` and `origins` are arrays when
 *     present. A failure there rejects with no browser launched.
 *   - Once Chromium is running, a step that throws closes the browser and only
 *     then rejects, with the ORIGINAL error: the same object, never a wrapper
 *     and never the close's own failure (that is reported on stderr). The
 *     steps are `newContext` (which is also where Playwright refuses
 *     storageState content that passed the shape check above), an init
 *     script, `newPage`, the first navigation and the registration wait.
 *
 * Up to 0.7.0 such a step threw with the browser still running and no handle
 * returned, so one Chromium leaked per failed first page load until the
 * process exited (coord finding 45a8ff13).
 */
export async function launchHeadlessTab(
  options: LaunchHeadlessTabOptions
): Promise<LaunchHeadlessTabResult> {
  const {
    url,
    headless = false,
    uiBridgeBase,
    waitForUiBridgeMs = 30_000,
    viewportWidth = 1280,
    viewportHeight = 720,
    deviceScaleFactor,
    colorScheme,
    userAgent,
    forwardConsole = true,
    onPageUrl,
    initScripts,
    launchArgs,
    storageStatePath,
    authToken,
    callerUserId,
    pinnedTabId,
    recordHar,
    serviceWorkers,
    initRouter,
  } = options;

  if (deviceScaleFactor !== undefined) validateDeviceScaleFactor(deviceScaleFactor);
  if (colorScheme !== undefined && colorScheme !== 'light' && colorScheme !== 'dark') {
    throw new Error(`colorScheme must be 'light' or 'dark' (got ${String(colorScheme)})`);
  }

  // Resolve the storageState seed. When a path is given we READ the file here
  // (rather than handing the path to Playwright) so we can split off the custom
  // `__sessionStorage` key: Playwright validates the storageState schema and
  // rejects unknown top-level keys, and passing the path would re-read the file
  // WITH the custom key. After splitting, the cleaned object is schema-valid and
  // the sessionStorage map (if any) drives an addInitScript restore below. A
  // legacy artifact without `__sessionStorage` round-trips to an equivalent
  // cleaned object → behavior is unchanged.
  //
  // Read BEFORE Chromium launches, like the checks above: a file that does not
  // read, parse as JSON, or hold an object whose `cookies` and `origins` are
  // arrays when present rejects the launch with no browser to clean up
  // (readStorageStateFile says exactly what it checks).
  let storageStateSeed: Record<string, unknown> | undefined;
  let sessionStorageMap: Record<string, Record<string, string>> | null = null;
  if (storageStatePath) {
    const split = splitSessionStorageArtifact(readStorageStateFile(storageStatePath));
    storageStateSeed = split.storageState;
    sessionStorageMap = split.sessionStorage;
  }

  const browser = await chromium.launch({
    headless,
    ...(launchArgs && launchArgs.length > 0 ? { args: launchArgs } : {}),
  });

  // From here on a Chromium process exists. A step that throws before the
  // handle below is returned would leave it running with nothing for the
  // caller to close, so a failed launch closes its own browser and then
  // rethrows the original error.
  try {
    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
      ...(colorScheme !== undefined ? { colorScheme } : {}),
      userAgent,
      ...(storageStateSeed ? { storageState: storageStateSeed as never } : {}),
      ...(recordHar !== undefined ? { recordHar } : {}),
      ...(serviceWorkers !== undefined ? { serviceWorkers } : {}),
    });

    // sessionStorage restore (Playwright's storageState can't carry it). The
    // init-script runs in the page realm before any page script on EVERY
    // navigation — exactly when the app first reads its token — and repopulates
    // sessionStorage for the matching origin. Registered before the first page so
    // it covers the initial navigation too.
    if (sessionStorageMap && Object.keys(sessionStorageMap).length > 0) {
      await context.addInitScript(restoreSessionStorageInitScript, sessionStorageMap);
    }

    // Register init scripts before the first page is created so they run in
    // the page realm before any of the target's own scripts execute. Order is
    // preserved — callers that need a config global available to a later
    // bundle script should list the config script first.
    for (const content of initScripts ?? []) {
      await context.addInitScript({ content });
    }

    // Caller routes go in before the first page exists, so they intercept the
    // first navigation's own requests, its document included.
    if (initRouter) {
      await initRouter(context);
    }

    const page = await context.newPage();

    if (forwardConsole) {
      // Every type goes to stderr. stdout is reserved for machine output: a
      // caller such as inject-cli emits one JSON line per action there, and a
      // `[browser.log]` line interleaved with them breaks its consumer's parse.
      page.on('console', (msg) => {
        process.stderr.write(`[browser.${msg.type()}] ${msg.text()}\n`);
      });
      page.on('pageerror', (err) => {
        process.stderr.write(`[browser.pageerror] ${err.message}\n`);
      });
    }

    if (onPageUrl) {
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
          onPageUrl(frame.url());
        }
      });
    }

    await page.goto(url, { waitUntil: 'load' });
    const finalUrl = page.url();

    let uiBridgeRegistered = false;
    let tabId: string | null = null;
    if (uiBridgeBase) {
      const result = await waitForUiBridgeRegistration(
        uiBridgeBase,
        waitForUiBridgeMs,
        { authToken, callerUserId },
        { pinnedTabId, expectedOrigin: originOf(finalUrl) }
      );
      uiBridgeRegistered = result.ok;
      tabId = result.tabId;
    }

    // Every call returns the FIRST close's promise, so a concurrent second
    // caller also waits until the context (and any recordHar archive) is closed.
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= closeTabReportingFailure(context, browser);
      return closing;
    };

    const navigate = async (nextUrl: string): Promise<void> => {
      await page.goto(nextUrl, { waitUntil: 'load' });
    };

    return {
      page,
      context,
      browser,
      close,
      navigate,
      finalUrl,
      uiBridgeRegistered,
      tabId,
    };
  } catch (err) {
    await closeAfterFailedLaunch(browser);
    throw err;
  }
}
