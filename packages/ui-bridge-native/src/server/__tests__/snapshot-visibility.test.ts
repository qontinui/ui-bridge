import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from '../../core/registry';
import { DefaultNativeActionExecutor } from '../../control/action-executor';
import { NativeUIBridgeServer } from '../http-server';
import type { NativeElementRef } from '../../core/types';
import type { RouteProvider } from '../types';

/**
 * Visibility filter coverage for `GET /control/snapshot?visibleOnly=...` and
 * `GET /control/elements?visibleOnly=...`.
 *
 * Regression: the /manual-test session on 2026-05-20 found that asking for
 * `visibleOnly=true&currentRouteOnly=true` on a populated mobile screen
 * returned 0 elements despite 41 mounted elements being on the active route.
 *
 * Root cause: `getVisibleElements()` required BOTH `state.visible === true`
 * AND `state.layout !== null`. React Native's `onLayout` is async — there's
 * a window after mount where the registry's `visible` flag is seeded to
 * `true` but `layout` is still `null`. The strict filter excluded every
 * element in that window.
 *
 * Fix: the visibleOnly filter at the snapshot/handler layer uses
 * `getMountedVisibleElements()` (the looser variant: `visible: true`
 * regardless of layout). Each element carries a `visibility` discriminator
 * (`"visible"` / `"likely-visible"` / `"hidden"`) so downstream callers can
 * branch on measured-vs-unmeasured.
 */

interface ParsedSnapshotResponse {
  success: boolean;
  data: {
    elements: Array<{
      id: string;
      visibility?: 'visible' | 'likely-visible' | 'hidden';
      state: { visible: boolean; layout: unknown };
      registrationRoute?: string | null;
    }>;
    currentRoute?: string | null;
  };
  timestamp: number;
}

interface ParsedElementsResponse {
  success: boolean;
  data: {
    elements: Array<{
      id: string;
      visibility?: 'visible' | 'likely-visible' | 'hidden';
    }>;
  };
}

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function buildServer() {
  const registry = new NativeUIBridgeRegistry();
  const executor = new DefaultNativeActionExecutor(registry);
  const server = new NativeUIBridgeServer(registry, executor);
  return { registry, server };
}

/**
 * Minimal RouteProvider that reports a single static route.
 * No subscribe semantics — markRouteOffscreen is driven manually by tests.
 */
function staticRouteProvider(route: string): RouteProvider {
  return {
    getCurrentRoute: () => route,
    getSegments: () => route.split('/').filter(Boolean),
    subscribe: () => () => {},
  };
}

