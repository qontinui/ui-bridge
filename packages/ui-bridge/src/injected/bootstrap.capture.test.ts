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
 */

import { it, expect, afterEach, beforeEach, vi } from 'vitest';
import { setGlobalRegistry, UIBridgeRegistry } from '../core/registry';
import { BrowserEventCapture } from '../debug/browser-capture';

type Realm = { browserCapture?: BrowserEventCapture; consoleCapture?: BrowserEventCapture };

function realm(): Realm | undefined {
  return (window as unknown as { __UI_BRIDGE__?: Realm }).__UI_BRIDGE__;
}

const realError = console.error;

beforeEach(() => {
  vi.resetModules();
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
  console.error = () => undefined;
});

afterEach(() => {
  realm()?.browserCapture?.uninstall();
  delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
  delete window.__uiBridgeInjected;
  setGlobalRegistry(new UIBridgeRegistry());
  console.error = realError;
});

it('on a page with no provider, a console.error emitted after bootstrap is returned by getConsoleErrors', async () => {
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
});

it("a provider's pre-existing capture is kept — the same object, not replaced", async () => {
  const providerCapture = new BrowserEventCapture();
  providerCapture.install();
  (window as unknown as { __UI_BRIDGE__: Realm }).__UI_BRIDGE__ = {
    browserCapture: providerCapture,
    consoleCapture: providerCapture,
  };

  await import('./bootstrap');
  expect(window.__uiBridgeInjected).toBeDefined();

  expect(realm()?.browserCapture).toBe(providerCapture);
  expect(realm()?.consoleCapture).toBe(providerCapture);
});
