/**
 * The two history reads — an element's event log (`getElementHistory`) and
 * the recent predict-then-verify effect records (`getRecentEffects`) — as ONE
 * implementation each, served by the in-page command dispatcher
 * (`./commandHandlers.ts`) and by the in-process handlers
 * (`../server/handlers.ts`).
 *
 * Both stores live in the page: the registry's `ElementEventLog`
 * (`../debug/element-event-log.ts`) and the process-global effect store
 * (`../control/effect-store.ts`). The relay used to send both actions to tabs
 * that had no case for them, and `relayWithFallback` turned the throw into an
 * empty success — "cannot see" answered as "nothing there".
 *
 * Each command answers its value, or a failure the page RETURNS (never
 * throws):
 *   - a registry that keeps no element history — it has no `getElementHistory`,
 *     or it was built without an event log (`hasElementHistory() === false`) —
 *     answers the typed `UB-CAPABILITY-UNAVAILABLE` envelope
 *     (`capability_unavailable_in_build`, reason `registry_has_no_history`),
 *     never an empty list;
 *   - a payload outside the grammar answers `INVALID_REQUEST`.
 */

import type { ElementHistoryOptions, ElementLogEntry } from '../core/types';
import { getGlobalEffectStore, type EffectRecordEntry } from '../control/effect-store';

/** The registry surface `getElementHistory` reads. Both methods are optional. */
export interface ElementHistorySource {
  getElementHistory?(elementId: string, options?: ElementHistoryOptions): ElementLogEntry[];
  /** `false` when the registry was built without an element event log. */
  hasElementHistory?(): boolean;
}

/** The typed answer for a store this runtime does not keep. */
export interface HistoryCapabilityUnavailable {
  success: false;
  error: string;
  code: 'UB-CAPABILITY-UNAVAILABLE';
  data: { code: 'capability_unavailable_in_build'; reason: 'registry_has_no_history' };
}

/** A payload the history grammar refused. */
export interface HistoryPayloadRefusal {
  success: false;
  error: string;
  failureDetails: { errorCode: 'INVALID_REQUEST'; message: string; expectedPayload: string };
}

export type HistoryCommandFailure = HistoryCapabilityUnavailable | HistoryPayloadRefusal;

/** The payload shape `getElementHistory` reads. */
export const ELEMENT_HISTORY_PAYLOAD_SHAPE = '{"elementId":"<elementId>","options"?:{…}}';

/** The payload shape `getRecentEffects` reads. */
export const RECENT_EFFECTS_PAYLOAD_SHAPE = '{"limit"?:<number>}';

/** Is this command answer a returned failure? */
export function isHistoryCommandFailure(answer: unknown): answer is HistoryCommandFailure {
  return (
    answer !== null &&
    typeof answer === 'object' &&
    !Array.isArray(answer) &&
    (answer as { success?: unknown }).success === false
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function refuse(message: string, expectedPayload: string): HistoryPayloadRefusal {
  return {
    success: false,
    error: message,
    failureDetails: { errorCode: 'INVALID_REQUEST', message, expectedPayload },
  };
}

function historyUnavailable(): HistoryCapabilityUnavailable {
  return {
    success: false,
    error:
      'getElementHistory: this registry keeps no element history (it was built without an ' +
      'element event log), so an empty list would be "cannot see" read as "nothing happened".',
    code: 'UB-CAPABILITY-UNAVAILABLE',
    data: { code: 'capability_unavailable_in_build', reason: 'registry_has_no_history' },
  };
}

/**
 * `getElementHistory {elementId, options?}` — the registry's logged entries for
 * one element (`id` is accepted beside `elementId`, as every element read
 * accepts it). `options` is the registry's own {@link ElementHistoryOptions},
 * passed through.
 */
export function elementHistoryCommand(
  payload: unknown,
  registry: ElementHistorySource
): ElementLogEntry[] | HistoryCommandFailure {
  if (!isPlainObject(payload)) {
    return refuse(
      'getElementHistory: the payload must be a JSON object',
      ELEMENT_HISTORY_PAYLOAD_SHAPE
    );
  }
  const rawId = payload.elementId ?? payload.id;
  if (typeof rawId !== 'string' || rawId.length === 0) {
    return refuse(
      'getElementHistory: "elementId" must be a non-empty string',
      ELEMENT_HISTORY_PAYLOAD_SHAPE
    );
  }
  const options = payload.options;
  if (options !== undefined && !isPlainObject(options)) {
    return refuse(
      'getElementHistory: "options", when given, must be a JSON object',
      ELEMENT_HISTORY_PAYLOAD_SHAPE
    );
  }
  if (
    typeof registry.getElementHistory !== 'function' ||
    registry.hasElementHistory?.() === false
  ) {
    return historyUnavailable();
  }
  return registry.getElementHistory(rawId, options as ElementHistoryOptions | undefined);
}

/**
 * `getRecentEffects {limit?}` — the effect store's records, newest first.
 * `limit` may arrive as a string (a GET adapter passes query values as
 * strings) and is coerced; an empty or non-numeric value means "no limit",
 * as it always has.
 */
export function recentEffectsCommand(
  payload: unknown
): EffectRecordEntry[] | HistoryPayloadRefusal {
  if (payload !== undefined && payload !== null && !isPlainObject(payload)) {
    return refuse(
      'getRecentEffects: the payload must be a JSON object',
      RECENT_EFFECTS_PAYLOAD_SHAPE
    );
  }
  const rawLimit: unknown = (payload as { limit?: unknown } | null | undefined)?.limit;
  let limit: number | undefined;
  if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) {
    limit = rawLimit;
  } else if (typeof rawLimit === 'string' && rawLimit.trim() !== '') {
    const parsed = Number(rawLimit);
    if (Number.isFinite(parsed)) limit = parsed;
  }
  return getGlobalEffectStore().getRecent(limit);
}
