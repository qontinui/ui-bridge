/**
 * `@qontinui/ui-bridge/injected`
 *
 * Programmatic building blocks for **injected mode** — driving UI Bridge's
 * semantic automation (find / act / snapshot / assert) against pages that
 * ship ZERO UI Bridge code, by injecting the engine bundle at automation
 * time. See the injected-transport plan (2026-05-31).
 *
 * The runnable artifact is the IIFE at `dist/injected/bundle.global.js`
 * (built from `bootstrap.ts`), which a driver injects via Playwright's
 * `addInitScript`. The `@qontinui/ui-bridge-wrapper` `injected` transport
 * resolves and injects that file for you. These named exports let other
 * tooling reuse the pieces (seeding a registry from the DOM, building a
 * registry-backed `BridgeAccess`, starting a relay client) directly.
 *
 * ## Capability tier status (plan §3.3)
 *
 * - **Tier 1 (shipped here):** find-by-label/text/role/type, click/type/
 *   clear/focus, interactive-element snapshot, visibility/state read — all
 *   backed by the DOM-seeded `UIBridgeRegistry` + the reused relay dispatcher
 *   (`executeCommand`). Works on a page that ships zero UI Bridge code.
 * - **Tier 2 (DEFERRED — not silently capped):** the structural
 *   `ElementQuery` language + DOM-inferred state machine from
 *   `@qontinui/ui-bridge-auto` are NOT wired in. Reason: that package ships
 *   `dist/` only — no `src/` is present in this checkout, so there is no
 *   buildable source to adapt the populated registry into `QueryableElement[]`
 *   against. Ranked semantic `find` does NOT depend on it (it rides Tier 1's
 *   populated registry), so Tier 1 is uncrippled. Revisit when
 *   `ui-bridge-auto` source becomes reachable (plan Phase 2 / OQ-2).
 * - **Tier 3 (vision):** delegated to the runner pipeline — unchanged, not
 *   in-page.
 */

export {
  seedRegistryFromDom,
  observeAndSeed,
  type SeedResult,
  type SeedOptions,
  type ObserveOptions,
} from './seed-registry';
export { bridgeAccessOver } from './bridge-access';
export {
  startRelayClient,
  resolveTabId,
  type RelayClientConfig,
  type RelayClientHandle,
} from '../relay/relay-client';
export type { InjectedRuntimeApi, InjectedRuntimeConfig } from './types';
