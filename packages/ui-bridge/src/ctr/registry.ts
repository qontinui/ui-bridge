/**
 * Central Target Registry
 *
 * Maps stable logical names to physical selectors with self-healing fallback chains.
 * Follows the SpecStore pattern: Map-backed, event-emitting, singleton via globalThis.
 */

import type { SearchCriteria } from '../ai/types';
import type {
  CtrEntry,
  CtrSelector,
  CtrConfig,
  CtrResolutionResult,
  CtrEvent,
  CtrListener,
} from './types';
import { CTR_CONFIG_VERSION, DEFAULT_SELECTOR_CONFIDENCE } from './types';
import { promoteSelector, demoteSelector, getViableSelectors } from './self-healing';

// =============================================================================
// Registry
// =============================================================================

export class CentralTargetRegistry {
  private entries = new Map<string, CtrEntry>();
  private listeners = new Set<CtrListener>();

  // Cache successful resolutions for the session to avoid repeated DOM queries
  private resolutionCache = new Map<string, { selector: CtrSelector; timestamp: number }>();
  private cacheTtlMs = 5000; // 5s cache

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  register(entry: CtrEntry): void {
    this.entries.set(entry.logicalName, entry);
    this.emit({
      type: 'ctr:entry-registered',
      logicalName: entry.logicalName,
      timestamp: Date.now(),
    });
  }

  unregister(logicalName: string): boolean {
    const existed = this.entries.delete(logicalName);
    if (existed) {
      this.resolutionCache.delete(logicalName);
      this.emit({ type: 'ctr:entry-unregistered', logicalName, timestamp: Date.now() });
    }
    return existed;
  }

  get(logicalName: string): CtrEntry | undefined {
    return this.entries.get(logicalName);
  }

  has(logicalName: string): boolean {
    return this.entries.has(logicalName);
  }

  getAll(): CtrEntry[] {
    return Array.from(this.entries.values());
  }

  clear(): void {
    this.entries.clear();
    this.resolutionCache.clear();
    this.emit({ type: 'ctr:cleared', timestamp: Date.now() });
  }

  get size(): number {
    return this.entries.size;
  }

  // ---------------------------------------------------------------------------
  // Selector Management
  // ---------------------------------------------------------------------------

  /**
   * Add a selector to an existing entry.
   */
  addSelector(logicalName: string, selector: CtrSelector): boolean {
    const entry = this.entries.get(logicalName);
    if (!entry) return false;

    entry.selectors.push(selector);
    entry.selectors.sort((a, b) => a.priority - b.priority);
    entry.version++;
    if (entry.metadata) {
      entry.metadata.updatedAt = new Date().toISOString();
    }
    this.emit({ type: 'ctr:entry-updated', logicalName, selector, timestamp: Date.now() });
    return true;
  }

  /**
   * Update a specific selector within an entry.
   */
  updateSelector(
    logicalName: string,
    selectorIndex: number,
    updates: Partial<Pick<CtrSelector, 'value' | 'priority' | 'confidence'>>
  ): boolean {
    const entry = this.entries.get(logicalName);
    if (!entry || selectorIndex < 0 || selectorIndex >= entry.selectors.length) return false;

    const selector = entry.selectors[selectorIndex];
    if (updates.value !== undefined) selector.value = updates.value;
    if (updates.priority !== undefined) selector.priority = updates.priority;
    if (updates.confidence !== undefined) selector.confidence = updates.confidence;

    entry.selectors.sort((a, b) => a.priority - b.priority);
    entry.version++;
    this.resolutionCache.delete(logicalName);
    this.emit({ type: 'ctr:entry-updated', logicalName, selector, timestamp: Date.now() });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve a logical name to a SearchCriteria that can be used by the assertion/search system.
   * Does NOT require a browser context — returns criteria, not an element.
   */
  resolveToSearchCriteria(logicalName: string): SearchCriteria | null {
    const entry = this.entries.get(logicalName);
    if (!entry) return null;

    // Check cache
    const cached = this.resolutionCache.get(logicalName);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return selectorToSearchCriteria(cached.selector);
    }

    // Try viable selectors in priority order
    const selectors = getViableSelectors(entry);
    if (selectors.length === 0) return null;

    // Return the highest-priority selector as SearchCriteria
    // (actual DOM resolution and self-healing happen in resolveInDOM)
    return selectorToSearchCriteria(selectors[0]);
  }

  /**
   * Resolve a logical name to a DOM element with self-healing.
   * Requires browser context (document must be available).
   */
  resolveInDOM(logicalName: string): CtrResolutionResult {
    const startTime = performance.now();
    const entry = this.entries.get(logicalName);

    if (!entry) {
      return {
        logicalName,
        resolved: false,
        attemptedSelectors: [],
        durationMs: performance.now() - startTime,
      };
    }

    const selectors = getViableSelectors(entry);
    const attempted: CtrSelector[] = [];

    for (const selector of selectors) {
      attempted.push(selector);
      const element = resolveSelectorInDOM(selector);

      if (element) {
        // Self-heal: promote this selector
        const event = promoteSelector(entry, selector);
        if (event) this.emit(event);

        // Demote all selectors that were tried before this one
        for (const failed of attempted.slice(0, -1)) {
          const demoteEvent = demoteSelector(entry, failed);
          if (demoteEvent) this.emit(demoteEvent);
        }

        entry.lastResolved = Date.now();
        this.resolutionCache.set(logicalName, { selector, timestamp: Date.now() });

        this.emit({
          type: 'ctr:resolution-succeeded',
          logicalName,
          selector,
          timestamp: Date.now(),
        });

        return {
          logicalName,
          resolved: true,
          matchedSelector: selector,
          element,
          criteria: selectorToSearchCriteria(selector),
          attemptedSelectors: attempted,
          durationMs: performance.now() - startTime,
        };
      }
    }

    // All selectors exhausted
    entry.lastFailed = Date.now();
    this.resolutionCache.delete(logicalName);

    this.emit({
      type: 'ctr:resolution-failed',
      logicalName,
      timestamp: Date.now(),
    });

    return {
      logicalName,
      resolved: false,
      attemptedSelectors: attempted,
      durationMs: performance.now() - startTime,
    };
  }

