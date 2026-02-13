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

  // Health
  health: HandlerFunction<{ status: string; timestamp: number }>;
}
