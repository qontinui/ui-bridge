/**
 * ARMING — plan 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case,
 * Phase 3: `getRoutes` and `navigateByAdapter`, which the relay already sends
 * to browser tabs, are answered by the page (D3, D4).
 *
 * Enters where exec mode's population enters: the injected bootstrap and the
 * `window.__uiBridgeInjected.execute` it installs. Before this phase both
 * rejected with `Unknown command action: …`.
 *
 * The adapter reaches the page through the slot
 * `window.__UI_BRIDGE__.navigationAdapter`, which `<UIBridgeProvider
 * navigation={…}>` sets while mounted and clears on unmount (last block).
 */

import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGlobalRegistry, UIBridgeRegistry } from '../core/registry';
import {
  createNextjsAdapter,
  createReactRouterAdapter,
  type NavigationAdapter,
} from '../navigation/navigation-adapter';
import { CommandRelay } from '../server/command-relay';
import { createRelayHandlers } from '../server/relay-handlers';
import { createHandlers, type RegistryLike } from '../server/handlers';
import { DefaultActionExecutor } from '../control/action-executor';
import { UIBridgeProvider } from '../react/UIBridgeProvider';

type Slots = { navigationAdapter?: NavigationAdapter; navigateHandler?: (url: string) => void };

function slots(): Slots {
  const w = window as unknown as { __UI_BRIDGE__?: Slots };
  return (w.__UI_BRIDGE__ ??= {});
}

/** A fresh injected runtime over the current DOM. */
async function bootRuntime() {
  vi.resetModules();
  await import('./bootstrap');
  const api = window.__uiBridgeInjected!;
  expect(api.ready).toBe(true);
  return api;
}

beforeEach(() => {
  delete window.__uiBridgeInjected;
  delete window.__uiBridgeInjectedConfig;
  delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
  document.title = 'Fleet';
  window.history.pushState(null, '', '/fleet?tab=2#top');
});

afterEach(() => {
  cleanup();
  delete window.__uiBridgeInjected;
  delete (window as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__;
  setGlobalRegistry(new UIBridgeRegistry());
  window.history.pushState(null, '', '/');
});

describe('injected execute("getRoutes")', () => {
  it('no adapter: the one current-page route, source window-location, complete false', async () => {
    const api = await bootRuntime();
    expect(await api.execute('getRoutes', {})).toEqual({
      routes: [{ name: 'Fleet', path: '/fleet' }],
      source: 'window-location',
      complete: false,
    });
  }, 30_000);

  it('a React Router adapter with routes: the flattened table, complete true', async () => {
    slots().navigationAdapter = createReactRouterAdapter({
      navigate: () => {},
      routes: [
        { path: '/', id: 'home' },
        { path: 'settings', id: 'settings', children: [{ path: 'profile', id: 'profile' }] },
      ],
    });
    const api = await bootRuntime();
    expect(await api.execute('getRoutes', {})).toEqual({
      routes: [
        { name: 'home', path: '/' },
        { name: 'settings', path: '/settings' },
        { name: 'profile', path: '/settings/profile' },
      ],
      source: 'adapter',
      complete: true,
    });
  }, 30_000);

  it('a React Router adapter with no routes: the current page, complete false', async () => {
    slots().navigationAdapter = createReactRouterAdapter({
      navigate: () => {},
      state: { location: { pathname: '/fleet' } },
    });
    const api = await bootRuntime();
    expect(await api.execute('getRoutes', {})).toEqual({
      routes: [{ name: 'Fleet', path: '/fleet' }],
      source: 'adapter',
      complete: false,
    });
  }, 30_000);

  it('a Next.js-shaped adapter: the current page, source adapter, complete false', async () => {
    slots().navigationAdapter = createNextjsAdapter({ push: () => {} });
    const api = await bootRuntime();
    expect(await api.execute('getRoutes', {})).toEqual({
      routes: [{ name: 'Fleet', path: '/fleet?tab=2' }],
      source: 'adapter',
      complete: false,
    });
  }, 30_000);

  it('a custom adapter declaring its table complete: complete true', async () => {
    slots().navigationAdapter = {
      getRoutes: () => [{ name: 'Only', path: '/only' }],
      navigate: async () => {},
      getCurrentRoute: () => ({ name: 'Only', path: '/only' }),
      isRouteTableComplete: () => true,
    };
    const api = await bootRuntime();
    expect(await api.execute('getRoutes', {})).toEqual({
      routes: [{ name: 'Only', path: '/only' }],
      source: 'adapter',
      complete: true,
    });
  }, 30_000);

  it('the in-process getRoutes answers the same builder (and the Next.js adapter is incomplete)', async () => {
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never,
      { navigationAdapter: createNextjsAdapter({ push: () => {} }) }
    );
    expect(await handlers.getRoutes()).toMatchObject({
      success: true,
      data: {
        routes: [{ name: 'Fleet', path: '/fleet?tab=2' }],
        source: 'adapter',
        complete: false,
      },
    });
    const bare = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    expect(await bare.getRoutes()).toMatchObject({
      success: true,
      data: {
        routes: [{ name: 'Fleet', path: '/fleet' }],
        source: 'window-location',
        complete: false,
      },
    });
  });
});

