import { describe, it, expect, vi } from 'vitest';
import {
  NativeUIBridgeRegistry,
  matchesCurrentRoute,
  deriveActiveTabFromSegments,
} from './registry';
import type { NativeElementRef } from './types';

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

describe('NativeUIBridgeRegistry.markRouteOffscreen', () => {
  it('clears visible/layout for elements registered on a specific route', () => {
    const registry = new NativeUIBridgeRegistry();

    registry.registerElement('a', makeRef(), { registrationRoute: '/settings' });
    registry.registerElement('b', makeRef(), { registrationRoute: '/settings' });
    registry.registerElement('c', makeRef(), { registrationRoute: '/dashboard' });

    // Give each element a real layout so we can verify it gets cleared
    const seedLayout = { x: 0, y: 0, width: 100, height: 20, pageX: 0, pageY: 0 };
    registry.updateElementState('a', { visible: true, layout: seedLayout });
    registry.updateElementState('b', { visible: true, layout: seedLayout });
    registry.updateElementState('c', { visible: true, layout: seedLayout });

    registry.markRouteOffscreen('/settings');

    expect(registry.getElement('a')!.getState().visible).toBe(false);
    expect(registry.getElement('a')!.getState().layout).toBeNull();
    expect(registry.getElement('b')!.getState().visible).toBe(false);
    expect(registry.getElement('b')!.getState().layout).toBeNull();

    // The element on a different route stays untouched
    expect(registry.getElement('c')!.getState().visible).toBe(true);
    expect(registry.getElement('c')!.getState().layout).toEqual(seedLayout);
  });

  it('does not touch elements without a registrationRoute (app-wide registrations)', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('global', makeRef(), {});
    const seedLayout = { x: 0, y: 0, width: 50, height: 10, pageX: 0, pageY: 0 };
    registry.updateElementState('global', { visible: true, layout: seedLayout });

    registry.markRouteOffscreen('/settings');

    expect(registry.getElement('global')!.getState().visible).toBe(true);
    expect(registry.getElement('global')!.getState().layout).toEqual(seedLayout);
  });

  it('is a no-op when no elements are registered on the given route', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/dashboard' });
    const seed = { x: 0, y: 0, width: 1, height: 1, pageX: 0, pageY: 0 };
    registry.updateElementState('a', { visible: true, layout: seed });

    registry.markRouteOffscreen('/nonexistent');

    expect(registry.getElement('a')!.getState().visible).toBe(true);
    expect(registry.getElement('a')!.getState().layout).toEqual(seed);
  });

  it('refuses to wipe global (null-route) elements when called with null or empty', () => {
    const registry = new NativeUIBridgeRegistry();
    // Global element — registered without a route, normalized to null
    registry.registerElement('global', makeRef(), {});
    const seed = { x: 0, y: 0, width: 1, height: 1, pageX: 0, pageY: 0 };
    registry.updateElementState('global', { visible: true, layout: seed });

    // Calling with null must not match registrationRoute: null globals
    // @ts-expect-error — deliberately passing an invalid route to test the guard
    registry.markRouteOffscreen(null);
    registry.markRouteOffscreen('');

    expect(registry.getElement('global')!.getState().visible).toBe(true);
    expect(registry.getElement('global')!.getState().layout).toEqual(seed);
  });

  it('preserves mounted/enabled/focused fields when clearing layout', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/settings' });
    registry.updateElementState('a', {
      mounted: true,
      visible: true,
      enabled: true,
      focused: true,
      layout: { x: 0, y: 0, width: 10, height: 10, pageX: 0, pageY: 0 },
    });

    registry.markRouteOffscreen('/settings');

    const state = registry.getElement('a')!.getState();
    expect(state.mounted).toBe(true); // Element is still mounted in the tree
    expect(state.enabled).toBe(true); // Still interactive, just off-screen
    expect(state.focused).toBe(true); // Preserves focus state
    expect(state.visible).toBe(false);
    expect(state.layout).toBeNull();
  });

  it('allows the element to regain layout when onLayout re-fires after offscreen', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/settings' });
    const first = { x: 0, y: 0, width: 10, height: 10, pageX: 0, pageY: 0 };
    registry.updateElementState('a', { visible: true, layout: first });

    // User leaves settings → onscreen tracker fires
    registry.markRouteOffscreen('/settings');
    expect(registry.getElement('a')!.getState().layout).toBeNull();

    // User returns, RN re-measures via onLayout → updateElementState with fresh layout
    const second = { x: 0, y: 50, width: 20, height: 20, pageX: 0, pageY: 50 };
    registry.updateElementState('a', { visible: true, layout: second });

    const state = registry.getElement('a')!.getState();
    expect(state.visible).toBe(true);
    expect(state.layout).toEqual(second);
  });

  it('keeps elements registered (not deleted) after markRouteOffscreen', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/settings' });

    registry.markRouteOffscreen('/settings');

    expect(registry.getElement('a')).toBeDefined();
    expect(registry.getAllElements()).toHaveLength(1);
  });
});

