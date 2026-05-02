import { i as AnyCapturedEvent, m as CapturedError, t as UIBridgeConfig, o as ControlSnapshot, u as ControlActionRequest, C as ControlActionResponse, k as BatchActionRequest, l as BatchActionResponse, v as ComponentActionRequest, g as ComponentActionResponse, w as FindRequest, x as FindResponse, y as WorkflowRunRequest, z as WorkflowRunResponse, G as SearchCriteria, H as SearchResponse, I as NLActionRequest, J as NLActionResponse, K as AssertionRequest, L as AssertionResult, M as BatchAssertionRequest, O as BatchAssertionResult, Q as SemanticSnapshot, R as SemanticDiff, V as ActionWithDiffRequest, X as ActionDiffResult, Y as ChangePredicate, Z as WaitForChangeOptions, _ as CategorizedDiff, $ as StructuredChangeAnalysis, a0 as ChangeBufferDrainResult, a1 as SnapshotBookmark, a2 as SemanticSearchCriteria, a3 as SemanticSearchResponse, U as UIState, p as UIStateGroup, q as UITransition, T as TransitionResult, P as PathResult, N as NavigationResult, S as StateSnapshot, a4 as IntentExecutionResult, a5 as IntentSearchResponse, a6 as Intent, a7 as RecoveryAttemptRequest, a8 as RecoveryAttemptResult, a9 as PageDataMap, aa as PageRegionMap, ab as StructuredDataExtraction, ac as ComponentInfo, ad as CrossAppComparisonReport, ae as PageNavigationResponse, af as PageNavigateRequest, ag as ElementDesignData, ah as InteractionStateName, ai as StateStyles, aj as ResponsiveSnapshot, ak as FormsResponse, F as FillFormRequest, j as FillResult, al as UndoRedoState, r as ElementHistoryOptions } from './types-DHAgZgSv.js';
import { a as CompositeIdleStatus, S as SignalStatus } from './types-BFG8zj15.js';
import { RenderLogEntryType, RenderLogEntry } from './render-log/index.js';
import { a as NetworkRequestEntry, W as WaitForRequestOptions, b as WaitForRequestResult } from './tracker-DpZSyunJ.js';
import { F as FindContext, a as FindResult, b as FormSnapshot, c as FormDiff } from './find-0AV6kONE.js';
import { S as StyleGuideConfig, a as StyleAuditReport, E as EvaluateRequest, Q as QualityEvaluationReport, b as SnapshotDiffReport } from './style-types-Dv17Y_sz.js';
import { E as ElementAnnotation, A as AnnotationConfig, a as AnnotationCoverage } from './types-C7D5seeQ.js';
import { F as FingerprintedEvent, T as TimelineEntry, H as HealthReport, N as NetworkChain, E as ErrorSessionSummary, B as BaselineComparison, a as ErrorSnapshot } from './error-snapshot-0fx-yfOq.js';

/**
 * UI Bridge Server Types
 *
 * Shared types for server adapters.
 */

/**
 * Server configuration
 */
interface UIBridgeServerConfig extends UIBridgeConfig {
    /** Base path for API routes */
    basePath?: string;
    /** Enable CORS */
    cors?: boolean | CORSOptions;
    /** Authentication middleware */
    authenticate?: (req: unknown) => boolean | Promise<boolean>;
    /** Rate limiting */
    rateLimit?: RateLimitOptions;
}
/**
 * CORS options
 */
interface CORSOptions {
    /** Allowed origins */
    origin?: string | string[] | boolean;
    /** Allowed methods */
    methods?: string[];
    /** Allowed headers */
    headers?: string[];
    /** Expose headers */
    exposeHeaders?: string[];
    /** Allow credentials */
    credentials?: boolean;
    /** Max age for preflight cache */
    maxAge?: number;
}
/**
 * Rate limit options
 */
interface RateLimitOptions {
    /** Time window in milliseconds */
    windowMs?: number;
    /** Max requests per window */
    max?: number;
    /** Message when rate limited */
    message?: string;
}
/**
 * API response wrapper
 */
interface APIResponse<T = unknown> {
    /** Whether the request succeeded */
    success: boolean;
    /** Response data */
    data?: T;
    /** Error message if failed */
    error?: string;
    /** Error code */
    code?: string;
    /** Request timestamp */
    timestamp: number;
    /** Response metadata (staleness, diagnostics) */
    _meta?: {
        stale?: boolean;
        staleSinceMs?: number;
        cacheAgeMs?: number;
        fallback?: boolean;
        reason?: string;
    };
    /** Recovery suggestions for error responses */
    suggestions?: string[];
}
/**
 * Render log query parameters
 */
