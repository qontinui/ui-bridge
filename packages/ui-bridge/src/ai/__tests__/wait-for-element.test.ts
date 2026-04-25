/**
 * wait-for-element tests (M1).
 *
 * Covers:
 *   - Predicate evaluator: every state branch + edge cases.
 *   - HTTP client: envelope unwrap, timeout-not-error semantics.
 *   - Poll loop: synchronous-hit, mid-wait predicate flip, timeout, absent-throughout.
 *   - Validation helper: missing id+selector / invalid state / out-of-range.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  evaluateElementPredicate,
  validateWaitForElementRequest,
  pollWaitForElement,
  waitForElement,
  type ElementSnapshot,
  type WaitForElementState,
} from '../wait-for-element';

// ---------------------------------------------------------------------------
// Predicate evaluator — pure logic
// ---------------------------------------------------------------------------

function snap(partial: Partial<ElementSnapshot>): ElementSnapshot {
  return { registered: false, state: null, ...partial };
}

const baseRect = { x: 0, y: 0, width: 100, height: 30, top: 0, right: 100, bottom: 30, left: 0 };

describe('evaluateElementPredicate', () => {
  describe('present', () => {
    it('false when not registered', () => {
      expect(evaluateElementPredicate(snap({ registered: false }), 'present')).toBe(false);
    });
    it('true when registered with rect', () => {
      const s = snap({ registered: true, state: { rect: baseRect } });
      expect(evaluateElementPredicate(s, 'present')).toBe(true);
    });
    it('false when registered but state has no rect', () => {
      const s = snap({ registered: true, state: { visible: true } });
      expect(evaluateElementPredicate(s, 'present')).toBe(false);
    });
  });

  describe('visible', () => {
    it('false when visible !== true', () => {
      const s = snap({ registered: true, state: { visible: false, rect: baseRect } });
      expect(evaluateElementPredicate(s, 'visible')).toBe(false);
    });
    it('false when rect has zero area', () => {
      const s = snap({
        registered: true,
        state: { visible: true, rect: { ...baseRect, width: 0, height: 0 } },
      });
      expect(evaluateElementPredicate(s, 'visible')).toBe(false);
    });
    it('true when visible + rect has area', () => {
      const s = snap({ registered: true, state: { visible: true, rect: baseRect } });
      expect(evaluateElementPredicate(s, 'visible')).toBe(true);
    });
  });

  describe('enabled / disabled', () => {
    it('enabled: true when enabled !== false', () => {
      expect(
        evaluateElementPredicate(snap({ registered: true, state: { enabled: true } }), 'enabled')
      ).toBe(true);
      // No `enabled` field at all → treated as enabled.
      expect(evaluateElementPredicate(snap({ registered: true, state: {} }), 'enabled')).toBe(true);
    });
    it('enabled: false when enabled === false', () => {
      expect(
        evaluateElementPredicate(snap({ registered: true, state: { enabled: false } }), 'enabled')
      ).toBe(false);
    });
    it('disabled: only true when enabled === false', () => {
      expect(
        evaluateElementPredicate(snap({ registered: true, state: { enabled: false } }), 'disabled')
      ).toBe(true);
      expect(
        evaluateElementPredicate(snap({ registered: true, state: { enabled: true } }), 'disabled')
      ).toBe(false);
      expect(evaluateElementPredicate(snap({ registered: true, state: {} }), 'disabled')).toBe(
        false
      );
    });
  });

  describe('value-not-empty / value-empty', () => {
    it('value-not-empty: true for non-empty string value', () => {
      const s = snap({ registered: true, state: { value: 'hello' } });
      expect(evaluateElementPredicate(s, 'value-not-empty')).toBe(true);
    });
    it('value-not-empty: true for checked === true even without value', () => {
      const s = snap({ registered: true, state: { checked: true } });
      expect(evaluateElementPredicate(s, 'value-not-empty')).toBe(true);
    });
    it('value-not-empty: false for empty string', () => {
      const s = snap({ registered: true, state: { value: '' } });
      expect(evaluateElementPredicate(s, 'value-not-empty')).toBe(false);
    });
    it('value-empty: true when value missing', () => {
      const s = snap({ registered: true, state: {} });
      expect(evaluateElementPredicate(s, 'value-empty')).toBe(true);
    });
    it('value-empty: true when value is empty string', () => {
      const s = snap({ registered: true, state: { value: '' } });
      expect(evaluateElementPredicate(s, 'value-empty')).toBe(true);
    });
    it('value-empty: false when value present', () => {
      const s = snap({ registered: true, state: { value: 'x' } });
      expect(evaluateElementPredicate(s, 'value-empty')).toBe(false);
    });
  });

  describe('checked / unchecked', () => {
    it('checked: only true for checked === true', () => {
      expect(
        evaluateElementPredicate(snap({ registered: true, state: { checked: true } }), 'checked')
      ).toBe(true);
      expect(
        evaluateElementPredicate(snap({ registered: true, state: { checked: false } }), 'checked')
      ).toBe(false);
      expect(evaluateElementPredicate(snap({ registered: true, state: {} }), 'checked')).toBe(
        false
      );
    });
    it('unchecked: true for checked === false OR missing', () => {
      expect(
        evaluateElementPredicate(snap({ registered: true, state: { checked: false } }), 'unchecked')
      ).toBe(true);
      expect(evaluateElementPredicate(snap({ registered: true, state: {} }), 'unchecked')).toBe(
        true
      );
      expect(
        evaluateElementPredicate(snap({ registered: true, state: { checked: true } }), 'unchecked')
      ).toBe(false);
    });
  });

  describe('absent', () => {
    it('true when not registered', () => {
      expect(evaluateElementPredicate(snap({ registered: false }), 'absent')).toBe(true);
    });
    it('true when registered but visible === false', () => {
      const s = snap({ registered: true, state: { visible: false, rect: baseRect } });
      expect(evaluateElementPredicate(s, 'absent')).toBe(true);
    });
    it('false when registered + visible', () => {
      const s = snap({ registered: true, state: { visible: true, rect: baseRect } });
      expect(evaluateElementPredicate(s, 'absent')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Poll loop — exercises the deterministic `now`/`schedule` injections.
// ---------------------------------------------------------------------------

describe('pollWaitForElement', () => {
  // Synthetic clock so we can advance time without touching real timers.
  function makeClock() {
    let t = 0;
    const queue: Array<{ at: number; cb: () => void }> = [];
    const now = () => t;
    const schedule = (cb: () => void, ms: number) => {
      queue.push({ at: t + ms, cb });
    };
    const advanceTo = async (target: number) => {
      while (true) {
        const next = queue.filter((q) => q.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        const idx = queue.indexOf(next);
        queue.splice(idx, 1);
        t = next.at;
        next.cb();
        // Yield so resolved promises in `tick` chain.
        await Promise.resolve();
      }
      t = target;
    };
    return { now, schedule, advanceTo };
  }

  it('value-not-empty: synchronous hit when input already has a value', async () => {
    const clock = makeClock();
    const promise = pollWaitForElement({
      takeSnapshot: () => snap({ registered: true, state: { value: 'hello' } }),
      predicate: 'value-not-empty',
      timeoutMs: 5000,
      pollMs: 50,
      now: clock.now,
      schedule: clock.schedule,
    });
    const outcome = await promise;
    expect(outcome.found).toBe(true);
    expect(outcome.durationMs).toBe(0);
  });

  it('visible: starts hidden, flips after a few polls', async () => {
    const clock = makeClock();
    const states: Partial<ElementSnapshot['state']>[] = [
      { visible: false, rect: baseRect },
      { visible: false, rect: baseRect },
      { visible: true, rect: baseRect }, // 3rd poll: hit
    ];
    let i = 0;
    const promise = pollWaitForElement({
      takeSnapshot: (): ElementSnapshot => {
        const state = states[Math.min(i, states.length - 1)] ?? null;
        i++;
        return { registered: true, state };
      },
      predicate: 'visible',
      timeoutMs: 1000,
      pollMs: 50,
      now: clock.now,
      schedule: clock.schedule,
    });
    // Initial sync tick happens at t=0 → miss, schedules at 50.
    // 50 → miss, schedules at 100.
    // 100 → hit.
    await clock.advanceTo(150);
    const outcome = await promise;
    expect(outcome.found).toBe(true);
    expect(outcome.durationMs).toBe(100);
    expect(outcome.observed?.state?.visible).toBe(true);
  });

  it('absent: starts present, becomes absent', async () => {
    const clock = makeClock();
    let registered = true;
    const promise = pollWaitForElement({
      takeSnapshot: (): ElementSnapshot => ({
        registered,
        state: registered ? { visible: true, rect: baseRect } : null,
      }),
      predicate: 'absent',
      timeoutMs: 1000,
      pollMs: 50,
      now: clock.now,
      schedule: clock.schedule,
    });
    // Drop after first sync tick.
    setTimeout(() => {
      registered = false;
    }, 0);
    await Promise.resolve();
    registered = false; // simulate removal between sync tick and first scheduled tick
    await clock.advanceTo(100);
    const outcome = await promise;
    expect(outcome.found).toBe(true);
  });

  it('timeout: predicate never satisfied → found:false, lastObservedState preserved', async () => {
    const clock = makeClock();
    const promise = pollWaitForElement({
      takeSnapshot: (): ElementSnapshot => ({
        registered: true,
        state: { value: '' },
      }),
      predicate: 'value-not-empty',
      timeoutMs: 200,
      pollMs: 50,
      now: clock.now,
      schedule: clock.schedule,
    });
    await clock.advanceTo(250);
    const outcome = await promise;
    expect(outcome.found).toBe(false);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(200);
    expect(outcome.observed).not.toBeNull();
    expect(outcome.observed?.registered).toBe(true);
  });

  it('absent throughout: lastObserved stays null', async () => {
    const clock = makeClock();
    const promise = pollWaitForElement({
      takeSnapshot: (): ElementSnapshot => ({ registered: false, state: null }),
      predicate: 'visible',
      timeoutMs: 100,
      pollMs: 50,
      now: clock.now,
      schedule: clock.schedule,
    });
    await clock.advanceTo(200);
    const outcome = await promise;
    expect(outcome.found).toBe(false);
    expect(outcome.observed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

describe('waitForElement (HTTP client)', () => {
  it('found:true → returns success payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        success: true,
        data: {
          found: true,
          durationMs: 47,
          finalState: {
            id: 'input-foo',
            registered: true,
            fromRegistry: true,
            state: { value: 'hi' },
          },
        },
      }),
    });
    const result = await waitForElement(
      { elementId: 'input-foo', state: 'value-not-empty' },
      { baseUrl: 'http://localhost:9876', fetchImpl: fetchImpl as typeof fetch }
    );
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.durationMs).toBe(47);
    }
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9876/ui-bridge/ai/wait-for-element');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ elementId: 'input-foo', state: 'value-not-empty' });
  });

  it('found:false on timeout is NOT thrown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        success: true,
        data: { found: false, durationMs: 5000, lastObservedState: null },
      }),
    });
    const result = await waitForElement(
      { elementId: 'never-shows', state: 'visible', timeoutMs: 5000 },
      { fetchImpl: fetchImpl as typeof fetch }
    );
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.durationMs).toBe(5000);
      expect(result.lastObservedState).toBeNull();
    }
  });

  it('throws on non-2xx response (validation rejection)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => "wait-for-element: invalid state 'bogus'",
      json: async () => ({ success: false, error: 'invalid' }),
    });
    await expect(
      waitForElement(
        { elementId: 'x', state: 'bogus' as WaitForElementState },
        { fetchImpl: fetchImpl as typeof fetch }
      )
    ).rejects.toThrow(/HTTP 400/);
  });
});

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

describe('validateWaitForElementRequest', () => {
  it('rejects when neither elementId nor selector provided', () => {
    expect(validateWaitForElementRequest({ state: 'visible' })).toMatch(/elementId.*selector/);
  });

  it('accepts elementId-only and selector-only', () => {
    expect(validateWaitForElementRequest({ elementId: 'a', state: 'present' })).toBeNull();
    expect(validateWaitForElementRequest({ selector: '#a', state: 'present' })).toBeNull();
  });

  it('rejects missing state', () => {
    expect(validateWaitForElementRequest({ elementId: 'a' })).toMatch(/'state' is required/);
  });

  it('rejects invalid state', () => {
    expect(validateWaitForElementRequest({ elementId: 'a', state: 'bogus' })).toMatch(
      /invalid state/
    );
  });

  it('rejects timeoutMs out of range', () => {
    expect(
      validateWaitForElementRequest({ elementId: 'a', state: 'present', timeoutMs: 30001 })
    ).toMatch(/0 and 30000/);
    expect(
      validateWaitForElementRequest({ elementId: 'a', state: 'present', timeoutMs: -1 })
    ).toMatch(/0 and 30000/);
  });

  it('rejects pollMs < 10', () => {
    expect(validateWaitForElementRequest({ elementId: 'a', state: 'present', pollMs: 5 })).toMatch(
      />= 10/
    );
  });

  it('accepts boundary values', () => {
    expect(
      validateWaitForElementRequest({
        elementId: 'a',
        state: 'present',
        timeoutMs: 30000,
        pollMs: 10,
      })
    ).toBeNull();
  });
});
