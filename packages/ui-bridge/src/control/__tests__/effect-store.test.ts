/**
 * Tests for the D3 Effect Calculus Effect Store ring buffer (Phase 2).
 *
 * Covers the bounded ring-buffer cap (oldest evicted), newest-first
 * getRecent(limit), the all-retained default, the empty/clear cases, and the
 * global singleton accessor.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EffectStore,
  getGlobalEffectStore,
  setGlobalEffectStore,
  resetGlobalEffectStore,
} from '../effect-store';
import type { EffectRecordEntry } from '../effect-store';
import type { EffectVerification } from '../effect-types';

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

describe('EffectStore', () => {
  it('records and returns newest-first', () => {
    const store = new EffectStore();
    store.record(entry('a', 1));
    store.record(entry('b', 2));
    store.record(entry('c', 3));

    const recent = store.getRecent();
    expect(recent.map((e) => e.action)).toEqual(['c', 'b', 'a']);
    expect(store.size).toBe(3);
  });

  it('getRecent(limit) returns the newest `limit` records', () => {
    const store = new EffectStore();
    for (let i = 1; i <= 5; i++) store.record(entry(`a${i}`, i));
    expect(store.getRecent(2).map((e) => e.action)).toEqual(['a5', 'a4']);
  });

  it('getRecent(0) returns empty; negative returns empty', () => {
    const store = new EffectStore();
    store.record(entry('a', 1));
    expect(store.getRecent(0)).toEqual([]);
    expect(store.getRecent(-3)).toEqual([]);
  });

  it('getRecent() with no arg returns all retained records newest-first', () => {
    const store = new EffectStore();
    store.record(entry('a', 1));
    store.record(entry('b', 2));
    expect(store.getRecent().map((e) => e.action)).toEqual(['b', 'a']);
  });

  it('enforces the ring-buffer cap, evicting the oldest', () => {
    const store = new EffectStore(3);
    store.record(entry('a', 1));
    store.record(entry('b', 2));
    store.record(entry('c', 3));
    store.record(entry('d', 4)); // evicts 'a'

    expect(store.size).toBe(3);
    expect(store.getRecent().map((e) => e.action)).toEqual(['d', 'c', 'b']);
  });

  it('default cap is 100', () => {
    const store = new EffectStore();
    for (let i = 0; i < 150; i++) store.record(entry(`a${i}`, i));
    expect(store.size).toBe(100);
    // Newest retained, oldest 50 evicted.
    expect(store.getRecent(1)[0].action).toBe('a149');
    expect(store.getRecent().some((e) => e.action === 'a49')).toBe(false);
    expect(store.getRecent().some((e) => e.action === 'a50')).toBe(true);
  });

  it('clear empties the buffer', () => {
    const store = new EffectStore();
    store.record(entry('a', 1));
    store.clear();
    expect(store.size).toBe(0);
    expect(store.getRecent()).toEqual([]);
  });

  it('a non-positive constructor cap falls back to the default (100)', () => {
    const store = new EffectStore(0);
    for (let i = 0; i < 101; i++) store.record(entry(`a${i}`, i));
    expect(store.size).toBe(100);
  });
});

describe('getGlobalEffectStore (singleton)', () => {
  beforeEach(() => {
    resetGlobalEffectStore();
  });

  it('returns the same instance across calls', () => {
    expect(getGlobalEffectStore()).toBe(getGlobalEffectStore());
  });

  it('reset replaces the instance', () => {
    const a = getGlobalEffectStore();
    resetGlobalEffectStore();
    expect(getGlobalEffectStore()).not.toBe(a);
  });

  it('set installs a provided instance', () => {
    const custom = new EffectStore();
    setGlobalEffectStore(custom);
    expect(getGlobalEffectStore()).toBe(custom);
  });
});
