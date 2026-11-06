/**
 * Standalone Server
 *
 * Standalone HTTP server for UI Bridge that can run independently.
 * Supports both HTTP and WebSocket connections.
 */

import type {
  UIBridgeServerConfig,
  UIBridgeServerHandlers,
  APIResponse,
  WebSocketMessage,
} from './types';
import { UI_BRIDGE_ROUTES } from './types';
import { mapInternalErrorCode } from './error-mapper';
import { UIBridgeWSHandler, type WebSocketLike } from './websocket-handler';
import type { BridgeEvent } from '@qontinui/ui-bridge';

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
  /**
   * WebSocket port. Defaults to `port`: the WebSocket server then attaches to
   * the HTTP server's own listener instead of binding a second one.
   */
  websocketPort?: number;
  /** Logging function */
  log?: (message: string) => void;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<
  Pick<StandaloneServerConfig, 'host' | 'port' | 'websocket' | 'log'>
> = {
  host: 'localhost',
  port: 9876,
  websocket: false,
  log: console.log,
};

/** Largest request body the standalone server reads, in bytes. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * A request the server refuses before any handler runs: a malformed URL or
 * path parameter, a body that is not JSON, or a body over the size limit.
 */
class RequestRefusal extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Wrap error in API format
 */
function wrapError(error: Error | string, code?: string): APIResponse<never> {
  const message = typeof error === 'string' ? error : error.message;
  return {
    success: false,
    error: message,
    code: mapInternalErrorCode(code, message),
    timestamp: Date.now(),
  };
}

/**
 * Simple HTTP server implementation using Node.js built-in http module
 * with optional WebSocket support.
 */
export class StandaloneServer {
  private server: import('http').Server | null = null;
  private wsServer: unknown = null; // WebSocket.Server from 'ws' package
  private config: typeof DEFAULT_CONFIG & StandaloneServerConfig;
  private handlers: UIBridgeServerHandlers;
  private wsHandler: UIBridgeWSHandler | null = null;
  private wsConnections: Set<WebSocketLike> = new Set();

