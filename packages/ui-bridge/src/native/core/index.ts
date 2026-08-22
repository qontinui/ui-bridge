/**
 * UI Bridge Native - Core
 *
 * Core types and registry for React Native.
 */

export * from './types';
// Action effect defaults (plan
// 2026-08-20-ui-bridge-action-declaration-shape, Phase 4)
export * from './action-effect';
// Phases 2 and 3 ship ONE implementation of each, in `src/core/*` — the
// modules import nothing, which is exactly what lets this tree share them
// (see `core/param-schema.ts`). Re-exported here so a consumer of the
// `./native` subpath can arm param enforcement or race a handler without also
// importing the DOM-bearing web barrel.
export {
  validateActionParams,
  formatParamValidationFailure,
  DEFAULT_PARAM_VALIDATION_MODE,
  getDefaultParamValidationMode,
  setDefaultParamValidationMode,
  resetDefaultParamValidationMode,
} from '../../core/param-schema';
export type {
  ParamSchemaKeyword,
  ParamSchemaIssue,
  ParamValidationResult,
  ParamValidationMode,
} from '../../core/param-schema';
export {
  runAbortable,
  inertAbortSignal,
  normalizeActionTimeoutMs,
  MAX_ACTION_TIMEOUT_MS,
} from '../../core/abortable';
export type {
  AbortReason,
  AbortableOutcome,
  RunAbortableOptions,
  TimeoutNormalization,
} from '../../core/abortable';
export * from './registry';
export * from './element-identifier';
