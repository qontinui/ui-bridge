/**
 * HeadlessTransport
 *
 * Wraps `@qontinui/ui-bridge-headless`'s `launchHeadlessTab` to own a
 * Playwright Chromium lifecycle. The transport's job is lifecycle only:
 *
 *   - Launch the browser on `ready()` and navigate to `options.targetUrl`.
 *   - Expose the `page` / `context` / `browser` via a `HeadlessContext`
 *     that each handler receives.
 *   - Close everything on `close()`.
 *
 * Action code lives in the wrapper's handler registrations, not in the
 * transport. Headless and headed differ only in the `headless` flag.
 */

import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { BaseTransport } from '../base-transport.js';
import { HandlerRegistry } from '../handler-registry.js';
import type { TransportConfig, WrapperTransportKind } from '../types.js';
import { WrapperTransportError } from '../types.js';

/** Options extracted from `TransportConfig.options` for headless/headed. */
export interface HeadlessTransportOptions {
  /** URL to navigate to on first `ready()`. Required. */
  targetUrl: string;
  /** Viewport width in px. Defaults to 1280. */
  viewportWidth?: number;
  /** Viewport height in px. Defaults to 720. */
  viewportHeight?: number;
  /**
   * Device scale factor of the browser context — what the page reads as
   * `window.devicePixelRatio`. Defaults to Playwright's (1). Applied as a
   * CONTEXT option by `launchHeadlessTab`; a Chromium launch flag would be
   * overridden by the viewport emulation and never reach the page.
   */
  deviceScaleFactor?: number;
  /** `prefers-color-scheme` the context emulates. Defaults to no override. */
  colorScheme?: 'light' | 'dark';
  /**
   * UI Bridge relay base URL. If provided, `ready()` blocks until the relay
   * confirms the tab registered. Mirrors `launchHeadlessTab` behavior.
   */
  uiBridgeBase?: string;
  /** Max time to wait for UI Bridge registration. Defaults to 30 000. */
  waitForUiBridgeMs?: number;
  /** User agent override. */
  userAgent?: string;
  /** Forward browser console/page errors to the Node process stderr. */
  forwardConsole?: boolean;
  /**
   * Extra Chromium command-line arguments passed through to
   * `chromium.launch({ args })` (e.g. the LNA-disable flags needed to fetch
   * a loopback relay from an https page). Plan 2026-06-12 item 2.
   */
  launchArgs?: string[];
  /**
   * Path to a Playwright `storageState` JSON file (cookies + localStorage)
   * to seed the browser context with before the first navigation. Lets a
   * previously-captured authenticated session (e.g. from
   * `ui-bridge-login-web --storage-state-out`) carry past a login wall so an
   * autonomous loop can drive a login-walled page repeatedly without
   * re-driving the hosted-UI login. Threaded to `launchHeadlessTab`'s
   * `storageStatePath`.
   */
  storageStatePath?: string;
  /**
   * Record a HAR of every request the browser context makes: Playwright's own
   * `recordHar` shape (`{ path, content?, mode?, urlFilter?, omitContent? }`),
   * passed to the launcher's `newContext` unchanged. Playwright writes the
   * archive when the context closes, which this transport's `close()` does
   * (the launcher closes the context before the browser), so the file is
   * complete once `close()` resolves. A launch that fails inside the launcher
   * writes no HAR. A `ready()` that fails AFTER the launch (an emulation
   * refusal, an injected-runtime wait) may still leave a
   * complete archive, because the tab is closed through the context, so a
   * missing file is not how to tell that `ready()` failed.
   */
  recordHar?: NonNullable<BrowserContextOptions['recordHar']>;
  /**
   * `'block'` stops pages registering service workers. A service worker
   * answers requests itself, so they reach neither `recordHar` nor a route
   * installed by `initRouter`; block them when either must see every request.
   * Unset: Playwright's default (`'allow'`).
   */
  serviceWorkers?: NonNullable<BrowserContextOptions['serviceWorkers']>;
  /**
   * Called with the browser context after it is created and before its first
   * page exists, so a `context.route('**\/*', …)` it installs intercepts the
   * first navigation's own document request. If it throws, `ready()` fails
   * and the browser is closed.
   */
  initRouter?: (context: BrowserContext) => void | Promise<void>;
}

