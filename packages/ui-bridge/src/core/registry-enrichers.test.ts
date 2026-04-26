/**
 * Snapshot enricher tests for UIBridgeRegistry
 *
 * Mirrors the mobile package's registry-enrichers.test.ts. Verifies that the
 * seven canonical enrichers (page, modalStack, toasts, relationships, dragDrop,
 * undoRedo, shortcuts) attach to snapshots when wired, that pluggable extras
 * work via registerSnapshotEnricher, that throws are isolated, and that both
 * `createSnapshot` and `createSnapshotAsync` enrich identically.
 */

import { describe, it, expect, vi } from 'vitest';
import { UIBridgeRegistry } from './registry';
import type { BridgeSnapshot, SnapshotEnrichers } from './types';
import type { SnapshotPageContext } from '../navigation/types';
import type { SnapshotModalContext } from '../modal/types';
import type { SnapshotToastContext } from '../toast/types';
import type { SnapshotRelationshipContext } from '../relationships/types';
import type { SnapshotDragDropContext } from '../drag-drop/types';
import type { SnapshotUndoContext } from '../undo/types';
import type { SnapshotShortcutContext } from '../shortcuts/types';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makePageContext(): SnapshotPageContext {
  return {
    url: 'http://localhost/test',
    pathname: '/test',
    search: '',
    hash: '',
    title: 'Test',
    recentNavigations: [],
  };
}

function makeModalContext(): SnapshotModalContext {
  return {
    modals: [],
    hasBlockingModal: true,
    count: 1,
  };
}

function makeToastContext(): SnapshotToastContext {
  return {
    active: [],
    recent: [],
    totalCaptured: 7,
  };
}

function makeRelationshipContext(): SnapshotRelationshipContext {
  return {
    relationships: [],
    count: 2,
    byOrigin: { declared: 1, aria: 1, html: 0 },
  };
}

function makeDragDropContext(): SnapshotDragDropContext {
  return {
    dragSources: [],
    dropZones: [],
    count: { dragSources: 0, dropZones: 0 },
    byOrigin: { declared: 0, aria: 0, dom: 0 },
  };
}

function makeUndoContext(): SnapshotUndoContext {
  return {
    undoAvailable: true,
    redoAvailable: false,
    undoDescription: 'Typing',
    summary: 'Can undo (Typing).',
  };
}

function makeShortcutContext(): SnapshotShortcutContext {
  return {
    shortcuts: [],
    totalCount: 0,
    lastScanTimestamp: 1000,
  };
}

function makeAllEnrichers(): SnapshotEnrichers {
  return {
    navigationTracker: { getSnapshotPageContext: () => makePageContext() },
    modalDetector: { getSnapshotModalContext: () => makeModalContext() },
    toastCapture: { getSnapshotToastContext: () => makeToastContext() },
    relationshipTracker: {
      getSnapshotRelationshipContext: () => makeRelationshipContext(),
    },
    dragDropDetector: {
      getSnapshotDragDropContext: () => makeDragDropContext(),
    },
    undoTracker: { getSnapshotUndoContext: () => makeUndoContext() },
    shortcutTracker: { getSnapshotShortcutContext: () => makeShortcutContext() },
  };
}

// Snapshot factory parameterized over the create method we want to exercise.
async function takeSnapshot(
  registry: UIBridgeRegistry,
  method: 'sync' | 'async'
): Promise<BridgeSnapshot> {
  if (method === 'sync') return registry.createSnapshot();
  return await registry.createSnapshotAsync();
}

// ---------------------------------------------------------------------------
// Shared test matrix — runs against both createSnapshot and createSnapshotAsync
// ---------------------------------------------------------------------------

