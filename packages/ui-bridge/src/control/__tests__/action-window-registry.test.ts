/**
 * Tests for the D3 Effect Calculus Action Window Registry (Phase 2).
 *
 * Covers beginAction / anchorSettle / end / isWithinAnyWindow /
 * recordConcurrentObservation / hadConcurrentObservation(ForRequest) —
 * including the "read the flag right after end()" case that the bounded
 * recently-ended map exists to support, the un-anchored bound and its
 * expiry, plus the global singleton accessor.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ActionWindowRegistry,
  MAX_UNANCHORED_WINDOW_MS,
  UNANCHORED_WINDOW_TIMEOUT_MARGIN_MS,
  unanchoredBoundForTimeout,
  getGlobalActionWindowRegistry,
  setGlobalActionWindowRegistry,
  resetGlobalActionWindowRegistry,
} from '../action-window-registry';

describe('ActionWindowRegistry', () => {
  let reg: ActionWindowRegistry;

  beforeEach(() => {
    reg = new ActionWindowRegistry();
  });

  /** Open a window at `startMs` and anchor its settle at once: [startMs, startMs + settleMs]. */
  function settled(requestId: string, startMs: number, settleMs: number) {
    const h = reg.beginAction(requestId, 'click', startMs);
    expect(reg.anchorSettle(h, startMs, settleMs)).toBe(true);
    return h;
  }

  it('an anchored window spans [start, settleStart + settleMs], inclusive', () => {
    settled('r1', 1000, 500);
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
    expect(reg.hadConcurrentObservationForRequest('r1')).toBe(true);
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
    expect(reg.hadConcurrentObservationForRequest('r1')).toBe(false);
    expect(reg.openCount).toBe(0);
  });

  it('anchorSettle lifts the un-anchored bound', () => {
    const h = reg.beginAction('r1', 'click', 1000, 500);
    expect(reg.anchorSettle(h, 1400, 1000)).toBe(true); // settle ends at 2400, past the 1500 bound
    expect(reg.isWithinAnyWindow(2400)).toBe(true);
    expect(reg.isWithinAnyWindow(2401)).toBe(false);
  });

  it('anchorSettle past the un-anchored bound reports the expiry and closes the window', () => {
    // Nothing touched the registry between the bound and the anchor, so the
    // window was not pruned yet — the anchor itself must still refuse it.
    const h = reg.beginAction('r1', 'click', 1000, 500);
    reg.recordConcurrentObservation(1200); // seen before the bound
    expect(reg.anchorSettle(h, 1501, 150)).toBe(false);
    expect(reg.openCount).toBe(0);
    expect(reg.isWithinAnyWindow(1550)).toBe(false); // the bound was not lifted
    expect(reg.hadConcurrentObservation(h)).toBe(true); // the flag survives
  });

  it('anchorSettle on an already-pruned handle reports the expiry', () => {
    const h = reg.beginAction('r1', 'click', 1000, 500);
    reg.recordConcurrentObservation(2000); // prunes it
    expect(reg.openCount).toBe(0);
    expect(reg.anchorSettle(h, 2100, 150)).toBe(false);
    expect(reg.hadConcurrentObservation(h)).toBe(false);
  });

  it('unanchoredBoundForTimeout: the floor without a timeout, timeout + margin above it', () => {
    expect(unanchoredBoundForTimeout(undefined)).toBe(MAX_UNANCHORED_WINDOW_MS);
    expect(unanchoredBoundForTimeout(1_000)).toBe(MAX_UNANCHORED_WINDOW_MS);
    expect(unanchoredBoundForTimeout(120_000)).toBe(120_000 + UNANCHORED_WINDOW_TIMEOUT_MARGIN_MS);
  });

  it('a window bounded by a long timeout keeps matching past the default bound', () => {
    // A 60 s action with a 120 s timeout: still running at 60 s, its window
    // must still be open there.
    const h = reg.beginAction('long', 'open', 1000, unanchoredBoundForTimeout(120_000));
    reg.recordConcurrentObservation(1000 + 60_000);
    expect(reg.openCount).toBe(1);
    expect(reg.anchorSettle(h, 1000 + 60_000, 150)).toBe(true);
    expect(reg.hadConcurrentObservation(h)).toBe(true);
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

  it('anchorSettle returns false for a handle this registry has not issued', () => {
    reg.beginAction('r1', 'click', 1000); // handle 1
    const other = new ActionWindowRegistry();
    other.beginAction('x', 'click', 0); // 1
    const unissued = other.beginAction('y', 'click', 0); // 2: `reg` has issued only 1
    expect(reg.anchorSettle(unissued, 5000, 150)).toBe(false);
    expect(reg.openCount).toBe(1);
    expect(reg.isWithinAnyWindow(9000)).toBe(true); // r1 still un-anchored and open
  });

  it('handles are per-registry numbers: a colliding foreign handle addresses this registry', () => {
    // Documented behaviour, not a guarantee of origin: both registries number
    // from 1, so another registry's first handle IS `reg`'s first handle.
    const own = reg.beginAction('r1', 'click', 1000);
    const foreign = new ActionWindowRegistry().beginAction('x', 'click', 0);
    expect(foreign).toBe(own);
    expect(reg.anchorSettle(foreign, 1600, 150)).toBe(true);
    expect(reg.isWithinAnyWindow(1751)).toBe(false); // r1 was anchored to [1000, 1750]
    expect(reg.isWithinAnyWindow(1750)).toBe(true);
  });

  it('end closes the window', () => {
    const h = settled('r1', 1000, 500);
    reg.end(h);
    expect(reg.openCount).toBe(0);
    expect(reg.isWithinAnyWindow(1200)).toBe(false);
  });

  it('end is a no-op for an unknown handle', () => {
    const foreign = new ActionWindowRegistry().beginAction('x', 'click', 0);
    expect(() => reg.end(foreign)).not.toThrow();
    expect(reg.hadConcurrentObservation(foreign)).toBe(false);
    expect(reg.hadConcurrentObservationForRequest('nope')).toBe(false);
  });

  it('recordConcurrentObservation flags only windows whose interval contains atMs', () => {
    const inside = settled('inside', 1000, 500); // [1000, 1500]
    const outside = settled('outside', 3000, 500); // [3000, 3500]

    reg.recordConcurrentObservation(1200);

    expect(reg.hadConcurrentObservation(inside)).toBe(true);
    expect(reg.hadConcurrentObservation(outside)).toBe(false);
    expect(reg.hadConcurrentObservationForRequest('inside')).toBe(true);
    expect(reg.hadConcurrentObservationForRequest('outside')).toBe(false);
  });

  it('hadConcurrentObservation reads the flag from a STILL-OPEN window', () => {
    const h = settled('r1', 1000, 500);
    expect(reg.hadConcurrentObservation(h)).toBe(false);
    reg.recordConcurrentObservation(1100);
    expect(reg.hadConcurrentObservation(h)).toBe(true);
  });

  it('hadConcurrentObservation still returns the right value AFTER end()', () => {
    const h = settled('r1', 1000, 500);
    reg.recordConcurrentObservation(1100);
    reg.end(h);
    // The window is closed, but the captured flag survives in the
    // recently-ended map so the verifier can read it right after ending.
    expect(reg.openCount).toBe(0);
    expect(reg.hadConcurrentObservation(h)).toBe(true);
    expect(reg.hadConcurrentObservationForRequest('r1')).toBe(true);
  });

  it('hadConcurrentObservation returns false after end() when no concurrency occurred', () => {
    const h = settled('r1', 1000, 500);
    reg.end(h);
    expect(reg.hadConcurrentObservation(h)).toBe(false);
    expect(reg.hadConcurrentObservationForRequest('r1')).toBe(false);
  });

  it('isWithinAnyWindow is true if ANY of several open windows contains atMs', () => {
    settled('a', 1000, 100); // [1000, 1100]
    settled('b', 2000, 100); // [2000, 2100]
    expect(reg.isWithinAnyWindow(2050)).toBe(true);
    expect(reg.isWithinAnyWindow(1500)).toBe(false);
  });

  it('a duplicate requestId opens a second window; the requestId lookup reads the newest', () => {
    const first = settled('r1', 1000, 100);
    reg.recordConcurrentObservation(1050);
    const second = settled('r1', 5000, 100);
    expect(reg.openCount).toBe(2);
    expect(reg.hadConcurrentObservation(first)).toBe(true);
    expect(reg.hadConcurrentObservation(second)).toBe(false);
    expect(reg.hadConcurrentObservationForRequest('r1')).toBe(false);
  });

  it('the recently-ended map is bounded (older flags evicted past the cap)', () => {
    // Cap is 50: end 60 flagged windows, then the oldest 10 must have dropped.
    for (let i = 0; i < 60; i++) {
      const h = settled(`r${i}`, 1000, 100);
      reg.recordConcurrentObservation(1050);
      reg.end(h);
    }
    // Newest 50 retained.
    expect(reg.hadConcurrentObservationForRequest('r59')).toBe(true);
    expect(reg.hadConcurrentObservationForRequest('r10')).toBe(true);
    // Oldest 10 evicted → fall back to false.
    expect(reg.hadConcurrentObservationForRequest('r0')).toBe(false);
    expect(reg.hadConcurrentObservationForRequest('r9')).toBe(false);
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