/**
 * Local structural type for `@qontinui/ui-bridge-headless`'s `launchHeadlessTab`,
 * declared here so the wrapper's `tsc` build does NOT depend on the headless
 * package's declaration files.
 *
 * Headless is an OPTIONAL peer (package.json `peerDependenciesMeta`): a clean
 * checkout that only ever uses the api/relay transports never installs it, so a
 * `typeof import('@qontinui/ui-bridge-headless')` type reference would make the
 * build fail to resolve the module. It is also brittle against dist/source skew
 * in the workspace link (a stale headless `dist/*.d.ts` would fail the wrapper
 * build even though the runtime `await import()` resolves the up-to-date impl).
 *
 * Only the call shape the wrapper actually uses is modelled. The runtime import
 * stays lazy (`await import(...)`) and is the single source of truth for the
 * real implementation.
 */
interface LaunchHeadlessTabArgs {
  url: string;
  headless: boolean;
  uiBridgeBase?: string;
  waitForUiBridgeMs?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  deviceScaleFactor?: number;
  colorScheme?: 'light' | 'dark';
  userAgent?: string;
  forwardConsole?: boolean;
  initScripts?: string[];
  launchArgs?: string[];
  storageStatePath?: string;
  recordHar?: NonNullable<BrowserContextOptions['recordHar']>;
  serviceWorkers?: NonNullable<BrowserContextOptions['serviceWorkers']>;
  initRouter?: (context: BrowserContext) => void | Promise<void>;
}

interface LaunchedHeadlessTab {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  uiBridgeRegistered: boolean;
  tabId: string | null;
  close: () => Promise<void>;
}

type LaunchHeadlessTabFn = (args: LaunchHeadlessTabArgs) => Promise<LaunchedHeadlessTab>;

/** Context shape delivered to each headless/headed handler. */
export interface HeadlessContext {
  readonly kind: 'headless' | 'headed' | 'injected';
  readonly page: Page;
  readonly browserContext: BrowserContext;
  readonly browser: Browser;
  /** True once the UI Bridge relay confirmed the tab is registered. */
  readonly uiBridgeRegistered: boolean;
  /** Relay-assigned tab id, when known. */
  readonly tabId: string | null;
}

/**
 * Shared implementation used by both `HeadlessTransport` and
 * `HeadedTransport` — they differ only in the `headless` launch flag and
 * their reported `kind`.
 */
export class HeadlessTransport extends BaseTransport {
  readonly kind: WrapperTransportKind;
  protected readonly options: HeadlessTransportOptions;
  protected readonly headless: boolean;

  protected tab: {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    uiBridgeRegistered: boolean;
    tabId: string | null;
    close: () => Promise<void>;
  } | null = null;

  constructor(
    config: TransportConfig,
    registry?: HandlerRegistry,
    overrides: { kind?: WrapperTransportKind; headless?: boolean } = {}
  ) {
    super(registry);
    this.kind = overrides.kind ?? 'headless';
    this.headless = overrides.headless ?? true;
    this.options = this.parseOptions(config);
  }

  private parseOptions(config: TransportConfig): HeadlessTransportOptions {
    const raw = (config.options ?? {}) as Record<string, unknown>;
    const targetUrl = raw['targetUrl'];
    if (typeof targetUrl !== 'string' || targetUrl.length === 0) {
      throw new WrapperTransportError(
        'INVALID_CONFIG',
        `Transport kind '${this.kind}' requires options.targetUrl (string)`
      );
    }
    return {
      targetUrl,
      viewportWidth:
        typeof raw['viewportWidth'] === 'number' ? (raw['viewportWidth'] as number) : undefined,
      viewportHeight:
        typeof raw['viewportHeight'] === 'number' ? (raw['viewportHeight'] as number) : undefined,
      deviceScaleFactor:
        typeof raw['deviceScaleFactor'] === 'number'
          ? (raw['deviceScaleFactor'] as number)
          : undefined,
      colorScheme:
        raw['colorScheme'] === 'light' || raw['colorScheme'] === 'dark'
          ? (raw['colorScheme'] as 'light' | 'dark')
          : undefined,
      uiBridgeBase:
        typeof raw['uiBridgeBase'] === 'string' ? (raw['uiBridgeBase'] as string) : undefined,
      waitForUiBridgeMs:
        typeof raw['waitForUiBridgeMs'] === 'number'
          ? (raw['waitForUiBridgeMs'] as number)
          : undefined,
      userAgent: typeof raw['userAgent'] === 'string' ? (raw['userAgent'] as string) : undefined,
      forwardConsole:
        typeof raw['forwardConsole'] === 'boolean' ? (raw['forwardConsole'] as boolean) : undefined,
      launchArgs:
        Array.isArray(raw['launchArgs']) &&
        (raw['launchArgs'] as unknown[]).every((a) => typeof a === 'string')
          ? (raw['launchArgs'] as string[])
          : undefined,
      storageStatePath:
        typeof raw['storageStatePath'] === 'string'
          ? (raw['storageStatePath'] as string)
          : undefined,
      ...this.parseContextOptions(raw),
    };
  }

