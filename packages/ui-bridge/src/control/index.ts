/**
 * UI Bridge Control Module
 *
 * HTTP control protocol and action execution.
 */

// Types
export * from './types';

// Action executor
export {
  DefaultActionExecutor,
  createActionExecutor,
  extractReactState,
  batch,
  controlBatch,
  MAX_BATCH_SIZE,
} from './action-executor';

// Forced CSS pseudo-state (`hover` / `unhover` / `hoverClick`)
export {
  forcePseudoState,
  releaseForcedPseudoState,
  releaseForcedPseudoStateIfOwner,
  getForcedPseudoState,
  snapshotForcedPseudoState,
  reapplyIfIdle,
  FORCED_PSEUDO_STATE_VERSION,
  releaseAfter,
  releaseHeldAfterDispatch,
  releasesForcedPseudoState,
  rewritePseudoSelector,
  selectorHasPseudo,
  pseudoStateAttribute,
  DEFAULT_HOLD_MS as FORCED_PSEUDO_DEFAULT_HOLD_MS,
  MAX_HOLD_MS as FORCED_PSEUDO_MAX_HOLD_MS,
  DEFAULT_SETTLE_TIMEOUT_MS as FORCED_PSEUDO_DEFAULT_SETTLE_TIMEOUT_MS,
} from './forced-hover';
export type {
  ForcedPseudoStateName,
  ForcedPseudoReleaseReason,
  ForcedPseudoReport,
  ForcedPseudoReleaseReport,
  ForcedPseudoRevealed,
  ForcedPseudoChange,
  ForcedPseudoDrift,
  ForcedPseudoSelectorDrift,
  ForcedPseudoHoldSnapshot,
  ForcedPseudoSettle,
  ForcedHoverActionReport,
  ForcedPseudoElementSource,
  ForcePseudoStateOptions,
  ForcedPseudoHoldInfo,
  ReleaseAfterOptions,
} from './forced-hover';

// Form fill utility
export { fillFormFields } from './fill-form';

// Workflow engine
export { DefaultWorkflowEngine, createWorkflowEngine } from './workflow-engine';

// D3 Effect Calculus — predict-then-verify subsystem
export type {
  EffectOutcome,
  ReversibilityKind,
  EffectCause,
  PredictedDelta,
  ObservabilityScope,
  ActionParams,
  EffectSignature,
  EffectSignatureId,
  ObservedDelta,
  EffectVerification,
} from './effect-types';
export { computeVerification } from './effect-containment';
export { DEFAULT_SETTLE_MS, FALLBACK_SETTLE_MS, settleMsForAction } from './settle-windows';
export {
  createDefaultSignatureRegistry,
  resolveSignature,
  componentSignatureId,
  normalizeDeclaredComponentSignature,
} from './effect-signatures';
export type {
  SignatureLookup,
  SignatureLookupElement,
  ComponentSignatureArms,
  DeclaredComponentSignatureSource,
  DefaultSignatureRegistryOptions,
} from './effect-signatures';
export { EffectVerifier } from './effect-verifier';
export type { EffectVerifierDeps } from './effect-verifier';
export {
  assertSignatureEffectConsistency,
  assertComponentActionEffectConsistency,
  describeSignatureDisagreement,
} from './effect-authoring';
export type { SignatureArmSummary, SignatureDisagreement } from './effect-authoring';
// D3 Effect Calculus — Phase 6: query the twin before acting.
export {
  buildComponentActionPrediction,
  unresolvedComponentActionPrediction,
  UNCLASSIFIED_CAVEAT_PREFIX,
} from './effect-predict';
export type {
  ComponentActionPrediction,
  ComponentActionPredictionInputs,
  ComponentActionPredictionStatus,
  ComponentActionPredictRequest,
  ComponentActionPredictResponse,
} from './effect-predict';
// D3 Effect Calculus — Phase 2 (settle-window attribution + effect store)
export {
  ActionWindowRegistry,
  getGlobalActionWindowRegistry,
  setGlobalActionWindowRegistry,
  resetGlobalActionWindowRegistry,
} from './action-window-registry';
export type { ActionWindow } from './action-window-registry';
export {
  EffectStore,
  getGlobalEffectStore,
  setGlobalEffectStore,
  resetGlobalEffectStore,
} from './effect-store';
export type { EffectRecordEntry } from './effect-store';
// D3 Effect Calculus — Phase 3b (workflow composition)
export { composeSignatures } from './effect-composition';
export type { CompositionStep, ComposedPrediction } from './effect-composition';
export type { WorkflowEngineOptions } from './workflow-engine';
// D3 Effect Calculus — Phase 4 (signature inference from recording history)
export {
  cooccurrenceToEffectRecords,
  inferSignatures,
  fingerprintToCriteria,
} from './effect-inference';
export type {
  EffectRecord,
  InferenceOptions,
  InferredFact,
  InferredSignatureEntry,
  InferredSignatureTable,
} from './effect-inference';
export { createInferredSignatureRegistry } from './effect-signatures';
export type { InferredRegistryOptions } from './effect-signatures';

// In-situ asset override — a dev control (plan 2026-10-13-image-generation-
// and-visual-judgment, Phase 18). Exported so an embedded host (the
// qontinui-runner's own webview hook) can serve the same engine the relay
// dispatcher does.
export {
  applyMediaOverride,
  restoreMediaOverrides,
  listMediaOverrides,
  validateMediaOverrideRequest,
  DEFAULT_OVERRIDE_TTL_MS,
  MIN_OVERRIDE_TTL_MS,
  MAX_OVERRIDE_TTL_MS,
  DEFAULT_DECODE_TIMEOUT_MS,
  MAX_DECODE_TIMEOUT_MS,
  POST_DECODE_WAIT_MS,
  MEDIA_OVERRIDE_TRANSPORT_HEADROOM_MS,
  fitMediaOverrideBudget,
} from './media-override';
export type {
  MediaOverrideRequest,
  MediaOverrideRestoreRequest,
  MediaOverrideSource,
  MediaOverrideMode,
  MediaOverrideErrorCode,
  MediaOverrideFailure,
  MediaOverrideReadiness,
  MediaOverrideTarget,
  MediaOverrideSuccess,
  MediaOverrideRestoreSuccess,
  MediaOverrideListEntry,
  MediaOverrideListSuccess,
  RestoreMismatch,
  RestoreResult,
  ValidatedMediaOverride,
} from './media-override';

// Text visibility — a dev control (same plan, Phase 16): hide every glyph for
// frame B of a text-over-image measurement, then restore exactly. Exported for
// an embedded host, as the media override is.
export {
  setTextVisibility,
  textHidden,
  validateTextVisibilityRequest,
  DEFAULT_TEXT_VISIBILITY_TTL_MS,
  MIN_TEXT_VISIBILITY_TTL_MS,
  MAX_TEXT_VISIBILITY_TTL_MS,
} from './text-visibility';
export type {
  TextVisibilityRequest,
  TextVisibilityErrorCode,
  TextVisibilityFailure,
  TextVisibilityCoverage,
  TextVisibilityHideSuccess,
  TextVisibilityShowSuccess,
  TextVisibilityRestore,
  TextVisibilityDrift,
  TextVisibilityResult,
  ValidatedTextVisibility,
} from './text-visibility';
