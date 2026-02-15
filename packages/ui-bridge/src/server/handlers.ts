/**
 * UI Bridge Server Handlers
 *
 * Factory function to create handler implementations for all UI Bridge endpoints.
 */

import type { UIBridgeServerHandlers, APIResponse, RenderLogQuery } from './types';
import type { ControlSnapshot, PageNavigateRequest, PageNavigationResponse } from '../control';
import type { RenderLogEntry } from '../render-log';
import type { ActionFailureDetails, ActionErrorCode } from '../core';
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
  Intent,
  IntentSearchResponse,
  IntentExecutionResult,
  RecoveryAttemptRequest,
  RecoveryAttemptResult,
  PageDataMap,
  PageRegionMap,
  StructuredDataExtraction,
  CrossAppComparisonReport,
  ComponentInfo,
} from '../ai';
import type {
  UIState,
  UIStateGroup,
  UITransition,
  PathResult,
  TransitionResult,
  NavigationResult,
  StateSnapshot,
} from '../core';
import {
  SearchEngine,
  NLActionExecutor,
  AssertionExecutor,
  SemanticSnapshotManager,
  SemanticDiffManager,
  generatePageSummary,
  extractPageData,
  segmentPageRegions,
  extractStructuredData,
  generateComparisonReport,
} from '../ai';
import type { ElementAnnotation, AnnotationConfig, AnnotationCoverage } from '../annotations';
import { AnnotationStore, getGlobalAnnotationStore } from '../annotations';
import type { CapturedError } from '../debug/browser-capture-types';

/**
 * Registry interface - minimal contract for handler usage
 */
export interface RegistryLike {
  getAllElements(): unknown[];
  getElement(id: string): unknown | undefined;
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

  // State management
  getStates?(): UIState[];
  getState?(id: string): UIState | undefined;
  getActiveStates?(): UIState[];
  activateState?(id: string): void;
  deactivateState?(id: string): void;
  getStateGroups?(): UIStateGroup[];
  activateStateGroup?(id: string): void;
  deactivateStateGroup?(id: string): void;
  getTransitions?(): UITransition[];
  canExecuteTransition?(id: string): { canExecute: boolean; reason?: string };
  executeTransition?(id: string): Promise<TransitionResult>;
  findPath?(targetStates: string[]): PathResult;
  navigateTo?(targetStates: string[]): Promise<NavigationResult>;
  getStateSnapshot?(): StateSnapshot;
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
}

/**
 * Console capture interface — minimal contract for handler usage
 */
export interface ConsoleCapturelike {
  getConsoleSince(ts: number): CapturedError[];
  getConsoleRecent(n?: number): CapturedError[];
  clear(): void;
}

/**
 * Configuration for creating handlers
 */
