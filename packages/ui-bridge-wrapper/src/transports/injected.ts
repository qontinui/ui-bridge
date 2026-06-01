/**
 * InjectedTransport
 *
 * The fourth-and-a-half delivery mode: drive UI Bridge's **semantic**
 * automation (find / act / snapshot / assert) against a page that ships
 * **zero** UI Bridge code, by injecting the engine bundle at automation time.
 *
 * Subclasses {@link HeadlessTransport} to reuse the Chromium launch/close
 * lifecycle. It differs in exactly two ways (plan §3.1):
 *   1. it injects `@qontinui/ui-bridge`'s `dist/injected/bundle.global.js`
 *      (plus an optional relay-config sibling) as init-scripts BEFORE first
 *      paint, so `window.__uiBridgeInjected` exists before the page's own
 *      scripts run;
 *   2. `buildContext()` returns an {@link InjectedContext} exposing semantic
 *      methods backed by the in-page runtime via `page.evaluate`, instead of
 *      the raw Playwright `page`.
 *
 * The production page is unchanged — nothing is shipped onto the real site;
 * the control surface exists only inside the browser this transport launched
 * (plan §3.6). When `options.uiBridgeBase` is set, the injected runtime also
 * registers as a relay tab (Variant B) so existing orchestrators drive it
 * through the same `/control/*` plane as embedded apps.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { HeadlessTransport, type HeadlessContext } from './headless.js';
import { HandlerRegistry } from '../handler-registry.js';
import type { TransportConfig } from '../types.js';
import { WrapperTransportError } from '../types.js';

const require = createRequire(import.meta.url);

/** Lazily-loaded, cached injected runtime bundle (the IIFE text). */
let cachedBundle: string | null = null;

/** Resolve + read `@qontinui/ui-bridge`'s injected runtime IIFE bundle. */
function loadInjectedBundle(): string {
  if (cachedBundle !== null) return cachedBundle;
  let bundlePath: string;
  try {
    bundlePath = require.resolve('@qontinui/ui-bridge/injected/bundle.global.js');
  } catch {
    // Fallback for resolvers that don't honor the subpath export: locate the
    // package root via its package.json and join the dist path.
    const pkgJson = require.resolve('@qontinui/ui-bridge/package.json');
    bundlePath = pkgJson.replace(/package\.json$/, 'dist/injected/bundle.global.js');
  }
  try {
    cachedBundle = readFileSync(bundlePath, 'utf8');
  } catch (cause) {
    throw new WrapperTransportError(
      'INJECTED_BUNDLE_MISSING',
      `Could not read the UI Bridge injected runtime bundle at '${bundlePath}'. ` +
        `Ensure @qontinui/ui-bridge is built (the IIFE is emitted by its tsup build).`,
      { cause }
    );
  }
  return cachedBundle;
}

/** Injected-specific options parsed from `TransportConfig.options`. */
interface InjectedExtraOptions {
  /** Launch with a visible window (debugging). Default false (headless). */
  headed: boolean;
  /** Max ms to wait for `window.__uiBridgeInjected.ready`. Default 30000. */
  readyTimeoutMs: number;
  /**
   * Whether `ready()` waits for the in-page runtime to report `settled` (DOM
   * quiet after content appeared), not merely `ready` (runtime live, registry
   * possibly still empty on a client-rendered SPA). Default true — this is the
   * fix that lets a driver snapshot immediately after `ready()` without polling
   * through hydration. Set false to revert to ready-only gating.
   */
  waitForSettle: boolean;
  /** Quiet window (ms) before the runtime declares itself settled. Default 500. */
  settleQuietMs?: number;
  /** Hard cap (ms) after which the runtime settles regardless. Default 10000. */
  settleTimeoutMs?: number;
  /**
   * CSS selector that must match before the DOM counts as settled. Without it,
   * settle fires on any content going quiet — which can be unrelated chrome that
   * paints before a lazily-mounted target control. With it, `ready()` waits for
   * the TARGET; and if the selector never matches before the settle cap,
   * `afterLaunch` throws `INJECTED_EXPECT_SELECTOR_UNMET` instead of returning a
   * page that's missing the control.
   */
  expectSelector?: string;
  /** Bearer token for the auth-gated relay (Variant B). */
  authToken?: string;
  /** Strict per-user tab-scoping metadata for relay heartbeats (Variant B). */
  registrationMetadata?: { userId: string; sessionId: string };
  /** App id reported to the relay registry (Variant B). */
  appId?: string;
  /** Display name reported to the relay registry (Variant B). */
  appName?: string;
  /** Stable per-tab id override (Variant B). */
  tabId?: string;
}

