/**
 * UI Bridge Native HTTP Server
 *
 * Abstract HTTP server implementation for React Native.
 * This provides a framework-agnostic server interface that can be
 * implemented using various React Native HTTP server libraries.
 *
 * Supported libraries:
 * - react-native-http-bridge (recommended)
 * - @aspect/react-native-http-server
 * - Custom implementations
 */

import type { NativeUIBridgeRegistry } from '../core/registry';
import type { NativeActionExecutor, PageNavigationResponse } from '../control/types';
import type {
  NativeServerConfig,
  NativeServerHandlers,
  NavigationProvider,
  RouteProvider,
  ScreenshotProvider,
  KeepAwakeProvider,
  APIResponse,
  HandlerContext,
} from './types';
import type { BridgeEvent } from '../core/types';
import { createServerHandlers } from './handlers';
import { ConsoleErrorBuffer, NetworkRequestBuffer } from './observability';
import type { WebSocketEventBridge } from './ws-event-bridge';
import type { JsonRpcRequest, JsonRpcResponse } from './ws-types';
import { isBatchRequest, isSubscribe, isUnsubscribe } from './ws-types';

// ── Path pattern matching ───────────────────────────────────────────────────

/**
 * Match an actual path against a pattern with :name placeholders.
 * Returns extracted params, or null if the pattern does not match.
 *
 * Example: parsePath('control/element/:id/action', 'control/element/tab-runs/action')
 *          → { id: 'tab-runs' }
 */
function parsePath(pattern: string, actual: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const actualParts = actual.split('/');

  if (patternParts.length !== actualParts.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = actualParts[i];
    } else if (patternParts[i] !== actualParts[i]) {
      return null;
    }
  }
  return params;
}

// ── WebSocket route table ───────────────────────────────────────────────────

/**
 * Route table for WebSocket JSON-RPC methods.
 *
 * Method strings use the same path structure as HTTP routes (with :id placeholders)
 * but without the /ui-bridge/ prefix. Path params are extracted automatically.
 *
 * Examples:
 *   "health"                                       → handlers.health
 *   "control/snapshot"                             → handlers.getSnapshot
 *   "control/element/tab-runs/action"              → handlers.executeAction ({id: 'tab-runs'})
 *   "control/component/my-comp/action/submit"     → handlers.executeComponentAction
 */
type HandlerKey = keyof NativeServerHandlers;
type HttpVerb = 'GET' | 'POST' | 'DELETE';

interface WsRoute {
  pattern: string;
  handler: HandlerKey;
  /**
   * HTTP verbs this route accepts when invoked over HTTP. When absent the
   * route is WS-only (or matches any verb on HTTP). Multiple verbs allow
   * a single pattern to serve GET+POST etc.
   */
  httpMethods?: readonly HttpVerb[];
  /**
   * When true, the route is only mounted (HTTP + WS + manifest) when the
   * server config opts in via `testHooks`. Production builds default to
   * `testHooks: false` so these endpoints simply don't exist in the route
   * table — agents probing `/_routes` won't see them.
   */
  requiresTestHooks?: boolean;
}

