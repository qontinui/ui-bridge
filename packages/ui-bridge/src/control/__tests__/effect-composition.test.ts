/**
 * Tests for the D3 Effect Calculus Phase 3b composition core
 * ({@link composeSignatures}). Pure unit tests — no DOM. Cover the merge
 * semantics: predicted-appear union, last-navigation-wins, strictest-error
 * ('none' wins), broadest-scope, and the 0-signature no-op.
 */

import { describe, it, expect } from 'vitest';
import { composeSignatures } from '../effect-composition';
import type { CompositionStep } from '../effect-composition';
import type { SignatureLookup, SignatureLookupElement } from '../effect-signatures';
import type { SemanticSnapshot } from '../../ai/types';
import type { EffectSignature, PredictedDelta } from '../effect-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let snapId = 0;

function makeSnapshot(elementIds: string[] = []): SemanticSnapshot {
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

/**
 * A registry that returns a fixed signature per action name. Lets each test
 * declare exactly the predicted deltas/scopes it needs.
 */
function fixedRegistry(map: Record<string, EffectSignature | undefined>): SignatureLookup {
  return {
    resolve(action: string): EffectSignature | undefined {
      return map[action];
    },
  };
}

function sig(predicted: PredictedDelta, elementIds?: string[]): EffectSignature {
  return {
    predicts: (): PredictedDelta => predicted,
    scope: elementIds ? { elementIds } : {},
    reversibility: 'reversible',
    provenance: 'declared',
  };
}

const STEP = (action: string, element?: SignatureLookupElement): CompositionStep => ({
  action,
  element,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('composeSignatures', () => {
  it('unions two steps\' predicted appears (deduped) and counts contributors', () => {
    const registry = fixedRegistry({
      a: sig({ elementsAppear: [{ id: 'menu' }] }, ['menu']),
      b: sig({ elementsAppear: [{ id: 'panel' }] }, ['panel']),
    });

    const composed = composeSignatures(
      [STEP('a'), STEP('b')],
      makeSnapshot(),
      registry,
    );

    expect(composed.stepsWithSignatures).toBe(2);
    expect(composed.predicted.elementsAppear).toEqual([{ id: 'menu' }, { id: 'panel' }]);
    // Both steps were id-scoped → composed scope is the union of ids.
    expect(composed.scope.elementIds).toEqual(['menu', 'panel']);
    expect(composed.scope.unchangedFromPrevious).toBeUndefined();
  });

  it('dedupes identical predicted-appear criteria across steps', () => {
    const registry = fixedRegistry({
      a: sig({ elementsAppear: [{ id: 'menu' }] }, ['menu']),
      b: sig({ elementsAppear: [{ id: 'menu' }] }, ['menu']),
    });

    const composed = composeSignatures([STEP('a'), STEP('b')], makeSnapshot(), registry);

    expect(composed.stepsWithSignatures).toBe(2);
    expect(composed.predicted.elementsAppear).toEqual([{ id: 'menu' }]);
    expect(composed.scope.elementIds).toEqual(['menu']);
  });

  it('navigationTo takes the LAST non-undefined (final destination)', () => {
    const registry = fixedRegistry({
      nav1: sig({ navigationTo: '/first' }),
      nav2: sig({ navigationTo: '/second' }),
    });

    const composed = composeSignatures(
      [STEP('nav1'), STEP('nav2')],
      makeSnapshot(),
      registry,
    );

    expect(composed.predicted.navigationTo).toBe('/second');
    // Both nav signatures are whole-page → composed scope is whole-page.
    expect(composed.scope.elementIds).toBeUndefined();
  });

  it('errorsAppear: \'none\' wins over a severity bound (strictest)', () => {
    const registry = fixedRegistry({
      lax: sig({ errorsAppear: { severityAtMost: 'warning' } }, ['x']),
      strict: sig({ errorsAppear: 'none' }, ['y']),
    });

    const composed = composeSignatures(
      [STEP('lax'), STEP('strict')],
      makeSnapshot(),
      registry,
    );

    expect(composed.predicted.errorsAppear).toBe('none');
  });

  it('errorsAppear: between two bounds keeps the lower (stricter) ceiling', () => {
    const registry = fixedRegistry({
      hi: sig({ errorsAppear: { severityAtMost: 'error' } }, ['x']),
      lo: sig({ errorsAppear: { severityAtMost: 'warning' } }, ['y']),
    });

    const composed = composeSignatures([STEP('hi'), STEP('lo')], makeSnapshot(), registry);

    expect(composed.predicted.errorsAppear).toEqual({ severityAtMost: 'warning' });
  });

  it('a whole-page step broadens the composed scope to whole-page', () => {
    const registry = fixedRegistry({
      scoped: sig({ elementsAppear: [{ id: 'menu' }] }, ['menu']),
      wide: sig({ navigationTo: '/x' }), // whole-page scope
    });

    const composed = composeSignatures(
      [STEP('scoped'), STEP('wide')],
      makeSnapshot(),
      registry,
    );

    expect(composed.scope.elementIds).toBeUndefined();
  });

  it('unions stateActivates/stateDeactivates and elementsModify', () => {
    const registry = fixedRegistry({
      s: sig({ stateActivates: ['modal'], stateDeactivates: ['list'] }, ['modal']),
      m: sig(
        { elementsModify: [{ criteria: { id: 'field' }, expect: { value: '' } }] },
        ['field'],
      ),
    });

    const composed = composeSignatures([STEP('s'), STEP('m')], makeSnapshot(), registry);

    expect(composed.predicted.stateActivates).toEqual(['modal']);
    expect(composed.predicted.stateDeactivates).toEqual(['list']);
    expect(composed.predicted.elementsModify).toEqual([
      { criteria: { id: 'field' }, expect: { value: '' } },
    ]);
  });

  it('0 signatures → stepsWithSignatures 0 (composition no-op)', () => {
    const registry = fixedRegistry({}); // resolves nothing

    const composed = composeSignatures(
      [STEP('scroll'), STEP('evaluate')],
      makeSnapshot(),
      registry,
    );

    expect(composed.stepsWithSignatures).toBe(0);
    expect(composed.predicted).toEqual({});
    // No id-scoped step contributed → scope is empty ids (not whole-page flip).
    expect(composed.scope.elementIds).toEqual([]);
  });

  it('uses the default registry when none is passed (click w/ reveals)', () => {
    const composed = composeSignatures(
      [STEP('click', { id: 'menu-btn', reveals: ['user-menu'] })],
      makeSnapshot(),
    );

    expect(composed.stepsWithSignatures).toBe(1);
    expect(composed.predicted.elementsAppear).toEqual([{ id: 'user-menu' }]);
    expect(composed.scope.elementIds).toEqual(['user-menu']);
  });

  it('default registry: click WITHOUT reveals resolves no signature', () => {
    const composed = composeSignatures(
      [STEP('click', { id: 'plain-btn' })],
      makeSnapshot(),
    );

    expect(composed.stepsWithSignatures).toBe(0);
  });
});