/** In-page settle state surfaced by {@link InjectedContext.settleState}/`whenSettled`. */
export interface InjectedSettleState {
  /** True once the DOM has settled (gated quiet window, or the hard cap). */
  settled: boolean;
  /** Interactive elements registered as of the most recent seed pass. */
  elementCount: number;
  /** True when settle was forced by the cap rather than a clean quiet window. */
  settledByTimeout: boolean;
  /** Whether the gating condition (content / expectSelector) was met. */
  expectSatisfied: boolean;
}

/**
 * Semantic context delivered to each injected handler. Extends
 * {@link HeadlessContext} (so drivers still get the raw `page` / `browser` /
 * `browserContext` handles for lower-level access) and adds the semantic
 * surface. `execute` is the generic escape hatch (any relay action id); the
 * named methods are typed conveniences over the most common ones. All run in
 * the page realm via `page.evaluate(window.__uiBridgeInjected.execute(...))`.
 */
export interface InjectedContext extends HeadlessContext {
  readonly kind: 'injected';
  /** True once the injected runtime reported ready (always true post-`ready()`). */
  readonly ready: boolean;
  /**
   * Re-read the in-page runtime's current settle state. After `ready()` with
   * the default `waitForSettle`, this is already `settled: true`; it's exposed
   * for drivers that disabled settle-gating or want the live element count.
   * `settledByTimeout` + `expectSatisfied: false` means the gate never met.
   */
  settleState(): Promise<InjectedSettleState>;
  /**
   * Wait for the in-page runtime to report settled (DOM quiet after content),
   * or `timeoutMs`. Useful after a soft-navigation re-render when the caller
   * wants to re-settle before the next assertion.
   */
  whenSettled(timeoutMs?: number): Promise<InjectedSettleState>;
  /** Run any relay action against the in-page runtime. */
  execute<T = unknown>(action: string, payload?: unknown): Promise<T>;
  /** Semantic find — by label / text / role / type / testId. */
  find(criteria?: Record<string, unknown>): Promise<unknown>;
  /** Act on an element by registry id: `{ action: 'click' | 'type' | ... }`. */
  act(id: string, request: Record<string, unknown>): Promise<unknown>;
  /** Read the interactive-element control snapshot. */
  snapshot(options?: Record<string, unknown>): Promise<unknown>;
  /** Assert a user-visible outcome (NL `{assertion}` or `{target,type,expected}`). */
  assert(spec: Record<string, unknown>): Promise<unknown>;
}

export class InjectedTransport extends HeadlessTransport {
  private readonly injected: InjectedExtraOptions;

  constructor(config: TransportConfig, registry?: HandlerRegistry) {
    const raw = (config.options ?? {}) as Record<string, unknown>;
    const headed = raw['headed'] === true;
    super(config, registry, { kind: 'injected', headless: !headed });
    this.injected = {
      headed,
      readyTimeoutMs:
        typeof raw['readyTimeoutMs'] === 'number' ? (raw['readyTimeoutMs'] as number) : 30_000,
      waitForSettle: raw['waitForSettle'] !== false,
      settleQuietMs:
        typeof raw['settleQuietMs'] === 'number' ? (raw['settleQuietMs'] as number) : undefined,
      settleTimeoutMs:
        typeof raw['settleTimeoutMs'] === 'number' ? (raw['settleTimeoutMs'] as number) : undefined,
      expectSelector:
        typeof raw['expectSelector'] === 'string' && (raw['expectSelector'] as string).length > 0
          ? (raw['expectSelector'] as string)
          : undefined,
      authToken: typeof raw['authToken'] === 'string' ? (raw['authToken'] as string) : undefined,
      registrationMetadata: isRegistrationMetadata(raw['registrationMetadata'])
        ? (raw['registrationMetadata'] as { userId: string; sessionId: string })
        : undefined,
      appId: typeof raw['appId'] === 'string' ? (raw['appId'] as string) : undefined,
      appName: typeof raw['appName'] === 'string' ? (raw['appName'] as string) : undefined,
      tabId: typeof raw['tabId'] === 'string' ? (raw['tabId'] as string) : undefined,
    };
  }

