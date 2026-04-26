import { describe, it, expect, vi } from 'vitest';
import { NativeUIBridgeRegistry } from './registry';
import type {
  NativeElementRef,
  NativeSnapshotModalContext,
  NativeSnapshotToastContext,
  NativeSnapshotUndoContext,
} from './types';

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: {} as NativeElementRef };
}

function makeModalContext(): NativeSnapshotModalContext {
  return {
    modals: [
      {
        id: 'm1',
        title: 'Confirm',
        type: 'modal',
        blocking: true,
        dismissible: true,
        detectedAt: 1000,
      },
    ],
    topModal: {
      id: 'm1',
      title: 'Confirm',
      type: 'modal',
      blocking: true,
      dismissible: true,
      detectedAt: 1000,
    },
    hasBlockingModal: true,
    count: 1,
  };
}

function makeToastContext(): NativeSnapshotToastContext {
  return {
    active: [
      {
        id: 't1',
        message: 'Saved',
        level: 'success',
        appearedAt: 1000,
        visible: true,
        durationMs: 200,
      },
    ],
    recent: [],
    totalCaptured: 1,
  };
}

function makeUndoContext(): NativeSnapshotUndoContext {
  return {
    canUndo: true,
    canRedo: false,
    undoDescription: 'Typing',
    undoDepth: 3,
    summary: 'Can undo (Typing). 3 entries.',
  };
}

describe('NativeUIBridgeRegistry snapshot enrichers', () => {
  it('omits modalStack/toasts/undoRedo when no enrichers are set', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), {});

    const snap = registry.createSnapshot();

    expect(snap.modalStack).toBeUndefined();
    expect(snap.toasts).toBeUndefined();
    expect(snap.undoRedo).toBeUndefined();
  });

  it('populates modalStack only when modalDetector is registered', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), {});

    registry.setEnrichers({
      modalDetector: { getSnapshotModalContext: () => makeModalContext() },
    });

    const snap = registry.createSnapshot();

    expect(snap.modalStack).toBeDefined();
    expect(snap.modalStack?.hasBlockingModal).toBe(true);
    expect(snap.modalStack?.count).toBe(1);
    expect(snap.modalStack?.modals).toHaveLength(1);
    expect(snap.modalStack?.topModal?.id).toBe('m1');

    expect(snap.toasts).toBeUndefined();
    expect(snap.undoRedo).toBeUndefined();
  });

  it('populates all three fields when all three enrichers are registered', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setEnrichers({
      modalDetector: { getSnapshotModalContext: () => makeModalContext() },
      toastCapture: { getSnapshotToastContext: () => makeToastContext() },
      undoTracker: { getSnapshotUndoContext: () => makeUndoContext() },
    });

    const snap = registry.createSnapshot();

    expect(snap.modalStack?.count).toBe(1);
    expect(snap.toasts?.totalCaptured).toBe(1);
    expect(snap.toasts?.active[0]?.message).toBe('Saved');
    expect(snap.undoRedo?.canUndo).toBe(true);
    expect(snap.undoRedo?.summary).toContain('Typing');
  });

  it('merges enrichers across multiple setEnrichers calls (HMR-safe)', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.setEnrichers({
      modalDetector: { getSnapshotModalContext: () => makeModalContext() },
    });
    // Second call should NOT clobber the first
    registry.setEnrichers({
      toastCapture: { getSnapshotToastContext: () => makeToastContext() },
    });

    const snap = registry.createSnapshot();

    expect(snap.modalStack).toBeDefined();
    expect(snap.toasts).toBeDefined();
  });

  it('omits the field for a throwing enricher but keeps the rest of the snapshot', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const registry = new NativeUIBridgeRegistry({ verbose: true });
    registry.registerElement('a', makeRef(), {});
    registry.setEnrichers({
      modalDetector: {
        getSnapshotModalContext: () => {
          throw new Error('boom');
        },
      },
      toastCapture: { getSnapshotToastContext: () => makeToastContext() },
    });

    const snap = registry.createSnapshot();

    expect(snap.modalStack).toBeUndefined();
    expect(snap.toasts).toBeDefined();
    // Base snapshot still intact
    expect(snap.elements).toHaveLength(1);
    expect(snap.elements[0]?.id).toBe('a');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('does not log enricher errors when verbose is false', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const registry = new NativeUIBridgeRegistry();
    registry.setEnrichers({
      modalDetector: {
        getSnapshotModalContext: () => {
          throw new Error('boom');
        },
      },
    });

    const snap = registry.createSnapshot();

    expect(snap.modalStack).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('registerSnapshotEnricher attaches a custom field; disposer removes it', () => {
    const registry = new NativeUIBridgeRegistry();
    const fn = vi.fn(() => ({ runnerTabs: { active: 'tab-terminal' } }));

    const dispose = registry.registerSnapshotEnricher('runner-tabs', fn);

    let snap = registry.createSnapshot();
    expect((snap as unknown as { runnerTabs?: { active: string } }).runnerTabs).toEqual({
      active: 'tab-terminal',
    });
    expect(fn).toHaveBeenCalledTimes(1);

    dispose();

    snap = registry.createSnapshot();
    expect((snap as unknown as { runnerTabs?: unknown }).runnerTabs).toBeUndefined();
  });

  it('unregisterSnapshotEnricher removes the named enricher', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerSnapshotEnricher('runner-tabs', () => ({ runnerTabs: { x: 1 } }));

    let snap = registry.createSnapshot();
    expect((snap as unknown as { runnerTabs?: unknown }).runnerTabs).toBeDefined();

    registry.unregisterSnapshotEnricher('runner-tabs');

    snap = registry.createSnapshot();
    expect((snap as unknown as { runnerTabs?: unknown }).runnerTabs).toBeUndefined();
  });

  it('passes elements + currentRoute to custom enrichers', () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('a', makeRef(), { registrationRoute: '/x' });
    const fn = vi.fn(() => ({ runnerTabs: { ok: true } }));
    registry.registerSnapshotEnricher('runner-tabs', fn);

    registry.createSnapshot({ currentRoute: '/x', segments: ['x'] });

    expect(fn).toHaveBeenCalledTimes(1);
    const arg = fn.mock.calls[0]?.[0];
    expect(arg?.currentRoute).toBe('/x');
    expect(Array.isArray(arg?.elements)).toBe(true);
    expect(arg?.elements).toHaveLength(1);
  });

  it('isolates throws from custom enrichers without breaking other enrichers', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const registry = new NativeUIBridgeRegistry({ verbose: true });
    registry.registerSnapshotEnricher('bad', () => {
      throw new Error('nope');
    });
    registry.registerSnapshotEnricher('good', () => ({ goodField: 42 }));

    const snap = registry.createSnapshot();

    expect((snap as unknown as { goodField?: number }).goodField).toBe(42);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
