/**
 * Phase 4 — `effect` on the wire: the `/control/component*` projection and the
 * Tauri IPC projection.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 4.
 *
 * Two projections serve `SerializedComponentAction` and they emit different
 * field sets:
 *
 *  - `annotateComponentWithInvocationPaths` (`server/handlers.ts`) spreads the
 *    whole registered action → `paramSchema` + per-action `path` + `effect`.
 *  - `serializeRegisteredComponent` (`core/registry.ts`) picks a narrow set →
 *    `effect` but NOT `paramSchema`/`path` (pinned in
 *    `core/component-action-effect.phase4.test.ts`).
 *
 * `effect` is the one Phase-4 field BOTH carry, because the snapshot is what an
 * autonomous walk reads and excluding destructive actions is this annotation's
 * only job.
 *
 * Every expectation is a hand-written literal — never the type, never the map.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import { executeCommand, type BridgeAccess } from '../react/commandHandlers';

function makeRegistryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    getComponentState: (id) => reg.getComponentState?.(id) ?? null,
    createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

function makeActionExecutor() {
  return {
    executeAction: async () => ({ success: true }),
    executeComponentAction: async () => ({ success: true }),
  };
}

function registerInvoiceRow(): void {
  getGlobalRegistry().registerComponent('invoice-row', {
    name: 'Invoice Row',
    description: 'One invoice',
    actions: [
      {
        id: 'click',
        label: 'Delete',
        description: 'Permanently delete this invoice',
        effect: 'destructive',
        handler: () => 'deleted',
      },
      { id: 'preview', label: 'Preview', effect: 'read', handler: () => 'previewed' },
      { id: 'rename', label: 'Rename', handler: () => 'renamed' },
    ],
  });
}

/** The wire is JSON. Whatever survives this round-trip is what a consumer sees. */
function overTheWire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('Phase 4 — effect on the /control/component* wire', () => {
  beforeEach(() => {
    resetGlobalRegistry();
    registerInvoiceRow();
  });
  afterEach(() => {
    resetGlobalRegistry();
  });

  it('GET /control/components emits destructive alongside the path', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.getComponents();

    expect(resp.success).toBe(true);
    const wire = overTheWire(resp.data) as {
      components: Array<{ id: string; actions: Array<Record<string, unknown>> }>;
    };
    const comp = wire.components.find((c) => c.id === 'invoice-row');

    expect(comp?.actions[0]).toEqual({
      id: 'click',
      label: 'Delete',
      description: 'Permanently delete this invoice',
      effect: 'destructive',
      path: '/control/component/invoice-row/action/click',
    });
    expect(comp?.actions[1]).toEqual({
      id: 'preview',
      label: 'Preview',
      effect: 'read',
      path: '/control/component/invoice-row/action/preview',
    });
    // Declared nothing: the key is simply absent, not `null`, not 'write'.
    expect(comp?.actions[2]).toEqual({
      id: 'rename',
      label: 'Rename',
      path: '/control/component/invoice-row/action/rename',
    });
  });

  it('GET /control/component/:id emits the same effect', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.getComponent('invoice-row');

    expect(resp.success).toBe(true);
    const wire = overTheWire(resp.data) as { actions: Array<Record<string, unknown>> };
    expect(wire.actions[0]).toEqual({
      id: 'click',
      label: 'Delete',
      description: 'Permanently delete this invoice',
      effect: 'destructive',
      path: '/control/component/invoice-row/action/click',
    });
  });
});

describe('Phase 4 — effect on the Tauri IPC channel', () => {
  beforeEach(() => {
    resetGlobalRegistry();
    registerInvoiceRow();
  });
  afterEach(() => {
    resetGlobalRegistry();
  });

  it('get_components carries the annotation', async () => {
    const result = (await executeCommand('get_components', {}, emptyBridge)) as {
      components: Array<{ id: string; actions: Array<Record<string, unknown>> }>;
    };
    const comp = result.components.find((c) => c.id === 'invoice-row');

    expect(comp?.actions[0]).toEqual({
      id: 'click',
      label: 'Delete',
      description: 'Permanently delete this invoice',
      effect: 'destructive',
    });
    expect(comp?.actions[1]).toEqual({
      id: 'preview',
      label: 'Preview',
      description: undefined,
      effect: 'read',
    });
    expect(comp?.actions[2].effect).toBeUndefined();
  });

  it('get_component carries the annotation', async () => {
    const result = (await executeCommand(
      'get_component',
      { componentId: 'invoice-row' },
      emptyBridge
    )) as { actions: Array<Record<string, unknown>> };

    expect(result.actions[0]).toEqual({
      id: 'click',
      label: 'Delete',
      description: 'Permanently delete this invoice',
      effect: 'destructive',
    });
  });

  it('getControlSnapshot carries the annotation', async () => {
    const result = (await executeCommand('getControlSnapshot', {}, emptyBridge)) as {
      components: Array<{ id: string; actions: Array<Record<string, unknown>> }>;
    };
    const comp = result.components.find((c) => c.id === 'invoice-row');

    expect(comp?.actions[0].effect).toBe('destructive');
    expect(comp?.actions[1].effect).toBe('read');
    expect(comp?.actions[2].effect).toBeUndefined();
  });
});
