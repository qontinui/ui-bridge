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
import type {
  NativeServerConfig,
  NativeServerHandlers,
  APIResponse,
} from './types';
import { createServerHandlers } from './handlers';

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
      console.warn(
        '[ui-bridge-native] No server adapter configured. Call setAdapter() first.'
      );
      console.warn(
        '[ui-bridge-native] See documentation for supported adapters.'
      );
      return;
    }

    await this.adapter.start(
      this.config.serverPort!,
      this.handleRequest.bind(this)
    );
    this.running = true;

    console.log(
      `[ui-bridge-native] HTTP server started on port ${this.config.serverPort}`
    );
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
    const parsePath = (
      pattern: string,
      actual: string
    ): Record<string, string> | null => {
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
