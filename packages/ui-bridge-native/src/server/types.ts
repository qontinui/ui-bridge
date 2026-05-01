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
 * Navigation provider for React Native apps.
 *
 * Apps supply this to enable programmatic navigation via the UI Bridge
 * (e.g., `control/page/navigate` and `control/page/back`).
 * For Expo Router: pass `router.push` and `router.back`.
 */
export interface NavigationProvider {
  navigate: (url: string) => void;
  back?: () => void;
  /** Replace current route (no back-stack entry). For Expo Router: router.replace */
  replace?: (url: string) => void;
  /** Refresh the current route. For Expo Router: router.replace(currentPath) */
  refresh?: () => void;
}

/**
 * Screenshot provider for React Native apps.
 *
 * Apps supply this to enable screen capture via the UI Bridge
 * (`control/screenshot`). For react-native-view-shot: pass a function
 * that calls `captureRef` on the root view and returns base64 PNG data.
 */
export interface ScreenshotProvider {
  /** Capture the current screen and return base64-encoded PNG data (no data: prefix). */
  capture: () => Promise<{ base64: string; width: number; height: number }>;
}

/**
 * Route provider for React Native apps.
 *
 * Apps supply this to expose the current navigation route in UI Bridge snapshots.
 * For Expo Router: render a RouteTracker component inside the router context that
 * calls `usePathname()` / `useSegments()` and writes the result to a module-level ref.
 */
export interface RouteProvider {
  /** Return the current route path (e.g. "/(tabs)/runs"), or null if unknown. */
  getCurrentRoute: () => string | null;
  /** Return the current route segments (e.g. ["(tabs)", "runs"]), if available. */
  getSegments?: () => string[];
  /**
   * Subscribe to route changes. Required so the UI Bridge can clear stale
   * layouts on route changes with zero lag.
   *
   * Implementers must invoke `listener` synchronously whenever the route
   * changes, passing the new route (or null if unknown). The returned function
   * must unsubscribe the listener.
   *
   * For Expo Router: wrap your RouteTracker component in a module-level
   * listener set and call each listener from within the tracker's effect.
   */
  subscribe: (listener: (route: string | null) => void) => () => void;
}

/**
 * Server configuration
 */
export interface NativeServerConfig extends NativeUIBridgeConfig {
  /** Enable CORS */
  cors?: boolean;
  /** Allowed origins for CORS */
  allowedOrigins?: string[];
  /**
   * Enable test-only HTTP endpoints (currently `control/modal/push` and
   * `control/modal/dismiss/:id`) so external runners can drive registry
   * state. Default `false`; the React provider mirrors
   * `features.testHooks` into this slot.
   */
  testHooks?: boolean;
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
  PAGE_REPLACE: {
    method: 'POST',
    path: '/ui-bridge/control/page/replace',
    description: 'Replace current route without adding to back stack',
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

  // AI helpers
  AI_FILL_FORM: {
    method: 'POST',
    path: '/ui-bridge/ai/fill-form',
    description: 'Fill multiple input elements in a single call',
  },

  // Test hooks — drive ModalDetector state from outside the React tree
  // (gated by `features.testHooks`). Mirrors `pushModal` / `dismissModal`
  // calls that components normally make in-process.
  PUSH_MODAL: {
    method: 'POST',
    path: '/ui-bridge/control/modal/push',
    description: 'Push a modal onto the modal stack (testHooks)',
  },
  DISMISS_MODAL: {
    method: 'POST',
    path: '/ui-bridge/control/modal/dismiss/:id',
    description: 'Dismiss a modal by id (testHooks)',
  },

  // Health
  HEALTH: {
    method: 'GET',
    path: '/ui-bridge/health',
    description: 'Health check',
  },
};

/**
 * Request body for `POST /ai/fill-form`.
 *
 * The mobile native bridge has no `setValue` action — text inputs are driven
 * via the `type` action (which calls `onChangeText`). The fillForm handler
 * dispatches each field as `executor.executeAction(elementId, { action: 'type',
 * params: { text: value, clear: true } })` so existing values are atomically
 * replaced (matching the web bridge's "setValue" semantics).
 *
 * Shape mirrors the runner's `POST /ui-bridge/ai/fill-form` documented in
 * docs-site/api/runner-features.md (array-of-pairs form), so callers can use
 * the same JSON across mobile and web/runner without special-casing.
 */
export interface FillFormFieldInput {
  /** Target element id (registered id, testID, accessibilityLabel, etc.) */
  elementId: string;
  /** Text value to write into the input. */
  value: string;
}

export interface FillFormRequest {
  fields: FillFormFieldInput[];
}

/**
 * Per-field outcome returned by `POST /ai/fill-form`.
 */
export interface FillFormFieldResult {
  /** Element id from the request, echoed back. */
  elementId: string;
  /** Whether `executor.executeAction` reported success for this field. */
  success: boolean;
  /** Error message when `success === false`. Omitted on success. */
  error?: string;
}

/**
 * Response payload returned in `APIResponse.data` for `POST /ai/fill-form`.
 */
export interface FillFormResponse {
  results: FillFormFieldResult[];
  succeededCount: number;
  failedCount: number;
}

/**
 * Request body for `POST /control/modal/push`.
 *
 * Mirrors `ModalDetector.pushModal`'s `ModalPushInput` shape; `metadata` is
 * a free-form object the test runner can stash for later assertions but is
 * not currently surfaced in the snapshot.
 */
export interface PushModalRequest {
  id: string;
  title?: string;
  type?: string;
  blocking?: boolean;
  dismissible?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Response payload for `POST /control/modal/push`.
 */
export interface PushModalResponse {
  pushed: boolean;
  id: string;
  title?: string;
  type?: string;
  blocking?: boolean;
  dismissible?: boolean;
  pushedAt: number;
}

/**
 * Response payload for `POST /control/modal/dismiss/:id`.
 */
export interface DismissModalResponse {
  dismissed: string;
}

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
  runWorkflow: HandlerFunction<{
    runId: string;
    status: string;
    steps: Array<{
      stepId: string;
      type: string;
      status: string;
      result?: unknown;
      error?: string;
      durationMs: number;
    }>;
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    durationMs: number;
  }>;

  // Page Navigation
  pageRefresh: HandlerFunction<PageNavigationResponse>;
  pageNavigate: HandlerFunction<PageNavigationResponse>;
  pageReplace: HandlerFunction<PageNavigationResponse>;
  pageGoBack: HandlerFunction<PageNavigationResponse>;
  pageGoForward: HandlerFunction<PageNavigationResponse>;

  // Screenshot
  getScreenshot: HandlerFunction<{ screenshot: string; width: number; height: number }>;

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

  // Meta / Introspection
  getMethods: HandlerFunction<{
    methods: Array<{ method: string; httpMethods?: string[]; description?: string }>;
  }>;

  // AI helpers
  fillForm: HandlerFunction<FillFormResponse>;

  // Test hooks — modal stack manipulation
  pushModal: HandlerFunction<PushModalResponse>;
  dismissModal: HandlerFunction<DismissModalResponse>;

  // Health
  health: HandlerFunction<Record<string, unknown>>;
}
