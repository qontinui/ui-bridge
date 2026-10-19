/**
 * The media override's time budget, in a module with no DOM or React imports so
 * a Node-side transport (the relay's handlers) can fit a request to its own
 * command timeout without loading the engine. See `media-override.ts`,
 * "TRANSPORT BUDGETS".
 */

export const DEFAULT_DECODE_TIMEOUT_MS = 10_000;
export const MAX_DECODE_TIMEOUT_MS = 60_000;
/**
 * Bound on each step an apply takes AFTER its decode wait: measuring the
 * candidate's pixels on success, or verifying the rollback on failure. A
 * caller's transport budget must keep this much headroom above
 * `decodeTimeoutMs` (the qontinui-runner keeps 2 s).
 */
export const POST_DECODE_WAIT_MS = 1_000;
/**
 * What a transport keeps between its own command timeout and the media
 * override's waits: {@link POST_DECODE_WAIT_MS} plus the reply's trip.
 */
export const MEDIA_OVERRIDE_TRANSPORT_HEADROOM_MS = 2_000;

/**
 * Fit an apply's `decodeTimeoutMs` (or a restore's `verifyTimeoutMs`) inside a
 * transport whose command timeout is `budgetMs`, so the typed result — a
 * `DECODE_TIMEOUT` with its rollback, an unverified restore — always arrives
 * before the transport gives up. An absent wait is filled with one that fits;
 * a numeric one that does not fit is refused, naming the budget. Anything
 * else is passed through for the engine's own validation to answer.
 */
export function fitMediaOverrideBudget(
  kind: 'apply' | 'restore',
  raw: unknown,
  budgetMs: number
): { ok: true; payload: unknown } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: true, payload: raw ?? {} };
  }
  const field = kind === 'apply' ? 'decodeTimeoutMs' : 'verifyTimeoutMs';
  const ceiling = Math.max(1, budgetMs - MEDIA_OVERRIDE_TRANSPORT_HEADROOM_MS);
  const value = (raw as Record<string, unknown>)[field];
  if (value === undefined) {
    return {
      ok: true,
      payload: { ...raw, [field]: Math.min(DEFAULT_DECODE_TIMEOUT_MS, ceiling) },
    };
  }
  if (typeof value === 'number' && value > ceiling) {
    return {
      ok: false,
      error:
        `${field} ${value} would outlive this transport's ${budgetMs} ms command timeout ` +
        `(at most ${ceiling} ms leaves room for the typed result to reach you); lower it, ` +
        `or raise the transport's timeout`,
    };
  }
  return { ok: true, payload: raw };
}
