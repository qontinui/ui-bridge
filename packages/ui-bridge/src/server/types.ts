/**
 * UI Bridge Server Types
 *
 * Shared types for server adapters.
 */

import type { UIBridgeConfig } from '../core';
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
} from '../control';
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
import type { CapturedError } from '../debug/browser-capture-types';

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
  aiExecute: (request: NLActionRequest) => Promise<APIResponse<NLActionResponse>>;
  aiAssert: (request: AssertionRequest) => Promise<APIResponse<AssertionResult>>;
  aiAssertBatch: (request: BatchAssertionRequest) => Promise<APIResponse<BatchAssertionResult>>;
  getSemanticSnapshot: () => Promise<APIResponse<SemanticSnapshot>>;
  getSemanticDiff: (since?: number) => Promise<APIResponse<SemanticDiff | null>>;
  getPageSummary: () => Promise<APIResponse<string>>;

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
  }) => Promise<APIResponse<{ events: unknown[]; count: number }>>;

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

  // Debug
  { method: 'GET', path: '/debug/action-history', handler: 'getActionHistory' },
  { method: 'GET', path: '/debug/metrics', handler: 'getMetrics' },
  { method: 'POST', path: '/debug/highlight/:id', handler: 'highlightElement', params: ['id'] },
  { method: 'GET', path: '/debug/element-tree', handler: 'getElementTree' },
  { method: 'GET', path: '/control/console-errors', handler: 'getConsoleErrors' },
  { method: 'POST', path: '/control/console-errors/clear', handler: 'clearConsoleErrors' },

  // AI-native endpoints
  { method: 'POST', path: '/ai/search', handler: 'aiSearch', bodyRequired: true },
  { method: 'POST', path: '/ai/execute', handler: 'aiExecute', bodyRequired: true },
  { method: 'POST', path: '/ai/assert', handler: 'aiAssert', bodyRequired: true },
  { method: 'POST', path: '/ai/assert/batch', handler: 'aiAssertBatch', bodyRequired: true },
  { method: 'GET', path: '/ai/snapshot', handler: 'getSemanticSnapshot' },
  { method: 'GET', path: '/ai/diff', handler: 'getSemanticDiff' },
  { method: 'GET', path: '/ai/summary', handler: 'getPageSummary' },
  { method: 'POST', path: '/ai/semantic-search', handler: 'aiSemanticSearch', bodyRequired: true },

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
