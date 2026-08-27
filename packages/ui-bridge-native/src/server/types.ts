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

/** Device keep-awake capability, injected by the host app (expo-keep-awake is mobile-only). */
export interface KeepAwakeProvider {
  request(source: string, durationMs?: number): void;
  release(source: string): void;
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
   * Optionally return the currently-active tab id for the snapshot's
   * `activeTab` field. Only needed when the visible pane is decoupled from the
   * router; Expo Router apps can omit it and let the registry derive the value
   * from `getSegments()`.
   */
  getActiveTab?: () => string | null | undefined;
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
  /**
   * Enable the read-only observability capture (console.error/warn +
   * fetch/XHR ring buffers backing `GET /control/console-errors` and
   * `GET /sdk/network-requests`). When omitted, falls back to the
   * `testHooks` value so existing consumers are unchanged; set explicitly
   * to decouple release-build capture from the testHooks-gated control
   * surface. The React provider mirrors `features.observability` into
   * this slot.
   */
  observability?: boolean;
  /**
   * Viewport getter for `POST /control/page-health`.
   *
   * Injected by `UIBridgeNativeProvider` from `Dimensions.get('window')`.
   * Lives at config-injection level because importing react-native from
   * `handlers.ts` (or even `require('react-native')` with try/catch) crashed
   * the host RN app in 0.6.3/0.6.4: Metro/Hermes raised
   * `unknownModuleError` past every local try/catch and tore down the JS
   * thread (blank screen, React tree destroyed). The provider already has
   * a live import of `react-native`, so it's the safe injection point.
   *
   * When absent: `page-health` falls back to `body.viewport`, then `{0,0}`
   * (degenerate coverage report — no crash).
   */
  viewportProvider?: () => { width: number; height: number };
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
  DISCOVER: {
    method: 'GET',
    path: '/ui-bridge/control/discover',
    description: 'Discover elements (alias for snapshot; web/runner parity)',
  },
  PAGE_HEALTH: {
    method: 'POST',
    path: '/ui-bridge/control/page-health',
    description:
      'Holistic page health diagnostic: spatial coverage, layout regions, text signals, interactive readiness, anomalies + ASCII heatmap',
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

  // AI helpers (NOT_SUPPORTED stubs) — these endpoints exist on the runner-side
  // UI Bridge surface but have no analog on mobile React Native. The mobile
  // bridge registers explicit stubs so callers get a structured NOT_SUPPORTED
  // envelope instead of a confusing HTTP 404. The mobile bridge's snapshot +
  // `/control/find` already cover what an operator would reach for these for.
  AI_FORMS: {
    method: 'GET',
    path: '/ui-bridge/ai/forms',
    description: 'Discover forms (runner-only; mobile returns NOT_SUPPORTED)',
  },
  AI_IDLE_STATUS: {
    method: 'GET',
    path: '/ui-bridge/ai/idle-status',
    description: 'Get page-idle signal (runner-only; mobile returns NOT_SUPPORTED)',
  },
  AI_CHANGE_BUFFER_ENABLE: {
    method: 'POST',
    path: '/ui-bridge/ai/change-buffer/enable',
    description: 'Enable DOM change buffer (runner-only; mobile returns NOT_SUPPORTED)',
  },
  AI_WAIT_FOR_ELEMENT: {
    method: 'POST',
    path: '/ui-bridge/ai/wait-for-element',
    description: 'Wait for element predicate via HTTP (runner-only; mobile returns NOT_SUPPORTED — use WS waitForElement instead)',
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

  // Observability — last-N ring buffers (always mounted; `installed:false`
  // when the console/network patches are off, i.e. no testHooks).
  CONSOLE_ERRORS: {
    method: 'GET',
    path: '/ui-bridge/control/console-errors',
    description: 'Last-N captured console.error/console.warn entries',
  },
  NETWORK_REQUESTS: {
    method: 'GET',
    path: '/ui-bridge/sdk/network-requests',
    description: 'Last-N captured fetch/XHR requests with status + duration',
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
 * Request body for `POST /control/tap` — synthesize a press at given screen
 * coordinates by searching registered elements whose layout rect contains the
 * point.
 *
 * The handler picks the topmost (smallest-area) match — usually the innermost
 * child — then dispatches the requested action via the standard executor.
 * `action` defaults to `'press'`.
 */
export interface TapAtRequest {
  x: number;
  y: number;
  action?: 'press' | 'longPress' | 'doubleTap';
}

/**
 * Response payload returned in `APIResponse.data` for `POST /control/tap`.
 */
export interface TapAtResponse {
  /** Element id whose rect contained the tap coords. */
  elementId: string;
  /** Action that was dispatched. */
  action: 'press' | 'longPress' | 'doubleTap';
  /** The element's layout rect at dispatch time (best-effort). */
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
    pageX?: number;
    pageY?: number;
  } | null;
}

/**
 * Single console error/warn entry captured by the observability ring buffer.
 * Returned by `GET /control/console-errors`.
 */
export interface ConsoleErrorEntry {
  /** ms since epoch when the entry was captured. */
  timestamp: number;
  /** `'error'` or `'warn'`. */
  level: 'error' | 'warn';
  /** Joined message string (matches what console would have printed). */
  message: string;
  /** Captured stack trace if any of the args was an Error. */
  stack?: string;
}

/**
 * Response payload for `GET /control/console-errors`.
 */
export interface ConsoleErrorsResponse {
  entries: ConsoleErrorEntry[];
  /** Number of entries returned (post `since`/`limit` filtering). */
  count: number;
  /** Total entries currently held in the ring buffer (pre-filter). */
  bufferSize: number;
  /**
   * Whether the console capture patch is actively installed. `false` means
   * the endpoint is mounted and schema-valid but not observing — typically
   * because `features.testHooks` is off (production builds don't patch
   * `console.error`/`console.warn`). When `false`, `entries` is always empty.
   */
  installed: boolean;
}

/**
 * Single network request entry captured by the observability ring buffer.
 * Returned by `GET /sdk/network-requests`.
 */
export interface NetworkRequestEntry {
  /** ms since epoch at request start. */
  timestamp: number;
  /** HTTP method (uppercased). */
  method: string;
  /** Resolved request URL. */
  url: string;
  /** HTTP status code, or 0 if the request errored before a response. */
  status: number;
  /** Wall-clock duration in ms from start to settlement. */
  durationMs: number;
  /** Whether the request settled with a 2xx response. */
  ok: boolean;
  /** Error message when the request rejected before a response. */
  error?: string;
}

/**
 * Response payload for `GET /sdk/network-requests`.
 */
export interface NetworkRequestsResponse {
  entries: NetworkRequestEntry[];
  count: number;
  bufferSize: number;
  /**
   * Whether the network capture patch is actively installed. `false` means
   * the endpoint is mounted and schema-valid but not observing — typically
   * because `features.testHooks` is off (production builds don't patch
   * `fetch`/`XMLHttpRequest`). When `false`, `entries` is always empty.
   */
  installed: boolean;
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
  // Page health — structured diagnostic over the snapshot's elements +
  // device viewport. Output shape mirrors the runner/web analyzer so the
  // `page-health` skill is platform-neutral.
  getPageHealth: HandlerFunction<unknown>;

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

  // App-agnostic interaction parity — cross-platform contract shared with the
  // web/runner bridge (`/control/page/*`). Text/label-based interactions
  // compose find + executeAction over the registry; selector-only variants
  // return NOT_SUPPORTED on native (no DOM).
  clickByText: HandlerFunction<{ clicked: boolean; element?: unknown }>;
  clickBySelector: HandlerFunction<never>;
  typeInto: HandlerFunction<{ typed: boolean; element?: unknown }>;
  readValue: HandlerFunction<never>;
  findByText: HandlerFunction<
    Array<{ index: number; id: string; type: string; label?: string }>
  >;

  // AI helpers — NOT_SUPPORTED stubs (runner-only endpoints; see route table).
  // These return `error(..., 'NOT_SUPPORTED')` and exist so the mobile bridge
  // never 404s on cheatsheet endpoints that work on the runner.
  aiForms: HandlerFunction<never>;
  aiIdleStatus: HandlerFunction<never>;
  aiChangeBufferEnable: HandlerFunction<never>;
  aiWaitForElement: HandlerFunction<never>;

  // Coord-based tap — synthesizes a press at the given screen coords by
  // searching registered elements whose layout rect contains the point.
  tapAt: HandlerFunction<TapAtResponse>;

  // Observability — last-N ring buffers for console + network. Both are
  // gated behind `features.testHooks` at the route layer; the handlers
  // themselves return empty buffers when the buffers aren't installed.
  getConsoleErrors: HandlerFunction<ConsoleErrorsResponse>;
  getNetworkRequests: HandlerFunction<NetworkRequestsResponse>;

  // Test hooks — modal stack manipulation
  pushModal: HandlerFunction<PushModalResponse>;
  dismissModal: HandlerFunction<DismissModalResponse>;

  // Test hooks — device keep-awake (screen stays on for the duration)
  keepAwake: HandlerFunction<{ enabled: boolean; durationMs: number | null }>;

  // Health
  health: HandlerFunction<Record<string, unknown>>;
}
