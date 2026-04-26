import { aw as UndoTrackerConfig, ax as DeclaredUndoState, al as UndoRedoState, ay as SnapshotUndoContext, az as NavigationTrackerOptions, aA as NavigationEventData, aB as PageInfo, aC as PageNavigationEntry, aD as SnapshotPageContext, aE as RouteInfo, aF as DeveloperPageContext, aG as NavigationCompleteData, aH as ShortcutTrackerOptions, aI as KeyboardShortcut, aJ as SnapshotShortcutContext, aK as ModalDetectorConfig, aL as ModalStack, aM as SnapshotModalContext, aN as ModalInfo, aO as ToastCaptureConfig, aP as ToastEventData, aQ as ToastSnapshot, aR as SnapshotToastContext, aS as CapturedToast, aT as RelationshipType, aU as ElementRelationship, aV as SnapshotRelationshipContext, aW as DragSourceInfo, aX as DropZoneInfo, aY as SnapshotDragDropContext } from './types-X8pyInrK.js';

/**
 * Undo/Redo Tracker
 *
 * Stateful tracker that combines DOM detection with action history correlation
 * and developer-declared undo state to provide comprehensive undo/redo awareness.
 *
 * Responsibilities:
 * - Maintains a rolling buffer of recent bridge actions as potential undo targets
 * - Integrates with UndoDetector for DOM scanning
 * - Accepts developer-declared state via setDeclaredState() (from useUndoRedo hook)
 * - Produces SnapshotUndoContext for ControlSnapshot integration
 */

declare class UndoTracker {
    private readonly detector;
    private readonly maxActionEntries;
    /** Rolling buffer of recent bridge actions */
    private actionBuffer;
    /** Developer-declared state (set via setDeclaredState) */
    private declaredState;
    constructor(config?: UndoTrackerConfig);
    /**
     * Record a bridge action for undo correlation.
     * Call this when an action completes successfully.
     */
    recordAction(record: {
        id: string;
        target: string;
        action: string;
        params?: Record<string, unknown>;
    }): void;
    /**
     * Set developer-declared undo/redo state (from useUndoRedo hook).
     * This overrides heuristic detection with authoritative data.
     */
    setDeclaredState(state: DeclaredUndoState | null): void;
    /**
     * Get the current developer-declared state, if any.
     */
    getDeclaredState(): DeclaredUndoState | null;
    /**
     * Execute undo programmatically.
     * Uses developer handler if available, otherwise dispatches Ctrl+Z.
     * Returns true if an undo method was available to execute.
     */
    executeUndo(): boolean;
    /**
     * Execute redo programmatically.
     * Uses developer handler if available, otherwise dispatches Ctrl+Shift+Z.
     * Returns true if a redo method was available to execute.
     */
    executeRedo(): boolean;
    /**
     * Get the full undo/redo state by combining all detection sources.
     */
    getState(): UndoRedoState;
    /**
     * Get the snapshot context for ControlSnapshot integration.
     */
    getSnapshotUndoContext(): SnapshotUndoContext;
    private buildDeclaredState;
    private buildHeuristicState;
}

/**
 * Navigation Tracker
 *
 * Automatically tracks page navigations by intercepting the History API
 * (pushState, replaceState) and listening to popstate/hashchange events.
 * Optionally observes document.title changes via MutationObserver.
 *
 * Works with any SPA framework — no developer configuration required.
 */

/**
 * Tracks navigation events and provides current page state.
 */
declare class NavigationTracker {
    private history;
    private maxHistory;
    private installed;
    private titleObserver;
    private lastTitle;
    private currentPageInfo;
    private routeInfo;
    private developerContext;
    private onNavigation;
    private _lastCompleteNavigation;
    private _completionSeenKeys;
    private _completionListeners;
    private origPushState;
    private origReplaceState;
    private boundPopState;
    private boundHashChange;
    constructor(options?: NavigationTrackerOptions);
    /**
     * Install History API interception and event listeners.
     * Safe to call in non-browser environments (no-ops).
     */
    install(onNavigation?: (data: NavigationEventData) => void): void;
    /**
     * Uninstall all interceptions and listeners.
     */
    uninstall(): void;
    /**
     * Get current page info from browser state.
     */
    getCurrentPage(): PageInfo;
    /**
     * Get recent navigation history (most recent last).
     */
    getRecentNavigations(): PageNavigationEntry[];
    /**
     * Build the full SnapshotPageContext for inclusion in ControlSnapshot.
     */
    getSnapshotPageContext(): SnapshotPageContext;
    /**
     * Set framework router info (called by useRouteAwareness or similar).
     */
    setRouteInfo(info: RouteInfo | undefined): void;
    /**
     * Set developer-annotated page context (called by usePageContext).
     */
    setPageContext(context: DeveloperPageContext | undefined): void;
    /**
     * Get current developer context (for testing/debugging).
     */
    getDeveloperContext(): DeveloperPageContext | undefined;
    /**
     * Get current route info (for testing/debugging).
     */
    getRouteInfo(): RouteInfo | undefined;
    /**
     * Mark a navigation as complete. Idempotent per (url, completedAt) tuple.
     * Emits a navigation-complete event to any registered listeners.
     */
    markNavigationComplete(routeKey: string, metadata?: Record<string, unknown>): void;
    /**
     * Get the last completed navigation, if any.
     */
    get lastCompleteNavigation(): NavigationCompleteData | null;
    /**
     * Subscribe to navigation-complete events. Returns an unsubscribe function.
     */
    onNavigationComplete(listener: (data: NavigationCompleteData) => void): () => void;
    private handleNavigation;
    private record;
    private capturePageInfo;
    private installTitleObserver;
}

