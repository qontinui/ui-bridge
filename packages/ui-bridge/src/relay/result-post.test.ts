/**
 * `postResult` — a relay tab's command-result POST reads its answer.
 *
 * Before this module, `sendResponse` in `relay-client.ts` fired the POST and
 * never looked at the response: a 429, 403 or 5xx was discarded, the result
 * was lost, and the relay's pending command timed out blaming the tab. These
 * tests pin every retryable and non-retryable arm of the replacement, with an
 * injected clock so each wait is asserted to the millisecond.
 */

import { describe, it, expect } from 'vitest';
import {
  postResult,
  parseRetryAfter,
  RESULT_POST_MAX_ATTEMPTS,
  RESULT_POST_BACKOFF_MS,
  RESULT_POST_MAX_WAIT_MS,
  RESULT_POST_TOTAL_BUDGET_MS,
} from './result-post';

/** One scripted answer: an HTTP response, or a thrown network error. */
type Scripted = { status: number; body?: string; retryAfter?: string } | { networkError: true };

function fakeResponse(s: { status: number; body?: string; retryAfter?: string }): Response {
  const headers = new Headers();
  if (s.retryAfter !== undefined) headers.set('Retry-After', s.retryAfter);
  const body = s.body ?? '';
  return {
    ok: s.status >= 200 && s.status < 300,
    status: s.status,
    headers,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * A harness with a manual clock: `sleep(ms)` advances it by exactly `ms`, so
 * the POST timestamps are the waits the module chose, nothing else.
 */
function harness(script: Scripted[]) {
  let clock = Date.parse('2026-11-08T12:00:00Z');
  const postTimes: number[] = [];
  const sleeps: number[] = [];
  const errors: Array<{ message: string; error?: unknown }> = [];
  let i = 0;
  const fetchImpl = (() => {
    postTimes.push(clock);
    const s = script[Math.min(i, script.length - 1)];
    i++;
    if ('networkError' in s) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(fakeResponse(s));
  }) as unknown as typeof fetch;
  const run = () =>
    postResult(
      fetchImpl,
      '/api/ui-bridge/commands',
      { method: 'POST', body: '{}' },
      {
        onError: (message, error) => errors.push({ message, error }),
        now: () => clock,
        sleep: (ms) => {
          sleeps.push(ms);
          clock += ms;
          return Promise.resolve();
        },
      }
    );
  return { run, postTimes, sleeps, errors, startedAt: clock };
}

const rateLimited = JSON.stringify({
  success: false,
  code: 'TRANSPORT_RATE_LIMITED',
  lane: 'result',
});

describe('postResult · constants', () => {
  it('holds the D1 bounds', () => {
    expect(RESULT_POST_MAX_ATTEMPTS).toBe(3);
    expect(RESULT_POST_BACKOFF_MS).toBe(1000);
    expect(RESULT_POST_MAX_WAIT_MS).toBe(5000);
    expect(RESULT_POST_TOTAL_BUDGET_MS).toBe(6000);
  });
});

describe('postResult · retryable refusals', () => {
  it('(1) 429 Retry-After: 1 then 200 -> two POSTs, second >= 1000 ms later, no onError', async () => {
    const h = harness([{ status: 429, retryAfter: '1', body: rateLimited }, { status: 200 }]);
    await h.run();
    expect(h.postTimes).toHaveLength(2);
    expect(h.postTimes[1] - h.postTimes[0]).toBeGreaterThanOrEqual(1000);
    expect(h.sleeps).toEqual([1000]);
    expect(h.errors).toHaveLength(0);
  });

  it('(2) three 429s (no Retry-After) -> three POSTs at 0/1000/3000, then one onError naming 429, code and lane', async () => {
    const h = harness([
      { status: 429, body: rateLimited },
      { status: 429, body: rateLimited },
      { status: 429, body: rateLimited },
    ]);
    await h.run();
    expect(h.postTimes).toHaveLength(3);
    expect(h.sleeps).toEqual([1000, 2000]);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].message).toContain('429');
    expect(h.errors[0].message).toContain('TRANSPORT_RATE_LIMITED');
    expect(h.errors[0].message).toContain('lane result');
  });

  it('(6) network error then 200 -> two POSTs, no onError', async () => {
    const h = harness([{ networkError: true }, { status: 200 }]);
    await h.run();
    expect(h.postTimes).toHaveLength(2);
    expect(h.sleeps).toEqual([1000]);
    expect(h.errors).toHaveLength(0);
  });

  it('a network error on every attempt is reported exactly once', async () => {
    const h = harness([{ networkError: true }]);
    await h.run();
    expect(h.postTimes).toHaveLength(3);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].error).toBeInstanceOf(TypeError);
  });

  it('(7) 503 with Retry-After as an HTTP-date 2 s ahead -> waits 2000 ms', async () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    const h = harness([
      { status: 503, retryAfter: new Date(now + 2000).toUTCString() },
      { status: 200 },
    ]);
    await h.run();
    expect(h.sleeps).toEqual([2000]);
    expect(h.postTimes[1] - h.postTimes[0]).toBe(2000);
    expect(h.errors).toHaveLength(0);
  });

  it('(8) Retry-After: 60 then 200 -> waits exactly 5000 ms (the clamp)', async () => {
    const h = harness([{ status: 429, retryAfter: '60' }, { status: 200 }]);
    await h.run();
    expect(h.sleeps).toEqual([5000]);
    expect(h.postTimes).toHaveLength(2);
    expect(h.postTimes[1] - h.postTimes[0]).toBe(5000);
    expect(h.errors).toHaveLength(0);
  });

  it('(10) three 429s each Retry-After: 5 -> second retry not made (6000 ms budget): two POSTs, one onError', async () => {
    const h = harness([
      { status: 429, retryAfter: '5', body: rateLimited },
      { status: 429, retryAfter: '5', body: rateLimited },
      { status: 429, retryAfter: '5', body: rateLimited },
    ]);
    await h.run();
    expect(h.postTimes).toHaveLength(2);
    expect(h.sleeps).toEqual([5000]);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].message).toContain('429');
  });

  it.each([502, 504])('%i is retried', async (status) => {
    const h = harness([{ status }, { status: 200 }]);
    await h.run();
    expect(h.postTimes).toHaveLength(2);
    expect(h.errors).toHaveLength(0);
  });
});

