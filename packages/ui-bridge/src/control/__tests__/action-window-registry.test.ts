/**
 * Tests for the D3 Effect Calculus Action Window Registry (Phase 2).
 *
 * Covers begin / end / isWithinAnyWindow / recordConcurrentObservation /
 * hadConcurrentObservation — including the "read the flag right after end()"
 * case that the bounded recently-ended map exists to support, plus the global
 * singleton accessor.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ActionWindowRegistry,
  getGlobalActionWindowRegistry,
  setGlobalActionWindowRegistry,
  resetGlobalActionWindowRegistry,
} from '../action-window-registry';

describe('ActionWindowRegistry', () => {
  let reg: ActionWindowRegistry;

  beforeEach(() => {
    reg = new ActionWindowRegistry();
  });

  it('begin opens a window with endMs = nowMs + settleMs', () => {
    reg.begin('r1', 'click', 1000, 500);
    expect(reg.openCount).toBe(1);
    expect(reg.isWithinAnyWindow(1000)).toBe(true);
    expect(reg.isWithinAnyWindow(1500)).toBe(true); // inclusive upper bound
    expect(reg.isWithinAnyWindow(1501)).toBe(false);
    expect(reg.isWithinAnyWindow(999)).toBe(false);
  });

  it('beginAction opens a window with no end until anchorSettle fixes it', () => {
    reg.beginAction('r1', 'click', 1000);
    expect(reg.isWithinAnyWindow(999)).toBe(false);
    expect(reg.isWithinAnyWindow(1000)).toBe(true);
    expect(reg.isWithinAnyWindow(1_000_000)).toBe(true); // action still running
    reg.recordConcurrentObservation(1400); // past start + a click band, mid-action
    expect(reg.hadConcurrentObservation('r1')).toBe(true);
  });

  it('anchorSettle sets endMs = settleStart + settleMs, keeping startMs', () => {
    reg.beginAction('r1', 'click', 1000);
    reg.anchorSettle('r1', 1600, 150);
    expect(reg.isWithinAnyWindow(1000)).toBe(true); // start unchanged
    expect(reg.isWithinAnyWindow(1750)).toBe(true); // inclusive end
    expect(reg.isWithinAnyWindow(1751)).toBe(false);
    reg.recordConcurrentObservation(1751);
    expect(reg.hadConcurrentObservation('r1')).toBe(false);
  });

  it('anchorSettle ignores an unknown id', () => {
    reg.beginAction('r1', 'click', 1000);
    reg.anchorSettle('nope', 5000, 150);
    expect(reg.openCount).toBe(1);
    expect(reg.isWithinAnyWindow(9000)).toBe(true);
  });

  it('end closes the window', () => {
    reg.begin('r1', 'click', 1000, 500);
    reg.end('r1');
    expect(reg.openCount).toBe(0);
    expect(reg.isWithinAnyWindow(1200)).toBe(false);
  });

  it('end is a no-op for an unknown requestId', () => {
    expect(() => reg.end('nope')).not.toThrow();
    expect(reg.hadConcurrentObservation('nope')).toBe(false);
  });

  it('recordConcurrentObservation flags only windows whose interval contains atMs', () => {
    reg.begin('inside', 'click', 1000, 500); // [1000, 1500]
    reg.begin('outside', 'type', 3000, 500); // [3000, 3500]

    reg.recordConcurrentObservation(1200);

    expect(reg.hadConcurrentObservation('inside')).toBe(true);
    expect(reg.hadConcurrentObservation('outside')).toBe(false);
  });

  it('hadConcurrentObservation reads the flag from a STILL-OPEN window', () => {
    reg.begin('r1', 'click', 1000, 500);
    expect(reg.hadConcurrentObservation('r1')).toBe(false);
    reg.recordConcurrentObservation(1100);
    expect(reg.hadConcurrentObservation('r1')).toBe(true);
  });

  it('hadConcurrentObservation still returns the right value AFTER end()', () => {
    reg.begin('r1', 'click', 1000, 500);
    reg.recordConcurrentObservation(1100);
    reg.end('r1');
    // The window is closed, but the captured flag survives in the
    // recently-ended map so the verifier can read it right after ending.
    expect(reg.openCount).toBe(0);
    expect(reg.hadConcurrentObservation('r1')).toBe(true);
  });

  it('hadConcurrentObservation returns false after end() when no concurrency occurred', () => {
    reg.begin('r1', 'click', 1000, 500);
    reg.end('r1');
    expect(reg.hadConcurrentObservation('r1')).toBe(false);
  });

  it('isWithinAnyWindow is true if ANY of several open windows contains atMs', () => {
    reg.begin('a', 'click', 1000, 100); // [1000, 1100]
    reg.begin('b', 'type', 2000, 100); // [2000, 2100]
    expect(reg.isWithinAnyWindow(2050)).toBe(true);
    expect(reg.isWithinAnyWindow(1500)).toBe(false);
  });

  it('a duplicate begin overwrites the prior open window for that id', () => {
    reg.begin('r1', 'click', 1000, 100);
    reg.recordConcurrentObservation(1050);
    expect(reg.hadConcurrentObservation('r1')).toBe(true);
    // Re-begin resets the flag.
    reg.begin('r1', 'click', 5000, 100);
    expect(reg.hadConcurrentObservation('r1')).toBe(false);
    expect(reg.openCount).toBe(1);
  });

  it('the recently-ended map is bounded (older flags evicted past the cap)', () => {
    // Cap is 50: end 60 flagged windows, then the oldest 10 must have dropped.
    for (let i = 0; i < 60; i++) {
      const id = `r${i}`;
      reg.begin(id, 'click', 1000, 100);
      reg.recordConcurrentObservation(1050);
      reg.end(id);
    }
    // Newest 50 retained.
    expect(reg.hadConcurrentObservation('r59')).toBe(true);
    expect(reg.hadConcurrentObservation('r10')).toBe(true);
    // Oldest 10 evicted → fall back to false.
    expect(reg.hadConcurrentObservation('r0')).toBe(false);
    expect(reg.hadConcurrentObservation('r9')).toBe(false);
  });
});

describe('getGlobalActionWindowRegistry (singleton)', () => {
  beforeEach(() => {
    resetGlobalActionWindowRegistry();
  });

  it('returns the same instance across calls', () => {
    const a = getGlobalActionWindowRegistry();
    const b = getGlobalActionWindowRegistry();
    expect(a).toBe(b);
  });

  it('reset replaces the instance', () => {
    const a = getGlobalActionWindowRegistry();
    resetGlobalActionWindowRegistry();
    const b = getGlobalActionWindowRegistry();
    expect(a).not.toBe(b);
  });

  it('set installs a provided instance', () => {
    const custom = new ActionWindowRegistry();
    setGlobalActionWindowRegistry(custom);
    expect(getGlobalActionWindowRegistry()).toBe(custom);
  });
});
