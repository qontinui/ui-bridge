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
 * once the registry is populated; `settled` flips true once the DOM goes quiet
 * after content appears (the signal a driver should gate its first snapshot on,
 * since on a client-rendered SPA the registry is empty at `ready`).
 */

import { UIBridgeRegistry, setGlobalRegistry } from '../core/registry';
import { executeCommand } from '../react/commandHandlers';
import { startRelayClient } from '../relay/relay-client';
import { observeAndSeed } from './seed-registry';
import { createSettleTracker } from './settle';
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

  const cfg = window.__uiBridgeInjectedConfig;
  const settle = createSettleTracker({
    quietMs: typeof cfg?.settleQuietMs === 'number' ? cfg.settleQuietMs : 500,
    timeoutMs: typeof cfg?.settleTimeoutMs === 'number' ? cfg.settleTimeoutMs : 10_000,
  });

  const api: InjectedRuntimeApi = {
    ready: false,
    settled: false,
    elementCount: 0,
    version: typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown',
    whenSettled: (timeoutMs?: number) => settle.whenSettled(timeoutMs),
    execute: (action: string, payload?: unknown) =>
      Promise.resolve(executeCommand(action, payload as Record<string, unknown>, bridge)),
  };
  window.__uiBridgeInjected = api;

  const start = () => {
    // Begin the settle hard-timeout cap as soon as observation starts.
    settle.start();
    // Populate + keep the registry live from the bare DOM. Each seed pass feeds
    // the settle tracker, which flips `settled` once the DOM quiets after
    // content appears (or the cap elapses) and mirrors state onto the api.
    observeAndSeed(registry, document.body, {
      onSeed: (elementCount) => {
        api.elementCount = elementCount;
        settle.noteSeed(elementCount);
        api.settled = settle.settled;
      },
    });
    api.ready = true;
    // The quiet/cap timers flip `settle.settled` asynchronously; mirror it onto
    // the api when it resolves so `window.__uiBridgeInjected.settled` is current
    // even between seed passes.
    void settle.whenSettled().then(() => {
      api.settled = true;
    });

    // Variant B — register as a relay tab when a base was injected.
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