/**
 * Shortcut Tracker
 *
 * Discovers keyboard shortcuts by scanning the DOM for aria-keyshortcuts,
 * accesskey, data-shortcut/data-hotkey attributes, and title/tooltip hints.
 * Also accepts developer-registered shortcuts via registerShortcuts().
 *
 * Follows the NavigationTracker pattern — install/uninstall lifecycle,
 * periodic re-scan, and snapshot context generation.
 */

/**
 * Normalize a key combo string to canonical form.
 * Canonical order: Ctrl+Alt+Shift+Meta+<key>
 *
 * Examples:
 *   "shift+ctrl+t" → "Ctrl+Shift+T"
 *   "cmd+s" → "Meta+S"
 *   "Control+Alt+Delete" → "Ctrl+Alt+Delete"
 */
declare function normalizeCombo(raw: string): string;
/**
 * Tracks keyboard shortcuts registered by the application.
 */
declare class ShortcutTracker {
    private shortcuts;
    private installed;
    private observer;
    private rescanTimer;
    private lastScanTimestamp;
    private maxShortcuts;
    private scanDOM;
    private rescanInterval;
    constructor(options?: ShortcutTrackerOptions);
    /**
     * Install DOM scanning and observation.
     */
    install(): void;
    /**
     * Uninstall all observation and clean up.
     */
    uninstall(): void;
    /**
     * Register shortcuts from developer code (via useKeyboardShortcuts hook).
     */
    registerShortcuts(shortcuts: KeyboardShortcut[]): void;
    /**
     * Remove developer-registered shortcuts by combo string.
     */
    unregisterShortcuts(combos: string[]): void;
    /**
     * Get all tracked shortcuts.
     */
    getShortcuts(): KeyboardShortcut[];
    /**
     * Build the SnapshotShortcutContext for inclusion in ControlSnapshot.
     */
    getSnapshotShortcutContext(): SnapshotShortcutContext;
    /**
     * Force a DOM re-scan.
     */
    rescan(): void;
    private scan;
    private scanAriaKeyShortcuts;
    private scanAccessKeys;
    private scanDataAttributes;
    private scanTitleHints;
    private addScanned;
    private inferDescription;
    private enforceLimit;
}

/**
 * Modal/Dialog Stack Detector
 *
 * Scans the DOM on demand for active modal dialogs, overlays, drawers, and
 * other blocking UI patterns. Supports native HTML dialogs, ARIA roles, and
 * popular component libraries (MUI, Ant Design, Bootstrap, Chakra, Radix,
 * Headless UI).
 *
 * This is a stateless detector — no MutationObserver or install/uninstall
 * lifecycle. It queries the DOM each time `detect()` is called.
 */

declare class ModalDetector {
    private readonly config;
    constructor(config?: ModalDetectorConfig);
    /**
     * Scan the DOM for active modals and return the current stack.
     */
    detect(): ModalStack;
    /**
     * Get the snapshot context shape for ControlSnapshot integration.
     */
    getSnapshotModalContext(): SnapshotModalContext;
    /**
     * Convenience: get the topmost modal, if any.
     */
    getTopModal(): ModalInfo | undefined;
}

/**
 * Toast/Notification Capture
 *
 * Captures transient toast notifications by observing DOM mutations and
 * matching against known toast library selectors. Tracks appearance and
 * dismissal, infers severity level, and maintains a ring buffer of recent
 * toasts for snapshot integration.
 */