const WS_ROUTES: readonly WsRoute[] = [
  // Health
  { pattern: 'health', handler: 'health', httpMethods: ['GET'] },

  // Elements
  { pattern: 'control/elements', handler: 'getElements', httpMethods: ['GET'] },
  // Flat alias — matches the runner UI Bridge's `/ui-bridge/elements` path so
  // agents can use the same URL across runner + mobile without remembering
  // the `control/` prefix. Delegates to the same handler.
  { pattern: 'elements', handler: 'getElements', httpMethods: ['GET'] },
  { pattern: 'control/element/:id', handler: 'getElement', httpMethods: ['GET'] },
  { pattern: 'control/element/:id/state', handler: 'getElementState', httpMethods: ['GET'] },
  { pattern: 'control/element/:id/action', handler: 'executeAction', httpMethods: ['POST'] },

  // Components
  { pattern: 'control/components', handler: 'getComponents', httpMethods: ['GET'] },
  { pattern: 'control/component/:id', handler: 'getComponent', httpMethods: ['GET'] },
  {
    pattern: 'control/component/:id/action/:actionId',
    handler: 'executeComponentAction',
    httpMethods: ['POST'],
  },

  // Discovery
  { pattern: 'control/find', handler: 'find', httpMethods: ['POST'] },
  // Runner-parity alias for `control/find`; the runner exposes its
  // AI-powered element search at `/ui-bridge/ai/find`, so mobile mounts the
  // same handler at both paths to keep agents portable across platforms.
  { pattern: 'ai/find', handler: 'find', httpMethods: ['POST'] },
  { pattern: 'control/snapshot', handler: 'getSnapshot', httpMethods: ['GET'] },
  // Discovery alias — web/runner parity with `POST /control/discover` (a
  // legacy alias for snapshot/find). Mounted on HTTP (GET+POST) so mobile
  // doesn't 404 where web returns 200; delegates to the snapshot handler.
  { pattern: 'control/discover', handler: 'getSnapshot', httpMethods: ['GET', 'POST'] },
  // Page health — accepts both GET and POST so the canonical skill invocation
  // (`POST .../control/page-health` with an empty body) and ad-hoc curls both
  // work without a body-shape gotcha.
  { pattern: 'control/page-health', handler: 'getPageHealth', httpMethods: ['GET', 'POST'] },

  // Workflows
  { pattern: 'control/workflows', handler: 'getWorkflows', httpMethods: ['GET'] },
  { pattern: 'control/workflow/:id/run', handler: 'runWorkflow', httpMethods: ['POST'] },

  // Page Navigation
  { pattern: 'control/page/refresh', handler: 'pageRefresh', httpMethods: ['POST'] },
  { pattern: 'control/page/navigate', handler: 'pageNavigate', httpMethods: ['POST'] },
  { pattern: 'control/page/replace', handler: 'pageReplace', httpMethods: ['POST'] },
  { pattern: 'control/page/back', handler: 'pageGoBack', httpMethods: ['POST'] },
  { pattern: 'control/page/forward', handler: 'pageGoForward', httpMethods: ['POST'] },

  // Screenshot — accepts both GET and POST on HTTP
  { pattern: 'control/screenshot', handler: 'getScreenshot', httpMethods: ['GET', 'POST'] },

  // Design Review
  { pattern: 'design/element/:id/styles', handler: 'getElementStyles', httpMethods: ['GET'] },
  {
    pattern: 'design/element/:id/state-styles',
    handler: 'getElementStateStyles',
    httpMethods: ['POST'],
  },
  { pattern: 'design/snapshot', handler: 'getDesignSnapshot', httpMethods: ['POST'] },
  { pattern: 'design/responsive', handler: 'getResponsiveSnapshots', httpMethods: ['POST'] },
  { pattern: 'design/audit', handler: 'runDesignAudit', httpMethods: ['POST'] },
  { pattern: 'design/style-guide/load', handler: 'loadStyleGuide', httpMethods: ['POST'] },
  { pattern: 'design/style-guide', handler: 'getStyleGuide', httpMethods: ['GET'] },
  // style-guide/clear: WS uses this pattern; HTTP uses DELETE on /design/style-guide.
  // We keep a WS-only entry for the explicit "clear" subpath, and add a DELETE-on-style-guide entry.
  { pattern: 'design/style-guide/clear', handler: 'clearStyleGuide' },
  { pattern: 'design/style-guide', handler: 'clearStyleGuide', httpMethods: ['DELETE'] },

  // Quality Evaluation
  { pattern: 'design/evaluate', handler: 'evaluateQuality', httpMethods: ['POST'] },
  { pattern: 'design/evaluate/contexts', handler: 'getQualityContexts', httpMethods: ['GET'] },
  { pattern: 'design/evaluate/baseline', handler: 'saveBaseline', httpMethods: ['POST'] },
  { pattern: 'design/evaluate/diff', handler: 'diffBaseline', httpMethods: ['POST'] },

  // Meta / Introspection
  { pattern: 'meta/methods', handler: 'getMethods', httpMethods: ['GET'] },

  // AI helpers — mobile parity with the runner's `/ui-bridge/ai/*` family.
  { pattern: 'ai/fill-form', handler: 'fillForm', httpMethods: ['POST'] },

  // AI helpers — NOT_SUPPORTED stubs. These endpoints exist on the runner-side
  // UI Bridge surface (and the /manual-test skill's cheatsheet documents them
  // as if they're universally available). Mobile React Native has no DOM, so
  // the mobile bridge mounts explicit stubs so callers get a structured
  // NOT_SUPPORTED envelope (with a hint pointing at the mobile-native
  // replacement) instead of a confusing HTTP 404.
  { pattern: 'ai/forms', handler: 'aiForms', httpMethods: ['GET'] },
  { pattern: 'ai/idle-status', handler: 'aiIdleStatus', httpMethods: ['GET'] },
  {
    pattern: 'ai/change-buffer/enable',
    handler: 'aiChangeBufferEnable',
    httpMethods: ['POST'],
  },
  {
    pattern: 'ai/wait-for-element',
    handler: 'aiWaitForElement',
    httpMethods: ['POST'],
  },

  // Coord-based tap — synthesizes a press at the given screen coords by
  // matching against registered elements' layout rects.
  { pattern: 'control/tap', handler: 'tapAt', httpMethods: ['POST'] },

  // App-agnostic interaction parity — mirrors the web/runner convenience
  // endpoints (`/control/page/click-by-text` etc.) so the SAME cross-platform
  // contract drives mobile. Text/label-based interactions compose
  // `executor.find` + `executor.executeAction` over the registry; the
  // DOM-selector-only variants (`click-by-selector`, `read-value`) have no RN
  // analog and return a structured NOT_SUPPORTED envelope.
  { pattern: 'control/page/click-by-text', handler: 'clickByText', httpMethods: ['POST'] },
  { pattern: 'control/page/click-by-selector', handler: 'clickBySelector', httpMethods: ['POST'] },
  { pattern: 'control/page/type-into', handler: 'typeInto', httpMethods: ['POST'] },
  { pattern: 'control/page/read-value', handler: 'readValue', httpMethods: ['POST'] },
  { pattern: 'control/page/find-by-text', handler: 'findByText', httpMethods: ['POST'] },

  // Test hooks — gated behind `features.testHooks`. Let external runners
  // drive the ModalDetector over HTTP so tests can flip `snapshot.modalStack`
  // without mounting React components.
  {
    pattern: 'control/modal/push',
    handler: 'pushModal',
    httpMethods: ['POST'],
    requiresTestHooks: true,
  },
  {
    pattern: 'control/modal/dismiss/:id',
    handler: 'dismissModal',
    httpMethods: ['POST'],
    requiresTestHooks: true,
  },
  {
    pattern: 'control/keep-awake',
    handler: 'keepAwake',
    httpMethods: ['POST'],
    requiresTestHooks: true,
  },

  // Observability — last-N console errors + network requests.
  //
  // Always mounted (not testHooks-gated) so they return a schema-valid 200
  // on every build instead of a 404 that agents can't distinguish from a
  // missing route. The INVASIVE part — monkey-patching `console.error` /
  // `fetch` / `XMLHttpRequest` — stays gated behind `testHooks` (see
  // NativeUIBridgeServer.start → buffer.install()). When the patches aren't
  // installed the handlers report `installed: false` + empty entries, so
  // production builds expose the contract without observing real users'
  // console/network traffic. Set `features.testHooks` (typically on
  // `__DEV__`) to populate the buffers with live data.
  {
    pattern: 'control/console-errors',
    handler: 'getConsoleErrors',
    httpMethods: ['GET'],
  },
  {
    pattern: 'sdk/network-requests',
    handler: 'getNetworkRequests',
    httpMethods: ['GET'],
  },
];

// ── _help payload ───────────────────────────────────────────────────────────

/**
 * Short description keyed by handler name — rendered alongside the route
 * list so `_help` is self-documenting. Only needs to cover handlers that
 * appear in WS_ROUTES.
 */
