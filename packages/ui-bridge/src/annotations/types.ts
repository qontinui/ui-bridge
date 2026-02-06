/**
 * Annotation Types
 *
 * Types for the semantic annotation system that allows developers
 * to attach rich human-authored context to UI elements.
 */

/**
 * Annotation for a single UI element.
 *
 * All fields are optional - annotate only what's useful.
 * Annotations provide human-authored semantic context that enriches
 * the UI Bridge's understanding of elements beyond what can be
 * inferred from the DOM alone.
 *
 * @example Basic annotation for a button
 * ```ts
 * const annotation: ElementAnnotation = {
 *   description: 'Primary login button',
 *   purpose: 'Submits the login form and authenticates the user',
 *   tags: ['auth', 'primary-action'],
 * };
 * store.set('login-btn', annotation);
 * ```
 *
 * @example Detailed annotation with relationships and metadata
 * ```ts
 * const annotation: ElementAnnotation = {
 *   description: 'Email input field',
 *   purpose: 'Collects the user email for authentication',
 *   notes: 'Validates email format on blur. Shows inline error below the field.',
 *   tags: ['auth', 'form-input', 'required'],
 *   relatedElements: ['email-label', 'email-error', 'login-btn'],
 *   metadata: { validationPattern: '^[^@]+@[^@]+\\.[^@]+$' },
 *   author: 'design-team',
 * };
 * ```
 */
export interface ElementAnnotation {
  /** Human-readable description of what this element is */
  description?: string;
  /** Why this element exists / what it's for */
  purpose?: string;
  /** Behavioral notes, edge cases, or caveats */
  notes?: string;
  /** Searchable tags for categorization */
  tags?: string[];
  /** IDs of related elements (e.g., a label and its input) */
  relatedElements?: string[];
  /** Arbitrary key-value metadata */
  metadata?: Record<string, unknown>;
  /** Timestamp of last update (auto-set by store) */
  updatedAt?: number;
  /** Author of this annotation */
  author?: string;
}

/**
 * Annotation configuration file format.
 *
 * This is the import/export format - a JSON file with version and annotations map.
 * Use `AnnotationStore.exportConfig()` to generate this object, and
 * `AnnotationStore.importConfig()` to load it back.
 *
 * @example JSON file format (`annotations.json`)
 * ```json
 * {
 *   "version": "1.0.0",
 *   "annotations": {
 *     "login-btn": {
 *       "description": "Primary login button",
 *       "purpose": "Submits the login form",
 *       "tags": ["auth", "primary-action"]
 *     },
 *     "email-input": {
 *       "description": "Email address input",
 *       "purpose": "Collects user email for authentication",
 *       "relatedElements": ["email-label", "email-error"]
 *     }
 *   },
 *   "metadata": {
 *     "appName": "MyApp",
 *     "description": "Annotations for the login page"
 *   }
 * }
 * ```
 */
export interface AnnotationConfig {
  /** Config format version */
  version: string;
  /** Map of element ID to annotation */
  annotations: Record<string, ElementAnnotation>;
  /** Optional file-level metadata */
  metadata?: {
    appName?: string;
    exportedAt?: number;
    description?: string;
  };
}

/**
 * Annotation coverage statistics.
 */
export interface AnnotationCoverage {
  /** Total elements known to the system */
  totalElements: number;
  /** Elements that have annotations */
  annotatedElements: number;
  /** Coverage as a percentage (0-100) */
  coveragePercent: number;
  /** IDs of annotated elements */
  annotatedIds: string[];
  /** IDs of unannotated elements */
  unannotatedIds: string[];
  /** When this coverage was computed */
  timestamp: number;
}

/**
 * Event types emitted by the annotation store.
 */
export type AnnotationEventType =
  | 'annotation:set'
  | 'annotation:deleted'
  | 'annotation:imported'
  | 'annotation:cleared';

/**
 * Event payload for annotation store events.
 */
export interface AnnotationEvent {
  type: AnnotationEventType;
  elementId?: string;
  annotation?: ElementAnnotation;
  count?: number;
  timestamp: number;
}

/** Current annotation config version */
export const ANNOTATION_CONFIG_VERSION = '1.0.0';
