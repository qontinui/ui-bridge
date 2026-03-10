/**
 * UI Bridge Undo/Redo Awareness Module
 *
 * Detects and tracks undo/redo availability by scanning the DOM on demand
 * and correlating with bridge action history. Supports developer-declared
 * state via the useUndoRedo hook for authoritative undo stack information.
 */

export { UndoDetector } from './undo-detector';
export type { UndoDetectionResult } from './undo-detector';
export { UndoTracker } from './undo-tracker';
export type {
  UndoDetectionSource,
  UndoEntry,
  UndoElementInfo,
  UndoRedoState,
  SnapshotUndoContext,
  UndoDetectorConfig,
  UndoTrackerConfig,
  DeclaredUndoState,
} from './types';
