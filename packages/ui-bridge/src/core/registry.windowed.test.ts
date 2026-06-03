/**
 * Windowed registry tests (Phase 0 — UI Bridge window-awareness).
 *
 * The registry stores elements partitioned by `windowLabel` so a multi-window
 * host (the runner's pop-out terminal windows) can register overlapping ids
 * without collision. These tests pin the ADDITIVE / backward-compatible
 * contract:
 *   - two windows + overlapping ids → no collision,
 *   - merged `byRoute` is the union across windows (top-level shape unchanged),
 *   - new `byRoutePerWindow` partitions that union correctly,
 *   - the default (no-`windowLabel`) path is byte-identical to the
 *     pre-window-aware behavior.
 *
 * See plan `2026-06-03-runner-popout-terminal-windows.md` Phase 0.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry, resetGlobalRegistry } from './registry';

describe('UIBridgeRegistry — windowed store', () => {
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

  function makeButton(): HTMLButtonElement {
    const el = document.createElement('button');
    container.appendChild(el);
    return el;
  }

  describe('no collision across windows', () => {
    it('keeps the same id in two windows as two distinct entries', () => {
      const a = makeButton();
      const b = makeButton();

      const mainEl = registry.registerElement('save-btn', a, { route: '/' }); // default "main"
      const term1El = registry.registerElement('save-btn', b, {
        route: '/',
        windowLabel: 'term-1',
      });

      // Both survive — the second register did NOT overwrite the first.
      expect(registry.getAllElements()).toHaveLength(2);
      expect(mainEl.element).toBe(a);
      expect(term1El.element).toBe(b);

      // Scoped lookup resolves each window's own entry.
      expect(registry.getElement('save-btn')?.element).toBe(a); // default-first
      // findElement is private; verify scoping via the serialized snapshot below.
    });

    it('does not double-count the totalRegistered across windows', () => {
      registry.registerElement('x', makeButton(), { route: '/' });
      registry.registerElement('x', makeButton(), { route: '/', windowLabel: 'term-1' });
      registry.registerElement('y', makeButton(), { route: '/', windowLabel: 'term-1' });

      const snap = registry.createSnapshot();
      expect(snap.registration.totalRegistered).toBe(3);
    });
  });

  describe('merged byRoute (top-level, union across windows)', () => {
    it('sums counts and unions ids across windows', () => {
      registry.registerElement('a', makeButton(), { route: '/home' });
      registry.registerElement('b', makeButton(), { route: '/home' });
      registry.registerElement('a', makeButton(), { route: '/home', windowLabel: 'term-1' });
      registry.registerElement('c', makeButton(), { route: '/settings', windowLabel: 'term-1' });

      const merged = registry.getCountsByRoute();

      // /home: main {a,b} + term-1 {a} → count 3 (sum), ids union {a,b}.
      expect(merged['/home'].count).toBe(3);
      expect(new Set(merged['/home'].ids)).toEqual(new Set(['a', 'b']));
      // /settings: only term-1 {c}.
      expect(merged['/settings']).toEqual({ count: 1, ids: ['c'] });
    });
  });

  describe('byRoutePerWindow (new, partitioned view)', () => {
    it('breaks the union down per window', () => {
      registry.registerElement('a', makeButton(), { route: '/home' });
      registry.registerElement('b', makeButton(), { route: '/home' });
      registry.registerElement('a', makeButton(), { route: '/home', windowLabel: 'term-1' });
      registry.registerElement('c', makeButton(), { route: '/settings', windowLabel: 'term-1' });

      const snap = registry.createSnapshot();
      const perWindow = snap.registration.byRoutePerWindow;
      expect(perWindow).toBeDefined();

      expect(perWindow!.main['/home'].count).toBe(2);
      expect(new Set(perWindow!.main['/home'].ids)).toEqual(new Set(['a', 'b']));
      expect(perWindow!['term-1']['/home']).toEqual({ count: 1, ids: ['a'] });
      expect(perWindow!['term-1']['/settings']).toEqual({ count: 1, ids: ['c'] });
    });

    it('tags non-default elements with their windowLabel in the snapshot', () => {
      registry.registerElement('a', makeButton(), { route: '/' });
      registry.registerElement('a', makeButton(), { route: '/', windowLabel: 'term-1' });

      const snap = registry.createSnapshot();
      const byWindow = new Map(snap.elements.map((e) => [e.windowLabel, e]));
      // Default element: windowLabel omitted (undefined).
      expect(byWindow.get(undefined)).toBeDefined();
      // term-1 element: windowLabel present.
      expect(byWindow.get('term-1')).toBeDefined();
    });

    it('emits activeWindowLabel only when provided', () => {
      registry.registerElement('a', makeButton(), { route: '/' });

      const without = registry.createSnapshot();
      expect('activeWindowLabel' in without).toBe(false);

      const withLabel = registry.createSnapshot({ activeWindowLabel: 'term-2' });
      expect(withLabel.activeWindowLabel).toBe('term-2');
    });
  });

  describe('default-only path is byte-identical to pre-window-aware behavior', () => {
    it('omits byRoutePerWindow and per-element windowLabel when no window is used', () => {
      registry.registerElement('a', makeButton(), { route: '/' });
      registry.registerElement('b', makeButton(), { route: '/' });

      const snap = registry.createSnapshot();

      // No new optional fields leak into the single-window shape.
      expect(snap.registration.byRoutePerWindow).toBeUndefined();
      expect('activeWindowLabel' in snap).toBe(false);
      for (const el of snap.elements) {
        expect(el.windowLabel).toBeUndefined();
      }

      // Merged byRoute is exactly the classic single-window output.
      expect(snap.registration.byRoute).toEqual({
        '/': { count: 2, ids: ['a', 'b'] },
      });
      expect(snap.registration.totalRegistered).toBe(2);
    });

    it('treats an explicit "main" windowLabel as the default (no per-window leak)', () => {
      registry.registerElement('a', makeButton(), { route: '/', windowLabel: 'main' });

      const snap = registry.createSnapshot();
      expect(snap.registration.byRoutePerWindow).toBeUndefined();
      expect(snap.elements[0].windowLabel).toBeUndefined();
    });

    it('round-trips JSON identically to a registry that never knew about windows', () => {
      registry.registerElement('a', makeButton(), { route: '/' });
      const json = JSON.parse(JSON.stringify(registry.createSnapshot().registration));
      // `byRoutePerWindow` must not appear as a key at all (additive, absent).
      expect(Object.prototype.hasOwnProperty.call(json, 'byRoutePerWindow')).toBe(false);
    });
  });

  describe('per-window unregister', () => {
    it('removes only the targeted window\'s entry', () => {
      registry.registerElement('save-btn', makeButton(), { route: '/' });
      registry.registerElement('save-btn', makeButton(), { route: '/', windowLabel: 'term-1' });

      const removed = registry.unregisterElement('save-btn', 'term-1');
      expect(removed).toBe(true);

      const snap = registry.createSnapshot();
      expect(snap.registration.totalRegistered).toBe(1);
      // The main entry survives; per-window view collapses back to single window.
      expect(snap.registration.byRoutePerWindow).toBeUndefined();
      expect(snap.registration.byRoute).toEqual({ '/': { count: 1, ids: ['save-btn'] } });
    });

    it('default-first unregister targets the main window when label omitted', () => {
      registry.registerElement('save-btn', makeButton(), { route: '/' });
      registry.registerElement('save-btn', makeButton(), { route: '/', windowLabel: 'term-1' });

      registry.unregisterElement('save-btn'); // no label → default ("main") first

      const perWindow = registry.getCountsByRoutePerWindow();
      // main gone, term-1 remains.
      expect(perWindow.main).toBeUndefined();
      expect(perWindow['term-1']['/']).toEqual({ count: 1, ids: ['save-btn'] });
    });
  });
});
