/**
 * useUIRelationship / useUIRelationships Hook Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUIRelationship, useUIRelationships } from '../useUIRelationship';
import type { UIBridgeContextValue } from '../UIBridgeProvider';

// Mock the UIBridgeProvider module to control what useUIBridgeOptional returns
const mockUseUIBridgeOptional = vi.fn<() => UIBridgeContextValue | null>();
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockUseUIBridgeOptional(),
}));

function createMockRelationshipTracker() {
  return {
    declare: vi.fn(),
    undeclare: vi.fn(),
    undeclareAll: vi.fn(),
  };
}

function createMockBridgeContext(
  relationshipTracker: ReturnType<typeof createMockRelationshipTracker>
): UIBridgeContextValue {
  return {
    relationshipTracker,
    // Minimal stubs — not used by useUIRelationship
    navigationTracker: {} as UIBridgeContextValue['navigationTracker'],
    shortcutTracker: {} as UIBridgeContextValue['shortcutTracker'],
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

describe('useUIRelationship', () => {
  let mockTracker: ReturnType<typeof createMockRelationshipTracker>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTracker = createMockRelationshipTracker();
  });

  it('should declare relationship on mount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    renderHook(() => useUIRelationship('search-input', 'results-list', 'filters'));

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);
    expect(mockTracker.declare).toHaveBeenCalledWith(
      'search-input',
      'results-list',
      'filters',
      undefined
    );
  });

  it('should undeclare relationship on unmount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { unmount } = renderHook(() =>
      useUIRelationship('search-input', 'results-list', 'filters')
    );

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);

    unmount();

    expect(mockTracker.undeclare).toHaveBeenCalledTimes(1);
    expect(mockTracker.undeclare).toHaveBeenCalledWith('search-input', 'results-list', 'filters');
  });

  it('should no-op when outside provider (context is null)', () => {
    mockUseUIBridgeOptional.mockReturnValue(null);

    const { unmount } = renderHook(() =>
      useUIRelationship('search-input', 'results-list', 'filters')
    );

    expect(mockTracker.declare).not.toHaveBeenCalled();

    unmount();

    expect(mockTracker.undeclare).not.toHaveBeenCalled();
  });

  it('should update when sourceId changes (undeclares old, declares new)', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(
      ({ sourceId }) => useUIRelationship(sourceId, 'results-list', 'filters'),
      { initialProps: { sourceId: 'search-input' } }
    );

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);
    expect(mockTracker.declare).toHaveBeenCalledWith(
      'search-input',
      'results-list',
      'filters',
      undefined
    );

    rerender({ sourceId: 'advanced-search' });

    // Cleanup should undeclare the old relationship
    expect(mockTracker.undeclare).toHaveBeenCalledTimes(1);
    expect(mockTracker.undeclare).toHaveBeenCalledWith('search-input', 'results-list', 'filters');

    // Then declare the new relationship
    expect(mockTracker.declare).toHaveBeenCalledTimes(2);
    expect(mockTracker.declare).toHaveBeenLastCalledWith(
      'advanced-search',
      'results-list',
      'filters',
      undefined
    );
  });

  it('should update when targetId changes', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(
      ({ targetId }) => useUIRelationship('search-input', targetId, 'filters'),
      { initialProps: { targetId: 'results-list' } }
    );

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);

    rerender({ targetId: 'filtered-table' });

    expect(mockTracker.undeclare).toHaveBeenCalledTimes(1);
    expect(mockTracker.undeclare).toHaveBeenCalledWith('search-input', 'results-list', 'filters');

    expect(mockTracker.declare).toHaveBeenCalledTimes(2);
    expect(mockTracker.declare).toHaveBeenLastCalledWith(
      'search-input',
      'filtered-table',
      'filters',
      undefined
    );
  });

  it('should update when type changes', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ type }) => useUIRelationship('toggle-btn', 'panel', type), {
      initialProps: { type: 'controls' as const },
    });

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);

    rerender({ type: 'toggles' as const });

    expect(mockTracker.undeclare).toHaveBeenCalledTimes(1);
    expect(mockTracker.undeclare).toHaveBeenCalledWith('toggle-btn', 'panel', 'controls');

    expect(mockTracker.declare).toHaveBeenCalledTimes(2);
    expect(mockTracker.declare).toHaveBeenLastCalledWith(
      'toggle-btn',
      'panel',
      'toggles',
      undefined
    );
  });

  it('should pass bidirectional option', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    renderHook(() =>
      useUIRelationship('tab-settings', 'settings-panel', 'activates', {
        bidirectional: true,
      })
    );

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);
    expect(mockTracker.declare).toHaveBeenCalledWith(
      'tab-settings',
      'settings-panel',
      'activates',
      { bidirectional: true }
    );
  });

  it('should pass metadata', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    renderHook(() =>
      useUIRelationship('sort-dropdown', 'data-table', 'controls', {
        metadata: { field: 'sortOrder' },
      })
    );

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);
    expect(mockTracker.declare).toHaveBeenCalledWith('sort-dropdown', 'data-table', 'controls', {
      metadata: { field: 'sortOrder' },
    });
  });

  it('should not re-declare when re-rendered with identical values', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(
      ({ meta }) =>
        useUIRelationship('sort-dropdown', 'data-table', 'controls', {
          metadata: meta,
        }),
      { initialProps: { meta: { field: 'sortOrder' } as Record<string, unknown> } }
    );

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);

    // Re-render with a new object that has the same values
    rerender({ meta: { field: 'sortOrder' } });

    // Should NOT re-fire because serialized metadata is identical
    expect(mockTracker.declare).toHaveBeenCalledTimes(1);
  });
});

describe('useUIRelationships', () => {
  let mockTracker: ReturnType<typeof createMockRelationshipTracker>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTracker = createMockRelationshipTracker();
  });

  it('should declare multiple relationships on mount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    renderHook(() =>
      useUIRelationships('save-button', [
        { target: 'name-input', type: 'submits' },
        { target: 'email-input', type: 'submits' },
        { target: 'form-status', type: 'populates' },
      ])
    );

    expect(mockTracker.declare).toHaveBeenCalledTimes(3);
    expect(mockTracker.declare).toHaveBeenCalledWith(
      'save-button',
      'name-input',
      'submits',
      undefined
    );
    expect(mockTracker.declare).toHaveBeenCalledWith(
      'save-button',
      'email-input',
      'submits',
      undefined
    );
    expect(mockTracker.declare).toHaveBeenCalledWith(
      'save-button',
      'form-status',
      'populates',
      undefined
    );
  });

  it('should undeclare all relationships on unmount', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { unmount } = renderHook(() =>
      useUIRelationships('save-button', [
        { target: 'name-input', type: 'submits' },
        { target: 'email-input', type: 'submits' },
      ])
    );

    expect(mockTracker.declare).toHaveBeenCalledTimes(2);

    unmount();

    expect(mockTracker.undeclare).toHaveBeenCalledTimes(2);
    expect(mockTracker.undeclare).toHaveBeenCalledWith('save-button', 'name-input', 'submits');
    expect(mockTracker.undeclare).toHaveBeenCalledWith('save-button', 'email-input', 'submits');
  });

  it('should update when relationships change', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ rels }) => useUIRelationships('save-button', rels), {
      initialProps: {
        rels: [{ target: 'name-input', type: 'submits' as const }],
      },
    });

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);
    expect(mockTracker.declare).toHaveBeenCalledWith(
      'save-button',
      'name-input',
      'submits',
      undefined
    );

    rerender({
      rels: [
        { target: 'name-input', type: 'submits' as const },
        { target: 'email-input', type: 'submits' as const },
      ],
    });

    // Cleanup: undeclare the old relationship
    expect(mockTracker.undeclare).toHaveBeenCalledWith('save-button', 'name-input', 'submits');

    // Then declare both new relationships
    expect(mockTracker.declare).toHaveBeenCalledTimes(3); // 1 initial + 2 new
    expect(mockTracker.declare).toHaveBeenLastCalledWith(
      'save-button',
      'email-input',
      'submits',
      undefined
    );
  });

  it('should no-op when outside provider (context is null)', () => {
    mockUseUIBridgeOptional.mockReturnValue(null);

    const { unmount } = renderHook(() =>
      useUIRelationships('save-button', [{ target: 'name-input', type: 'submits' }])
    );

    expect(mockTracker.declare).not.toHaveBeenCalled();

    unmount();

    expect(mockTracker.undeclare).not.toHaveBeenCalled();
  });

  it('should not re-declare when re-rendered with identical values', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    const { rerender } = renderHook(({ rels }) => useUIRelationships('save-button', rels), {
      initialProps: {
        rels: [{ target: 'name-input', type: 'submits' as const }],
      },
    });

    expect(mockTracker.declare).toHaveBeenCalledTimes(1);

    // Re-render with a new array that has the same values
    rerender({
      rels: [{ target: 'name-input', type: 'submits' as const }],
    });

    // Should NOT re-fire because serialized relationships are identical
    expect(mockTracker.declare).toHaveBeenCalledTimes(1);
  });

  it('should pass options from inline relationships', () => {
    const bridgeContext = createMockBridgeContext(mockTracker);
    mockUseUIBridgeOptional.mockReturnValue(bridgeContext);

    renderHook(() =>
      useUIRelationships('tab-bar', [
        {
          target: 'panel-a',
          type: 'activates',
          bidirectional: true,
          metadata: { index: 0 },
        },
        {
          target: 'panel-b',
          type: 'activates',
          bidirectional: true,
          metadata: { index: 1 },
        },
      ])
    );

    expect(mockTracker.declare).toHaveBeenCalledTimes(2);
    expect(mockTracker.declare).toHaveBeenCalledWith('tab-bar', 'panel-a', 'activates', {
      bidirectional: true,
      metadata: { index: 0 },
    });
    expect(mockTracker.declare).toHaveBeenCalledWith('tab-bar', 'panel-b', 'activates', {
      bidirectional: true,
      metadata: { index: 1 },
    });
  });
});
