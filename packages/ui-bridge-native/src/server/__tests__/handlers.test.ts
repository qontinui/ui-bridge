import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import type { NativeAppInfo, NativeElementRef } from '../../core/types';
import type { NativeActionExecutor } from '../../control/types';
import type { RouteProvider } from '../types';
import { createServerHandlers } from '../handlers';
import { NativeUIBridgeServer } from '../http-server';

/**
 * Minimal `NativeActionExecutor` stub. The handlers covered by these tests
 * (`getSnapshot`, `health`) never invoke the executor, so we just supply
 * unimplemented methods that throw if accidentally called — that way a future
 * regression that starts touching the executor in those handlers will fail
 * loudly instead of silently passing.
 */
function makeStubExecutor(): NativeActionExecutor {
  const unused = (): never => {
    throw new Error('executor method should not be called by snapshot/health handlers');
  };
  return {
    executeAction: unused,
    executeComponentAction: unused,
    find: unused,
    waitForElement: unused,
    onActionExecuted: () => () => {},
  } as unknown as NativeActionExecutor;
}

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

describe('snapshot.registration coverage', () => {
  it('reports zero registrations and never-had-registrations on an empty registry', async () => {
    const registry = new NativeUIBridgeRegistry();
    const handlers = createServerHandlers(registry, makeStubExecutor());

    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.registration).toEqual({
      totalRegistered: 0,
      everHadRegistrations: false,
      byRoute: {},
    });
  });

  it('groups elements by registrationRoute and buckets unrouted elements under "?"', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('with-route', makeRef(), { registrationRoute: '/foo' });
    registry.registerElement('no-route', makeRef(), {});

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.registration).toEqual({
      totalRegistered: 2,
      everHadRegistrations: true,
      byRoute: { '/foo': 1, '?': 1 },
    });
  });

  it('keeps everHadRegistrations sticky after all elements unregister', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/foo' });
    registry.registerElement('b', makeRef(), { registrationRoute: '/foo' });
    registry.unregisterElement('a');
    registry.unregisterElement('b');

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.registration).toEqual({
      totalRegistered: 0,
      everHadRegistrations: true,
      byRoute: {},
    });
  });

  it('counts multiple elements on the same route correctly', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/dashboard' });
    registry.registerElement('b', makeRef(), { registrationRoute: '/dashboard' });
    registry.registerElement('c', makeRef(), { registrationRoute: '/settings' });

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.data?.registration).toEqual({
      totalRegistered: 3,
      everHadRegistrations: true,
      byRoute: { '/dashboard': 2, '/settings': 1 },
    });
  });
});

describe('health.registration coverage', () => {
  it('includes the same registration block as the snapshot handler', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/foo' });
    registry.registerElement('b', makeRef(), {});

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.health({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    const data = response.data as Record<string, unknown>;
    expect(data.registration).toEqual({
      totalRegistered: 2,
      everHadRegistrations: true,
      byRoute: { '/foo': 1, '?': 1 },
    });
    expect(data.status).toBe('healthy');
    expect(typeof data.timestamp).toBe('number');
  });

  it('reports an empty-registry coverage block when nothing has been registered', async () => {
    const registry = new NativeUIBridgeRegistry();
    const handlers = createServerHandlers(registry, makeStubExecutor());

    const response = await handlers.health({ params: {}, query: {}, body: undefined });

    const data = response.data as Record<string, unknown>;
    expect(data.registration).toEqual({
      totalRegistered: 0,
      everHadRegistrations: false,
      byRoute: {},
    });
  });

  it('still emits registration when appInfo is configured (alongside the uiBridge block)', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/foo' });

    const handlers = createServerHandlers(registry, makeStubExecutor(), {
      appInfo: {
        appId: 'test-app',
        appName: 'Test App',
        appType: 'mobile',
        framework: 'react-native',
      },
    });

    const response = await handlers.health({ params: {}, query: {}, body: undefined });
    const data = response.data as Record<string, unknown>;

    expect(data.registration).toEqual({
      totalRegistered: 1,
      everHadRegistrations: true,
      byRoute: { '/foo': 1 },
    });
    expect(data.uiBridge).toBeDefined();
  });
});

