import { describe, it, expect, vi } from 'vitest';
import { bindWithRetry, isAddrInUseError } from '../bind-retry';

/**
 * A fake clock + sleep so the 30s retry budget runs instantly. `sleep`
 * advances the injected clock by the requested delay and records each delay
 * so tests can assert the backoff schedule.
 */
function fakeTimers() {
  let nowMs = 0;
  const delays: number[] = [];
  return {
    now: () => nowMs,
    sleep: (ms: number) => {
      delays.push(ms);
      nowMs += ms;
      return Promise.resolve();
    },
    delays,
  };
}

const silentLogger = { warn: () => {}, error: () => {} };

function addrInUse(): Error {
  return new Error('listen EADDRINUSE: address already in use 0.0.0.0:8087');
}

describe('isAddrInUseError', () => {
  it('matches EADDRINUSE in the message', () => {
    expect(isAddrInUseError(addrInUse())).toBe(true);
  });

  it('matches the human-readable "address already in use" form', () => {
    expect(isAddrInUseError(new Error('bind: Address already in use'))).toBe(true);
  });

  it('matches a `.code` of EADDRINUSE without the message', () => {
    expect(isAddrInUseError({ code: 'EADDRINUSE' })).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isAddrInUseError(new Error('EACCES permission denied'))).toBe(false);
    expect(isAddrInUseError(undefined)).toBe(false);
  });
});

describe('bindWithRetry', () => {
  it('resolves immediately when the first attempt succeeds', async () => {
    const attempt = vi.fn().mockResolvedValue(undefined);
    await bindWithRetry(attempt, { logger: silentLogger });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries EADDRINUSE and succeeds on a later attempt', async () => {
    const t = fakeTimers();
    let calls = 0;
    const attempt = vi.fn().mockImplementation(() => {
      calls += 1;
      // Fail the first 3 attempts with EADDRINUSE, then succeed.
      return calls <= 3 ? Promise.reject(addrInUse()) : Promise.resolve();
    });

    await bindWithRetry(attempt, {
      minTotalMs: 30_000,
      logger: silentLogger,
      sleep: t.sleep,
      now: t.now,
    });

    expect(attempt).toHaveBeenCalledTimes(4);
    // Far more than the old fixed 3-retry give-up would have allowed.
    expect(calls).toBe(4);
  });

  it('keeps retrying for at least ~30s rather than giving up after 3 tries', async () => {
    const t = fakeTimers();
    // Always EADDRINUSE — count how many attempts happen before the budget
    // is exhausted. With initial 500ms / cap 5000ms backoff over 30s this is
    // well above the old maxRetries=3.
    const attempt = vi.fn().mockRejectedValue(addrInUse());

    await expect(
      bindWithRetry(attempt, {
        minTotalMs: 30_000,
        logger: silentLogger,
        sleep: t.sleep,
        now: t.now,
      })
    ).rejects.toThrow(/EADDRINUSE/);

    expect(attempt.mock.calls.length).toBeGreaterThan(3);
    // Total slept time should approach but not exceed the budget.
    const totalSlept = t.delays.reduce((a, b) => a + b, 0);
    expect(totalSlept).toBeLessThan(30_000);
  });

  it('applies exponential backoff capped at maxDelayMs', async () => {
    const t = fakeTimers();
    const attempt = vi.fn().mockRejectedValue(addrInUse());

    await expect(
      bindWithRetry(attempt, {
        minTotalMs: 30_000,
        initialDelayMs: 500,
        maxDelayMs: 5_000,
        backoffFactor: 2,
        logger: silentLogger,
        sleep: t.sleep,
        now: t.now,
      })
    ).rejects.toThrow();

    // 500, 1000, 2000, 4000, then capped at 5000...
    expect(t.delays.slice(0, 4)).toEqual([500, 1000, 2000, 4000]);
    expect(t.delays.every((d) => d <= 5_000)).toBe(true);
  });

  it('fails fast on non-EADDRINUSE errors (no retry)', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('EACCES permission denied'));
    await expect(bindWithRetry(attempt, { logger: silentLogger })).rejects.toThrow(/EACCES/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('passes the attempt index so callers can recreate the server per retry', async () => {
    const t = fakeTimers();
    const seen: number[] = [];
    let calls = 0;
    const attempt = vi.fn().mockImplementation((idx: number) => {
      seen.push(idx);
      calls += 1;
      return calls <= 2 ? Promise.reject(addrInUse()) : Promise.resolve();
    });

    await bindWithRetry(attempt, {
      minTotalMs: 30_000,
      logger: silentLogger,
      sleep: t.sleep,
      now: t.now,
    });

    expect(seen).toEqual([0, 1, 2]);
  });
});
