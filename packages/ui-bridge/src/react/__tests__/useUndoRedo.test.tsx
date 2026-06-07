/**
 * useUndoRedo Hook Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUndoRedo } from '../useUndoRedo';
import type { UIBridgeContextValue } from '../UIBridgeProvider';
import type { DeclaredUndoState } from '../../undo/types';

// Mock the UIBridgeProvider module to control what useUIBridgeOptional returns
const mockUseUIBridgeOptional = vi.fn<() => UIBridgeContextValue | null>();
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockUseUIBridgeOptional(),
}));

function createMockUndoTracker() {
  return {
    setDeclaredState: vi.fn(),
    // Stubs for the rest of UndoTracker — not exercised by these tests
    install: vi.fn(),
    uninstall: vi.fn(),
    getState: vi.fn(),
    getSnapshotContext: vi.fn(),
    recordAction: vi.fn(),
  };
}

function createMockBridgeContext(
  undoTracker: ReturnType<typeof createMockUndoTracker>
): UIBridgeContextValue {
  return {
    undoTracker,
  } as unknown as UIBridgeContextValue;
}

describe('useUndoRedo', () => {
  let mockTracker: ReturnType<typeof createMockUndoTracker>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTracker = createMockUndoTracker();
  });

  it('should set declared state on mount', () => {
    mockUseUIBridgeOptional.mockReturnValue(createMockBridgeContext(mockTracker));

    const options: DeclaredUndoState = { canUndo: true, canRedo: false };

    renderHook(() => useUndoRedo(options));

    expect(mockTracker.setDeclaredState).toHaveBeenCalledWith(options);
  });

  it('should clear declared state on unmount', () => {
    mockUseUIBridgeOptional.mockReturnValue(createMockBridgeContext(mockTracker));

    const options: DeclaredUndoState = { canUndo: true, canRedo: true };

    const { unmount } = renderHook(() => useUndoRedo(options));

    unmount();

    expect(mockTracker.setDeclaredState).toHaveBeenLastCalledWith(null);
  });

  it('should not crash outside UIBridgeProvider (no-op when bridge is null)', () => {
    mockUseUIBridgeOptional.mockReturnValue(null);

    const { unmount } = renderHook(() => useUndoRedo({ canUndo: false, canRedo: false }));

    expect(mockTracker.setDeclaredState).not.toHaveBeenCalled();

    unmount();

    expect(mockTracker.setDeclaredState).not.toHaveBeenCalled();
  });

  it('should re-declare with the FULL updated options when a dep field changes', () => {
    mockUseUIBridgeOptional.mockReturnValue(createMockBridgeContext(mockTracker));

    const initial: DeclaredUndoState = {
      canUndo: false,
      canRedo: false,
      undoDescription: 'Nothing',
      undoStack: ['a'],
    };

    const { rerender } = renderHook(({ opts }) => useUndoRedo(opts), {
      initialProps: { opts: initial },
    });

    // Both effects fire on mount; both pass the initial object.
    expect(mockTracker.setDeclaredState).toHaveBeenCalledWith(initial);
    mockTracker.setDeclaredState.mockClear();

    const updated: DeclaredUndoState = {
      canUndo: true, // dep field changed → second effect re-fires
      canRedo: false,
      undoDescription: 'Typing', // also changed
      undoStack: ['b', 'a'], // NON-dep field, but must be carried through
    };

    rerender({ opts: updated });

    // The second effect read optionsRef.current (the latest object), so the
    // tracker must receive the fully-updated options — including undoStack,
    // which is intentionally absent from the dependency array. This is the
    // regression guard for the body/deps mismatch fix.
    expect(mockTracker.setDeclaredState).toHaveBeenCalledWith(updated);
    expect(mockTracker.setDeclaredState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canUndo: true,
        undoDescription: 'Typing',
        undoStack: ['b', 'a'],
      })
    );
  });

  it('should NOT re-fire the update effect when only a non-dep field changes', () => {
    mockUseUIBridgeOptional.mockReturnValue(createMockBridgeContext(mockTracker));

    const initial: DeclaredUndoState = {
      canUndo: true,
      canRedo: false,
      undoStack: ['a'],
    };

    const { rerender } = renderHook(({ opts }) => useUndoRedo(opts), {
      initialProps: { opts: initial },
    });

    mockTracker.setDeclaredState.mockClear();

    // Only undoStack (a non-dep field) changes; the dep fields are identical.
    rerender({ opts: { canUndo: true, canRedo: false, undoStack: ['b', 'a'] } });

    // Neither effect should re-fire: bridge is unchanged and no primitive
    // dep field changed.
    expect(mockTracker.setDeclaredState).not.toHaveBeenCalled();
  });
});