describe('snapshot.appInfo', () => {
  // Issue 1: appInfo was read by the SDK and surfaced in /health, but never
  // included in /control/snapshot. Mobile snapshots returned `appInfo: {}` or
  // missing. The fix routes appInfo through the registry so both default and
  // routeProvider-overridden getSnapshot paths emit it.

  const APP_INFO: NativeAppInfo = {
    appId: 'qontinui-mobile',
    appName: 'Qontinui Mobile',
    appType: 'mobile',
    framework: 'expo',
  };

  it('omits appInfo when no config.appInfo was provided', async () => {
    const registry = new NativeUIBridgeRegistry();
    const handlers = createServerHandlers(registry, makeStubExecutor());

    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.appInfo).toBeUndefined();
  });

  it('omits appInfo when config.appInfo is omitted from server config', async () => {
    // Server constructor mirrors `config.appInfo` into the registry; when
    // it's missing, the registry holds nothing and the snapshot stays clean.
    const registry = new NativeUIBridgeRegistry();
    const server = new NativeUIBridgeServer(registry, makeStubExecutor(), { cors: false });

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/snapshot',
      headers: {},
      query: {},
    });

    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data?.appInfo).toBeUndefined();
  });

  it('includes appInfo on the snapshot when wired via the server constructor', async () => {
    // End-to-end: NativeUIBridgeServer wires config.appInfo into the registry
    // automatically, so /control/snapshot picks it up without the caller
    // having to thread it through manually.
    const registry = new NativeUIBridgeRegistry();
    const server = new NativeUIBridgeServer(registry, makeStubExecutor(), {
      appInfo: APP_INFO,
      cors: false,
    });

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/snapshot',
      headers: {},
      query: {},
    });

    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data?.appInfo).toEqual(APP_INFO);
  });

  it('includes appInfo when set directly on the registry (covers context.createSnapshot)', async () => {
    // Direct registry path — used by the React provider's
    // `context.createSnapshot()` value, which doesn't go through the HTTP
    // server. Setting on the registry covers both code paths.
    const registry = new NativeUIBridgeRegistry();
    registry.setAppInfo(APP_INFO);

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.appInfo).toEqual(APP_INFO);

    // And the bare registry call returns the same shape.
    expect(registry.createSnapshot().appInfo).toEqual(APP_INFO);
  });

  it('includes appInfo on the snapshot even after setRouteProvider installs the override path', async () => {
    // The setRouteProvider override re-binds getSnapshot. Make sure that
    // override didn't accidentally drop the appInfo we threaded through
    // the registry — both paths must populate it identically.
    const registry = new NativeUIBridgeRegistry();
    const server = new NativeUIBridgeServer(registry, makeStubExecutor(), {
      appInfo: APP_INFO,
      cors: false,
    });

    const provider: RouteProvider = {
      getCurrentRoute: () => '/(tabs)/runs',
      getSegments: () => ['(tabs)', 'runs'],
      subscribe: () => () => {},
    };
    server.setRouteProvider(provider);

    const response = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/snapshot',
      headers: {},
      query: {},
    });

    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data?.appInfo).toEqual(APP_INFO);
    expect(body.data?.currentRoute).toBe('/(tabs)/runs');
  });
});

describe('snapshot.currentRoute / segments', () => {
  // Issue 2: route was null in live snapshots even when RouteTracker was
  // mounted, because the bare-server / cloud-relay path used the default
  // getSnapshot which never read route info. Forwarding the provider into
  // the registry gives the default handler the same data the override had.

  it('emits currentRoute: null when no route provider is wired', async () => {
    const registry = new NativeUIBridgeRegistry();
    const handlers = createServerHandlers(registry, makeStubExecutor());

    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.currentRoute).toBeNull();
    expect(response.data?.segments).toBeUndefined();
  });

  it('default getSnapshot reads currentRoute from a registry-registered provider', async () => {
    // This is the scenario we couldn't satisfy before the fix — the default
    // handler had no access to the route provider, so the snapshot returned
    // null even when the provider was wired into the server.
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/dashboard',
      getSegments: () => ['(tabs)', 'dashboard'],
    });

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    expect(response.data?.currentRoute).toBe('/(tabs)/dashboard');
    expect(response.data?.segments).toEqual(['(tabs)', 'dashboard']);
  });

  it('NativeUIBridgeServer.setRouteProvider forwards into the registry so the default handler works', async () => {
    // End-to-end: the server's setRouteProvider must forward the provider
    // into the registry, so even code paths that don't use the
    // server-handler override (cloud-relay tunnel, registry.createSnapshot,
    // etc.) read live route data.
    const registry = new NativeUIBridgeRegistry();
    const server = new NativeUIBridgeServer(registry, makeStubExecutor(), { cors: false });

    let currentRoute: string | null = '/(tabs)/runs';
    server.setRouteProvider({
      getCurrentRoute: () => currentRoute,
      getSegments: () => (currentRoute ? currentRoute.split('/').filter(Boolean) : []),
      subscribe: () => () => {},
    });

    // The provider is now in the registry — registry.createSnapshot() should
    // pick it up directly, bypassing the server's handler override entirely.
    const direct = registry.createSnapshot();
    expect(direct.currentRoute).toBe('/(tabs)/runs');

    // And changes to the provider's view of the world flow through.
    currentRoute = '/(tabs)/settings';
    expect(registry.createSnapshot().currentRoute).toBe('/(tabs)/settings');
  });

  it('explicit routeInfo passed to createSnapshot wins over the registry fallback', async () => {
    // Backwards-compat guard: the server's setRouteProvider override still
    // calls createSnapshot with explicit routeInfo, and that path must keep
    // working unchanged when both are set.
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({ getCurrentRoute: () => '/from-registry' });

    const snap = registry.createSnapshot({ currentRoute: '/from-explicit', segments: ['x'] });

    expect(snap.currentRoute).toBe('/from-explicit');
    expect(snap.segments).toEqual(['x']);
  });

  it('isolates throws from a misbehaving routeProvider without breaking the snapshot', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => {
        throw new Error('boom');
      },
    });

    // Should not throw, and the snapshot's currentRoute should fall back to null
    // (other fields remain populated).
    const snap = registry.createSnapshot();
    expect(snap.currentRoute).toBeNull();
    expect(snap.timestamp).toBeGreaterThan(0);
  });

  it('clears the route provider when set to null', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({ getCurrentRoute: () => '/wired' });
    expect(registry.createSnapshot().currentRoute).toBe('/wired');

    registry.setRouteProvider(null);
    expect(registry.createSnapshot().currentRoute).toBeNull();
  });
});

