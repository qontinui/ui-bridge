/**
 * useUndoRedo Hook
 *
 * Allows developers to declare their application's undo/redo state
 * to the UI Bridge. This provides authoritative undo stack information
 * that overrides heuristic DOM detection.
 *
 * Usage:
 * ```tsx
 * function MyEditor() {
 *   const { canUndo, canRedo, undo, redo, undoStack } = useMyUndoSystem();
 *
 *   useUndoRedo({
 *     canUndo,
 *     canRedo,
 *     undoDescription: undoStack[0]?.description,
 *     undoStack: undoStack.map(e => e.description),
 *     onUndo: undo,
 *     onRedo: redo,
 *   });
 *
 *   return <div>...</div>;
 * }
 * ```
 */

import { useEffect, useRef } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { DeclaredUndoState } from '../undo/types';

/**
 * Declare undo/redo state to the UI Bridge.
 *
 * The declared state is authoritative and overrides all heuristic detection.
 * When the component unmounts, the declaration is cleared.
 */
export function useUndoRedo(options: DeclaredUndoState): void {
  const bridge = useUIBridgeOptional();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!bridge?.undoTracker) return;

    bridge.undoTracker.setDeclaredState(optionsRef.current);

    return () => {
      bridge.undoTracker?.setDeclaredState(null);
    };
  }, [bridge]);

  // Update declared state when options change
  useEffect(() => {
    if (!bridge?.undoTracker) return;
    bridge.undoTracker.setDeclaredState(options);
  }, [
    bridge,
    options.canUndo,
    options.canRedo,
    options.undoDescription,
    options.redoDescription,
    // Intentionally not including undoStack/redoStack/onUndo/onRedo
    // to avoid excessive re-renders — the ref captures them
  ]);
}
