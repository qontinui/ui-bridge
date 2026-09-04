/**
 * Phase 5 — the component-action arm of signature resolution, signature
 * identity, the authoring lint, and two-arm disagreement.
 *
 * Plan: `2026-09-04-effect-calculus-joins-the-component-action-registry`,
 * Phase 5.
 *
 * Before this, `SignatureLookup.resolve()` switched over seven element-level
 * verbs and a component action's free-form id fell through to
 * `default: undefined` — the whole component surface was invisible to the
 * calculus. These tests pin the arm that closes that, on the SAME interface
 * rather than a parallel lookup.
 */

import { describe, it, expect } from 'vitest';
import {
  componentSignatureId,
  createDefaultSignatureRegistry,
  createInferredSignatureRegistry,
  normalizeDeclaredComponentSignature,
} from '../effect-signatures';
import {
  assertComponentActionEffectConsistency,
  assertSignatureEffectConsistency,
  describeSignatureDisagreement,
} from '../effect-authoring';
import type {
  ActionParams,
  EffectSignature,
  PredictedDelta,
} from '../effect-types';
import type { InferredSignatureEntry, InferredSignatureTable } from '../effect-inference';
import type { SemanticSnapshot } from '../../ai/types';

// ---------------------------------------------------------------------------
// Fixtures — hand-written, never derived from the code under test
// ---------------------------------------------------------------------------

function declaredSig(overrides: Partial<EffectSignature> = {}): EffectSignature {
  return {
    predicts: (): PredictedDelta => ({ elementsAppear: [{ id: 'confirm-dialog' }] }),
    scope: { elementIds: ['confirm-dialog'] },
    reversibility: 'reversible',
    ...overrides,
  };
}

/** A minimal snapshot — the fixtures' `predicts` never reads it. */
const EMPTY_SNAPSHOT = { page: {}, elements: [] } as unknown as SemanticSnapshot;
const PARAMS: ActionParams = { action: 'delete' };

/**
 * Hand-built inference table. `keyFor` reproduces the real one's format
 * (`${action} ${targetFingerprint ?? 'null'}`) literally rather than importing
 * it, so a change to the key format shows up here as a failure instead of
 * silently agreeing with itself.
 */
function tableOf(entries: InferredSignatureEntry[]): InferredSignatureTable {
  const keyFor = (action: string, targetFingerprint: string | null): string =>
    `${action} ${targetFingerprint ?? 'null'}`;
  const bySignatureKey = new Map<string, InferredSignatureEntry>();
  for (const e of entries) bySignatureKey.set(keyFor(e.action, e.targetFingerprint), e);
  return { bySignatureKey, keyFor };
}

function entry(
  action: string,
  targetFingerprint: string | null,
  appears: string[]
): InferredSignatureEntry {
  return {
    action,
    targetFingerprint,
    support: 5,
    facts: appears.map((text) => ({
      criteria: { textContains: text },
      confidence: 0.8,
      kind: 'appear' as const,
    })),
  };
}

// ---------------------------------------------------------------------------
// Signature identity
// ---------------------------------------------------------------------------

