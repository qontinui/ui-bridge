/**
 * Phase 6 — `POST /control/component/:id/action/:actionId/predict`.
 *
 * Plan: `2026-09-04-effect-calculus-joins-the-component-action-registry`,
 * Phase 6. Drives the real `DefaultActionExecutor` against a real registry.
 *
 * Two properties carry this phase, and both are asserted here against things
 * that can actually go red:
 *
 *   1. **State neutrality.** The route resolves a signature, captures a
 *      snapshot and predicts — it does NOT invoke the handler. The test that
 *      proves it registers a handler that THROWS when called, so a regression
 *      that starts invoking cannot pass. (Mutation-checked: making
 *      `predictComponentAction` call the handler turns it red.)
 *
 *   2. **A `null` prediction never reads as "harmless".** An action nobody
 *      described is UNCLASSIFIED, not safe
 *      [policy: unknown-must-not-render-as-a-default]. The assertions below
 *      pin the WORDS of `coverageCaveat` and the presence of every explicitly
 *      `null` key AFTER a JSON round-trip — because `JSON.stringify` drops
 *      `undefined`, and an omitted key is exactly how an unknown turns into a
 *      silent default on the wire.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import {
  createDefaultSignatureRegistry,
  createInferredSignatureRegistry,
} from './effect-signatures';
import {
  getGlobalActionWindowRegistry,
  resetGlobalActionWindowRegistry,
} from './action-window-registry';
import { resetGlobalEffectStore, getGlobalEffectStore } from './effect-store';
import { UNCLASSIFIED_CAVEAT_PREFIX } from './effect-predict';
import type { EffectSignature, PredictedDelta } from './effect-types';
import type { InferredSignatureEntry, InferredSignatureTable } from './effect-inference';

/** The wire is JSON. Whatever survives this round-trip is what a caller sees. */
function overTheWire<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe('Phase 6 — predict a component action without invoking it', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    resetGlobalActionWindowRegistry();
    resetGlobalEffectStore();
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalActionWindowRegistry();
    resetGlobalEffectStore();
  });

  function appearSignature(id: string, overrides: Partial<EffectSignature> = {}): EffectSignature {
    return {
      predicts: (): PredictedDelta => ({ elementsAppear: [{ id }] }),
      scope: { elementIds: [id] },
      reversibility: 'reversible',
      settleMs: 0,
      ...overrides,
    };
  }

  /**
   * A handler that fails the test the instant it is called.
   *
   * Deliberately a `throw` and not a spy assertion: a spy has to be checked,
   * and a check that is forgotten (or that runs after an early `return`) is a
   * test that quietly stops testing. A throw cannot be forgotten.
   */
  function explodingHandler(): () => never {
    return () => {
      throw new Error(
        'PREDICT INVOKED THE HANDLER — a predict call must never execute the action',
      );
    };
  }

  // =========================================================================
  // 1. State neutrality — the property the phase is about
  // =========================================================================

  it('does NOT invoke the handler (the handler throws if called)', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        {
          id: 'delete',
          effect: 'destructive',
          signature: appearSignature('deleted-toast', { reversibility: 'one-way' }),
          handler: explodingHandler(),
        },
      ],
    });

    const res = await executor.predictComponentAction('invoice-row', 'delete');

    // If the handler had run, the throw above would have surfaced — either as
    // a rejection or as `success: false` with that message. Both are excluded.
    expect(res.success).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.status).toBe('predicted');
    expect(res.handlerInvoked).toBe(false);
    expect(res.predicted).toEqual({ elementsAppear: [{ id: 'deleted-toast' }] });
  });

  it('writes nothing to the effect store and opens no settle window', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        {
          id: 'delete',
          effect: 'destructive',
          signature: appearSignature('deleted-toast', { reversibility: 'one-way' }),
          handler: explodingHandler(),
        },
      ],
    });

    await executor.predictComponentAction('invoice-row', 'delete', { requestId: 'req-predict' });

    // A store entry records a predict-then-VERIFY cycle. Nothing was verified.
    expect(getGlobalEffectStore().size).toBe(0);
    // No settle window was opened for this request id, so a concurrent
    // background observation cannot be attributed to a call that did nothing.
    expect(getGlobalActionWindowRegistry().hadConcurrentObservation('req-predict')).toBe(false);
  });

  it('predicting twice is idempotent — same answer, still no invocation', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        { id: 'open', signature: appearSignature('panel'), handler: explodingHandler() },
      ],
    });

    const first = await executor.predictComponentAction('drawer', 'open');
    const second = await executor.predictComponentAction('drawer', 'open');

    expect(first.predicted).toEqual(second.predicted);
    expect(first.signatureId).toBe(second.signatureId);
    expect(getGlobalEffectStore().size).toBe(0);
  });

  // =========================================================================
  // 2. The no-signature arm — UNCLASSIFIED, never "harmless"
  // =========================================================================

  it('no signature → predicted null, status unclassified, and it SAYS so', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [{ id: 'open', effect: 'write', handler: explodingHandler() }],
    });

    const res = await executor.predictComponentAction('drawer', 'open');

    expect(res.success).toBe(true);
    expect(res.status).toBe('unclassified');
    expect(res.predicted).toBeNull();
    // Every signature-derived facet is an explicit null, not an omission.
    expect(res.reversibility).toBeNull();
    expect(res.provenance).toBeNull();
    expect(res.confidence).toBeNull();
    expect(res.signatureId).toBeNull();
    expect(res.scope).toBeNull();
    expect(res.predictedAgainstSnapshotAt).toBeNull();
    // The coarse annotation is echoed, and flagged as present.
    expect(res.effect).toBe('write');
    expect(res.effectDeclared).toBe(true);
    // Nothing to contradict → no consistency messages. The unclassified state
    // is NOT reported here, so an empty list never has to read as "all good".
    expect(res.consistency).toEqual([]);
  });

  it('the unclassified caveat states that null is NOT evidence of safety', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [{ id: 'delete', handler: explodingHandler() }],
    });

    const res = await executor.predictComponentAction('invoice-row', 'delete');

    // The words, not merely a non-empty string: a caveat that stops saying
    // this is the exact regression the policy clause exists to prevent.
    expect(res.coverageCaveat).toContain(UNCLASSIFIED_CAVEAT_PREFIX);
    expect(res.coverageCaveat).toContain('NOT evidence that it is safe to invoke');
    expect(res.coverageCaveat).toContain('NOT a prediction that the action changes nothing');
    expect(res.coverageCaveat).toContain('invoice-row.delete');
    // Unannotated as well as unsigned — both gaps named, not just the one.
    expect(res.effect).toBeUndefined();
    expect(res.effectDeclared).toBe(false);
    expect(res.coverageCaveat).toContain('no coarse `effect` annotation');
  });

  it('the nulls SURVIVE JSON — an omitted key is how an unknown becomes a default', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [{ id: 'open', handler: explodingHandler() }],
    });

    const wire = overTheWire(await executor.predictComponentAction('drawer', 'open'));

    // Hand-written key list, asserted with `in` rather than on the value:
    // `JSON.stringify` drops `undefined`, so a field that regressed from
    // `null` to `undefined` would still satisfy `toBeNull()` on the object
    // while vanishing entirely from the wire.
    for (const key of [
      'predicted',
      'reversibility',
      'provenance',
      'confidence',
      'signatureId',
      'scope',
      'predictedAgainstSnapshotAt',
    ]) {
      expect(key in wire, `"${key}" must survive JSON as an explicit null`).toBe(true);
      expect(wire[key]).toBeNull();
    }
    expect(wire.status).toBe('unclassified');
    expect(wire.handlerInvoked).toBe(false);
    expect(typeof wire.coverageCaveat).toBe('string');
    expect((wire.coverageCaveat as string).length).toBeGreaterThan(0);
  });

  // =========================================================================
  // 3. The predicted arm — every field the plan names
  // =========================================================================

  it('a declared signature fills effect/reversibility/provenance/id/scope', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        {
          id: 'delete',
          effect: 'destructive',
          signature: appearSignature('deleted-toast', { reversibility: 'one-way' }),
          handler: explodingHandler(),
        },
      ],
    });

    const res = await executor.predictComponentAction('invoice-row', 'delete');

    expect(res.status).toBe('predicted');
    expect(res.effect).toBe('destructive');
    expect(res.effectDeclared).toBe(true);
    expect(res.reversibility).toBe('one-way');
    expect(res.provenance).toBe('declared');
    // Stamped by the resolver from `<componentId>.<actionId>` (Phase 5).
    expect(res.signatureId).toBe('invoice-row.delete');
    // A hand-declared signature has no measurement behind it — `null`, never
    // a fabricated 1.0.
    expect(res.confidence).toBeNull();
    expect(res.scope).toEqual({ elementIds: ['deleted-toast'] });
    expect(res.predicted).toEqual({ elementsAppear: [{ id: 'deleted-toast' }] });
    expect(typeof res.predictedAgainstSnapshotAt).toBe('number');
    expect(res.consistency).toEqual([]);
  });

  it('the predicted caveat says the handler was not invoked and names the scope', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        { id: 'open', signature: appearSignature('panel'), handler: explodingHandler() },
      ],
    });

    const res = await executor.predictComponentAction('drawer', 'open');

    expect(res.coverageCaveat).toContain('PREDICTION ONLY');
    expect(res.coverageCaveat).toContain('handler was NOT invoked');
    expect(res.coverageCaveat).toContain('drawer.open');
    expect(res.coverageCaveat).toContain('1 element (panel)');
  });

  it('params reach the signature — a prediction is FOR the bag the caller named', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('layout', {
      name: 'Layout',
      actions: [
        {
          id: 'setLayout',
          effect: 'write',
          signature: {
            predicts: (p): PredictedDelta => ({
              elementsAppear: [{ id: `pane-${String(p.params?.layoutId ?? 'none')}` }],
            }),
            scope: {},
            reversibility: 'reversible',
          },
          handler: explodingHandler(),
        },
      ],
    });

    const res = await executor.predictComponentAction('layout', 'setLayout', {
      params: { layoutId: 'split' },
    });

    expect(res.predicted).toEqual({ elementsAppear: [{ id: 'pane-split' }] });
  });

  // =========================================================================
  // 4. Consistency — a caller sees a declaration its own signature contradicts
  // =========================================================================

  it("effect 'read' with a mutating signature is reported in consistency", async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        {
          id: 'peek',
          effect: 'read',
          // `stateActivates` — one of the four facets `predictsMutation`
          // counts (`./effect-authoring`). An `elementsAppear` prediction is
          // deliberately NOT a mutation there: revealing something is not
          // changing it.
          signature: appearSignature('panel', {
            predicts: (): PredictedDelta => ({ stateActivates: ['DrawerOpen'] }),
          }),
          handler: explodingHandler(),
        },
      ],
    });

    const res = await executor.predictComponentAction('drawer', 'peek');

    expect(res.status).toBe('predicted');
    expect(res.consistency).toHaveLength(1);
    expect(res.consistency[0]).toContain('read-effect');
    expect(res.consistency[0]).toContain('drawer.peek');
    // Reported, never thrown on: an inconsistent annotation is an authoring
    // bug to surface, not a reason to refuse to answer.
    expect(res.success).toBe(true);
    expect(res.predicted).not.toBeNull();
  });

  it("effect 'destructive' with a reversible declared signature is reported", async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('invoice-row', {
      name: 'Invoice Row',
      actions: [
        {
          id: 'delete',
          effect: 'destructive',
          // reversibility left at the helper's 'reversible' — the contradiction.
          signature: appearSignature('deleted-toast'),
          handler: explodingHandler(),
        },
      ],
    });

    const res = await executor.predictComponentAction('invoice-row', 'delete');

    expect(res.consistency).toHaveLength(1);
    expect(res.consistency[0]).toContain("reversibility: 'one-way'");
  });

  // =========================================================================
  // 5. Two arms, and their disagreement
  // =========================================================================

  it('reports a declared-vs-inferred disagreement, both predicted against ONE snapshot', async () => {
    const table = inferredTableFor('open', 'drawer', 'Panel');
    const executor = new DefaultActionExecutor(registry, undefined, {
      signatureRegistry: createInferredSignatureRegistry(
        table,
        createDefaultSignatureRegistry({
          declaredComponentSignature: () => appearSignature('panel-declared'),
        }),
      ),
    });
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        {
          id: 'open',
          signature: appearSignature('panel-declared'),
          handler: explodingHandler(),
        },
      ],
    });

    const res = await executor.predictComponentAction('drawer', 'open');

    // The DECLARED arm wins and is what `predicted` reports.
    expect(res.provenance).toBe('declared');
    expect(res.predicted).toEqual({ elementsAppear: [{ id: 'panel-declared' }] });
    expect(res.disagreement).toBeDefined();
    expect(res.disagreement?.declared.provenance).toBe('declared');
    expect(res.disagreement?.inferred.provenance).toBe('inferred');
    expect(res.disagreement?.messages.some((m) => m.includes('elementsAppear differs'))).toBe(
      true,
    );
  });

  it('an INFERRED-only arm reports its provenance, id and measured confidence', async () => {
    const table = inferredTableFor('open', 'drawer', 'Panel');
    const executor = new DefaultActionExecutor(registry, undefined, {
      signatureRegistry: createInferredSignatureRegistry(table, createDefaultSignatureRegistry()),
    });
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [{ id: 'open', effect: 'destructive', handler: explodingHandler() }],
    });

    const res = await executor.predictComponentAction('drawer', 'open');

    expect(res.status).toBe('predicted');
    expect(res.provenance).toBe('inferred');
    expect(res.signatureId).toBe('open drawer');
    expect(res.confidence).toBeCloseTo(0.9);
    expect(res.disagreement).toBeUndefined();
    // Phase 5's fix: an inferred signature's hard-coded 'reversible' must NOT
    // be reported as contradicting a 'destructive' declaration.
    expect(res.consistency).toHaveLength(1);
    expect(res.consistency[0]).toContain('inference cannot establish irreversibility');
    // …and the caveat repeats it, because a caller reading only the caveat
    // must not take `reversibility: 'reversible'` at face value.
    expect(res.coverageCaveat).toContain('Inference cannot observe irreversibility');
    expect(res.coverageCaveat).toContain('0.9');
  });

  // =========================================================================
  // 6. Unresolved — "there is no such action" is not "unclassified"
  // =========================================================================

  it('an unknown component is UNRESOLVED, not unclassified', async () => {
    const executor = new DefaultActionExecutor(registry);

    const res = await executor.predictComponentAction('nope', 'open');

    expect(res.success).toBe(false);
    expect(res.status).toBe('unresolved');
    expect(res.code).toBe('COMPONENT_NOT_FOUND');
    expect(res.predicted).toBeNull();
    expect(res.coverageCaveat).toContain('UNRESOLVED');
    expect(res.coverageCaveat).toContain('least of all that one is safe');
  });

  it('an unknown action names the ones that DO exist', async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        { id: 'open', handler: explodingHandler() },
        { id: 'close', handler: explodingHandler() },
      ],
    });

    const res = await executor.predictComponentAction('drawer', 'nope');

    expect(res.success).toBe(false);
    expect(res.status).toBe('unresolved');
    expect(res.code).toBe('ACTION_NOT_FOUND');
    expect(res.error).toContain('open, close');
  });

  it("a signature whose predicts() throws is an authoring bug, not 'unclassified'", async () => {
    const executor = new DefaultActionExecutor(registry);
    registry.registerComponent('drawer', {
      name: 'Drawer',
      actions: [
        {
          id: 'open',
          signature: {
            predicts: (): PredictedDelta => {
              throw new Error('bad signature');
            },
            scope: {},
            reversibility: 'reversible',
          },
          handler: explodingHandler(),
        },
      ],
    });

    const res = await executor.predictComponentAction('drawer', 'open');

    expect(res.success).toBe(false);
    expect(res.code).toBe('SIGNATURE_PREDICT_FAILED');
    expect(res.error).toContain('bad signature');
    // Crucially NOT 'unclassified' — that would blame a coverage gap for a
    // bug in a signature that exists.
    expect(res.status).toBe('unresolved');
  });
});

/**
 * A hand-built inference table with one entry keyed `(action, componentId)` —
 * the shape the component arm probes first. Mirrors the Phase 5 helper.
 */
function inferredTableFor(
  action: string,
  componentId: string,
  appearText: string,
): InferredSignatureTable {
  const keyFor = (a: string, t: string | null): string => `${a} ${t ?? 'null'}`;
  const e: InferredSignatureEntry = {
    action,
    targetFingerprint: componentId,
    support: 4,
    facts: [{ criteria: { textContains: appearText }, confidence: 0.9, kind: 'appear' }],
  };
  return { bySignatureKey: new Map([[keyFor(action, componentId), e]]), keyFor };
}