  /**
   * Build the `__uiBridgeInjectedConfig` injected ahead of the bundle, or null
   * if there's nothing to configure. Carries the relay fields (Variant B only,
   * when `uiBridgeBase` is set) AND the settle-tuning fields (both variants).
   */
  private injectedConfig(): Record<string, unknown> | null {
    const cfg: Record<string, unknown> = {};
    const base = this.options.uiBridgeBase;
    if (base) {
      cfg.uiBridgeBase = base;
      if (this.injected.authToken) cfg.authToken = this.injected.authToken;
      if (this.injected.registrationMetadata)
        cfg.registrationMetadata = this.injected.registrationMetadata;
      if (this.injected.appId) cfg.appId = this.injected.appId;
      if (this.injected.appName) cfg.appName = this.injected.appName;
      if (this.injected.tabId) cfg.tabId = this.injected.tabId;
    }
    if (this.injected.settleQuietMs !== undefined)
      cfg.settleQuietMs = this.injected.settleQuietMs;
    if (this.injected.settleTimeoutMs !== undefined)
      cfg.settleTimeoutMs = this.injected.settleTimeoutMs;
    if (this.injected.expectSelector !== undefined)
      cfg.expectSelector = this.injected.expectSelector;
    return Object.keys(cfg).length > 0 ? cfg : null;
  }

  protected override async buildInitScripts(): Promise<string[]> {
    const scripts: string[] = [];
    // Config first so it exists when the bundle's init-script runs.
    const cfg = this.injectedConfig();
    if (cfg) {
      scripts.push(`window.__uiBridgeInjectedConfig = ${JSON.stringify(cfg)};`);
    }
    scripts.push(loadInjectedBundle());
    return scripts;
  }

  protected override async afterLaunch(page: Page): Promise<void> {
    // Resolve `ready()` only once the in-page runtime reports ready
    // (success criterion 1). The bundle flips `ready` after seeding the
    // registry on DOM-ready.
    try {
      await page.waitForFunction(
        () =>
          (window as unknown as { __uiBridgeInjected?: { ready?: boolean } }).__uiBridgeInjected
            ?.ready === true,
        undefined,
        { timeout: this.injected.readyTimeoutMs }
      );
    } catch (cause) {
      throw new WrapperTransportError(
        'INJECTED_RUNTIME_NOT_READY',
        `The injected UI Bridge runtime did not report ready within ` +
          `${this.injected.readyTimeoutMs}ms. The bundle may have failed to ` +
          `evaluate (check page console / CSP) or the page never reached DOMContentLoaded.`,
        { cause, retryable: true }
      );
    }

    // Then wait for the DOM to SETTLE (content painted + quiet) so the driver
    // can snapshot immediately after ready() without polling through SPA
    // hydration. The runtime always settles eventually (its own hard cap), so
    // this resolves the in-page `whenSettled()` rather than racing a Playwright
    // poll; we still bound the outer wait by readyTimeoutMs as a backstop in
    // case the page realm wedged.
    if (this.injected.waitForSettle) {
      let state: {
        settled: boolean;
        settledByTimeout: boolean;
        expectSatisfied: boolean;
        elementCount: number;
      };
      try {
        await page.waitForFunction(
          () =>
            (
              window as unknown as { __uiBridgeInjected?: { settled?: boolean } }
            ).__uiBridgeInjected?.settled === true,
          undefined,
          { timeout: this.injected.readyTimeoutMs }
        );
        state = await page.evaluate(() => {
          const api = (
            window as unknown as {
              __uiBridgeInjected?: {
                settled?: boolean;
                settledByTimeout?: boolean;
                expectSatisfied?: boolean;
                elementCount?: number;
              };
            }
          ).__uiBridgeInjected;
          return {
            settled: api?.settled === true,
            settledByTimeout: api?.settledByTimeout === true,
            expectSatisfied: api?.expectSatisfied === true,
            elementCount: api?.elementCount ?? 0,
          };
        });
      } catch (cause) {
        throw new WrapperTransportError(
          'INJECTED_RUNTIME_NOT_SETTLED',
          `The injected UI Bridge runtime did not report settled within ` +
            `${this.injected.readyTimeoutMs}ms. The page kept mutating past its ` +
            `settle cap, or the realm was torn down. Pass options.waitForSettle=false ` +
            `to gate on ready only, or raise options.settleTimeoutMs / readyTimeoutMs.`,
          { cause, retryable: true }
        );
      }

      // The runtime settled, but distinguish a clean settle from "the cap fired
      // while the gating condition was still unmet". With an expectSelector that
      // means the target control never appeared; without one it means the page
      // stayed empty. Either way the page is NOT drivable — surface it as a
      // structured error rather than handing back a control-less page that the
      // caller would mis-read as a clean snapshot.
      if (state.settledByTimeout && !state.expectSatisfied) {
        const sel = this.injected.expectSelector;
        throw new WrapperTransportError(
          'INJECTED_EXPECT_SELECTOR_UNMET',
          sel
            ? `The injected runtime settled at its cap without the expected control ` +
                `(selector '${sel}') appearing — ${state.elementCount} element(s) were ` +
                `registered, but none matched. The control may mount slower than the ` +
                `settle cap (raise options.settleTimeoutMs), the selector may be wrong, ` +
                `or the inject failed. Treat as BLOCKED/UNVERIFIED, not a clean page.`
            : `The injected runtime settled at its cap with an empty registry ` +
                `(0 elements). The page never rendered interactive content within ` +
                `the settle cap, or the inject failed. Raise options.settleTimeoutMs ` +
                `for a slow page; otherwise treat as BLOCKED/UNVERIFIED.`,
          { retryable: true }
        );
      }
    }
  }

