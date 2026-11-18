/**
 * The injected runtime installs the console capture — plan
 * 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
 * Phase 8 (D3 h1).
 *
 * The React provider installs a `BrowserEventCapture` and publishes it as
 * `window.__UI_BRIDGE__.browserCapture`; nothing under `src/injected/` did, so
 * an injected or exec-mode run on a page without the provider had no console
 * instrument at all. Enters where the injected population enters: the
 * bootstrap IIFE and the `window.__uiBridgeInjected.execute` it installs.
 *
 * The capture it installs must not record the SDK's own traffic (review fix
 * m4): the relay client's result POSTs and heartbeats go to the injected
 * `uiBridgeBase` (often `127.0.0.1:9876`, which the capture's default ignore
 * list does not name), and its diagnostics are `[UIBridge]`-prefixed
 * `console.error` calls.
 *
 * `vi.resetModules()` gives each test a fresh bootstrap (it is an IIFE that
 * runs on import), so the capture class is imported dynamically AFTER the reset
 * — the same module instance the bootstrap then uses.
 */

import { it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { setGlobalRegistry, UIBridgeRegistry } from '../core/registry';
import type { BrowserEventCapture } from '../debug/browser-capture';

type Realm = { browserCapture?: BrowserEventCapture; consoleCapture?: BrowserEventCapture };

function realm(): Realm | undefined {
  return (window as unknown as { __UI_BRIDGE__?: Realm }).__UI_BRIDGE__;
}

const realError = console.error;
const realWarn = console.warn;

/**
 * Each test re-imports the bootstrap cold (after `vi.resetModules()`), which
 * loads the whole dispatcher graph; under full-suite load that has run past
 * vitest's 5 s default. An explicit budget, plus a warm-up import so the
 * transform cache is hot before the first test.
 */
const COLD_IMPORT_TIMEOUT_MS = 20_000;

beforeAll(async () => {
  await import('../react/commandHandlers');
}, COLD_IMPORT_TIMEOUT_MS);
const realFetch = window.fetch;
const RELAY_BASE = 'http://127.0.0.1:9876/ui-bridge';

beforeEach(() => {
  vi.resetModules();
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
  delete (globalThis as unknown as { __UI_BRIDGE_RELAY_TRAFFIC__?: unknown })
    .__UI_BRIDGE_RELAY_TRAFFIC__;
  console.error = () => undefined;
  console.warn = () => undefined;
}, COLD_IMPORT_TIMEOUT_MS);

afterEach(() => {
  realm()?.browserCapture?.uninstall();
  delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  delete (globalThis as unknown as { __UI_BRIDGE_RELAY_TRAFFIC__?: unknown })
    .__UI_BRIDGE_RELAY_TRAFFIC__;
  setGlobalRegistry(new UIBridgeRegistry());
  console.error = realError;
  console.warn = realWarn;
  window.fetch = realFetch;
  vi.doUnmock('../relay/relay-client');
  vi.restoreAllMocks();
}, COLD_IMPORT_TIMEOUT_MS);

it(
  'on a page with no provider, a console.error emitted after bootstrap is returned by getConsoleErrors',
  async () => {
    await import('./bootstrap');
    const api = window.__uiBridgeInjected!;
    expect(api).toBeDefined();

    console.error('emitted after injection');

    const r = (await api.execute('getConsoleErrors', {})) as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
    };
    expect(r.success).not.toBe(false);
    expect(r.errors?.some((e) => String(e.message).includes('emitted after injection'))).toBe(true);
  },
  COLD_IMPORT_TIMEOUT_MS
);

it(
  "a provider's pre-existing capture is kept — the same object, and no second capture is installed",
  async () => {
    const { BrowserEventCapture } = await import('../debug/browser-capture');
    const providerCapture = new BrowserEventCapture();
    providerCapture.install();
    (window as unknown as { __UI_BRIDGE__: Realm }).__UI_BRIDGE__ = {
      browserCapture: providerCapture,
      consoleCapture: providerCapture,
    };
    const install = vi.spyOn(BrowserEventCapture.prototype, 'install');

    await import('./bootstrap');
    expect(window.__uiBridgeInjected).toBeDefined();

    expect(realm()?.browserCapture).toBe(providerCapture);
    expect(realm()?.consoleCapture).toBe(providerCapture);
    expect(install).not.toHaveBeenCalled();
  },
  COLD_IMPORT_TIMEOUT_MS
);

it(
  "the injected capture drops the SDK's own [UIBridge] / [ui-bridge] console diagnostics, and keeps the page's",
  async () => {
    await import('./bootstrap');
    const api = window.__uiBridgeInjected!;
    const cap = realm()!.browserCapture!;

    console.warn('[ui-bridge] page enricher threw:', new Error('enricher'));
    console.warn('a page warning');
    const consoleMessages = cap
      .getByType('console')
      .map((e) => String((e as unknown as { message?: string }).message));
    expect(consoleMessages.some((m) => m.includes('a page warning'))).toBe(true);
    expect(consoleMessages.some((m) => m.includes('[ui-bridge]'))).toBe(false);

    console.error(
      '[UIBridge] Command result for command c1 was not delivered: 503 after 3 attempt(s)'
    );
    console.error('a page error');

    const r = (await api.execute('getConsoleErrors', {})) as {
      errors: Array<{ message?: string }>;
    };
    const messages = r.errors.map((e) => String(e.message));
    expect(messages.some((m) => m.includes('a page error'))).toBe(true);
    expect(messages.some((m) => m.includes('[UIBridge]'))).toBe(false);
  },
  COLD_IMPORT_TIMEOUT_MS
);

it(
  "the injected capture does not record the relay base's own endpoints as page network errors",
  async () => {
    // The relay client itself is stubbed: this test is about what the capture
    // records, and the real client would open a stream and post heartbeats.
    vi.doMock('../relay/relay-client', () => ({ startRelayClient: () => undefined }));
    window.fetch = (async () => new Response('busy', { status: 503 })) as typeof fetch;
    window.__uiBridgeInjectedConfig = { uiBridgeBase: RELAY_BASE } as never;

    await import('./bootstrap');
    const cap = realm()!.browserCapture!;

    await window.fetch(`${RELAY_BASE}/heartbeat`, { method: 'POST' });
    await window.fetch(`${RELAY_BASE}/commands`, { method: 'POST' });
    await window.fetch('http://127.0.0.1:9876/api/page-data');

    const urls = cap
      .getByType('network')
      .map((e) => String((e as unknown as { requestUrl?: string }).requestUrl));
    expect(urls.some((u) => u.includes('/api/page-data'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/heartbeat'))).toBe(false);
    expect(urls.some((u) => u.endsWith('/commands'))).toBe(false);
  },
  COLD_IMPORT_TIMEOUT_MS
);
