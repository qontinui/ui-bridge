/**
 * UI Bridge diagnostics — single source of truth.
 *
 * The code vocabulary, recovery catalog, and canonical `RecoverySuggestion`
 * shape (D6) are generated from `diagnostics/codes.json` into
 * `codes.generated.ts`. This barrel re-exports them and folds the previously
 * hand-maintained `ERROR_SUGGESTIONS` map and `getRecoverySuggestions()` switch
 * onto that single source (plan D6 / §5).
 */

export type {
  UiBridgeErrorCode,
  DiagnosticCategory,
  RecoverySuggestion,
  DiagnosticEntry,
} from './codes.generated';
export { UI_BRIDGE_ERROR_CODES, DIAGNOSTICS } from './codes.generated';

import type { UiBridgeErrorCode, RecoverySuggestion } from './codes.generated';
import { DIAGNOSTICS } from './codes.generated';

/**
 * Recovery suggestions per code, sourced from the generated catalog.
 *
 * Replaces the former hand-maintained `ERROR_SUGGESTIONS` map in
 * `ai/error-context.ts` (D6 — one source). Returns a defensive copy so callers
 * may sort/mutate without corrupting the catalog.
 */
export const ERROR_SUGGESTIONS: Record<UiBridgeErrorCode, RecoverySuggestion[]> =
  Object.fromEntries(
    (Object.keys(DIAGNOSTICS) as UiBridgeErrorCode[]).map((code) => [
      code,
      DIAGNOSTICS[code].recoveryTemplate.map((r) => ({ ...r })),
    ])
  ) as Record<UiBridgeErrorCode, RecoverySuggestion[]>;

/**
 * Generate recovery suggestions for an error code.
 *
 * Replaces the duplicated `getRecoverySuggestions()` switch statements in
 * `server/handlers.ts` and `ui-bridge-server/handlers.ts` (D6 — one source).
 * Unknown codes fall back to the generic `UB-UNKNOWN-ERROR` template.
 */
export function getRecoverySuggestions(
  errorCode: UiBridgeErrorCode
): RecoverySuggestion[] {
  const entry = DIAGNOSTICS[errorCode] ?? DIAGNOSTICS['UB-UNKNOWN-ERROR'];
  return entry.recoveryTemplate.map((r) => ({ ...r }));
}

/**
 * Error codes for which retrying the original action is recommended.
 * Derived from the catalog: a code is retry-recommended when any of its
 * recovery template entries is `retryable: true`.
 */
function isRetryRecommended(errorCode: UiBridgeErrorCode): boolean {
  const entry = DIAGNOSTICS[errorCode] ?? DIAGNOSTICS['UB-UNKNOWN-ERROR'];
  return entry.recoveryTemplate.some((r) => r.retryable);
}

/**
 * Structured-failure shape mirror of `core/types.ts` `ActionFailureDetails`.
 * Re-declared structurally here (rather than imported) to keep the
 * diagnostics barrel free of a back-edge into `core`; the field set is the
 * subset every failure surface populates.
 */
export interface BuiltActionFailureDetails {
  errorCode: UiBridgeErrorCode;
  message: string;
  elementId?: string;
  suggestedActions: RecoverySuggestion[];
  retryRecommended: boolean;
  context?: Record<string, unknown>;
  durationMs?: number;
  timeoutMs?: number;
}

/**
 * Map a loosely-typed internal/legacy error code (the historical
 * `error(msg, 'NOT_FOUND')`-style strings used across `handlers.ts` /
 * `relay-handlers.ts`) plus its prose message to a canonical
 * `UiBridgeErrorCode`.
 *
 * Single source for `ui-bridge-server/src/error-mapper.ts` and the
 * `ui-bridge` `server/relay-handlers.ts` `error()` helper (Phase 1). The
 * legacy strings are an internal SDK convention, not a public wire vocabulary
 * (no `legacy:[]` recognition surface — D1); this mapper exists only to
 * convert them at the response boundary so `APIResponse.code` is canonical.
 *
 * Resolution order: explicit code mapping → message heuristic →
 * `UB-UNKNOWN-ERROR`.
 */
