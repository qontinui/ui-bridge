/**
 * useUndoRedo Hook Tests
 */

import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUndoRedo } from '../useUndoRedo';
import type { UIBridgeContextValue } from '../UIBridgeProvider';
import type { DeclaredUndoState } from '../../undo/types';
import type { UndoTracker } from '../../undo/undo-tracker';
import { executeCommand, type BridgeAccess } from '../commandHandlers';

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

    // The commit hands the tracker the initial object.
    expect(mockTracker.setDeclaredState).toHaveBeenCalledWith(initial);
    mockTracker.setDeclaredState.mockClear();

    const updated: DeclaredUndoState = {
      canUndo: true, // changed
      canRedo: false,
      undoDescription: 'Typing', // also changed
      undoStack: ['b', 'a'], // must be carried through as well
    };

    rerender({ opts: updated });

    // The tracker must receive the fully-updated options — including
    // undoStack, not only the fields that changed.
    expect(mockTracker.setDeclaredState).toHaveBeenCalledWith(updated);
    expect(mockTracker.setDeclaredState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canUndo: true,
        undoDescription: 'Typing',
        undoStack: ['b', 'a'],
      })
    );
  });

  it('hands the tracker the new object when only the stack changes', () => {
    // This case used to assert the opposite: that nothing reached the tracker
    // while canUndo, canRedo and both descriptions held still. That pinned the
    // defect. The tracker kept the old object, so an agent read the old stack
    // and ran the old onUndo.
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

    // Only undoStack changes; canUndo, canRedo and the descriptions are the same.
    rerender({ opts: { canUndo: true, canRedo: false, undoStack: ['b', 'a'] } });

    expect(mockTracker.setDeclaredState).toHaveBeenCalledTimes(1);
    expect(mockTracker.setDeclaredState).toHaveBeenLastCalledWith({
      canUndo: true,
      canRedo: false,
      undoStack: ['b', 'a'],
    });
  });
});

// ---------------------------------------------------------------------------
// Through the REAL UIBridgeProvider and the relay's real command handler, the
// path an agent's `POST /control/undo` takes: `executeCommand('executeUndo')`
// calls `__UI_BRIDGE__.undoTracker.executeUndo()` — the tracker the provider
// built, put in its context and published — which runs the declared `onUndo`.
// These cases run outside `act`, which would flush every effect before
// returning and hide WHEN the tracker was written. Every expectation is a
// literal.
// ---------------------------------------------------------------------------
describe('useUndoRedo hands an agent undo the committed closure, outside act', () => {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  let savedAct: boolean | undefined;
  beforeAll(() => {
    savedAct = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterAll(() => {
    g.IS_REACT_ACT_ENVIRONMENT = savedAct;
  });

  let Provider: typeof import('../UIBridgeProvider').UIBridgeProvider;
  beforeEach(async () => {
    const actual =
      await vi.importActual<typeof import('../UIBridgeProvider')>('../UIBridgeProvider');
    Provider = actual.UIBridgeProvider;
    // The hook under test imports the mocked module; route it to the real
    // context, which the real provider below fills.
    mockUseUIBridgeOptional.mockImplementation(() => actual.useUIBridgeOptional());
  });
  afterEach(() => {
    mockUseUIBridgeOptional.mockReset();
  });

  // A PRECONDITION wait: with `act` off, React commits and flushes on its own
  // schedule. Never used for the property under test.
  const until = (pred: () => boolean, what: string) =>
    vi.waitFor(
      () => {
        if (!pred()) throw new Error(`timed out waiting for: ${what}`);
      },
      { timeout: 2000, interval: 10 }
    );

  const emptyBridge: BridgeAccess = {
    elements: [],
    getElement: () => undefined,
    components: [],
    workflows: [],
  };

  // One editor whose declaration never changes. Only its onUndo closure does:
  // `version` is captured by it and by nothing that useUndoRedo used to key on.
  const ran: string[] = [];
  let flushes = 0;
  function Editor({ version }: { version: string }) {
    useUndoRedo({
      canUndo: true,
      canRedo: false,
      undoDescription: 'Typing',
      onUndo: () => {
        ran.push(version);
      },
    });
    // Counts the passive flushes of this component's commits.
    useEffect(() => {
      flushes += 1;
    });
    return <span>{version}</span>;
  }

  function mount() {
    ran.length = 0;
    flushes = 0;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (version: string) =>
      root.render(
        <Provider>
          <Editor version={version} />
        </Provider>
      );
    const done = () => {
      root.unmount();
      container.remove();
    };
    return { container, render, done };
  }

  it('POST /control/undo after a re-render that changed only onUndo runs the NEW closure', async () => {
    const { render, done } = mount();
    render('first');
    await until(() => flushes === 1, 'the first commit to flush');

    render('second');
    await until(() => flushes === 2, 'the re-render to flush');

    const result = await executeCommand('executeUndo', {}, emptyBridge);

    expect(result).toMatchObject({ success: true, executed: true, method: 'tracker' });
    expect(ran).toEqual(['second']);
    done();
  });

  it('runs the new closure at commit, before the passive flush', async () => {
    const { container, render, done } = mount();
    render('first');
    await until(() => flushes === 1, 'the first commit to flush');
    // The tracker the real provider published, which the relay reaches.
    const tracker = (globalThis as unknown as { __UI_BRIDGE__: { undoTracker: UndoTracker } })
      .__UI_BRIDGE__.undoTracker;
    const span = container.firstElementChild as HTMLElement;
    expect(span.textContent).toBe('first');

    // Sample inside a MutationObserver callback: a microtask after the DOM
    // commit, and before the passive flush of a non-discrete update.
    const sampled = new Promise<number>((resolve) => {
      const observer = new MutationObserver(() => {
        if (span.textContent !== 'second') return;
        observer.disconnect();
        const flushesAtSample = flushes;
        tracker.executeUndo();
        resolve(flushesAtSample);
      });
      observer.observe(span, { childList: true, characterData: true, subtree: true });
    });
    // A resolved-promise update is non-discrete: its passive effects flush in
    // a later task than its commit.
    await Promise.resolve().then(() => render('second'));
    const flushesAtSample = await sampled;

    // The sample sat in the gap: 'second' had committed and its passive
    // effects had not run.
    expect(flushesAtSample).toBe(1);
    expect(ran).toEqual(['second']);
    done();
  });
});
