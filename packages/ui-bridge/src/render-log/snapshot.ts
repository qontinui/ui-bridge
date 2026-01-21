/**
 * Render Log Snapshot Module
 *
 * Manages render log entries and provides persistence options.
 */

import type { DOMSnapshot, DOMChange, CaptureOptions } from './dom-capture';
import { captureDOMSnapshot, DOMChangeObserver } from './dom-capture';

/**
 * Render log entry types
 */
export type RenderLogEntryType =
  | 'snapshot'
  | 'change'
  | 'navigation'
  | 'interaction'
  | 'error'
  | 'custom';

/**
 * Base render log entry
 */
export interface RenderLogEntry {
  /** Unique entry ID */
  id: string;
  /** Entry type */
  type: RenderLogEntryType;
  /** Timestamp */
  timestamp: number;
  /** Entry data */
  data: unknown;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Snapshot entry
 */
export interface SnapshotEntry extends RenderLogEntry {
  type: 'snapshot';
  data: DOMSnapshot;
}

/**
 * Change entry
 */
export interface ChangeEntry extends RenderLogEntry {
  type: 'change';
  data: DOMChange[];
}

/**
 * Navigation entry
 */
export interface NavigationEntry extends RenderLogEntry {
  type: 'navigation';
  data: {
    from: string;
    to: string;
    navigationType: 'push' | 'replace' | 'pop' | 'reload';
  };
}

/**
 * Interaction entry
 */
export interface InteractionEntry extends RenderLogEntry {
  type: 'interaction';
  data: {
    eventType: string;
    targetId?: string;
    targetTagName?: string;
    coordinates?: { x: number; y: number };
    key?: string;
    modifiers?: {
      ctrl: boolean;
      shift: boolean;
      alt: boolean;
      meta: boolean;
    };
  };
}

/**
 * Error entry
 */
export interface ErrorEntry extends RenderLogEntry {
  type: 'error';
  data: {
    message: string;
    stack?: string;
    source?: string;
    lineno?: number;
    colno?: number;
  };
}

/**
 * Render log storage interface
 */
export interface RenderLogStorage {
  /** Append an entry to the log */
  append(entry: RenderLogEntry): Promise<void>;
  /** Get entries by type and/or time range */
  getEntries(options?: {
    type?: RenderLogEntryType;
    since?: number;
    until?: number;
    limit?: number;
  }): Promise<RenderLogEntry[]>;
  /** Clear the log */
  clear(): Promise<void>;
  /** Get total entry count */
  count(): Promise<number>;
}

/**
 * In-memory render log storage
 */
export class InMemoryRenderLogStorage implements RenderLogStorage {
  private entries: RenderLogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  async append(entry: RenderLogEntry): Promise<void> {
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  async getEntries(options?: {
    type?: RenderLogEntryType;
    since?: number;
    until?: number;
    limit?: number;
  }): Promise<RenderLogEntry[]> {
    let results = [...this.entries];

    if (options?.type) {
      results = results.filter((e) => e.type === options.type);
    }
    if (options?.since) {
      results = results.filter((e) => e.timestamp >= options.since!);
    }
    if (options?.until) {
      results = results.filter((e) => e.timestamp <= options.until!);
    }
    if (options?.limit) {
      results = results.slice(-options.limit);
    }

    return results;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  async count(): Promise<number> {
    return this.entries.length;
  }

  /** Get entries synchronously (for in-memory only) */
  getEntriesSync(): RenderLogEntry[] {
    return [...this.entries];
  }
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Render log manager options
 */
export interface RenderLogOptions {
  /** Storage implementation */
  storage?: RenderLogStorage;
  /** Automatically capture snapshots on navigation */
  captureOnNavigation?: boolean;
  /** Automatically capture DOM changes */
  captureChanges?: boolean;
  /** Capture interval for periodic snapshots (ms) */
  snapshotInterval?: number;
  /** Default capture options */
  captureOptions?: CaptureOptions;
  /** Callback when entry is added */
  onEntry?: (entry: RenderLogEntry) => void;
  /** Maximum entries to keep */
  maxEntries?: number;
}

/**
 * Render Log Manager
 *
 * Central manager for capturing and storing render logs.
 */
export class RenderLogManager {
  private storage: RenderLogStorage;
  private changeObserver: DOMChangeObserver | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private pendingChanges: DOMChange[] = [];
  private options: RenderLogOptions;
  private started = false;

  constructor(options: RenderLogOptions = {}) {
    this.options = options;
    this.storage = options.storage ?? new InMemoryRenderLogStorage(options.maxEntries);
  }

  /**
   * Start capturing
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Set up change observer
    if (this.options.captureChanges !== false) {
      this.changeObserver = new DOMChangeObserver({
        callback: (change) => {
          this.pendingChanges.push(change);
        },
      });
      this.changeObserver.start();
    }

    // Set up navigation observer
    if (this.options.captureOnNavigation !== false) {
      this.setupNavigationObserver();
    }

    // Set up periodic snapshots
    if (this.options.snapshotInterval) {
      this.snapshotTimer = setInterval(() => {
        this.captureSnapshot();
      }, this.options.snapshotInterval);
    }

    // Capture initial snapshot
    this.captureSnapshot();
  }

  /**
   * Stop capturing
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.changeObserver?.stop();
    this.changeObserver = null;

    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  /**
   * Capture a DOM snapshot
   */
  async captureSnapshot(metadata?: Record<string, unknown>): Promise<SnapshotEntry> {
    // Flush pending changes first
    if (this.pendingChanges.length > 0) {
      await this.flushChanges();
    }

    const snapshot = captureDOMSnapshot(this.options.captureOptions);
    const entry: SnapshotEntry = {
      id: generateId(),
      type: 'snapshot',
      timestamp: snapshot.timestamp,
      data: snapshot,
      metadata,
    };

    await this.addEntry(entry);
    return entry;
  }

  /**
   * Flush pending DOM changes
   */
  async flushChanges(): Promise<ChangeEntry | null> {
    if (this.pendingChanges.length === 0) return null;

    const changes = [...this.pendingChanges];
    this.pendingChanges = [];

    const entry: ChangeEntry = {
      id: generateId(),
      type: 'change',
      timestamp: Date.now(),
      data: changes,
    };

    await this.addEntry(entry);
    return entry;
  }

  /**
   * Log an interaction
   */
  async logInteraction(
    eventType: string,
    details: Omit<InteractionEntry['data'], 'eventType'>
  ): Promise<InteractionEntry> {
    const entry: InteractionEntry = {
      id: generateId(),
      type: 'interaction',
      timestamp: Date.now(),
      data: {
        eventType,
        ...details,
      },
    };

    await this.addEntry(entry);
    return entry;
  }

  /**
   * Log an error
   */
  async logError(
    message: string,
    details?: Omit<ErrorEntry['data'], 'message'>
  ): Promise<ErrorEntry> {
    const entry: ErrorEntry = {
      id: generateId(),
      type: 'error',
      timestamp: Date.now(),
      data: {
        message,
        ...details,
      },
    };

    await this.addEntry(entry);
    return entry;
  }

  /**
   * Log a navigation
   */
  async logNavigation(
    from: string,
    to: string,
    navigationType: NavigationEntry['data']['navigationType']
  ): Promise<NavigationEntry> {
    const entry: NavigationEntry = {
      id: generateId(),
      type: 'navigation',
      timestamp: Date.now(),
      data: {
        from,
        to,
        navigationType,
      },
    };

    await this.addEntry(entry);
    return entry;
  }

  /**
   * Add a custom entry
   */
  async logCustom(
    data: unknown,
    metadata?: Record<string, unknown>
  ): Promise<RenderLogEntry> {
    const entry: RenderLogEntry = {
      id: generateId(),
      type: 'custom',
      timestamp: Date.now(),
      data,
      metadata,
    };

    await this.addEntry(entry);
    return entry;
  }

  /**
   * Get log entries
   */
  async getEntries(options?: {
    type?: RenderLogEntryType;
    since?: number;
    until?: number;
    limit?: number;
  }): Promise<RenderLogEntry[]> {
    return this.storage.getEntries(options);
  }

  /**
   * Clear the log
   */
  async clear(): Promise<void> {
    this.pendingChanges = [];
    await this.storage.clear();
  }

  /**
   * Get entry count
   */
  async count(): Promise<number> {
    return this.storage.count();
  }

  /**
   * Get the latest snapshot
   */
  async getLatestSnapshot(): Promise<SnapshotEntry | null> {
    const snapshots = await this.storage.getEntries({ type: 'snapshot', limit: 1 });
    return (snapshots[0] as SnapshotEntry) || null;
  }

  private async addEntry(entry: RenderLogEntry): Promise<void> {
    await this.storage.append(entry);
    this.options.onEntry?.(entry);
  }

  private setupNavigationObserver(): void {
    let lastUrl = window.location.href;

    // History API
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      const result = originalPushState.apply(history, args);
      const newUrl = window.location.href;
      if (newUrl !== lastUrl) {
        this.logNavigation(lastUrl, newUrl, 'push');
        this.captureSnapshot({ trigger: 'navigation' });
        lastUrl = newUrl;
      }
      return result;
    };

    history.replaceState = (...args) => {
      const result = originalReplaceState.apply(history, args);
      const newUrl = window.location.href;
      if (newUrl !== lastUrl) {
        this.logNavigation(lastUrl, newUrl, 'replace');
        this.captureSnapshot({ trigger: 'navigation' });
        lastUrl = newUrl;
      }
      return result;
    };

    // Popstate (back/forward)
    window.addEventListener('popstate', () => {
      const newUrl = window.location.href;
      if (newUrl !== lastUrl) {
        this.logNavigation(lastUrl, newUrl, 'pop');
        this.captureSnapshot({ trigger: 'navigation' });
        lastUrl = newUrl;
      }
    });
  }
}

/**
 * Create a render log manager with default options
 */
export function createRenderLogManager(options?: RenderLogOptions): RenderLogManager {
  return new RenderLogManager(options);
}
