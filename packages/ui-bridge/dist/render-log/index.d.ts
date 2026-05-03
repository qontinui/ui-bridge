import { c7 as ElementIdentifier, at as ElementState } from '../types-gR41i0Eb.js';

/**
 * DOM Capture Module
 *
 * Utilities for capturing DOM snapshots and tracking changes.
 */

/**
 * Captured DOM element information
 */
interface CapturedElement {
    /** Element identifier */
    identifier: ElementIdentifier;
    /** Best single identifier string */
    bestId: string;
    /** Tag name */
    tagName: string;
    /** Element role */
    role?: string;
    /** Accessible name */
    accessibleName?: string;
    /** Text content (truncated) */
    textContent?: string;
    /** Element state */
    state: ElementState;
    /** Attributes relevant for automation */
    attributes: Record<string, string>;
    /** Child element count */
    childCount: number;
    /** Depth in the DOM tree */
    depth: number;
}
/**
 * DOM snapshot
 */
interface DOMSnapshot {
    /** Timestamp when snapshot was taken */
    timestamp: number;
    /** Page URL */
    url: string;
    /** Page title */
    title: string;
    /** Viewport dimensions */
    viewport: {
        width: number;
        height: number;
        scrollX: number;
        scrollY: number;
    };
    /** Captured elements */
    elements: CapturedElement[];
    /** Total DOM node count */
    totalNodeCount: number;
    /** Capture duration in milliseconds */
    captureDurationMs: number;
}
/**
 * Options for DOM capture
 */
interface CaptureOptions {
    /** Root element to capture from (defaults to document.body) */
    root?: HTMLElement;
    /** Maximum depth to traverse */
    maxDepth?: number;
    /** Maximum number of elements to capture */
    maxElements?: number;
    /** Only capture interactive elements */
    interactiveOnly?: boolean;
    /** Include hidden elements */
    includeHidden?: boolean;
    /** Selectors to include (whitelist) */
    includeSelectors?: string[];
    /** Selectors to exclude (blacklist) */
    excludeSelectors?: string[];
    /** Custom filter function */
    filter?: (element: HTMLElement) => boolean;
    /** Truncate text content to this length */
    maxTextLength?: number;
}
/**
 * Capture DOM snapshot
 */
declare function captureDOMSnapshot(options?: CaptureOptions): DOMSnapshot;
/**
 * Capture only interactive elements
 */
declare function captureInteractiveElements(options?: Omit<CaptureOptions, 'interactiveOnly'>): DOMSnapshot;
/**
 * Mutation record for tracked changes
 */
interface DOMChange {
    timestamp: number;
    type: 'added' | 'removed' | 'modified' | 'attribute';
    elementId?: string;
    tagName: string;
    details?: {
        attributeName?: string;
        oldValue?: string;
        newValue?: string;
        addedNodes?: number;
        removedNodes?: number;
    };
}
/**
 * DOM change observer
 */
declare class DOMChangeObserver {
    private observer;
    private changes;
    private maxChanges;
    private callback?;
    constructor(options?: {
        maxChanges?: number;
        callback?: (change: DOMChange) => void;
    });
    start(root?: HTMLElement): void;
    stop(): void;
    private processMutation;
    private addChange;
    getChanges(): DOMChange[];
    clearChanges(): void;
}

/**
 * Render Log Snapshot Module
 *
 * Manages render log entries and provides persistence options.
 */

/**
 * Render log entry types
 */
type RenderLogEntryType = 'snapshot' | 'change' | 'navigation' | 'interaction' | 'error' | 'custom';
/**
 * Base render log entry
 */
interface RenderLogEntry {
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
interface SnapshotEntry extends RenderLogEntry {
    type: 'snapshot';
    data: DOMSnapshot;
}
/**
 * Change entry
 */
interface ChangeEntry extends RenderLogEntry {
    type: 'change';
    data: DOMChange[];
}
/**
 * Navigation entry
 */
interface NavigationEntry extends RenderLogEntry {
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
interface InteractionEntry extends RenderLogEntry {
    type: 'interaction';
    data: {
        eventType: string;
        targetId?: string;
        targetTagName?: string;
        coordinates?: {
            x: number;
            y: number;
        };
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
interface ErrorEntry extends RenderLogEntry {
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
interface RenderLogStorage {
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
declare class InMemoryRenderLogStorage implements RenderLogStorage {
    private entries;
    private maxEntries;
    constructor(maxEntries?: number);
    append(entry: RenderLogEntry): Promise<void>;
    getEntries(options?: {
        type?: RenderLogEntryType;
        since?: number;
        until?: number;
        limit?: number;
    }): Promise<RenderLogEntry[]>;
    clear(): Promise<void>;
    count(): Promise<number>;
    /** Get entries synchronously (for in-memory only) */
    getEntriesSync(): RenderLogEntry[];
}
/**
 * Render log manager options
 */
interface RenderLogOptions {
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
declare class RenderLogManager {
    private storage;
    private changeObserver;
    private snapshotTimer;
    private pendingChanges;
    private options;
    private started;
    constructor(options?: RenderLogOptions);
    /**
     * Start capturing
     */
    start(): void;
    /**
     * Stop capturing
     */
    stop(): void;
    /**
     * Capture a DOM snapshot
     */
    captureSnapshot(metadata?: Record<string, unknown>): Promise<SnapshotEntry>;
    /**
     * Flush pending DOM changes
     */
    flushChanges(): Promise<ChangeEntry | null>;
    /**
     * Log an interaction
     */
    logInteraction(eventType: string, details: Omit<InteractionEntry['data'], 'eventType'>): Promise<InteractionEntry>;
    /**
     * Log an error
     */
    logError(message: string, details?: Omit<ErrorEntry['data'], 'message'>): Promise<ErrorEntry>;
    /**
     * Log a navigation
     */
    logNavigation(from: string, to: string, navigationType: NavigationEntry['data']['navigationType']): Promise<NavigationEntry>;
    /**
     * Add a custom entry
     */
    logCustom(data: unknown, metadata?: Record<string, unknown>): Promise<RenderLogEntry>;
    /**
     * Get log entries
     */
    getEntries(options?: {
        type?: RenderLogEntryType;
        since?: number;
        until?: number;
        limit?: number;
    }): Promise<RenderLogEntry[]>;
    /**
     * Clear the log
     */
    clear(): Promise<void>;
    /**
     * Get entry count
     */
    count(): Promise<number>;
    /**
     * Get the latest snapshot
     */
    getLatestSnapshot(): Promise<SnapshotEntry | null>;
    private addEntry;
    private setupNavigationObserver;
}
/**
 * Create a render log manager with default options
 */
declare function createRenderLogManager(options?: RenderLogOptions): RenderLogManager;

export { type CaptureOptions, type CapturedElement, type ChangeEntry, type DOMChange, DOMChangeObserver, type DOMSnapshot, type ErrorEntry, InMemoryRenderLogStorage, type InteractionEntry, type NavigationEntry, type RenderLogEntry, type RenderLogEntryType, RenderLogManager, type RenderLogOptions, type RenderLogStorage, type SnapshotEntry, captureDOMSnapshot, captureInteractiveElements, createRenderLogManager };