interface RenderLogQuery {
    /** Filter by entry type */
    type?: RenderLogEntryType;
    /** Filter entries since timestamp */
    since?: number;
    /** Filter entries until timestamp */
    until?: number;
    /** Limit number of results */
    limit?: number;
}
/**
 * Browser events response — returned by GET /control/browser-events
 */
interface BrowserEventsResponse {
    /** Raw events (filtered by params) */
    events: AnyCapturedEvent[] | CapturedError[];
    /** Total count of returned events */
    count: number;
    /** Deduplicated event groups (only when deduplicate=true) */
    deduplicated?: FingerprintedEvent[];
    /** Number of unique fingerprints (only when deduplicate=true) */
    uniqueCount?: number;
}
/**
 * Server handler interface
 *
 * Implementations provide these handlers for different frameworks.
 */
interface UIBridgeServerHandlers {
    getRenderLog: (query?: RenderLogQuery) => Promise<APIResponse<RenderLogEntry[]>>;
    clearRenderLog: () => Promise<APIResponse<void>>;
    captureSnapshot: () => Promise<APIResponse<unknown>>;
    getRenderLogPath: () => Promise<APIResponse<{
        path: string;
    }>>;
    getElements: (options?: {
        recency?: string;
        /** Case-insensitive substring filter on the element's title DOM attribute */
        title?: string;
        /** Case-insensitive substring filter on the element's aria-label DOM attribute */
        aria_label?: string;
        /** Case-insensitive substring filter on the element's visible text / label */
        text?: string;
    }) => Promise<APIResponse<ControlSnapshot['elements']>>;
    getElement: (id: string, options?: {
        recency?: string;
    }) => Promise<APIResponse<ControlSnapshot['elements'][0]>>;
    getElementState: (id: string) => Promise<APIResponse<unknown>>;
    getElementReactState: (id: string) => Promise<APIResponse<unknown>>;
    executeElementAction: (id: string, request: ControlActionRequest) => Promise<APIResponse<ControlActionResponse>>;
    executeBatchAction: (request: BatchActionRequest) => Promise<APIResponse<BatchActionResponse>>;
    /**
     * Rank snapshot elements by natural-language query against the
     * structured disambiguation metadata (variant, position, color,
     * contextPath, label, type). Returns scored matches.
     *
     * Free-text input is tokenised and matched token-bag style; structured
     * filters (type, origin, visibleOnly, contextPathContains) act as hard
     * filters. See `@qontinui/ui-bridge/core` `findElements` for the
     * scoring model.
     */
    rankElements: (request: {
        text?: string;
        type?: string;
        variant?: string;
        position?: string;
        color?: string;
        contextPathContains?: string;
        origin?: 'hook' | 'auto';
        visibleOnly?: boolean;
        limit?: number;
        minScore?: number;
    }) => Promise<APIResponse<Array<{
        id: string;
        score: number;
        reasons: string[];
        element: ControlSnapshot['elements'][0];
    }>>>;
    getComponents: (options?: {
        recency?: string;
    }) => Promise<APIResponse<ControlSnapshot['components']>>;
    getComponent: (id: string, options?: {
        recency?: string;
    }) => Promise<APIResponse<ControlSnapshot['components'][0]>>;
    getComponentState: (id: string) => Promise<APIResponse<{
        state: Record<string, unknown>;
        computed: Record<string, unknown>;
        timestamp: number;
    }>>;
    executeComponentAction: (id: string, request: ComponentActionRequest) => Promise<APIResponse<ComponentActionResponse>>;
    find: (request?: FindRequest & {
        recency?: string;
    }) => Promise<APIResponse<FindResponse>>;
    /**
     * @deprecated Use find() instead
     */
    discover: (request?: FindRequest & {
        recency?: string;
    }) => Promise<APIResponse<FindResponse>>;
    getControlSnapshot: (request?: {
        targetTabId?: string;
        url?: string;
        skipSettle?: boolean | string;
        settleTimeout?: number | string;
        recency?: string;
        /**
         * Item 1 filter: when `true`, drop elements with `kind: "content"`
         * (semantic `data-ui-bridge-content` entries) from the response.
         * Default `false` — include everything.
         */
        interactiveOnly?: boolean | string;
        /** snake_case alias for `interactiveOnly`. */
        interactive_only?: boolean | string;
    }) => Promise<APIResponse<ControlSnapshot>>;
    getElementImages: (request?: Record<string, unknown>) => Promise<APIResponse<unknown>>;
    getWorkflows: (options?: {
        recency?: string;
    }) => Promise<APIResponse<ControlSnapshot['workflows']>>;
    runWorkflow: (id: string, request?: WorkflowRunRequest) => Promise<APIResponse<WorkflowRunResponse>>;
    getWorkflowStatus: (runId: string) => Promise<APIResponse<WorkflowRunResponse>>;
    getActionHistory: (limit?: number) => Promise<APIResponse<unknown[]>>;
    getMetrics: () => Promise<APIResponse<unknown>>;
    highlightElement: (id: string) => Promise<APIResponse<void>>;
    getElementTree: () => Promise<APIResponse<unknown>>;
    getConsoleErrors: (params?: {
        since?: number;
        /**
         * Monotonic id cursor — return only entries with `id > sinceId`.
         * Paired with `nextSinceId` in the ungrouped response for pagination.
         * Takes precedence over the legacy `since` timestamp filter when both
         * are provided.
         */
        sinceId?: number;
        limit?: number;
        group?: boolean;
        groupBy?: 'fingerprint' | 'message' | 'source';
    }) => Promise<APIResponse<{
        errors: CapturedError[];
        count: number;
        /** Cursor for the next call — last returned entry's id, or `sinceId` if empty. */
        nextSinceId?: number;
        /** Lifetime total of entries evicted from the underlying buffer. */
        droppedCount?: number;
        /** Current buffer size (not filtered by level/since). */
        bufferedCount?: number;
    } | {
        groups: unknown[];
        totalErrors: number;
        totalGroups: number;
    }>>;
    clearConsoleErrors: () => Promise<APIResponse<{
        cleared: boolean;
    }>>;
    aiSearch: (criteria: SearchCriteria) => Promise<APIResponse<SearchResponse>>;
    aiFind: (request: {
        query: string;
        context?: FindContext;
        confidenceThreshold?: number;
    }) => Promise<APIResponse<FindResult>>;
    aiExecute: (request: NLActionRequest) => Promise<APIResponse<NLActionResponse>>;
    aiAssert: (request: AssertionRequest) => Promise<APIResponse<AssertionResult>>;
    aiAssertBatch: (request: BatchAssertionRequest) => Promise<APIResponse<BatchAssertionResult>>;
    getSemanticSnapshot: (options?: {
        includeForms?: string | boolean;
    }) => Promise<APIResponse<SemanticSnapshot>>;
    getSemanticDiff: (since?: number) => Promise<APIResponse<SemanticDiff | null>>;
    getPageSummary: () => Promise<APIResponse<string>>;
    executeWithDiff: (request: ActionWithDiffRequest) => Promise<APIResponse<ActionDiffResult>>;
    waitForChange: (request: {
        predicate: ChangePredicate;
        options?: WaitForChangeOptions;
    }) => Promise<APIResponse<SemanticDiff>>;
    categorizeLastDiff: () => Promise<APIResponse<CategorizedDiff | null>>;
    getScopedDiff: (request: {
        scope: string;
        fromBookmark?: string;
    }) => Promise<APIResponse<SemanticDiff | null>>;
    summarizeDiff: (request: {
        budget: number;
        includeIds?: boolean;
        includeCategory?: boolean;
        fromBookmark?: string;
    }) => Promise<APIResponse<{
        summary: string;
    }>>;
    analyzeStructuredChanges: (request: {
        fromBookmark?: string;
    }) => Promise<APIResponse<StructuredChangeAnalysis>>;
    enableChangeBuffer: () => Promise<APIResponse<{
        enabled: boolean;
    }>>;
    disableChangeBuffer: () => Promise<APIResponse<{
        enabled: boolean;
    }>>;
    drainChangeBuffer: () => Promise<APIResponse<ChangeBufferDrainResult>>;
    getChangeBufferSize: () => Promise<APIResponse<{
        size: number;
        enabled: boolean;
    }>>;
    saveBookmark: (request: {
        name: string;
    }) => Promise<APIResponse<SnapshotBookmark>>;
    getBookmark: (name: string) => Promise<APIResponse<SnapshotBookmark>>;
    deleteBookmark: (name: string) => Promise<APIResponse<{
        deleted: boolean;
    }>>;
    listBookmarks: () => Promise<APIResponse<string[]>>;
    diffFromBookmark: (name: string) => Promise<APIResponse<SemanticDiff | null>>;
    aiSemanticSearch: (criteria: SemanticSearchCriteria) => Promise<APIResponse<SemanticSearchResponse>>;
    getStates: () => Promise<APIResponse<UIState[]>>;
    getState: (id: string) => Promise<APIResponse<UIState>>;
    getActiveStates: () => Promise<APIResponse<UIState[]>>;
    activateState: (id: string) => Promise<APIResponse<void>>;
    deactivateState: (id: string) => Promise<APIResponse<void>>;
    getStateGroups: () => Promise<APIResponse<UIStateGroup[]>>;
    activateStateGroup: (id: string) => Promise<APIResponse<void>>;
    deactivateStateGroup: (id: string) => Promise<APIResponse<void>>;
    getTransitions: () => Promise<APIResponse<UITransition[]>>;
    canExecuteTransition: (id: string) => Promise<APIResponse<{
        canExecute: boolean;
        reason?: string;
    }>>;
    executeTransition: (id: string) => Promise<APIResponse<TransitionResult>>;
    findPath: (request: {
        targetStates: string[];
    }) => Promise<APIResponse<PathResult>>;
    navigateTo: (request: {
        targetStates: string[];
    }) => Promise<APIResponse<NavigationResult>>;
    getStateSnapshot: () => Promise<APIResponse<StateSnapshot>>;
    executeIntent: (request: {
        intentId: string;
        params?: Record<string, unknown>;
    }) => Promise<APIResponse<IntentExecutionResult>>;
    findIntent: (request: {
        query: string;
    }) => Promise<APIResponse<IntentSearchResponse>>;
    listIntents: () => Promise<APIResponse<Intent[]>>;
    registerIntent: (intent: Intent) => Promise<APIResponse<Intent>>;
    executeIntentFromQuery: (request: {
        query: string;
        params?: Record<string, unknown>;
    }) => Promise<APIResponse<IntentExecutionResult>>;
    deleteIntent: (name: string) => Promise<APIResponse<{
        deleted: boolean;
    }>>;
    attemptRecovery: (request: RecoveryAttemptRequest) => Promise<APIResponse<RecoveryAttemptResult>>;
    analyzePageData: () => Promise<APIResponse<PageDataMap>>;
    analyzePageRegions: () => Promise<APIResponse<PageRegionMap>>;
    analyzeStructuredData: () => Promise<APIResponse<StructuredDataExtraction>>;
    crossAppCompare: (request: {
        sourceSnapshot: SemanticSnapshot;
        targetSnapshot: SemanticSnapshot;
        sourceComponents?: ComponentInfo[];
        targetComponents?: ComponentInfo[];
    }) => Promise<APIResponse<CrossAppComparisonReport>>;
    pageRefresh: () => Promise<APIResponse<PageNavigationResponse>>;
    pageNavigate: (request: PageNavigateRequest) => Promise<APIResponse<PageNavigationResponse>>;
    pageGoBack: () => Promise<APIResponse<PageNavigationResponse>>;
    pageGoForward: () => Promise<APIResponse<PageNavigationResponse>>;
    pageEvaluate: (request: unknown) => Promise<APIResponse<unknown>>;
    pageScroll: (request: unknown) => Promise<APIResponse<unknown>>;
    clipboardWrite: (request: unknown) => Promise<APIResponse<unknown>>;
    clipboardRead: () => Promise<APIResponse<unknown>>;
    getAnnotations: () => Promise<APIResponse<Record<string, ElementAnnotation>>>;
    getAnnotation: (id: string) => Promise<APIResponse<ElementAnnotation>>;
    setAnnotation: (id: string, annotation: ElementAnnotation) => Promise<APIResponse<ElementAnnotation>>;
    deleteAnnotation: (id: string) => Promise<APIResponse<void>>;
    importAnnotations: (config: AnnotationConfig) => Promise<APIResponse<{
        count: number;
    }>>;
    exportAnnotations: () => Promise<APIResponse<AnnotationConfig>>;
    getAnnotationCoverage: () => Promise<APIResponse<AnnotationCoverage>>;
    getPerformanceEntries: () => Promise<APIResponse<unknown>>;
    clearPerformanceEntries: () => Promise<APIResponse<{
        cleared: boolean;
    }>>;
    getBrowserEvents: (params?: {
        type?: string;
        since?: number;
        limit?: number;
        severity?: string;
        deduplicate?: boolean;
    }) => Promise<APIResponse<BrowserEventsResponse>>;
    getTimeline: (params?: {
        since?: number;
        limit?: number;
        minSeverity?: string;
    }) => Promise<APIResponse<{
        entries: TimelineEntry[];
        count: number;
    }>>;
    getHealthReport: (params?: {
        windowMs?: number;
    }) => Promise<APIResponse<HealthReport>>;
    getNetworkChains: (params?: {
        since?: number;
        limit?: number;
        failuresOnly?: boolean;
        url?: string;
    }) => Promise<APIResponse<{
        chains: NetworkChain[];
        count: number;
    }>>;
    startErrorSession: (request: {
        label?: string;
    }) => Promise<APIResponse<{
        sessionId: string;
    }>>;
    endErrorSession: () => Promise<APIResponse<ErrorSessionSummary | null>>;
    getErrorSessions: () => Promise<APIResponse<ErrorSessionSummary[]>>;
    captureErrorBaseline: (request: {
        label: string;
    }) => Promise<APIResponse<{
        label: string;
        capturedAt: number;
        fingerprintCount: number;
    }>>;
    compareErrorBaseline: (request: {
        label: string;
    }) => Promise<APIResponse<BaselineComparison | null>>;
    getErrorSnapshots: (params?: {
        limit?: number;
    }) => Promise<APIResponse<{
        snapshots: ErrorSnapshot[];
        count: number;
    }>>;
    getErrorReport: () => Promise<APIResponse<{
        health: HealthReport;
        recentErrors: AnyCapturedEvent[];
        activeSession: ErrorSessionSummary | null;
        snapshots: ErrorSnapshot[];
    }>>;
    getElementStyles: (id: string) => Promise<APIResponse<ElementDesignData>>;
    getElementStateStyles: (id: string, request: {
        states?: InteractionStateName[];
    }) => Promise<APIResponse<{
        elementId: string;
        stateStyles: StateStyles[];
    }>>;
    getDesignSnapshot: (request?: {
        elementIds?: string[];
        includePseudoElements?: boolean;
    }) => Promise<APIResponse<{
        elements: ElementDesignData[];
        timestamp: number;
    }>>;
    getResponsiveSnapshots: (request: {
        viewports?: Record<string, number>;
        elementIds?: string[];
    }) => Promise<APIResponse<ResponsiveSnapshot[]>>;
    setViewportConstraints: (request: {
        width?: number;
        restore?: boolean;
    }) => Promise<APIResponse<{
        success: boolean;
        viewportWidth: number;
        constrainedWidth: number;
        timestamp: number;
    }>>;
    runDesignAudit: (request?: {
        guide?: StyleGuideConfig;
        elementIds?: string[];
    }) => Promise<APIResponse<StyleAuditReport>>;
    loadStyleGuide: (request: {
        guide: StyleGuideConfig;
    }) => Promise<APIResponse<{
        loaded: boolean;
    }>>;
    getStyleGuide: () => Promise<APIResponse<StyleGuideConfig | null>>;
    clearStyleGuide: () => Promise<APIResponse<{
        cleared: boolean;
    }>>;
    evaluateQuality: (request?: EvaluateRequest) => Promise<APIResponse<QualityEvaluationReport>>;
    getQualityContexts: () => Promise<APIResponse<Array<{
        name: string;
        description: string;
    }>>>;
    saveBaseline: (request?: {
        label?: string;
        elementIds?: string[];
    }) => Promise<APIResponse<{
        saved: boolean;
        elementCount: number;
    }>>;
    diffBaseline: (request?: {
        elementIds?: string[];
    }) => Promise<APIResponse<SnapshotDiffReport>>;
    getForms: () => Promise<APIResponse<FormsResponse>>;
    fillForm: (request: FillFormRequest) => Promise<APIResponse<FillResult>>;
    snapshotForms: () => Promise<APIResponse<FormSnapshot>>;
    diffForms: (request: {
        before: FormSnapshot;
        after: FormSnapshot;
    }) => Promise<APIResponse<FormDiff>>;
    getClipboard: () => Promise<APIResponse<{
        text: string | null;
        formats: string[];
    }>>;
    setClipboard: (request: {
        text: string;
        html?: string;
    }) => Promise<APIResponse<{
        written: boolean;
        formats: string[];
    }>>;
    getNetworkRequests: (params?: {
        status?: string;
        method?: string;
        urlPattern?: string;
        failuresOnly?: boolean;
        since?: number;
        limit?: number;
    }) => Promise<APIResponse<{
        requests: NetworkRequestEntry[];
        count: number;
        inFlightCount: number;
    }>>;
    getNetworkRequestsInFlight: () => Promise<APIResponse<{
        requests: NetworkRequestEntry[];
        count: number;
    }>>;
    waitForNetworkRequest: (request: WaitForRequestOptions) => Promise<APIResponse<WaitForRequestResult>>;
    getNetworkRequest: (id: string) => Promise<APIResponse<NetworkRequestEntry>>;
    getIdleStatus: () => Promise<APIResponse<CompositeIdleStatus>>;
    getIdleSignalStatus: (signal: string) => Promise<APIResponse<SignalStatus>>;
    waitForIdle: (request?: {
        timeout?: number;
        minStableMs?: number;
        exclude?: string[];
    }) => Promise<APIResponse<CompositeIdleStatus>>;
    waitForSignalIdle: (signal: string, request?: {
        timeout?: number;
        minStableMs?: number;
    }) => Promise<APIResponse<SignalStatus>>;
    waitForTargets: (request: {
        targets: Array<string | {
            indicator: string;
        }>;
        timeout?: number;
        minStableMs?: number;
    }) => Promise<APIResponse<Record<string, SignalStatus>>>;
    getUndoState: () => Promise<APIResponse<UndoRedoState>>;
    executeUndo: () => Promise<APIResponse<{
        executed: boolean;
    }>>;
    executeRedo: () => Promise<APIResponse<{
        executed: boolean;
    }>>;
    getCapabilities: () => Promise<APIResponse<CapabilitiesResponse>>;
    getSpecs: () => Promise<APIResponse<Record<string, unknown>>>;
    receiveHeartbeat: () => Promise<APIResponse<{
        received: boolean;
    }>>;
    getElementHistory: (elementId: string, options?: ElementHistoryOptions) => Promise<APIResponse<unknown[]>>;
    findMedia: (request?: FindRequest) => Promise<APIResponse<FindResponse>>;
    mediaAuditAccessibility: () => Promise<APIResponse<unknown>>;
    mediaAuditPerformance: () => Promise<APIResponse<unknown>>;
    captureMediaSnapshot: (request: {
        elementId: string;
        maxSize?: number;
    }) => Promise<APIResponse<unknown>>;
    compareMediaSnapshots: (request: {
        snapshotA: unknown;
        snapshotB: unknown;
    }) => Promise<APIResponse<unknown>>;
    analyzeMedia: (request: {
        elementId: string;
        maxSize?: number;
    }) => Promise<APIResponse<unknown>>;
    analyzeMediaBatch: (request: {
        elementIds: string[];
        maxSize?: number;
    }) => Promise<APIResponse<unknown>>;
    analyzeMediaPage: (request?: {
        maxElements?: number;
        maxSize?: number;
        includeContext?: boolean;
    }) => Promise<APIResponse<unknown>>;
    getChangesSince: (params?: {
        since?: number;
        limit?: number;
    }) => Promise<APIResponse<{
        events: DOMChangeEvent[];
        count: number;
    }>>;
    /** Tear down internal subscriptions and observers to prevent resource leaks. */
    destroy?: () => void;
    query: (request: {
        selector: string;
        limit?: number;
        includeState?: boolean;
    }) => Promise<APIResponse<{
        elements: unknown[];
        count: number;
    }>>;
    waitForElement: (request: {
        selector?: string;
        elementId?: string;
        timeout?: number;
        pollInterval?: number;
    }) => Promise<APIResponse<{
        found: boolean;
        element?: unknown;
        waitedMs: number;
    }>>;
    /**
     * Tier 3.1 — Wait for an element matching a structured selector to satisfy
     * a given condition (present / visible / clickable / text-matches).
     *
     * Implemented via registry polling so it works with both DOM and native elements.
     */
    waitForElementByCondition: (request: WaitForElementByConditionRequest) => Promise<APIResponse<WaitForElementByConditionResponse>>;
    /**
     * Testing-friendliness — Wait for an SPA route change with optional
     * from/to matching. Returns a timeout shape (reason: 'timeout') when no
     * matching navigation occurs before `timeoutMs`.
     */
    waitForRouteChange: (request?: WaitForRouteChangeRequest) => Promise<APIResponse<WaitForRouteChangeResponse | {
        reason: 'timeout';
        lastKnownRoute?: string;
        elapsedMs: number;
    }>>;
    /**
     * Testing-friendliness — Wait for an element matching `predicate` to be
     * registered (or visible / have layout, per `requirement`). Polls the
     * in-memory registry; falls back to `document.querySelector` when
     * `predicate.selector` is given.
     */
    waitForElementRegistered: (request: WaitForElementRequest) => Promise<APIResponse<WaitForElementSuccessResponse | {
        reason: 'timeout';
        elapsedMs: number;
        closestMatch?: Record<string, unknown>;
    }>>;
    /**
     * Tier 3.2 — Execute a heterogeneous sequence of actions, waits, and
     * snapshots in one round-trip.
     */
    controlBatch: (request: ControlBatchRequest) => Promise<APIResponse<ControlBatchResponse>>;
    clickByText: (request: {
        text: string;
        tag?: string;
        exact?: boolean;
    }) => Promise<APIResponse<{
        clicked: boolean;
        element?: unknown;
    }>>;
    clickBySelector: (request: {
        selector: string;
        index?: number;
    }) => Promise<APIResponse<{
        clicked: boolean;
        element?: unknown;
    }>>;
    typeInto: (request: {
        selector?: string;
        label?: string;
        text: string;
        clear?: boolean;
    }) => Promise<APIResponse<{
        typed: boolean;
        element?: unknown;
    }>>;
    readValue: (request: {
        selector: string;
        index?: number;
    }) => Promise<APIResponse<{
        value: string | null;
        length: number;
    }>>;
    findByText: (request: {
        text: string;
        tag?: string;
        exact?: boolean;
    }) => Promise<APIResponse<Array<{
        index: number;
        tag: string;
        text: string;
        rect: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        disabled: boolean;
        visible: boolean;
    }>>>;
    getDiagnostics: () => Promise<APIResponse<{
        sdk_initialized: boolean;
        auto_register_active: boolean;
        registered_elements: number;
        dom_interactive_elements: number;
        mutation_observer_active: boolean;
        navigation_adapter: string;
        page_title: string;
        page_url: string;
        page_ready: boolean;
        providers_mounted: string[];
        last_discover_at: string | null;
        capabilities: string[];
    }>>;
    getRoutes: () => Promise<APIResponse<Array<{
        name: string;
        path: string;
    }>>>;
    navigateByAdapter: (request: {
        page: string;
    }) => Promise<APIResponse<{
        navigated: boolean;
        route: {
            name: string;
            path: string;
        };
    }>>;
}
/**
 * Push-based DOM change event.
 *
 * Batched subtree-change events emitted by the ChangeObserver and relayed
 * through the CommandRelay. Inspired by folk-js/allio's SubtreeChanged event.
 */
