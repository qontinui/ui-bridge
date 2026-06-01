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
  ObservedDelta,
  EffectVerification,
} from './effect-types';
export { computeVerification } from './effect-containment';
export { DEFAULT_SETTLE_MS, FALLBACK_SETTLE_MS, settleMsForAction } from './settle-windows';
export {
  createDefaultSignatureRegistry,
  resolveSignature,
} from './effect-signatures';
export type { SignatureLookup, SignatureLookupElement } from './effect-signatures';
export { EffectVerifier } from './effect-verifier';
export type { EffectVerifierDeps } from './effect-verifier';
export { assertSignatureEffectConsistency } from './effect-authoring';
