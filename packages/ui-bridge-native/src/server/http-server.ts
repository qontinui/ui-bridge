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
import type { NativeActionExecutor, PageNavigationResponse } from '../control/types';
import type {
  NativeServerConfig,
  NativeServerHandlers,
  NavigationProvider,
  RouteProvider,
  ScreenshotProvider,
  KeepAwakeProvider,
  APIResponse,
  HandlerContext,
} from './types';
import type { BridgeEvent } from '../core/types';
import { createServerHandlers } from './handlers';
import {
  PairingAuthority,
  PairingError,
  SIGNED_BODY_MAX_CHARS,
  SIGNED_TARGET_MAX_CHARS,
  UI_BRIDGE_AUTH_HEADER,
  UNCONFIGURED_PAIRING_STATE,
  carriesWebContext,
  headerValues,
  isTrustedLoopbackRequest,
  isWebReachableRequest,
  type ArmedPairingCode,
  type PairingState,
} from './pairing';
import { ConsoleErrorBuffer, NetworkRequestBuffer } from './observability';
import type { WebSocketEventBridge } from './ws-event-bridge';
import type { JsonRpcRequest, JsonRpcResponse } from './ws-types';
import { isBatchRequest, isSubscribe, isUnsubscribe } from './ws-types';

// ── HTTP status mapping ─────────────────────────────────────────────────────

/**
 * HTTP status for each `APIResponse.code` that has an honest status of its own.
 *
 * Handlers already distinguish "this platform will never do that"
 * (`NOT_SUPPORTED`), "no such route" (`NOT_FOUND`) and "wrong verb"
 * (`METHOD_NOT_ALLOWED`) in the response envelope. Anything not listed here is
 * a client-input problem and keeps 400, which is what 400 is for.
 *
 * `NOT_SUPPORTED` is also ELEMENT-scoped, not only platform-scoped: an element
 * action that fails with a `NativeActionError` keeps its code through
 * `handlers.ts` `executeAction` — today `scrollIntoView` on an element with no
 * usable declared `scrollAncestorId`. Either way it means "retrying this
 * request will not help", which is why it maps to 501 rather than 400.
 *
 * RESOURCE-level misses are deliberately NOT here. `ELEMENT_NOT_FOUND`,
 * `COMPONENT_NOT_FOUND`, `MODAL_NOT_FOUND` and `WORKFLOW_NOT_FOUND`
 * (`handlers.ts`) keep 400: the route resolved and served a request whose
 * *argument* named nothing — a client-input problem, not a routing one.
 * Widening 404 to cover them would make "this endpoint does not exist" and
 * "this id does not exist" the same status, which is the ambiguity this
 * mapping exists to remove.
 *
 * A `Map` rather than an object literal on purpose: a plain object resolves
 * inherited keys, so a `code` of `"toString"` or `"constructor"` would return
 * a FUNCTION where a status number is typed, and it would be relayed straight
 * into the cloud tunnel (`transport/CloudRelayClient.ts`). Unreachable today —
 * every `code` in the tree is a hardcoded literal — but a `Map` costs nothing
 * and closes it structurally rather than by audit.
 */
const ERROR_CODE_HTTP_STATUS = new Map<string, number>([
  ['NOT_SUPPORTED', 501],
  ['NOT_FOUND', 404],
  ['METHOD_NOT_ALLOWED', 405],
  // Device pairing, all answered by the network entry. A 401 means this caller
  // has not proved it may act; a 403 means proving it would change nothing; a 503
  // means the phone cannot check yet.
  ['PAIRING_REQUIRED', 401],
  ['PAIRING_UNCONFIGURED', 401],
  ['PAIRING_NOT_ARMED', 401],
  ['PAIRING_CODE_INVALID', 401],
  ['PAIRING_TIMESTAMP_REFUSED', 401],
  ['PAIRING_WS_LOOPBACK_ONLY', 403],
  ['PAIRING_WEB_CALLER_REFUSED', 403],
  ['PAIRING_BODY_TOO_LARGE', 413],
  ['PAIRING_TARGET_TOO_LONG', 414],
  ['PAIRING_UNAVAILABLE', 503],
]);

/**
 * Derive the HTTP status for a completed `APIResponse`.
 *
 * Every unsuccessful response used to be flattened to HTTP 400, which made a
 * deliberately-unimplemented route (`/ai/forms` → `NOT_SUPPORTED`) and a route
 * that does not exist (`NOT_FOUND`) indistinguishable from a malformed request
 * — so callers retried request shapes against endpoints that were never going
 * to answer. The envelope's `code` already carries the distinction; this maps
 * it onto the status line so a caller reading only the status gets the truth.
 */
export function httpStatusForResponse(response: APIResponse): number {
  if (response.success) return 200;
  const mapped = response.code ? ERROR_CODE_HTTP_STATUS.get(response.code) : undefined;
  return mapped ?? 400;
}

// ── Path pattern matching ───────────────────────────────────────────────────

/**
 * Match an actual path against a pattern with :name placeholders.
 * Returns extracted params, or null if the pattern does not match.
 *
 * Example: parsePath('control/element/:id/action', 'control/element/tab-runs/action')
 *          → { id: 'tab-runs' }
 */
function parsePath(pattern: string, actual: string): Record<string, string> | null {
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
}

// ── WebSocket route table ───────────────────────────────────────────────────

/**
 * Route table for WebSocket JSON-RPC methods.
 *
 * Method strings use the same path structure as HTTP routes (with :id placeholders)
 * but without the /ui-bridge/ prefix. Path params are extracted automatically.
 *
 * Examples:
 *   "health"                                       → handlers.health
 *   "control/snapshot"                             → handlers.getSnapshot
 *   "control/element/tab-runs/action"              → handlers.executeAction ({id: 'tab-runs'})
 *   "control/component/my-comp/action/submit"     → handlers.executeComponentAction
 */
type HandlerKey = keyof NativeServerHandlers;
type HttpVerb = 'GET' | 'POST' | 'DELETE';

interface WsRoute {
  pattern: string;
  handler: HandlerKey;
  /**
   * HTTP verbs this route accepts when invoked over HTTP. When absent the
   * route is WS-only (or matches any verb on HTTP). Multiple verbs allow
   * a single pattern to serve GET+POST etc.
   */
  httpMethods?: readonly HttpVerb[];
  /**
   * When true, the route is only mounted (HTTP + WS + manifest) when the
   * server config opts in via `testHooks`. Production builds default to
   * `testHooks: false` so these endpoints simply don't exist in the route
   * table — agents probing `/_routes` won't see them.
   */
  requiresTestHooks?: boolean;
}

