/**
 * Playwright-backed Chromium launcher for UI Bridge testing.
 *
 * Launches a real browser (headful or headless), navigates to the target
 * URL, and optionally blocks until the UI Bridge relay reports that a tab
 * has connected. Console messages and page errors are forwarded to stdout
 * so debugging failures doesn't require opening the visible browser.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

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

  /** Viewport width (px). Default 1280. */
  viewportWidth?: number;

  /** Viewport height (px). Default 720. */
  viewportHeight?: number;

  /**
   * User agent string override. Defaults to Playwright's Chromium
   * default, which is a plain modern Chrome UA.
   */
  userAgent?: string;

  /**
   * Whether to forward page `console.*` messages and uncaught errors to
   * the Node process's stderr. Default `true`.
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
   * seeding and behavior is unchanged. Passed straight to
   * `BrowserContext`'s `storageState` option (Playwright accepts a file path).
   */
  storageStatePath?: string;
}

export interface HeadlessTab {
  /** The Playwright page handle, for advanced drivers that need direct access. */
  page: Page;
  /** The Playwright browser context (one per tab; disposal closes all pages). */
  context: BrowserContext;
  /** The underlying browser instance. Closing this closes everything. */
  browser: Browser;
  /**
   * Close the browser and all associated resources. Safe to call multiple
   * times; subsequent calls resolve immediately.
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

/** Poll `<uiBridgeBase>/tabs` until it reports at least one connected tab. */
async function waitForUiBridgeRegistration(
  uiBridgeBase: string,
  timeoutMs: number
): Promise<{ tabId: string | null; ok: boolean }> {
  const deadline = Date.now() + timeoutMs;
  const url = `${uiBridgeBase.replace(/\/$/, '')}/tabs`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        const body = (await res.json()) as {
          data?: { tabs?: Array<{ tabId?: string }> };
        };
        const tabs = body?.data?.tabs ?? [];
        if (tabs.length > 0) {
          return { tabId: tabs[0]?.tabId ?? null, ok: true };
        }
      }
    } catch {
      // ignore — relay may not be ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { tabId: null, ok: false };
}

/**
 * Launch a Playwright Chromium browser and keep the tab open until `close()`
 * is called. Resolves once the page has loaded and (optionally) UI Bridge
 * has confirmed the tab's registration.
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
    userAgent,
    forwardConsole = true,
    onPageUrl,
    initScripts,
    launchArgs,
    storageStatePath,
  } = options;

  const browser = await chromium.launch({
    headless,
    ...(launchArgs && launchArgs.length > 0 ? { args: launchArgs } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
    userAgent,
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
  });

  // Register init scripts before the first page is created so they run in
  // the page realm before any of the target's own scripts execute. Order is
  // preserved — callers that need a config global available to a later
  // bundle script should list the config script first.
  for (const content of initScripts ?? []) {
    await context.addInitScript({ content });
  }

  const page = await context.newPage();

  if (forwardConsole) {
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      const prefix = `[browser.${type}]`;
      if (type === 'error' || type === 'warning') {
        process.stderr.write(`${prefix} ${text}\n`);
      } else {
        process.stdout.write(`${prefix} ${text}\n`);
      }
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
    const result = await waitForUiBridgeRegistration(uiBridgeBase, waitForUiBridgeMs);
    uiBridgeRegistered = result.ok;
    tabId = result.tabId;
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await browser.close();
    } catch {
      // ignore — best-effort teardown
    }
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
}
