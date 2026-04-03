/**
 * Express Adapter
 *
 * Express.js middleware for UI Bridge server.
 */

import type { Router, Request, Response, NextFunction } from 'express';
import type {
  UIBridgeServerConfig,
  UIBridgeServerHandlers,
  APIResponse,
  RouteDefinition,
  CORSOptions,
} from './types';
import { UI_BRIDGE_ROUTES } from './types';
import type { SSEManager } from './sse-handler';

/**
 * Express-specific configuration
 */
export interface ExpressAdapterConfig extends UIBridgeServerConfig {
  /** Use JSON body parser (if not already configured) */
  useBodyParser?: boolean;
  /** SSE manager for streaming events (pass to enable GET /control/events/stream) */
  sseManager?: SSEManager;
}

/**
 * Create CORS middleware
 */
function createCORSMiddleware(options: CORSOptions | boolean) {
  const corsOptions: CORSOptions =
    typeof options === 'boolean'
      ? { origin: options, methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] }
      : options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Origin
    if (corsOptions.origin === true) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (typeof corsOptions.origin === 'string') {
      res.setHeader('Access-Control-Allow-Origin', corsOptions.origin);
    } else if (Array.isArray(corsOptions.origin)) {
      const origin = req.headers.origin;
      if (origin && corsOptions.origin.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    }

    // Methods
    if (corsOptions.methods) {
      res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    }

    // Headers
    if (corsOptions.headers) {
      res.setHeader('Access-Control-Allow-Headers', corsOptions.headers.join(', '));
    } else {
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With'
      );
    }

    // Credentials
    if (corsOptions.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Max age
    if (corsOptions.maxAge) {
      res.setHeader('Access-Control-Max-Age', String(corsOptions.maxAge));
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}

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

/**
 * Create Express router with UI Bridge routes
 */
export function createExpressRouter(
  handlers: Partial<UIBridgeServerHandlers>,
  config: ExpressAdapterConfig = {}
): Router {
  // Dynamic import to avoid bundling Express if not used
   
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  const router: Router = express.Router();

  // Add CORS middleware if configured
  if (config.cors) {
    router.use(createCORSMiddleware(config.cors));
  }

  // Add body parser if requested
  if (config.useBodyParser) {
    router.use(express.json());
  }

  // Add authentication middleware if configured
  if (config.authenticate) {
    router.use(async (req: Request, res: Response, next: NextFunction) => {
      try {
        const authenticated = await config.authenticate!(req);
        if (!authenticated) {
          res.status(401).json(wrapError('Unauthorized', 'UNAUTHORIZED'));
          return;
        }
        next();
      } catch (error) {
        res.status(500).json(wrapError(error as Error, 'AUTH_ERROR'));
      }
    });
  }

  // Register routes
  for (const route of UI_BRIDGE_ROUTES) {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';
    const path = route.path;
    const handlerName = route.handler as keyof UIBridgeServerHandlers;
    const handler = handlers[handlerName];

    if (!handler) {
      console.warn(`Handler not found for route: ${route.method} ${route.path}`);
      continue;
    }

    router[method](
      path,
      createRouteHandler(route, handler as (...args: unknown[]) => Promise<APIResponse<unknown>>)
    );
  }

  // SSE streaming endpoint (outside normal route pattern — holds connection open)
  if (config.sseManager) {
    const sse = config.sseManager;
    router.get('/control/events/stream', (req: Request, res: Response) => {
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
      res.flushHeaders();

      const types = req.query.types as string | undefined;
      const elements = req.query.elements as string | undefined;

      const clientId = sse.addClient(
        (data: string) => res.write(data),
        () => {
          if (!res.writableEnded) res.end();
        },
        types,
        elements
      );

      // Clean up on disconnect
      req.on('close', () => {
        sse.removeClient(clientId);
      });
    });

    // Change observation SSE stream — filters to snapshot:changed events only
    router.get('/control/changes/stream', (changesReq: Request, changesRes: Response) => {
      changesRes.setHeader('Content-Type', 'text/event-stream');
      changesRes.setHeader('Cache-Control', 'no-cache');
      changesRes.setHeader('Connection', 'keep-alive');
      changesRes.setHeader('X-Accel-Buffering', 'no');
      changesRes.flushHeaders();

      const clientId = sse.addClient(
        (data: string) => changesRes.write(data),
        () => {
          if (!changesRes.writableEnded) changesRes.end();
        },
        'snapshot:changed' // Pre-filter to change events only
      );

      changesReq.on('close', () => {
        sse.removeClient(clientId);
      });
    });
  }

  return router;
}

/**
 * Create a route handler from a route definition
 */
function createRouteHandler(
  route: RouteDefinition,
  handler: (...args: unknown[]) => Promise<APIResponse<unknown>>
) {
  return async (req: Request, res: Response) => {
    try {
      // Extract params
      const args: unknown[] = [];

      if (route.params) {
        for (const param of route.params) {
          args.push(req.params[param]);
        }
      }

      // Add body if required
      if (route.bodyRequired || route.method === 'POST') {
        args.push(req.body);
      }

      // Add query params for GET requests
      if (route.method === 'GET' && Object.keys(req.query).length > 0) {
        args.push(req.query);
      }

      const result = await handler(...args);
      res.json(result);
    } catch (error) {
      res.status(500).json(wrapError(error as Error, 'INTERNAL_ERROR'));
    }
  };
}

/**
 * Create Express app with UI Bridge routes
 *
 * Convenience function that creates a complete Express app with UI Bridge.
 */
export function createExpressApp(
  handlers: Partial<UIBridgeServerHandlers>,
  config: ExpressAdapterConfig = {}
): unknown {
   
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  const app = express();

  app.use(express.json());

  const basePath = config.basePath || '/ui-bridge';
  const router = createExpressRouter(handlers, { ...config, useBodyParser: false });

  app.use(basePath, router);

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  return app;
}

/**
 * Express middleware that adds UI Bridge to an existing app
 */
export function uiBridgeMiddleware(
  handlers: Partial<UIBridgeServerHandlers>,
  config: ExpressAdapterConfig = {}
): Router {
  return createExpressRouter(handlers, config);
}
