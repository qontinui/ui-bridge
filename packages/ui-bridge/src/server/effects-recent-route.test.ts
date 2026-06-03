/**
 * D3 Effect Calculus (Phase 2) — `/effects/recent` route + handler contract.
 *
 * Asserts the read-only GET route is registered in the source-of-truth route
 * table and bound to `getRecentEffects`, that the handler key exists on a
 * created handlers object, and that the handler drains the global effect store
 * newest-first with a respected `limit`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UI_BRIDGE_ROUTES } from './types';
import { createHandlers } from './handlers';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import {
  getGlobalEffectStore,
  resetGlobalEffectStore,
  type EffectRecordEntry,
} from '../control/effect-store';
import type { EffectVerification } from '../control/effect-types';

function fakeVerification(): EffectVerification {
  return {
    outcome: 'Confirmed',
    predicted: {},
    observed: { appeared: [], disappeared: [], modified: [], errorsAppeared: 0 },
    containment: {
      predictedSubsetObserved: true,
      observedSubsetPredicted: true,
      activeNegation: false,
      coverage: 1,
    },
    cause: 'causal',
    durationMs: 1,
  };
}

function entry(action: string, timestamp: number): EffectRecordEntry {
  return {
    action,
    elementId: `${action}-el`,
    outcome: 'Confirmed',
    cause: 'causal',
    verification: fakeVerification(),
    timestamp,
  };
}

describe('UI_BRIDGE_ROUTES /effects/recent registration', () => {
  it('declares GET /effects/recent bound to getRecentEffects', () => {
    const route = UI_BRIDGE_ROUTES.find(
      (r) => r.method === 'GET' && r.path === '/effects/recent'
    );
    expect(route).toBeDefined();
    expect(route?.handler).toBe('getRecentEffects');
    expect(route?.bodyRequired).toBeFalsy();
    expect(route?.params).toBeUndefined();
  });
});

describe('getRecentEffects handler', () => {
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    resetGlobalEffectStore();
    const registry = new UIBridgeRegistry();
    const executor = new DefaultActionExecutor(registry);
    handlers = createHandlers(registry, executor);
  });

  it('exposes getRecentEffects on the handlers object', () => {
    expect(typeof handlers.getRecentEffects).toBe('function');
  });

  it('returns recent effects newest-first from the global store', async () => {
    const store = getGlobalEffectStore();
    store.record(entry('a', 1));
    store.record(entry('b', 2));
    store.record(entry('c', 3));

    const res = await handlers.getRecentEffects();

    expect(res.success).toBe(true);
    expect(res.data?.map((e) => e.action)).toEqual(['c', 'b', 'a']);
  });

  it('respects a numeric limit', async () => {
    const store = getGlobalEffectStore();
    for (let i = 1; i <= 5; i++) store.record(entry(`a${i}`, i));

    const res = await handlers.getRecentEffects({ limit: 2 });
    expect(res.data?.map((e) => e.action)).toEqual(['a5', 'a4']);
  });

  it('coerces a string limit (query param shape)', async () => {
    const store = getGlobalEffectStore();
    for (let i = 1; i <= 5; i++) store.record(entry(`a${i}`, i));

    // The GET adapter passes query values as strings.
    const res = await handlers.getRecentEffects({
      limit: '3' as unknown as number,
    });
    expect(res.data?.map((e) => e.action)).toEqual(['a5', 'a4', 'a3']);
  });

  it('returns an empty array when the store is empty', async () => {
    const res = await handlers.getRecentEffects();
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });
});