interface DOMChangeEvent {
    type: 'subtreeChanged';
    timestamp: number;
    added: string[];
    removed: string[];
    modified: string[];
}
/**
 * Endpoint description for API discovery
 */
interface EndpointInfo {
    method: string;
    path: string;
    description: string;
    queryParams?: Record<string, string>;
}
/**
 * Category of related endpoints
 */
interface EndpointCategory {
    description: string;
    endpoints: EndpointInfo[];
}
/**
 * Response from the /capabilities endpoint
 */
interface CapabilitiesResponse {
    version: string;
    categories: Record<string, EndpointCategory>;
}
/**
 * Selector criteria for waitForElementByCondition.
 * All provided fields are ANDed together (case-insensitive substring match).
 */
interface ElementConditionSelector {
    /** Match by element id (exact or substring) */
    id?: string;
    /** Match by title attribute (substring) */
    title?: string;
    /** Match by aria-label attribute (substring) */
    aria_label?: string;
    /** Match by visible text / label (substring) */
    text?: string;
    /** Match by element type (e.g. "button", "input") */
    type?: string;
}
/**
 * Request body for POST /ai/wait-for-element (Tier 3.1)
 */
interface WaitForElementByConditionRequest {
    /** Selector criteria — all provided fields must match */
    selector: ElementConditionSelector;
    /** Max wait in ms (default 5000, capped at 60000) */
    timeout_ms?: number;
    /** Condition to check on each poll */
    condition?: 'present' | 'visible' | 'clickable' | 'text-matches';
    /** Substring to match when condition is "text-matches" (case-insensitive) */
    text_match?: string;
}
/**
 * Response body for POST /ai/wait-for-element (Tier 3.1)
 */
