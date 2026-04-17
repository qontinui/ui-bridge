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
} from '../control';
import { createHandlers, type RegistryLike, type ActionExecutorLike } from './handlers';
import { SSEManager } from './sse-handler';
import type { CommandRelay } from './command-relay';
import { CDPTabDiscovery } from './cdp-tabs';

/**
 * Next.js specific configuration
 */
export interface NextJSAdapterConfig extends UIBridgeServerConfig {
  /** Runtime for edge/serverless */
  runtime?: 'edge' | 'nodejs';
  /** SSE manager for streaming events to clients */
  sseManager?: SSEManager;
  /** CommandRelay instance for relay route support */
  relay?: CommandRelay;
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
 * JSON.stringify replacer that strips DOM nodes and handles circular references.
 * Server-side responses may include data from command handlers that accidentally
 * contain HTMLElement refs (which create cycles via React's __reactFiber$).
 */
function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object') {
      // Strip DOM nodes — they're never meaningful in JSON responses
      if (typeof Node !== 'undefined' && val instanceof Node) {
        return `[${val.constructor.name}]`;
      }
      // Break circular references
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    // Strip functions
    if (typeof val === 'function') return undefined;
    return val;
  });
}

/**
 * Create JSON response
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(safeJsonStringify(data), {
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
  handlers: Partial<UIBridgeServerHandlers>,
  config: NextJSAdapterConfig = {}
): {
  GET: NextRouteHandler;
  POST: NextRouteHandler;
  PUT: NextRouteHandler;
  DELETE: NextRouteHandler;
} {
  const authenticate = config.authenticate;
  const cdp = new CDPTabDiscovery();

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

      // Intercept SSE event stream before normal routing
      if (method === 'GET' && path === '/control/events/stream' && config.sseManager) {
        return createSSEStreamResponse(request, config.sseManager);
      }

      // Change observation SSE stream — filters to snapshot:changed events only
      if (method === 'GET' && path === '/control/changes/stream' && config.sseManager) {
        return createSSEStreamResponse(request, config.sseManager, 'snapshot:changed');
      }

      // CDP tab discovery routes (opt-in, works without relay)
      const cdpResponse = await handleCDPRoute(method, path, request, cdp);
      if (cdpResponse) return cdpResponse;

      // Intercept relay routes before normal routing
      if (config.relay) {
        const relayResponse = handleRelayRoute(method, path, request, config.relay, config);
        if (relayResponse) return await relayResponse;
      }

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

      // Add body for POST/PUT/PATCH requests or when body is required
      if (route.bodyRequired || method === 'POST' || method === 'PUT' || method === 'PATCH') {
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
    PUT: handleRequest,
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
      async GET(request: NextRequest): Promise<Response> {
        const url = request.nextUrl?.searchParams?.get('url') ?? undefined;
        const targetTabId = request.nextUrl?.searchParams?.get('targetTabId') ?? undefined;
        const skipSettle = request.nextUrl?.searchParams?.get('skipSettle') ?? undefined;
        const settleTimeout = request.nextUrl?.searchParams?.get('settleTimeout') ?? undefined;
        const result = await handlers.getControlSnapshot({
          targetTabId,
          url,
          skipSettle,
          settleTimeout,
        });
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
 * import { createUIBridgeHandler } from '@qontinui/ui-bridge/server';
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

// SSE heartbeat interval (15 seconds)
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

// ============================================================================
// CDP Tab Discovery Routes
// ============================================================================

/**
 * Handle CDP tab discovery routes. Returns a Response if the route matches,
 * or null to fall through to relay / normal routing.
 */
