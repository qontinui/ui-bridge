/**
 * Classify the outcome of a UI Bridge action for a CLI's error channel.
 *
 * WHY THIS EXISTS
 *
 * The in-page dispatcher reserves `throw` for a handful of cases (an unknown
 * action id, mostly) and *returns* a structured failure for everything a
 * caller actually hits — a missing element, an invisible one, a disabled one.
 * `createActionFailure` (packages/ui-bridge/src/react/commandHandlers.ts)
 * builds that envelope:
 *
 *     { success: false, error: "Element x not found",
 *       failureDetails: { errorCode: "ELEMENT_NOT_FOUND", ... } }
 *
 * and `InjectedContext.execute` hands it back verbatim
 * (src/transports/injected.ts). So a CLI that keys failure off `catch` alone
 * prints that object as a *result* and exits 0: the caller reads the documented
 * error channel, sees nothing, and reports a clean run for a page the action
 * never changed. Measured on 0.7.1 — `ui-bridge-inject --exec
 * 'executeElementAction {"id":"no-such-element",...}'` printed the
 * ELEMENT_NOT_FOUND envelope under `result` and exited 0. A consumer that
 * scripts a click and then snapshots gets a successful-looking run in which the
 * click never happened.
 *
 * This module is the one place that answers "did that action actually do what
 * it was asked?", so every bin gives the same answer. It invents no envelope:
 * `{ success: false, error, failureDetails }` is already the repo-wide shape
 * for a returned failure, and `{ code, message }` is already what the CLIs put
 * on their `error` key for a thrown one.
 */

import { WrapperTransportError } from './types.js';

/**
 * The CLI-level error envelope written to an output line's `error` key.
 *
 * `details` carries the handler's own structured diagnostics UNFLATTENED — the
 * whole `failureDetails` object for a returned failure, `WrapperTransportError.details`
 * for a thrown one — so a caller can still branch on `ELEMENT_NOT_FOUND` vs
 * `ELEMENT_NOT_VISIBLE` vs `ELEMENT_NOT_ENABLED`, read `retryRecommended`, or
 * follow `suggestedActions` instead of parsing a message string.
 */
export interface CliActionError {
  /** Machine-readable code — `failureDetails.errorCode` where the handler set one. */
  code: string;
  message: string;
  /** How the failure reached us: the handler returned it, or it was thrown. */
  source: 'returned' | 'thrown';
  /** The handler's structured diagnostics, verbatim. Omitted when there are none. */
  details?: unknown;
}

/** Fallback code for a returned failure that named none of its own. */
export const RETURNED_FAILURE_CODE = 'ACTION_FAILED';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * True when `result` is a handler result that reports its own failure.
 *
 * The predicate is deliberately narrow — an explicit `success === false` — so
 * it cannot misread a result that merely *lacks* a `success` field (a control
 * snapshot, a find result, an element state) as a failure. That is the same
 * signal every returned-failure site in the SDK sets; see the ~190 `success:
 * false` returns across packages/ui-bridge/src.
 */
export function isReturnedFailure(result: unknown): boolean {
  return isRecord(result) && result.success === false;
}

/**
 * Map a *returned* failure onto the CLI error envelope, or `null` when the
 * result is not a failure at all (the overwhelmingly common case — this runs on
 * every successful action too, so it stays cheap and total).
 *
 * `action` is used only to build a last-resort message for a handler that
 * returned `{ success: false }` and nothing else.
 */
export function returnedFailureError(action: string, result: unknown): CliActionError | null {
  if (!isReturnedFailure(result)) return null;
  const r = result as Record<string, unknown>;

  const failureDetails = isRecord(r.failureDetails) ? r.failureDetails : null;
  // `error` is a string on the `createActionFailure` envelope and an object on
  // the `CommandResponse` envelope (`{ code, message }`). Both are in the tree.
  const errorObj = isRecord(r.error) ? r.error : null;

  const code =
    nonEmptyString(failureDetails?.errorCode) ??
    nonEmptyString(errorObj?.code) ??
    RETURNED_FAILURE_CODE;

  const message =
    nonEmptyString(r.error) ??
    nonEmptyString(errorObj?.message) ??
    nonEmptyString(failureDetails?.message) ??
    `action '${action}' reported success: false`;

  const details = failureDetails ?? errorObj ?? undefined;

  const out: CliActionError = { code, message, source: 'returned' };
  if (details !== undefined) out.details = details;
  return out;
}

/** Map a *thrown* error onto the same envelope. */
export function thrownError(err: unknown): CliActionError {
  if (err instanceof WrapperTransportError) {
    const out: CliActionError = { code: err.code, message: err.message, source: 'thrown' };
    // WrapperTransportError already carries structured diagnostics for some
    // codes (e.g. INJECTED_EXPECT_SELECTOR_UNMET). They used to be dropped on
    // the floor here; pass them through on the same key as a returned failure's.
    if (err.details !== undefined) out.details = err.details;
    return out;
  }
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : String(err),
    source: 'thrown',
  };
}
