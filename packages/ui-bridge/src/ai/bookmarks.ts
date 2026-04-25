/**
 * Snapshot Bookmark Store (B2)
 *
 * Process-wide registry of named `SnapshotBookmark` entries. Mirrors the
 * design of `getGlobalStubRegistry()` in `network/stubs.ts` (F2).
 *
 * Design:
 *   - Module-level singleton accessed via `getGlobalBookmarkStore()`.
 *     Bookmarks must survive React re-renders and the parallel write/read
 *     paths in `react/commandHandlers.ts` (browser-SDK dispatcher) and
 *     `ai/change-tracker.ts` (runner ChangeTracker instances) must share
 *     the same backing map. Previously each path owned its own `Map`, so a
 *     `POST /ai/bookmarks` written via one path was invisible to a
 *     subsequent `GET /ai/bookmarks` resolved through the other.
 *   - Eviction: oldest-by-`savedAt` when at `maxBookmarks` capacity, mirroring
 *     the prior ChangeTracker behaviour.
 *   - Cleared on hard reload (module state is reinitialised); persists across
 *     soft navigations exactly like the stub registry does.
 */

import type { SemanticSnapshot } from './types';

/** Named snapshot bookmark stored in the registry. */
export interface SnapshotBookmarkEntry {
  /** Bookmark name (unique key). */
  name: string;
  /** Semantic snapshot captured at save time. */
  snapshot: SemanticSnapshot;
  /** Epoch ms when the bookmark was saved. */
  savedAt: number;
}

/**
 * Process-wide store of named bookmarks. Created lazily by
 * `getGlobalBookmarkStore()` and shared by every code path that needs
 * to read or write bookmarks.
 */
export class BookmarkStore {
  private bookmarks = new Map<string, SnapshotBookmarkEntry>();
  private maxBookmarks: number;

  constructor(maxBookmarks = 50) {
    this.maxBookmarks = Math.max(1, maxBookmarks);
  }

  /**
   * Configure the eviction cap. The store keeps the configured number of
   * most-recently-saved bookmarks. Overwriting an existing name does not
   * count toward the cap.
   */
  setMaxBookmarks(max: number): void {
    this.maxBookmarks = Math.max(1, max);
    // If the new cap is smaller than the current set, evict oldest now so
    // the invariant holds going forward.
    while (this.bookmarks.size > this.maxBookmarks) {
      const oldest = this.findOldestKey();
      if (oldest === null) break;
      this.bookmarks.delete(oldest);
    }
  }

  /** Save (or overwrite) a bookmark. Returns the stored entry. */
  save(entry: SnapshotBookmarkEntry): SnapshotBookmarkEntry {
    if (this.bookmarks.size >= this.maxBookmarks && !this.bookmarks.has(entry.name)) {
      const oldest = this.findOldestKey();
      if (oldest !== null) {
        this.bookmarks.delete(oldest);
      }
    }
    this.bookmarks.set(entry.name, entry);
    return entry;
  }

  /** Get a bookmark by name, or null if missing. */
  get(name: string): SnapshotBookmarkEntry | null {
    return this.bookmarks.get(name) ?? null;
  }

  /** Returns true if the named bookmark exists. */
  has(name: string): boolean {
    return this.bookmarks.has(name);
  }

  /** Delete a bookmark. Returns true if it existed. */
  delete(name: string): boolean {
    return this.bookmarks.delete(name);
  }

  /** List bookmark names in insertion order. */
  listNames(): string[] {
    return [...this.bookmarks.keys()];
  }

  /** List all bookmark entries in insertion order. */
  list(): SnapshotBookmarkEntry[] {
    return [...this.bookmarks.values()];
  }

  /** Number of bookmarks currently stored. */
  size(): number {
    return this.bookmarks.size;
  }

  /** Remove every bookmark. Returns the number cleared. */
  clear(): number {
    const n = this.bookmarks.size;
    this.bookmarks.clear();
    return n;
  }

  private findOldestKey(): string | null {
    let oldestKey: string | null = null;
    let oldestSavedAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.bookmarks) {
      if (entry.savedAt < oldestSavedAt) {
        oldestSavedAt = entry.savedAt;
        oldestKey = key;
      }
    }
    return oldestKey;
  }
}

// ============================================================================
// Module-level singleton
// ============================================================================

let globalStore: BookmarkStore | null = null;

/**
 * Access the process-wide bookmark store. Module-level so bookmarks
 * survive React re-renders and so the SDK browser dispatcher
 * (`react/commandHandlers.ts`) and the ChangeTracker class
 * (`ai/change-tracker.ts`) share a single backing map.
 */
export function getGlobalBookmarkStore(): BookmarkStore {
  if (!globalStore) {
    globalStore = new BookmarkStore();
  }
  return globalStore;
}

/**
 * Test helper: replace the singleton with a fresh, empty store. Tests that
 * exercise bookmark behaviour should call this in `beforeEach` so they
 * don't see leftovers from earlier tests.
 */
export function __resetGlobalBookmarkStoreForTest(maxBookmarks?: number): BookmarkStore {
  globalStore = new BookmarkStore(maxBookmarks);
  return globalStore;
}