async function handleCDPRoute(
  method: string,
  path: string,
  request: Request,
  cdp: CDPTabDiscovery
): Promise<Response | null> {
  // GET /tabs/cdp — list all Chrome tabs via CDP
  if (method === 'GET' && path === '/tabs/cdp') {
    if (!cdp.isEnabled()) {
      return jsonResponse(
        {
          success: false,
          error:
            'CDP not configured. Launch Chrome with --remote-debugging-port=9222 and set CDP_ENDPOINT env var.',
          code: 'CDP_DISABLED',
        },
        503
      );
    }
    const targets = await cdp.listTargets();
    return jsonResponse({
      success: true,
      data: { targets, endpoint: 'configured' },
      timestamp: Date.now(),
    });
  }

  // POST /tabs/cdp/new — open a new tab (must be checked before :targetId routes)
  if (method === 'POST' && path === '/tabs/cdp/new') {
    if (!cdp.isEnabled()) {
      return jsonResponse(
        { success: false, error: 'CDP not configured.', code: 'CDP_DISABLED' },
        503
      );
    }
    const body = await request.json().catch(() => ({}));
    const url = (body as { url?: string }).url;
    const target = await cdp.openNewTab(url);
    return jsonResponse({ success: !!target, data: target, timestamp: Date.now() });
  }

  // POST /tabs/cdp/:targetId/activate
  const activateMatch = method === 'POST' && path.match(/^\/tabs\/cdp\/([^/]+)\/activate$/);
  if (activateMatch) {
    if (!cdp.isEnabled()) {
      return jsonResponse(
        { success: false, error: 'CDP not configured.', code: 'CDP_DISABLED' },
        503
      );
    }
    const targetId = decodeURIComponent(activateMatch[1]);
    const ok = await cdp.activateTarget(targetId);
    return jsonResponse({ success: ok, timestamp: Date.now() });
  }

  // POST /tabs/cdp/:targetId/close
  const closeMatch = method === 'POST' && path.match(/^\/tabs\/cdp\/([^/]+)\/close$/);
  if (closeMatch) {
    if (!cdp.isEnabled()) {
      return jsonResponse(
        { success: false, error: 'CDP not configured.', code: 'CDP_DISABLED' },
        503
      );
    }
    const targetId = decodeURIComponent(closeMatch[1]);
    const ok = await cdp.closeTarget(targetId);
    return jsonResponse({ success: ok, timestamp: Date.now() });
  }

  return null;
}

// ============================================================================
// Relay Routes
// ============================================================================

const RELAY_COMMAND_STREAM_HEARTBEAT_MS = 15_000;

/**
 * Handle relay-specific routes. Returns a Response (or Promise<Response>)
 * if the route matches, or null to fall through to normal routing.
 */
function handleRelayRoute(
  method: string,
  path: string,
  request: NextRequest,
  relay: CommandRelay,
  config: NextJSAdapterConfig
): Response | Promise<Response> | null {
  // GET /commands/stream — SSE command delivery to browser
  if (method === 'GET' && path === '/commands/stream') {
    return createCommandStreamResponse(request, relay);
  }

  // POST /commands — browser sends command responses
  if (method === 'POST' && path === '/commands') {
    return handleCommandResponse(request, relay);
  }

  // POST /heartbeat — browser heartbeat
  if (method === 'POST' && path === '/heartbeat') {
    return (async () => {
      let heartbeatTabId: string | undefined;
      try {
        const body = await request.json();
        heartbeatTabId = body?.tabId as string | undefined;
        relay.receiveHeartbeat(heartbeatTabId, {
          url: body?.url as string | undefined,
          title: body?.title as string | undefined,
          visibility: body?.visibility as string | undefined,
        });
      } catch {
        relay.receiveHeartbeat();
      }
      // Report whether the server currently holds an SSE listener for this
      // tabId. The SDK uses this to detect silent disconnects (e.g. when a
      // client-side route change dropped the EventSource without firing
      // onerror) and recover by reopening the stream.
      const diag = relay.getTransportDiagnostics();
      const tabRegistered =
        heartbeatTabId !== undefined && diag.connectedTabs.includes(heartbeatTabId);
      return jsonResponse({
        success: true,
        data: { received: true, tabRegistered },
        timestamp: Date.now(),
      });
    })();
  }

  // GET /health — transport diagnostics + heartbeat freshness + discovery metadata
  if (method === 'GET' && path === '/health') {
    const diagnostics = relay.getTransportDiagnostics();
    const response: Record<string, unknown> = {
      success: true,
      data: {
        responsive: relay.isAppResponsive(),
        lastHeartbeat: relay.getLastHeartbeat(),
        ...diagnostics,
      },
      timestamp: Date.now(),
    };
    // Include uiBridge metadata for app discovery scanner
    if (config.appInfo) {
      response.uiBridge = {
        ...config.appInfo,
        capabilities: ['control', 'renderLog', 'debug'],
      };
    }
    return jsonResponse(response);
  }

  // GET /tabs — connected tab info with metadata
  if (method === 'GET' && path === '/tabs') {
    const url = new URL(request.url);
    const detailed = url.searchParams.get('detailed') === 'true';
    const diag = relay.getTransportDiagnostics();
    if (detailed) {
      return (async () => {
        const tabInfos = await relay.getTabsWithInfo();
        const tabs = tabInfos.map((info) => ({
          ...info,
          ...(diag.tabMetadata[info.tabId] || {}),
          lastHeartbeat: diag.tabHeartbeats[info.tabId] ?? null,
          isPrimary: info.tabId === diag.primaryTabId,
          isDemoted: diag.demotedTabs.includes(info.tabId),
        }));
        return jsonResponse({ success: true, data: { tabs }, timestamp: Date.now() });
      })();
    }
    const tabs = diag.connectedTabs.map((tabId) => ({
      tabId,
      ...(diag.tabMetadata[tabId] || {}),
      lastHeartbeat: diag.tabHeartbeats[tabId] ?? null,
      isPrimary: tabId === diag.primaryTabId,
      isDemoted: diag.demotedTabs.includes(tabId),
    }));
    return jsonResponse({
      success: true,
      data: { tabs },
      timestamp: Date.now(),
    });
  }

  // POST /tabs/:tabId/activate — focus a specific tab
  if (method === 'POST' && path.match(/^\/tabs\/([^/]+)\/activate$/)) {
    const targetTabId = decodeURIComponent(path.split('/')[2]);
    return (async () => {
      try {
        const result = await relay.queueCommand('tabActivate', {}, { targetTabId });
        return jsonResponse({ success: true, data: result, timestamp: Date.now() });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ success: false, error: msg, timestamp: Date.now() }, 500);
      }
    })();
  }

  // POST /tabs/:tabId/close — request a tab to close
  if (method === 'POST' && path.match(/^\/tabs\/([^/]+)\/close$/)) {
    const targetTabId = decodeURIComponent(path.split('/')[2]);
    return (async () => {
      try {
        const result = await relay.queueCommand('tabClose', {}, { targetTabId });
        return jsonResponse({ success: true, data: result, timestamp: Date.now() });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ success: false, error: msg, timestamp: Date.now() }, 500);
      }
    })();
  }

  return null;
}