describe('measure-on-snapshot refresh (read-time geometry)', () => {
  function makeMeasuringRef(
    impl: (cb: (pageX: number, pageY: number, w: number, h: number) => void) => void
  ): React.RefObject<NativeElementRef> {
    return {
      current: { measureInWindow: impl } as unknown as NativeElementRef,
    };
  }

  /** Mount-time layout at pageY 100 — the "stale" position. */
  const staleLayout = { x: 0, y: 100, width: 100, height: 50, pageX: 0, pageY: 100 };

  it('getSnapshot serves the re-measured bbox, not the stale stored layout', async () => {
    const registry = new NativeUIBridgeRegistry();
    // The ref reports the element's CURRENT position (scrolled to pageY 360)
    // while the registry still stores the mount-time layout (pageY 100).
    registry.registerElement('cell', makeMeasuringRef((cb) => cb(0, 360, 100, 50)), {
      type: 'view',
    });
    registry.updateElementState('cell', { visible: true, layout: staleLayout });

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getSnapshot({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    const cell = response.data!.elements.find((e) => e.id === 'cell')!;
    expect(cell.bbox).toEqual({ x: 0, y: 360, w: 100, h: 50 });
    expect(cell.state.layout).toMatchObject({ pageX: 0, pageY: 360 });
  });

  it('getElements serves the re-measured layout, not the stale stored layout', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('cell', makeMeasuringRef((cb) => cb(40, 720, 200, 44)), {
      type: 'view',
    });
    registry.updateElementState('cell', { visible: true, layout: staleLayout });

    const handlers = createServerHandlers(registry, makeStubExecutor());
    const response = await handlers.getElements({ params: {}, query: {}, body: undefined });

    expect(response.success).toBe(true);
    const data = response.data as {
      elements: Array<{ id: string; state: { layout: { pageX: number; pageY: number } | null } }>;
    };
    const cell = data.elements.find((e) => e.id === 'cell')!;
    expect(cell.state.layout).toMatchObject({ pageX: 40, pageY: 720, width: 200, height: 44 });
  });

  it('tapAt hit-tests against the re-measured rect (post-scroll position)', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('retry-btn', makeMeasuringRef((cb) => cb(0, 360, 100, 50)), {
      type: 'button',
    });
    registry.updateElementState('retry-btn', { visible: true, layout: staleLayout });

    const executed: Array<{ elementId: string; action: string }> = [];
    const executor = {
      executeAction: async (elementId: string, req: { action: string }) => {
        executed.push({ elementId, action: req.action });
        return { success: true, timestamp: Date.now() };
      },
      executeComponentAction: () => {
        throw new Error('not used');
      },
      find: () => {
        throw new Error('not used');
      },
      waitForElement: () => {
        throw new Error('not used');
      },
      onActionExecuted: () => () => {},
    } as unknown as NativeActionExecutor;

    const handlers = createServerHandlers(registry, executor);

    // Tap inside the CURRENT rect (pageY 360..410). With the stale stored
    // layout (pageY 100..150) this point would miss entirely.
    const hit = await handlers.tapAt({ params: {}, query: {}, body: { x: 50, y: 380 } });
    expect(hit.success).toBe(true);
    expect(hit.data?.elementId).toBe('retry-btn');
    expect(executed).toEqual([{ elementId: 'retry-btn', action: 'press' }]);

    // The mount-time rect no longer matches — the stale position is gone.
    const miss = await handlers.tapAt({ params: {}, query: {}, body: { x: 50, y: 120 } });
    expect(miss.success).toBe(false);
  });
});
