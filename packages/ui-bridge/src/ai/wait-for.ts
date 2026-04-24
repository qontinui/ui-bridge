/**
 * wait-for — thin client for POST /ui-bridge/ai/wait-for.
 *
 * Lets tests wait for declarative UI state instead of sleeping + re-snapshotting.
 * The server polls at ~100ms cadence and returns the moment the predicate is
 * satisfied, or times out (with `timedOut: true`). Server-side hard ceiling on
 * `timeoutMs` is 30_000.
 */

export type WaitForPredicate =
  | { type: 'textVisible'; text: string }
  | { type: 'elementVisible'; id: string }
  | { type: 'elementDisappeared'; id: string }
  | { type: 'snapshotChanged'; since: number }
  | { type: 'elementValue'; id: string; equals: string };

export interface WaitForResult {
  satisfied: boolean;
  elapsedMs: number;
  timedOut?: boolean;
  lastError?: string;
}

export interface WaitForOptions {
  /**
   * Base URL of the runner, e.g. `http://localhost:9876`. Defaults to
   * same-origin for browser callers. Required when running from Node.
   */
  baseUrl?: string;
  /** Optional fetch implementation (useful for tests). */
  fetchImpl?: typeof fetch;
  /**
   * Optional AbortSignal. If it fires before the server responds, the
   * returned promise rejects with the abort reason.
   */
  signal?: AbortSignal;
}

/**
 * Wait for `predicate` to be satisfied or until `timeoutMs` elapses.
 *
 * Returns `{ satisfied: true, elapsedMs }` on success, or
 * `{ satisfied: false, elapsedMs, timedOut: true, lastError? }` on timeout.
 *
 * @throws if the network call itself fails (non-2xx response, fetch error,
 *   abort). The timeout-without-satisfaction case is not an error — it's
 *   surfaced as `{ satisfied: false, timedOut: true }`.
 */
export async function waitFor(
  predicate: WaitForPredicate,
  timeoutMs: number,
  options: WaitForOptions = {}
): Promise<WaitForResult> {
  const { baseUrl = '', fetchImpl = fetch, signal } = options;
  const url = `${baseUrl.replace(/\/+$/, '')}/ui-bridge/ai/wait-for`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ predicate, timeoutMs }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `ai/wait-for: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`
    );
  }

  const envelope = (await response.json()) as {
    success: boolean;
    data?: WaitForResult;
    error?: string;
  };

  if (!envelope.success || !envelope.data) {
    throw new Error(`ai/wait-for: ${envelope.error ?? 'request failed'}`);
  }

  return envelope.data;
}
