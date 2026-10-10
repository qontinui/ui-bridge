import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import type { RouteInfo } from '../../core/types';
import type { RouteProvider } from '../types';

/**
 * `GET /control/snapshot` — `page.route`, read through the SERVER rather than
 * the registry (plan `2026-10-10-ui-bridge-native-exports-no-use-route-awareness`,
 * Phase 2).
 *
 * Same harness and same reason as `snapshot-route-canonical.test.ts`:
 * `NativeUIBridgeServer.setRouteProvider` installs a `getSnapshot` override
 * that calls `registry.createSnapshot(routeInfo)` with an EXPLICIT argument —
 * a different `createSnapshot` branch from the registry-level tests, and the
 * one that serves this route for every app that has a route to report. The
 * runner's journey ledger reads `page.route.pattern` off exactly this
 * response, so `page.route` must be emitted on this branch.
 */

interface ParsedSnapshotResponse {
  success: boolean;
  data: {
    currentRoute?: string | null;
    route?: string;
    page?: { route?: RouteInfo };
  };
}

function buildServer(currentRoute: string) {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  const server = new NativeUIBridgeServer(registry, executor);
  const provider: RouteProvider = {
    getCurrentRoute: () => currentRoute,
    getSegments: () => currentRoute.split('/').filter(Boolean),
    subscribe: () => () => {},
  };
  server.setRouteProvider(provider);
  return { registry, server };
}

async function snapshot(server: NativeUIBridgeServer): Promise<ParsedSnapshotResponse['data']> {
  const res = await server.handleRequest({
    method: 'GET',
    path: '/ui-bridge/control/snapshot',
    headers: {},
    query: {},
  });
  expect(res.status).toBe(200);
  const parsed = JSON.parse(res.body) as ParsedSnapshotResponse;
  expect(parsed.success).toBe(true);
  return parsed.data;
}

describe('GET /control/snapshot — page.route through the server override branch', () => {
  it('carries page.route once route info is set, independent of currentRoute', async () => {
    const { registry, server } = buildServer('/profile/alice');
    registry.setRouteInfo({ pattern: '/profile/[user]', patternSource: 'router' });

    const data = await snapshot(server);

    expect(data.page?.route).toEqual({ pattern: '/profile/[user]', patternSource: 'router' });
    // The concrete path still reaches its own field, from the provider.
    expect(data.currentRoute).toBe('/profile/alice');
    expect(data.route).toBe('/profile/alice');
  });

  it('omits page when no route info is set', async () => {
    const { server } = buildServer('/profile/alice');
    const data = await snapshot(server);
    expect('page' in data).toBe(false);
    expect(data.currentRoute).toBe('/profile/alice');
  });

  it('omits page again after route info is cleared', async () => {
    const { registry, server } = buildServer('/profile/alice');
    registry.setRouteInfo({ pattern: '/profile/[user]', patternSource: 'router' });
    registry.setRouteInfo(undefined);
    expect('page' in (await snapshot(server))).toBe(false);
  });

  it('never leaks the concrete path into page when the pattern is null', async () => {
    const { registry, server } = buildServer('/search/secret-sentinel');
    registry.setRouteInfo({ pattern: null, patternSource: 'router' });

    const data = await snapshot(server);

    expect(data.page).toEqual({ route: { pattern: null, patternSource: 'router' } });
    expect(JSON.stringify(data.page)).not.toContain('secret-sentinel');
    // The provider's concrete value is where it belongs, and only there.
    expect(data.currentRoute).toBe('/search/secret-sentinel');
  });
});
