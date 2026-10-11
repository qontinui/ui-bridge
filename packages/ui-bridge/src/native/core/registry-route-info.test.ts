import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from './registry';
import { createServerHandlers } from '../server/handlers';
import type { RouteInfo } from './types';

/**
 * The registry's route-info slot, emitted as `page.route` (plan
 * `2026-10-10-ui-bridge-native-exports-no-use-route-awareness`, Phase 2),
 * mirrored into this `@qontinui/ui-bridge/native` twin (finding `4fa33d87`).
 *
 * `page.route` is spelled as the web SDK's `snapshot.page.route`, which the
 * runner's journey ledger reads as a route TEMPLATE. This twin's
 * `createSnapshot` has a single assembly point and no enrichers, so the
 * registry contract plus the server's `getSnapshot` handler cover every path
 * that emits a snapshot.
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

  it('copies the info out, so mutating an emitted snapshot or a getRouteInfo result alters nothing', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteInfo({
      pattern: '/profile/[user]',
      patternSource: 'router',
      params: { user: 'alice' },
      routeStack: ['/', '/profile', '/profile/[user]'],
    });
    const expected = {
      route: {
        pattern: '/profile/[user]',
        patternSource: 'router',
        params: { user: 'alice' },
        routeStack: ['/', '/profile', '/profile/[user]'],
      },
    };
    const snapshot = registry.createSnapshot();
    snapshot.page!.route!.params!.user = 'mallory';
    snapshot.page!.route!.routeStack!.push('extra');
    expect(registry.createSnapshot().page).toEqual(expected);
    const read = registry.getRouteInfo()!;
    read.params!.user = 'mallory';
    read.routeStack!.push('extra');
    expect(registry.createSnapshot().page).toEqual(expected);
  });

  it('reaches GET /control/snapshot through the server getSnapshot handler', async () => {
    const registry = new NativeUIBridgeRegistry();
    const handlers = createServerHandlers(registry, {} as never);
    registry.setRouteInfo(PROFILE);
    const withRoute = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });
    expect(withRoute.success).toBe(true);
    expect(withRoute.data?.page).toEqual({
      route: { pattern: '/profile/[user]', patternSource: 'router' },
    });
    registry.setRouteInfo(undefined);
    const cleared = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });
    expect(cleared.data && 'page' in cleared.data).toBe(false);
  });
});