/**
 * SSE stream that delivers commands from the relay to browser tabs.
 */
function createCommandStreamResponse(request: NextRequest, relay: CommandRelay): Response {
  const url = new URL(request.url);
  const tabId = url.searchParams.get('tabId') ?? undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        unsubscribe();
      };

      // Send initial connection event
      try {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'connected', buildId: relay.buildId, timestamp: Date.now() })}\n\n`
          )
        );
      } catch {
        /* ignore */
      }

      // Subscribe to commands
      const unsubscribe = relay.subscribeToCommands((command) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(command)}\n\n`));
        } catch {
          cleanup();
        }
      }, tabId);

      // Heartbeat to keep connection alive
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          cleanup();
        }
      }, RELAY_COMMAND_STREAM_HEARTBEAT_MS);

      // Clean up on disconnect
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Handle command responses from the browser (POST /commands).
 */
async function handleCommandResponse(request: NextRequest, relay: CommandRelay): Promise<Response> {
  try {
    const body = await request.json();
    const { commandId, success: ok, result, error: errorMsg, tabId: responseTabId } = body;

    if (!commandId) {
      return jsonResponse(
        { success: false, error: 'Missing commandId', timestamp: Date.now() },
        400
      );
    }

    if (ok) {
      relay.resolveCommand(commandId, result, responseTabId as string | undefined);
    } else {
      relay.rejectCommand(
        commandId,
        errorMsg || (result as { error?: string })?.error || 'Unknown error'
      );
    }

    return jsonResponse({ success: true, timestamp: Date.now() });
  } catch {
    return jsonResponse(
      { success: false, error: 'Invalid request body', timestamp: Date.now() },
      400
    );
  }
}

/**
 * Create an SSE streaming response for the Next.js adapter.
 * Follows the same pattern as the web app's command stream route.
 */
function createSSEStreamResponse(
  request: NextRequest,
  sseManager: SSEManager,
  typeFilterOverride?: string
): Response {
  const url = new URL(request.url);
  const typeFilter = typeFilterOverride ?? url.searchParams.get('types') ?? undefined;
  const elementFilter = url.searchParams.get('elements') ?? undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let clientId: string | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let closed = false;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (clientId) {
          sseManager.removeClient(clientId);
          clientId = null;
        }
      };

      // Register SSE client with the manager
      clientId = sseManager.addClient(
        (data: string) => {
          try {
            controller.enqueue(encoder.encode(data));
            return true;
          } catch {
            cleanup();
            return false;
          }
        },
        () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
        typeFilter,
        elementFilter
      );

      // Heartbeat to keep connection alive and detect dead connections
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          cleanup();
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);

      // Clean up when the client disconnects
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
