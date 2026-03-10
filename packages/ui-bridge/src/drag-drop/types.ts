/**
 * Drag-and-Drop Discovery Types
 *
 * Types for detecting and reporting drag sources, drop zones, and their
 * relationships. Supports developer-declared, ARIA-detected, and
 * CSS/DOM heuristic-detected drag-drop patterns.
 */

/**
 * Where the drag-drop information was detected from
 */
export type DragDropOrigin =
  | 'declared' // Developer declared via useDragSource/useDropZone hooks
  | 'aria' // Auto-detected from ARIA attributes (aria-grabbed, aria-dropeffect)
  | 'dom'; // Auto-detected from DOM attributes/CSS (draggable, cursor-grab, etc.)

/**
 * The type of drag operation
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export type DragEffect = 'move' | 'copy' | 'link' | 'reorder' | (string & {});

/**
 * A detected drag source element
 */
export interface DragSourceInfo {
  /** UI Bridge element ID */
  id: string;
  /** Human-readable label (from aria-label, textContent, etc.) */
  label?: string;
  /** The kind of data this source represents (e.g., 'workflow-step', 'file', 'list-item') */
  dataType?: string;
  /** How it was detected */
  origin: DragDropOrigin;
  /** Whether the element has native draggable="true" */
  nativeDraggable: boolean;
  /** Whether a grab cursor was detected (CSS heuristic) */
  hasGrabCursor: boolean;
  /** Optional developer-provided metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A detected drop zone element
 */
export interface DropZoneInfo {
  /** UI Bridge element ID */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Data types this zone accepts (if declared) */
  accepts?: string[];
  /** The effect when dropped here */
  effect?: DragEffect;
  /** How it was detected */
  origin: DragDropOrigin;
  /** ARIA dropeffect value, if present */
  ariaDropEffect?: string;
  /** Whether this is a sortable container (contains multiple draggable children) */
  isSortable: boolean;
  /** IDs of draggable children contained in this zone */
  containedDragSources?: string[];
  /** Optional developer-provided metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Snapshot context for ControlSnapshot integration
 */
export interface SnapshotDragDropContext {
  /** Detected drag source elements */
  dragSources: DragSourceInfo[];
  /** Detected drop zones */
  dropZones: DropZoneInfo[];
  /** Summary counts */
  count: {
    dragSources: number;
    dropZones: number;
  };
  /** Breakdown by detection origin */
  byOrigin: {
    declared: number;
    aria: number;
    dom: number;
  };
}

/**
 * Options for the useDragSource hook
 */
export interface UseDragSourceOptions {
  /** The kind of data this source represents */
  dataType?: string;
  /** Human-readable label */
  label?: string;
  /** Optional metadata about the drag source */
  metadata?: Record<string, unknown>;
}

/**
 * Options for the useDropZone hook
 */
export interface UseDropZoneOptions {
  /** Data types this zone accepts */
  accepts?: string[];
  /** The effect when dropped here */
  effect?: DragEffect;
  /** Human-readable label */
  label?: string;
  /** Optional metadata about the drop zone */
  metadata?: Record<string, unknown>;
}
