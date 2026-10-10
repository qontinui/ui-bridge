/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';

// Mock react-native before importing the provider so StyleSheet.flatten exists.
vi.mock('react-native', () => ({
  StyleSheet: {
    flatten: (style: unknown) => style ?? undefined,
  },
  PixelRatio: {
    get: () => 1,
  },
  Dimensions: {
    get: () => ({ width: 390, height: 844 }),
  },
}));

import { useRouteAwareness, type UseRouteAwarenessOptions } from '../useRouteAwareness';
import { expoRouterPattern } from '../routePattern';
import {
  UIBridgeNativeProvider,
  useUIBridgeNative,
  type UIBridgeNativeContextValue,
} from '../UIBridgeNativeProvider';
import type { RouteInfo } from '../../core/types';

/**
 * `useRouteAwareness` (plan
 * `2026-10-10-ui-bridge-native-exports-no-use-route-awareness`, Phase 3).
 *
 * The hook writes the router-asserted route TEMPLATE into the registry's
 * route-info slot, which every snapshot emits as `page.route` — the field the
 * runner's journey ledger reads. Harness as in
 * `provider-context-stability.test.tsx`: jsdom, the real provider, and a
 * mocked `react-native`. Module-constant props keep the provider's context
 * identity stable so effect re-fires come only from the hook's own deps.
 */

const FEATURES = { server: false };
const CONFIG = {};

function mountUnderProvider(info: RouteInfo, options?: UseRouteAwarenessOptions) {
  let bridge!: UIBridgeNativeContextValue;
  function Capture() {
    bridge = useUIBridgeNative();
    return null;
  }
  function Reporter({ info, options }: { info: RouteInfo; options?: UseRouteAwarenessOptions }) {
    useRouteAwareness(info, options);
    return null;
  }
  function Host({
    info,
    options,
    show = true,
  }: {
    info: RouteInfo;
    options?: UseRouteAwarenessOptions;
    show?: boolean;
  }) {
    return (
      <UIBridgeNativeProvider features={FEATURES} config={CONFIG}>
        <Capture />
        {show ? <Reporter info={info} options={options} /> : null}
      </UIBridgeNativeProvider>
    );
  }
  const view = render(<Host info={info} options={options} />);
  return {
    get bridge() {
      return bridge;
    },
    rerender: (next: RouteInfo, nextOptions?: UseRouteAwarenessOptions, show = true) =>
      view.rerender(<Host info={next} options={nextOptions} show={show} />),
    unmount: view.unmount,
  };
}

