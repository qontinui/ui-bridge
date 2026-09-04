/**
 * Phase 5 — `signature` survives the registry's closed object literals, and
 * NEVER reaches the wire.
 *
 * Plan: `2026-09-04-effect-calculus-joins-the-component-action-registry`,
 * Phase 5.
 *
 * Two opposite obligations, and both are runtime round-trips because a
 * type-check can see neither:
 *
 *   1. `registerComponent` / `updateComponent` each re-map the incoming action
 *      into a fresh object literal with a CLOSED field list. A field missing
 *      from either is dropped at registration time, silently — the literal
 *      stays assignable, the serializer still runs, the field is simply never
 *      there. That trap had already fired for `paramSchema` before Phase 2.
 *   2. The snapshot projection must NOT carry it. `signature` holds a closure,
 *      and this test pins the projected object's EXACT key set so a future
 *      widening has to be deliberate rather than accidental.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UIBridgeRegistry,
  serializeRegisteredComponent,
  resetGlobalRegistry,
  getGlobalRegistry,
} from './registry';
import type { EffectSignature, PredictedDelta } from '../control/effect-types';

/** A hand-written signature literal — never built from a helper under test. */
function revealsSignature(id: string): EffectSignature {
  return {
    predicts: (): PredictedDelta => ({ elementsAppear: [{ id }] }),
    scope: { elementIds: [id] },
    reversibility: 'reversible',
  };
}

describe('Phase 5 — signature survives registerComponent', () => {
  it('carries a declared signature into the registered component', () => {
    const registry = new UIBridgeRegistry();
    const sig = revealsSignature('confirm-dialog');
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        { id: 'delete', label: 'Delete', effect: 'destructive', signature: sig, handler: () => 1 },
        { id: 'rename', label: 'Rename', handler: () => 2 },
      ],
    });

    const registered = registry.getComponent('invoice-row');
    expect(registered?.actions.map((a) => a.id)).toEqual(['delete', 'rename']);
    // The SAME object reference — the registry copies the field, it does not
    // clone or normalize it. Normalization happens at resolve time.
    expect(registered?.actions[0].signature).toBe(sig);
    // Declared nothing: stays undefined. "Nobody described this action" is a
    // distinct state and it is never filled in with a fabricated signature.
    expect(registered?.actions[1].signature).toBeUndefined();
  });

  it('leaves signature undefined for every action when none is declared', () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('bare', {
      name: 'Bare',
      actions: [{ id: 'ping', handler: () => 'pong' }],
    });

    const registered = registry.getComponent('bare');
    expect(registered?.actions[0].signature).toBeUndefined();
    expect(registered?.actions[0].id).toBe('ping');
    expect(typeof registered?.actions[0].handler).toBe('function');
  });
});

describe('Phase 5 — signature survives updateComponent', () => {
  it('carries a changed signature through the update path', () => {
    const registry = new UIBridgeRegistry();
    const first = revealsSignature('panel-a');
    const second = revealsSignature('panel-b');
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [{ id: 'open', signature: first, handler: () => 1 }],
    });
    expect(registry.getComponent('drawer')?.actions[0].signature).toBe(first);

    const updated = registry.updateComponent('drawer', {
      actions: [{ id: 'open', signature: second, handler: () => 1 }],
    });

    expect(updated).toBe(true);
    expect(registry.getComponent('drawer')?.actions[0].signature).toBe(second);
  });

  it('drops the signature when the update declares none', () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [{ id: 'open', signature: revealsSignature('panel-a'), handler: () => 1 }],
    });

    registry.updateComponent('drawer', {
      actions: [{ id: 'open', handler: () => 1 }],
    });

    expect(registry.getComponent('drawer')?.actions[0].signature).toBeUndefined();
  });
});

describe('Phase 5 — signature is runtime-only and never projected', () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });
  afterEach(() => {
    resetGlobalRegistry();
  });

  it('serializeRegisteredComponent omits it — EXACT key set, not a spot check', () => {
    const registry = new UIBridgeRegistry();
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        {
          id: 'delete',
          label: 'Delete',
          description: 'Permanently delete this invoice',
          effect: 'destructive',
          signature: revealsSignature('confirm-dialog'),
          handler: () => 'deleted',
        },
      ],
    });

    // The projection BEFORE JSON — this is the object an in-process consumer
    // (or a structured-clone transport) actually receives. `JSON.stringify`
    // would drop a function key and hide the widening; this does not.
    const projected = serializeRegisteredComponent(registry.getComponent('invoice-row')!);
    const action = projected.actions[0] as Record<string, unknown>;

    expect(Object.keys(action).sort()).toEqual(['description', 'effect', 'id', 'label']);
    expect('signature' in action).toBe(false);
    expect('handler' in action).toBe(false);
    // And the coarse annotation is still there — Phase 5 did not disturb it.
    expect(action.effect).toBe('destructive');
  });

  it('createSnapshot carries no signature either', () => {
    getGlobalRegistry().registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        { id: 'delete', label: 'Delete', signature: revealsSignature('x'), handler: () => 1 },
      ],
    });

    const snapshot = getGlobalRegistry().createSnapshot();
    const comp = snapshot.components.find((c) => c.id === 'invoice-row');
    const action = comp?.actions[0] as Record<string, unknown>;

    expect(Object.keys(action).sort()).toEqual(['description', 'effect', 'id', 'label']);
    expect('signature' in action).toBe(false);
    // Structured-clone safety is the reason: a closure in the snapshot would
    // throw on postMessage. Prove the projection survives one.
    expect(() => structuredClone(snapshot.components)).not.toThrow();
  });
});
