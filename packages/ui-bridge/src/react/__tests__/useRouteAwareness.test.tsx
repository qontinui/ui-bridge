/**
 * useRouteAwareness Hook Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useRouteAwareness } from '../useRouteAwareness';
import type { UIBridgeContextValue } from '../UIBridgeProvider';
import type { RouteInfo } from '../../navigation/types';

// Mock the UIBridgeProvider module to control what useUIBridgeOptional returns
const mockUseUIBridgeOptional = vi.fn<() => UIBridgeContextValue | null>();
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockUseUIBridgeOptional(),
}));

function createMockNavigationTracker() {
  return {
    setPageContext: vi.fn(),
    setRouteInfo: vi.fn(),
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

describe('useRouteAwareness', () => {
  let mockTracker: ReturnType<typeof createMockNavigationTracker>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTracker = createMockNavigationTracker();
  });

  it('should set route info on mount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const info: RouteInfo = {
      pattern: '/tasks/:id',
      params: { id: '42' },
    };

    renderHook(() => useRouteAwareness(info));

    expect(mockTracker.setRouteInfo).toHaveBeenCalledWith(info);
  });

  it('should clear route info on unmount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const info: RouteInfo = {
      pattern: '/settings',
      params: {},
    };

    const { unmount } = renderHook(() => useRouteAwareness(info));

    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(1);
    expect(mockTracker.setRouteInfo).toHaveBeenCalledWith(info);

    unmount();

    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(2);
    expect(mockTracker.setRouteInfo).toHaveBeenLastCalledWith(undefined);
  });

  it('should update when route info changes', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const initialInfo: RouteInfo = {
      pattern: '/tasks',
      params: {},
      queryParams: { page: '1' },
    };

    const updatedInfo: RouteInfo = {
      pattern: '/tasks/:id',
      params: { id: '99' },
      queryParams: {},
    };

    const { rerender } = renderHook(({ info }) => useRouteAwareness(info), {
      initialProps: { info: initialInfo },
    });

    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(1);
    expect(mockTracker.setRouteInfo).toHaveBeenCalledWith(initialInfo);

    rerender({ info: updatedInfo });

    // 3 calls: mount(initial) + cleanup(undefined) + mount(updated)
    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(3);
    expect(mockTracker.setRouteInfo).toHaveBeenLastCalledWith(updatedInfo);
  });

  it('should not crash outside UIBridgeProvider (no-op when bridge is null)', () => {
    mockUseUIBridgeOptional.mockReturnValue(null);

    const info: RouteInfo = {
      pattern: '/orphan',
    };

    // Should not throw
    const { unmount } = renderHook(() => useRouteAwareness(info));

    expect(mockTracker.setRouteInfo).not.toHaveBeenCalled();

    // Unmount should also not throw
    unmount();

    expect(mockTracker.setRouteInfo).not.toHaveBeenCalled();
  });

  it('should not re-call setRouteInfo when re-rendered with identical values', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ info }) => useRouteAwareness(info), {
      initialProps: {
        info: { pattern: '/tasks', params: { id: '1' } } as RouteInfo,
      },
    });

    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(1);

    // Re-render with a new object that has the same field values
    rerender({
      info: { pattern: '/tasks', params: { id: '1' } },
    });

    // The effect deps serialize to the same values, so it should NOT re-fire
    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(1);
  });

  it('should update when queryParams change', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ info }) => useRouteAwareness(info), {
      initialProps: {
        info: {
          pattern: '/tasks',
          queryParams: { page: '1' },
        } as RouteInfo,
      },
    });

    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(1);

    rerender({
      info: {
        pattern: '/tasks',
        queryParams: { page: '2' },
      },
    });

    // 3 calls: mount(initial) + cleanup(undefined) + mount(updated)
    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(3);
  });

  it('should update when routeStack changes', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ info }) => useRouteAwareness(info), {
      initialProps: {
        info: {
          pattern: '/tasks',
          routeStack: ['/', '/tasks'],
        } as RouteInfo,
      },
    });

    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(1);

    rerender({
      info: {
        pattern: '/tasks',
        routeStack: ['/', '/tasks', '/tasks/new'],
      },
    });

    // 3 calls: mount(initial) + cleanup(undefined) + mount(updated)
    expect(mockTracker.setRouteInfo).toHaveBeenCalledTimes(3);
  });
});
