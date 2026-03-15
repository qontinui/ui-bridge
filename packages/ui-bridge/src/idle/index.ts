/**
 * UI Bridge Idle Detection Module
 *
 * Detects when the application has "settled" after an action by combining
 * multiple signals: network requests, DOM mutations, and loading indicators.
 *
 * Each signal is independently accessible. The composite aggregates them
 * but never hides them.
 */

// Types
export type {
  IdleSignal,
  SignalStatus,
  SignalWaitOptions,
  SignalTransitionCallback,
  NetworkSignalStatus,
  PendingRequest,
  DOMSignalStatus,
  LoadingIndicatorSignalStatus,
  DetectedLoadingIndicator,
  FormMutationSignalStatus,
  FormMutationConfig,
  AnimationSignalStatus,
  DetectedAnimation,
  CompositeSignalEntry,
  CompositeIdleStatus,
  CompositeWaitOptions,
  SelectiveWaitOptions,
  WaitTarget,
  IdleEventType,
  NetworkRequestStartData,
  NetworkRequestEndData,
  NetworkIdleConfig,
  DOMSettlingConfig,
  LoadingIndicatorConfig,
  CompositeIdleConfig,
  StuckVerdict,
  StuckScreenEvidence,
  StuckScreenDiagnosis,
  StuckScreenConfig,
} from './types';

// Signal detectors
export { NetworkIdleDetector } from './network-idle';
export { DOMSettlingDetector } from './dom-settling';
export { LoadingIndicatorDetector } from './loading-indicators';
export { FormMutationDetector } from './form-mutation';

// Composite
export { CompositeIdleDetector } from './composite-idle';
export type { CompositeTransitionCallback } from './composite-idle';

// Stuck screen diagnostic
export { StuckScreenDetector } from './stuck-screen';