interface WaitForElementByConditionResponse {
    /** Whether the condition was satisfied before timeout */
    matched: boolean;
    /** The matched element (present when matched is true) */
    element?: unknown;
    /** How long we actually waited in ms */
    waited_ms: number;
}
/**
 * Request body for POST /ai/wait-for-route-change.
 *
 * Blocks until the SPA route changes. Optionally filters by the prior
 * route (`fromRoute`) and/or the new route (`toRoute` with `matchMode`).
 * When a matching route change happened between the request arriving and
 * the subscription being set, the handler resolves immediately with
 * `elapsedMs: 0` by scanning the always-on recent-route-change buffer.
 */
interface WaitForRouteChangeRequest {
    /** Only fire when the prior route equals this exact string. */
    fromRoute?: string;
    /** Only fire when the new route matches this (per `matchMode`). */
    toRoute?: string;
    /** How to compare `toRoute` against the new route. Default: `"exact"`. */
    matchMode?: 'exact' | 'prefix' | 'regex';
    /** Max wait in ms. Default 5000, clamped to [100, 60000]. */
    timeoutMs?: number;
}
/**
 * Response body for POST /ai/wait-for-route-change (success case).
 */
interface WaitForRouteChangeResponse {
    from: string;
    to: string;
    elapsedMs: number;
}
/**
 * Selector predicate for POST /ai/wait-for-element.
 *
 * All provided fields are ANDed. At least one field should be provided;
 * otherwise the first registered element is returned.
 */
