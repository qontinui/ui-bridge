/**
 * UI Bridge Core Module
 *
 * Exports all core types and WebSocket client.
 */

// Export all types
export * from './types';

// Action-invocation abandonment primitive (plan
// 2026-08-20-ui-bridge-action-declaration-shape, Phase 3)
export {
  runAbortable,
  inertAbortSignal,
  normalizeActionTimeoutMs,
  MAX_ACTION_TIMEOUT_MS,
} from './abortable';
export type {
  AbortReason,
  AbortableOutcome,
  RunAbortableOptions,
  TimeoutNormalization,
} from './abortable';

// Parameter-schema validation (plan
// 2026-08-20-ui-bridge-action-declaration-shape, Phase 2)
export {
  validateActionParams,
  formatParamValidationFailure,
  DEFAULT_PARAM_VALIDATION_MODE,
  getDefaultParamValidationMode,
  setDefaultParamValidationMode,
  resetDefaultParamValidationMode,
} from './param-schema';
// The TYPES are re-exported by `./types` (which `export *`s above), the same
// way `UiBridgeErrorCode` is — re-exporting them here too would be a duplicate
// export.

// Action effect defaults (plan
// 2026-08-20-ui-bridge-action-declaration-shape, Phase 4). `IREffect` itself
// is declared in `./types` and comes through the `export *` above.
export {
  STANDARD_ACTION_EFFECTS,
  standardActionEffect,
  resolveActionEffect,
} from './action-effect';

// Chainable query DSL
export { UIQuery } from './query-builder';
export type { QueryResult } from './query-builder';

// Recency model for snapshot freshness control
export { Recency, isSatisfiedBy, requiresFetch, mightRequireFetch, parseRecency } from './recency';
export type { Recency as RecencyType } from './recency';

// Push-based change observation
export { ChangeObserver } from './change-observer';
export type { ChangeObserverConfig, DOMChangeEvent } from './change-observer';

// Registry singleton accessor
export {
  UIBridgeRegistry,
  getGlobalRegistry,
  serializeRegisteredElement,
  measureFreshBbox,
  DEFAULT_REMOUNT_CACHE_WINDOW_MS,
} from './registry';

// Element fingerprinting for state discovery
export {
  computeElementFingerprint,
  computeAllFingerprints,
  computeFingerprintsWithMapping,
  findNearestRegisteredElement,
} from './element-fingerprint';
export type { ElementFingerprintData, RepeatPatternData } from './element-fingerprint';

// Stable element references across React re-renders
export { createStableRef, resolveStableRef } from './stable-ref';
export type { StableElementRef, StableRefResolution, ResolveStableRefOptions } from './stable-ref';

// Snapshot identity — the cross-language FNV-1a-64 fold that gives every
// `BridgeSnapshot` a content-addressed id, plus the two comparison predicates
// (`unchanged` / `remounted`) the id was designed to answer on its own.
export {
  computeSnapshotSignature,
  computeMountFold,
  computeSnapshotIdentity,
  formatSnapshotId,
  parseSnapshotId,
  snapshotUnchangedFrom,
  snapshotRemountedFrom,
  generationComparable,
  evaluateSnapshotFreshness,
  supersededSnapshotMessage,
  SNAPSHOT_ID_PREFIX,
} from './snapshot-signature';
export type {
  SnapshotSignature,
  SnapshotIdentity,
  SignatureElementLike,
  SnapshotFreshness,
  SnapshotFreshnessVerdict,
  SnapshotFreshnessArm,
  SnapshotFreshnessBlindSpot,
  SnapshotFreshnessWorld,
} from './snapshot-signature';

// Resolution stability — the ONE ordinal vocabulary both element-resolution
// chains report in. Ordinal class labels, NOT calibrated probabilities.
export {
  scoreResolution,
  buildElementResolution,
  ELEMENT_RESOLUTION_RANK,
  ELEMENT_RESOLUTION_CLASS,
} from './resolution-score';
export type {
  ElementResolution,
  ElementResolutionCandidate,
  ElementResolutionStrategy,
  ResolutionStabilityClass,
} from './resolution-score';

// Structured NL-disambiguation query — rank elements by metadata without
// pixel inspection. Replaces the VLM-for-disambiguation path.
export { findElements } from './find';
export type { FindableElement, ElementQuery, ElementMatch } from './find';

// Canonical find/discover filter — the ONE FindRequest filter implementation
// shared by the React command handlers, direct server handlers, and relay
// handlers. Do not re-implement find filtering anywhere else.
export { applyCanonicalFindFilter, INTERACTIVE_ELEMENT_TYPES } from './find-filter';
export type { CanonicalFindCriteria, FindFilterableElement } from './find-filter';

// WebSocket client (web-specific)
export { UIBridgeWSClient, createWSClient } from './websocket-client';

// SVG-safe className helpers — always use instead of `.className.split(...)`.
export { classString, classList } from './class-name';

// Code-point-safe truncation — always use instead of `.slice(0, n)` /
// `.substring(0, n)` on user text. A raw slice splits surrogate pairs, and the
// resulting lone surrogate makes the whole JSON response unparseable for a
// strict-UTF-8 consumer such as the Rust runner.
export { truncateCodePoints } from './text';

// Shared keyboard-event primitives — the ONE key-name grammar and dispatch
// loop behind the element-scoped `sendKeys` action and the document-scoped
// `sendKeysToPage` page primitive. Do not hand-roll KeyboardEvent dispatch.
export {
  NON_PRINTABLE_KEYS,
  keyToCode,
  // Legacy `keyCode`/`which`/`charCode` derivation plus the ONE synthetic
  // `KeyboardEventInit` builder. Exported for the same reason as the dispatch
  // targets below: an out-of-repo consumer must not hand-roll an init that
  // omits the legacy fields and silently reaches no handler.
  keyToKeyCode,
  buildKeyboardEventInit,
  normalizeKeyDescriptors,
  dispatchKeySequence,
  // The ONE dispatch-target vocabulary. Exported so an out-of-repo consumer —
  // notably the runner's `POST /ui-bridge/control/key` handler — can adopt the
  // same targets, the same `document` default and the same reject-by-name
  // behaviour instead of hand-rolling a third copy of the switch.
  KEY_DISPATCH_TARGETS,
  DEFAULT_KEY_DISPATCH_TARGET,
  resolveKeyTarget,
} from './key-events';
export type {
  KeyModifiers,
  KeyDescriptor,
  KeyEventType,
  KeyNormalizeResult,
  KeyDispatchOutcome,
  KeyDispatchTarget,
  KeyTargetFailure,
  KeyTargetResult,
} from './key-events';
