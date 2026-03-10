/**
 * useKeyboardShortcuts Hook Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import type { UIBridgeContextValue } from '../UIBridgeProvider';

// Mock the UIBridgeProvider module to control what useUIBridgeOptional returns
const mockUseUIBridgeOptional = vi.fn<() => UIBridgeContextValue | null>();
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockUseUIBridgeOptional(),
}));

function createMockShortcutTracker() {
  return {
    registerShortcuts: vi.fn(),
    unregisterShortcuts: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    getShortcuts: vi.fn().mockReturnValue([]),
    getSnapshotShortcutContext: vi.fn(),
    rescan: vi.fn(),
  };
}

function createMockBridgeContext(
  shortcutTracker: ReturnType<typeof createMockShortcutTracker>
): UIBridgeContextValue {
  return {
    shortcutTracker,
    // Minimal stubs — not used by useKeyboardShortcuts
    navigationTracker: {} as UIBridgeContextValue['navigationTracker'],
    features: {},
    config: {},
    registry: {} as UIBridgeContextValue['registry'],
    executor: {} as UIBridgeContextValue['executor'],
    workflowEngine: {} as UIBridgeContextValue['workflowEngine'],
    wsConnectionState: 'disconnected',
    getElements: () => [],
    getComponents: () => [],
    createSnapshot: () =>
      ({}) as UIBridgeContextValue extends { createSnapshot: () => infer R } ? R : never,
    createSnapshotAsync: async () =>
      ({}) as UIBridgeContextValue extends { createSnapshotAsync: () => Promise<infer R> }
        ? R
        : never,
    on: () => () => {},
    off: () => {},
    initialized: true,
    wsConnect: async () => {},
    wsDisconnect: () => {},
    wsSubscribe: async () => [],
    onWsEvent: () => () => {},
  } as unknown as UIBridgeContextValue;
}

describe('useKeyboardShortcuts', () => {
  let mockTracker: ReturnType<typeof createMockShortcutTracker>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTracker = createMockShortcutTracker();
  });

  it('should register shortcuts on mount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    renderHook(() =>
      useKeyboardShortcuts([
        { combo: 'Ctrl+S', description: 'Save' },
        { combo: 'Ctrl+N', description: 'New' },
      ])
    );

    expect(mockTracker.registerShortcuts).toHaveBeenCalledWith([
      { combo: 'Ctrl+S', description: 'Save', source: 'developer' },
      { combo: 'Ctrl+N', description: 'New', source: 'developer' },
    ]);
  });

  it('should unregister shortcuts on unmount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ combo: 'Ctrl+S', description: 'Save' }])
    );

    expect(mockTracker.registerShortcuts).toHaveBeenCalledTimes(1);

    unmount();

    expect(mockTracker.unregisterShortcuts).toHaveBeenCalledWith(['Ctrl+S']);
  });

  it('should re-register when shortcuts change', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ shortcuts }) => useKeyboardShortcuts(shortcuts), {
      initialProps: {
        shortcuts: [{ combo: 'Ctrl+S', description: 'Save' }],
      },
    });

    expect(mockTracker.registerShortcuts).toHaveBeenCalledTimes(1);

    rerender({
      shortcuts: [
        { combo: 'Ctrl+S', description: 'Save' },
        { combo: 'Ctrl+N', description: 'New' },
      ],
    });

    // cleanup(old) + register(new) = 1 unregister + 2 register calls
    expect(mockTracker.unregisterShortcuts).toHaveBeenCalledTimes(1);
    expect(mockTracker.registerShortcuts).toHaveBeenCalledTimes(2);
  });

  it('should not crash outside UIBridgeProvider', () => {
    mockUseUIBridgeOptional.mockReturnValue(null);

    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ combo: 'Ctrl+S', description: 'Save' }])
    );

    expect(mockTracker.registerShortcuts).not.toHaveBeenCalled();
    unmount();
    expect(mockTracker.unregisterShortcuts).not.toHaveBeenCalled();
  });

  it('should not re-register when re-rendered with identical values', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ shortcuts }) => useKeyboardShortcuts(shortcuts), {
      initialProps: {
        shortcuts: [{ combo: 'Ctrl+S', description: 'Save' }],
      },
    });

    expect(mockTracker.registerShortcuts).toHaveBeenCalledTimes(1);

    // Re-render with a new object with the same values
    rerender({
      shortcuts: [{ combo: 'Ctrl+S', description: 'Save' }],
    });

    // Should NOT re-fire because JSON.stringify produces the same string
    expect(mockTracker.registerShortcuts).toHaveBeenCalledTimes(1);
  });

  it('should not register empty shortcuts array', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    renderHook(() => useKeyboardShortcuts([]));

    expect(mockTracker.registerShortcuts).not.toHaveBeenCalled();
  });
});
