/**
 * `postResult` — POST a relay command's result and READ the answer.
 *
 * The relay client used to fire the result POST and ignore the response, so a
 * 429, 403 or 5xx was discarded, the result was lost, and the relay's pending
 * command later timed out blaming a tab that had in fact responded.
 *
 * Policy (plan `2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently`, D1):
 *
 * - Retryable: 429, 502, 503, 504 and a network error (the fetch throws).
 *   Each wait is the response's `Retry-After` (delta-seconds or HTTP-date)
 *   when parseable, else `RESULT_POST_BACKOFF_MS` doubled per attempt, clamped
 *   to `RESULT_POST_MAX_WAIT_MS`. At most `RESULT_POST_MAX_ATTEMPTS` POSTs.
 * - All attempts share `RESULT_POST_TOTAL_BUDGET_MS`, measured from the first
 *   POST: a retry is not made unless its wait plus `RESULT_POST_MIN_ATTEMPT_MS`
 *   fits in the budget remaining, because a result posted after the driver
 *   timed out reaches no one and a near-zero attempt window only aborts a POST
 *   it has just sent.
 * - Any other non-2xx (403 `COMMAND_RESPONSE_REFUSED`, 404 `COMMAND_UNKNOWN`,
 *   413, ...) is reported at once and never retried.
 * - Every attempt — the POST and the read of a refusal body — is bounded by the
 *   budget remaining: an `AbortController` (combined with any caller signal)
 *   aborts it, and a fetch or body that ignores the abort is raced against the
 *   same deadline. No budget remains by construction, so a timed-out attempt
 *   is reported, never left pending. With no answer the POST may still have
 *   landed, so it is reported as `delivery unconfirmed`, never as "not
 *   delivered". A refusal whose status arrived but whose body stalled is a
 *   definite refusal, reported without a code.
 * - A result that is not delivered produces exactly ONE `onError` call, naming
 *   the HTTP status and the refusal body's `code` and `lane` when present.
 *
 * Never throws.
 */

/** Most POSTs made for one result, the first included. */
export const RESULT_POST_MAX_ATTEMPTS = 3;
/** Wait before the first retry when the answer carries no usable `Retry-After`; doubles per attempt. */
export const RESULT_POST_BACKOFF_MS = 1000;
/** Upper bound on any single wait, whatever `Retry-After` says. */
export const RESULT_POST_MAX_WAIT_MS = 5000;
/** Budget shared by every attempt for one result, measured from the first POST. */
export const RESULT_POST_TOTAL_BUDGET_MS = 6000;
/**
 * Least budget a retry must still have AFTER its wait. A retry that would
 * start with less is not made: it would abort a POST it had only just sent.
 */
export const RESULT_POST_MIN_ATTEMPT_MS = 500;

/** Bytes of a refusal body read when looking for its `code` / `lane`. */
const REFUSAL_BODY_READ_LIMIT = 4096;

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** Injected collaborators — real ones by default, fakes in tests. */
export interface PostResultOptions {
  /** Called once per undelivered result. */
  onError: (message: string, error?: unknown) => void;
  /** Clock in epoch ms. Defaults to `Date.now`. */
  now?: () => number;
  /** Wait `ms`. Defaults to a `setTimeout` promise, so fake timers drive it. */
  sleep?: (ms: number) => Promise<void>;
  /** Names the result in the report, e.g. `command abc123`. */
  context?: string;
}

/**
 * Parse a `Retry-After` header value into a wait in ms, relative to `now`.
 * Accepts delta-seconds (a non-negative integer) and an HTTP-date (a past date
 * reads as 0). Anything else — absent, empty, negative, fractional, garbage —
 * answers `null`.
 */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  // A purely numeric-looking value that failed the integer test (e.g. `-3`,
  // `1.5`) is malformed delta-seconds, not a date — `Date.parse` would accept
  // some of those as years.
  if (/^[-+]?[\d.]+$/.test(trimmed)) return null;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Read at most the first {@link REFUSAL_BODY_READ_LIMIT} bytes of a body as
 * text. An abort of `signal` cancels the reader, which ends a pending read.
 */
async function readBoundedText(resp: Response, signal: AbortSignal): Promise<string> {
  const reader = resp.body?.getReader?.();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const onAbort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      while (total < REFUSAL_BODY_READ_LIMIT) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      void reader.cancel().catch(() => {});
    }
    const joined = new Uint8Array(Math.min(total, REFUSAL_BODY_READ_LIMIT));
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= joined.length) break;
      const take = chunk.subarray(0, joined.length - offset);
      joined.set(take, offset);
      offset += take.byteLength;
    }
    return new TextDecoder().decode(joined);
  }
  if (typeof resp.text === 'function') {
    return (await resp.text()).slice(0, REFUSAL_BODY_READ_LIMIT);
  }
  return '';
}