describe('RouteProvider subscribe contract', () => {
  // Integration-level test: a simple pub/sub RouteProvider should correctly
  // drive markRouteOffscreen via the listener it receives.
  it('listener dispatches markRouteOffscreen for the departed route', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/settings' });
    const seed = { x: 0, y: 0, width: 10, height: 10, pageX: 0, pageY: 0 };
    registry.updateElementState('a', { visible: true, layout: seed });

    // Simulate the handleRouteChange logic from UIBridgeNativeProvider
    let lastRoute: string | null = '/settings';
    const handleRouteChange = (current: string | null) => {
      if (current !== lastRoute && lastRoute != null) {
        registry.markRouteOffscreen(lastRoute);
      }
      lastRoute = current;
    };

    // User navigates /settings → /
    handleRouteChange('/');

    expect(registry.getElement('a')!.getState().visible).toBe(false);
    expect(registry.getElement('a')!.getState().layout).toBeNull();
  });

  it('listener skips null→route transitions without error', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/' });
    const seed = { x: 0, y: 0, width: 10, height: 10, pageX: 0, pageY: 0 };
    registry.updateElementState('a', { visible: true, layout: seed });

    let lastRoute: string | null = null;
    const handleRouteChange = (current: string | null) => {
      if (current !== lastRoute && lastRoute != null) {
        registry.markRouteOffscreen(lastRoute);
      }
      lastRoute = current;
    };

    // Startup: null → "/"  (lastRoute advances but no offscreen marking)
    handleRouteChange('/');
    expect(registry.getElement('a')!.getState().layout).toEqual(seed);

    // Subsequent: "/" → "/settings"  (now "/" gets cleared)
    handleRouteChange('/settings');
    expect(registry.getElement('a')!.getState().visible).toBe(false);
    expect(registry.getElement('a')!.getState().layout).toBeNull();
  });
});

describe('NativeUIBridgeRegistry.getVisibleElements', () => {
  it('returns only elements with visible=true and a non-null layout', () => {
    const registry = new NativeUIBridgeRegistry();

    registry.registerElement('visible-with-layout', makeRef(), {});
    registry.updateElementState('visible-with-layout', {
      visible: true,
      layout: { x: 0, y: 0, width: 10, height: 10, pageX: 0, pageY: 0 },
    });

    registry.registerElement('visible-no-layout', makeRef(), {});
    registry.updateElementState('visible-no-layout', { visible: true, layout: null });

    registry.registerElement('hidden-with-layout', makeRef(), {});
    registry.updateElementState('hidden-with-layout', {
      visible: false,
      layout: { x: 0, y: 0, width: 10, height: 10, pageX: 0, pageY: 0 },
    });

    const visible = registry.getVisibleElements();
    expect(visible.map((e) => e.id)).toEqual(['visible-with-layout']);
  });
});

