/**
 * UI Bridge Server Handlers
 *
 * Factory function to create handler implementations for all UI Bridge endpoints.
 */

import type { UIBridgeServerHandlers, APIResponse, RenderLogQuery } from './types';
import type {
  ControlSnapshot,
  DiscoveredElement,
  ActionExecutor,
  ControlActionResponse,
  ComponentActionResponse,
  FindResponse,
  WorkflowRunResponse,
} from '@qontinui/ui-bridge/control';
import { diagnosePageHealth } from './page-health';
import type { PageHealthReport } from './page-health';
import type { RenderLogEntry } from '@qontinui/ui-bridge/render-log';
import type {
  ActionFailureDetails,
  ElementHistoryOptions,
  ElementLogEntry,
} from '@qontinui/ui-bridge/core';
import type { UiBridgeErrorCode } from '@qontinui/ui-bridge/diagnostics';
import {
  getRecoverySuggestions,
  mapInternalErrorCode,
  DIAGNOSTICS,
  UI_BRIDGE_ERROR_CODES,
} from '@qontinui/ui-bridge/diagnostics';
import type {
  SearchCriteria,
  SearchResponse,
  NLActionRequest,
  NLActionResponse,
  AssertionRequest,
  AssertionResult,
  BatchAssertionRequest,
  BatchAssertionResult,
  SemanticSnapshot,
  SemanticDiff,
  SemanticSearchCriteria,
  SemanticSearchResponse,
  SemanticSearchResult,
  AIDiscoveredElement,
  ScreenAnalysis,
  CompactElement,
  GroupedElements,
  CompactModal,
  CompactToast,
  AggregatedErrors,
  LoadingState,
} from '@qontinui/ui-bridge/ai';
import {
  SearchEngine,
  NLActionExecutor,
  AssertionExecutor,
  SemanticSnapshotManager,
  SemanticDiffManager,
} from '@qontinui/ui-bridge/ai';

/**
 * Registry interface - minimal contract for handler usage
 */
export interface RegistryLike {
  getAllElements(): DiscoveredElement[];
  getElement(id: string): DiscoveredElement | undefined;
  getAllComponents(): unknown[];
  getComponent(id: string): unknown | undefined;
  getComponentState?(id: string): {
    state: Record<string, unknown>;
    computed: Record<string, unknown>;
    timestamp: number;
  } | null;
  createSnapshot(): ControlSnapshot;
  getRenderLog?(): RenderLogEntry[];
  clearRenderLog?(): void;
  captureSnapshot?(): unknown;
  findElements?(request?: unknown): unknown[];
  getAllWorkflows?(): unknown[];
  getWorkflow?(id: string): unknown;
  getActionHistory?(): unknown[];
  getMetrics?(): unknown;
  highlightElement?(id: string): void;
  getElementTree?(): unknown;

  // Element event log
  getElementHistory?(elementId: string, options?: ElementHistoryOptions): ElementLogEntry[];
}

/**
 * Action executor interface - minimal contract for handler usage
 */
export interface ActionExecutorLike {
  executeAction(
    elementId: string,
    request: { action: string; params?: Record<string, unknown>; waitOptions?: unknown }
  ): Promise<unknown>;
  executeComponentAction(
    componentId: string,
    request: { action: string; params?: Record<string, unknown> }
  ): Promise<unknown>;
  /** Optional find method for filtered element discovery */
  find?(request?: unknown): Promise<unknown>;
}

/**
 * Configuration for creating handlers
 */
