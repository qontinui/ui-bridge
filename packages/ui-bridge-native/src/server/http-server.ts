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
import type { NativeServerConfig, NativeServerHandlers, NavigationProvider, APIResponse, HandlerContext } from './types';
import { createServerHandlers } from './handlers';
import type { WebSocketEventBridge } from './ws-event-bridge';
import type { JsonRpcRequest, JsonRpcResponse } from './ws-types';
import { isBatchRequest, isSubscribe, isUnsubscribe } from './ws-types';

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
      const ok = this.eventBridge?.handleSubscribe(connId, events) ?? false;
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

    // Standard JSON-RPC request
    const method = message.method as string;
    const params = (message.params || {}) as Record<string, unknown>;

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
   * Route a JSON-RPC method string to the appropriate handler.
   *
   * Method strings use the same path structure as HTTP routes but without
   * the /ui-bridge/ prefix and with path params in the params object.
   *
   * Examples:
   *   "health"                                → handlers.health
   *   "control/snapshot"                      → handlers.getSnapshot
   *   "control/element/{id}/action"           → handlers.executeAction (id from params)
   *   "control/component/{id}/action/{actionId}" → handlers.executeComponentAction
   */
  private async routeMethodToHandler(
    method: string,
    params: Record<string, unknown>
  ): Promise<APIResponse> {
    const ctx: HandlerContext = {
      params: {} as Record<string, string>,
      query: {} as Record<string, string>,
      body: params,
    };

    // Extract path params from the params object (id, actionId, etc.)
    if (params.id) ctx.params.id = String(params.id);
    if (params.actionId) ctx.params.actionId = String(params.actionId);

    // Also pass query params if provided
    if (params.query && typeof params.query === 'object') {
      ctx.query = params.query as Record<string, string>;
    }

    switch (method) {
      // Health
      case 'health':
        return this.handlers.health(ctx);

      // Elements
      case 'control/elements':
        return this.handlers.getElements(ctx);
      case 'control/element':
        return this.handlers.getElement(ctx);
      case 'control/element/state':
        return this.handlers.getElementState(ctx);
      case 'control/element/action':
        return this.handlers.executeAction(ctx);

      // Components
      case 'control/components':
        return this.handlers.getComponents(ctx);
      case 'control/component':
        return this.handlers.getComponent(ctx);
      case 'control/component/action':
        return this.handlers.executeComponentAction(ctx);

      // Discovery
      case 'control/find':
        return this.handlers.find(ctx);
      case 'control/snapshot':
        return this.handlers.getSnapshot(ctx);
      case 'control/discover':
        return this.handlers.getSnapshot(ctx);

      // Workflows
      case 'control/workflows':
        return this.handlers.getWorkflows(ctx);
      case 'control/workflow/run':
        return this.handlers.runWorkflow(ctx);

      // Page Navigation
      case 'control/page/refresh':
        return this.handlers.pageRefresh(ctx);
      case 'control/page/navigate':
        return this.handlers.pageNavigate(ctx);
      case 'control/page/back':
        return this.handlers.pageGoBack(ctx);
      case 'control/page/forward':
        return this.handlers.pageGoForward(ctx);

      // Design Review
      case 'design/element/styles':
        return this.handlers.getElementStyles(ctx);
      case 'design/element/state-styles':
        return this.handlers.getElementStateStyles(ctx);
      case 'design/snapshot':
        return this.handlers.getDesignSnapshot(ctx);
      case 'design/responsive':
        return this.handlers.getResponsiveSnapshots(ctx);
      case 'design/audit':
        return this.handlers.runDesignAudit(ctx);
      case 'design/style-guide/load':
        return this.handlers.loadStyleGuide(ctx);
      case 'design/style-guide':
        return this.handlers.getStyleGuide(ctx);
      case 'design/style-guide/clear':
        return this.handlers.clearStyleGuide(ctx);

      // Quality Evaluation
      case 'design/evaluate':
        return this.handlers.evaluateQuality(ctx);
      case 'design/evaluate/contexts':
        return this.handlers.getQualityContexts(ctx);
      case 'design/evaluate/baseline':
        return this.handlers.saveBaseline(ctx);
      case 'design/evaluate/diff':
        return this.handlers.diffBaseline(ctx);

      default:
        return {
          success: false,
          error: `Unknown method: ${method}`,
          code: 'NOT_FOUND',
          timestamp: Date.now(),
        };
    }
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

    // Parse path parameters
    const parsePath = (pattern: string, actual: string): Record<string, string> | null => {
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
    };

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
