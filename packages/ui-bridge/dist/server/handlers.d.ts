import { S as SpecStore } from '../store-DQEgutyN.js';
import { F as FillFormRequest, j as FillResult, k as BatchActionRequest, l as BatchActionResponse, m as CapturedError, i as AnyCapturedEvent, n as BrowserEventType, D as DetectedErrorOverlay, e as BridgeEvent, o as ControlSnapshot, U as UIState, p as UIStateGroup, q as UITransition, T as TransitionResult, P as PathResult, N as NavigationResult, S as StateSnapshot, r as ElementHistoryOptions, s as ElementLogEntry, B as BridgeEventType } from '../types-gR41i0Eb.js';
import { a as UIBridgeServerHandlers } from '../types-IusLW_V8.js';
import { C as CompositeIdleConfig } from '../types-BFG8zj15.js';
import { N as NavigationAdapter } from '../navigation-adapter-D0eod-Ve.js';
import { RenderLogEntry } from '../render-log/index.js';
import { N as NavigationTracker, S as ShortcutTracker, M as ModalDetector, T as ToastCapture, R as RelationshipTracker, D as DragDropDetector, U as UndoTracker } from '../drag-drop-detector-yIMjB3n1.js';
import { AnnotationStore } from '../annotations/index.js';
import { N as NetworkTrackerConfig } from '../tracker-DpZSyunJ.js';
import '../types-BmCNUYVv.js';
import '../find-BPQslSWH.js';
import '../style-types-Chrc4Cjm.js';
import '../types-C7D5seeQ.js';
import '../error-snapshot-Ce_OGouq.js';

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
    /**
     * Navigation tracker instance for page/route awareness in snapshots.
     * @deprecated For snapshot enrichment, the registry's `setEnrichers({ navigationTracker })`
     * is now the source of truth — `<UIBridgeProvider>` wires it automatically.
     * This field is retained only because some callers still pass it, and because
     * `modalDetector` / `undoTracker` etc. remain required for non-snapshot paths.
     */
    navigationTracker?: NavigationTracker;
    /**
     * Shortcut tracker instance for keyboard shortcut discovery in snapshots.
     * @deprecated For snapshot enrichment, the registry's `setEnrichers({ shortcutTracker })`
     * is now the source of truth.
     */
    shortcutTracker?: ShortcutTracker;
    /**
     * Modal detector instance for modal/dialog stack detection in snapshots.
     * @deprecated For snapshot enrichment, the registry's `setEnrichers({ modalDetector })`
     * is now the source of truth. Still consumed by non-snapshot code paths
     * (e.g. action-executor modal scoping).
     */
    modalDetector?: ModalDetector;
    /**
     * Toast capture instance for toast/notification detection in snapshots.
     * @deprecated For snapshot enrichment, the registry's `setEnrichers({ toastCapture })`
     * is now the source of truth.
     */
    toastCapture?: ToastCapture;
    /**
     * Relationship tracker instance for element relationship hints in snapshots.
     * @deprecated For snapshot enrichment, the registry's `setEnrichers({ relationshipTracker })`
     * is now the source of truth.
     */
    relationshipTracker?: RelationshipTracker;
    /**
     * Drag-drop detector instance for drag source and drop zone discovery in snapshots.
     * @deprecated For snapshot enrichment, the registry's `setEnrichers({ dragDropDetector })`
     * is now the source of truth.
     */
    dragDropDetector?: DragDropDetector;
    /**
     * Undo tracker instance for undo/redo awareness in snapshots.
     * @deprecated For snapshot enrichment, the registry's `setEnrichers({ undoTracker })`
     * is now the source of truth. Still REQUIRED for non-snapshot paths:
     * `recordAction` (action history) and `/control/undo` / `/control/redo`.
     */
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
    /**
     * Phase 4.1 (plan 2026-05-03) — enable POST /control/sdk/spawn-headless.
     *
     * When `true`, the spawn-headless handler dynamically imports
     * `@qontinui/ui-bridge-headless` (an optional peer) and launches a real
     * Chromium tab. When omitted/`false`, the route exists but returns 503.
     *
     * Precedence (highest first):
     *   1. Explicit `true` here → enabled.
     *   2. Environment: `ENABLE_HEADLESS_SPAWN=1` or `=true` → enabled.
     *   3. Default → disabled.
     *
     * Disabled by default because the in-process Playwright launcher pulls
     * in Chromium (~300 MB download) and a server-controlled headless browser
     * has security implications outside dev environments.
     */
    enableHeadlessSpawn?: boolean;
}
/**
 * Build the enriched "Component not found" error message used by every
 * component-detail / component-action 404 site (Phase 1.1, plan 2026-05-03).
 *
 * Output format:
 *   `Component "{id}" not found{otherRouteHint}. Available components: [...]. ` +
 *   `Components are only available when their page is active — navigate to ` +
 *   `the page that contains this component and try again.`
 *
 * `otherRouteHint` is appended only when `byRoute` (Phase 1.2 shape, with
 * per-route `ids`) shows the missing id is registered on a different route.
 * Falls back to no hint when `byRoute` / `currentRoute` are absent or the
 * id genuinely doesn't exist anywhere — callers don't have to special-case
 * the missing-snapshot scenario.
 */
declare function buildComponentNotFoundError(id: string, available: readonly string[], byRoute?: Record<string, {
    count: number;
    ids: string[];
}>, currentRoute?: string | null): string;
/**
 * Check if the app is responsive based on heartbeat freshness.
 */
declare function isAppResponsive(): boolean;
/**
 * Get the last heartbeat timestamp.
 */
declare function getLastHeartbeat(): number;
/**
 * Close every spawned headless tab tracked across all `createHandlers()`
 * instances. Exported so callers (e.g. CLI servers, integration tests) can
 * trigger the same teardown the `beforeExit` listener would, on signal
 * handlers or `server.stop()` paths where `beforeExit` won't fire.
 */
declare function closeAllSpawnedHeadlessTabs(): Promise<void>;
declare function createHandlers(registry: RegistryLike, actionExecutor: ActionExecutorLike, config?: CreateHandlersConfig): UIBridgeServerHandlers;
/**
 * Create partial handlers for AI-specific functionality only
 *
 * Use this when you want to add AI endpoints to an existing handler setup.
 */
declare function createAIHandlers(registry: RegistryLike, actionExecutor: ActionExecutorLike): Pick<UIBridgeServerHandlers, 'aiSearch' | 'aiFind' | 'aiExecute' | 'aiAssert' | 'aiAssertBatch' | 'getSemanticSnapshot' | 'getSemanticDiff' | 'getPageSummary'>;

export { type ActionExecutorLike, type BrowserEventCaptureLike, type ConsoleCapturelike, type CreateHandlersConfig, type RegistryLike, buildComponentNotFoundError, closeAllSpawnedHeadlessTabs, createAIHandlers, createHandlers, getLastHeartbeat, isAppResponsive };
