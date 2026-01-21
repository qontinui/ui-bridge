/**
 * Standalone Server
 *
 * Standalone HTTP server for UI Bridge that can run independently.
 */

import type {
  UIBridgeServerConfig,
  UIBridgeServerHandlers,
  APIResponse,
  WebSocketMessage,
} from './types';
import { UI_BRIDGE_ROUTES } from './types';

/**
 * Standalone server configuration
 */
export interface StandaloneServerConfig extends UIBridgeServerConfig {
  /** Host to bind to */
  host?: string;
  /** Port to listen on */
  port?: number;
  /** Enable WebSocket support */
  websocket?: boolean;
  /** WebSocket port (defaults to port) */
  websocketPort?: number;
  /** Logging function */
  log?: (message: string) => void;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<
  Pick<StandaloneServerConfig, 'host' | 'port' | 'websocket' | 'websocketPort' | 'log'>
> = {
  host: 'localhost',
  port: 9876,
  websocket: false,
  websocketPort: 9876,
  log: console.log,
};

/**
 * Wrap error in API format
 */
function wrapError(error: Error | string, code?: string): APIResponse<never> {
  return {
    success: false,
    error: typeof error === 'string' ? error : error.message,
    code,
    timestamp: Date.now(),
  };
}

// WebSocket type (simplified to avoid requiring ws types)
interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
}

/**
 * Simple HTTP server implementation using Node.js built-in http module
 */
export class StandaloneServer {
  private server: import('http').Server | null = null;
  private config: Required<
    Pick<StandaloneServerConfig, 'host' | 'port' | 'websocket' | 'websocketPort' | 'log'>
  > &
    StandaloneServerConfig;
  private handlers: UIBridgeServerHandlers;
  private wsConnections: Set<WebSocketLike> = new Set();

  constructor(handlers: UIBridgeServerHandlers, config: StandaloneServerConfig = {}) {
    this.handlers = handlers;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const http = await import('http');

    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this.config.log(
          `UI Bridge server listening on http://${this.config.host}:${this.config.port}`
        );
        resolve();
      });

      this.server!.on('error', reject);
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Close WebSocket connections
    for (const ws of this.wsConnections) {
      ws.close();
    }
    this.wsConnections.clear();

    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Handle an HTTP request
   */
  private async handleRequest(
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse
  ): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const method = req.method || 'GET';
    const basePath = this.config.basePath || '/ui-bridge';

    // Add CORS headers
    if (this.config.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    // Handle preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (url.pathname === '/health') {
      this.sendJSON(res, { status: 'ok', timestamp: Date.now() });
      return;
    }

    // Remove base path
    let path = url.pathname;
    if (path.startsWith(basePath)) {
      path = path.slice(basePath.length) || '/';
    }

    // Find matching route
    const route = this.findRoute(path, method);
    if (!route) {
      this.sendJSON(res, wrapError('Not found', 'NOT_FOUND'), 404);
      return;
    }

    try {
      // Parse body for POST requests
      let body: unknown = {};
      if (method === 'POST') {
        body = await this.parseBody(req);
      }

      // Extract params
      const params = this.extractParams(path, route.path);

      // Get handler
      const handlerName = route.handler as keyof UIBridgeServerHandlers;
      const handler = this.handlers[handlerName];

      if (!handler) {
        this.sendJSON(res, wrapError('Not implemented', 'NOT_IMPLEMENTED'), 501);
        return;
      }

      // Build arguments
      const args: unknown[] = [];

      if (route.params) {
        for (const param of route.params) {
          args.push(params[param]);
        }
      }

      if (method === 'POST') {
        args.push(body);
      }

      if (method === 'GET') {
        const query = Object.fromEntries(url.searchParams);
        if (Object.keys(query).length > 0) {
          args.push(query);
        }
      }

      // Call handler
      const result = await (handler as (...args: unknown[]) => Promise<APIResponse<unknown>>)(
        ...args
      );
      this.sendJSON(res, result);
    } catch (error) {
      this.config.log(`Error handling ${method} ${path}: ${error}`);
      this.sendJSON(res, wrapError(error as Error, 'INTERNAL_ERROR'), 500);
    }
  }

  /**
   * Find a matching route
   */
  private findRoute(path: string, method: string): (typeof UI_BRIDGE_ROUTES)[0] | null {
    for (const route of UI_BRIDGE_ROUTES) {
      if (route.method !== method) continue;

      const routeRegex = route.path.replace(/:[^/]+/g, '([^/]+)').replace(/\//g, '\\/');

      const regex = new RegExp(`^${routeRegex}$`);
      if (regex.test(path)) {
        return route;
      }
    }
    return null;
  }

  /**
   * Extract params from path
   */
  private extractParams(path: string, routePath: string): Record<string, string> {
    const params: Record<string, string> = {};
    const routeParts = routePath.split('/');
    const pathParts = path.split('/');

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = pathParts[i];
      }
    }

    return params;
  }

  /**
   * Parse request body
   */
  private parseBody(req: import('http').IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Send JSON response
   */
  private sendJSON(res: import('http').ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * Broadcast a message to all WebSocket connections
   */
  broadcast(message: WebSocketMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.wsConnections) {
      if (ws.readyState === 1) {
        // OPEN
        ws.send(data);
      }
    }
  }

  /**
   * Get the server address
   */
  getAddress(): { host: string; port: number } | null {
    const address = this.server?.address();
    if (!address || typeof address === 'string') return null;
    return { host: this.config.host, port: address.port };
  }
}

/**
 * Create and start a standalone server
 */
export async function createStandaloneServer(
  handlers: UIBridgeServerHandlers,
  config?: StandaloneServerConfig
): Promise<StandaloneServer> {
  const server = new StandaloneServer(handlers, config);
  await server.start();
  return server;
}

/**
 * CLI entry point
 */
export async function startCLI(
  handlers: UIBridgeServerHandlers,
  args: string[] = process.argv.slice(2)
): Promise<void> {
  const config: StandaloneServerConfig = {};

  // Parse CLI args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === '--port' || arg === '-p') {
      config.port = parseInt(nextArg);
      i++;
    } else if (arg === '--host' || arg === '-h') {
      config.host = nextArg;
      i++;
    } else if (arg === '--cors') {
      config.cors = true;
    }
  }

  const server = await createStandaloneServer(handlers, config);

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}
