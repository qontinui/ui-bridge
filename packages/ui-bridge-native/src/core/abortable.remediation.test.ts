/**
 * `core/abortable.ts` — the wire-timeout policy, in the
 * `@qontinui/ui-bridge-native` copy.
 *
 * This package cannot import `@qontinui/ui-bridge` (an OPTIONAL peer), so it
 * carries a byte-level duplicate of the module. An untested duplicate drifts —
 * so the policy arms are pinned here too, against the same hand-written
 * literals. (The unhandled-rejection property is pinned in the web copy's
 * twin of this file; it needs a DOM `unhandledrejection` listener, and this
 * package's vitest runs in the node environment.)
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 3.
 *
 * Two things are covered here:
 *
 * 1. **`normalizeActionTimeoutMs` (pre-PR review #1).** `timeoutMs` became
 *    caller-controlled the moment the wire entry points started forwarding it,
 *    so it must never reach `setTimeout` unvalidated. Every arm of the
 *    documented policy is pinned against hand-written literals.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runAbortable, normalizeActionTimeoutMs, MAX_ACTION_TIMEOUT_MS } from './abortable';

describe('normalizeActionTimeoutMs — the wire-boundary policy (review #1)', () => {
  it('treats an absent value as "no timeout"', () => {
    expect(normalizeActionTimeoutMs(undefined)).toEqual({
      ok: true,
      timeoutMs: undefined,
      clamped: false,
    });
    expect(normalizeActionTimeoutMs(null)).toEqual({
      ok: true,
      timeoutMs: undefined,
      clamped: false,
    });
  });

  it('accepts zero — "do not let it run" is a coherent request', () => {
    expect(normalizeActionTimeoutMs(0)).toEqual({ ok: true, timeoutMs: 0, clamped: false });
  });

  it('accepts an ordinary positive value unchanged', () => {
    expect(normalizeActionTimeoutMs(5000)).toEqual({ ok: true, timeoutMs: 5000, clamped: false });
  });

  it('floors a fractional value — a timer cannot express sub-millisecond delay', () => {
    expect(normalizeActionTimeoutMs(1500.9)).toEqual({
      ok: true,
      timeoutMs: 1500,
      clamped: false,
    });
  });

  it('clamps anything above 24 hours, and reports that it clamped', () => {
    // 86_400_001 is one millisecond past the ceiling.
    expect(normalizeActionTimeoutMs(86_400_001)).toEqual({
      ok: true,
      timeoutMs: 86_400_000,
      clamped: true,
    });
    // The 32-bit setTimeout overflow boundary. Unclamped, this delay wraps
    // negative and the timer fires IMMEDIATELY — "wait 25 days" would abandon
    // the action on the next tick.
    expect(normalizeActionTimeoutMs(2_147_483_648)).toEqual({
      ok: true,
      timeoutMs: 86_400_000,
      clamped: true,
    });
    expect(normalizeActionTimeoutMs(Number.MAX_SAFE_INTEGER)).toEqual({
      ok: true,
      timeoutMs: 86_400_000,
      clamped: true,
    });
  });

  it('accepts exactly 24 hours without clamping', () => {
    expect(normalizeActionTimeoutMs(86_400_000)).toEqual({
      ok: true,
      timeoutMs: 86_400_000,
      clamped: false,
    });
  });

  it('the exported ceiling is 24 hours in milliseconds', () => {
    expect(MAX_ACTION_TIMEOUT_MS).toBe(86400000);
  });

  it('REFUSES a negative value rather than letting setTimeout read it as 0', () => {
    expect(normalizeActionTimeoutMs(-1)).toEqual({
      ok: false,
      reason: 'timeoutMs must not be negative, received -1',
    });
  });

  it('REFUSES NaN', () => {
    expect(normalizeActionTimeoutMs(Number.NaN)).toEqual({
      ok: false,
      reason: 'timeoutMs must be a finite number of milliseconds, received NaN',
    });
  });

  it('REFUSES Infinity and -Infinity', () => {
    expect(normalizeActionTimeoutMs(Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      reason: 'timeoutMs must be a finite number of milliseconds, received Infinity',
    });
    expect(normalizeActionTimeoutMs(Number.NEGATIVE_INFINITY)).toEqual({
      ok: false,
      reason: 'timeoutMs must be a finite number of milliseconds, received -Infinity',
    });
  });

  it('REFUSES a numeric STRING rather than coercing it', () => {
    expect(normalizeActionTimeoutMs('5000')).toEqual({
      ok: false,
      reason: 'timeoutMs must be a number of milliseconds, received "5000"',
    });
  });

  it('REFUSES other non-numeric JSON values', () => {
    expect(normalizeActionTimeoutMs(true)).toEqual({
      ok: false,
      reason: 'timeoutMs must be a number of milliseconds, received boolean',
    });
    expect(normalizeActionTimeoutMs({})).toEqual({
      ok: false,
      reason: 'timeoutMs must be a number of milliseconds, received object',
    });
    expect(normalizeActionTimeoutMs([1])).toEqual({
      ok: false,
      reason: 'timeoutMs must be a number of milliseconds, received object',
    });
  });
});

describe('runAbortable clamps at the timer too (review #1, defence in depth)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire immediately for a delay past the 32-bit setTimeout boundary', async () => {
    vi.useFakeTimers();

    let settled = false;
    const promise = runAbortable(() => new Promise<string>(() => {}), {
      timeoutMs: 2_147_483_648,
    }).then((outcome) => {
      settled = true;
      return outcome;
    });

    // Unclamped, `setTimeout(fn, 2147483648)` wraps to a negative 32-bit delay
    // and runs on the next tick. Clamped to 24h, nothing has fired here.
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(86_400_000);
    await expect(promise).resolves.toEqual({ aborted: true, reason: 'timeout' });
  });
});
