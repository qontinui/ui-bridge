/**
 * Regression contract — `executeCommand('getControlSnapshot', ...)`.
 *
 * Locks in the shape this command emits so future feature additions can't
 * silently drift from `serializeRegisteredElement` / `createSnapshot`.
 *
 * What this asserts (per the post-a8a4bb4 audit):
 *   - Top-level shape: timestamp, snapshotTakenAtMs, route (when DOM),
 *     registration{totalRegistered,everHadRegistrations,byRoute}, elements,
 *     components, workflows, activeRuns.
 *   - F3 registration metadata mirrors the registry state, including the
 *     sticky `everHadRegistrations` latch after every element unregisters.
 *   - Elements are serialized via the canonical `serializeRegisteredElement`
 *     (rich SDK shape: tagName/identifier/bbox/visible/etc.), not the legacy
 *     minimal `{id,type,label,actions,state}` shape.
 *   - `componentBasePath` payload option flows into both the per-component
 *     `actionInvocationPath` AND the per-element `componentActionBasePath`
 *     for elements with `ownedByComponent` set.
 *   - Snapshot `route` reflects `window.location.pathname`.
 *   - Graceful degradation: if a registry probe throws inside the F3
 *     metadata block, the snapshot returns the conservative
 *     `{totalRegistered: elements.length, everHadRegistrations: false,
 *     byRoute: {}}` default rather than crashing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

/**
 * Subset of the snapshot shape we assert on. Untyped beyond this — the test
 * itself is the contract. Intentionally `unknown` for `elements`/`components`
 * so individual cases can narrow as needed.
 */
type Snapshot = {
  timestamp: number;
  snapshotTakenAtMs: number;
  route?: string;
  registration: {
    totalRegistered: number;
    everHadRegistrations: boolean;
    byRoute: Record<string, number>;
  };
  elements: Array<Record<string, unknown>>;
  components: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
  activeRuns: unknown[];
};

async function getSnapshot(payload: Record<string, unknown> = {}): Promise<Snapshot> {
  return (await executeCommand('getControlSnapshot', payload, emptyBridge)) as Snapshot;
}

describe('executeCommand · getControlSnapshot · shape contract', () => {
  let container: HTMLDivElement;
  const originalPathname = window.location.pathname;

  beforeEach(() => {
    // Each test gets a fresh registry singleton so byRoute/latch are clean.
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    // Reset history to a known path so jsdom's pathname is predictable.
    window.history.pushState(null, '', '/');
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
    window.history.pushState(null, '', originalPathname);
    vi.restoreAllMocks();
  });

  it('returns the documented top-level fields', async () => {
    const snap = await getSnapshot();

    expect(typeof snap.timestamp).toBe('number');
    expect(typeof snap.snapshotTakenAtMs).toBe('number');
    // Both timestamp aliases come from the same `Date.now()` call.
    expect(snap.timestamp).toBe(snap.snapshotTakenAtMs);

    expect(snap.registration).toBeDefined();
    expect(typeof snap.registration.totalRegistered).toBe('number');
    expect(typeof snap.registration.everHadRegistrations).toBe('boolean');
    expect(snap.registration.byRoute).toBeDefined();
    expect(typeof snap.registration.byRoute).toBe('object');

    expect(Array.isArray(snap.elements)).toBe(true);
    expect(Array.isArray(snap.components)).toBe(true);
    expect(Array.isArray(snap.workflows)).toBe(true);
    expect(Array.isArray(snap.activeRuns)).toBe(true);
    // Relay handler always emits an empty `activeRuns` (run tracking is
    // server-side); make sure that contract doesn't drift.
    expect(snap.activeRuns).toEqual([]);

    // jsdom always has a pathname, so `route` must be present and string.
    expect(typeof snap.route).toBe('string');
  });

  it('includes route from window.location.pathname', async () => {
    window.history.pushState(null, '', '/test/path');

    const snap = await getSnapshot();

    expect(snap.route).toBe('/test/path');
  });
});

