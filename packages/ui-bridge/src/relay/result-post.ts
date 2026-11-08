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
 *   POST: a retry whose wait would overrun the budget remaining is not made,
 *   because a result posted after the driver timed out reaches no one.
 * - Any other non-2xx (403 `COMMAND_RESPONSE_REFUSED`, 404 `COMMAND_UNKNOWN`,
 *   413, ...) is reported at once and never retried.
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

/** Read at most the first {@link REFUSAL_BODY_READ_LIMIT} bytes of a body as text. */
async function readBoundedText(resp: Response): Promise<string> {
  const reader = resp.body?.getReader?.();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < REFUSAL_BODY_READ_LIMIT) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
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
async function readRefusal(resp: Response): Promise<{ code?: string; lane?: string }> {
  try {
    const parsed: unknown = JSON.parse(await readBoundedText(resp));
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
  const report = (detail: string, attempts: number, error?: unknown) => {
    const subject = context ? ` for ${context}` : '';
    try {
      onError(
        `[UIBridge] Command result${subject} was not delivered: ${detail} after ${attempts} attempt(s)`,
        error
      );
    } catch {
      /* a broken logger must not break the relay loop */
    }
  };

  try {
    const startedAt = now();
    for (let attempt = 1; ; attempt++) {
      let waitMs: number;
      let failure: { detail: string; error?: unknown };
      try {
        const resp = await fetchImpl(url, init);
        if (resp.ok) return;
        const refusal = await readRefusal(resp);
        failure = { detail: describeRefusal(resp.status, refusal) };
        if (!RETRYABLE_STATUSES.has(resp.status)) {
          report(failure.detail, attempt);
          return;
        }
        const retryAfter = parseRetryAfter(resp.headers?.get?.('Retry-After'), now());
        waitMs = retryAfter ?? RESULT_POST_BACKOFF_MS * 2 ** (attempt - 1);
      } catch (e) {
        failure = {
          detail: `network error (${e instanceof Error ? e.message : String(e)})`,
          error: e,
        };
        waitMs = RESULT_POST_BACKOFF_MS * 2 ** (attempt - 1);
      }
      waitMs = Math.min(waitMs, RESULT_POST_MAX_WAIT_MS);
      const remaining = RESULT_POST_TOTAL_BUDGET_MS - (now() - startedAt);
      if (attempt >= RESULT_POST_MAX_ATTEMPTS || waitMs > remaining) {
        report(failure.detail, attempt, failure.error);
        return;
      }
      await sleep(waitMs);
    }
  } catch (e) {
    report('unexpected error', 0, e);
  }
}