/**
 * Item 2 of the 0.6.6 robustness pass — seed `state.value` from
 * `props.value` for controlled-input elements so AI drivers can read the
 * default value before the user has typed.
 *
 * Pre-fix: `useUIElementWithProps + captureProps({ value, onChangeText })`
 * registered a `type:'input'` element whose `state.value` was undefined
 * until the FIRST `onChangeText` call. The bridge could see the input but
 * not its default text.
 */
describe('NativeUIBridgeRegistry — controlled-input state.value mirror (Item 2)', () => {
  it('seeds state.value from props.value at registration for type:"input"', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('api-url', makeRef(), {
      type: 'input',
      props: { value: 'https://demo.staging.qontinui.io' },
    });
    expect(registry.getElement('api-url')!.getState().value).toBe(
      'https://demo.staging.qontinui.io'
    );
  });

  it('mirrors props.value updates into state.value on updateElementProps', () => {
    // Simulates `useUIElementWithProps + captureProps({ value, onChangeText })`
    // where the parent re-passes a new value on a controlled re-render.
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('search', makeRef(), { type: 'input' });
    expect(registry.getElement('search')!.getState().value).toBeUndefined();

    registry.updateElementProps('search', { value: 'initial', onChangeText: () => {} });
    expect(registry.getElement('search')!.getState().value).toBe('initial');

    registry.updateElementProps('search', { value: 'updated' });
    expect(registry.getElement('search')!.getState().value).toBe('updated');
  });

  it('does NOT touch state.value for non-input element types', () => {
    // A switch's "value" prop is a boolean and lives on `state.checked`.
    // The input-only mirror must not clobber that.
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('s', makeRef(), { type: 'switch' });
    registry.updateElementProps('s', { value: true });
    expect(registry.getElement('s')!.getState().value).toBeUndefined();
  });

  it('does NOT touch state.value when props.value is not a string', () => {
    // Defensive: if a consumer somehow passes value={undefined} or null
    // (common in transitional render paths), don't blow away whatever
    // state.value already holds.
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('i', makeRef(), {
      type: 'input',
      props: { value: 'seeded' },
    });
    expect(registry.getElement('i')!.getState().value).toBe('seeded');

    registry.updateElementProps('i', { value: undefined });
    expect(registry.getElement('i')!.getState().value).toBe('seeded');

    registry.updateElementProps('i', { value: null });
    expect(registry.getElement('i')!.getState().value).toBe('seeded');
  });

  it('lets the bridge-driven type action still update state.value', () => {
    // The action-executor `type` action calls
    // `updateElementState(id, { value: params.text })` directly — verify
    // the controlled-input mirror doesn't fight that path.
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('i', makeRef(), {
      type: 'input',
      props: { value: 'before' },
    });
    expect(registry.getElement('i')!.getState().value).toBe('before');

    // Simulate the action-executor's type-action mutation.
    registry.updateElementState('i', { value: 'typed-from-bridge' });
    expect(registry.getElement('i')!.getState().value).toBe('typed-from-bridge');
  });
});

/**
 * Item 3 of the 0.6.6 robustness pass — surface a text element's dynamic
 * label as `state.value` so bridge consumers can grep text content with a
 * uniform `state.value` accessor instead of parsing `label`.
 *
 * Pre-fix: a status text registered via `useUIElement({id, type:'text', label})`
 * exposed its dynamic label only via the top-level `label` field. Reading
 * "Status: online" / "Status: offline" required string-parsing `label`.
 */