describe('executeCommand · getControlSnapshot · F3 registration metadata', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    window.history.pushState(null, '', '/');
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
    vi.restoreAllMocks();
  });

  it('empty registry → totalRegistered:0, everHadRegistrations:false, byRoute:{}', async () => {
    const snap = await getSnapshot();

    expect(snap.registration).toEqual({
      totalRegistered: 0,
      everHadRegistrations: false,
      byRoute: {},
    });
  });

  it('after registering elements → totals match, latch true, byRoute populated', async () => {
    const registry = getGlobalRegistry();
    const a = document.createElement('button');
    const b = document.createElement('button');
    const c = document.createElement('input');
    container.appendChild(a);
    container.appendChild(b);
    container.appendChild(c);

    registry.registerElement('a', a, { route: '/fleet' });
    registry.registerElement('b', b, { route: '/fleet' });
    registry.registerElement('c', c, { route: '/settings' });

    const snap = await getSnapshot();

    expect(snap.registration.totalRegistered).toBe(3);
    expect(snap.registration.everHadRegistrations).toBe(true);
    expect(snap.registration.byRoute).toEqual({
      '/fleet': 2,
      '/settings': 1,
    });
    // Sanity-check the elements array length agrees with totalRegistered.
    expect(snap.elements).toHaveLength(snap.registration.totalRegistered);
  });

  it('after registering then unregistering all → totalRegistered:0 but latch still true (sticky)', async () => {
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    container.appendChild(btn);

    registry.registerElement('btn-1', btn, { route: '/home' });
    registry.unregisterElement('btn-1');

    const snap = await getSnapshot();

    // Latch sticks; counters drop. This is the F3 invariant that distinguishes
    // "page never had coverage" from "coverage tore down".
    expect(snap.registration).toEqual({
      totalRegistered: 0,
      everHadRegistrations: true,
      byRoute: {},
    });
  });
});

describe('executeCommand · getControlSnapshot · element shape', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    window.history.pushState(null, '', '/');
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
    vi.restoreAllMocks();
  });

  it('elements use the canonical serializeRegisteredElement shape (not legacy minimal)', async () => {
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    btn.textContent = 'Save';
    container.appendChild(btn);

    registry.registerElement('save-btn', btn, {
      type: 'button',
      label: 'Save',
    });

    const snap = await getSnapshot();
    expect(snap.elements).toHaveLength(1);
    const el = snap.elements[0];

    // Legacy minimal shape was {id, type, label, actions, state}. Anything
    // beyond those five fields proves we routed through
    // `serializeRegisteredElement`. We require AT LEAST 5 extra canonical
    // fields to be present so a future regression that drops one field
    // doesn't sneak past the contract.
    const legacyMinimum = new Set(['id', 'type', 'label', 'actions', 'state']);
    const richFields = Object.keys(el).filter((k) => !legacyMinimum.has(k));
    expect(richFields.length).toBeGreaterThanOrEqual(5);

    // Spot-check specific canonical fields the SDK guarantees for any
    // hook-registered element. `tagName` and `identifier` come from the
    // serializer; their absence is the most direct symptom of a regression
    // back to the old elementToSnapshot path.
    expect(el).toHaveProperty('tagName');
    expect(el.tagName).toBe('button');
    expect(el).toHaveProperty('identifier');
    expect(el).toHaveProperty('actions');
    expect(el).toHaveProperty('state');
    expect(el).toHaveProperty('origin');
    // `route` is captured at registration time and surfaced per element so
    // consumers can reconcile with `registration.byRoute`.
    expect(el).toHaveProperty('route');
  });
});

