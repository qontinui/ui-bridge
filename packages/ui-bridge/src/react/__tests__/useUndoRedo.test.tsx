/**
 * useUndoRedo Hook Tests
 */

import { useEffect, useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUndoRedo } from '../useUndoRedo';
import type { UIBridgeContextValue } from '../UIBridgeProvider';
import type { DeclaredUndoState } from '../../undo/types';
import type { UndoTracker } from '../../undo/undo-tracker';
import { executeCommand, type BridgeAccess } from '../commandHandlers';
import { outsideAct } from './outside-act';

// Mock the UIBridgeProvider module to control what useUIBridgeOptional returns
const mockUseUIBridgeOptional = vi.fn<() => UIBridgeContextValue | null>();
vi.mock('../UIBridgeProvider', () => ({
  useUIBridgeOptional: () => mockUseUIBridgeOptional(),
}));

// The REAL provider module, for the outside-act cases below. Imported once at
// module level, during collection, which has no hook timeout: as an awaited
// import inside a `beforeEach` its cold load (the whole provider tree) counted
// against the hook budget and timed out under load. This file never resets or
// re-mocks modules, so every hook used to receive this same cached instance
// anyway; hoisting it loses no isolation. It must stay out of the `vi.mock`
// factory above, which is hoisted above this line.
const actualProvider =
  await vi.importActual<typeof import('../UIBridgeProvider')>('../UIBridgeProvider');

function createMockUndoTracker() {
  // Holds the declaration like the real tracker does, because the hook's
  // unmount cleanup reads it back before clearing it.
  let declared: DeclaredUndoState | null = null;
  return {
    setDeclaredState: vi.fn((state: DeclaredUndoState | null) => {
      declared = state;
    }),
    getDeclaredState: vi.fn(() => declared),
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
  const { mount, until } = outsideAct();

  const Provider = actualProvider.UIBridgeProvider;
  beforeEach(() => {
    // The hook under test imports the mocked module; route it to the real
    // context, which the real provider below fills.
    mockUseUIBridgeOptional.mockImplementation(() => actualProvider.useUIBridgeOptional());
  });
  afterEach(() => {
    mockUseUIBridgeOptional.mockReset();
  });

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
  beforeEach(() => {
    ran.length = 0;
    flushes = 0;
  });
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

  /** The tracker the real provider built and published, which the relay reaches. */
  const publishedTracker = () =>
    (globalThis as unknown as { __UI_BRIDGE__: { undoTracker: UndoTracker } }).__UI_BRIDGE__
      .undoTracker;

  function mountEditor() {
    const { container, root } = mount();
    const render = (version: string) =>
      root.render(
        <Provider>
          <Editor version={version} />
        </Provider>
      );
    return { container, render };
  }

  it('POST /control/undo after a re-render that changed only onUndo runs the NEW closure', async () => {
    const { render } = mountEditor();
    render('first');
    await until(() => flushes === 1, 'the first commit to flush');

    render('second');
    await until(() => flushes === 2, 'the re-render to flush');

    const result = await executeCommand('executeUndo', {}, emptyBridge);

    expect(result).toMatchObject({ success: true, executed: true, method: 'tracker' });
    expect(ran).toEqual(['second']);
  });

  it('runs the new closure at commit, before the passive flush', async () => {
    const { container, render } = mountEditor();
    render('first');
    await until(() => flushes === 1, 'the first commit to flush');
    const tracker = publishedTracker();
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
  });

  it("unmounting one declarer leaves another declarer's live declaration in place", async () => {
    const { container, root } = mount();
    let hideA: () => void = () => {};
    // A sits in its own host, so hiding it re-renders that host alone: B does
    // not re-render, and so cannot re-declare in the commit that unmounts A.
    function AHost() {
      const [shown, setShown] = useState(true);
      hideA = () => setShown(false);
      return shown ? <Editor version="A" /> : null;
    }
    root.render(
      <Provider>
        <AHost />
        <Editor version="B" />
      </Provider>
    );
    await until(() => flushes === 2, 'both declarers to commit');
    const tracker = publishedTracker();

    // B committed after A, a later sibling, so B owns the declaration.
    tracker.executeUndo();
    expect(ran).toEqual(['B']);
    ran.length = 0;

    hideA();
    await until(() => container.textContent === 'B', 'A to unmount');

    const result = await executeCommand('executeUndo', {}, emptyBridge);
    expect(result).toMatchObject({ success: true, executed: true, method: 'tracker' });
    expect(ran).toEqual(['B']);

    // B's own unmount does withdraw its declaration.
    root.render(
      <Provider>
        <AHost />
      </Provider>
    );
    await until(() => container.textContent === '', 'B to unmount');
    expect(tracker.getDeclaredState()).toBeNull();
  });

  it('unmounting the owner after a re-render that changed its onUndo withdraws the declaration', async () => {
    // Pins the cleanup's read of the LATEST committed declaration. The
    // re-render hands the tracker a new object. A cleanup that compared against
    // the object it saw when the effect was created would find the tracker
    // holding something else, and leave the unmounted owner's declaration in
    // place.
    const { container, root } = mount();
    const render = (version: string | null) =>
      root.render(<Provider>{version === null ? null : <Editor version={version} />}</Provider>);
    render('first');
    await until(() => flushes === 1, 'the first commit to flush');
    render('second');
    await until(() => flushes === 2, 'the re-render to flush');
    const tracker = publishedTracker();

    // The tracker holds the re-render's declaration, not the mount's.
    tracker.executeUndo();
    expect(ran).toEqual(['second']);

    render(null);
    await until(() => container.textContent === '', 'the owner to unmount');
    expect(tracker.getDeclaredState()).toBeNull();
  });
});