export interface CreateHandlersConfig {
  /** Optional render log path */
  renderLogPath?: string;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Create a success response
 */
function success<T>(data: T): APIResponse<T> {
  return {
    success: true,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Create an error response.
 *
 * The optional `code` argument accepts the historical loosely-typed
 * internal strings (`'NOT_FOUND'`, `'ELEMENT_ERROR'`, …) used across this
 * file; it is mapped to a canonical `UiBridgeErrorCode` via the
 * single-source error mapper (plan Phase 1). The prose `message` is
 * retained as the dual-audience human field (goal #3).
 */
function error<T = unknown>(message: string, code?: string): APIResponse<T> {
  return {
    success: false,
    error: message,
    code: mapInternalErrorCode(code, message),
    timestamp: Date.now(),
  };
}

/**
 * Create structured failure details.
 *
 * Recovery suggestions come from the single generated diagnostics catalog
 * (plan D6) via getRecoverySuggestions(); the prior in-file switch + map are
 * deleted.
 */
function createFailureDetails(
  errorCode: UiBridgeErrorCode,
  message: string,
  options: {
    elementId?: string;
    selectorsTried?: string[];
    durationMs?: number;
    timeoutMs?: number;
  } = {}
): ActionFailureDetails {
  const retryableErrors: UiBridgeErrorCode[] = [
    'UB-ELEM-NOT-VISIBLE',
    'UB-ACTION-TIMEOUT',
    'UB-LOW-CONFIDENCE',
    'UB-NET-ERROR',
    'UB-STATE-NOT-REACHED',
  ];

  return {
    errorCode,
    message,
    elementId: options.elementId,
    selectorsTried: options.selectorsTried,
    suggestedActions: getRecoverySuggestions(errorCode),
    retryRecommended: retryableErrors.includes(errorCode),
    durationMs: options.durationMs,
    timeoutMs: options.timeoutMs,
  };
}

/**
 * Build the public catalog entry for a code (plan Phase 2). Shape mirrors a
 * `diagnostics/codes.json` entry exactly — `{ code, category, description,
 * commonCauses, recoveryTemplate }` — so the proxy endpoint, the
 * `explain --json` CLI, and the raw JSON file are byte-equivalent. Sourced
 * from the single generated catalog (D6), never hand-duplicated.
 */
function catalogEntry(code: UiBridgeErrorCode): {
  code: UiBridgeErrorCode;
  category: string;
  description: string;
  commonCauses: string[];
  recoveryTemplate: ReturnType<typeof getRecoverySuggestions>;
} {
  const entry = DIAGNOSTICS[code];
  return {
    code,
    category: entry.category,
    description: entry.description,
    commonCauses: [...entry.commonCauses],
    recoveryTemplate: entry.recoveryTemplate.map((r) => ({ ...r })),
  };
}

/**
 * Transform an AIDiscoveredElement into a CompactElement.
 * Truncates text to 200 chars, uses [x,y,w,h] bounds tuple.
 */
function toCompactElement(el: AIDiscoveredElement): CompactElement {
  const compact: CompactElement = {
    id: el.id,
    type: el.type,
    visible: el.state.visible,
    enabled: el.state.enabled,
    actions: el.actions,
  };
  if (el.label) compact.label = el.label;
  if (el.state.textContent) {
    compact.text =
      el.state.textContent.length > 200 ? el.state.textContent.slice(0, 200) : el.state.textContent;
  }
  if (el.state.value !== undefined) compact.value = el.state.value;
  if (el.semanticType) compact.semanticType = el.semanticType;
  if (el.state.rect) {
    compact.bounds = [el.state.rect.x, el.state.rect.y, el.state.rect.width, el.state.rect.height];
  }
  return compact;
}

/**
 * Build a ScreenAnalysis from a registry + snapshot manager + summary generator.
 * Shared between createHandlers and createAIHandlers.
 */
function buildScreenAnalysis(
  registry: RegistryLike,
  snapshotManager: { createSnapshot(cs: ControlSnapshot): SemanticSnapshot }
): ScreenAnalysis {
  const controlSnapshot = registry.createSnapshot();
  const semanticSnapshot = snapshotManager.createSnapshot(controlSnapshot);

  // Reuse ui-bridge's canonical summary — `snapshotManager.createSnapshot`
  // already ran `generatePageSummary` over §4.6-branded elements produced by
  // its OWN converter (label/description re-scrubbed by verdict). Re-deriving
  // it here from hand-built plain-string elements would launder `description`.
  const summary = semanticSnapshot.summary;

  // Transform elements into compact grouped format
  const interactive: CompactElement[] = [];
  const content: CompactElement[] = [];
  const media: CompactElement[] = [];

  for (const el of semanticSnapshot.elements) {
    const compact = toCompactElement(el);
    const category = el.category || 'content';
    if (category === 'interactive') {
      interactive.push(compact);
    } else if (category === 'media') {
      media.push(compact);
    } else {
      content.push(compact);
    }
  }

  const elements: GroupedElements = { interactive, content, media };

  // Page info — prefer semantic, fallback to control
  const page = {
    url: semanticSnapshot.page?.url || controlSnapshot.page?.url || '',
    title: semanticSnapshot.page?.title || controlSnapshot.page?.title || '',
    type: semanticSnapshot.page?.pageType,
  };

  // Viewport from control snapshot
  const viewport = controlSnapshot.viewport
    ? {
        width: controlSnapshot.viewport.viewportWidth,
        height: controlSnapshot.viewport.viewportHeight,
        scrollX: controlSnapshot.viewport.scrollX,
        scrollY: controlSnapshot.viewport.scrollY,
        canScrollDown: controlSnapshot.viewport.canScrollDown,
      }
    : undefined;

  // Modals from semantic snapshot
  const modals: CompactModal[] = semanticSnapshot.activeModals.map((m) => {
    const compact: CompactModal = {
      id: m.id,
      type: m.type,
      blocking: m.blocking,
    };
    if (m.title) compact.title = m.title;
    if (m.closeButton) compact.closeButton = m.closeButton;
    if (m.primaryAction) compact.primaryAction = m.primaryAction;
    return compact;
  });

  // Aggregate errors from forms + control snapshot errorSummary
  const validationErrors: string[] = [];
  for (const form of semanticSnapshot.forms) {
    for (const field of form.fields) {
      if (field.error) {
        validationErrors.push(`${field.label}: ${field.error}`);
      }
    }
  }
  const errorSummary = controlSnapshot.errorSummary;
  const errors: AggregatedErrors = {
    count: errorSummary?.errorCount ?? 0,
    health: errorSummary?.health ?? 'healthy',
    validationErrors,
    runtimeError: errorSummary?.mostRecentError?.message,
    hasErrorOverlay: (errorSummary?.errorOverlays?.length ?? 0) > 0,
  };

  // Toasts from control snapshot (CapturedToast typed via SnapshotToastContext)
  const toasts: CompactToast[] =
    controlSnapshot.toasts?.active.map((t) => {
      const compact: CompactToast = {
        id: t.id,
        message: t.message,
        dismissible: t.hasAction ?? false,
      };
      if (t.level) compact.level = t.level;
      return compact;
    }) ?? [];

  // Loading state
  const inFlightRequests = semanticSnapshot.networkActivity?.inFlightCount ?? 0;
  const activeWorkflows = controlSnapshot.activeRuns?.length ?? 0;
  const loading: LoadingState = {
    isLoading: inFlightRequests > 0 || activeWorkflows > 0,
    inFlightRequests,
    activeWorkflows,
  };

  return {
    page,
    viewport,
    summary,
    elements,
    forms: semanticSnapshot.forms,
    modals,
    errors,
    toasts,
    loading,
    focusedElement: semanticSnapshot.focusedElement,
    elementCounts: semanticSnapshot.elementCounts,
    timestamp: Date.now(),
  };
}

/**
 * Create server handlers for UI Bridge
 *
 * @param registry - The UI Bridge registry instance
 * @param actionExecutor - The action executor instance
 * @param config - Optional configuration
 * @returns Handler implementations for all endpoints
 *
 * @example
 * ```ts
 * import { createHandlers } from '@qontinui/ui-bridge-server';
 * import { getGlobalRegistry, createActionExecutor } from '@qontinui/ui-bridge';
 *
 * const registry = getGlobalRegistry();
 * const executor = createActionExecutor(registry);
 * const handlers = createHandlers(registry, executor);
 *
 * // Use with Express
 * const router = createExpressRouter(handlers);
 *
 * // Use with standalone server
 * const server = new StandaloneServer(handlers);
 * ```
 */
export function createHandlers(
  registry: RegistryLike,
  actionExecutor: ActionExecutorLike,
  config: CreateHandlersConfig = {}
): UIBridgeServerHandlers {
  // Create AI module instances
  const searchEngine = new SearchEngine();
  const nlExecutor = new NLActionExecutor();
  const assertionExecutor = new AssertionExecutor();
  const snapshotManager = new SemanticSnapshotManager();
  const diffManager = new SemanticDiffManager();

  // Helper to get fresh elements and update AI modules
  function refreshElements(): void {
    const elements = registry.getAllElements();
    searchEngine.updateElements(elements);
    nlExecutor.updateElements(elements);
    nlExecutor.setActionExecutor(actionExecutor as unknown as ActionExecutor);
    assertionExecutor.updateElements(elements);
  }

  return {
    // =========================================================================
    // Render Log Handlers
    // =========================================================================

    getRenderLog: async (query?: RenderLogQuery): Promise<APIResponse<RenderLogEntry[]>> => {
      try {
        const entries = registry.getRenderLog?.() ?? [];

        let filtered = entries;

        if (query?.type) {
          filtered = filtered.filter((e) => e.type === query.type);
        }
        if (query?.since) {
          filtered = filtered.filter((e) => e.timestamp >= query.since!);
        }
        if (query?.until) {
          filtered = filtered.filter((e) => e.timestamp <= query.until!);
        }
        if (query?.limit) {
          filtered = filtered.slice(0, query.limit);
        }

        return success(filtered);
      } catch (err) {
        return error((err as Error).message, 'RENDER_LOG_ERROR');
      }
    },

    clearRenderLog: async (): Promise<APIResponse<void>> => {
      try {
        registry.clearRenderLog?.();
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'RENDER_LOG_ERROR');
      }
    },

    captureSnapshot: async (): Promise<APIResponse<unknown>> => {
      try {
        const snapshot = registry.captureSnapshot?.();
        return success(snapshot);
      } catch (err) {
        return error((err as Error).message, 'SNAPSHOT_ERROR');
      }
    },

    getRenderLogPath: async (): Promise<APIResponse<{ path: string }>> => {
      return success({ path: config.renderLogPath || '' });
    },

    // =========================================================================
    // Element Handlers
    // =========================================================================

    getElements: async (): Promise<APIResponse<ControlSnapshot['elements']>> => {
      try {
        const elements = registry.getAllElements();
        return success(elements as unknown as ControlSnapshot['elements']);
      } catch (err) {
        return error((err as Error).message, 'ELEMENTS_ERROR');
      }
    },

    getElement: async (id: string): Promise<APIResponse<ControlSnapshot['elements'][0]>> => {
      try {
        const element = registry.getElement(id);
        if (!element) {
          const failureDetails = createFailureDetails(
            'UB-ELEM-NOT-FOUND',
            `Element not found: ${id}`,
            {
              elementId: id,
              selectorsTried: [id],
            }
          );
          return {
            success: false,
            error: `Element not found: ${id}`,
            code: 'UB-ELEM-NOT-FOUND',
            data: { failureDetails } as unknown as ControlSnapshot['elements'][0],
            timestamp: Date.now(),
          };
        }
        return success(element as unknown as ControlSnapshot['elements'][0]);
      } catch (err) {
        return error((err as Error).message, 'ELEMENT_ERROR');
      }
    },

    getElementState: async (id: string): Promise<APIResponse<unknown>> => {
      try {
        const element = registry.getElement(id) as { state?: unknown } | undefined;
        if (!element) {
          return error(`Element not found: ${id}`, 'NOT_FOUND');
        }
        return success(element.state);
      } catch (err) {
        return error((err as Error).message, 'ELEMENT_STATE_ERROR');
      }
    },

    executeElementAction: async (
      id: string,
      request: { action: string; params?: Record<string, unknown>; waitOptions?: unknown }
    ): Promise<APIResponse<ControlActionResponse>> => {
      const startTime = Date.now();
      try {
        // Check if element exists first
        const element = registry.getElement(id);
        if (!element) {
          const failureDetails = createFailureDetails(
            'UB-ELEM-NOT-FOUND',
            `Element not found: ${id}`,
            {
              elementId: id,
              selectorsTried: [id],
              durationMs: Date.now() - startTime,
            }
          );
          return {
            success: false,
            error: `Element not found: ${id}`,
            code: 'UB-ELEM-NOT-FOUND',
            data: {
              failureDetails,
              durationMs: Date.now() - startTime,
            },
            timestamp: Date.now(),
          } as APIResponse<ControlActionResponse>;
        }

        const result = await actionExecutor.executeAction(id, {
          action: request.action,
          params: request.params,
          waitOptions: request.waitOptions,
        });

        // If the action executor returned a failure, enhance with structured details
        if (result && typeof result === 'object' && 'success' in result && !result.success) {
          const actionResult = result as {
            success: boolean;
            error?: string;
            elementState?: unknown;
          };
          // Determine error code based on error message
          let errorCode: UiBridgeErrorCode = 'UB-UNKNOWN-ERROR';
          const errorMsg = actionResult.error?.toLowerCase() || '';

          if (errorMsg.includes('not found')) {
            errorCode = 'UB-ELEM-NOT-FOUND';
          } else if (errorMsg.includes('not visible') || errorMsg.includes('hidden')) {
            errorCode = 'UB-ELEM-NOT-VISIBLE';
          } else if (errorMsg.includes('disabled') || errorMsg.includes('not enabled')) {
            errorCode = 'UB-ELEM-NOT-ENABLED';
          } else if (errorMsg.includes('timeout')) {
            errorCode = 'UB-ACTION-TIMEOUT';
          } else if (errorMsg.includes('blocked') || errorMsg.includes('interactable')) {
            errorCode = 'UB-ELEM-NOT-INTERACTABLE';
          }

          const failureDetails = createFailureDetails(
            errorCode,
            actionResult.error || 'Action failed',
            {
              elementId: id,
              durationMs: Date.now() - startTime,
            }
          );

          // Return a proper failure envelope — don't wrap in success() which
          // creates double-wrapping: {success: true, data: {success: false}}
          return {
            success: false,
            error: actionResult.error || 'Action failed',
            code: errorCode,
            data: { ...actionResult, failureDetails },
            timestamp: Date.now(),
          } as APIResponse<ControlActionResponse>;
        }

        return success(result) as APIResponse<ControlActionResponse>;
      } catch (err) {
        const errorMessage = (err as Error).message;
        let errorCode: UiBridgeErrorCode = 'UB-UNKNOWN-ERROR';

        if (errorMessage.includes('not found')) {
          errorCode = 'UB-ELEM-NOT-FOUND';
        } else if (errorMessage.includes('timeout')) {
          errorCode = 'UB-ACTION-TIMEOUT';
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          errorCode = 'UB-NET-ERROR';
        }

        const failureDetails = createFailureDetails(errorCode, errorMessage, {
          elementId: id,
          durationMs: Date.now() - startTime,
        });

        return {
          success: false,
          error: errorMessage,
          code: errorCode,
          data: {
            failureDetails,
            durationMs: Date.now() - startTime,
          },
          timestamp: Date.now(),
        } as APIResponse<ControlActionResponse>;
      }
    },

    // =========================================================================
    // Component Handlers
    // =========================================================================

    getComponents: async (): Promise<APIResponse<ControlSnapshot['components']>> => {
      try {
        const components = registry.getAllComponents();
        return success(components as ControlSnapshot['components']);
      } catch (err) {
        return error((err as Error).message, 'COMPONENTS_ERROR');
      }
    },

    getComponent: async (id: string): Promise<APIResponse<ControlSnapshot['components'][0]>> => {
      try {
        const component = registry.getComponent(id);
        if (!component) {
          return error(`Component not found: ${id}`, 'NOT_FOUND');
        }
        return success(component as ControlSnapshot['components'][0]);
      } catch (err) {
        return error((err as Error).message, 'COMPONENT_ERROR');
      }
    },

    getComponentState: async (
      id: string
    ): Promise<
      APIResponse<{
        state: Record<string, unknown>;
        computed: Record<string, unknown>;
        timestamp: number;
      }>
    > => {
      try {
        // First check if the component exists
        const component = registry.getComponent(id);
        if (!component) {
          return error(`Component not found: ${id}`, 'NOT_FOUND');
        }

        // Use registry's getComponentState if available
        if (registry.getComponentState) {
          const stateResponse = registry.getComponentState(id);
          if (!stateResponse) {
            return error(`Component not found or not mounted: ${id}`, 'NOT_FOUND');
          }
          return success(stateResponse);
        }

        // Fallback: component exists but doesn't expose state
        const comp = component as {
          getState?: () => Record<string, unknown>;
          getComputed?: () => Record<string, unknown>;
        };
        return success({
          state: comp.getState?.() ?? {},
          computed: comp.getComputed?.() ?? {},
          timestamp: Date.now(),
        });
      } catch (err) {
        return error((err as Error).message, 'COMPONENT_STATE_ERROR');
      }
    },

    executeComponentAction: async (
      id: string,
      request: { action: string; params?: Record<string, unknown> }
    ): Promise<APIResponse<ComponentActionResponse>> => {
      try {
        const result = await actionExecutor.executeComponentAction(id, {
          action: request.action,
          params: request.params,
        });
        return success(result) as APIResponse<ComponentActionResponse>;
      } catch (err) {
        return error((err as Error).message, 'COMPONENT_ACTION_ERROR');
      }
    },

    // =========================================================================
    // Find/Discovery Handlers
    // =========================================================================

    find: async (request?: unknown): Promise<APIResponse<FindResponse>> => {
      try {
        // Use actionExecutor.find() when available — it supports text, role,
        // and other filters that registry.findElements() doesn't handle
        if (actionExecutor.find) {
          const result = await actionExecutor.find(request);
          return success(result) as APIResponse<FindResponse>;
        }
        // Fallback to registry
        const findRequest = request as
          | { types?: string[]; selector?: string; limit?: number }
          | undefined;
        const elements = registry.findElements?.(findRequest) ?? registry.getAllElements();
        return success({
          elements,
          timestamp: Date.now(),
          total: (elements as unknown[]).length,
          durationMs: 0,
        }) as APIResponse<FindResponse>;
      } catch (err) {
        return error((err as Error).message, 'FIND_ERROR');
      }
    },

    discover: async (request?: unknown): Promise<APIResponse<FindResponse>> => {
      try {
        // Use actionExecutor.find() when available for proper filtering
        if (actionExecutor.find) {
          const result = await actionExecutor.find(request);
          return success(result) as APIResponse<FindResponse>;
        }
        // Fallback to registry
        const findRequest = request as
          | { types?: string[]; selector?: string; limit?: number }
          | undefined;
        const elements = registry.findElements?.(findRequest) ?? registry.getAllElements();
        return success({
          elements,
          timestamp: Date.now(),
          total: (elements as unknown[]).length,
          durationMs: 0,
        }) as APIResponse<FindResponse>;
      } catch (err) {
        return error((err as Error).message, 'DISCOVER_ERROR');
      }
    },

    getControlSnapshot: async (): Promise<APIResponse<ControlSnapshot>> => {
      try {
        const snapshot = registry.createSnapshot();
        return success(snapshot);
      } catch (err) {
        return error((err as Error).message, 'SNAPSHOT_ERROR');
      }
    },

    // =========================================================================
    // Workflow Handlers
    // =========================================================================

    getWorkflows: async (): Promise<APIResponse<ControlSnapshot['workflows']>> => {
      try {
        const workflows = registry.getAllWorkflows?.() ?? [];
        return success(workflows as ControlSnapshot['workflows']);
      } catch (err) {
        return error((err as Error).message, 'WORKFLOWS_ERROR');
      }
    },

    runWorkflow: async (id: string, request?: unknown): Promise<APIResponse<WorkflowRunResponse>> => {
      try {
        const runnerPort = process.env['QONTINUI_PORT'] ?? '9876';
        const runnerUrl = `http://localhost:${runnerPort}`;
        let response: Response;
        try {
          response = await fetch(
            `${runnerUrl}/api/unified-workflows/${encodeURIComponent(id)}/run`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(request ?? {}),
            }
          );
        } catch (fetchErr) {
          return error<WorkflowRunResponse>(
            `Failed to reach runner at ${runnerUrl}: ${(fetchErr as Error).message}`,
            'RUNNER_UNAVAILABLE'
          );
        }
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          return error<WorkflowRunResponse>(
            `Runner returned ${response.status}: ${body}`,
            'RUNNER_ERROR'
          );
        }
        const data = (await response.json()) as unknown;
        return success(data) as APIResponse<WorkflowRunResponse>;
      } catch (err) {
        return error((err as Error).message, 'WORKFLOW_ERROR');
      }
    },

    getWorkflowStatus: async (runId: string): Promise<APIResponse<WorkflowRunResponse>> => {
      try {
        const runnerPort = process.env['QONTINUI_PORT'] ?? '9876';
        const runnerUrl = `http://localhost:${runnerPort}`;
        let response: Response;
        try {
          response = await fetch(`${runnerUrl}/api/task-runs/${encodeURIComponent(runId)}`);
        } catch (fetchErr) {
          return error<WorkflowRunResponse>(
            `Failed to reach runner at ${runnerUrl}: ${(fetchErr as Error).message}`,
            'RUNNER_UNAVAILABLE'
          );
        }
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          return error<WorkflowRunResponse>(
            `Runner returned ${response.status}: ${body}`,
            'RUNNER_ERROR'
          );
        }
        const data = (await response.json()) as unknown;
        return success(data) as APIResponse<WorkflowRunResponse>;
      } catch (err) {
        return error((err as Error).message, 'WORKFLOW_STATUS_ERROR');
      }
    },

    // =========================================================================
    // Debug Handlers
    // =========================================================================

    getActionHistory: async (limit?: number): Promise<APIResponse<unknown[]>> => {
      try {
        const history = registry.getActionHistory?.() ?? [];
        const limited = limit ? history.slice(-limit) : history;
        return success(limited);
      } catch (err) {
        return error((err as Error).message, 'ACTION_HISTORY_ERROR');
      }
    },

    getMetrics: async (): Promise<APIResponse<unknown>> => {
      try {
        const metrics = registry.getMetrics?.() ?? {
          elementCount: registry.getAllElements().length,
          componentCount: registry.getAllComponents().length,
        };
        return success(metrics);
      } catch (err) {
        return error((err as Error).message, 'METRICS_ERROR');
      }
    },

    highlightElement: async (id: string): Promise<APIResponse<void>> => {
      try {
        registry.highlightElement?.(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'HIGHLIGHT_ERROR');
      }
    },

    getElementTree: async (): Promise<APIResponse<unknown>> => {
      try {
        const tree = registry.getElementTree?.() ?? { root: null, elements: [] };
        return success(tree);
      } catch (err) {
        return error((err as Error).message, 'ELEMENT_TREE_ERROR');
      }
    },

    // =========================================================================
    // AI-Native Handlers
    // =========================================================================

    aiSearch: async (criteria: SearchCriteria): Promise<APIResponse<SearchResponse>> => {
      try {
        // Refresh elements before search
        refreshElements();
        const response = searchEngine.search(criteria);
        return success(response);
      } catch (err) {
        return error((err as Error).message, 'AI_SEARCH_ERROR');
      }
    },

    aiExecute: async (request: NLActionRequest): Promise<APIResponse<NLActionResponse>> => {
      try {
        // Refresh elements before execution
        refreshElements();
        const response = await nlExecutor.execute(request);
        return success(response);
      } catch (err) {
        return error((err as Error).message, 'AI_EXECUTE_ERROR');
      }
    },

    aiAssert: async (request: AssertionRequest): Promise<APIResponse<AssertionResult>> => {
      try {
        // Refresh elements before assertion
        refreshElements();
        const result = await assertionExecutor.assert(request);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'AI_ASSERT_ERROR');
      }
    },

