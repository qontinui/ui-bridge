/**
 * UI Bridge Server Types
 *
 * Shared types for server adapters.
 */

import type { UIBridgeConfig, ElementHistoryOptions } from '../core';
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  FindRequest,
  FindResponse,
  ControlSnapshot,
  WorkflowRunRequest,
  WorkflowRunResponse,
  PageNavigateRequest,
  PageNavigationResponse,
  FillFormRequest,
} from '../control';
import type { FillResult } from '../core/types';
import type { RenderLogEntry, RenderLogEntryType } from '../render-log';
import type {
  SearchCriteria,
  SearchResponse,
  NLActionRequest,
  NLActionResponse,
  AssertionRequest,
  AssertionResult,
  BatchAssertionRequest,
  BatchAssertionResult,
  SemanticSnapshot,
  SemanticDiff,
  SemanticSearchCriteria,
  SemanticSearchResponse,
  Intent,
  IntentSearchResponse,
  IntentExecutionResult,
  RecoveryAttemptRequest,
  RecoveryAttemptResult,
  PageDataMap,
  PageRegionMap,
  StructuredDataExtraction,
  CrossAppComparisonReport,
  ComponentInfo,
  ActionWithDiffRequest,
  ActionDiffResult,
  ChangePredicate,
  WaitForChangeOptions,
  CategorizedDiff,
  ChangeBufferDrainResult,
  SnapshotBookmark,
  FormsResponse,
  StructuredChangeAnalysis,
  FormSnapshot,
  FormDiff,
  FindResult,
  FindContext,
} from '../ai';
import type {
  InteractionStateName,
  ElementDesignData,
  StateStyles,
  ResponsiveSnapshot,
} from '../core/types';
import type { StyleGuideConfig, StyleAuditReport } from '../specs/style-types';
import type {
  QualityEvaluationReport,
  SnapshotDiffReport,
  EvaluateRequest,
} from '../specs/quality-types';
import type {
  UIState,
  UIStateGroup,
  UITransition,
  PathResult,
  TransitionResult,
  NavigationResult,
  StateSnapshot,
} from '../core';
import type { ElementAnnotation, AnnotationConfig, AnnotationCoverage } from '../annotations';
import type { CapturedError, AnyCapturedEvent } from '../debug/browser-capture-types';
import type { FingerprintedEvent } from '../debug/error-fingerprint';
import type { TimelineEntry } from '../debug/error-timeline';
import type { HealthReport } from '../debug/health-score';
import type { ErrorSessionSummary, BaselineComparison } from '../debug/error-session';
import type { NetworkChain } from '../debug/network-chain';
import type { ErrorSnapshot } from '../debug/error-snapshot';
import type { CompositeIdleStatus, SignalStatus } from '../idle';
import type { NetworkRequestEntry, WaitForRequestOptions, WaitForRequestResult } from '../network';
import type { UndoRedoState } from '../undo';

/**
 * Server configuration
 */
export interface UIBridgeServerConfig extends UIBridgeConfig {
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
export interface CORSOptions {
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
export interface RateLimitOptions {
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
export interface APIResponse<T = unknown> {
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
}

/**
 * Render log query parameters
 */
export interface RenderLogQuery {
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
export interface BrowserEventsResponse {
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
export interface UIBridgeServerHandlers {
  // Render log endpoints
  getRenderLog: (query?: RenderLogQuery) => Promise<APIResponse<RenderLogEntry[]>>;
  clearRenderLog: () => Promise<APIResponse<void>>;
  captureSnapshot: () => Promise<APIResponse<unknown>>;
  getRenderLogPath: () => Promise<APIResponse<{ path: string }>>;

  // Control endpoints
  getElements: () => Promise<APIResponse<ControlSnapshot['elements']>>;
  getElement: (id: string) => Promise<APIResponse<ControlSnapshot['elements'][0]>>;
  getElementState: (id: string) => Promise<APIResponse<unknown>>;
  executeElementAction: (
    id: string,
    request: ControlActionRequest
  ) => Promise<APIResponse<ControlActionResponse>>;

  // Component endpoints
  getComponents: () => Promise<APIResponse<ControlSnapshot['components']>>;
  getComponent: (id: string) => Promise<APIResponse<ControlSnapshot['components'][0]>>;
  getComponentState: (id: string) => Promise<
    APIResponse<{
      state: Record<string, unknown>;
      computed: Record<string, unknown>;
      timestamp: number;
    }>
  >;
  executeComponentAction: (
    id: string,
    request: ComponentActionRequest
  ) => Promise<APIResponse<ComponentActionResponse>>;

