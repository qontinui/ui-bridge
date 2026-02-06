/**
 * Annotation Store Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnnotationStore, getGlobalAnnotationStore, resetGlobalAnnotationStore } from './store';
import type { ElementAnnotation, AnnotationConfig } from './types';
import { ANNOTATION_CONFIG_VERSION } from './types';

describe('AnnotationStore', () => {
  let store: AnnotationStore;

  beforeEach(() => {
    store = new AnnotationStore();
    resetGlobalAnnotationStore();
  });

  describe('CRUD operations', () => {
    it('should store an annotation with auto-set updatedAt via set()', () => {
      const annotation: ElementAnnotation = {
        description: 'A submit button',
        purpose: 'Submits the form',
      };
      const before = Date.now();
      store.set('btn-submit', annotation);
      const after = Date.now();

      const stored = store.get('btn-submit');
      expect(stored).toBeDefined();
      expect(stored!.description).toBe('A submit button');
      expect(stored!.purpose).toBe('Submits the form');
      expect(stored!.updatedAt).toBeGreaterThanOrEqual(before);
      expect(stored!.updatedAt).toBeLessThanOrEqual(after);
    });

    it('should retrieve an annotation with get()', () => {
      store.set('email-input', { description: 'Email field' });
      const result = store.get('email-input');
      expect(result).toBeDefined();
      expect(result!.description).toBe('Email field');
    });

    it('should return undefined for missing annotation via get()', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });

    it('should return true from has() for existing annotation', () => {
      store.set('btn-1', { description: 'Button' });
      expect(store.has('btn-1')).toBe(true);
    });

    it('should return false from has() for missing annotation', () => {
      expect(store.has('missing')).toBe(false);
    });

    it('should delete an existing annotation and return true', () => {
      store.set('btn-1', { description: 'Button' });
      const result = store.delete('btn-1');
      expect(result).toBe(true);
      expect(store.has('btn-1')).toBe(false);
      expect(store.get('btn-1')).toBeUndefined();
    });

    it('should return false when deleting a missing annotation', () => {
      const result = store.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('should report correct count', () => {
      expect(store.count).toBe(0);
      store.set('a', { description: 'A' });
      expect(store.count).toBe(1);
      store.set('b', { description: 'B' });
      expect(store.count).toBe(2);
      store.delete('a');
      expect(store.count).toBe(1);
    });

    it('should clear all annotations', () => {
      store.set('a', { description: 'A' });
      store.set('b', { description: 'B' });
      store.set('c', { description: 'C' });
      expect(store.count).toBe(3);

      store.clear();
      expect(store.count).toBe(0);
      expect(store.has('a')).toBe(false);
      expect(store.has('b')).toBe(false);
      expect(store.has('c')).toBe(false);
    });
  });

  describe('getAll()', () => {
    it('should return all annotations as a record', () => {
      store.set('btn-1', { description: 'Button 1' });
      store.set('btn-2', { description: 'Button 2', tags: ['primary'] });

      const all = store.getAll();

      expect(Object.keys(all)).toHaveLength(2);
      expect(all['btn-1']).toBeDefined();
      expect(all['btn-1'].description).toBe('Button 1');
      expect(all['btn-2']).toBeDefined();
      expect(all['btn-2'].description).toBe('Button 2');
      expect(all['btn-2'].tags).toEqual(['primary']);
    });

    it('should return an empty record when store is empty', () => {
      const all = store.getAll();
      expect(Object.keys(all)).toHaveLength(0);
    });
  });

  describe('events', () => {
    it('should emit annotation:set event on set()', () => {
      const listener = vi.fn();
      store.on(listener);

      store.set('btn-1', { description: 'Test' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'annotation:set',
          elementId: 'btn-1',
          annotation: expect.objectContaining({
            description: 'Test',
          }),
          timestamp: expect.any(Number),
        })
      );
    });

    it('should emit annotation:deleted event on delete()', () => {
      const listener = vi.fn();
      store.set('btn-1', { description: 'Test' });

      store.on(listener);
      store.delete('btn-1');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'annotation:deleted',
          elementId: 'btn-1',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should not emit annotation:deleted when deleting missing element', () => {
      const listener = vi.fn();
      store.on(listener);

      store.delete('nonexistent');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should emit annotation:imported event on importConfig()', () => {
      const listener = vi.fn();
      store.on(listener);

      const config: AnnotationConfig = {
        version: ANNOTATION_CONFIG_VERSION,
        annotations: {
          'btn-1': { description: 'Button 1' },
          'btn-2': { description: 'Button 2' },
        },
      };

      store.importConfig(config);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'annotation:imported',
          count: 2,
          timestamp: expect.any(Number),
        })
      );
    });

    it('should emit annotation:cleared event on clear()', () => {
      const listener = vi.fn();
      store.set('btn-1', { description: 'Test' });

      store.on(listener);
      store.clear();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'annotation:cleared',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should stop receiving events after unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = store.on(listener);

      store.set('btn-1', { description: 'First' });
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      store.set('btn-2', { description: 'Second' });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('import/export roundtrip', () => {
    it('should export a valid config with version and annotations', () => {
      store.set('btn-1', { description: 'Button 1' });
      store.set('input-1', { description: 'Input 1', tags: ['form'] });

      const config = store.exportConfig();

      expect(config.version).toBe(ANNOTATION_CONFIG_VERSION);
      expect(Object.keys(config.annotations)).toHaveLength(2);
      expect(config.annotations['btn-1'].description).toBe('Button 1');
      expect(config.annotations['input-1'].tags).toEqual(['form']);
      expect(config.metadata).toBeDefined();
      expect(config.metadata!.exportedAt).toBeGreaterThan(0);
    });

    it('should export with custom metadata', () => {
      store.set('btn-1', { description: 'Button' });

      const config = store.exportConfig({
        appName: 'TestApp',
        description: 'Test export',
      });

      expect(config.metadata!.appName).toBe('TestApp');
      expect(config.metadata!.description).toBe('Test export');
      expect(config.metadata!.exportedAt).toBeGreaterThan(0);
    });

    it('should import annotations from a config and return count', () => {
      const config: AnnotationConfig = {
        version: ANNOTATION_CONFIG_VERSION,
        annotations: {
          'btn-1': { description: 'Button 1' },
          'btn-2': { description: 'Button 2', purpose: 'Submit' },
        },
      };

      const count = store.importConfig(config);

      expect(count).toBe(2);
      expect(store.count).toBe(2);
      expect(store.get('btn-1')!.description).toBe('Button 1');
      expect(store.get('btn-2')!.purpose).toBe('Submit');
    });

    it('should merge imported annotations with existing ones', () => {
      store.set('existing', { description: 'Already here' });

      const config: AnnotationConfig = {
        version: ANNOTATION_CONFIG_VERSION,
        annotations: {
          'new-one': { description: 'Imported' },
          existing: { description: 'Overwritten' },
        },
      };

      const count = store.importConfig(config);

      expect(count).toBe(2);
      expect(store.count).toBe(2);
      expect(store.get('existing')!.description).toBe('Overwritten');
      expect(store.get('new-one')!.description).toBe('Imported');
    });

    it('should roundtrip export then import', () => {
      store.set('btn-1', { description: 'Button 1', tags: ['primary'] });
      store.set('input-1', { description: 'Input 1' });

      const exported = store.exportConfig({ appName: 'MyApp' });

      const newStore = new AnnotationStore();
      const count = newStore.importConfig(exported);

      expect(count).toBe(2);
      expect(newStore.get('btn-1')!.description).toBe('Button 1');
      expect(newStore.get('btn-1')!.tags).toEqual(['primary']);
      expect(newStore.get('input-1')!.description).toBe('Input 1');
    });
  });

  describe('getCoverage()', () => {
    it('should compute correct coverage with some annotated elements', () => {
      store.set('btn-1', { description: 'Button 1' });
      store.set('btn-2', { description: 'Button 2' });

      const coverage = store.getCoverage(['btn-1', 'btn-2', 'btn-3', 'btn-4']);

      expect(coverage.totalElements).toBe(4);
      expect(coverage.annotatedElements).toBe(2);
      expect(coverage.coveragePercent).toBe(50);
      expect(coverage.annotatedIds).toEqual(['btn-1', 'btn-2']);
      expect(coverage.unannotatedIds).toEqual(['btn-3', 'btn-4']);
      expect(coverage.timestamp).toBeGreaterThan(0);
    });

    it('should return 0% coverage when no annotations exist', () => {
      const coverage = store.getCoverage(['a', 'b', 'c']);

      expect(coverage.totalElements).toBe(3);
      expect(coverage.annotatedElements).toBe(0);
      expect(coverage.coveragePercent).toBe(0);
      expect(coverage.annotatedIds).toEqual([]);
      expect(coverage.unannotatedIds).toEqual(['a', 'b', 'c']);
    });

    it('should return 100% coverage when all elements are annotated', () => {
      store.set('a', { description: 'A' });
      store.set('b', { description: 'B' });

      const coverage = store.getCoverage(['a', 'b']);

      expect(coverage.totalElements).toBe(2);
      expect(coverage.annotatedElements).toBe(2);
      expect(coverage.coveragePercent).toBe(100);
      expect(coverage.annotatedIds).toEqual(['a', 'b']);
      expect(coverage.unannotatedIds).toEqual([]);
    });

    it('should handle empty element list', () => {
      store.set('btn-1', { description: 'Button' });

      const coverage = store.getCoverage([]);

      expect(coverage.totalElements).toBe(0);
      expect(coverage.annotatedElements).toBe(0);
      expect(coverage.coveragePercent).toBe(0);
      expect(coverage.annotatedIds).toEqual([]);
      expect(coverage.unannotatedIds).toEqual([]);
    });
  });

  describe('global annotation store', () => {
    it('should return a singleton via getGlobalAnnotationStore()', () => {
      const store1 = getGlobalAnnotationStore();
      const store2 = getGlobalAnnotationStore();
      expect(store1).toBe(store2);
    });

    it('should create a fresh store after resetGlobalAnnotationStore()', () => {
      const store1 = getGlobalAnnotationStore();
      store1.set('btn-1', { description: 'Test' });

      resetGlobalAnnotationStore();

      const store2 = getGlobalAnnotationStore();
      expect(store2).not.toBe(store1);
      expect(store2.count).toBe(0);
    });
  });
});