describe('injected execute("navigateByAdapter")', () => {
  it("{page:'settings'}, no adapter: exactly pageNavigate — the navigateHandler gets /settings", async () => {
    const navigateHandler = vi.fn((url: string) => window.history.pushState(null, '', url));
    slots().navigateHandler = navigateHandler;
    const api = await bootRuntime();
    const answer = await api.execute('navigateByAdapter', { page: 'settings' });
    expect(navigateHandler).toHaveBeenCalledTimes(1);
    expect(navigateHandler).toHaveBeenCalledWith('/settings');
    expect(answer).toEqual({ navigated: true, route: { name: 'Fleet', path: '/settings' } });
  }, 30_000);

  it("{page:'settings'}, an adapter: adapter.navigate('settings'), answered with its current route", async () => {
    const navigate = vi.fn(async (_target: string) => {});
    const navigateHandler = vi.fn();
    slots().navigateHandler = navigateHandler;
    slots().navigationAdapter = {
      getRoutes: () => [],
      navigate,
      getCurrentRoute: () => ({ name: 'Settings', path: '/app/settings' }),
    };
    const api = await bootRuntime();
    const answer = await api.execute('navigateByAdapter', { page: 'settings' });
    expect(navigate).toHaveBeenCalledWith('settings');
    expect(navigateHandler).not.toHaveBeenCalled();
    expect(answer).toEqual({ navigated: true, route: { name: 'Settings', path: '/app/settings' } });
  }, 30_000);

  it('a missing page is a returned INVALID_REQUEST', async () => {
    const api = await bootRuntime();
    expect(await api.execute('navigateByAdapter', {})).toMatchObject({
      success: false,
      error: 'navigateByAdapter: "page" must be a non-empty string',
      failureDetails: { errorCode: 'INVALID_REQUEST' },
    });
  }, 30_000);

  it("{page:'javascript:alert(1)'}: INVALID_URL_PROTOCOL on both sides, and nothing navigates", async () => {
    const message =
      'Dangerous URL protocol rejected: "javascript:". Only http, https, and relative paths are allowed.';
    const navigate = vi.fn(async () => {});
    const navigateHandler = vi.fn();
    slots().navigateHandler = navigateHandler;
    slots().navigationAdapter = {
      getRoutes: () => [],
      navigate,
      getCurrentRoute: () => ({ name: 'x', path: '/x' }),
    };

    // The page.
    const api = await bootRuntime();
    expect(await api.execute('navigateByAdapter', { page: 'javascript:alert(1)' })).toMatchObject({
      success: false,
      error: message,
      failureDetails: { errorCode: 'INVALID_URL_PROTOCOL', message },
    });

    // The relay: refused before it reaches any tab.
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
      proactiveSnapshot: false,
    });
    const seen: string[] = [];
    relay.subscribeToCommands((cmd) => seen.push(cmd.action), 'tab-a');
    try {
      expect(
        await createRelayHandlers(relay).navigateByAdapter({ page: 'javascript:alert(1)' })
      ).toMatchObject({ success: false, error: message, code: 'UB-VALIDATION-ERROR' });
    } finally {
      relay.destroy();
    }

    expect(seen).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateHandler).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/fleet');
  }, 30_000);

  it('the browser pageNavigate refusal now carries its code under failureDetails', async () => {
    const api = await bootRuntime();
    expect(await api.execute('pageNavigate', { url: 'javascript:alert(1)' })).toMatchObject({
      success: false,
      failureDetails: { errorCode: 'INVALID_URL_PROTOCOL' },
    });
    expect(await api.execute('pageNavigate', { url: 'ftp://x' })).toMatchObject({
      success: false,
      error: 'Invalid URL protocol "ftp:". Only http, https, and relative paths are allowed.',
      failureDetails: { errorCode: 'INVALID_URL_PROTOCOL' },
    });
    expect(await api.execute('pageNavigate', { url: 'http://[' })).toMatchObject({
      success: false,
      failureDetails: { errorCode: 'INVALID_URL_FORMAT' },
    });
  }, 30_000);

  it('the in-process navigateByAdapter with no adapter goes through its own pageNavigate', async () => {
    const navigateHandler = vi.fn();
    slots().navigateHandler = navigateHandler;
    const registry = new UIBridgeRegistry();
    const handlers = createHandlers(
      registry as unknown as RegistryLike,
      new DefaultActionExecutor(registry) as never
    );
    const pageNavigate = vi
      .spyOn(handlers, 'pageNavigate')
      .mockResolvedValue({ success: true, data: { url: '/settings' } as never, timestamp: 1 });
    const result = await handlers.navigateByAdapter({ page: 'settings' });
    expect(pageNavigate).toHaveBeenCalledWith({ url: '/settings' });
    expect(result).toMatchObject({
      success: true,
      data: { navigated: true, route: { name: 'Fleet', path: '/fleet?tab=2#top' } },
    });
  });
});

describe('<UIBridgeProvider navigation={…}>', () => {
  it('sets the page slot on mount, swaps it on change, and clears it on unmount', () => {
    const first = createNextjsAdapter({ push: () => {} });
    const second = createNextjsAdapter({ push: () => {} });
    const view = render(
      <UIBridgeProvider navigation={first}>
        <span />
      </UIBridgeProvider>
    );
    expect(slots().navigationAdapter).toBe(first);
    view.rerender(
      <UIBridgeProvider navigation={second}>
        <span />
      </UIBridgeProvider>
    );
    expect(slots().navigationAdapter).toBe(second);
    view.unmount();
    expect(slots().navigationAdapter).toBeUndefined();
  });
});
