/**
 * CTR -> Spec Execution Pipeline Integration Smoke Test
 *
 * Validates the full flow: load CTR config -> register entries ->
 * resolve targets via spec executor -> self-healing fallback -> cache
 * invalidation -> config round-trip.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CentralTargetRegistry, createCtrEntry, getGlobalCtr, resetGlobalCtr } from '../registry';
import type { CtrConfig } from '../types';
import { resolveTarget } from '../../specs/executor';
import type { SpecTarget } from '../../specs/types';
import type { SearchCriteria } from '../../ai/types';
import sampleConfig from './sample.ctr.uibridge.json';

// =============================================================================
// Helpers
// =============================================================================

function ctrTarget(logicalName: string, label?: string): SpecTarget {
  return { type: 'ctr', logicalName, label };
}

// =============================================================================
// Tests
// =============================================================================

describe('CTR -> Spec Execution Pipeline (integration)', () => {
  let registry: CentralTargetRegistry;

  beforeEach(() => {
    resetGlobalCtr();
    registry = getGlobalCtr();
  });

  afterEach(() => {
    resetGlobalCtr();
  });

  // ---------------------------------------------------------------------------
  // Config loading & registration
  // ---------------------------------------------------------------------------

  describe('config loading', () => {
    it('loads the sample CTR config and registers all entries', () => {
      registry.loadConfig(sampleConfig as CtrConfig);

      expect(registry.size).toBe(sampleConfig.entries.length);
      for (const entry of sampleConfig.entries) {
        expect(registry.has(entry.logicalName)).toBe(true);
      }
    });

    it('each loaded entry retains its selectors in priority order', () => {
      registry.loadConfig(sampleConfig as CtrConfig);

      const runBtn = registry.get('exec.run-button');
      expect(runBtn).toBeDefined();
      expect(runBtn!.selectors.length).toBe(3);
      // Selectors should already be sorted by priority (0, 1, 2)
      for (let i = 1; i < runBtn!.selectors.length; i++) {
        expect(runBtn!.selectors[i].priority).toBeGreaterThanOrEqual(
          runBtn!.selectors[i - 1].priority
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // resolveTarget with CTR targets
  // ---------------------------------------------------------------------------

  describe('resolveTarget() for ctr type', () => {
    beforeEach(() => {
      registry.loadConfig(sampleConfig as CtrConfig);
    });

    it('resolves a CTR target to SearchCriteria via the global registry', () => {
      const result = resolveTarget(ctrTarget('exec.library-search'));

      // The highest-priority selector is data-testid "workflow-library-search"
      expect(result).toEqual({ idPattern: 'workflow-library-search', fuzzy: false });
    });

    it('resolves a data-awas-element selector to idPattern criteria', () => {
      const result = resolveTarget(ctrTarget('exec.queue-heading'));

      expect(result).toEqual({ idPattern: 'workflow-queue-heading', fuzzy: false });
    });

    it('falls back to idPattern with fuzzy:true for unknown logical names', () => {
      const result = resolveTarget(ctrTarget('nonexistent.target'));

      expect(result).toEqual({ idPattern: 'nonexistent.target', fuzzy: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Self-healing: resolveToSearchCriteria picks highest-priority viable selector
  // ---------------------------------------------------------------------------

  describe('self-healing fallback chain', () => {
    it('picks the highest-priority viable selector', () => {
      const entry = createCtrEntry('test.multi-selector', [
        { strategy: 'data-testid', value: 'primary-tid', priority: 0, confidence: 0.9 },
        { strategy: 'css', value: '.fallback-class', priority: 1, confidence: 0.8 },
        { strategy: 'id', value: 'last-resort-id', priority: 2, confidence: 0.5 },
      ]);
      registry.register(entry);

      const criteria = registry.resolveToSearchCriteria('test.multi-selector');
      // Should pick the first selector (priority 0, confidence 0.9)
      expect(criteria).toEqual({ idPattern: 'primary-tid', fuzzy: false });
    });

    it('skips selectors below the minimum confidence threshold', () => {
      const entry = createCtrEntry('test.degraded', [
        { strategy: 'data-testid', value: 'broken-tid', priority: 0, confidence: 0.1 },
        { strategy: 'css', value: '.still-works', priority: 1, confidence: 0.8 },
      ]);
      registry.register(entry);

      const criteria = registry.resolveToSearchCriteria('test.degraded');
      // First selector is below MIN_CONFIDENCE_THRESHOLD (0.2), so should use the css one
      expect(criteria).toEqual({ selector: '.still-works', fuzzy: false });
    });

    it('returns null when all selectors are below confidence threshold', () => {
      const entry = createCtrEntry('test.all-dead', [
        { strategy: 'data-testid', value: 'dead-1', priority: 0, confidence: 0.05 },
        { strategy: 'css', value: '.dead-2', priority: 1, confidence: 0.1 },
      ]);
      registry.register(entry);

      const criteria = registry.resolveToSearchCriteria('test.all-dead');
      expect(criteria).toBeNull();
    });

    it('resolveTarget falls back to fuzzy idPattern when all selectors exhausted', () => {
      const entry = createCtrEntry('test.exhausted', [
        { strategy: 'data-testid', value: 'gone', priority: 0, confidence: 0.05 },
      ]);
      registry.register(entry);

      const result = resolveTarget(ctrTarget('test.exhausted'));
      // CTR resolveToSearchCriteria returns null -> executor falls back to fuzzy idPattern
      expect(result).toEqual({ idPattern: 'test.exhausted', fuzzy: true });
    });

    it('search strategy selector returns the SearchCriteria object directly', () => {
      const entry = createCtrEntry('test.search-selector', [
        {
          strategy: 'search',
          value: { role: 'button', textContent: 'Submit' } as SearchCriteria,
          priority: 0,
          confidence: 0.8,
        },
      ]);
      registry.register(entry);

      const criteria = registry.resolveToSearchCriteria('test.search-selector');
      expect(criteria).toEqual({ role: 'button', textContent: 'Submit' });
    });
  });

  // ---------------------------------------------------------------------------
  // Cache invalidation
  // ---------------------------------------------------------------------------

  describe('cache invalidation', () => {
    it('returns cached result on second call within TTL', () => {
      registry.loadConfig(sampleConfig as CtrConfig);
      registry.setCacheTtl(60_000); // long TTL so cache is always fresh

      const first = registry.resolveToSearchCriteria('exec.library-search');
      const second = registry.resolveToSearchCriteria('exec.library-search');

      expect(first).toEqual(second);
    });

    it('invalidateCache for a specific key forces re-resolution', () => {
      // Register an entry with two selectors
      const entry = createCtrEntry('test.cache-key', [
        { strategy: 'data-testid', value: 'original-tid', priority: 0, confidence: 0.9 },
        { strategy: 'css', value: '.backup', priority: 1, confidence: 0.8 },
      ]);
      registry.register(entry);
      registry.setCacheTtl(60_000);

      // Prime the cache -- should resolve to highest-priority selector
      const primed = registry.resolveToSearchCriteria('test.cache-key');
      expect(primed).toEqual({ idPattern: 'original-tid', fuzzy: false });

      // Use updateSelector to change the top selector's value.
      // updateSelector internally deletes the cache entry for this key.
      registry.updateSelector('test.cache-key', 0, { value: 'updated-tid' });

      // After updateSelector (which invalidates cache), the new value should appear
      const afterUpdate = registry.resolveToSearchCriteria('test.cache-key');
      expect(afterUpdate).toEqual({ idPattern: 'updated-tid', fuzzy: false });

      // Now test explicit invalidateCache: prime cache again, then add a new
      // higher-priority selector and call invalidateCache manually
      registry.addSelector('test.cache-key', {
        strategy: 'data-testid',
        value: 'highest-priority-tid',
        priority: -1, // highest priority
        confidence: 0.95,
      });

      // addSelector doesn't clear the cache, so cached value persists
      // (the cache was written by the afterUpdate call above)
      // Call invalidateCache to force fresh resolution
      registry.invalidateCache('test.cache-key');
      const afterInvalidate = registry.resolveToSearchCriteria('test.cache-key');
      expect(afterInvalidate).toEqual({ idPattern: 'highest-priority-tid', fuzzy: false });
    });

    it('invalidateCache() with no args clears the entire cache', () => {
      registry.loadConfig(sampleConfig as CtrConfig);
      registry.setCacheTtl(60_000);

      // Prime cache for two entries
      registry.resolveToSearchCriteria('exec.library-search');
      registry.resolveToSearchCriteria('exec.run-button');

      // Replace selectors entirely so cached references diverge
      registry.get('exec.library-search')!.selectors = [
        { strategy: 'data-testid' as const, value: 'new-search', priority: 0, confidence: 0.9 },
      ];
      registry.get('exec.run-button')!.selectors = [
        { strategy: 'data-testid' as const, value: 'new-run', priority: 0, confidence: 0.9 },
      ];

      registry.invalidateCache();

      expect(registry.resolveToSearchCriteria('exec.library-search')).toEqual({
        idPattern: 'new-search',
        fuzzy: false,
      });
      expect(registry.resolveToSearchCriteria('exec.run-button')).toEqual({
        idPattern: 'new-run',
        fuzzy: false,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // exportConfig round-trip
  // ---------------------------------------------------------------------------

  describe('exportConfig round-trip', () => {
    it('exports the same data that was loaded', () => {
      registry.loadConfig(sampleConfig as CtrConfig);

      const exported = registry.exportConfig();

      expect(exported.version).toBe(sampleConfig.version);
      expect(exported.entries.length).toBe(sampleConfig.entries.length);

      for (const original of sampleConfig.entries) {
        const found = exported.entries.find((e) => e.logicalName === original.logicalName);
        expect(found).toBeDefined();
        expect(found!.selectors.length).toBe(original.selectors.length);
        expect(found!.version).toBe(original.version);

        // Verify each selector matches
        for (let i = 0; i < original.selectors.length; i++) {
          expect(found!.selectors[i].strategy).toBe(original.selectors[i].strategy);
          expect(found!.selectors[i].value).toEqual(original.selectors[i].value);
          expect(found!.selectors[i].priority).toBe(original.selectors[i].priority);
          expect(found!.selectors[i].confidence).toBe(original.selectors[i].confidence);
        }
      }
    });

    it('exported config can be re-loaded into a fresh registry', () => {
      registry.loadConfig(sampleConfig as CtrConfig);
      const exported = registry.exportConfig();

      // Create a fresh registry and load the exported config
      const freshRegistry = new CentralTargetRegistry();
      freshRegistry.loadConfig(exported);

      expect(freshRegistry.size).toBe(registry.size);
      for (const entry of registry.getAll()) {
        expect(freshRegistry.has(entry.logicalName)).toBe(true);
        const freshEntry = freshRegistry.get(entry.logicalName)!;
        expect(freshEntry.selectors.length).toBe(entry.selectors.length);
      }
    });

    it('round-tripped registry resolves the same SearchCriteria', () => {
      registry.loadConfig(sampleConfig as CtrConfig);

      const originalCriteria = registry.resolveToSearchCriteria('exec.run-button');

      // Round-trip
      const exported = registry.exportConfig();
      const freshRegistry = new CentralTargetRegistry();
      freshRegistry.loadConfig(exported);

      const roundTrippedCriteria = freshRegistry.resolveToSearchCriteria('exec.run-button');

      expect(roundTrippedCriteria).toEqual(originalCriteria);
    });
  });
});
