import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import type { NativeElementRef } from '../../core/types';
import type { RouteProvider } from '../types';

/**
 * `GET /control/snapshot` — the canonical `route` / `activeTab` aliases, read
 * through the SERVER rather than the registry.
 *
 * Why this file exists: `NativeUIBridgeServer.setRouteProvider` installs a
 * `getSnapshot` handler override that calls `registry.createSnapshot(routeInfo)`
 * with an explicit `routeInfo` argument. That is a DIFFERENT branch of
 * `createSnapshot` from the one the registry-level tests exercise (which pass
 * no argument and fall back to the registered provider), and it is the branch
 * that actually serves this route for every app that wires a route provider —
 * i.e. every app that has a route to report.
 *
 * When `activeTab` was introduced, that branch derived the value straight from
 * `routeInfo.segments` and never consulted `resolveActiveTab`, so
 * `RouteProvider.getActiveTab` — the documented opt-in for an app whose visible
 * pane is decoupled from the router — reached no consumer at all while the
 * registry-level tests for it stayed green.
 *
 * Which of these are regression guards, stated honestly (verified by reverting
 * the fix and re-running): `honours RouteProvider.getActiveTab`, and the two
 * throwing-provider cases, FAIL without it. The first case (`emits the
 * canonical aliases`) and `falls back to the derivation when getActiveTab
 * throws` pass either way — the derivation happens to give the same answer —
 * and are kept as contract pins, not as proof of the fix.
 */

interface ParsedSnapshotResponse {
  success: boolean;
  data: {
    currentRoute?: string | null;
    segments?: string[];
    route?: string;
    activeTab?: string;
  };
}

function buildServer() {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  const server = new NativeUIBridgeServer(registry, executor);
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

describe('GET /control/snapshot — canonical route/activeTab through the server', () => {
  it('emits the canonical aliases beside the native-only fields', async () => {
    const { server } = buildServer();
    const provider: RouteProvider = {
      getCurrentRoute: () => '/(tabs)/runs',
      getSegments: () => ['(tabs)', 'runs'],
      subscribe: () => () => {},
    };
    server.setRouteProvider(provider);

    const data = await snapshot(server);

    expect(data.route).toBe('/(tabs)/runs');
    expect(data.activeTab).toBe('runs');
    expect(data.currentRoute).toBe('/(tabs)/runs');
    expect(data.segments).toEqual(['(tabs)', 'runs']);
  });

  it('honours RouteProvider.getActiveTab over the segment derivation', async () => {
    const { server } = buildServer();
    const provider: RouteProvider = {
      getCurrentRoute: () => '/(tabs)/runs',
      getSegments: () => ['(tabs)', 'runs'],
      // An app with a segmented control: the visible pane is not the route.
      getActiveTab: () => 'custom-pane',
      subscribe: () => () => {},
    };
    server.setRouteProvider(provider);

    // Pre-fix this answered "runs" — the derivation — silently discarding the
    // host's explicit answer.
    expect((await snapshot(server)).activeTab).toBe('custom-pane');
  });

  it('falls back to the derivation when getActiveTab throws', async () => {
    const { server } = buildServer();
    server.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/fleet',
      getSegments: () => ['(tabs)', 'fleet'],
      getActiveTab: () => {
        throw new Error('host bug');
      },
      subscribe: () => () => {},
    });

    // A host's opt-in extra must never make the snapshot WORSE than it was
    // without it.
    expect((await snapshot(server)).activeTab).toBe('fleet');
  });

  it('degrades to a routeless snapshot rather than 500ing when the provider throws', async () => {
    const { server } = buildServer();
    server.setRouteProvider({
      getCurrentRoute: () => {
        throw new Error('navigation ref not ready');
      },
      subscribe: () => () => {},
    });

    // The registry's own fallback path already caught this; the server's
    // override read the provider unguarded, so the same throwing host turned
    // the whole route into a 500 depending only on which path served it.
    const data = await snapshot(server);
    expect(data.currentRoute).toBeNull();
    expect('route' in data).toBe(false);
    expect('activeTab' in data).toBe(false);
  });

  it('keeps the route (and therefore the route filter) when only getSegments throws', async () => {
    const { registry, server } = buildServer();
    server.setRouteProvider({
      getCurrentRoute: () => '/settings',
      getSegments: () => {
        throw new Error('segments unavailable mid-navigation');
      },
      subscribe: () => () => {},
    });
    registry.registerElement(
      'on-route',
      { current: {} as NativeElementRef },
      { registrationRoute: '/settings' }
    );
    registry.registerElement(
      'off-route',
      { current: {} as NativeElementRef },
      { registrationRoute: '/other' }
    );

    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/snapshot',
      headers: {},
      query: { currentRouteOnly: 'true' },
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as {
      data: { currentRoute?: string | null; elements: Array<{ id: string }> };
    };

    // The three provider reads are guarded separately for exactly this reason.
    // Sharing one try/catch discarded the successfully-read route, and
    // `createSnapshot` only applies the `currentRouteOnly` filter when the route
    // is truthy — so the response would have been 200 carrying EVERY registered
    // element in the app, presented as this route's. A silent wrong answer that
    // a runner would then act on, from what used to be a loud 500.
    expect(parsed.data.currentRoute).toBe('/settings');
    expect(parsed.data.elements.map((e) => e.id)).toEqual(['on-route']);
  });

  it('does not 500 /control/elements when a throwing provider meets currentRouteOnly', async () => {
    const { registry, server } = buildServer();
    server.setRouteProvider({
      getCurrentRoute: () => {
        throw new Error('navigation ref not ready');
      },
      subscribe: () => () => {},
    });
    registry.registerElement(
      'row-0',
      { current: {} as NativeElementRef },
      { registrationRoute: '/settings' }
    );

    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/elements',
      headers: {},
      query: { currentRouteOnly: 'true' },
    });

    expect(res.status).toBe(200);
  });
});
