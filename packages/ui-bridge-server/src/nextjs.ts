/**
 * Next.js Adapter
 *
 * Next.js API route handlers for UI Bridge server.
 */

// Define NextRequest interface locally to avoid requiring next as a dependency
interface NextRequest extends Request {
  nextUrl: URL;
}
import type {
  UIBridgeServerConfig,
  UIBridgeServerHandlers,
  APIResponse,
  RouteDefinition,
  RenderLogQuery,
} from './types';
import { UI_BRIDGE_ROUTES } from './types';
import type {
  ControlActionRequest,
  ComponentActionRequest,
  FindRequest,
  WorkflowRunRequest,
} from '@qontinui/ui-bridge/control';
import { createHandlers, type RegistryLike, type ActionExecutorLike } from './handlers';

/**
 * Next.js specific configuration
 */
export interface NextJSAdapterConfig extends UIBridgeServerConfig {
  /** Runtime for edge/serverless */
  runtime?: 'edge' | 'nodejs';
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
 * Create JSON response
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Route handler factory for Next.js App Router
 */
export type NextRouteHandler = (
  request: NextRequest,
  context: { params: Record<string, string> }
) => Promise<Response>;

/**
 * Create Next.js route handlers for UI Bridge
 *
 * Use this to create route handlers for the App Router.
 *
 * @example
 * ```ts
 * // app/api/ui-bridge/[...path]/route.ts
 * import { createNextRouteHandlers } from 'ui-bridge-server/nextjs';
 * import { handlers } from '@/lib/ui-bridge';
 *
 * export const { GET, POST, DELETE } = createNextRouteHandlers(handlers);
 * ```
 */
export function createNextRouteHandlers(
  handlers: UIBridgeServerHandlers,
  config: NextJSAdapterConfig = {}
): {
  GET: NextRouteHandler;
  POST: NextRouteHandler;
  DELETE: NextRouteHandler;
} {
  const authenticate = config.authenticate;

  async function handleRequest(
    request: NextRequest,
    context: { params: Record<string, string> }
  ): Promise<Response> {
    try {
      // Authentication
      if (authenticate) {
        const authenticated = await authenticate(request);
        if (!authenticated) {
          return jsonResponse(wrapError('Unauthorized', 'UNAUTHORIZED'), 401);
        }
      }

      // Extract path from catch-all route
      const pathParam = context.params.path;
      const path = Array.isArray(pathParam) ? '/' + pathParam.join('/') : '/' + pathParam;
      const method = request.method;

      // Find matching route
      const route = findMatchingRoute(path, method);
      if (!route) {
        return jsonResponse(wrapError('Not found', 'NOT_FOUND'), 404);
      }

      // Extract URL params
      const params = extractParams(path, route);

      // Get handler
      const handlerName = route.handler as keyof UIBridgeServerHandlers;
      const handler = handlers[handlerName];

      if (!handler) {
        return jsonResponse(wrapError('Handler not found', 'NOT_IMPLEMENTED'), 501);
      }

      // Build arguments
      const args: unknown[] = [];

      // Add URL params
      if (route.params) {
        for (const param of route.params) {
          args.push(params[param]);
        }
      }

      // Add body for POST requests
      if (method === 'POST') {
        try {
          const body = await request.json();
          args.push(body);
        } catch {
          // No body or invalid JSON
          args.push({});
        }
      }

      // Add query params for GET requests
      if (method === 'GET') {
        const searchParams = Object.fromEntries(request.nextUrl.searchParams);
        if (Object.keys(searchParams).length > 0) {
          args.push(searchParams);
        }
      }

      // Call handler
      const result = await (handler as (...args: unknown[]) => Promise<APIResponse<unknown>>)(
        ...args
      );
      return jsonResponse(result);
    } catch (error) {
      console.error('UI Bridge error:', error);
      return jsonResponse(wrapError(error as Error, 'INTERNAL_ERROR'), 500);
    }
  }

  return {
    GET: handleRequest,
    POST: handleRequest,
    DELETE: handleRequest,
  };
}

/**
 * Find a matching route definition
 */
function findMatchingRoute(path: string, method: string): RouteDefinition | null {
  for (const route of UI_BRIDGE_ROUTES) {
    if (route.method !== method) continue;

    // Convert route path to regex
    const routeRegex = route.path.replace(/:[^/]+/g, '([^/]+)').replace(/\//g, '\\/');

    const regex = new RegExp(`^${routeRegex}$`);
    if (regex.test(path)) {
      return route;
    }
  }
  return null;
}

/**
 * Extract params from URL path based on route definition
 */
function extractParams(path: string, route: RouteDefinition): Record<string, string> {
  const params: Record<string, string> = {};
  if (!route.params) return params;

  // Extract param values from path
  const routeParts = route.path.split('/');
  const pathParts = path.split('/');

  for (let i = 0; i < routeParts.length; i++) {
    const routePart = routeParts[i];
    if (routePart.startsWith(':')) {
      const paramName = routePart.slice(1);
      params[paramName] = pathParts[i];
    }
  }

  return params;
}

/**
 * Individual route handler creators for more granular control
 */
export function createRenderLogHandlers(handlers: UIBridgeServerHandlers) {
  return {
    async GET(request: NextRequest): Promise<Response> {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const query: RenderLogQuery = {
        type: searchParams.type as RenderLogQuery['type'],
        since: searchParams.since ? parseInt(searchParams.since) : undefined,
        until: searchParams.until ? parseInt(searchParams.until) : undefined,
        limit: searchParams.limit ? parseInt(searchParams.limit) : undefined,
      };
      const result = await handlers.getRenderLog(query);
      return jsonResponse(result);
    },
    async DELETE(): Promise<Response> {
      const result = await handlers.clearRenderLog();
      return jsonResponse(result);
    },
  };
}

export function createControlHandlers(handlers: UIBridgeServerHandlers) {
  return {
    elements: {
      async GET(): Promise<Response> {
        const result = await handlers.getElements();
        return jsonResponse(result);
      },
    },
    element: {
      async GET(_request: NextRequest, context: { params: { id: string } }): Promise<Response> {
        const result = await handlers.getElement(context.params.id);
        return jsonResponse(result);
      },
      async POST(request: NextRequest, context: { params: { id: string } }): Promise<Response> {
        const body = (await request.json()) as ControlActionRequest;
        const result = await handlers.executeElementAction(context.params.id, body);
        return jsonResponse(result);
      },
    },
    components: {
      async GET(): Promise<Response> {
        const result = await handlers.getComponents();
        return jsonResponse(result);
      },
    },
    component: {
      async GET(_request: NextRequest, context: { params: { id: string } }): Promise<Response> {
        const result = await handlers.getComponent(context.params.id);
        return jsonResponse(result);
      },
      async POST(
        request: NextRequest,
        context: { params: { id: string; actionId: string } }
      ): Promise<Response> {
        const body = (await request.json()) as Omit<ComponentActionRequest, 'action'>;
        const result = await handlers.executeComponentAction(context.params.id, {
          ...body,
          action: context.params.actionId,
        });
        return jsonResponse(result);
      },
    },
    find: {
      async POST(request: NextRequest): Promise<Response> {
        const body = (await request.json()) as FindRequest;
        const result = await handlers.find(body);
        return jsonResponse(result);
      },
    },
    discover: {
      /**
       * @deprecated Use /control/find instead
       */
      async POST(request: NextRequest): Promise<Response> {
        const body = (await request.json()) as FindRequest;
        const result = await handlers.discover(body);
        return jsonResponse(result);
      },
    },
    snapshot: {
      async GET(): Promise<Response> {
        const result = await handlers.getControlSnapshot();
        return jsonResponse(result);
      },
    },
    workflows: {
      async GET(): Promise<Response> {
        const result = await handlers.getWorkflows();
        return jsonResponse(result);
      },
    },
    workflow: {
      async POST(request: NextRequest, context: { params: { id: string } }): Promise<Response> {
        const body = (await request.json()) as WorkflowRunRequest;
        const result = await handlers.runWorkflow(context.params.id, body);
        return jsonResponse(result);
      },
    },
  };
}

export function createDebugHandlers(handlers: UIBridgeServerHandlers) {
  return {
    actionHistory: {
      async GET(request: NextRequest): Promise<Response> {
        const limit = request.nextUrl.searchParams.get('limit');
        const result = await handlers.getActionHistory(limit ? parseInt(limit) : undefined);
        return jsonResponse(result);
      },
    },
    metrics: {
      async GET(): Promise<Response> {
        const result = await handlers.getMetrics();
        return jsonResponse(result);
      },
    },
    highlight: {
      async POST(_request: NextRequest, context: { params: { id: string } }): Promise<Response> {
        const result = await handlers.highlightElement(context.params.id);
        return jsonResponse(result);
      },
    },
  };
}

/**
 * Zero-config convenience wrapper for Next.js App Router.
 *
 * Creates a single route handler with server-safe stub implementations.
 * Read operations return empty data; write operations return errors.
 *
 * For full control API access (live snapshots, element actions, AI search),
 * use the runtime injection proxy or implement a custom client-server relay.
 *
 * @example
 * ```ts
 * // app/api/ui-bridge/[...path]/route.ts
 * import { createUIBridgeHandler } from '@qontinui/ui-bridge-server/nextjs';
 *
 * const handler = createUIBridgeHandler();
 *
 * export const GET = handler;
 * export const POST = handler;
 * export const DELETE = handler;
 * ```
 */
export function createUIBridgeHandler(config?: NextJSAdapterConfig): NextRouteHandler {
  const registry: RegistryLike = {
    getAllElements: () => [],
    getElement: () => undefined,
    getAllComponents: () => [],
    getComponent: () => undefined,
    createSnapshot: () =>
      ({
        timestamp: Date.now(),
        elements: [],
        components: [],
        workflows: [],
        activeRuns: [],
      }) as ReturnType<RegistryLike['createSnapshot']>,
  };

  const executor: ActionExecutorLike = {
    executeAction: async () => ({
      success: false,
      error: 'Server-side action execution not available. Use the runtime injection proxy.',
      timestamp: Date.now(),
    }),
    executeComponentAction: async () => ({
      success: false,
      error: 'Server-side action execution not available. Use the runtime injection proxy.',
      timestamp: Date.now(),
    }),
  };

  const handlers = createHandlers(registry, executor);
  const routeHandlers = createNextRouteHandlers(handlers, config);
  // All three handlers point to the same internal handleRequest function
  return routeHandlers.GET;
}