  /**
   * `recordHar`, `serviceWorkers` and `initRouter`. Unlike the display
   * options above, a malformed value is REFUSED rather than dropped: dropping
   * `recordHar` would leave a caller waiting for an archive that is never
   * written, and dropping `initRouter` would let requests it meant to answer
   * reach the network.
   */
  private parseContextOptions(
    raw: Record<string, unknown>
  ): Pick<HeadlessTransportOptions, 'recordHar' | 'serviceWorkers' | 'initRouter'> {
    const out: Pick<HeadlessTransportOptions, 'recordHar' | 'serviceWorkers' | 'initRouter'> = {};
    const invalid = (what: string) =>
      new WrapperTransportError('INVALID_CONFIG', `Transport kind '${this.kind}': ${what}`);
    const har = raw['recordHar'];
    if (har !== undefined) {
      if (
        typeof har !== 'object' ||
        har === null ||
        typeof (har as { path?: unknown }).path !== 'string' ||
        (har as { path: string }).path.length === 0
      ) {
        throw invalid('options.recordHar must be an object with a non-empty string `path`');
      }
      out.recordHar = har as NonNullable<HeadlessTransportOptions['recordHar']>;
    }
    const sw = raw['serviceWorkers'];
    if (sw !== undefined) {
      if (sw !== 'allow' && sw !== 'block') {
        throw invalid(`options.serviceWorkers must be 'allow' or 'block' (got ${String(sw)})`);
      }
      out.serviceWorkers = sw;
    }
    const router = raw['initRouter'];
    if (router !== undefined) {
      if (typeof router !== 'function') {
        throw invalid('options.initRouter must be a function (context) => void | Promise<void>');
      }
      out.initRouter = router as NonNullable<HeadlessTransportOptions['initRouter']>;
    }
    return out;
  }

  protected async onReady(): Promise<void> {
    // Lazy-import so api-only wrappers that never build the headless transport
    // don't pay the Playwright resolution cost. `@qontinui/ui-bridge-headless`
    // is an OPTIONAL peer (package.json peerDependenciesMeta), so the import is
    // NOT guaranteed resolvable — a bare `npx @qontinui/ui-bridge-wrapper …`
    // does not install peers. Catch the resolution failure and surface an
    // actionable install hint instead of a raw ERR_MODULE_NOT_FOUND.
    // Typed via the local `LaunchHeadlessTabFn` (see above) rather than a
    // `typeof import(...)` reference, so this build never needs the optional
    // peer's declaration files. The specifier is split out of the literal so
    // bundlers/`tsc` cannot eagerly resolve the optional peer at build time.
    let launchHeadlessTab: LaunchHeadlessTabFn;
    const headlessSpecifier = '@qontinui/ui-bridge-headless';
    try {
      const mod = (await import(headlessSpecifier)) as {
        launchHeadlessTab: LaunchHeadlessTabFn;
      };
      ({ launchHeadlessTab } = mod);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      // Only a genuine resolution failure means "the peer is not installed".
      // Anything else (a broken install, a missing TRANSITIVE dep, version
      // skew making the module throw on evaluation) must NOT tell the user to
      // install a package they already have.
      if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
        throw new WrapperTransportError(
          'INVALID_CONFIG',
          `Transport kind '${this.kind}' needs the optional '@qontinui/ui-bridge-headless' ` +
            `peer, which is not installed. Install it and the Chromium browser:\n` +
            `  npm i @qontinui/ui-bridge-headless && npx playwright install chromium\n` +
            `(bare \`npx @qontinui/ui-bridge-wrapper …\` does NOT install peers — pass each ` +
            `peer with \`-p\`, e.g.\n` +
            `  npx -y -p @qontinui/ui-bridge-wrapper -p @qontinui/ui-bridge -p @qontinui/ui-bridge-headless -p playwright ui-bridge-login-web …)\n` +
            `Underlying import error: ${cause}`
        );
      }
      throw new WrapperTransportError(
        'INVALID_CONFIG',
        `'@qontinui/ui-bridge-headless' is installed but failed to load — this is a ` +
          `broken install (missing transitive dependency or version skew), not a ` +
          `missing peer. Try reinstalling it. Underlying error: ${cause}`
      );
    }

