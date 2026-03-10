/**
 * usePageContext Hook Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { usePageContext } from '../usePageContext';
import type { UIBridgeContextValue } from '../UIBridgeProvider';
import type { DeveloperPageContext } from '../../navigation/types';

// Mock the UIBridgeProvider module to control what useUIBridgeOptional returns
const mockUseUIBridgeOptional = vi.fn<() => UIBridgeContextValue | null>();
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockUseUIBridgeOptional(),
}));

function createMockNavigationTracker() {
  return {
    setPageContext: vi.fn(),
    setRouteInfo: vi.fn(),
    // Additional methods that exist on NavigationTracker but aren't needed for these tests
    install: vi.fn(),
    uninstall: vi.fn(),
    getCurrentPage: vi.fn(),
    getRecentNavigations: vi.fn().mockReturnValue([]),
    getSnapshotPageContext: vi.fn(),
    getDeveloperContext: vi.fn(),
    getRouteInfo: vi.fn(),
  };
}

function createMockBridgeContext(
  navigationTracker: ReturnType<typeof createMockNavigationTracker>
): UIBridgeContextValue {
  return {
    navigationTracker,
    // Minimal stubs for the rest of the context — not used by usePageContext
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

describe('usePageContext', () => {
  let mockTracker: ReturnType<typeof createMockNavigationTracker>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTracker = createMockNavigationTracker();
  });

  it('should set page context on mount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const context: DeveloperPageContext = {
      name: 'Dashboard',
      section: 'main',
    };

    renderHook(() => usePageContext(context));

    expect(mockTracker.setPageContext).toHaveBeenCalledWith(context);
  });

  it('should clear page context on unmount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const context: DeveloperPageContext = {
      name: 'Settings',
      section: 'admin',
    };

    const { unmount } = renderHook(() => usePageContext(context));

    // Called once on mount
    expect(mockTracker.setPageContext).toHaveBeenCalledTimes(1);
    expect(mockTracker.setPageContext).toHaveBeenCalledWith(context);

    unmount();

    // Called again with undefined on unmount (cleanup)
    expect(mockTracker.setPageContext).toHaveBeenCalledTimes(2);
    expect(mockTracker.setPageContext).toHaveBeenLastCalledWith(undefined);
  });

  it('should update when context changes', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const initialContext: DeveloperPageContext = {
      name: 'Task List',
      section: 'tasks',
    };

    const updatedContext: DeveloperPageContext = {
      name: 'Task Detail',
      section: 'tasks',
      breadcrumb: ['Tasks', 'Task #42'],
    };

    const { rerender } = renderHook(({ ctx }) => usePageContext(ctx), {
      initialProps: { ctx: initialContext },
    });

    expect(mockTracker.setPageContext).toHaveBeenCalledTimes(1);
    expect(mockTracker.setPageContext).toHaveBeenCalledWith(initialContext);

    rerender({ ctx: updatedContext });

    // 3 calls: mount(initial) + cleanup(undefined) + mount(updated)
    expect(mockTracker.setPageContext).toHaveBeenCalledTimes(3);
    expect(mockTracker.setPageContext).toHaveBeenLastCalledWith(updatedContext);
  });

  it('should not crash outside UIBridgeProvider (no-op when bridge is null)', () => {
    mockUseUIBridgeOptional.mockReturnValue(null);

    const context: DeveloperPageContext = {
      name: 'Orphan Page',
    };

    // Should not throw
    const { unmount } = renderHook(() => usePageContext(context));

    expect(mockTracker.setPageContext).not.toHaveBeenCalled();

    // Unmount should also not throw
    unmount();

    expect(mockTracker.setPageContext).not.toHaveBeenCalled();
  });

  it('should not re-call setPageContext when re-rendered with identical values', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ ctx }) => usePageContext(ctx), {
      initialProps: {
        ctx: { name: 'Dashboard', section: 'main' } as DeveloperPageContext,
      },
    });

    expect(mockTracker.setPageContext).toHaveBeenCalledTimes(1);

    // Re-render with a new object that has the same field values
    rerender({
      ctx: { name: 'Dashboard', section: 'main' },
    });

    // The effect deps serialize to the same values, so it should NOT re-fire
    expect(mockTracker.setPageContext).toHaveBeenCalledTimes(1);
  });

  it('should update when meta changes', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ ctx }) => usePageContext(ctx), {
      initialProps: {
        ctx: { name: 'Page', meta: { version: 1 } } as DeveloperPageContext,
      },
    });

    expect(mockTracker.setPageContext).toHaveBeenCalledTimes(1);

    rerender({
      ctx: { name: 'Page', meta: { version: 2 } },
    });

    // 3 calls: mount(initial) + cleanup(undefined) + mount(updated)
    expect(mockTracker.setPageContext).toHaveBeenCalledTimes(3);
  });
});