const WS_ROUTES: readonly WsRoute[] = [
  // Health
  { pattern: 'health', handler: 'health', httpMethods: ['GET'] },

  // Device pairing. Always NOT_SUPPORTED from this table: the real route is in
  // `handleNetworkRequest`, because route context carries no peer, and this
  // entry is what JSON-RPC and the relay reach instead.
  { pattern: 'pair', handler: 'pair', httpMethods: ['POST'] },

  // Elements
  { pattern: 'control/elements', handler: 'getElements', httpMethods: ['GET'] },
  // Flat alias — matches the runner UI Bridge's `/ui-bridge/elements` path so
  // agents can use the same URL across runner + mobile without remembering
  // the `control/` prefix. Delegates to the same handler.
  { pattern: 'elements', handler: 'getElements', httpMethods: ['GET'] },
  { pattern: 'control/element/:id', handler: 'getElement', httpMethods: ['GET'] },
  { pattern: 'control/element/:id/state', handler: 'getElementState', httpMethods: ['GET'] },
  { pattern: 'control/element/:id/action', handler: 'executeAction', httpMethods: ['POST'] },

  // Components
  { pattern: 'control/components', handler: 'getComponents', httpMethods: ['GET'] },
  { pattern: 'control/component/:id', handler: 'getComponent', httpMethods: ['GET'] },
  {
    pattern: 'control/component/:id/action/:actionId',
    handler: 'executeComponentAction',
    httpMethods: ['POST'],
  },

  // Discovery
  { pattern: 'control/find', handler: 'find', httpMethods: ['POST'] },
  // Runner-parity alias for `control/find`; the runner exposes its
  // AI-powered element search at `/ui-bridge/ai/find`, so mobile mounts the
  // same handler at both paths to keep agents portable across platforms.
  { pattern: 'ai/find', handler: 'find', httpMethods: ['POST'] },
  { pattern: 'control/snapshot', handler: 'getSnapshot', httpMethods: ['GET'] },
  // Discovery alias — web/runner parity with `POST /control/discover` (a
  // legacy alias for snapshot/find). Mounted on HTTP (GET+POST) so mobile
  // doesn't 404 where web returns 200; delegates to the snapshot handler.
  { pattern: 'control/discover', handler: 'getSnapshot', httpMethods: ['GET', 'POST'] },
  // Page health — accepts both GET and POST so the canonical skill invocation
  // (`POST .../control/page-health` with an empty body) and ad-hoc curls both
  // work without a body-shape gotcha.
  { pattern: 'control/page-health', handler: 'getPageHealth', httpMethods: ['GET', 'POST'] },

  // Workflows
  { pattern: 'control/workflows', handler: 'getWorkflows', httpMethods: ['GET'] },
  { pattern: 'control/workflow/:id/run', handler: 'runWorkflow', httpMethods: ['POST'] },

  // Page Navigation
  { pattern: 'control/page/refresh', handler: 'pageRefresh', httpMethods: ['POST'] },
  { pattern: 'control/page/navigate', handler: 'pageNavigate', httpMethods: ['POST'] },
  { pattern: 'control/page/replace', handler: 'pageReplace', httpMethods: ['POST'] },
  { pattern: 'control/page/back', handler: 'pageGoBack', httpMethods: ['POST'] },
  { pattern: 'control/page/forward', handler: 'pageGoForward', httpMethods: ['POST'] },

  // Screenshot — accepts both GET and POST on HTTP
  { pattern: 'control/screenshot', handler: 'getScreenshot', httpMethods: ['GET', 'POST'] },

  // Design Review
  { pattern: 'design/element/:id/styles', handler: 'getElementStyles', httpMethods: ['GET'] },
  {
    pattern: 'design/element/:id/state-styles',
    handler: 'getElementStateStyles',
    httpMethods: ['POST'],
  },
  { pattern: 'design/snapshot', handler: 'getDesignSnapshot', httpMethods: ['POST'] },
  { pattern: 'design/responsive', handler: 'getResponsiveSnapshots', httpMethods: ['POST'] },
  { pattern: 'design/audit', handler: 'runDesignAudit', httpMethods: ['POST'] },
  { pattern: 'design/style-guide/load', handler: 'loadStyleGuide', httpMethods: ['POST'] },
  { pattern: 'design/style-guide', handler: 'getStyleGuide', httpMethods: ['GET'] },
  // style-guide/clear: WS uses this pattern; HTTP uses DELETE on /design/style-guide.
  // We keep a WS-only entry for the explicit "clear" subpath, and add a DELETE-on-style-guide entry.
  { pattern: 'design/style-guide/clear', handler: 'clearStyleGuide' },
  { pattern: 'design/style-guide', handler: 'clearStyleGuide', httpMethods: ['DELETE'] },

  // Quality Evaluation
  { pattern: 'design/evaluate', handler: 'evaluateQuality', httpMethods: ['POST'] },
  { pattern: 'design/evaluate/contexts', handler: 'getQualityContexts', httpMethods: ['GET'] },
  { pattern: 'design/evaluate/baseline', handler: 'saveBaseline', httpMethods: ['POST'] },
  { pattern: 'design/evaluate/diff', handler: 'diffBaseline', httpMethods: ['POST'] },

  // Meta / Introspection
  { pattern: 'meta/methods', handler: 'getMethods', httpMethods: ['GET'] },

  // AI helpers — mobile parity with the runner's `/ui-bridge/ai/*` family.
  { pattern: 'ai/fill-form', handler: 'fillForm', httpMethods: ['POST'] },

  // AI helpers — NOT_SUPPORTED stubs. These endpoints exist on the runner-side
  // UI Bridge surface (and the /manual-test skill's cheatsheet documents them
  // as if they're universally available). Mobile React Native has no DOM, so
  // the mobile bridge mounts explicit stubs so callers get a structured
  // NOT_SUPPORTED envelope (with a hint pointing at the mobile-native
  // replacement) instead of a confusing HTTP 404.
  { pattern: 'ai/forms', handler: 'aiForms', httpMethods: ['GET'] },
  { pattern: 'ai/idle-status', handler: 'aiIdleStatus', httpMethods: ['GET'] },
  {
    pattern: 'ai/change-buffer/enable',
    handler: 'aiChangeBufferEnable',
    httpMethods: ['POST'],
  },
  {
    pattern: 'ai/wait-for-element',
    handler: 'aiWaitForElement',
    httpMethods: ['POST'],
  },

  // Coord-based tap — synthesizes a press at the given screen coords by
  // matching against registered elements' layout rects.
  { pattern: 'control/tap', handler: 'tapAt', httpMethods: ['POST'] },

  // App-agnostic interaction parity — mirrors the web/runner convenience
  // endpoints (`/control/page/click-by-text` etc.) so the SAME cross-platform
  // contract drives mobile. Text/label-based interactions compose
  // `executor.find` + `executor.executeAction` over the registry; the
  // DOM-selector-only variants (`click-by-selector`, `read-value`) have no RN
  // analog and return a structured NOT_SUPPORTED envelope.
  { pattern: 'control/page/click-by-text', handler: 'clickByText', httpMethods: ['POST'] },
  { pattern: 'control/page/click-by-selector', handler: 'clickBySelector', httpMethods: ['POST'] },
  { pattern: 'control/page/type-into', handler: 'typeInto', httpMethods: ['POST'] },
  { pattern: 'control/page/read-value', handler: 'readValue', httpMethods: ['POST'] },
  { pattern: 'control/page/find-by-text', handler: 'findByText', httpMethods: ['POST'] },

  // Test hooks — gated behind `features.testHooks`. Let external runners
  // drive the ModalDetector over HTTP so tests can flip `snapshot.modalStack`
  // without mounting React components.
  {
    pattern: 'control/modal/push',
    handler: 'pushModal',
    httpMethods: ['POST'],
    requiresTestHooks: true,
  },
  {
    pattern: 'control/modal/dismiss/:id',
    handler: 'dismissModal',
    httpMethods: ['POST'],
    requiresTestHooks: true,
  },
  {
    pattern: 'control/keep-awake',
    handler: 'keepAwake',
    httpMethods: ['POST'],
    requiresTestHooks: true,
  },

  // Observability — last-N console errors + network requests.
  //
  // Always mounted (not testHooks-gated) so they return a schema-valid 200
  // on every build instead of a 404 that agents can't distinguish from a
  // missing route. The INVASIVE part — monkey-patching `console.error` /
  // `fetch` / `XMLHttpRequest` — stays gated behind `testHooks` (see
  // NativeUIBridgeServer.start → buffer.install()). When the patches aren't
  // installed the handlers report `installed: false` + empty entries, so
  // production builds expose the contract without observing real users'
  // console/network traffic. Set `features.testHooks` (typically on
  // `__DEV__`) to populate the buffers with live data.
  {
    pattern: 'control/console-errors',
    handler: 'getConsoleErrors',
    httpMethods: ['GET'],
  },
  {
    pattern: 'sdk/network-requests',
    handler: 'getNetworkRequests',
    httpMethods: ['GET'],
  },
];

/**
 * The two discovery endpoints, which `routeRequest` special-cases rather than
 * dispatching through `WS_ROUTES` — there is no handler to dispatch to. Both
 * are GET-only.
 *
 * ⚠️ This is the DISPATCH-adjacent copy, not the only one. The same two path
 * strings are also written out in `buildRoutesPayload` (which appends them to
 * the `_routes` manifest) and in the two serving branches of `routeRequest`,
 * and their `HELP` / `ROUTES` entries live in `types.ts`. Adding a third
 * discovery endpoint means touching all four. Only the `types.ts` ↔
 * `buildRoutesPayload` pair is ratcheted, by `route-table-parity.test.ts`;
 * forgetting THIS set silently downgrades the new endpoint's wrong-verb answer
 * to 404 and nothing fails. Collapsing the four into one declaration is a
 * worthwhile follow-up and is not attempted here.
 */
const DISCOVERY_PATHS = new Set(['_help', '_routes']);

/**
 * The verbs this surface serves for a path, in table order.
 *
 * Fills the `Allow` header that RFC 9110 §15.5.6 makes mandatory on a 405, and
 * that the wrong-verb arm answered without: a caller told only "method not
 * allowed" has to guess which verb to retry, which is the guessing game the
 * status mapping exists to end. Read off `WS_ROUTES` — the array `routeRequest`
 * itself iterates — plus `DISCOVERY_PATHS`, which is the other thing
 * `routeRequest` dispatches on, so the header cannot come to disagree with the
 * status about what this surface accepts.
 *
 * `testHooks` is honoured for the same reason `routeRequest` honours it: a
 * production build must not advertise a gated verb it will not serve. `path` is
 * the full request path; the `/ui-bridge/` prefix is stripped here. Empty for a
 * path no route matches, in which case no header is set — that path answers
 * 404, where `Allow` would be meaningless.
 */
function allowedMethodsForPath(path: string, testHooks: boolean): string[] {
  const PREFIX = '/ui-bridge/';
  if (!path.startsWith(PREFIX)) return [];
  const stripped = path.slice(PREFIX.length);

  const methods: string[] = [];
  if (DISCOVERY_PATHS.has(stripped)) methods.push('GET');
  for (const route of WS_ROUTES) {
    if (!route.httpMethods) continue;
    if (route.requiresTestHooks && !testHooks) continue;
    if (parsePath(route.pattern, stripped) === null) continue;
    for (const verb of route.httpMethods) {
      if (!methods.includes(verb)) methods.push(verb);
    }
  }
  return methods;
}

// ── _help payload ───────────────────────────────────────────────────────────

/**
 * Short description keyed by handler name — rendered alongside the route
 * list so `_help` is self-documenting. Only needs to cover handlers that
 * appear in WS_ROUTES.
 */
