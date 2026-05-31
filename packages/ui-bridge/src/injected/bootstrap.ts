/**
 * Injected runtime bootstrap — the entry point built to a single IIFE
 * (`dist/injected/bundle.global.js`) that a driver injects via
 * `BrowserContext.addInitScript` before the target page's first paint.
 *
 * It composes ONLY existing engines (plan §3.2):
 *   1. `new UIBridgeRegistry()` (standalone, React-free) installed as the
 *      global registry so the relay dispatcher reads from it.
 *   2. `observeAndSeed` — populate + keep it live from the bare DOM via the
 *      `dom-fallback` substrate (no app cooperation).
 *   3. `window.__uiBridgeInjected.execute = (a, p) => executeCommand(a, p, bridge)`
 *      — the same dispatcher embedded apps use.
 *   4. (Relay variant) `startRelayClient(...)` when the driver injected a
 *      `window.__uiBridgeInjectedConfig.uiBridgeBase`.
 *
 * Init-scripts run at document_start — before `<body>` exists — so seeding is
 * deferred to DOM-ready. `execute` is wired immediately; `ready` flips true
 * once the registry is populated.
 */

import { UIBridgeRegistry, setGlobalRegistry } from '../core/registry';
import { executeCommand } from '../react/commandHandlers';
import { startRelayClient } from '../relay/relay-client';
import { observeAndSeed } from './seed-registry';
import { bridgeAccessOver } from './bridge-access';
import type { InjectedRuntimeApi } from './types';

declare const __SDK_VERSION__: string;

(function bootstrapInjectedRuntime() {
  // Idempotent: a re-injection (e.g. SPA soft-nav re-running init scripts)
  // must not clobber a live runtime or double-register the global registry.
  if (typeof window === 'undefined') return;
  if (window.__uiBridgeInjected) return;

  const registry = new UIBridgeRegistry();
  // Install as the global so `executeCommand` (which reads
  // `getGlobalRegistry()` for elements/components/workflows) sees our
  // DOM-seeded elements.
  setGlobalRegistry(registry);

  const bridge = bridgeAccessOver(registry);

  const api: InjectedRuntimeApi = {
    ready: false,
    version: typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown',
    execute: (action: string, payload?: unknown) =>
      Promise.resolve(executeCommand(action, payload as Record<string, unknown>, bridge)),
  };
  window.__uiBridgeInjected = api;

  const start = () => {
    // Populate + keep the registry live from the bare DOM.
    observeAndSeed(registry, document.body);
    api.ready = true;

    // Variant B — register as a relay tab when a base was injected.
    const cfg = window.__uiBridgeInjectedConfig;
    if (cfg?.uiBridgeBase) {
      startRelayClient({
        basePath: cfg.uiBridgeBase,
        execute: api.execute,
        tabId: cfg.tabId,
        authHeader: () => cfg.authToken ?? null,
        registrationMetadata: () => cfg.registrationMetadata ?? null,
        appType: 'injected',
        capabilities: ['control', 'discovery'],
        appId: cfg.appId,
        appName: cfg.appName,
        version: api.version,
      });
    }
  };

  if (document.body) {
    start();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
