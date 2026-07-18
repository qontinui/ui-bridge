/**
 * Relay Handlers — Creates UIBridgeServerHandlers backed by CommandRelay
 *
 * Each handler queues a command to the browser via the relay and returns
 * the result. Server-only handlers (heartbeat, capabilities, render log,
 * metrics) execute directly without relay.
 *
 * This replaces the need for apps to write ~2700 lines of custom handler
 * code. Instead, ~30 lines of setup produces a fully functional handler set.
 */

import type { CommandRelay } from './command-relay';
import { mapInternalErrorCode } from '../diagnostics';
import { buildComponentNotFoundError } from './handlers';
import type {
  UIBridgeServerHandlers,
  APIResponse,
  CapabilitiesResponse,
  DOMChangeEvent,
  HandlerContext,
  StateSummary,
} from './types';
import type { RenderLogEntry } from '../render-log';
import type {
  ControlSnapshot,
  FallbackScreenshot,
  ComponentActionRequest,
  FindResponse,
  EffectRecordEntry,
} from '../control';
import { matchesElementSelector, type MatchableElement } from './selector-match';
import { diagnosePageHealth } from './page-health';
import type { SemanticSnapshot } from '../ai';
import type { Recency as RecencyType } from '../core/recency';
import { Recency, isSatisfiedBy, parseRecency } from '../core/recency';
import { findElements } from '../core/find';
import type { ElementQuery } from '../core/find';
import {
  applyCanonicalFindFilter,
  type CanonicalFindCriteria,
  type FindFilterableElement,
} from '../core/find-filter';

// ============================================================================
// Helpers
// ============================================================================

function success<T>(
  data: T,
  _meta?: {
    stale?: boolean;
    staleSinceMs?: number;
    cacheAgeMs?: number;
    fallback?: boolean;
    reason?: string;
  }
): APIResponse<T> {
  const response: APIResponse<T> = { success: true, data, timestamp: Date.now() };
  if (_meta) response._meta = _meta;
  return response;
}

function error(message: string, code?: string, suggestions?: string[]): APIResponse<never> {
  return {
    success: false,
    error: message,
    code: mapInternalErrorCode(code, message),
    timestamp: Date.now(),
    ...(suggestions ? { suggestions } : {}),
  };
}

/** Maximum allowed response size for fallback screenshots (10 MB) */
const MAX_SCREENSHOT_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Fetch a fallback screenshot from an external screenshot service.
 * Returns null if the service is unavailable or the request fails.
 *
 * Only http: and https: URLs are allowed to prevent SSRF via exotic protocols.
 */
async function fetchFallbackScreenshot(
  url: string,
  reason: FallbackScreenshot['reason']
): Promise<FallbackScreenshot | null> {
  try {
    // Validate URL scheme — only allow http and https to prevent SSRF
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    // Guard against oversized responses
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_SCREENSHOT_RESPONSE_BYTES) {
      return null;
    }

    const text = await response.text();
    if (text.length > MAX_SCREENSHOT_RESPONSE_BYTES) {
      return null;
    }

    const body = JSON.parse(text);
    if (body?.success && body?.data?.screenshot) {
      return {
        base64: body.data.screenshot,
        width: body.data.width ?? 0,
        height: body.data.height ?? 0,
        reason,
      };
    }
    return null;
  } catch {
    // Screenshot service unavailable — not an error, just no fallback
    return null;
  }
}

// ============================================================================
// Factory
// ============================================================================

export interface RelayHandlersOptions {
  /** SDK version string for capabilities endpoint (default: '0.1.0') */
  version?: string;
  /**
   * URL of an external screenshot endpoint to call when the relay cannot
   * reach the browser (timeout, no listeners, empty response).
   *
   * Expected response shape: `{ success: true, data: { screenshot: "<base64>", width: N, height: N } }`
   *
   * Example: `'http://localhost:9876/ui-bridge/vision/capture'`
   * (Phase 2 of the UI Bridge Vision Pipeline replaced the legacy
   * `/ui-bridge/sdk/screenshot` and `/ui-bridge/control/*screenshot*` routes
   * with `/ui-bridge/vision/{capture,annotate,diff,raw,cache,health}`.)
   */
  screenshotFallbackUrl?: string;
  /** Cache TTL in milliseconds for snapshot staleness checks (default: 5000) */
  cacheTtlMs?: number;
  /**
   * Pre-loaded specs to serve from the server without relying on the browser
   * relay or React lifecycle. Pass the result of your app's `getAllSpecs()`
   * function here. The relay will still try the browser for live specs, but
   * falls back to these when the browser is disconnected or unresponsive.
   *
   * @example
   * ```ts
   * import { getAllSpecs } from '../spec-registry';
   * const handlers = createRelayHandlers(relay, {
   *   specs: getAllSpecs(),
   * });
   * ```
   */
  specs?: Array<{ specId: string; config: unknown }>;
}

/**
 * Create a full UIBridgeServerHandlers implementation backed by a CommandRelay.
 *
 * Every action/query wraps `relay.queueCommand()`. Server-only handlers
 * (heartbeat, capabilities, render log management) execute directly.
 *
 * @example
 * ```ts
 * import { CommandRelay, createRelayHandlers } from '@qontinui/ui-bridge/server';
 *
 * const relay = new CommandRelay();
 * const handlers = createRelayHandlers(relay);
 * ```
 */
