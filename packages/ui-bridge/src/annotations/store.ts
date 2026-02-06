/**
 * Annotation Store
 *
 * In-memory store for element annotations with CRUD operations,
 * import/export, coverage tracking, and event emission.
 */

import type {
  ElementAnnotation,
  AnnotationConfig,
  AnnotationCoverage,
  AnnotationEvent,
} from './types';
import { ANNOTATION_CONFIG_VERSION } from './types';

/**
 * Listener function for annotation events.
 */
export type AnnotationListener = (event: AnnotationEvent) => void;

/**
 * Annotation Store
 *
 * Stores element annotations in memory with event-driven updates.
 * Provides CRUD operations, import/export, coverage tracking, and
 * an event system for reacting to annotation changes.
 *
 * @example Basic CRUD usage
 * ```ts
 * const store = new AnnotationStore();
 *
 * // Set an annotation
 * store.set('login-btn', {
 *   description: 'Primary login button',
 *   purpose: 'Submits the login form',
 *   tags: ['auth', 'primary-action'],
 * });
 *
 * // Read it back
 * const annotation = store.get('login-btn');
 * console.log(annotation?.description); // 'Primary login button'
 *
 * // Check existence
 * store.has('login-btn'); // true
 *
 * // Delete it
 * store.delete('login-btn'); // true
 * ```
 *
 * @example Import/export workflow
 * ```ts
 * const store = new AnnotationStore();
 *
 * // Import from a config file
 * const config = JSON.parse(fs.readFileSync('annotations.json', 'utf-8'));
 * const count = store.importConfig(config);
 * console.log(`Imported ${count} annotations`);
 *
 * // Export current state
 * const exported = store.exportConfig({ appName: 'MyApp' });
 * fs.writeFileSync('annotations.json', JSON.stringify(exported, null, 2));
 * ```
 *
 * @example Listening for changes
 * ```ts
 * const store = new AnnotationStore();
 *
 * const unsubscribe = store.on((event) => {
 *   switch (event.type) {
 *     case 'annotation:set':
 *       console.log(`Updated: ${event.elementId}`);
 *       break;
 *     case 'annotation:deleted':
 *       console.log(`Deleted: ${event.elementId}`);
 *       break;
 *     case 'annotation:imported':
 *       console.log(`Imported ${event.count} annotations`);
 *       break;
 *     case 'annotation:cleared':
 *       console.log('All annotations cleared');
 *       break;
 *   }
 * });
 *
 * // Later, stop listening
 * unsubscribe();
 * ```
 */
export class AnnotationStore {
  private store = new Map<string, ElementAnnotation>();
  private listeners = new Set<AnnotationListener>();

  /**
   * Get an annotation by element ID.
   */
  get(elementId: string): ElementAnnotation | undefined {
    return this.store.get(elementId);
  }

  /**
   * Get all annotations as a record.
   */
  getAll(): Record<string, ElementAnnotation> {
    const result: Record<string, ElementAnnotation> = {};
    for (const [id, annotation] of this.store) {
      result[id] = annotation;
    }
    return result;
  }

  /**
   * Set an annotation for an element. Auto-sets `updatedAt`.
   */
  set(elementId: string, annotation: ElementAnnotation): void {
    const updated: ElementAnnotation = {
      ...annotation,
      updatedAt: Date.now(),
    };
    this.store.set(elementId, updated);
    this.emit({
      type: 'annotation:set',
      elementId,
      annotation: updated,
      timestamp: Date.now(),
    });
  }

  /**
   * Delete an annotation by element ID.
   *
   * @returns true if the annotation existed and was deleted
   */
  delete(elementId: string): boolean {
    const existed = this.store.delete(elementId);
    if (existed) {
      this.emit({
        type: 'annotation:deleted',
        elementId,
        timestamp: Date.now(),
      });
    }
    return existed;
  }

  /**
   * Check if an annotation exists for an element.
   */
  has(elementId: string): boolean {
    return this.store.has(elementId);
  }

  /**
   * Get the number of stored annotations.
   */
  get count(): number {
    return this.store.size;
  }

  /**
   * Clear all annotations.
   */
  clear(): void {
    this.store.clear();
    this.emit({
      type: 'annotation:cleared',
      timestamp: Date.now(),
    });
  }

