/**
 * Tests for D3 Effect Calculus Phase 4 — signature inference from recording
 * history ({@link ../effect-inference}) and the declared-first / inferred-fallback
 * registry ({@link ../effect-signatures#createInferredSignatureRegistry}).
 */

import { describe, it, expect } from 'vitest';
import {
  cooccurrenceToEffectRecords,
  inferSignatures,
  type EffectRecord,
} from '../effect-inference';
import { createInferredSignatureRegistry } from '../effect-signatures';
import { computeVerification } from '../effect-containment';
import type { CooccurrenceExportData } from '../../recording/types';
import type { ElementFingerprintData } from '../../core/element-fingerprint';
import type {
  SemanticSnapshot,
  ElementChange,
} from '../../ai/types';
import type { ObservedDelta } from '../effect-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fp(partial: Partial<ElementFingerprintData> & { hash: string }): ElementFingerprintData {
  return {
    structuralPath: 'div > button',
    positionZone: 'main',
    landmarkContext: '',
    role: '',
    tagName: 'div',
    sizeCategory: 'medium',
    relativePosition: { top: 0.1, left: 0.1 },
    isRepeating: false,
    ...partial,
  };
}

const FP_BTN = fp({ hash: 'fp-btn', role: 'button', accessibleName: 'Open menu', tagName: 'button' });
const FP_MENU = fp({
  hash: 'fp-menu',
  role: 'menu',
  accessibleName: 'Account menu',
  tagName: 'ul',
  structuralPath: 'nav > ul',
});

/**
 * 4 clicks on `fp-btn`; 3 of them made `fp-menu` appear (confidence 0.75).
 * Plus 2 clicks on a second target `fp-other` (below the default support floor).
 */
function makeExport(): CooccurrenceExportData {
  const FP_OTHER = fp({ hash: 'fp-other', role: 'button', accessibleName: 'Other', tagName: 'button' });
  return {
    sessionId: 'sess-1',
    exportedAt: 0,
    allFingerprints: ['fp-btn', 'fp-menu', 'fp-other'],
    fingerprintDetails: {
      'fp-btn': FP_BTN,
      'fp-menu': FP_MENU,
      'fp-other': FP_OTHER,
    },
    presenceMatrix: [],
    cooccurrenceCounts: {},
    fingerprintStats: {},
    stateCandidates: [],
    transitions: [
      // 4 clicks on fp-btn — 3 reveal fp-menu, 1 reveals nothing.
      mkT('a1', 'click', 'fp-btn', ['fp-menu'], []),
      mkT('a2', 'click', 'fp-btn', ['fp-menu'], []),
      mkT('a3', 'click', 'fp-btn', ['fp-menu'], []),
      mkT('a4', 'click', 'fp-btn', [], []),
      // 2 clicks on fp-other — below minSupport=3.
      mkT('a5', 'click', 'fp-other', ['fp-menu'], []),
      mkT('a6', 'click', 'fp-other', ['fp-menu'], []),
    ],
  };
}

function mkT(
  actionId: string,
  actionType: string,
  targetFingerprint: string | null,
  appeared: string[],
  disappeared: string[],
) {
  return {
    actionId,
    actionType,
    targetFingerprint,
    beforeCaptureId: `${actionId}-before`,
    afterCaptureId: `${actionId}-after`,
    appearedFingerprints: appeared,
    disappearedFingerprints: disappeared,
    timestamp: 0,
  };
}

function makeEmptySnapshot(): SemanticSnapshot {
  return {
    timestamp: 0,
    snapshotId: 'snap-inf',
    page: { url: 'http://localhost/test', title: 't', activeModals: [] },
    elements: [],
    forms: [],
    activeModals: [],
    summary: 's',
    elementCounts: {},
  };
}

// ---------------------------------------------------------------------------
// cooccurrenceToEffectRecords
// ---------------------------------------------------------------------------

describe('cooccurrenceToEffectRecords', () => {
  it('maps transitions 1:1', () => {
    const data = makeExport();
    const records = cooccurrenceToEffectRecords(data);
    expect(records).toHaveLength(data.transitions.length);
    expect(records[0]).toEqual<EffectRecord>({
      action: 'click',
      targetFingerprint: 'fp-btn',
      appeared: ['fp-menu'],
      disappeared: [],
    });
    expect(records[3]).toEqual<EffectRecord>({
      action: 'click',
      targetFingerprint: 'fp-btn',
      appeared: [],
      disappeared: [],
    });
  });
});

// ---------------------------------------------------------------------------
// inferSignatures
// ---------------------------------------------------------------------------

