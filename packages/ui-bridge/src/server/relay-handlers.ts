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
import type {
  UIBridgeServerHandlers,
  APIResponse,
  CapabilitiesResponse,
  DOMChangeEvent,
} from './types';
import type { RenderLogEntry } from '../render-log';
import type {
  ControlSnapshot,
  FallbackScreenshot,
  ComponentActionRequest,
  FindResponse,
} from '../control';
import { matchesElementSelector, type MatchableElement } from './selector-match';
import type { SemanticSnapshot } from '../ai';
import type { Recency as RecencyType } from '../core/recency';
import { Recency, isSatisfiedBy, parseRecency } from '../core/recency';
import { findElements } from '../core/find';
import type { ElementQuery } from '../core/find';

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
    code,
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
   * Example: `'http://localhost:9876/ui-bridge/sdk/screenshot'`
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

  // Helper: relay a command, return success/error
  async function relayCommand<T>(
    action: string,
    payload: unknown = {},
    opts?: { targetTabId?: string }
  ): Promise<APIResponse<T>> {
    try {
      const result = await relay.queueCommand<T>(action, payload, opts);
      return success(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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
    fallback: T
  ): Promise<APIResponse<T>> {
    try {
      const result = await relay.queueCommand<T>(action, payload);
      return success(result);
    } catch {
      return success(fallback, {
        fallback: true,
        reason: `Relay command '${action}' failed or timed out — returning default value. Ensure the target app is connected and responsive.`,
      });
    }
  }

  // Helper: filter cached snapshot elements using find/discover criteria.
  // Returns elements with enough fields to satisfy FindResponse shape.
  function filterCachedElements(
    elements: ControlSnapshot['elements'],
    criteria: Record<string, unknown>
  ): Array<Record<string, unknown>> {
    const interactiveTypes = new Set([
      'button',
      'input',
      'select',
      'textarea',
      'link',
      'checkbox',
      'radio',
    ]);
    let filtered = [...elements];

    if (criteria.interactive_only || criteria.interactiveOnly) {
      filtered = filtered.filter(
        (e) => interactiveTypes.has(e.type) || (e.actions && e.actions.length > 0)
      );
    }
    if (criteria.element_type) {
      const t = criteria.element_type as string;
      filtered = filtered.filter((e) => e.type === t);
    }
    if (criteria.types && Array.isArray(criteria.types)) {
      const ts = criteria.types as string[];
      filtered = filtered.filter((e) => ts.includes(e.type));
    }
    if (criteria.text) {
      const lc = (criteria.text as string).toLowerCase();
      filtered = filtered.filter(
        (e) => (e.label ?? '').toLowerCase().includes(lc) || e.id.toLowerCase().includes(lc)
      );
    }
    if (criteria.exact_text) {
      const lc = (criteria.exact_text as string).toLowerCase();
      filtered = filtered.filter((e) => (e.label ?? '').toLowerCase() === lc);
    }
    if (criteria.role) {
      const r = (criteria.role as string).toLowerCase();
      filtered = filtered.filter((e) => e.type.toLowerCase() === r);
    }
    if (criteria.label) {
      const lc = (criteria.label as string).toLowerCase();
      filtered = filtered.filter((e) => (e.label ?? '').toLowerCase().includes(lc));
    }
    // Map to DiscoveredElement-compatible shape (add missing fields)
    return filtered.map((e) => ({
      ...e,
      tagName: e.type,
      registered: true,
    }));
  }

  // Helper: refresh the cached control snapshot based on Recency requirements
  const defaultRecency = Recency.MaxAge(options?.cacheTtlMs ?? 5000);
  let snapshotStaleSince: number | null = null;

  function staleMeta(): { stale: boolean; staleSinceMs?: number; cacheAgeMs: number } {
    const cacheAgeMs = Date.now() - latestControlSnapshot.timestamp;
    if (snapshotStaleSince) {
      return { stale: true, staleSinceMs: Date.now() - snapshotStaleSince, cacheAgeMs };
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

    async getRenderLog(query) {
      // Try relaying to the browser first for live render log data
      try {
        const result = await relay.queueCommand('getRenderLog', query ?? {});
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

    async clearRenderLog() {
      renderLogEntries = [];
      // Also relay the clear to the browser so live render log entries are cleared
      try {
        await relay.queueCommand('clearRenderLog', {});
      } catch {
        // Browser may be disconnected — server-side cache already cleared above
      }
      return success(undefined);
    },

    async captureSnapshot() {
      return relayCommand('captureSnapshot');
    },

    async getRenderLogPath() {
      return success({ path: '/api/ui-bridge/render-log' });
    },

    // ========================================================================
    // Control — Elements
    // ========================================================================

    async getElements(options) {
      const recency = resolveRecency(options);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.elements.length === 0);
      const _meta = staleMeta();

      let elements = latestControlSnapshot.elements;

      // Apply substring filters via the shared matcher. The relay works
      // against the cached snapshot (no live DOM), so the matcher's
      // accessible-name fallback chain (label → id) is what actually fires here.
      if (options?.title || options?.aria_label || options?.text) {
        elements = elements.filter((el) =>
          matchesElementSelector(el as unknown as MatchableElement, {
            title: options?.title as string | undefined,
            aria_label: options?.aria_label as string | undefined,
            text: options?.text as string | undefined,
          })
        );
      }

      return success(elements, _meta);
    },

    async rankElements(request) {
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

    async getElement(id, options) {
      // Try relay first for live element data when browser is connected
      try {
        const result = await relay.queueCommand('getElement', { id });
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

    async getElementState(id) {
      try {
        const result = await relay.queueCommand('getElementState', { id });
        if (result) return success(result);
      } catch {
        // Relay failed — fall back to state from cached snapshot
      }
      const element = latestControlSnapshot.elements.find((e) => e.id === id);
      if (element && 'state' in element) return success((element as any).state);
      return error(`Element state for ${id} not available (browser disconnected)`, 'NOT_FOUND');
    },

    async getElementReactState(id) {
      return relayCommand('getElementReactState', { id });
    },

    async executeElementAction(id, request) {
      return relayCommand('executeElementAction', { id, request });
    },

    async executeBatchAction(request) {
      return relayCommand('executeBatchAction', { request });
    },

    // ========================================================================
    // Control — Components
    // ========================================================================

    async getComponents(options) {
      const recency = resolveRecency(options);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.components.length === 0);
      const _meta = staleMeta();
      return success(latestControlSnapshot.components, _meta);
    },

    async getComponent(id, options) {
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
        return error(
          `Component "${id}" not found. Available components: [${available.join(', ')}]. Components are only available when their page is active — navigate to the page that contains this component and try again.`,
          'NOT_FOUND',
          [
            'Use getControlSnapshot() to see all available components',
            'Navigate to the page containing this component first',
            'Components mount/unmount with page navigation — ensure the correct page is active',
          ]
        );
      }
      return success(component);
    },

    async getComponentState(id) {
      return relayCommand('getComponentState', { id });
    },

    async executeComponentAction(id, request, body?: Record<string, unknown>) {
      // The Express adapter passes (id, actionId, body) based on route params ['id', 'actionId'].
      // When called from Express: id=componentId, request=actionId (string), body=req.body.
      // When called from Next.js/WebSocket: id=componentId, request={action, params}.
      // Normalize both calling conventions into the relay command format.
      let normalizedRequest: ComponentActionRequest;
      if (typeof request === 'string') {
        // Express path: request is actually the actionId string, body is the 3rd argument
        normalizedRequest = { action: request, params: body?.params as Record<string, unknown> };
      } else {
        normalizedRequest = request;
      }
      return relayCommand('executeComponentAction', { id, request: normalizedRequest });
    },

    // ========================================================================
    // Find / Discovery
    // ========================================================================

    async find(request) {
      const {
        targetTabId,
        recency: recencyParam,
        ...payload
      } = (request as Record<string, unknown> & { targetTabId?: string; recency?: string }) || {};
      const result = await relayCommand<FindResponse>('find', payload, { targetTabId });
      if (result.success) return result;
      // Relay failed — fall back to filtering cached snapshot elements
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
        },
        _meta
      ) as APIResponse<FindResponse>;
    },

    async discover(request) {
      const {
        targetTabId,
        recency: recencyParam,
        ...payload
      } = (request as Record<string, unknown> & { targetTabId?: string; recency?: string }) || {};
      const result = await relayCommand<FindResponse>('discover', payload, { targetTabId });
      if (result.success) return result;
      // Relay failed — fall back to filtering cached snapshot elements
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
        },
        _meta
      ) as APIResponse<FindResponse>;
    },

    async getElementImages(request) {
      const { targetTabId, ...payload } =
        (request as Record<string, unknown> & { targetTabId?: string }) || {};
      return relayCommand('getElementImages', payload, { targetTabId });
    },

    async getControlSnapshot(request) {
      const recency = parseRecency(request?.recency);

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
        const result = await relay.queueCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          { targetTabId: request?.targetTabId }
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

    async getWorkflows(options) {
      const recency = resolveRecency(options);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.workflows.length === 0);
      const _meta = staleMeta();
      return success(latestControlSnapshot.workflows, _meta);
    },

    async runWorkflow(id, request) {
      return relayCommand('runWorkflow', { id, request });
    },

    async getWorkflowStatus(runId) {
      return relayCommand('getWorkflowStatus', { runId });
    },

    // ========================================================================
    // Debug
    // ========================================================================

    async getActionHistory(limit) {
      return relayWithFallback('getActionHistory', { limit }, [] as unknown[]);
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

    async highlightElement(id) {
      return relayCommand('highlightElement', { id });
    },

    async getElementTree() {
      return relayCommand('getElementTree');
    },

    async getConsoleErrors(params) {
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
        const result = await relay.queueCommand<ConsoleErrorsResult | GroupedResult>(
          'getConsoleErrors',
          params ?? {}
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

    async clearConsoleErrors() {
      return relayCommand('clearConsoleErrors');
    },

    // ========================================================================
    // AI-Native
    // ========================================================================

    async aiSearch(criteria) {
      return relayCommand('aiSearch', criteria);
    },

    async aiFind(request) {
      return relayCommand('aiFind', request);
    },

    async aiExecute(request) {
      return relayCommand('aiExecute', request);
    },

    async aiAssert(request) {
      return relayCommand('aiAssert', request);
    },

    async aiAssertBatch(request) {
      return relayCommand('aiAssertBatch', request);
    },

    async getSemanticSnapshot(options) {
      try {
        const result = await relay.queueCommand<SemanticSnapshot>(
          'getSemanticSnapshot',
          options ?? {}
        );
        latestSemanticSnapshot = result;
        return success(result);
      } catch (e) {
        if (latestSemanticSnapshot) return success(latestSemanticSnapshot);
        return error((e as Error).message, 'COMMAND_FAILED');
      }
    },

    async getSemanticDiff(since) {
      return relayCommand('getSemanticDiff', { since });
    },

    async getPageSummary() {
      return relayCommand('getPageSummary');
    },

    // ========================================================================
    // Change Tracking
    // ========================================================================

    async executeWithDiff(request) {
      return relayCommand('executeWithDiff', request);
    },

    async waitForChange(request) {
      return relayCommand('waitForChange', request);
    },

    async categorizeLastDiff() {
      return relayCommand('categorizeLastDiff');
    },

    async getScopedDiff(request) {
      return relayCommand('getScopedDiff', request);
    },

    async summarizeDiff(request) {
      return relayCommand('summarizeDiff', request);
    },

    async analyzeStructuredChanges(request) {
      return relayCommand('analyzeStructuredChanges', request);
    },

    // ========================================================================
    // Change Buffer
    // ========================================================================

    async enableChangeBuffer() {
      return relayCommand('enableChangeBuffer');
    },

    async disableChangeBuffer() {
      return relayCommand('disableChangeBuffer');
    },

    async drainChangeBuffer() {
      return relayCommand('drainChangeBuffer');
    },

    async getChangeBufferSize() {
      return relayCommand('getChangeBufferSize');
    },

    // ========================================================================
    // Snapshot Bookmarks
    // ========================================================================

    async saveBookmark(request) {
      return relayCommand('saveBookmark', request);
    },

    async getBookmark(name) {
      return relayCommand('getBookmark', { name });
    },

    async deleteBookmark(name) {
      return relayCommand('deleteBookmark', { name });
    },

    async listBookmarks() {
      return relayCommand('listBookmarks');
    },

    async diffFromBookmark(name) {
      return relayCommand('diffFromBookmark', { name });
    },

    // ========================================================================
    // Semantic Search
    // ========================================================================

    async aiSemanticSearch(criteria) {
      return relayCommand('aiSemanticSearch', criteria);
    },

    // ========================================================================
    // State Management
    // ========================================================================

    async getStates() {
      return relayWithFallback('getStates', {}, []);
    },

    async getState(id) {
      return relayCommand('getState', { id });
    },

    async getActiveStates() {
      return relayWithFallback('getActiveStates', {}, []);
    },

    async activateState(id) {
      return relayCommand('activateState', { id });
    },

    async deactivateState(id) {
      return relayCommand('deactivateState', { id });
    },

    async getStateGroups() {
      return relayWithFallback('getStateGroups', {}, []);
    },

    async activateStateGroup(id) {
      return relayCommand('activateStateGroup', { id });
    },

    async deactivateStateGroup(id) {
      return relayCommand('deactivateStateGroup', { id });
    },

    async getTransitions() {
      return relayWithFallback('getTransitions', {}, []);
    },

    async canExecuteTransition(id) {
      return relayCommand('canExecuteTransition', { id });
    },

    async executeTransition(id) {
      return relayCommand('executeTransition', { id });
    },

    async findPath(request) {
      return relayCommand('findPath', request);
    },

    async navigateTo(request) {
      return relayCommand('navigateTo', request);
    },

    async getStateSnapshot() {
      return relayWithFallback(
        'getStateSnapshot',
        {},
        {
          timestamp: Date.now(),
          activeStates: [],
          states: [],
          groups: [],
          transitions: [],
        }
      );
    },

    // ========================================================================
    // Intent
    // ========================================================================

    async executeIntent(request) {
      return relayCommand('executeIntent', request);
    },

    async findIntent(request) {
      return relayCommand('findIntent', request);
    },

    async listIntents() {
      return relayWithFallback('listIntents', {}, []);
    },

    async registerIntent(intent) {
      return relayCommand('registerIntent', intent);
    },

    async executeIntentFromQuery(request) {
      return relayCommand('executeIntentFromQuery', request);
    },

    async deleteIntent(name) {
      return relayCommand('deleteIntent', { name });
    },

    // ========================================================================
    // Recovery
    // ========================================================================

    async attemptRecovery(request) {
      return relayCommand('attemptRecovery', request);
    },

    // ========================================================================
    // Cross-App Analysis
    // ========================================================================

    async analyzePageData() {
      return relayCommand('analyzePageData');
    },

    async analyzePageRegions() {
      return relayCommand('analyzePageRegions');
    },

    async analyzeStructuredData() {
      return relayCommand('analyzeStructuredData');
    },

    async crossAppCompare(request) {
      return relayCommand('crossAppCompare', request);
    },

    // ========================================================================
    // Page Navigation
    // ========================================================================

    async pageRefresh() {
      return relayCommand('pageRefresh');
    },

    async pageNavigate(request) {
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
      return relayCommand('pageNavigate', payload, { targetTabId });
    },

    async pageGoBack() {
      return relayCommand('pageGoBack');
    },

    async pageGoForward() {
      return relayCommand('pageGoForward');
    },

    async pageEvaluate(request: unknown) {
      return relayCommand('pageEvaluate', request);
    },

    async pageScroll(request: unknown) {
      return relayCommand('pageScroll', request);
    },

    // ========================================================================
    // Annotations
    // ========================================================================

    async getAnnotations() {
      return relayWithFallback('getAnnotations', {}, {});
    },

    async getAnnotation(id) {
      return relayCommand('getAnnotation', { id });
    },

    async setAnnotation(id, annotation) {
      return relayCommand('setAnnotation', { id, annotation });
    },

    async deleteAnnotation(id) {
      return relayCommand('deleteAnnotation', { id });
    },

    async importAnnotations(config) {
      return relayCommand('importAnnotations', config);
    },

    async exportAnnotations() {
      return relayCommand('exportAnnotations');
    },

    async getAnnotationCoverage() {
      return relayCommand('getAnnotationCoverage');
    },

    // ========================================================================
    // Clipboard (relayed to browser for gesture-based access)
    // ========================================================================

    async clipboardWrite(request: unknown) {
      return relayCommand('clipboardWrite', request);
    },

    async clipboardRead() {
      return relayCommand('clipboardRead');
    },

    // ========================================================================
    // Performance Diagnostics
    // ========================================================================

    async getPerformanceEntries() {
      return relayCommand('getPerformanceEntries');
    },

    async clearPerformanceEntries() {
      return relayCommand('clearPerformanceEntries');
    },

    async getBrowserEvents(params) {
      return relayCommand('getBrowserEvents', params ?? {});
    },

    async getTimeline(params) {
      return relayCommand('getTimeline', params ?? {});
    },

    // ========================================================================
    // Health & Error Debugging
    // ========================================================================

    async getHealthReport(params) {
      return relayCommand('getHealthReport', params ?? {});
    },

    async getNetworkChains(params) {
      return relayCommand('getNetworkChains', params ?? {});
    },

    async startErrorSession(request) {
      return relayCommand('startErrorSession', request);
    },

    async endErrorSession() {
      return relayCommand('endErrorSession');
    },

    async getErrorSessions() {
      return relayCommand('getErrorSessions');
    },

    async captureErrorBaseline(request) {
      return relayCommand('captureErrorBaseline', request);
    },

    async compareErrorBaseline(request) {
      return relayCommand('compareErrorBaseline', request);
    },

    async getErrorSnapshots(params) {
      return relayCommand('getErrorSnapshots', params ?? {});
    },

    async getErrorReport() {
      return relayCommand('getErrorReport');
    },

    // ========================================================================
    // Design Review
    // ========================================================================

    async getElementStyles(id) {
      return relayCommand('getElementStyles', { id });
    },

    async getElementStateStyles(id, request) {
      return relayCommand('getElementStateStyles', { id, ...request });
    },

    async getDesignSnapshot(request) {
      return relayCommand('getDesignSnapshot', request ?? {});
    },

    async getResponsiveSnapshots(request) {
      return relayCommand('getResponsiveSnapshots', request);
    },

    async setViewportConstraints(request) {
      return relayCommand('setViewportConstraints', request);
    },

    async runDesignAudit(request) {
      return relayCommand('runDesignAudit', request ?? {});
    },

    async loadStyleGuide(request) {
      return relayCommand('loadStyleGuide', request);
    },

    async getStyleGuide() {
      return relayCommand('getStyleGuide');
    },

    async clearStyleGuide() {
      return relayCommand('clearStyleGuide');
    },

    // ========================================================================
    // Quality Evaluation
    // ========================================================================

    async evaluateQuality(request) {
      return relayCommand('evaluateQuality', request ?? {});
    },

    async getQualityContexts() {
      return relayCommand('getQualityContexts');
    },

    async saveBaseline(request) {
      return relayCommand('saveBaseline', request ?? {});
    },

    async diffBaseline(request) {
      return relayCommand('diffBaseline', request ?? {});
    },

    // ========================================================================
    // Form State Awareness
    // ========================================================================

    async getForms() {
      return relayCommand('getForms');
    },

    async fillForm(request) {
      return relayCommand('fillForm', request);
    },

    async snapshotForms() {
      return relayCommand('snapshotForms');
    },

    async diffForms(request) {
      return relayCommand('diffForms', request);
    },

    // ========================================================================
    // Clipboard
    // ========================================================================

    async getClipboard() {
      return relayCommand('getClipboard');
    },

    async setClipboard(request) {
      return relayCommand('setClipboard', request);
    },

    // ========================================================================
    // Network Request Monitoring
    // ========================================================================

    async getNetworkRequests(params) {
      return relayCommand('getNetworkRequests', params ?? {});
    },

    async getNetworkRequestsInFlight() {
      return relayCommand('getNetworkRequestsInFlight');
    },

    async waitForNetworkRequest(request) {
      return relayCommand('waitForNetworkRequest', request);
    },

    async getNetworkRequest(id) {
      return relayCommand('getNetworkRequest', { id });
    },

    // ========================================================================
    // Idle Detection
    // ========================================================================

    async getIdleStatus() {
      return relayCommand('getIdleStatus');
    },

    async getIdleSignalStatus(signal) {
      return relayCommand('getIdleSignalStatus', { signal });
    },

    async waitForIdle(request) {
      return relayCommand('waitForIdle', request ?? {});
    },

    async waitForSignalIdle(signal, request) {
      return relayCommand('waitForSignalIdle', { signal, ...request });
    },

    async waitForTargets(request) {
      return relayCommand('waitForTargets', request);
    },

    // ========================================================================
    // Undo/Redo
    // ========================================================================

    async getUndoState() {
      return relayCommand('getUndoState');
    },

    async executeUndo() {
      return relayCommand('executeUndo');
    },

    async executeRedo() {
      return relayCommand('executeRedo');
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
    // Media Discovery & Analysis
    // ========================================================================

    async findMedia(request) {
      return relayCommand('findMedia', request ?? {});
    },

    async mediaAuditAccessibility() {
      return relayCommand('mediaAuditAccessibility');
    },

    async mediaAuditPerformance() {
      return relayCommand('mediaAuditPerformance');
    },

    async captureMediaSnapshot(request) {
      return relayCommand('captureMediaSnapshot', request);
    },

    async compareMediaSnapshots(request) {
      return relayCommand('compareMediaSnapshots', request);
    },

    async analyzeMedia(request) {
      return relayCommand('analyzeMedia', request);
    },

    async analyzeMediaBatch(request) {
      return relayCommand('analyzeMediaBatch', request);
    },

    async analyzeMediaPage(request) {
      return relayCommand('analyzeMediaPage', request ?? {});
    },

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

    async getElementHistory(elementId, options) {
      return relayWithFallback('getElementHistory', { elementId, options }, [] as unknown[]);
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
    async query(request) {
      return relayCommand('query', request);
    },

    async waitForElement(request) {
      return relayCommand('waitForElement', request);
    },

    // Tier 3.1 — relay to browser context so the JS SDK can do registry polling
    async waitForElementByCondition(request) {
      return relayCommand('waitForElementByCondition', request);
    },

    // Testing-friendliness — relay route-change waits to the browser
    // context, which owns the ChangeTracker state.
    async waitForRouteChange(request) {
      return relayCommand('waitForRouteChange', request);
    },
    async waitForElementRegistered(request) {
      return relayCommand('waitForElementRegistered', request);
    },

    // Tier 3.2 — relay batch to browser context
    async controlBatch(request) {
      return relayCommand('controlBatch', request);
    },

    // App-agnostic convenience endpoints
    async clickByText(request) {
      return relayCommand('clickByText', request);
    },
    async clickBySelector(request) {
      return relayCommand('clickBySelector', request);
    },
    async typeInto(request) {
      return relayCommand('typeInto', request);
    },
    async readValue(request) {
      return relayCommand('readValue', request);
    },
    async findByText(request) {
      return relayCommand('findByText', request);
    },

    // Diagnostics
    async getDiagnostics() {
      return relayCommand('getDiagnostics');
    },

    // Navigation adapter
    async getRoutes() {
      return relayCommand('getRoutes');
    },
    async navigateByAdapter(request) {
      return relayCommand('navigateByAdapter', request);
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
