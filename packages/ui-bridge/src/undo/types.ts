/**
 * Undo/Redo Awareness Types
 *
 * Types for detecting and tracking undo/redo availability in the UI.
 */

/**
 * How the undo/redo capability was detected
 */
export type UndoDetectionSource =
  | 'dom-element'
  | 'exec-command'
  | 'shortcut'
  | 'developer-declared';

/**
 * A single undo or redo stack entry
 */
export interface UndoEntry {
  /** Human-readable description of what this entry represents */
  description: string;
  /** How this entry was detected */
  source: UndoDetectionSource;
  /** Bridge action ID that caused this entry (if correlated from action history) */
  actionId?: string;
  /** Confidence level 0–1 */
  confidence: number;
  /** Timestamp when this entry was recorded */
  timestamp: number;
}

/**
 * Information about a detected undo/redo DOM element (button, menu item, etc.)
 */
export interface UndoElementInfo {
  /** CSS selector that targets this element */
  selector: string;
  /** Whether the element is currently enabled (not disabled/aria-disabled) */
  enabled: boolean;
  /** Label text (aria-label, title, textContent) */
  label?: string;
  /** Description parsed from the label (e.g., "Typing" from "Undo Typing") */
  parsedDescription?: string;
}

/**
 * Full undo/redo state
 */
export interface UndoRedoState {
  /** Whether undo appears to be available */
  undoAvailable: boolean;
  /** Whether redo appears to be available */
  redoAvailable: boolean;
  /** Description of what undo would reverse (if determinable) */
  undoDescription?: string;
  /** Description of what redo would restore (if determinable) */
  redoDescription?: string;
  /** Undo stack depth (if known — usually only from developer declaration) */
  undoDepth?: number;
  /** Redo stack depth (if known — usually only from developer declaration) */
  redoDepth?: number;
  /** Known undo entries (most recent first) */
  undoStack: UndoEntry[];
  /** Known redo entries (most recent first) */
  redoStack: UndoEntry[];
  /** How the state was detected */
  detectionSources: UndoDetectionSource[];
  /** Keyboard shortcut to trigger undo (if known) */
  undoShortcut?: string;
  /** Keyboard shortcut to trigger redo (if known) */
  redoShortcut?: string;
  /** Detected undo DOM element */
  undoElement?: UndoElementInfo;
  /** Detected redo DOM element */
  redoElement?: UndoElementInfo;
  /** Timestamp of this state snapshot */
  timestamp: number;
}

/**
 * Snapshot context for ControlSnapshot integration
 */
export interface SnapshotUndoContext {
  /** Whether undo appears to be available */
  undoAvailable: boolean;
  /** Whether redo appears to be available */
  redoAvailable: boolean;
  /** Description of what undo would reverse */
  undoDescription?: string;
  /** Description of what redo would restore */
  redoDescription?: string;
  /** Undo stack depth (if known) */
  undoDepth?: number;
  /** Redo stack depth (if known) */
  redoDepth?: number;
  /** Human-readable summary for AI */
  summary: string;
}

/**
 * Configuration for the undo detector
 */
export interface UndoDetectorConfig {
  /** Additional CSS selectors to check for undo buttons/elements */
  customUndoSelectors?: string[];
  /** Additional CSS selectors to check for redo buttons/elements */
  customRedoSelectors?: string[];
  /** Whether to use document.execCommand probe (default: true) */
  useExecCommand?: boolean;
}

/**
 * Developer-declared undo/redo state (via useUndoRedo hook)
 */
export interface DeclaredUndoState {
  /** Whether undo is currently available */
  canUndo: boolean;
  /** Whether redo is currently available */
  canRedo: boolean;
  /** Description of next undo */
  undoDescription?: string;
  /** Description of next redo */
  redoDescription?: string;
  /** Full undo stack descriptions (most recent first) */
  undoStack?: string[];
  /** Full redo stack descriptions (most recent first) */
  redoStack?: string[];
  /** Execute undo programmatically */
  onUndo?: () => void;
  /** Execute redo programmatically */
  onRedo?: () => void;
}

/**
 * Configuration for the undo tracker
 */
export interface UndoTrackerConfig {
  /** Maximum number of action-correlated entries to keep */
  maxActionEntries?: number;
  /** Detector configuration */
  detectorConfig?: UndoDetectorConfig;
}
