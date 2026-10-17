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
export type {
  CompositionStep,
  ComposedPrediction,
} from './effect-composition';
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
