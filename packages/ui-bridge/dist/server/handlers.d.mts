import { S as SpecStore } from '../store-_iavlVNP.mjs';
import { F as FillFormRequest, j as FillResult, k as BatchActionRequest, l as BatchActionResponse, m as CapturedError, i as AnyCapturedEvent, n as BrowserEventType, D as DetectedErrorOverlay, e as BridgeEvent, o as ControlSnapshot, U as UIState, p as UIStateGroup, q as UITransition, T as TransitionResult, P as PathResult, N as NavigationResult, S as StateSnapshot, r as ElementHistoryOptions, s as ElementLogEntry, B as BridgeEventType } from '../types-svkOxfrJ.mjs';
import { a as UIBridgeServerHandlers } from '../types-h-6suk8E.mjs';
import { C as CompositeIdleConfig } from '../types-CNyrSSSQ.mjs';
import { N as NavigationAdapter } from '../navigation-adapter-D0eod-Ve.mjs';
import { RenderLogEntry } from '../render-log/index.mjs';
import { N as NavigationTracker, S as ShortcutTracker, M as ModalDetector, T as ToastCapture, R as RelationshipTracker, D as DragDropDetector, U as UndoTracker } from '../drag-drop-detector-D_geRFOe.mjs';
import { AnnotationStore } from '../annotations/index.mjs';
import { N as NetworkTrackerConfig } from '../tracker-DpZSyunJ.mjs';
import '../types-BmKY7boF.mjs';
import '../find-CHUFcAzn.mjs';
import '../style-types-CSsr7rsk.mjs';
import '../types-C7D5seeQ.mjs';
import '../error-snapshot-DlaqDYcU.mjs';

/**
 * Registry interface - minimal contract for handler usage
 */
interface RegistryLike {
    getAllElements(): unknown[];
    getElement(id: string): unknown | undefined;
    getAllComponents(): unknown[];
    getComponent(id: string): unknown | undefined;
    getComponentState?(id: string): {
        state: Record<string, unknown>;
        computed: Record<string, unknown>;
        timestamp: number;
    } | null;
    createSnapshot(): ControlSnapshot;
    getRenderLog?(): RenderLogEntry[];
    clearRenderLog?(): void;
    captureSnapshot?(): unknown;
    findElements?(request?: unknown): unknown[];
    getAllWorkflows?(): unknown[];
    getWorkflow?(id: string): unknown;
    getActionHistory?(): unknown[];
    getMetrics?(): unknown;
    highlightElement?(id: string): void;
    getElementTree?(): unknown;
    getStates?(): UIState[];
    getState?(id: string): UIState | undefined;
    getActiveStates?(): UIState[];
    activateState?(id: string): void;
    deactivateState?(id: string): void;
    getStateGroups?(): UIStateGroup[];
    activateStateGroup?(id: string): void;
    deactivateStateGroup?(id: string): void;
    getTransitions?(): UITransition[];
    canExecuteTransition?(id: string): {
        canExecute: boolean;
        reason?: string;
    };
    executeTransition?(id: string): Promise<TransitionResult>;
    findPath?(targetStates: string[]): PathResult;
    navigateTo?(targetStates: string[]): Promise<NavigationResult>;
    getStateSnapshot?(): StateSnapshot;
    getElementHistory?(elementId: string, options?: ElementHistoryOptions): ElementLogEntry[];
    on?<T = unknown>(type: BridgeEventType, listener: (event: BridgeEvent<T>) => void): () => void;
}
/**
 * Action executor interface - minimal contract for handler usage
 */
interface ActionExecutorLike {
    executeAction(elementId: string, request: {
        action: string;
        params?: Record<string, unknown>;
        waitOptions?: unknown;
    }): Promise<unknown>;
    executeComponentAction(componentId: string, request: {
        action: string;
        params?: Record<string, unknown>;
    }): Promise<unknown>;
    fillForm?(request: FillFormRequest): Promise<FillResult>;
    executeBatch?(request: BatchActionRequest): Promise<BatchActionResponse>;
}
/**
 * Console capture interface — minimal contract for handler usage
 * @deprecated Use BrowserEventCaptureLike instead
 */
interface ConsoleCapturelike {
    getConsoleSince(ts: number): CapturedError[];
    getConsoleRecent(n?: number): CapturedError[];
    clear(): void;
}
/**
 * Browser event capture interface — full contract for handler usage.
 * Extends the legacy ConsoleCapturelike with full event query methods.
 */
