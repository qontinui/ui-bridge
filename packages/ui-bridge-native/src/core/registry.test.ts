import { describe, it, expect } from 'vitest';
import { NativeUIBridgeRegistry } from './registry';
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