  // Find endpoints
  find: (request?: FindRequest) => Promise<APIResponse<FindResponse>>;
  /**
   * @deprecated Use find() instead
   */
  discover: (request?: FindRequest) => Promise<APIResponse<FindResponse>>;
  getControlSnapshot: (request?: {
    targetTabId?: string;
    url?: string;
    skipSettle?: boolean | string;
    settleTimeout?: number | string;
  }) => Promise<APIResponse<ControlSnapshot>>;

  // Workflow endpoints
  getWorkflows: () => Promise<APIResponse<ControlSnapshot['workflows']>>;
  runWorkflow: (
    id: string,
    request?: WorkflowRunRequest
  ) => Promise<APIResponse<WorkflowRunResponse>>;
  getWorkflowStatus: (runId: string) => Promise<APIResponse<WorkflowRunResponse>>;

  // Debug endpoints
  getActionHistory: (limit?: number) => Promise<APIResponse<unknown[]>>;
  getMetrics: () => Promise<APIResponse<unknown>>;
  highlightElement: (id: string) => Promise<APIResponse<void>>;
  getElementTree: () => Promise<APIResponse<unknown>>;
  getConsoleErrors: (params?: {
    since?: number;
    limit?: number;
  }) => Promise<APIResponse<{ errors: CapturedError[]; count: number }>>;
  clearConsoleErrors: () => Promise<APIResponse<{ cleared: boolean }>>;

  // AI-native endpoints
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

  // Change tracking endpoints
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
  // Budget-aware diff summary
  summarizeDiff: (request: {
    budget: number;
    includeIds?: boolean;
    includeCategory?: boolean;
    fromBookmark?: string;
  }) => Promise<APIResponse<{ summary: string }>>;
  // Structured change analysis (table/list-aware)
  analyzeStructuredChanges: (request: {
    fromBookmark?: string;
  }) => Promise<APIResponse<StructuredChangeAnalysis>>;

  // Change buffer endpoints
  enableChangeBuffer: () => Promise<APIResponse<{ enabled: boolean }>>;
  disableChangeBuffer: () => Promise<APIResponse<{ enabled: boolean }>>;
  drainChangeBuffer: () => Promise<APIResponse<ChangeBufferDrainResult>>;
  getChangeBufferSize: () => Promise<APIResponse<{ size: number; enabled: boolean }>>;

  // Snapshot bookmark endpoints
  saveBookmark: (request: { name: string }) => Promise<APIResponse<SnapshotBookmark>>;
  getBookmark: (name: string) => Promise<APIResponse<SnapshotBookmark>>;
  deleteBookmark: (name: string) => Promise<APIResponse<{ deleted: boolean }>>;
  listBookmarks: () => Promise<APIResponse<string[]>>;
  diffFromBookmark: (name: string) => Promise<APIResponse<SemanticDiff | null>>;

  // Semantic search (embedding-based)
  aiSemanticSearch: (
    criteria: SemanticSearchCriteria
  ) => Promise<APIResponse<SemanticSearchResponse>>;

  // State management endpoints
  getStates: () => Promise<APIResponse<UIState[]>>;
  getState: (id: string) => Promise<APIResponse<UIState>>;
  getActiveStates: () => Promise<APIResponse<UIState[]>>;
  activateState: (id: string) => Promise<APIResponse<void>>;
  deactivateState: (id: string) => Promise<APIResponse<void>>;
  getStateGroups: () => Promise<APIResponse<UIStateGroup[]>>;
  activateStateGroup: (id: string) => Promise<APIResponse<void>>;
  deactivateStateGroup: (id: string) => Promise<APIResponse<void>>;
  getTransitions: () => Promise<APIResponse<UITransition[]>>;
  canExecuteTransition: (
    id: string
  ) => Promise<APIResponse<{ canExecute: boolean; reason?: string }>>;
  executeTransition: (id: string) => Promise<APIResponse<TransitionResult>>;
  findPath: (request: { targetStates: string[] }) => Promise<APIResponse<PathResult>>;
  navigateTo: (request: { targetStates: string[] }) => Promise<APIResponse<NavigationResult>>;
  getStateSnapshot: () => Promise<APIResponse<StateSnapshot>>;

