import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSettleTracker } from './settle';

describe('createSettleTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles after a quiet window once content has appeared (late SPA render)', async () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 10_000 });
    t.start();

    // Initial empty seed (pre-hydration): no countdown arms.
    t.noteSeed(0);
    vi.advanceTimersByTime(600);
    expect(t.settled).toBe(false);

    // App paints: countdown arms.
    t.noteSeed(12);
    expect(t.settled).toBe(false);
    vi.advanceTimersByTime(499);
    expect(t.settled).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.settled).toBe(true);
    expect(t.elementCount).toBe(12);
  });

  it('resets the quiet window on each content-bearing re-seed', () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 10_000 });
    t.start();

    t.noteSeed(3);
    vi.advanceTimersByTime(400);
    t.noteSeed(7); // still mutating — resets the countdown
    vi.advanceTimersByTime(400);
    expect(t.settled).toBe(false); // would have fired at 500 from the first pass
    vi.advanceTimersByTime(100);
    expect(t.settled).toBe(true);
    expect(t.elementCount).toBe(7);
  });

  it('settles at the hard timeout for a never-quiet page', () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 2_000 });
    t.start();

    // A pass every 100ms keeps resetting the quiet window forever.
    for (let elapsed = 0; elapsed < 2_000; elapsed += 100) {
      t.noteSeed(5);
      vi.advanceTimersByTime(100);
    }
    expect(t.settled).toBe(true);
  });

  it('settles at the hard timeout for a genuinely empty page', () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 2_000 });
    t.start();

    t.noteSeed(0);
    vi.advanceTimersByTime(1_999);
    expect(t.settled).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.settled).toBe(true);
    expect(t.elementCount).toBe(0);
  });

  it('whenSettled resolves immediately when already settled', async () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 10_000 });
    t.start();
    t.noteSeed(4);
    vi.advanceTimersByTime(500);
    expect(t.settled).toBe(true);

    const state = await t.whenSettled();
    expect(state).toEqual({
      settled: true,
      elementCount: 4,
      settledByTimeout: false,
      expectSatisfied: true,
    });
  });

  it('whenSettled resolves with settled:true once the quiet window elapses', async () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 10_000 });
    t.start();
    const p = t.whenSettled();
    t.noteSeed(9);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toEqual({
      settled: true,
      elementCount: 9,
      settledByTimeout: false,
      expectSatisfied: true,
    });
  });

  it('whenSettled resolves with settled:false on its own timeout', async () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 10_000 });
    t.start();
    t.noteSeed(2); // content present but caller wants a short bound
    const p = t.whenSettled(200);
    vi.advanceTimersByTime(200);
    await expect(p).resolves.toEqual({
      settled: false,
      elementCount: 2,
      settledByTimeout: false,
      expectSatisfied: true,
    });
  });

  it('start() is idempotent and dispose() clears timers', () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 1_000 });
    t.start();
    t.start(); // no second cap timer
    t.dispose();
    vi.advanceTimersByTime(5_000);
    expect(t.settled).toBe(false);
  });

  it('flags a clean (non-timeout) settle', () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 10_000 });
    t.start();
    t.noteSeed(5);
    vi.advanceTimersByTime(500);
    expect(t.settled).toBe(true);
    expect(t.settledByTimeout).toBe(false);
    expect(t.expectSatisfied).toBe(true);
  });

  it('flags a timeout settle on a genuinely empty page (expectSatisfied false)', () => {
    const t = createSettleTracker({ quietMs: 500, timeoutMs: 2_000 });
    t.start();
    t.noteSeed(0);
    vi.advanceTimersByTime(2_000);
    expect(t.settled).toBe(true);
    expect(t.settledByTimeout).toBe(true);
    expect(t.expectSatisfied).toBe(false);
  });

  describe('expected-selector gate (satisfied predicate)', () => {
    it('does NOT settle on unrelated content before the gate is satisfied', () => {
      const t = createSettleTracker({ quietMs: 500, timeoutMs: 10_000 });
      t.start();

      // Header/chrome paints (3 elements) but the expected control isn't there.
      t.noteSeed(3, false);
      vi.advanceTimersByTime(500);
      expect(t.settled).toBe(false); // unsatisfied — no countdown armed
      expect(t.elementCount).toBe(3);

      // The auth widget lazily mounts: now satisfied.
      t.noteSeed(6, true);
      vi.advanceTimersByTime(499);
      expect(t.settled).toBe(false);
      vi.advanceTimersByTime(1);
      expect(t.settled).toBe(true);
      expect(t.settledByTimeout).toBe(false);
      expect(t.expectSatisfied).toBe(true);
      expect(t.elementCount).toBe(6);
    });

    it('an unsatisfied pass cancels a pending quiet countdown', () => {
      const t = createSettleTracker({ quietMs: 500, timeoutMs: 10_000 });
      t.start();

      t.noteSeed(6, true); // gate met, countdown arms
      vi.advanceTimersByTime(300);
      t.noteSeed(2, false); // widget unmounted/swapped out — gate no longer met
      vi.advanceTimersByTime(500);
      expect(t.settled).toBe(false); // countdown was cancelled

      t.noteSeed(6, true); // remounts
      vi.advanceTimersByTime(500);
      expect(t.settled).toBe(true);
      expect(t.expectSatisfied).toBe(true);
    });

    it('settles at the cap with expectSatisfied:false when the gate never matches', () => {
      const t = createSettleTracker({ quietMs: 500, timeoutMs: 2_000 });
      t.start();

      // Content exists but never satisfies the expected-selector gate.
      for (let elapsed = 0; elapsed < 2_000; elapsed += 100) {
        t.noteSeed(4, false);
        vi.advanceTimersByTime(100);
      }
      expect(t.settled).toBe(true);
      expect(t.settledByTimeout).toBe(true);
      expect(t.expectSatisfied).toBe(false);
      expect(t.elementCount).toBe(4);
    });
  });
});
