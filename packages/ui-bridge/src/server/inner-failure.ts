/**
 * Describe an INNER failure so it can be carried on an outer envelope.
 *
 * Several producers report a failed action by returning (not throwing) an
 * object that carries its own verdict: the browser dispatcher resolves with
 * `{ success: false, error, failureDetails }`, the executor returns an
 * `ActionResponse`, the NL executor an `NLActionResponse`, and
 * `executeWithDiff` wraps any of those as `actionResult`. Wherever such a
 * result is lifted onto an `APIResponse`, the envelope has to say `success:
 * false` and name the inner failure — otherwise every consumer that branches
 * on the envelope (all of them; it is the documented contract) is told the
 * action worked. This module is the one place that turns an inner result into
 * the envelope's `error` / `code` pair, so the relay seam and the direct
 * transport cannot drift on it.
 */

import { mapInternalErrorCode } from '../diagnostics';

/**
 * Read the human message and the envelope code off an inner result.
 *
 * `result` need not be an object: a producer that reported no verdict at all
 * still fails the envelope, and gets `fallbackMessage`.
 */
export function describeInnerFailure(
  result: unknown,
  fallbackMessage: string
): { message: string; code: string } {
  const r =
    result !== null && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  const message = typeof r.error === 'string' && r.error.length > 0 ? r.error : fallbackMessage;

  // A HOISTED `code` is a custom-action handler's OWN machine-readable code
  // (`TERMINAL_EXITED`, …), hoisted by the same rule the executor path applies.
  // It is propagated VERBATIM: the handler's vocabulary is not the SDK
  // taxonomy, so `mapInternalErrorCode` would flatten it to `UB-UNKNOWN-ERROR`
  // and the only surviving signal would be prose.
  if (typeof r.code === 'string' && r.code.length > 0) return { message, code: r.code };

  // Otherwise the code came from the SDK's own vocabulary — a hoisted
  // `errorCode`, `failureDetails.errorCode` (what `createActionFailure`
  // emits) or `failureInfo.errorCode` (`NLActionResponse`'s declared
  // structured-failure field — no producer in this package fills it today,
  // but an app-supplied NL executor may). Those DO map onto the canonical
  // `UB-*` family.
  const nestedCode = (holder: unknown): string | undefined => {
    const c = (holder as { errorCode?: unknown } | undefined)?.errorCode;
    return typeof c === 'string' && c.length > 0 ? c : undefined;
  };
  const internal = nestedCode(r) ?? nestedCode(r.failureDetails) ?? nestedCode(r.failureInfo);
  return { message, code: mapInternalErrorCode(internal, message) };
}
