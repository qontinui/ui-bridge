/**
 * Canonical wire-shape contract — plan 2026-05-17-sdk-canonical-shape-unification.
 *
 * The control-mode snapshot must be a strict SUPERSET of the canonical
 * `qontinui-types::ui_bridge` shape so qontinui-spec-check's strict
 * `serde_json::from_value::<UIBridgeSnapshot>` parse succeeds with no
 * boundary adapter in between (the runner's `adapt_supplied_snapshot` was
 * deleted on the strength of this contract). Guards all three serializer
 * paths:
 *
 *   1. `createSnapshot` / `createSnapshotAsync` (registry)
 *   2. `materializeElements` (server DOM-fallback / find / discover)
 *   3. the relay `getControlSnapshot` command (runner Tauri IPC path)
 *
 * Canonical REQUIRED fields (everything else is serde-tolerated extras):
 *   element:   id, type, identifier{xpath,selector}, state{visible,enabled,
 *              focused,rect{x,y,width,height,top,right,bottom,left}},
 *              registeredAt (ms int), mounted (bool)
 *   component: id, name, registeredAt, mounted; actions entries must be
 *              `{id, label?, description?}` objects (ComponentActionInfo),
 *              never bare strings, and never leak `handler`/`paramSchema`
 *   workflow:  id, name, stepCount
 *   undoRedo:  canUndo, canRedo, summary
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { UIBridgeRegistry, getGlobalRegistry, resetGlobalRegistry } from './registry';
import { materializeElements } from '../server/handlers';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';

// ---------------------------------------------------------------------------
// Canonical-shape assertions (shared across the three paths)
// ---------------------------------------------------------------------------

function expectCanonicalElement(el: Record<string, unknown>): void {
  expect(typeof el.id).toBe('string');
  expect(typeof el.type).toBe('string');
  const identifier = el.identifier as Record<string, unknown>;
  expect(identifier).toBeDefined();
  expect(typeof identifier.xpath).toBe('string');
  expect(typeof identifier.selector).toBe('string');
  const state = el.state as Record<string, unknown>;
  expect(state).toBeDefined();
  expect(typeof state.visible).toBe('boolean');
  expect(typeof state.enabled).toBe('boolean');
  expect(typeof state.focused).toBe('boolean');
  const rect = state.rect as Record<string, unknown>;
  for (const k of ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left']) {
    expect(typeof rect[k], `state.rect.${k}`).toBe('number');
  }
  expect(typeof el.registeredAt, 'registeredAt').toBe('number');
  expect(Number.isInteger(el.registeredAt)).toBe(true);
  expect(typeof el.mounted, 'mounted').toBe('boolean');
}

function expectCanonicalComponent(comp: Record<string, unknown>): void {
  expect(typeof comp.id).toBe('string');
  expect(typeof comp.name).toBe('string');
  expect(typeof comp.registeredAt, 'registeredAt').toBe('number');
  expect(typeof comp.mounted, 'mounted').toBe('boolean');
  const actions = comp.actions as Array<Record<string, unknown>>;
  expect(Array.isArray(actions)).toBe(true);
  for (const a of actions) {
    expect(typeof a, 'ComponentActionInfo object, not a bare id string').toBe('object');
    expect(typeof a.id).toBe('string');
    // Runtime-only fields must never reach the wire.
    expect(a.handler).toBeUndefined();
    expect(a.paramSchema).toBeUndefined();
  }
}

function expectCanonicalUndoRedo(undoRedo: Record<string, unknown>): void {
  expect(typeof undoRedo.canUndo, 'canUndo').toBe('boolean');
  expect(typeof undoRedo.canRedo, 'canRedo').toBe('boolean');
  expect(typeof undoRedo.summary, 'summary').toBe('string');
  // The pre-0.22.0 web-only names must not come back.
  expect(undoRedo.undoAvailable).toBeUndefined();
  expect(undoRedo.redoAvailable).toBeUndefined();
}

/** JSON round-trip — asserts on what actually goes over the wire. */
function wire<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function registerFixtures(registry: UIBridgeRegistry, container: HTMLElement): void {
  const btn = document.createElement('button');
  btn.textContent = 'Save';
  container.appendChild(btn);
  registry.registerElement('save-btn', btn, { type: 'button', label: 'Save' });
  registry.registerComponent('editor', {
    name: 'Editor',
    description: 'The editor pane',
    actions: [
      { id: 'save', label: 'Save', description: 'Persist the doc', handler: () => {} },
      { id: 'reset', handler: () => {} },
    ],
    elementIds: ['save-btn'],
  });
  registry.setEnrichers({
    undoTracker: {
      getSnapshotUndoContext: () => ({
        canUndo: true,
        canRedo: false,
        undoDescription: 'Typing',
        summary: 'Can undo (Typing).',
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Path 1 — registry createSnapshot / createSnapshotAsync
// ---------------------------------------------------------------------------

describe('canonical wire shape · createSnapshot / createSnapshotAsync', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    registerFixtures(registry, container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('createSnapshot carries every canonical required field', () => {
    const snap = wire(registry.createSnapshot());
    expect(typeof snap.timestamp).toBe('number');
    const elements = snap.elements as Array<Record<string, unknown>>;
    expect(elements.length).toBeGreaterThan(0);
    elements.forEach(expectCanonicalElement);
    const components = snap.components as Array<Record<string, unknown>>;
    expect(components).toHaveLength(1);
    components.forEach(expectCanonicalComponent);
    // Labeled + unlabeled actions both serialize as ComponentActionInfo.
    expect(components[0].actions).toEqual([
      { id: 'save', label: 'Save', description: 'Persist the doc' },
      { id: 'reset' },
    ]);
    expectCanonicalUndoRedo(snap.undoRedo as Record<string, unknown>);
  });

  it('createSnapshotAsync emits the identical component/element shape', async () => {
    const snap = wire(await registry.createSnapshotAsync());
    (snap.elements as Array<Record<string, unknown>>).forEach(expectCanonicalElement);
    const components = snap.components as Array<Record<string, unknown>>;
    expect(components).toHaveLength(1);
    components.forEach(expectCanonicalComponent);
    expectCanonicalUndoRedo(snap.undoRedo as Record<string, unknown>);
  });

  it('workflows carry canonical id/name/stepCount', () => {
    registry.registerWorkflow({
      id: 'wf-1',
      name: 'Login flow',
      steps: [{ id: 's1', type: 'element-action', target: 'save-btn', action: 'click' }],
    });
    const snap = wire(registry.createSnapshot());
    const workflows = snap.workflows as Array<Record<string, unknown>>;
    expect(workflows).toHaveLength(1);
    expect(workflows[0].id).toBe('wf-1');
    expect(workflows[0].name).toBe('Login flow');
    expect(workflows[0].stepCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Path 2 — server materializeElements (DOM-fallback / find / discover)
// ---------------------------------------------------------------------------

describe('canonical wire shape · materializeElements fallback', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('registry-backed elements keep their real registeredAt/mounted', () => {
    const btn = document.createElement('button');
    container.appendChild(btn);
    const registered = registry.registerElement('live-btn', btn, { type: 'button' });
    const [el] = wire(materializeElements(registry.getAllElements())) as unknown as Array<
      Record<string, unknown>
    >;
    expectCanonicalElement(el);
    expect(el.registeredAt).toBe(registered.registeredAt);
    expect(el.mounted).toBe(true);
  });

  it('DOM-scan objects without lifecycle fields get them synthesized', () => {
    const div = document.createElement('div');
    container.appendChild(div);
    // Simulate a raw DOM-fallback scan entry: no registeredAt/mounted, and
    // getState/getIdentifier provided the way the scanner builds them.
    const before = Date.now();
    const [el] = materializeElements([
      {
        id: 'scanned-1',
        type: 'button',
        element: div,
        getState: () => ({
          visible: true,
          enabled: true,
          focused: false,
          rect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
        }),
        getIdentifier: () => ({ xpath: '/html/body/div', selector: 'div' }),
        actions: ['click'],
      },
    ]) as unknown as Array<Record<string, unknown>>;
    expectCanonicalElement(wire(el));
    expect(el.registeredAt as number).toBeGreaterThanOrEqual(before);
    expect(el.mounted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Path 3 — relay getControlSnapshot (runner Tauri IPC path)
// ---------------------------------------------------------------------------

describe('canonical wire shape · relay getControlSnapshot', () => {
  let container: HTMLDivElement;

  const emptyBridge: BridgeAccess = {
    elements: [],
    getElement: () => undefined,
    components: [],
    workflows: [],
  };

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    registerFixtures(getGlobalRegistry() as UIBridgeRegistry, container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
  });

  it('relay snapshot carries every canonical required field (incl. no handler leak)', async () => {
    const snap = wire(await executeCommand('getControlSnapshot', {}, emptyBridge));
    const elements = snap.elements as Array<Record<string, unknown>>;
    expect(elements.length).toBeGreaterThan(0);
    elements.forEach(expectCanonicalElement);
    const components = snap.components as Array<Record<string, unknown>>;
    expect(components).toHaveLength(1);
    components.forEach(expectCanonicalComponent);
    expectCanonicalUndoRedo(snap.undoRedo as Record<string, unknown>);
  });
});