interface WaitForElementPredicate {
    /** Match by element id (exact). */
    id?: string;
    /** Match by label / accessible name (case-insensitive substring). */
    label?: string;
    /** Match by data-testid attribute (exact). */
    testId?: string;
    /** CSS selector — falls back to document.querySelector if element is not in registry. */
    selector?: string;
}
/**
 * Request body for POST /ai/wait-for-element.
 *
 * Polls the in-memory registry for an element matching `predicate`. When
 * `selector` is supplied, falls back to `document.querySelector` once per
 * poll so the wait also covers elements that aren't SDK-registered.
 */
interface WaitForElementRequest {
    predicate: WaitForElementPredicate;
    /**
     * Additional requirement on the matched element.
     * - `"registered"` (default): element exists in the registry.
     * - `"visible"`: element exists AND is visible per snapshot rules.
     * - `"has-layout"`: element exists AND `layout.width > 0 && layout.height > 0`.
     */
    requirement?: 'registered' | 'visible' | 'has-layout';
    /** Poll interval in ms. Default 100, clamped to [50, 1000]. */
    pollMs?: number;
    /** Max wait in ms. Default 5000, clamped to [100, 60000]. */
    timeoutMs?: number;
}
/**
 * Response body for POST /ai/wait-for-element (success case).
 */
