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
// Phase 2 (plan 2026-08-20-ui-bridge-action-declaration-shape). `param-schema`
// has NO imports, so this type-only edge to `../core` creates no module cycle
// even though `core/types.ts` imports from this barrel.
import type { ParamSchemaIssue } from '../core/param-schema';

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
 * Context map used to render `${key}` placeholders inside recovery templates.
 * Values are coerced to strings at substitution time; `undefined`/`null`
 * entries leave their placeholder untouched (treated as "unknown key").
 */
export type RecoveryRenderContext = Record<
  string,
  string | number | boolean | null | undefined
>;

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

/**
 * Substitute `${key}` placeholders in a template string from a context map.
 *
 * - Any `${key}` present (and non-nullish) in `context` is replaced with its
 *   stringified value (at minimum `${elementId}` / `${waitDurationMs}`, but
 *   any key is supported).
 * - Unknown placeholders (key absent, or value `undefined`/`null`) are left
 *   **verbatim** and nothing is logged (per Phase 3 spec).
 */
function renderTemplateString(
  template: string,
  context: RecoveryRenderContext
): string {
  if (template.indexOf('${') === -1) return template;
  return template.replace(PLACEHOLDER_RE, (whole, key: string) => {
    const value = context[key];
    if (value === undefined || value === null) return whole;
    return String(value);
  });
}

/**
 * Render a single recovery suggestion's `suggestion` and `command` strings
 * against a failure-context map, returning a fresh object (never mutates the
 * catalog entry).
 */
function renderSuggestion(
  suggestion: RecoverySuggestion,
  context: RecoveryRenderContext
): RecoverySuggestion {
  const rendered: RecoverySuggestion = {
    ...suggestion,
    suggestion: renderTemplateString(suggestion.suggestion, context),
  };
  if (suggestion.command !== undefined) {
    rendered.command = renderTemplateString(suggestion.command, context);
  }
  return rendered;
}

/**
 * Generate recovery suggestions for an error code.
 *
 * Replaces the duplicated `getRecoverySuggestions()` switch statements in
 * `server/handlers.ts` and `ui-bridge-server/handlers.ts` (D6 — one source).
 * Unknown codes fall back to the generic `UB-UNKNOWN-ERROR` template.
 *
 * When `context` is supplied, every `${key}` placeholder in each suggestion's
 * `suggestion`/`command` is substituted from it (Phase 3 — sync failure paths
 * pass `${elementId}` / `${waitDurationMs}` / etc.). Unknown placeholders are
 * left untouched. Without `context` the static catalog template is returned
 * (defensive copy).
 */
export function getRecoverySuggestions(
  errorCode: UiBridgeErrorCode,
  context?: RecoveryRenderContext
): RecoverySuggestion[] {
  const entry = DIAGNOSTICS[errorCode] ?? DIAGNOSTICS['UB-UNKNOWN-ERROR'];
  if (!context) {
    return entry.recoveryTemplate.map((r) => ({ ...r }));
  }
  return entry.recoveryTemplate.map((r) => renderSuggestion(r, context));
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
  /** Typed-reason discriminators (Phase 3) — mirror `ActionFailureDetails`. */
  disabledReason?: 'native' | 'aria' | 'pointer-none';
  visibilityReason?: 'hidden' | 'off-screen' | 'occluded' | 'no-layout';
  /**
   * `'snapshot-superseded'` is the opt-in stale-*snapshot* arm — the element
   * resolves fine, the snapshot the caller reasoned from does not. See
   * `ActionFailureDetails.staleReason`.
   */
  staleReason?: 'unmounted' | 'rerendered' | 'detached' | 'snapshot-superseded';
  waitCondition?: string;
  waitTimedOutAfterMs?: number;
  timeoutType?: 'network' | 'navigation' | 'computation';
  /**
   * Why an action was abandoned before producing a result. `'timeout'` pairs
   * with `errorCode: 'UB-ACTION-TIMEOUT'`; `'signal'` pairs with
   * `'UB-ACTION-FAILED'` and is the discriminator that stands in for a
   * dedicated caller-cancellation code. Mirrors
   * `ActionFailureDetails.cancelReason` — see it for why only one arm needs a
   * discriminator.
   */
  cancelReason?: 'signal' | 'timeout';
  /**
   * Which params failed the action's declared `paramSchema` (Phase 2). Mirrors
   * `ActionFailureDetails.invalidParams`; paired with
   * `errorCode: 'UB-ACTION-REJECTED'`.
   */
  invalidParams?: ParamSchemaIssue[];
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
    /**
     * Failure-context map for rendering `${...}` placeholders in the catalog
     * recovery templates (Phase 3). `elementId` is auto-merged in when set.
     */
    renderContext?: RecoveryRenderContext;
    /** Typed-reason discriminators (Phase 3). */
    disabledReason?: 'native' | 'aria' | 'pointer-none';
    visibilityReason?: 'hidden' | 'off-screen' | 'occluded' | 'no-layout';
    staleReason?: 'unmounted' | 'rerendered' | 'detached' | 'snapshot-superseded';
    waitCondition?: string;
    waitTimedOutAfterMs?: number;
    timeoutType?: 'network' | 'navigation' | 'computation';
    /**
     * Why an action was abandoned (Phase 3). `'timeout'` is paired with
     * `errorCode: 'UB-ACTION-TIMEOUT'`, `'signal'` with `'UB-ACTION-FAILED'` —
     * see `ActionFailureDetails.cancelReason`.
     */
    cancelReason?: 'signal' | 'timeout';
    /**
     * Which params failed the declared `paramSchema` (Phase 2). Paired with
     * `errorCode: 'UB-ACTION-REJECTED'` — see
     * `ActionFailureDetails.invalidParams`.
     */
    invalidParams?: ParamSchemaIssue[];
  } = {}
): BuiltActionFailureDetails {
  // The element id is always a valid `${elementId}` substitution source even
  // when the caller didn't pass an explicit renderContext.
  const renderContext: RecoveryRenderContext | undefined =
    options.renderContext || options.elementId !== undefined
      ? { elementId: options.elementId, ...options.renderContext }
      : undefined;

  return {
    errorCode,
    message,
    elementId: options.elementId,
    suggestedActions: getRecoverySuggestions(errorCode, renderContext),
    retryRecommended: isRetryRecommended(errorCode),
    context: options.context,
    durationMs: options.durationMs,
    timeoutMs: options.timeoutMs,
    disabledReason: options.disabledReason,
    visibilityReason: options.visibilityReason,
    staleReason: options.staleReason,
    waitCondition: options.waitCondition,
    waitTimedOutAfterMs: options.waitTimedOutAfterMs,
    timeoutType: options.timeoutType,
    cancelReason: options.cancelReason,
    invalidParams: options.invalidParams,
  };
}