  protected override async buildContext(): Promise<InjectedContext> {
    if (!this.tab) {
      throw new WrapperTransportError(
        'NOT_READY',
        `Transport 'injected' is not ready; call ready() before dispatch`
      );
    }
    const { page, context: browserContext, browser, uiBridgeRegistered, tabId } = this.tab;

    const execute = <T = unknown>(action: string, payload?: unknown): Promise<T> =>
      page.evaluate(
        (args: [string, unknown]) =>
          (
            window as unknown as {
              __uiBridgeInjected: { execute(a: string, p?: unknown): Promise<unknown> };
            }
          ).__uiBridgeInjected.execute(args[0], args[1]),
        [action, payload] as [string, unknown]
      ) as Promise<T>;

    const settleState = (): Promise<InjectedSettleState> =>
      page.evaluate(() => {
        const api = (
          window as unknown as {
            __uiBridgeInjected?: {
              settled?: boolean;
              elementCount?: number;
              settledByTimeout?: boolean;
              expectSatisfied?: boolean;
            };
          }
        ).__uiBridgeInjected;
        return {
          settled: api?.settled === true,
          elementCount: api?.elementCount ?? 0,
          settledByTimeout: api?.settledByTimeout === true,
          expectSatisfied: api?.expectSatisfied === true,
        };
      });

    const whenSettled = (timeoutMs?: number): Promise<InjectedSettleState> =>
      page.evaluate(
        (ms: number | null) => {
          const api = (
            window as unknown as {
              __uiBridgeInjected?: {
                whenSettled?: (t?: number) => Promise<{
                  settled: boolean;
                  elementCount: number;
                  settledByTimeout: boolean;
                  expectSatisfied: boolean;
                }>;
                settled?: boolean;
                elementCount?: number;
                settledByTimeout?: boolean;
                expectSatisfied?: boolean;
              };
            }
          ).__uiBridgeInjected;
          if (api?.whenSettled) return api.whenSettled(ms ?? undefined);
          return Promise.resolve({
            settled: api?.settled === true,
            elementCount: api?.elementCount ?? 0,
            settledByTimeout: api?.settledByTimeout === true,
            expectSatisfied: api?.expectSatisfied === true,
          });
        },
        (timeoutMs ?? null) as number | null
      );

    return {
      kind: 'injected',
      page,
      browserContext,
      browser,
      uiBridgeRegistered,
      ready: true,
      tabId,
      settleState,
      whenSettled,
      execute,
      find: (criteria?: Record<string, unknown>) => execute('find', criteria ?? {}),
      act: (id: string, request: Record<string, unknown>) =>
        execute('executeElementAction', { id, request }),
      snapshot: (options?: Record<string, unknown>) => execute('getControlSnapshot', options ?? {}),
      assert: (spec: Record<string, unknown>) => execute('aiAssert', spec),
    };
  }
}

function isRegistrationMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === 'string' && typeof v.sessionId === 'string';
}