describe('inferSignatures', () => {
  it('infers an appear-fact for fp-menu with confidence 0.75, criteria from details (role/text not hash)', () => {
    const data = makeExport();
    const records = cooccurrenceToEffectRecords(data);
    const table = inferSignatures(records, data.fingerprintDetails, {
      minSupport: 3,
      minConfidence: 0.5,
    });

    const key = table.keyFor('click', 'fp-btn');
    const entry = table.bySignatureKey.get(key);
    expect(entry).toBeDefined();
    expect(entry?.support).toBe(4);

    const appearFacts = entry!.facts.filter((f) => f.kind === 'appear');
    expect(appearFacts).toHaveLength(1);
    const fact = appearFacts[0];
    expect(fact.confidence).toBeCloseTo(0.75, 5);

    // Criteria built from fingerprintDetails['fp-menu'] — role + textContains,
    // NOT the raw hash.
    expect(fact.criteria.role).toBe('menu');
    expect(fact.criteria.textContains).toBe('Account menu');
    expect(JSON.stringify(fact.criteria)).not.toContain('fp-menu');
    expect(fact.criteria.id).toBeUndefined();
  });

  it('does not infer below minSupport (fp-other has only 2 occurrences)', () => {
    const data = makeExport();
    const records = cooccurrenceToEffectRecords(data);
    const table = inferSignatures(records, data.fingerprintDetails, {
      minSupport: 3,
      minConfidence: 0.5,
    });
    const otherKey = table.keyFor('click', 'fp-other');
    expect(table.bySignatureKey.has(otherKey)).toBe(false);
  });

  it('drops consequences below minConfidence', () => {
    // 4 clicks, only 1 reveals fp-menu → confidence 0.25 < 0.5.
    const records: EffectRecord[] = [
      { action: 'click', targetFingerprint: 'fp-btn', appeared: ['fp-menu'], disappeared: [] },
      { action: 'click', targetFingerprint: 'fp-btn', appeared: [], disappeared: [] },
      { action: 'click', targetFingerprint: 'fp-btn', appeared: [], disappeared: [] },
      { action: 'click', targetFingerprint: 'fp-btn', appeared: [], disappeared: [] },
    ];
    const table = inferSignatures(records, makeExport().fingerprintDetails, {
      minSupport: 3,
      minConfidence: 0.5,
    });
    const entry = table.bySignatureKey.get(table.keyFor('click', 'fp-btn'));
    expect(entry?.support).toBe(4);
    expect(entry?.facts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createInferredSignatureRegistry — declared-vs-inferred precedence
// ---------------------------------------------------------------------------

describe('createInferredSignatureRegistry', () => {
  function buildTable() {
    const data = makeExport();
    const records = cooccurrenceToEffectRecords(data);
    return inferSignatures(records, data.fingerprintDetails, {
      minSupport: 3,
      minConfidence: 0.5,
    });
  }

  it('declared signature wins for a click WITH reveals (provenance not inferred)', () => {
    const table = buildTable();
    const registry = createInferredSignatureRegistry(table, undefined, {
      fingerprintOf: () => 'fp-btn',
    });
    const sig = registry.resolve('click', { id: 'toggle', reveals: ['panel-a'] });
    expect(sig).toBeDefined();
    expect(sig?.provenance).toBe('declared');
    expect(sig?.confidence).toBeUndefined();
  });

  it('falls back to an inferred signature for a click WITHOUT reveals', () => {
    const table = buildTable();
    const registry = createInferredSignatureRegistry(table, undefined, {
      // Map the live element id → its recording fingerprint.
      fingerprintOf: (id) => (id === 'menu-button' ? 'fp-btn' : undefined),
    });
    const sig = registry.resolve('click', { id: 'menu-button' });
    expect(sig).toBeDefined();
    expect(sig?.provenance).toBe('inferred');
    expect(sig?.confidence).toBeCloseTo(0.75, 5);

    const predicted = sig!.predicts({ action: 'click', elementId: 'menu-button' }, makeEmptySnapshot());
    expect(predicted.elementsAppear).toHaveLength(1);
    expect(predicted.elementsAppear?.[0]).toEqual({ role: 'menu', textContains: 'Account menu' });
    // Whole-page scope (criteria carry no id).
    expect(sig?.scope.elementIds).toBeUndefined();
  });

  it('returns undefined when neither declared nor an inferred entry resolves', () => {
    const table = buildTable();
    const registry = createInferredSignatureRegistry(table, undefined, {
      fingerprintOf: () => undefined,
    });
    // 'scroll' has no declared signature; the only inferred entry is for 'click',
    // so an action-level fallback for 'scroll' finds nothing.
    expect(registry.resolve('scroll', { id: 'x' })).toBeUndefined();
  });

  it('uses the action-level aggregate when exactly one inferred entry exists for the action and no fingerprint maps', () => {
    const table = buildTable();
    // No fingerprintOf → per-target key is `click null`, which misses; the only
    // inferred 'click' entry (fp-btn) is the unambiguous action-level aggregate.
    const registry = createInferredSignatureRegistry(table);
    const sig = registry.resolve('click', { id: 'unknown-button' });
    expect(sig?.provenance).toBe('inferred');
    expect(sig?.confidence).toBeCloseTo(0.75, 5);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: an inferred prediction is checkable by computeVerification
// ---------------------------------------------------------------------------

describe('inferred prediction is checkable by computeVerification', () => {
  it('an inferred PredictedDelta + matching ObservedDelta → Confirmed', () => {
    const table = inferSignatures(
      cooccurrenceToEffectRecords(makeExport()),
      makeExport().fingerprintDetails,
      { minSupport: 3, minConfidence: 0.5 },
    );
    const registry = createInferredSignatureRegistry(table, undefined, {
      fingerprintOf: (id) => (id === 'menu-button' ? 'fp-btn' : undefined),
    });
    const sig = registry.resolve('click', { id: 'menu-button' })!;
    const predicted = sig.predicts({ action: 'click', elementId: 'menu-button' }, makeEmptySnapshot());

    // A live element matching the inferred criteria (role 'menu', description
    // containing 'Account menu') appeared.
    const appearedMenu: ElementChange = {
      elementId: 'live-menu-1',
      description: 'Account menu (expanded)',
      type: 'menu',
      semanticType: 'menu',
    };
    const observed: ObservedDelta = {
      appeared: [appearedMenu],
      disappeared: [],
      modified: [],
      errorsAppeared: 0,
    };

    const result = computeVerification(
      predicted,
      observed,
      makeEmptySnapshot(),
      sig.scope,
      'causal',
      5,
    );
    expect(result.outcome).toBe('Confirmed');
    expect(result.containment.predictedSubsetObserved).toBe(true);
    expect(result.containment.observedSubsetPredicted).toBe(true);
    expect(result.containment.coverage).toBe(1);
  });
});
