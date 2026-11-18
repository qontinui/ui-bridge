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

import { useRef } from 'react';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { DeclaredUndoState } from '../undo/types';

/**
 * Declare undo/redo state to the UI Bridge.
 *
 * The declared state is authoritative and overrides all heuristic detection.
 * The tracker holds the options of the latest COMMITTED render, so an agent's
 * undo or redo runs that render's `onUndo` / `onRedo` and reads its stacks.
 *
 * The tracker holds ONE declaration. With several components declaring, the
 * one that committed last owns it. Unmounting a component clears the
 * declaration only while it is still that component's own, so unmounting one
 * declarer never withdraws another's.
 *
 * Under a Suspense boundary that re-suspends, the content stays mounted but is
 * hidden behind the fallback. React runs layout cleanups when it hides that
 * content and skips layout mounts while it stays hidden. So the declaration is
 * withdrawn on hide, if it is still this component's, and is not refreshed by
 * commits made while hidden. React hands it back, with the latest committed
 * options, when the content is revealed. Meanwhile an agent's undo finds
 * nothing declared and falls back to the keyboard shortcut.
 */
export function useUndoRedo(options: DeclaredUndoState): void {
  const bridge = useUIBridgeOptional();
  const tracker = bridge?.undoTracker;
  // The object this component last handed the tracker. The cleanup below
  // compares it with what the tracker holds before clearing anything.
  const declaredRef = useRef<DeclaredUndoState | null>(null);

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
    if (!tracker) return;
    declaredRef.current = options;
    tracker.setDeclaredState(options);
  });

  // Clear the declaration on unmount (and on a Suspense hide), and from the old
  // tracker if the provider ever hands over a new one. Clear it only while the
  // tracker still holds this component's own object: another declarer that
  // committed later owns it now. This runs at commit too, so an unmounted
  // component's handler is never run in the passive gap. `declaredRef` is read
  // at cleanup time on purpose, because it holds the latest committed
  // declaration rather than the one from when the tracker last changed.
  useIsomorphicLayoutEffect(() => {
    if (!tracker) return;
    return () => {
      if (tracker.getDeclaredState() === declaredRef.current) {
        tracker.setDeclaredState(null);
      }
    };
  }, [tracker]);
}
