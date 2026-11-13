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
  MAX_UNANCHORED_WINDOW_MS,
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
    const h = reg.beginAction('r1', 'click', 1000);
    expect(reg.isWithinAnyWindow(999)).toBe(false);
    expect(reg.isWithinAnyWindow(1000)).toBe(true);
    expect(reg.isWithinAnyWindow(20_000)).toBe(true); // action still running
    reg.recordConcurrentObservation(1400); // past start + a click band, mid-action
    expect(reg.hadConcurrentObservation(h)).toBe(true);
    expect(reg.hadConcurrentObservation('r1')).toBe(true); // requestId lookup
  });

  it('an un-anchored window is bounded: it matches up to the bound and is pruned after it', () => {
    // Pinned clock: the action opened at 1000 and never returned (no anchor,
    // no end). It must not hold a window open for the rest of the process.
    const h = reg.beginAction('stuck', 'click', 1000);
    const bound = 1000 + MAX_UNANCHORED_WINDOW_MS;
    expect(reg.isWithinAnyWindow(bound - 1)).toBe(true);
    expect(reg.isWithinAnyWindow(bound)).toBe(true); // inclusive
    reg.recordConcurrentObservation(bound - 1);
    expect(reg.isWithinAnyWindow(bound + 1)).toBe(false);
    expect(reg.openCount).toBe(0); // pruned, not just masked
    expect(reg.isWithinAnyWindow(bound + 1_000_000)).toBe(false);
    // The pruned window's flag is still readable, and a late end() is a no-op.
    expect(reg.hadConcurrentObservation(h)).toBe(true);
    expect(() => reg.end(h)).not.toThrow();
  });

  it('beginAction honours an explicit maxOpenMs', () => {
    reg.beginAction('r1', 'click', 1000, 500);
    expect(reg.isWithinAnyWindow(1500)).toBe(true);
    reg.recordConcurrentObservation(1501);
    expect(reg.hadConcurrentObservation('r1')).toBe(false);
    expect(reg.openCount).toBe(0);
  });

  it('anchorSettle lifts the un-anchored bound', () => {
    const h = reg.beginAction('r1', 'click', 1000, 500);
    reg.anchorSettle(h, 1400, 1000); // settle ends at 2400, past the 1500 bound
    expect(reg.isWithinAnyWindow(2400)).toBe(true);
    expect(reg.isWithinAnyWindow(2401)).toBe(false);
  });

  it('overlapping beginAction calls sharing a requestId keep separate windows and flags', () => {
    const first = reg.beginAction('dup', 'click', 1000);
    const second = reg.beginAction('dup', 'type', 2000);
    expect(first).not.toBe(second);
    expect(reg.openCount).toBe(2);
    reg.anchorSettle(first, 1100, 100); // [1000, 1200]
    reg.anchorSettle(second, 2100, 100); // [2000, 2200]
    reg.recordConcurrentObservation(1150); // inside the first only
    expect(reg.hadConcurrentObservation(first)).toBe(true);
    expect(reg.hadConcurrentObservation(second)).toBe(false);
    reg.end(first);
    expect(reg.openCount).toBe(1);
    expect(reg.isWithinAnyWindow(2150)).toBe(true); // second still open
    reg.end(second);
    expect(reg.hadConcurrentObservation(first)).toBe(true);
    expect(reg.hadConcurrentObservation(second)).toBe(false);
  });

  it('anchorSettle sets endMs = settleStart + settleMs, keeping startMs', () => {
    const h = reg.beginAction('r1', 'click', 1000);
    reg.anchorSettle(h, 1600, 150);
    expect(reg.isWithinAnyWindow(1000)).toBe(true); // start unchanged
    expect(reg.isWithinAnyWindow(1750)).toBe(true); // inclusive end
    expect(reg.isWithinAnyWindow(1751)).toBe(false);
    reg.recordConcurrentObservation(1751);
    expect(reg.hadConcurrentObservation(h)).toBe(false);
  });

  it('anchorSettle ignores an unknown handle', () => {
    const h = reg.beginAction('r1', 'click', 1000);
    reg.anchorSettle(h + 1000, 5000, 150);
    expect(reg.openCount).toBe(1);
    expect(reg.isWithinAnyWindow(9000)).toBe(true);
  });

  it('end closes the window', () => {
    const h = reg.begin('r1', 'click', 1000, 500);
    reg.end(h);
    expect(reg.openCount).toBe(0);
    expect(reg.isWithinAnyWindow(1200)).toBe(false);
  });

  it('end is a no-op for an unknown handle', () => {
    expect(() => reg.end(12345)).not.toThrow();
    expect(reg.hadConcurrentObservation(12345)).toBe(false);
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
    const h = reg.begin('r1', 'click', 1000, 500);
    reg.recordConcurrentObservation(1100);
    reg.end(h);
    // The window is closed, but the captured flag survives in the
    // recently-ended map so the verifier can read it right after ending.
    expect(reg.openCount).toBe(0);
    expect(reg.hadConcurrentObservation(h)).toBe(true);
    expect(reg.hadConcurrentObservation('r1')).toBe(true);
  });

  it('hadConcurrentObservation returns false after end() when no concurrency occurred', () => {
    const h = reg.begin('r1', 'click', 1000, 500);
    reg.end(h);
    expect(reg.hadConcurrentObservation(h)).toBe(false);
    expect(reg.hadConcurrentObservation('r1')).toBe(false);
  });

  it('isWithinAnyWindow is true if ANY of several open windows contains atMs', () => {
    reg.begin('a', 'click', 1000, 100); // [1000, 1100]
    reg.begin('b', 'type', 2000, 100); // [2000, 2100]
    expect(reg.isWithinAnyWindow(2050)).toBe(true);
    expect(reg.isWithinAnyWindow(1500)).toBe(false);
  });

  it('a duplicate begin opens a second window; the requestId lookup reads the newest', () => {
    const first = reg.begin('r1', 'click', 1000, 100);
    reg.recordConcurrentObservation(1050);
    const second = reg.begin('r1', 'click', 5000, 100);
    expect(reg.openCount).toBe(2);
    expect(reg.hadConcurrentObservation(first)).toBe(true);
    expect(reg.hadConcurrentObservation(second)).toBe(false);
    expect(reg.hadConcurrentObservation('r1')).toBe(false);
  });

  it('the recently-ended map is bounded (older flags evicted past the cap)', () => {
    // Cap is 50: end 60 flagged windows, then the oldest 10 must have dropped.
    for (let i = 0; i < 60; i++) {
      const id = `r${i}`;
      const h = reg.begin(id, 'click', 1000, 100);
      reg.recordConcurrentObservation(1050);
      reg.end(h);
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
