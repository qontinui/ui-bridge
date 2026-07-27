/**
 * UI Bridge Core Module
 *
 * Exports all core types and WebSocket client.
 */

// Export all types
export * from './types';

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
export type { StableElementRef } from './stable-ref';

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