describe('NativeUIBridgeRegistry — text label mirrored to state.value (Item 3)', () => {
  it('seeds state.value from label at registration for type:"text"', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('status', makeRef(), {
      type: 'text',
      label: 'Status: online',
    });
    expect(registry.getElement('status')!.getState().value).toBe('Status: online');
  });

  it('keeps state.value in sync when updateElementMeta changes the label', () => {
    // The hook calls `bridge.registry.updateElementMeta({label: newLabel})`
    // from `updateLabel(...)`. The mirror should follow.
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('status', makeRef(), {
      type: 'text',
      label: 'Status: online',
    });
    expect(registry.getElement('status')!.getState().value).toBe('Status: online');

    const changed = registry.updateElementMeta('status', { label: 'Status: offline' });
    expect(changed).toBe(true);
    expect(registry.getElement('status')!.getState().value).toBe('Status: offline');
    // And the label field itself updated too.
    expect(registry.getElement('status')!.label).toBe('Status: offline');
  });

  it('does NOT touch state.value for non-text element types', () => {
    // A button has a label too, but its label is the action name — exposing
    // it as state.value would conflict with text-input semantics.
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('b', makeRef(), { type: 'button', label: 'Submit' });
    expect(registry.getElement('b')!.getState().value).toBeUndefined();
  });

  it('does not mirror when label is unchanged (idempotent updateElementMeta)', () => {
    // updateElementMeta returns false on a redundant call — the mirror
    // should not re-emit a state change in that case.
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('t', makeRef(), { type: 'text', label: 'Hello' });

    let stateChanges = 0;
    registry.on('element:stateChanged', () => {
      stateChanges++;
    });

    const changed = registry.updateElementMeta('t', { label: 'Hello' });
    expect(changed).toBe(false);
    expect(stateChanges).toBe(0);
  });
});

/**
 * Item 4 of the 0.6.6 robustness pass — `currentRouteOnly=true` should
 * INCLUDE route-agnostic elements (no `registrationRoute`) PLUS elements
 * matching the current route. Only excludes elements whose `route` field
 * is set to a non-matching route.
 *
 * Pre-fix: strict equality (`e.registrationRoute === currentRoute`)
 * dropped every app-root registration on mobile because tabs/header chrome
 * is typically registered at the root with `registrationRoute: null`.
 */
describe('matchesCurrentRoute — route-agnostic + current-route filter (Item 4)', () => {
  it('includes elements registered on the current route', () => {
    expect(matchesCurrentRoute('/dashboard', '/dashboard')).toBe(true);
  });

  it('includes route-agnostic elements (null/undefined/empty route)', () => {
    expect(matchesCurrentRoute(null, '/dashboard')).toBe(true);
    expect(matchesCurrentRoute(undefined, '/dashboard')).toBe(true);
    expect(matchesCurrentRoute('', '/dashboard')).toBe(true);
  });

  it('excludes elements registered on a different route', () => {
    expect(matchesCurrentRoute('/settings', '/dashboard')).toBe(false);
  });
});

describe('createSnapshot with currentRouteOnly=true (Item 4)', () => {
  it('includes route-agnostic elements alongside current-route elements', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => '/dashboard',
      subscribe: () => () => {},
    });

    // Tab bar registered at the app root — no `registrationRoute`.
    registry.registerElement('tab-home', makeRef(), { type: 'button' });
    // Header registered at the app root.
    registry.registerElement('app-header', makeRef(), { type: 'text' });
    // Dashboard-scoped card.
    registry.registerElement('dash-card', makeRef(), {
      type: 'view',
      registrationRoute: '/dashboard',
    });
    // Settings-scoped element — must be EXCLUDED.
    registry.registerElement('settings-row', makeRef(), {
      type: 'view',
      registrationRoute: '/settings',
    });

    const snapshot = registry.createSnapshot(undefined, { currentRouteOnly: true });
    const ids = snapshot.elements.map((e) => e.id).sort();
    expect(ids).toEqual(['app-header', 'dash-card', 'tab-home']);
    expect(ids).not.toContain('settings-row');
  });

  it('falls back to all elements when no currentRoute resolvable', () => {
    // When the route provider returns null, currentRouteOnly is a no-op —
    // the filter is gated on `resolvedRoute.currentRoute` being truthy.
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => null,
      subscribe: () => () => {},
    });

    registry.registerElement('a', makeRef(), { type: 'view' });
    registry.registerElement('b', makeRef(), {
      type: 'view',
      registrationRoute: '/dashboard',
    });

    const snapshot = registry.createSnapshot(undefined, { currentRouteOnly: true });
    expect(snapshot.elements.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });
});

