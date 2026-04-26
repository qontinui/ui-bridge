import { c as SpecConfig } from './types-BmKY7boF.mjs';
import { G as SearchCriteria } from './types-svkOxfrJ.mjs';

/**
 * Central Target Registry (CTR) Types
 *
 * Maps stable logical names to physical selectors, surviving DOM restructuring.
 * Inspired by testergizer-open-core's Central Target Registry pattern.
 */

/** Strategy for locating a DOM element. */
type CtrSelectorStrategy = 'data-testid' | 'data-awas-element' | 'id' | 'css' | 'xpath' | 'search';
/**
 * A single selector within a CTR entry's fallback chain.
 * Multiple selectors are tried in priority order (lower = tried first).
 */
interface CtrSelector {
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
interface CtrEntryMetadata {
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
interface CtrEntry {
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
interface CtrConfig {
    version: '1.0.0';
    entries: CtrEntry[];
    metadata?: {
        author?: string;
        description?: string;
    };
}
/** Result of resolving a logical name through the CTR. */
interface CtrResolutionResult {
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
type CtrEventType = 'ctr:entry-registered' | 'ctr:entry-unregistered' | 'ctr:entry-updated' | 'ctr:selector-promoted' | 'ctr:selector-demoted' | 'ctr:resolution-succeeded' | 'ctr:resolution-failed' | 'ctr:config-loaded' | 'ctr:cleared';
interface CtrEvent {
    type: CtrEventType;
    logicalName?: string;
    selector?: CtrSelector;
    timestamp: number;
}
type CtrListener = (event: CtrEvent) => void;
declare const CTR_CONFIG_VERSION = "1.0.0";
declare const CTR_FILE_EXTENSION = ".ctr.uibridge.json";
/** Default confidence for newly created selectors. */
declare const DEFAULT_SELECTOR_CONFIDENCE = 0.8;
/** Confidence boost applied when a selector resolves successfully. */
declare const CONFIDENCE_BOOST = 0.05;
/** Confidence penalty applied when a selector fails to resolve. */
declare const CONFIDENCE_PENALTY = 0.1;
/** Minimum confidence before a selector is considered unreliable. */
declare const MIN_CONFIDENCE_THRESHOLD = 0.2;
/**
 * Element reliability data from the runner's cross-run analysis.
 * Used to pre-seed CTR selector confidence scores based on historical success rates.
 */
interface ElementReliability {
    /** The element ID (matches element_id in ui_bridge_events). */
    element_id: string;
    /** Total number of interactions across all runs. */
    total_interactions: number;
    /** Number of successful interactions. */
    successful_interactions: number;
    /** Success rate (0.0 - 1.0). */
    success_rate: number;
    /** Last failure reason, if any. */
    last_failure_reason?: string;
    /** Whether this element is considered flaky (success_rate < 0.95). */
    flaky: boolean;
    /** Recommended confidence score based on historical data. */
    recommended_confidence: number;
}

/**
 * Migration utility: .spec.uibridge.json → .ctr.uibridge.json
 *
 * Scans existing spec files, extracts elementId and search targets, and generates
 * CTR entries so that specs can migrate to logical-name-based targeting.
 */

interface MigrationResult {
    /** Generated CTR config. */
    ctrConfig: CtrConfig;
    /** Number of unique targets found (elementId + search). */
    totalTargets: number;
    /** Number of CTR entries created (deduplicated). */
    entriesCreated: number;
    /** Spec file paths that were scanned. */
    scannedFiles: string[];
}
/**
 * Slugify a string: lowercase, spaces/underscores→hyphens, strip non-alphanumeric (except hyphens/dots).
 */
declare function slugify(input: string): string;
/**
 * Derive a deterministic logical name from a search target.
 * Priority:
 *   1. label (slugified)
 *   2. {role}.{text|textContent|accessibleName|textContains}
 *   3. selector as-is
 *   4. fallback "search-{index}" (should not happen in practice)
 */
declare function logicalNameFromSearch(criteria: SearchCriteria, label?: string): string;
/**
 * Scan a SpecConfig and extract elementId and search targets into CTR entries.
 */
declare function migrateSpecToCtr(specConfig: SpecConfig, _specId?: string): CtrConfig;
/**
 * Scan a directory for .spec.uibridge.json files and generate a merged CTR config.
 */
declare function migrateDirectoryToCtr(specDir: string): MigrationResult;
/**
 * Generate a transformed SpecConfig where elementId targets are replaced with ctr targets.
 */
declare function rewriteSpecWithCtr(specConfig: SpecConfig): SpecConfig;

export { CONFIDENCE_BOOST as C, DEFAULT_SELECTOR_CONFIDENCE as D, type ElementReliability as E, MIN_CONFIDENCE_THRESHOLD as M, CONFIDENCE_PENALTY as a, CTR_CONFIG_VERSION as b, CTR_FILE_EXTENSION as c, type CtrConfig as d, type CtrEntry as e, type CtrEntryMetadata as f, type CtrEvent as g, type CtrEventType as h, type CtrListener as i, type CtrResolutionResult as j, type CtrSelector as k, type CtrSelectorStrategy as l, type MigrationResult as m, logicalNameFromSearch as n, migrateDirectoryToCtr as o, migrateSpecToCtr as p, rewriteSpecWithCtr as r, slugify as s };