  /**
   * Import annotations from a config object.
   *
   * Merges with existing annotations (new values overwrite per element ID).
   *
   * @returns Number of annotations imported
   *
   * @example
   * ```ts
   * const config: AnnotationConfig = {
   *   version: '1.0.0',
   *   annotations: {
   *     'btn-1': { description: 'Submit button', tags: ['form'] },
   *     'input-1': { description: 'Name field' },
   *   },
   * };
   * const count = store.importConfig(config); // 2
   * ```
   */
  importConfig(config: AnnotationConfig): number {
    let count = 0;
    for (const [id, annotation] of Object.entries(config.annotations)) {
      this.store.set(id, {
        ...annotation,
        updatedAt: annotation.updatedAt ?? Date.now(),
      });
      count++;
    }
    this.emit({
      type: 'annotation:imported',
      count,
      timestamp: Date.now(),
    });
    return count;
  }

  /**
   * Export all annotations as a config object.
   *
   * The returned object can be serialized to JSON and saved to a file,
   * then later re-imported with {@link importConfig}.
   *
   * @param metadata - Optional metadata to include (appName, description, etc.)
   * @returns AnnotationConfig with all current annotations
   *
   * @example
   * ```ts
   * const config = store.exportConfig({ appName: 'MyApp' });
   * // config.version === '1.0.0'
   * // config.annotations === { 'btn-1': { ... }, 'input-1': { ... } }
   * // config.metadata === { appName: 'MyApp', exportedAt: 1706900000000 }
   *
   * // Save to file
   * fs.writeFileSync('annotations.json', JSON.stringify(config, null, 2));
   * ```
   */
  exportConfig(metadata?: AnnotationConfig['metadata']): AnnotationConfig {
    return {
      version: ANNOTATION_CONFIG_VERSION,
      annotations: this.getAll(),
      metadata: {
        ...metadata,
        exportedAt: Date.now(),
      },
    };
  }

  /**
   * Compute annotation coverage against a set of known element IDs.
   *
   * Compares the store's annotations against the provided list of element IDs
   * to determine what percentage of elements have been annotated.
   *
   * @param allElementIds - Array of all known element IDs in the UI
   * @returns Coverage statistics including percentages and lists of annotated/unannotated IDs
   *
   * @example
   * ```ts
   * store.set('btn-1', { description: 'Submit' });
   * store.set('input-1', { description: 'Name' });
   *
   * const coverage = store.getCoverage(['btn-1', 'input-1', 'input-2', 'link-1']);
   * // coverage.totalElements === 4
   * // coverage.annotatedElements === 2
   * // coverage.coveragePercent === 50
   * // coverage.annotatedIds === ['btn-1', 'input-1']
   * // coverage.unannotatedIds === ['input-2', 'link-1']
   * ```
   */
  getCoverage(allElementIds: string[]): AnnotationCoverage {
    const annotatedIds: string[] = [];
    const unannotatedIds: string[] = [];

    for (const id of allElementIds) {
      if (this.store.has(id)) {
        annotatedIds.push(id);
      } else {
        unannotatedIds.push(id);
      }
    }

    const total = allElementIds.length;
    return {
      totalElements: total,
      annotatedElements: annotatedIds.length,
      coveragePercent: total > 0 ? (annotatedIds.length / total) * 100 : 0,
      annotatedIds,
      unannotatedIds,
      timestamp: Date.now(),
    };
  }

  /**
   * Subscribe to annotation events.
   *
   * The listener is called whenever annotations are set, deleted, imported,
   * or cleared. Returns an unsubscribe function to stop listening.
   *
   * @param listener - Callback function receiving {@link AnnotationEvent} objects
   * @returns Unsubscribe function - call it to remove the listener
   *
   * @example
   * ```ts
   * const unsubscribe = store.on((event) => {
   *   if (event.type === 'annotation:set') {
   *     console.log(`Element ${event.elementId} annotated:`, event.annotation);
   *   }
   * });
   *
   * store.set('btn-1', { description: 'Submit' });
   * // Logs: "Element btn-1 annotated: { description: 'Submit', updatedAt: ... }"
   *
   * unsubscribe(); // Stop listening
   * ```
   */
  on(listener: AnnotationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Emit an event to all listeners.
   */
  private emit(event: AnnotationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors break the store
      }
    }
  }
}

// Global singleton
let globalStore: AnnotationStore | null = null;

/**
 * Get the global annotation store singleton.
 */
export function getGlobalAnnotationStore(): AnnotationStore {
  if (!globalStore) {
    globalStore = new AnnotationStore();
  }
  return globalStore;
}

/**
 * Reset the global annotation store (primarily for testing).
 */
export function resetGlobalAnnotationStore(): void {
  globalStore = null;
}
