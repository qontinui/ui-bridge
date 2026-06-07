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

import type { Browser, BrowserContext, Page } from 'playwright';
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
  userAgent?: string;
  forwardConsole?: boolean;
  initScripts?: string[];
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
      uiBridgeBase:
        typeof raw['uiBridgeBase'] === 'string' ? (raw['uiBridgeBase'] as string) : undefined,
      waitForUiBridgeMs:
        typeof raw['waitForUiBridgeMs'] === 'number'
          ? (raw['waitForUiBridgeMs'] as number)
          : undefined,
      userAgent: typeof raw['userAgent'] === 'string' ? (raw['userAgent'] as string) : undefined,
      forwardConsole:
        typeof raw['forwardConsole'] === 'boolean' ? (raw['forwardConsole'] as boolean) : undefined,
    };
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

    let tab: Awaited<ReturnType<typeof launchHeadlessTab>>;
    try {
      tab = await launchHeadlessTab({
        url: this.options.targetUrl,
        headless: this.headless,
        uiBridgeBase: this.options.uiBridgeBase,
        waitForUiBridgeMs: this.options.waitForUiBridgeMs,
        viewportWidth: this.options.viewportWidth,
        viewportHeight: this.options.viewportHeight,
        userAgent: this.options.userAgent,
        forwardConsole: this.options.forwardConsole,
        initScripts: initScripts.length > 0 ? initScripts : undefined,
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

    // Subclass hook: block until the page-side runtime is ready (e.g. the
    // injected bundle reports `window.__uiBridgeInjected.ready === true`).
    await this.afterLaunch(tab.page);
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