export function createRelayHandlers(
  relay: CommandRelay,
  options?: RelayHandlersOptions
): UIBridgeServerHandlers {
  const version = options?.version ?? '0.1.0';
  const screenshotFallbackUrl = options?.screenshotFallbackUrl;
  const injectedSpecs = options?.specs ?? [];

  // Server-side render log cache
  let renderLogEntries: RenderLogEntry[] = [];
  const MAX_ENTRIES = 50;

  // Cached snapshots
  let latestControlSnapshot: ControlSnapshot = {
    timestamp: Date.now(),
    elements: [],
    components: [],
    workflows: [],
    activeRuns: [],
  };
  let latestSemanticSnapshot: SemanticSnapshot | null = null;

  // Cache for console errors (returned when browser disconnects)
  let lastConsoleErrorsCache: APIResponse<unknown> | null = null;

  /**
   * Extract `targetTabId` from a relay-command payload — Item #4 routing.
   *
   * Callers (the Next.js / Express adapter, in particular) thread `tabId`
   * into the request body so every handler downstream sees it without
   * per-handler plumbing. We strip it here so the browser-side dispatcher
   * doesn't receive a stray `tabId`/`targetTabId` field it doesn't expect.
   *
   * Both spellings are accepted: external `?tabId` query / `tabId` body
   * field uses the public name; the internal relay option is `targetTabId`.
   *
   * Two locations are checked:
   *   1. The top-level payload object (e.g. `relayCommand('find', payload)`)
   *   2. The nested `payload.request` object (the common pattern for
   *      action-style handlers: `relayCommand('executeElementAction',
   *      { id, request })` — `request` is the body the adapter threaded
   *      `tabId` into).
   *
   * Top-level wins over nested when both exist.
   */
  function extractTabRouting(payload: unknown): {
    targetTabId: string | undefined;
    callerUserId: string | undefined;
    cleaned: unknown;
  } {
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      return { targetTabId: undefined, callerUserId: undefined, cleaned: payload };
    }
    const obj = payload as Record<string, unknown>;
    const topTarget = typeof obj.targetTabId === 'string' ? (obj.targetTabId as string) : undefined;
    const topPublic = typeof obj.tabId === 'string' ? (obj.tabId as string) : undefined;
    const topCallerUserId =
      typeof obj.__callerUserId === 'string' ? (obj.__callerUserId as string) : undefined;

    // Inspect the nested `request` wrapper used by action-style handlers.
    let nestedTabId: string | undefined;
    let nestedCaller: string | undefined;
    let cleanedRequest: unknown = obj.request;
    let requestRewritten = false;
    if (obj.request !== null && typeof obj.request === 'object' && !Array.isArray(obj.request)) {
      const req = obj.request as Record<string, unknown>;
      const nestedTarget =
        typeof req.targetTabId === 'string' ? (req.targetTabId as string) : undefined;
      const nestedPublic = typeof req.tabId === 'string' ? (req.tabId as string) : undefined;
      nestedTabId = nestedTarget ?? nestedPublic;
      nestedCaller =
        typeof req.__callerUserId === 'string' ? (req.__callerUserId as string) : undefined;
      if (nestedTabId !== undefined || nestedCaller !== undefined) {
        const {
          targetTabId: _omitT,
          tabId: _omitP,
          __callerUserId: _omitC,
          ...restReq
        } = req;
        cleanedRequest = restReq;
        requestRewritten = true;
      }
    }

    const targetTabId = topTarget ?? topPublic ?? nestedTabId;
    const callerUserId = topCallerUserId ?? nestedCaller;
    if (targetTabId === undefined && callerUserId === undefined) {
      return { targetTabId: undefined, callerUserId: undefined, cleaned: payload };
    }

    const {
      targetTabId: _omitTarget,
      tabId: _omitPublic,
      __callerUserId: _omitCaller,
      ...rest
    } = obj;
    if (requestRewritten) {
      (rest as Record<string, unknown>).request = cleanedRequest;
    }
    return { targetTabId, callerUserId, cleaned: rest };
  }

  // Helper: relay a command, return success/error. Honors `targetTabId`
  // sourced from either the explicit `opts` argument (used by a couple of
  // handlers that destructure it manually) or the payload itself (the
  // catch-all Item #4 path — nextjs/express adapters stuff `tabId` into the
  // body so every handler picks it up uniformly). Per-user tab scoping
  // (§4.2) lifts the consumer-provided `__callerUserId` into `ownerCheck`
  // so the relay enforces the dispatch boundary regardless of which
  // handler the request lands on. `OwnerMismatchError` is re-stamped as
  // `TAB_NOT_FOUND` at the envelope so the response shape mirrors a
  // genuine missing-tab case (no enumeration leak).
  //
  // Per-user tab scoping (§4.2) closing-the-hole pass: the `opts.context`
  // is the explicit channel for handlers whose signature has no request
  // bag (zero-arg `captureSnapshot()`, id-only `getElementState(id)`,
  // etc.). The adapter passes `{callerUserId}` as the final positional arg
  // and the handler forwards it here via `opts.context` so the ownership
  // check fires even when there's no payload to splice `__callerUserId`
  // into. Precedence (highest first): explicit `opts.ownerCheck` →
  // payload-supplied `__callerUserId` → `opts.context.callerUserId`.
  async function relayCommand<T>(
    action: string,
    payload: unknown = {},
    opts?: {
      targetTabId?: string;
      ownerCheck?: { userId: string };
      context?: HandlerContext;
    }
  ): Promise<APIResponse<T>> {
    const {
      targetTabId: payloadTabId,
      callerUserId,
      cleaned,
    } = extractTabRouting(payload);
    const effectiveTabId = opts?.targetTabId ?? payloadTabId;
    const contextUserId = opts?.context?.callerUserId;
    const effectiveOwnerCheck =
      opts?.ownerCheck ??
      (callerUserId ? { userId: callerUserId } : undefined) ??
      (contextUserId ? { userId: contextUserId } : undefined);
    const effectiveOpts =
      effectiveTabId || effectiveOwnerCheck
        ? {
            ...(effectiveTabId ? { targetTabId: effectiveTabId } : {}),
            ...(effectiveOwnerCheck ? { ownerCheck: effectiveOwnerCheck } : {}),
          }
        : undefined;
    try {
      const result = await relay.queueCommand<T>(action, cleaned, effectiveOpts);
      return success(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Per-tab routing errors get a dedicated code so callers can branch
      // without parsing prose (Item #4). Bypass `mapInternalErrorCode` and
      // return the literal `TAB_NOT_FOUND` / `TAB_STALE` codes — these are
      // contract surface (multi-machine drivers branch on them), same shape
      // as the `WRONG_TYPE_PARAM` envelope in `executeElementAction`.
      const tabErr = e as { code?: unknown; name?: unknown };
      // Per-user tab scoping (§4.2): OwnerMismatchError is redacted to
      // TAB_NOT_FOUND (404) at the HTTP envelope so callers cannot
      // distinguish "tab exists but not yours" from "tab does not
      // exist". The structured field (`callerUserId` / `storedUserId`)
      // stays in the relay's exception for server-side observability
      // and never reaches the wire.
      if (tabErr?.name === 'OwnerMismatchError') {
        return {
          success: false,
          error:
            `tabId is not in connectedTabs. ` +
            `Use GET /tabs to discover live tab ids, or omit tabId to dispatch to the primary tab.`,
          code: 'TAB_NOT_FOUND' as APIResponse['code'],
          timestamp: Date.now(),
          httpStatus: 404,
          suggestions: [
            'GET /tabs?activeOnly=true to discover currently live tabs',
            'Omit tabId to fall back to the relay primary tab',
          ],
        } as APIResponse<T>;
      }
      if (tabErr?.name === 'TabRoutingError' && typeof tabErr.code === 'string') {
        // Surface HTTP-level status codes so adapters (Express / Next.js)
        // translate the per-tab routing failure into the documented
        // status, not the default 200. The vet for multi-tab routing
        // (mtc post-vet) explicitly required HTTP 404 when a pinned
        // `?tabId=<id>` is not registered. TAB_STALE → 410 Gone reads
        // as "the tab existed but is no longer routable", consistent
        // with the RFC 7231 semantic. Callers that branch on the
        // envelope code keep working unchanged.
        const httpStatus =
          tabErr.code === 'TAB_NOT_FOUND' ? 404 : tabErr.code === 'TAB_STALE' ? 410 : undefined;
        return {
          success: false,
          error: msg,
          code: tabErr.code as APIResponse['code'],
          timestamp: Date.now(),
          ...(httpStatus !== undefined ? { httpStatus } : {}),
          suggestions: [
            'GET /tabs?activeOnly=true to discover currently live tabs',
            'Omit tabId to fall back to the relay primary tab',
            'Wait for the target tab to reconnect, then retry',
          ],
        } as APIResponse<T>;
      }
      const hasListeners = relay.hasCommandListeners() || relay.getWebSocketClientCount() > 0;
      const isTimeout = msg.includes('timeout') || msg.includes('Timeout');
      const hint = !hasListeners
        ? ' No browser tab is connected — ensure the app is open and the UI Bridge SDK is loaded.'
        : isTimeout
          ? ' The browser did not respond in time — the page may be unresponsive or navigating.'
          : '';
      const isUnsupported =
        msg.includes('unsupported') || msg.includes('Unsupported') || msg.includes('not supported');
      const suggestions = isTimeout
        ? [
            'Check if the browser tab is responsive',
            'The page may be navigating or loading heavy content',
            'Try again after the page settles',
          ]
        : !hasListeners
          ? [
              'Ensure the app is open in a browser tab',
              'Verify the UI Bridge SDK is loaded in the app',
            ]
          : isUnsupported
            ? [
                'Check that the action is supported for this element type',
                'Use getControlSnapshot() to see element capabilities',
                'Supported actions: click, type, select, toggle, scroll, focus',
              ]
            : undefined;
      const code = isTimeout ? 'TIMEOUT' : isUnsupported ? 'UNSUPPORTED_ACTION' : 'COMMAND_FAILED';
      return error(`${msg}${hint}`, code, suggestions);
    }
  }

  // Helper: relay with empty-array fallback — includes metadata when fallback is used
  async function relayWithFallback<T>(
    action: string,
    payload: unknown = {},
    fallback: T,
    context?: HandlerContext
  ): Promise<APIResponse<T>> {
    const { targetTabId, callerUserId, cleaned } = extractTabRouting(payload);
    const effectiveCallerUserId = callerUserId ?? context?.callerUserId;
    const opts =
      targetTabId || effectiveCallerUserId
        ? {
            ...(targetTabId ? { targetTabId } : {}),
            ...(effectiveCallerUserId ? { ownerCheck: { userId: effectiveCallerUserId } } : {}),
          }
        : undefined;
    try {
      const result = await relay.queueCommand<T>(action, cleaned, opts);
      return success(result);
    } catch {
      return success(fallback, {
        fallback: true,
        reason: `Relay command '${action}' failed or timed out — returning default value. Ensure the target app is connected and responsive.`,
      });
    }
  }

  // Helper: resolve callerUserId from optional context. Returns the
  // `relayCommand` opts shape (just the `context` slot — preserves
  // existing precedence rules). Centralizes the per-handler boilerplate
  // for the dozens of handlers that need to thread context into the
  // relay layer.
  function ctxOpts(
    context?: HandlerContext
  ): { context?: HandlerContext } | undefined {
    return context ? { context } : undefined;
  }

  // Helper: filter cached snapshot elements using find/discover criteria.
  // Filtering delegates to the canonical `applyCanonicalFindFilter`
  // (src/core/find-filter.ts) — shared with the React command handlers and
  // direct server handlers so the four historical copies cannot drift again.
  // Only the DiscoveredElement-compatible shape mapping stays relay-specific.
  function filterCachedElements(
    elements: ControlSnapshot['elements'],
    criteria: Record<string, unknown>
  ): Array<Record<string, unknown>> {
    const filtered = applyCanonicalFindFilter(
      elements as unknown as FindFilterableElement[],
      criteria as CanonicalFindCriteria
    );
    // Map to DiscoveredElement-compatible shape (add missing fields)
    return filtered.map((e) => ({
      ...e,
      tagName: e.type,
      registered: true,
    }));
  }

  // Helper: refresh the cached control snapshot based on Recency requirements
  const cacheTtlMs = options?.cacheTtlMs ?? 5000;
  const defaultRecency = Recency.MaxAge(cacheTtlMs);
  /**
   * Cache-age multiplier above which `staleMeta()` reports `stale: true`
   * even when the refresh path never flagged a relay failure. Captures the
   * "tab disconnected, never reconnected" failure mode where the cache
   * silently ages out without anyone marking it stale. 5× the TTL is
   * conservative — at the 5s default, a tab idle ≥25s starts surfacing
   * stale=true to callers.
   */
  const STALE_AGE_MULTIPLIER = 5;
  let snapshotStaleSince: number | null = null;

  function staleMeta(): { stale: boolean; staleSinceMs?: number; cacheAgeMs: number } {
    const cacheAgeMs = Date.now() - latestControlSnapshot.timestamp;
    if (snapshotStaleSince) {
      return { stale: true, staleSinceMs: Date.now() - snapshotStaleSince, cacheAgeMs };
    }
    // Item B (iter-3 manual-test remediation): mark stale on age-based decay
    // even when the relay never flagged a failure. Without this, a tab that
    // disconnected silently (or never connected at all) returns
    // `stale: false` indefinitely because `snapshotStaleSince` is only set
    // when `relay.queueCommand` actively throws. Callers reading e.g.
    // `getControlSnapshot()` on a fresh server with no tab attached would
    // see `{stale:false, cacheAgeMs: 60_000}` and assume the empty payload
    // was current.
    if (cacheAgeMs > cacheTtlMs * STALE_AGE_MULTIPLIER) {
      return { stale: true, cacheAgeMs };
    }
    return { stale: false, cacheAgeMs };
  }

  let inflightRefresh: Promise<void> | null = null;

  /**
   * Refresh the cached snapshot if the given Recency requirement is not satisfied.
   *
   * - `Any` + non-empty → return cache immediately (no relay command)
   * - `Current` → always fetch fresh from the browser
   * - `MaxAge(ms)` → fetch only if cache is older than `ms`
   */
  async function refreshSnapshotIfNeeded(recency: RecencyType, isEmpty: boolean): Promise<void> {
    // Fast path: Recency.Any accepts any cached value as long as it's non-empty
    if (recency.kind === 'any' && !isEmpty) return;

    const ageMs = Date.now() - latestControlSnapshot.timestamp;
    if (!isEmpty && isSatisfiedBy(recency, ageMs)) return;

    // Need to fetch — deduplicate concurrent refresh requests
    if (inflightRefresh) {
      await inflightRefresh;
      return;
    }

    inflightRefresh = (async () => {
      try {
        const result = await relay.queueCommand<ControlSnapshot>('getControlSnapshot', {});
        latestControlSnapshot = result;
        snapshotStaleSince = null;
      } catch {
        // Track when we first started returning stale data
        if (!snapshotStaleSince) snapshotStaleSince = Date.now();
      }
    })();

    try {
      await inflightRefresh;
    } finally {
      inflightRefresh = null;
    }
  }

  // Backward-compatible wrapper: resolves recency from options or uses default
  function resolveRecency(opts?: { recency?: string }): RecencyType {
    return opts?.recency ? parseRecency(opts.recency) : defaultRecency;
  }

  // Change event ring buffer for push-based observation
  const changeEventBuffer: DOMChangeEvent[] = [];
  const MAX_CHANGE_EVENTS = 5000;
  const changeEventSubscribers = new Set<(event: DOMChangeEvent) => void>();

  function pushChangeEvent(event: DOMChangeEvent): void {
    changeEventBuffer.push(event);
    if (changeEventBuffer.length > MAX_CHANGE_EVENTS) {
      changeEventBuffer.splice(0, changeEventBuffer.length - MAX_CHANGE_EVENTS);
    }
    // Mark snapshot as stale when a change event arrives
    if (!snapshotStaleSince) snapshotStaleSince = Date.now();
    // Notify subscribers
    for (const sub of changeEventSubscribers) {
      try {
        sub(event);
      } catch {
        /* subscriber errors are non-fatal */
      }
    }
  }

  const handlers: UIBridgeServerHandlers = {
    // ========================================================================
    // Render Log (server-side)
    // ========================================================================

    async getRenderLog(query, context) {
      // Try relaying to the browser first for live render log data
      try {
        const { cleaned, callerUserId } = extractTabRouting(query ?? {});
        const effectiveUserId = callerUserId ?? context?.callerUserId;
        const liveOpts = effectiveUserId
          ? { ownerCheck: { userId: effectiveUserId } }
          : undefined;
        const result = await relay.queueCommand('getRenderLog', cleaned, liveOpts);
        if (
          result &&
          typeof result === 'object' &&
          'entries' in (result as Record<string, unknown>)
        ) {
          return success((result as Record<string, unknown>).entries as RenderLogEntry[]);
        }
      } catch {
        // Relay failed — fall back to server-side cache
      }
      let results = [...renderLogEntries];
      if (query?.type) results = results.filter((e) => e.type === query.type);
      if (query?.since) results = results.filter((e) => e.timestamp >= query.since!);
      if (query?.until) results = results.filter((e) => e.timestamp <= query.until!);
      if (query?.limit) results = results.slice(-query.limit);
      return success(results);
    },

    async clearRenderLog(context) {
      renderLogEntries = [];
      // Also relay the clear to the browser so live render log entries are cleared.
      // Per-user tab scoping (§4.2): when invoked through the HTTP layer
      // with `X-Caller-User-Id`, the adapter passes the userId via `context`
      // so the live-relay leg dispatches only to the caller's tabs.
      try {
        const liveOpts = context?.callerUserId
          ? { ownerCheck: { userId: context.callerUserId } }
          : undefined;
        await relay.queueCommand('clearRenderLog', {}, liveOpts);
      } catch {
        // Browser may be disconnected — server-side cache already cleared above
      }
      return success(undefined);
    },

    async captureSnapshot(context) {
      return relayCommand('captureSnapshot', {}, ctxOpts(context));
    },

    async getRenderLogPath() {
      return success({ path: '/api/ui-bridge/render-log' });
    },

    // ========================================================================
    // Control — Elements
    // ========================================================================

    async getElements(options, context) {
      const { targetTabId, callerUserId, cleaned } = extractTabRouting(options ?? {});
      const opts = (cleaned ?? {}) as NonNullable<typeof options> & { revealsAny?: string };

      // Apply substring filters via the shared matcher. The relay works
      // against snapshot data (no live DOM), so the matcher's accessible-name
      // fallback chain (label → id) is what actually fires here.
      // Phase 3.2 adds the `revealsAny` filter which acts on each element's
      // `reveals` array — passed through verbatim by `serializeRegisteredElement`.
      const applyFilters = (
        elements: ControlSnapshot['elements']
      ): ControlSnapshot['elements'] => {
        if (!(opts.title || opts.aria_label || opts.text || opts.revealsAny)) return elements;
        return elements.filter((el) =>
          matchesElementSelector(el as unknown as MatchableElement, {
            title: opts.title as string | undefined,
            aria_label: opts.aria_label as string | undefined,
            text: opts.text as string | undefined,
            revealsAny: opts.revealsAny,
          })
        );
      };

      // P0 (plan 2026-06-12 item 1): a PINNED read must never be served from
      // the shared cross-tab cache — dispatch a live snapshot to that tab and
      // propagate routing errors instead of another tab's elements.
      if (targetTabId !== undefined) {
        const effectiveUserId = callerUserId ?? context?.callerUserId;
        const live = await relayCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          {
            targetTabId,
            ...(effectiveUserId ? { ownerCheck: { userId: effectiveUserId } } : {}),
          }
        );
        if (!live.success || !live.data) {
          return live as unknown as APIResponse<ControlSnapshot['elements']>;
        }
        return success(applyFilters(live.data.elements), { stale: false, cacheAgeMs: 0 });
      }

      const recency = resolveRecency(opts);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.elements.length === 0);
      const _meta = staleMeta();

      return success(applyFilters(latestControlSnapshot.elements), _meta);
    },

    async rankElements(request, _context) {
      // Rank against the cached relay snapshot — the disambiguation
      // metadata is passthrough from the browser tab's registry, so no
      // live relay call is needed. Respects the caller's recency hint
      // so a stale snapshot can be refreshed first.
      const recency = resolveRecency(request as { recency?: string } | undefined);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.elements.length === 0);
      const query = (request ?? {}) as ElementQuery;
      const matches = findElements(
        latestControlSnapshot.elements as unknown as Parameters<typeof findElements>[0],
        query
      );
      return success(
        matches.map((m) => ({
          id: m.id,
          score: m.score,
          reasons: m.reasons,
          element: m.element as unknown as ControlSnapshot['elements'][0],
        }))
      );
    },

    async listWindows() {
      // Runner-only: the relay dispatches to a connected browser tab, which has
      // no Tauri runner windows. Discover runner windows via direct HTTP to the
      // runner (GET /control/runner-windows), not over the browser-tab relay.
      return error(
        'listWindows is runner-only — query the qontinui-runner directly (GET /control/runner-windows), not the browser-tab relay',
        'NOT_IMPLEMENTED'
      );
    },

    async getElement(id, options, context) {
      const { targetTabId, callerUserId } = extractTabRouting(options ?? {});
      const effectiveUserId = callerUserId ?? context?.callerUserId;

      // P0 (plan 2026-06-12 item 1): a PINNED read must never fall back to
      // the shared cross-tab cache — propagate the routing/timeout error.
      if (targetTabId !== undefined) {
        const live = await relayCommand<ControlSnapshot['elements'][0] | null>(
          'getElement',
          { id },
          {
            targetTabId,
            ...(effectiveUserId ? { ownerCheck: { userId: effectiveUserId } } : {}),
          }
        );
        if (!live.success) {
          return live as unknown as APIResponse<ControlSnapshot['elements'][0]>;
        }
        if (live.data) return success(live.data);
        return error(
          `Element "${id}" not found on tab "${targetTabId}". Use find() or getControlSnapshot() with the same tabId to see that tab's elements.`,
          'ELEMENT_NOT_FOUND',
          [
            'Use find() with the same tabId to search that tab',
            'GET /tabs?activeOnly=true to discover currently live tabs',
            'The element may not be rendered yet — wait for the page to fully load',
          ]
        );
      }

      // Try relay first for live element data when browser is connected
      try {
        const liveOpts = effectiveUserId
          ? { ownerCheck: { userId: effectiveUserId } }
          : undefined;
        const result = await relay.queueCommand('getElement', { id }, liveOpts);
        if (result) return success(result) as APIResponse<ControlSnapshot['elements'][0]>;
      } catch {
        // Relay failed — fall back to cached snapshot
      }
      let element = latestControlSnapshot.elements.find((e) => e.id === id);
      if (!element) {
        // Refresh and retry — element may have been registered after the cached snapshot
        const recency = resolveRecency(options);
        await refreshSnapshotIfNeeded(recency.kind === 'any' ? Recency.Current : recency, true);
        element = latestControlSnapshot.elements.find((e) => e.id === id);
      }
      if (!element) {
        const count = latestControlSnapshot.elements.length;
        return error(
          `Element "${id}" not found (${count} elements registered). Use find() or getControlSnapshot() to see available elements.`,
          'ELEMENT_NOT_FOUND',
          [
            'Use find() to search for elements by description or type',
            'Use getControlSnapshot() to see all available elements',
            'The element may not be rendered yet — wait for the page to fully load',
          ]
        );
      }
      return success(element);
    },

    async getElementState(id, context) {
      // Per-user tab scoping (§4.2): the adapter threads the
      // authenticated caller's userId via the `context` final argument so
      // the dispatch is gated on the caller's tabs, NEVER on whichever
      // tab happens to be `primaryTabId` (which could belong to a
      // different user).
      const liveOpts = context?.callerUserId
        ? { ownerCheck: { userId: context.callerUserId } }
        : undefined;
      try {
        const result = await relay.queueCommand('getElementState', { id }, liveOpts);
        if (result) return success(result);
      } catch {
        // Relay failed — fall back to state from cached snapshot.
        // The cached snapshot is shared across users (refresh path runs
        // unscoped), so the fallback below leaks no more than an
        // unauthenticated admin GET against the same id would.
      }
      const element = latestControlSnapshot.elements.find((e) => e.id === id);
      if (element && 'state' in element) return success((element as { state: unknown }).state);
      return error(`Element state for ${id} not available (browser disconnected)`, 'NOT_FOUND');
    },

    async getElementReactState(id, context) {
      return relayCommand('getElementReactState', { id }, ctxOpts(context));
    },

    async executeElementAction(id, request, context) {
      // Item A (iter-3 manual-test remediation): contract enforcement for the
      // `type` action. The docs (`docs-site/docs/api/runner-features.md` §
      // "Per-action param names") promise that `type` returns HTTP 400 when
      // the caller sends `value` instead of `text`, but the relay
      // pass-through used to forward the malformed payload to the browser,
      // where the runtime would silently no-op (or, worse, substitute the
      // element's `type` HTML attribute as the typed text). Validate here
      // so misuse surfaces immediately with an actionable error envelope.
      // NEVER fall back to element.type — the docs explicitly call this out.
      //
      // The error envelope deliberately bypasses `mapInternalErrorCode` so
      // callers see the documented literal `WRONG_TYPE_PARAM` / `MISSING_PARAM`
      // codes rather than the canonical-UB family bucket. These codes are
      // contract surface (manual-test report + docs reference them by name).
      if (request && (request as { action?: string }).action === 'type') {
        const params = (request as { params?: Record<string, unknown> }).params;
        const hasText = params != null && typeof params['text'] === 'string';
        const hasValue = params != null && typeof params['value'] === 'string';
        if (!hasText) {
          if (hasValue) {
            return {
              success: false,
              error:
                "type action takes 'text' parameter; got 'value'. Did you mean setValue?",
              code: 'WRONG_TYPE_PARAM' as APIResponse['code'],
              data: {
                hint: { provided: ['value'], required: ['text'] },
              } as unknown as import('../control').ControlActionResponse,
              httpStatus: 400,
              timestamp: Date.now(),
            };
          }
          return {
            success: false,
            error: "type action requires 'text' string parameter",
            code: 'MISSING_PARAM' as APIResponse['code'],
            data: {
              required: ['text'],
            } as unknown as import('../control').ControlActionResponse,
            httpStatus: 400,
            timestamp: Date.now(),
          };
        }
      }
      return relayCommand('executeElementAction', { id, request }, ctxOpts(context));
    },

    async executeBatchAction(request, context) {
      return relayCommand('executeBatchAction', { request }, ctxOpts(context));
    },

    // ========================================================================
    // Control — Components
    // ========================================================================

    async getComponents(options, context) {
      const { targetTabId, callerUserId, cleaned } = extractTabRouting(options ?? {});

      // P0 (plan 2026-06-12 item 1): a PINNED read must never be served from
      // the shared cross-tab cache — dispatch a live snapshot to that tab and
      // propagate routing errors instead of another tab's components.
      if (targetTabId !== undefined) {
        const effectiveUserId = callerUserId ?? context?.callerUserId;
        const live = await relayCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          {
            targetTabId,
            ...(effectiveUserId ? { ownerCheck: { userId: effectiveUserId } } : {}),
          }
        );
        if (!live.success || !live.data) {
          return live as unknown as APIResponse<{
            components: ControlSnapshot['components'];
          }>;
        }
        return success({ components: live.data.components }, { stale: false, cacheAgeMs: 0 });
      }

      const recency = resolveRecency(cleaned as typeof options);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.components.length === 0);
      const _meta = staleMeta();
      // F2 (Direction B): wrap the array in `{components: [...]}` so the
      // envelope is `{success: true, data: {components: [...]}}`, matching
      // every other rich endpoint convention and aligning with the runner's
      // direct `/ui-bridge/control/components` route.
      return success({ components: latestControlSnapshot.components }, _meta);
    },

    async getComponent(id, options, _context) {
      // Refresh snapshot before looking up — components mount/unmount with page navigation
      // First try cached, then refresh if not found (avoids unnecessary refresh when cache is fresh)
      let component = latestControlSnapshot.components.find((c) => c.id === id);
      if (!component) {
        const recency = resolveRecency(options);
        await refreshSnapshotIfNeeded(recency.kind === 'any' ? Recency.Current : recency, true);
        component = latestControlSnapshot.components.find((c) => c.id === id);
      }
      if (!component) {
        const available = latestControlSnapshot.components.map((c) => c.id);
        // The cached snapshot may carry Phase-1.2 registration metadata
        // (`byRoute` with per-route ids) and a top-level `route`; use both
        // to inject the cross-route hint when the missing id lives elsewhere.
        const enriched = latestControlSnapshot as ControlSnapshot & {
          registration?: { byRoute?: Record<string, { count: number; ids: string[] }> };
          route?: string;
        };
        const message = buildComponentNotFoundError(
          id,
          available,
          enriched.registration?.byRoute,
          enriched.route
        );
        return error(message, 'NOT_FOUND', [
          'Use getControlSnapshot() to see all available components',
          'Navigate to the page containing this component first',
          'Components mount/unmount with page navigation — ensure the correct page is active',
        ]);
      }
      return success(component);
    },

    async getComponentState(id, context) {
      return relayCommand('getComponentState', { id }, ctxOpts(context));
    },

    async executeComponentAction(
      id,
      request,
      bodyOrContext?: (Record<string, unknown> & HandlerContext) | HandlerContext
    ) {
      // The Express adapter passes (id, actionId, body) based on route params ['id', 'actionId'].
      // When called from Express: id=componentId, request=actionId (string), bodyOrContext=req.body.
      // When called from Next.js/WebSocket: id=componentId, request={action, params}, bodyOrContext=HandlerContext.
      // Per-user tab scoping (§4.2): the trailing arg from the Next.js
      // catch-all dispatcher is a `HandlerContext` `{ callerUserId }`;
      // disambiguate by inspecting the body-shape fields.
      let normalizedRequest: ComponentActionRequest;
      let context: HandlerContext | undefined;
      if (typeof request === 'string') {
        // Express path: request is actually the actionId string, body is the 3rd argument
        const body = bodyOrContext as Record<string, unknown> | undefined;
        normalizedRequest = {
          action: request,
          params: body?.params as Record<string, unknown>,
        };
        // Express never threads HandlerContext through this path.
        context = undefined;
      } else {
        normalizedRequest = request;
        // The trailing arg is the HandlerContext threaded by Next.js.
        context = bodyOrContext as HandlerContext | undefined;
      }
      return relayCommand(
        'executeComponentAction',
        { id, request: normalizedRequest },
        ctxOpts(context)
      );
    },

    // ========================================================================
    // Find / Discovery
    // ========================================================================

    async find(request, context) {
      const {
        targetTabId,
        recency: recencyParam,
        ...payload
      } = (request as Record<string, unknown> & { targetTabId?: string; recency?: string }) || {};
      // P0 (plan 2026-06-12 item 1): detect explicit tab pinning across BOTH
      // spellings — the destructured internal `targetTabId` and the public
      // `tabId` the adapters splice into the body (relayCommand extracts and
      // strips the latter via extractTabRouting).
      const pinnedTabId =
        targetTabId ??
        (typeof (payload as { tabId?: unknown }).tabId === 'string'
          ? ((payload as { tabId: string }).tabId as string)
          : undefined);
      const result = await relayCommand<FindResponse>('find', payload, { targetTabId, context });
      if (result.success) return result;
      // P0 (plan 2026-06-12 item 1): a PINNED read must NEVER be answered from
      // the shared `latestControlSnapshot` cache — that cache is last-writer-
      // wins across ALL tabs, so serving it would silently return another
      // tab's elements as `success: true`. Propagate the routing/timeout
      // error envelope (TAB_NOT_FOUND / TAB_STALE / TIMEOUT / ...) instead.
      if (pinnedTabId !== undefined) return result;
      // Unpinned relay failure — fall back to filtering cached snapshot elements
      const recency = parseRecency(recencyParam);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.elements.length === 0);
      const filtered = filterCachedElements(latestControlSnapshot.elements, payload);
      const _meta = staleMeta();
      return success(
        {
          elements: filtered as unknown as FindResponse['elements'],
          total: filtered.length,
          durationMs: 0,
          timestamp: Date.now(),
          // F3 readiness signal (item 5): carry the cached snapshot's
          // registration block so a caller polling through the post-reload
          // dead window sees a typed not-ready (`everHadRegistrations:
          // false`) instead of a bare empty result.
          ...(latestControlSnapshot.registration
            ? { registration: latestControlSnapshot.registration }
            : {}),
        },
        _meta
      ) as APIResponse<FindResponse>;
    },

    /**
     * @deprecated Use {@link find} instead. `discover()` is a back-compat alias
     * that forwards to `find()`. The runner only dispatches the `find` action,
     * so browser-side wrappers no longer need a separate `discover` handler.
     * Will be removed in a future major version.
     */
    async discover(request, context) {
      return handlers.find(request, context);
    },

    // Vision pipeline (Phase 2 of plan 2026-05-13) — relay-mode stubs.
    // The runner answers `/vision/*` directly without going through the
    // browser relay; the SDK relay-handler factory only needs to satisfy
    // the `UIBridgeServerHandlers` interface so apps that share this
    // factory don't crash if those routes are mounted.
    async visionCapture(_request, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionAnnotate(_request, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionDiff(_request, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionRaw(_request, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionCacheStream(_sha256, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionHealth(_context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionExtract(_request, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionDescribe(_request, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionAnalyze(_request, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionAssert(_request, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionBaseline(_request, _context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionBaselinesList(_context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async visionMutationOccurred(_context) {
      return error('route is runner-direct, mount the runner', 'RUNNER_REQUIRED');
    },

    async getControlSnapshot(request, context) {
      const recency = parseRecency(request?.recency);
      const { targetTabId, callerUserId } = extractTabRouting(request ?? {});
      const effectiveUserId = callerUserId ?? context?.callerUserId;

      // Item 3 (plan 2026-06-12): an explicitly PINNED snapshot read (either
      // spelling — public `?tabId=`/body `tabId` or internal `targetTabId`)
      // must NEVER be answered from the shared `latestControlSnapshot` cache:
      // the cache is last-writer-wins across ALL tabs, so a per-tab read from
      // it is structurally impossible. Bypass every cache fast path and
      // dispatch live to that tab; on failure propagate the routing error
      // (TAB_NOT_FOUND / TAB_STALE / TIMEOUT) instead of another tab's data.
      // The pinned result deliberately does NOT overwrite the shared cache —
      // that would re-introduce the cross-tab pollution this fixes.
      if (targetTabId !== undefined) {
        const result = await relayCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          {
            targetTabId,
            ...(effectiveUserId ? { ownerCheck: { userId: effectiveUserId } } : {}),
          }
        );
        if (!result.success || !result.data) return result;
        return success(result.data, { stale: false, cacheAgeMs: 0 });
      }

      // Fast path: Recency.Any returns cached snapshot immediately
      if (recency.kind === 'any' && latestControlSnapshot.elements.length > 0) {
        const _meta = staleMeta();
        return success(latestControlSnapshot, _meta);
      }

      // Check for no listeners before attempting the command
      const hasListeners = relay.hasCommandListeners() || relay.getWebSocketClientCount() > 0;

      if (!hasListeners) {
        // No browser connected — return cached snapshot with fallback screenshot
        const snapshot = { ...latestControlSnapshot, timestamp: Date.now() };
        if (screenshotFallbackUrl) {
          const fallback = await fetchFallbackScreenshot(screenshotFallbackUrl, 'no_listeners');
          if (fallback) {
            snapshot.fallbackScreenshot = fallback;
          }
        }
        const _meta = staleMeta();
        return success(snapshot, _meta);
      }

      // MaxAge path: skip relay command if cache is fresh enough
      if (recency.kind === 'maxAge') {
        const ageMs = Date.now() - latestControlSnapshot.timestamp;
        if (isSatisfiedBy(recency, ageMs) && latestControlSnapshot.elements.length > 0) {
          const _meta = staleMeta();
          return success(latestControlSnapshot, _meta);
        }
      }

      try {
        const queueOpts: { ownerCheck?: { userId: string } } = {};
        if (effectiveUserId) queueOpts.ownerCheck = { userId: effectiveUserId };
        const result = await relay.queueCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          Object.keys(queueOpts).length > 0 ? queueOpts : undefined
        );
        latestControlSnapshot = result;
        snapshotStaleSince = null;

        // If the snapshot came back empty (no elements, no components), the app
        // may be in an error state — attach a fallback screenshot for context
        const isEmpty = result.elements.length === 0 && result.components.length === 0;
        if (isEmpty && screenshotFallbackUrl) {
          const fallback = await fetchFallbackScreenshot(screenshotFallbackUrl, 'empty_response');
          if (fallback) {
            return success(
              { ...result, fallbackScreenshot: fallback },
              { stale: false, cacheAgeMs: 0 }
            );
          }
        }

        return success(result, { stale: false, cacheAgeMs: 0 });
      } catch (_e) {
        // Command timed out or failed — return cached snapshot with fallback screenshot
        if (!snapshotStaleSince) snapshotStaleSince = Date.now();
        const snapshot = { ...latestControlSnapshot, timestamp: Date.now() };
        if (screenshotFallbackUrl) {
          const fallback = await fetchFallbackScreenshot(screenshotFallbackUrl, 'timeout');
          if (fallback) {
            snapshot.fallbackScreenshot = fallback;
          }
        }
        const _meta = staleMeta();
        return success(snapshot, _meta);
      }
    },

    // ========================================================================
    // Workflows
    // ========================================================================

    async getWorkflows(options, _context) {
      const recency = resolveRecency(options);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.workflows.length === 0);
      const _meta = staleMeta();
      return success(latestControlSnapshot.workflows, _meta);
    },

    async runWorkflow(id, request, context) {
      return relayCommand('runWorkflow', { id, request }, ctxOpts(context));
    },

    async getWorkflowStatus(runId, context) {
      return relayCommand('getWorkflowStatus', { runId }, ctxOpts(context));
    },

    // ========================================================================
    // Debug
    // ========================================================================

    async getActionHistory(limit, context) {
      return relayWithFallback('getActionHistory', { limit }, [] as unknown[], context);
    },

    // D3 Effect Calculus (Phase 2) — recent predict-then-verify cycles live in
    // the browser-side effect store (where actions execute), so relay through.
    async getRecentEffects(options, context) {
      return relayWithFallback(
        'getRecentEffects',
        { limit: options?.limit },
        [] as EffectRecordEntry[],
        context
      );
    },

    async getMetrics() {
      return success({
        timestamp: Date.now(),
        uptime: typeof process !== 'undefined' ? process.uptime() * 1000 : 0,
        memory: typeof process !== 'undefined' ? process.memoryUsage() : {},
        pendingCommands: relay.getTransportDiagnostics().pendingCommandCount,
        commandQueueLength: relay.getTransportDiagnostics().commandQueueLength,
      });
    },

    async highlightElement(id, context) {
      return relayCommand('highlightElement', { id }, ctxOpts(context));
    },

    async getElementTree(context) {
      return relayCommand('getElementTree', {}, ctxOpts(context));
    },

    async getConsoleErrors(params, context) {
      type ConsoleErrorsResult = {
        errors: import('../debug/browser-capture-types').CapturedError[];
        count: number;
        nextSinceId?: number;
        droppedCount?: number;
        bufferedCount?: number;
      };
      type GroupedResult = {
        groups: unknown[];
        totalErrors: number;
        totalGroups: number;
      };
      const isGrouped = params?.group === true;
      try {
        const { cleaned, callerUserId } = extractTabRouting(params ?? {});
        const effectiveUserId = callerUserId ?? context?.callerUserId;
        const liveOpts = effectiveUserId
          ? { ownerCheck: { userId: effectiveUserId } }
          : undefined;
        const result = await relay.queueCommand<ConsoleErrorsResult | GroupedResult>(
          'getConsoleErrors',
          cleaned,
          liveOpts
        );
        // Cache successful result for fallback when browser disconnects (ungrouped only)
        if (!isGrouped && result && typeof result === 'object') {
          lastConsoleErrorsCache = success(result as ConsoleErrorsResult);
        }
        return success(result as ConsoleErrorsResult | GroupedResult);
      } catch {
        // Relay failed — return cached data if available (ungrouped only)
        if (!isGrouped && lastConsoleErrorsCache)
          return lastConsoleErrorsCache as APIResponse<ConsoleErrorsResult>;
        if (isGrouped) {
          return success({ groups: [], totalErrors: 0, totalGroups: 0 } as GroupedResult);
        }
        return success({ errors: [], count: 0 } as ConsoleErrorsResult);
      }
    },

    async clearConsoleErrors(context) {
      return relayCommand('clearConsoleErrors', {}, ctxOpts(context));
    },

    // ========================================================================
    // AI-Native
    // ========================================================================

    async aiSearch(criteria, context) {
      return relayCommand('aiSearch', criteria, ctxOpts(context));
    },

    async aiFind(request, context) {
      return relayCommand('aiFind', request, ctxOpts(context));
    },

    async aiExecute(request, context) {
      return relayCommand('aiExecute', request, ctxOpts(context));
    },

    async aiAssert(request, context) {
      return relayCommand('aiAssert', request, ctxOpts(context));
    },

    async aiAssertBatch(request, context) {
      return relayCommand('aiAssertBatch', request, ctxOpts(context));
    },

    async getSemanticSnapshot(options, context) {
      try {
        const { cleaned, callerUserId } = extractTabRouting(options ?? {});
        const effectiveUserId = callerUserId ?? context?.callerUserId;
        const liveOpts = effectiveUserId
          ? { ownerCheck: { userId: effectiveUserId } }
          : undefined;
        const result = await relay.queueCommand<SemanticSnapshot>(
          'getSemanticSnapshot',
          cleaned,
          liveOpts
        );
        latestSemanticSnapshot = result;
        return success(result);
      } catch (e) {
        if (latestSemanticSnapshot) return success(latestSemanticSnapshot);
        return error((e as Error).message, 'COMMAND_FAILED');
      }
    },

    async getSemanticDiff(since, context) {
      return relayCommand('getSemanticDiff', { since }, ctxOpts(context));
    },

    async getPageSummary(context) {
      return relayCommand('getPageSummary', {}, ctxOpts(context));
    },

    // ========================================================================
    // Change Tracking
    // ========================================================================

    async executeWithDiff(request, context) {
      return relayCommand('executeWithDiff', request, ctxOpts(context));
    },

    async waitForChange(request, context) {
      return relayCommand('waitForChange', request, ctxOpts(context));
    },

    async categorizeLastDiff(context) {
      return relayCommand('categorizeLastDiff', {}, ctxOpts(context));
    },

    async getScopedDiff(request, context) {
      return relayCommand('getScopedDiff', request, ctxOpts(context));
    },

    async summarizeDiff(request, context) {
      return relayCommand('summarizeDiff', request, ctxOpts(context));
    },

    async analyzeStructuredChanges(request, context) {
      return relayCommand('analyzeStructuredChanges', request, ctxOpts(context));
    },

    // ========================================================================
    // Change Buffer
    // ========================================================================

    async enableChangeBuffer(context) {
      return relayCommand('enableChangeBuffer', {}, ctxOpts(context));
    },

    async disableChangeBuffer(context) {
      return relayCommand('disableChangeBuffer', {}, ctxOpts(context));
    },

    async drainChangeBuffer(context) {
      return relayCommand('drainChangeBuffer', {}, ctxOpts(context));
    },

    async getChangeBufferSize(context) {
      return relayCommand('getChangeBufferSize', {}, ctxOpts(context));
    },

    // ========================================================================
    // Snapshot Bookmarks
    // ========================================================================

    async saveBookmark(request, context) {
      return relayCommand('saveBookmark', request, ctxOpts(context));
    },

    async getBookmark(name, context) {
      return relayCommand('getBookmark', { name }, ctxOpts(context));
    },

    async deleteBookmark(name, context) {
      return relayCommand('deleteBookmark', { name }, ctxOpts(context));
    },

    async listBookmarks(context) {
      return relayCommand('listBookmarks', {}, ctxOpts(context));
    },

    async diffFromBookmark(name, context) {
      return relayCommand('diffFromBookmark', { name }, ctxOpts(context));
    },

    // ========================================================================
    // Semantic Search
    // ========================================================================

    async aiSemanticSearch(criteria, context) {
      return relayCommand('aiSemanticSearch', criteria, ctxOpts(context));
    },

    // ========================================================================
    // State Management
    // ========================================================================

    async getStates(context) {
      return relayWithFallback('getStates', {}, [], context);
    },

    async getState(id, context) {
      return relayCommand('getState', { id }, ctxOpts(context));
    },

    async getActiveStates(context) {
      return relayWithFallback('getActiveStates', {}, [], context);
    },

    async activateState(id, context) {
      return relayCommand('activateState', { id }, ctxOpts(context));
    },

    async deactivateState(id, context) {
      return relayCommand('deactivateState', { id }, ctxOpts(context));
    },

    async getStateGroups(context) {
      return relayWithFallback('getStateGroups', {}, [], context);
    },

    async activateStateGroup(id, context) {
      return relayCommand('activateStateGroup', { id }, ctxOpts(context));
    },

    async deactivateStateGroup(id, context) {
      return relayCommand('deactivateStateGroup', { id }, ctxOpts(context));
    },

    async getTransitions(context) {
      return relayWithFallback('getTransitions', {}, [], context);
    },

    async canExecuteTransition(id, context) {
      return relayCommand('canExecuteTransition', { id }, ctxOpts(context));
    },

    async executeTransition(id, context) {
      return relayCommand('executeTransition', { id }, ctxOpts(context));
    },

    async findPath(request, context) {
      return relayCommand('findPath', request, ctxOpts(context));
    },

    async navigateTo(request, context) {
      return relayCommand('navigateTo', request, ctxOpts(context));
    },

    async getStateSnapshot(context) {
      return relayWithFallback(
        'getStateSnapshot',
        {},
        {
          timestamp: Date.now(),
          activeStates: [],
          states: [],
          groups: [],
          transitions: [],
        },
        context
      );
    },

    // ========================================================================
    // Intent
    // ========================================================================

    async executeIntent(request, context) {
      return relayCommand('executeIntent', request, ctxOpts(context));
    },

    async findIntent(request, context) {
      return relayCommand('findIntent', request, ctxOpts(context));
    },

    async listIntents(context) {
      return relayWithFallback('listIntents', {}, [], context);
    },

    async registerIntent(intent, context) {
      return relayCommand('registerIntent', intent, ctxOpts(context));
    },

    async executeIntentFromQuery(request, context) {
      return relayCommand('executeIntentFromQuery', request, ctxOpts(context));
    },

    async deleteIntent(name, context) {
      return relayCommand('deleteIntent', { name }, ctxOpts(context));
    },

    // ========================================================================
    // Recovery
    // ========================================================================

    async attemptRecovery(request, context) {
      return relayCommand('attemptRecovery', request, ctxOpts(context));
    },

    // ========================================================================
    // Cross-App Analysis
    // ========================================================================

    async analyzePageData(context) {
      return relayCommand('analyzePageData', {}, ctxOpts(context));
    },

    async analyzePageRegions(context) {
      return relayCommand('analyzePageRegions', {}, ctxOpts(context));
    },

    async analyzeStructuredData(context) {
      return relayCommand('analyzeStructuredData', {}, ctxOpts(context));
    },

    async crossAppCompare(request, context) {
      return relayCommand('crossAppCompare', request, ctxOpts(context));
    },

    // ========================================================================
    // Page Navigation
    // ========================================================================

    async pageRefresh(context) {
      return relayCommand('pageRefresh', {}, ctxOpts(context));
    },

    async pageNavigate(request, context) {
      const { targetTabId, ...payload } = request as unknown as Record<string, unknown> & {
        targetTabId?: string;
      };
      // Reject dangerous URL protocols before relaying to the browser.
      // A javascript: or data: URL relayed to the browser executes arbitrary JS
      // and can permanently break the SSE relay connection.
      const url = (payload as { url?: string }).url;
      if (!url) {
        return error('URL is required', 'INVALID_REQUEST');
      }
      const dangerousProtocols = ['javascript:', 'data:', 'blob:', 'vbscript:'];
      try {
        const parsed = new URL(url);
        if (dangerousProtocols.includes(parsed.protocol)) {
          return error(
            `Dangerous URL protocol rejected: "${parsed.protocol}". Only http, https, and relative paths are allowed.`,
            'INVALID_URL_PROTOCOL'
          );
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return error(
            `Invalid URL protocol "${parsed.protocol}". Only http, https, and relative paths are allowed.`,
            'INVALID_URL_PROTOCOL'
          );
        }
      } catch {
        // URL failed to parse as absolute — only allow relative paths starting with "/"
        if (!url.startsWith('/')) {
          return error(
            'Invalid URL format. Only http, https, and relative paths starting with "/" are allowed.',
            'INVALID_URL_FORMAT'
          );
        }
      }
      return relayCommand('pageNavigate', payload, { targetTabId, context });
    },

    async pageGoBack(context) {
      return relayCommand('pageGoBack', {}, ctxOpts(context));
    },

    async pageGoForward(context) {
      return relayCommand('pageGoForward', {}, ctxOpts(context));
    },

    async pageEvaluate(request: unknown, context) {
      return relayCommand('pageEvaluate', request, ctxOpts(context));
    },

    async pageScroll(request: unknown, context) {
      return relayCommand('pageScroll', request, ctxOpts(context));
    },

    // ========================================================================
    // Annotations
    // ========================================================================

    async getAnnotations(context) {
      return relayWithFallback('getAnnotations', {}, {}, context);
    },

    async getAnnotation(id, context) {
      return relayCommand('getAnnotation', { id }, ctxOpts(context));
    },

    async setAnnotation(id, annotation, context) {
      return relayCommand('setAnnotation', { id, annotation }, ctxOpts(context));
    },

    async deleteAnnotation(id, context) {
      return relayCommand('deleteAnnotation', { id }, ctxOpts(context));
    },

    async importAnnotations(config, context) {
      return relayCommand('importAnnotations', config, ctxOpts(context));
    },

    async exportAnnotations(context) {
      return relayCommand('exportAnnotations', {}, ctxOpts(context));
    },

    async getAnnotationCoverage(context) {
      return relayCommand('getAnnotationCoverage', {}, ctxOpts(context));
    },

    // ========================================================================
    // Clipboard (relayed to browser for gesture-based access)
    // ========================================================================

    /**
     * @deprecated Use {@link setClipboard} instead. `clipboardWrite()` is a
     * back-compat alias that forwards to `setClipboard()`. The runner only
     * dispatches the `setClipboard` action.
     * Will be removed in a future major version.
     */
    async clipboardWrite(request: unknown, context) {
      return handlers.setClipboard(
        request as Parameters<typeof handlers.setClipboard>[0],
        context
      );
    },

    /**
     * @deprecated Use {@link getClipboard} instead. `clipboardRead()` is a
     * back-compat alias that forwards to `getClipboard()`. The runner only
     * dispatches the `getClipboard` action.
     * Will be removed in a future major version.
     */
    async clipboardRead(context) {
      return handlers.getClipboard(context);
    },

    // ========================================================================
    // Performance Diagnostics
    // ========================================================================

    async getPerformanceEntries(context) {
      return relayCommand('getPerformanceEntries', {}, ctxOpts(context));
    },

    async clearPerformanceEntries(context) {
      return relayCommand('clearPerformanceEntries', {}, ctxOpts(context));
    },

    async getBrowserEvents(params, context) {
      return relayCommand('getBrowserEvents', params ?? {}, ctxOpts(context));
    },

    async getTimeline(params, context) {
      return relayCommand('getTimeline', params ?? {}, ctxOpts(context));
    },

    // ========================================================================
    // Health & Error Debugging
    // ========================================================================

    async getHealthReport(params, context) {
      return relayCommand('getHealthReport', params ?? {}, ctxOpts(context));
    },

    async getNetworkChains(params, context) {
      return relayCommand('getNetworkChains', params ?? {}, ctxOpts(context));
    },

    async startErrorSession(request, context) {
      return relayCommand('startErrorSession', request, ctxOpts(context));
    },

    async endErrorSession(context) {
      return relayCommand('endErrorSession', {}, ctxOpts(context));
    },

    async getErrorSessions(context) {
      return relayCommand('getErrorSessions', {}, ctxOpts(context));
    },

    async captureErrorBaseline(request, context) {
      return relayCommand('captureErrorBaseline', request, ctxOpts(context));
    },

    async compareErrorBaseline(request, context) {
      return relayCommand('compareErrorBaseline', request, ctxOpts(context));
    },

    async getErrorSnapshots(params, context) {
      return relayCommand('getErrorSnapshots', params ?? {}, ctxOpts(context));
    },

    async getErrorReport(context) {
      return relayCommand('getErrorReport', {}, ctxOpts(context));
    },

    // ========================================================================
    // Design Review
    // ========================================================================

    async getElementStyles(id, context) {
      return relayCommand('getElementStyles', { id }, ctxOpts(context));
    },

    async getElementStateStyles(id, request, context) {
      return relayCommand('getElementStateStyles', { id, ...request }, ctxOpts(context));
    },

    async getDesignSnapshot(request, context) {
      return relayCommand('getDesignSnapshot', request ?? {}, ctxOpts(context));
    },

    async getResponsiveSnapshots(request, context) {
      return relayCommand('getResponsiveSnapshots', request, ctxOpts(context));
    },

    async setViewportConstraints(request, context) {
      return relayCommand('setViewportConstraints', request, ctxOpts(context));
    },

    async runDesignAudit(request, context) {
      return relayCommand('runDesignAudit', request ?? {}, ctxOpts(context));
    },

    async loadStyleGuide(request, context) {
      return relayCommand('loadStyleGuide', request, ctxOpts(context));
    },

    async getStyleGuide(context) {
      return relayCommand('getStyleGuide', {}, ctxOpts(context));
    },

    async clearStyleGuide(context) {
      return relayCommand('clearStyleGuide', {}, ctxOpts(context));
    },

    // ========================================================================
    // Quality Evaluation
    // ========================================================================

    async evaluateQuality(request, context) {
      return relayCommand('evaluateQuality', request ?? {}, ctxOpts(context));
    },

    async getQualityContexts(context) {
      return relayCommand('getQualityContexts', {}, ctxOpts(context));
    },

    async saveBaseline(request, context) {
      return relayCommand('saveBaseline', request ?? {}, ctxOpts(context));
    },

    async diffBaseline(request, context) {
      return relayCommand('diffBaseline', request ?? {}, ctxOpts(context));
    },

    // ========================================================================
    // Form State Awareness
    // ========================================================================

    async getForms(context) {
      return relayCommand('getForms', {}, ctxOpts(context));
    },

    async fillForm(request, context) {
      return relayCommand('fillForm', request, ctxOpts(context));
    },

    async snapshotForms(context) {
      return relayCommand('snapshotForms', {}, ctxOpts(context));
    },

    async diffForms(request, context) {
      return relayCommand('diffForms', request, ctxOpts(context));
    },

    // ========================================================================
    // Clipboard
    // ========================================================================

    async getClipboard(context) {
      return relayCommand('getClipboard', {}, ctxOpts(context));
    },

    async setClipboard(request, context) {
      return relayCommand('setClipboard', request, ctxOpts(context));
    },

    // ========================================================================
    // Network Request Monitoring
    // ========================================================================

    async getNetworkRequests(params, context) {
      return relayCommand('getNetworkRequests', params ?? {}, ctxOpts(context));
    },

    async getNetworkRequestsInFlight(context) {
      return relayCommand('getNetworkRequestsInFlight', {}, ctxOpts(context));
    },

    async waitForNetworkRequest(request, context) {
      return relayCommand('waitForNetworkRequest', request, ctxOpts(context));
    },

    async getNetworkRequest(id, context) {
      return relayCommand('getNetworkRequest', { id }, ctxOpts(context));
    },

    // ========================================================================
    // State Summary (Phase 1.3, plan 2026-05-03)
    // ========================================================================

    async getStateSummary(): Promise<APIResponse<StateSummary>> {
      // Reuse the cached snapshot — `latestControlSnapshot` is the same data
      // a fresh `/control/snapshot` call would synthesize, just without the
      // round-trip cost. The whole point of state-summary is to skip the
      // five separate calls a caller would otherwise make.
      const snapshot = latestControlSnapshot as ControlSnapshot & {
        route?: string;
        activeTab?: string;
      };
      const visibleElementCount = snapshot.elements.reduce((acc, el) => {
        const state = el.state as { rect?: { width: number; height: number }; visible?: boolean } | undefined;
        const rect = state?.rect;
        const hasLayout = !!rect && (rect.width > 0 || rect.height > 0);
        const isVisible = state?.visible !== false;
        return acc + (hasLayout && isVisible ? 1 : 0);
      }, 0);
      const modalOpen = (snapshot.modalStack?.count ?? 0) > 0;

      // hasErrors: best-effort from the relay's console-errors cache. We do
      // NOT trigger a fresh round-trip here — state-summary's contract is
      // "synthesize from what we already have", not "make extra calls".
      let hasErrors = false;
      const cache = lastConsoleErrorsCache as
        | APIResponse<{ count?: number; errors?: unknown[] }>
        | null;
      if (cache?.success && cache.data) {
        const count = cache.data.count;
        if (typeof count === 'number') {
          hasErrors = count > 0;
        } else if (Array.isArray(cache.data.errors)) {
          hasErrors = cache.data.errors.length > 0;
        }
      }

      // idleSignals: the relay doesn't cache idle status, but a single
      // round-trip is still cheaper than four. Fall back to null on error
      // so callers can detect "idle detection unavailable" without 500ing.
      let idleSignals: StateSummary['idleSignals'] = null;
      try {
        const idleResp = await relayCommand<NonNullable<StateSummary['idleSignals']>>(
          'getIdleStatus'
        );
        if (idleResp.success && idleResp.data) idleSignals = idleResp.data;
      } catch {
        idleSignals = null;
      }

      return success({
        visibleElementCount,
        modalOpen,
        hasErrors,
        idleSignals,
        registeredComponents: snapshot.components.length,
        route: snapshot.route ?? null,
        activeTab: snapshot.activeTab ?? null,
      });
    },

    // ========================================================================
    // Page Health Diagnostics
    // ========================================================================
    //
    // Pure data-over-snapshot analyzer (mirrors the runner's
    // `/control/page-health` handler step-for-step). The relay variant
    // computes the report server-side from the cached snapshot — no extra
    // round-trip to the browser tab is required because every input
    // (`state.visible`, `state.normalizedRect`, `category`, `classes`,
    // `state.textContent`) already lives in the snapshot relay maintains.

    async pageHealth() {
      try {
        const snapshot = latestControlSnapshot as ControlSnapshot;
        const elements = (snapshot?.elements ?? []) as unknown as Parameters<
          typeof diagnosePageHealth
        >[0];
        const report = diagnosePageHealth(elements);
        return success(report);
      } catch (err) {
        return error((err as Error).message, 'PAGE_HEALTH_ERROR');
      }
    },

    // ========================================================================
    // Idle Detection
    // ========================================================================

    async getIdleStatus(context) {
      return relayCommand('getIdleStatus', {}, ctxOpts(context));
    },

    async getIdleSignalStatus(signal, context) {
      return relayCommand('getIdleSignalStatus', { signal }, ctxOpts(context));
    },

    async waitForIdle(request, context) {
      return relayCommand('waitForIdle', request ?? {}, ctxOpts(context));
    },

    async waitForSignalIdle(signal, request, context) {
      return relayCommand('waitForSignalIdle', { signal, ...request }, ctxOpts(context));
    },

    async waitForTargets(request, context) {
      return relayCommand('waitForTargets', request, ctxOpts(context));
    },

    // ========================================================================
    // Undo/Redo
    // ========================================================================

    async getUndoState(context) {
      return relayCommand('getUndoState', {}, ctxOpts(context));
    },

    async executeUndo(context) {
      return relayCommand('executeUndo', {}, ctxOpts(context));
    },

    async executeRedo(context) {
      return relayCommand('executeRedo', {}, ctxOpts(context));
    },

    // ========================================================================
    // API Discovery (server-only)
    // ========================================================================

    async getCapabilities(): Promise<APIResponse<CapabilitiesResponse>> {
      return success({
        version,
        categories: {
          control: {
            description: 'Element and component control',
            endpoints: [
              { method: 'GET', path: '/control/elements', description: 'List registered elements' },
              { method: 'GET', path: '/control/snapshot', description: 'Get control snapshot' },
              { method: 'POST', path: '/control/find', description: 'Find elements' },
              {
                method: 'POST',
                path: '/control/element/:id/action',
                description: 'Execute element action',
              },
            ],
          },
          ai: {
            description: 'AI-native search and execution',
            endpoints: [
              { method: 'POST', path: '/ai/search', description: 'Semantic element search' },
              {
                method: 'POST',
                path: '/ai/execute',
                description: 'Natural language action execution',
              },
              { method: 'POST', path: '/ai/assert', description: 'UI assertion' },
              { method: 'GET', path: '/ai/snapshot', description: 'Semantic snapshot' },
            ],
          },
          media: {
            description: 'Media element discovery and analysis',
            endpoints: [
              {
                method: 'POST',
                path: '/ai/media/find',
                description: 'Find media elements with filters',
              },
              {
                method: 'POST',
                path: '/ai/media/audit/accessibility',
                description: 'Alt text audit',
              },
              {
                method: 'POST',
                path: '/ai/media/audit/performance',
                description: 'Oversized/transfer size audit',
              },
              { method: 'POST', path: '/ai/media/snapshot', description: 'Capture media snapshot' },
              { method: 'POST', path: '/ai/media/compare', description: 'Compare two snapshots' },
              {
                method: 'POST',
                path: '/ai/media/analyze',
                description: 'Capture image + context for AI analysis',
              },
              {
                method: 'POST',
                path: '/ai/media/analyze/batch',
                description: 'Capture multiple images for comparison',
              },
              {
                method: 'POST',
                path: '/ai/media/analyze/page',
                description: 'Capture all visible media on page',
              },
            ],
          },
          debug: {
            description: 'Debugging and diagnostics',
            endpoints: [
              { method: 'GET', path: '/debug/metrics', description: 'Server metrics' },
              { method: 'GET', path: '/control/health', description: 'Health report' },
              { method: 'GET', path: '/control/browser-events', description: 'Browser events' },
            ],
          },
        },
      });
    },

    // ========================================================================
    // Heartbeat (server-only)
    // ========================================================================

    async receiveHeartbeat() {
      relay.receiveHeartbeat();
      return success({ received: true });
    },

    // ========================================================================
    // Media Discovery & Analysis — removed in Phase 2 of the UI Bridge
    // Vision Pipeline (2026-05-13). The new `/vision/*` routes are
    // runner-direct (see the `visionCapture`/`visionAnnotate`/`visionDiff`/
    // `visionRaw`/`visionCacheStream`/`visionHealth` stubs above).
    // ========================================================================

    async getSpecs() {
      // Try the browser relay first for live spec data
      const result = await relayWithFallback('getSpecs', {}, {} as Record<string, unknown>);
      // If the relay returned specs, use them
      if (result.success && result.data && Object.keys(result.data).length > 0) {
        return result;
      }
      // Fall back to server-injected specs (passed via options.specs)
      if (injectedSpecs.length > 0) {
        const data: Record<string, unknown> = {};
        for (const spec of injectedSpecs) {
          data[spec.specId] = spec.config;
        }
        return success(data);
      }
      return result;
    },

    async getElementHistory(elementId, options, context) {
      return relayWithFallback(
        'getElementHistory',
        { elementId, options },
        [] as unknown[],
        context
      );
    },

    // ========================================================================
    // Change Observation (push-based)
    // ========================================================================

    async getChangesSince(params) {
      const since = params?.since ?? 0;
      const limit = params?.limit ?? 100;
      const events = changeEventBuffer.filter((e) => e.timestamp > since).slice(-limit);
      return success({ events, count: events.length });
    },

    // Enhanced discovery — relay to browser context
    async query(request, context) {
      return relayCommand('query', request, ctxOpts(context));
    },

    async waitForElement(request, context) {
      return relayCommand('waitForElement', request, ctxOpts(context));
    },

    // Tier 3.1 — relay to browser context so the JS SDK can do registry polling
    async waitForElementByCondition(request, context) {
      return relayCommand('waitForElementByCondition', request, ctxOpts(context));
    },

    // Testing-friendliness — relay route-change waits to the browser
    // context, which owns the ChangeTracker state.
    async waitForRouteChange(request, context) {
      return relayCommand('waitForRouteChange', request, ctxOpts(context));
    },
    async waitForElementRegistered(request, context) {
      return relayCommand('waitForElementRegistered', request, ctxOpts(context));
    },

    // Phase 2.1 (plan 2026-05-03) — relay element-predicate assertion to
    // the browser. The runtime dispatcher evaluates the predicate against
    // the live registry; we forward the verdict and re-stamp the 422
    // semantics so external consumers see the same status code regardless
    // of whether the in-process or relay path serves the request.
    async expectElement(id, request, context) {
      const relayed = await relayCommand<{
        passed: boolean;
        observedState: { registered: boolean; state: Record<string, unknown> | null } | null;
        durationMs: number;
      }>('expectElement', { id, request }, ctxOpts(context));
      if (!relayed.success || !relayed.data) return relayed;
      if (relayed.data.passed === false) {
        return {
          ...relayed,
          httpStatus: 422,
        };
      }
      return relayed;
    },

    // Phase 4.1 (plan 2026-05-03) — spawn-headless is a server-side-only
    // feature. The relay routes traffic between an external HTTP client
    // and a browser-resident SDK, so it has no business launching a
    // separate Chromium process. Return 501 so the route shows up in
    // capability advertisements without pretending to fulfill the contract.
    async spawnHeadless() {
      return {
        success: false,
        error:
          'spawn-headless is not supported on the relay transport. ' +
          'Call /control/sdk/spawn-headless against the in-process server ' +
          '(createHandlers) instead.',
        code: mapInternalErrorCode('HEADLESS_SPAWN_UNSUPPORTED_ON_RELAY'),
        timestamp: Date.now(),
        httpStatus: 501,
      };
    },

    // Tier 3.2 — relay batch to browser context
    async controlBatch(request, context) {
      return relayCommand('controlBatch', request, ctxOpts(context));
    },

    // App-agnostic convenience endpoints
    async clickByText(request, context) {
      return relayCommand('clickByText', request, ctxOpts(context));
    },
    async clickBySelector(request, context) {
      return relayCommand('clickBySelector', request, ctxOpts(context));
    },
    async typeInto(request, context) {
      return relayCommand('typeInto', request, ctxOpts(context));
    },
    async readValue(request, context) {
      return relayCommand('readValue', request, ctxOpts(context));
    },
    async findByText(request, context) {
      return relayCommand('findByText', request, ctxOpts(context));
    },

    // Diagnostics
    async getDiagnostics(context) {
      return relayCommand('getDiagnostics', {}, ctxOpts(context));
    },

    // Navigation adapter
    async getRoutes(context) {
      return relayCommand('getRoutes', {}, ctxOpts(context));
    },
    async navigateByAdapter(request, context) {
      return relayCommand('navigateByAdapter', request, ctxOpts(context));
    },
  };

  // Expose render log entry addition for external use
  (handlers as unknown as Record<string, unknown>).__addRenderLogEntry = (
    entry: RenderLogEntry
  ) => {
    renderLogEntries.push(entry);
    while (renderLogEntries.length > MAX_ENTRIES) renderLogEntries.shift();
  };

  (handlers as unknown as Record<string, unknown>).__addRenderLogEntries = (
    entries: RenderLogEntry[]
  ) => {
    for (const entry of entries) {
      renderLogEntries.push(entry);
      while (renderLogEntries.length > MAX_ENTRIES) renderLogEntries.shift();
    }
  };

  // Expose push-based change observation for external wiring
  (handlers as unknown as Record<string, unknown>).__pushChangeEvent = pushChangeEvent;

  (handlers as unknown as Record<string, unknown>).__subscribeChanges = (
    callback: (event: DOMChangeEvent) => void
  ): (() => void) => {
    changeEventSubscribers.add(callback);
    return () => {
      changeEventSubscribers.delete(callback);
    };
  };

  return handlers;
}
