import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from './registry';
import type { NativeElementRef, RouteInfo } from './types';

/**
 * The registry's route-info slot, emitted as `page.route` (plan
 * `2026-10-10-ui-bridge-native-exports-no-use-route-awareness`, Phase 2).
 *
 * `page.route` is spelled as the web SDK's `snapshot.page.route`, which the
 * runner's journey ledger reads as a route TEMPLATE. These tests pin the
 * registry-level contract; the server branch (`GET /control/snapshot` through
 * the `setRouteProvider` override) is pinned in
 * `server/__tests__/snapshot-page-route.test.ts`.
 */

const PROFILE: RouteInfo = { pattern: '/profile/[user]', patternSource: 'router' };

describe('NativeUIBridgeRegistry route info → page.route', () => {
  it('omits page entirely when no route info is set', () => {
    const registry = new NativeUIBridgeRegistry();
    const snapshot = registry.createSnapshot();
    expect('page' in snapshot).toBe(false);
    expect(registry.getRouteInfo()).toBeUndefined();
  });

  it('emits page.route once route info is set', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteInfo(PROFILE);
    expect(registry.createSnapshot().page).toEqual({
      route: { pattern: '/profile/[user]', patternSource: 'router' },
    });
    expect(registry.getRouteInfo()).toEqual({
      pattern: '/profile/[user]',
      patternSource: 'router',
    });
  });

  it('emits page.route on the explicit-routeInfo branch too', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteInfo(PROFILE);
    const snapshot = registry.createSnapshot({ currentRoute: '/profile/alice', segments: [] });
    expect(snapshot.page).toEqual({
      route: { pattern: '/profile/[user]', patternSource: 'router' },
    });
    expect(snapshot.currentRoute).toBe('/profile/alice');
  });

  it('omits page again once route info is cleared', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteInfo(PROFILE);
    registry.setRouteInfo(undefined);
    expect('page' in registry.createSnapshot()).toBe(false);
    expect(registry.getRouteInfo()).toBeUndefined();
  });

  it('carries every RouteInfo field through verbatim', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteInfo({
      pattern: '/(tabs)/runs/[id]',
      patternSource: 'router',
      params: { id: '7' },
      queryParams: { tab: 'logs' },
      routeStack: ['/', '/(tabs)', '/(tabs)/runs', '/(tabs)/runs/[id]'],
    });
    expect(registry.createSnapshot().page).toEqual({
      route: {
        pattern: '/(tabs)/runs/[id]',
        patternSource: 'router',
        params: { id: '7' },
        queryParams: { tab: 'logs' },
        routeStack: ['/', '/(tabs)', '/(tabs)/runs', '/(tabs)/runs/[id]'],
      },
    });
  });

  it('copies the info, so a later caller mutation alters neither the slot nor an emitted snapshot', () => {
    const registry = new NativeUIBridgeRegistry();
    const info: RouteInfo = {
      pattern: '/profile/[user]',
      patternSource: 'router',
      params: { user: 'alice' },
      routeStack: ['/', '/profile', '/profile/[user]'],
    };
    registry.setRouteInfo(info);
    const before = registry.createSnapshot();
    info.pattern = '/mutated';
    info.params!.user = 'mallory';
    info.routeStack!.push('extra');
    expect(before.page?.route?.pattern).toBe('/profile/[user]');
    expect(registry.createSnapshot().page).toEqual({
      route: {
        pattern: '/profile/[user]',
        patternSource: 'router',
        params: { user: 'alice' },
        routeStack: ['/', '/profile', '/profile/[user]'],
      },
    });
  });

  it('leaves page unaffected by the visibleOnly and currentRouteOnly options', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement(
      'on-route',
      { current: {} as NativeElementRef },
      { registrationRoute: '/profile/alice' }
    );
    registry.setRouteInfo(PROFILE);
    const expected = { route: { pattern: '/profile/[user]', patternSource: 'router' } };
    expect(
      registry.createSnapshot({ currentRoute: '/profile/alice' }, { currentRouteOnly: true }).page
    ).toEqual(expected);
    expect(registry.createSnapshot(undefined, { visibleOnly: true }).page).toEqual(expected);
  });

  it('a custom enricher returning page neither displaces nor contaminates page.route', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerSnapshotEnricher('rogue', () => ({
      page: { route: { pattern: '/x/secret' } },
    }));
    registry.setRouteInfo(PROFILE);
    const snapshot = registry.createSnapshot();
    expect(snapshot.page).toEqual({
      route: { pattern: '/profile/[user]', patternSource: 'router' },
    });
    expect(JSON.stringify(snapshot.page)).not.toContain('secret');
  });

  it("leaves an enricher's page as written when no route info is set", () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerSnapshotEnricher('host', () => ({ page: { custom: true } }));
    expect((registry.createSnapshot() as { page?: unknown }).page).toEqual({ custom: true });
  });
});