declare class ToastCapture {
    private config;
    private observer;
    private pollTimerId;
    private capturedElements;
    private activeToasts;
    private recentToasts;
    private totalCaptured;
    private idCounter;
    private installed;
    private onToastEvent;
    private scanScheduled;
    private allSelectors;
    constructor(config?: ToastCaptureConfig);
    install(onToastEvent?: (data: ToastEventData) => void): void;
    uninstall(): void;
    getSnapshot(): ToastSnapshot;
    getSnapshotToastContext(): SnapshotToastContext;
    getActive(): CapturedToast[];
    getRecent(count?: number): CapturedToast[];
    private scheduleScan;
    private scanForToasts;
    private querySelectorsFallback;
    private captureToast;
    private checkDismissals;
    private dismissToast;
    private pruneRecent;
    private getActiveList;
}

/**
 * Relationship Tracker
 *
 * Manages element relationships from three sources:
 * 1. Developer-declared (via hooks): stored in an internal map
 * 2. ARIA auto-detected: scanned from DOM on demand
 * 3. HTML auto-detected: scanned from DOM on demand
 *
 * The tracker merges all sources and deduplicates when producing snapshots.
 */

declare class RelationshipTracker {
    /**
     * Developer-declared relationships, keyed by `${source}|${target}|${type}`.
     */
    private declared;
    /**
     * Cached auto-detected relationships from the last `refreshAutoDetected()` call.
     * Used by AutoRegisterProvider so ARIA/HTML scanning happens once per batch
     * rather than on every snapshot request.
     */
    private cachedAutoDetected;
    /**
     * Declare a relationship between two elements.
     *
     * If a relationship with the same source, target, and type already exists it
     * is overwritten.
     */
    declare(source: string, target: string, type: RelationshipType, options?: {
        bidirectional?: boolean;
        metadata?: Record<string, unknown>;
    }): void;
    /**
     * Remove a declared relationship.
     *
     * If `type` is provided, removes only that specific relationship.
     * Otherwise removes ALL relationships between source and target.
     */
    undeclare(source: string, target: string, type?: RelationshipType): void;
    /**
     * Remove ALL relationships where `elementId` appears as source OR target.
     *
     * Useful for cleanup when an element unmounts.
     */
    undeclareAll(elementId: string): void;
    /**
     * Return all developer-declared relationships.
     */
    getDeclared(): ElementRelationship[];
    /**
     * Scan the DOM for ARIA relationship attributes among the provided elements.
     *
     * Only relationships where both source and target are in the provided element
     * list are included.
     *
     * @param elements - Registered elements with their DOM nodes
     * @returns Detected ARIA relationships
     */
    scanARIARelationships(elements: Array<{
        id: string;
        element: Element;
    }>): ElementRelationship[];
    /**
     * Scan the DOM for HTML structural relationships among the provided elements.
     *
     * Detects:
     * - `<label for="id">` explicit label associations
     * - `<label>` wrapping an input (implicit label association)
     *
     * @param elements - Registered elements with their DOM nodes
     * @returns Detected HTML relationships
     */
    scanHTMLRelationships(elements: Array<{
        id: string;
        element: Element;
    }>): ElementRelationship[];
    /**
     * Re-scan ARIA and HTML relationships for the given elements and cache the
     * results. Subsequent calls to `getRelationships()` without an `elements`
     * argument will include these cached auto-detected relationships.
     *
     * This is called automatically by `useAutoRegister` after each batch of
     * element registrations, making ARIA/HTML relationship data "free" for
     * AutoRegisterProvider users without per-snapshot DOM scanning.
     */
    refreshAutoDetected(elements: Array<{
        id: string;
        element: Element;
    }>): void;
    /**
     * Clear the auto-detected relationship cache.
     */
    clearAutoDetected(): void;
    /**
     * Return all relationships (declared + ARIA + HTML), deduplicated.
     *
     * When the same source+target+type exists from multiple origins, the one
     * with the highest priority is kept: declared > aria > html.
     *
     * @param elements - Optional registered elements for on-demand auto-detection
     *   scanning. If omitted, uses cached auto-detected relationships (from
     *   `refreshAutoDetected()`) plus declared relationships.
     */
    getRelationships(elements?: Array<{
        id: string;
        element: Element;
    }>): ElementRelationship[];
    /**
     * Return the snapshot relationship context for ControlSnapshot integration.
     */
    getSnapshotRelationshipContext(elements?: Array<{
        id: string;
        element: Element;
    }>): SnapshotRelationshipContext;
    /**
     * Return all relationships where `elementId` is source OR target.
     */
    getRelationshipsFor(elementId: string, elements?: Array<{
        id: string;
        element: Element;
    }>): ElementRelationship[];
    /**
     * Return IDs of elements related to `elementId`, optionally filtered by type.
     *
     * If `elementId` is the source, returns the target IDs (and vice versa).
     */
    getRelatedElements(elementId: string, type?: RelationshipType, elements?: Array<{
        id: string;
        element: Element;
    }>): string[];
}

