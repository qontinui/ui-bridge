/**
 * Central Target Registry (CTR) Types
 *
 * Maps stable logical names to physical selectors, surviving DOM restructuring.
 * Inspired by testergizer-open-core's Central Target Registry pattern.
 */

import type { SearchCriteria } from '../ai/types';

// =============================================================================
// Selector Strategies
// =============================================================================

/** Strategy for locating a DOM element. */
export type CtrSelectorStrategy =
  | 'data-testid'
  | 'data-awas-element'
  | 'id'
  | 'css'
  | 'xpath'
  | 'search';

/**
 * A single selector within a CTR entry's fallback chain.
 * Multiple selectors are tried in priority order (lower = tried first).
 */
export interface CtrSelector {
  /** How to interpret `value`. */
  strategy: CtrSelectorStrategy;
  /**
   * The selector value.
   * - For 'data-testid', 'data-awas-element', 'id': the attribute value string.
   * - For 'css', 'xpath': the raw selector string.
   * - For 'search': a structured SearchCriteria object.
   */
  value: string | SearchCriteria;
  /** Priority in fallback chain (lower = tried first). */
  priority: number;
  /** Confidence score 0-1, updated by self-healing on successful/failed resolution. */
  confidence: number;
}

// =============================================================================
// Entries
// =============================================================================

export interface CtrEntryMetadata {
  /** Human-readable description of the element. */
  description?: string;
  /** React component name where this element lives. */
  component?: string;
  /** URL pattern where this element appears (glob or regex). */
  pageUrl?: string;
  /** Freeform tags for filtering/grouping. */
  tags?: string[];
  /** ISO 8601 timestamp. */
  createdAt?: string;
  /** ISO 8601 timestamp. */
  updatedAt?: string;
}

/**
 * A single CTR entry mapping a logical name to one or more physical selectors.
 */
export interface CtrEntry {
  /** Stable logical name: "login-button", "nav.settings", "form.email-input". */
  logicalName: string;
  /** Ordered fallback chain of selectors. */
  selectors: CtrSelector[];
  /** Optional metadata. */
  metadata?: CtrEntryMetadata;
  /** Schema version of this entry, bumped on selector updates. */
  version: number;
  /** Timestamp of last successful resolution. */
  lastResolved?: number;
  /** Timestamp of last failed resolution (all selectors exhausted). */
  lastFailed?: number;
}

// =============================================================================
// Config (the .ctr.uibridge.json file format)
// =============================================================================

export interface CtrConfig {
  version: '1.0.0';
  entries: CtrEntry[];
  metadata?: {
    author?: string;
    description?: string;
  };
}

// =============================================================================
// Resolution
// =============================================================================

/** Result of resolving a logical name through the CTR. */
export interface CtrResolutionResult {
  /** The logical name that was resolved. */
  logicalName: string;
  /** Whether resolution succeeded. */
  resolved: boolean;
  /** The selector that succeeded (if resolved). */
  matchedSelector?: CtrSelector;
  /** The resolved element (if running in a browser context). */
  element?: HTMLElement;
  /** SearchCriteria derived from the matched selector (for headless/relay use). */
  criteria?: SearchCriteria;
  /** All selectors that were attempted before success/failure. */
  attemptedSelectors: CtrSelector[];
  /** Duration of the resolution process in ms. */
  durationMs: number;
}

// =============================================================================
// Events
// =============================================================================

export type CtrEventType =
  | 'ctr:entry-registered'
  | 'ctr:entry-unregistered'
  | 'ctr:entry-updated'
  | 'ctr:selector-promoted'
  | 'ctr:selector-demoted'
  | 'ctr:resolution-succeeded'
  | 'ctr:resolution-failed'
  | 'ctr:config-loaded'
  | 'ctr:cleared';

export interface CtrEvent {
  type: CtrEventType;
  logicalName?: string;
  selector?: CtrSelector;
  timestamp: number;
}

export type CtrListener = (event: CtrEvent) => void;

// =============================================================================
// Constants
// =============================================================================

export const CTR_CONFIG_VERSION = '1.0.0';

export const CTR_FILE_EXTENSION = '.ctr.uibridge.json';

/** Default confidence for newly created selectors. */
export const DEFAULT_SELECTOR_CONFIDENCE = 0.8;

/** Confidence boost applied when a selector resolves successfully. */
export const CONFIDENCE_BOOST = 0.05;

/** Confidence penalty applied when a selector fails to resolve. */
export const CONFIDENCE_PENALTY = 0.1;

/** Minimum confidence before a selector is considered unreliable. */
export const MIN_CONFIDENCE_THRESHOLD = 0.2;
