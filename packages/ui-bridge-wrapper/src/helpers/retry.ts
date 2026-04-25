/**
 * `withRetry`
 *
 * Exponential-backoff retry helper. Transports surface retryable errors
 * with `err.retryable === true` (see `WrapperTransportError`); wrappers
 * can pass their own predicate via `shouldRetry` when the default
 * retry-every-error behavior is too aggressive.
 *
 * Defaults: 3 attempts, 200 ms base, doubling delay (200 / 400 / 800).
 */

import { WrapperTransportError } from '../types.js';

export interface WithRetryOptions {
  /** Total attempt count, including the first call. Defaults to 3. */
  attempts?: number;
  /** Base delay in ms. Defaults to 200. Doubles between attempts. */
  baseMs?: number;
  /** Max cap on any single backoff wait. Defaults to 5 000 ms. */
  maxDelayMs?: number;
  /**
   * Predicate that decides whether to retry a given error. Defaults to
   * `err.retryable === true` for `WrapperTransportError`, `true`
   * otherwise (network/unknown errors are presumed transient).
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Sleep implementation hook — defaults to `setTimeout`. Overridden in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultShouldRetry = (err: unknown): boolean => {
  if (err instanceof WrapperTransportError) {
    return err.retryable;
  }
  return true;
};

export async function withRetry<T>(fn: () => Promise<T>, opts: WithRetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = Math.max(0, opts.baseMs ?? 200);
  const cap = Math.max(base, opts.maxDelayMs ?? 5_000);
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const delay = Math.min(cap, base * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
  // Unreachable — loop either returns or throws — but TS can't prove it.
  throw lastErr;
}
