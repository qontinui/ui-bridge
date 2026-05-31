/**
 * Shared types for the injected runtime — the in-page API the driver talks to
 * and the optional config it injects as a sibling init-script.
 */

/**
 * The API the injected bundle defines on `window.__uiBridgeInjected`. The
 * driver (Variant A) drives it directly via `page.evaluate`; the relay client
 * (Variant B) drives it over the network through the same dispatcher.
 */
export interface InjectedRuntimeApi {
  /**
   * `true` once the DOM-seeded registry is populated and the runtime is ready
   * to accept `execute` calls. The driver gates dispatch on this
   * (`page.waitForFunction('window.__uiBridgeInjected?.ready === true')`).
   * `execute` is callable before this flips, but the registry will be empty
   * until DOM-ready, so callers should wait.
   */
  ready: boolean;
  /**
   * `true` once the DOM has **settled** — a seed pass has registered at least
   * one interactive element AND no further re-seed has fired for the quiet
   * window (or the hard settle timeout elapsed). On a client-rendered SPA the
   * registry is empty at `ready` and fills in as the app paints; `settled` is
   * the signal that the page is actually drivable, so a driver should gate its
   * first snapshot/find on `settled` rather than `ready`. Always becomes `true`
   * eventually (genuinely-empty and never-quiet pages resolve at the timeout).
   */
  settled: boolean;
  /** Interactive elements registered as of the most recent seed pass. */
  elementCount: number;
  /** SDK version the bundle was built from. */
  version: string;
  /**
   * Resolve once the DOM is {@link settled}, or after `timeoutMs` (default: the
   * runtime's configured settle timeout). Resolves immediately if already
   * settled. The resolved value reflects state at resolution time, so a
   * timed-out wait reports `settled: false`. Drivers prefer this over polling
   * `getControlSnapshot` through hydration.
   */
  whenSettled(timeoutMs?: number): Promise<{ settled: boolean; elementCount: number }>;
  /**
   * Run a relay command action against the populated registry — the exact
   * dispatcher embedded apps use (`executeCommand`). Returns the action result
   * (or a `{ success: false }` envelope).
   */
  execute(action: string, payload?: unknown): Promise<unknown>;
}

/**
 * Optional configuration the driver injects as a sibling init-script
 * (`window.__uiBridgeInjectedConfig`) ahead of the bundle. When
 * `uiBridgeBase` is present, the bundle starts a relay client (Variant B) so
 * the injected page registers as a tab and is drivable through the standard
 * `/control/*` plane. When absent, the bundle is direct-drive only (Variant A).
 */
export interface InjectedRuntimeConfig {
  /** Relay base path/URL (e.g. `https://qontinui.io/api/ui-bridge`). */
  uiBridgeBase?: string;
  /** Bearer token for the auth-gated relay. */
  authToken?: string;
  /** Strict per-user tab-scoping metadata for heartbeats. */
  registrationMetadata?: { userId: string; sessionId: string };
  /** Stable per-tab id override. Defaults to a persisted random uuid. */
  tabId?: string;
  /** App id reported to the relay registry. */
  appId?: string;
  /** Display name reported to the relay registry. */
  appName?: string;
  /**
   * Quiet window (ms) with no further DOM re-seed before the runtime declares
   * itself {@link InjectedRuntimeApi.settled}. Default 500.
   */
  settleQuietMs?: number;
  /**
   * Hard cap (ms) after which the runtime declares itself settled regardless of
   * ongoing mutations (never-quiet or empty pages). Default 10000.
   */
  settleTimeoutMs?: number;
}

declare global {
  interface Window {
    __uiBridgeInjected?: InjectedRuntimeApi;
    __uiBridgeInjectedConfig?: InjectedRuntimeConfig;
  }
}