export interface CreateHandlersConfig {
  /** Optional render log path */
  renderLogPath?: string;
  /** Verbose logging */
  verbose?: boolean;
  /** Optional annotation store (defaults to global singleton) */
  annotationStore?: AnnotationStore;
  /** Optional console capture instance for error monitoring */
  consoleCapture?: ConsoleCapturelike;
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
 * Create an error response
 */
function error<T = unknown>(message: string, code?: string): APIResponse<T> {
  return {
    success: false,
    error: message,
    code,
    timestamp: Date.now(),
  };
}

/**
 * Generate recovery suggestions based on error code
 */
function getRecoverySuggestions(errorCode: ActionErrorCode): Array<{
  suggestion: string;
  command?: string;
  confidence: number;
  retryable: boolean;
}> {
  switch (errorCode) {
    case 'ELEMENT_NOT_FOUND':
      return [
        {
          suggestion: 'Wait for the page to fully load',
          command: 'wait for page to load',
          confidence: 0.7,
          retryable: true,
        },
        {
          suggestion: 'Use a different description for the element',
          confidence: 0.8,
          retryable: false,
        },
        {
          suggestion: 'Scroll the page to reveal the element',
          command: 'scroll down',
          confidence: 0.6,
          retryable: true,
        },
      ];
    case 'ELEMENT_NOT_VISIBLE':
      return [
        {
          suggestion: 'Scroll to make the element visible',
          command: 'scroll to element',
          confidence: 0.9,
          retryable: true,
        },
        {
          suggestion: 'Wait for any loading overlays to disappear',
          confidence: 0.7,
          retryable: true,
        },
        {
          suggestion: 'Close any blocking modals or popups',
          command: 'click close button',
          confidence: 0.8,
          retryable: true,
        },
      ];
    case 'ELEMENT_NOT_ENABLED':
      return [
        { suggestion: 'Fill in required fields first', confidence: 0.8, retryable: false },
        {
          suggestion: 'Complete prerequisite steps in the form',
          confidence: 0.7,
          retryable: false,
        },
        {
          suggestion: 'Wait for the element to become enabled',
          command: 'wait for element to be enabled',
          confidence: 0.6,
          retryable: true,
        },
      ];
    case 'ELEMENT_NOT_INTERACTABLE':
      return [
        {
          suggestion: 'Close any modal or popup blocking the element',
          command: 'click close button',
          confidence: 0.9,
          retryable: true,
        },
        { suggestion: 'Wait for animations to complete', confidence: 0.7, retryable: true },
        {
          suggestion: 'Scroll the element into the viewport',
          command: 'scroll to element',
          confidence: 0.8,
          retryable: true,
        },
      ];
    case 'ACTION_TIMEOUT':
      return [
        { suggestion: 'Increase the timeout duration', confidence: 0.8, retryable: true },
        { suggestion: 'Check if the condition can ever be met', confidence: 0.7, retryable: false },
        {
          suggestion: 'Verify the page is responding',
          command: 'check page status',
          confidence: 0.6,
          retryable: true,
        },
      ];
    case 'LOW_CONFIDENCE':
      return [
        {
          suggestion: 'Use the exact text shown on the element',
          confidence: 0.9,
          retryable: false,
        },
        {
          suggestion: 'Try a different description that more closely matches the element',
          confidence: 0.8,
          retryable: false,
        },
        {
          suggestion: 'Lower the confidence threshold if the match is correct',
          confidence: 0.7,
          retryable: true,
        },
      ];
    case 'AMBIGUOUS_MATCH':
      return [
        {
          suggestion: 'Be more specific about which element you mean',
          confidence: 0.9,
          retryable: false,
        },
        {
          suggestion: 'Include the section or form name in the description',
          confidence: 0.8,
          retryable: false,
        },
        { suggestion: 'Use the element ID directly', confidence: 0.7, retryable: false },
      ];
    default:
      return [
        {
          suggestion: 'Try a different approach or check the page state',
          confidence: 0.5,
          retryable: false,
        },
      ];
  }
}

/**
 * Create structured failure details
 */
function createFailureDetails(
  errorCode: ActionErrorCode,
  message: string,
  options: {
    elementId?: string;
    selectorsTried?: string[];
    durationMs?: number;
    timeoutMs?: number;
  } = {}
): ActionFailureDetails {
  const retryableErrors: ActionErrorCode[] = [
    'ELEMENT_NOT_VISIBLE',
    'ACTION_TIMEOUT',
    'LOW_CONFIDENCE',
    'NETWORK_ERROR',
    'STATE_NOT_REACHED',
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
 * Create server handlers for UI Bridge
 *
 * @param registry - The UI Bridge registry instance
 * @param actionExecutor - The action executor instance
 * @param config - Optional configuration
 * @returns Handler implementations for all endpoints
 *
 * @example
 * ```ts
 * import { createHandlers } from '@qontinui/ui-bridge/server';
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

  // Intent registry (in-memory store for registered intents)
  const intentRegistry = new Map<string, Intent>();

  // Console capture
  const consoleCapture = config.consoleCapture ?? null;

  // Annotation store
  const annotationStore = config.annotationStore ?? getGlobalAnnotationStore();

  // Helper to get fresh elements and update AI modules
  function refreshElements(): void {
    const elements = registry.getAllElements();
    searchEngine.updateElements(elements as any[]);
    nlExecutor.updateElements(elements as any[]);
    nlExecutor.setActionExecutor(actionExecutor as any);
    assertionExecutor.updateElements(elements as any[]);
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
        return success(elements as ControlSnapshot['elements']);
      } catch (err) {
        return error((err as Error).message, 'ELEMENTS_ERROR');
      }
    },

    getElement: async (id: string): Promise<APIResponse<ControlSnapshot['elements'][0]>> => {
      try {
        const element = registry.getElement(id);
        if (!element) {
          const failureDetails = createFailureDetails(
            'ELEMENT_NOT_FOUND',
            `Element not found: ${id}`,
            {
              elementId: id,
              selectorsTried: [id],
            }
          );
          return {
            success: false,
            error: `Element not found: ${id}`,
            code: 'ELEMENT_NOT_FOUND',
            data: { failureDetails } as any,
            timestamp: Date.now(),
          };
        }
        return success(element as ControlSnapshot['elements'][0]);
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
    ) => {
      const startTime = Date.now();
      try {
        // Check if element exists first
        const element = registry.getElement(id);
        if (!element) {
          const failureDetails = createFailureDetails(
            'ELEMENT_NOT_FOUND',
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
            code: 'ELEMENT_NOT_FOUND',
            data: {
              success: false,
              error: `Element not found: ${id}`,
              failureDetails,
              durationMs: Date.now() - startTime,
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
          } as APIResponse<any>;
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
          let errorCode: ActionErrorCode = 'UNKNOWN_ERROR';
          const errorMsg = actionResult.error?.toLowerCase() || '';

          if (errorMsg.includes('not found')) {
            errorCode = 'ELEMENT_NOT_FOUND';
          } else if (errorMsg.includes('not visible') || errorMsg.includes('hidden')) {
            errorCode = 'ELEMENT_NOT_VISIBLE';
          } else if (errorMsg.includes('disabled') || errorMsg.includes('not enabled')) {
            errorCode = 'ELEMENT_NOT_ENABLED';
          } else if (errorMsg.includes('timeout')) {
            errorCode = 'ACTION_TIMEOUT';
          } else if (errorMsg.includes('blocked') || errorMsg.includes('interactable')) {
            errorCode = 'ELEMENT_NOT_INTERACTABLE';
          }

          const failureDetails = createFailureDetails(
            errorCode,
            actionResult.error || 'Action failed',
            {
              elementId: id,
              durationMs: Date.now() - startTime,
            }
          );

          return success({
            ...actionResult,
            failureDetails,
          }) as APIResponse<any>;
        }

        return success(result) as APIResponse<any>;
      } catch (err) {
        const errorMessage = (err as Error).message;
        let errorCode: ActionErrorCode = 'UNKNOWN_ERROR';

        if (errorMessage.includes('not found')) {
          errorCode = 'ELEMENT_NOT_FOUND';
        } else if (errorMessage.includes('timeout')) {
          errorCode = 'ACTION_TIMEOUT';
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          errorCode = 'NETWORK_ERROR';
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
            success: false,
            error: errorMessage,
            failureDetails,
            durationMs: Date.now() - startTime,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        } as APIResponse<any>;
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
    ) => {
      try {
        const result = await actionExecutor.executeComponentAction(id, {
          action: request.action,
          params: request.params,
        });
        return success(result) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'COMPONENT_ACTION_ERROR');
      }
    },

    // =========================================================================
    // Find/Discovery Handlers
    // =========================================================================

    find: async (request?: unknown) => {
      try {
        const findRequest = request as
          | { types?: string[]; selector?: string; limit?: number }
          | undefined;
        const elements = registry.findElements?.(findRequest) ?? registry.getAllElements();
        return success({
          elements,
          timestamp: Date.now(),
          total: (elements as unknown[]).length,
          durationMs: 0,
        }) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'FIND_ERROR');
      }
    },

    discover: async (request?: unknown) => {
      // Deprecated, delegates to find
      try {
        const findRequest = request as
          | { types?: string[]; selector?: string; limit?: number }
          | undefined;
        const elements = registry.findElements?.(findRequest) ?? registry.getAllElements();
        return success({
          elements,
          timestamp: Date.now(),
          total: (elements as unknown[]).length,
          durationMs: 0,
        }) as APIResponse<any>;
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

    runWorkflow: async (id: string, _request?: unknown) => {
      try {
        const workflow = registry.getWorkflow?.(id);
        if (!workflow) {
          return error(`Workflow not found: ${id}`, 'NOT_FOUND');
        }
        // TODO: Implement actual workflow execution
        const runId = `run-${Date.now()}`;
        return success({
          runId,
          workflowId: id,
          status: 'pending',
          startedAt: Date.now(),
          steps: [],
          totalSteps: 0,
        }) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'WORKFLOW_ERROR');
      }
    },

    getWorkflowStatus: async (runId: string) => {
      try {
        // TODO: Implement workflow status tracking
        return success({
          runId,
          workflowId: '',
          status: 'completed',
          completedAt: Date.now(),
          startedAt: Date.now(),
          steps: [],
          totalSteps: 0,
        }) as APIResponse<any>;
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

    getConsoleErrors: async (params?: {
      since?: number;
      limit?: number;
    }): Promise<APIResponse<{ errors: CapturedError[]; count: number }>> => {
      try {
        if (!consoleCapture) {
          return success({ errors: [], count: 0 });
        }
        const errors = params?.since
          ? consoleCapture.getConsoleSince(params.since)
          : consoleCapture.getConsoleRecent(params?.limit ?? 50);
        return success({ errors, count: errors.length });
      } catch (err) {
        return error((err as Error).message, 'CONSOLE_ERRORS_ERROR');
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
        const snapshot = registry.createSnapshot();
        // Convert snapshot elements to AI elements format for summary
        const elements = snapshot.elements.map((el) => ({
          ...el,
          description: el.label || el.id,
          aliases: [],
          suggestedActions: [],
          tagName: el.type,
          accessibleName: el.label,
          registered: true,
        })) as any[];
        const summary = generatePageSummary(elements);
        return success(summary);
      } catch (err) {
        return error((err as Error).message, 'PAGE_SUMMARY_ERROR');
      }
    },

    // =========================================================================
    // Semantic Search Handler (Embedding-based)
    // =========================================================================

    // =========================================================================
    // Page Navigation Handlers
    // =========================================================================

    pageRefresh: async (): Promise<APIResponse<PageNavigationResponse>> => {
      try {
        window.location.reload();
        return success({ success: true, url: window.location.href, timestamp: Date.now() });
      } catch (err) {
        return error((err as Error).message, 'PAGE_REFRESH_ERROR');
      }
    },

    pageNavigate: async (
      request: PageNavigateRequest
    ): Promise<APIResponse<PageNavigationResponse>> => {
      try {
        if (!request.url) {
          return error('URL is required', 'INVALID_REQUEST');
        }
        window.location.href = request.url;
        return success({ success: true, url: request.url, timestamp: Date.now() });
      } catch (err) {
        return error((err as Error).message, 'PAGE_NAVIGATE_ERROR');
      }
    },

    pageGoBack: async (): Promise<APIResponse<PageNavigationResponse>> => {
      try {
        window.history.back();
        return success({ success: true, url: window.location.href, timestamp: Date.now() });
      } catch (err) {
        return error((err as Error).message, 'PAGE_GO_BACK_ERROR');
      }
    },

    pageGoForward: async (): Promise<APIResponse<PageNavigationResponse>> => {
      try {
        window.history.forward();
        return success({ success: true, url: window.location.href, timestamp: Date.now() });
      } catch (err) {
        return error((err as Error).message, 'PAGE_GO_FORWARD_ERROR');
      }
    },

    // =========================================================================
    // Annotation Handlers
    //
    // REST API endpoints for managing element annotations:
    //   GET    /annotations           - List all annotations
    //   GET    /annotations/export    - Export all annotations as AnnotationConfig
    //   GET    /annotations/coverage  - Get annotation coverage statistics
    //   GET    /annotations/:id       - Get annotation for a specific element
    //   PUT    /annotations/:id       - Create or update an annotation
    //   DELETE /annotations/:id       - Delete an annotation
    //   POST   /annotations/import    - Import annotations from AnnotationConfig
    // =========================================================================

    getAnnotations: async (): Promise<APIResponse<Record<string, ElementAnnotation>>> => {
      try {
        return success(annotationStore.getAll());
      } catch (err) {
        return error((err as Error).message, 'ANNOTATIONS_ERROR');
      }
    },

    getAnnotation: async (id: string): Promise<APIResponse<ElementAnnotation>> => {
      try {
        const annotation = annotationStore.get(id);
        if (!annotation) {
          return error(`Annotation not found: ${id}`, 'NOT_FOUND');
        }
        return success(annotation);
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_ERROR');
      }
    },

    setAnnotation: async (
      id: string,
      annotation: ElementAnnotation
    ): Promise<APIResponse<ElementAnnotation>> => {
      try {
        annotationStore.set(id, annotation);
        return success(annotationStore.get(id)!);
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_SET_ERROR');
      }
    },

    deleteAnnotation: async (id: string): Promise<APIResponse<void>> => {
      try {
        const existed = annotationStore.delete(id);
        if (!existed) {
          return error(`Annotation not found: ${id}`, 'NOT_FOUND');
        }
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_DELETE_ERROR');
      }
    },

    importAnnotations: async (
      config: AnnotationConfig
    ): Promise<APIResponse<{ count: number }>> => {
      try {
        const count = annotationStore.importConfig(config);
        return success({ count });
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_IMPORT_ERROR');
      }
    },

    exportAnnotations: async (): Promise<APIResponse<AnnotationConfig>> => {
      try {
        return success(annotationStore.exportConfig());
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_EXPORT_ERROR');
      }
    },

    getAnnotationCoverage: async (): Promise<APIResponse<AnnotationCoverage>> => {
      try {
        const allElements = registry.getAllElements() as Array<{ id: string }>;
        const allIds = allElements.map((el) => el.id);
        return success(annotationStore.getCoverage(allIds));
      } catch (err) {
        return error((err as Error).message, 'ANNOTATION_COVERAGE_ERROR');
      }
    },

    aiSemanticSearch: async (
      criteria: SemanticSearchCriteria
    ): Promise<APIResponse<SemanticSearchResponse>> => {
      const startTime = performance.now();
      try {
        // Refresh elements for search
        refreshElements();

        // Get all elements
        const allElements = registry.getAllElements() as any[];

        // Convert to AI discovered elements for semantic search
        const aiElements: Array<{ element: AIDiscoveredElement; text: string }> = allElements.map(
          (el) => {
            // Build searchable text from element properties
            const textParts: string[] = [];

            // Prioritize description and accessible name for semantic matching
            const state = 'getState' in el ? (el as any).getState() : el.state;
            const textContent = state?.textContent || '';
            const label = el.label || '';
            const accessibleName = el.accessibleName || '';
            const placeholder = el.placeholder || '';
            const title = el.title || '';

            if (label) textParts.push(label);
            if (accessibleName && accessibleName !== label) textParts.push(accessibleName);
            if (textContent && textContent !== label && textContent !== accessibleName) {
              textParts.push(textContent);
            }
            if (placeholder) textParts.push(`placeholder: ${placeholder}`);
            if (title) textParts.push(title);

            const combinedText = textParts.join(' ').trim() || el.id;

            return {
              element: {
                id: el.id,
                type: el.type,
                label: el.label,
                tagName: el.tagName || el.type,
                role: el.role,
                accessibleName: el.accessibleName,
                actions: el.actions || [],
                state: state || {},
                registered: true,
                description: label || el.id,
                aliases: [],
                suggestedActions: [],
              } as AIDiscoveredElement,
              text: combinedText,
            };
          }
        );

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
            const queryWords = new Set(query.split(/\s+/).filter((w: string) => w.length > 2));
            const textWords = new Set(textLower.split(/\s+/).filter((w: string) => w.length > 2));

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

    // =========================================================================
    // State Management Handlers
    // =========================================================================

    getStates: async (): Promise<APIResponse<UIState[]>> => {
      try {
        const states = registry.getStates?.() ?? [];
        return success(states);
      } catch (err) {
        return error((err as Error).message, 'STATES_ERROR');
      }
    },

    getState: async (id: string): Promise<APIResponse<UIState>> => {
      try {
        const state = registry.getState?.(id);
        if (!state) {
          return error(`State not found: ${id}`, 'NOT_FOUND');
        }
        return success(state);
      } catch (err) {
        return error((err as Error).message, 'STATE_ERROR');
      }
    },

    getActiveStates: async (): Promise<APIResponse<UIState[]>> => {
      try {
        const states = registry.getActiveStates?.() ?? [];
        return success(states);
      } catch (err) {
        return error((err as Error).message, 'ACTIVE_STATES_ERROR');
      }
    },

    activateState: async (id: string): Promise<APIResponse<void>> => {
      try {
        if (!registry.activateState) {
          return error('State management not available', 'NOT_IMPLEMENTED');
        }
        registry.activateState(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'ACTIVATE_STATE_ERROR');
      }
    },

    deactivateState: async (id: string): Promise<APIResponse<void>> => {
      try {
        if (!registry.deactivateState) {
          return error('State management not available', 'NOT_IMPLEMENTED');
        }
        registry.deactivateState(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'DEACTIVATE_STATE_ERROR');
      }
    },

    getStateGroups: async (): Promise<APIResponse<UIStateGroup[]>> => {
      try {
        const groups = registry.getStateGroups?.() ?? [];
        return success(groups);
      } catch (err) {
        return error((err as Error).message, 'STATE_GROUPS_ERROR');
      }
    },

    activateStateGroup: async (id: string): Promise<APIResponse<void>> => {
      try {
        if (!registry.activateStateGroup) {
          return error('State group management not available', 'NOT_IMPLEMENTED');
        }
        registry.activateStateGroup(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'ACTIVATE_STATE_GROUP_ERROR');
      }
    },

    deactivateStateGroup: async (id: string): Promise<APIResponse<void>> => {
      try {
        if (!registry.deactivateStateGroup) {
          return error('State group management not available', 'NOT_IMPLEMENTED');
        }
        registry.deactivateStateGroup(id);
        return success(undefined);
      } catch (err) {
        return error((err as Error).message, 'DEACTIVATE_STATE_GROUP_ERROR');
      }
    },

    getTransitions: async (): Promise<APIResponse<UITransition[]>> => {
      try {
        const transitions = registry.getTransitions?.() ?? [];
        return success(transitions);
      } catch (err) {
        return error((err as Error).message, 'TRANSITIONS_ERROR');
      }
    },

    canExecuteTransition: async (
      id: string
    ): Promise<APIResponse<{ canExecute: boolean; reason?: string }>> => {
      try {
        if (!registry.canExecuteTransition) {
          return error('Transition management not available', 'NOT_IMPLEMENTED');
        }
        const result = registry.canExecuteTransition(id);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'CAN_EXECUTE_TRANSITION_ERROR');
      }
    },

    executeTransition: async (id: string): Promise<APIResponse<TransitionResult>> => {
      try {
        if (!registry.executeTransition) {
          return error('Transition execution not available', 'NOT_IMPLEMENTED');
        }
        const result = await registry.executeTransition(id);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'EXECUTE_TRANSITION_ERROR');
      }
    },

    findPath: async (request: { targetStates: string[] }): Promise<APIResponse<PathResult>> => {
      try {
        if (!registry.findPath) {
          return error('Pathfinding not available', 'NOT_IMPLEMENTED');
        }
        const result = registry.findPath(request.targetStates);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'FIND_PATH_ERROR');
      }
    },

    navigateTo: async (request: {
      targetStates: string[];
    }): Promise<APIResponse<NavigationResult>> => {
      try {
        if (!registry.navigateTo) {
          return error('Navigation not available', 'NOT_IMPLEMENTED');
        }
        const result = await registry.navigateTo(request.targetStates);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'NAVIGATE_TO_ERROR');
      }
    },

    getStateSnapshot: async (): Promise<APIResponse<StateSnapshot>> => {
      try {
        if (!registry.getStateSnapshot) {
          // Fallback: build from available data
          const snapshot: StateSnapshot = {
            timestamp: Date.now(),
            activeStates: (registry.getActiveStates?.() ?? []).map((s) => s.id),
            states: registry.getStates?.() ?? [],
            groups: registry.getStateGroups?.() ?? [],
            transitions: registry.getTransitions?.() ?? [],
          };
          return success(snapshot);
        }
        return success(registry.getStateSnapshot());
      } catch (err) {
        return error((err as Error).message, 'STATE_SNAPSHOT_ERROR');
      }
    },

    // =========================================================================
    // Intent Handlers
    // =========================================================================

    executeIntent: async (request: {
      intentId: string;
      params?: Record<string, unknown>;
    }): Promise<APIResponse<IntentExecutionResult>> => {
      const startTime = Date.now();
      try {
        refreshElements();
        const intent = intentRegistry.get(request.intentId);
        if (!intent) {
          return error(`Intent not found: ${request.intentId}`, 'NOT_FOUND');
        }
        // Execute via NL executor using intent description as instruction
        const nlResponse = await nlExecutor.execute({
          instruction: intent.description,
          context: `Executing intent: ${intent.name}`,
        });
        return success({
          success: nlResponse.success,
          intentId: request.intentId,
          result: nlResponse,
          error: nlResponse.error,
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        return error((err as Error).message, 'EXECUTE_INTENT_ERROR');
      }
    },

    findIntent: async (request: { query: string }): Promise<APIResponse<IntentSearchResponse>> => {
      try {
        const query = request.query.toLowerCase();
        const results: Array<{ intent: Intent; confidence: number }> = [];

        for (const intent of intentRegistry.values()) {
          let confidence = 0;
          const nameLower = intent.name.toLowerCase();
          const descLower = intent.description.toLowerCase();

          if (nameLower === query) {
            confidence = 1.0;
          } else if (nameLower.includes(query) || query.includes(nameLower)) {
            confidence = 0.8;
          } else if (descLower.includes(query)) {
            confidence = 0.6;
          } else if (intent.tags?.some((t) => t.toLowerCase().includes(query))) {
            confidence = 0.5;
          }

          if (confidence > 0) {
            results.push({ intent, confidence });
          }
        }

        results.sort((a, b) => b.confidence - a.confidence);
        return success({ intents: results });
      } catch (err) {
        return error((err as Error).message, 'FIND_INTENT_ERROR');
      }
    },

    listIntents: async (): Promise<APIResponse<Intent[]>> => {
      try {
        return success(Array.from(intentRegistry.values()));
      } catch (err) {
        return error((err as Error).message, 'LIST_INTENTS_ERROR');
      }
    },

    registerIntent: async (intent: Intent): Promise<APIResponse<Intent>> => {
      try {
        intentRegistry.set(intent.id, intent);
        return success(intent);
      } catch (err) {
        return error((err as Error).message, 'REGISTER_INTENT_ERROR');
      }
    },

    executeIntentFromQuery: async (request: {
      query: string;
      params?: Record<string, unknown>;
    }): Promise<APIResponse<IntentExecutionResult>> => {
      const startTime = Date.now();
      try {
        refreshElements();
        // Find best matching intent
        const query = request.query.toLowerCase();
        let bestIntent: Intent | null = null;
        let bestConfidence = 0;

        for (const intent of intentRegistry.values()) {
          let confidence = 0;
          const nameLower = intent.name.toLowerCase();
          const descLower = intent.description.toLowerCase();

          if (nameLower === query) {
            confidence = 1.0;
          } else if (nameLower.includes(query) || query.includes(nameLower)) {
            confidence = 0.8;
          } else if (descLower.includes(query)) {
            confidence = 0.6;
          }

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestIntent = intent;
          }
        }

        if (!bestIntent) {
          return success({
            success: false,
            intentId: '',
            error: `No intent found matching query: ${request.query}`,
            durationMs: Date.now() - startTime,
          });
        }

        const nlResponse = await nlExecutor.execute({
          instruction: bestIntent.description,
          context: `Executing intent from query: ${request.query}`,
        });

        return success({
          success: nlResponse.success,
          intentId: bestIntent.id,
          result: nlResponse,
          error: nlResponse.error,
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        return error((err as Error).message, 'EXECUTE_INTENT_FROM_QUERY_ERROR');
      }
    },

    // =========================================================================
    // Recovery Handler
    // =========================================================================

    attemptRecovery: async (
      request: RecoveryAttemptRequest
    ): Promise<APIResponse<RecoveryAttemptResult>> => {
      const startTime = Date.now();
      try {
        refreshElements();
        const strategiesAttempted: string[] = [];
        let lastResult: NLActionResponse | undefined;

        // Try recovery strategies based on the failure info
        const suggestions = request.failure.suggestedActions ?? [];

        for (let i = 0; i < Math.min(suggestions.length, request.maxRetries); i++) {
          const suggestion = suggestions[i];
          strategiesAttempted.push(suggestion.suggestion || `strategy-${i}`);

          // If the suggestion has a command, try executing it
          const instruction = suggestion.command || request.instruction;
          try {
            const result = await nlExecutor.execute({
              instruction,
              context: `Recovery attempt ${i + 1}: ${suggestion.suggestion}`,
            });
            lastResult = result;

            if (result.success) {
              return success({
                recovered: true,
                strategiesAttempted,
                finalResult: result,
                durationMs: Date.now() - startTime,
              });
            }
          } catch {
            // Continue to next strategy
          }
        }

        // If no suggestions or all failed, try the instruction directly
        if (strategiesAttempted.length === 0 || !lastResult?.success) {
          strategiesAttempted.push('direct-instruction');
          try {
            const result = await nlExecutor.execute({
              instruction: request.instruction,
              context: 'Recovery: direct instruction attempt',
            });
            lastResult = result;

            if (result.success) {
              return success({
                recovered: true,
                strategiesAttempted,
                finalResult: result,
                durationMs: Date.now() - startTime,
              });
            }
          } catch {
            // Fall through to failure
          }
        }

        return success({
          recovered: false,
          strategiesAttempted,
          finalResult: lastResult,
          error: 'All recovery strategies exhausted',
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        return error((err as Error).message, 'RECOVERY_ERROR');
      }
    },

    // =========================================================================
    // Cross-App Analysis Handlers
    // =========================================================================

    analyzePageData: async (): Promise<APIResponse<PageDataMap>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        const result = extractPageData(snapshot.elements);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'ANALYZE_DATA_ERROR');
      }
    },

    analyzePageRegions: async (): Promise<APIResponse<PageRegionMap>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        const result = segmentPageRegions(snapshot.elements);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'ANALYZE_REGIONS_ERROR');
      }
    },

    analyzeStructuredData: async (): Promise<APIResponse<StructuredDataExtraction>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        const result = extractStructuredData(snapshot.elements);
        return success(result);
      } catch (err) {
        return error((err as Error).message, 'ANALYZE_STRUCTURED_DATA_ERROR');
      }
    },

    crossAppCompare: async (request: {
      sourceSnapshot: SemanticSnapshot;
      targetSnapshot: SemanticSnapshot;
      sourceComponents?: ComponentInfo[];
      targetComponents?: ComponentInfo[];
    }): Promise<APIResponse<CrossAppComparisonReport>> => {
      try {
        const hasComponents = request.sourceComponents && request.targetComponents;
        const report = generateComparisonReport(
          request.sourceSnapshot,
          request.targetSnapshot,
          hasComponents
            ? {
                config: { includeComponents: true },
                sourceComponents: request.sourceComponents,
                targetComponents: request.targetComponents,
              }
            : undefined
        );
        return success(report);
      } catch (err) {
        return error((err as Error).message, 'CROSS_APP_COMPARE_ERROR');
      }
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
> {
  const searchEngine = new SearchEngine();
  const nlExecutor = new NLActionExecutor();
  const assertionExecutor = new AssertionExecutor();
  const snapshotManager = new SemanticSnapshotManager();
  const diffManager = new SemanticDiffManager();

  function refreshElements(): void {
    const elements = registry.getAllElements();
    searchEngine.updateElements(elements as any[]);
    nlExecutor.updateElements(elements as any[]);
    nlExecutor.setActionExecutor(actionExecutor as any);
    assertionExecutor.updateElements(elements as any[]);
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
          code: 'AI_SEARCH_ERROR',
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
          code: 'AI_EXECUTE_ERROR',
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
          code: 'AI_ASSERT_ERROR',
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
          code: 'AI_ASSERT_BATCH_ERROR',
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
          code: 'SEMANTIC_SNAPSHOT_ERROR',
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
          code: 'SEMANTIC_DIFF_ERROR',
          timestamp: Date.now(),
        };
      }
    },

    getPageSummary: async (): Promise<APIResponse<string>> => {
      try {
        const snapshot = registry.createSnapshot();
        // Convert snapshot elements to AI elements format for summary
        const elements = snapshot.elements.map((el) => ({
          ...el,
          description: el.label || el.id,
          aliases: [],
          suggestedActions: [],
          tagName: el.type,
          accessibleName: el.label,
          registered: true,
        })) as any[];
        const summary = generatePageSummary(elements);
        return { success: true, data: summary, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          code: 'PAGE_SUMMARY_ERROR',
          timestamp: Date.now(),
        };
      }
    },
  };
}
