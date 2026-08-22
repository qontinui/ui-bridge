/**
 * Abandonment primitive for action invocation.
 *
 * Plan `2026-08-20-ui-bridge-action-declaration-shape`, Phase 3.
 *
 * `ActionHandler`'s `options.signal` is **cooperative**: a well-behaved handler
 * observes it and returns early. Cooperation cannot be enforced, and a handler
 * that hangs is exactly the case cancellation exists for — so the executor
 * never trusts the handler to observe the signal. It races the handler promise
 * against the abort and reports the outcome either way.
 *
 * This module has **no imports**, which is what lets `src/native/*` — a tree
 * that otherwise takes no runtime dependency on `src/core/*`, because it
 * bundles for React Native — share the one implementation instead of growing a
 * fourth copy of it. `AbortController` is present in both environments.
 */

/** Which of the two cancellation sources fired. */
export type AbortReason = 'signal' | 'timeout';

/**
 * Result of {@link runAbortable}. Discriminated on `aborted` so the caller
 * cannot read `result` off an abandoned invocation.
 */
export type AbortableOutcome<T> =
  | { aborted: false; result: T }
  | { aborted: true; reason: AbortReason };

/** Cancellation sources composed by {@link runAbortable}. */
export interface RunAbortableOptions {
  /**
   * An in-process caller's signal. Cannot cross the wire — that is what
   * `timeoutMs` is for.
   */
  signal?: AbortSignal;
  /**
   * Milliseconds after which the invocation is abandoned. Serializable, so
   * this is the arm an HTTP/WebSocket caller can actually use. A negative or
   * non-numeric value is ignored (no timeout).
   */
  timeoutMs?: number;
}

/**
 * Invoke `invoke` with a derived `AbortSignal`, abandoning it if either the
 * caller's signal aborts or `timeoutMs` elapses.
 *
 * - Returns `{ aborted: true, reason }` **without invoking at all** when the
 *   caller's signal is already aborted.
 * - Returns `{ aborted: false, result }` on normal completion.
 * - **Rejects** if `invoke` throws/rejects while the race is still live, so a
 *   genuine handler error stays distinguishable from a cancellation.
 * - A rejection that arrives *after* an abort already won is swallowed:
 *   `Promise.race` has a rejection handler attached, so the abandoned handler
 *   cannot surface as an unhandled rejection.
 */
export async function runAbortable<T>(
  invoke: (signal: AbortSignal) => T | Promise<T>,
  options: RunAbortableOptions = {}
): Promise<AbortableOutcome<T>> {
  const callerSignal = options.signal;
  const timeoutMs = options.timeoutMs;

  if (callerSignal?.aborted) {
    return { aborted: true, reason: 'signal' };
  }

  const controller = new AbortController();
  // Set before `controller.abort()` in both arms, so the abort listener reads
  // the reason that actually fired.
  let reason: AbortReason = 'signal';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onCallerAbort = (): void => {
    reason = 'signal';
    controller.abort();
  };

  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs >= 0) {
    timer = setTimeout(() => {
      reason = 'timeout';
      controller.abort();
    }, timeoutMs);
  }

  try {
    const abandoned = new Promise<AbortableOutcome<T>>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve({ aborted: true, reason }), {
        once: true,
      });
    });

    const completed = (async (): Promise<AbortableOutcome<T>> => ({
      aborted: false,
      result: await invoke(controller.signal),
    }))();

    return await Promise.race([completed, abandoned]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}