const HANDLER_DESCRIPTIONS: Record<string, string> = {
  health: 'Liveness probe; returns app metadata + element count',
  pair: 'Get the pairing token: loopback with no code, otherwise body { code }. Direct HTTP only',
  getElements: 'Flat list of registered UI elements',
  getElement: 'Single element by id',
  getElementState: 'Dynamic state (value, focused, checked) for one element',
  executeAction: 'Run an action on an element (see "actions" below for names)',
  getComponents: 'Higher-level components with action schemas',
  getComponent: 'Component detail + per-action paramSchema',
  executeComponentAction: 'Invoke a component action directly (preferred over button clicks)',
  find: 'AI-powered element search by natural-language query',
  getSnapshot:
    'Full snapshot: elements + route + state. Supports ?visibleOnly=true and ?currentRouteOnly=true',
  getPageHealth:
    'Holistic page health diagnostic over current snapshot elements (spatial coverage, layout regions, text/anomaly signals, heatmap). Optional body: { viewport?: { width, height } } to override Dimensions.get("window").',
  getWorkflows: 'List registered workflows',
  runWorkflow: 'Trigger a workflow by id',
  pageRefresh: 'Reload the current route',
  pageNavigate: 'Imperative router.push(url) — preferred over tapping tab buttons',
  pageReplace: 'router.replace(url)',
  pageGoBack: 'router.back()',
  pageGoForward: 'router.forward()',
  getScreenshot: 'PNG screenshot of the current screen',
  getElementStyles: 'Computed styles for an element (design review)',
  getElementStateStyles: 'Computed styles per interaction state (hover/focus/disabled)',
  getDesignSnapshot: 'Visual + style snapshot for design review',
  getResponsiveSnapshots: 'Screenshots at multiple viewport widths',
  runDesignAudit: 'Accessibility + visual audit',
  loadStyleGuide: 'Load a design system style guide',
  getStyleGuide: 'Fetch the currently loaded style guide',
  clearStyleGuide: 'Unload the style guide',
  evaluateQuality: 'Score the current UI against a quality context',
  getQualityContexts: 'List available quality evaluation contexts',
  saveBaseline: 'Save a quality baseline snapshot',
  diffBaseline: 'Diff current UI against a saved baseline',
  getMethods: 'List every handler name (legacy introspection)',
  fillForm:
    'Fill multiple inputs in one call: body { fields: [{elementId, value}] } — each field dispatches `type` + `clear:true`',
  aiForms:
    'STUB — runner-only; mobile returns NOT_SUPPORTED. Use /control/snapshot + filter type==="input" instead.',
  aiIdleStatus:
    'STUB — runner-only; mobile returns NOT_SUPPORTED. Subscribe to registry events over WS for change signals.',
  aiChangeBufferEnable:
    'STUB — runner-only; mobile returns NOT_SUPPORTED. Use WS event subscriptions for change notifications.',
  aiWaitForElement:
    'STUB — runner-only; mobile returns NOT_SUPPORTED. Use the WS waitForElement / waitForCondition JSON-RPC methods.',
  tapAt:
    'Synthesize a press at given screen coords by matching registered element layout rects: body { x, y, action? }',
  clickByText:
    'App-agnostic: press the first element matching free-text (label/accessibilityLabel/testID): body { text, visibleOnly? }',
  clickBySelector:
    'STUB — selector-based; NOT_SUPPORTED on native (no DOM). Use clickByText or /control/find + /control/element/:id/action.',
  typeInto:
    'App-agnostic: type into the input matching a label: body { label, text, clear?, visibleOnly? }. (selector form is web-only)',
  readValue:
    'STUB — selector-based; NOT_SUPPORTED on native (no DOM). Use /control/element/:id/state to read a value.',
  findByText:
    'App-agnostic: list elements matching free-text (no press): body { text, visibleOnly? }',
  getConsoleErrors:
    'Last-N console.error/console.warn entries; ?since=<ms>&limit=<n>. `installed:false` when capture is off (no testHooks) — entries empty but schema-valid.',
  getNetworkRequests:
    'Last-N fetch/XHR entries with status + duration; ?since=<ms>&limit=<n>. `installed:false` when capture is off (no testHooks) — entries empty but schema-valid.',
  pushModal:
    'TEST HOOK — push a modal onto the snapshot.modalStack via the registry ModalDetector',
  dismissModal:
    'TEST HOOK — dismiss a modal by id from the snapshot.modalStack via the registry ModalDetector',
  keepAwake:
    'TEST HOOK — keep the device screen awake via the injected keepAwakeProvider: body { enabled: boolean, durationMs?: number }',
};

/** Static reference for common action names + their params. */
const ACTION_REFERENCE = [
  { name: 'press', aliases: ['click'], params: 'PressActionParams (optional position)' },
  { name: 'longPress', params: 'PressActionParams (optional position)' },
  { name: 'doubleTap', params: 'none' },
  {
    name: 'type',
    params:
      'TypeActionParams { text, delay?, clear? | clearFirst? } — `clear:true` replaces content atomically',
  },
  { name: 'clear', params: 'none — empties the input' },
  { name: 'focus', params: 'none' },
  { name: 'blur', params: 'none' },
  { name: 'scroll', params: 'ScrollActionParams { offset? {x,y}, to? }' },
  {
    name: 'scrollIntoView',
    params:
      "ScrollIntoViewActionParams { padding? (dp, default 16) } — scrolls the element's DECLARED scrollAncestorId ScrollView; returns { alreadyVisible, scrolled }; NOT_SUPPORTED (501) without a usable declared ancestor",
  },
  { name: 'swipe', params: 'SwipeActionParams { direction, distance }' },
  { name: 'toggle', params: 'none — flips boolean controls' },
];

/**
 * Minimal `{method, path}` list matching the runner's `/_routes` shape so
 * the same URL works across platforms. Expanded multi-verb routes into one
 * entry per verb. `testHooks` enables the gated `control/modal/*` endpoints.
 */
function buildRoutesPayload(testHooks: boolean) {
  const entries: Array<{ method: string; path: string }> = [];
  for (const r of WS_ROUTES) {
    if (!r.httpMethods) continue;
    if (r.requiresTestHooks && !testHooks) continue;
    for (const m of r.httpMethods) {
      entries.push({ method: m, path: `/ui-bridge/${r.pattern}` });
    }
  }
  // Expose the two discovery endpoints themselves so self-reference is clean.
  entries.push({ method: 'GET', path: '/ui-bridge/_help' });
  entries.push({ method: 'GET', path: '/ui-bridge/_routes' });
  entries.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { routes: entries, count: entries.length };
}

/**
 * Build the `/_help` payload: route index + action reference.
 * Cheap to compute; we don't cache since it's rarely called.
 * Routes that require `testHooks` are filtered out when the flag is off so
 * agents probing the manifest never see endpoints they can't call.
 */
function buildHelpPayload(testHooks: boolean) {
  return {
    version: 1,
    description: 'UI Bridge Native HTTP surface. Prefix every path with /ui-bridge/.',
    routes: WS_ROUTES.filter((r) => !r.requiresTestHooks || testHooks).map((r) => ({
      pattern: r.pattern,
      httpMethods: r.httpMethods ?? [],
      wsOnly: !r.httpMethods,
      handler: r.handler,
      description: HANDLER_DESCRIPTIONS[r.handler] ?? '',
    })),
    actions: ACTION_REFERENCE,
    tips: [
      'Start with `GET /ui-bridge/control/snapshot?visibleOnly=true` to see what the user actually sees.',
      'Prefer `control/component/:id/action/:actionId` over button presses — typed paramSchema, no button-id guessing.',
      'Use `pageNavigate` for tab switches instead of pressing tab buttons; gesture state often swallows clicks.',
      'The `type` action supports `clear:true` to replace existing text atomically in one call.',
    ],
  };
}

/**
 * HTTP Request interface (library-agnostic)
 */
export interface HTTPRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  /**
   * The socket peer's address. Fill it from the accepted socket and never from a
   * header. Absent reads as not loopback.
   */
  remoteAddress?: string;
  /**
   * The request target exactly as on the request line, `path?query`. A signature
   * covers these bytes, which a parsed `path` and `query` cannot reproduce. A
   * signed request with a query is refused without it.
   */
  rawTarget?: string;
  /** The body exactly as received. A signed request with a body is refused without it. */
  rawBody?: string;
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
 * WebSocket-aware server adapter interface.
 *
 * Extends ServerAdapter with callbacks for WebSocket connections.
 * The adapter manages the raw TCP/WS layer; these callbacks let the
 * UI Bridge server handle message routing and event broadcasting.
 */