const INTERNAL_CODE_TO_CANONICAL: Record<string, UiBridgeErrorCode> = {
  NOT_FOUND: 'UB-ELEM-NOT-FOUND',
  ELEMENT_NOT_FOUND: 'UB-ELEM-NOT-FOUND',
  COMPONENT_NOT_FOUND: 'UB-ELEM-NOT-FOUND',
  INVALID_REQUEST: 'UB-VALIDATION-ERROR',
  VALIDATION_ERROR: 'UB-VALIDATION-ERROR',
  NOT_IMPLEMENTED: 'UB-UNSUPPORTED-ACTION',
  RUNNER_REQUIRED: 'UB-ACTION-REJECTED',
  RUNNER_UNAVAILABLE: 'UB-NET-ERROR',
  RUNNER_ERROR: 'UB-NET-ERROR',
  COMMAND_FAILED: 'UB-ACTION-FAILED',
  HEADLESS_SPAWN_UNSUPPORTED_ON_RELAY: 'UB-UNSUPPORTED-ACTION',
  HEADLESS_SPAWN_DISABLED: 'UB-ACTION-REJECTED',
  HEADLESS_PEER_MISSING: 'UB-UNSUPPORTED-ACTION',
  HEADLESS_LAUNCH_FAILED: 'UB-ACTION-FAILED',
  WAIT_ERROR: 'UB-ACTION-TIMEOUT',
  PAGE_HEALTH_ERROR: 'UB-UNKNOWN-ERROR',
  QUERY_ERROR: 'UB-VALIDATION-ERROR',
  CDP_DISABLED: 'UB-ACTION-REJECTED',
  UNAUTHORIZED: 'UB-ACTION-REJECTED',
  INTERNAL_ERROR: 'UB-UNKNOWN-ERROR',
};

export function mapInternalErrorCode(
  internalCode?: string,
  message?: string
): UiBridgeErrorCode {
  if (internalCode) {
    // Already canonical — pass through.
    if ((DIAGNOSTICS as Record<string, unknown>)[internalCode]) {
      return internalCode as UiBridgeErrorCode;
    }
    const mapped = INTERNAL_CODE_TO_CANONICAL[internalCode];
    if (mapped) return mapped;
    // Generic `*_ERROR` convention → categorise by family below, else unknown.
    if (internalCode.endsWith('_ERROR')) {
      const m = (message ?? '').toLowerCase();
      if (m.includes('not found') || m.includes('does not exist'))
        return 'UB-ELEM-NOT-FOUND';
      if (m.includes('timeout') || m.includes('timed out'))
        return 'UB-ACTION-TIMEOUT';
      return 'UB-UNKNOWN-ERROR';
    }
  }

  const m = (message ?? '').toLowerCase();
  if (m.includes('not found') || m.includes('does not exist'))
    return 'UB-ELEM-NOT-FOUND';
  if (m.includes('not visible') || m.includes('hidden'))
    return 'UB-ELEM-NOT-VISIBLE';
  if (m.includes('disabled')) return 'UB-ELEM-DISABLED';
  if (m.includes('timeout') || m.includes('timed out'))
    return 'UB-ACTION-TIMEOUT';
  if (m.includes('required') || m.includes('invalid'))
    return 'UB-VALIDATION-ERROR';
  if (m.includes('network') || m.includes('disconnected'))
    return 'UB-NET-ERROR';

  return 'UB-UNKNOWN-ERROR';
}

/**
 * Build canonical structured failure details from an error code + prose
 * message. Single source for the `failureDetails` field added to
 * `ComponentActionResponse` / `WorkflowStepResult` in Phase 1 (and reused by
 * the server `createFailureDetails`). `suggestedActions` and
 * `retryRecommended` are both derived from the generated catalog (D6) — no
 * hand-maintained tables.
 */
export function buildActionFailureDetails(
  errorCode: UiBridgeErrorCode,
  message: string,
  options: {
    elementId?: string;
    context?: Record<string, unknown>;
    durationMs?: number;
    timeoutMs?: number;
  } = {}
): BuiltActionFailureDetails {
  return {
    errorCode,
    message,
    elementId: options.elementId,
    suggestedActions: getRecoverySuggestions(errorCode),
    retryRecommended: isRetryRecommended(errorCode),
    context: options.context,
    durationMs: options.durationMs,
    timeoutMs: options.timeoutMs,
  };
}
