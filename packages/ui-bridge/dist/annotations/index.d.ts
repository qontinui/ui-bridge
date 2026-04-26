import { c as AnnotationEvent, E as ElementAnnotation, A as AnnotationConfig, a as AnnotationCoverage } from '../types-C7D5seeQ.js';
export { b as ANNOTATION_CONFIG_VERSION, d as AnnotationEventType } from '../types-C7D5seeQ.js';

/**
 * Annotation Store
 *
 * In-memory store for element annotations with CRUD operations,
 * import/export, coverage tracking, and event emission.
 */

/**
 * Listener function for annotation events.
 */
type AnnotationListener = (event: AnnotationEvent) => void;
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
declare class AnnotationStore {
    private store;
    private listeners;
    /**
     * Get an annotation by element ID.
     */
    get(elementId: string): ElementAnnotation | undefined;
    /**
     * Get all annotations as a record.
     */
    getAll(): Record<string, ElementAnnotation>;
    /**
     * Set an annotation for an element. Auto-sets `updatedAt`.
     */
    set(elementId: string, annotation: ElementAnnotation): void;
    /**
     * Delete an annotation by element ID.
     *
     * @returns true if the annotation existed and was deleted
     */
    delete(elementId: string): boolean;
    /**
     * Check if an annotation exists for an element.
     */
    has(elementId: string): boolean;
    /**
     * Get the number of stored annotations.
     */
    get count(): number;
    /**
     * Clear all annotations.
     */
    clear(): void;
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
    importConfig(config: AnnotationConfig): number;
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
    exportConfig(metadata?: AnnotationConfig['metadata']): AnnotationConfig;
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
    getCoverage(allElementIds: string[]): AnnotationCoverage;
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
    on(listener: AnnotationListener): () => void;
    /**
     * Emit an event to all listeners.
     */
    private emit;
}
/**
 * Get the global annotation store singleton.
 */
declare function getGlobalAnnotationStore(): AnnotationStore;
/**
 * Reset the global annotation store (primarily for testing).
 */
declare function resetGlobalAnnotationStore(): void;

export { AnnotationConfig, AnnotationCoverage, AnnotationEvent, type AnnotationListener, AnnotationStore, ElementAnnotation, getGlobalAnnotationStore, resetGlobalAnnotationStore };