describe.each([['createSnapshot', 'sync'] as const, ['createSnapshotAsync', 'async'] as const])(
  'UIBridgeRegistry snapshot enrichers (%s)',
  (_label, method) => {
    it('omits all canonical fields when no enrichers are set', async () => {
      const registry = new UIBridgeRegistry();
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      registry.registerElement('a', btn);

      const snap = await takeSnapshot(registry, method);

      expect(snap.page).toBeUndefined();
      expect(snap.modalStack).toBeUndefined();
      expect(snap.toasts).toBeUndefined();
      expect(snap.relationships).toBeUndefined();
      expect(snap.dragDrop).toBeUndefined();
      expect(snap.undoRedo).toBeUndefined();
      expect(snap.shortcuts).toBeUndefined();

      document.body.removeChild(btn);
    });

    it('populates only the canonical fields whose enrichers are registered', async () => {
      const registry = new UIBridgeRegistry();
      registry.setEnrichers({
        modalDetector: { getSnapshotModalContext: () => makeModalContext() },
      });

      const snap = await takeSnapshot(registry, method);

      expect(snap.modalStack).toBeDefined();
      expect(snap.modalStack?.hasBlockingModal).toBe(true);
      expect(snap.modalStack?.count).toBe(1);

      // None of the other six should appear
      expect(snap.page).toBeUndefined();
      expect(snap.toasts).toBeUndefined();
      expect(snap.relationships).toBeUndefined();
      expect(snap.dragDrop).toBeUndefined();
      expect(snap.undoRedo).toBeUndefined();
      expect(snap.shortcuts).toBeUndefined();
    });

    it('populates every canonical field when all seven enrichers are registered', async () => {
      const registry = new UIBridgeRegistry();
      registry.setEnrichers(makeAllEnrichers());

      const snap = await takeSnapshot(registry, method);

      expect(snap.page?.pathname).toBe('/test');
      expect(snap.modalStack?.count).toBe(1);
      expect(snap.toasts?.totalCaptured).toBe(7);
      expect(snap.relationships?.count).toBe(2);
      expect(snap.dragDrop?.count).toEqual({ dragSources: 0, dropZones: 0 });
      expect(snap.undoRedo?.undoAvailable).toBe(true);
      expect(snap.undoRedo?.summary).toContain('Typing');
      expect(snap.shortcuts?.lastScanTimestamp).toBe(1000);
    });

    it('isolates a throwing canonical enricher — other fields still appear', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const registry = new UIBridgeRegistry({ verbose: true });
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      registry.registerElement('a', btn);

      registry.setEnrichers({
        modalDetector: {
          getSnapshotModalContext: () => {
            throw new Error('boom');
          },
        },
        toastCapture: { getSnapshotToastContext: () => makeToastContext() },
        undoTracker: { getSnapshotUndoContext: () => makeUndoContext() },
      });

      const snap = await takeSnapshot(registry, method);

      expect(snap.modalStack).toBeUndefined();
      expect(snap.toasts).toBeDefined();
      expect(snap.undoRedo).toBeDefined();
      // Base snapshot still intact
      expect(snap.elements).toHaveLength(1);
      expect(snap.elements[0]?.id).toBe('a');
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
      document.body.removeChild(btn);
    });

    it('does not log enricher errors when verbose is false', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const registry = new UIBridgeRegistry();
      registry.setEnrichers({
        modalDetector: {
          getSnapshotModalContext: () => {
            throw new Error('boom');
          },
        },
      });

      const snap = await takeSnapshot(registry, method);

      expect(snap.modalStack).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('setEnrichers partially merges so HMR remounts do not clobber', async () => {
      const registry = new UIBridgeRegistry();

      registry.setEnrichers({
        toastCapture: { getSnapshotToastContext: () => makeToastContext() },
      });
      // Second call should NOT clobber the first
      registry.setEnrichers({
        modalDetector: { getSnapshotModalContext: () => makeModalContext() },
      });

      const snap = await takeSnapshot(registry, method);

      expect(snap.modalStack).toBeDefined();
      expect(snap.toasts).toBeDefined();
    });

    it('passes registered element pairs to relationship + drag-drop enrichers', async () => {
      const registry = new UIBridgeRegistry();
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      registry.registerElement('a', btn);

      const relSpy = vi.fn(() => makeRelationshipContext());
      const ddSpy = vi.fn(() => makeDragDropContext());
      registry.setEnrichers({
        relationshipTracker: { getSnapshotRelationshipContext: relSpy },
        dragDropDetector: { getSnapshotDragDropContext: ddSpy },
      });

      await takeSnapshot(registry, method);

      expect(relSpy).toHaveBeenCalledTimes(1);
      expect(ddSpy).toHaveBeenCalledTimes(1);
      const relArg = relSpy.mock.calls[0]?.[0];
      const ddArg = ddSpy.mock.calls[0]?.[0];
      expect(Array.isArray(relArg)).toBe(true);
      expect(relArg).toHaveLength(1);
      expect(relArg?.[0]?.id).toBe('a');
      expect(relArg?.[0]?.element).toBe(btn);
      expect(Array.isArray(ddArg)).toBe(true);
      expect(ddArg).toHaveLength(1);
      expect(ddArg?.[0]?.id).toBe('a');

      document.body.removeChild(btn);
    });

    it('registerSnapshotEnricher attaches a custom field; disposer removes it', async () => {
      const registry = new UIBridgeRegistry();
      const fn = vi.fn(() => ({ runnerTabs: { active: 'tab-terminal' } }));

      const dispose = registry.registerSnapshotEnricher('runner-tabs', fn);

      let snap = await takeSnapshot(registry, method);
      expect((snap as unknown as { runnerTabs?: { active: string } }).runnerTabs).toEqual({
        active: 'tab-terminal',
      });
      expect(fn).toHaveBeenCalledTimes(1);

      dispose();

      snap = await takeSnapshot(registry, method);
      expect((snap as unknown as { runnerTabs?: unknown }).runnerTabs).toBeUndefined();
    });

    it('unregisterSnapshotEnricher removes the named enricher', async () => {
      const registry = new UIBridgeRegistry();
      registry.registerSnapshotEnricher('runner-tabs', () => ({ runnerTabs: { x: 1 } }));

      let snap = await takeSnapshot(registry, method);
      expect((snap as unknown as { runnerTabs?: unknown }).runnerTabs).toBeDefined();

      registry.unregisterSnapshotEnricher('runner-tabs');

      snap = await takeSnapshot(registry, method);
      expect((snap as unknown as { runnerTabs?: unknown }).runnerTabs).toBeUndefined();
    });

    it('passes elements + getActiveTab + snapshotSoFar to custom enrichers', async () => {
      const registry = new UIBridgeRegistry();
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      registry.registerElement('a', btn);

      const fn = vi.fn(() => ({ runnerTabs: { ok: true } }));
      registry.registerSnapshotEnricher('runner-tabs', fn);

      const getActiveTab = () => 'tab-1';
      if (method === 'sync') {
        registry.createSnapshot({ getActiveTab });
      } else {
        await registry.createSnapshotAsync(50, { getActiveTab });
      }

      expect(fn).toHaveBeenCalledTimes(1);
      const arg = fn.mock.calls[0]?.[0];
      expect(Array.isArray(arg?.elements)).toBe(true);
      expect(arg?.elements).toHaveLength(1);
      expect(arg?.elements?.[0]?.id).toBe('a');
      expect(arg?.elements?.[0]?.element).toBe(btn);
      expect(arg?.getActiveTab).toBe(getActiveTab);
      // snapshotSoFar should expose the in-progress base snapshot, including
      // the activeTab the SDK has already resolved from getActiveTab.
      expect(arg?.snapshotSoFar).toBeDefined();
      expect(arg?.snapshotSoFar.activeTab).toBe('tab-1');
      expect(arg?.snapshotSoFar.elements).toHaveLength(1);

      document.body.removeChild(btn);
    });

    it('isolates throws from custom enrichers without breaking other enrichers', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const registry = new UIBridgeRegistry({ verbose: true });
      registry.registerSnapshotEnricher('bad', () => {
        throw new Error('nope');
      });
      registry.registerSnapshotEnricher('good', () => ({ goodField: 42 }));

      const snap = await takeSnapshot(registry, method);

      expect((snap as unknown as { goodField?: number }).goodField).toBe(42);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('ignores non-object returns from custom enrichers', async () => {
      const registry = new UIBridgeRegistry();
      // Returning a non-object (here typed-cast through unknown) shouldn't crash
      // and shouldn't merge anything onto the snapshot.
      registry.registerSnapshotEnricher('noop', () => null as unknown as Record<string, unknown>);

      const snap = await takeSnapshot(registry, method);

      // Sanity: snapshot still emits the standard top-level keys.
      expect(snap.elements).toBeDefined();
      expect(snap.components).toBeDefined();
    });
  }
);
