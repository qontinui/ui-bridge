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
import type { SnapshotPageContext } from '../navigation/types';
import type { SnapshotModalContext } from '../modal/types';
import type { SnapshotToastContext } from '../toast/types';
import type { SnapshotRelationshipContext } from '../relationships/types';
import type { SnapshotDragDropContext } from '../drag-drop/types';
import type { SnapshotUndoContext } from '../undo/types';
import type { SnapshotShortcutContext } from '../shortcuts/types';

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
    byRoute: Record<string, { count: number; ids: string[] }>;
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
    expect(snap.registration.byRoute['/fleet'].count).toBe(2);
    expect(new Set(snap.registration.byRoute['/fleet'].ids)).toEqual(new Set(['a', 'b']));
    expect(snap.registration.byRoute['/settings'].count).toBe(1);
    expect(snap.registration.byRoute['/settings'].ids).toEqual(['c']);
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

describe('executeCommand · getControlSnapshot · Phase 3 scope+reveals (plan 2026-05-03)', () => {
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

  it('component scope round-trips: undefined → undefined (default "route")', async () => {
    const registry = getGlobalRegistry();
    registry.registerComponent('login-form', {
      name: 'Login Form',
      actions: [{ id: 'submit', handler: () => {} }],
    });
    const snap = await getSnapshot();
    const comp = snap.components[0] as { id: string; scope?: string };
    expect(comp.id).toBe('login-form');
    // Default behavior: scope is omitted (clients treat undefined as "route").
    expect(comp.scope).toBeUndefined();
  });

  it('component scope round-trips: "global" passes through verbatim', async () => {
    const registry = getGlobalRegistry();
    registry.registerComponent('command-palette', {
      name: 'Command Palette',
      actions: [],
      scope: 'global',
    });
    const snap = await getSnapshot();
    const comp = snap.components[0] as { id: string; scope?: string };
    expect(comp.id).toBe('command-palette');
    expect(comp.scope).toBe('global');
  });

  it('element reveals round-trips: undefined → undefined', async () => {
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('plain-btn', btn);
    const snap = await getSnapshot();
    const el = snap.elements[0] as { id: string; reveals?: string[] };
    expect(el.id).toBe('plain-btn');
    expect(el.reveals).toBeUndefined();
  });

  it('element reveals round-trips: array passes through verbatim', async () => {
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('sidebar-toggle', btn, {
      reveals: ['session-card-*', 'promote-to-worktree-*'],
    });
    const snap = await getSnapshot();
    const el = snap.elements.find((e) => e.id === 'sidebar-toggle') as
      | { reveals?: string[] }
      | undefined;
    expect(el).toBeDefined();
    expect(el!.reveals).toEqual(['session-card-*', 'promote-to-worktree-*']);
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

/**
 * Property-based regression guard for the two-channel snapshot drift bug.
 *
 * Background: in April 2026 (~24h window before commit a8a4bb4) the SDK had
 * two paths emitting snapshots — `registry.createSnapshot()` (canonical, used
 * by the runner) and `executeCommand('getControlSnapshot', ...)` (relay
 * handler, used by the supervisor dashboard) — and they silently drifted.
 * `createSnapshot` gained new top-level fields (registration, route,
 * snapshotTakenAtMs in d50ce72) but the relay handler built its own minimal
 * payload inline and never picked them up.
 *
 * The 12 hand-written shape tests above assert *expected fields are present*
 * in the relay snapshot — they would NOT catch a future regression that adds
 * a new field to `createSnapshot` and forgets to mirror it in the relay path.
 *
 * This block adds a property test instead: every top-level key emitted by
 * `registry.createSnapshot()` must also appear in the relay handler's output.
 * Set inclusion only — the relay is allowed to add extra fields like
 * `activeRuns` that the canonical snapshot doesn't carry.
 */

/**
 * Asserts every top-level key in `canonical` is also present in `relay`.
 * Failure message lists the missing keys explicitly so CI logs surface the
 * regression at a glance instead of forcing a debug session.
 */
function expectAllCanonicalKeysPresent(
  canonical: Record<string, unknown>,
  relay: Record<string, unknown>
): void {
  const canonicalKeys = new Set(Object.keys(canonical));
  const relayKeys = new Set(Object.keys(relay));
  const missing = [...canonicalKeys].filter((k) => !relayKeys.has(k));
  expect(
    missing,
    `expected getControlSnapshot to emit all canonical fields, but missing: [${missing.join(', ')}]`
  ).toEqual([]);
}

describe('two-channel drift guard', () => {
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

  it('every top-level key emitted by registry.createSnapshot is also emitted by getControlSnapshot', async () => {
    // Populate the registry with at least one element + component + workflow
    // so neither snapshot is empty. An empty registry might happen to have a
    // smaller key set (e.g. omit conditional fields), defeating the property
    // test — registering across all three categories exercises every branch
    // that contributes top-level keys.
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    btn.textContent = 'Save';
    container.appendChild(btn);
    registry.registerElement('save-btn', btn, { type: 'button', label: 'Save' });
    registry.registerComponent('login-form', {
      name: 'Login Form',
      actions: [{ id: 'submit', handler: () => {} }],
    });
    registry.registerWorkflow({
      id: 'demo-workflow',
      name: 'Demo Workflow',
      steps: [],
    });

    // Both snapshots must observe the same registry state. `createSnapshot`
    // pulls directly from `this.*` on the registry; `executeCommand` reads
    // via `getGlobalRegistry()` (see commandHandlers.ts:648), so a single
    // global registry instance is enough.
    const canonical = registry.createSnapshot() as unknown as Record<string, unknown>;
    const relay = (await getSnapshot()) as unknown as Record<string, unknown>;

    expectAllCanonicalKeysPresent(canonical, relay);
  });

  it('relay handler is allowed to add fields beyond the canonical set', async () => {
    // This test documents the intentional-divergence direction: the relay
    // handler emits `activeRuns` that `createSnapshot` does NOT carry. A
    // future reader who sees the property-test pass should not assume the
    // two paths are bidirectionally identical — the relay is a superset by
    // design (run tracking is server-side only, surfaced through the relay).
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('btn-1', btn);

    const canonical = registry.createSnapshot() as unknown as Record<string, unknown>;
    const relay = (await getSnapshot()) as unknown as Record<string, unknown>;

    // Relay carries activeRuns; canonical does not. If this ever flips,
    // either createSnapshot grew an activeRuns field (in which case this
    // test should be updated and the property-test will start covering it)
    // or the relay dropped activeRuns (a regression for dashboard consumers).
    expect(relay).toHaveProperty('activeRuns');
    expect(canonical).not.toHaveProperty('activeRuns');
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — relay/WS path now picks up registry enrichers via
// `registry.runSnapshotEnrichers`. Mirrors the matrix from
// `registry-enrichers.test.ts` so the two construction sites (canonical
// `createSnapshot` and the relay's hand-built shape) cannot drift on enrichment.
// ---------------------------------------------------------------------------

function makePageContext(): SnapshotPageContext {
  return {
    url: 'http://localhost/test',
    pathname: '/test',
    search: '',
    hash: '',
    title: 'Test',
    recentNavigations: [],
  };
}

function makeModalContext(): SnapshotModalContext {
  return {
    modals: [],
    hasBlockingModal: true,
    count: 1,
  };
}

function makeToastContext(): SnapshotToastContext {
  return {
    active: [],
    recent: [],
    totalCaptured: 7,
  };
}

function makeRelationshipContext(): SnapshotRelationshipContext {
  return {
    relationships: [],
    count: 2,
    byOrigin: { declared: 1, aria: 1, html: 0 },
  };
}

function makeDragDropContext(): SnapshotDragDropContext {
  return {
    dragSources: [],
    dropZones: [],
    count: { dragSources: 0, dropZones: 0 },
    byOrigin: { declared: 0, aria: 0, dom: 0 },
  };
}

function makeUndoContext(): SnapshotUndoContext {
  return {
    canUndo: true,
    canRedo: false,
    undoDescription: 'Typing',
    summary: 'Can undo (Typing).',
  };
}

function makeShortcutContext(): SnapshotShortcutContext {
  return {
    shortcuts: [],
    totalCount: 0,
    lastScanTimestamp: 1000,
  };
}

/**
 * Like `Snapshot` above, but with the seven canonical enriched fields
 * available as optional reads. The relay shape isn't strictly typed as
 * `BridgeSnapshot` (workflows have `steps`; components carry `state` /
 * `elementIds`), but the enriched fields use the same shapes the SDK
 * publishes — assertion just cares whether they appear at all.
 */
type EnrichedRelaySnapshot = Snapshot & {
  page?: SnapshotPageContext;
  modalStack?: SnapshotModalContext;
  toasts?: SnapshotToastContext;
  relationships?: SnapshotRelationshipContext;
  dragDrop?: SnapshotDragDropContext;
  undoRedo?: SnapshotUndoContext;
  shortcuts?: SnapshotShortcutContext;
  // Custom enrichers can attach arbitrary keys; let tests cast as needed.
  [key: string]: unknown;
};

async function getEnrichedSnapshot(
  payload: Record<string, unknown> = {}
): Promise<EnrichedRelaySnapshot> {
  return (await executeCommand(
    'getControlSnapshot',
    payload,
    emptyBridge
  )) as EnrichedRelaySnapshot;
}

describe('executeCommand · getControlSnapshot · enrichment', () => {
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

  it('default (no enrichers wired) → none of the seven canonical fields appear', async () => {
    const registry = getGlobalRegistry();
    // Explicitly set empty enrichers to simulate a host that mounted the
    // provider with no trackers (and to lock in the contract that an empty
    // enricher map produces an un-enriched relay snapshot).
    registry.setEnrichers({});

    const snap = await getEnrichedSnapshot();

    expect(snap.page).toBeUndefined();
    expect(snap.modalStack).toBeUndefined();
    expect(snap.toasts).toBeUndefined();
    expect(snap.relationships).toBeUndefined();
    expect(snap.dragDrop).toBeUndefined();
    expect(snap.undoRedo).toBeUndefined();
    expect(snap.shortcuts).toBeUndefined();
  });

  it('only the wired canonical fields populate; others stay absent', async () => {
    const registry = getGlobalRegistry();
    registry.setEnrichers({
      modalDetector: { getSnapshotModalContext: () => makeModalContext() },
    });

    const snap = await getEnrichedSnapshot();

    expect(snap.modalStack).toBeDefined();
    expect(snap.modalStack?.hasBlockingModal).toBe(true);
    expect(snap.modalStack?.count).toBe(1);

    expect(snap.page).toBeUndefined();
    expect(snap.toasts).toBeUndefined();
    expect(snap.relationships).toBeUndefined();
    expect(snap.dragDrop).toBeUndefined();
    expect(snap.undoRedo).toBeUndefined();
    expect(snap.shortcuts).toBeUndefined();
  });

  it('all seven enrichers wired → all seven canonical fields appear on the relay snapshot', async () => {
    const registry = getGlobalRegistry();
    registry.setEnrichers({
      navigationTracker: { getSnapshotPageContext: () => makePageContext() },
      modalDetector: { getSnapshotModalContext: () => makeModalContext() },
      toastCapture: { getSnapshotToastContext: () => makeToastContext() },
      relationshipTracker: {
        getSnapshotRelationshipContext: () => makeRelationshipContext(),
      },
      dragDropDetector: {
        getSnapshotDragDropContext: () => makeDragDropContext(),
      },
      undoTracker: { getSnapshotUndoContext: () => makeUndoContext() },
      shortcutTracker: { getSnapshotShortcutContext: () => makeShortcutContext() },
    });

    const snap = await getEnrichedSnapshot();

    expect(snap.page?.pathname).toBe('/test');
    expect(snap.modalStack?.count).toBe(1);
    expect(snap.toasts?.totalCaptured).toBe(7);
    expect(snap.relationships?.count).toBe(2);
    expect(snap.dragDrop?.count).toEqual({ dragSources: 0, dropZones: 0 });
    expect(snap.undoRedo?.canUndo).toBe(true);
    expect(snap.shortcuts?.lastScanTimestamp).toBe(1000);
  });

  it('a throwing canonical enricher does NOT break the relay snapshot — other fields still appear', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Swap in a verbose registry instance under the global slot so the
    // enrichers' verbose-warn branch fires (the relay uses the global
    // registry, not whatever we construct locally).
    const registry = getGlobalRegistry();
    // Mark verbose by reaching into the options pocket. The default global
    // registry was constructed with `verbose: false`; this test only cares
    // that other enrichers still attach when one throws, regardless of
    // verbose. We assert no rethrow propagates.
    registry.setEnrichers({
      modalDetector: {
        getSnapshotModalContext: () => {
          throw new Error('boom');
        },
      },
      toastCapture: { getSnapshotToastContext: () => makeToastContext() },
      undoTracker: { getSnapshotUndoContext: () => makeUndoContext() },
    });

    const snap = await getEnrichedSnapshot();

    expect(snap.modalStack).toBeUndefined();
    expect(snap.toasts).toBeDefined();
    expect(snap.toasts?.totalCaptured).toBe(7);
    expect(snap.undoRedo).toBeDefined();
    expect(snap.undoRedo?.canUndo).toBe(true);
    // Base relay-snapshot fields untouched.
    expect(snap.registration).toBeDefined();
    expect(Array.isArray(snap.activeRuns)).toBe(true);

    warnSpy.mockRestore();
  });

  it('custom enrichers registered via registerSnapshotEnricher attach to the relay snapshot', async () => {
    const registry = getGlobalRegistry();
    const dispose = registry.registerSnapshotEnricher('runner-tabs', () => ({
      runnerTabs: { active: 'tab-terminal' },
    }));

    const snap = await getEnrichedSnapshot();
    expect(snap.runnerTabs).toEqual({ active: 'tab-terminal' });

    dispose();

    const snap2 = await getEnrichedSnapshot();
    expect(snap2.runnerTabs).toBeUndefined();
  });
});

describe("executeCommand · find/discover · F3 registration readiness (plan 2026-06-12 item 5)", () => {
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

  type FindResult = {
    elements: unknown[];
    total: number;
    registration: {
      totalRegistered: number;
      everHadRegistrations: boolean;
      byRoute: Record<string, { count: number; ids: string[] }>;
    };
  };

  it('empty registry → find carries the typed not-ready signal (everHadRegistrations: false)', async () => {
    const result = (await executeCommand(
      'find',
      { include_hidden: true },
      emptyBridge
    )) as FindResult;

    // The post-reload dead window: empty result, but TYPED as "not hydrated
    // yet" rather than a bare empty list.
    expect(result.elements).toEqual([]);
    expect(result.registration).toBeDefined();
    expect(result.registration.everHadRegistrations).toBe(false);
    expect(result.registration.totalRegistered).toBe(0);
  });

  it('after registration → find carries everHadRegistrations: true (and stays true after teardown)', async () => {
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    container.appendChild(btn);
    registry.registerElement('btn-1', btn, { route: '/home' });

    const populated = (await executeCommand(
      'find',
      { include_hidden: true },
      emptyBridge
    )) as FindResult;
    expect(populated.registration.everHadRegistrations).toBe(true);
    expect(populated.registration.totalRegistered).toBe(1);

    // Teardown: latch sticks → "genuinely empty", not "not ready".
    registry.unregisterElement('btn-1');
    const empty = (await executeCommand(
      'find',
      { include_hidden: true },
      emptyBridge
    )) as FindResult;
    expect(empty.elements).toEqual([]);
    expect(empty.registration.everHadRegistrations).toBe(true);
    expect(empty.registration.totalRegistered).toBe(0);
  });

  it('discover alias carries the same registration block', async () => {
    const result = (await executeCommand(
      'discover',
      { include_hidden: true },
      emptyBridge
    )) as FindResult;
    expect(result.registration).toBeDefined();
    expect(result.registration.everHadRegistrations).toBe(false);
  });
});