export interface WebSocketServerAdapter extends ServerAdapter {
  /**
   * Called BEFORE the 101 goes out. Answer `response` instead of upgrading when
   * `admit` is false. JSON-RPC over the socket drives everything, so this is as
   * much a door as any HTTP route, and only a trusted loopback caller gets through.
   */
  onWebSocketUpgrade?: (req: HTTPRequest) => WebSocketUpgradeDecision;
  /** Called when a JSON text frame is received from a WS client. Returns response string or null. */
  onWebSocketMessage?: (connId: string, message: string) => Promise<string | null>;
  /** Called when a new WS connection is established after the HTTP 101 upgrade. */
  onWebSocketConnect?: (connId: string) => void;
  /** Called when a WS connection is closed or drops. */
  onWebSocketDisconnect?: (connId: string) => void;
  /** Send a message to a specific WS connection by ID. */
  sendToConnection?: (connId: string, message: string) => void;
  /** Send a message to all connected WS clients. */
  broadcast?: (message: string) => void;
}

/** What `onWebSocketUpgrade` decides. */
export type WebSocketUpgradeDecision = { admit: true } | { admit: false; response: HTTPResponse };

/** Who a request was admitted as, or the answer that refuses it. */
type Admission =
  | { admitted: true; as: 'loopback' | 'signed' | 'unauthenticated-network' }
  | { admitted: false; code: string; error: string; data?: Record<string, unknown> };

const HEALTH_PATH = '/ui-bridge/health';
const PAIR_PATH = '/ui-bridge/pair';

/** The `id` of a raw JSON-RPC message, read the way `handleWebSocketMessage` reads it. */
function jsonRpcIdOf(rawMessage: string): number | string {
  try {
    const id = (JSON.parse(rawMessage) as { id?: unknown } | null)?.id;
    return typeof id === 'number' || typeof id === 'string' ? id : 0;
  } catch {
    return 0;
  }
}

/**
 * Native UI Bridge HTTP Server
 */
export class NativeUIBridgeServer {
  private config: NativeServerConfig;
  /** Absent when the app configured no store: non-loopback callers then have no way in. */
  private pairing?: PairingAuthority;
  /** Whether this run's adapter has called `onWebSocketUpgrade` at all. */
  private upgradeGateSeen = false;
  /** Warned once per run rather than per request, which would flood the error ring. */
  private warnedMissingPeer = false;
  private handlers: NativeServerHandlers;
  private adapter?: ServerAdapter;
  private running = false;
  private keepAwakeProvider?: KeepAwakeProvider;
  /**
   * Per-connection cleanup thunks for in-flight waiters (waitForElement,
   * waitForCondition, ...). Aborted when a client disconnects so the
   * underlying timers/listeners don't leak.
   */
  private pendingWaiters = new Map<string, Set<() => void>>();

  /**
   * Observability ring buffers backing `/control/console-errors` and
   * `/sdk/network-requests`. Allocated unconditionally so the handler can
   * always read them, but the global patches (`install()`) only fire on
   * `start()` when observability is enabled (the dedicated `observability`
   * flag, defaulting to `testHooks`) — builds with both off don't
   * monkey-patch.
   */
  private consoleErrorBuffer: ConsoleErrorBuffer;
  private networkRequestBuffer: NetworkRequestBuffer;

  /**
   * Whether the console/network capture should be installed. The dedicated
   * `observability` flag wins when set; otherwise falls back to `testHooks`
   * so consumers predating the flag keep their exact behavior.
   */
  private observabilityEnabled(): boolean {
    return this.config.observability ?? this.config.testHooks === true;
  }

  constructor(
    private registry: NativeUIBridgeRegistry,
    private executor: NativeActionExecutor,
    config: NativeServerConfig = {}
  ) {
    this.config = {
      serverPort: 8087,
      cors: true,
      ...config,
    };
    if (this.config.pairingStore) {
      this.pairing = new PairingAuthority(this.config.pairingStore);
    }
    this.consoleErrorBuffer = new ConsoleErrorBuffer();
    this.networkRequestBuffer = new NetworkRequestBuffer();
    // Mirror appInfo into the registry so `createSnapshot` includes it
    // automatically — keeps the default `getSnapshot` handler and any other
    // call site (e.g. context.createSnapshot, cloud-relay tunnels) on the
    // same code path without each having to thread `appInfo` through.
    if (this.config.appInfo) {
      this.registry.setAppInfo(this.config.appInfo);
    }
    this.handlers = createServerHandlers(registry, executor, {
      appInfo: this.config.appInfo,
      consoleErrorBuffer: this.consoleErrorBuffer,
      networkRequestBuffer: this.networkRequestBuffer,
      viewportProvider: this.config.viewportProvider,
    });

    // Set up method introspection from the route table
    this.handlers.getMethods = async () => {
      const testHooks = this.config.testHooks === true;
      const methods = WS_ROUTES.filter((r) => !r.requiresTestHooks || testHooks).map((r) => ({
        method: r.pattern,
        httpMethods: r.httpMethods ? [...r.httpMethods] : undefined,
      }));
      // Add special WebSocket-only methods not in the route table
      const wsMethods = [
        { method: 'waitForElement', description: 'Wait for an element to be registered' },
        { method: 'waitForCondition', description: 'Wait for an element state predicate' },
        { method: 'sequence', description: 'Execute a sequence of steps in order' },
        { method: 'events/history', description: 'Replay recent registry events' },
        { method: 'subscriptions/list', description: 'List current event subscriptions' },
      ];
      return {
        success: true,
        data: { methods: [...methods, ...wsMethods] },
        timestamp: Date.now(),
      };
    };
  }

