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
export { UIBridgeRegistry, getGlobalRegistry } from './registry';

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

// WebSocket client (web-specific)
export { UIBridgeWSClient, createWSClient } from './websocket-client';
