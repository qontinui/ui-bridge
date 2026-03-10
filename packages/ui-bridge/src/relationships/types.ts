/**
 * Element Relationship Types
 *
 * Types for declaring and tracking semantic relationships between UI elements.
 * Relationships can be developer-declared (via hooks) or auto-detected from
 * ARIA attributes and HTML structure.
 */

/**
 * Well-known relationship types.
 *
 * Extensible with any string for domain-specific relationships.
 */
export type RelationshipType =
  | 'controls' // A changes B's state (toggle -> panel)
  | 'filters' // A narrows B's content (search -> list)
  | 'validates' // A shows validation state for B (error message -> input)
  | 'labels' // A names/titles B (heading -> section)
  | 'describes' // A provides detail for B (help text -> input)
  | 'submits' // A triggers submission of B (button -> form)
  | 'activates' // A makes B the active item (tab -> panel)
  | 'toggles' // A shows/hides B (button -> dropdown)
  | 'populates' // A provides data for B (data source -> display)
  | 'navigatesTo' // A navigates to B (link -> page section)
  | 'dependsOn' // A requires B's value (city select -> country select)
  | 'owns' // A logically contains B (combobox -> listbox popup)
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {}); // extensible

/**
 * Where the relationship was detected from
 */
export type RelationshipOrigin =
  | 'declared' // Developer declared via useUIRelationship hook or useUIElement options
  | 'aria' // Auto-detected from ARIA attributes (aria-controls, aria-labelledby, etc.)
  | 'html'; // Auto-detected from HTML structure (label[for], form containment, etc.)

/**
 * A semantic relationship between two UI elements
 */
export interface ElementRelationship {
  /** Source element ID (the element that has the relationship) */
  source: string;
  /** Target element ID (the element being related to) */
  target: string;
  /** Type of relationship */
  type: RelationshipType;
  /** How the relationship was detected */
  origin: RelationshipOrigin;
  /** Whether the relationship applies in both directions */
  bidirectional?: boolean;
  /** Optional metadata about the relationship */
  metadata?: Record<string, unknown>;
}

/**
 * Inline relationship declaration for useUIElement options
 */
export interface InlineRelationship {
  /** Target element ID */
  target: string;
  /** Relationship type */
  type: RelationshipType;
  /** Whether bidirectional */
  bidirectional?: boolean;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Snapshot context for ControlSnapshot integration
 */
export interface SnapshotRelationshipContext {
  /** All relationships (declared + auto-detected, deduplicated) */
  relationships: ElementRelationship[];
  /** Total count */
  count: number;
  /** Breakdown by origin */
  byOrigin: {
    declared: number;
    aria: number;
    html: number;
  };
}

/**
 * Options for the useUIRelationship hook
 */
export interface UseUIRelationshipOptions {
  /** Whether the relationship is bidirectional (default: false) */
  bidirectional?: boolean;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}
