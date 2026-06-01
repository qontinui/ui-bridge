/**
 * Tests for the D3 Effect Calculus signature registry
 * ({@link createDefaultSignatureRegistry}).
 */

import { describe, it, expect } from 'vitest';
import { createDefaultSignatureRegistry } from '../effect-signatures';
import type { SemanticSnapshot } from '../../ai/types';

function makeEmptySnapshot(): SemanticSnapshot {
  return {
    timestamp: Date.now(),
    snapshotId: 'snap-sig',
    page: { url: 'http://localhost/test', title: 't', activeModals: [] },
    elements: [],
    forms: [],
    activeModals: [],
    summary: 's',
    elementCounts: {},
  };
}

describe('createDefaultSignatureRegistry', () => {
  const registry = createDefaultSignatureRegistry();
  const pre = makeEmptySnapshot();

  it('click with reveals resolves a signature predicting those appear', () => {
    const sig = registry.resolve('click', { id: 'toggle', reveals: ['panel-a', 'panel-b-*'] });
    expect(sig).toBeDefined();
    expect(sig?.scope.elementIds).toEqual(['panel-a', 'panel-b-*']);

    const predicted = sig!.predicts({ action: 'click', elementId: 'toggle' }, pre);
    expect(predicted.elementsAppear).toEqual([{ id: 'panel-a' }, { id: 'panel-b-*' }]);
  });

  it('click without reveals resolves undefined', () => {
    expect(registry.resolve('click', { id: 'plain-button' })).toBeUndefined();
    expect(registry.resolve('click', undefined)).toBeUndefined();
  });

  it('navigate resolves a navigationTo prediction from the url param', () => {
    const sig = registry.resolve('navigate', undefined, { url: '/dashboard' });
    expect(sig).toBeDefined();
    const predicted = sig!.predicts({ action: 'navigate', params: { url: '/dashboard' } }, pre);
    expect(predicted.navigationTo).toBe('/dashboard');
    expect(sig?.scope.elementIds).toBeUndefined(); // whole-page
  });

  it('navigate without a url/route/to param resolves undefined', () => {
    expect(registry.resolve('navigate', undefined, {})).toBeUndefined();
  });

  it('wait with a state param predicts that state activates', () => {
    const sig = registry.resolve('wait', undefined, { state: 'modal-open' });
    expect(sig).toBeDefined();
    const predicted = sig!.predicts({ action: 'wait', params: { state: 'modal-open' } }, pre);
    expect(predicted.stateActivates).toEqual(['modal-open']);
  });

  it('type on a target predicts a value modification', () => {
    const sig = registry.resolve('type', { id: 'email-input' }, { text: 'hi' });
    expect(sig).toBeDefined();
    const predicted = sig!.predicts({ action: 'type', elementId: 'email-input' }, pre);
    expect(predicted.elementsModify?.[0].criteria.id).toBe('email-input');
    expect(predicted.elementsModify?.[0].expect).toHaveProperty('value');
  });

  it('focus predicts a focused:true modification on the target', () => {
    const sig = registry.resolve('focus', { id: 'field-1' });
    expect(sig).toBeDefined();
    const predicted = sig!.predicts({ action: 'focus', elementId: 'field-1' }, pre);
    expect(predicted.elementsModify?.[0].expect).toEqual({ focused: true });
  });

  it('fill predicts a modification per filled field', () => {
    const sig = registry.resolve('fill', undefined, { fields: { name: 'a', email: 'b' } });
    expect(sig).toBeDefined();
    const predicted = sig!.predicts({ action: 'fill', params: { fields: { name: 'a', email: 'b' } } }, pre);
    expect(predicted.elementsModify?.map((m) => m.criteria.id)).toEqual(['name', 'email']);
  });

  it('evaluate and scroll resolve undefined (no concrete prediction)', () => {
    expect(registry.resolve('evaluate', undefined)).toBeUndefined();
    expect(registry.resolve('scroll', { id: 'x' })).toBeUndefined();
  });

  it('an unknown action resolves undefined', () => {
    expect(registry.resolve('teleport', { id: 'x' })).toBeUndefined();
  });
});
