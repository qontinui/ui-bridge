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
import { mapInternalErrorCode } from '../diagnostics';
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
  const message = typeof error === 'string' ? error : error.message;
  return {
    success: false,
    error: message,
    code: mapInternalErrorCode(code, message),
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

      // Item #4 — per-tab routing. Sniff `tabId` from query, header, and
      // body, then thread it into whichever arg the handler accepts. Body
      // wins if it already has `tabId` (caller knew what they wanted);
      // otherwise query > header. Header name matches the Next.js adapter.
      const queryTabId =
        (typeof req.query.tabId === 'string' && req.query.tabId) ||
        (typeof req.query.targetTabId === 'string' && req.query.targetTabId) ||
        undefined;
      const headerTabId =
        (typeof req.headers['x-ui-bridge-tab-id'] === 'string'
          ? (req.headers['x-ui-bridge-tab-id'] as string)
          : undefined) ?? undefined;
      const externalTabId = queryTabId || headerTabId;

      // Per-user tab scoping (§4.2): mirror the Next.js adapter's
      // X-Caller-User-Id sniff so the trusted-identity-bound `context`
      // reaches every relay-dispatching handler — even the zero-arg ones
      // (captureSnapshot, clearRenderLog, getElementState, …) whose body
      // / query splice can't carry `__callerUserId`.
      const headerCallerUserId =
        (typeof req.headers['x-caller-user-id'] === 'string'
          ? (req.headers['x-caller-user-id'] as string)
          : undefined) ?? undefined;

      // Add body when the route declares one. See nextjs.ts for the
      // per-user-scoping rationale (POST routes without `bodyRequired`
      // are context-only handlers whose signatures end at the trailing
      // `context?: HandlerContext` arg).
      if (route.bodyRequired) {
        let body = req.body;
        if (
          externalTabId &&
          body !== null &&
          typeof body === 'object' &&
          !Array.isArray(body) &&
          (body as Record<string, unknown>).tabId === undefined &&
          (body as Record<string, unknown>).targetTabId === undefined
        ) {
          body = { ...(body as Record<string, unknown>), tabId: externalTabId };
        } else if (!body && externalTabId) {
          body = { tabId: externalTabId };
        }
        if (
          headerCallerUserId &&
          body !== null &&
          typeof body === 'object' &&
          !Array.isArray(body)
        ) {
          body = { ...(body as Record<string, unknown>), __callerUserId: headerCallerUserId };
        } else if (!body && headerCallerUserId) {
          body = { __callerUserId: headerCallerUserId };
        }
        args.push(body);
      }

      // Add query params for GET requests. See nextjs.ts for why
      // `__callerUserId` is NOT spliced into the searchParams.
      if (route.method === 'GET') {
        const query = { ...req.query } as Record<string, unknown>;
        if (externalTabId && query.tabId === undefined && query.targetTabId === undefined) {
          query.tabId = externalTabId;
        }
        if (Object.keys(query).length > 0) {
          args.push(query);
        }
      }

      // Per-user tab scoping (§4.2) — trailing context arg. The adapter
      // ALWAYS supplies this so zero-arg / id-only handlers
      // (captureSnapshot, clearRenderLog, getElementState(id)) — whose
      // signatures can't carry __callerUserId in the body/query — still
      // enforce ownership when X-Caller-User-Id is present. Adds NO
      // overhead when the header is absent (context.callerUserId
      // undefined → relay falls back to primary-tab dispatch).
      args.push({ callerUserId: headerCallerUserId });

      const result = await handler(...args);
      // Honor APIResponse.httpStatus for endpoints that need 4xx semantics
      // (e.g. Phase 2.1 `/control/element/:id/expect` → 422 on assertion
      // failure). Strip the hint from the body so the envelope shape stays
      // stable for consumers that only know the default 200 contract.
      const httpStatus =
        typeof (result as APIResponse<unknown>).httpStatus === 'number'
          ? (result as APIResponse<unknown>).httpStatus
          : undefined;
      let body: unknown = result;
      if (httpStatus !== undefined) {
        const { httpStatus: _omit, ...rest } = result as APIResponse<unknown>;
        body = rest;
        res.status(httpStatus).json(body);
      } else {
        res.json(body);
      }
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

  // Health check (also served at /status)
  app.get(['/health', '/status'], (_req: Request, res: Response) => {
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