/**
 * Drag-and-Drop Detector
 *
 * Detects drag sources and drop zones from three sources:
 * 1. Developer-declared (via hooks): stored in internal maps
 * 2. ARIA auto-detected: aria-grabbed, aria-dropeffect
 * 3. DOM auto-detected: draggable attribute, cursor-grab CSS, structural heuristics
 *
 * Follows the same pattern as RelationshipTracker: developer declarations are
 * stored persistently, while auto-detected results are cached after batch
 * registration via refreshAutoDetected().
 */

declare class DragDropDetector {
    /**
     * Developer-declared drag sources, keyed by element ID.
     */
    private declaredSources;
    /**
     * Developer-declared drop zones, keyed by element ID.
     */
    private declaredZones;
    /**
     * Cached auto-detected drag sources from the last refreshAutoDetected() call.
     */
    private cachedAutoSources;
    /**
     * Cached auto-detected drop zones from the last refreshAutoDetected() call.
     */
    private cachedAutoZones;
    /**
     * Declare an element as a drag source.
     */
    declareDragSource(id: string, options?: {
        dataType?: string;
        label?: string;
        metadata?: Record<string, unknown>;
    }): void;
    /**
     * Remove a declared drag source.
     */
    undeclareDragSource(id: string): void;
    /**
     * Declare an element as a drop zone.
     */
    declareDropZone(id: string, options?: {
        accepts?: string[];
        effect?: string;
        label?: string;
        metadata?: Record<string, unknown>;
    }): void;
    /**
     * Remove a declared drop zone.
     */
    undeclareDropZone(id: string): void;
    /**
     * Remove ALL declarations where `elementId` appears.
     * Useful for cleanup when an element unmounts.
     */
    undeclareAll(elementId: string): void;
    /**
     * Scan elements for ARIA drag-drop attributes.
     *
     * Detects:
     * - `aria-grabbed="true"` → drag source
     * - `aria-dropeffect` → drop zone
     */
    scanARIA(elements: Array<{
        id: string;
        element: Element;
    }>): {
        sources: DragSourceInfo[];
        zones: DropZoneInfo[];
    };
    /**
     * Scan elements for DOM-based drag-drop indicators.
     *
     * Detects:
     * - `draggable="true"` attribute
     * - CSS grab/move cursor classes or computed styles
     * - Structural heuristic: containers with multiple draggable children → sortable drop zone
     */
    scanDOM(elements: Array<{
        id: string;
        element: Element;
    }>): {
        sources: DragSourceInfo[];
        zones: DropZoneInfo[];
    };
    /**
     * Check if an element is a drag source based on DOM/CSS indicators.
     */
    private isDragSource;
    /**
     * Check if there's a closer registered container between `container` and
     * its draggable children. Walks up from each drag source toward `container`
     * looking for intermediate registered non-drag-source elements.
     *
     * O(depth × sources) instead of O(n³).
     */
    private hasCloserRegisteredContainer;
    /**
     * Heuristic: does this element look like a list/sortable container?
     */
    private looksLikeList;
    /**
     * Extract a human-readable label from an element.
     */
    private extractLabel;
    /**
     * Re-scan ARIA and DOM drag-drop indicators for the given elements and
     * cache the results. Called automatically by useAutoRegister after each
     * batch of element registrations.
     */
    refreshAutoDetected(elements: Array<{
        id: string;
        element: Element;
    }>): void;
    /**
     * Clear the auto-detected cache.
     */
    clearAutoDetected(): void;
    /**
     * Return all drag sources (declared + auto-detected), deduplicated.
     * Declared sources take priority over auto-detected ones.
     */
    getDragSources(elements?: Array<{
        id: string;
        element: Element;
    }>): DragSourceInfo[];
    /**
     * Return all drop zones (declared + auto-detected), deduplicated.
     * Declared zones take priority over auto-detected ones.
     */
    getDropZones(elements?: Array<{
        id: string;
        element: Element;
    }>): DropZoneInfo[];
    /**
     * Return the snapshot context for ControlSnapshot integration.
     */
    getSnapshotDragDropContext(elements?: Array<{
        id: string;
        element: Element;
    }>): SnapshotDragDropContext;
    /**
     * Get drop zones that accept a given data type.
     */
    getDropZonesForType(dataType: string, elements?: Array<{
        id: string;
        element: Element;
    }>): DropZoneInfo[];
    /**
     * Get drag sources contained within a specific drop zone.
     */
    getDragSourcesInZone(zoneId: string, elements?: Array<{
        id: string;
        element: Element;
    }>): DragSourceInfo[];
    private deduplicateSources;
    private deduplicateZones;
}

export { DragDropDetector as D, ModalDetector as M, NavigationTracker as N, RelationshipTracker as R, ShortcutTracker as S, ToastCapture as T, UndoTracker as U, normalizeCombo as n };