const HANDLER_DESCRIPTIONS: Record<string, string> = {
  health: 'Liveness probe; returns app metadata + element count',
  getElements: 'Flat list of registered UI elements',
  getElement: 'Single element by id',
  getElementState: 'Dynamic state (value, focused, checked) for one element',
  executeAction: 'Run an action on an element (see "actions" below for names)',
  getComponents: 'Higher-level components with action schemas',
  getComponent: 'Component detail + per-action paramSchema',
  executeComponentAction: 'Invoke a component action directly (preferred over button clicks)',
  find: 'AI-powered element search by natural-language query',
  getSnapshot:
    'Full snapshot: elements + route + state. Supports ?visibleOnly=true and ?currentRouteOnly=true',
  getPageHealth:
    'Holistic page health diagnostic over current snapshot elements (spatial coverage, layout regions, text/anomaly signals, heatmap). Optional body: { viewport?: { width, height } } to override Dimensions.get("window").',
  getWorkflows: 'List registered workflows',
  runWorkflow: 'Trigger a workflow by id',
  pageRefresh: 'Reload the current route',
  pageNavigate: 'Imperative router.push(url) — preferred over tapping tab buttons',
  pageReplace: 'router.replace(url)',
  pageGoBack: 'router.back()',
  pageGoForward: 'router.forward()',
  getScreenshot: 'PNG screenshot of the current screen',
  getElementStyles: 'Computed styles for an element (design review)',
  getElementStateStyles: 'Computed styles per interaction state (hover/focus/disabled)',
  getDesignSnapshot: 'Visual + style snapshot for design review',
  getResponsiveSnapshots: 'Screenshots at multiple viewport widths',
  runDesignAudit: 'Accessibility + visual audit',
  loadStyleGuide: 'Load a design system style guide',
  getStyleGuide: 'Fetch the currently loaded style guide',
  clearStyleGuide: 'Unload the style guide',
  evaluateQuality: 'Score the current UI against a quality context',
  getQualityContexts: 'List available quality evaluation contexts',
  saveBaseline: 'Save a quality baseline snapshot',
  diffBaseline: 'Diff current UI against a saved baseline',
  getMethods: 'List every handler name (legacy introspection)',
  fillForm:
    'Fill multiple inputs in one call: body { fields: [{elementId, value}] } — each field dispatches `type` + `clear:true`',
  aiForms:
    'STUB — runner-only; mobile returns NOT_SUPPORTED. Use /control/snapshot + filter type==="input" instead.',
  aiIdleStatus:
    'STUB — runner-only; mobile returns NOT_SUPPORTED. Subscribe to registry events over WS for change signals.',
  aiChangeBufferEnable:
    'STUB — runner-only; mobile returns NOT_SUPPORTED. Use WS event subscriptions for change notifications.',
  aiWaitForElement:
    'STUB — runner-only; mobile returns NOT_SUPPORTED. Use the WS waitForElement / waitForCondition JSON-RPC methods.',
  tapAt:
    'Synthesize a press at given screen coords by matching registered element layout rects: body { x, y, action? }',
  clickByText:
    'App-agnostic: press the first element matching free-text (label/accessibilityLabel/testID): body { text, visibleOnly? }',
  clickBySelector:
    'STUB — selector-based; NOT_SUPPORTED on native (no DOM). Use clickByText or /control/find + /control/element/:id/action.',
  typeInto:
    'App-agnostic: type into the input matching a label: body { label, text, clear?, visibleOnly? }. (selector form is web-only)',
  readValue:
    'STUB — selector-based; NOT_SUPPORTED on native (no DOM). Use /control/element/:id/state to read a value.',
  findByText:
    'App-agnostic: list elements matching free-text (no press): body { text, visibleOnly? }',
  getConsoleErrors:
    'Last-N console.error/console.warn entries; ?since=<ms>&limit=<n>. `installed:false` when capture is off (no testHooks) — entries empty but schema-valid.',
  getNetworkRequests:
    'Last-N fetch/XHR entries with status + duration; ?since=<ms>&limit=<n>. `installed:false` when capture is off (no testHooks) — entries empty but schema-valid.',
  pushModal:
    'TEST HOOK — push a modal onto the snapshot.modalStack via the registry ModalDetector',
  dismissModal:
    'TEST HOOK — dismiss a modal by id from the snapshot.modalStack via the registry ModalDetector',
  keepAwake:
    'TEST HOOK — keep the device screen awake via the injected keepAwakeProvider: body { enabled: boolean, durationMs?: number }',
};

/** Static reference for common action names + their params. */
const ACTION_REFERENCE = [
  { name: 'press', aliases: ['click'], params: 'PressActionParams (optional position)' },
  { name: 'longPress', params: 'PressActionParams (optional position)' },
  { name: 'doubleTap', params: 'none' },
  {
    name: 'type',
    params:
      'TypeActionParams { text, delay?, clear? | clearFirst? } — `clear:true` replaces content atomically',
  },
  { name: 'clear', params: 'none — empties the input' },
  { name: 'focus', params: 'none' },
  { name: 'blur', params: 'none' },
  { name: 'scroll', params: 'ScrollActionParams { offset? {x,y}, to? }' },
  { name: 'swipe', params: 'SwipeActionParams { direction, distance }' },
  { name: 'toggle', params: 'none — flips boolean controls' },
];

/**
 * Minimal `{method, path}` list matching the runner's `/_routes` shape so
 * the same URL works across platforms. Expanded multi-verb routes into one
 * entry per verb. `testHooks` enables the gated `control/modal/*` endpoints.
 */
function buildRoutesPayload(testHooks: boolean) {
  const entries: Array<{ method: string; path: string }> = [];
  for (const r of WS_ROUTES) {
    if (!r.httpMethods) continue;
    if (r.requiresTestHooks && !testHooks) continue;
    for (const m of r.httpMethods) {
      entries.push({ method: m, path: `/ui-bridge/${r.pattern}` });
    }
  }
  // Expose the two discovery endpoints themselves so self-reference is clean.
  entries.push({ method: 'GET', path: '/ui-bridge/_help' });
  entries.push({ method: 'GET', path: '/ui-bridge/_routes' });
  entries.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { routes: entries, count: entries.length };
}

/**
 * Build the `/_help` payload: route index + action reference.
 * Cheap to compute; we don't cache since it's rarely called.
 * Routes that require `testHooks` are filtered out when the flag is off so
 * agents probing the manifest never see endpoints they can't call.
 */
