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
 * DUPLICATE OF `@qontinui/ui-bridge` `src/core/abortable.ts` — DELIBERATELY NOT
 * AN IMPORT. `@qontinui/ui-bridge` is an OPTIONAL peerDependency of this
 * package and is absent from `dependencies`, so a consumer may install
 * `@qontinui/ui-bridge-native` alone; importing from it would resolve inside
 * this monorepo and then fail for that consumer. See the same note on
 * `core/types.ts` `ActionHandler`.
 *
 * KEEP IN SYNC with `@qontinui/ui-bridge` `src/core/abortable.ts` — including
 * `MAX_ACTION_TIMEOUT_MS` and `normalizeActionTimeoutMs` below. The module has
 * no imports and touches no DOM API — only `AbortController` and `setTimeout`,
 * both present in React Native.
 */

/** Which of the two cancellation sources fired. */
export type AbortReason = 'signal' | 'timeout';

/**
 * Ceiling applied to a caller-supplied `timeoutMs` — **24 hours**.
 *
 * `ComponentActionRequest.timeoutMs` crosses the wire, so it is attacker- (or
 * typo-) controlled: an HTTP or WebSocket caller can put any JSON number in
 * it and it would otherwise land in `setTimeout` unchecked. Two concrete
 * hazards that ceiling closes:
 *
 * - **`setTimeout`'s 32-bit delay overflow.** Any delay above 2147483647ms
 *   wraps to a *negative* 32-bit int in every major runtime and the timer
 *   fires **immediately** — so `timeoutMs: 2147483648` ("about 25 days,
 *   effectively no timeout") would abandon the action on the next tick, the
 *   exact opposite of what the caller asked for. Clamping below that boundary
 *   makes the semantics monotonic: a bigger number never means a shorter wait.
 * - **A pinned timer per in-flight request.** Nothing here is unbounded work,
 *   but a 100-year timeout is indistinguishable from "no timeout" while still
 *   holding the handler's abandonment machinery alive, so there is nothing to
 *   buy above a day.
 *
 * Clamping (rather than rejecting) is right at the top end because the intent
 * is unambiguous — "effectively forever" — and the clamped value honours it as
 * closely as the platform can. The malformed cases below are rejected instead,
 * because there the intent is NOT recoverable.
 */
export const MAX_ACTION_TIMEOUT_MS = 86_400_000;

/**
 * Outcome of {@link normalizeActionTimeoutMs}. Discriminated on `ok` so a
 * rejected value cannot be read as a timeout by accident.
 */
export type TimeoutNormalization =
  | {
      ok: true;
      /** `undefined` ≡ no timeout. Always a finite integer in `[0, MAX]`. */
      timeoutMs: number | undefined;
      /** True iff the caller's value was above {@link MAX_ACTION_TIMEOUT_MS}. */
      clamped: boolean;
    }
  | { ok: false; reason: string };

/**
 * Validate and clamp a wire-supplied `timeoutMs` before it can reach a timer.
 *
 * The policy, stated once so all three executors share it:
 *
 * | Supplied | Result | Why |
 * |---|---|---|
 * | absent / `null` | no timeout | the documented "omitted ⇒ no timeout" default |
 * | `0` | abandon on the next tick | a coherent request ("don't let it run"), and what `setTimeout(…, 0)` already means |
 * | `1 … MAX` | honoured, floored to an integer | fractional ms is not a thing a timer can express |
 * | `> MAX` | clamped to {@link MAX_ACTION_TIMEOUT_MS} | see that constant — above 2^31-1 the platform timer silently inverts |
 * | negative | **rejected** | `setTimeout` would treat it as `0`, i.e. a sign typo would abandon every call instantly and silently |
 * | `NaN` / `±Infinity` | **rejected** | `setTimeout(NaN)` is `setTimeout(0)` — same silent-instant-abandon trap |
 * | not a number (`"5000"`, `{}`, `true`) | **rejected** | JSON has numbers; a string here means the caller built the body wrong, and coercing would hide it |
 *
 * Rejection is loud on purpose: every rejected case is one where *ignoring*
 * the field fails open (the action runs uncancellable) and *coercing* it fails
 * closed at zero. Neither is what the caller asked for, and both are silent —
 * which is the defect class this whole plan exists to remove.
 */
export function normalizeActionTimeoutMs(raw: unknown): TimeoutNormalization {
  if (raw === undefined || raw === null) {
    return { ok: true, timeoutMs: undefined, clamped: false };
  }
  if (typeof raw !== 'number') {
    return {
      ok: false,
      reason: `timeoutMs must be a number of milliseconds, received ${typeof raw === 'string' ? JSON.stringify(raw) : typeof raw}`,
    };
  }
  if (!Number.isFinite(raw)) {
    return {
      ok: false,
      reason: `timeoutMs must be a finite number of milliseconds, received ${String(raw)}`,
    };
  }
  if (raw < 0) {
    return {
      ok: false,
      reason: `timeoutMs must not be negative, received ${String(raw)}`,
    };
  }
  if (raw > MAX_ACTION_TIMEOUT_MS) {
    return { ok: true, timeoutMs: MAX_ACTION_TIMEOUT_MS, clamped: true };
  }
  return { ok: true, timeoutMs: Math.floor(raw), clamped: false };
}

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
   * this is the arm an HTTP/WebSocket caller can actually use.
   *
   * Expected to have been through {@link normalizeActionTimeoutMs} already —
   * every executor seam runs it, because this value arrives from the wire.
   * The `Number.isFinite` / `>= 0` guard below is defence in depth for a
   * direct in-process caller, and ignores anything malformed rather than
   * letting it reach `setTimeout`.
   */
  timeoutMs?: number;
}

/**
 * A fresh `AbortSignal` that is never aborted.
 *
 * `ActionHandlerOptions` promises the bag is *always* supplied, so a handler
 * written the way the docs describe — `(params, { signal }) => …` — must never
 * be called with `undefined` as its second argument. Not every invocation seam
 * has a cancellation source to give it though: an ELEMENT custom action
 * (`ControlActionRequest`) carries no `timeoutMs` and the executor holds no
 * controller for it, so there is nothing that could ever abort. Those seams
 * pass this instead of `undefined`, which keeps the destructure safe and keeps
 * `signal.aborted` honestly `false`.
 *
 * **Fresh per call, deliberately.** A shared singleton would accumulate one
 * listener per handler that calls `signal.addEventListener('abort', …)` and
 * never releases them — a leak on a hot path. A `AbortController` allocation
 * is a few bytes and custom element actions are not a hot path.
 *
 * When element actions grow a cancellation source, replace the call sites with
 * a real `runAbortable` race — the handler contract does not change.
 */
export function inertAbortSignal(): AbortSignal {
  return new AbortController().signal;
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
    // The clamp is applied AGAIN here, at the only place a delay actually
    // reaches a timer. `normalizeActionTimeoutMs` already did it for every
    // wire path, but a direct in-process caller reaches `runAbortable`
    // without passing through an executor — and above 2^31-1 `setTimeout`
    // wraps negative and fires immediately, turning "wait a century" into
    // "abandon now". See MAX_ACTION_TIMEOUT_MS.
    timer = setTimeout(
      () => {
        reason = 'timeout';
        controller.abort();
      },
      Math.min(timeoutMs, MAX_ACTION_TIMEOUT_MS)
    );
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
