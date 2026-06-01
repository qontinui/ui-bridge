/**
 * Tests for the D3 Effect Calculus pure containment core
 * ({@link computeVerification}). Covers every outcome in the §3.4 table plus
 * the §6.3 active-negation edge case and the mixed-cause downgrade.
 */

import { describe, it, expect } from 'vitest';
import { computeVerification } from '../effect-containment';
import type {
  PredictedDelta,
  ObservedDelta,
  ObservabilityScope,
} from '../effect-types';
import type { SemanticSnapshot, ElementChange, ElementModification } from '../../ai/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let snapId = 0;

/** Minimal SemanticSnapshot carrying only the fields the code reads. */
function makeSnapshot(elementIds: string[]): SemanticSnapshot {
  snapId++;
  return {
    timestamp: Date.now(),
    snapshotId: `snap-${snapId}`,
    page: { url: 'http://localhost/test', title: 't', activeModals: [] },
    elements: elementIds.map((id) => ({
      id,
      type: 'button',
      label: id,
      tagName: 'button',
      actions: ['click'],
      state: {
        visible: true,
        enabled: true,
        focused: false,
        rect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
        textContent: id,
      },
      registered: true,
      description: id,
      aliases: [],
      suggestedActions: [],
      category: 'interactive' as const,
    })),
    forms: [],
    activeModals: [],
    summary: 's',
    elementCounts: {},
  };
}

function appeared(id: string, extra: Partial<ElementChange> = {}): ElementChange {
  return { elementId: id, description: id, type: 'button', ...extra };
}

function modification(id: string, property: string): ElementModification {
  return { elementId: id, description: id, property, from: 'a', to: 'b', significant: true };
}

function emptyObserved(over: Partial<ObservedDelta> = {}): ObservedDelta {
  return { appeared: [], disappeared: [], modified: [], errorsAppeared: 0, ...over };
}

const WHOLE_PAGE: ObservabilityScope = {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeVerification — outcome table', () => {
  it('Confirmed: P⊆O and O⊆P (exact match)', () => {
    const predicted: PredictedDelta = { elementsAppear: [{ id: 'modal-1' }] };
    const observed = emptyObserved({ appeared: [appeared('modal-1')] });
    const pre = makeSnapshot(['btn']); // modal not present pre

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);

    expect(v.outcome).toBe('Confirmed');
    expect(v.containment.predictedSubsetObserved).toBe(true);
    expect(v.containment.observedSubsetPredicted).toBe(true);
    expect(v.containment.activeNegation).toBe(false);
    expect(v.containment.coverage).toBe(1);
  });

  it('Surprise: P⊆O but extra unpredicted change observed', () => {
    const predicted: PredictedDelta = { elementsAppear: [{ id: 'modal-1' }] };
    const observed = emptyObserved({ appeared: [appeared('modal-1'), appeared('toast-x')] });
    const pre = makeSnapshot(['btn']);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);

    expect(v.outcome).toBe('Surprise');
    expect(v.containment.predictedSubsetObserved).toBe(true);
    expect(v.containment.observedSubsetPredicted).toBe(false);
  });

  it('Failure: predicted appear, nothing observed, element absent in pre', () => {
    const predicted: PredictedDelta = { elementsAppear: [{ id: 'modal-1' }] };
    const observed = emptyObserved();
    const pre = makeSnapshot(['btn']); // modal-1 absent pre

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);

    expect(v.outcome).toBe('Failure');
    expect(v.containment.predictedSubsetObserved).toBe(false);
    expect(v.containment.activeNegation).toBe(false);
  });

  it('Contradiction: predicted appear, element present in pre AND disappeared', () => {
    const predicted: PredictedDelta = { elementsAppear: [{ id: 'modal-1' }] };
    const observed = emptyObserved({ disappeared: [appeared('modal-1')] });
    const pre = makeSnapshot(['btn', 'modal-1']);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);

    expect(v.outcome).toBe('Contradiction');
    expect(v.containment.predictedSubsetObserved).toBe(false);
    expect(v.containment.activeNegation).toBe(true);
  });

  it('Contradiction: predicted disappear, element instead appeared', () => {
    const predicted: PredictedDelta = { elementsDisappear: [{ id: 'spinner' }] };
    const observed = emptyObserved({ appeared: [appeared('spinner')] });
    const pre = makeSnapshot(['btn']);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);

    expect(v.outcome).toBe('Contradiction');
    expect(v.containment.activeNegation).toBe(true);
  });

  it('§6.3 edge: predicted "modal appears" but modal already in pre + empty observed → Failure, not Contradiction', () => {
    const predicted: PredictedDelta = { elementsAppear: [{ id: 'modal-1' }] };
    const observed = emptyObserved(); // empty delta for modal-1
    const pre = makeSnapshot(['btn', 'modal-1']); // already present pre

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);

    expect(v.outcome).toBe('Failure');
    expect(v.containment.activeNegation).toBe(false);
  });

  it('Partial: a predicted id outside scope → coverage<1 → Partial overrides', () => {
    // Predict two appears but scope only captures one of them.
    const predicted: PredictedDelta = {
      elementsAppear: [{ id: 'card-1' }, { id: 'out-of-scope' }],
    };
    // Even if both observed (would be Confirmed), coverage<1 forces Partial.
    const observed = emptyObserved({
      appeared: [appeared('card-1'), appeared('out-of-scope')],
    });
    const pre = makeSnapshot(['btn']);
    const scope: ObservabilityScope = { elementIds: ['card-1'] };

    const v = computeVerification(predicted, observed, pre, scope, 'causal', 5);

    expect(v.outcome).toBe('Partial');
    expect(v.containment.coverage).toBeLessThan(1);
    expect(v.containment.coverage).toBeCloseTo(0.5);
  });

  it('mixed cause downgrades Confirmed → Surprise', () => {
    const predicted: PredictedDelta = { elementsAppear: [{ id: 'modal-1' }] };
    const observed = emptyObserved({ appeared: [appeared('modal-1')] });
    const pre = makeSnapshot(['btn']);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'mixed', 5);

    expect(v.outcome).toBe('Surprise');
    expect(v.cause).toBe('mixed');
  });

  it('mixed cause does NOT upgrade a Failure', () => {
    const predicted: PredictedDelta = { elementsAppear: [{ id: 'modal-1' }] };
    const observed = emptyObserved();
    const pre = makeSnapshot(['btn']);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'mixed', 5);

    expect(v.outcome).toBe('Failure');
  });

  it('Empty predicted delta → Confirmed with coverage 1', () => {
    const predicted: PredictedDelta = {};
    const observed = emptyObserved();
    const pre = makeSnapshot(['btn']);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);

    expect(v.outcome).toBe('Confirmed');
    expect(v.containment.coverage).toBe(1);
    expect(v.containment.predictedSubsetObserved).toBe(true);
    expect(v.containment.observedSubsetPredicted).toBe(true);
  });

  it('Empty predicted but observed has changes → Surprise (extra)', () => {
    const predicted: PredictedDelta = {};
    const observed = emptyObserved({ appeared: [appeared('surprise-el')] });
    const pre = makeSnapshot(['btn']);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);

    expect(v.outcome).toBe('Surprise');
    expect(v.containment.observedSubsetPredicted).toBe(false);
  });
});