interface WaitForElementSuccessResponse {
    element: {
        id: string;
        label?: string;
        type?: string;
        [key: string]: unknown;
    };
    elapsedMs: number;
}
/**
 * A single step in a Tier 3.2 control batch request.
 */
type ControlBatchStep = {
    type: 'action';
    /** ID of the element to act on */
    element_id: string;
    /** Action name (click, type, focus, …) */
    action: string;
    /** Optional action parameters */
    params?: Record<string, unknown>;
} | {
    type: 'wait';
    /** Milliseconds to sleep */
    ms: number;
} | {
    type: 'snapshot';
};
/**
 * Request body for POST /control/batch (Tier 3.2)
 */
interface ControlBatchRequest {
    actions: ControlBatchStep[];
    /** When true (default), stop executing on the first error */
    stop_on_error?: boolean;
}
/**
 * Per-step result in a Tier 3.2 batch response
 */
interface ControlBatchStepResult {
    index: number;
    success: boolean;
    data?: unknown;
    error?: string;
}
/**
 * Response body for POST /control/batch (Tier 3.2)
 */
interface ControlBatchResponse {
    results: ControlBatchStepResult[];
    completed: number;
    total: number;
}
/**
 * Route definition
 */
interface RouteDefinition {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    handler: string;
    params?: string[];
    bodyRequired?: boolean;
}
/**
 * All UI Bridge routes
 */