  /**
   * Set the server adapter
   */
  setAdapter(adapter: ServerAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Set the device's stable id. An app usually loads it from storage after the
   * server has started, and this spares it a restart that would drop every
   * socket and any armed code.
   */
  setDeviceId(deviceId: string | undefined): void {
    this.config.deviceId = deviceId;
  }

  /**
   * Set a navigation provider for programmatic route navigation.
   * This enables `control/page/navigate` and `control/page/back` on native.
   */
  setNavigationProvider(provider: NavigationProvider): void {
    this.handlers.pageNavigate = async (ctx): Promise<APIResponse<PageNavigationResponse>> => {
      const body = ctx.body as Record<string, unknown> | undefined;
      const url = body?.url;
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'Missing required "url" parameter', timestamp: Date.now() };
      }
      try {
        provider.navigate(url);
        return {
          success: true,
          data: { success: true, url, timestamp: Date.now() },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Navigation failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };

    this.handlers.pageReplace = async (ctx): Promise<APIResponse<PageNavigationResponse>> => {
      if (!provider.replace) {
        return {
          success: false,
          error: 'Replace navigation not supported by navigation provider',
          timestamp: Date.now(),
        };
      }
      const body = ctx.body as Record<string, unknown> | undefined;
      const url = body?.url;
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'Missing required "url" parameter', timestamp: Date.now() };
      }
      try {
        provider.replace(url);
        return {
          success: true,
          data: { success: true, url, timestamp: Date.now() },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Replace navigation failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };

    this.handlers.pageGoBack = async (): Promise<APIResponse<PageNavigationResponse>> => {
      if (!provider.back) {
        return { success: false, error: 'Back navigation not supported', timestamp: Date.now() };
      }
      try {
        provider.back();
        return {
          success: true,
          data: { success: true, timestamp: Date.now() },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Back navigation failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };

    this.handlers.pageRefresh = async (): Promise<APIResponse<PageNavigationResponse>> => {
      if (!provider.refresh) {
        return {
          success: false,
          error: 'Page refresh not supported by navigation provider',
          timestamp: Date.now(),
        };
      }
      try {
        provider.refresh();
        return {
          success: true,
          data: { success: true, timestamp: Date.now() },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Refresh failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };
  }

  /**
   * Set a route provider for reporting the current navigation route.
   * When set, `control/snapshot` responses include `currentRoute` and
   * `segments`, plus the canonical `route` / `activeTab` aliases the web SDK's
   * `BridgeSnapshot` spells the same way.
   *
   * Also forwards the provider into the registry so the *default*
   * `getSnapshot` handler (and any other call site of
   * `registry.createSnapshot`) reads the route too — without this the
   * cloud-relay/bare-server path returned `currentRoute: null` even when
   * a `RouteTracker` was wired, because that path never installed the
   * server-level handler override below.
   */
  setRouteProvider(provider: RouteProvider): void {
    this.registry.setRouteProvider(provider);
    // Override getElements to support currentRouteOnly filtering with real route data
    const baseGetElements = this.handlers.getElements;
    this.handlers.getElements = async (ctx: HandlerContext) => {
      const currentRouteOnly =
        ctx.query?.currentRouteOnly === 'true' ||
        (ctx.body as Record<string, unknown>)?.currentRouteOnly === true;

      // If currentRouteOnly requested and no explicit route param, inject the current route
      if (currentRouteOnly && !ctx.query?.route && !(ctx.body as Record<string, unknown>)?.route) {
        // Defensive for the same reason as `getSnapshot` below: a throwing
        // provider must degrade to "no route filter", not 500 the route.
        let currentRoute: string | null;
        try {
          currentRoute = provider.getCurrentRoute();
        } catch {
          currentRoute = null;
        }
        if (currentRoute) {
          // Inject route into query so the base handler can filter by it
          ctx.query = { ...ctx.query, route: currentRoute };
        }
      }
      return baseGetElements(ctx);
    };

    this.handlers.getSnapshot = async (ctx: HandlerContext) => {
      const visibleOnly =
        ctx?.query?.visibleOnly === 'true' ||
        (ctx?.body as Record<string, unknown>)?.visibleOnly === true;
      const currentRouteOnly =
        ctx?.query?.currentRouteOnly === 'true' ||
        (ctx?.body as Record<string, unknown>)?.currentRouteOnly === true;
      // Read the provider defensively. The registry's own fallback path wraps
      // these same calls in a try/catch and degrades to a null route; without
      // the same guard here a host whose provider throws mid-navigation turns
      // the whole `control/snapshot` response into a 500 instead of a snapshot
      // that simply does not know its route.
      //
      // THREE separate guards, not one, because the three facts fail
      // independently and `currentRoute` is load-bearing: `createSnapshot`
      // applies the `currentRouteOnly` filter only when `currentRoute` is
      // truthy, so letting an optional `getSegments()` throw discard a route we
      // successfully read would answer `?currentRouteOnly=true` with EVERY
      // registered element in the app, labelled as the current route's. That
      // turns a loud 500 into a silent wrong answer a runner would act on.
      let currentRoute: string | null;
      try {
        currentRoute = provider.getCurrentRoute() ?? null;
      } catch {
        currentRoute = null;
      }
      let segments: string[] | undefined;
      try {
        segments = provider.getSegments?.();
      } catch {
        segments = undefined;
      }
      // Passed explicitly rather than left to the registry to resolve. The
      // registry's `resolveActiveTab` reads whatever provider is registered on
      // IT, which is not necessarily this one — a host that detaches with
      // `registry.setRouteProvider(null)` (the documented HMR/teardown escape
      // hatch) would leave this closure still reporting the right `route` while
      // `activeTab` silently reverted to the segment derivation. Reading our own
      // provider keeps the emitted snapshot internally consistent.
      let activeTab: string | null | undefined;
      try {
        activeTab = provider.getActiveTab?.();
      } catch {
        activeTab = undefined;
      }
      const snapshot = this.registry.createSnapshot(
        { currentRoute, segments, activeTab },
        { visibleOnly, currentRouteOnly }
      );
      return { success: true, data: snapshot, timestamp: Date.now() };
    };
  }

  /**
   * Set a screenshot provider for native screen capture.
   * This enables `control/screenshot` on native.
   */
  setScreenshotProvider(provider: ScreenshotProvider): void {
    const SCREENSHOT_TIMEOUT_MS = 10_000;
    this.handlers.getScreenshot = async () => {
      try {
        const result = await Promise.race([
          provider.capture(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error(`Screenshot capture timed out after ${SCREENSHOT_TIMEOUT_MS}ms`)),
              SCREENSHOT_TIMEOUT_MS
            )
          ),
        ]);
        return {
          success: true,
          data: { screenshot: result.base64, width: result.width, height: result.height },
          timestamp: Date.now(),
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: `Screenshot capture failed: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        };
      }
    };
  }

  /**
   * Set a keep-awake provider for native screen-wake control.
   * This enables `control/keep-awake` and arms the auto-arm hook in
   * handleRequest (every request keeps the screen alive for 60s).
   */
  setKeepAwakeProvider(provider: KeepAwakeProvider): void {
    this.keepAwakeProvider = provider;
    this.handlers.keepAwake = async (ctx) => {
      const { enabled, durationMs } = (ctx.body ?? {}) as {
        enabled?: unknown;
        durationMs?: unknown;
      };
      if (typeof enabled !== 'boolean') {
        return {
          success: false,
          error: 'enabled must be boolean',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        };
      }
      if (enabled) {
        provider.request('ui-bridge', typeof durationMs === 'number' ? durationMs : undefined);
      } else {
        provider.release('ui-bridge');
      }
      return {
        success: true,
        data: { enabled, durationMs: typeof durationMs === 'number' ? durationMs : null },
        timestamp: Date.now(),
      };
    };
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
      console.warn('[ui-bridge-native] No server adapter configured. Call setAdapter() first.');
      console.warn('[ui-bridge-native] See documentation for supported adapters.');
      return;
    }

    // Install observability patches before binding the port — gated behind
    // the dedicated `observability` flag, which defaults to `testHooks` so
    // existing consumers are unchanged. Decoupling the two lets release
    // builds capture console/network evidence without also exposing the
    // testHooks-gated control surface (`control/modal/*` etc.).
    if (this.observabilityEnabled()) {
      this.consoleErrorBuffer.install();
      this.networkRequestBuffer.install();
    }

    this.upgradeGateSeen = false;
    this.warnedMissingPeer = false;
    if (this.config.allowUnauthenticatedNetwork) {
      console.warn(
        '[ui-bridge-native] allowUnauthenticatedNetwork is on: anyone who can reach this port can drive the app over HTTP.'
      );
    } else if (!this.pairing) {
      console.warn(
        '[ui-bridge-native] No pairingStore configured: non-loopback callers are refused with PAIRING_UNCONFIGURED.'
      );
    }

    await this.adapter.start(this.config.serverPort!, this.handleNetworkRequest.bind(this));
    this.running = true;

    console.log(`[ui-bridge-native] HTTP server started on port ${this.config.serverPort}`);
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

    // Restore the original globals; idempotent if never installed.
    this.consoleErrorBuffer.uninstall();
    this.networkRequestBuffer.uninstall();

    console.log('[ui-bridge-native] HTTP server stopped');
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  // ── WebSocket Support ───────────────────────────────────────────────────

  private eventBridge?: WebSocketEventBridge;

  /**
   * Set the event bridge for WebSocket event broadcasting and subscriptions.
   */
  setEventBridge(bridge: WebSocketEventBridge): void {
    this.eventBridge = bridge;
  }

  /**
   * The entry a socket's messages come through. An adapter that never called
   * `onWebSocketUpgrade` admitted the socket with no check, and a message carries
   * no peer to check now, so it is refused: the same fail-closed reading as a
   * missing peer address. An adapter that gates sees a call before its first socket.
   */
  async handleNetworkWebSocketMessage(connId: string, rawMessage: string): Promise<string | null> {
    if (!this.upgradeGateSeen) {
      return JSON.stringify({
        id: jsonRpcIdOf(rawMessage),
        result: {
          success: false,
          error: 'This server adapter does not gate WebSocket upgrades (onWebSocketUpgrade).',
          code: 'PAIRING_UNCONFIGURED',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }
    return this.handleWebSocketMessage(connId, rawMessage);
  }

  /**
   * Handle a JSON-RPC message from a WebSocket client.
   * Parses the message, routes to the appropriate handler, and returns
   * a JSON string response (or null for events that need no response).
   */
  async handleWebSocketMessage(connId: string, rawMessage: string): Promise<string | null> {
    let msg: unknown;
    try {
      msg = JSON.parse(rawMessage);
    } catch {
      return JSON.stringify({
        error: 'Invalid JSON',
        timestamp: Date.now(),
      });
    }

    if (typeof msg !== 'object' || msg === null) {
      return JSON.stringify({
        error: 'Message must be a JSON object',
        timestamp: Date.now(),
      });
    }

    const message = msg as Record<string, unknown>;
    const id = (message.id as string | number | undefined) ?? 0;

    // Handle batch requests
    if (isBatchRequest(message)) {
      const results = await this.handleBatchRequest(message.batch);
      return JSON.stringify({ id, results });
    }

    // Handle subscribe
    if (isSubscribe(message)) {
      const events = message.params?.events || [];
      const throttleMs = message.params?.throttleMs;
      const ok = this.eventBridge?.handleSubscribe(connId, events, throttleMs) ?? false;
      return JSON.stringify({
        id,
        result: {
          success: ok,
          data: { subscribed: events },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // Handle unsubscribe
    if (isUnsubscribe(message)) {
      const events = message.params?.events || [];
      const ok = this.eventBridge?.handleUnsubscribe(connId, events) ?? false;
      return JSON.stringify({
        id,
        result: {
          success: ok,
          data: { unsubscribed: events },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    const method = message.method as string;
    const params = (message.params || {}) as Record<string, unknown>;

    // ── Connection-aware special methods ──────────────────────────────────

    // subscriptions/list — return current subscriptions + throttle for this connection
    if (method === 'subscriptions/list') {
      const events = this.eventBridge?.getSubscriptions(connId) ?? [];
      const throttleMs = this.eventBridge?.getThrottleMs(connId);
      return JSON.stringify({
        id,
        result: {
          success: true,
          data: { events, throttleMs: throttleMs ?? null },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // waitForElement — resolve when element is registered, or timeout
    if (method === 'waitForElement') {
      return this.handleWaitForElement(connId, id, params);
    }

    // waitForCondition — resolve when an element state predicate becomes true
    if (method === 'waitForCondition') {
      return this.handleWaitForCondition(connId, id, params);
    }

    // sequence — execute steps in order, stop on first failure
    if (method === 'sequence') {
      return this.handleSequence(id, params);
    }

    // events/history — replay recent events matching optional filter
    if (method === 'events/history') {
      const eventsFilter = Array.isArray(params.events) ? (params.events as string[]) : undefined;
      const since = typeof params.since === 'number' ? params.since : undefined;
      const limit = typeof params.limit === 'number' ? params.limit : undefined;
      const history = this.eventBridge?.getHistory({ events: eventsFilter, since }) ?? [];
      const sliced =
        limit !== undefined && limit > 0 && history.length > limit
          ? history.slice(history.length - limit)
          : history;
      return JSON.stringify({
        id,
        result: {
          success: true,
          data: { events: sliced },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // Standard JSON-RPC request

    if (!method) {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing "method" field',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    try {
      const apiResponse = await this.routeMethodToHandler(method, params);
      return JSON.stringify({ id, result: apiResponse } satisfies JsonRpcResponse);
    } catch (error) {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: error instanceof Error ? error.message : 'Internal error',
          code: 'INTERNAL_ERROR',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }
  }

  /**
   * Execute a batch of JSON-RPC requests concurrently.
   */
  async handleBatchRequest(batch: JsonRpcRequest[]): Promise<JsonRpcResponse[]> {
    return Promise.all(
      batch.map(async (req) => {
        try {
          const result = await this.routeMethodToHandler(
            req.method,
            (req.params || {}) as Record<string, unknown>
          );
          return { id: req.id, result } as JsonRpcResponse;
        } catch (error) {
          return {
            id: req.id,
            result: {
              success: false,
              error: error instanceof Error ? error.message : 'Internal error',
              code: 'INTERNAL_ERROR',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse;
        }
      })
    );
  }

  /**
   * Register an in-flight waiter's cleanup thunk under the given connection.
   * Returns an `unregister` thunk that the natural-resolution path should
   * call so the cleanup isn't re-invoked on disconnect.
   */
  private registerWaiter(connId: string, cleanup: () => void): () => void {
    let set = this.pendingWaiters.get(connId);
    if (!set) {
      set = new Set();
      this.pendingWaiters.set(connId, set);
    }
    set.add(cleanup);
    return () => {
      const s = this.pendingWaiters.get(connId);
      if (!s) return;
      s.delete(cleanup);
      if (s.size === 0) this.pendingWaiters.delete(connId);
    };
  }

  /**
   * Abort all pending waiters associated with a connection. Called by the
   * provider's WS disconnect handler so timers/listeners don't leak after
   * the client goes away.
   */
  abortWaitersForConnection(connId: string): void {
    const set = this.pendingWaiters.get(connId);
    if (!set) return;
    for (const cleanup of set) {
      try {
        cleanup();
      } catch (err) {
        console.warn('[ui-bridge-native] waiter cleanup threw:', err);
      }
    }
    this.pendingWaiters.delete(connId);
  }

  /**
   * Wait for an element to be registered, or resolve immediately if it already exists.
   * Returns a JsonRpcResponse JSON string.
   */
  private async handleWaitForElement(
    connId: string,
    id: string | number,
    params: Record<string, unknown>
  ): Promise<string> {
    const targetId = params.id;
    const timeout = typeof params.timeout === 'number' ? params.timeout : 10000;

    if (!targetId || typeof targetId !== 'string') {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing or invalid "id" parameter',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // Already registered — return immediately
    const existing = this.registry.getElement(targetId);
    if (existing) {
      return JSON.stringify({
        id,
        result: {
          success: true,
          data: {
            id: targetId,
            state: existing.getState(),
            identifier: existing.getIdentifier(),
            waited: false,
          },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    // Wait for element:registered event with matching id, or timeout
    return new Promise<string>((resolve) => {
      let settled = false;
      let unsub: (() => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unregister: (() => void) | null = null;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (unsub) {
          unsub();
          unsub = null;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (unregister) {
          unregister();
          unregister = null;
        }
      };

      // Track this waiter so it can be aborted if the connection closes.
      unregister = this.registerWaiter(connId, () => {
        cleanup();
        resolve(
          JSON.stringify({
            id,
            result: {
              success: false,
              error: 'Connection closed before element was registered',
              code: 'CONNECTION_CLOSED',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      });

      unsub = this.registry.on('element:registered', (event: BridgeEvent) => {
        if (settled) return;
        const data = event.data as { id?: string } | undefined;
        if (data?.id !== targetId) return;

        cleanup();
        const el = this.registry.getElement(targetId);
        resolve(
          JSON.stringify({
            id,
            result: {
              success: true,
              data: {
                id: targetId,
                state: el?.getState() ?? null,
                identifier: el?.getIdentifier() ?? null,
                waited: true,
              },
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      });

      timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve(
          JSON.stringify({
            id,
            result: {
              success: false,
              error: `Timeout waiting for element: ${targetId}`,
              code: 'TIMEOUT',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      }, timeout);
    });
  }

  /**
   * Wait for an arbitrary element-state predicate to become true.
   *
   * Supported `condition` shapes:
   *   {field: "mounted"|"visible"|"enabled"|"focused", equals: boolean}
   *   {field: "layout", exists: true}
   *   {field: string, equals: unknown}  // generic: state[field] === equals
   *
   * Resolves immediately with `waited:false` if the predicate already
   * holds. Otherwise subscribes to `element:registered` and
   * `element:stateChanged` until the predicate matches or timeout fires.
   */
  private async handleWaitForCondition(
    connId: string,
    id: string | number,
    params: Record<string, unknown>
  ): Promise<string> {
    const targetId = params.elementId;
    const condition = params.condition as
      | { field?: string; equals?: unknown; exists?: boolean }
      | undefined;
    const timeout = typeof params.timeout === 'number' ? params.timeout : 10000;

    if (!targetId || typeof targetId !== 'string') {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing or invalid "elementId" parameter',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }
    if (!condition || typeof condition.field !== 'string') {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing or invalid "condition.field"',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    const evaluate = (state: Record<string, unknown> | null | undefined): boolean => {
      if (!state) return false;
      const value = state[condition.field as string];
      if (condition.exists === true) return value !== null && value !== undefined;
      if ('equals' in condition) return value === condition.equals;
      return false;
    };

    const makeResult = (state: Record<string, unknown> | null, waited: boolean) =>
      JSON.stringify({
        id,
        result: {
          success: true,
          data: { id: targetId, state, waited },
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);

    // Fast path: already holds.
    const existing = this.registry.getElement(targetId);
    if (existing) {
      const state = existing.getState() as unknown as Record<string, unknown> | null;
      if (evaluate(state)) {
        return makeResult(state, false);
      }
    }

    return new Promise<string>((resolve) => {
      let settled = false;
      let unsubRegistered: (() => void) | null = null;
      let unsubStateChanged: (() => void) | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unregister: (() => void) | null = null;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (unsubRegistered) {
          unsubRegistered();
          unsubRegistered = null;
        }
        if (unsubStateChanged) {
          unsubStateChanged();
          unsubStateChanged = null;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (unregister) {
          unregister();
          unregister = null;
        }
      };

      unregister = this.registerWaiter(connId, () => {
        cleanup();
        resolve(
          JSON.stringify({
            id,
            result: {
              success: false,
              error: 'Connection closed before condition was met',
              code: 'CONNECTION_CLOSED',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      });

      const checkAndResolve = () => {
        if (settled) return;
        const el = this.registry.getElement(targetId);
        if (!el) return;
        const state = el.getState() as unknown as Record<string, unknown> | null;
        if (evaluate(state)) {
          cleanup();
          resolve(makeResult(state, true));
        }
      };

      unsubRegistered = this.registry.on('element:registered', (event: BridgeEvent) => {
        if (settled) return;
        const data = event.data as { id?: string } | undefined;
        if (data?.id !== targetId) return;
        checkAndResolve();
      });

      unsubStateChanged = this.registry.on('element:stateChanged', (event: BridgeEvent) => {
        if (settled) return;
        const data = event.data as { id?: string } | undefined;
        if (data?.id !== targetId) return;
        checkAndResolve();
      });

      timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        resolve(
          JSON.stringify({
            id,
            result: {
              success: false,
              error: `Timeout waiting for condition on element: ${targetId}`,
              code: 'TIMEOUT',
              timestamp: Date.now(),
            },
          } satisfies JsonRpcResponse)
        );
      }, timeout);
    });
  }

  /**
   * Execute a sequence of JSON-RPC steps in order, stopping on first failure.
   * Returns a JsonRpcResponse JSON string with per-step results.
   */
  private async handleSequence(
    id: string | number,
    params: Record<string, unknown>
  ): Promise<string> {
    const rawSteps = params.steps;

    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      return JSON.stringify({
        id,
        result: {
          success: false,
          error: 'Missing or empty "steps" array',
          code: 'INVALID_REQUEST',
          timestamp: Date.now(),
        },
      } satisfies JsonRpcResponse);
    }

    const steps = rawSteps as Array<{ method: string; params?: Record<string, unknown> }>;
    const results: Array<{ step: number; method: string; result: APIResponse }> = [];
    let allSuccess = true;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (!step || typeof step.method !== 'string') {
        results.push({
          step: i,
          method: String(step?.method ?? ''),
          result: {
            success: false,
            error: 'Step is missing "method" field',
            code: 'INVALID_REQUEST',
            timestamp: Date.now(),
          },
        });
        allSuccess = false;
        break;
      }

      try {
        const stepResult = await this.routeMethodToHandler(step.method, step.params ?? {});
        results.push({ step: i, method: step.method, result: stepResult });
        if (!stepResult.success) {
          allSuccess = false;
          break;
        }
      } catch (err) {
        results.push({
          step: i,
          method: step.method,
          result: {
            success: false,
            error: err instanceof Error ? err.message : 'Step execution failed',
            code: 'STEP_FAILED',
            timestamp: Date.now(),
          },
        });
        allSuccess = false;
        break;
      }
    }

    return JSON.stringify({
      id,
      result: {
        success: allSuccess,
        data: {
          completedSteps: results.length,
          totalSteps: steps.length,
          results,
        },
        timestamp: Date.now(),
      },
    } satisfies JsonRpcResponse);
  }

  /**
   * Route a JSON-RPC method string to the appropriate handler using path-style matching.
   *
   * Method strings mirror HTTP routes but without the /ui-bridge/ prefix.
   * Path params are extracted from :name placeholders in the route pattern.
   *
   * Examples:
   *   "health"                                           → handlers.health
   *   "control/snapshot"                                 → handlers.getSnapshot
   *   "control/element/tab-runs/action"                  → handlers.executeAction ({id:'tab-runs'})
   *   "control/component/my-comp/action/submit"          → handlers.executeComponentAction
   */
  private async routeMethodToHandler(
    method: string,
    params: Record<string, unknown>
  ): Promise<APIResponse> {
    const testHooks = this.config.testHooks === true;
    for (const route of WS_ROUTES) {
      const pathParams = parsePath(route.pattern, method);
      if (!pathParams) continue;

      // Test-hook routes are invisible over WS too when the flag is off.
      if (route.requiresTestHooks && !testHooks) continue;

      const ctx: HandlerContext = {
        params: pathParams,
        query:
          params.query && typeof params.query === 'object'
            ? (params.query as Record<string, string>)
            : {},
        body: params,
      };

      return this.handlers[route.handler](ctx);
    }

    return {
      success: false,
      error: `Unknown method: ${method}`,
      code: 'NOT_FOUND',
      timestamp: Date.now(),
    };
  }

  // ── Device pairing ──────────────────────────────────────────────────────

  /**
   * What `start()` hands the adapter: every request off the socket comes through
   * here, and `handleRequest` sits behind it.
   *
   * | Caller                                                   | Admitted |
   * |----------------------------------------------------------|----------|
   * | Loopback peer, no web context, loopback `Host`           | yes      |
   * | Anyone with a valid `X-UI-Bridge-Auth` signature         | yes      |
   * | Anyone, `GET /ui-bridge/health` (trimmed)                | yes      |
   * | Anyone with no web context, `POST /ui-bridge/pair`       | yes      |
   * | A web page, `POST /ui-bridge/pair`                       | 403 `PAIRING_WEB_CALLER_REFUSED` |
   * | Signature outside the window or below the floor          | 401 `PAIRING_TIMESTAMP_REFUSED` |
   * | Signed body over `SIGNED_BODY_MAX_CHARS`                 | 413 `PAIRING_BODY_TOO_LARGE` |
   * | Signed method or target over its cap                     | 414 `PAIRING_TARGET_TOO_LONG` |
   * | Everyone else                                            | 401 `PAIRING_REQUIRED` |
   * | No store configured, not loopback                        | 401 `PAIRING_UNCONFIGURED` |
   * | Under `allowUnauthenticatedNetwork`, a web page or a rebindable `Host` | 403 `PAIRING_WEB_CALLER_REFUSED` |
   *
   * The gate is here rather than in `handleRequest` because `CloudRelayClient`
   * calls that directly and must keep working: relay access already means the
   * same user account, checked by the backend.
   */
  async handleNetworkRequest(request: HTTPRequest): Promise<HTTPResponse> {
    try {
      if (request.method === 'POST' && request.path === PAIR_PATH) {
        return await this.handlePair(request);
      }
      const admission = await this.admit(request);
      if (request.method === 'GET' && request.path === HEALTH_PATH) {
        return await this.handleNetworkHealth(request, admission);
      }
      if (!admission.admitted) {
        return this.refusal(admission.code, admission.error, { data: admission.data });
      }
      return await this.handleRequest(request);
    } catch {
      // Fixed text, not the error's: a store's failure could quote what it held.
      return this.refusal('INTERNAL_ERROR', 'Internal server error', { status: 500 });
    }
  }

  /**
   * The WebSocket door: trusted loopback or nothing, whatever else the request
   * carries. A signature covers no upgrade intent, so one swallowed GET re-sent
   * with `Upgrade: websocket` would become a permanent control socket, and a socket
   * outlives the signature's window. `allowUnauthenticatedNetwork` opens HTTP only,
   * and no runner dials a device's socket.
   */
  handleWebSocketUpgrade(request: HTTPRequest): WebSocketUpgradeDecision {
    this.upgradeGateSeen = true;
    if (this.isTrustedLoopback(request)) return { admit: true };
    return {
      admit: false,
      response: this.refusal(
        'PAIRING_WS_LOOPBACK_ONLY',
        'WebSocket upgrades are accepted only from this machine. Use signed HTTP from anywhere else.'
      ),
    };
  }

  private isTrustedLoopback(request: HTTPRequest): boolean {
    if (!request.remoteAddress && !this.warnedMissingPeer) {
      this.warnedMissingPeer = true;
      console.warn(
        '[ui-bridge-native] A request arrived with no peer address and is treated as not loopback. ' +
          'The server adapter must pass remoteAddress.'
      );
    }
    return isTrustedLoopbackRequest(request);
  }

  private async admit(request: HTTPRequest): Promise<Admission> {
    if (this.isTrustedLoopback(request)) return { admitted: true, as: 'loopback' };
    if (this.config.allowUnauthenticatedNetwork) {
      if (isWebReachableRequest(request)) {
        return {
          admitted: false,
          code: 'PAIRING_WEB_CALLER_REFUSED',
          error: 'A web page cannot drive this device.',
        };
      }
      return { admitted: true, as: 'unauthenticated-network' };
    }
    if (!this.pairing) {
      return {
        admitted: false,
        code: 'PAIRING_UNCONFIGURED',
        error: 'This app has not configured device pairing, so it accepts only local callers.',
      };
    }
    const required: Admission = {
      admitted: false,
      code: 'PAIRING_REQUIRED',
      error:
        'This device requires pairing. Sign the request with the token from POST /ui-bridge/pair.',
    };
    const signatures = headerValues(request.headers, UI_BRIDGE_AUTH_HEADER);
    if (signatures.length !== 1) return required;
    const verdict = await this.pairing.verifySignature(request, signatures[0]);
    if (verdict === 'valid') return { admitted: true, as: 'signed' };
    if (verdict === 'store_unavailable') {
      return {
        admitted: false,
        code: 'PAIRING_UNAVAILABLE',
        error: 'The pairing store is not available yet. Try again.',
      };
    }
    if (verdict === 'timestamp_refused') {
      return {
        admitted: false,
        code: 'PAIRING_TIMESTAMP_REFUSED',
        error:
          'The signature timestamp is not acceptable. Re-sync to data.serverTime and sign again.',
        data: { serverTime: Date.now() },
      };
    }
    if (verdict === 'body_too_large') {
      return {
        admitted: false,
        code: 'PAIRING_BODY_TOO_LARGE',
        error: `A signed body may be at most ${SIGNED_BODY_MAX_CHARS} characters.`,
      };
    }
    if (verdict === 'target_too_long') {
      return {
        admitted: false,
        code: 'PAIRING_TARGET_TOO_LONG',
        error: `A signed target may be at most ${SIGNED_TARGET_MAX_CHARS} characters.`,
      };
    }
    return required;
  }

  private corsHeaders(): Record<string, string> {
    if (!this.config.cors) return {};
    return {
      'Access-Control-Allow-Origin': this.config.allowedOrigins
        ? this.config.allowedOrigins.join(',')
        : '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
  }

  /** No CORS header: a page must not be able to read what the gate says. */
  private refusal(
    code: string,
    error: string,
    extra: { status?: number; data?: Record<string, unknown> } = {}
  ): HTTPResponse {
    const body: APIResponse = {
      success: false,
      error,
      code,
      timestamp: Date.now(),
      ...(extra.data ? { data: extra.data } : {}),
    };
    return {
      status: extra.status ?? httpStatusForResponse(body),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  /**
   * Open health. An admitted caller gets the full answer. Anyone else gets what
   * discovery needs and nothing about the app's contents, and that answer is
   * built without going through `handleRequest`, whose keep-awake auto-arm is no
   * business of an anonymous LAN probe. It carries no CORS header, so a web page
   * cannot read the stable device id.
   */
  private async handleNetworkHealth(
    request: HTTPRequest,
    admission: Admission
  ): Promise<HTTPResponse> {
    const pairing = {
      required: !(
        admission.admitted &&
        (admission.as === 'loopback' || admission.as === 'unauthenticated-network')
      ),
      authenticated: admission.admitted && admission.as !== 'unauthenticated-network',
    };
    const identity = {
      deviceId: this.config.deviceId ?? null,
      serverTime: Date.now(),
      pairing,
    };

    if (admission.admitted) {
      const response = await this.handleRequest(request);
      const parsed = JSON.parse(response.body) as APIResponse<Record<string, unknown>>;
      if (!parsed.success || !parsed.data) return response;
      return {
        ...response,
        body: JSON.stringify({ ...parsed, data: { ...parsed.data, ...identity } }),
      };
    }

    const health = await this.handlers.health({ params: {}, query: {}, body: undefined });
    const full = (health.data ?? {}) as { status?: unknown; uiBridge?: Record<string, unknown> };
    const trimmed: Record<string, unknown> = { status: full.status, ...identity };
    if (full.uiBridge) {
      const { version, appId, appName, appType, framework } = full.uiBridge;
      trimmed.uiBridge = { version, appId, appName, appType, framework };
    }
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: trimmed, timestamp: Date.now() }),
    };
  }

  /**
   * `POST /ui-bridge/pair`, the only way to a token, and only ever from here.
   * Its answer carries no CORS header, because no web page has any business
   * reading a token, and it answers only after the store write has finished. A web
   * page is refused first of all, so it cannot burn an attempt or the armed code.
   */
  private async handlePair(request: HTTPRequest): Promise<HTTPResponse> {
    if (carriesWebContext(request)) {
      return this.refusal('PAIRING_WEB_CALLER_REFUSED', 'A web page cannot pair with this device.');
    }
    if (!this.pairing) {
      return this.refusal(
        'PAIRING_UNCONFIGURED',
        'This app has not configured device pairing, so it cannot issue a token.'
      );
    }
    const deviceId = this.config.deviceId;
    // Ahead of the code, so a phone that cannot pair yet does not spend one.
    if (!deviceId) {
      return this.refusal('PAIRING_UNAVAILABLE', 'The device id is not available yet. Try again.');
    }
    const outcome = await this.pairing.pair({
      trustedLoopback: this.isTrustedLoopback(request),
      peer: request.remoteAddress,
      body: request.body,
    });
    if (!outcome.ok) return this.refusal(outcome.code, outcome.error);
    const body: APIResponse = {
      success: true,
      data: { token: outcome.token, deviceId, serverTime: Date.now() },
      timestamp: Date.now(),
    };
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
    };
  }

  /**
   * Arm a 6-digit code for a LAN pairing. In memory and single use. It stops
   * working after about 2 minutes, or after 5 wrong attempts from anyone. Rejects
   * with a `PairingError` when no store is configured or it has not loaded.
   */
  async armPairingCode(): Promise<ArmedPairingCode> {
    return this.requirePairing().arm();
  }

  /** Cancel a live code. */
  disarmPairingCode(): void {
    this.pairing?.disarm();
  }

  /** What Settings shows, including the peer that consumed the last code. */
  getPairingState(): PairingState {
    return this.pairing?.getState() ?? UNCONFIGURED_PAIRING_STATE;
  }

  /**
   * Replace the token, so every signature made with the old one stops verifying.
   * There are no network sockets to close, because none is ever admitted.
   */
  async revokePairing(): Promise<void> {
    await this.requirePairing().revoke();
  }

  private requirePairing(): PairingAuthority {
    if (!this.pairing) {
      throw new PairingError('PAIRING_UNCONFIGURED', 'No pairingStore is configured.');
    }
    return this.pairing;
  }

  /**
   * Handle incoming HTTP request, past the gate.
   *
   * Exposed as public so that CloudRelayClient can call it directly (without
   * loopback TCP overhead) when processing tunneled requests. Anything reached
   * from a socket goes through `handleNetworkRequest` first.
   */
  async handleRequest(request: HTTPRequest): Promise<HTTPResponse> {
    // Add CORS headers if enabled
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.corsHeaders(),
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return { status: 204, headers, body: '' };
    }

    // Auto-arm: when test hooks are enabled and a keep-awake provider is
    // wired, every incoming request keeps the screen alive for 60s so an
    // external runner driving the device never loses it to a screen lock.
    // Best-effort — must never throw and break the request. This is the
    // single chokepoint for HTTP, WS-tunnelled, and cloud-relay paths
    // (CloudRelayClient calls handleRequest directly).
    if (this.config.testHooks === true && this.keepAwakeProvider) {
      try {
        this.keepAwakeProvider.request('auto-arm', 60_000);
      } catch {
        /* keep-awake is best-effort; never break a request */
      }
    }

    try {
      const response = await this.routeRequest(request);
      // A 405 must name the verbs that ARE accepted, or the caller is left
      // guessing exactly as it was under the blanket 400. `Allow` is not a
      // CORS-safelisted response header, so without `Access-Control-Expose-
      // Headers` a cross-origin browser caller — a web page or a browser-based
      // agent — reads `null` from it and gets nothing from this at all.
      if (response.code === 'METHOD_NOT_ALLOWED') {
        const allow = allowedMethodsForPath(request.path, this.config.testHooks === true);
        if (allow.length > 0) {
          headers['Allow'] = allow.join(', ');
          if (this.config.cors) headers['Access-Control-Expose-Headers'] = 'Allow';
        }
      }
      return {
        status: httpStatusForResponse(response),
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
   * Route an HTTP request to the appropriate handler using WS_ROUTES.
   *
   * Strips the `/ui-bridge/` prefix from the path, then iterates the shared
   * WS_ROUTES table. Each route's `pattern` is matched against the stripped
   * path via the module-level `parsePath` helper; path params are merged
   * with the request body into a HandlerContext.
   *
   * `httpMethods` disambiguates routes that share a pattern but differ
   * by verb (e.g. GET vs DELETE on `design/style-guide`). A route without
   * `httpMethods` is WS-only and will not be matched on HTTP.
   */
  private async routeRequest(request: HTTPRequest): Promise<APIResponse> {
    const { method, path, query, body } = request;

    const PREFIX = '/ui-bridge/';
    if (!path.startsWith(PREFIX)) {
      return {
        success: false,
        error: `Route not found: ${method} ${path}`,
        code: 'NOT_FOUND',
        timestamp: Date.now(),
      };
    }

    const stripped = path.slice(PREFIX.length);

    // Discoverability:
    //   - `_help` (rich) — routes + action reference + tips
    //   - `_routes` (minimal) — runner-compatible shape for parity
    // Lets agents fetch a single URL on either runner or mobile to see what
    // they can do without reading docs.
    const testHooks = this.config.testHooks === true;

    if (method === 'GET' && stripped === '_help') {
      return {
        success: true,
        data: buildHelpPayload(testHooks),
        timestamp: Date.now(),
      };
    }
    if (method === 'GET' && stripped === '_routes') {
      return {
        success: true,
        data: buildRoutesPayload(testHooks),
        timestamp: Date.now(),
      };
    }

    // Reaching here with a discovery path means the PATH was right and the VERB
    // was not — the two branches above are the only ones that serve them, and
    // both are GET-only. They live outside `WS_ROUTES` (there is no handler to
    // dispatch to), so the loop below cannot notice them, and `POST
    // /ui-bridge/_routes` used to answer "no such route" about a route
    // `buildRoutesPayload` publishes one line up. Seeding the flag here keeps
    // "wrong verb on a path we publish → 405" true for every entry in
    // `UI_BRIDGE_NATIVE_ROUTES`, including these two.
    let patternMatchedButWrongVerb = DISCOVERY_PATHS.has(stripped);

    for (const route of WS_ROUTES) {
      const pathParams = parsePath(route.pattern, stripped);
      if (!pathParams) continue;

      // Pattern matches — now filter on HTTP verb.
      if (!route.httpMethods) {
        // WS-only route; don't serve on HTTP.
        continue;
      }
      // Route gated by `testHooks`: behave as if it isn't registered when
      // the flag is off so production builds get a vanilla NOT_FOUND.
      if (route.requiresTestHooks && !testHooks) {
        continue;
      }
      if (!route.httpMethods.includes(method as HttpVerb)) {
        patternMatchedButWrongVerb = true;
        continue;
      }

      const ctx: HandlerContext = { params: pathParams, query, body };
      return this.handlers[route.handler](ctx);
    }

    // The verbs go in the ENVELOPE as well as the `Allow` header, because
    // almost nothing in this tree reads headers: `CloudRelayClient` relays the
    // whole response, but the skills, the cheatsheets and every documented
    // probe read the JSON body (`curl … | jq .error`). A caller doing that saw
    // "Method not allowed: POST /ui-bridge/health" and still had to guess.
    const allowed = patternMatchedButWrongVerb
      ? allowedMethodsForPath(path, testHooks)
      : ([] as string[]);

    return {
      success: false,
      error: patternMatchedButWrongVerb
        ? `Method not allowed: ${method} ${path}${
            allowed.length > 0 ? ` (allowed: ${allowed.join(', ')})` : ''
          }`
        : `Route not found: ${method} ${path}`,
      code: patternMatchedButWrongVerb ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND',
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
 *         // Pairing: without these, non-loopback callers cannot be admitted.
 *         remoteAddress: request.remoteAddress,
 *         rawTarget: request.url,
 *         rawBody: request.postData,
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