function buildHelpPayload(testHooks: boolean) {
  return {
    version: 1,
    description: 'UI Bridge Native HTTP surface. Prefix every path with /ui-bridge/.',
    routes: WS_ROUTES.filter((r) => !r.requiresTestHooks || testHooks).map((r) => ({
      pattern: r.pattern,
      httpMethods: r.httpMethods ?? [],
      wsOnly: !r.httpMethods,
      handler: r.handler,
      description: HANDLER_DESCRIPTIONS[r.handler] ?? '',
    })),
    actions: ACTION_REFERENCE,
    tips: [
      'Start with `GET /ui-bridge/control/snapshot?visibleOnly=true` to see what the user actually sees.',
      'Prefer `control/component/:id/action/:actionId` over button presses — typed paramSchema, no button-id guessing.',
      'Use `pageNavigate` for tab switches instead of pressing tab buttons; gesture state often swallows clicks.',
      'The `type` action supports `clear:true` to replace existing text atomically in one call.',
    ],
  };
}

/**
 * HTTP Request interface (library-agnostic)
 */
export interface HTTPRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
}

/**
 * HTTP Response interface (library-agnostic)
 */
export interface HTTPResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Request handler type
 */
export type RequestHandler = (request: HTTPRequest) => Promise<HTTPResponse>;

/**
 * Server adapter interface
 *
 * Implement this interface to integrate with your chosen HTTP server library.
 */
export interface ServerAdapter {
  /** Start the server */
  start(port: number, handler: RequestHandler): Promise<void>;
  /** Stop the server */
  stop(): Promise<void>;
  /** Check if server is running */
  isRunning(): boolean;
}

/**
 * WebSocket-aware server adapter interface.
 *
 * Extends ServerAdapter with callbacks for WebSocket connections.
 * The adapter manages the raw TCP/WS layer; these callbacks let the
 * UI Bridge server handle message routing and event broadcasting.
 */
export interface WebSocketServerAdapter extends ServerAdapter {
  /** Called when a JSON text frame is received from a WS client. Returns response string or null. */
  onWebSocketMessage?: (connId: string, message: string) => Promise<string | null>;
  /** Called when a new WS connection is established after the HTTP 101 upgrade. */
  onWebSocketConnect?: (connId: string) => void;
  /** Called when a WS connection is closed or drops. */
  onWebSocketDisconnect?: (connId: string) => void;
  /** Send a message to a specific WS connection by ID. */
  sendToConnection?: (connId: string, message: string) => void;
  /** Send a message to all connected WS clients. */
  broadcast?: (message: string) => void;
}

/**
 * Native UI Bridge HTTP Server
 */
export class NativeUIBridgeServer {
  private config: NativeServerConfig;
  private handlers: NativeServerHandlers;
  private adapter?: ServerAdapter;
  private running = false;
  private keepAwakeProvider?: KeepAwakeProvider;
  /**
   * Per-connection cleanup thunks for in-flight waiters (waitForElement,
   * waitForCondition, ...). Aborted when a client disconnects so the
   * underlying timers/listeners don't leak.
   */
  private pendingWaiters = new Map<string, Set<() => void>>();

  /**
   * Observability ring buffers backing `/control/console-errors` and
   * `/sdk/network-requests`. Allocated unconditionally so the handler can
   * always read them, but the global patches (`install()`) only fire on
   * `start()` when `testHooks` is set — production builds don't monkey-patch.
   */
  private consoleErrorBuffer: ConsoleErrorBuffer;
  private networkRequestBuffer: NetworkRequestBuffer;

  constructor(
    private registry: NativeUIBridgeRegistry,
    private executor: NativeActionExecutor,
    config: NativeServerConfig = {}
  ) {
    this.config = {
      serverPort: 8087,
      cors: true,
      ...config,
    };
    this.consoleErrorBuffer = new ConsoleErrorBuffer();
    this.networkRequestBuffer = new NetworkRequestBuffer();
    // Mirror appInfo into the registry so `createSnapshot` includes it
    // automatically — keeps the default `getSnapshot` handler and any other
    // call site (e.g. context.createSnapshot, cloud-relay tunnels) on the
    // same code path without each having to thread `appInfo` through.
    if (this.config.appInfo) {
      this.registry.setAppInfo(this.config.appInfo);
    }
    this.handlers = createServerHandlers(registry, executor, {
      appInfo: this.config.appInfo,
      consoleErrorBuffer: this.consoleErrorBuffer,
      networkRequestBuffer: this.networkRequestBuffer,
      viewportProvider: this.config.viewportProvider,
    });

    // Set up method introspection from the route table
    this.handlers.getMethods = async () => {
      const testHooks = this.config.testHooks === true;
      const methods = WS_ROUTES.filter((r) => !r.requiresTestHooks || testHooks).map((r) => ({
        method: r.pattern,
        httpMethods: r.httpMethods ? [...r.httpMethods] : undefined,
      }));
      // Add special WebSocket-only methods not in the route table
      const wsMethods = [
        { method: 'waitForElement', description: 'Wait for an element to be registered' },
        { method: 'waitForCondition', description: 'Wait for an element state predicate' },
        { method: 'sequence', description: 'Execute a sequence of steps in order' },
        { method: 'events/history', description: 'Replay recent registry events' },
        { method: 'subscriptions/list', description: 'List current event subscriptions' },
      ];
      return {
        success: true,
        data: { methods: [...methods, ...wsMethods] },
        timestamp: Date.now(),
      };
    };
  }