    aiAssertBatch: async (
      request: BatchAssertionRequest
    ): Promise<APIResponse<BatchAssertionResult>> => {
      try {
        // Refresh elements before batch assertion
        refreshElements();
        const result = await assertionExecutor.assertBatch(request);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'AI_ASSERT_BATCH_ERROR');
      }
    },

    getSemanticSnapshot: async (): Promise<APIResponse<SemanticSnapshot>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        return success(snapshot);
      } catch (err) {
        return error((err as Error).message, 'SEMANTIC_SNAPSHOT_ERROR');
      }
    },

    getSemanticDiff: async (_since?: number): Promise<APIResponse<SemanticDiff | null>> => {
      try {
        // Create current snapshot
        const controlSnapshot = registry.createSnapshot();
        const currentSnapshot = snapshotManager.createSnapshot(controlSnapshot);

        // Update the diff manager and get the diff from previous state
        const diff = diffManager.update(currentSnapshot);
        return success(diff);
      } catch (err) {
        return error((err as Error).message, 'SEMANTIC_DIFF_ERROR');
      }
    },

    getPageSummary: async (): Promise<APIResponse<string>> => {
      try {
        // Use ui-bridge's canonical §4.6-branded summary rather than
        // re-deriving it from hand-built plain-string elements (which would
        // launder `description`). `createSnapshot` runs `generatePageSummary`
        // internally over elements branded by its own converter.
        const summary = snapshotManager.createSnapshot(registry.createSnapshot()).summary;
        return success(summary);
      } catch (err) {
        return error((err as Error).message, 'PAGE_SUMMARY_ERROR');
      }
    },

    getScreenAnalysis: async (): Promise<APIResponse<ScreenAnalysis>> => {
      try {
        const analysis = buildScreenAnalysis(registry, snapshotManager);
        return success(analysis);
      } catch (err) {
        return error((err as Error).message, 'SCREEN_ANALYSIS_ERROR');
      }
    },

    // =========================================================================
    // Semantic Search Handler (Embedding-based)
    // =========================================================================

    aiSemanticSearch: async (
      criteria: SemanticSearchCriteria
    ): Promise<APIResponse<SemanticSearchResponse>> => {
      const startTime = performance.now();
      try {
        // Refresh elements for search
        refreshElements();

        // Build a semantic snapshot: its `.elements` are converted to
        // AIDiscoveredElement by ui-bridge's OWN converter, which applies the
        // §4.6 brand (label/description re-scrubbed by verdict). Searching over
        // these already-branded, already-scrubbed elements — rather than
        // hand-building AIDiscoveredElement-shaped objects from raw registry
        // reads — is what keeps `element` (re-emitted to the client in
        // SemanticSearchResult) honestly branded instead of laundering a
        // plain-string `description`.
        const semanticSnapshot = snapshotManager.createSnapshot(registry.createSnapshot());

        // Build searchable text per branded element for the fuzzy fallback.
        // All fields read here are already §4.6-scrubbed at their source.
        const aiElements: Array<{ element: AIDiscoveredElement; text: string }> =
          semanticSnapshot.elements.map((element) => {
            const textParts: string[] = [];
            const label = element.label ?? '';
            const accessibleName = element.accessibleName ?? '';
            const textContent = element.state?.textContent ?? '';
            const placeholder = element.placeholder ?? '';
            const title = element.title ?? '';

            if (label) textParts.push(label);
            if (accessibleName && accessibleName !== label) textParts.push(accessibleName);
            if (textContent && textContent !== label && textContent !== accessibleName) {
              textParts.push(textContent);
            }
            if (placeholder) textParts.push(`placeholder: ${placeholder}`);
            if (title) textParts.push(title);

            const combinedText = textParts.join(' ').trim() || element.id;

            return { element, text: combinedText };
          });

        // Apply type/role filters if specified
        let filteredElements = aiElements;
        if (criteria.type) {
          filteredElements = filteredElements.filter(
            ({ element }) => element.type.toLowerCase() === criteria.type!.toLowerCase()
          );
        }
        if (criteria.role) {
          filteredElements = filteredElements.filter(
            ({ element }) => element.role?.toLowerCase() === criteria.role!.toLowerCase()
          );
        }

        // NOTE: Semantic search with embeddings requires server-side embedding support.
        // This handler provides the API structure. Actual embedding computation
        // should be delegated to the qontinui library or a separate embedding service.
        //
        // For now, we fall back to fuzzy text matching as a placeholder.
        // In production, this would call the qontinui embeddings module.

        const query = criteria.query.toLowerCase();
        const threshold = criteria.threshold ?? 0.5;
        const limit = criteria.limit ?? 10;

        // Simple text similarity as fallback (to be replaced with embedding similarity)
        const scoredResults: SemanticSearchResult[] = filteredElements.map(({ element, text }) => {
          // Calculate basic text similarity
          const textLower = text.toLowerCase();
          let similarity = 0;

          // Exact match
          if (textLower.includes(query)) {
            similarity = 0.9;
          } else {
            // Word overlap similarity
            const queryWords = new Set(query.split(/\s+/).filter((w) => w.length > 2));
            const textWords = new Set(textLower.split(/\s+/).filter((w) => w.length > 2));

            if (queryWords.size > 0 && textWords.size > 0) {
              let matchCount = 0;
              for (const word of queryWords) {
                for (const textWord of textWords) {
                  if (textWord.includes(word) || word.includes(textWord)) {
                    matchCount++;
                    break;
                  }
                }
              }
              similarity = (matchCount / queryWords.size) * 0.7;
            }
          }

          return {
            element,
            similarity,
            rank: 0, // Will be set after sorting
            embeddedText: text,
          };
        });

        // Filter by threshold and sort by similarity
        const filteredResults = scoredResults
          .filter((r) => r.similarity >= threshold)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);

        // Set ranks
        filteredResults.forEach((result, index) => {
          result.rank = index + 1;
        });

        const response: SemanticSearchResponse = {
          results: filteredResults,
          bestMatch: filteredResults.length > 0 ? filteredResults[0] : null,
          scannedCount: filteredElements.length,
          durationMs: performance.now() - startTime,
          query: criteria.query,
          providerInfo: {
            provider: 'text-fallback',
            model: 'simple-similarity',
            dimension: 0,
          },
          timestamp: Date.now(),
        };

        return success(response);
      } catch (err) {
        return error((err as Error).message, 'AI_SEMANTIC_SEARCH_ERROR');
      }
    },

    getPerformanceEntries: async (): Promise<APIResponse<unknown>> => {
      return {
        success: true,
        data: { navigation: null, resources: [], paint: [] },
        timestamp: Date.now(),
      };
    },

    clearPerformanceEntries: async (): Promise<APIResponse<{ cleared: boolean }>> => {
      return { success: true, data: { cleared: true }, timestamp: Date.now() };
    },

    getBrowserEvents: async (_params?: {
      type?: string;
      since?: number;
      limit?: number;
    }): Promise<APIResponse<{ events: unknown[]; count: number }>> => {
      return { success: true, data: { events: [], count: 0 }, timestamp: Date.now() };
    },

    getElementHistory: async (
      elementId: string,
      options?: ElementHistoryOptions
    ): Promise<APIResponse<ElementLogEntry[]>> => {
      try {
        const entries = registry.getElementHistory?.(elementId, options) ?? [];
        return success(entries);
      } catch (err) {
        return error((err as Error).message, 'ELEMENT_HISTORY_ERROR');
      }
    },

    // Page health diagnostics
    pageHealth: async (): Promise<APIResponse<PageHealthReport>> => {
      try {
        // Get elements via discover/find (uses the same path as the discover handler)
        let elements: DiscoveredElement[];
        if (actionExecutor.find) {
          const result = (await actionExecutor.find()) as { elements: DiscoveredElement[] };
          elements = result.elements ?? [];
        } else {
          elements = (registry.findElements?.() ??
            registry.getAllElements()) as DiscoveredElement[];
        }

        const report = diagnosePageHealth(elements);
        return { success: true, data: report, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: mapInternalErrorCode('PAGE_HEALTH_ERROR', (err as Error).message),
          timestamp: Date.now(),
        };
      }
    },

    query: async (request: {
      selector: string;
      limit?: number;
      includeState?: boolean;
    }): Promise<APIResponse<{ elements: unknown[]; count: number }>> => {
      try {
        refreshElements();
        const allElements =
          registry.findElements?.({ selector: request.selector }) ?? registry.getAllElements();
        const elements = request.limit
          ? (allElements as unknown[]).slice(0, request.limit)
          : (allElements as unknown[]);
        return success({ elements, count: elements.length });
      } catch (err) {
        return error<{ elements: unknown[]; count: number }>((err as Error).message, 'QUERY_ERROR');
      }
    },

    waitForElement: async (request: {
      selector?: string;
      elementId?: string;
      timeout?: number;
      pollInterval?: number;
    }): Promise<APIResponse<{ found: boolean; element?: unknown; waitedMs: number }>> => {
      const timeout = request.timeout ?? 5000;
      const pollInterval = request.pollInterval ?? 200;
      const start = Date.now();
      try {
        while (Date.now() - start < timeout) {
          refreshElements();
          if (request.elementId) {
            const el = registry.getElement(request.elementId);
            if (el) return success({ found: true, element: el, waitedMs: Date.now() - start });
          } else if (request.selector) {
            const found = registry.findElements?.({ selector: request.selector });
            if (found && (found as unknown[]).length > 0) {
              return success({
                found: true,
                element: (found as unknown[])[0],
                waitedMs: Date.now() - start,
              });
            }
          }
          await new Promise((r) => setTimeout(r, pollInterval));
        }
        return success({ found: false, waitedMs: Date.now() - start });
      } catch (err) {
        return error<{ found: boolean; element?: unknown; waitedMs: number }>(
          (err as Error).message,
          'WAIT_ERROR'
        );
      }
    },

    // App-agnostic convenience endpoints (stubs — browser context required)
    clickByText: async (): Promise<APIResponse<{ clicked: boolean; element?: unknown }>> => {
      return {
        success: false,
        error: 'clickByText requires browser context',
        code: 'UB-UNSUPPORTED-ACTION',
        timestamp: Date.now(),
      };
    },
    clickBySelector: async (): Promise<APIResponse<{ clicked: boolean; element?: unknown }>> => {
      return {
        success: false,
        error: 'clickBySelector requires browser context',
        code: 'UB-UNSUPPORTED-ACTION',
        timestamp: Date.now(),
      };
    },
    typeInto: async (): Promise<APIResponse<{ typed: boolean; element?: unknown }>> => {
      return {
        success: false,
        error: 'typeInto requires browser context',
        code: 'UB-UNSUPPORTED-ACTION',
        timestamp: Date.now(),
      };
    },
    readValue: async (): Promise<APIResponse<{ value: string | null; length: number }>> => {
      return {
        success: false,
        error: 'readValue requires browser context',
        code: 'UB-UNSUPPORTED-ACTION',
        timestamp: Date.now(),
      };
    },
    findByText: async (): Promise<
      APIResponse<
        Array<{
          index: number;
          tag: string;
          text: string;
          rect: { x: number; y: number; width: number; height: number };
          disabled: boolean;
          visible: boolean;
        }>
      >
    > => {
      return {
        success: false,
        error: 'findByText requires browser context',
        code: 'UB-UNSUPPORTED-ACTION',
        timestamp: Date.now(),
      };
    },

    // Diagnostics
    getDiagnostics: async () => {
      const registeredCount = registry.getAllElements().length;
      return success({
        sdk_initialized: true,
        auto_register_active: false,
        registered_elements: registeredCount,
        dom_interactive_elements: 0,
        mutation_observer_active: false,
        navigation_adapter: 'none',
        page_title: '',
        page_url: '',
        page_ready: true,
        providers_mounted: [],
        last_discover_at: null,
        capabilities: ['control', 'find', 'ai'],
      });
    },

    // Diagnostic catalog (plan Phase 2). Read-only; backed by the single
    // source `diagnostics/codes.json` via the generated catalog. The raw
    // entry shape mirrors a `codes.json` entry exactly: { code, category,
    // description, commonCauses, recoveryTemplate }.
    getDiagnosticsCatalog: async () => {
      const codes = UI_BRIDGE_ERROR_CODES.map((code) => catalogEntry(code));
      return success({ codes, count: codes.length });
    },
    getDiagnosticCode: async (code: string) => {
      if (!(code in DIAGNOSTICS)) {
        // Unknown code → 404-shaped APIResponse with a canonical
        // UiBridgeErrorCode (reuse Phase 1's error() / mapper path).
        return error(
          `Unknown diagnostic code: ${code}. ` +
            `See GET /diagnostics/catalog for the full catalog.`,
          'NOT_FOUND'
        );
      }
      return success(catalogEntry(code as UiBridgeErrorCode));
    },

    // Navigation adapter (stubs)
    getRoutes: async (): Promise<APIResponse<Array<{ name: string; path: string }>>> => {
      return success<Array<{ name: string; path: string }>>([]);
    },
    navigateByAdapter: async (): Promise<
      APIResponse<{ navigated: boolean; route: { name: string; path: string } }>
    > => {
      return {
        success: false,
        error: 'navigateByAdapter requires browser context',
        code: 'UB-UNSUPPORTED-ACTION',
        timestamp: Date.now(),
      };
    },
  };
}

