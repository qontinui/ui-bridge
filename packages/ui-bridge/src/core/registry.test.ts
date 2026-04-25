/**
 * Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  UIBridgeRegistry,
  setGlobalRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from './registry';

describe('UIBridgeRegistry', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  describe('element registration', () => {
    it('should register an element', () => {
      const element = document.createElement('button');
      container.appendChild(element);

      const registered = registry.registerElement('test-btn', element, {
        type: 'button',
        label: 'Test Button',
      });

      expect(registered).toBeDefined();
      expect(registered.id).toBe('test-btn');
      expect(registered.type).toBe('button');
      expect(registered.label).toBe('Test Button');
    });

    it('should infer element type when not specified', () => {
      const button = document.createElement('button');
      container.appendChild(button);

      const registered = registry.registerElement('btn-1', button);

      expect(registered.type).toBe('button');
    });

    it('should infer input type', () => {
      const input = document.createElement('input');
      input.type = 'text';
      container.appendChild(input);

      const registered = registry.registerElement('input-1', input);

      expect(registered.type).toBe('input');
    });

    it('should infer checkbox type', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      container.appendChild(checkbox);

      const registered = registry.registerElement('checkbox-1', checkbox);

      expect(registered.type).toBe('checkbox');
    });

    it('should unregister an element', () => {
      const element = document.createElement('button');
      container.appendChild(element);

      registry.registerElement('btn-1', element);
      expect(registry.getElement('btn-1')).toBeDefined();

      registry.unregisterElement('btn-1');
      expect(registry.getElement('btn-1')).toBeUndefined();
    });

    it('should get all elements', () => {
      const btn1 = document.createElement('button');
      const btn2 = document.createElement('button');
      container.appendChild(btn1);
      container.appendChild(btn2);

      registry.registerElement('btn-1', btn1);
      registry.registerElement('btn-2', btn2);

      const elements = registry.getAllElements();

      expect(elements).toHaveLength(2);
      expect(elements.map((e) => e.id)).toContain('btn-1');
      expect(elements.map((e) => e.id)).toContain('btn-2');
    });

    it('should find element by DOM element', () => {
      const element = document.createElement('input');
      container.appendChild(element);

      registry.registerElement('email-input', element);

      const found = registry.findByDOMElement(element);

      expect(found).toBeDefined();
      expect(found?.id).toBe('email-input');
    });

    it('starts with no bbox and no visibility until updated', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);

      const registered = registry.registerElement('btn-1', btn);

      expect(registered.bbox).toBeUndefined();
      expect(registered.visible).toBeUndefined();
    });

    it('updateElementBbox writes live bbox and visibility', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('btn-1', btn);

      const ok = registry.updateElementBbox(
        'btn-1',
        { x: 10, y: 20, width: 100, height: 30 },
        true
      );

      expect(ok).toBe(true);
      const entry = registry.getElement('btn-1')!;
      expect(entry.bbox).toEqual({ x: 10, y: 20, width: 100, height: 30 });
      expect(entry.visible).toBe(true);
    });

    it('updateElementBbox does not bump storeVersion (scroll churn safety)', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('btn-1', btn);

      const before = registry.getSnapshot().version;
      registry.updateElementBbox('btn-1', { x: 0, y: 0, width: 10, height: 10 }, true);
      registry.updateElementBbox('btn-1', { x: 1, y: 1, width: 10, height: 10 }, true);
      const after = registry.getSnapshot().version;

      expect(after).toBe(before);
    });

    it('updateElementBbox returns false for unknown id', () => {
      expect(registry.updateElementBbox('nope', { x: 0, y: 0, width: 1, height: 1 }, true)).toBe(
        false
      );
    });

    it('clears bbox/visible when called with undefined', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('btn-1', btn);
      registry.updateElementBbox('btn-1', { x: 1, y: 2, width: 3, height: 4 }, true);

      registry.updateElementBbox('btn-1', undefined, undefined);

      const entry = registry.getElement('btn-1')!;
      expect(entry.bbox).toBeUndefined();
      expect(entry.visible).toBeUndefined();
    });

    it('serializes bbox/visible into the snapshot output', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('btn-1', btn, { type: 'button', label: 'Go' });
      registry.updateElementBbox('btn-1', { x: 5, y: 6, width: 7, height: 8 }, true);

      const snapshot = registry.createSnapshot();
      const serialized = snapshot.elements.find((e) => e.id === 'btn-1');

      expect(serialized).toBeDefined();
      expect(serialized!.bbox).toEqual({ x: 5, y: 6, width: 7, height: 8 });
      expect(serialized!.visible).toBe(true);
    });

    it('carries disambiguation metadata (variant/position/color/contextPath) through the snapshot', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('save-btn', btn, {
        type: 'button',
        label: 'Save',
        variant: 'destructive',
        position: 'bottom-right',
        color: '#ef4444',
        contextPath: 'settings-modal > theme-section > accent-color',
      });

      const snapshot = registry.createSnapshot();
      const serialized = snapshot.elements.find((e) => e.id === 'save-btn');

      expect(serialized).toBeDefined();
      expect(serialized!.variant).toBe('destructive');
      expect(serialized!.position).toBe('bottom-right');
      expect(serialized!.color).toBe('#ef4444');
      expect(serialized!.contextPath).toBe('settings-modal > theme-section > accent-color');
    });

    it('reads ariaExpanded from <details>.open when aria-expanded is unset', () => {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Advanced';
      details.appendChild(summary);
      container.appendChild(details);

      registry.registerElement('details-el', details, { type: 'disclosure', label: 'Advanced' });
      registry.registerElement('summary-el', summary, { type: 'disclosure', label: 'Advanced' });

      details.open = false;
      expect(registry.getElement('details-el')!.getState().ariaExpanded).toBe(false);
      expect(registry.getElement('summary-el')!.getState().ariaExpanded).toBe(false);

      details.open = true;
      expect(registry.getElement('details-el')!.getState().ariaExpanded).toBe(true);
      expect(registry.getElement('summary-el')!.getState().ariaExpanded).toBe(true);
    });

    it('explicit aria-expanded wins over <details>.open fallback', () => {
      const details = document.createElement('details');
      details.setAttribute('aria-expanded', 'true');
      details.open = false;
      container.appendChild(details);

      registry.registerElement('details-el', details, { type: 'disclosure', label: 'x' });

      expect(registry.getElement('details-el')!.getState().ariaExpanded).toBe(true);
    });
  });

  describe('component registration', () => {
    it('should register a component', () => {
      const handler = vi.fn();

      const component = registry.registerComponent('login-form', {
        name: 'Login Form',
        description: 'User authentication form',
        actions: [
          {
            id: 'submit',
            label: 'Submit',
            handler,
          },
        ],
      });

      expect(component).toBeDefined();
      expect(component.id).toBe('login-form');
      expect(component.name).toBe('Login Form');
      expect(component.actions).toHaveLength(1);
    });

    it('should unregister a component', () => {
      registry.registerComponent('form-1', {
        name: 'Form',
        actions: [],
      });

      expect(registry.getComponent('form-1')).toBeDefined();

      registry.unregisterComponent('form-1');

      expect(registry.getComponent('form-1')).toBeUndefined();
    });

    it('should get all components', () => {
      registry.registerComponent('comp-1', { name: 'Component 1', actions: [] });
      registry.registerComponent('comp-2', { name: 'Component 2', actions: [] });

      const components = registry.getAllComponents();

      expect(components).toHaveLength(2);
    });

    it('should link elements to component', () => {
      const btn = document.createElement('button');
      const input = document.createElement('input');
      container.appendChild(btn);
      container.appendChild(input);

      registry.registerElement('btn-1', btn);
      registry.registerElement('input-1', input);

      const component = registry.registerComponent('form-1', {
        name: 'Form',
        actions: [],
        elementIds: ['btn-1', 'input-1'],
      });

      expect(component.elementIds).toContain('btn-1');
      expect(component.elementIds).toContain('input-1');
    });
  });

  describe('workflow registration', () => {
    it('should register a workflow', () => {
      const workflow = registry.registerWorkflow({
        id: 'login-flow',
        name: 'Login Flow',
        steps: [
          {
            id: 'step-1',
            type: 'action',
            target: 'email-input',
            action: 'type',
            params: { text: 'test@example.com' },
          },
        ],
      });

      expect(workflow).toBeDefined();
      expect(workflow.id).toBe('login-flow');
      expect(workflow.steps).toHaveLength(1);
    });

    it('should get a workflow by id', () => {
      registry.registerWorkflow({
        id: 'test-workflow',
        name: 'Test',
        steps: [],
      });

      const workflow = registry.getWorkflow('test-workflow');

      expect(workflow).toBeDefined();
      expect(workflow?.name).toBe('Test');
    });

    it('should unregister a workflow', () => {
      registry.registerWorkflow({
        id: 'temp-workflow',
        name: 'Temp',
        steps: [],
      });

      expect(registry.getWorkflow('temp-workflow')).toBeDefined();

      registry.unregisterWorkflow('temp-workflow');

      expect(registry.getWorkflow('temp-workflow')).toBeUndefined();
    });
  });

  describe('event system', () => {
    it('should emit and listen to events', () => {
      const listener = vi.fn();

      registry.on('element:registered', listener);

      const element = document.createElement('button');
      container.appendChild(element);

      registry.registerElement('btn-1', element);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'element:registered',
        })
      );
    });

    it('should remove event listener with off()', () => {
      const listener = vi.fn();

      registry.on('element:registered', listener);
      registry.off('element:registered', listener);

      const element = document.createElement('button');
      container.appendChild(element);

      registry.registerElement('btn-1', element);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function from on()', () => {
      const listener = vi.fn();

      const unsubscribe = registry.on('element:registered', listener);

      // Unsubscribe before registering
      unsubscribe();

      const element = document.createElement('button');
      container.appendChild(element);

      registry.registerElement('btn-1', element);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('snapshot', () => {
    it('should create a snapshot', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);

      registry.registerElement('btn-1', btn);
      registry.registerComponent('comp-1', { name: 'Component', actions: [] });

      const snapshot = registry.createSnapshot();

      expect(snapshot.elements).toHaveLength(1);
      expect(snapshot.components).toHaveLength(1);
      expect(snapshot.timestamp).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // F3: Snapshot registration metadata
  // ──────────────────────────────────────────────────────────────────────
  describe('snapshot registration metadata (F3)', () => {
    it('everHadRegistrations starts false before any register call', () => {
      const snapshot = registry.createSnapshot();
      expect(snapshot.registration.everHadRegistrations).toBe(false);
      expect(snapshot.registration.totalRegistered).toBe(0);
      expect(snapshot.registration.byRoute).toEqual({});
      expect(registry.hasEverHadRegistrations()).toBe(false);
    });

    it('everHadRegistrations flips true after first register and stays true after unmount', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);

      registry.registerElement('btn-1', btn, { route: '/home' });
      expect(registry.createSnapshot().registration.everHadRegistrations).toBe(true);

      registry.unregisterElement('btn-1');
      const afterUnmount = registry.createSnapshot();

      // Key F3 invariant: latch stays `true` so callers can tell
      // "page had coverage that's now torn down" from "never had coverage".
      expect(afterUnmount.registration.everHadRegistrations).toBe(true);
      expect(afterUnmount.registration.totalRegistered).toBe(0);
      expect(afterUnmount.registration.byRoute).toEqual({});
    });

    it('everHadRegistrations resets to false only on clear()', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('btn-1', btn);
      expect(registry.hasEverHadRegistrations()).toBe(true);

      registry.clear();

      expect(registry.hasEverHadRegistrations()).toBe(false);
      expect(registry.createSnapshot().registration.everHadRegistrations).toBe(false);
    });

    it('totalRegistered matches elements.length at snapshot time', () => {
      const a = document.createElement('button');
      const b = document.createElement('input');
      const c = document.createElement('a');
      container.appendChild(a);
      container.appendChild(b);
      container.appendChild(c);

      registry.registerElement('a', a);
      registry.registerElement('b', b);
      registry.registerElement('c', c);

      const snap = registry.createSnapshot();
      expect(snap.registration.totalRegistered).toBe(snap.elements.length);
      expect(snap.registration.totalRegistered).toBe(3);

      registry.unregisterElement('b');
      const snap2 = registry.createSnapshot();
      expect(snap2.registration.totalRegistered).toBe(snap2.elements.length);
      expect(snap2.registration.totalRegistered).toBe(2);
    });

    it('byRoute groups by registration route and drops keys when count hits zero', () => {
      const a1 = document.createElement('button');
      const a2 = document.createElement('button');
      const b1 = document.createElement('button');
      container.appendChild(a1);
      container.appendChild(a2);
      container.appendChild(b1);

      registry.registerElement('a1', a1, { route: '/fleet' });
      registry.registerElement('a2', a2, { route: '/fleet' });
      registry.registerElement('b1', b1, { route: '/settings' });

      expect(registry.createSnapshot().registration.byRoute).toEqual({
        '/fleet': 2,
        '/settings': 1,
      });

      // Drop the only /settings element — the key itself should be removed.
      registry.unregisterElement('b1');
      expect(registry.createSnapshot().registration.byRoute).toEqual({ '/fleet': 2 });

      // Drop both /fleet elements — byRoute should be fully empty, not
      // `{ '/fleet': 0 }`.
      registry.unregisterElement('a1');
      registry.unregisterElement('a2');
      expect(registry.createSnapshot().registration.byRoute).toEqual({});
    });

    it('byRoute falls back to window.location.pathname when route not supplied', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);

      registry.registerElement('btn-1', btn);

      const snap = registry.createSnapshot();
      // jsdom defaults to "/" — whatever the current pathname is, it must
      // be present in both the top-level `route` and `byRoute`.
      expect(typeof snap.route).toBe('string');
      expect(snap.registration.byRoute[snap.route!]).toBe(1);
    });

    it('passing route: null opts the element out of byRoute entirely', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);

      registry.registerElement('btn-opt-out', btn, { route: null });

      const snap = registry.createSnapshot();
      // Element exists but contributes nothing to byRoute — useful for
      // elements that don't belong to any page (e.g. an always-mounted
      // app shell control).
      expect(snap.registration.totalRegistered).toBe(1);
      expect(snap.registration.byRoute).toEqual({});
    });

    it('snapshot.registration is present on createSnapshotAsync too', async () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('async-btn', btn, { route: '/async-page' });

      const snap = await registry.createSnapshotAsync();

      expect(snap.registration.totalRegistered).toBe(1);
      expect(snap.registration.everHadRegistrations).toBe(true);
      expect(snap.registration.byRoute).toEqual({ '/async-page': 1 });
      expect(snap.snapshotTakenAtMs).toBeGreaterThan(0);
      expect(snap.snapshotTakenAtMs).toBe(snap.timestamp);
    });

    it('snapshotTakenAtMs mirrors the legacy timestamp field', () => {
      const snap = registry.createSnapshot();
      expect(snap.snapshotTakenAtMs).toBe(snap.timestamp);
      expect(snap.snapshotTakenAtMs).toBeGreaterThan(0);
    });

    it('re-registering the same id under a new route does not double-count', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);

      registry.registerElement('same-id', btn, { route: '/a' });
      registry.registerElement('same-id', btn, { route: '/b' });

      const snap = registry.createSnapshot();
      // Reverse the prior entry's route on overwrite so /a goes back to 0
      // (and is therefore dropped) and /b holds the single live count.
      expect(snap.registration.totalRegistered).toBe(1);
      expect(snap.registration.byRoute).toEqual({ '/b': 1 });
    });

    it('individual snapshot elements echo their registration route', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('btn-1', btn, { route: '/dashboard' });

      const snap = registry.createSnapshot();
      const el = snap.elements.find((e) => e.id === 'btn-1');
      expect(el?.route).toBe('/dashboard');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // F1: snapshot.activeTab provider injection
  //
  // The SDK has no concept of "tab" — apps that decouple URL from tab
  // (the runner) supply a `getActiveTab` callback so a single snapshot
  // can carry both `route` and `activeTab`. With no provider the field
  // must stay omitted so non-tab consumers are unaffected.
  // ──────────────────────────────────────────────────────────────────────
  describe('snapshot activeTab (F1)', () => {
    it('omits activeTab when no getActiveTab provider is supplied', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('btn-1', btn);

      const snap = registry.createSnapshot();
      expect(snap.activeTab).toBeUndefined();
      expect('activeTab' in snap).toBe(false);
    });

    it('populates activeTab from the provider on createSnapshot', () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('btn-1', btn);

      const snap = registry.createSnapshot({ getActiveTab: () => 'specs' });
      expect(snap.activeTab).toBe('specs');
    });

    it('populates activeTab from the provider on createSnapshotAsync', async () => {
      const btn = document.createElement('button');
      container.appendChild(btn);
      registry.registerElement('btn-1', btn);

      const snap = await registry.createSnapshotAsync(50, {
        getActiveTab: () => 'prompt-home',
      });
      expect(snap.activeTab).toBe('prompt-home');
    });

    it('reflects the live provider value on each snapshot call', () => {
      let current = 'tab-a';
      const opts = { getActiveTab: () => current };
      expect(registry.createSnapshot(opts).activeTab).toBe('tab-a');

      current = 'tab-b';
      expect(registry.createSnapshot(opts).activeTab).toBe('tab-b');
    });

    it('treats null / empty / non-string provider returns as omitted', () => {
      expect(registry.createSnapshot({ getActiveTab: () => null }).activeTab).toBeUndefined();
      expect(registry.createSnapshot({ getActiveTab: () => undefined }).activeTab).toBeUndefined();
      expect(registry.createSnapshot({ getActiveTab: () => '' }).activeTab).toBeUndefined();
    });

    it('swallows provider errors and omits activeTab', () => {
      const snap = registry.createSnapshot({
        getActiveTab: () => {
          throw new Error('boom');
        },
      });
      expect(snap.activeTab).toBeUndefined();
      // The rest of the snapshot must still be intact.
      expect(snap.registration).toBeDefined();
      expect(Array.isArray(snap.elements)).toBe(true);
    });
  });

  describe('global registry', () => {
    it('should set and get global registry', () => {
      const newRegistry = new UIBridgeRegistry();

      setGlobalRegistry(newRegistry);

      expect(getGlobalRegistry()).toBe(newRegistry);
    });

    it('should reset global registry', () => {
      const newRegistry = new UIBridgeRegistry();
      const btn = document.createElement('button');
      container.appendChild(btn);
      newRegistry.registerElement('test-btn', btn);

      setGlobalRegistry(newRegistry);
      expect(getGlobalRegistry().getAllElements()).toHaveLength(1);

      resetGlobalRegistry();

      // After reset, getGlobalRegistry creates a fresh registry
      const freshRegistry = getGlobalRegistry();
      expect(freshRegistry).toBeInstanceOf(UIBridgeRegistry);
      expect(freshRegistry.getAllElements()).toHaveLength(0);
      expect(freshRegistry).not.toBe(newRegistry);
    });
  });
});