  constructor(handlers: UIBridgeServerHandlers, config: StandaloneServerConfig = {}) {
    this.handlers = handlers;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create WebSocket handler if enabled
    if (this.config.websocket) {
      this.wsHandler = new UIBridgeWSHandler(handlers, {
        verbose: true,
        log: this.config.log,
      });
    }
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const http = await import('http');

    this.server = http.createServer((req, res) => {
      // A rejection that escaped here would be unhandled and end the process.
      this.handleRequest(req, res).catch((error: unknown) => {
        this.config.log(`Error handling ${req.method} ${req.url}: ${error}`);
        if (res.headersSent) {
          res.destroy();
          return;
        }
        this.sendJSON(res, wrapError(String(error), 'INTERNAL_ERROR'), 500);
      });
    });

    // Start WebSocket server if enabled
    if (this.config.websocket && this.wsHandler) {
      await this.startWebSocketServer();
    }

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this.config.log(
          `UI Bridge server listening on http://${this.config.host}:${this.config.port}`
        );
        if (this.config.websocket) {
          const wsPort = this.config.websocketPort || this.config.port;
          this.config.log(
            `UI Bridge WebSocket server listening on ws://${this.config.host}:${wsPort}`
          );
        }
        resolve();
      });

      this.server!.on('error', reject);
    });
  }

  /**
   * Start WebSocket server
   */
  private async startWebSocketServer(): Promise<void> {
    try {
      // Dynamically import ws package
      const { WebSocketServer } = await import('ws');

      const wsPort = this.config.websocketPort || this.config.port;
      const useSamePort = wsPort === this.config.port;

      if (useSamePort && this.server) {
        // Attach to same HTTP server (upgrade handling)
        this.wsServer = new WebSocketServer({ server: this.server });
      } else {
        // Create separate WebSocket server
        this.wsServer = new WebSocketServer({
          host: this.config.host,
          port: wsPort,
        });
      }

      const wss = this.wsServer as {
        on(
          event: 'connection',
          callback: (ws: WebSocketLike, request?: { url?: string }) => void
        ): void;
        on(event: 'error', callback: (error: Error) => void): void;
        close(): void;
      };

      wss.on('connection', (ws, request) => {
        this.wsConnections.add(ws);
        // Forward the persisted tab id (?tabId=) so the client resumes its
        // server-side identity across reconnects instead of churning ids.
        let preferredId: string | undefined;
        const rawUrl = request?.url;
        if (rawUrl) {
          try {
            preferredId =
              new URL(rawUrl, 'http://localhost').searchParams.get('tabId') ?? undefined;
          } catch {
            /* malformed url — fall back to generated id */
          }
        }
        this.wsHandler!.handleConnection(ws, preferredId);

        ws.onclose = () => {
          this.wsConnections.delete(ws);
        };
      });

      wss.on('error', (error) => {
        this.config.log(`WebSocket server error: ${error.message}`);
      });
    } catch (_error) {
      // ws package not installed - WebSocket support disabled
      this.config.log(
        'Warning: WebSocket support requires the "ws" package. Install it with: npm install ws'
      );
      this.wsHandler = null;
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Close WebSocket handler
    if (this.wsHandler) {
      this.wsHandler.disconnectAll();
    }

    // Close WebSocket server
    if (this.wsServer) {
      const wss = this.wsServer as { close(): void };
      wss.close();
      this.wsServer = null;
    }

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
    // Only the path and query are read, so the base is fixed rather than built
    // from the client-supplied Host header (`Host: a b` is not a valid URL). An
    // origin-form target is appended to the base rather than resolved against
    // it, so `//x/path` stays a path instead of naming host `x`.
    let url: URL;
    try {
      // `*` is the asterisk-form target of `OPTIONS *`, which names no path.
      const target = !req.url || req.url === '*' ? '/' : req.url;
      url = target.startsWith('/') ? new URL(`http://localhost${target}`) : new URL(target);
    } catch {
      this.sendJSON(res, wrapError('Malformed request URL', 'INVALID_REQUEST'), 400);
      return;
    }
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

    // P2.2 — Endpoint discovery. Served before route matching so it works
    // even if no UIBridgeServerHandlers entry registers it.
    if (method === 'GET' && path === '/_routes') {
      const routes = UI_BRIDGE_ROUTES.map((r) => ({ method: r.method, path: r.path })).sort(
        (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
      );
      this.sendJSON(res, {
        success: true,
        data: { routes, count: routes.length },
        timestamp: Date.now(),
      });
      return;
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
      if (error instanceof RequestRefusal) {
        // An oversized body is left unread: close the connection after the
        // answer instead of letting Node drain the rest of it.
        if (error.status === 413) res.setHeader('Connection', 'close');
        this.sendJSON(res, wrapError(error, 'INVALID_REQUEST'), error.status);
        return;
      }
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
        // Decoded, as Express decodes them: `form%20submit` is `form submit`.
        try {
          params[routeParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
        } catch {
          throw new RequestRefusal(400, `Malformed path parameter: ${pathParts[i]}`);
        }
      }
    }

    return params;
  }

  /**
   * Parse a request body as JSON. An empty body is `{}`. The bytes are decoded
   * once, after the last chunk, so a multi-byte character split across two
   * chunks survives. A body declared JSON (or undeclared) that does not parse
   * is refused (400) rather than reaching the handler as `{}`. A body declared
   * as another type that does not parse is passed on as `{}`, not refused.
   */
  private parseBody(
    req: import('http').IncomingMessage,
    maxBytes = MAX_BODY_BYTES
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let refused = false;
      req.on('data', (chunk: string | Buffer) => {
        if (refused) return;
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        bytes += buf.length;
        if (bytes > maxBytes) {
          refused = true;
          // Stop reading but keep the socket, so the 413 can still be written.
          req.pause();
          reject(new RequestRefusal(413, 'Request body too large'));
          return;
        }
        chunks.push(buf);
      });
      req.on('end', () => {
        if (refused) return;
        const data = Buffer.concat(chunks).toString('utf8');
        if (!data.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          const type = req.headers['content-type'];
          if (type && !/[/+]json\b/i.test(type)) {
            resolve({});
            return;
          }
          reject(new RequestRefusal(400, 'Request body is not valid JSON'));
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
   * Broadcast a message to all WebSocket connections (legacy)
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
   * Broadcast an event to all subscribed WebSocket clients
   */
  broadcastEvent(event: BridgeEvent): void {
    if (this.wsHandler) {
      this.wsHandler.broadcastEvent(event);
    }
  }

  /**
   * Get WebSocket handler for direct access
   */
  getWSHandler(): UIBridgeWSHandler | null {
    return this.wsHandler;
  }

  /**
   * Get number of connected WebSocket clients
   */
  get wsClientCount(): number {
    return this.wsHandler?.clientCount ?? 0;
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
