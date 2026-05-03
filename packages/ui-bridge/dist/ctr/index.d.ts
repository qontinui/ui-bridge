import { e as CtrEntry, k as CtrSelector, j as CtrResolutionResult, d as CtrConfig, i as CtrListener, E as ElementReliability, g as CtrEvent } from '../migrate-specs-to-ctr-CSHXU4f8.js';
export { C as CONFIDENCE_BOOST, a as CONFIDENCE_PENALTY, b as CTR_CONFIG_VERSION, c as CTR_FILE_EXTENSION, f as CtrEntryMetadata, h as CtrEventType, l as CtrSelectorStrategy, D as DEFAULT_SELECTOR_CONFIDENCE, M as MIN_CONFIDENCE_THRESHOLD, m as MigrationResult } from '../migrate-specs-to-ctr-CSHXU4f8.js';
import { G as SearchCriteria, as as RegisteredElement, ar as UIBridgeRegistry } from '../types-gR41i0Eb.js';
import '../types-BmCNUYVv.js';

declare class CentralTargetRegistry {
    private entries;
    private listeners;
    private resolutionCache;
    private cacheTtlMs;
    register(entry: CtrEntry): void;
    unregister(logicalName: string): boolean;
    get(logicalName: string): CtrEntry | undefined;
    has(logicalName: string): boolean;
    getAll(): CtrEntry[];
    clear(): void;
    get size(): number;
    /**
     * Add a selector to an existing entry.
     */
    addSelector(logicalName: string, selector: CtrSelector): boolean;
    /**
     * Update a specific selector within an entry.
     */
    updateSelector(logicalName: string, selectorIndex: number, updates: Partial<Pick<CtrSelector, 'value' | 'priority' | 'confidence'>>): boolean;
    /**
     * Resolve a logical name to a SearchCriteria that can be used by the assertion/search system.
     * Does NOT require a browser context — returns criteria, not an element.
     */
    resolveToSearchCriteria(logicalName: string): SearchCriteria | null;
    /**
     * Resolve a logical name to a DOM element with self-healing.
     * Requires browser context (document must be available).
     */
    resolveInDOM(logicalName: string): CtrResolutionResult;
    loadConfig(config: CtrConfig): void;
    exportConfig(): CtrConfig;
    on(listener: CtrListener): () => void;
    off(listener: CtrListener): void;
    private emit;
    setCacheTtl(ms: number): void;
    invalidateCache(logicalName?: string): void;
    /**
     * Seed selector confidence scores from cross-run reliability data.
     *
     * When the runner provides historical element reliability data (via
     * GET /ui-bridge/graph/element-reliability), this method adjusts the
     * initial confidence of matching CTR entries based on observed success rates.
     *
     * Elements marked as flaky get their confidence reduced; reliable elements
     * get a boost. This prevents the CTR from starting with high confidence on
     * selectors that historically fail.
     */
    seedFromHistory(reliabilityData: ElementReliability[]): number;
}
declare function getGlobalCtr(): CentralTargetRegistry;
declare function setGlobalCtr(registry: CentralTargetRegistry): void;
declare function resetGlobalCtr(): void;
/**
 * Create a CtrEntry with sensible defaults.
 */
declare function createCtrEntry(logicalName: string, selectors: Array<{
    strategy: CtrSelector['strategy'];
    value: CtrSelector['value'];
    priority?: number;
    confidence?: number;
}>, metadata?: CtrEntry['metadata']): CtrEntry;

/**
 * CTR Self-Healing
 *
 * When a primary selector fails, falls through to secondary selectors.
 * Promotes successful selectors and demotes failed ones based on confidence scores.
 */

/**
 * Promote a selector that resolved successfully.
 * Increases confidence and may decrease priority (making it tried earlier).
 */
declare function promoteSelector(entry: CtrEntry, selector: CtrSelector): CtrEvent | null;
/**
 * Demote a selector that failed to resolve.
 * Decreases confidence.
 */
declare function demoteSelector(entry: CtrEntry, selector: CtrSelector): CtrEvent | null;
/**
 * Get selectors sorted by priority, filtered to those above the minimum confidence threshold.
 */
declare function getViableSelectors(entry: CtrEntry): CtrSelector[];
/**
 * Check if an entry has any viable selectors remaining.
 */
declare function hasViableSelectors(entry: CtrEntry): boolean;

/**
 * CTR Auto-Populate
 *
 * Observes UIBridgeRegistry element registration events and automatically
 * creates CTR entries from registered elements. Bridges the runtime registry
 * (transient, tied to DOM lifecycle) to the CTR (persistent logical names).
 */

/**
 * Options for auto-populating CTR entries from registry events.
 */
interface AutoPopulateOptions {
    /**
     * Whether to overwrite existing CTR entries when a new element is registered
     * with the same logical name. Default: false (keep existing).
     */
    overwrite?: boolean;
    /**
     * Prefix for auto-generated logical names. Default: '' (no prefix).
     */
    prefix?: string;
    /**
     * Filter function to decide whether a registered element should get a CTR entry.
     * Default: all elements get entries.
     */
    filter?: (element: RegisteredElement) => boolean;
}
/**
 * Start observing a UIBridgeRegistry and auto-creating CTR entries.
 * Returns an unsubscribe function.
 */
declare function autoPopulateCtr(uiRegistry: UIBridgeRegistry, ctr: CentralTargetRegistry, options?: AutoPopulateOptions): () => void;

export { type AutoPopulateOptions, CentralTargetRegistry, CtrConfig, CtrEntry, CtrEvent, CtrListener, CtrResolutionResult, CtrSelector, ElementReliability, autoPopulateCtr, createCtrEntry, demoteSelector, getGlobalCtr, getViableSelectors, hasViableSelectors, promoteSelector, resetGlobalCtr, setGlobalCtr };