  // Intent endpoints
  executeIntent: (request: {
    intentId: string;
    params?: Record<string, unknown>;
  }) => Promise<APIResponse<IntentExecutionResult>>;
  findIntent: (request: { query: string }) => Promise<APIResponse<IntentSearchResponse>>;
  listIntents: () => Promise<APIResponse<Intent[]>>;
  registerIntent: (intent: Intent) => Promise<APIResponse<Intent>>;
  executeIntentFromQuery: (request: {
    query: string;
    params?: Record<string, unknown>;
  }) => Promise<APIResponse<IntentExecutionResult>>;

  // Recovery endpoints
  attemptRecovery: (request: RecoveryAttemptRequest) => Promise<APIResponse<RecoveryAttemptResult>>;

  // Cross-app analysis endpoints
  analyzePageData: () => Promise<APIResponse<PageDataMap>>;
  analyzePageRegions: () => Promise<APIResponse<PageRegionMap>>;
  analyzeStructuredData: () => Promise<APIResponse<StructuredDataExtraction>>;
  crossAppCompare: (request: {
    sourceSnapshot: SemanticSnapshot;
    targetSnapshot: SemanticSnapshot;
    sourceComponents?: ComponentInfo[];
    targetComponents?: ComponentInfo[];
  }) => Promise<APIResponse<CrossAppComparisonReport>>;

  // Page navigation endpoints
  pageRefresh: () => Promise<APIResponse<PageNavigationResponse>>;
  pageNavigate: (request: PageNavigateRequest) => Promise<APIResponse<PageNavigationResponse>>;
  pageGoBack: () => Promise<APIResponse<PageNavigationResponse>>;
  pageGoForward: () => Promise<APIResponse<PageNavigationResponse>>;

  // Annotation endpoints
  getAnnotations: () => Promise<APIResponse<Record<string, ElementAnnotation>>>;
  getAnnotation: (id: string) => Promise<APIResponse<ElementAnnotation>>;
  setAnnotation: (
    id: string,
    annotation: ElementAnnotation
  ) => Promise<APIResponse<ElementAnnotation>>;
  deleteAnnotation: (id: string) => Promise<APIResponse<void>>;
  importAnnotations: (config: AnnotationConfig) => Promise<APIResponse<{ count: number }>>;
  exportAnnotations: () => Promise<APIResponse<AnnotationConfig>>;
  getAnnotationCoverage: () => Promise<APIResponse<AnnotationCoverage>>;

  // Performance diagnostics endpoints
  getPerformanceEntries: () => Promise<APIResponse<unknown>>;
  clearPerformanceEntries: () => Promise<APIResponse<{ cleared: boolean }>>;
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
  }) => Promise<APIResponse<{ entries: TimelineEntry[]; count: number }>>;

  // Health score endpoint
  getHealthReport: (params?: { windowMs?: number }) => Promise<APIResponse<HealthReport>>;

  // Network chain endpoints
  getNetworkChains: (params?: {
    since?: number;
    limit?: number;
    failuresOnly?: boolean;
    url?: string;
  }) => Promise<APIResponse<{ chains: NetworkChain[]; count: number }>>;

  // Error session endpoints
  startErrorSession: (request: { label?: string }) => Promise<APIResponse<{ sessionId: string }>>;
  endErrorSession: () => Promise<APIResponse<ErrorSessionSummary | null>>;
  getErrorSessions: () => Promise<APIResponse<ErrorSessionSummary[]>>;
  captureErrorBaseline: (request: {
    label: string;
  }) => Promise<APIResponse<{ label: string; capturedAt: number; fingerprintCount: number }>>;
  compareErrorBaseline: (request: {
    label: string;
  }) => Promise<APIResponse<BaselineComparison | null>>;

  // Error snapshots (auto-captured on significant errors)
  getErrorSnapshots: (params?: {
    limit?: number;
  }) => Promise<APIResponse<{ snapshots: ErrorSnapshot[]; count: number }>>;

  // Composite error report (health + recent errors + session in one call)
  getErrorReport: () => Promise<
    APIResponse<{
      health: HealthReport;
      recentErrors: AnyCapturedEvent[];
      activeSession: ErrorSessionSummary | null;
      snapshots: ErrorSnapshot[];
    }>
  >;

