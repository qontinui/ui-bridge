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
} from '../ai';
import type { ElementAnnotation, AnnotationConfig, AnnotationCoverage } from '../annotations';

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
  getControlSnapshot: () => Promise<APIResponse<ControlSnapshot>>;

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

  // AI-native endpoints
  { method: 'POST', path: '/ai/search', handler: 'aiSearch', bodyRequired: true },
  { method: 'POST', path: '/ai/execute', handler: 'aiExecute', bodyRequired: true },
  { method: 'POST', path: '/ai/assert', handler: 'aiAssert', bodyRequired: true },
  { method: 'POST', path: '/ai/assert/batch', handler: 'aiAssertBatch', bodyRequired: true },
  { method: 'GET', path: '/ai/snapshot', handler: 'getSemanticSnapshot' },
  { method: 'GET', path: '/ai/diff', handler: 'getSemanticDiff' },
  { method: 'GET', path: '/ai/summary', handler: 'getPageSummary' },
  { method: 'POST', path: '/ai/semantic-search', handler: 'aiSemanticSearch', bodyRequired: true },

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