describe('Phase 5 — signature identity', () => {
  it('names a declared component-action signature `<componentId>.<actionId>`', () => {
    expect(componentSignatureId('invoice-row', 'delete')).toBe('invoice-row.delete');
  });

  it('normalize stamps the default id and provenance without mutating the author literal', () => {
    const authored = declaredSig();
    const normalized = normalizeDeclaredComponentSignature(authored, 'invoice-row', 'delete');

    expect(normalized?.id).toBe('invoice-row.delete');
    expect(normalized?.provenance).toBe('declared');
    // The author's literal is very often a module-level constant shared by
    // every mount — it must come back untouched.
    expect(authored.id).toBeUndefined();
    expect(authored.provenance).toBeUndefined();
    expect(normalized).not.toBe(authored);
  });

  it('never overwrites an author-supplied id or provenance', () => {
    const authored = declaredSig({ id: 'my-own-name', provenance: 'declared' });
    const normalized = normalizeDeclaredComponentSignature(authored, 'invoice-row', 'delete');
    expect(normalized?.id).toBe('my-own-name');
    // Nothing to fill in, so the same reference comes straight back.
    expect(normalized).toBe(authored);
  });

  it('normalizing nothing is nothing — never a fabricated signature', () => {
    expect(normalizeDeclaredComponentSignature(undefined, 'c', 'a')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The component arm on the default registry
// ---------------------------------------------------------------------------

describe('Phase 5 — DefaultSignatureRegistry component arm', () => {
  it('answers undefined when nothing tells it where declarations live', () => {
    const registry = createDefaultSignatureRegistry();
    expect(registry.resolveComponentSignature('invoice-row', 'delete')).toBeUndefined();
  });

  it('resolves and normalizes the declared signature from the injected source', () => {
    const registry = createDefaultSignatureRegistry({
      declaredComponentSignature: (c, a) =>
        c === 'invoice-row' && a === 'delete' ? declaredSig() : undefined,
    });

    const sig = registry.resolveComponentSignature('invoice-row', 'delete');
    expect(sig?.id).toBe('invoice-row.delete');
    expect(sig?.provenance).toBe('declared');
    expect(registry.resolveComponentSignature('invoice-row', 'rename')).toBeUndefined();
  });

  it('the element arm still falls through on a free-form component action id', () => {
    // The gap Phase 5 exists to close: `resolve()` cannot classify `delete`.
    expect(createDefaultSignatureRegistry().resolve('delete', undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The component arm on the inferred registry
// ---------------------------------------------------------------------------

describe('Phase 5 — InferredSignatureRegistry component arm', () => {
  const table = tableOf([
    entry('delete', 'invoice-row', ['Deleted']),
    entry('archive.toggle', null, ['Archived']),
    entry('publish', 'some-other-component', ['Published']),
  ]);

  function inferredRegistry(declared?: EffectSignature) {
    return createInferredSignatureRegistry(
      table,
      createDefaultSignatureRegistry({
        declaredComponentSignature: () => declared,
      })
    );
  }

  it('declared beats inferred', () => {
    const sig = inferredRegistry(declaredSig()).resolveComponentSignature(
      'invoice-row',
      'delete'
    );
    expect(sig?.provenance).toBe('declared');
    expect(sig?.id).toBe('invoice-row.delete');
  });

  it('falls back to an entry keyed (actionId, componentId), named by its table key', () => {
    const sig = inferredRegistry().resolveComponentSignature('invoice-row', 'delete');
    expect(sig?.provenance).toBe('inferred');
    expect(sig?.id).toBe('delete invoice-row');
    expect(sig?.predicts(PARAMS, EMPTY_SNAPSHOT)).toEqual({
      elementsAppear: [{ textContains: 'Deleted' }],
    });
  });

  it('falls back to an entry keyed under the qualified name with no target', () => {
    const sig = inferredRegistry().resolveComponentSignature('archive', 'toggle');
    expect(sig?.provenance).toBe('inferred');
    expect(sig?.id).toBe('archive.toggle null');
  });

  it('NEVER borrows an entry that only shares the bare action id', () => {
    // `publish` was recorded against `some-other-component`. A component action
    // also called `publish` on a DIFFERENT component must not inherit it — that
    // would be a fabricated prediction wearing a measurement's confidence.
    expect(inferredRegistry().resolveComponentSignature('press-kit', 'publish')).toBeUndefined();
  });

  it('reports BOTH arms so a disagreement is detectable', () => {
    const arms = inferredRegistry(declaredSig()).resolveComponentSignatureArms?.(
      'invoice-row',
      'delete'
    );
    expect(arms?.declared?.provenance).toBe('declared');
    expect(arms?.inferred?.provenance).toBe('inferred');
    // The winner is the declared one — and the loser is still reported.
    expect(arms?.signature).toBe(arms?.declared);
  });

  it('an inferred signature always claims reversible — the absence of evidence', () => {
    expect(inferredRegistry().resolveComponentSignature('invoice-row', 'delete')?.reversibility).toBe(
      'reversible'
    );
  });
});

// ---------------------------------------------------------------------------
// Authoring lint
// ---------------------------------------------------------------------------

describe('Phase 5 — assertComponentActionEffectConsistency', () => {
  it('is clean when the declaration and the signature agree', () => {
    const sig = declaredSig({ provenance: 'declared', reversibility: 'one-way' });
    expect(
      assertComponentActionEffectConsistency(
        'destructive',
        sig,
        PARAMS,
        EMPTY_SNAPSHOT,
        'invoice-row',
        'delete'
      )
    ).toEqual([]);
  });

  it('flags a read-effect action whose signature predicts a mutation', () => {
    const sig = declaredSig({
      provenance: 'declared',
      predicts: (): PredictedDelta => ({ navigationTo: '/gone' }),
    });
    const messages = assertComponentActionEffectConsistency(
      'read',
      sig,
      PARAMS,
      EMPTY_SNAPSHOT,
      'invoice-row',
      'delete'
    );
    expect(messages).toEqual(['read-effect component action "invoice-row.delete" predicts a mutation']);
  });

  it('flags a destructive action whose DECLARED signature is not one-way', () => {
    const sig = declaredSig({ provenance: 'declared', reversibility: 'reversible' });
    const messages = assertComponentActionEffectConsistency(
      'destructive',
      sig,
      PARAMS,
      EMPTY_SNAPSHOT,
      'invoice-row',
      'delete'
    );
    expect(messages).toEqual([
      `component action "invoice-row.delete" must declare reversibility: 'one-way'`,
    ]);
  });

  it('an unstamped provenance is treated as declared, not skipped', () => {
    // Inference always stamps `'inferred'`, so an unstamped signature is
    // hand-authored — skipping the rule for it would drop the check on exactly
    // the signatures a human wrote.
    const messages = assertComponentActionEffectConsistency(
      'destructive',
      declaredSig(),
      PARAMS,
      EMPTY_SNAPSHOT,
      'invoice-row',
      'delete'
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`must declare reversibility: 'one-way'`);
  });

  it('does NOT fire the one-way rule on an inferred signature — and never contradicts', () => {
    // The inherited contradiction: an inferred signature hard-codes
    // `reversibility: 'reversible'`, so the old Rule 2 would fire on EVERY
    // inferred signature by construction and report the author's declaration
    // as the bug.
    const inferred = declaredSig({ provenance: 'inferred', reversibility: 'reversible' });
    const messages = assertComponentActionEffectConsistency(
      'destructive',
      inferred,
      PARAMS,
      EMPTY_SNAPSHOT,
      'invoice-row',
      'delete'
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('inference cannot establish irreversibility');
    // It must NOT be the accusatory message, and must not tell the author their
    // 'destructive' is wrong.
    expect(messages[0]).not.toContain(`must declare reversibility: 'one-way'`);
    expect(messages[0]).toContain('does NOT contradict the declaration');
  });

  it('the transition twin inherits the same fix', () => {
    const inferred = declaredSig({ provenance: 'inferred', reversibility: 'reversible' });
    const messages = assertSignatureEffectConsistency(
      'destructive',
      inferred,
      PARAMS,
      EMPTY_SNAPSHOT
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('inference cannot establish irreversibility');
  });
});

// ---------------------------------------------------------------------------
// Two-arm disagreement
// ---------------------------------------------------------------------------

describe('Phase 5 — describeSignatureDisagreement', () => {
  const declared = declaredSig({ id: 'invoice-row.delete', provenance: 'declared' });
  const inferred = declaredSig({
    id: 'delete invoice-row',
    provenance: 'inferred',
    confidence: 0.8,
  });

  it('is undefined when both arms predict the same thing', () => {
    expect(
      describeSignatureDisagreement(
        { signature: declared, predicted: { elementsAppear: [{ id: 'a' }, { id: 'b' }] } },
        { signature: inferred, predicted: { elementsAppear: [{ id: 'b' }, { id: 'a' }] } }
      )
    ).toBeUndefined();
  });

  it('reports a differing elementsAppear set with both arms named', () => {
    const d = describeSignatureDisagreement(
      { signature: declared, predicted: { elementsAppear: [{ id: 'confirm-dialog' }] } },
      { signature: inferred, predicted: { elementsAppear: [{ textContains: 'Deleted' }] } }
    );

    expect(d).toBeDefined();
    expect(d?.declared.id).toBe('invoice-row.delete');
    expect(d?.inferred.id).toBe('delete invoice-row');
    expect(d?.inferred.confidence).toBe(0.8);
    expect(d?.messages).toHaveLength(1);
    expect(d?.messages[0]).toContain('elementsAppear differs');
  });

  it('reports a differing navigation target', () => {
    const d = describeSignatureDisagreement(
      { signature: declared, predicted: { navigationTo: '/invoices' } },
      { signature: inferred, predicted: {} }
    );
    expect(d?.messages).toEqual([
      'navigationTo differs — declared "/invoices", inferred none',
    ]);
  });

  it('reports a reversibility difference as a note, not a refutation', () => {
    const d = describeSignatureDisagreement(
      { signature: { ...declared, reversibility: 'one-way' }, predicted: {} },
      { signature: inferred, predicted: {} }
    );
    expect(d?.messages).toHaveLength(1);
    expect(d?.messages[0]).toContain('reversibility differs');
    expect(d?.messages[0]).toContain('not a refutation of the declaration');
  });
});