  // Design review endpoints
  getElementStyles: (id: string) => Promise<APIResponse<ElementDesignData>>;
  getElementStateStyles: (
    id: string,
    request: { states?: InteractionStateName[] }
  ) => Promise<APIResponse<{ elementId: string; stateStyles: StateStyles[] }>>;
  getDesignSnapshot: (request?: {
    elementIds?: string[];
    includePseudoElements?: boolean;
  }) => Promise<APIResponse<{ elements: ElementDesignData[]; timestamp: number }>>;
  getResponsiveSnapshots: (request: {
    viewports?: Record<string, number>;
    elementIds?: string[];
  }) => Promise<APIResponse<ResponsiveSnapshot[]>>;
  runDesignAudit: (request?: {
    guide?: StyleGuideConfig;
    elementIds?: string[];
  }) => Promise<APIResponse<StyleAuditReport>>;
  loadStyleGuide: (request: {
    guide: StyleGuideConfig;
  }) => Promise<APIResponse<{ loaded: boolean }>>;
  getStyleGuide: () => Promise<APIResponse<StyleGuideConfig | null>>;
  clearStyleGuide: () => Promise<APIResponse<{ cleared: boolean }>>;

  // Quality evaluation endpoints
  evaluateQuality: (request?: EvaluateRequest) => Promise<APIResponse<QualityEvaluationReport>>;
  getQualityContexts: () => Promise<APIResponse<Array<{ name: string; description: string }>>>;
  saveBaseline: (request?: {
    label?: string;
    elementIds?: string[];
  }) => Promise<APIResponse<{ saved: boolean; elementCount: number }>>;
  diffBaseline: (request?: { elementIds?: string[] }) => Promise<APIResponse<SnapshotDiffReport>>;

  // Form state awareness endpoints
  getForms: () => Promise<APIResponse<FormsResponse>>;
  fillForm: (request: FillFormRequest) => Promise<APIResponse<FillResult>>;
  snapshotForms: () => Promise<APIResponse<FormSnapshot>>;
  diffForms: (request: {
    before: FormSnapshot;
    after: FormSnapshot;
  }) => Promise<APIResponse<FormDiff>>;

  // Clipboard endpoints
  getClipboard: () => Promise<APIResponse<{ text: string | null; formats: string[] }>>;
  setClipboard: (request: {
    text: string;
    html?: string;
  }) => Promise<APIResponse<{ written: boolean; formats: string[] }>>;

  // Network request monitoring endpoints
  getNetworkRequests: (params?: {
    status?: string;
    method?: string;
    urlPattern?: string;
    failuresOnly?: boolean;
    since?: number;
    limit?: number;
  }) => Promise<
    APIResponse<{ requests: NetworkRequestEntry[]; count: number; inFlightCount: number }>
  >;

  getNetworkRequestsInFlight: () => Promise<
    APIResponse<{ requests: NetworkRequestEntry[]; count: number }>
  >;

  waitForNetworkRequest: (
    request: WaitForRequestOptions
  ) => Promise<APIResponse<WaitForRequestResult>>;

  getNetworkRequest: (id: string) => Promise<APIResponse<NetworkRequestEntry>>;

  // Idle detection endpoints
  getIdleStatus: () => Promise<APIResponse<CompositeIdleStatus>>;
  getIdleSignalStatus: (signal: string) => Promise<APIResponse<SignalStatus>>;
  waitForIdle: (request?: {
    timeout?: number;
    minStableMs?: number;
    exclude?: string[];
  }) => Promise<APIResponse<CompositeIdleStatus>>;
  waitForSignalIdle: (
    signal: string,
    request?: { timeout?: number; minStableMs?: number }
  ) => Promise<APIResponse<SignalStatus>>;
  waitForTargets: (request: {
    targets: Array<string | { indicator: string }>;
    timeout?: number;
    minStableMs?: number;
  }) => Promise<APIResponse<Record<string, SignalStatus>>>;

  // Undo/redo awareness endpoints
  getUndoState: () => Promise<APIResponse<UndoRedoState>>;
  executeUndo: () => Promise<APIResponse<{ executed: boolean }>>;
  executeRedo: () => Promise<APIResponse<{ executed: boolean }>>;

  // API discovery
  getCapabilities: () => Promise<APIResponse<CapabilitiesResponse>>;