describe('executeCommand · getControlSnapshot · componentBasePath option', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    window.history.pushState(null, '', '/');
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
    vi.restoreAllMocks();
  });

  it('default (no option) → component actionInvocationPath uses /control/component', async () => {
    const registry = getGlobalRegistry();
    registry.registerComponent('login-form', {
      name: 'Login Form',
      actions: [{ id: 'submit', handler: () => {} }],
    });

    const snap = await getSnapshot();
    expect(snap.components).toHaveLength(1);
    const comp = snap.components[0] as { id: string; actionInvocationPath?: string };

    expect(comp.id).toBe('login-form');
    expect(comp.actionInvocationPath).toBe('/control/component/login-form/action/{actionId}');
  });

  it('payload.componentBasePath flows into component actionInvocationPath', async () => {
    const registry = getGlobalRegistry();
    registry.registerComponent('login-form', {
      name: 'Login Form',
      actions: [{ id: 'submit', handler: () => {} }],
    });

    const snap = await getSnapshot({
      componentBasePath: '/supervisor-bridge/control/component',
    });

    const comp = snap.components[0] as { id: string; actionInvocationPath?: string };
    expect(comp.actionInvocationPath).toBe(
      '/supervisor-bridge/control/component/login-form/action/{actionId}'
    );
  });

  it('payload.componentBasePath also propagates to per-element componentActionBasePath', async () => {
    const registry = getGlobalRegistry();
    registry.registerComponent('login-form', {
      name: 'Login Form',
      actions: [{ id: 'submit', handler: () => {} }],
    });
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('login-submit', btn, {
      ownedByComponent: 'login-form',
    });

    const snap = await getSnapshot({
      componentBasePath: '/supervisor-bridge/control/component',
    });

    const el = snap.elements.find((e) => e.id === 'login-submit') as
      | { ownedByComponent?: string; componentActionBasePath?: string }
      | undefined;
    expect(el).toBeDefined();
    expect(el!.ownedByComponent).toBe('login-form');
    // `serializeRegisteredElement` derives this as
    // `${componentBasePath}/${ownedByComponent}` — the per-element path
    // must reflect the option, not just the component's invocation path.
    expect(el!.componentActionBasePath).toBe('/supervisor-bridge/control/component/login-form');
  });

  it('default per-element componentActionBasePath uses /control/component prefix', async () => {
    const registry = getGlobalRegistry();
    registry.registerComponent('login-form', {
      name: 'Login Form',
      actions: [{ id: 'submit', handler: () => {} }],
    });
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('login-submit', btn, {
      ownedByComponent: 'login-form',
    });

    const snap = await getSnapshot();

    const el = snap.elements.find((e) => e.id === 'login-submit') as
      | { componentActionBasePath?: string }
      | undefined;
    expect(el!.componentActionBasePath).toBe('/control/component/login-form');
  });
});

describe('executeCommand · getControlSnapshot · graceful degradation', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    window.history.pushState(null, '', '/');
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
    vi.restoreAllMocks();
  });

  it('returns conservative defaults when registry probe throws inside F3 metadata block', async () => {
    // Register one element so we can confirm the conservative fallback uses
    // `elements.length` for `totalRegistered`.
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('btn-1', btn, { route: '/home' });

    // Force the F3 probe to fail. The handler reads elements outside the
    // try/catch (those still succeed), then enters a try/catch that calls
    // `hasEverHadRegistrations()` — making that throw exercises the fallback
    // branch without breaking the rest of the snapshot.
    vi.spyOn(registry, 'hasEverHadRegistrations').mockImplementation(() => {
      throw new Error('simulated registry failure');
    });

    const snap = await getSnapshot();

    // Conservative default: totalRegistered = elements.length (1),
    // everHadRegistrations = false, byRoute = {}.
    expect(snap.registration).toEqual({
      totalRegistered: 1,
      everHadRegistrations: false,
      byRoute: {},
    });
    // The rest of the snapshot still works — elements are still serialized.
    expect(snap.elements).toHaveLength(1);
    expect(snap.elements[0].id).toBe('btn-1');
  });

  it('falls back when getCountsByRoute throws too', async () => {
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('btn-1', btn);

    vi.spyOn(registry, 'getCountsByRoute').mockImplementation(() => {
      throw new Error('simulated byRoute failure');
    });

    const snap = await getSnapshot();

    expect(snap.registration).toEqual({
      totalRegistered: 1,
      everHadRegistrations: false,
      byRoute: {},
    });
  });
});
