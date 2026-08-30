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
import type { NativeActionExecutor } from '../control/types';
import type { NativeServerConfig, NativeServerHandlers, APIResponse } from './types';
import { UI_BRIDGE_NATIVE_ROUTES } from './types';
import { createServerHandlers } from './handlers';

// ── HTTP status mapping ─────────────────────────────────────────────────────

/**
 * HTTP status for each `APIResponse.code` that has an honest status of its own.
 *
 * PORT of `ERROR_CODE_HTTP_STATUS` in
 * `packages/ui-bridge-native/src/server/http-server.ts` (qontinui/ui-bridge#175).
 * That PR fixed only the sibling package and said so; this surface kept
 * answering a blanket `success ? 200 : 400`, so the two published React Native
 * surfaces gave different statuses for the same envelope. KEEP IN SYNC — the
 * two maps, and this function's body, are asserted equal by
 * `http-status-parity.test.ts`.
 *
 * ⚠️ SCOPE — #175 had TWO halves and only the status half is ported. Its
 * viewport-clipped visibility work (`computeVisibility`, `visibilityReason`,
 * `setViewportProvider`) lives in `packages/ui-bridge-native/src/core/registry.ts`
 * and has NO counterpart in this package's `src/native/core/registry.ts`, so a
 * snapshot from `@qontinui/ui-bridge/native` still carries no `visibility`
 * field at all while the sibling's carries a clipped three-value verdict. That
 * is a larger, separate port (it needs a viewport provider injected through
 * this package's own native provider) and it is deliberately not attempted
 * here. Do not read `http-status-parity.test.ts` as evidence that the two
 * surfaces agree generally — it pins one dimension.
 *
 * RESOURCE-level misses are deliberately NOT here. `ELEMENT_NOT_FOUND`,
 * `COMPONENT_NOT_FOUND` and `WORKFLOW_NOT_FOUND` (`handlers.ts`) keep 400: the
 * route resolved and served a request whose *argument* named nothing — a
 * client-input problem, not a routing one. Widening 404 to cover them would
 * make "this endpoint does not exist" and "this id does not exist" the same
 * status, which is the ambiguity this mapping exists to remove.
 *
 * `ACTION_FAILED` (`handlers.ts`) is NOT here either, and that is a decision
 * inherited rather than made: it keeps 400 on BOTH surfaces. It is the weakest
 * member of the 400 set — a host app's own `onPress` throwing surfaces as
 * `ACTION_FAILED`, and "you sent a bad request" is the wrong thing to tell a
 * client about a fault on the device. Changing it would re-open the divergence
 * this port closes, so it is named here and left alone; fix it on both surfaces
 * together or not at all.
 *
 * A `Map` rather than an object literal on purpose: a plain object resolves
 * inherited keys, so a `code` of `"toString"` or `"constructor"` would return a
 * FUNCTION where a status number is typed. Unreachable today — every `code` in
 * the tree is a hardcoded literal — but a `Map` costs nothing and closes it
 * structurally rather than by audit.
 */
const ERROR_CODE_HTTP_STATUS = new Map<string, number>([
  ['NOT_SUPPORTED', 501],
  ['NOT_FOUND', 404],
  ['METHOD_NOT_ALLOWED', 405],
]);

/**
 * Derive the HTTP status for a completed `APIResponse`.
 *
 * Every unsuccessful response used to be flattened to HTTP 400, which made a
 * deliberately-unimplemented route (`control/page/refresh` → `NOT_SUPPORTED`)
 * and a route that does not exist (`NOT_FOUND`) indistinguishable from a
 * malformed request — so callers retried request shapes against endpoints that
 * were never going to answer. The envelope's `code` already carries the
 * distinction; this maps it onto the status line so a caller reading only the
 * status gets the truth.
 */
export function httpStatusForResponse(response: APIResponse): number {
  if (response.success) return 200;
  const mapped = response.code ? ERROR_CODE_HTTP_STATUS.get(response.code) : undefined;
  return mapped ?? 400;
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
      serverPort: 9876,
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

  /**
   * Handle incoming HTTP request.
   *
   * PUBLIC, matching the sibling package (`ui-bridge-native`'s
   * `NativeUIBridgeServer.handleRequest`). Two callers need it without a socket:
   * a host driving the bridge in-process rather than over HTTP, and this
   * package's own tests, which assert the status line the `ServerAdapter`
   * contract hands back. It was private only by omission — `setAdapter` already
   * exposes the same code path to any adapter a consumer writes.
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

    try {
      const response = await this.routeRequest(request);
      return {
        status: httpStatusForResponse(response),
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

    // Batch actions
    if (method === 'POST' && path === '/ui-bridge/control/batch-actions') {
      return this.handlers.executeBatchAction({ params: {}, query, body });
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
    //
    // These four were DECLARED in three places and reachable from none:
    // `UI_BRIDGE_NATIVE_ROUTES` (`./types`) publishes their paths, the
    // `NativeServerHandlers` interface types them, `createServerHandlers`
    // implements them — and `routeRequest` had no branch for any of them, so a
    // consumer following the exported route table fell through to the
    // route-not-found tail below. Three layers of the same package disagreed
    // about whether the endpoint existed.
    //
    // The handlers answer `NOT_SUPPORTED` (HTTP 501 via
    // `httpStatusForResponse`) rather than doing anything: React Native has no
    // page to refresh. That is the point — "this platform will never do that"
    // is a different answer from "no such route", and it is the answer the
    // published route table promises. A host that has a navigation provider
    // overrides the handler; the route is what makes the override reachable.
    // Route-table/router parity is pinned by `route-table-parity.test.ts`.
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

    // Wrong verb on a path this package DOES publish → 405, not 404.
    //
    // The branches above match method and path together, so a right-path /
    // wrong-verb request used to fall through here and be reported as a route
    // that does not exist — which is what made `METHOD_NOT_ALLOWED` an entry in
    // `ERROR_CODE_HTTP_STATUS` that nothing could produce, and left this
    // surface answering 404 where the sibling answers 405 for the very same
    // request (`POST /ui-bridge/health`).
    //
    // The verb table is not re-declared: it is read off `UI_BRIDGE_NATIVE_ROUTES`,
    // the same exported constant a consumer reads, so the router cannot come to
    // disagree with the published contract about which verb a path takes. A
    // path absent from the table degrades to 404, which is the honest answer
    // for a route this package does not publish.
    const publishedUnderAnotherVerb = Object.values(UI_BRIDGE_NATIVE_ROUTES).some(
      (route) => route.method !== method && parsePath(route.path, path) !== null
    );
    if (publishedUnderAnotherVerb) {
      return {
        success: false,
        error: `Method not allowed: ${method} ${path}`,
        code: 'METHOD_NOT_ALLOWED',
        timestamp: Date.now(),
      };
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