  // Specs endpoint — serves all loaded specs for runner discovery
  getSpecs: () => Promise<APIResponse<Record<string, unknown>>>;

  // Heartbeat (app health detection)
  receiveHeartbeat: () => Promise<APIResponse<{ received: boolean }>>;

  // Element event log
  getElementHistory: (
    elementId: string,
    options?: ElementHistoryOptions
  ) => Promise<APIResponse<unknown[]>>;

  // Media discovery & analysis endpoints
  findMedia: (request?: FindRequest) => Promise<APIResponse<FindResponse>>;
  mediaAuditAccessibility: () => Promise<APIResponse<unknown>>;
  mediaAuditPerformance: () => Promise<APIResponse<unknown>>;
  captureMediaSnapshot: (request: { elementId: string; maxSize?: number }) => Promise<APIResponse<unknown>>;
  compareMediaSnapshots: (request: { snapshotA: unknown; snapshotB: unknown }) => Promise<APIResponse<unknown>>;
  analyzeMedia: (request: { elementId: string; maxSize?: number }) => Promise<APIResponse<unknown>>;
  analyzeMediaBatch: (request: { elementIds: string[]; maxSize?: number }) => Promise<APIResponse<unknown>>;
  analyzeMediaPage: (request?: { maxElements?: number; maxSize?: number; includeContext?: boolean }) => Promise<APIResponse<unknown>>;
}

/**
 * Endpoint description for API discovery
 */
export interface EndpointInfo {
  method: string;
  path: string;
  description: string;
}

/**
 * Category of related endpoints
 */
export interface EndpointCategory {
  description: string;
  endpoints: EndpointInfo[];
}

/**
 * Response from the /capabilities endpoint
 */
export interface CapabilitiesResponse {
  version: string;
  categories: Record<string, EndpointCategory>;
}

/**
 * Route definition
 */
export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: string; // Key in UIBridgeServerHandlers
  params?: string[]; // URL params to extract
  bodyRequired?: boolean;
}

/**
 * All UI Bridge routes
 */
export const UI_BRIDGE_ROUTES: RouteDefinition[] = [
  // Render log
  { method: 'GET', path: '/render-log', handler: 'getRenderLog' },
  { method: 'DELETE', path: '/render-log', handler: 'clearRenderLog' },
  { method: 'POST', path: '/render-log/snapshot', handler: 'captureSnapshot' },
  { method: 'GET', path: '/render-log/path', handler: 'getRenderLogPath' },

  // Control - Elements
  { method: 'GET', path: '/control/elements', handler: 'getElements' },
  { method: 'GET', path: '/control/element/:id', handler: 'getElement', params: ['id'] },
  { method: 'GET', path: '/control/element/:id/state', handler: 'getElementState', params: ['id'] },
  {
    method: 'POST',
    path: '/control/element/:id/action',
    handler: 'executeElementAction',
    params: ['id'],
    bodyRequired: true,
  },

  // Control - Components
  { method: 'GET', path: '/control/components', handler: 'getComponents' },
  { method: 'GET', path: '/control/component/:id', handler: 'getComponent', params: ['id'] },
  {
    method: 'GET',
    path: '/control/component/:id/state',
    handler: 'getComponentState',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/control/component/:id/action/:actionId',
    handler: 'executeComponentAction',
    params: ['id', 'actionId'],
    bodyRequired: true,
  },

  // Find (formerly Discovery)
  { method: 'POST', path: '/control/find', handler: 'find' },
  { method: 'POST', path: '/control/discover', handler: 'discover' }, // @deprecated Use /control/find
  { method: 'GET', path: '/control/snapshot', handler: 'getControlSnapshot' },

  // Workflows
  { method: 'GET', path: '/control/workflows', handler: 'getWorkflows' },
  { method: 'POST', path: '/control/workflow/:id/run', handler: 'runWorkflow', params: ['id'] },
  {
    method: 'GET',
    path: '/control/workflow/:runId/status',
    handler: 'getWorkflowStatus',
    params: ['runId'],
  },

  // Element event log
  {
    method: 'GET',
    path: '/debug/element-history/:id',
    handler: 'getElementHistory',
    params: ['id'],
  },

  // Debug
  { method: 'GET', path: '/debug/action-history', handler: 'getActionHistory' },
  { method: 'GET', path: '/debug/metrics', handler: 'getMetrics' },
  { method: 'POST', path: '/debug/highlight/:id', handler: 'highlightElement', params: ['id'] },
  { method: 'GET', path: '/debug/element-tree', handler: 'getElementTree' },
  { method: 'GET', path: '/control/console-errors', handler: 'getConsoleErrors' },
  { method: 'POST', path: '/control/console-errors/clear', handler: 'clearConsoleErrors' },

  // AI-native endpoints
  { method: 'POST', path: '/ai/search', handler: 'aiSearch', bodyRequired: true },
  { method: 'POST', path: '/ai/find', handler: 'aiFind', bodyRequired: true },
  { method: 'POST', path: '/ai/execute', handler: 'aiExecute', bodyRequired: true },
  { method: 'POST', path: '/ai/assert', handler: 'aiAssert', bodyRequired: true },
  { method: 'POST', path: '/ai/assert/batch', handler: 'aiAssertBatch', bodyRequired: true },
  { method: 'GET', path: '/ai/snapshot', handler: 'getSemanticSnapshot' },
  { method: 'GET', path: '/ai/diff', handler: 'getSemanticDiff' },
  { method: 'GET', path: '/ai/summary', handler: 'getPageSummary' },
  { method: 'POST', path: '/ai/semantic-search', handler: 'aiSemanticSearch', bodyRequired: true },

  // Change tracking
  {
    method: 'POST',
    path: '/ai/execute-with-diff',
    handler: 'executeWithDiff',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/ai/wait-for-change',
    handler: 'waitForChange',
    bodyRequired: true,
  },
  { method: 'GET', path: '/ai/categorize-last-diff', handler: 'categorizeLastDiff' },
  { method: 'POST', path: '/ai/scoped-diff', handler: 'getScopedDiff', bodyRequired: true },
  {
    method: 'POST',
    path: '/ai/summarize-diff',
    handler: 'summarizeDiff',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/ai/structured-changes',
    handler: 'analyzeStructuredChanges',
  },

  // Change buffer
  { method: 'POST', path: '/ai/change-buffer/enable', handler: 'enableChangeBuffer' },
  { method: 'POST', path: '/ai/change-buffer/disable', handler: 'disableChangeBuffer' },
  { method: 'POST', path: '/ai/change-buffer/drain', handler: 'drainChangeBuffer' },
  { method: 'GET', path: '/ai/change-buffer/size', handler: 'getChangeBufferSize' },

  // Snapshot bookmarks (static routes before parameterized)
  { method: 'POST', path: '/ai/bookmarks', handler: 'saveBookmark', bodyRequired: true },
  { method: 'GET', path: '/ai/bookmarks', handler: 'listBookmarks' },
  { method: 'GET', path: '/ai/bookmark/:name', handler: 'getBookmark', params: ['name'] },
  {
    method: 'DELETE',
    path: '/ai/bookmark/:name',
    handler: 'deleteBookmark',
    params: ['name'],
  },
  {
    method: 'GET',
    path: '/ai/bookmark/:name/diff',
    handler: 'diffFromBookmark',
    params: ['name'],
  },

  // State management (static routes before parameterized)
  { method: 'GET', path: '/control/states', handler: 'getStates' },
  { method: 'GET', path: '/control/states/active', handler: 'getActiveStates' },
  { method: 'GET', path: '/control/states/snapshot', handler: 'getStateSnapshot' },
  { method: 'POST', path: '/control/states/find-path', handler: 'findPath', bodyRequired: true },
  { method: 'POST', path: '/control/states/navigate', handler: 'navigateTo', bodyRequired: true },
  { method: 'GET', path: '/control/state/:id', handler: 'getState', params: ['id'] },
  { method: 'POST', path: '/control/state/:id/activate', handler: 'activateState', params: ['id'] },
  {
    method: 'POST',
    path: '/control/state/:id/deactivate',
    handler: 'deactivateState',
    params: ['id'],
  },
  { method: 'GET', path: '/control/state-groups', handler: 'getStateGroups' },
  {
    method: 'POST',
    path: '/control/state-group/:id/activate',
    handler: 'activateStateGroup',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/control/state-group/:id/deactivate',
    handler: 'deactivateStateGroup',
    params: ['id'],
  },
  { method: 'GET', path: '/control/transitions', handler: 'getTransitions' },
  {
    method: 'GET',
    path: '/control/transition/:id/can-execute',
    handler: 'canExecuteTransition',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/control/transition/:id/execute',
    handler: 'executeTransition',
    params: ['id'],
  },

  // Intent endpoints
  { method: 'GET', path: '/ai/intents', handler: 'listIntents' },
  { method: 'POST', path: '/ai/intents/execute', handler: 'executeIntent', bodyRequired: true },
  { method: 'POST', path: '/ai/intents/find', handler: 'findIntent', bodyRequired: true },
  { method: 'POST', path: '/ai/intents/register', handler: 'registerIntent', bodyRequired: true },
  {
    method: 'POST',
    path: '/ai/intents/execute-from-query',
    handler: 'executeIntentFromQuery',
    bodyRequired: true,
  },

  // Recovery endpoints
  {
    method: 'POST',
    path: '/ai/recovery/attempt',
    handler: 'attemptRecovery',
    bodyRequired: true,
  },

  // Cross-app analysis endpoints
  { method: 'GET', path: '/ai/analyze/data', handler: 'analyzePageData' },
  { method: 'GET', path: '/ai/analyze/regions', handler: 'analyzePageRegions' },
  { method: 'GET', path: '/ai/analyze/structured-data', handler: 'analyzeStructuredData' },
  {
    method: 'POST',
    path: '/ai/analyze/cross-app-compare',
    handler: 'crossAppCompare',
    bodyRequired: true,
  },

  // Page navigation
  { method: 'POST', path: '/control/page/refresh', handler: 'pageRefresh' },
  { method: 'POST', path: '/control/page/navigate', handler: 'pageNavigate', bodyRequired: true },
  { method: 'POST', path: '/control/page/back', handler: 'pageGoBack' },
  { method: 'POST', path: '/control/page/forward', handler: 'pageGoForward' },

  // Annotations (static routes before parameterized)
  { method: 'GET', path: '/annotations', handler: 'getAnnotations' },
  { method: 'GET', path: '/annotations/export', handler: 'exportAnnotations' },
  { method: 'GET', path: '/annotations/coverage', handler: 'getAnnotationCoverage' },
  { method: 'POST', path: '/annotations/import', handler: 'importAnnotations', bodyRequired: true },
  { method: 'GET', path: '/annotations/:id', handler: 'getAnnotation', params: ['id'] },
  {
    method: 'PUT',
    path: '/annotations/:id',
    handler: 'setAnnotation',
    params: ['id'],
    bodyRequired: true,
  },
  { method: 'DELETE', path: '/annotations/:id', handler: 'deleteAnnotation', params: ['id'] },

  // Performance diagnostics
  { method: 'GET', path: '/control/performance-entries', handler: 'getPerformanceEntries' },
  {
    method: 'POST',
    path: '/control/performance-entries/clear',
    handler: 'clearPerformanceEntries',
  },
  { method: 'GET', path: '/control/browser-events', handler: 'getBrowserEvents' },
  { method: 'GET', path: '/control/timeline', handler: 'getTimeline' },
  { method: 'GET', path: '/control/health', handler: 'getHealthReport' },
  { method: 'GET', path: '/control/network-chains', handler: 'getNetworkChains' },
  { method: 'POST', path: '/control/error-sessions/start', handler: 'startErrorSession' },
  { method: 'POST', path: '/control/error-sessions/end', handler: 'endErrorSession' },
  { method: 'GET', path: '/control/error-sessions', handler: 'getErrorSessions' },
  {
    method: 'POST',
    path: '/control/error-baselines/capture',
    handler: 'captureErrorBaseline',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/error-baselines/compare',
    handler: 'compareErrorBaseline',
    bodyRequired: true,
  },
  { method: 'GET', path: '/control/error-snapshots', handler: 'getErrorSnapshots' },
  { method: 'GET', path: '/control/error-report', handler: 'getErrorReport' },

  // Design review
  {
    method: 'GET',
    path: '/design/element/:id/styles',
    handler: 'getElementStyles',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/design/element/:id/state-styles',
    handler: 'getElementStateStyles',
    params: ['id'],
  },
  { method: 'POST', path: '/design/snapshot', handler: 'getDesignSnapshot' },
  {
    method: 'POST',
    path: '/design/responsive',
    handler: 'getResponsiveSnapshots',
    bodyRequired: true,
  },
  { method: 'POST', path: '/design/audit', handler: 'runDesignAudit' },
  {
    method: 'POST',
    path: '/design/style-guide/load',
    handler: 'loadStyleGuide',
    bodyRequired: true,
  },
  { method: 'GET', path: '/design/style-guide', handler: 'getStyleGuide' },
  { method: 'DELETE', path: '/design/style-guide', handler: 'clearStyleGuide' },

  // Quality evaluation
  { method: 'POST', path: '/design/evaluate', handler: 'evaluateQuality' },
  { method: 'GET', path: '/design/evaluate/contexts', handler: 'getQualityContexts' },
  { method: 'POST', path: '/design/evaluate/baseline', handler: 'saveBaseline' },
  { method: 'POST', path: '/design/evaluate/diff', handler: 'diffBaseline' },

  // Form state awareness
  { method: 'GET', path: '/control/forms', handler: 'getForms' },
  { method: 'POST', path: '/control/fill', handler: 'fillForm', bodyRequired: true },
  { method: 'POST', path: '/control/forms/snapshot', handler: 'snapshotForms' },
  {
    method: 'POST',
    path: '/control/forms/diff',
    handler: 'diffForms',
    bodyRequired: true,
  },

  // Clipboard
  { method: 'GET', path: '/control/clipboard', handler: 'getClipboard' },
  { method: 'POST', path: '/control/clipboard', handler: 'setClipboard', bodyRequired: true },

  // Network request monitoring (static routes before parameterized)
  { method: 'GET', path: '/control/network-requests', handler: 'getNetworkRequests' },
  {
    method: 'GET',
    path: '/control/network-requests/in-flight',
    handler: 'getNetworkRequestsInFlight',
  },
  {
    method: 'POST',
    path: '/control/network-requests/wait',
    handler: 'waitForNetworkRequest',
    bodyRequired: true,
  },
  {
    method: 'GET',
    path: '/control/network-request/:id',
    handler: 'getNetworkRequest',
    params: ['id'],
  },

  // Idle detection (static routes before parameterized)
  { method: 'GET', path: '/control/idle-status', handler: 'getIdleStatus' },
  { method: 'POST', path: '/control/wait-for-idle', handler: 'waitForIdle' },
  {
    method: 'POST',
    path: '/control/wait-for-targets',
    handler: 'waitForTargets',
    bodyRequired: true,
  },
  {
    method: 'GET',
    path: '/control/idle-status/:signal',
    handler: 'getIdleSignalStatus',
    params: ['signal'],
  },
  {
    method: 'POST',
    path: '/control/wait-for-idle/:signal',
    handler: 'waitForSignalIdle',
    params: ['signal'],
  },

  // Undo/redo awareness
  { method: 'GET', path: '/control/undo-state', handler: 'getUndoState' },
  { method: 'POST', path: '/control/undo', handler: 'executeUndo' },
  { method: 'POST', path: '/control/redo', handler: 'executeRedo' },

  // API discovery
  { method: 'GET', path: '/capabilities', handler: 'getCapabilities' },

  // Specs
  { method: 'GET', path: '/control/specs', handler: 'getSpecs' },

  // Heartbeat
  { method: 'POST', path: '/heartbeat', handler: 'receiveHeartbeat' },

  // Media discovery & analysis
  { method: 'POST', path: '/ai/media/find', handler: 'findMedia' },
  { method: 'POST', path: '/ai/media/audit/accessibility', handler: 'mediaAuditAccessibility' },
  { method: 'POST', path: '/ai/media/audit/performance', handler: 'mediaAuditPerformance' },
  { method: 'POST', path: '/ai/media/snapshot', handler: 'captureMediaSnapshot' },
  { method: 'POST', path: '/ai/media/compare', handler: 'compareMediaSnapshots' },
  { method: 'POST', path: '/ai/media/analyze', handler: 'analyzeMedia' },
  { method: 'POST', path: '/ai/media/analyze/batch', handler: 'analyzeMediaBatch' },
  { method: 'POST', path: '/ai/media/analyze/page', handler: 'analyzeMediaPage' },
];

/**
 * WebSocket message types
 */
export type WebSocketMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'event'
  | 'snapshot'
  | 'action'
  | 'error';

/**
 * WebSocket message
 */
export interface WebSocketMessage<T = unknown> {
  type: WebSocketMessageType;
  channel?: string;
  data?: T;
  error?: string;
  timestamp: number;
}