describe('postResult · non-retryable refusals', () => {
  it('(3) 403 COMMAND_RESPONSE_REFUSED -> one POST, one onError', async () => {
    const h = harness([
      { status: 403, body: JSON.stringify({ success: false, code: 'COMMAND_RESPONSE_REFUSED' }) },
    ]);
    await h.run();
    expect(h.postTimes).toHaveLength(1);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].message).toContain('403');
    expect(h.errors[0].message).toContain('COMMAND_RESPONSE_REFUSED');
  });

  it('(4) 404 COMMAND_UNKNOWN -> one POST, one onError', async () => {
    const h = harness([
      { status: 404, body: JSON.stringify({ success: false, code: 'COMMAND_UNKNOWN' }) },
    ]);
    await h.run();
    expect(h.postTimes).toHaveLength(1);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].message).toContain('404');
    expect(h.errors[0].message).toContain('COMMAND_UNKNOWN');
  });

  it('(5) 413 -> one POST, one onError (non-JSON body tolerated)', async () => {
    const h = harness([{ status: 413, body: '<html>Payload Too Large</html>' }]);
    await h.run();
    expect(h.postTimes).toHaveLength(1);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].message).toContain('413');
  });

  it('reads the refusal code from within the first 4 KB only', async () => {
    // `code` sits past byte 4096, so a bounded read never sees it.
    const big = JSON.stringify({ pad: 'x'.repeat(5000), code: 'COMMAND_UNKNOWN' });
    const h = harness([{ status: 404, body: big }]);
    await h.run();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].message).toContain('404');
    expect(h.errors[0].message).not.toContain('COMMAND_UNKNOWN');
  });
});

describe('postResult · control', () => {
  it('(9) 200 -> one POST, no onError', async () => {
    const h = harness([{ status: 200 }]);
    await h.run();
    expect(h.postTimes).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
    expect(h.errors).toHaveLength(0);
  });

  it('never throws, even when onError throws', async () => {
    const fetchImpl = (() => Promise.reject(new Error('boom'))) as unknown as typeof fetch;
    await expect(
      postResult(
        fetchImpl,
        '/x',
        {},
        {
          onError: () => {
            throw new Error('logger broke');
          },
          now: () => 0,
          sleep: () => Promise.resolve(),
        }
      )
    ).resolves.toBeUndefined();
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('1', now)).toBe(1000);
    expect(parseRetryAfter('0', now)).toBe(0);
    expect(parseRetryAfter(' 60 ', now)).toBe(60_000);
  });
  it('reads an HTTP-date relative to now', () => {
    expect(parseRetryAfter(new Date(now + 2000).toUTCString(), now)).toBe(2000);
  });
  it('clamps a past HTTP-date to 0', () => {
    expect(parseRetryAfter(new Date(now - 5000).toUTCString(), now)).toBe(0);
  });
  it('answers null for absent or unparseable values', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter(undefined, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter('-3', now)).toBeNull();
    expect(parseRetryAfter('1.5', now)).toBeNull();
  });
});