interface BrowserEventCaptureLike extends ConsoleCapturelike {
    getSince(ts: number): AnyCapturedEvent[];
    getRecent(n?: number): AnyCapturedEvent[];
    getByType(type: BrowserEventType): AnyCapturedEvent[];
    getFrameworkOverlays?(): DetectedErrorOverlay[];
}
/**
 * Configuration for creating handlers
 */
interface CreateHandlersConfig {
    /** Optional render log path */
    renderLogPath?: string;
    /** Verbose logging */
    verbose?: boolean;
    /** Optional annotation store (defaults to global singleton) */
    annotationStore?: AnnotationStore;
    /**
     * Browser event capture instance for error/event monitoring.
     * Accepts either the full BrowserEventCaptureLike or the legacy ConsoleCapturelike.
     */
    consoleCapture?: BrowserEventCaptureLike | ConsoleCapturelike;
    /** Navigation tracker instance for page/route awareness in snapshots */
    navigationTracker?: NavigationTracker;
    /** Shortcut tracker instance for keyboard shortcut discovery in snapshots */
    shortcutTracker?: ShortcutTracker;
    /** Modal detector instance for modal/dialog stack detection in snapshots */
    modalDetector?: ModalDetector;
    /** Toast capture instance for toast/notification detection in snapshots */
    toastCapture?: ToastCapture;
    /** Relationship tracker instance for element relationship hints in snapshots */
    relationshipTracker?: RelationshipTracker;
    /** Drag-drop detector instance for drag source and drop zone discovery in snapshots */
    dragDropDetector?: DragDropDetector;
    /** Undo tracker instance for undo/redo awareness in snapshots */
    undoTracker?: UndoTracker;
    /** Spec store instance for serving loaded specs (defaults to global singleton) */
    specStore?: SpecStore;
    /** Idle detection configuration. Set to false to disable. */
    idleDetection?: CompositeIdleConfig | false;
    /**
     * Callback for idle detection events (app:busy, network:idle, etc.).
     * Wire this to UIBridgeWSHandler.broadcastEvent() to push idle events to WebSocket clients.
     */
    onIdleEvent?: (event: BridgeEvent) => void;
    /**
     * Callback for browser error/warning events.
     * Wire this to UIBridgeWSHandler.broadcastEvent() to push error events to WebSocket clients.
     * Events are classified by severity before being emitted.
     */
    onBrowserEvent?: (event: BridgeEvent) => void;
    /**
     * Network request monitoring configuration.
     * Set to `false` to disable, or provide a `NetworkTrackerConfig` object.
     * Defaults to enabled with default settings.
     */
    networkMonitoring?: NetworkTrackerConfig | false;
    /**
     * Callback for push-based change observation events (snapshot:changed).
     * Wire this to SSEManager.broadcast() and/or UIBridgeWSHandler.broadcastEvent()
     * to push change events to connected clients.
     */
    onChangeEvent?: (event: BridgeEvent) => void;
    /**
     * Navigation adapter for app-agnostic page navigation.
     * If not provided, falls back to window.location navigation.
     */
    navigationAdapter?: NavigationAdapter;
}
/**
 * Check if the app is responsive based on heartbeat freshness.
 */
declare function isAppResponsive(): boolean;
/**
 * Get the last heartbeat timestamp.
 */
declare function getLastHeartbeat(): number;
declare function createHandlers(registry: RegistryLike, actionExecutor: ActionExecutorLike, config?: CreateHandlersConfig): UIBridgeServerHandlers;
/**
 * Create partial handlers for AI-specific functionality only
 *
 * Use this when you want to add AI endpoints to an existing handler setup.
 */
declare function createAIHandlers(registry: RegistryLike, actionExecutor: ActionExecutorLike): Pick<UIBridgeServerHandlers, 'aiSearch' | 'aiFind' | 'aiExecute' | 'aiAssert' | 'aiAssertBatch' | 'getSemanticSnapshot' | 'getSemanticDiff' | 'getPageSummary'>;

export { type ActionExecutorLike, type BrowserEventCaptureLike, type ConsoleCapturelike, type CreateHandlersConfig, type RegistryLike, createAIHandlers, createHandlers, getLastHeartbeat, isAppResponsive };
