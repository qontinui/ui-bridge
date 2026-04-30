/**
 * Element Event Log
 *
 * Query/projection layer over the bridge event stream, scoped by element ID.
 * Uses a single shared ring buffer to avoid per-element memory allocation.
 */

/**
 * Element Event Log
 *
 * Ingests bridge events, tags them by element ID, and stores them in a shared
 * ring buffer. Provides per-element history queries with filtering.
 */
declare class ElementEventLog {
    private buffer;
    private maxEntries;
    private defaultLevel;
    private levelOverrides;
    constructor(config?: ElementEventLogConfig);
    /**
     * Ingest a bridge event. Extracts element ID, classifies level,
     * gates against the effective level, and appends to the shared buffer.
     */
    ingest(event: BridgeEvent): void;
    /**
     * Query the history for a specific element.
     */
    getHistory(elementId: string, options?: ElementHistoryOptions): ElementLogEntry[];
    /**
     * Set a per-element log level override.
     */
    setElementLogLevel(elementId: string, level: ElementLogLevel): void;
    /**
     * Get the effective log level for an element.
     */
    getElementLogLevel(elementId: string): ElementLogLevel;
    /**
     * Remove per-element override and clean up. Entries age out via FIFO.
     */
    removeElement(elementId: string): void;
    /**
     * Clear all entries and overrides.
     */
    clear(): void;
    /**
     * Get stats about the current buffer.
     */
    getStats(): {
        totalEntries: number;
        uniqueElements: number;
        oldestTimestamp: number | null;
    };
}

/**
 * Browser Event Capture Types
 *
 * Discriminated union of all browser-side events captured for debugging.
 */
type BrowserEventType = 'console' | 'network' | 'react-error' | 'navigation' | 'long-task' | 'long-animation-frame' | 'resource-error' | 'web-vital' | 'memory' | 'ws-disconnection' | 'hmr' | 'freeze' | 'dom-metrics';
interface BrowserCapturedEvent {
    type: BrowserEventType;
    timestamp: number;
    url: string;
}
interface ConsoleCapturedEvent extends BrowserCapturedEvent {
    type: 'console';
    level: 'error' | 'warn' | 'unhandledrejection';
    message: string;
    stack?: string;
}
interface NetworkCapturedEvent extends BrowserCapturedEvent {
    type: 'network';
    method: string;
    requestUrl: string;
    status?: number;
    statusText?: string;
    durationMs: number;
    kind: 'http-error' | 'network-error' | 'timeout' | 'cors' | 'abort';
    errorMessage?: string;
}
interface ReactErrorCapturedEvent extends BrowserCapturedEvent {
    type: 'react-error';
    message: string;
    stack?: string;
    componentStack?: string;
}
interface NavigationCapturedEvent extends BrowserCapturedEvent {
    type: 'navigation';
    from: string;
    to: string;
    trigger: 'pushState' | 'replaceState' | 'popstate';
}
interface LongTaskCapturedEvent extends BrowserCapturedEvent {
    type: 'long-task';
    durationMs: number;
}
interface ResourceErrorCapturedEvent extends BrowserCapturedEvent {
    type: 'resource-error';
    resourceUrl: string;
    tagName: string;
}
interface WebVitalCapturedEvent extends BrowserCapturedEvent {
    type: 'web-vital';
    metric: 'LCP' | 'CLS' | 'INP';
    value: number;
}
interface MemoryCapturedEvent extends BrowserCapturedEvent {
    type: 'memory';
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
}
interface WsDisconnectionCapturedEvent extends BrowserCapturedEvent {
    type: 'ws-disconnection';
    previousState: string;
    newState: string;
    reconnectAttempt?: number;
}
interface HmrCapturedEvent extends BrowserCapturedEvent {
    type: 'hmr';
    level: 'error' | 'warning';
    message: string;
    /** Source file that caused the error, if available */
    moduleName?: string;
    /** Source location (line:col), if available */
    loc?: string;
}
interface FreezeCapturedEvent extends BrowserCapturedEvent {
    type: 'freeze';
    gapMs: number;
    expectedMs: number;
}
interface DomMetricsCapturedEvent extends BrowserCapturedEvent {
    type: 'dom-metrics';
    nodeCount: number;
    listenerCount?: number;
}
interface LoafScriptAttribution {
    invoker: string;
    sourceURL: string;
    sourceFunctionName: string;
    sourceCharPosition: number;
    duration: number;
}
interface LoafCapturedEvent extends BrowserCapturedEvent {
    type: 'long-animation-frame';
    durationMs: number;
    blockingDurationMs: number;
    scripts: LoafScriptAttribution[];
}
type AnyCapturedEvent = ConsoleCapturedEvent | NetworkCapturedEvent | ReactErrorCapturedEvent | NavigationCapturedEvent | LongTaskCapturedEvent | LoafCapturedEvent | ResourceErrorCapturedEvent | WebVitalCapturedEvent | MemoryCapturedEvent | WsDisconnectionCapturedEvent | HmrCapturedEvent | FreezeCapturedEvent | DomMetricsCapturedEvent;
type OnBrowserEventCallback = (event: AnyCapturedEvent) => void;
interface CapturedError {
    timestamp: number;
    level: 'error' | 'warn' | 'unhandledrejection';
    message: string;
    stack?: string;
}
/**
 * @deprecated Use OnBrowserEventCallback instead
 */
type OnCaptureCallback = (entry: CapturedError) => void;
interface BrowserCaptureConfig {
    /** Capture console.error/warn + unhandled rejections. Default: true */
    console?: boolean;
    /** Capture failed fetch requests (4xx/5xx/network errors). Default: true */
    network?: boolean;
    /** Capture History API navigation. Default: true */
    navigation?: boolean;
    /** Capture PerformanceObserver long tasks. Default: true */
    longTasks?: boolean;
    /** Capture Long Animation Frames (LoAF) with script attribution. Default: true */
    longAnimationFrames?: boolean;
    /** Capture failed resource loads (img/script/link). Default: true */
    resourceErrors?: boolean;
    /** Capture WebSocket disconnection events. Default: true */
    wsDisconnections?: boolean;
    /** Capture Next.js HMR compilation errors/warnings via EventSource. Default: true */
    hmr?: boolean;
    /** Detect framework error overlays (Next.js, Vite, React error boundary). Default: true */
    frameworkOverlays?: boolean;
    /** Capture Web Vitals (LCP, CLS). Default: false (opt-in) */
    webVitals?: boolean;
    /** Capture Chrome memory snapshots. Default: false (opt-in) */
    memory?: boolean;
    /** Advanced: network capture options */
    networkOptions?: {
        /** URL patterns to ignore (substrings). Defaults to dev-debug/ui-bridge endpoints. */
        ignorePatterns?: string[];
    };
    /** Advanced: memory polling interval in ms. Default: 30000 */
    memoryIntervalMs?: number;
    /** Capture UI freeze detection (main thread stalls). Default: false (opt-in) */
    freezeDetector?: boolean;
    /** Freeze detection: threshold in ms to consider a freeze. Default: 3000 */
    freezeThresholdMs?: number;
    /** Freeze detection: check interval in ms. Default: 200 */
    freezeIntervalMs?: number;
    /** Capture DOM node count metrics. Default: false (opt-in) */
    domMetrics?: boolean;
    /** DOM metrics: polling interval in ms. Default: 10000 */
    domMetricsIntervalMs?: number;
    /** Maximum buffer size. Default: 200 */
    maxEntries?: number;
}
declare const DEFAULT_CAPTURE_CONFIG: Required<Pick<BrowserCaptureConfig, 'console' | 'network' | 'navigation' | 'longTasks' | 'longAnimationFrames' | 'resourceErrors' | 'wsDisconnections' | 'hmr' | 'frameworkOverlays' | 'webVitals' | 'memory' | 'memoryIntervalMs' | 'freezeDetector' | 'freezeThresholdMs' | 'freezeIntervalMs' | 'domMetrics' | 'domMetricsIntervalMs' | 'maxEntries'>>;

/**
 * Framework Error Overlay Capture Sub-module
 *
 * Detects framework error overlays from Next.js, Vite, and React error
 * boundaries using DOM observation. Emits events when overlays appear or
 * disappear, and exposes current overlay state for snapshot enrichment.
 *
 * Detected overlays:
 * - Next.js: `nextjs-portal` / `nextjs__container_errors_*` elements
 * - Vite: `vite-error-overlay` custom element
 * - React Error Boundary: elements with `data-react-error-boundary` attribute
 *   (or common fallback patterns like role="alert" with error-like content)
 */

type Emit = (event: AnyCapturedEvent) => void;
interface DetectedErrorOverlay {
    /** Which framework produced this overlay */
    framework: 'nextjs' | 'vite' | 'react-error-boundary';
    /** Whether the overlay is currently visible */
    visible: boolean;
    /** Title or heading extracted from the overlay */
    title?: string;
    /** Error message extracted from the overlay */
    message?: string;
    /** Source file reference, if available */
    file?: string;
}
/**
 * Detect currently visible framework error overlays.
 * Returns an array of detected overlays (empty if none visible).
 */
declare function getActiveOverlays(): DetectedErrorOverlay[];
declare function installFrameworkOverlayCapture(emit: Emit): () => void;

/**
 * Navigation / Page-Route Awareness Types
 *
 * Types for tracking page navigation state, route information,
 * and navigation history within the UI Bridge.
 */
/**
 * How a navigation was triggered
 */
type NavigationTrigger = 'push' | 'replace' | 'pop' | 'initial' | 'hash';
/**
 * A single navigation event in the history buffer
 */
interface PageNavigationEntry {
    /** URL navigated from (empty for initial load) */
    from: string;
    /** URL navigated to */
    to: string;
    /** How the navigation was triggered */
    trigger: NavigationTrigger;
    /** Timestamp of the navigation */
    timestamp: number;
}
/**
 * Current page information extracted from the browser
 */
interface PageInfo {
    /** Full URL (window.location.href) */
    url: string;
    /** Pathname only (window.location.pathname) */
    pathname: string;
    /** Query string including ? (window.location.search) */
    search: string;
    /** Hash fragment including # (window.location.hash) */
    hash: string;
    /** Document title */
    title: string;
}
/**
 * Structured route information provided by framework router integration
 */
interface RouteInfo {
    /** Route pattern (e.g., "/tasks/:id") */
    pattern?: string;
    /** Extracted route parameters (e.g., { id: "123" }) */
    params?: Record<string, string>;
    /** Query parameters as key-value pairs */
    queryParams?: Record<string, string>;
    /** Matched route stack / breadcrumb (e.g., ["/", "/tasks", "/tasks/:id"]) */
    routeStack?: string[];
}
/**
 * Semantic page context provided by developers via usePageContext()
 */
interface DeveloperPageContext {
    /** Semantic page name (e.g., "Task Detail", "Dashboard") */
    name: string;
    /** Application section/area (e.g., "tasks", "settings", "admin") */
    section?: string;
    /** Breadcrumb trail (e.g., ["Tasks", "Task #123"]) */
    breadcrumb?: string[];
    /** Arbitrary metadata */
    meta?: Record<string, unknown>;
}
/**
 * Full page context included in ControlSnapshot.
 * Combines auto-detected info with developer-provided context.
 */
interface SnapshotPageContext {
    /** Full URL */
    url: string;
    /** Pathname only */
    pathname: string;
    /** Query string */
    search: string;
    /** Hash fragment */
    hash: string;
    /** Document title */
    title: string;
    /** Recent navigation history (most recent last) */
    recentNavigations: PageNavigationEntry[];
    /** Framework router info (if provided via useRouteAwareness) */
    route?: RouteInfo;
    /** Developer-annotated page context (if provided via usePageContext) */
    pageContext?: DeveloperPageContext;
}
/**
 * Configuration for the NavigationTracker
 */
interface NavigationTrackerOptions {
    /** Maximum number of navigation entries to keep (default: 20) */
    maxHistory?: number;
    /** Whether to observe document.title changes (default: true) */
    observeTitle?: boolean;
}
/**
 * Data emitted with navigation:change bridge events
 */
interface NavigationEventData {
    /** Previous page info */
    from: PageInfo;
    /** New page info */
    to: PageInfo;
    /** How the navigation was triggered */
    trigger: NavigationTrigger;
}
/**
 * Data tracked when a navigation is explicitly marked complete
 */
interface NavigationCompleteData {
    /** URL at which navigation completed */
    url: string;
    /** Timestamp when the navigation was marked complete */
    completedAt: number;
    /** Application-defined route key (e.g., "/tasks/:id") */
    routeKey: string;
    /** Optional metadata from the caller */
    metadata?: Record<string, unknown>;
}
/**
 * Parameters for the wait_for_navigation_complete IPC command
 */
interface WaitForNavigationParams {
    /** Only match navigations completed after this timestamp */
    since?: number;
    /** Only match navigations whose URL matches this pattern (substring or regex) */
    urlPattern?: string;
    /** Maximum time to wait in milliseconds */
    timeout: number;
}
/**
 * Result of the wait_for_navigation_complete IPC command
 */
interface WaitForNavigationResult {
    /** Whether navigation completed (true) or timed out (false) */
    completed: boolean;
    /** URL where navigation completed */
    url?: string;
    /** Application-defined route key */
    routeKey?: string;
    /** Timestamp when the navigation completed */
    completedAt?: number;
    /** Whether the signal came from an explicit markNavigationComplete call or idle-based fallback */
    source: 'explicit' | 'fallback-idle';
}

/**
 * Keyboard Shortcut Discovery Types
 *
 * Types for tracking keyboard shortcuts registered by the application,
 * enabling AI agents to use shortcuts for faster automation.
 */
/**
 * How a shortcut was discovered
 */
type ShortcutSource = 'aria-keyshortcuts' | 'accesskey' | 'title-hint' | 'data-attribute' | 'developer';
/**
 * A single keyboard shortcut
 */
interface KeyboardShortcut {
    /** Normalized key combo: "Ctrl+Shift+T", "Alt+N", "Escape" */
    combo: string;
    /** What the shortcut does (human-readable) */
    description?: string;
    /** Associated element ID in the bridge registry */
    elementId?: string;
    /** How this shortcut was discovered */
    source: ShortcutSource;
    /** Scope/context where this shortcut works (e.g., "global", "editor") */
    scope?: string;
}
/**
 * Configuration for ShortcutTracker
 */
interface ShortcutTrackerOptions {
    /** Scan DOM for aria-keyshortcuts, accesskey, title hints (default: true) */
    scanDOM?: boolean;
    /** Interval (ms) for periodic DOM re-scan (default: 5000, 0 = disable) */
    rescanInterval?: number;
    /** Maximum shortcuts to track (default: 200) */
    maxShortcuts?: number;
}
/**
 * Context included in ControlSnapshot.shortcuts
 */
interface SnapshotShortcutContext {
    /** All discovered shortcuts */
    shortcuts: KeyboardShortcut[];
    /** Total count */
    totalCount: number;
    /** When the last scan/update occurred */
    lastScanTimestamp: number;
}

/**
 * Modal/Dialog Stack Types
 *
 * Types for detecting and tracking modal dialogs, overlays, and blocking UI.
 */
/**
 * Information about a detected modal/dialog
 */
interface ModalInfo {
    /** Unique identifier (element id, or generated) */
    id: string;
    /** Dialog title text, if detectable */
    title?: string;
    /** Type of modal */
    type: 'dialog' | 'alertdialog' | 'modal' | 'drawer' | 'popover' | 'sheet';
    /** Whether this modal blocks interaction with content behind it */
    blocking: boolean;
    /** Computed z-index of the modal */
    zIndex: number;
    /** Whether a backdrop/overlay is present */
    hasBackdrop: boolean;
    /** CSS selector for the close button, if found */
    closeButton?: string;
    /** Text of the primary action button, if found */
    primaryAction?: string;
    /** Whether ESC key dismisses this modal */
    escDismiss: boolean;
    /** ARIA role */
    role?: string;
    /** ARIA label or labelledby text */
    ariaLabel?: string;
    /** Timestamp when detected */
    detectedAt: number;
    /** CSS selector that can target this modal */
    selector: string;
}
/**
 * Stack of active modals with analysis
 */
interface ModalStack {
    /** Active modals ordered by z-index (topmost last) */
    modals: ModalInfo[];
    /** The topmost modal, if any */
    topModal?: ModalInfo;
    /** Whether any blocking modal is present */
    hasBlockingModal: boolean;
    /** Count of active modals */
    count: number;
    /** Timestamp of snapshot */
    timestamp: number;
}
/**
 * Snapshot context for ControlSnapshot integration
 */
interface SnapshotModalContext {
    /** Active modals ordered by z-index */
    modals: ModalInfo[];
    /** Topmost modal info */
    topModal?: ModalInfo;
    /** Whether a blocking modal is present */
    hasBlockingModal: boolean;
    /** Number of active modals */
    count: number;
}
/**
 * Configuration for modal detection
 */
interface ModalDetectorConfig {
    /** Additional CSS selectors to check for modals */
    customSelectors?: string[];
    /** Whether to detect backdrop elements (default: true) */
    detectBackdrop?: boolean;
    /** Whether to detect close buttons (default: true) */
    detectCloseButton?: boolean;
    /** Whether to detect primary actions (default: true) */
    detectPrimaryAction?: boolean;
}

/**
 * Toast/Notification Detection Types
 *
 * Types for capturing and tracking transient toast notifications.
 */
/**
 * Severity level of a toast notification
 */
type ToastLevel = 'info' | 'success' | 'warning' | 'error' | 'loading' | 'unknown';
/**
 * A captured toast notification
 */
interface CapturedToast {
    /** Unique identifier */
    id: string;
    /** Toast message text */
    message: string;
    /** Severity level */
    level: ToastLevel;
    /** When the toast appeared (ms since epoch) */
    appearedAt: number;
    /** When the toast was dismissed (ms since epoch), if observed */
    dismissedAt?: number;
    /** Whether the toast is currently visible */
    visible: boolean;
    /** How long the toast was/has been visible (ms) */
    durationMs: number;
    /** Source library if detectable */
    source?: string;
    /** Whether toast has an action button */
    hasAction?: boolean;
    /** Action button text if present */
    actionText?: string;
}
/**
 * Snapshot of toast state
 */
interface ToastSnapshot {
    /** Currently visible toasts */
    active: CapturedToast[];
    /** Recently dismissed toasts (ring buffer) */
    recent: CapturedToast[];
    /** Total toasts captured since install */
    totalCaptured: number;
}
/**
 * Snapshot context for ControlSnapshot integration
 */
interface SnapshotToastContext {
    /** Currently visible toasts */
    active: CapturedToast[];
    /** Recently dismissed toasts */
    recent: CapturedToast[];
    /** Total captured since tracking began */
    totalCaptured: number;
}
/**
 * Configuration for toast capture
 */
interface ToastCaptureConfig {
    /** Maximum number of recent toasts to keep (default: 20) */
    maxRecent?: number;
    /** Additional CSS selectors to watch for toasts */
    customSelectors?: string[];
    /** How long a dismissed toast stays in recent buffer (ms, default: 60000) */
    recentRetention?: number;
    /** Polling interval for dismissal detection (ms, default: 500) */
    pollInterval?: number;
}
/**
 * Toast event data for bridge events
 */
interface ToastEventData {
    /** The toast that appeared or was dismissed */
    toast: CapturedToast;
    /** Event type */
    action: 'appeared' | 'dismissed';
}

/**
 * Element Relationship Types
 *
 * Types for declaring and tracking semantic relationships between UI elements.
 * Relationships can be developer-declared (via hooks) or auto-detected from
 * ARIA attributes and HTML structure.
 */
/**
 * Well-known relationship types.
 *
 * Extensible with any string for domain-specific relationships.
 */
type RelationshipType = 'controls' | 'filters' | 'validates' | 'labels' | 'describes' | 'submits' | 'activates' | 'toggles' | 'populates' | 'navigatesTo' | 'dependsOn' | 'owns' | (string & {});
/**
 * Where the relationship was detected from
 */
type RelationshipOrigin = 'declared' | 'aria' | 'html';
/**
 * A semantic relationship between two UI elements
 */
interface ElementRelationship {
    /** Source element ID (the element that has the relationship) */
    source: string;
    /** Target element ID (the element being related to) */
    target: string;
    /** Type of relationship */
    type: RelationshipType;
    /** How the relationship was detected */
    origin: RelationshipOrigin;
    /** Whether the relationship applies in both directions */
    bidirectional?: boolean;
    /** Optional metadata about the relationship */
    metadata?: Record<string, unknown>;
}
/**
 * Inline relationship declaration for useUIElement options
 */
