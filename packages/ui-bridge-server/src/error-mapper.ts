/**
 * Error Mapper
 *
 * Maps thrown internal errors and the historical loosely-typed
 * `error(msg, 'NOT_FOUND')`-style code strings used across `handlers.ts`
 * to a canonical `UiBridgeErrorCode` so `APIResponse.code` is always a
 * stable, enumerated value (plan Phase 1 / §2.1, §2.4).
 *
 * The actual mapping table lives once in the `@qontinui/ui-bridge`
 * diagnostics barrel (`mapInternalErrorCode`) — the same source the
 * generated catalog and `relay-handlers.ts` use. This module is the
 * plan-named entry point and adds the thrown-`Error` convenience overload.
 */

import {
  mapInternalErrorCode,
  type UiBridgeErrorCode,
} from '@qontinui/ui-bridge/diagnostics';

export { mapInternalErrorCode };
export type { UiBridgeErrorCode };

/**
 * Map an internal/legacy code string (+ optional prose message) to a
 * canonical `UiBridgeErrorCode`. Re-export of the single-source mapper.
 */
export function toCanonicalErrorCode(
  internalCode?: string,
  message?: string
): UiBridgeErrorCode {
  return mapInternalErrorCode(internalCode, message);
}

/**
 * Map a thrown value to a canonical `UiBridgeErrorCode`, using its message
 * (and an optional internal code hint) as the heuristic input.
 */
export function mapThrownError(
  err: unknown,
  internalCodeHint?: string
): UiBridgeErrorCode {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  return mapInternalErrorCode(internalCodeHint, message);
}