  /**
   * Set the server adapter
   */
  setAdapter(adapter: ServerAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Set a navigation provider for programmatic route navigation.
   * This enables `control/page/navigate` and `control/page/back` on native.
   */
  setNavigationProvider(provider: NavigationProvider): void {
    this.handlers.pageNavigate = async (ctx): Promise<APIResponse<PageNavigationResponse>> => {
      const body = ctx.body as Record<string, unknown> | undefined;
      const url = body?.url;
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'Missing required "url" parameter', timestamp: Date.now() };
      }
      try {
        provider.navigate(url);
        return {
          success: true,
          data: { success: true, url, timestamp: Date.now() },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Navigation failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };

    this.handlers.pageReplace = async (ctx): Promise<APIResponse<PageNavigationResponse>> => {
      if (!provider.replace) {
        return {
          success: false,
          error: 'Replace navigation not supported by navigation provider',
          timestamp: Date.now(),
        };
      }
      const body = ctx.body as Record<string, unknown> | undefined;
      const url = body?.url;
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'Missing required "url" parameter', timestamp: Date.now() };
      }
      try {
        provider.replace(url);
        return {
          success: true,
          data: { success: true, url, timestamp: Date.now() },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Replace navigation failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };

    this.handlers.pageGoBack = async (): Promise<APIResponse<PageNavigationResponse>> => {
      if (!provider.back) {
        return { success: false, error: 'Back navigation not supported', timestamp: Date.now() };
      }
      try {
        provider.back();
        return {
          success: true,
          data: { success: true, timestamp: Date.now() },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Back navigation failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };

    this.handlers.pageRefresh = async (): Promise<APIResponse<PageNavigationResponse>> => {
      if (!provider.refresh) {
        return {
          success: false,
          error: 'Page refresh not supported by navigation provider',
          timestamp: Date.now(),
        };
      }
      try {
        provider.refresh();
        return {
          success: true,
          data: { success: true, timestamp: Date.now() },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Refresh failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };
  }

  /**
   * Set a route provider for reporting the current navigation route.
   * When set, `control/snapshot` responses include `currentRoute` and `segments`.
   *
   * Also forwards the provider into the registry so the *default*
   * `getSnapshot` handler (and any other call site of
   * `registry.createSnapshot`) reads the route too — without this the
   * cloud-relay/bare-server path returned `currentRoute: null` even when
   * a `RouteTracker` was wired, because that path never installed the
   * server-level handler override below.
   */
  setRouteProvider(provider: RouteProvider): void {
    this.registry.setRouteProvider(provider);
    // Override getElements to support currentRouteOnly filtering with real route data
    const baseGetElements = this.handlers.getElements;
    this.handlers.getElements = async (ctx: HandlerContext) => {
      const currentRouteOnly =
        ctx.query?.currentRouteOnly === 'true' ||
        (ctx.body as Record<string, unknown>)?.currentRouteOnly === true;

      // If currentRouteOnly requested and no explicit route param, inject the current route
      if (currentRouteOnly && !ctx.query?.route && !(ctx.body as Record<string, unknown>)?.route) {
        const currentRoute = provider.getCurrentRoute();
        if (currentRoute) {
          // Inject route into query so the base handler can filter by it
          ctx.query = { ...ctx.query, route: currentRoute };
        }
      }
      return baseGetElements(ctx);
    };

    this.handlers.getSnapshot = async (ctx: HandlerContext) => {
      const visibleOnly =
        ctx?.query?.visibleOnly === 'true' ||
        (ctx?.body as Record<string, unknown>)?.visibleOnly === true;
      const currentRouteOnly =
        ctx?.query?.currentRouteOnly === 'true' ||
        (ctx?.body as Record<string, unknown>)?.currentRouteOnly === true;
      const snapshot = this.registry.createSnapshot(
        {
          currentRoute: provider.getCurrentRoute(),
          segments: provider.getSegments?.(),
        },
        { visibleOnly, currentRouteOnly }
      );
      return { success: true, data: snapshot, timestamp: Date.now() };
    };
  }

  /**
   * Set a screenshot provider for native screen capture.
   * This enables `control/screenshot` on native.
   */
  setScreenshotProvider(provider: ScreenshotProvider): void {
    const SCREENSHOT_TIMEOUT_MS = 10_000;
    this.handlers.getScreenshot = async () => {
      try {
        const result = await Promise.race([
          provider.capture(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error(`Screenshot capture timed out after ${SCREENSHOT_TIMEOUT_MS}ms`)),
              SCREENSHOT_TIMEOUT_MS
            )
          ),
        ]);
        return {
          success: true,
          data: { screenshot: result.base64, width: result.width, height: result.height },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Screenshot capture failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };
  }

  /**
   * Set a keep-awake provider for native screen-wake control.
   * This enables `control/keep-awake` and arms the auto-arm hook in
   * handleRequest (every request keeps the screen alive for 60s).
   */
  setKeepAwakeProvider(provider: KeepAwakeProvider): void {
    this.keepAwakeProvider = provider;
    this.handlers.keepAwake = async (ctx) => {
      const { enabled, durationMs } = (ctx.body ?? {}) as {
        enabled?: unknown;
        durationMs?: unknown;
      };
      if (typeof enabled !== 'boolean') {
        return {
          success: false,
          error: 'enabled must be boolean',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        };
      }
      if (enabled) {
        provider.request('ui-bridge', typeof durationMs === 'number' ? durationMs : undefined);
      } else {
        provider.release('ui-bridge');
      }
      return {
        success: true,
        data: { enabled, durationMs: typeof durationMs === 'number' ? durationMs : null },
        timestamp: Date.now(),
      };
    };
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn('[ui-bridge-native] Server already running');
      return;
    }

    if (!this.adapter) {
      console.warn('[ui-bridge-native] No server adapter configured. Call setAdapter() first.');
      console.warn('[ui-bridge-native] See documentation for supported adapters.');
      return;
    }

    // Install observability patches before binding the port — gated behind
    // `testHooks` so production builds don't monkey-patch console/fetch.
    if (this.config.testHooks === true) {
      this.consoleErrorBuffer.install();
      this.networkRequestBuffer.install();
    }

    await this.adapter.start(this.config.serverPort!, this.handleRequest.bind(this));
    this.running = true;

    console.log(`[ui-bridge-native] HTTP server started on port ${this.config.serverPort}`);
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.running || !this.adapter) {
      return;
    }

    await this.adapter.stop();
    this.running = false;

    // Restore the original globals; idempotent if never installed.
    this.consoleErrorBuffer.uninstall();
    this.networkRequestBuffer.uninstall();

    console.log('[ui-bridge-native] HTTP server stopped');
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  // ── WebSocket Support ───────────────────────────────────────────────────

  private eventBridge?: WebSocketEventBridge;

  /**
   * Set the event bridge for WebSocket event broadcasting and subscriptions.
   */
  setEventBridge(bridge: WebSocketEventBridge): void {
    this.eventBridge = bridge;
  }

  /**
   * Handle a JSON-RPC message from a WebSocket client.
   * Parses the message, routes to the appropriate handler, and returns
   * a JSON string response (or null for events that need no response).
   */
  async handleWebSocketMessage(connId: string, rawMessage: string): Promise<string | null> {
    let msg: unknown;
    try {
      msg = JSON.parse(rawMessage);
    } catch {
      return JSON.stringify({
        error: 'Invalid JSON',
        timestamp: Date.now(),
      });
    }

    if (typeof msg !== 'object' || msg === null) {
      return JSON.stringify({
        error: 'Message must be a JSON object',
        timestamp: Date.now(),
      });
    }

    const message = msg as Record<string, unknown>;
    const id = (message.id as string | number | undefined) ?? 0;

    // Handle batch requests
    if (isBatchRequest(message)) {
      const results = await this.handleBatchRequest(message.batch);
      return JSON.stringify({ id, results });
    }

    // Handle subscribe
    if (isSubscribe(message)) {
      const events = message.params?.events || [];
      const throttleMs = message.params?.throttleMs;
      const ok = this.eventBridge?.handleSubscribe(connId, events, throttleMs) ?? false;
      return JSON.stringify({
        id,
        result: {
          success: ok,
          data: { subscribed: events },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // Handle unsubscribe
    if (isUnsubscribe(message)) {
      const events = message.params?.events || [];
      const ok = this.eventBridge?.handleUnsubscribe(connId, events) ?? false;
      return JSON.stringify({
        id,
        result: {
          success: ok,
          data: { unsubscribed: events },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    const method = message.method as string;
    const params = (message.params || {}) as Record<string, unknown>;

    // ── Connection-aware special methods ──────────────────────────────────

    // subscriptions/list — return current subscriptions + throttle for this connection
    if (method === 'subscriptions/list') {
      const events = this.eventBridge?.getSubscriptions(connId) ?? [];
      const throttleMs = this.eventBridge?.getThrottleMs(connId);
      return JSON.stringify({
        id,
        result: {
          success: true,
          data: { events, throttleMs: throttleMs ?? null },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // waitForElement — resolve when element is registered, or timeout
    if (method === 'waitForElement') {
      return this.handleWaitForElement(connId, id, params);
    }

    // waitForCondition — resolve when an element state predicate becomes true
    if (method === 'waitForCondition') {
      return this.handleWaitForCondition(connId, id, params);
    }

    // sequence — execute steps in order, stop on first failure
    if (method === 'sequence') {
      return this.handleSequence(id, params);
    }

    // events/history — replay recent events matching optional filter
    if (method === 'events/history') {
      const eventsFilter = Array.isArray(params.events) ? (params.events as string[]) : undefined;
      const since = typeof params.since === 'number' ? params.since : undefined;
      const limit = typeof params.limit === 'number' ? params.limit : undefined;
      const history = this.eventBridge?.getHistory({ events: eventsFilter, since }) ?? [];
      const sliced =
        limit !== undefined && limit > 0 && history.length > limit
          ? history.slice(history.length - limit)
          : history;
      return JSON.stringify({
        id,
        result: {
          success: true,
          data: { events: sliced },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // Standard JSON-RPC request

    if (!method) {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing "method" field',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    try {
      const apiResponse = await this.routeMethodToHandler(method, params);
      return JSON.stringify({ id, result: apiResponse } satisfies JsonRpcResponse);
    } catch (error) {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: error instanceof Error ? error.message : 'Internal error',
          code: 'INTERNAL_ERROR',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }
  }

  /**
   * Execute a batch of JSON-RPC requests concurrently.
   */
  async handleBatchRequest(batch: JsonRpcRequest[]): Promise<JsonRpcResponse[]> {
    return Promise.all(
      batch.map(async (req) => {
        try {
          const result = await this.routeMethodToHandler(
            req.method,
            (req.params || {}) as Record<string, unknown>
          );
          return { id: req.id, result } as JsonRpcResponse;
        } catch (error) {
          return {
            id: req.id,
            result: {
              success: false,
              error: error instanceof Error ? error.message : 'Internal error',
              code: 'INTERNAL_ERROR',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse;
        }
      })
    );
  }

  /**
   * Register an in-flight waiter's cleanup thunk under the given connection.
   * Returns an `unregister` thunk that the natural-resolution path should
   * call so the cleanup isn't re-invoked on disconnect.
   */
  private registerWaiter(connId: string, cleanup: () => void): () => void {
    let set = this.pendingWaiters.get(connId);
    if (!set) {
      set = new Set();
      this.pendingWaiters.set(connId, set);
    }
    set.add(cleanup);
    return () => {
      const s = this.pendingWaiters.get(connId);
      if (!s) return;
      s.delete(cleanup);
      if (s.size === 0) this.pendingWaiters.delete(connId);
    };
  }

  /**
   * Abort all pending waiters associated with a connection. Called by the
   * provider's WS disconnect handler so timers/listeners don't leak after
   * the client goes away.
   */
  abortWaitersForConnection(connId: string): void {
    const set = this.pendingWaiters.get(connId);
    if (!set) return;
    for (const cleanup of set) {
      try {
        cleanup();
      } catch (err) {
        console.warn('[ui-bridge-native] waiter cleanup threw:', err);
      }
    }
    this.pendingWaiters.delete(connId);
  }

  /**
   * Wait for an element to be registered, or resolve immediately if it already exists.
   * Returns a JsonRpcResponse JSON string.
   */
  private async handleWaitForElement(
    connId: string,
    id: string | number,
    params: Record<string, unknown>
  ): Promise<string> {
    const targetId = params.id;
    const timeout = typeof params.timeout === 'number' ? params.timeout : 10000;

    if (!targetId || typeof targetId !== 'string') {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing or invalid "id" parameter',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // Already registered — return immediately
    const existing = this.registry.getElement(targetId);
    if (existing) {
      return JSON.stringify({
        id,
        result: {
          success: true,
          data: {
            id: targetId,
            state: existing.getState(),
            identifier: existing.getIdentifier(),
            waited: false,
          },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // Wait for element:registered event with matching id, or timeout
    return new Promise<string>((resolve) => {
      let settled = false;
      let unsub: (() => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unregister: (() => void) | null = null;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (unsub) {
          unsub();
          unsub = null;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (unregister) {
          unregister();
          unregister = null;
        }
      };

      // Track this waiter so it can be aborted if the connection closes.
      unregister = this.registerWaiter(connId, () => {
        cleanup();
        resolve(
          JSON.stringify({
            id,
            result: {
              success: false,
              error: 'Connection closed before element was registered',
              code: 'CONNECTION_CLOSED',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      });

      unsub = this.registry.on('element:registered', (event: BridgeEvent) => {
        if (settled) return;
        const data = event.data as { id?: string } | undefined;
        if (data?.id !== targetId) return;

        cleanup();
        const el = this.registry.getElement(targetId);
        resolve(
          JSON.stringify({
            id,
            result: {
              success: true,
              data: {
                id: targetId,
                state: el?.getState() ?? null,
                identifier: el?.getIdentifier() ?? null,
                waited: true,
              },
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      });

      timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve(
          JSON.stringify({
            id,
            result: {
              success: false,
              error: `Timeout waiting for element: ${targetId}`,
              code: 'TIMEOUT',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      }, timeout);
    });
  }

  /**
   * Wait for an arbitrary element-state predicate to become true.
   *
   * Supported `condition` shapes:
   *   {field: "mounted"|"visible"|"enabled"|"focused", equals: boolean}
   *   {field: "layout", exists: true}
   *   {field: string, equals: unknown}  // generic: state[field] === equals
   *
   * Resolves immediately with `waited:false` if the predicate already
   * holds. Otherwise subscribes to `element:registered` and
   * `element:stateChanged` until the predicate matches or timeout fires.
   */
  private async handleWaitForCondition(
    connId: string,
    id: string | number,
    params: Record<string, unknown>
  ): Promise<string> {
    const targetId = params.elementId;
    const condition = params.condition as
      | { field?: string; equals?: unknown; exists?: boolean }
      | undefined;
    const timeout = typeof params.timeout === 'number' ? params.timeout : 10000;

    if (!targetId || typeof targetId !== 'string') {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing or invalid "elementId" parameter',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }
    if (!condition || typeof condition.field !== 'string') {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing or invalid "condition.field"',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    const evaluate = (state: Record<string, unknown> | null | undefined): boolean => {
      if (!state) return false;
      const value = state[condition.field as string];
      if (condition.exists === true) return value !== null && value !== undefined;
      if ('equals' in condition) return value === condition.equals;
      return false;
    };

    const makeResult = (state: Record<string, unknown> | null, waited: boolean) =>
      JSON.stringify({
        id,
        result: {
          success: true,
          data: { id: targetId, state, waited },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);

    // Fast path: already holds.
    const existing = this.registry.getElement(targetId);
    if (existing) {
      const state = existing.getState() as unknown as Record<string, unknown> | null;
      if (evaluate(state)) {
        return makeResult(state, false);
      }
    }

    return new Promise<string>((resolve) => {
      let settled = false;
      let unsubRegistered: (() => void) | null = null;
      let unsubStateChanged: (() => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unregister: (() => void) | null = null;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (unsubRegistered) {
          unsubRegistered();
          unsubRegistered = null;
        }
        if (unsubStateChanged) {
          unsubStateChanged();
          unsubStateChanged = null;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (unregister) {
          unregister();
          unregister = null;
        }
      };

      unregister = this.registerWaiter(connId, () => {
        cleanup();
        resolve(
          JSON.stringify({
            id,
            result: {
              success: false,
              error: 'Connection closed before condition was met',
              code: 'CONNECTION_CLOSED',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      });

      const checkAndResolve = () => {
        if (settled) return;
        const el = this.registry.getElement(targetId);
        if (!el) return;
        const state = el.getState() as unknown as Record<string, unknown> | null;
        if (evaluate(state)) {
          cleanup();
          resolve(makeResult(state, true));
        }
      };

      unsubRegistered = this.registry.on('element:registered', (event: BridgeEvent) => {
        if (settled) return;
        const data = event.data as { id?: string } | undefined;
        if (data?.id !== targetId) return;
        checkAndResolve();
      });

      unsubStateChanged = this.registry.on('element:stateChanged', (event: BridgeEvent) => {
        if (settled) return;
        const data = event.data as { id?: string } | undefined;
        if (data?.id !== targetId) return;
        checkAndResolve();
      });

      timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve(
          JSON.stringify({
            id,
            result: {
              success: false,
              error: `Timeout waiting for condition on element: ${targetId}`,
              code: 'TIMEOUT',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      }, timeout);
    });
  }

  /**
   * Execute a sequence of JSON-RPC steps in order, stopping on first failure.
   * Returns a JsonRpcResponse JSON string with per-step results.
   */
  private async handleSequence(
    id: string | number,
    params: Record<string, unknown>
  ): Promise<string> {
    const rawSteps = params.steps;

    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing or empty "steps" array',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    const steps = rawSteps as Array<{ method: string; params?: Record<string, unknown> }>;
    const results: Array<{ step: number; method: string; result: APIResponse }> = [];
    let allSuccess = true;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (!step || typeof step.method !== 'string') {
        results.push({
          step: i,
          method: String(step?.method ?? ''),
          result: {
            success: false,
            error: 'Step is missing "method" field',
            code: 'INVALID_REQUEST',
            timestamp: Date.now(),
          },
        });
        allSuccess = false;
        break;
      }

      try {
        const stepResult = await this.routeMethodToHandler(step.method, step.params ?? {});
        results.push({ step: i, method: step.method, result: stepResult });
        if (!stepResult.success) {
          allSuccess = false;
          break;
        }
      } catch (err) {
        results.push({
          step: i,
          method: step.method,
          result: {
            success: false,
            error: err instanceof Error ? err.message : 'Step execution failed',
            code: 'STEP_FAILED',
            timestamp: Date.now(),
          },
        });
        allSuccess = false;
        break;
      }
    }

    return JSON.stringify({
      id,
      result: {
        success: allSuccess,
        data: {
          completedSteps: results.length,
          totalSteps: steps.length,
          results,
        },
        timestamp: Date.now(),
      },
    } satisfies JsonRpcResponse);
  }

  /**
   * Route a JSON-RPC method string to the appropriate handler using path-style matching.
   *
   * Method strings mirror HTTP routes but without the /ui-bridge/ prefix.
   * Path params are extracted from :name placeholders in the route pattern.
   *
   * Examples:
   *   "health"                                           → handlers.health
   *   "control/snapshot"                                 → handlers.getSnapshot
   *   "control/element/tab-runs/action"                  → handlers.executeAction ({id:'tab-runs'})
   *   "control/component/my-comp/action/submit"          → handlers.executeComponentAction
   */
  private async routeMethodToHandler(
    method: string,
    params: Record<string, unknown>
  ): Promise<APIResponse> {
    const testHooks = this.config.testHooks === true;
    for (const route of WS_ROUTES) {
      const pathParams = parsePath(route.pattern, method);
      if (!pathParams) continue;

      // Test-hook routes are invisible over WS too when the flag is off.
      if (route.requiresTestHooks && !testHooks) continue;

      const ctx: HandlerContext = {
        params: pathParams,
        query:
          params.query && typeof params.query === 'object'
            ? (params.query as Record<string, string>)
            : {},
        body: params,
      };

      return this.handlers[route.handler](ctx);
    }

    return {
      success: false,
      error: `Unknown method: ${method}`,
      code: 'NOT_FOUND',
      timestamp: Date.now(),
    };
  }

  /**
   * Handle incoming HTTP request
   *
   * Exposed as public so that CloudRelayClient can call it directly (without
   * loopback TCP overhead) when processing tunneled requests.
   */
  async handleRequest(request: HTTPRequest): Promise<HTTPResponse> {
    // Add CORS headers if enabled
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.cors) {
      headers['Access-Control-Allow-Origin'] = this.config.allowedOrigins
        ? this.config.allowedOrigins.join(',')
        : '*';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return { status: 204, headers, body: '' };
    }

    // Auto-arm: when test hooks are enabled and a keep-awake provider is
    // wired, every incoming request keeps the screen alive for 60s so an
    // external runner driving the device never loses it to a screen lock.
    // Best-effort — must never throw and break the request. This is the
    // single chokepoint for HTTP, WS-tunnelled, and cloud-relay paths
    // (CloudRelayClient calls handleRequest directly).
    if (this.config.testHooks === true && this.keepAwakeProvider) {
      try {
        this.keepAwakeProvider.request('auto-arm', 60_000);
      } catch {
        /* keep-awake is best-effort; never break a request */
      }
    }

    try {
      const response = await this.routeRequest(request);
      return {
        status: response.success ? 200 : 400,
        headers,
        body: JSON.stringify(response),
      };
    } catch (error) {
      const errorResponse: APIResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        code: 'INTERNAL_ERROR',
        timestamp: Date.now(),
      };
      return {
        status: 500,
        headers,
        body: JSON.stringify(errorResponse),
      };
    }
  }

  /**
   * Route an HTTP request to the appropriate handler using WS_ROUTES.
   *
   * Strips the `/ui-bridge/` prefix from the path, then iterates the shared
   * WS_ROUTES table. Each route's `pattern` is matched against the stripped
   * path via the module-level `parsePath` helper; path params are merged
   * with the request body into a HandlerContext.
   *
   * `httpMethods` disambiguates routes that share a pattern but differ
   * by verb (e.g. GET vs DELETE on `design/style-guide`). A route without
   * `httpMethods` is WS-only and will not be matched on HTTP.
   */
  private async routeRequest(request: HTTPRequest): Promise<APIResponse> {
    const { method, path, query, body } = request;

    const PREFIX = '/ui-bridge/';
    if (!path.startsWith(PREFIX)) {
      return {
        success: false,
        error: `Route not found: ${method} ${path}`,
        code: 'NOT_FOUND',
        timestamp: Date.now(),
      };
    }

    const stripped = path.slice(PREFIX.length);

    // Discoverability:
    //   - `_help` (rich) — routes + action reference + tips
    //   - `_routes` (minimal) — runner-compatible shape for parity
    // Lets agents fetch a single URL on either runner or mobile to see what
    // they can do without reading docs.
    const testHooks = this.config.testHooks === true;

    if (method === 'GET' && stripped === '_help') {
      return {
        success: true,
        data: buildHelpPayload(testHooks),
        timestamp: Date.now(),
      };
    }
    if (method === 'GET' && stripped === '_routes') {
      return {
        success: true,
        data: buildRoutesPayload(testHooks),
        timestamp: Date.now(),
      };
    }

    let patternMatchedButWrongVerb = false;

    for (const route of WS_ROUTES) {
      const pathParams = parsePath(route.pattern, stripped);
      if (!pathParams) continue;

      // Pattern matches — now filter on HTTP verb.
      if (!route.httpMethods) {
        // WS-only route; don't serve on HTTP.
        continue;
      }
      // Route gated by `testHooks`: behave as if it isn't registered when
      // the flag is off so production builds get a vanilla NOT_FOUND.
      if (route.requiresTestHooks && !testHooks) {
        continue;
      }
      if (!route.httpMethods.includes(method as HttpVerb)) {
        patternMatchedButWrongVerb = true;
        continue;
      }

      const ctx: HandlerContext = { params: pathParams, query, body };
      return this.handlers[route.handler](ctx);
    }

    return {
      success: false,
      error: patternMatchedButWrongVerb
        ? `Method not allowed: ${method} ${path}`
        : `Route not found: ${method} ${path}`,
      code: patternMatchedButWrongVerb ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND',
      timestamp: Date.now(),
    };
  }
}

/**
 * Create a UI Bridge Native server
 */
export function createNativeServer(
  registry: NativeUIBridgeRegistry,
  executor: NativeActionExecutor,
  config?: NativeServerConfig
): NativeUIBridgeServer {
  return new NativeUIBridgeServer(registry, executor, config);
}

/**
 * Example adapter using react-native-http-bridge
 *
 * To use this adapter:
 * 1. Install: npm install react-native-http-bridge
 * 2. Link native modules
 * 3. Create adapter and pass to server
 *
 * ```tsx
 * import httpBridge from 'react-native-http-bridge';
 *
 * const adapter: ServerAdapter = {
 *   start: async (port, handler) => {
 *     httpBridge.start(port, 'ui-bridge', async (request) => {
 *       const response = await handler({
 *         method: request.type,
 *         path: request.url,
 *         headers: request.headers || {},
 *         query: parseQuery(request.url),
 *         body: request.postData ? JSON.parse(request.postData) : undefined,
 *       });
 *       httpBridge.respond(
 *         request.requestId,
 *         response.status,
 *         response.headers['Content-Type'],
 *         response.body
 *       );
 *     });
 *   },
 *   stop: async () => {
 *     httpBridge.stop();
 *   },
 *   isRunning: () => true,
 * };
 *
 * server.setAdapter(adapter);
 * await server.start();
 * ```
 */
