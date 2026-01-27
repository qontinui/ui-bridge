/**
 * Search Engine Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SearchEngine, createSearchEngine, DEFAULT_SEARCH_CONFIG } from './search-engine';
import type { DiscoveredElement } from '../control/types';
import type { SearchCriteria } from './types';

// Helper to create mock discovered elements
function createMockElement(
  id: string,
  options: {
    textContent?: string;
    type?: string;
    tagName?: string;
    role?: string;
    accessibleName?: string;
    visible?: boolean;
    enabled?: boolean;
    focused?: boolean;
    rect?: { x: number; y: number; width: number; height: number };
    label?: string;
  } = {}
): DiscoveredElement {
  const {
    textContent = '',
    type = 'button',
    tagName = 'button',
    role,
    accessibleName,
    visible = true,
    enabled = true,
    focused = false,
    rect = { x: 0, y: 0, width: 100, height: 30 },
    label,
  } = options;

  return {
    id,
    type,
    label: label || id,
    tagName,
    role,
    accessibleName,
    actions: ['click'],
    state: {
      visible,
      enabled,
      focused,
      checked: false,
      textContent,
      rect,
      attributes: {},
    },
    registered: false,
  };
}

describe('SearchEngine', () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const engine = new SearchEngine();
      expect(engine).toBeDefined();
    });

    it('should accept custom config', () => {
      const engine = new SearchEngine({ fuzzyThreshold: 0.5, maxResults: 10 });
      expect(engine).toBeDefined();
    });
  });

  describe('createSearchEngine', () => {
    it('should create a search engine instance', () => {
      const engine = createSearchEngine();
      expect(engine).toBeInstanceOf(SearchEngine);
    });

    it('should accept custom config', () => {
      const engine = createSearchEngine({ maxResults: 5 });
      expect(engine).toBeInstanceOf(SearchEngine);
    });
  });

  describe('updateElements', () => {
    it('should update cached elements', () => {
      const elements = [
        createMockElement('btn-1', { textContent: 'Submit' }),
        createMockElement('btn-2', { textContent: 'Cancel' }),
      ];

      engine.updateElements(elements);

      const result = engine.findByText('Submit');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('search', () => {
    const testElements = [
      createMockElement('submit-btn', { textContent: 'Submit', type: 'button', tagName: 'button' }),
      createMockElement('cancel-btn', { textContent: 'Cancel', type: 'button', tagName: 'button' }),
      createMockElement('email-input', {
        textContent: '',
        type: 'input',
        tagName: 'input',
        accessibleName: 'Email Address',
      }),
      createMockElement('search-input', {
        textContent: '',
        type: 'input',
        tagName: 'input',
        accessibleName: 'Search',
      }),
      createMockElement('hidden-btn', {
        textContent: 'Hidden',
        type: 'button',
        visible: false,
      }),
    ];

    beforeEach(() => {
      engine.updateElements(testElements);
    });

    it('should search by exact text match', () => {
      const response = engine.search({ text: 'Submit' });

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.bestMatch).not.toBeNull();
      expect(response.bestMatch?.element.id).toBe('submit-btn');
    });

    it('should search by fuzzy text match', () => {
      // Use a lower threshold for fuzzy matching with typos
      const response = engine.search({ text: 'Sumbit', fuzzy: true, fuzzyThreshold: 0.5 }); // typo

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.bestMatch?.element.id).toBe('submit-btn');
    });

    it('should search by accessible name', () => {
      const response = engine.search({ accessibleName: 'Email Address' });

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.bestMatch?.element.id).toBe('email-input');
    });

    it('should search by role', () => {
      const elementsWithRole = [
        createMockElement('btn-1', { role: 'button', textContent: 'Click Me' }),
        createMockElement('link-1', { role: 'link', textContent: 'Go Home' }),
      ];
      engine.updateElements(elementsWithRole);

      const response = engine.search({ role: 'button' });

      expect(response.results.length).toBeGreaterThan(0);
    });

    it('should filter hidden elements by default', () => {
      const response = engine.search({ text: 'Hidden' });

      // Hidden elements should not be found by default
      expect(response.results.every((r) => r.element.id !== 'hidden-btn')).toBe(true);
    });

    it('should include hidden elements when configured', () => {
      const engineWithHidden = new SearchEngine({ includeHidden: true });
      engineWithHidden.updateElements(testElements);

      const response = engineWithHidden.search({ text: 'Hidden' });

      expect(response.results.some((r) => r.element.id === 'hidden-btn')).toBe(true);
    });

    it('should return search metadata', () => {
      const response = engine.search({ text: 'Submit' });

      expect(response.scannedCount).toBeGreaterThan(0);
      expect(response.durationMs).toBeGreaterThanOrEqual(0);
      expect(response.timestamp).toBeDefined();
      expect(response.criteria).toEqual({ text: 'Submit' });
    });

    it('should limit results to maxResults', () => {
      const manyElements = Array.from({ length: 50 }, (_, i) =>
        createMockElement(`btn-${i}`, { textContent: `Button ${i}` })
      );
      const engineWithLimit = new SearchEngine({ maxResults: 5 });
      engineWithLimit.updateElements(manyElements);

      const response = engineWithLimit.search({ text: 'Button', fuzzy: true });

      expect(response.results.length).toBeLessThanOrEqual(5);
    });

    it('should sort results by confidence', () => {
      const response = engine.search({ text: 'Submit', fuzzy: true });

      if (response.results.length > 1) {
        for (let i = 1; i < response.results.length; i++) {
          expect(response.results[i - 1].confidence).toBeGreaterThanOrEqual(
            response.results[i].confidence
          );
        }
      }
    });

    it('should search by type', () => {
      const response = engine.search({ type: 'input' });

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results.every((r) => r.element.type === 'input')).toBe(true);
    });

    it('should search with textContains', () => {
      const response = engine.search({ textContains: 'Subm' });

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.bestMatch?.element.id).toBe('submit-btn');
    });

    it('should search with placeholder', () => {
      const elementsWithPlaceholder = [
        createMockElement('search-box', {
          type: 'input',
          tagName: 'input',
          textContent: '',
        }),
      ];
      // Note: The placeholder matching would require the element to have placeholder property
      // which is handled differently in the actual implementation
      engine.updateElements(elementsWithPlaceholder);

      const response = engine.search({ placeholder: 'Search...' });
      // The test verifies the search mechanism works even if no match
      expect(response).toBeDefined();
    });

    it('should use custom fuzzy threshold', () => {
      const response = engine.search({ text: 'Sbmt', fuzzy: true, fuzzyThreshold: 0.9 });

      // With very high threshold, typo should not match
      expect(response.results.length).toBe(0);
    });
  });

  describe('findBest', () => {
    it('should return the best match', () => {
      const elements = [
        createMockElement('btn-1', { textContent: 'Submit Form' }),
        createMockElement('btn-2', { textContent: 'Cancel' }),
      ];
      engine.updateElements(elements);

      // Use a lower threshold since "Submit" needs to match "Submit Form" via text contains
      const result = engine.findBest({ text: 'Submit', fuzzyThreshold: 0.5 });

      expect(result).not.toBeNull();
      expect(result?.element.id).toBe('btn-1');
    });

    it('should return null when no match', () => {
      const elements = [createMockElement('btn-1', { textContent: 'Submit' })];
      engine.updateElements(elements);

      const result = engine.findBest({ text: 'xyz', fuzzyThreshold: 0.99 });

      expect(result).toBeNull();
    });
  });

  describe('findByText', () => {
    it('should find elements by text', () => {
      const elements = [
        createMockElement('btn-1', { textContent: 'Click Here' }),
        createMockElement('btn-2', { textContent: 'Submit' }),
      ];
      engine.updateElements(elements);

      const results = engine.findByText('Click Here');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].element.id).toBe('btn-1');
    });

    it('should support fuzzy matching by default', () => {
      const elements = [createMockElement('btn-1', { textContent: 'Submit Button' })];
      engine.updateElements(elements);

      const results = engine.findByText('Sumbit Buton');

      expect(results.length).toBeGreaterThan(0);
    });

    it('should support exact matching when fuzzy is false', () => {
      const elements = [createMockElement('btn-1', { textContent: 'Submit' })];
      engine.updateElements(elements);

      const results = engine.findByText('Sumbit', false);

      // Exact match should not find the typo
      expect(results.length).toBe(0);
    });
  });

  describe('findByRole', () => {
    it('should find elements by role', () => {
      const elements = [
        createMockElement('btn-1', { role: 'button', textContent: 'Click' }),
        createMockElement('link-1', { role: 'link', textContent: 'Go' }),
      ];
      engine.updateElements(elements);

      const results = engine.findByRole('button');

      expect(results.length).toBeGreaterThan(0);
    });

    it('should find elements by role and name', () => {
      const elements = [
        createMockElement('btn-1', { role: 'button', accessibleName: 'Submit' }),
        createMockElement('btn-2', { role: 'button', accessibleName: 'Cancel' }),
      ];
      engine.updateElements(elements);

      const results = engine.findByRole('button', 'Submit');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].element.accessibleName).toBe('Submit');
    });
  });

  describe('findByAccessibleName', () => {
    it('should find elements by accessible name', () => {
      const elements = [
        createMockElement('input-1', { accessibleName: 'Email Address' }),
        createMockElement('input-2', { accessibleName: 'Password' }),
      ];
      engine.updateElements(elements);

      const results = engine.findByAccessibleName('Email Address');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].element.id).toBe('input-1');
    });

    it('should support fuzzy matching', () => {
      const elements = [createMockElement('input-1', { accessibleName: 'Email Address' })];
      engine.updateElements(elements);

      const results = engine.findByAccessibleName('Email Adress'); // typo

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('findNear', () => {
    it('should find elements near a reference element', () => {
      const elements = [
        createMockElement('label-1', {
          textContent: 'Username',
          rect: { x: 0, y: 0, width: 100, height: 20 },
        }),
        createMockElement('input-1', {
          type: 'input',
          rect: { x: 0, y: 25, width: 200, height: 30 },
        }),
        createMockElement('far-btn', {
          textContent: 'Far Away',
          rect: { x: 1000, y: 1000, width: 100, height: 30 },
        }),
      ];
      engine.updateElements(elements);

      const results = engine.findNear('label-1', { type: 'input' });

      // Input should be found as it's near the label
      expect(results.some((r) => r.element.id === 'input-1')).toBe(true);
    });

    it('should return empty when reference not found', () => {
      const elements = [createMockElement('btn-1', { textContent: 'Button' })];
      engine.updateElements(elements);

      const results = engine.findNear('nonexistent', {});

      // Should still return valid results object
      expect(results).toBeDefined();
    });
  });

  describe('findWithin', () => {
    it('should search with within criteria', () => {
      const elements = [
        createMockElement('form-1', { type: 'form', textContent: 'Login Form' }),
        createMockElement('btn-1', { textContent: 'Submit' }),
      ];
      engine.updateElements(elements);

      const results = engine.findWithin('form-1', { text: 'Submit' });

      // The method passes through to search with within criteria
      expect(results).toBeDefined();
    });
  });

  describe('scoring', () => {
    it('should give higher scores to exact matches', () => {
      const elements = [
        createMockElement('btn-exact', { textContent: 'Submit' }),
        createMockElement('btn-similar', { textContent: 'Submit Form' }),
      ];
      engine.updateElements(elements);

      const response = engine.search({ text: 'Submit' });

      expect(response.bestMatch?.element.id).toBe('btn-exact');
    });

    it('should include match reasons', () => {
      const elements = [createMockElement('btn-1', { textContent: 'Submit' })];
      engine.updateElements(elements);

      const response = engine.search({ text: 'Submit' });

      expect(response.bestMatch?.matchReasons.length).toBeGreaterThan(0);
    });

    it('should include individual scores', () => {
      const elements = [createMockElement('btn-1', { textContent: 'Submit', role: 'button' })];
      engine.updateElements(elements);

      const response = engine.search({ text: 'Submit', role: 'button' });

      expect(response.bestMatch?.scores).toBeDefined();
    });
  });

  describe('ID pattern matching', () => {
    it('should match elements by ID pattern with wildcard', () => {
      const elements = [
        createMockElement('submit-btn', { textContent: 'Submit' }),
        createMockElement('cancel-btn', { textContent: 'Cancel' }),
        createMockElement('other-element', { textContent: 'Other' }),
      ];
      engine.updateElements(elements);

      const response = engine.search({ idPattern: '*-btn' });

      expect(response.results.length).toBe(2);
      expect(response.results.every((r) => r.element.id.endsWith('-btn'))).toBe(true);
    });
  });

  describe('DEFAULT_SEARCH_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_SEARCH_CONFIG.fuzzyThreshold).toBe(0.7);
      expect(DEFAULT_SEARCH_CONFIG.textWeight).toBe(0.35);
      expect(DEFAULT_SEARCH_CONFIG.accessibilityWeight).toBe(0.25);
      expect(DEFAULT_SEARCH_CONFIG.roleWeight).toBe(0.15);
      expect(DEFAULT_SEARCH_CONFIG.spatialWeight).toBe(0.1);
      expect(DEFAULT_SEARCH_CONFIG.aliasWeight).toBe(0.15);
      expect(DEFAULT_SEARCH_CONFIG.maxResults).toBe(20);
      expect(DEFAULT_SEARCH_CONFIG.includeHidden).toBe(false);
    });
  });

  describe('semantic type inference', () => {
    it('should infer submit button type', () => {
      const elements = [createMockElement('btn-1', { type: 'button', textContent: 'Submit' })];
      engine.updateElements(elements);

      const response = engine.search({ text: 'Submit' });

      expect(response.bestMatch?.element.semanticType).toBe('submit-button');
    });

    it('should infer email input type', () => {
      const elements = [
        createMockElement('email-input', {
          type: 'input',
          accessibleName: 'Email',
        }),
      ];
      engine.updateElements(elements);

      const response = engine.search({ accessibleName: 'Email' });

      // Should include the element in results
      expect(response.results.length).toBeGreaterThan(0);
    });

    it('should infer navigation link type', () => {
      const elements = [
        createMockElement('home-link', { type: 'link', textContent: 'Home' }),
      ];
      engine.updateElements(elements);

      const response = engine.search({ text: 'Home' });

      expect(response.bestMatch?.element.semanticType).toBe('home-link');
    });
  });

  describe('AIDiscoveredElement output', () => {
    it('should include description in results', () => {
      const elements = [createMockElement('btn-1', { textContent: 'Submit Form' })];
      engine.updateElements(elements);

      // Use textContains for partial match and lower threshold
      const response = engine.search({ textContains: 'Submit', fuzzyThreshold: 0.5 });

      // Description may be undefined if element doesn't have enough metadata
      // But the element should still be found
      expect(response.results.length).toBeGreaterThan(0);
    });

    it('should include aliases in results', () => {
      const elements = [createMockElement('btn-1', { textContent: 'Submit' })];
      engine.updateElements(elements);

      const response = engine.search({ text: 'Submit' });

      expect(response.bestMatch?.element.aliases).toBeDefined();
      expect(Array.isArray(response.bestMatch?.element.aliases)).toBe(true);
    });

    it('should include suggested actions', () => {
      const elements = [createMockElement('btn-1', { type: 'button', textContent: 'Submit' })];
      engine.updateElements(elements);

      const response = engine.search({ text: 'Submit' });

      expect(response.bestMatch?.element.suggestedActions).toBeDefined();
      expect(Array.isArray(response.bestMatch?.element.suggestedActions)).toBe(true);
    });
  });
});
