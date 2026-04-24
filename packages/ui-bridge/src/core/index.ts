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

// WebSocket client (web-specific)
export { UIBridgeWSClient, createWSClient } from './websocket-client';

// SVG-safe className helpers — always use instead of `.className.split(...)`.
export { classString, classList } from './class-name';
