/**
 * BookmarkStore tests (B2)
 *
 * Covers the process-wide bookmark singleton plus the save → list → diff →
 * delete → list-empty lifecycle as exercised through `ChangeTracker`. The
 * lifecycle test is the regression guard against the bug observed in the
 * 2026-04-25 manual test where `POST /ai/bookmarks` saved into one map
 * but `GET /ai/bookmarks` read from a different one and returned `[]`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BookmarkStore,
  getGlobalBookmarkStore,
  __resetGlobalBookmarkStoreForTest,
  type SnapshotBookmarkEntry,
} from '../bookmarks';
import { ChangeTracker } from '../change-tracker';
import type { ChangeTrackerDeps } from '../change-tracker';
import type { SemanticSnapshot } from '../types';
import type { ControlSnapshot } from '../../control/types';

// ============================================================================
// Helpers
// ============================================================================

let snapshotId = 0;

function makeSnapshot(elementIds: string[]): SemanticSnapshot {
  snapshotId++;
  return {
    timestamp: Date.now(),
    snapshotId: `snap-${snapshotId}`,
    page: { url: 'http://localhost/test', title: 't', activeModals: [] },
    elements: elementIds.map((id) => ({
      id,
      type: 'button',
      label: id,
      tagName: 'button',
      actions: ['click'],
      state: {
        visible: true,
        enabled: true,
        focused: false,
        rect: { x: 0, y: 0, width: 10, height: 10, top: 0, right: 10, bottom: 10, left: 0 },
        textContent: id,
      },
      registered: true,
      description: id,
      aliases: [],
      suggestedActions: [],
      category: 'interactive' as const,
    })),
    forms: [],
    activeModals: [],
    summary: 's',
    elementCounts: {},
  };
}

function makeBookmark(name: string, elementIds: string[] = ['a']): SnapshotBookmarkEntry {
  return { name, snapshot: makeSnapshot(elementIds), savedAt: Date.now() };
}

function makeTrackerDeps(snapshots: SemanticSnapshot[]): {
  deps: ChangeTrackerDeps;
  createSnapshot: ReturnType<typeof vi.fn>;
} {
  const queue = [...snapshots];
  const createSnapshot = vi.fn(() => {
    const next = queue.shift();
    if (!next) throw new Error('test bug: ran out of queued snapshots');
    return next;
  });
  const deps: ChangeTrackerDeps = {
    snapshotManager: { createSnapshot } as unknown as ChangeTrackerDeps['snapshotManager'],
    idleDetector: null,
    createControlSnapshot: vi.fn().mockReturnValue({} as ControlSnapshot),
    refreshElements: vi.fn(),
  };
  return { deps, createSnapshot };
}

// ============================================================================
// Tests
// ============================================================================

describe('BookmarkStore', () => {
  beforeEach(() => {
    __resetGlobalBookmarkStoreForTest();
  });

  describe('singleton', () => {
    it('returns a stable instance', () => {
      expect(getGlobalBookmarkStore()).toBe(getGlobalBookmarkStore());
    });

    it('__resetGlobalBookmarkStoreForTest replaces the instance', () => {
      const before = getGlobalBookmarkStore();
      before.save(makeBookmark('keep'));
      __resetGlobalBookmarkStoreForTest();
      const after = getGlobalBookmarkStore();
      expect(after).not.toBe(before);
      expect(after.list()).toHaveLength(0);
    });
  });

  describe('save / get / list / delete', () => {
    it('saves and retrieves a bookmark', () => {
      const store = new BookmarkStore();
      const bm = makeBookmark('a');
      store.save(bm);
      expect(store.get('a')).toEqual(bm);
      expect(store.has('a')).toBe(true);
    });

    it('returns null for unknown name', () => {
      const store = new BookmarkStore();
      expect(store.get('missing')).toBeNull();
      expect(store.has('missing')).toBe(false);
    });

    it('lists names in insertion order', () => {
      const store = new BookmarkStore();
      store.save(makeBookmark('first'));
      store.save(makeBookmark('second'));
      store.save(makeBookmark('third'));
      expect(store.listNames()).toEqual(['first', 'second', 'third']);
    });

    it('list() returns full entries', () => {
      const store = new BookmarkStore();
      const a = makeBookmark('a');
      const b = makeBookmark('b');
      store.save(a);
      store.save(b);
      expect(store.list()).toEqual([a, b]);
    });

    it('overwrite does not duplicate the name', () => {
      const store = new BookmarkStore();
      store.save(makeBookmark('x'));
      store.save(makeBookmark('x'));
      expect(store.listNames()).toEqual(['x']);
      expect(store.size()).toBe(1);
    });

    it('delete removes the entry and returns true', () => {
      const store = new BookmarkStore();
      store.save(makeBookmark('temp'));
      expect(store.delete('temp')).toBe(true);
      expect(store.delete('temp')).toBe(false);
      expect(store.listNames()).toEqual([]);
    });

    it('clear empties everything and returns the count', () => {
      const store = new BookmarkStore();
      store.save(makeBookmark('a'));
      store.save(makeBookmark('b'));
      expect(store.clear()).toBe(2);
      expect(store.size()).toBe(0);
    });
  });

  describe('eviction', () => {
    it('evicts the oldest entry when at capacity', () => {
      const store = new BookmarkStore(3);
      store.save({ name: 'a', snapshot: makeSnapshot(['a']), savedAt: 100 });
      store.save({ name: 'b', snapshot: makeSnapshot(['b']), savedAt: 200 });
      store.save({ name: 'c', snapshot: makeSnapshot(['c']), savedAt: 300 });
      store.save({ name: 'd', snapshot: makeSnapshot(['d']), savedAt: 400 });
      expect(store.has('a')).toBe(false);
      expect(store.listNames()).toEqual(['b', 'c', 'd']);
    });

    it('overwriting an existing name does not trigger eviction', () => {
      const store = new BookmarkStore(2);
      store.save({ name: 'a', snapshot: makeSnapshot(['a']), savedAt: 100 });
      store.save({ name: 'b', snapshot: makeSnapshot(['b']), savedAt: 200 });
      // Re-saving 'a' should NOT evict 'b' even though we're at cap.
      store.save({ name: 'a', snapshot: makeSnapshot(['a2']), savedAt: 300 });
      expect(store.has('a')).toBe(true);
      expect(store.has('b')).toBe(true);
    });

    it('setMaxBookmarks shrinks the store when reduced', () => {
      const store = new BookmarkStore(5);
      store.save({ name: 'a', snapshot: makeSnapshot(['a']), savedAt: 1 });
      store.save({ name: 'b', snapshot: makeSnapshot(['b']), savedAt: 2 });
      store.save({ name: 'c', snapshot: makeSnapshot(['c']), savedAt: 3 });
      store.setMaxBookmarks(1);
      expect(store.size()).toBe(1);
      // Newest survives
      expect(store.has('c')).toBe(true);
    });
  });

  // ==========================================================================
  // Lifecycle through ChangeTracker (the path the runner exercises)
  // ==========================================================================

  describe('save → list → diff → delete → list-empty (regression for B2 manual-test bug)', () => {
    it('keeps the bookmark visible across save and list calls', () => {
      // Two snapshots: one for save, one for diff (post-change).
      const before = makeSnapshot(['btn-1']);
      const after = makeSnapshot(['btn-1', 'btn-2']);
      const { deps } = makeTrackerDeps([before, after]);
      const tracker = new ChangeTracker(deps);

      // 1. save
      const saved = tracker.saveBookmark('before-test');
      expect(saved.name).toBe('before-test');
      expect(saved.savedAt).toBeGreaterThan(0);

      // 2. list — this is the assertion that failed pre-fix.
      expect(tracker.listBookmarks()).toEqual(['before-test']);

      // The store must also be visible to a *separate* code path that
      // reads through the singleton (e.g. `react/commandHandlers.ts`).
      // We simulate that by reading the singleton directly.
      const fromSingleton = getGlobalBookmarkStore().get('before-test');
      expect(fromSingleton).not.toBeNull();
      expect(fromSingleton?.name).toBe('before-test');

      // 3. diff — current state has a new element, so the diff must be
      // non-empty. Pre-fix this returned null because the bookmark wasn't
      // in the store the diff handler queried.
      const diff = tracker.diffFromBookmark('before-test');
      expect(diff).not.toBeNull();
      expect(diff!.changes.appeared.map((c) => c.elementId)).toContain('btn-2');

      // 4. delete
      expect(tracker.deleteBookmark('before-test')).toBe(true);

      // 5. list-empty
      expect(tracker.listBookmarks()).toEqual([]);
      expect(tracker.diffFromBookmark('before-test')).toBeNull();
    });

    it('multiple ChangeTracker instances share one bookmark store', () => {
      // This is the architectural invariant: even if two ChangeTracker
      // instances exist (e.g. the `wait_for_route_change` lazy-init path
      // on the runner constructed one before `save_bookmark` constructed
      // a second), they must agree on the bookmark set.
      const snap = makeSnapshot(['x']);
      const { deps: depsA } = makeTrackerDeps([snap]);
      const { deps: depsB } = makeTrackerDeps([]);
      const trackerA = new ChangeTracker(depsA);
      const trackerB = new ChangeTracker(depsB);

      trackerA.saveBookmark('shared');
      expect(trackerB.listBookmarks()).toEqual(['shared']);
      expect(trackerB.getBookmark('shared')).not.toBeNull();
    });
  });
});