describe('GET /control/snapshot?visibleOnly=true — regression: layout-pending elements', () => {
  it('returns ALL mounted elements on the active route even before onLayout fires', async () => {
    const { registry, server } = buildServer();
    server.setRouteProvider(staticRouteProvider('/settings'));

    // Populate /settings with several elements but DON'T set their layout —
    // simulating the state right after mount, before any onLayout callback
    // has fired. This is the exact scenario the manual-test session hit.
    for (let i = 0; i < 5; i++) {
      registry.registerElement(`settings-row-${i}`, makeRef(), {
        registrationRoute: '/settings',
      });
    }

    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/snapshot',
      headers: {},
      query: { visibleOnly: 'true', currentRouteOnly: 'true' },
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as ParsedSnapshotResponse;
    expect(parsed.success).toBe(true);
    // Pre-fix: 0. Post-fix: 5 (all visible-but-unmeasured elements come through).
    expect(parsed.data.elements.length).toBe(5);
    // Every element should be flagged as likely-visible since their
    // layouts are still null.
    for (const el of parsed.data.elements) {
      expect(el.visibility).toBe('likely-visible');
      expect(el.state.layout).toBeNull();
      expect(el.state.visible).toBe(true);
    }
  });

  it('emits visibility="visible" for elements with a measured layout', async () => {
    const { registry, server } = buildServer();
    server.setRouteProvider(staticRouteProvider('/dash'));

    registry.registerElement('measured', makeRef(), { registrationRoute: '/dash' });
    registry.updateElementState('measured', {
      visible: true,
      layout: { x: 0, y: 0, width: 100, height: 40, pageX: 0, pageY: 0 },
    });

    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/snapshot',
      headers: {},
      query: { visibleOnly: 'true', currentRouteOnly: 'true' },
    });

    const parsed = JSON.parse(res.body) as ParsedSnapshotResponse;
    expect(parsed.data.elements).toHaveLength(1);
    expect(parsed.data.elements[0].id).toBe('measured');
    expect(parsed.data.elements[0].visibility).toBe('visible');
  });

  it('filters out elements marked off-screen by markRouteOffscreen', async () => {
    const { registry, server } = buildServer();
    server.setRouteProvider(staticRouteProvider('/active'));

    registry.registerElement('on-active', makeRef(), { registrationRoute: '/active' });
    registry.registerElement('on-inactive', makeRef(), { registrationRoute: '/inactive' });

    // Simulate React Navigation transitioning away from /inactive while it
    // stays mounted — markRouteOffscreen sets visible:false, layout:null.
    registry.markRouteOffscreen('/inactive');

    // visibleOnly without currentRouteOnly — should include /active but skip /inactive.
    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/snapshot',
      headers: {},
      query: { visibleOnly: 'true' },
    });
    const parsed = JSON.parse(res.body) as ParsedSnapshotResponse;
    const ids = parsed.data.elements.map((e) => e.id);
    expect(ids).toContain('on-active');
    expect(ids).not.toContain('on-inactive');
  });

  it('mixes visible + likely-visible in the same response and discriminates them', async () => {
    const { registry, server } = buildServer();
    server.setRouteProvider(staticRouteProvider('/mix'));

    registry.registerElement('measured', makeRef(), { registrationRoute: '/mix' });
    registry.updateElementState('measured', {
      visible: true,
      layout: { x: 0, y: 0, width: 50, height: 50, pageX: 0, pageY: 0 },
    });
    registry.registerElement('pending', makeRef(), { registrationRoute: '/mix' });
    // intentionally leave 'pending' with the seeded {visible:true, layout:null}

    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/snapshot',
      headers: {},
      query: { visibleOnly: 'true', currentRouteOnly: 'true' },
    });

    const parsed = JSON.parse(res.body) as ParsedSnapshotResponse;
    const byId = new Map(parsed.data.elements.map((e) => [e.id, e.visibility]));
    expect(byId.get('measured')).toBe('visible');
    expect(byId.get('pending')).toBe('likely-visible');
  });
});

describe('GET /control/elements?visibleOnly=true — parity with snapshot', () => {
  it('uses the same looser filter so the two endpoints agree', async () => {
    const { registry, server } = buildServer();
    server.setRouteProvider(staticRouteProvider('/settings'));

    for (let i = 0; i < 3; i++) {
      registry.registerElement(`elt-${i}`, makeRef(), { registrationRoute: '/settings' });
    }

    const res = await server.handleRequest({
      method: 'GET',
      path: '/ui-bridge/control/elements',
      headers: {},
      query: { visibleOnly: 'true', currentRouteOnly: 'true' },
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as ParsedElementsResponse;
    expect(parsed.data.elements).toHaveLength(3);
    for (const el of parsed.data.elements) {
      expect(el.visibility).toBe('likely-visible');
    }
  });
});

describe('strict getVisibleElements() preserves the legacy contract', () => {
  it('still requires layout !== null for backward compat with non-snapshot callers', () => {
    const { registry } = buildServer();

    registry.registerElement('measured', makeRef(), {});
    registry.updateElementState('measured', {
      visible: true,
      layout: { x: 0, y: 0, width: 10, height: 10, pageX: 0, pageY: 0 },
    });

    registry.registerElement('layout-pending', makeRef(), {});
    // seeded visible:true, layout:null — getVisibleElements must exclude it

    const strict = registry.getVisibleElements();
    expect(strict.map((e) => e.id)).toEqual(['measured']);

    // The looser variant includes both
    const loose = registry.getMountedVisibleElements();
    expect(loose.map((e) => e.id).sort()).toEqual(['layout-pending', 'measured']);
  });
});