  // ---------------------------------------------------------------------------
  // Config Import/Export
  // ---------------------------------------------------------------------------

  loadConfig(config: CtrConfig): void {
    for (const entry of config.entries) {
      this.entries.set(entry.logicalName, entry);
    }
    this.resolutionCache.clear();
    this.emit({ type: 'ctr:config-loaded', timestamp: Date.now() });
  }

  exportConfig(): CtrConfig {
    return {
      version: CTR_CONFIG_VERSION,
      entries: Array.from(this.entries.values()),
    };
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  on(listener: CtrListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  off(listener: CtrListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: CtrEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the registry
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cache Control
  // ---------------------------------------------------------------------------

  setCacheTtl(ms: number): void {
    this.cacheTtlMs = ms;
  }

  invalidateCache(logicalName?: string): void {
    if (logicalName) {
      this.resolutionCache.delete(logicalName);
    } else {
      this.resolutionCache.clear();
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-Run Confidence Seeding
  // ---------------------------------------------------------------------------

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
  seedFromHistory(reliabilityData: import('./types').ElementReliability[]): number {
    let seeded = 0;

    for (const data of reliabilityData) {
      // Match reliability data to entries by element_id matching selector values
      for (const [, entry] of this.entries) {
        for (const selector of entry.selectors) {
          const selectorValue = typeof selector.value === 'string' ? selector.value : undefined;
          if (!selectorValue) continue;

          // Match if the element_id equals the selector value or logical name
          if (selectorValue === data.element_id || entry.logicalName === data.element_id) {
            // Blend historical confidence with current: 70% historical, 30% current
            const blended = data.recommended_confidence * 0.7 + selector.confidence * 0.3;
            selector.confidence = Math.max(0.1, Math.min(1.0, blended));
            seeded++;
          }
        }
      }
    }

    return seeded;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert a CtrSelector to a SearchCriteria for use with the search/assertion system.
 */
function selectorToSearchCriteria(selector: CtrSelector): SearchCriteria {
  switch (selector.strategy) {
    case 'data-testid':
      return { idPattern: selector.value as string, fuzzy: false };
    case 'data-awas-element':
      return { idPattern: selector.value as string, fuzzy: false };
    case 'id':
      return { idPattern: selector.value as string, fuzzy: false };
    case 'css':
      return { selector: selector.value as string, fuzzy: false };
    case 'xpath':
      return { xpath: selector.value as string, fuzzy: false };
    case 'search':
      return selector.value as SearchCriteria;
  }
}

/**
 * Resolve a single CtrSelector to a DOM element.
 * Returns null if the selector doesn't match or we're not in a browser context.
 */
function resolveSelectorInDOM(selector: CtrSelector): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  try {
    switch (selector.strategy) {
      case 'data-testid':
        return document.querySelector<HTMLElement>(
          `[data-testid="${CSS.escape(selector.value as string)}"]`
        );
      case 'data-awas-element':
        return document.querySelector<HTMLElement>(
          `[data-awas-element="${CSS.escape(selector.value as string)}"]`
        );
      case 'id':
        return document.querySelector<HTMLElement>(`#${CSS.escape(selector.value as string)}`);
      case 'css':
        return document.querySelector<HTMLElement>(selector.value as string);
      case 'xpath': {
        const result = document.evaluate(
          selector.value as string,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return result.singleNodeValue as HTMLElement | null;
      }
      case 'search':
        // Search-based resolution requires the SearchEngine — handled at a higher level.
        // Return null here; the registry's resolveToSearchCriteria() path handles this.
        return null;
    }
  } catch {
    return null;
  }
}

// =============================================================================
// Singleton
// =============================================================================

const GLOBAL_KEY = '__uiBridgeCtr';

export function getGlobalCtr(): CentralTargetRegistry {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CentralTargetRegistry();
  }
  return g[GLOBAL_KEY] as CentralTargetRegistry;
}

export function setGlobalCtr(registry: CentralTargetRegistry): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = registry;
}

export function resetGlobalCtr(): void {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}

// =============================================================================
// Entry Builder Helper
// =============================================================================

/**
 * Create a CtrEntry with sensible defaults.
 */
export function createCtrEntry(
  logicalName: string,
  selectors: Array<{
    strategy: CtrSelector['strategy'];
    value: CtrSelector['value'];
    priority?: number;
    confidence?: number;
  }>,
  metadata?: CtrEntry['metadata']
): CtrEntry {
  return {
    logicalName,
    selectors: selectors.map((s, i) => ({
      strategy: s.strategy,
      value: s.value,
      priority: s.priority ?? i,
      confidence: s.confidence ?? DEFAULT_SELECTOR_CONFIDENCE,
    })),
    metadata: metadata
      ? { ...metadata, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      : undefined,
    version: 1,
  };
}