describe('computeVerification — navigation', () => {
  it('Confirmed on string navigation match', () => {
    const predicted: PredictedDelta = { navigationTo: '/dashboard' };
    const observed = emptyObserved({ navigatedTo: '/dashboard' });
    const pre = makeSnapshot([]);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);
    expect(v.outcome).toBe('Confirmed');
  });

  it('Failure when navigation predicted but not observed', () => {
    const predicted: PredictedDelta = { navigationTo: '/dashboard' };
    const observed = emptyObserved();
    const pre = makeSnapshot([]);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);
    expect(v.outcome).toBe('Failure');
  });

  it('Confirmed on RegExp navigation match', () => {
    const predicted: PredictedDelta = { navigationTo: /^\/tasks\/\d+$/ };
    const observed = emptyObserved({ navigatedTo: '/tasks/42' });
    const pre = makeSnapshot([]);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);
    expect(v.outcome).toBe('Confirmed');
  });

  it('Surprise when unpredicted navigation observed', () => {
    const predicted: PredictedDelta = { elementsAppear: [{ id: 'x' }] };
    const observed = emptyObserved({ appeared: [appeared('x')], navigatedTo: '/elsewhere' });
    const pre = makeSnapshot([]);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);
    expect(v.outcome).toBe('Surprise');
  });
});

describe('computeVerification — errors', () => {
  it("errorsAppear: 'none' Confirmed when no errors appeared", () => {
    const predicted: PredictedDelta = { errorsAppear: 'none' };
    const observed = emptyObserved({ errorsAppeared: 0 });
    const pre = makeSnapshot([]);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);
    expect(v.outcome).toBe('Confirmed');
  });

  it("errorsAppear: 'none' Failure when an error appeared", () => {
    const predicted: PredictedDelta = { errorsAppear: 'none' };
    const observed = emptyObserved({
      appeared: [appeared('err', { type: 'alert', semanticType: 'error-banner' })],
      errorsAppeared: 1,
    });
    const pre = makeSnapshot([]);

    const v = computeVerification(predicted, observed, pre, WHOLE_PAGE, 'causal', 5);
    // P⊄O (none-prediction violated) and no active negation → Failure.
    expect(v.outcome).toBe('Failure');
    expect(v.containment.predictedSubsetObserved).toBe(false);
  });
});

describe('computeVerification — glob id matching (reveals)', () => {
  it('Confirmed when a glob criterion matches a globbed appeared id', () => {
    const predicted: PredictedDelta = { elementsAppear: [{ id: 'session-card-*' }] };
    const observed = emptyObserved({ appeared: [appeared('session-card-7')] });
    const pre = makeSnapshot(['btn']);

    const v = computeVerification(predicted, observed, pre, { elementIds: ['session-card-*'] }, 'causal', 5);
    expect(v.outcome).toBe('Confirmed');
    expect(v.containment.coverage).toBe(1);
  });
});

describe('computeVerification — elementsModify', () => {
  it('Confirmed when predicted value modification observed on target', () => {
    const predicted: PredictedDelta = {
      elementsModify: [{ criteria: { id: 'input-1' }, expect: { value: '' } }],
    };
    const observed = emptyObserved({ modified: [modification('input-1', 'value')] });
    const pre = makeSnapshot(['input-1']);

    const v = computeVerification(predicted, observed, pre, { elementIds: ['input-1'] }, 'causal', 5);
    expect(v.outcome).toBe('Confirmed');
  });

  it('Failure when predicted modification touches a different property', () => {
    const predicted: PredictedDelta = {
      elementsModify: [{ criteria: { id: 'input-1' }, expect: { value: '' } }],
    };
    const observed = emptyObserved({ modified: [modification('input-1', 'focused')] });
    const pre = makeSnapshot(['input-1']);

    const v = computeVerification(predicted, observed, pre, { elementIds: ['input-1'] }, 'causal', 5);
    // predicted value-mod not satisfied (property mismatch) AND observed
    // focused-mod not predicted → P⊄O, no active negation → Failure.
    expect(v.outcome).toBe('Failure');
  });
});
