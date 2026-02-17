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

/**
 * Express-specific configuration
 */
export interface ExpressAdapterConfig extends UIBridgeServerConfig {
  /** Use JSON body parser (if not already configured) */
  useBodyParser?: boolean;
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
  handlers: UIBridgeServerHandlers,
  config: ExpressAdapterConfig = {}
): Router {
  // Dynamic import to avoid bundling Express if not used
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    const start = performance.now();
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
      const durationMs = Math.round(performance.now() - start);
      res.setHeader('X-Response-Time', `${durationMs}ms`);
      res.json({ ...result, durationMs });
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      res.setHeader('X-Response-Time', `${durationMs}ms`);
      res.status(500).json({ ...wrapError(error as Error, 'INTERNAL_ERROR'), durationMs });
    }
  };
}

/**
 * Create Express app with UI Bridge routes
 *
 * Convenience function that creates a complete Express app with UI Bridge.
 */
export function createExpressApp(
  handlers: UIBridgeServerHandlers,
  config: ExpressAdapterConfig = {}
): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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
  handlers: UIBridgeServerHandlers,
  config: ExpressAdapterConfig = {}
): Router {
  return createExpressRouter(handlers, config);
}
