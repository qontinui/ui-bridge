/**
 * `core/sdk-diagnostics.ts` — the one diagnostics builder both transports
 * serve (plan 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case,
 * Phase 2, D5). Every input flag and every page read, with literals.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSdkDiagnostics, type SdkDiagnosticsInputs } from './sdk-diagnostics';

const NONE: SdkDiagnosticsInputs = {
  registeredElements: 0,
  hasConsoleCapture: false,
  hasNavigationTracker: false,
  hasNavigationAdapter: false,
};

type GlobalWithBridge = { __UI_BRIDGE__?: Record<string, unknown> };

beforeEach(() => {
  document.title = 'Diagnostics fixture';
  document.body.innerHTML = '<button>One</button><a href="/x">Two</a><p>prose</p>';
});

afterEach(() => {
  delete (window as unknown as GlobalWithBridge).__UI_BRIDGE__;
  document.body.innerHTML = '';
  document.title = '';
});

describe('buildSdkDiagnostics', () => {
  it('a page with no SDK provider: the literal answer', () => {
    expect(buildSdkDiagnostics({ ...NONE, registeredElements: 5 })).toEqual({
      sdk_initialized: false,
      auto_register_active: false,
      registered_elements: 5,
      dom_interactive_elements: 2,
      mutation_observer_active: false,
      navigation_adapter: 'window-location',
      page_title: 'Diagnostics fixture',
      page_url: 'http://localhost:3000/',
      page_ready: document.readyState === 'complete',
      providers_mounted: [],
      last_discover_at: null,
      capabilities: ['control', 'find', 'ai'],
    });
  });

  it('a mounted provider: window.__UI_BRIDGE__ is read', () => {
    (window as unknown as GlobalWithBridge).__UI_BRIDGE__ = {
      autoRegisterActive: true,
      mutationObserverActive: true,
      providers: ['UIBridgeProvider'],
    };
    expect(buildSdkDiagnostics(NONE)).toMatchObject({
      sdk_initialized: true,
      auto_register_active: true,
      mutation_observer_active: true,
      providers_mounted: ['UIBridgeProvider'],
    });
  });

  it.each([
    [{ hasConsoleCapture: true }, ['control', 'find', 'ai', 'debug'], 'window-location'],
    [{ hasNavigationTracker: true }, ['control', 'find', 'ai', 'navigation'], 'window-location'],
    [{ hasNavigationAdapter: true }, ['control', 'find', 'ai', 'navigation-adapter'], 'custom'],
    [
      { hasConsoleCapture: true, hasNavigationTracker: true, hasNavigationAdapter: true },
      ['control', 'find', 'ai', 'debug', 'navigation', 'navigation-adapter'],
      'custom',
    ],
  ])('%j: capabilities %j, adapter %s', (flags, capabilities, adapter) => {
    const diag = buildSdkDiagnostics({ ...NONE, ...flags });
    expect(diag.capabilities).toEqual(capabilities);
    expect(diag.navigation_adapter).toBe(adapter);
  });
});
