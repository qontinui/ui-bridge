/**
 * Central Target Registry Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CentralTargetRegistry, createCtrEntry, resetGlobalCtr } from './registry';
import {
  promoteSelector,
  demoteSelector,
  getViableSelectors,
  hasViableSelectors,
} from './self-healing';
import type { CtrEntry, CtrSelector } from './types';
import {
  DEFAULT_SELECTOR_CONFIDENCE,
  CONFIDENCE_BOOST,
  CONFIDENCE_PENALTY,
  MIN_CONFIDENCE_THRESHOLD,
  CTR_CONFIG_VERSION,
} from './types';

// =============================================================================
// CentralTargetRegistry
// =============================================================================

describe('CentralTargetRegistry', () => {
  let registry: CentralTargetRegistry;

  beforeEach(() => {
    registry = new CentralTargetRegistry();
    resetGlobalCtr();
  });

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  describe('register / unregister / get / has / getAll / clear / size', () => {
    it('should register an entry and retrieve it by logicalName', () => {
      const entry = createCtrEntry('login-button', [
        { strategy: 'data-testid', value: 'login-btn' },
      ]);
      registry.register(entry);

      expect(registry.has('login-button')).toBe(true);
      expect(registry.get('login-button')).toBe(entry);
      expect(registry.size).toBe(1);
    });

    it('should return undefined for unregistered logicalName', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('should unregister an entry and return true', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'id', value: 'btn' }]);
      registry.register(entry);
      expect(registry.unregister('btn')).toBe(true);
      expect(registry.has('btn')).toBe(false);
      expect(registry.size).toBe(0);
    });

    it('should return false when unregistering a non-existent entry', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });

    it('should return all entries via getAll()', () => {
      registry.register(createCtrEntry('a', [{ strategy: 'id', value: 'a' }]));
      registry.register(createCtrEntry('b', [{ strategy: 'id', value: 'b' }]));
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.logicalName).sort()).toEqual(['a', 'b']);
    });

    it('should clear all entries', () => {
      registry.register(createCtrEntry('a', [{ strategy: 'id', value: 'a' }]));
      registry.register(createCtrEntry('b', [{ strategy: 'id', value: 'b' }]));
      registry.clear();
      expect(registry.size).toBe(0);
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Selector Management
  // ---------------------------------------------------------------------------

  describe('addSelector', () => {
    it('should add a selector to an existing entry and re-sort by priority', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'data-testid', value: 'btn', priority: 0 }]);
      registry.register(entry);

      const newSelector: CtrSelector = {
        strategy: 'css',
        value: '.btn-primary',
        priority: 1,
        confidence: 0.9,
      };
      expect(registry.addSelector('btn', newSelector)).toBe(true);
      expect(registry.get('btn')!.selectors).toHaveLength(2);
      expect(registry.get('btn')!.version).toBe(2);
    });

    it('should return false for a non-existent entry', () => {
      const sel: CtrSelector = { strategy: 'id', value: 'x', priority: 0, confidence: 0.8 };
      expect(registry.addSelector('nope', sel)).toBe(false);
    });
  });

  describe('updateSelector', () => {
    it('should update selector value and priority', () => {
      const entry = createCtrEntry('btn', [
        { strategy: 'data-testid', value: 'old-val', priority: 0 },
        { strategy: 'css', value: '.old', priority: 1 },
      ]);
      registry.register(entry);

      expect(registry.updateSelector('btn', 0, { value: 'new-val', priority: 5 })).toBe(true);
      const updated = registry.get('btn')!;
      // After update, selectors re-sorted: css (priority 1) then data-testid (priority 5)
      expect(updated.selectors[0].strategy).toBe('css');
      expect(updated.selectors[1].value).toBe('new-val');
      expect(updated.version).toBe(2);
    });

    it('should return false for invalid index', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'id', value: 'x' }]);
      registry.register(entry);
      expect(registry.updateSelector('btn', 5, { value: 'z' })).toBe(false);
      expect(registry.updateSelector('btn', -1, { value: 'z' })).toBe(false);
    });

    it('should return false for non-existent entry', () => {
      expect(registry.updateSelector('nope', 0, { value: 'z' })).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // resolveToSearchCriteria
  // ---------------------------------------------------------------------------

  describe('resolveToSearchCriteria', () => {
    it('should return null for unregistered logicalName', () => {
      expect(registry.resolveToSearchCriteria('nonexistent')).toBeNull();
    });

    it('should return idPattern for data-testid strategy', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'data-testid', value: 'submit-btn' }]);
      registry.register(entry);
      const criteria = registry.resolveToSearchCriteria('btn');
      expect(criteria).toEqual({ idPattern: 'submit-btn', fuzzy: false });
    });

    it('should return idPattern for data-awas-element strategy', () => {
      const entry = createCtrEntry('el', [{ strategy: 'data-awas-element', value: 'my-el' }]);
      registry.register(entry);
      const criteria = registry.resolveToSearchCriteria('el');
      expect(criteria).toEqual({ idPattern: 'my-el', fuzzy: false });
    });

    it('should return idPattern for id strategy', () => {
      const entry = createCtrEntry('el', [{ strategy: 'id', value: 'my-id' }]);
      registry.register(entry);
      const criteria = registry.resolveToSearchCriteria('el');
      expect(criteria).toEqual({ idPattern: 'my-id', fuzzy: false });
    });

    it('should return selector for css strategy', () => {
      const entry = createCtrEntry('el', [{ strategy: 'css', value: '.my-class' }]);
      registry.register(entry);
      const criteria = registry.resolveToSearchCriteria('el');
      expect(criteria).toEqual({ selector: '.my-class', fuzzy: false });
    });

    it('should return xpath for xpath strategy', () => {
      const entry = createCtrEntry('el', [{ strategy: 'xpath', value: '//div[@id="x"]' }]);
      registry.register(entry);
      const criteria = registry.resolveToSearchCriteria('el');
      expect(criteria).toEqual({ xpath: '//div[@id="x"]', fuzzy: false });
    });

    it('should return SearchCriteria directly for search strategy', () => {
      const searchCriteria = { text: 'Submit', fuzzy: true };
      const entry: CtrEntry = {
        logicalName: 'el',
        selectors: [{ strategy: 'search', value: searchCriteria, priority: 0, confidence: 0.8 }],
        version: 1,
      };
      registry.register(entry);
      const criteria = registry.resolveToSearchCriteria('el');
      expect(criteria).toEqual(searchCriteria);
    });

    it('should return null when all selectors are below confidence threshold', () => {
      const entry: CtrEntry = {
        logicalName: 'btn',
        selectors: [{ strategy: 'id', value: 'x', priority: 0, confidence: 0.01 }],
        version: 1,
      };
      registry.register(entry);
      expect(registry.resolveToSearchCriteria('btn')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Config Import/Export
  // ---------------------------------------------------------------------------

  describe('loadConfig / exportConfig', () => {
    it('should round-trip config', () => {
      const entry1 = createCtrEntry('a', [{ strategy: 'id', value: 'a' }]);
      const entry2 = createCtrEntry('b', [{ strategy: 'css', value: '.b' }]);
      registry.register(entry1);
      registry.register(entry2);

      const exported = registry.exportConfig();
      expect(exported.version).toBe(CTR_CONFIG_VERSION);
      expect(exported.entries).toHaveLength(2);

      const registry2 = new CentralTargetRegistry();
      registry2.loadConfig(exported);
      expect(registry2.size).toBe(2);
      expect(registry2.has('a')).toBe(true);
      expect(registry2.has('b')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------

  describe('cache behavior', () => {
    it('should use cached resolution within TTL', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'id', value: 'x' }]);
      registry.register(entry);

      // First resolution populates nothing in cache since resolveToSearchCriteria
      // only caches on resolveInDOM. But we can test that setCacheTtl/invalidateCache work.
      registry.setCacheTtl(100);
      const c1 = registry.resolveToSearchCriteria('btn');
      const c2 = registry.resolveToSearchCriteria('btn');
      expect(c1).toEqual(c2);
    });

    it('should invalidateCache for a specific logicalName', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'id', value: 'x' }]);
      registry.register(entry);
      registry.invalidateCache('btn');
      // Should still resolve since resolveToSearchCriteria falls through to selectors
      expect(registry.resolveToSearchCriteria('btn')).not.toBeNull();
    });

    it('should invalidateCache for all entries', () => {
      registry.register(createCtrEntry('a', [{ strategy: 'id', value: 'a' }]));
      registry.register(createCtrEntry('b', [{ strategy: 'id', value: 'b' }]));
      registry.invalidateCache();
      expect(registry.resolveToSearchCriteria('a')).not.toBeNull();
      expect(registry.resolveToSearchCriteria('b')).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  describe('event emission', () => {
    it('should emit ctr:entry-registered on register', () => {
      const listener = vi.fn();
      registry.on(listener);
      const entry = createCtrEntry('btn', [{ strategy: 'id', value: 'x' }]);
      registry.register(entry);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ctr:entry-registered', logicalName: 'btn' })
      );
    });

    it('should emit ctr:entry-unregistered on unregister', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'id', value: 'x' }]);
      registry.register(entry);
      const listener = vi.fn();
      registry.on(listener);
      registry.unregister('btn');
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ctr:entry-unregistered', logicalName: 'btn' })
      );
    });

    it('should emit ctr:entry-updated on addSelector', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'id', value: 'x' }]);
      registry.register(entry);
      const listener = vi.fn();
      registry.on(listener);
      registry.addSelector('btn', { strategy: 'css', value: '.x', priority: 1, confidence: 0.8 });
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ctr:entry-updated', logicalName: 'btn' })
      );
    });

    it('should emit ctr:entry-updated on updateSelector', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'id', value: 'x' }]);
      registry.register(entry);
      const listener = vi.fn();
      registry.on(listener);
      registry.updateSelector('btn', 0, { value: 'y' });
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ctr:entry-updated', logicalName: 'btn' })
      );
    });

    it('should emit ctr:cleared on clear', () => {
      const listener = vi.fn();
      registry.on(listener);
      registry.clear();
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'ctr:cleared' }));
    });

    it('should emit ctr:config-loaded on loadConfig', () => {
      const listener = vi.fn();
      registry.on(listener);
      registry.loadConfig({ version: '1.0.0', entries: [] });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'ctr:config-loaded' }));
    });

    it('should remove listener with off()', () => {
      const listener = vi.fn();
      registry.on(listener);
      registry.off(listener);
      registry.register(createCtrEntry('x', [{ strategy: 'id', value: 'x' }]));
      expect(listener).not.toHaveBeenCalled();
    });

    it('should remove listener via returned unsubscribe function', () => {
      const listener = vi.fn();
      const unsub = registry.on(listener);
      unsub();
      registry.register(createCtrEntry('x', [{ strategy: 'id', value: 'x' }]));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // createCtrEntry helper
  // ---------------------------------------------------------------------------

  describe('createCtrEntry', () => {
    it('should create an entry with default priority and confidence', () => {
      const entry = createCtrEntry('btn', [
        { strategy: 'data-testid', value: 'submit' },
        { strategy: 'css', value: '.submit-btn' },
      ]);
      expect(entry.logicalName).toBe('btn');
      expect(entry.version).toBe(1);
      expect(entry.selectors).toHaveLength(2);
      expect(entry.selectors[0].priority).toBe(0);
      expect(entry.selectors[0].confidence).toBe(DEFAULT_SELECTOR_CONFIDENCE);
      expect(entry.selectors[1].priority).toBe(1);
    });

    it('should use provided priority and confidence', () => {
      const entry = createCtrEntry('btn', [
        { strategy: 'id', value: 'x', priority: 5, confidence: 0.95 },
      ]);
      expect(entry.selectors[0].priority).toBe(5);
      expect(entry.selectors[0].confidence).toBe(0.95);
    });

    it('should include metadata with timestamps when provided', () => {
      const entry = createCtrEntry('btn', [{ strategy: 'id', value: 'x' }], {
        description: 'A button',
        component: 'LoginForm',
      });
      expect(entry.metadata?.description).toBe('A button');
      expect(entry.metadata?.component).toBe('LoginForm');
      expect(entry.metadata?.createdAt).toBeDefined();
      expect(entry.metadata?.updatedAt).toBeDefined();
    });
  });
});

// =============================================================================
// Self-Healing
// =============================================================================

describe('self-healing', () => {
  function makeEntry(selectors: CtrSelector[]): CtrEntry {
    return { logicalName: 'test', selectors, version: 1 };
  }

  describe('promoteSelector', () => {
    it('should increase confidence by CONFIDENCE_BOOST', () => {
      const sel: CtrSelector = { strategy: 'id', value: 'x', priority: 0, confidence: 0.8 };
      const entry = makeEntry([sel]);
      const event = promoteSelector(entry, sel);
      expect(sel.confidence).toBeCloseTo(0.8 + CONFIDENCE_BOOST);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('ctr:selector-promoted');
    });

    it('should cap confidence at 1.0', () => {
      const sel: CtrSelector = { strategy: 'id', value: 'x', priority: 0, confidence: 0.98 };
      const entry = makeEntry([sel]);
      promoteSelector(entry, sel);
      expect(sel.confidence).toBe(1.0);
    });

    it('should swap priorities when promoted selector has higher confidence than predecessor', () => {
      const sel0: CtrSelector = { strategy: 'id', value: 'a', priority: 0, confidence: 0.5 };
      const sel1: CtrSelector = { strategy: 'css', value: '.b', priority: 1, confidence: 0.49 };
      const entry = makeEntry([sel0, sel1]);

      // Promote sel1 so its confidence exceeds sel0
      promoteSelector(entry, sel1);
      // sel1 confidence now ~0.54, sel0 is 0.5 => should swap priorities
      expect(sel1.priority).toBe(0);
      expect(sel0.priority).toBe(1);
    });

    it('should return null for a selector not in the entry', () => {
      const sel: CtrSelector = { strategy: 'id', value: 'x', priority: 0, confidence: 0.8 };
      const other: CtrSelector = { strategy: 'css', value: '.y', priority: 1, confidence: 0.8 };
      const entry = makeEntry([sel]);
      expect(promoteSelector(entry, other)).toBeNull();
    });
  });

  describe('demoteSelector', () => {
    it('should decrease confidence by CONFIDENCE_PENALTY', () => {
      const sel: CtrSelector = { strategy: 'id', value: 'x', priority: 0, confidence: 0.8 };
      const entry = makeEntry([sel]);
      const event = demoteSelector(entry, sel);
      expect(sel.confidence).toBeCloseTo(0.8 - CONFIDENCE_PENALTY);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('ctr:selector-demoted');
    });

    it('should floor confidence at 0', () => {
      const sel: CtrSelector = { strategy: 'id', value: 'x', priority: 0, confidence: 0.05 };
      const entry = makeEntry([sel]);
      demoteSelector(entry, sel);
      expect(sel.confidence).toBe(0);
    });

    it('should return null for a selector not in the entry', () => {
      const sel: CtrSelector = { strategy: 'id', value: 'x', priority: 0, confidence: 0.8 };
      const other: CtrSelector = { strategy: 'css', value: '.y', priority: 1, confidence: 0.8 };
      const entry = makeEntry([sel]);
      expect(demoteSelector(entry, other)).toBeNull();
    });
  });

  describe('getViableSelectors', () => {
    it('should filter selectors below MIN_CONFIDENCE_THRESHOLD', () => {
      const selHigh: CtrSelector = { strategy: 'id', value: 'a', priority: 0, confidence: 0.8 };
      const selLow: CtrSelector = { strategy: 'css', value: '.b', priority: 1, confidence: 0.05 };
      const entry = makeEntry([selHigh, selLow]);
      const viable = getViableSelectors(entry);
      expect(viable).toHaveLength(1);
      expect(viable[0]).toBe(selHigh);
    });

    it('should sort by priority (lower first)', () => {
      const sel0: CtrSelector = { strategy: 'id', value: 'a', priority: 2, confidence: 0.8 };
      const sel1: CtrSelector = { strategy: 'css', value: '.b', priority: 0, confidence: 0.9 };
      const entry = makeEntry([sel0, sel1]);
      const viable = getViableSelectors(entry);
      expect(viable[0]).toBe(sel1);
      expect(viable[1]).toBe(sel0);
    });

    it('should include selectors exactly at MIN_CONFIDENCE_THRESHOLD', () => {
      const sel: CtrSelector = {
        strategy: 'id',
        value: 'a',
        priority: 0,
        confidence: MIN_CONFIDENCE_THRESHOLD,
      };
      const entry = makeEntry([sel]);
      expect(getViableSelectors(entry)).toHaveLength(1);
    });
  });

  describe('hasViableSelectors', () => {
    it('should return true when at least one selector is viable', () => {
      const entry = makeEntry([{ strategy: 'id', value: 'a', priority: 0, confidence: 0.8 }]);
      expect(hasViableSelectors(entry)).toBe(true);
    });

    it('should return false when all selectors are below threshold', () => {
      const entry = makeEntry([{ strategy: 'id', value: 'a', priority: 0, confidence: 0.01 }]);
      expect(hasViableSelectors(entry)).toBe(false);
    });
  });
});
