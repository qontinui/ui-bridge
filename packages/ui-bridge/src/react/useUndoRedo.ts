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

import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { DeclaredUndoState } from '../undo/types';

/**
 * Declare undo/redo state to the UI Bridge.
 *
 * The declared state is authoritative and overrides all heuristic detection.
 * The tracker holds the options of the latest COMMITTED render, so an agent's
 * undo or redo runs that render's `onUndo` / `onRedo` and reads its stacks.
 * When the component unmounts, the declaration is cleared.
 */
export function useUndoRedo(options: DeclaredUndoState): void {
  const bridge = useUIBridgeOptional();
  const tracker = bridge?.undoTracker;

  // Hand the tracker this commit's options on EVERY commit. The tracker keeps
  // the object by reference, and `executeUndo` / `executeRedo` (reached by
  // `POST /control/undo|redo`) call its `onUndo` / `onRedo` at call time. So a
  // declaration refreshed only when `canUndo`, `canRedo` or a description
  // changed ran a stale closure and served stale stacks for as long as those
  // held still. `setDeclaredState` is a pointer write that emits nothing, so
  // it is cheap to run on every commit. It is a layout effect, not a passive
  // one: a call that arrives after the commit and before the passive flush
  // must not run the previous render's handler.
  useIsomorphicLayoutEffect(() => {
    tracker?.setDeclaredState(options);
  });

  // Clear the declaration on unmount, and from the old tracker if the provider
  // ever hands over a new one. This also runs at commit, so an unmounted
  // component's handler is never run in the passive gap.
  useIsomorphicLayoutEffect(() => {
    if (!tracker) return;
    return () => {
      tracker.setDeclaredState(null);
    };
  }, [tracker]);
}