describe('useRouteAwareness', () => {
  it('reports the info to the registry on mount', () => {
    const h = mountUnderProvider({ pattern: '/profile/[user]', patternSource: 'router' });
    expect(h.bridge.registry.getRouteInfo()).toEqual({
      pattern: '/profile/[user]',
      patternSource: 'router',
    });
    expect(h.bridge.registry.createSnapshot().page).toEqual({
      route: { pattern: '/profile/[user]', patternSource: 'router' },
    });
    h.unmount();
  });

  it('updates the reported info when the pattern changes', () => {
    const h = mountUnderProvider({ pattern: '/profile/[user]', patternSource: 'router' });
    h.rerender({ pattern: '/(tabs)/runs', patternSource: 'router' });
    expect(h.bridge.registry.getRouteInfo()).toEqual({
      pattern: '/(tabs)/runs',
      patternSource: 'router',
    });
    h.unmount();
  });

  it('reports pattern null, keeping patternSource, while unmatched', () => {
    const h = mountUnderProvider(
      { pattern: '/search/[q]', patternSource: 'router' },
      { unmatched: true }
    );
    expect(h.bridge.registry.getRouteInfo()?.pattern).toBeNull();
    expect(h.bridge.registry.getRouteInfo()?.patternSource).toBe('router');
    h.unmount();
  });

  it('drops params while unmatched, so the not-found path never reaches the snapshot', () => {
    const h = mountUnderProvider(
      {
        pattern: '/search/[q]',
        patternSource: 'router',
        params: { 'not-found': 'secret-sentinel' },
      },
      { unmatched: true }
    );
    const page = h.bridge.registry.createSnapshot().page;
    expect(page?.route?.pattern).toBeNull();
    expect(JSON.stringify(page)).not.toContain('secret-sentinel');
    h.unmount();
  });

  it('restores the pattern when unmatched lowers', () => {
    const info: RouteInfo = { pattern: '/(tabs)/runs', patternSource: 'router' };
    const h = mountUnderProvider(info, { unmatched: true });
    expect(h.bridge.registry.getRouteInfo()?.pattern).toBeNull();
    h.rerender(info, { unmatched: false });
    expect(h.bridge.registry.getRouteInfo()?.pattern).toBe('/(tabs)/runs');
    h.unmount();
  });

  it('clears the reported info when the reporting component unmounts', () => {
    const info: RouteInfo = { pattern: '/profile/[user]', patternSource: 'router' };
    const h = mountUnderProvider(info);
    expect(h.bridge.registry.getRouteInfo()).toBeDefined();
    // Unmount ONLY the reporter; the provider (and its registry) stays.
    h.rerender(info, undefined, false);
    expect(h.bridge.registry.getRouteInfo()).toBeUndefined();
    expect('page' in h.bridge.registry.createSnapshot()).toBe(false);
    h.unmount();
  });

  it('is a no-op outside a provider', () => {
    function Bare() {
      useRouteAwareness({ pattern: '/x', patternSource: 'router' });
      return null;
    }
    expect(() => render(<Bare />).unmount()).not.toThrow();
  });

  it('mount, unmount, mount again leaves exactly the latest info set', () => {
    const first: RouteInfo = { pattern: '/a', patternSource: 'router' };
    const second: RouteInfo = { pattern: '/b', patternSource: 'router' };
    const h = mountUnderProvider(first);
    h.rerender(first, undefined, false);
    expect(h.bridge.registry.getRouteInfo()).toBeUndefined();
    h.rerender(second, undefined, true);
    expect(h.bridge.registry.getRouteInfo()).toEqual({ pattern: '/b', patternSource: 'router' });
    expect(h.bridge.registry.createSnapshot().page).toEqual({
      route: { pattern: '/b', patternSource: 'router' },
    });
    h.unmount();
  });

  it('under StrictMode (double-invoked effects) leaves the latest info set after mount', () => {
    let bridge!: UIBridgeNativeContextValue;
    function Capture() {
      bridge = useUIBridgeNative();
      return null;
    }
    function Reporter({ info }: { info: RouteInfo }) {
      useRouteAwareness(info);
      return null;
    }
    const view = render(
      <StrictMode>
        <UIBridgeNativeProvider features={FEATURES} config={CONFIG}>
          <Capture />
          <Reporter info={{ pattern: '/a', patternSource: 'router' }} />
        </UIBridgeNativeProvider>
      </StrictMode>
    );
    expect(bridge.registry.getRouteInfo()).toEqual({ pattern: '/a', patternSource: 'router' });
    view.rerender(
      <StrictMode>
        <UIBridgeNativeProvider features={FEATURES} config={CONFIG}>
          <Capture />
          <Reporter info={{ pattern: '/b', patternSource: 'router' }} />
        </UIBridgeNativeProvider>
      </StrictMode>
    );
    expect(bridge.registry.getRouteInfo()).toEqual({ pattern: '/b', patternSource: 'router' });
    view.unmount();
  });

  it('end to end: an Expo not-found render yields page.route.pattern null', () => {
    const h = mountUnderProvider({
      pattern: expoRouterPattern(['+not-found']),
      patternSource: 'router',
    });
    expect(h.bridge.registry.createSnapshot().page?.route?.pattern).toBeNull();
    h.unmount();
  });
});
