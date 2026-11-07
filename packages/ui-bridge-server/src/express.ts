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
import { mapInternalErrorCode } from './error-mapper';
import { MAX_BODY_BYTES, interpretJsonBody } from './request-body';

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
  const message = typeof error === 'string' ? error : error.message;
  return {
    success: false,
    error: message,
    code: mapInternalErrorCode(code, message),
    timestamp: Date.now(),
  };
}

/**
 * Read a JSON request body by the standalone server's rules (`parseBody` in
 * standalone.ts), so a body means the same thing through every adapter:
 *
 * - over `MAX_BODY_BYTES` (declared or read) is a 413, and the connection is
 *   closed rather than draining the rest;
 * - an empty or whitespace-only body is no body (the route supplies `{}`);
 * - any JSON value parses, top-level primitives included;
 * - a body that does not parse is a 400 when it is declared JSON (`/json`,
 *   `+json`) or undeclared, and no body when it is declared as another type.
 *
 * A body a parser earlier in the stack already read, or a stream it already
 * consumed, is left alone.
 */
function jsonBody() {
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = req as unknown as { _body?: boolean; body?: unknown };
    const length = req.headers['content-length'];
    const hasBody =
      req.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
    // A stream an earlier middleware already consumed will never emit 'end'
    // again: skip it rather than wait on it.
    if (raw._body || !hasBody || req.readableEnded) {
      next();
      return;
    }
    const tooLarge = () => {
      res.setHeader('Connection', 'close');
      res.status(413).json(wrapError('Request body too large', 'INVALID_REQUEST'));
    };
    if (Number(length) > MAX_BODY_BYTES) {
      tooLarge();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    req.on('data', (chunk: string | Buffer) => {
      if (settled) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buf.length;
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        req.pause();
        tooLarge();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      raw._body = true;
      const read = interpretJsonBody(
        Buffer.concat(chunks).toString('utf8'),
        req.headers['content-type']
      );
      if (!read.ok) {
        res.status(read.status).json(wrapError(read.message, 'INVALID_REQUEST'));
        return;
      }
      if (read.body !== undefined) raw.body = read.body;
      next();
    });
    req.on('error', () => {
      if (settled) return;
      settled = true;
      res.status(400).json(wrapError('Request body could not be read', 'INVALID_REQUEST'));
    });
    // Restart a stream an earlier middleware paused; a no-op otherwise.
    req.resume();
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

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  const router: Router = express.Router();

  // Add CORS middleware if configured
  if (config.cors) {
    router.use(createCORSMiddleware(config.cors));
  }

  // Add body parser if requested: the standalone server's rules, not
  // `express.json()` (100 KB default, strict mode, `application/json` only,
  // and a 400 for an empty JSON-declared POST).
  if (config.useBodyParser) {
    router.use(jsonBody());
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

  // P2.2 — Endpoint discovery. Returns every (method, path) pair sorted by
  // path so SDKs and tests can introspect what the server exposes without
  // grepping the source. Mirrors the `/ui-bridge/_routes` endpoint on the
  // runner.
  router.get('/_routes', (_req: Request, res: Response) => {
    const routes = UI_BRIDGE_ROUTES.map((r) => ({ method: r.method, path: r.path })).sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
    );
    res.json({
      success: true,
      data: { routes, count: routes.length },
      timestamp: Date.now(),
    });
  });

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

      // Add body if required. Defensive normalization (iter-4): an
      // upstream proxy or a body-parser bypass can leave `req.body`
      // undefined even for a POST. Handlers expect an object (e.g.
      // `pageHealth()` takes no args but the route is POST). Coerce to
      // `{}` so destructuring + key-access inside handlers doesn't crash.
      if (route.bodyRequired || route.method === 'POST') {
        args.push(req.body ?? {});
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  const app = express();

  app.use(jsonBody());

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