/**
 * Create partial handlers for AI-specific functionality only
 *
 * Use this when you want to add AI endpoints to an existing handler setup.
 */
export function createAIHandlers(
  registry: RegistryLike,
  actionExecutor: ActionExecutorLike
): Pick<
  UIBridgeServerHandlers,
  | 'aiSearch'
  | 'aiExecute'
  | 'aiAssert'
  | 'aiAssertBatch'
  | 'getSemanticSnapshot'
  | 'getSemanticDiff'
  | 'getPageSummary'
  | 'getScreenAnalysis'
  | 'getPerformanceEntries'
  | 'clearPerformanceEntries'
  | 'getBrowserEvents'
> {
  const searchEngine = new SearchEngine();
  const nlExecutor = new NLActionExecutor();
  const assertionExecutor = new AssertionExecutor();
  const snapshotManager = new SemanticSnapshotManager();
  const diffManager = new SemanticDiffManager();

  function refreshElements(): void {
    const elements = registry.getAllElements();
    searchEngine.updateElements(elements);
    nlExecutor.updateElements(elements);
    nlExecutor.setActionExecutor(actionExecutor as unknown as ActionExecutor);
    assertionExecutor.updateElements(elements);
  }

  return {
    aiSearch: async (criteria: SearchCriteria): Promise<APIResponse<SearchResponse>> => {
      try {
        refreshElements();
        const response = searchEngine.search(criteria);
        return { success: true, data: response, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: mapInternalErrorCode('AI_SEARCH_ERROR', (err as Error).message),
          timestamp: Date.now(),
        };
      }
    },

    aiExecute: async (request: NLActionRequest): Promise<APIResponse<NLActionResponse>> => {
      try {
        refreshElements();
        const response = await nlExecutor.execute(request);
        return { success: true, data: response, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: mapInternalErrorCode('AI_EXECUTE_ERROR', (err as Error).message),
          timestamp: Date.now(),
        };
      }
    },

    aiAssert: async (request: AssertionRequest): Promise<APIResponse<AssertionResult>> => {
      try {
        refreshElements();
        const result = await assertionExecutor.assert(request);
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: mapInternalErrorCode('AI_ASSERT_ERROR', (err as Error).message),
          timestamp: Date.now(),
        };
      }
    },

    aiAssertBatch: async (
      request: BatchAssertionRequest
    ): Promise<APIResponse<BatchAssertionResult>> => {
      try {
        refreshElements();
        const result = await assertionExecutor.assertBatch(request);
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: mapInternalErrorCode('AI_ASSERT_BATCH_ERROR', (err as Error).message),
          timestamp: Date.now(),
        };
      }
    },

    getSemanticSnapshot: async (): Promise<APIResponse<SemanticSnapshot>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        return { success: true, data: snapshot, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: mapInternalErrorCode('SEMANTIC_SNAPSHOT_ERROR', (err as Error).message),
          timestamp: Date.now(),
        };
      }
    },

    getSemanticDiff: async (_since?: number): Promise<APIResponse<SemanticDiff | null>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const currentSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        const diff = diffManager.update(currentSnapshot);
        return { success: true, data: diff, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: mapInternalErrorCode('SEMANTIC_DIFF_ERROR', (err as Error).message),
          timestamp: Date.now(),
        };
      }
    },

    getPageSummary: async (): Promise<APIResponse<string>> => {
      try {
        // Use ui-bridge's canonical §4.6-branded summary rather than
        // re-deriving it from hand-built plain-string elements (which would
        // launder `description`). `createSnapshot` runs `generatePageSummary`
        // internally over elements branded by its own converter.
        const summary = snapshotManager.createSnapshot(registry.createSnapshot()).summary;
        return { success: true, data: summary, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: mapInternalErrorCode('PAGE_SUMMARY_ERROR', (err as Error).message),
          timestamp: Date.now(),
        };
      }
    },

    getScreenAnalysis: async (): Promise<APIResponse<ScreenAnalysis>> => {
      try {
        const analysis = buildScreenAnalysis(registry, snapshotManager);
        return { success: true, data: analysis, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: mapInternalErrorCode('SCREEN_ANALYSIS_ERROR', (err as Error).message),
          timestamp: Date.now(),
        };
      }
    },

    // Performance diagnostics (browser-only; SDK handler returns empty defaults)
    getPerformanceEntries: async (): Promise<APIResponse<unknown>> => {
      return {
        success: true,
        data: { navigation: null, resources: [], paint: [] },
        timestamp: Date.now(),
      };
    },
    clearPerformanceEntries: async (): Promise<APIResponse<{ cleared: boolean }>> => {
      return { success: true, data: { cleared: true }, timestamp: Date.now() };
    },
    getBrowserEvents: async (_params?: {
      type?: string;
      since?: number;
      limit?: number;
    }): Promise<APIResponse<{ events: unknown[]; count: number }>> => {
      return { success: true, data: { events: [], count: 0 }, timestamp: Date.now() };
    },
  };
}