declare const UI_BRIDGE_ROUTES: RouteDefinition[];
/**
 * WebSocket message types
 */
type WebSocketMessageType = 'subscribe' | 'unsubscribe' | 'event' | 'snapshot' | 'action' | 'error';
/**
 * WebSocket message
 */
interface WebSocketMessage<T = unknown> {
    type: WebSocketMessageType;
    channel?: string;
    data?: T;
    error?: string;
    timestamp: number;
}

export { type APIResponse as A, type BrowserEventsResponse as B, type CORSOptions as C, type DOMChangeEvent as D, type ElementConditionSelector as E, type RateLimitOptions as R, type UIBridgeServerConfig as U, type WebSocketMessage as W, type UIBridgeServerHandlers as a, type CapabilitiesResponse as b, type ControlBatchRequest as c, type ControlBatchResponse as d, type ControlBatchStep as e, type ControlBatchStepResult as f, type EndpointCategory as g, type EndpointInfo as h, type RenderLogQuery as i, type RouteDefinition as j, UI_BRIDGE_ROUTES as k, type WaitForElementByConditionRequest as l, type WaitForElementByConditionResponse as m, type WaitForElementPredicate as n, type WaitForElementRequest as o, type WaitForElementSuccessResponse as p, type WaitForRouteChangeRequest as q, type WaitForRouteChangeResponse as r, type WebSocketMessageType as s };
