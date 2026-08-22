/**
 * Phase 4 — `effect` survives the registry's closed object literals, and
 * reaches the wire.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 4.
 *
 * `registerComponent` and `updateComponent` each re-map the incoming action
 * into a **fresh object literal with a closed field list**. A field missing
 * from either is dropped at registration time, silently — the literal stays
 * assignable, the serializer still runs, the field is simply never there.
 * Phase 2 found that trap had ALREADY FIRED on `origin/main` for
 * `paramSchema` across eight native sites. These are RUNTIME round-trips
 * precisely because a type-check cannot see the drop.
 *
 * Every expectation is a hand-written literal — never `IREffect`, never
 * `STANDARD_ACTION_EFFECTS`, no `satisfies`, no type assertions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UIBridgeRegistry,
  serializeRegisteredComponent,
  resetGlobalRegistry,
  getGlobalRegistry,
} from './registry';

/** The wire is JSON. Whatever survives this round-trip is what a consumer sees. */
function overTheWire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('Phase 4 — effect survives registerComponent', () => {
  it('carries a declared destructive effect into the registered component', () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        { id: 'click', label: 'Delete', effect: 'destructive', handler: () => 'deleted' },
        { id: 'open', label: 'Open', effect: 'read', handler: () => 'opened' },
        { id: 'rename', label: 'Rename', handler: () => 'renamed' },
      ],
    });

    const registered = registry.getComponent('invoice-row');
    expect(registered?.actions.map((a) => a.id)).toEqual(['click', 'open', 'rename']);
    expect(registered?.actions[0].effect).toBe('destructive');
    expect(registered?.actions[1].effect).toBe('read');
    // Declared nothing: stays undefined at the registry. The verb-map default
    // is applied by `resolveActionEffect` at read time, not baked in here.
    expect(registered?.actions[2].effect).toBeUndefined();
  });

  it('leaves effect undefined for every action when none is declared', () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('bare', {
      name: 'Bare',
      actions: [{ id: 'ping', handler: () => 'pong' }],
    });

    const registered = registry.getComponent('bare');
    expect(registered?.actions[0].effect).toBeUndefined();
    // And the rest of the action is untouched.
    expect(registered?.actions[0].id).toBe('ping');
    expect(typeof registered?.actions[0].handler).toBe('function');
  });
});

describe('Phase 4 — effect survives updateComponent', () => {
  it('carries a changed effect through the update path', () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [{ id: 'click', label: 'Delete', effect: 'write', handler: () => 'x' }],
    });
    expect(registry.getComponent('invoice-row')?.actions[0].effect).toBe('write');

    const updated = registry.updateComponent('invoice-row', {
      actions: [{ id: 'click', label: 'Delete', effect: 'destructive', handler: () => 'x' }],
    });

    expect(updated).toBe(true);
    expect(registry.getComponent('invoice-row')?.actions[0].effect).toBe('destructive');
  });

  it('drops the effect when the update declares none', () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [{ id: 'click', effect: 'destructive', handler: () => 'x' }],
    });

    registry.updateComponent('invoice-row', {
      actions: [{ id: 'click', handler: () => 'x' }],
    });

    expect(registry.getComponent('invoice-row')?.actions[0].effect).toBeUndefined();
  });
});

describe('Phase 4 — effect reaches the snapshot projection', () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });
  afterEach(() => {
    resetGlobalRegistry();
  });

  it('serializeRegisteredComponent emits destructive over the wire', () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        {
          id: 'click',
          label: 'Delete',
          description: 'Permanently delete this invoice',
          effect: 'destructive',
          handler: () => 'deleted',
        },
      ],
    });

    const wire = overTheWire(
      serializeRegisteredComponent(registry.getComponent('invoice-row')!)
    ) as { actions: Array<Record<string, unknown>> };

    expect(wire.actions[0]).toEqual({
      id: 'click',
      label: 'Delete',
      description: 'Permanently delete this invoice',
      effect: 'destructive',
    });
  });

  it('omits the key entirely when no effect is declared', () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('bare', {
      name: 'Bare',
      actions: [{ id: 'ping', handler: () => 'pong' }],
    });

    const wire = overTheWire(serializeRegisteredComponent(registry.getComponent('bare')!)) as {
      actions: Array<Record<string, unknown>>;
    };

    // Byte-identical to the pre-Phase-4 projection for an un-annotated app.
    expect(wire.actions[0]).toEqual({ id: 'ping' });
    expect('effect' in wire.actions[0]).toBe(false);
  });

  it('createSnapshot carries it too — the surface an autonomous walk reads', () => {
    getGlobalRegistry().registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        { id: 'click', label: 'Delete', effect: 'destructive', handler: () => 'deleted' },
        { id: 'preview', label: 'Preview', effect: 'read', handler: () => 'previewed' },
      ],
    });

    const wire = overTheWire(getGlobalRegistry().createSnapshot()) as {
      components: Array<{ id: string; actions: Array<Record<string, unknown>> }>;
    };
    const comp = wire.components.find((c) => c.id === 'invoice-row');

    expect(comp?.actions).toEqual([
      { id: 'click', label: 'Delete', effect: 'destructive' },
      { id: 'preview', label: 'Preview', effect: 'read' },
    ]);
  });
});
