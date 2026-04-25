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

/** Context shape delivered to each headless/headed handler. */
export interface HeadlessContext {
  readonly kind: 'headless' | 'headed';
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

  private tab: {
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
    // Lazy-import so api-only wrappers that never build the headless
    // transport don't pay the Playwright resolution cost. Headless is a
    // hard dep, so the import is always resolvable — but deferring it
    // keeps startup snappy.
    const { launchHeadlessTab } = await import('@qontinui/ui-bridge-headless');

    const tab = await launchHeadlessTab({
      url: this.options.targetUrl,
      headless: this.headless,
      uiBridgeBase: this.options.uiBridgeBase,
      waitForUiBridgeMs: this.options.waitForUiBridgeMs,
      viewportWidth: this.options.viewportWidth,
      viewportHeight: this.options.viewportHeight,
      userAgent: this.options.userAgent,
      forwardConsole: this.options.forwardConsole,
    });

    this.tab = {
      browser: tab.browser,
      context: tab.context,
      page: tab.page,
      uiBridgeRegistered: tab.uiBridgeRegistered,
      tabId: tab.tabId,
      close: tab.close,
    };
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
