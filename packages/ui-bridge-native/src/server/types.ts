/**
 * UI Bridge Native Server Types
 *
 * Types for the embedded HTTP server.
 */

import type {
  NativeUIBridgeConfig,
  NativeActionResponse,
  NativeFindResponse,
  NativeBridgeSnapshot,
} from '../core/types';
import type { ComponentActionResponse, PageNavigationResponse } from '../control/types';
import type { ElementDesignData, StateStyles, ResponsiveSnapshot } from '../design/design-types';

/**
 * Server configuration
 */
export interface NativeServerConfig extends NativeUIBridgeConfig {
  /** Enable CORS */
  cors?: boolean;
  /** Allowed origins for CORS */
  allowedOrigins?: string[];
}

/**
 * Route definition
 */
export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
}

/**
 * All UI Bridge Native routes
 */
export const UI_BRIDGE_NATIVE_ROUTES: Record<string, RouteDefinition> = {
  // Control - Elements
  GET_ELEMENTS: {
    method: 'GET',
    path: '/ui-bridge/control/elements',
    description: 'List all registered elements',
  },
  GET_ELEMENT: {
    method: 'GET',
    path: '/ui-bridge/control/element/:id',
    description: 'Get element details',
  },
  GET_ELEMENT_STATE: {
    method: 'GET',
    path: '/ui-bridge/control/element/:id/state',
    description: 'Get element state',
  },
  EXECUTE_ACTION: {
    method: 'POST',
    path: '/ui-bridge/control/element/:id/action',
    description: 'Execute action on element',
  },

  // Control - Components
  GET_COMPONENTS: {
    method: 'GET',
    path: '/ui-bridge/control/components',
    description: 'List all registered components',
  },
  GET_COMPONENT: {
    method: 'GET',
    path: '/ui-bridge/control/component/:id',
    description: 'Get component details',
  },
  EXECUTE_COMPONENT_ACTION: {
    method: 'POST',
    path: '/ui-bridge/control/component/:id/action/:actionId',
    description: 'Execute component action',
  },

  // Discovery
  FIND: {
    method: 'POST',
    path: '/ui-bridge/control/find',
    description: 'Find elements matching criteria',
  },
  GET_SNAPSHOT: {
    method: 'GET',
    path: '/ui-bridge/control/snapshot',
    description: 'Get full bridge snapshot',
  },

  // Workflows
  GET_WORKFLOWS: {
    method: 'GET',
    path: '/ui-bridge/control/workflows',
    description: 'List all workflows',
  },
  RUN_WORKFLOW: {
    method: 'POST',
    path: '/ui-bridge/control/workflow/:id/run',
    description: 'Run a workflow',
  },

  // Page Navigation
  PAGE_REFRESH: {
    method: 'POST',
    path: '/ui-bridge/control/page/refresh',
    description: 'Refresh the current page',
  },
  PAGE_NAVIGATE: {
    method: 'POST',
    path: '/ui-bridge/control/page/navigate',
    description: 'Navigate to a URL',
  },
  PAGE_GO_BACK: {
    method: 'POST',
    path: '/ui-bridge/control/page/back',
    description: 'Go back in navigation history',
  },
  PAGE_GO_FORWARD: {
    method: 'POST',
    path: '/ui-bridge/control/page/forward',
    description: 'Go forward in navigation history',
  },

  // Design Review
  DESIGN_ELEMENT_STYLES: {
    method: 'GET',
    path: '/ui-bridge/design/element/:id/styles',
    description: 'Get computed styles for an element',
  },
  DESIGN_ELEMENT_STATE_STYLES: {
    method: 'POST',
    path: '/ui-bridge/design/element/:id/state-styles',
    description: 'Get state-specific styles for an element',
  },
  DESIGN_SNAPSHOT: {
    method: 'POST',
    path: '/ui-bridge/design/snapshot',
    description: 'Get design data for all or selected elements',
  },
  DESIGN_RESPONSIVE: {
    method: 'POST',
    path: '/ui-bridge/design/responsive',
    description: 'Get responsive snapshots (current device only on native)',
  },
  DESIGN_AUDIT: {
    method: 'POST',
    path: '/ui-bridge/design/audit',
    description: 'Run style guide audit on elements',
  },
  DESIGN_STYLE_GUIDE_LOAD: {
    method: 'POST',
    path: '/ui-bridge/design/style-guide/load',
    description: 'Load a style guide for audit',
  },
  DESIGN_STYLE_GUIDE_GET: {
    method: 'GET',
    path: '/ui-bridge/design/style-guide',
    description: 'Get currently loaded style guide',
  },
  DESIGN_STYLE_GUIDE_CLEAR: {
    method: 'DELETE',
    path: '/ui-bridge/design/style-guide',
    description: 'Clear loaded style guide',
  },

  // Health
  HEALTH: {
    method: 'GET',
    path: '/ui-bridge/health',
    description: 'Health check',
  },
};

/**
 * API response wrapper
 */
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  timestamp: number;
}

/**
 * Handler context
 */
export interface HandlerContext {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

/**
 * Handler function type
 */
export type HandlerFunction<T = unknown> = (context: HandlerContext) => Promise<APIResponse<T>>;

/**
 * Server handlers interface
 */
export interface NativeServerHandlers {
  // Elements
  getElements: HandlerFunction<{ elements: unknown[] }>;
  getElement: HandlerFunction<{ element: unknown }>;
  getElementState: HandlerFunction<{ state: unknown }>;
  executeAction: HandlerFunction<NativeActionResponse>;

  // Components
  getComponents: HandlerFunction<{ components: unknown[] }>;
  getComponent: HandlerFunction<{ component: unknown }>;
  executeComponentAction: HandlerFunction<ComponentActionResponse>;

  // Discovery
  find: HandlerFunction<NativeFindResponse>;
  getSnapshot: HandlerFunction<NativeBridgeSnapshot>;

  // Workflows
  getWorkflows: HandlerFunction<{ workflows: unknown[] }>;
  runWorkflow: HandlerFunction<{ runId: string; status: string }>;

  // Page Navigation
  pageRefresh: HandlerFunction<PageNavigationResponse>;
  pageNavigate: HandlerFunction<PageNavigationResponse>;
  pageGoBack: HandlerFunction<PageNavigationResponse>;
  pageGoForward: HandlerFunction<PageNavigationResponse>;

  // Design Review
  getElementStyles: HandlerFunction<ElementDesignData>;
  getElementStateStyles: HandlerFunction<{ elementId: string; stateStyles: StateStyles[] }>;
  getDesignSnapshot: HandlerFunction<{ elements: ElementDesignData[]; timestamp: number }>;
  getResponsiveSnapshots: HandlerFunction<ResponsiveSnapshot[]>;
  runDesignAudit: HandlerFunction<unknown>;
  loadStyleGuide: HandlerFunction<{ loaded: boolean }>;
  getStyleGuide: HandlerFunction<unknown>;
  clearStyleGuide: HandlerFunction<{ cleared: boolean }>;

  // Quality Evaluation
  evaluateQuality: HandlerFunction<unknown>;
  getQualityContexts: HandlerFunction<Array<{ name: string; description: string }>>;
  saveBaseline: HandlerFunction<{ saved: boolean; elementCount: number }>;
  diffBaseline: HandlerFunction<unknown>;

  // Health
  health: HandlerFunction<{ status: string; timestamp: number }>;
}