describe('NativeUIBridgeRegistry.refreshMeasurements', () => {
  function makeMeasuringRef(
    impl: (cb: (pageX: number, pageY: number, w: number, h: number) => void) => void
  ): React.RefObject<NativeElementRef> {
    return {
      current: { measureInWindow: impl } as unknown as NativeElementRef,
    };
  }

  const staleLayout = { x: 0, y: 100, width: 100, height: 50, pageX: 0, pageY: 100 };

  it('writes fresh coordinates from measureInWindow over a stale stored layout', async () => {
    const registry = new NativeUIBridgeRegistry();
    // Element measured at mount (pageY: 100), then "scrolled" to pageY: 360 —
    // the ref now reports the NEW position while the registry holds the old.
    registry.registerElement('cell', makeMeasuringRef((cb) => cb(0, 360, 100, 50)), {});
    registry.updateElementState('cell', { visible: true, layout: staleLayout });

    const counts = await registry.refreshMeasurements();

    expect(counts).toEqual({ measured: 1, cleared: 0, skipped: 0 });
    const state = registry.getElement('cell')!.getState();
    expect(state.visible).toBe(true);
    expect(state.layout).toEqual({
      x: 0,
      y: 360,
      width: 100,
      height: 50,
      pageX: 0,
      pageY: 360,
    });
  });

  it('clears to visible:false/layout:null when a previously-measured element reports zero dims', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('gone', makeMeasuringRef((cb) => cb(0, 0, 0, 0)), {});
    registry.updateElementState('gone', { visible: true, layout: staleLayout });

    const counts = await registry.refreshMeasurements();

    expect(counts).toEqual({ measured: 0, cleared: 1, skipped: 0 });
    const state = registry.getElement('gone')!.getState();
    expect(state.visible).toBe(false);
    expect(state.layout).toBeNull();
  });

  it('leaves state untouched on zero dims when the element never had a layout', async () => {
    const registry = new NativeUIBridgeRegistry();
    // Mount-gap element: registered (seeded visible:true, layout:null) but
    // its first onLayout hasn't fired. Zero dims must NOT demote it.
    registry.registerElement('fresh', makeMeasuringRef((cb) => cb(0, 0, 0, 0)), {});

    const counts = await registry.refreshMeasurements();

    expect(counts).toEqual({ measured: 0, cleared: 0, skipped: 1 });
    const state = registry.getElement('fresh')!.getState();
    expect(state.visible).toBe(true);
    expect(state.layout).toBeNull();
  });

  it('skips elements without a callable measureInWindow and leaves them untouched', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('fixture', makeRef(), {});
    registry.updateElementState('fixture', { visible: true, layout: staleLayout });

    const counts = await registry.refreshMeasurements();

    expect(counts).toEqual({ measured: 0, cleared: 0, skipped: 1 });
    expect(registry.getElement('fixture')!.getState().layout).toEqual(staleLayout);
  });

  it('does not touch elements that are not visible', async () => {
    const registry = new NativeUIBridgeRegistry();
    const measure = vi.fn((cb: (x: number, y: number, w: number, h: number) => void) =>
      cb(5, 5, 10, 10)
    );
    registry.registerElement('hidden', makeMeasuringRef(measure), {});
    registry.updateElementState('hidden', { visible: false, layout: null });

    const counts = await registry.refreshMeasurements();

    expect(measure).not.toHaveBeenCalled();
    expect(counts).toEqual({ measured: 0, cleared: 0, skipped: 0 });
    expect(registry.getElement('hidden')!.getState().visible).toBe(false);
  });

  it('resolves at the timeout when a ref never calls back, keeping counts from live refs', async () => {
    const registry = new NativeUIBridgeRegistry();
    // Dead ref: measureInWindow accepts the callback and never invokes it.
    registry.registerElement('dead', makeMeasuringRef(() => {}), {});
    registry.updateElementState('dead', { visible: true, layout: staleLayout });
    // Live sibling measures fine and must still be counted.
    registry.registerElement('live', makeMeasuringRef((cb) => cb(10, 20, 30, 40)), {});
    registry.updateElementState('live', { visible: true, layout: staleLayout });

    const counts = await registry.refreshMeasurements({ timeoutMs: 25 });

    expect(counts).toEqual({ measured: 1, cleared: 0, skipped: 0 });
    // The dead element's stale layout is left as-is (no callback ever fired).
    expect(registry.getElement('dead')!.getState().layout).toEqual(staleLayout);
    expect(registry.getElement('live')!.getState().layout).toMatchObject({
      pageX: 10,
      pageY: 20,
      width: 30,
      height: 40,
    });
  });

  it('never throws when measureInWindow itself throws', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement(
      'thrower',
      makeMeasuringRef(() => {
        throw new Error('boom');
      }),
      {}
    );
    registry.updateElementState('thrower', { visible: true, layout: staleLayout });

    const counts = await registry.refreshMeasurements();

    expect(counts).toEqual({ measured: 0, cleared: 0, skipped: 1 });
    expect(registry.getElement('thrower')!.getState().layout).toEqual(staleLayout);
  });
});