    // Subclasses (injected) supply init-scripts to run before first paint.
    const initScripts = await this.buildInitScripts();

    // Subclasses (injected) supply the relay credentials. The launcher's
    // `<uiBridgeBase>/tabs` registration poll runs in NODE, not the page, so it
    // needs the bearer separately from the page-side client — against a gated
    // relay an anonymous poll 401s and reports `tabId: null` on a launch that
    // actually succeeded.
    const relayAuth = this.relayAuth();
    // A pinned launch must find ITS tab, not whichever tab registered first.
    const pinnedTabId = this.pinnedTabId();

    // recordHar / serviceWorkers / initRouter came to the launcher together
    // (ui-bridge#381). An older optional peer accepts the
    // keys and ignores them: no HAR, service workers allowed, no routes. The
    // launcher calls `initRouter` before its first page exists, so whenever
    // any of the three is set the transport ALWAYS passes one, and (except
    // for `serviceWorkers: 'allow'` alone, below) treats "it was never
    // called" as proof the peer dropped all three.
    const { recordHar, serviceWorkers, initRouter: callerRouter } = this.options;
    // `serviceWorkers: 'allow'` is Playwright's default, so a peer that drops
    // it still behaves as asked: it alone does not demand the proof.
    const contextOptionsRequested =
      recordHar !== undefined || serviceWorkers === 'block' || callerRouter !== undefined;
    let routerCalled = false;
    const initRouter =
      contextOptionsRequested || serviceWorkers !== undefined
        ? async (context: BrowserContext): Promise<void> => {
            routerCalled = true;
            if (callerRouter) await callerRouter(context);
          }
        : undefined;

