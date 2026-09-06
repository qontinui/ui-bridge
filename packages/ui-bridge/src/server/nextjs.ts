/**
 * Next.js Adapter
 *
 * Next.js API route handlers for UI Bridge server.
 *
 * Per-tab routing (Item #4)
 * --------------------------
 * When more than one browser tab is connected to the same relay (e.g. two
 * operator machines both pointed at the same Vercel deployment of
 * `demo.staging.qontinui.io`), the default dispatch routes the command to
 * `primaryTabId` — and `primaryTabId` flips to the most-recently-registered
 * tab. That means an element id resolved from tab A's snapshot may be
 * dispatched to tab B and 404 with "Element not found".
 *
 * To pin a command to a specific tab, supply `tabId` in ANY of three places
 * (in order of precedence, highest first):
 *
 *   1. Query string:   ?tabId=<uuid>
 *   2. HTTP header:    X-UI-Bridge-Tab-Id: <uuid>
 *   3. JSON body:      { "tabId": "<uuid>", ... }
 *
 * Discover live tab ids with `GET /tabs` (or `GET /tabs?activeOnly=true` to
 * filter out tabs whose heartbeat has gone stale). If the supplied tabId is
 * not connected, the relay rejects the command with `code: "TAB_NOT_FOUND"`;
 * if the tab is registered but stale, `code: "TAB_STALE"`. Omitting tabId
 * preserves the legacy primary-tab fallback (backward compatible).
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
import { mapInternalErrorCode } from '../diagnostics';
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
  const message = typeof error === 'string' ? error : error.message;
  return {
    success: false,
    error: message,
    code: mapInternalErrorCode(code, message),
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
 * import { createNextRouteHandlers } from '@qontinui/ui-bridge-server/nextjs';
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

      // Item #4 — per-tab routing. Sniff `tabId` from URL query, then the
      // `X-UI-Bridge-Tab-Id` header. If found, we'll splice it into the
      // body / query object below so handlers downstream can route the
      // relay command to a specific tab instead of `primaryTabId`. Body
      // takes lowest precedence — see `extractTabRouting` in relay-handlers.
      const queryTabId =
        request.nextUrl.searchParams.get('tabId') ??
        request.nextUrl.searchParams.get('targetTabId') ??
        undefined;
      const headerTabId =
        request.headers.get('x-ui-bridge-tab-id') ??
        request.headers.get('X-UI-Bridge-Tab-Id') ??
        undefined;
      const externalTabId = queryTabId ?? headerTabId ?? undefined;

      // Per-user tab scoping (§4.2): the consumer's auth gate populates
      // `X-Caller-User-Id` from the authenticated identity (NEVER from a
      // browser-supplied value). When present, splice it into the payload
      // as `__callerUserId` so `relay-handlers.extractTabRouting` can lift
      // it into `ownerCheck` and the relay enforces per-user dispatch
      // boundaries. Reserved key — do NOT use `callerUserId` to avoid
      // colliding with handler request bodies.
      const callerUserId =
        request.headers.get('x-caller-user-id') ??
        request.headers.get('X-Caller-User-Id') ??
        undefined;

      // Add body when the route declares one. Per-user tab scoping (§4.2):
      // POST routes WITHOUT `bodyRequired:true` are context-only handlers
      // (`captureSnapshot`, `clearConsoleErrors`, `enableChangeBuffer`,
      // …) whose signatures accept just the trailing `context?:
      // HandlerContext`. Pushing a body for those would shift the
      // context to the wrong positional slot. Stick to the route table.
      if (route.bodyRequired) {
        try {
          const body = await request.json();
          if (
            externalTabId &&
            body !== null &&
            typeof body === 'object' &&
            !Array.isArray(body) &&
            (body as Record<string, unknown>).tabId === undefined &&
            (body as Record<string, unknown>).targetTabId === undefined
          ) {
            (body as Record<string, unknown>).tabId = externalTabId;
          }
          if (callerUserId && body !== null && typeof body === 'object' && !Array.isArray(body)) {
            (body as Record<string, unknown>).__callerUserId = callerUserId;
          }
          args.push(body);
        } catch {
          // No body or invalid JSON — synthesize a body that still carries
          // tabId / callerUserId so per-tab routing + ownership enforcement
          // work on endpoints whose handler signature requires a body but
          // whose caller sent none.
          const synth: Record<string, unknown> = {};
          if (externalTabId) synth.tabId = externalTabId;
          if (callerUserId) synth.__callerUserId = callerUserId;
          args.push(synth);
        }
      }

      // Add query params for GET requests. Per-user tab scoping (§4.2):
      // `__callerUserId` is delivered via the trailing `context` arg
      // (below) — NOT spliced into the searchParams bag. Splicing it
      // would push an otherwise-empty query as the 2nd positional arg
      // to id-only handlers like `getElementState(id, context?)`,
      // shifting `context` to the wrong slot. The `tabId` splice stays
      // (it's a payload field many handlers read via `extractTabRouting`).
      if (method === 'GET') {
        const searchParams = Object.fromEntries(request.nextUrl.searchParams);
        if (
          externalTabId &&
          searchParams.tabId === undefined &&
          searchParams.targetTabId === undefined
        ) {
          searchParams.tabId = externalTabId;
        }
        if (Object.keys(searchParams).length > 0) {
          args.push(searchParams);
        }
      }

      // Per-user tab scoping (§4.2) — trailing context arg. The adapter
      // ALWAYS supplies this final positional argument so zero-arg /
      // id-only handlers (captureSnapshot, clearRenderLog,
      // getElementState(id)) — whose signatures don't carry
      // __callerUserId in the body/query — still enforce ownership when
      // X-Caller-User-Id is present. Adds NO overhead when the header is
      // absent (context.callerUserId undefined → relay falls back to
      // primary-tab dispatch).
      args.push({ callerUserId });

      // Call handler
      const result = await (handler as (...args: unknown[]) => Promise<APIResponse<unknown>>)(
        ...args
      );
      // Honor APIResponse.httpStatus for endpoints that need 4xx semantics
      // on logical failure (Phase 2.1 `/control/element/:id/expect` → 422).
      const httpStatus = typeof result.httpStatus === 'number' ? result.httpStatus : undefined;
      if (httpStatus !== undefined) {
        const { httpStatus: _omit, ...body } = result;
        return jsonResponse(body, httpStatus);
      }
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
      async GET(request: NextRequest): Promise<Response> {
        // Phase 3.2: forward filter query params (`title`, `aria_label`,
        // `text`, `revealsAny`) so the handler-level matcher can apply them.
        // `windowLabel` targets a runner pop-out window (the runner reads it
        // off the `?windowLabel=` query). Empty strings are dropped so callers
        // can omit fields without tripping the "selector has at least one
        // field" check.
        const sp = request.nextUrl.searchParams;
        const pick = (key: string): string | undefined => {
          const raw = sp.get(key);
          if (raw === null) return undefined;
          return raw.length === 0 ? undefined : raw;
        };
        const result = await handlers.getElements({
          recency: pick('recency'),
          title: pick('title'),
          aria_label: pick('aria_label'),
          text: pick('text'),
          revealsAny: pick('revealsAny'),
          windowLabel: pick('windowLabel'),
        });
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

  // POST /heartbeat — browser heartbeat.
  //
  // Per-user tab scoping (§4.2, strict mode): the body MUST carry
  // `registrationMetadata: {userId, sessionId}`. A missing or malformed
  // envelope → HTTP 400 + `MISSING_REGISTRATION_METADATA`. No listener
  // entry / metadata is created in that case, and the next stale-tab
  // sweep will evict any SSE listener opened for this tabId. Backward
  // compatibility is NOT a goal — sibling SDKs are updated separately.
  if (method === 'POST' && path === '/heartbeat') {
    return (async () => {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse(
          {
            success: false,
            error: 'heartbeat body required',
            code: 'MISSING_REGISTRATION_METADATA',
            timestamp: Date.now(),
          },
          400
        );
      }

      const heartbeatTabId = typeof body?.tabId === 'string' ? (body.tabId as string) : undefined;

      // Strict ownership metadata enforcement.
      const rawMeta = body?.registrationMetadata as
        | { userId?: unknown; sessionId?: unknown }
        | undefined;
      const userId =
        typeof rawMeta?.userId === 'string' && rawMeta.userId.trim().length > 0
          ? (rawMeta.userId as string).trim()
          : undefined;
      const sessionId =
        typeof rawMeta?.sessionId === 'string' && rawMeta.sessionId.trim().length > 0
          ? (rawMeta.sessionId as string).trim()
          : undefined;
      if (!heartbeatTabId || !userId || !sessionId) {
        return jsonResponse(
          {
            success: false,
            error:
              'heartbeat requires tabId and registrationMetadata.{userId, sessionId} (strict mode)',
            code: 'MISSING_REGISTRATION_METADATA',
            timestamp: Date.now(),
          },
          400
        );
      }

      // Per-user tab scoping (§4.2): ownership may only be claimed/
      // transferred under an AUTH-PROVEN identity. `X-Caller-User-Id` is
      // injected by the consumer's auth gate from the authenticated
      // session (never a browser value); the body's `registrationMetadata
      // .userId` is caller-asserted. When the proven identity is present
      // it must match the claimed userId, otherwise the transfer is
      // refused and the prior owner stands — closing the "know a tabId,
      // steal the tab" takeover primitive while still allowing a genuine
      // re-login (which carries the new user's proven identity).
      const callerUserId =
        request.headers.get('x-caller-user-id') ??
        request.headers.get('X-Caller-User-Id') ??
        undefined;
      const registration = relay.recordRegistration(
        heartbeatTabId,
        { userId, sessionId },
        { callerUserId }
      );
      relay.receiveHeartbeat(heartbeatTabId, {
        url: typeof body?.url === 'string' ? (body.url as string) : undefined,
        title: typeof body?.title === 'string' ? (body.title as string) : undefined,
        visibility: typeof body?.visibility === 'string' ? (body.visibility as string) : undefined,
      });

      // Report whether the server currently holds an SSE listener for this
      // tabId. The SDK uses this to detect silent disconnects (e.g. when a
      // client-side route change dropped the EventSource without firing
      // onerror) and recover by reopening the stream.
      const diag = relay.getTransportDiagnostics();
      const tabRegistered = diag.connectedTabs.includes(heartbeatTabId);
      return jsonResponse({
        success: true,
        data: {
          received: true,
          tabRegistered,
          // Observability: signals an ownership claim/transfer was refused
          // because the claimed userId was not auth-proven. Not a fatal
          // heartbeat error — the loop continues; the tab simply keeps its
          // prior (or no) owner. Absent when ownership was assigned.
          ...(registration.ownershipAssigned
            ? {}
            : { ownershipAssigned: false, ownerChangeRejected: registration.rejectedReason }),
        },
        timestamp: Date.now(),
      });
    })();
  }

  // GET /health (also served at /status) — transport diagnostics + heartbeat freshness + discovery metadata
  //
  // Per-user tab scoping (§4.2): `/health` spreads the FULL transport
  // diagnostics, so it must be scoped by exactly the same mechanism as
  // `/tabs` — when the request carries `X-Caller-User-Id`, the diagnostics
  // are filtered to tabs owned by that user (tab ids, urls/titles,
  // ownership records, and in-flight command ids all included). Without
  // the header (trusted server-side / admin callers, and the localhost
  // discovery scanner) the unfiltered view is returned, as before.
  //
  // Prior to this, `/health` returned the global registry to EVERY
  // authenticated caller while `/tabs` scoped correctly — a cross-user
  // tab-id (and url/sessionId) enumeration leak that simply routed around
  // the `/tabs` gate.
  if (method === 'GET' && (path === '/health' || path === '/status')) {
    const healthCallerUserId =
      request.headers.get('x-caller-user-id') ?? request.headers.get('X-Caller-User-Id') ?? null;
    const diagnostics = relay.getTransportDiagnostics(
      healthCallerUserId ? { ownerCheck: { userId: healthCallerUserId } } : undefined
    );
    const response: Record<string, unknown> = {
      success: true,
      data: {
        responsive: healthCallerUserId
          ? relay.isAppResponsive({ ownerCheck: { userId: healthCallerUserId } })
          : relay.isAppResponsive(),
        lastHeartbeat: healthCallerUserId
          ? relay.getLastHeartbeat({ ownerCheck: { userId: healthCallerUserId } })
          : relay.getLastHeartbeat(),
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

  // GET /tabs/wait — long-poll until at least one tab is connected.
  // Used by `@qontinui/ui-bridge-headless` and other test drivers that
  // launch a browser and want to block until the relay acknowledges
  // the new tab instead of racing it.
  //
  // Query params:
  //   ?timeoutMs=<ms>   default 30000, max 120000
  //   ?pollMs=<ms>      default 250, min 50
  //
  // Per-user tab scoping (§4.2): when the request carries
  // `X-Caller-User-Id`, the response is filtered to tabs owned by that
  // user. Without the header (trusted server-side / admin callers),
  // ALL tabs are returned. SECURITY: the header MUST be set by the
  // consumer's auth gate from the authenticated identity — NEVER trust a
  // value forwarded from the browser.
  //
  // Response (tab connected):
  //   { success: true, data: { tabs: [...], waitedMs: N }, timestamp }
  // Response (timeout):
  //   HTTP 504 { success: false, error: 'timeout', timestamp }
  if (method === 'GET' && path === '/tabs/wait') {
    const url = new URL(request.url);
    const timeoutMs = Math.min(
      120_000,
      Math.max(100, Number.parseInt(url.searchParams.get('timeoutMs') ?? '30000', 10) || 30_000)
    );
    const pollMs = Math.max(
      50,
      Number.parseInt(url.searchParams.get('pollMs') ?? '250', 10) || 250
    );
    const callerUserId =
      request.headers.get('x-caller-user-id') ?? request.headers.get('X-Caller-User-Id') ?? null;
    return (async () => {
      const startedAt = Date.now();
      const deadline = startedAt + timeoutMs;
      while (Date.now() < deadline) {
        const diag = relay.getTransportDiagnostics();
        const visibleIds = callerUserId ? relay.listOwnedTabs(callerUserId) : diag.connectedTabs;
        if (visibleIds.length > 0) {
          const tabs = visibleIds.map((tabId) => ({
            tabId,
            ...(diag.tabMetadata[tabId] || {}),
            lastHeartbeat: diag.tabHeartbeats[tabId] ?? null,
            isPrimary: tabId === diag.primaryTabId,
            isDemoted: diag.demotedTabs.includes(tabId),
          }));
          return jsonResponse({
            success: true,
            data: { tabs, waitedMs: Date.now() - startedAt },
            timestamp: Date.now(),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      return jsonResponse(
        {
          success: false,
          error: 'timeout',
          data: { timeoutMs, waitedMs: Date.now() - startedAt },
          timestamp: Date.now(),
        },
        504
      );
    })();
  }

  // GET /tabs — connected tab info with metadata.
  // Query params:
  //   ?detailed=true     Issue a per-tab `getTabInfo` round-trip to enrich
  //                      each entry with the live URL/pathname/title.
  //   ?activeOnly=true   Item #15 — return only tabs whose last heartbeat
  //                      falls within `tabActiveWindowMs`. Use this BEFORE
  //                      pinning a command with `?tabId=<id>` to avoid
  //                      racing the next stale-tab sweep.
  //
  // Per-user tab scoping (§4.2): when the request carries
  // `X-Caller-User-Id`, the response is filtered to tabs owned by that
  // user. Without the header (trusted server-side / admin callers),
  // ALL tabs are returned. SECURITY: the header MUST be set by the
  // consumer's auth gate from the authenticated identity — NEVER trust a
  // value forwarded from the browser.
  if (method === 'GET' && path === '/tabs') {
    const url = new URL(request.url);
    const detailed = url.searchParams.get('detailed') === 'true';
    const activeOnly = url.searchParams.get('activeOnly') === 'true';
    const callerUserId =
      request.headers.get('x-caller-user-id') ?? request.headers.get('X-Caller-User-Id') ?? null;
    const diag = relay.getTransportDiagnostics();
    const ownedSet = callerUserId ? new Set(relay.listOwnedTabs(callerUserId)) : null;
    const baseIds = activeOnly ? diag.activeTabs : diag.connectedTabs;
    const tabIds = ownedSet ? baseIds.filter((id) => ownedSet.has(id)) : baseIds;
    const activeSet = new Set(diag.activeTabs);
    if (detailed) {
      return (async () => {
        const tabInfos = await relay.getTabsWithInfo();
        const filtered = tabInfos.filter((info) => {
          if (activeOnly && !activeSet.has(info.tabId)) return false;
          if (ownedSet && !ownedSet.has(info.tabId)) return false;
          return true;
        });
        const tabs = filtered.map((info) => ({
          ...info,
          ...(diag.tabMetadata[info.tabId] || {}),
          lastHeartbeat: diag.tabHeartbeats[info.tabId] ?? null,
          isPrimary: info.tabId === diag.primaryTabId,
          isDemoted: diag.demotedTabs.includes(info.tabId),
          isActive: activeSet.has(info.tabId),
        }));
        return jsonResponse({
          success: true,
          data: { tabs, tabActiveWindowMs: diag.tabActiveWindowMs },
          timestamp: Date.now(),
        });
      })();
    }
    const tabs = tabIds.map((tabId) => ({
      tabId,
      ...(diag.tabMetadata[tabId] || {}),
      lastHeartbeat: diag.tabHeartbeats[tabId] ?? null,
      isPrimary: tabId === diag.primaryTabId,
      isDemoted: diag.demotedTabs.includes(tabId),
      isActive: activeSet.has(tabId),
    }));
    return jsonResponse({
      success: true,
      data: { tabs, tabActiveWindowMs: diag.tabActiveWindowMs },
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

      // Keep-alive, and the client's throttle-immune heartbeat clock.
      //
      // This used to be an SSE comment (`: heartbeat`). It is now a NAMED
      // `ping` event carrying a `data:` payload, because the client cannot
      // keep its own reliable clock: its heartbeat is a `setInterval`, and
      // browsers clamp timers in hidden tabs to ~1 firing per minute. Arriving
      // bytes are not throttled, so the client beats in response to this ping
      // instead of waiting on its timer (see `relay-client.ts`).
      //
      // Safe in both directions. An older `fetch`-based client parses the
      // payload, matches neither `type === 'connected'` nor
      // `commandId && action`, and ignores it. An `EventSource`-based client
      // dispatches it as a `ping`-typed event, so its `onmessage` — which
      // handles only unnamed `message` events — never sees it. Either way the
      // bytes still serve the original keep-alive/dead-connection purpose.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ping\ndata: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`
            )
          );
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