/** The refusal's `code` and `lane`, when the (bounded) body is JSON carrying them. */
async function readRefusal(
  resp: Response,
  signal: AbortSignal
): Promise<{ code?: string; lane?: string }> {
  try {
    const parsed: unknown = JSON.parse(await readBoundedText(resp, signal));
    if (!parsed || typeof parsed !== 'object') return {};
    const top = parsed as Record<string, unknown>;
    const nested =
      top.error && typeof top.error === 'object' ? (top.error as Record<string, unknown>) : {};
    const pick = (key: string): string | undefined => {
      const v = top[key] ?? nested[key];
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    };
    return { code: pick('code'), lane: pick('lane') };
  } catch {
    return {};
  }
}

/** Raised when an attempt outlives the budget remaining. */
class AttemptDeadlineError extends Error {
  constructor(ms: number) {
    super(
      `no answer within the ${RESULT_POST_TOTAL_BUDGET_MS} ms budget (attempt bounded at ${ms} ms)`
    );
    this.name = 'AttemptDeadlineError';
  }
}

/**
 * One attempt's deadline: an `AbortController` that fires after `ms`, or when
 * the caller's own signal aborts, and a promise that rejects when it does —
 * so a fetch or body read that ignores the signal still loses the race.
 * `dispose()` clears the timer and the caller-signal listener.
 */
function attemptDeadline(ms: number, callerSignal: AbortSignal | null | undefined) {
  const controller = new AbortController();
  let rejectDeadline: (e: unknown) => void = () => {};
  const expired = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  expired.catch(() => {}); // only ever observed through a race
  const abort = (reason: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    rejectDeadline(reason);
  };
  const timer = setTimeout(() => abort(new AttemptDeadlineError(ms)), Math.max(0, ms));
  const onCallerAbort = () => abort(callerSignal?.reason ?? new Error('aborted by caller'));
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  return {
    signal: controller.signal,
    race<T>(p: Promise<T>): Promise<T> {
      return Promise.race([p, expired]);
    },
    dispose() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

function describeRefusal(status: number, refusal: { code?: string; lane?: string }): string {
  let text = `HTTP ${status}`;
  if (refusal.code) text += ` ${refusal.code}`;
  if (refusal.lane) text += ` (lane ${refusal.lane})`;
  return text;
}

/**
 * POST `init` to `url` with the retry policy above. Resolves when the result
 * was accepted (2xx) or the failure has been reported; never rejects.
 */
export async function postResult(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: PostResultOptions
): Promise<void> {
  const { onError, now = Date.now, sleep = defaultSleep, context } = options;
  const report = (detail: string, attempts: number, error?: unknown, unconfirmed = false) => {
    const subject = context ? ` for ${context}` : '';
    const verdict = unconfirmed ? 'delivery unconfirmed' : 'was not delivered';
    try {
      const tally = attempts > 0 ? ` after ${attempts} attempt(s)` : '';
      onError(`[UIBridge] Command result${subject} ${verdict}: ${detail}${tally}`, error);
    } catch {
      /* a broken logger must not break the relay loop */
    }
  };

  let attempt = 0;
  try {
    const startedAt = now();
    for (attempt = 1; ; attempt++) {
      let waitMs: number;
      let failure: { detail: string; error?: unknown; unconfirmed?: boolean };
      const deadline = attemptDeadline(
        RESULT_POST_TOTAL_BUDGET_MS - (now() - startedAt),
        init.signal
      );
      try {
        const resp = await deadline.race(fetchImpl(url, { ...init, signal: deadline.signal }));
        if (resp.ok) return;
        // The status line arrived, so this IS a refusal; a body that stalls past
        // the deadline only costs us its code.
        const refusal = await deadline
          .race(readRefusal(resp, deadline.signal))
          .catch((): { code?: string; lane?: string } => ({}));
        failure = { detail: describeRefusal(resp.status, refusal) };
        if (!RETRYABLE_STATUSES.has(resp.status)) {
          report(failure.detail, attempt);
          return;
        }
        const retryAfter = parseRetryAfter(resp.headers?.get?.('Retry-After'), now());
        waitMs = retryAfter ?? RESULT_POST_BACKOFF_MS * 2 ** (attempt - 1);
      } catch (e) {
        failure =
          e instanceof AttemptDeadlineError
            ? {
                detail: `no answer within ${RESULT_POST_TOTAL_BUDGET_MS} ms`,
                error: e,
                unconfirmed: true,
              }
            : {
                detail: `network error (${e instanceof Error ? e.message : String(e)})`,
                error: e,
              };
        waitMs = RESULT_POST_BACKOFF_MS * 2 ** (attempt - 1);
      } finally {
        deadline.dispose();
      }
      waitMs = Math.min(waitMs, RESULT_POST_MAX_WAIT_MS);
      const remaining = RESULT_POST_TOTAL_BUDGET_MS - (now() - startedAt);
      if (attempt >= RESULT_POST_MAX_ATTEMPTS || waitMs + RESULT_POST_MIN_ATTEMPT_MS > remaining) {
        report(failure.detail, attempt, failure.error, failure.unconfirmed);
        return;
      }
      await sleep(waitMs);
    }
  } catch (e) {
    report(`unexpected error (${e instanceof Error ? e.message : String(e)})`, attempt, e);
  }
}