    let tab: Awaited<ReturnType<typeof launchHeadlessTab>>;
    try {
      tab = await launchHeadlessTab({
        url: this.options.targetUrl,
        headless: this.headless,
        uiBridgeBase: this.options.uiBridgeBase,
        waitForUiBridgeMs: this.options.waitForUiBridgeMs,
        viewportWidth: this.options.viewportWidth,
        viewportHeight: this.options.viewportHeight,
        ...(this.options.deviceScaleFactor !== undefined
          ? { deviceScaleFactor: this.options.deviceScaleFactor }
          : {}),
        ...(this.options.colorScheme !== undefined
          ? { colorScheme: this.options.colorScheme }
          : {}),
        userAgent: this.options.userAgent,
        forwardConsole: this.options.forwardConsole,
        initScripts: initScripts.length > 0 ? initScripts : undefined,
        launchArgs:
          this.options.launchArgs && this.options.launchArgs.length > 0
            ? this.options.launchArgs
            : undefined,
        storageStatePath: this.options.storageStatePath,
        ...(relayAuth.authToken ? { authToken: relayAuth.authToken } : {}),
        ...(relayAuth.callerUserId ? { callerUserId: relayAuth.callerUserId } : {}),
        ...(pinnedTabId ? { pinnedTabId } : {}),
        ...(recordHar !== undefined ? { recordHar } : {}),
        ...(serviceWorkers !== undefined ? { serviceWorkers } : {}),
        ...(initRouter ? { initRouter } : {}),
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      // The other half of the first-run story: the peer resolved but the
      // Chromium binary was never installed. Playwright's raw "Executable
      // doesn't exist at <path>" surfaces several frames deep — translate it
      // into the same actionable shape as the missing-peer error above.
      if (/Executable doesn't exist|browserType\.launch/i.test(cause)) {
        throw new WrapperTransportError(
          'INVALID_CONFIG',
          `Playwright's Chromium browser is not installed (the ` +
            `'@qontinui/ui-bridge-headless' peer itself loaded fine). Run:\n` +
            `  npx playwright install chromium\n` +
            `Underlying launch error: ${cause}`
        );
      }
      throw err;
    }

    this.tab = {
      browser: tab.browser,
      context: tab.context,
      page: tab.page,
      uiBridgeRegistered: tab.uiBridgeRegistered,
      tabId: tab.tabId,
      close: tab.close,
    };

    if (contextOptionsRequested && !routerCalled) {
      await this.onClose().catch(() => {});
      throw new WrapperTransportError(
        'CONTEXT_OPTIONS_NOT_APPLIED',
        `The installed '@qontinui/ui-bridge-headless' peer launched the tab without calling ` +
          `initRouter, so it predates the recordHar / serviceWorkers / initRouter passthrough ` +
          `(ui-bridge#381) and ignored them: no HAR would be written and no route ` +
          `installed. Upgrade it.`,
        {
          details: {
            requested: {
              recordHar: recordHar !== undefined,
              serviceWorkers: serviceWorkers ?? null,
              initRouter: callerRouter !== undefined,
            },
          },
        }
      );
    }

    // A requested emulation is VERIFIED on the page before anything is driven
    // through it. The launcher is an optional peer resolved at run time, and a
    // `@qontinui/ui-bridge-headless` that predates `deviceScaleFactor` /
    // `colorScheme` would accept the extra keys and silently ignore them — a
    // DPR-1 page measured as if it were DPR 2.
    await this.verifyEmulation(tab.page);

    // Subclass hook: block until the page-side runtime is ready (e.g. the
    // injected bundle reports `window.__uiBridgeInjected.ready === true`).
    await this.afterLaunch(tab.page);
  }

  /**
   * Read back the requested device scale factor and colour scheme from the
   * page itself, and refuse a launch whose page reports anything else.
   */
  private async verifyEmulation(page: Page): Promise<void> {
    const wantDpr = this.options.deviceScaleFactor;
    const wantScheme = this.options.colorScheme;
    if (wantDpr === undefined && wantScheme === undefined) return;
    const seen = await page.evaluate(() => ({
      dpr: window.devicePixelRatio,
      dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    }));
    const problems: string[] = [];
    if (wantDpr !== undefined && Math.abs(seen.dpr - wantDpr) > 1e-9) {
      problems.push(`devicePixelRatio ${seen.dpr} (requested ${wantDpr})`);
    }
    if (wantScheme !== undefined && seen.dark !== (wantScheme === 'dark')) {
      problems.push(
        `prefers-color-scheme ${seen.dark ? 'dark' : 'light'} (requested ${wantScheme})`
      );
    }
    if (problems.length === 0) return;
    await this.onClose().catch(() => {});
    throw new WrapperTransportError(
      'EMULATION_NOT_APPLIED',
      `The launched page reports ${problems.join(' and ')}. The installed ` +
        `'@qontinui/ui-bridge-headless' peer most likely predates deviceScaleFactor/colorScheme ` +
        `support (added after 0.5.0) and ignored them; upgrade it. A page measured at an ` +
        `emulation it is not actually rendering at would be stamped with the wrong values.`,
      { details: { requested: { deviceScaleFactor: wantDpr, colorScheme: wantScheme }, seen } }
    );
  }

  /**
   * Subclass hook: init-scripts to register on the browser context before the
   * first navigation (via `context.addInitScript`). Default: none. Injected
   * mode overrides this to inject the config + runtime bundle pre-paint.
   */
  protected async buildInitScripts(): Promise<string[]> {
    return [];
  }

  /**
   * Subclass hook: credentials for the launcher's Node-side relay registration
   * poll (`<uiBridgeBase>/tabs`). Default: none (anonymous poll — correct for an
   * ungated relay). Injected mode overrides this with the `--auth-token` bearer
   * and the `--registration-metadata` userId.
   */
  protected relayAuth(): { authToken?: string; callerUserId?: string } {
    return {};
  }

  /**
   * Subclass hook: the tab id this launch pinned, so the registration poll
   * returns that tab only. Default: none. Injected mode returns `--tab-id`.
   */
  protected pinnedTabId(): string | undefined {
    return undefined;
  }

  /**
   * Subclass hook: run after launch + navigation, before `ready()` resolves.
   * Default: no-op. Injected mode overrides it to await the in-page runtime.
   */
  protected async afterLaunch(_page: Page): Promise<void> {
    // no-op for headless/headed
  }

  protected async onClose(): Promise<void> {
    if (!this.tab) return;
    const t = this.tab;
    this.tab = null;
    await t.close();
  }

  protected async buildContext(): Promise<HeadlessContext> {
    if (!this.tab) {
      throw new WrapperTransportError(
        'NOT_READY',
        `Transport '${this.kind}' is not ready; call ready() before dispatch`
      );
    }
    return {
      kind: this.kind as 'headless' | 'headed',
      page: this.tab.page,
      browserContext: this.tab.context,
      browser: this.tab.browser,
      uiBridgeRegistered: this.tab.uiBridgeRegistered,
      tabId: this.tab.tabId,
    };
  }
}