/**
 * Canonical `route` / `activeTab` snapshot fields.
 *
 * The native snapshot emitted only `currentRoute` + `segments`, while the web
 * SDK's `BridgeSnapshot` — the shape every cross-platform consumer speaks —
 * spells them `route` and `activeTab`. A device sitting on a perfectly
 * well-known screen therefore answered `control/snapshot` with a null route
 * and a null active tab. Both are now emitted, derived from the Expo Router
 * navigation state the `RouteProvider` already exposes.
 */
describe('deriveActiveTabFromSegments — Expo Router navigation state', () => {
  it('returns the segment that follows the innermost layout group', () => {
    expect(deriveActiveTabFromSegments(['(tabs)', 'runs'])).toBe('runs');
  });

  it('keeps reporting the tab from a detail screen pushed on top of it', () => {
    expect(deriveActiveTabFromSegments(['(tabs)', 'runs', '[id]'])).toBe('runs');
  });

  it("reports the group's index route when the group is the leaf", () => {
    expect(deriveActiveTabFromSegments(['(tabs)'])).toBe('index');
  });

  it('uses the INNERMOST group when layouts are nested', () => {
    expect(deriveActiveTabFromSegments(['(app)', '(tabs)', 'fleet'])).toBe('fleet');
  });

  it('declines to guess for a dynamic route directly under the group', () => {
    expect(deriveActiveTabFromSegments(['(tabs)', '[id]'])).toBeUndefined();
  });

  it('declines to guess when the app has no group layout at all', () => {
    expect(deriveActiveTabFromSegments(['settings'])).toBeUndefined();
  });

  it('handles empty / absent segment lists', () => {
    expect(deriveActiveTabFromSegments([])).toBeUndefined();
    expect(deriveActiveTabFromSegments(undefined)).toBeUndefined();
  });
});

