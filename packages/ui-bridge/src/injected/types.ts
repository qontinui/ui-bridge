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
  /** SDK version the bundle was built from. */
  version: string;
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
}

declare global {
  interface Window {
    __uiBridgeInjected?: InjectedRuntimeApi;
    __uiBridgeInjectedConfig?: InjectedRuntimeConfig;
  }
}
