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
import type { NativeServerConfig, NativeServerHandlers, NavigationProvider, RouteProvider, ScreenshotProvider, APIResponse, HandlerContext } from './types';
import type { BridgeEvent } from '../core/types';
import { createServerHandlers } from './handlers';
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

interface WsRoute {
  pattern: string;
  handler: HandlerKey;
}

const WS_ROUTES: readonly WsRoute[] = [
  // Health
  { pattern: 'health', handler: 'health' },

  // Elements
  { pattern: 'control/elements', handler: 'getElements' },
  { pattern: 'control/element/:id', handler: 'getElement' },
  { pattern: 'control/element/:id/state', handler: 'getElementState' },
  { pattern: 'control/element/:id/action', handler: 'executeAction' },

  // Components
  { pattern: 'control/components', handler: 'getComponents' },
  { pattern: 'control/component/:id', handler: 'getComponent' },
  { pattern: 'control/component/:id/action/:actionId', handler: 'executeComponentAction' },

  // Discovery
  { pattern: 'control/find', handler: 'find' },
  { pattern: 'control/snapshot', handler: 'getSnapshot' },
  { pattern: 'control/discover', handler: 'getSnapshot' },

  // Workflows
  { pattern: 'control/workflows', handler: 'getWorkflows' },
  { pattern: 'control/workflow/:id/run', handler: 'runWorkflow' },

  // Page Navigation
  { pattern: 'control/page/refresh', handler: 'pageRefresh' },
  { pattern: 'control/page/navigate', handler: 'pageNavigate' },
  { pattern: 'control/page/back', handler: 'pageGoBack' },
  { pattern: 'control/page/forward', handler: 'pageGoForward' },

  // Screenshot
  { pattern: 'control/screenshot', handler: 'getScreenshot' },

  // Design Review
  { pattern: 'design/element/:id/styles', handler: 'getElementStyles' },
  { pattern: 'design/element/:id/state-styles', handler: 'getElementStateStyles' },
  { pattern: 'design/snapshot', handler: 'getDesignSnapshot' },
  { pattern: 'design/responsive', handler: 'getResponsiveSnapshots' },
  { pattern: 'design/audit', handler: 'runDesignAudit' },
  { pattern: 'design/style-guide/load', handler: 'loadStyleGuide' },
  { pattern: 'design/style-guide', handler: 'getStyleGuide' },
  { pattern: 'design/style-guide/clear', handler: 'clearStyleGuide' },

  // Quality Evaluation
  { pattern: 'design/evaluate', handler: 'evaluateQuality' },
  { pattern: 'design/evaluate/contexts', handler: 'getQualityContexts' },
  { pattern: 'design/evaluate/baseline', handler: 'saveBaseline' },
  { pattern: 'design/evaluate/diff', handler: 'diffBaseline' },
];

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
    this.handlers = createServerHandlers(registry, executor);
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
        return { success: true, data: { success: true, url, timestamp: Date.now() }, timestamp: Date.now() };
      } catch (e: any) {
        return { success: false, error: `Navigation failed: ${e.message}`, timestamp: Date.now() };
      }
    };

    this.handlers.pageGoBack = async (): Promise<APIResponse<PageNavigationResponse>> => {
      if (!provider.back) {
        return { success: false, error: 'Back navigation not supported', timestamp: Date.now() };
      }
      try {
        provider.back();
        return { success: true, data: { success: true, timestamp: Date.now() }, timestamp: Date.now() };
      } catch (e: any) {
        return { success: false, error: `Back navigation failed: ${e.message}`, timestamp: Date.now() };
      }
    };
  }

  /**
   * Set a route provider for reporting the current navigation route.
   * When set, `control/snapshot` responses include `currentRoute` and `segments`.
   */
  setRouteProvider(provider: RouteProvider): void {
    this.handlers.getSnapshot = async () => {
      const snapshot = this.registry.createSnapshot({
        currentRoute: provider.getCurrentRoute(),
        segments: provider.getSegments?.(),
      });
      return { success: true, data: snapshot, timestamp: Date.now() };
    };
  }

  /**
   * Set a screenshot provider for native screen capture.
   * This enables `control/screenshot` on native.
   */
  setScreenshotProvider(provider: ScreenshotProvider): void {
    this.handlers.getScreenshot = async () => {
      try {
        const result = await provider.capture();
        return {
          success: true,
          data: { screenshot: result.base64, width: result.width, height: result.height },
          timestamp: Date.now(),
        };
      } catch (e: any) {
        return {
          success: false,
          error: `Screenshot capture failed: ${e.message}`,
          timestamp: Date.now(),
        };
      }
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
      return this.handleWaitForElement(id, params);
    }

    // sequence — execute steps in order, stop on first failure
    if (method === 'sequence') {
      return this.handleSequence(id, params);
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
   * Wait for an element to be registered, or resolve immediately if it already exists.
   * Returns a JsonRpcResponse JSON string.
   */
  private async handleWaitForElement(
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

      const cleanup = () => {
        settled = true;
        if (unsub) {
          unsub();
          unsub = null;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

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
    for (const route of WS_ROUTES) {
      const pathParams = parsePath(route.pattern, method);
      if (!pathParams) continue;

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
   */
  private async handleRequest(request: HTTPRequest): Promise<HTTPResponse> {
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
   * Route request to appropriate handler
   */
  private async routeRequest(request: HTTPRequest): Promise<APIResponse> {
    const { method, path, query, body } = request;

    // Health check
    if (method === 'GET' && path === '/ui-bridge/health') {
      return this.handlers.health({ params: {}, query, body });
    }

    // Elements
    if (method === 'GET' && path === '/ui-bridge/control/elements') {
      return this.handlers.getElements({ params: {}, query, body });
    }

    let params = parsePath('/ui-bridge/control/element/:id', path);
    if (method === 'GET' && params) {
      return this.handlers.getElement({ params, query, body });
    }

    params = parsePath('/ui-bridge/control/element/:id/state', path);
    if (method === 'GET' && params) {
      return this.handlers.getElementState({ params, query, body });
    }

    params = parsePath('/ui-bridge/control/element/:id/action', path);
    if (method === 'POST' && params) {
      return this.handlers.executeAction({ params, query, body });
    }

    // Components
    if (method === 'GET' && path === '/ui-bridge/control/components') {
      return this.handlers.getComponents({ params: {}, query, body });
    }

    params = parsePath('/ui-bridge/control/component/:id', path);
    if (method === 'GET' && params) {
      return this.handlers.getComponent({ params, query, body });
    }

    params = parsePath('/ui-bridge/control/component/:id/action/:actionId', path);
    if (method === 'POST' && params) {
      return this.handlers.executeComponentAction({ params, query, body });
    }

    // Discovery
    if (method === 'POST' && path === '/ui-bridge/control/find') {
      return this.handlers.find({ params: {}, query, body });
    }

    if (method === 'GET' && path === '/ui-bridge/control/snapshot') {
      return this.handlers.getSnapshot({ params: {}, query, body });
    }

    // Workflows
    if (method === 'GET' && path === '/ui-bridge/control/workflows') {
      return this.handlers.getWorkflows({ params: {}, query, body });
    }

    params = parsePath('/ui-bridge/control/workflow/:id/run', path);
    if (method === 'POST' && params) {
      return this.handlers.runWorkflow({ params, query, body });
    }

    // Page Navigation
    if (method === 'POST' && path === '/ui-bridge/control/page/refresh') {
      return this.handlers.pageRefresh({ params: {}, query, body });
    }
    if (method === 'POST' && path === '/ui-bridge/control/page/navigate') {
      return this.handlers.pageNavigate({ params: {}, query, body });
    }
    if (method === 'POST' && path === '/ui-bridge/control/page/back') {
      return this.handlers.pageGoBack({ params: {}, query, body });
    }
    if (method === 'POST' && path === '/ui-bridge/control/page/forward') {
      return this.handlers.pageGoForward({ params: {}, query, body });
    }
    if (method === 'GET' && path === '/ui-bridge/control/screenshot') {
      return this.handlers.getScreenshot({ params: {}, query, body });
    }
    if (method === 'POST' && path === '/ui-bridge/control/screenshot') {
      return this.handlers.getScreenshot({ params: {}, query, body });
    }

    // Design Review
    params = parsePath('/ui-bridge/design/element/:id/styles', path);
    if (method === 'GET' && params) {
      return this.handlers.getElementStyles({ params, query, body });
    }

    params = parsePath('/ui-bridge/design/element/:id/state-styles', path);
    if (method === 'POST' && params) {
      return this.handlers.getElementStateStyles({ params, query, body });
    }

    if (method === 'POST' && path === '/ui-bridge/design/snapshot') {
      return this.handlers.getDesignSnapshot({ params: {}, query, body });
    }

    if (method === 'POST' && path === '/ui-bridge/design/responsive') {
      return this.handlers.getResponsiveSnapshots({ params: {}, query, body });
    }

    if (method === 'POST' && path === '/ui-bridge/design/audit') {
      return this.handlers.runDesignAudit({ params: {}, query, body });
    }

    if (method === 'POST' && path === '/ui-bridge/design/style-guide/load') {
      return this.handlers.loadStyleGuide({ params: {}, query, body });
    }

    if (method === 'GET' && path === '/ui-bridge/design/style-guide') {
      return this.handlers.getStyleGuide({ params: {}, query, body });
    }

    if (method === 'DELETE' && path === '/ui-bridge/design/style-guide') {
      return this.handlers.clearStyleGuide({ params: {}, query, body });
    }

    // Quality Evaluation
    if (method === 'POST' && path === '/ui-bridge/design/evaluate') {
      return this.handlers.evaluateQuality({ params: {}, query, body });
    }

    if (method === 'GET' && path === '/ui-bridge/design/evaluate/contexts') {
      return this.handlers.getQualityContexts({ params: {}, query, body });
    }

    if (method === 'POST' && path === '/ui-bridge/design/evaluate/baseline') {
      return this.handlers.saveBaseline({ params: {}, query, body });
    }

    if (method === 'POST' && path === '/ui-bridge/design/evaluate/diff') {
      return this.handlers.diffBaseline({ params: {}, query, body });
    }

    // Not found
    return {
      success: false,
      error: `Route not found: ${method} ${path}`,
      code: 'NOT_FOUND',
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