interface InlineRelationship {
    /** Target element ID */
    target: string;
    /** Relationship type */
    type: RelationshipType;
    /** Whether bidirectional */
    bidirectional?: boolean;
    /** Optional metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Snapshot context for ControlSnapshot integration
 */
interface SnapshotRelationshipContext {
    /** All relationships (declared + auto-detected, deduplicated) */
    relationships: ElementRelationship[];
    /** Total count */
    count: number;
    /** Breakdown by origin */
    byOrigin: {
        declared: number;
        aria: number;
        html: number;
    };
}
/**
 * Options for the useUIRelationship hook
 */
interface UseUIRelationshipOptions {
    /** Whether the relationship is bidirectional (default: false) */
    bidirectional?: boolean;
    /** Optional metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Drag-and-Drop Discovery Types
 *
 * Types for detecting and reporting drag sources, drop zones, and their
 * relationships. Supports developer-declared, ARIA-detected, and
 * CSS/DOM heuristic-detected drag-drop patterns.
 */
/**
 * Where the drag-drop information was detected from
 */
type DragDropOrigin = 'declared' | 'aria' | 'dom';
/**
 * The type of drag operation
 */
type DragEffect = 'move' | 'copy' | 'link' | 'reorder' | (string & {});
/**
 * A detected drag source element
 */
interface DragSourceInfo {
    /** UI Bridge element ID */
    id: string;
    /** Human-readable label (from aria-label, textContent, etc.) */
    label?: string;
    /** The kind of data this source represents (e.g., 'workflow-step', 'file', 'list-item') */
    dataType?: string;
    /** How it was detected */
    origin: DragDropOrigin;
    /** Whether the element has native draggable="true" */
    nativeDraggable: boolean;
    /** Whether a grab cursor was detected (CSS heuristic) */
    hasGrabCursor: boolean;
    /** Optional developer-provided metadata */
    metadata?: Record<string, unknown>;
}
/**
 * A detected drop zone element
 */
interface DropZoneInfo {
    /** UI Bridge element ID */
    id: string;
    /** Human-readable label */
    label?: string;
    /** Data types this zone accepts (if declared) */
    accepts?: string[];
    /** The effect when dropped here */
    effect?: DragEffect;
    /** How it was detected */
    origin: DragDropOrigin;
    /** ARIA dropeffect value, if present */
    ariaDropEffect?: string;
    /** Whether this is a sortable container (contains multiple draggable children) */
    isSortable: boolean;
    /** IDs of draggable children contained in this zone */
    containedDragSources?: string[];
    /** Optional developer-provided metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Snapshot context for ControlSnapshot integration
 */
interface SnapshotDragDropContext {
    /** Detected drag source elements */
    dragSources: DragSourceInfo[];
    /** Detected drop zones */
    dropZones: DropZoneInfo[];
    /** Summary counts */
    count: {
        dragSources: number;
        dropZones: number;
    };
    /** Breakdown by detection origin */
    byOrigin: {
        declared: number;
        aria: number;
        dom: number;
    };
}
/**
 * Options for the useDragSource hook
 */
interface UseDragSourceOptions {
    /** The kind of data this source represents */
    dataType?: string;
    /** Human-readable label */
    label?: string;
    /** Optional metadata about the drag source */
    metadata?: Record<string, unknown>;
}
/**
 * Options for the useDropZone hook
 */
interface UseDropZoneOptions {
    /** Data types this zone accepts */
    accepts?: string[];
    /** The effect when dropped here */
    effect?: DragEffect;
    /** Human-readable label */
    label?: string;
    /** Optional metadata about the drop zone */
    metadata?: Record<string, unknown>;
}

/**
 * Undo/Redo Awareness Types
 *
 * Types for detecting and tracking undo/redo availability in the UI.
 */
/**
 * How the undo/redo capability was detected
 */
type UndoDetectionSource = 'dom-element' | 'exec-command' | 'shortcut' | 'developer-declared';
/**
 * A single undo or redo stack entry
 */
interface UndoEntry {
    /** Human-readable description of what this entry represents */
    description: string;
    /** How this entry was detected */
    source: UndoDetectionSource;
    /** Bridge action ID that caused this entry (if correlated from action history) */
    actionId?: string;
    /** Confidence level 0–1 */
    confidence: number;
    /** Timestamp when this entry was recorded */
    timestamp: number;
}
/**
 * Information about a detected undo/redo DOM element (button, menu item, etc.)
 */
interface UndoElementInfo {
    /** CSS selector that targets this element */
    selector: string;
    /** Whether the element is currently enabled (not disabled/aria-disabled) */
    enabled: boolean;
    /** Label text (aria-label, title, textContent) */
    label?: string;
    /** Description parsed from the label (e.g., "Typing" from "Undo Typing") */
    parsedDescription?: string;
}
/**
 * Full undo/redo state
 */
interface UndoRedoState {
    /** Whether undo appears to be available */
    undoAvailable: boolean;
    /** Whether redo appears to be available */
    redoAvailable: boolean;
    /** Description of what undo would reverse (if determinable) */
    undoDescription?: string;
    /** Description of what redo would restore (if determinable) */
    redoDescription?: string;
    /** Undo stack depth (if known — usually only from developer declaration) */
    undoDepth?: number;
    /** Redo stack depth (if known — usually only from developer declaration) */
    redoDepth?: number;
    /** Known undo entries (most recent first) */
    undoStack: UndoEntry[];
    /** Known redo entries (most recent first) */
    redoStack: UndoEntry[];
    /** How the state was detected */
    detectionSources: UndoDetectionSource[];
    /** Keyboard shortcut to trigger undo (if known) */
    undoShortcut?: string;
    /** Keyboard shortcut to trigger redo (if known) */
    redoShortcut?: string;
    /** Detected undo DOM element */
    undoElement?: UndoElementInfo;
    /** Detected redo DOM element */
    redoElement?: UndoElementInfo;
    /** Timestamp of this state snapshot */
    timestamp: number;
}
/**
 * Snapshot context for ControlSnapshot integration
 */
interface SnapshotUndoContext {
    /** Whether undo appears to be available */
    undoAvailable: boolean;
    /** Whether redo appears to be available */
    redoAvailable: boolean;
    /** Description of what undo would reverse */
    undoDescription?: string;
    /** Description of what redo would restore */
    redoDescription?: string;
    /** Undo stack depth (if known) */
    undoDepth?: number;
    /** Redo stack depth (if known) */
    redoDepth?: number;
    /** Human-readable summary for AI */
    summary: string;
}
/**
 * Configuration for the undo detector
 */
interface UndoDetectorConfig {
    /** Additional CSS selectors to check for undo buttons/elements */
    customUndoSelectors?: string[];
    /** Additional CSS selectors to check for redo buttons/elements */
    customRedoSelectors?: string[];
    /** Whether to use document.execCommand probe (default: true) */
    useExecCommand?: boolean;
}
/**
 * Developer-declared undo/redo state (via useUndoRedo hook)
 */
interface DeclaredUndoState {
    /** Whether undo is currently available */
    canUndo: boolean;
    /** Whether redo is currently available */
    canRedo: boolean;
    /** Description of next undo */
    undoDescription?: string;
    /** Description of next redo */
    redoDescription?: string;
    /** Full undo stack descriptions (most recent first) */
    undoStack?: string[];
    /** Full redo stack descriptions (most recent first) */
    redoStack?: string[];
    /** Execute undo programmatically */
    onUndo?: () => void;
    /** Execute redo programmatically */
    onRedo?: () => void;
}
/**
 * Configuration for the undo tracker
 */
interface UndoTrackerConfig {
    /** Maximum number of action-correlated entries to keep */
    maxActionEntries?: number;
    /** Detector configuration */
    detectorConfig?: UndoDetectorConfig;
}

/**
 * Extended action request with additional options
 */
interface ControlActionRequest extends ActionRequest {
    /** Unique request ID for tracking */
    requestId?: string;
    /** Capture snapshot after action */
    captureAfter?: boolean;
    /** Retry options if action fails */
    retryOptions?: {
        maxRetries: number;
        retryDelay: number;
        retryOn?: ('timeout' | 'notFound' | 'disabled' | 'error')[];
    };
    /**
     * Wait for idle after the action completes.
     *
     * - `'idle'` — wait for composite idle (all signals)
     * - `string` — wait for a specific signal (e.g., `'network'`, `'dom'`)
     * - `string[]` — wait for multiple signals
     * - `{ indicator: string }` — wait for a CSS selector to disappear
     */
    waitAfter?: 'idle' | string | string[] | {
        indicator: string;
    };
    /** Timeout for waitAfter in ms (default: 10000) */
    waitAfterTimeout?: number;
    /** Minimum stable time for waitAfter in ms (default: 300) */
    waitAfterMinStable?: number;
}
/**
 * Extended action response with additional info
 */
interface ControlActionResponse extends ActionResponse {
    /** Request ID if provided */
    requestId?: string;
    /** Snapshot captured after action */
    snapshot?: unknown;
    /** Number of retries attempted */
    retryCount?: number;
    /** Wait duration before action */
    waitDurationMs?: number;
    /** Time spent waiting for idle after action (ms) */
    idleWaitMs?: number;
    /** DOM changes caused by the action (populated when captureAfter: true) */
    changes?: ActionChanges;
}
/**
 * Component action request
 */
interface ComponentActionRequest {
    /** Action ID to execute */
    action: string;
    /** Action parameters */
    params?: Record<string, unknown>;
    /** Unique request ID */
    requestId?: string;
}
/**
 * Component action response
 */
interface ComponentActionResponse {
    /** Whether the action succeeded */
    success: boolean;
    /** Result from the action */
    result?: unknown;
    /** Error message if failed */
    error?: string;
    /** Stack trace if failed */
    stack?: string;
    /** Duration of the action */
    durationMs: number;
    /** Timestamp when completed */
    timestamp: number;
    /** Request ID if provided */
    requestId?: string;
}
/**
 * Workflow run request
 */
interface WorkflowRunRequest {
    /** Parameters for the workflow */
    params?: Record<string, unknown>;
    /** Request ID for tracking */
    requestId?: string;
    /** Start from a specific step */
    startStep?: string;
    /** Stop at a specific step */
    stopStep?: string;
    /** Step timeout */
    stepTimeout?: number;
    /** Total workflow timeout */
    workflowTimeout?: number;
}
/**
 * Workflow step result
 */
interface WorkflowStepResult {
    /** Step ID */
    stepId: string;
    /** Step type */
    stepType: string;
    /** Whether the step succeeded */
    success: boolean;
    /** Step result */
    result?: unknown;
    /** Error if failed */
    error?: string;
    /** Duration in milliseconds */
    durationMs: number;
    /** Timestamp when completed */
    timestamp: number;
}
/**
 * Workflow run status
 */
type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
/**
 * Workflow run response
 */
interface WorkflowRunResponse {
    /** Workflow ID */
    workflowId: string;
    /** Run ID for tracking */
    runId: string;
    /** Current status */
    status: WorkflowRunStatus;
    /** Step results */
    steps: WorkflowStepResult[];
    /** Current step index */
    currentStep?: number;
    /** Total steps */
    totalSteps: number;
    /** Overall success */
    success?: boolean;
    /** Error message if failed */
    error?: string;
    /** Start timestamp */
    startedAt: number;
    /** End timestamp */
    completedAt?: number;
    /** Total duration */
    durationMs?: number;
}
/**
 * Element info for discovery
 */
interface DiscoveredElement {
    /** Element ID */
    id: string;
    /** Element type */
    type: string;
    /** Human-readable label */
    label?: string;
    /** Tag name */
    tagName: string;
    /** Role attribute */
    role?: string;
    /** Accessible name */
    accessibleName?: string;
    /** Available actions */
    actions: string[];
    /** Current state */
    state: ElementState;
    /** Whether registered with UI Bridge */
    registered: boolean;
    /** Whether this is an interactive element, static content, or media */
    category?: 'interactive' | 'content' | 'media';
    /**
     * High-level element kind. `"content"` for plain semantic content
     * (cards/badges/pills) tagged with `data-ui-bridge-content`;
     * `"interactive"` otherwise. Mirrors `category`.
     */
    kind?: 'interactive' | 'content';
    /** Normalized text content for data-ui-bridge-content elements */
    content?: string;
    /** CSS className attribute */
    className?: string;
    /** CSS class list as array */
    classes?: string[];
    /** Metadata for content elements */
    contentMetadata?: ContentMetadata;
    /** Metadata for media elements */
    mediaMetadata?: MediaMetadata;
}
/**
 * Find request options
 *
 * Used to find/discover controllable elements in the UI.
 */
interface FindRequest {
    /** Root element selector to start from */
    root?: string;
    /** Only find interactive elements */
    interactiveOnly?: boolean;
    /** Include hidden elements */
    includeHidden?: boolean;
    /** Maximum elements to return */
    limit?: number;
    /** Filter by element type */
    types?: string[];
    /** Filter by text content, label, or accessible name (substring match, case-insensitive) */
    text?: string;
    /** Filter by ARIA role */
    role?: string;
    /** Filter by element type (single type — alias for types with one value) */
    element_type?: string;
    /** Filter by label (substring match, case-insensitive) */
    label?: string;
    /** Filter by exact text content or label (case-insensitive, trimmed) */
    exact_text?: string;
    /** Filter by selector */
    selector?: string;
    /** Filter by data-testid attribute (exact match) */
    testId?: string;
    /** Include content (non-interactive) elements in results */
    includeContent?: boolean;
    /** Only return content elements */
    contentOnly?: boolean;
    /** Filter by content role */
    contentRole?: string;
    /** Skip waiting for DOM to settle (default: false — endpoints wait by default) */
    skipSettle?: boolean;
    /** Max ms to wait for DOM settle (default: 500). Non-fatal on timeout. */
    settleTimeout?: number;
    /** Include media elements in results */
    includeMedia?: boolean;
    /** Only return media elements */
    mediaOnly?: boolean;
    /** Filter media by type (e.g., 'image', 'video', 'svg') */
    mediaType?: string;
    /** Only return media elements that failed to load */
    brokenOnly?: boolean;
    /** Only return images missing alt text */
    missingAltOnly?: boolean;
    /** Regex pattern to match against source URL */
    srcPattern?: string;
    /** Filter oversized images by ratio threshold (default: 2.0) */
    oversizeThreshold?: number;
}
/**
 * Find response
 *
 * Response from finding/discovering controllable elements.
 */
interface FindResponse {
    /** Found elements */
    elements: DiscoveredElement[];
    /** Total elements found */
    total: number;
    /** Find duration */
    durationMs: number;
    /** Timestamp */
    timestamp: number;
}
/**
 * @deprecated Use FindRequest instead
 */
type DiscoveryRequest = FindRequest;
/**
 * @deprecated Use FindResponse instead
 */
type DiscoveryResponse = FindResponse;
/**
 * Viewport and page scroll context included in ControlSnapshot.
 */
interface SnapshotViewportContext {
    /** Viewport (window) width in pixels */
    viewportWidth: number;
    /** Viewport (window) height in pixels */
    viewportHeight: number;
    /** Page horizontal scroll offset */
    scrollX: number;
    /** Page vertical scroll offset */
    scrollY: number;
    /** Full document width */
    documentWidth: number;
    /** Full document height */
    documentHeight: number;
    /** Whether the page can scroll further down */
    canScrollDown: boolean;
    /** Whether the page can scroll further right */
    canScrollRight: boolean;
}
/**
 * Error summary included in control snapshots.
 * Gives AI agents a quick health overview without a separate API call.
 */
interface SnapshotErrorSummary {
    /** Number of errors in the last 30 seconds */
    errorCount: number;
    /** Number of warnings in the last 30 seconds */
    warningCount: number;
    /** Most recent critical error, if any */
    mostRecentError?: {
        message: string;
        timestamp: number;
        /** Extracted source file:line, if available */
        sourceLocation?: string;
    };
    /** Overall health assessment */
    health: 'healthy' | 'degraded' | 'broken';
    /** Framework error overlays currently visible on the page */
    errorOverlays?: DetectedErrorOverlay[];
}
/**
 * Fallback screenshot captured when the UI Bridge relay cannot reach the browser.
 * Provides visual context (via an external screenshot service) even when
 * the in-browser SDK is unresponsive, disconnected, or erroring.
 */
interface FallbackScreenshot {
    /** Base64-encoded PNG screenshot */
    base64: string;
    /** Screenshot width in pixels */
    width: number;
    /** Screenshot height in pixels */
    height: number;
    /** Why the fallback was triggered */
    reason: 'timeout' | 'no_listeners' | 'empty_response';
}
/**
 * Control snapshot - full state of controllable UI
 */
interface ControlSnapshot {
    /** Timestamp */
    timestamp: number;
    /** All registered elements */
    elements: Array<{
        id: string;
        type: string;
        label?: string;
        actions: string[];
        state: ElementState;
        category?: 'interactive' | 'content' | 'media';
        /**
         * High-level element kind — `"interactive"` for clickable/typeable/etc.
         * elements, `"content"` for semantic plain-content elements (cards,
         * badges, pills) tagged with `data-ui-bridge-content`. Mirrors
         * `category`. Callers can pass `?interactiveOnly=true` on the snapshot
         * endpoint to filter `kind: "content"` entries out.
         */
        kind?: 'interactive' | 'content';
        /**
         * Normalized text content for semantic content elements tagged with
         * `data-ui-bridge-content` (whitespace-collapsed, trimmed). Lets tests
         * assert on card/badge/pill text without `/control/page/evaluate`.
         */
        content?: string;
        /**
         * ARIA role / semantic role hint for content elements, sourced from
         * `data-ui-bridge-role` (falls back to the element's `role` attribute).
         */
        role?: string;
        contentMetadata?: ContentMetadata;
        mediaMetadata?: MediaMetadata;
        /**
         * Live viewport-relative bounding box (CSS pixels) tracked by
         * `useUIElement`'s ResizeObserver + scroll/resize listeners. Present for
         * SDK-registered elements whose ref attached (or matched via the
         * `[data-ui-bridge-id]` fallback). Runners use this to dispatch clicks
         * via DOM coordinates and skip VLM pixel grounding.
         */
        bbox?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        /**
         * Live visibility signal (`bbox.width > 0 && bbox.height > 0`). Paired
         * with `bbox`. A cheap "rendered" hint — not a full hit-test like
         * `state.visible`.
         */
        visible?: boolean;
        /**
         * Semantic role / intent hint for disambiguation (e.g. `"primary"`,
         * `"destructive"`). Passthrough from `useUIElement` options — see
         * `RegisteredElement.variant` for common values. Lets NL queries like
         * "the destructive Confirm" rank candidates without VLM grounding.
         */
        variant?: string;
        /**
         * Positional hint for disambiguation (e.g. `"bottom-right"`).
         * Passthrough from `useUIElement` options.
         */
        position?: string;
        /**
         * Dominant color hint as seen by the user (CSS name / hex / design-token
         * alias). Passthrough from `useUIElement` options.
         */
        color?: string;
        /**
         * Hierarchical semantic path for ranking across duplicate labels
         * (e.g. `"settings-modal > theme-section > accent-color"`).
         * Passthrough from `useUIElement` options.
         */
        contextPath?: string;
    }>;
    /** All registered components */
    components: Array<{
        id: string;
        name: string;
        actions: string[];
    }>;
    /** Available workflows */
    workflows: Array<{
        id: string;
        name: string;
        stepCount: number;
    }>;
    /** Active workflow runs */
    activeRuns: Array<{
        runId: string;
        workflowId: string;
        status: WorkflowRunStatus;
        currentStep: number;
        totalSteps: number;
    }>;
    /** Error/warning summary from browser event capture (populated by server handlers) */
    errorSummary?: SnapshotErrorSummary;
    /** Current page/route context (populated by server handlers via NavigationTracker) */
    page?: SnapshotPageContext;
    /** Keyboard shortcuts discovered in the application (populated by server handlers via ShortcutTracker) */
    shortcuts?: SnapshotShortcutContext;
    /** Modal/dialog stack — active modals/dialogs/drawers (populated by server handlers via ModalDetector) */
    modalStack?: SnapshotModalContext;
    /** Toast/notification snapshot — active and recently dismissed toasts (populated by server handlers via ToastCapture) */
    toasts?: SnapshotToastContext;
    /** Viewport dimensions and page scroll position */
    viewport?: SnapshotViewportContext;
    /** Element relationships — declared + auto-detected from ARIA/HTML (populated by server handlers via RelationshipTracker) */
    relationships?: SnapshotRelationshipContext;
    /** Drag sources and drop zones detected in the UI (populated by server handlers via DragDropDetector) */
    dragDrop?: SnapshotDragDropContext;
    /** Undo/redo availability and state (populated by server handlers via UndoTracker) */
    undoRedo?: SnapshotUndoContext;
    /** Fallback screenshot when the browser is unresponsive (populated by relay handlers) */
    fallbackScreenshot?: FallbackScreenshot;
}
/**
 * React state extracted from a DOM element's React fiber internals.
 * Used by the `/control/element/:id/react-state` endpoint.
 */
interface ReactStateInfo {
    /** Props from __reactProps$ (functions replaced with "[Function]") */
    props: Record<string, unknown>;
    /** useState / useReducer values from the fiber memoizedState chain */
    fiberState: unknown[];
    /** Display name of the nearest React component */
    componentName?: string;
    /** Informational note (e.g. when no React internals found) */
    note?: string;
}
/**
 * Describes a single field-level change between pre- and post-action snapshots.
 */
interface ElementFieldChange {
    /** Element ID */
    elementId: string;
    /** Field that changed (e.g. "value", "textContent", "visible") */
    field: string;
    /** Value before the action */
    before: unknown;
    /** Value after the action */
    after: unknown;
}
/**
 * Summary of DOM changes caused by an action, returned when `captureAfter: true`.
 */
interface ActionChanges {
    /** Element IDs that appeared after the action */
    appeared: string[];
    /** Element IDs that disappeared after the action */
    disappeared: string[];
    /** Fields that changed on existing elements */
    stateChanged: ElementFieldChange[];
}
/**
 * Action types for keyboard input
 */
interface KeyboardAction {
    /** Key to press */
    key: string;
    /** Key modifiers */
    modifiers?: {
        ctrl?: boolean;
        shift?: boolean;
        alt?: boolean;
        meta?: boolean;
    };
    /** Hold duration for key press */
    holdDuration?: number;
}
/**
 * SendKeys action — dispatches real KeyboardEvent sequences on an element.
 *
 * Unlike `type` (which sets input/textarea values via the DOM), `sendKeys`
 * fires keydown → keypress → keyup events.  This is required for elements
 * that consume keyboard events directly (e.g. xterm.js terminals, canvas
 * games, custom editors).
 */
interface SendKeysAction {
    /** Sequence of key descriptors to dispatch */
    keys: KeyboardAction[];
    /** Delay between each key (ms, default 0) */
    delay?: number;
}
/**
 * Drag action parameters
 *
 * Drags the source element to a target element or position by dispatching
 * a sequence of mouse events: mousedown → mousemove × N → mouseup.
 * Optionally dispatches HTML5 drag events (dragstart, dragover, drop, dragend)
 * for applications that listen to those instead of mouse events.
 */
interface DragAction {
    /** Target element to drag to (resolved via registry or DOM query) */
    target?: {
        /** UI Bridge element ID (checked in registry first) */
        elementId?: string;
        /** CSS selector */
        selector?: string;
    };
    /** Target coordinates (absolute client position, alternative to target element) */
    targetPosition?: {
        x: number;
        y: number;
    };
    /** Source offset from element center in pixels (default: element center) */
    sourceOffset?: {
        x: number;
        y: number;
    };
    /** Target offset from target element center in pixels (default: element center) */
    targetOffset?: {
        x: number;
        y: number;
    };
    /** Number of intermediate mousemove steps (default: 10) */
    steps?: number;
    /** Delay in ms between mousedown and first move (default: 100) */
    holdDelay?: number;
    /** Delay in ms after mouseup (default: 50) */
    releaseDelay?: number;
    /** Also dispatch HTML5 drag events (dragstart/dragover/drop/dragend) alongside mouse events (default: false) */
    html5?: boolean;
}
/**
 * Action types for mouse input
 */
interface MouseAction {
    /** Mouse button */
    button?: 'left' | 'right' | 'middle';
    /** Click count */
    clickCount?: number;
    /** Coordinates relative to element */
    position?: {
        x: number;
        y: number;
    };
    /** Hold duration for click */
    holdDuration?: number;
}
/**
 * Action types for scroll input
 */
interface ScrollAction {
    /** Scroll direction */
    direction?: 'up' | 'down' | 'left' | 'right';
    /** Scroll amount in pixels */
    amount?: number;
    /**
     * Vertical scroll delta in pixels, using wheel-event semantics:
     * positive = scroll DOWN, negative = scroll UP.
     * Takes precedence over direction+amount when provided.
     */
    deltaY?: number;
    /**
     * Horizontal scroll delta in pixels, using wheel-event semantics:
     * positive = scroll RIGHT, negative = scroll LEFT.
     * Takes precedence over direction+amount when provided.
     */
    deltaX?: number;
    /** Scroll to specific position */
    position?: {
        x: number;
        y: number;
    };
    /** Scroll to element */
    toElement?: string;
    /** Smooth scroll */
    smooth?: boolean;
}
/**
 * Vertical/horizontal alignment for scrollIntoView (standard Web API type).
 */
type ScrollLogicalPosition = 'start' | 'center' | 'end' | 'nearest';
/**
 * Action types for scrollIntoView — scrolls the target element into the visible area
 */
interface ScrollIntoViewAction {
    /** Smooth scroll animation */
    smooth?: boolean;
    /** Vertical alignment: 'start' | 'center' | 'end' | 'nearest' (default: 'center') */
    block?: ScrollLogicalPosition;
    /** Horizontal alignment: 'start' | 'center' | 'end' | 'nearest' (default: 'nearest') */
    inline?: ScrollLogicalPosition;
}
/**
 * Type action for text input
 */
interface TypeAction {
    /** Text to type */
    text: string;
    /** Clear existing value first */
    clear?: boolean;
    /** Delay between keystrokes (ms) */
    delay?: number;
    /** Trigger events (input, change) */
    triggerEvents?: boolean;
}
/**
 * Select action for dropdowns
 */
interface SelectAction {
    /** Value(s) to select */
    value: string | string[];
    /** Select by label instead of value */
    byLabel?: boolean;
    /** For multi-select: add to selection */
    additive?: boolean;
}
/**
 * Autocomplete action for inputs with suggestion dropdowns.
 * Types text, waits for suggestions to appear, then selects a match.
 */
interface AutocompleteAction {
    /** Text to type to trigger suggestions */
    searchText: string;
    /** Value to select from the suggestion list (matched by text content) */
    selectValue: string;
    /** Max time (ms) to wait for suggestions to appear (default: 2000) */
    suggestionTimeout?: number;
    /** Clear existing value first (default: true) */
    clear?: boolean;
}
/**
 * Wait condition result
 */
interface WaitResult {
    /** Whether the condition was met */
    met: boolean;
    /** Time waited in milliseconds */
    waitedMs: number;
    /** Final state when resolved */
    state?: ElementState;
    /** Error if timed out */
    error?: string;
}
/**
 * Page navigation request
 */
interface PageNavigateRequest {
    /** URL to navigate to */
    url: string;
    /**
     * Optional navigation mode (F1).
     *
     * - `"hard"` (default, back-compat): full webview reload via
     *   `window.location.href = url`. Resets all injected state.
     * - `"soft"`: SPA-friendly client-side navigation using
     *   `history.pushState` + synthetic `popstate` / `ui-bridge:navigate`
     *   events. Preserves `window.<custom-globals>` (fetch patches, spies,
     *   test tokens).
     *
     * Any other value is rejected with a 400.
     */
    mode?: 'hard' | 'soft';
    /**
     * Legacy boolean flag (pre-F1). `true` bypasses the registered navigation
     * handler and forces a full reload even when a React Router / Next.js
     * adapter is available. Kept for back-compat; prefer `mode` for new code.
     */
    hard?: boolean;
}
/**
 * Page navigation response
 */
interface PageNavigationResponse {
    /** Whether the navigation succeeded */
    success: boolean;
    /** Current URL after navigation */
    url?: string;
    /**
     * Whether a full reload was used (`true` for `mode: "hard"`, `false` for
     * `"soft"`). Populated on every F1+ response so callers can audit which
     * path the SDK took. Legacy callers that only read this flag continue to
     * work.
     */
    hard?: boolean;
    /**
     * Echoes the mode actually executed: `"hard"` or `"soft"`. Populated on
     * every F1+ response.
     */
    mode?: 'hard' | 'soft';
    /** When true, the SDK used a registered navigate-handler (client-side). */
    clientSideNavigation?: boolean;
    /** Timestamp */
    timestamp: number;
}
/**
 * Fill form request - fill multiple form fields atomically
 */
interface FillFormRequest {
    /** Map of element ID (or selector) to value */
    fields: Record<string, string | boolean | string[]>;
    /** Whether to trigger validation after filling (default: true) */
    triggerValidation?: boolean;
    /** Whether to clear existing values first (default: true) */
    clearFirst?: boolean;
}
/**
 * A single step in a batch action sequence.
 */
interface BatchActionStep {
    /** Target element ID (registry ID, CTR logical name, or CSS selector) */
    elementId: string;
    /** Action to execute */
    action: ControlActionRequest;
    /** Optional label for identifying this step in results */
    label?: string;
}
/**
 * Request to execute multiple actions in a single HTTP round-trip.
 */
interface BatchActionRequest {
    /** Ordered sequence of actions to execute */
    steps: BatchActionStep[];
    /** Stop executing on the first failure (default: true) */
    stopOnFailure?: boolean;
    /** Delay in ms between steps (default: 0) */
    delayBetweenMs?: number;
}
/**
 * Result of a single step within a batch.
 */
interface BatchActionStepResult {
    /** Index of this step in the batch */
    index: number;
    /** Label if provided */
    label?: string;
    /** The target element ID */
    elementId: string;
    /** The action response */
    response: ControlActionResponse;
}
/**
 * Result of a batch action execution.
 */
interface BatchActionResponse {
    /** Whether all steps succeeded */
    success: boolean;
    /** Individual step results */
    results: BatchActionStepResult[];
    /** Number of steps that succeeded */
    succeededCount: number;
    /** Number of steps that failed */
    failedCount: number;
    /** Number of steps that were skipped (due to stopOnFailure) */
    skippedCount: number;
    /** Total duration across all steps */
    durationMs: number;
    /** Timestamp */
    timestamp: number;
}
/**
 * A single operation in a server-side batch request.
 * Maps to the Rust `BatchOperation` struct.
 */
interface ServerBatchOperation {
    /** Unique ID for this operation within the batch (for result correlation) */
    id: string;
    /** The operation type (e.g., "get_elements", "execute_action", "discover") */
    operation: string;
    /** Operation-specific parameters */
    params?: Record<string, unknown>;
}
/**
 * Options for the server-side batch() call.
 */
interface ServerBatchOptions {
    /** If true, stop executing on first error (default: false) */
    stopOnError?: boolean;
}
/**
 * Result of a single operation within a server-side batch response.
 * Maps to the Rust `BatchOperationResult` struct.
 */
interface ServerBatchOperationResult {
    /** Correlation ID matching the request operation */
    id: string;
    /** Whether the operation succeeded */
    success: boolean;
    /** Operation result data */
    data?: unknown;
    /** Error message if failed */
    error?: string;
    /** Structured error detail */
    errorDetail?: {
        code: string;
        message: string;
        recoveryHint?: string;
    };
    /** Duration of this operation in milliseconds */
    durationMs: number;
}
/**
 * Response from a server-side batch execution.
 * Maps to the Rust `BatchResponse` struct.
 */
interface ServerBatchResponse {
    /** True only if all operations succeeded */
    success: boolean;
    /** Per-operation results in request order */
    results: ServerBatchOperationResult[];
    /** Total wall-clock time for the entire batch in milliseconds */
    totalDurationMs: number;
}
/**
 * A single step in a control batch request (simplified form for the
 * standalone `controlBatch()` helper).
 */
interface ControlBatchStep {
    /** Target element ID */
    elementId: string;
    /** Action name (e.g., "click", "type", "select") */
    action: string;
    /** Action-specific parameters */
    params?: Record<string, unknown>;
}
/**
 * Per-step result returned by the `/control/batch` endpoint.
 */
interface ControlBatchStepResult {
    /** Zero-based step index */
    step: number;
    /** Whether the step succeeded */
    success: boolean;
    /** Wall-clock time in ms */
    durationMs: number;
    /** Target element ID */
    elementId: string;
    /** Action executed */
    action: string;
    /** Raw response from the step */
    response: Record<string, unknown>;
}
/**
 * Response from the `/control/batch` endpoint.
 */
interface ControlBatchResponse {
    /** True only if every executed step succeeded */
    success: boolean;
    /** Per-step results in request order */
    results: ControlBatchStepResult[];
    /** Total wall-clock time in ms */
    totalMs: number;
    /** Snapshot diff (element IDs added / removed) */
    snapshotDiff: Record<string, unknown> | null;
    /** Whether execution was stopped early due to an error */
    stoppedEarly: boolean;
}
/**
 * Action executor interface
 */
interface ActionExecutor {
    /** Execute an action on an element */
    executeAction(elementId: string, action: ControlActionRequest): Promise<ControlActionResponse>;
    /** Execute an action on a component */
    executeComponentAction(componentId: string, action: ComponentActionRequest): Promise<ComponentActionResponse>;
    /** Wait for a condition */
    waitFor(elementId: string, options: WaitOptions): Promise<WaitResult>;
    /** Find controllable elements */
    find(options?: FindRequest): Promise<FindResponse>;
    /**
     * @deprecated Use find() instead
     */
    discover(options?: FindRequest): Promise<FindResponse>;
    /** Get control snapshot */
    getSnapshot(): Promise<ControlSnapshot>;
    /** Fill multiple form fields atomically */
    fillForm(request: FillFormRequest): Promise<FillResult>;
    /** Execute multiple actions in a single batch, reducing IPC round-trips */
    executeBatch(request: BatchActionRequest): Promise<BatchActionResponse>;
}
/**
 * Workflow engine interface
 */
interface WorkflowEngine {
    /** Run a workflow */
    run(workflowId: string, request?: WorkflowRunRequest): Promise<WorkflowRunResponse>;
    /** Get workflow run status */
    getRunStatus(runId: string): Promise<WorkflowRunResponse | null>;
    /** Cancel a running workflow */
    cancel(runId: string): Promise<boolean>;
    /** List active runs */
    listActiveRuns(): Promise<WorkflowRunResponse[]>;
}

/**
 * AI Module Types
 *
 * Defines types for AI-native UI Bridge functionality including
 * search criteria, natural language actions, assertions, and semantic snapshots.
 */

/**
 * Criteria for searching elements using multiple strategies
 */
interface SearchCriteria {
    /** Exact visible text match: "Start Extraction" */
    text?: string;
    /** Alias for text (used by spec assertions) */
    textContent?: string;
    /** Partial text match: "Start" */
    textContains?: string;
    /** Accessible name (aria-label, associated labels) */
    accessibleName?: string;
    /** ARIA role: "button", "input" */
    role?: string;
    /** Element type (more specific than role) */
    type?: ElementType;
    /** Spatial proximity: "near the URL input" */
    near?: string;
    /** Container context: "within the login form" */
    within?: string;
    /** Enable fuzzy matching (default: true) */
    fuzzy?: boolean;
    /** Fuzzy match confidence threshold 0-1 (default: 0.7) */
    fuzzyThreshold?: number;
    /** Element ID pattern (supports wildcards) */
    idPattern?: string;
    /** CSS selector */
    selector?: string;
    /** XPath expression */
    xpath?: string;
    /** Placeholder text (for inputs) */
    placeholder?: string;
    /** Title attribute */
    title?: string;
    /** Data attributes to match */
    dataAttributes?: Record<string, string>;
    /** Filter by content role */
    contentRole?: string;
    /** Include content (non-interactive) elements in search */
    includeContent?: boolean;
    /** Only search content elements */
    contentOnly?: boolean;
}
/**
 * Result from a search operation
 */
interface SearchResult {
    /** The matched element */
    element: AIDiscoveredElement;
    /** Match confidence 0-1 */
    confidence: number;
    /** Reasons why this element matched */
    matchReasons: string[];
    /** Match scores by strategy */
    scores: {
        text?: number;
        accessibility?: number;
        role?: number;
        spatial?: number;
        fuzzy?: number;
    };
}
/**
 * Response from search operations
 */
interface SearchResponse {
    /** All matching results sorted by confidence */
    results: SearchResult[];
    /** Best match (highest confidence above threshold) */
    bestMatch: SearchResult | null;
    /** Total elements scanned */
    scannedCount: number;
    /** Search duration in milliseconds */
    durationMs: number;
    /** Search criteria used */
    criteria: SearchCriteria;
    /** Timestamp */
    timestamp: number;
}
/**
 * Element with AI-generated metadata and descriptions
 */
interface AIDiscoveredElement extends DiscoveredElement {
    /** Human-readable description: "Blue submit button in the form" */
    description: string;
    /** Auto-generated aliases for natural language matching */
    aliases: string[];
    /** Inferred purpose: "Submits the form" */
    purpose?: string;
    /** Parent context identifier */
    parentContext?: string;
    /** Suggested actions in natural language */
    suggestedActions: string[];
    /** Semantic type (more descriptive than ElementType) */
    semanticType?: string;
    /** Associated label text */
    labelText?: string;
    /** Placeholder text (for inputs) */
    placeholder?: string;
    /** Title attribute */
    title?: string;
    /** ARIA description */
    ariaDescription?: string;
    /** Whether this is an interactive element, static content, or media */
    category?: 'interactive' | 'content' | 'media';
    /** Metadata for content elements */
    contentMetadata?: ContentMetadata;
}
/**
 * Response from AI find operations
 */
interface AIFindResponse {
    /** All discovered elements with AI metadata */
    elements: AIDiscoveredElement[];
    /** LLM-friendly text summary of the page */
    summary: string;
    /** Detected forms with their fields */
    forms?: FormAnalysis[];
    /** Page context information */
    pageContext: PageContext;
    /** Find duration */
    durationMs: number;
    /** Timestamp */
    timestamp: number;
}
/**
 * Page context information
 */
interface PageContext {
    /** Current URL */
    url: string;
    /** Page title */
    title: string;
    /** Inferred page type */
    pageType?: 'login' | 'dashboard' | 'form' | 'list' | 'detail' | 'search' | 'checkout' | 'settings' | 'unknown';
    /** Active modals/dialogs */
    activeModals: string[];
    /** Currently focused element */
    focusedElement?: string;
    /** Detected navigation elements */
    navigation?: string[];
    /** Pathname (from NavigationTracker) */
    pathname?: string;
    /** Semantic page name (from usePageContext) */
    pageName?: string;
    /** Application section (from usePageContext) */
    section?: string;
    /** Breadcrumb trail (from usePageContext) */
    breadcrumb?: string[];
    /** Route pattern (from useRouteAwareness, e.g., "/tasks/:id") */
    routePattern?: string;
    /** Route parameters (from useRouteAwareness, e.g., { id: "123" }) */
    routeParams?: Record<string, string>;
}
/**
 * Form analysis result
 */
interface FormAnalysis {
    /** Form element ID */
    id: string;
    /** Form name attribute */
    name?: string;
    /** Detected form purpose */
    purpose?: string;
    /** Form fields */
    fields: FormFieldAnalysis[];
    /** Whether form is valid */
    isValid: boolean;
    /** Submit button ID */
    submitButton?: string;
    /** Cancel/reset button ID */
    cancelButton?: string;
}
/**
 * Form field analysis
 */
interface FormFieldAnalysis {
    /** Field element ID */
    id: string;
    /** Field label */
    label: string;
    /** Input type */
    type: string;
    /** Current value */
    value: string;
    /** Whether field is valid */
    valid: boolean;
    /** Validation error message */
    error?: string;
    /** Whether field is required */
    required: boolean;
    /** Placeholder text */
    placeholder?: string;
}
/**
 * Natural language action request
 */
interface NLActionRequest {
    /** Natural language instruction: "click the Start Extraction button" */
    instruction: string;
    /** Optional context to help disambiguate */
    context?: string;
    /** Timeout for the operation */
    timeout?: number;
    /** Confidence threshold for element matching */
    confidenceThreshold?: number;
}
/**
 * Parsed action from natural language
 */
interface ParsedAction {
    /** Action type */
    action: 'click' | 'type' | 'select' | 'check' | 'uncheck' | 'scroll' | 'wait' | 'assert' | 'hover' | 'focus' | 'clear' | 'doubleClick' | 'rightClick';
    /** Description of the target element */
    targetDescription: string;
    /** Value for type/select actions */
    value?: string;
    /** Key modifiers */
    modifiers?: ('shift' | 'ctrl' | 'alt' | 'meta')[];
    /** Scroll direction for scroll actions */
    scrollDirection?: 'up' | 'down' | 'left' | 'right';
    /** Wait condition for wait actions */
    waitCondition?: string;
    /** Assertion type for assert actions */
    assertionType?: AssertionType;
    /** Raw instruction that was parsed */
    rawInstruction: string;
    /** Parse confidence */
    parseConfidence: number;
}
/**
 * Partial match information for structured failures
 */
interface PartialMatchInfo {
    /** Element ID */
    elementId: string;
    /** Match confidence 0-1 */
    confidence: number;
    /** Why this element was considered but not selected */
    reason: string;
    /** Element type */
    type: string;
    /** Element description/label */
    description?: string;
}
/**
 * Recovery suggestion for structured failures
 */
interface RecoverySuggestionInfo {
    /** Human-readable suggestion */
    suggestion: string;
    /** Machine-executable command (if applicable) */
    command?: string;
    /** Confidence that this action will help (0-1) */
    confidence: number;
    /** Whether retry with same parameters might help */
    retryable: boolean;
}
/**
 * Structured failure information for NL action responses
 */
interface StructuredFailureInfo {
    /** Machine-readable error code */
    errorCode: string;
    /** Human-readable error message */
    message: string;
    /** Target element ID (if known) */
    elementId?: string;
    /** Selectors/strategies that were attempted */
    selectorsTried?: string[];
    /** Similar elements that were found but not used */
    partialMatches?: PartialMatchInfo[];
    /** Current state of the target element (if found) */
    elementState?: ElementState;
    /** Reference to visual context (screenshot path/id) */
    screenshotContext?: string;
    /** Suggested recovery actions */
    suggestedActions?: RecoverySuggestionInfo[];
    /** Whether retry with same parameters might help */
    retryRecommended: boolean;
    /** Additional context data */
    context?: Record<string, unknown>;
    /** Duration before failure in milliseconds */
    durationMs?: number;
    /** Timeout value that was exceeded (for timeout errors) */
    timeoutMs?: number;
}
/**
 * Response from executing a natural language action
 */
interface NLActionResponse {
    /** Whether the action succeeded */
    success: boolean;
    /** Human-readable description of what was done */
    executedAction: string;
    /** The element that was used */
    elementUsed: AIDiscoveredElement;
    /** Match confidence for the element */
    confidence: number;
    /** Element state after the action */
    elementState: ElementState;
    /** Action duration */
    durationMs: number;
    /** Timestamp */
    timestamp: number;
    /** Error message if failed */
    error?: string;
    /** Error code */
    errorCode?: string;
    /** Suggestions for recovery */
    suggestions?: string[];
    /** Alternative elements that could have been used */
    alternatives?: SearchResult[];
    /** Detailed failure information when success is false */
    failureInfo?: StructuredFailureInfo;
}
/**
 * Types of assertions that can be made about elements
 */
type AssertionType = 'visible' | 'hidden' | 'enabled' | 'disabled' | 'focused' | 'checked' | 'unchecked' | 'hasText' | 'containsText' | 'hasValue' | 'hasClass' | 'exists' | 'notExists' | 'count' | 'attribute' | 'cssProperty' | 'cssPropertyInSet' | 'cssPropertyRange' | 'tokenCompliance' | 'noOverlap' | 'minSpacing';
/**
 * Assertion request
 */
interface AssertionRequest {
    /** Element target (ID or natural language description) */
    target: string | SearchCriteria;
    /** Type of assertion */
    type: AssertionType;
    /** Expected value (for hasText, hasValue, count, attribute, cssProperty) */
    expected?: unknown;
    /** Attribute name (for attribute assertions) */
    attributeName?: string;
    /** CSS property name (for cssProperty, cssPropertyInSet, cssPropertyRange, tokenCompliance) */
    propertyName?: string;
    /** Allowed values set (for cssPropertyInSet) */
    allowedValues?: string[];
    /** Range bounds (for cssPropertyRange) */
    range?: {
        min?: number;
        max?: number;
    };
    /** Token path (for tokenCompliance, e.g. "colors.primary") */
    tokenPath?: string;
    /** Timeout for waiting (ms) */
    timeout?: number;
    /** Custom failure message */
    message?: string;
    /** Whether to use fuzzy matching for element search */
    fuzzy?: boolean;
    /** Second element target for spatial assertions (noOverlap, minSpacing) */
    relatedTarget?: string | SearchCriteria;
    /** Minimum gap in pixels between elements (for minSpacing) */
    minGap?: number;
}
/**
 * Assertion result
 */
interface AssertionResult {
    /** Whether the assertion passed */
    passed: boolean;
    /** Element target that was checked */
    target: string;
    /** Human-readable description of the target */
    targetDescription: string;
    /** Expected value */
    expected: unknown;
    /** Actual value */
    actual: unknown;
    /** Failure reason if assertion failed */
    failureReason?: string;
    /** Suggestion for fixing the failure */
    suggestion?: string;
    /** Element state at time of assertion */
    elementState?: ElementState;
    /** Search metadata from element lookup (confidence, match reasons, candidate count) */
    searchDetails?: {
        confidence: number;
        matchReasons: string[];
        candidateCount: number;
    };
    /** Duration of the assertion */
    durationMs: number;
    /** Timestamp */
    timestamp: number;
}
/**
 * Batch assertion request
 */
interface BatchAssertionRequest {
    /** Assertions to execute */
    assertions: AssertionRequest[];
    /** Mode: 'all' requires all to pass, 'any' requires at least one */
    mode: 'all' | 'any';
    /** Stop on first failure */
    stopOnFailure?: boolean;
}
/**
 * Batch assertion result
 */
interface BatchAssertionResult {
    /** Overall pass/fail */
    passed: boolean;
    /** Individual assertion results */
    results: AssertionResult[];
    /** Number of passed assertions */
    passedCount: number;
    /** Number of failed assertions */
    failedCount: number;
    /** Total duration */
    durationMs: number;
    /** Timestamp */
    timestamp: number;
}
/**
 * Semantic snapshot of the current page state
 */
interface SemanticSnapshot {
    /** Snapshot timestamp */
    timestamp: number;
    /** Snapshot ID for diffing */
    snapshotId: string;
    /** Page information */
    page: PageContext;
    /** All elements with AI metadata */
    elements: AIDiscoveredElement[];
    /** Form states */
    forms: FormState[];
    /** Active modals */
    activeModals: ModalState[];
    /** Currently focused element */
    focusedElement?: string;
    /** LLM-readable summary */
    summary: string;
    /** Element count by type */
    elementCounts: Record<string, number>;
    /** Detailed form state (included when `includeForms` option is set) */
    formsDetail?: FormsResponse;
    /** Network activity summary (when network monitoring is enabled) */
    networkActivity?: {
        inFlightCount: number;
        inFlightRequests: Array<{
            url: string;
            method: string;
            durationMs: number;
        }>;
        recentFailures: Array<{
            url: string;
            method: string;
            statusCode: number;
            durationMs: number;
            error?: string;
        }>;
        recentFailureCount: number;
    };
}
/**
 * Form state in semantic snapshot
 */
interface FormState {
    /** Form ID */
    id: string;
    /** Form name */
    name?: string;
    /** Form purpose */
    purpose?: string;
    /** Field states */
    fields: FormFieldState[];
    /** Overall validity */
    isValid: boolean;
    /** Submit button */
    submitButton?: string;
    /** Whether form is dirty (has changes) */
    isDirty: boolean;
}
/**
 * Form field state
 */
interface FormFieldState {
    /** Field ID */
    id: string;
    /** Field label */
    label: string;
    /** Input type */
    type: string;
    /** Current value */
    value: string;
    /** Validity */
    valid: boolean;
    /** Error message */
    error?: string;
    /** Required flag */
    required: boolean;
    /** Touched flag */
    touched: boolean;
    /** Placeholder text */
    placeholder?: string;
    /** Whether the field value differs from the default */
    isDirty?: boolean;
    /** Checked state for checkboxes/radios */
    checked?: boolean;
    /** Selected options for select elements */
    selectedOptions?: string[];
    /** HTML5 constraint attributes */
    constraints?: {
        pattern?: string;
        minLength?: number;
        maxLength?: number;
        min?: string;
        max?: string;
        step?: string;
    };
    /** Source of the detected validation error */
    errorSource?: 'html5' | 'aria' | 'adjacent-element' | 'css-class';
}
/**
 * Response from the /control/forms endpoint
 */
interface FormsResponse {
    /** All detected forms on the page */
    forms: FormState[];
    /** LLM-readable summary */
    summary: string;
    /** Timestamp */
    timestamp: number;
}
/**
 * Modal/dialog state
 */
interface ModalState {
    /** Modal ID */
    id: string;
    /** Modal title */
    title?: string;
    /** Modal type */
    type: 'dialog' | 'alert' | 'confirm' | 'prompt' | 'drawer' | 'popup';
    /** Whether modal is blocking */
    blocking: boolean;
    /** Close button ID */
    closeButton?: string;
    /** Primary action button */
    primaryAction?: string;
    /** Secondary action button */
    secondaryAction?: string;
}
/**
 * Semantic diff between two snapshots
 */
interface SemanticDiff {
    /** LLM-readable summary of changes */
    summary: string;
    /** From snapshot ID */
    fromSnapshotId: string;
    /** To snapshot ID */
    toSnapshotId: string;
    /** Detailed changes */
    changes: {
        /** Elements that appeared */
        appeared: ElementChange[];
        /** Elements that disappeared */
        disappeared: ElementChange[];
        /** Elements that were modified */
        modified: ElementModification[];
    };
    /** Content-specific changes (text, metrics, statuses) */
    contentChanges?: ContentChanges;
    /** Probable trigger for the changes */
    probableTrigger?: string;
    /** Suggested next actions based on changes */
    suggestedActions?: string[];
    /** Page context changes */
    pageChanges?: {
        urlChanged: boolean;
        titleChanged: boolean;
        newUrl?: string;
        newTitle?: string;
    };
    /** Duration of diff computation */
    durationMs: number;
    /** Timestamp */
    timestamp: number;
}
/**
 * Content-specific changes detected between snapshots
 */
interface ContentChanges {
    /** General text content changes */
    textChanges: TextChange[];
    /** Metric/numeric value changes with delta analysis */
    metricChanges: MetricChange[];
    /** Status/badge changes with direction analysis */
    statusChanges: StatusChange[];
    /** Human-readable summary of content changes */
    summary: string;
}
/**
 * A text content change between snapshots
 */
interface TextChange {
    /** Element ID */
    elementId: string;
    /** Content type (e.g., 'heading', 'paragraph', 'badge') */
    contentType: string;
    /** Previous text value */
    oldText: string;
    /** New text value */
    newText: string;
    /** Whether content was modified, added, or removed */
    changeType: 'modified' | 'added' | 'removed';
}
/**
 * A metric value change with numeric analysis
 */
interface MetricChange {
    /** Element ID */
    elementId: string;
    /** Associated label or description */
    label: string;
    /** Previous value as string */
    oldValue: string;
    /** New value as string */
    newValue: string;
    /** Numeric delta if both values are parseable */
    numericDelta?: number;
    /** Percent change if both values are parseable */
    percentChange?: number;
    /** Whether the change is significant (>10% or sign flip) */
    significant: boolean;
}
/**
 * A status change with direction analysis
 */
interface StatusChange {
    /** Element ID */
    elementId: string;
    /** Associated label or description */
    label: string;
    /** Previous status text */
    oldStatus: string;
    /** New status text */
    newStatus: string;
    /** Whether the change is positive, negative, or neutral */
    direction: 'improved' | 'degraded' | 'neutral';
}
/**
 * Element change (appeared/disappeared)
 */
interface ElementChange {
    /** Element ID */
    elementId: string;
    /** Element description */
    description: string;
    /** Element type */
    type: string;
    /** Semantic type */
    semanticType?: string;
}
/**
 * Element modification
 */
interface ElementModification {
    /** Element ID */
    elementId: string;
    /** Element description */
    description: string;
    /** Property that changed */
    property: string;
    /** Previous value */
    from: string;
    /** New value */
    to: string;
    /** Whether this is a significant change */
    significant: boolean;
}
/** Semantic category for a set of changes */
type ChangeCategory = 'navigation' | 'feedback' | 'data-update' | 'ui-state' | 'loading' | 'no-op';
/** Result of categorizing a diff */
interface CategorizedDiff {
    /** Primary category */
    category: ChangeCategory;
    /** Confidence in the categorization (0-1) */
    confidence: number;
    /** Secondary categories if the diff spans multiple */
    secondaryCategories: ChangeCategory[];
    /** The underlying diff */
    diff: SemanticDiff;
}
/** Request for action-integrated diffing */
interface ActionWithDiffRequest {
    /** Natural language instruction (mutually exclusive with elementAction) */
    instruction?: string;
    /** Direct element action (mutually exclusive with instruction) */
    elementAction?: {
        elementId: string;
        action: string;
        params?: Record<string, unknown>;
    };
    /** Timeout for idle settling after action (ms, default: 5000) */
    settleTimeout?: number;
    /** Min stable time for idle (ms, default: 300) */
    settleMinStable?: number;
    /** CSS selector to scope the diff to a container */
    scope?: string;
    /** Whether to categorize the diff (default: true) */
    categorize?: boolean;
    /** Whether to record a change timeline during settling (default: false) */
    timeline?: boolean;
    /** Timeline polling interval during settling (ms, default: 100) */
    timelineInterval?: number;
    /** If set, include a budget-aware text summary capped at this many characters */
    summaryBudget?: number;
    /** If true, detect and analyze table/list structural changes */
    analyzeStructured?: boolean;
}
/** Result from action-integrated diffing */
interface ActionDiffResult {
    /** Whether the action succeeded */
    actionSuccess: boolean;
    /** Action result details */
    actionResult: unknown;
    /** Snapshot before action */
    beforeSnapshot: SemanticSnapshot;
    /** Snapshot after action + settling */
    afterSnapshot: SemanticSnapshot;
    /** Computed diff */
    diff: SemanticDiff;
    /** Semantic category (if categorize was true) */
    categorized?: CategorizedDiff;
    /** Change timeline (if timeline was requested) */
    timeline?: ChangeTimeline;
    /** Whether idle settling timed out */
    settleTimedOut: boolean;
    /** Budget-aware text summary (if summaryBudget was set) */
    budgetSummary?: string;
    /** Structured change analysis (if analyzeStructured was true) */
    structuredChanges?: StructuredChangeAnalysis;
    /** Total duration (action + settle + diff) */
    durationMs: number;
    /** Timestamp */
    timestamp: number;
}
/** A timeline of changes during the settle period */
interface ChangeTimeline {
    /** Individual timestamped events */
    events: TimelineEvent[];
    /** Total settle duration (ms) */
    settleMs: number;
    /** Whether the UI reached a stable state */
    settled: boolean;
}
/** A single event in the change timeline */
interface TimelineEvent {
    /** Time offset from action start (ms) */
    offsetMs: number;
    /** Type of event */
    type: 'action' | 'elements-appeared' | 'elements-disappeared' | 'elements-modified' | 'page-changed' | 'settled';
    /** Human-readable summary */
    summary: string;
    /** Element IDs involved (if applicable) */
    elementIds?: string[];
    /** Number of elements affected */
    count?: number;
}
/** Predicate for waitForChange — declarative conditions for detecting specific changes */
interface ChangePredicate {
    /** Wait for a specific element to appear (by ID or description matcher) */
    elementAppeared?: string | {
        text?: string;
        type?: string;
    };
    /** Wait for a specific element to disappear (by ID) */
    elementDisappeared?: string;
    /** Wait for an element's property to change to a value */
    propertyChanged?: {
        elementId: string;
        property: string;
        expectedValue?: string;
    };
    /** Wait for text content matching a pattern anywhere on the page */
    textContains?: {
        elementId?: string;
        text: string;
    };
    /** Wait for a specific change category */
    category?: ChangeCategory;
    /** Wait for any significant change */
    anySignificantChange?: boolean;
    /** Wait until at least N elements match (appeared + existing matching type/text) */
    elementCount?: {
        /** Minimum count required */
        min: number;
        /** Element type to count */
        type?: string;
        /** Text to match (case-insensitive substring) */
        text?: string;
    };
    /** Wait for URL/route to change */
    urlChanged?: boolean;
    /** Wait for URL to contain a specific substring */
    urlContains?: string;
    /** Wait for form to become valid (no error elements visible) */
    formValid?: {
        /** Form element ID or container scope */
        formId?: string;
    };
    /** Wait for a status change with a specific direction */
    statusChanged?: {
        /** Element ID of the status indicator */
        elementId?: string;
        /** Required direction of change */
        direction?: 'improved' | 'degraded';
        /** Specific new status text (case-insensitive) */
        newStatus?: string;
    };
}
/** Options for waitForChange */
interface WaitForChangeOptions {
    /** Maximum time to wait (ms, default: 10000) */
    timeout?: number;
    /** Polling interval (ms, default: 200) */
    interval?: number;
    /** CSS selector to scope the diff */
    scope?: string;
}
/** A buffered DOM mutation change entry */
interface BufferedChange {
    /** Diff */
    diff: SemanticDiff;
    /** Semantic category */
    category: ChangeCategory;
    /** Timestamp when the change was recorded */
    recordedAt: number;
    /** Sequence number */
    sequence: number;
}
/** A buffered SPA route-change entry (P1.3). Distinguished from DOM
 * mutation entries by the `type: "route-change"` discriminator so callers
 * can branch without inspecting the shape. */
interface BufferedRouteChange {
    /** Discriminator — always `"route-change"`. */
    type: 'route-change';
    /** Previous URL (window.location.href before the navigation). */
    from: string;
    /** New URL after the navigation. */
    to: string;
    /** Timestamp when the change was recorded — `at` matches the wire
     * format documented in the runner's HTTP contract. */
    at: number;
    /** Mirror of `at` so the field matches `BufferedChange.recordedAt` for
     * consumers that sort the interleaved drain by `recordedAt`. */
    recordedAt: number;
    /** Sequence number, monotonic across the buffer (DOM + route). */
    sequence: number;
}
/** Discriminated union of every entry kind that can land in the change
 * buffer. DOM mutations keep their existing flat shape (no `type` field);
 * route changes carry `type: "route-change"`. */
type BufferEntry = BufferedChange | BufferedRouteChange;
/** A raw DOM mutation captured by MutationObserver while the buffer is active. */
interface DomMutationEntry {
    /** MutationRecord.type value. */
    type: 'childList' | 'attributes' | 'characterData';
    /** Best-effort CSS selector for the mutated element. */
    target_selector: string;
    /** Number of nodes added (childList only). */
    added?: number;
    /** Number of nodes removed (childList only). */
    removed?: number;
    /** Attribute that changed (attributes only). */
    attribute_name?: string;
    /** Wall-clock timestamp (Date.now()) when the mutation was observed. */
    timestamp: number;
}
/** A console error/warn/unhandledrejection captured while the buffer is active. */
interface ConsoleErrorEntry {
    /** 'error' | 'warn' | 'unhandledrejection' */
    level: 'error' | 'warn' | 'unhandledrejection';
    /** Log message text. */
    message: string;
    /** Stack trace if available. */
    stack?: string;
    /** Wall-clock timestamp. */
    timestamp: number;
}
/** A network request captured while the buffer is active. */
interface BufferedNetworkEntry {
    url: string;
    method: string;
    /** HTTP status code if the request has completed. */
    status?: number;
    /** Round-trip duration in milliseconds if the request has completed. */
    duration_ms?: number;
    /** Timestamp when the request started. */
    timestamp: number;
}
/** A Tauri backend event captured while the buffer is active. Only populated
 * when the SDK is running inside a Tauri webview (detected via
 * `window.__TAURI_INTERNALS__`). In non-Tauri hosts this stays empty. */
interface BufferedTauriEvent {
    /** Tauri event name (matches the name passed to `listen()`). */
    event: string;
    /** Event payload as delivered by `@tauri-apps/api/event`. */
    payload: unknown;
    /** Wall-clock timestamp (Date.now()) when the event was observed. */
    timestamp: number;
}
/** Response from draining the change buffer */
interface ChangeBufferDrainResult {
    /** Registry-level diffs (DOM mutations tracked via the semantic snapshot diff engine)
     * and SPA route-change entries interleaved by `recordedAt`. Backward-compatible. */
    changes: BufferEntry[];
    /** Raw DOM mutations captured by MutationObserver since last drain. */
    dom: DomMutationEntry[];
    /** Console errors/warnings captured since last drain. */
    console_errors: ConsoleErrorEntry[];
    /** Network requests that started since last drain. */
    network_requests: BufferedNetworkEntry[];
    /** Tauri backend events captured since last drain. Empty when the host is
     * not a Tauri webview or no event names were registered via
     * `setTauriEventNames()`. */
    tauri_events: BufferedTauriEvent[];
    /** Total registry-level changes drained (backward compat) */
    count: number;
    /** Timestamp when the buffer was most recently enabled. */
    enabled_at: number;
    /** Time span covered by the registry changes */
    fromTimestamp: number;
    toTimestamp: number;
}
/** Named snapshot bookmark */
interface SnapshotBookmark {
    /** Bookmark name */
    name: string;
    /** The snapshot */
    snapshot: SemanticSnapshot;
    /** When the bookmark was saved */
    savedAt: number;
}
/** Options for budget-aware diff summary generation */
interface DiffSummaryOptions {
    /** Maximum character count for the summary */
    budget: number;
    /** Include element IDs in the summary (default: false) */
    includeIds?: boolean;
    /** Include the category in the summary header (default: true) */
    includeCategory?: boolean;
}
/** Result of structured change analysis (table/list-level diffing) */
interface StructuredChangeAnalysis {
    /** Table-level changes detected */
    tableChanges: TableChangeAnalysis[];
    /** List-level changes detected */
    listChanges: ListChangeAnalysis[];
    /** Whether any structured data was detected */
    hasStructuredData: boolean;
}
/** Analysis of changes to a detected table */
interface TableChangeAnalysis {
    /** Table label/identifier */
    label: string;
    /** Column headers */
    columns: string[];
    /** Rows that were added */
    addedRows: string[][];
    /** Rows that were removed */
    removedRows: string[][];
    /** Rows with cell value changes */
    modifiedRows: {
        rowIndex: number;
        changes: {
            column: string;
            from: string;
            to: string;
        }[];
    }[];
    /** Summary of table changes */
    summary: string;
}
/** Analysis of changes to a detected list */
interface ListChangeAnalysis {
    /** List label/identifier */
    label: string;
    /** Items that were added */
    addedItems: Record<string, string>[];
    /** Items that were removed */
    removedItems: Record<string, string>[];
    /** Summary of list changes */
    summary: string;
}
/**
 * Compact element representation — flat, minimal, ~11 fields vs AIDiscoveredElement's 20+.
 * Bounds as [x,y,w,h] tuple saves ~60% vs full rect object.
 * Text truncated to 200 chars.
 */
interface CompactElement {
    id: string;
    type: string;
    label?: string;
    visible: boolean;
    enabled: boolean;
    text?: string;
    value?: string;
    actions: string[];
    semanticType?: string;
    /** Bounds as [x, y, width, height] tuple */
    bounds?: [number, number, number, number];
}
/**
 * Elements pre-grouped by category so agents can skip irrelevant sections.
 */
interface GroupedElements {
    interactive: CompactElement[];
    content: CompactElement[];
    media: CompactElement[];
}
/**
 * Compact modal representation
 */
interface CompactModal {
    id: string;
    title?: string;
    type: string;
    blocking: boolean;
    closeButton?: string;
    primaryAction?: string;
}
/**
 * Compact toast representation
 */
interface CompactToast {
    id: string;
    message: string;
    level?: string;
    dismissible: boolean;
}
/**
 * Aggregated error information
 */
interface AggregatedErrors {
    count: number;
    health: 'healthy' | 'degraded' | 'broken';
    validationErrors: string[];
    runtimeError?: string;
    hasErrorOverlay: boolean;
}
/**
 * Loading/in-flight state
 */
interface LoadingState {
    isLoading: boolean;
    inFlightRequests: number;
    activeWorkflows: number;
}
/**
 * Comprehensive screen analysis — single response combining all actionable
 * information about the current screen.
 */
interface ScreenAnalysis {
    /** Page info (url, title, type) */
    page: {
        url: string;
        title: string;
        type?: string;
    };
    /** Viewport dimensions and scroll state */
    viewport?: {
        width: number;
        height: number;
        scrollX: number;
        scrollY: number;
        canScrollDown: boolean;
    };
    /** LLM-readable summary */
    summary: string;
    /** Elements grouped by category */
    elements: GroupedElements;
    /** Form states */
    forms: FormState[];
    /** Active modals */
    modals: CompactModal[];
    /** Aggregated errors */
    errors: AggregatedErrors;
    /** Active toasts */
    toasts: CompactToast[];
    /** Loading state */
    loading: LoadingState;
    /** Currently focused element ID */
    focusedElement?: string;
    /** Element counts by type */
    elementCounts: Record<string, number>;
    /** Snapshot timestamp */
    timestamp: number;
}
/**
 * Semantic search criteria using embeddings
 */
interface SemanticSearchCriteria {
    /** Natural language query for semantic matching */
    query: string;
    /** Minimum similarity score (0-1, default: 0.5) */
    threshold?: number;
    /** Maximum results to return */
    limit?: number;
    /** Filter by element type */
    type?: string;
    /** Filter by ARIA role */
    role?: string;
    /** Combine with text-based search */
    combineWithText?: boolean;
}
/**
 * Semantic search result
 */
interface SemanticSearchResult {
    /** The matched element */
    element: AIDiscoveredElement;
    /** Semantic similarity score (0-1) */
    similarity: number;
    /** Rank in results (1-indexed) */
    rank: number;
    /** Text that was used for embedding */
    embeddedText: string;
}
/**
 * Response from semantic search operations
 */
interface SemanticSearchResponse {
    /** All matching results sorted by similarity */
    results: SemanticSearchResult[];
    /** Best match (highest similarity above threshold) */
    bestMatch: SemanticSearchResult | null;
    /** Total elements scanned */
    scannedCount: number;
    /** Search duration in milliseconds */
    durationMs: number;
    /** Query used */
    query: string;
    /** Embedding provider info */
    providerInfo?: {
        provider: string;
        model: string;
        dimension: number;
    };
    /** Timestamp */
    timestamp: number;
}
/**
 * Rich error context for AI agents
 */
interface AIErrorContext {
    /** Error code */
    code: string;
    /** Human-readable error message */
    message: string;
    /** What action was attempted */
    attemptedAction: string;
    /** Search criteria used (if applicable) */
    searchCriteria?: SearchCriteria;
    /** Information about what was found */
    searchResults: {
        /** Number of candidates found */
        candidatesFound: number;
        /** Nearest match if any */
        nearestMatch?: {
            element: AIDiscoveredElement;
            confidence: number;
            whyNotSelected: string;
        };
    };
    /** Page state at time of error */
    pageContext: {
        url: string;
        title: string;
        visibleElements: number;
        /** Possible blockers like modals */
        possibleBlockers: string[];
    };
    /** Recovery suggestions */
    suggestions: RecoverySuggestion[];
    /** Stack trace if available */
    stack?: string;
    /** Timestamp */
    timestamp: number;
}
/**
 * Recovery suggestion for errors
 */
interface RecoverySuggestion {
    /** Human-readable action description */
    action: string;
    /** Command to execute (if applicable) */
    command?: string;
    /** Confidence that this will help */
    confidence: number;
    /** Priority (lower = try first) */
    priority: number;
}
/**
 * Extended element registration options with AI metadata
 */
interface AIElementRegistrationOptions {
    /** Alternative names for the element */
    aliases?: string[];
    /** Human-readable description */
    description?: string;
    /** Semantic type (more descriptive than ElementType) */
    semanticType?: string;
    /** Purpose of the element */
    purpose?: string;
    /** Whether to auto-generate aliases */
    autoGenerateAliases?: boolean;
}
/**
 * Parameter definition for an intent
 */
interface IntentParam {
    /** Parameter type (e.g., 'string', 'number', 'boolean') */
    type: string;
    /** Whether the parameter is required */
    required?: boolean;
    /** Description of the parameter */
    description?: string;
    /** Default value */
    default?: unknown;
}
/**
 * An intent represents a high-level user goal that can be executed
 */
interface Intent {
    /** Unique intent identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description of what the intent does */
    description: string;
    /** Tags for categorization and search */
    tags?: string[];
    /** Parameters the intent accepts */
    params?: Record<string, IntentParam>;
    /** Handler identifier */
    handler?: string;
}
/**
 * Response from intent search/find operations
 */
interface IntentSearchResponse {
    /** Matched intents with confidence scores */
    intents: Array<{
        intent: Intent;
        confidence: number;
    }>;
}
/**
 * Result from executing an intent
 */
interface IntentExecutionResult {
    /** Whether the intent executed successfully */
    success: boolean;
    /** ID of the intent that was executed */
    intentId: string;
    /** Result data from the intent execution */
    result?: unknown;
    /** Error message if failed */
    error?: string;
    /** Duration of intent execution in milliseconds */
    durationMs: number;
}
/**
 * Request to attempt recovery from a failure
 */
interface RecoveryAttemptRequest {
    /** The failure to recover from */
    failure: StructuredFailureInfo;
    /** Natural language instruction for recovery */
    instruction: string;
    /** Optional element ID related to the failure */
    elementId?: string;
    /** Maximum number of retries */
    maxRetries: number;
}
/**
 * Result from a recovery attempt
 */
interface RecoveryAttemptResult {
    /** Whether recovery was successful */
    recovered: boolean;
    /** Names of strategies that were attempted */
    strategiesAttempted: string[];
    /** Final action result if recovery succeeded */
    finalResult?: NLActionResponse;
    /** Error message if recovery failed */
    error?: string;
    /** Duration of recovery attempts in milliseconds */
    durationMs: number;
}
/** Classified data type for extracted values */
type DataType = 'text' | 'number' | 'currency' | 'date' | 'email' | 'url' | 'phone' | 'percentage' | 'boolean' | 'enum' | 'unknown';
/** A single extracted data value from a page element */
interface ExtractedDataValue {
    /** Source element ID */
    elementId: string;
    /** Accessible name or label */
    label: string;
    /** Raw text value */
    rawValue: string;
    /** Normalized value for comparison */
    normalizedValue: string;
    /** Classified data type */
    dataType: DataType;
    /** Confidence in the classification (0-1) */
    confidence: number;
}
/** Map of labeled data values extracted from a page */
interface PageDataMap {
    /** All extracted values keyed by label */
    values: Record<string, ExtractedDataValue>;
    /** Total elements scanned */
    scannedCount: number;
    /** Elements with extractable data */
    extractedCount: number;
}
/** Semantic region type */
type RegionType = 'header' | 'navigation' | 'sidebar' | 'main-content' | 'footer' | 'form' | 'table' | 'card' | 'modal' | 'toolbar' | 'unknown';
/** A segmented region of a page */
interface PageRegion {
    /** Region type */
    type: RegionType;
    /** Bounding box */
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Element IDs contained in this region */
    elementIds: string[];
    /** Computed label for the region */
    label: string;
    /** Confidence in the classification (0-1) */
    confidence: number;
}
/** All regions on a page */
interface PageRegionMap {
    /** Detected regions */
    regions: PageRegion[];
    /** Total elements assigned to regions */
    assignedCount: number;
    /** Elements not assigned to any region */
    unassignedIds: string[];
}
/** Column definition for an extracted table */
interface TableColumn {
    /** Column header text */
    header: string;
    /** Index in the table */
    index: number;
    /** Detected data type for the column */
    dataType: DataType;
}
/** Schema of an extracted table */
interface TableSchema {
    /** Table label or caption */
    label: string;
    /** Columns */
    columns: TableColumn[];
    /** Row data (array of row arrays) */
    rows: string[][];
    /** Source element ID */
    sourceElementId?: string;
}
/** Field definition for a list item */
interface ListItemField {
    /** Field label */
    label: string;
    /** Detected data type */
    dataType: DataType;
}
/** Schema of an extracted list */
interface ListSchema {
    /** List label */
    label: string;
    /** Item fields */
    fields: ListItemField[];
    /** Items (array of field-value maps) */
    items: Record<string, string>[];
    /** Source element ID */
    sourceElementId?: string;
}
/** All structured data extracted from a page */
interface StructuredDataExtraction {
    /** Extracted tables */
    tables: TableSchema[];
    /** Extracted lists */
    lists: ListSchema[];
}
/** Describes the format of a data value */
interface FormatDescriptor {
    /** Element ID */
    elementId: string;
    /** Label */
    label: string;
    /** Data type */
    dataType: DataType;
    /** Detected format pattern (e.g., "MM/DD/YYYY", "$#,###.##") */
    pattern: string;
    /** Example value */
    example: string;
}
/** A format mismatch between source and target */
interface FormatMismatch {
    /** Label of the data field */
    label: string;
    /** Source format */
    sourceFormat: FormatDescriptor;
    /** Target format */
    targetFormat: FormatDescriptor;
    /** Severity: 'info' | 'warning' | 'error' */
    severity: 'info' | 'warning' | 'error';
    /** Human-readable description of the mismatch */
    description: string;
}
/** A pair of matched elements across apps */
interface MatchedElementPair {
    /** Source element ID */
    sourceId: string;
    /** Target element ID */
    targetId: string;
    /** Source element label */
    sourceLabel: string;
    /** Target element label */
    targetLabel: string;
    /** Match confidence (0-1) */
    confidence: number;
    /** Strategy that matched them */
    matchStrategy: string;
}
/** Comparison of a data value between source and target */
interface DataValueComparison {
    /** Field label */
    label: string;
    /** Source value */
    sourceValue: string;
    /** Target value */
    targetValue: string;
    /** Whether values match after normalization */
    valuesMatch: boolean;
    /** Whether formats match */
    formatsMatch: boolean;
}
/** Full cross-app diff result */
interface CrossAppDiff {
    /** Matched element pairs */
    matchedPairs: MatchedElementPair[];
    /** Source elements with no match */
    unmatchedSourceIds: string[];
    /** Target elements with no match */
    unmatchedTargetIds: string[];
    /** Data value comparisons for matched pairs */
    dataComparisons: DataValueComparison[];
    /** Format mismatches */
    formatMismatches: FormatMismatch[];
}
/** Comparison of interactive capabilities between matched elements */
interface InteractionParity {
    /** Matched element pair */
    pair: MatchedElementPair;
    /** Actions available in source */
    sourceActions: string[];
    /** Actions available in target */
    targetActions: string[];
    /** Actions present in source but missing in target */
    missingInTarget: string[];
    /** Actions present in target but missing in source */
    missingInSource: string[];
}
/** A pair of navigation elements across apps */
interface NavigationPair {
    /** Source navigation element */
    sourceId: string;
    /** Target navigation element */
    targetId: string;
    /** Link text or label */
    label: string;
    /** Source href/destination */
    sourceHref?: string;
    /** Target href/destination */
    targetHref?: string;
    /** Whether the destination is equivalent */
    destinationMatch: boolean;
}
/** Full navigation map comparison */
interface NavigationMap {
    /** Matched navigation pairs */
    pairs: NavigationPair[];
    /** Navigation items only in source */
    sourceOnly: string[];
    /** Navigation items only in target */
    targetOnly: string[];
}
/** Information about a component (from /control/components) */
interface ComponentInfo {
    /** Component ID */
    id: string;
    /** Component name */
    name: string;
    /** Component type */
    type: string;
    /** State keys */
    stateKeys: string[];
    /** Action names */
    actions: string[];
}
/** A matched pair of components */
interface ComponentMatch {
    /** Source component */
    source: ComponentInfo;
    /** Target component */
    target: ComponentInfo;
    /** Match confidence (0-1) */
    confidence: number;
    /** State key differences */
    stateKeyDiff: {
        missing: string[];
        extra: string[];
    };
    /** Action differences */
    actionDiff: {
        missing: string[];
        extra: string[];
    };
}
/** Full component comparison result */
interface ComponentComparison {
    /** Matched component pairs */
    matches: ComponentMatch[];
    /** Source-only components */
    sourceOnly: ComponentInfo[];
    /** Target-only components */
    targetOnly: ComponentInfo[];
}
/** Detected grid structure from element positions */
interface GridStructure {
    /** Detected column positions (x-coordinates) */
    columns: number[];
    /** Detected row positions (y-coordinates) */
    rows: number[];
    /** Column count */
    columnCount: number;
    /** Row count */
    rowCount: number;
}
/** Differences in grid structure */
interface GridDiff {
    /** Source grid */
    sourceGrid: GridStructure;
    /** Target grid */
    targetGrid: GridStructure;
    /** Column count difference */
    columnDiff: number;
    /** Row count difference */
    rowDiff: number;
}
/** Differences in element hierarchy depth */
interface HierarchyDiff {
    /** Source max nesting depth */
    sourceDepth: number;
    /** Target max nesting depth */
    targetDepth: number;
    /** Difference */
    depthDiff: number;
}
/** Information density comparison */
interface DensityComparison {
    /** Source elements per region */
    sourceDensity: number;
    /** Target elements per region */
    targetDensity: number;
    /** Ratio (source/target) */
    ratio: number;
}
/** Full layout comparison result */
interface LayoutComparison {
    /** Grid structure differences */
    gridDiff: GridDiff;
    /** Hierarchy differences */
    hierarchyDiff: HierarchyDiff;
    /** Density comparison */
    density: DensityComparison;
    /** Overall layout similarity (0-1) */
    similarity: number;
}
/** A matched heading pair */
interface HeadingMatch {
    /** Source heading text */
    source: string;
    /** Target heading text */
    target: string;
    /** Heading level (1-6) */
    level?: number;
}
/** A changed heading pair */
interface HeadingChange {
    /** Source heading text */
    source: string;
    /** Target heading text */
    target: string;
    /** Heading level (1-6) */
    level?: number;
}
/** A matched metric pair */
interface MetricMatch {
    /** Metric label */
    label: string;
    /** Source value */
    sourceValue: string;
    /** Target value */
    targetValue: string;
}
/** A changed metric pair (cross-app comparison) */
interface CrossAppMetricChange {
    /** Metric label */
    label: string;
    /** Source value */
    sourceValue: string;
    /** Target value */
    targetValue: string;
}
/** A matched status pair */
interface StatusMatch {
    /** Status label */
    label: string;
    /** Source status text */
    sourceStatus: string;
    /** Target status text */
    targetStatus: string;
}
/** A changed status pair (cross-app comparison) */
interface CrossAppStatusChange {
    /** Status label */
    label: string;
    /** Source status text */
    sourceStatus: string;
    /** Target status text */
    targetStatus: string;
}
/** Heading comparison for a specific level */
interface HeadingLevelComparison {
    /** Heading level (1-6) */
    level: number;
    /** Source heading count */
    sourceCount: number;
    /** Target heading count */
    targetCount: number;
}
/** Table structure comparison */
interface TableComparison {
    /** Table label (source) */
    sourceLabel: string;
    /** Table label (target) */
    targetLabel: string;
    /** Whether column headers match */
    columnsMatch: boolean;
    /** Column headers only in source */
    sourceOnlyColumns: string[];
    /** Column headers only in target */
    targetOnlyColumns: string[];
    /** Number of rows in source */
    sourceRowCount: number;
    /** Number of rows in target */
    targetRowCount: number;
    /** Cell value differences (row, column, source value, target value) */
    cellDifferences: Array<{
        row: number;
        column: string;
        sourceValue: string;
        targetValue: string;
    }>;
}
/** Full content comparison result */
interface ContentComparison {
    /** Heading comparison */
    headings: {
        matched: HeadingMatch[];
        sourceOnly: string[];
        targetOnly: string[];
        changed: HeadingChange[];
    };
    /** Metric comparison */
    metrics: {
        matched: MetricMatch[];
        changed: CrossAppMetricChange[];
        sourceOnly: string[];
        targetOnly: string[];
    };
    /** Status comparison */
    statuses: {
        matched: StatusMatch[];
        changed: CrossAppStatusChange[];
    };
    /** Labels / text comparison */
    labels: {
        matched: string[];
        sourceOnly: string[];
        targetOnly: string[];
    };
    /** Table structure comparison */
    tables: TableComparison[];
    /** Heading hierarchy comparison */
    headingHierarchy: HeadingLevelComparison[];
    /** Content parity score (0-1) */
    contentParity: number;
}
/** A single issue found during comparison */
interface ComparisonIssue {
    /** Issue severity */
    severity: 'info' | 'warning' | 'error';
    /** Issue category */
    category: 'missing-data' | 'format-mismatch' | 'value-mismatch' | 'missing-action' | 'navigation-gap' | 'layout-difference' | 'component-mismatch' | 'content-difference';
    /** Human-readable description */
    description: string;
    /** Source element ID (if applicable) */
    sourceElementId?: string;
    /** Target element ID (if applicable) */
    targetElementId?: string;
}
/** Full cross-app comparison report */
interface CrossAppComparisonReport {
    /** Source page URL */
    sourceUrl: string;
    /** Target page URL */
    targetUrl: string;
    /** Timestamp */
    timestamp: number;
    /** Duration of comparison in ms */
    durationMs: number;
    /** Scores (0-1) */
    scores: {
        dataCompleteness: number;
        formatAlignment: number;
        presentationAlignment: number;
        navigationParity: number;
        actionParity: number;
        overallScore: number;
    };
    /** Cross-app diff */
    diff: CrossAppDiff;
    /** Navigation map */
    navigation: NavigationMap;
    /** Layout comparison */
    layout: LayoutComparison;
    /** Component comparison (included when components are provided) */
    components?: ComponentComparison;
    /** Content comparison (headings, metrics, statuses, labels, tables) */
    contentComparison?: ContentComparison;
    /** All issues sorted by severity */
    issues: ComparisonIssue[];
    /** LLM-readable summary */
    summary: string;
}

/**
 * Element and Component Registry
 *
 * Central registry for all UI elements and components registered with UI Bridge.
 * Provides methods for registration, lookup, and lifecycle management.
 */

/**
 * Single source of truth for serializing a `RegisteredElement` to a snapshot
 * entry. Used by `createSnapshot`/`createSnapshotAsync` here AND by the
 * runner's `serializeElement` helper so the two paths cannot drift. When you
 * add a field to `RegisteredElement` that should appear in serialized form,
 * add it here only.
 *
 * Returns the snapshot-shape (no `registeredAt`/`mounted`/`element`). Wrappers
 * that need additional fields can spread and extend.
 *
 * @param options.componentBasePath  Prefix for `componentActionBasePath`. Defaults
 *   to `/control/component` (correct for the standalone ui-bridge server).
 *   The runner mounts routes under `/ui-bridge/...` so it should pass
 *   `/ui-bridge/control/component`.
 */
declare function serializeRegisteredElement(el: RegisteredElement, options?: {
    componentBasePath?: string;
}): BridgeSnapshot['elements'][number];
/**
 * Registry options
 */
/**
 * Duration (ms) to keep recently-unmounted element refs for fingerprint-based
 * ID preservation across React re-renders. Tunable per-registry via
 * `RegistryOptions.remountCacheWindowMs`.
 */
declare const DEFAULT_REMOUNT_CACHE_WINDOW_MS = 2000;
interface RegistryOptions {
    /** Enable verbose logging */
    verbose?: boolean;
    /** Callback when an event occurs */
    onEvent?: BridgeEventListener;
    /** Element event log for per-element observability */
    elementEventLog?: ElementEventLog;
    /** Preserve element IDs across React remounts by fingerprint matching (default: false) */
    preserveIdAcrossRemount?: boolean;
    /** How long (ms) to keep recently-unmounted refs for remount matching (default: 2000) */
    remountCacheWindowMs?: number;
}
/**
 * UI Bridge Registry
 *
 * Central registry for managing elements, components, and workflows.
 */
interface RegistrySnapshot {
    elements: RegisteredElement[];
    components: RegisteredComponent[];
    workflows: Workflow[];
    version: number;
}
declare class UIBridgeRegistry {
    /**
     * Stable per-instance tag assigned at construction time. Used by
     * UI_BRIDGE_DEBUG_FIND diagnostics to detect duplicate registry instances
     * across the React-context path (`bridge.registry`) and the module-level
     * singleton path (`getGlobalRegistry()`). The runner has historically
     * shown a 193-vs-118 element divergence between the two paths; the tag
     * lets a single diagnostic run answer "is this the same registry or two
     * different ones?" empirically without re-deploying instrumentation.
     *
     * Six chars of base-36 entropy — collision-safe within a single page
     * lifetime (~2 billion possible values, dozens of registries at most).
     * Public so external diagnostic tools can read it via reflection without
     * needing a getter call.
     */
    readonly __instanceTag: string;
    private elements;
    private components;
    private workflows;
    private eventListeners;
    private options;
    private states;
    private stateGroups;
    private transitions;
    private activeStates;
    private recentlyRemoved;
    private everHadRegistrationsFlag;
    private routeCounts;
    private storeVersion;
    private storeListeners;
    private cachedSnapshot;
    private notifyScheduled;
    private enrichers;
    private snapshotExtras;
    constructor(options?: RegistryOptions);
    /**
     * Public accessor for the instance tag — equivalent to reading
     * `__instanceTag` directly, but kept as a method so external diagnostic
     * code (which sees the type from `dist/`) can call it without TypeScript
     * complaining about touching internal fields.
     */
    getInstanceTag(): string;
    /**
     * Register/replace canonical enrichers (navigation/modal/toast/relationships/
     * drag-drop/undo/shortcuts). HMR-safe — calling with a partial set merges into
     * existing slots instead of clobbering them, so a remount that re-runs init
     * for one tracker doesn't drop the others.
     */
    setEnrichers(e: Partial<SnapshotEnrichers>): void;
    /**
     * Register a custom snapshot enricher. The returned object will be
     * `Object.assign`ed onto the snapshot, so use unique top-level keys to avoid
     * clobbering canonical fields. Returns a disposer.
     */
    registerSnapshotEnricher(name: string, fn: SnapshotEnricher): () => void;
    /** Remove a custom snapshot enricher by name */
    unregisterSnapshotEnricher(name: string): void;
    /**
     * Subscribe to registry changes (for useSyncExternalStore).
     * Returns an unsubscribe function.
     */
    subscribe(callback: () => void): () => void;
    /**
     * Get a stable snapshot reference that changes only when the registry mutates.
     * Designed for useSyncExternalStore.
     */
    getSnapshot(): RegistrySnapshot;
    private notifyStoreListeners;
    /**
     * Emit an event
     */
    private emit;
    /**
     * Register an event listener
     */
    on<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): () => void;
    /**
     * Dispatch an event from external sources (e.g., NavigationTracker).
     * Prefer using registry methods (registerElement, etc.) for internal events.
     */
    dispatchEvent<T>(type: BridgeEventType, data: T): void;
    /**
     * Remove an event listener
     */
    off<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): void;
    /**
     * Register an element
     */
    /**
     * Update a registered element's metadata/options in place.
     * See `updateComponent` for rationale. Does not replace the DOM element
     * reference — use `registerElement` if the element itself changed.
     */
    updateElement(id: string, options: {
        type?: ElementType;
        label?: string;
        actions?: StandardAction[];
        customActions?: Record<string, CustomAction>;
        category?: 'interactive' | 'content' | 'media';
        contentMetadata?: ContentMetadata;
        mediaMetadata?: MediaMetadata;
        /** Disambiguation hint — semantic role/intent. See RegisteredElement.variant. */
        variant?: string;
        /** Disambiguation hint — positional. See RegisteredElement.position. */
        position?: string;
        /** Disambiguation hint — dominant color. See RegisteredElement.color. */
        color?: string;
        /** Disambiguation hint — hierarchical semantic path. See RegisteredElement.contextPath. */
        contextPath?: string;
    }): boolean;
    /**
     * Update the live viewport-relative bounding box and visibility for a
     * registered element. Called by `useUIElement`'s ResizeObserver + scroll
     * listeners and MUST NOT emit events or bump `storeVersion` — bbox updates
     * fire on every scroll/resize and would cause `useSyncExternalStore`
     * consumers to re-render continuously (React error #185).
     *
     * Returns `false` if the element is not registered.
     */
    updateElementBbox(id: string, bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | undefined, visible: boolean | undefined): boolean;
    /**
     * Action-driven state refresh.
     *
     * Action handlers (`type`, `clear`, `setValue`, `check`, `uncheck`, `toggle`,
     * `select`, `sendKeys`, `focus`, `blur`) call this after mutating the DOM so
     * subsequent `getElement(id)` / snapshot reads see the post-action state
     * even when React detaches/re-creates the underlying DOM node between the
     * action and the next read.
     *
     * The fields in `updates` overlay the live `getElementState(element)` read
     * (cached values win for `value`, `checked`, `focused`, etc.). Other fields
     * (rect, computedStyles, scrollInfo) keep flowing from the live DOM read so
     * layout stays accurate. Pass `undefined` for `updates` to clear the
     * overlay.
     *
     * Returns `false` if `id` is not registered.
     */
    refreshElement(id: string, updates: Partial<ElementState> | undefined): boolean;
    registerElement(id: string, element: HTMLElement, options?: {
        type?: ElementType;
        label?: string;
        actions?: StandardAction[];
        customActions?: Record<string, CustomAction>;
        category?: 'interactive' | 'content' | 'media';
        contentMetadata?: ContentMetadata;
        mediaMetadata?: MediaMetadata;
        /** Component that owns this element (set by <UIBridgeComponentScope>). */
        ownedByComponent?: string;
        /**
         * How this registration happened — `'hook'` (explicit useUIElement /
         * useUIComponent) or `'auto'` (DOM walker in useAutoRegister). Defaults
         * to `'hook'` so any programmatic caller that doesn't know about this
         * field is treated as a developer-instrumented registration. The
         * auto-register path overrides to `'auto'`.
         */
        origin?: 'hook' | 'auto';
        /** Disambiguation hint — semantic role/intent. See RegisteredElement.variant. */
        variant?: string;
        /** Disambiguation hint — positional. See RegisteredElement.position. */
        position?: string;
        /** Disambiguation hint — dominant color. See RegisteredElement.color. */
        color?: string;
        /** Disambiguation hint — hierarchical semantic path. See RegisteredElement.contextPath. */
        contextPath?: string;
        /**
         * Page route the element is registered under. Defaults to
         * `window.location.pathname` when available; used to populate
         * `BridgeSnapshot.registration.byRoute`. Pass `null` to explicitly
         * opt out of route tracking; pass a string (e.g. a framework router's
         * matched pattern) to override the `pathname` default.
         */
        route?: string | null;
        /**
         * Normalized text content for `data-ui-bridge-content` semantic
         * elements (cards/badges/pills). Surfaced on the snapshot element
         * as `content`.
         */
        content?: string;
        /**
         * ARIA/semantic role hint for content elements (e.g. `"article"`,
         * `"listitem"`, `"status"`). Surfaced on the snapshot element as
         * `role`. Sourced from `data-ui-bridge-role` with a fallback to
         * the DOM `role` attribute.
         */
        role?: string;
    }): RegisteredElement;
    private incrementRouteCount;
    private decrementRouteCount;
    /**
     * Register a content (non-interactive) element
     */
    registerContentElement(id: string, element: HTMLElement, options: {
        contentType: string;
        contentMetadata: ContentMetadata;
        label?: string;
        /** Defaults to `'auto'` — content elements only flow from the DOM scanner. */
        origin?: 'hook' | 'auto';
    }): RegisteredElement;
    /**
     * Get all content (non-interactive) elements
     */
    getAllContentElements(): RegisteredElement[];
    /**
     * Register a media element (image, video, canvas, SVG, etc.)
     *
     * If a `refreshMetadata` callback is provided, mediaMetadata is re-captured
     * on every `getState()` call so loading transitions and video state stay fresh.
     */
    registerMediaElement(id: string, element: HTMLElement, options: {
        mediaType: string;
        mediaMetadata: MediaMetadata;
        label?: string;
        refreshMetadata?: (el: HTMLElement) => MediaMetadata;
        /** Defaults to `'auto'` — media elements only flow from the DOM scanner. */
        origin?: 'hook' | 'auto';
    }): RegisteredElement;
    /**
     * Get all interactive elements
     */
    getAllInteractiveElements(): RegisteredElement[];
    /**
     * Get all media elements
     */
    getAllMediaElements(): RegisteredElement[];
    /**
     * Unregister an element
     */
    unregisterElement(id: string): boolean;
    /**
     * Get a registered element
     */
    getElement(id: string): RegisteredElement | undefined;
    /**
     * Get all registered elements
     */
    getAllElements(): RegisteredElement[];
    /**
     * Find element by DOM element reference
     */
    findByDOMElement(element: HTMLElement): RegisteredElement | undefined;
    /**
     * Get element event history from the element event log.
     */
    getElementHistory(elementId: string, options?: ElementHistoryOptions): ElementLogEntry[];
    /**
     * Set the log level override for a specific element.
     */
    setElementLogLevel(elementId: string, level: ElementLogLevel): void;
    /**
     * Get the effective log level for an element.
     */
    getElementLogLevel(elementId: string): ElementLogLevel;
    /**
     * Search for elements using AI search criteria
     */
    searchElements(criteria: SearchCriteria): SearchResult[];
    /**
     * Find element by visible text
     */
    findByText(text: string, fuzzy?: boolean): RegisteredElement | undefined;
    /**
     * Find element by accessible name
     */
    findByAccessibleName(name: string): RegisteredElement | undefined;
    /**
     * Generate aliases for an element
     */
    private generateElementAliases;
    /**
     * Infer ARIA role from element type
     */
    private inferRole;
    /**
     * Update a component's options in place, without emitting a
     * `component:registered` event. Returns `false` if the component is not
     * currently registered — callers should fall back to `registerComponent`.
     *
     * Preserves `registeredAt` and `mounted`. Intended for React hooks that
     * want to reflect option changes on the same mounted consumer without
     * firing a full re-register (which would churn `useSyncExternalStore`
     * subscribers).
     */
    updateComponent(id: string, options: {
        name?: string;
        description?: string;
        actions?: Array<{
            id: string;
            label?: string;
            description?: string;
            paramSchema?: Record<string, unknown>;
            handler: (params?: unknown) => unknown | Promise<unknown>;
        }>;
        elementIds?: string[];
        getState?: StateGetter<Record<string, unknown>>;
        getComputed?: () => Record<string, unknown>;
    }): boolean;
    /**
     * Register a component
     */
    registerComponent(id: string, options: {
        name: string;
        description?: string;
        actions?: Array<{
            id: string;
            label?: string;
            description?: string;
            paramSchema?: Record<string, unknown>;
            handler: (params?: unknown) => unknown | Promise<unknown>;
        }>;
        elementIds?: string[];
        getState?: StateGetter<Record<string, unknown>>;
        getComputed?: () => Record<string, unknown>;
    }): RegisteredComponent;
    /**
     * Unregister a component
     */
    unregisterComponent(id: string): boolean;
    /**
     * Get a registered component
     */
    getComponent(id: string): RegisteredComponent | undefined;
    /**
     * Get all registered components
     */
    getAllComponents(): RegisteredComponent[];
    /**
     * Get the current state and computed properties of a component
     */
    getComponentState(id: string): ComponentStateResponse | null;
    /**
     * Register a workflow
     */
    registerWorkflow(workflow: Workflow): Workflow;
    /**
     * Unregister a workflow
     */
    unregisterWorkflow(id: string): boolean;
    /**
     * Get a workflow
     */
    getWorkflow(id: string): Workflow | undefined;
    /**
     * Get all workflows
     */
    getAllWorkflows(): Workflow[];
    /**
     * Register a state
     */
    registerState(state: UIState): UIState;
    /**
     * Update a state's stored options in place. See `updateComponent` for
     * rationale — avoids re-emitting `element:registered`/`unregistered`
     * pairs on every option change so `useSyncExternalStore` consumers don't
     * re-render on minor metadata edits.
     */
    updateState(state: UIState): boolean;
    /**
     * Unregister a state
     */
    unregisterState(id: string): boolean;
    /**
     * Get a registered state
     */
    getState(id: string): UIState | undefined;
    /**
     * Get all registered states
     */
    getAllStates(): UIState[];
    /**
     * Register a state group
     */
    registerStateGroup(group: UIStateGroup): UIStateGroup;
    /** In-place update — see `updateComponent`. */
    updateStateGroup(group: UIStateGroup): boolean;
    /**
     * Unregister a state group
     */
    unregisterStateGroup(id: string): boolean;
    /**
     * Get a state group
     */
    getStateGroup(id: string): UIStateGroup | undefined;
    /**
     * Get all state groups
     */
    getAllStateGroups(): UIStateGroup[];
    /**
     * Register a transition
     */
    registerTransition(transition: UITransition): UITransition;
    /** In-place update — see `updateComponent`. */
    updateTransition(transition: UITransition): boolean;
    /**
     * Unregister a transition
     */
    unregisterTransition(id: string): boolean;
    /**
     * Get a transition
     */
    getTransition(id: string): UITransition | undefined;
    /**
     * Get all transitions
     */
    getAllTransitions(): UITransition[];
    /**
     * Get currently active states
     */
    getActiveStates(): string[];
    /**
     * Check if a state is active
     */
    isStateActive(id: string): boolean;
    /**
     * Activate a state
     */
    activateState(id: string): boolean;
    /**
     * Deactivate a state
     */
    deactivateState(id: string): boolean;
    /**
     * Activate multiple states
     */
    activateStates(ids: string[]): string[];
    /**
     * Deactivate multiple states
     */
    deactivateStates(ids: string[]): string[];
    /**
     * Activate a state group (all states in the group)
     */
    activateStateGroup(groupId: string): string[];
    /**
     * Deactivate a state group (all states in the group)
     */
    deactivateStateGroup(groupId: string): string[];
    /**
     * Check if a transition can be executed from current state
     */
    canExecuteTransition(transitionId: string): boolean;
    /**
     * Execute a transition
     */
    executeTransition(transitionId: string): Promise<TransitionResult>;
    /**
     * Find a path from current state to target states
     *
     * Uses a simple BFS algorithm for pathfinding.
     * For more advanced pathfinding (Dijkstra, A*), use the Python state manager service.
     */
    findPath(targetStates: string[]): PathResult;
    /**
     * Navigate to target states using pathfinding
     */
    navigateTo(targetStates: string[]): Promise<NavigationResult>;
    /**
     * Create a state snapshot
     */
    createStateSnapshot(): StateSnapshot;
    /**
     * Whether this registry instance has ever had an element register in its
     * lifetime. Sticky — flips true on first `registerElement` and stays true
     * until `clear()`.  Exposed primarily for tests; production code should
     * read `BridgeSnapshot.registration.everHadRegistrations`.
     */
    hasEverHadRegistrations(): boolean;
    /**
     * Per-route counts of currently-registered elements. Returns a plain
     * object copy so callers can't mutate the internal map. Elements with
     * an undefined route are omitted. Exposed primarily for tests; production
     * code should read `BridgeSnapshot.registration.byRoute`.
     */
    getCountsByRoute(): Record<string, number>;
    /**
     * Build the F3 registration-diagnostics metadata for a snapshot. Shared
     * by `createSnapshot` and `createSnapshotAsync` so both paths emit the
     * same shape.
     */
    private buildRegistrationMetadata;
    /**
     * Best-effort read of the current page route. Matches the default source
     * `registerElement` uses, so the snapshot's top-level `route` lines up
     * with the `byRoute` keys under normal operation.
     */
    private currentRoute;
    /**
     * Resolve the optional `activeTab` field for a snapshot. Applications that
     * decouple their visible pane from `window.location` (e.g. the runner's
     * tab-based shell) supply a `getActiveTab` callback in the snapshot options;
     * the SDK itself has no concept of "tab", so without a provider the field
     * stays undefined and non-tab-based consumers are unaffected. Errors thrown
     * by the provider are swallowed so a buggy host can never break the rest of
     * the snapshot.
     */
    private resolveActiveTab;
    /**
     * Run every registered snapshot enricher (canonical + pluggable extras) and
     * mutate `snapshot` in place with their output. Each call is wrapped in its
     * own try/catch so a misbehaving tracker can never break the rest of the
     * snapshot. Shared by `createSnapshot` and `createSnapshotAsync` so both
     * paths emit identically-enriched output.
     *
     * Also exposed as the public {@link runSnapshotEnrichers} entry point for
     * callers that build a snapshot shape outside `createSnapshot{,Async}` (e.g.
     * the relay/WS dispatcher in `commandHandlers.getControlSnapshot`, which
     * keeps a richer workflow + component shape but still wants the seven
     * canonical fields). Routing both shapes through this single helper keeps
     * the snapshot-two-channel-drift class structurally impossible — see
     * memory note `proj_issue_snapshot_two_channel_drift.md`.
     */
    runSnapshotEnrichers(snapshot: BridgeSnapshot, options?: {
        getActiveTab?: () => string | null | undefined;
    }): void;
    private runEnrichers;
    /**
     * Create a snapshot of the current state
     */
    createSnapshot(options?: {
        componentBasePath?: string;
        /**
         * Optional provider for the snapshot's `activeTab` field. Apps that
         * own their own tab system (the runner) inject the active tab id here.
         * Returning a falsy value or omitting the provider leaves the field
         * undefined.
         */
        getActiveTab?: () => string | null | undefined;
    }): BridgeSnapshot;
    /**
     * Create a snapshot asynchronously, processing elements in batches to avoid
     * blocking the main thread. This prevents "Page Unresponsive" dialogs when
     * there are many registered elements (200-500+), since getState() and
     * getIdentifier() force layout/style recalculation for each element.
     */
    createSnapshotAsync(batchSize?: number, options?: {
        componentBasePath?: string;
        /**
         * Optional provider for the snapshot's `activeTab` field — see
         * {@link createSnapshot}. The provider is invoked once at the end of
         * the snapshot build so it observes the same wall-clock as the
         * registration metadata.
         */
        getActiveTab?: () => string | null | undefined;
    }): Promise<BridgeSnapshot>;
    /**
     * Clear all registrations
     */
    clear(): void;
    /**
     * Get registry statistics
     */
    getStats(): {
        elementCount: number;
        componentCount: number;
        workflowCount: number;
        mountedElementCount: number;
        mountedComponentCount: number;
        stateCount: number;
        stateGroupCount: number;
        transitionCount: number;
        activeStateCount: number;
    };
}
/**
 * Get or create the global registry.
 *
 * Reads from the cross-bundle `globalThis[Symbol.for(...)]` slot so every
 * SDK bundle shares one live instance, then lazily creates one if no
 * provider has yet called `setGlobalRegistry`.
 */
declare function getGlobalRegistry(): UIBridgeRegistry;

/**
 * Element Fingerprint Generation
 *
 * Computes stable fingerprints for DOM elements that enable cross-page element matching
 * and state discovery. Fingerprint hashes are deterministic and match the Python
 * ElementFingerprint schema in qontinui/state_machine/fingerprint_types.py.
 *
 * Fingerprints capture structural and semantic properties that remain stable across
 * page loads and navigation, enabling the state machine to identify states by
 * element composition rather than brittle selectors.
 */

/**
 * Repeat pattern information for list/grid/table items.
 * Matches Python RepeatPattern.to_dict() output.
 */
interface RepeatPatternData {
    type: 'list' | 'grid' | 'table';
    containerSelector: string;
    itemSelector: string;
    index: number;
    totalCount: number;
}
/**
 * Browser-computed element fingerprint for stable identification.
 * Matches Python ElementFingerprint.to_dict() output (camelCase keys).
 */
interface ElementFingerprintData {
    hash: string;
    structuralPath: string;
    positionZone: string;
    landmarkContext: string;
    landmarkLabel?: string;
    role: string;
    tagName: string;
    accessibleName?: string;
    sizeCategory: string;
    relativePosition: {
        top: number;
        left: number;
    };
    isRepeating: boolean;
    repeatPattern?: RepeatPatternData;
}
/**
 * Compute an element fingerprint from a live DOM element.
 *
 * This is synchronous — uses the sync hash function.
 * For async SHA-256 hashing, use computeElementFingerprintAsync().
 */
declare function computeElementFingerprint(element: HTMLElement): ElementFingerprintData;
/**
 * Compute fingerprints for all registered elements in the registry.
 * Returns a map keyed by fingerprint hash.
 *
 * Elements that share a fingerprint hash (e.g., identical list items)
 * are deduplicated — only the first is kept.
 */
declare function computeAllFingerprints(registry: UIBridgeRegistry): Map<string, ElementFingerprintData>;
/**
 * Compute fingerprints with element ID mapping.
 * Returns fingerprints map and a mapping from fingerprint hash → element IDs.
 *
 * This is useful for the recording session to track which registered elements
 * correspond to which fingerprints.
 */
declare function computeFingerprintsWithMapping(registry: UIBridgeRegistry): {
    fingerprints: Map<string, ElementFingerprintData>;
    hashToElementIds: Map<string, string[]>;
    elementIdToHash: Map<string, string>;
};
/**
 * Find the nearest registered element for a DOM element by walking up ancestors.
 * Used by the interaction interceptor to map DOM events to registered elements.
 */
declare function findNearestRegisteredElement(target: HTMLElement, registry: UIBridgeRegistry): RegisteredElement | undefined;

/**
 * Recording Session Types
 *
 * Types for the recording session that captures user interactions and produces
 * CooccurrenceExport data for state machine bootstrapping.
 *
 * The CooccurrenceExportData interface matches the Python
 * CooccurrenceExport.to_dict() output exactly (camelCase keys).
 */

interface TransitionRecordData {
    actionId: string;
    actionType: string;
    targetFingerprint: string | null;
    beforeCaptureId: string;
    afterCaptureId: string;
    appearedFingerprints: string[];
    disappearedFingerprints: string[];
    timestamp: number;
}
interface PresenceMatrixEntryData {
    captureId: string;
    url: string;
    fingerprints: string[];
}
interface FingerprintStatsData {
    totalAppearances: number;
    captureIds: string[];
    firstSeen: number;
    lastSeen: number;
}
interface StateCandidateData {
    fingerprints: string[];
    cooccurrenceRate: number;
    positionZone?: string;
    landmarkContext?: string;
}
/**
 * Full export from a recording session.
 * This is the canonical input to FingerprintStateDiscovery.load_cooccurrence_export().
 */
interface CooccurrenceExportData {
    sessionId: string;
    exportedAt: number;
    allFingerprints: string[];
    fingerprintDetails: Record<string, ElementFingerprintData>;
    presenceMatrix: PresenceMatrixEntryData[];
    cooccurrenceCounts: Record<string, Record<string, number>>;
    fingerprintStats: Record<string, FingerprintStatsData>;
    transitions: TransitionRecordData[];
    stateCandidates: StateCandidateData[];
}

/**
 * Error Severity Classification
 *
 * Classifies browser events into severity levels so AI agents
 * can focus on what matters and ignore noise.
 *
 * Severity hierarchy: crash > error > warning > noise
 */

type ErrorSeverity = 'crash' | 'error' | 'warning' | 'noise';
interface ClassifiedEvent {
    event: AnyCapturedEvent;
    severity: ErrorSeverity;
    /** Short reason for the classification */
    reason: string;
}
declare const SEVERITY_RANK: Record<ErrorSeverity, number>;
/**
 * Configurable noise patterns that should be suppressed.
 * Users can extend this set via custom classifiers or by appending to the array.
 * Matching is case-sensitive substring matching against the event message.
 */
declare const DEFAULT_NOISE_PATTERNS: string[];
/**
 * Classify a single event's severity.
 *
 * Classification rules:
 * - **crash**: React error boundary, unhandled rejection, network errors on critical endpoints
 * - **error**: console.error (not noise), network 5xx, script/stylesheet load failures, HMR errors
 * - **warning**: console.warn (not noise), network 4xx, image load failures, WS disconnection,
 *   long tasks >= 500ms, long animation frames with high blocking duration
 * - **noise**: Noise-pattern matches, long tasks < 100ms, navigation, memory, web vitals,
 *   HMR reconnect messages, aborted requests, WS reconnect attempts
 */
declare function classifyEvent(event: AnyCapturedEvent): {
    severity: ErrorSeverity;
    reason: string;
};
/**
 * Classify a batch of events with their severity and reason.
 */
declare function classifyEvents(events: AnyCapturedEvent[]): ClassifiedEvent[];
/**
 * Filter events to only those at or above a minimum severity.
 *
 * Severity order: crash > error > warning > noise
 *
 * Examples:
 * - `filterBySeverity(events, 'warning')` returns crash + error + warning events
 * - `filterBySeverity(events, 'error')` returns crash + error events
 * - `filterBySeverity(events, 'noise')` returns all events (everything is at least noise)
 */
declare function filterBySeverity(events: AnyCapturedEvent[], minSeverity: ErrorSeverity): AnyCapturedEvent[];

/**
 * Error Impact Assessment
 *
 * Determines whether an error actually affected the UI by comparing
 * UI state snapshots before and after the error occurred.
 *
 * Phase 4.15 from the console capture plan.
 *
 * This module is DOM-agnostic — all UI state is provided via the
 * `captureUIState` callback in the config.
 */

interface UIConsequences {
    /** Element IDs that disappeared after the error */
    elementsRemoved: string[];
    /** New elements that appeared (e.g., error boundary fallback) */
    elementsAdded: string[];
    /** Elements that became disabled after the error */
    elementsDisabled: string[];
    /** Unexpected navigation destination, if any */
    navigationTriggered?: string;
    /** Entire component tree crashed (e.g., white screen) */
    renderBlocked: boolean;
    /** React error boundary caught the error */
    errorBoundaryTriggered: boolean;
}
interface ErrorImpact {
    error: {
        message: string;
        severity: ErrorSeverity;
        fingerprint: string;
        timestamp: number;
    };
    uiConsequences: UIConsequences;
    recoveryStatus: 'recovered' | 'degraded' | 'fatal' | 'unknown';
    assessedAt: number;
}
interface UIStateSnapshot {
    /** Set of registered element IDs */
    elementIds: Set<string>;
    /** Subset that are disabled */
    disabledIds: Set<string>;
    /** Elements that match error boundary fallback patterns */
    errorBoundaryElements: Set<string>;
    /** Current URL */
    url: string;
    /** When this snapshot was taken */
    timestamp: number;
}
interface ErrorImpactConfig {
    /** Callback to capture current UI state (module is DOM-agnostic) */
    captureUIState: () => UIStateSnapshot;
    /** Time window after error to check for navigation changes (default: 500ms) */
    navigationChangeThresholdMs?: number;
    /** If element count drops below this fraction of before-count, consider render blocked (default: 0.2 = 80% elements lost) */
    renderBlockedThreshold?: number;
}
declare class ErrorImpactAssessor {
    private config;
    private beforeState;
    private lastAssessment;
    constructor(config: ErrorImpactConfig);
    /**
     * Capture a "before" snapshot of the UI state.
     * Call this before an action that might trigger errors.
     */
    captureBeforeState(): void;
    /**
     * Assess the impact of a single browser event on the UI.
     *
     * Classifies the event, captures an after-state snapshot, and computes
     * the diff against the before-state to determine UI consequences.
     */
    assessImpact(event: AnyCapturedEvent): ErrorImpact;
    /**
     * Batch version of assessImpact.
     * Only assesses crash and error severity events (skips warning/noise).
     */
    assessEvents(events: AnyCapturedEvent[]): ErrorImpact[];
    /**
     * Get the most recent impact assessment, or null if none has been performed.
     */
    getLastAssessment(): ErrorImpact | null;
    /**
     * Compare before and after UI snapshots to determine what changed.
     */
    private computeConsequences;
    /**
     * Determine recovery status based on UI consequences.
     *
     * - `fatal`: render blocked OR >50% of elements removed
     * - `degraded`: error boundary triggered OR elements disabled OR some elements removed
     * - `recovered`: no significant UI changes (error was handled gracefully)
     * - `unknown`: unable to determine (e.g., no before-state)
     */
    private determineRecovery;
    /**
     * Check if new error boundary fallback elements appeared.
     */
    private hasNewErrorBoundaryElements;
    /**
     * Return an empty UIConsequences (used when no before-state is available).
     */
    private emptyConsequences;
}

/**
 * Resolution-independent coordinates normalized to 0–1 range relative to the viewport.
 * Inspired by AirtestProject/Poco's coordinate system for cross-resolution targeting.
 *
 * Values are computed as: rect.{x,y,width,height} / viewport.{width,height}
 * so (0,0) is top-left and (1,1) is bottom-right of the viewport.
 */
interface NormalizedRect {
    /** Normalized left edge (0–1) */
    x: number;
    /** Normalized top edge (0–1) */
    y: number;
    /** Normalized width (0–1) */
    width: number;
    /** Normalized height (0–1) */
    height: number;
}
/**
 * Element identification using multiple strategies
 */
interface ElementIdentifier {
    /** @deprecated No longer set. Elements are identified through the bridge registry. */
    uiId?: string;
    /** Testing library convention (data-testid attribute) */
    testId?: string;
    /** Legacy AWAS support (data-awas-element attribute) */
    awasId?: string;
    /** HTML id attribute */
    htmlId?: string;
    /** Generated XPath selector */
    xpath: string;
    /** Generated CSS selector */
    selector: string;
}
/**
 * Current state of a UI element
 */
interface ElementState {
    /** Whether the element is visible in the viewport */
    visible: boolean;
    /** Whether the element is enabled (not disabled) */
    enabled: boolean;
    /** Whether the element has focus */
    focused: boolean;
    /** ARIA role attribute value (e.g. "tablist", "tab", "button") */
    role?: string;
    /** Computed accessible name (aria-label > aria-labelledby > associated label > title > text) */
    accessibleName?: string;
    /** Bounding rectangle of the element */
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    /** Resolution-independent bounding rect normalized to 0–1 viewport coordinates */
    normalizedRect?: NormalizedRect;
    /** Current value for inputs */
    value?: string;
    /** Checked state for checkboxes/radios */
    checked?: boolean;
    /** Selected options for select elements */
    selectedOptions?: string[];
    /** Full option list for <select> elements — value/label/selected per option */
    availableOptions?: Array<{
        value: string;
        label: string;
        selected: boolean;
    }>;
    /** Text content of the element */
    textContent?: string;
    /** Inner HTML of the element (sanitized) */
    innerHTML?: string;
    /** href for anchor elements */
    href?: string;
    /** Route path from data-route attribute (navigation elements) */
    dataRoute?: string;
    /** Whether element has opacity 0 (visually hidden but in DOM) */
    opacityHidden?: boolean;
    /** ARIA selected state (tabs, list items) */
    ariaSelected?: boolean;
    /** ARIA pressed state (toggle buttons) */
    ariaPressed?: boolean | 'mixed';
    /** ARIA current state (navigation) */
    ariaCurrent?: string;
    /** ARIA expanded state (expandable elements) */
    ariaExpanded?: boolean;
    /** ARIA checked state (switches, checkboxes with role="switch"/"checkbox", can be true/false/'mixed') */
    ariaChecked?: boolean | 'mixed';
    /** Computed styles relevant for automation and visual debugging */
    computedStyles?: {
        display: string;
        visibility: string;
        opacity: string;
        pointerEvents: string;
        cursor: string;
        color: string;
        backgroundColor: string;
        colorScheme: string;
        fontSize: string;
        fontWeight: string;
        lineHeight: string;
        overflow: string;
        textOverflow: string;
        whiteSpace: string;
        position: string;
        zIndex: string;
        padding: string;
        margin: string;
        borderColor: string;
        borderWidth: string;
        borderRadius: string;
    };
    /** Whether the element is required (form controls only) */
    required?: boolean;
    /** HTML5 constraint validation state (form controls only) */
    validationState?: {
        valid: boolean;
        validationMessage?: string;
        valueMissing?: boolean;
        typeMismatch?: boolean;
        patternMismatch?: boolean;
        tooShort?: boolean;
        tooLong?: boolean;
        rangeUnderflow?: boolean;
        rangeOverflow?: boolean;
        stepMismatch?: boolean;
        customError?: boolean;
    };
    /** HTML5 constraint attributes (form controls only) */
    constraints?: {
        pattern?: string;
        minLength?: number;
        maxLength?: number;
        min?: string;
        max?: string;
        step?: string;
    };
    /** Media metadata for images, video, canvas, SVG elements */
    mediaMetadata?: MediaMetadata;
    /** Whether this element is within the viewport bounds (separate from `visible` which also checks display/opacity) */
    inViewport?: boolean;
    /** Scroll container info — only present if this element has overflowing scrollable content */
    scrollInfo?: {
        /** Current vertical scroll offset */
        scrollTop: number;
        /** Current horizontal scroll offset */
        scrollLeft: number;
        /** Total scrollable height */
        scrollHeight: number;
        /** Total scrollable width */
        scrollWidth: number;
        /** Visible (client) height */
        clientHeight: number;
        /** Visible (client) width */
        clientWidth: number;
        /** Whether more content exists above */
        canScrollUp: boolean;
        /** Whether more content exists below */
        canScrollDown: boolean;
        /** Whether more content exists to the left */
        canScrollLeft: boolean;
        /** Whether more content exists to the right */
        canScrollRight: boolean;
    };
}
/**
 * Types of UI elements that can be registered
 */
type ElementType = 'button' | 'input' | 'select' | 'checkbox' | 'radio' | 'link' | 'form' | 'textarea' | 'menu' | 'menuitem' | 'tab' | 'dialog' | 'disclosure' | 'custom' | 'switch' | 'slider' | 'combobox' | 'listbox' | 'option' | 'textbox' | 'generic' | 'image' | 'video' | 'canvas' | 'svg' | 'picture';
/**
 * Types of static content elements (non-interactive)
 */
type ContentType = 'heading' | 'paragraph' | 'list-item' | 'table-cell' | 'table-header' | 'label' | 'caption' | 'blockquote' | 'code-block' | 'badge' | 'status-message' | 'metric-value' | 'description-text' | 'nav-text' | 'content-generic';
/**
 * Semantic role of content elements
 */
type ContentRole = 'heading' | 'body-text' | 'list-item' | 'table-cell' | 'table-header' | 'label' | 'caption' | 'quote' | 'code' | 'badge' | 'status' | 'metric' | 'description' | 'navigation' | 'generic';
/**
 * Metadata for content elements
 */
interface ContentMetadata {
    /** Semantic role of the content */
    contentRole: ContentRole;
    /** Heading level (1-6) for heading content */
    headingLevel?: number;
    /** Whether the content is dynamically updated */
    dynamic?: boolean;
    /** Stable text prefix for identification when full text changes */
    stableTextPrefix?: string;
    /** Structural context (e.g., "table > tbody > tr:nth-child(2)") */
    structuralContext?: string;
}
/**
 * Types of media elements
 */
type MediaType = 'image' | 'video' | 'canvas' | 'svg' | 'picture' | 'background-image';
/**
 * Metadata for media elements (images, video, canvas, SVG, etc.)
 */
interface MediaMetadata {
    /** Type of media element */
    mediaType: MediaType;
    /** Source URL */
    src?: string;
    /** Alt text for accessibility */
    altText?: string;
    /** Whether the image is decorative (empty alt or role="presentation") */
    isDecorative: boolean;
    /** Natural (intrinsic) width in pixels */
    naturalWidth?: number;
    /** Natural (intrinsic) height in pixels */
    naturalHeight?: number;
    /** Rendered width in pixels */
    renderedWidth: number;
    /** Rendered height in pixels */
    renderedHeight: number;
    /** Ratio of natural to rendered size (> 2.0 indicates oversized) */
    oversizeRatio?: number;
    /** Current loading state */
    loadingState: 'pending' | 'loaded' | 'error' | 'lazy';
    /** Whether the element uses lazy loading */
    lazyLoading: boolean;
    /** Image format (e.g., 'png', 'jpg', 'webp', 'svg+xml') */
    format?: string;
    /** Transfer size in bytes (from Performance API) */
    transferSize?: number;
    /** srcset attribute value */
    srcset?: string;
    /** sizes attribute value */
    sizes?: string;
    /** Source elements from <picture> */
    sources?: Array<{
        srcset: string;
        media?: string;
        type?: string;
    }>;
    /** SVG viewBox attribute */
    svgViewBox?: string;
    /** Video-specific state */
    videoState?: {
        poster?: string;
        currentTime: number;
        duration: number;
        paused: boolean;
        muted: boolean;
    };
}
/**
 * Standard actions available on elements
 */
type StandardAction = 'click' | 'doubleClick' | 'rightClick' | 'middleClick' | 'type' | 'sendKeys' | 'clear' | 'select' | 'focus' | 'blur' | 'hover' | 'scroll' | 'scrollIntoView' | 'check' | 'uncheck' | 'toggle' | 'setValue' | 'drag' | 'submit' | 'reset' | 'autocomplete';
/**
 * Handler for custom actions
 */
type ActionHandler<TParams = unknown, TResult = unknown> = (params?: TParams) => TResult | Promise<TResult>;
/**
 * Custom action definition
 */
interface CustomAction<TParams = unknown, TResult = unknown> {
    /** Action identifier */
    id: string;
    /** Human-readable label */
    label?: string;
    /** Description of what the action does */
    description?: string;
    /** Action handler function */
    handler: ActionHandler<TParams, TResult>;
}
/**
 * Live bounding box (viewport-relative, CSS pixels) for a registered element.
 *
 * Maintained by the `useUIElement` hook via `ResizeObserver` + scroll/resize
 * listeners — it's always fresh without a `getBoundingClientRect()` call at
 * snapshot time. Used by the runner's bbox-first click provider to skip VLM
 * pixel grounding for SDK-registered elements.
 */
interface ElementBbox {
    /** Viewport-relative left edge in CSS pixels */
    x: number;
    /** Viewport-relative top edge in CSS pixels */
    y: number;
    /** Width in CSS pixels */
    width: number;
    /** Height in CSS pixels */
    height: number;
}
/**
 * A UI element registered with the bridge
 */
interface RegisteredElement {
    /** Unique identifier for this element */
    id: string;
    /** The DOM element reference */
    element: HTMLElement;
    /** Type of UI element */
    type: ElementType;
    /** Human-readable label */
    label?: string;
    /** Available standard actions for this element */
    actions: StandardAction[];
    /** Custom actions specific to this element */
    customActions?: Record<string, CustomAction>;
    /** Function to get the current state */
    getState: () => ElementState;
    /** Function to get the element identifier */
    getIdentifier: () => ElementIdentifier;
    /** Timestamp when the element was registered */
    registeredAt: number;
    /** Whether this element is currently mounted */
    mounted: boolean;
    /**
     * Live viewport-relative bounding box in CSS pixels. Maintained by
     * `useUIElement` via ResizeObserver + scroll/resize listeners so snapshots
     * can expose it without recomputing layout. Undefined if the element is not
     * DOM-attached yet or the hook couldn't resolve a node.
     */
    bbox?: ElementBbox;
    /**
     * Live visibility signal (`bbox.width > 0 && bbox.height > 0`). Undefined
     * when `bbox` is undefined. A "rendered" hint only — it does not include
     * the hit-test/occlusion checks that `getState().visible` performs.
     */
    visible?: boolean;
    /** Whether this is an interactive element, static content, or media */
    category?: 'interactive' | 'content' | 'media';
    /** Metadata for content elements */
    contentMetadata?: ContentMetadata;
    /** Metadata for media elements */
    mediaMetadata?: MediaMetadata;
    /**
     * Normalized text content of a semantic content element (whitespace
     * collapsed, trimmed). Populated by the auto-register scanner for plain
     * content elements tagged with `data-ui-bridge-content` so snapshots can
     * expose card/badge/pill text without requiring `/control/page/evaluate`.
     * Absent for interactive elements and for content registered via the
     * heading/paragraph/table-cell content-discovery path (those expose their
     * text via `state.textContent`).
     */
    content?: string;
    /**
     * ARIA role / semantic role of a content element, populated from
     * `data-ui-bridge-role` on the element (falls back to `role` attribute).
     * Lets callers filter semantic content by role (e.g. `role: "article"`,
     * `role: "listitem"`, `role: "status"`) without DOM traversal.
     */
    role?: string;
    /** Alternative names for natural language matching */
    aliases?: string[];
    /** Human-readable description for AI agents */
    description?: string;
    /** Semantic type (more descriptive than ElementType) */
    semanticType?: string;
    /** Purpose of the element */
    purpose?: string;
    /**
     * ID of a `useUIComponent` that owns/renders this element. Set automatically
     * when the element is registered inside a `<UIBridgeComponentScope>`, so
     * snapshot consumers can discover that higher-level actions exist (e.g.
     * `POST /control/component/<ownedByComponent>/action/load-profile`) rather
     * than driving the flow through raw element clicks.
     */
    ownedByComponent?: string;
    /**
     * How this element entered the registry.
     *
     * - `'hook'`  — registered explicitly via `useUIElement` / `useUIComponent`
     *   (i.e. a developer wired it up).
     * - `'auto'`  — registered by the DOM walker in `useAutoRegister` based on
     *   tag/role selectors. Downstream consumers (snapshot filters, spec
     *   emitters, test tooling) can use this to skip or prioritize
     *   developer-instrumented elements.
     *
     * Defaults to `'hook'` when not specified so programmatic callers that
     * preceded this field behave as before.
     */
    origin?: 'hook' | 'auto';
    /**
     * Semantic role / intent. Common values: `"primary"`, `"secondary"`,
     * `"destructive"`, `"ghost"`, `"link"`, `"success"`, `"warning"`.
     * Open-ended — consumers may use their own design-system tokens.
     */
    variant?: string;
    /**
     * Positional hint for disambiguation. Common values: `"top"`, `"bottom"`,
     * `"left"`, `"right"`, `"top-left"`, `"top-right"`, `"bottom-left"`,
     * `"bottom-right"`, `"center"`. Open-ended string.
     */
    position?: string;
    /**
     * Dominant color hint as seen by the user. Accepts CSS color names
     * (`"red"`, `"blue"`), hex (`"#ef4444"`), or design-token aliases
     * (`"accent"`, `"danger"`). Open-ended string.
     */
    color?: string;
    /**
     * Hierarchical semantic path, e.g.
     * `"settings-modal > theme-section > accent-color"`. Helps rank
     * "the Save button" when multiple forms each have one. Open-ended string.
     */
    contextPath?: string;
    /**
     * The page route this element was registered under.
     *
     * Captured at `registerElement` time from `window.location.pathname` when
     * not provided explicitly. Used to group elements by page in snapshot
     * registration metadata so callers can confirm a tab switch actually
     * re-registered the target page's elements. Undefined in non-DOM
     * environments (SSR, tests without jsdom).
     */
    route?: string;
    /**
     * Action-driven cached state overlays.
     *
     * After a mutation action (`type`, `clear`, `setValue`, `check`, `uncheck`,
     * `toggle`, `select`, `sendKeys`, `focus`, `blur`) executes, the action
     * executor pushes the freshly-computed `ElementState` here via
     * `registry.refreshElement(id, state)`. The element's `getState()` overlays
     * these fields on top of the live DOM read so subsequent
     * `/control/element/:id` and `/control/snapshot` calls reflect the action
     * outcome even when the registered DOM node has been detached/re-rendered
     * by React between the action and the read.
     *
     * Cleared on re-registration (the new entry starts with no overrides).
     */
    cachedStateOverrides?: Partial<ElementState>;
}
/**
 * Generic state getter function
 */
type StateGetter<T = unknown> = () => T;
/**
 * Component action definition
 */
interface ComponentAction<TParams = unknown, TResult = unknown> {
    /** Action identifier */
    id: string;
    /** Human-readable label */
    label?: string;
    /** Description of what the action does */
    description?: string;
    /** Parameter schema (for documentation/validation) */
    paramSchema?: Record<string, unknown>;
    /** Action handler function */
    handler: ActionHandler<TParams, TResult>;
}
/**
 * A component registered with the bridge (higher-level than elements)
 */
interface RegisteredComponent {
    /** Unique identifier for this component */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description of the component's purpose */
    description?: string;
    /** Available actions on this component */
    actions: ComponentAction[];
    /** Child element IDs owned by this component */
    elementIds?: string[];
    /** Timestamp when the component was registered */
    registeredAt: number;
    /** Whether this component is currently mounted */
    mounted: boolean;
    /** State getter function */
    getState?: StateGetter<Record<string, unknown>>;
    /** Computed properties getter function */
    getComputed?: () => Record<string, unknown>;
}
/**
 * Workflow step types
 */
type WorkflowStepType = 'element-action' | 'component-action' | 'wait' | 'assert' | 'navigate' | 'branch' | 'loop' | 'extract' | 'log' | 'custom';
/**
 * Branch condition for conditional workflow execution
 */
interface BranchCondition {
    /** State IDs that must be active */
    activeStates?: string[];
    /** State IDs that must be inactive */
    inactiveStates?: string[];
    /** Element ID to check state of */
    elementId?: string;
    /** Expected element state */
    elementState?: Partial<ElementState>;
    /** Custom condition function */
    condition?: () => boolean | Promise<boolean>;
}
/**
 * Loop configuration for repeated workflow steps
 */
interface LoopConfig {
    /** Maximum number of iterations */
    maxIterations?: number;
    /** Continue while these states are active */
    whileStatesActive?: string[];
    /** Continue while these states are inactive */
    whileStatesInactive?: string[];
    /** Custom continue condition */
    whileCondition?: () => boolean | Promise<boolean>;
    /** Delay between iterations in ms */
    delayMs?: number;
}
/**
 * Extract configuration for data extraction
 */
interface ExtractConfig {
    /** Element ID to extract from */
    elementId: string;
    /** Property to extract (value, textContent, innerHTML, attribute) */
    property: 'value' | 'textContent' | 'innerHTML' | 'attribute' | 'state';
    /** Attribute name (if property is 'attribute') */
    attributeName?: string;
    /** Variable name to store extracted value */
    variableName: string;
    /** Optional transformation function */
    transform?: (value: unknown) => unknown;
}
/**
 * Log configuration for debugging
 */
interface LogConfig {
    /** Log level */
    level: 'debug' | 'info' | 'warn' | 'error';
    /** Message to log */
    message: string;
    /** Additional data to include */
    data?: Record<string, unknown>;
    /** Include current active states */
    includeStates?: boolean;
    /** Include element state */
    elementId?: string;
}
/**
 * Workflow step definition
 */
interface WorkflowStep {
    /** Step identifier */
    id: string;
    /** Type of step */
    type: WorkflowStepType;
    /** Target element or component ID */
    target?: string;
    /** Action to execute */
    action?: string;
    /** Action parameters */
    params?: Record<string, unknown>;
    /** Wait conditions */
    waitOptions?: WaitOptions;
    /** Expected state for assertions */
    expectedState?: Partial<ElementState>;
    /** Custom step handler */
    handler?: () => unknown | Promise<unknown>;
    /** Target states for navigation (type: 'navigate') */
    targetStates?: string[];
    /** Branch condition (type: 'branch') */
    branchCondition?: BranchCondition;
    /** Steps to execute if branch condition is true */
    thenSteps?: WorkflowStep[];
    /** Steps to execute if branch condition is false */
    elseSteps?: WorkflowStep[];
    /** Loop configuration (type: 'loop') */
    loopConfig?: LoopConfig;
    /** Steps to execute in loop */
    loopSteps?: WorkflowStep[];
    /** Extract configuration (type: 'extract') */
    extractConfig?: ExtractConfig;
    /** Log configuration (type: 'log') */
    logConfig?: LogConfig;
}
/**
 * Extended workflow step with additional branch/loop/extract support
 */
interface ExtendedWorkflowStep extends WorkflowStep {
    /** Branch condition (type: 'branch') */
    branchCondition?: BranchCondition;
    /** Steps to execute if branch condition is true */
    thenSteps?: ExtendedWorkflowStep[];
    /** Steps to execute if branch condition is false */
    elseSteps?: ExtendedWorkflowStep[];
    /** Loop configuration (type: 'loop') */
    loopConfig?: LoopConfig;
    /** Steps to execute in loop */
    loopSteps?: ExtendedWorkflowStep[];
    /** Extract configuration (type: 'extract') */
    extractConfig?: ExtractConfig;
    /** Log configuration (type: 'log') */
    logConfig?: LogConfig;
}
/**
 * Workflow definition
 */
interface Workflow {
    /** Unique identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description of what the workflow does */
    description?: string;
    /** Steps to execute */
    steps: WorkflowStep[];
    /** Default parameters for the workflow */
    defaultParams?: Record<string, unknown>;
}
/**
 * Wait options for actions
 */
interface WaitOptions {
    /** Wait for element to be visible */
    visible?: boolean;
    /** Wait for element to be enabled */
    enabled?: boolean;
    /** Wait for element to have focus */
    focused?: boolean;
    /** Wait for element state to match */
    state?: Partial<ElementState>;
    /** Timeout in milliseconds */
    timeout?: number;
    /** Polling interval in milliseconds */
    interval?: number;
}
/**
 * Action request sent to the control API
 */
interface ActionRequest {
    /** Action to execute */
    action: StandardAction | string;
    /** Action parameters */
    params?: {
        /** Text to type */
        text?: string;
        /** Value to select */
        value?: string;
        /** Scroll offset */
        offset?: {
            x: number;
            y: number;
        };
        /** Key modifiers */
        modifiers?: {
            ctrl?: boolean;
            shift?: boolean;
            alt?: boolean;
            meta?: boolean;
        };
        /** Additional custom parameters */
        [key: string]: unknown;
    };
    /** Wait options before executing */
    waitOptions?: WaitOptions;
}
/**
 * Response from an action execution
 */
interface ActionResponse {
    /** Whether the action succeeded */
    success: boolean;
    /** Element state after the action */
    elementState?: ElementState;
    /** Result of the action (for custom actions) */
    result?: unknown;
    /** Error message if failed */
    error?: string;
    /** Stack trace if failed */
    stack?: string;
    /** Duration of the action in milliseconds */
    durationMs: number;
    /** Timestamp when the action completed */
    timestamp: number;
    /** Console errors/warnings captured during action execution */
    consoleErrors?: CapturedError[];
    /** All browser events captured during action execution, enriched with severity and source info */
    browserEvents?: ActionBrowserEvent[];
    /** Error diff: what changed as a result of this action */
    errorDiff?: ActionErrorDiff;
    /** Error impact assessment: how errors affected the UI (only present when significant errors occurred) */
    errorImpact?: ErrorImpact;
}
/**
 * An enriched browser event captured during action execution.
 * Includes classification metadata that the raw CapturedError lacks.
 */
interface ActionBrowserEvent {
    /** The raw captured event */
    event: AnyCapturedEvent;
    /** Classified severity */
    severity: ErrorSeverity;
    /** Reason for the classification */
    reason: string;
    /** Stable fingerprint for deduplication */
    fingerprint: string;
    /** Extracted source file:line, if available */
    sourceLocation?: string;
}
/**
 * Error diff: what changed as a result of an action.
 * Compares browser events before vs after the action.
 */
interface ActionErrorDiff {
    /** Events that appeared after the action (new fingerprints) */
    newErrors: ActionBrowserEvent[];
    /** Events present before that disappeared after */
    resolvedErrors: ActionBrowserEvent[];
    /** Net change: positive means more errors, negative means fewer */
    errorDelta: number;
}
/**
 * Fill multiple form fields atomically
 */
interface FillAction {
    type: 'fill';
    /** Map of element ID (or selector) to value */
    fields: Record<string, string | boolean | string[]>;
    /** Whether to trigger validation after filling (default: true) */
    triggerValidation?: boolean;
    /** Whether to clear existing values first (default: true) */
    clearFirst?: boolean;
}
/**
 * Result of filling a single form field
 */
interface FillFieldResult {
    /** Whether this field was filled successfully */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Validation error message if validation failed */
    validationError?: string;
}
/**
 * Result of filling multiple form fields
 */
interface FillResult {
    /** Whether all fields were filled successfully */
    success: boolean;
    /** Number of fields that were filled */
    filledCount: number;
    /** Number of fields that encountered errors */
    errorCount: number;
    /** Per-field results keyed by field ID */
    fields: Record<string, FillFieldResult>;
}
/**
 * Machine-readable error codes for action failures
 */
type ActionErrorCode = 'ELEMENT_NOT_FOUND' | 'ELEMENT_NOT_VISIBLE' | 'ELEMENT_NOT_ENABLED' | 'ELEMENT_NOT_INTERACTABLE' | 'ACTION_TIMEOUT' | 'ACTION_REJECTED' | 'STATE_NOT_REACHED' | 'NETWORK_ERROR' | 'PARSE_ERROR' | 'VALIDATION_ERROR' | 'AMBIGUOUS_MATCH' | 'LOW_CONFIDENCE' | 'UNSUPPORTED_ACTION' | 'UNKNOWN_ERROR';
/**
 * Partial element match found during search
 */
interface PartialMatch {
    /** Element ID of the partial match */
    elementId: string;
    /** Match confidence score (0-1) */
    confidence: number;
    /** Reason for partial match */
    reason: string;
    /** Type of match */
    type: string;
    /** Description of the match */
    description?: string;
}
/**
 * Suggested recovery action
 */
interface RecoveryAction {
    /** Human-readable suggestion */
    suggestion: string;
    /** Optional command to execute */
    command?: string;
    /** Confidence score (0-1) */
    confidence: number;
    /** Whether the original action can be retried */
    retryable: boolean;
}
/**
 * Structured error details for action failures
 */
interface ActionFailureDetails {
    /** Machine-readable error code */
    errorCode: ActionErrorCode;
    /** Human-readable error message */
    message: string;
    /** Element ID that was targeted */
    elementId?: string;
    /** CSS selectors that were tried */
    selectorsTried?: string[];
    /** Partial matches found during element search */
    partialMatches?: PartialMatch[];
    /** Element state at time of failure */
    elementState?: ElementState;
    /** Screenshot context (base64 or URL) */
    screenshotContext?: string;
    /** Suggested recovery actions */
    suggestedActions: RecoveryAction[];
    /** Whether retrying is recommended */
    retryRecommended: boolean;
    /** Additional context */
    context?: Record<string, unknown>;
    /** Duration of the action in milliseconds */
    durationMs?: number;
    /** Timeout that was configured in milliseconds */
    timeoutMs?: number;
}
/**
 * Declarative spec for asserting properties of a registered element.
 * Passed as the JSON body to `POST /ui-bridge/control/element/{id}/assert`.
 */
interface ElementAssertionSpec {
    /** Assert the element is visible (or not) */
    visible?: boolean;
    /** Assert the element is enabled (or not) */
    enabled?: boolean;
    /** Assert the element has focus (or not) */
    focused?: boolean;
    /** Assert exact text content */
    text?: string;
    /** Assert text content contains this substring */
    textContains?: string;
    /** Assert text content matches this regex (capped at 500 chars) */
    textMatches?: string;
    /** Assert exact input/textarea value */
    value?: string;
    /** Assert checked state (checkboxes, radios) */
    checked?: boolean;
    /** Assert HTML attributes by name → expected value */
    attributes?: Record<string, string>;
    /** Assert CSS class presence / absence */
    classList?: {
        has?: string[];
        missing?: string[];
    };
    /** Assert bounding-box dimensions (px) */
    boundingBox?: {
        minWidth?: number;
        maxWidth?: number;
        minHeight?: number;
        maxHeight?: number;
    };
}
/**
 * A single failed predicate within an element assertion.
 */
interface ElementAssertionFailure {
    /** The spec field that failed (e.g. "visible", "classList.has", "boundingBox.minWidth") */
    field: string;
    /** The value the spec expected */
    expected: unknown;
    /** The actual value observed on the element */
    actual: unknown;
    /** Comparison kind */
    kind: 'exact' | 'contains' | 'regex' | 'min' | 'max' | 'absent' | 'error';
}
/**
 * Structured result of a declarative element assertion.
 * Returned by `POST /ui-bridge/control/element/{id}/assert`.
 */
interface ElementAssertionResult {
    /** True when every checked predicate passed */
    passed: boolean;
    /** Total number of predicates evaluated */
    checked: number;
    /** Number of predicates that passed */
    passedCount: number;
    /** Details for each failing predicate (empty when `passed` is true) */
    failures: ElementAssertionFailure[];
    /** Snapshot of the element's state at assertion time */
    elementSnapshot?: {
        id: string;
        visible: boolean;
        enabled: boolean;
        focused: boolean;
        textContent?: string;
        value?: string;
        checked?: boolean;
        rect?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    };
}
/**
 * Registration-diagnostics metadata for a bridge snapshot.
 *
 * Lets callers distinguish the three cases that all look like
 * `elements: []` on the wire:
 *   1. "Bridge has never seen any registration" — page has no `useUIElement`
 *      coverage, or the SDK isn't wired up at all.
 *   2. "Registrations happened but are all unmounted now" — page mounted
 *      its elements earlier then tore them down (e.g. route switched).
 *   3. "Registrations happened and some are still live" — normal operation;
 *      `elements` is empty only if the caller filtered it out.
 *
 * Always present on `BridgeSnapshot`. Additive to the pre-F3 shape: legacy
 * readers of `elements` continue to work unchanged.
 */
interface SnapshotRegistrationMetadata {
    /** Number of elements currently in the registry at snapshot time. */
    totalRegistered: number;
    /**
     * Flips `true` the first time any element registers in this SDK
     * instance's lifetime, and stays `true` for the rest of its lifetime —
     * even after every element unmounts. Use this to distinguish "bridge has
     * never seen any registration" from "registrations happened but are all
     * unmounted now".
     */
    everHadRegistrations: boolean;
    /**
     * Per-route counts of currently-registered elements, keyed by the route
     * string captured when the element was registered (same semantics as the
     * snapshot's top-level `route` field). Elements drop out of the map when
     * they unmount; a route with zero live elements is omitted entirely
     * rather than kept as `route: 0`. Useful for confirming a tab switch
     * actually re-registered the target page's elements.
     */
    byRoute: Record<string, number>;
}
/**
 * Snapshot of the entire UI bridge state
 */
interface BridgeSnapshot {
    /**
     * Timestamp of the snapshot (ms since epoch).
     *
     * @deprecated Prefer `snapshotTakenAtMs` — same value, clearer name.
     *   Both fields are emitted for back-compat; `timestamp` will be removed
     *   in a future major.
     */
    timestamp: number;
    /** Snapshot capture timestamp in milliseconds since epoch. */
    snapshotTakenAtMs: number;
    /**
     * Current page route at snapshot time. Captured from
     * `window.location.pathname` when available. Undefined in non-DOM
     * environments. Matches the `route` keys used in `registration.byRoute`.
     */
    route?: string;
    /**
     * Currently-active tab id for tab-based apps that decouple their visible
     * pane from `route`. The SDK does not own a tab system itself; this field
     * is populated only when the snapshot caller supplies a `getActiveTab`
     * provider on `createSnapshot` / `createSnapshotAsync`. The runner wires
     * this to its `qontinui-main-active-tab` instance-storage key (the same
     * value the `tabs_list` IPC handler returns), so cross-tab automation can
     * read `route` + `activeTab` from a single snapshot rather than calling
     * `/control/tabs` separately. Absent for non-runner consumers.
     */
    activeTab?: string;
    /**
     * Registration-diagnostics metadata — lets callers tell "no coverage"
     * from "coverage but all unmounted" without an extra probe round-trip.
     * See {@link SnapshotRegistrationMetadata}.
     */
    registration: SnapshotRegistrationMetadata;
    /** All registered elements */
    elements: Array<{
        id: string;
        type: ElementType | string;
        tagName: string;
        label?: string;
        identifier: ElementIdentifier;
        state: ElementState;
        actions: StandardAction[];
        customActions?: string[];
        category?: 'interactive' | 'content' | 'media';
        /**
         * High-level element kind — `"interactive"` for clickable/typeable/etc.
         * elements, `"content"` for semantic plain-content elements (cards,
         * badges, pills) emitted via `data-ui-bridge-content`. Mirrors
         * `category` when set; callers can filter with `?interactiveOnly=true`
         * to exclude content entries. Absent for `"media"` (use `category`).
         */
        kind?: 'interactive' | 'content';
        /**
         * Normalized text content of a `data-ui-bridge-content` element
         * (whitespace-collapsed, trimmed). Lets snapshot consumers assert on
         * card/badge/pill text directly. Undefined for interactive elements.
         */
        content?: string;
        /**
         * ARIA role / semantic role hint for content elements, sourced from
         * `data-ui-bridge-role` (falls back to the element's `role` attribute).
         * Absent for elements that don't carry one.
         */
        role?: string;
        contentMetadata?: ContentMetadata;
        mediaMetadata?: MediaMetadata;
        /** Component (if any) that owns/renders this element. Prefer component actions for automation. */
        ownedByComponent?: string;
        /** Base URL template for the owning component, if present. */
        componentActionBasePath?: string;
        /**
         * Live viewport-relative bounding box tracked by `useUIElement`. Present
         * for SDK-registered elements whose ref has attached (or that resolved
         * via the `[data-ui-bridge-id]` fallback). Undefined for elements that
         * didn't wire up live tracking.
         */
        bbox?: ElementBbox;
        /** Live visibility (`bbox.width > 0 && bbox.height > 0`). Paired with `bbox`. */
        visible?: boolean;
        /** Stable reference that survives React re-renders */
        stableRef?: {
            id: string;
            fingerprint: string;
            semanticPath: string;
            stableId?: string;
        };
        /**
         * How this element got into the registry.
         * `'hook'` = explicit `useUIElement`/`useUIComponent`; `'auto'` = DOM-walker
         * auto-instrumentation (`useAutoRegister`). Consumers that want to ignore
         * auto-tagged entries can filter on this field.
         */
        origin?: 'hook' | 'auto';
        /**
         * Semantic role / intent hint for disambiguation (e.g. `"primary"`,
         * `"destructive"`). Passthrough from `useUIElement` options. See
         * `RegisteredElement.variant` for common values.
         */
        variant?: string;
        /**
         * Positional hint for disambiguation (e.g. `"bottom-right"`).
         * Passthrough from `useUIElement` options.
         */
        position?: string;
        /**
         * Dominant color hint as seen by the user (CSS name / hex / token).
         * Passthrough from `useUIElement` options.
         */
        color?: string;
        /**
         * Hierarchical semantic path for ranking across duplicate labels.
         * Passthrough from `useUIElement` options.
         */
        contextPath?: string;
        /**
         * The page route this element was registered under (captured from
         * `window.location.pathname` at registration time, or provided
         * explicitly by framework hooks). Matches the keys in
         * `BridgeSnapshot.registration.byRoute`. Undefined in non-DOM
         * environments.
         */
        route?: string;
    }>;
    /** All registered components */
    components: Array<{
        id: string;
        name: string;
        description?: string;
        actions: string[];
        elementIds?: string[];
    }>;
    /** Available workflows */
    workflows: Array<{
        id: string;
        name: string;
        description?: string;
        stepCount: number;
    }>;
    /** Page/route context (populated when a navigationTracker enricher is registered) */
    page?: SnapshotPageContext;
    /** Modal/dialog/popover context (populated when a modalDetector enricher is registered) */
    modalStack?: SnapshotModalContext;
    /** Toast/notification context (populated when a toastCapture enricher is registered) */
    toasts?: SnapshotToastContext;
    /** Element-relationship context (populated when a relationshipTracker enricher is registered) */
    relationships?: SnapshotRelationshipContext;
    /** Drag-and-drop context (populated when a dragDropDetector enricher is registered) */
    dragDrop?: SnapshotDragDropContext;
    /** Undo/redo context (populated when an undoTracker enricher is registered) */
    undoRedo?: SnapshotUndoContext;
    /** Keyboard shortcut context (populated when a shortcutTracker enricher is registered) */
    shortcuts?: SnapshotShortcutContext;
}
/**
 * Canonical enricher slot. Each tracker exposes a `getSnapshot*Context()` method
 * that the registry calls during `createSnapshot`/`createSnapshotAsync`. Slots
 * that take element pairs receive them from the registry — callers don't have
 * to wire that themselves.
 */
interface SnapshotEnrichers {
    navigationTracker?: {
        getSnapshotPageContext(): SnapshotPageContext;
    };
    modalDetector?: {
        getSnapshotModalContext(): SnapshotModalContext;
    };
    toastCapture?: {
        getSnapshotToastContext(): SnapshotToastContext;
    };
    relationshipTracker?: {
        getSnapshotRelationshipContext(elements?: Array<{
            id: string;
            element: Element;
        }>): SnapshotRelationshipContext;
    };
    dragDropDetector?: {
        getSnapshotDragDropContext(elements?: Array<{
            id: string;
            element: Element;
        }>): SnapshotDragDropContext;
    };
    undoTracker?: {
        getSnapshotUndoContext(): SnapshotUndoContext;
    };
    shortcutTracker?: {
        getSnapshotShortcutContext(): SnapshotShortcutContext;
    };
}
/**
 * Pluggable snapshot enricher: receives base context and returns extra fields
 * that get `Object.assign`ed onto the snapshot. Used for ad-hoc/custom trackers
 * (e.g. runner sidebar tabs) without growing the canonical enricher set.
 *
 * `elements` is the live list of registered elements (id + DOM node pairs).
 * `getActiveTab` is the same provider passed to `createSnapshot{,Async}` so
 * enrichers that care about tab state can read it without separate plumbing.
 * `snapshotSoFar` is the in-progress base snapshot — enrichers may inspect it
 * (e.g. read `route` or already-attached canonical fields) but must not mutate
 * it; return new fields instead.
 */
type SnapshotEnricher = (ctx: {
    elements: Array<{
        id: string;
        element: Element;
    }>;
    getActiveTab?: () => string | null | undefined;
    snapshotSoFar: BridgeSnapshot;
}) => Record<string, unknown>;
/**
 * Event types emitted by the bridge
 */
type BridgeEventType = 'element:registered' | 'element:unregistered' | 'element:stateChanged' | 'component:registered' | 'component:unregistered' | 'action:started' | 'action:completed' | 'action:failed' | 'workflow:started' | 'workflow:stepCompleted' | 'workflow:completed' | 'workflow:failed' | 'render:snapshot' | 'error' | 'app:busy' | 'app:idle' | 'network:busy' | 'network:idle' | 'network:requestStart' | 'network:requestEnd' | 'dom:mutating' | 'dom:settled' | 'loading:detected' | 'loading:cleared' | 'form:mutating' | 'form:settled' | 'navigation:change' | 'toast:appeared' | 'toast:dismissed' | 'browser:error' | 'browser:warning' | 'browser:crash' | 'snapshot:changed';
/**
 * Event payload structure
 */
interface BridgeEvent<T = unknown> {
    type: BridgeEventType;
    timestamp: number;
    data: T;
}
/**
 * Event listener function
 */
type BridgeEventListener<T = unknown> = (event: BridgeEvent<T>) => void;
/**
 * UI Bridge feature flags
 */
interface UIBridgeFeatures {
    /** Enable render logging (DOM observation) */
    renderLog?: boolean;
    /** Enable HTTP control endpoints */
    control?: boolean;
    /** Enable debug tools (inspector, metrics) */
    debug?: boolean;
}
/**
 * UI Bridge configuration
 */
interface UIBridgeConfig {
    /** Port for standalone server */
    serverPort?: number;
    /** API path prefix for integrated servers */
    apiPath?: string;
    /** Enable WebSocket for real-time updates */
    websocket?: boolean;
    /** WebSocket port (defaults to serverPort) */
    websocketPort?: number;
    /** Log file path for render logs */
    logFilePath?: string;
    /** Maximum number of render log entries to keep */
    maxLogEntries?: number;
    /** Enable DOM change tracking in render log. Default: true. Disable to reduce memory usage. */
    captureChanges?: boolean;
    /** Enable verbose logging */
    verbose?: boolean;
    /** Application info for discovery */
    appInfo?: {
        appId: string;
        appName: string;
        appType: 'web' | 'desktop' | 'mobile' | 'other';
        framework?: string;
    };
    /** Element-scoped event log configuration (opt-in) */
    elementLog?: ElementEventLogConfig;
}
/**
 * Log level for element-scoped event logging
 */
type ElementLogLevel = 'silent' | 'error' | 'info' | 'debug';
/**
 * A single element-scoped log entry
 */
interface ElementLogEntry {
    /** Unique entry ID */
    id: string;
    /** The element this entry relates to */
    elementId: string;
    /** The bridge event type that produced this entry */
    eventType: BridgeEventType;
    /** Classified log level */
    level: ElementLogLevel;
    /** Timestamp (ms) */
    timestamp: number;
    /** Human-readable summary */
    message: string;
    /** Optional event payload */
    data?: unknown;
}
/**
 * Options for querying element history
 */
interface ElementHistoryOptions {
    /** Filter by event types */
    eventTypes?: BridgeEventType[];
    /** Minimum log level to include */
    minLevel?: ElementLogLevel;
    /** Only entries after this timestamp */
    since?: number;
    /** Maximum number of entries to return */
    limit?: number;
    /** Sort order (default: 'asc') */
    order?: 'asc' | 'desc';
}
/**
 * Configuration for the element event log
 */
interface ElementEventLogConfig {
    /** Maximum entries in the shared ring buffer (default: 2000) */
    maxEntries?: number;
    /** Default log level for elements without an explicit override (default: 'error') */
    defaultLogLevel?: ElementLogLevel;
    /** Enable element event logging (default: false — opt-in) */
    enabled?: boolean;
}
/**
 * Computed property definition
 */
interface ComputedProperty<T = unknown> {
    /** Getter function for the computed value */
    getter: () => T;
    /** Description of what the computed property represents */
    description?: string;
}
/**
 * Response from getting component state
 */
interface ComponentStateResponse {
    /** Current state values */
    state: Record<string, unknown>;
    /** Current computed property values */
    computed: Record<string, unknown>;
    /** Timestamp when the state was captured */
    timestamp: number;
}
/**
 * UI State definition
 *
 * Represents a distinct state in the UI (e.g., "LoginForm", "Dashboard", "Modal").
 * States can be active or inactive, and can block other states from activating.
 */
interface UIState {
    /** Unique state identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Element IDs belonging to this state */
    elements: string[];
    /** Optional function to detect if state is active */
    activeWhen?: () => boolean;
    /** If true, blocks other state activations (modal behavior) */
    blocking?: boolean;
    /** Specific state IDs this state blocks */
    blocks?: string[];
    /** State group membership */
    group?: string;
    /** Cost for pathfinding (default: 1.0) */
    pathCost?: number;
    /** Custom metadata */
    metadata?: Record<string, unknown>;
}
/**
 * State group - states that activate/deactivate atomically
 *
 * When a group is activated, all its states are activated together.
 * When deactivated, all states are deactivated together.
 */
interface UIStateGroup {
    /** Unique group identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** State IDs belonging to this group */
    states: string[];
}
/**
 * State transition definition
 *
 * Defines how to move from one set of states to another,
 * including any actions to execute during the transition.
 */
interface UITransition {
    /** Unique transition identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Precondition: at least one must be active */
    fromStates: string[];
    /** States to activate */
    activateStates: string[];
    /** States to deactivate */
    exitStates: string[];
    /** Groups to activate */
    activateGroups?: string[];
    /** Groups to deactivate */
    exitGroups?: string[];
    /** Actions to execute during transition */
    actions?: WorkflowStep[];
    /** Cost for pathfinding */
    pathCost?: number;
    /** Whether source states remain visible during transition */
    staysVisible?: boolean;
    /** IR-emitted authoring metadata bag — opaque to runtime behavior.
     *
     * Phase 4 / UI Bridge Redesign Section 1: when a `<TransitionTo>` JSX
     * wrapper or `useUITransition` caller passes `effect`, `metadata`, or
     * `provenance`, those values land here under `__ir`. Counterfactual
     * analysis (section 6) and auto-regression generation (section 9) read
     * this bag to gate destructive transitions and feed semantic context.
     *
     * The exact shape of `__ir` is not part of the runtime contract — only
     * the build plugin / IR adapter consumes it. The runtime registry treats
     * the field as opaque and round-trips it untouched.
     */
    metadata?: Record<string, unknown>;
}
/**
 * Path result from pathfinding
 *
 * Returned when searching for a path to target states.
 */
interface PathResult {
    /** Whether a path was found */
    found: boolean;
    /** Transition IDs in order to reach target */
    transitions: string[];
    /** Total cost of the path */
    totalCost: number;
    /** Target state IDs */
    targetStates: string[];
    /** Estimated number of steps */
    estimatedSteps: number;
}
/**
 * Transition execution result
 */
interface TransitionResult {
    /** Whether the transition succeeded */
    success: boolean;
    /** States that were activated */
    activatedStates: string[];
    /** States that were deactivated */
    deactivatedStates: string[];
    /** Error message if failed */
    error?: string;
    /** Phase where failure occurred (if any) */
    failedPhase?: string;
    /** Duration of the transition in milliseconds */
    durationMs: number;
}
/**
 * Navigation result
 *
 * Returned after navigating to target states via pathfinding.
 */
interface NavigationResult {
    /** Whether navigation succeeded */
    success: boolean;
    /** The path that was followed */
    path: PathResult;
    /** Transitions that were executed */
    executedTransitions: string[];
    /** Final active states after navigation */
    finalActiveStates: string[];
    /** Error message if failed */
    error?: string;
    /** Duration of the navigation in milliseconds */
    durationMs: number;
}
/**
 * State manager snapshot
 */
interface StateSnapshot {
    /** Timestamp of the snapshot */
    timestamp: number;
    /** Currently active state IDs */
    activeStates: string[];
    /** All registered states */
    states: UIState[];
    /** All registered state groups */
    groups: UIStateGroup[];
    /** All registered transitions */
    transitions: UITransition[];
}
/**
 * WebSocket message types from client to server
 */
type WSClientMessageType = 'subscribe' | 'unsubscribe' | 'ping' | 'find' | 'discover' | 'getElement' | 'getSnapshot' | 'executeAction' | 'executeComponentAction' | 'executeWorkflow' | 'getElementHistory' | 'changeEvent' | 'recording:start' | 'recording:stop' | 'recording:status' | 'recording:autosave' | 'recording:recover';
/**
 * WebSocket message types from server to client
 */
type WSServerMessageType = 'welcome' | 'pong' | 'subscribed' | 'unsubscribed' | 'event' | 'response' | 'error' | 'workflowProgress';
/**
 * Base WebSocket message structure
 */
interface WSMessageBase {
    /** Unique message ID for request/response correlation */
    id: string;
    /** Message type */
    type: WSClientMessageType | WSServerMessageType;
    /** Timestamp when message was created */
    timestamp: number;
}
/**
 * Client message: Subscribe to events
 */
interface WSSubscribeMessage extends WSMessageBase {
    type: 'subscribe';
    payload: {
        events?: BridgeEventType[];
        elementIds?: string[];
        componentIds?: string[];
    };
}
/**
 * Client message: Unsubscribe from events
 */
interface WSUnsubscribeMessage extends WSMessageBase {
    type: 'unsubscribe';
    payload: {
        events?: BridgeEventType[];
    };
}
/**
 * Client message: Ping (keepalive)
 */
interface WSPingMessage extends WSMessageBase {
    type: 'ping';
}
/**
 * Client message: Find elements
 */
interface WSFindMessage extends WSMessageBase {
    type: 'find';
    payload?: {
        interactiveOnly?: boolean;
        includeState?: boolean;
        selector?: string;
    };
}
/**
 * Client message: Discover elements (deprecated)
 * @deprecated Use WSFindMessage instead
 */
interface WSDiscoverMessage extends WSMessageBase {
    type: 'discover';
    payload?: {
        interactiveOnly?: boolean;
        includeState?: boolean;
        selector?: string;
    };
}
/**
 * Client message: Get element details
 */
interface WSGetElementMessage extends WSMessageBase {
    type: 'getElement';
    payload: {
        elementId: string;
        includeState?: boolean;
    };
}
/**
 * Client message: Get full snapshot
 */
interface WSGetSnapshotMessage extends WSMessageBase {
    type: 'getSnapshot';
}
/**
 * Client message: Execute action on element
 */
interface WSExecuteActionMessage extends WSMessageBase {
    type: 'executeAction';
    payload: {
        elementId: string;
        action: {
            action: string;
            params?: Record<string, unknown>;
            waitOptions?: WaitOptions;
        };
    };
}
/**
 * Client message: Execute component action
 */
interface WSExecuteComponentActionMessage extends WSMessageBase {
    type: 'executeComponentAction';
    payload: {
        componentId: string;
        action: string;
        params?: Record<string, unknown>;
    };
}
/**
 * Client message: Execute workflow
 */
interface WSExecuteWorkflowMessage extends WSMessageBase {
    type: 'executeWorkflow';
    payload: {
        workflowId: string;
        params?: Record<string, unknown>;
        streamProgress?: boolean;
    };
}
/**
 * Client message: Get element history from the element event log
 */
interface WSGetElementHistoryMessage extends WSMessageBase {
    type: 'getElementHistory';
    payload: {
        elementId: string;
        options?: ElementHistoryOptions;
    };
}
/**
 * Client message: Push-based change event from browser tab
 */
interface WSChangeEventMessage extends WSMessageBase {
    type: 'changeEvent';
    payload: {
        added?: string[];
        removed?: string[];
        modified?: string[];
    };
}
/**
 * Union type for all client messages
 */
/** Recording: Start recording session */
interface WSRecordingStartMessage extends WSMessageBase {
    type: 'recording:start';
    payload?: {
        config?: {
            debounceMs?: number;
            maxCaptures?: number;
            filterUnregistered?: boolean;
            keystrokeCoalesceMs?: number;
            autoSaveIntervalMs?: number;
        };
    };
}
/** Recording: Stop recording session */
interface WSRecordingStopMessage extends WSMessageBase {
    type: 'recording:stop';
}
/** Recording: Get recording status */
interface WSRecordingStatusMessage extends WSMessageBase {
    type: 'recording:status';
}
/** Recording: Auto-save partial export data for crash recovery */
interface WSRecordingAutoSaveMessage extends WSMessageBase {
    type: 'recording:autosave';
    payload?: {
        exportData?: CooccurrenceExportData;
    };
}
/** Recording: Recover last auto-saved export data */
interface WSRecordingRecoverMessage extends WSMessageBase {
    type: 'recording:recover';
}
type WSClientMessage = WSSubscribeMessage | WSUnsubscribeMessage | WSPingMessage | WSFindMessage | WSDiscoverMessage | WSGetElementMessage | WSGetSnapshotMessage | WSExecuteActionMessage | WSExecuteComponentActionMessage | WSExecuteWorkflowMessage | WSGetElementHistoryMessage | WSChangeEventMessage | WSRecordingStartMessage | WSRecordingStopMessage | WSRecordingStatusMessage | WSRecordingAutoSaveMessage | WSRecordingRecoverMessage;
/**
 * Server message: Welcome (sent on connection)
 */
interface WSWelcomeMessage extends WSMessageBase {
    type: 'welcome';
    payload: {
        version: string;
        features: UIBridgeFeatures;
        clientId: string;
    };
}
/**
 * Server message: Pong (response to ping)
 */
interface WSPongMessage extends WSMessageBase {
    type: 'pong';
}
/**
 * Server message: Subscription confirmed
 */
interface WSSubscribedMessage extends WSMessageBase {
    type: 'subscribed';
    payload: {
        events: BridgeEventType[];
    };
}
/**
 * Server message: Unsubscription confirmed
 */
interface WSUnsubscribedMessage extends WSMessageBase {
    type: 'unsubscribed';
    payload: {
        events: BridgeEventType[];
    };
}
/**
 * Server message: Event notification
 */
interface WSEventMessage extends WSMessageBase {
    type: 'event';
    payload: BridgeEvent;
}
/**
 * Server message: Response to a request
 */
interface WSResponseMessage<T = unknown> extends WSMessageBase {
    type: 'response';
    requestId: string;
    payload: {
        success: boolean;
        data?: T;
        error?: string;
    };
}
/**
 * Server message: Error
 */
interface WSErrorMessage extends WSMessageBase {
    type: 'error';
    requestId?: string;
    payload: {
        code: string;
        message: string;
        details?: unknown;
    };
}
/**
 * Server message: Workflow progress update
 */
interface WSWorkflowProgressMessage extends WSMessageBase {
    type: 'workflowProgress';
    requestId: string;
    payload: {
        workflowId: string;
        currentStep: number;
        totalSteps: number;
        step: {
            id: string;
            type: string;
            status: 'pending' | 'running' | 'completed' | 'failed';
        };
        stepResult?: unknown;
        error?: string;
    };
}
/**
 * Union type for all server messages
 */
type WSServerMessage = WSWelcomeMessage | WSPongMessage | WSSubscribedMessage | WSUnsubscribedMessage | WSEventMessage | WSResponseMessage | WSErrorMessage | WSWorkflowProgressMessage;
/**
 * WebSocket connection state
 */
type WSConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
/**
 * WebSocket client configuration
 */
interface WSClientConfig {
    /** WebSocket server URL */
    url: string;
    /** Auto-reconnect on disconnect */
    autoReconnect?: boolean;
    /** Reconnect delay in milliseconds */
    reconnectDelay?: number;
    /** Maximum reconnect attempts (0 = infinite) */
    maxReconnectAttempts?: number;
    /** Ping interval in milliseconds (0 = disabled) */
    pingInterval?: number;
    /** Connection timeout in milliseconds */
    connectionTimeout?: number;
}
/**
 * Subscription options for WebSocket client
 */
interface WSSubscriptionOptions {
    /** Event types to subscribe to */
    events?: BridgeEventType[];
    /** Filter by element IDs */
    elementIds?: string[];
    /** Filter by component IDs */
    componentIds?: string[];
}
/**
 * ARIA checked state (can be boolean or 'mixed' for indeterminate)
 */
type AriaCheckedState = boolean | 'mixed';
/**
 * Extended computed styles for design review (~40 design-relevant CSS properties).
 * Separate from ElementState.computedStyles to keep normal snapshots lightweight.
 */
interface ExtendedComputedStyles {
    display: string;
    position: string;
    boxSizing: string;
    width: string;
    height: string;
    minWidth: string;
    maxWidth: string;
    minHeight: string;
    maxHeight: string;
    margin: string;
    marginTop: string;
    marginRight: string;
    marginBottom: string;
    marginLeft: string;
    padding: string;
    paddingTop: string;
    paddingRight: string;
    paddingBottom: string;
    paddingLeft: string;
    overflow: string;
    overflowX: string;
    overflowY: string;
    flexDirection: string;
    flexWrap: string;
    justifyContent: string;
    alignItems: string;
    alignSelf: string;
    gap: string;
    gridTemplateColumns: string;
    gridTemplateRows: string;
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    textAlign: string;
    textTransform: string;
    textDecoration: string;
    color: string;
    backgroundColor: string;
    backgroundImage: string;
    border: string;
    borderRadius: string;
    boxShadow: string;
    opacity: string;
    outline: string;
    transform: string;
    transition: string;
    cursor: string;
    zIndex: string;
    visibility: string;
    pointerEvents: string;
}
/**
 * Interaction state name for state variation capture
 */
type InteractionStateName = 'default' | 'hover' | 'focus' | 'active' | 'disabled';
/**
 * Style diff entry: a property that changed from default state
 */
interface StyleDiff {
    property: string;
    defaultValue: string;
    stateValue: string;
}
/**
 * Styles captured in a specific interaction state
 */
interface StateStyles {
    state: InteractionStateName;
    styles: ExtendedComputedStyles;
    diffFromDefault: StyleDiff[];
}
/**
 * Pseudo-element computed styles
 */
interface PseudoElementStyles {
    selector: '::before' | '::after';
    content: string;
    styles: Partial<ExtendedComputedStyles>;
}
/**
 * Full design data for a single element
 */
interface ElementDesignData {
    elementId: string;
    label?: string;
    type: string;
    styles: ExtendedComputedStyles;
    stateVariations?: StateStyles[];
    pseudoElements?: PseudoElementStyles[];
    customProperties?: Record<string, string>;
    className?: string;
    classes?: string[];
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
/**
 * Design snapshot at a specific viewport width
 */
interface ResponsiveSnapshot {
    viewportWidth: number;
    viewportLabel?: string;
    elements: ElementDesignData[];
    timestamp: number;
}
/**
 * Accessibility information for a UI element
 */
interface ElementAccessibility {
    /** The element's computed role (explicit or implicit) */
    role: string;
    /** Computed accessible name following ARIA name computation */
    accessibleName?: string;
    /** Computed accessible description */
    accessibleDescription?: string;
    /** Value of aria-label attribute */
    ariaLabel?: string;
    /** Value of aria-labelledby attribute */
    ariaLabelledBy?: string;
    /** Value of aria-describedby attribute */
    ariaDescribedBy?: string;
    /** Whether element is expanded (for expandable elements) */
    ariaExpanded?: boolean;
    /** Whether element is selected (for selectable elements) */
    ariaSelected?: boolean;
    /** Checked state (for checkboxes, can be true/false/'mixed') */
    ariaChecked?: AriaCheckedState;
    /** Whether element is hidden from accessibility tree */
    ariaHidden?: boolean;
    /** Whether element is disabled via aria-disabled */
    ariaDisabled?: boolean;
    /** Whether element is required (for form inputs) */
    ariaRequired?: boolean;
    /** Current aria-live value for live regions */
    ariaLive?: 'off' | 'polite' | 'assertive';
    /** Tab index value */
    tabIndex: number;
    /** Whether element is in the tab order (tabindex >= 0 or naturally focusable) */
    isInTabOrder: boolean;
    /** Whether element can receive keyboard focus */
    isKeyboardAccessible: boolean;
    /** The implicit role based on element type (before explicit role override) */
    implicitRole?: string;
    /** Whether element has an explicit role attribute */
    hasExplicitRole: boolean;
}
/**
 * WCAG conformance level
 */
type WCAGLevel = 'A' | 'AA' | 'AAA';
/**
 * Accessibility issue severity
 */
type AccessibilitySeverity = 'critical' | 'serious' | 'moderate' | 'minor';
/**
 * An accessibility issue found during validation
 */
interface AccessibilityIssue {
    /** Unique identifier for this issue instance */
    id: string;
    /** The WCAG success criterion this issue relates to (e.g., "4.1.2") */
    wcagCriterion: string;
    /** How severe this issue is */
    severity: AccessibilitySeverity;
    /** WCAG conformance level this criterion belongs to */
    level: WCAGLevel;
    /** Human-readable description of the issue */
    message: string;
    /** ID of the element with the issue */
    elementId: string;
    /** Selector to find the element */
    elementSelector?: string;
    /** Suggested fix for the issue */
    suggestion: string;
    /** The rule ID that detected this issue */
    ruleId: string;
}

interface AccessibilityReport {
    /** When the validation was performed */
    timestamp: number;
    /** URL of the page that was validated */
    url: string;
    /** Number of elements that were scanned */
    elementsScanned: number;
    /** All issues found during validation */
    issues: AccessibilityIssue[];
    /** Number of checks that passed */
    passedCount: number;
    /** Number of checks that failed */
    failedCount: number;
    /** Whether the page meets WCAG 2.1 Level A */
    meetsWCAG_A: boolean;
    /** Whether the page meets WCAG 2.1 Level AA */
    meetsWCAG_AA: boolean;
    /** Human-readable summary of the validation */
    summary: string;
    /** Duration of the validation in milliseconds */
    durationMs: number;
}

export { type StructuredChangeAnalysis as $, type ActionRequest as A, type BridgeEventType as B, type ControlActionResponse as C, type DetectedErrorOverlay as D, type ErrorSeverity as E, type FillFormRequest as F, type SearchCriteria as G, type SearchResponse as H, type NLActionRequest as I, type NLActionResponse as J, type AssertionRequest as K, type AssertionResult as L, type BatchAssertionRequest as M, type NavigationResult as N, type BatchAssertionResult as O, type PathResult as P, type SemanticSnapshot as Q, type SemanticDiff as R, type StateSnapshot as S, type TransitionResult as T, type UIState as U, type ActionWithDiffRequest as V, type WSClientConfig as W, type ActionDiffResult as X, type ChangePredicate as Y, type WaitForChangeOptions as Z, type CategorizedDiff as _, type WSConnectionState as a, type AIElementRegistrationOptions as a$, type ChangeBufferDrainResult as a0, type SnapshotBookmark as a1, type SemanticSearchCriteria as a2, type SemanticSearchResponse as a3, type IntentExecutionResult as a4, type IntentSearchResponse as a5, type Intent as a6, type RecoveryAttemptRequest as a7, type RecoveryAttemptResult as a8, type PageDataMap as a9, type NavigationEventData as aA, type PageInfo as aB, type PageNavigationEntry as aC, type SnapshotPageContext as aD, type RouteInfo as aE, type DeveloperPageContext as aF, type NavigationCompleteData as aG, type ShortcutTrackerOptions as aH, type KeyboardShortcut as aI, type SnapshotShortcutContext as aJ, type ModalDetectorConfig as aK, type ModalStack as aL, type SnapshotModalContext as aM, type ModalInfo as aN, type ToastCaptureConfig as aO, type ToastEventData as aP, type ToastSnapshot as aQ, type SnapshotToastContext as aR, type CapturedToast as aS, type RelationshipType as aT, type ElementRelationship as aU, type SnapshotRelationshipContext as aV, type DragSourceInfo as aW, type DropZoneInfo as aX, type SnapshotDragDropContext as aY, type UndoElementInfo as aZ, type UndoDetectorConfig as a_, type PageRegionMap as aa, type StructuredDataExtraction as ab, type ComponentInfo as ac, type CrossAppComparisonReport as ad, type PageNavigationResponse as ae, type PageNavigateRequest as af, type ElementDesignData as ag, type InteractionStateName as ah, type StateStyles as ai, type ResponsiveSnapshot as aj, type FormsResponse as ak, type UndoRedoState as al, type DiscoveredElement as am, type AIDiscoveredElement as an, type AssertionType as ao, type BrowserCaptureConfig as ap, type OnBrowserEventCallback as aq, UIBridgeRegistry as ar, type RegisteredElement as as, type ElementState as at, type SearchResult as au, type FormState as av, type UndoTrackerConfig as aw, type DeclaredUndoState as ax, type SnapshotUndoContext as ay, type NavigationTrackerOptions as az, type WSSubscriptionOptions as b, type ElementAssertionResult as b$, type AIErrorContext as b0, type AIFindResponse as b1, type AccessibilityIssue as b2, type AccessibilityReport as b3, type AccessibilitySeverity as b4, type ActionBrowserEvent as b5, type ActionChanges as b6, type ActionErrorCode as b7, type ActionErrorDiff as b8, type ActionExecutor as b9, type ContentChanges as bA, type ContentComparison as bB, type ContentMetadata as bC, type ContentRole as bD, type ContentType as bE, type ControlBatchResponse as bF, type ControlBatchStep as bG, type ControlBatchStepResult as bH, type CrossAppDiff as bI, type CrossAppMetricChange as bJ, type CrossAppStatusChange as bK, type CustomAction as bL, DEFAULT_CAPTURE_CONFIG as bM, DEFAULT_NOISE_PATTERNS as bN, DEFAULT_REMOUNT_CACHE_WINDOW_MS as bO, type DataType as bP, type DataValueComparison as bQ, type DensityComparison as bR, type DiffSummaryOptions as bS, type DiscoveryRequest as bT, type DiscoveryResponse as bU, type DomMetricsCapturedEvent as bV, type DragAction as bW, type DragDropOrigin as bX, type DragEffect as bY, type ElementAccessibility as bZ, type ElementAssertionFailure as b_, type ActionFailureDetails as ba, type ActionHandler as bb, type AggregatedErrors as bc, type AriaCheckedState as bd, type AutocompleteAction as be, type BatchActionStep as bf, type BatchActionStepResult as bg, type BranchCondition as bh, type BridgeEventListener as bi, type BrowserCapturedEvent as bj, type BufferEntry as bk, type BufferedChange as bl, type BufferedRouteChange as bm, type ChangeCategory as bn, type ChangeTimeline as bo, type ClassifiedEvent as bp, type CompactElement as bq, type CompactModal as br, type CompactToast as bs, type ComparisonIssue as bt, type ComponentAction as bu, type ComponentComparison as bv, type ComponentMatch as bw, type ComponentStateResponse as bx, type ComputedProperty as by, type ConsoleCapturedEvent as bz, type BridgeSnapshot as c, type PageRegion as c$, type ElementAssertionSpec as c0, type ElementBbox as c1, type ElementChange as c2, ElementEventLog as c3, type ElementEventLogConfig as c4, type ElementFieldChange as c5, type ElementFingerprintData as c6, type ElementIdentifier as c7, type ElementLogLevel as c8, type ElementModification as c9, type IntentParam as cA, type InteractionParity as cB, type KeyboardAction as cC, type LayoutComparison as cD, type ListChangeAnalysis as cE, type ListItemField as cF, type ListSchema as cG, type LoadingState as cH, type LogConfig as cI, type LongTaskCapturedEvent as cJ, type LoopConfig as cK, type MatchedElementPair as cL, type MediaMetadata as cM, type MediaType as cN, type MemoryCapturedEvent as cO, type MetricChange as cP, type MetricMatch as cQ, type ModalState as cR, type MouseAction as cS, type NavigationCapturedEvent as cT, type NavigationMap as cU, type NavigationPair as cV, type NavigationTrigger as cW, type NetworkCapturedEvent as cX, type NormalizedRect as cY, type OnCaptureCallback as cZ, type PageContext as c_, type ElementType as ca, type ErrorImpact as cb, ErrorImpactAssessor as cc, type ErrorImpactConfig as cd, type ExtendedComputedStyles as ce, type ExtendedWorkflowStep as cf, type ExtractConfig as cg, type ExtractedDataValue as ch, type FallbackScreenshot as ci, type FillAction as cj, type FillFieldResult as ck, type FormAnalysis as cl, type FormFieldAnalysis as cm, type FormFieldState as cn, type FormatDescriptor as co, type FormatMismatch as cp, type FreezeCapturedEvent as cq, type GridDiff as cr, type GridStructure as cs, type GroupedElements as ct, type HeadingChange as cu, type HeadingLevelComparison as cv, type HeadingMatch as cw, type HierarchyDiff as cx, type HmrCapturedEvent as cy, type InlineRelationship as cz, type ActionResponse as d, type WSGetElementMessage as d$, type ParsedAction as d0, type PartialMatch as d1, type PseudoElementStyles as d2, type ReactErrorCapturedEvent as d3, type ReactStateInfo as d4, type RecoveryAction as d5, type RecoverySuggestion as d6, type RegionType as d7, type RegisteredComponent as d8, type RelationshipOrigin as d9, type TableChangeAnalysis as dA, type TableColumn as dB, type TableComparison as dC, type TableSchema as dD, type TextChange as dE, type TimelineEvent as dF, type ToastLevel as dG, type TypeAction as dH, type UIBridgeFeatures as dI, type UIConsequences as dJ, type UIStateSnapshot as dK, type UndoDetectionSource as dL, type UndoEntry as dM, type UseDragSourceOptions as dN, type UseDropZoneOptions as dO, type UseUIRelationshipOptions as dP, type WCAGLevel as dQ, type WSChangeEventMessage as dR, type WSClientMessageType as dS, type WSDiscoverMessage as dT, type WSErrorMessage as dU, type WSEventMessage as dV, type WSExecuteActionMessage as dW, type WSExecuteComponentActionMessage as dX, type WSExecuteWorkflowMessage as dY, type WSFindMessage as dZ, type WSGetElementHistoryMessage as d_, type RepeatPatternData as da, type ResourceErrorCapturedEvent as db, SEVERITY_RANK as dc, type ScreenAnalysis as dd, type ScrollAction as de, type ScrollIntoViewAction as df, type ScrollLogicalPosition as dg, type SelectAction as dh, type SemanticSearchResult as di, type SendKeysAction as dj, type ServerBatchOperation as dk, type ServerBatchOperationResult as dl, type ServerBatchOptions as dm, type ServerBatchResponse as dn, type ShortcutSource as dp, type SnapshotEnricher as dq, type SnapshotEnrichers as dr, type SnapshotErrorSummary as ds, type SnapshotRegistrationMetadata as dt, type SnapshotViewportContext as du, type StandardAction as dv, type StateGetter as dw, type StatusChange as dx, type StatusMatch as dy, type StyleDiff as dz, type BridgeEvent as e, type WSGetSnapshotMessage as e0, type WSMessageBase as e1, type WSPingMessage as e2, type WSPongMessage as e3, type WSRecordingAutoSaveMessage as e4, type WSRecordingRecoverMessage as e5, type WSRecordingStartMessage as e6, type WSRecordingStatusMessage as e7, type WSRecordingStopMessage as e8, type WSResponseMessage as e9, getActiveOverlays as eA, getGlobalRegistry as eB, installFrameworkOverlayCapture as eC, serializeRegisteredElement as eD, type WSServerMessage as ea, type WSServerMessageType as eb, type WSSubscribeMessage as ec, type WSSubscribedMessage as ed, type WSUnsubscribeMessage as ee, type WSUnsubscribedMessage as ef, type WSWelcomeMessage as eg, type WSWorkflowProgressMessage as eh, type WaitForNavigationParams as ei, type WaitForNavigationResult as ej, type WaitOptions as ek, type WaitResult as el, type WebVitalCapturedEvent as em, type Workflow as en, type WorkflowEngine as eo, type WorkflowRunStatus as ep, type WorkflowStep as eq, type WorkflowStepType as er, type WsDisconnectionCapturedEvent as es, classifyEvent as et, classifyEvents as eu, computeAllFingerprints as ev, computeElementFingerprint as ew, computeFingerprintsWithMapping as ex, filterBySeverity as ey, findNearestRegisteredElement as ez, type WSClientMessage as f, type ComponentActionResponse as g, type WorkflowStepResult as h, type AnyCapturedEvent as i, type FillResult as j, type BatchActionRequest as k, type BatchActionResponse as l, type CapturedError as m, type BrowserEventType as n, type ControlSnapshot as o, type UIStateGroup as p, type UITransition as q, type ElementHistoryOptions as r, type ElementLogEntry as s, type UIBridgeConfig as t, type ControlActionRequest as u, type ComponentActionRequest as v, type FindRequest as w, type FindResponse as x, type WorkflowRunRequest as y, type WorkflowRunResponse as z };