describe('createSnapshot — canonical route / activeTab', () => {
  it('populates both from the route provider', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/runs',
      getSegments: () => ['(tabs)', 'runs'],
    });

    const snapshot = registry.createSnapshot();

    expect(snapshot.route).toBe('/(tabs)/runs');
    expect(snapshot.activeTab).toBe('runs');
    // The pre-existing native-only fields are untouched.
    expect(snapshot.currentRoute).toBe('/(tabs)/runs');
    expect(snapshot.segments).toEqual(['(tabs)', 'runs']);
  });

  it('lets an explicit getActiveTab provider win over the derivation', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/runs',
      getSegments: () => ['(tabs)', 'runs'],
      getActiveTab: () => 'custom-pane',
    });

    expect(registry.createSnapshot().activeTab).toBe('custom-pane');
  });

  it('falls back to the derivation when getActiveTab throws or answers blank', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/fleet',
      getSegments: () => ['(tabs)', 'fleet'],
      getActiveTab: () => {
        throw new Error('host bug');
      },
    });
    expect(registry.createSnapshot().activeTab).toBe('fleet');

    const blank = new NativeUIBridgeRegistry();
    blank.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/fleet',
      getSegments: () => ['(tabs)', 'fleet'],
      getActiveTab: () => '',
    });
    expect(blank.createSnapshot().activeTab).toBe('fleet');
  });

  it('derives activeTab from an explicit routeInfo argument too', () => {
    const registry = new NativeUIBridgeRegistry();
    const snapshot = registry.createSnapshot({
      currentRoute: '/(tabs)/gates',
      segments: ['(tabs)', 'gates'],
    });
    expect(snapshot.route).toBe('/(tabs)/gates');
    expect(snapshot.activeTab).toBe('gates');
  });

  it('omits both fields (rather than nulling them) when no route is known', () => {
    const registry = new NativeUIBridgeRegistry();
    const snapshot = registry.createSnapshot();
    expect('route' in snapshot).toBe(false);
    expect('activeTab' in snapshot).toBe(false);
    // `currentRoute` keeps its explicit-null contract for existing consumers.
    expect(snapshot.currentRoute).toBeNull();
  });

  // The `routeInfo` branch is not a corner case: `NativeUIBridgeServer.
  // setRouteProvider` installs a `getSnapshot` override that ALWAYS passes
  // `routeInfo`, so this is the branch that serves `control/snapshot` for every
  // app that wires a route provider. Deriving straight from `routeInfo.segments`
  // here made `RouteProvider.getActiveTab` unreachable in production while the
  // provider-branch tests above stayed green.
  it('honours a registered getActiveTab even when the caller passes routeInfo', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/runs',
      getSegments: () => ['(tabs)', 'runs'],
      getActiveTab: () => 'custom-pane',
    });

    const snapshot = registry.createSnapshot({
      currentRoute: '/(tabs)/runs',
      segments: ['(tabs)', 'runs'],
    });

    expect(snapshot.activeTab).toBe('custom-pane');
  });

  it('falls back to the derivation on the routeInfo branch when no provider answers', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/fleet',
      getSegments: () => ['(tabs)', 'fleet'],
      getActiveTab: () => {
        throw new Error('host bug');
      },
    });

    expect(
      registry.createSnapshot({ currentRoute: '/(tabs)/fleet', segments: ['(tabs)', 'fleet'] })
        .activeTab
    ).toBe('fleet');
  });

  it('lets an explicit routeInfo.activeTab win over both provider and derivation', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/runs',
      getSegments: () => ['(tabs)', 'runs'],
      getActiveTab: () => 'from-provider',
    });

    const snapshot = registry.createSnapshot({
      currentRoute: '/(tabs)/runs',
      segments: ['(tabs)', 'runs'],
      activeTab: 'from-caller',
    });

    expect(snapshot.activeTab).toBe('from-caller');
  });

  it('treats a blank routeInfo.activeTab as "not answered", not as an override', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setRouteProvider({
      getCurrentRoute: () => '/(tabs)/runs',
      getSegments: () => ['(tabs)', 'runs'],
      getActiveTab: () => 'from-provider',
    });

    expect(
      registry.createSnapshot({
        currentRoute: '/(tabs)/runs',
        segments: ['(tabs)', 'runs'],
        activeTab: '',
      }).activeTab
    ).toBe('from-provider');
  });
});
