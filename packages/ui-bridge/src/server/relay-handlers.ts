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
import type { UIBridgeServerHandlers, APIResponse, CapabilitiesResponse } from './types';
import type { RenderLogEntry } from '../render-log';
import type { ControlSnapshot, FallbackScreenshot } from '../control';
import type { SemanticSnapshot } from '../ai';

// ============================================================================
// Helpers
// ============================================================================

function success<T>(data: T): APIResponse<T> {
  return { success: true, data, timestamp: Date.now() };
}

function error(message: string, code?: string): APIResponse<never> {
  return { success: false, error: message, code, timestamp: Date.now() };
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

  // Server-side render log cache
  let renderLogEntries: RenderLogEntry[] = [];
  const MAX_ENTRIES = 5;

  // Cached snapshots
  let latestControlSnapshot: ControlSnapshot = {
    timestamp: Date.now(),
    elements: [],
    components: [],
    workflows: [],
    activeRuns: [],
  };
  let latestSemanticSnapshot: SemanticSnapshot | null = null;

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
      return error((e as Error).message, 'COMMAND_FAILED');
    }
  }

  // Helper: relay with empty-array fallback
  async function relayWithFallback<T>(
    action: string,
    payload: unknown = {},
    fallback: T
  ): Promise<APIResponse<T>> {
    try {
      const result = await relay.queueCommand<T>(action, payload);
      return success(result);
    } catch {
      return success(fallback);
    }
  }

  // Helper: refresh the cached control snapshot if stale or if the given array is empty
  const CACHE_TTL_MS = 5000;
  async function refreshSnapshotIfStale(isEmpty: boolean): Promise<void> {
    const isStale = Date.now() - latestControlSnapshot.timestamp > CACHE_TTL_MS;
    if (isEmpty || isStale) {
      try {
        const result = await relay.queueCommand<ControlSnapshot>('getControlSnapshot', {});
        latestControlSnapshot = result;
      } catch {
        /* use cached fallback */
      }
    }
  }

  const handlers: UIBridgeServerHandlers = {
    // ========================================================================
    // Render Log (server-side)
    // ========================================================================

    async getRenderLog(query) {
      let results = [...renderLogEntries];
      if (query?.type) results = results.filter((e) => e.type === query.type);
      if (query?.since) results = results.filter((e) => e.timestamp >= query.since!);
      if (query?.until) results = results.filter((e) => e.timestamp <= query.until!);
      if (query?.limit) results = results.slice(-query.limit);
      return success(results);
    },

    async clearRenderLog() {
      renderLogEntries = [];
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

    async getElements() {
      await refreshSnapshotIfStale(latestControlSnapshot.elements.length === 0);
      return success(latestControlSnapshot.elements);
    },

    async getElement(id) {
      const element = latestControlSnapshot.elements.find((e) => e.id === id);
      if (!element) return error(`Element ${id} not found`, 'NOT_FOUND');
      return success(element);
    },

    async getElementState(id) {
      return relayCommand('getElementState', { id });
    },

    async getElementReactState(id) {
      return relayCommand('getElementReactState', { id });
    },

    async executeElementAction(id, request) {
      return relayCommand('executeElementAction', { id, request });
    },

    // ========================================================================
    // Control — Components
    // ========================================================================

    async getComponents() {
      // Refresh snapshot to get the latest component list from the browser
      await refreshSnapshotIfStale(latestControlSnapshot.components.length === 0);
      return success(latestControlSnapshot.components);
    },

    async getComponent(id) {
      // Refresh snapshot before looking up — components mount/unmount with page navigation
      await refreshSnapshotIfStale(true);
      const component = latestControlSnapshot.components.find((c) => c.id === id);
      if (!component) {
        return error(
          `Component "${id}" not found. Components are only available when their page is active — navigate to the page that contains this component and try again.`,
          'NOT_FOUND'
        );
      }
      return success(component);
    },

    async getComponentState(id) {
      return relayCommand('getComponentState', { id });
    },

    async executeComponentAction(id, request) {
      return relayCommand('executeComponentAction', { id, request });
    },

    // ========================================================================
    // Find / Discovery
    // ========================================================================

    async find(request) {
      const { targetTabId, ...payload } =
        (request as Record<string, unknown> & { targetTabId?: string }) || {};
      return relayCommand('find', payload, { targetTabId });
    },

    async discover(request) {
      const { targetTabId, ...payload } =
        (request as Record<string, unknown> & { targetTabId?: string }) || {};
      return relayCommand('discover', payload, { targetTabId });
    },

    async getElementImages(request) {
      const { targetTabId, ...payload } =
        (request as Record<string, unknown> & { targetTabId?: string }) || {};
      return relayCommand('getElementImages', payload, { targetTabId });
    },

    async getControlSnapshot(request) {
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
        return success(snapshot);
      }

      try {
        const result = await relay.queueCommand<ControlSnapshot>(
          'getControlSnapshot',
          {},
          { targetTabId: request?.targetTabId }
        );
        latestControlSnapshot = result;

        // If the snapshot came back empty (no elements, no components), the app
        // may be in an error state — attach a fallback screenshot for context
        const isEmpty = result.elements.length === 0 && result.components.length === 0;
        if (isEmpty && screenshotFallbackUrl) {
          const fallback = await fetchFallbackScreenshot(screenshotFallbackUrl, 'empty_response');
          if (fallback) {
            return success({ ...result, fallbackScreenshot: fallback });
          }
        }

        return success(result);
      } catch (e) {
        // Command timed out or failed — return cached snapshot with fallback screenshot
        const snapshot = { ...latestControlSnapshot, timestamp: Date.now() };
        if (screenshotFallbackUrl) {
          const fallback = await fetchFallbackScreenshot(screenshotFallbackUrl, 'timeout');
          if (fallback) {
            snapshot.fallbackScreenshot = fallback;
          }
        }
        return success(snapshot);
      }
    },

    // ========================================================================
    // Workflows
    // ========================================================================

    async getWorkflows() {
      await refreshSnapshotIfStale(latestControlSnapshot.workflows.length === 0);
      return success(latestControlSnapshot.workflows);
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
      return relayCommand('getConsoleErrors', params ?? {});
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
      return relayCommand('pageNavigate', payload, { targetTabId });
    },

    async pageGoBack() {
      return relayCommand('pageGoBack');
    },

    async pageGoForward() {
      return relayCommand('pageGoForward');
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
      return success({} as Record<string, unknown>);
    },

    async getElementHistory(elementId, options) {
      return relayWithFallback('getElementHistory', { elementId, options }, [] as unknown[]);
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

  return handlers;
}
