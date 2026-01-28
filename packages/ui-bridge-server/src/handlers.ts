/**
 * UI Bridge Server Handlers
 *
 * Factory function to create handler implementations for all UI Bridge endpoints.
 */

import type {
  UIBridgeServerHandlers,
  APIResponse,
  RenderLogQuery,
} from './types';
import type {
  ControlSnapshot,
} from '@qontinui/ui-bridge/control';
import type { RenderLogEntry } from '@qontinui/ui-bridge/render-log';
import type {
  ActionFailureDetails,
  ActionErrorCode,
} from '@qontinui/ui-bridge/core';
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
} from '@qontinui/ui-bridge/ai';
import {
  SearchEngine,
  NLActionExecutor,
  AssertionExecutor,
  SemanticSnapshotManager,
  SemanticDiffManager,
  generatePageSummary,
} from '@qontinui/ui-bridge/ai';

/**
 * Registry interface - minimal contract for handler usage
 */
export interface RegistryLike {
  getAllElements(): unknown[];
  getElement(id: string): unknown | undefined;
  getAllComponents(): unknown[];
  getComponent(id: string): unknown | undefined;
  getComponentState?(id: string): { state: Record<string, unknown>; computed: Record<string, unknown>; timestamp: number } | null;
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
        { suggestion: 'Wait for the page to fully load', command: 'wait for page to load', confidence: 0.7, retryable: true },
        { suggestion: 'Use a different description for the element', confidence: 0.8, retryable: false },
        { suggestion: 'Scroll the page to reveal the element', command: 'scroll down', confidence: 0.6, retryable: true },
      ];
    case 'ELEMENT_NOT_VISIBLE':
      return [
        { suggestion: 'Scroll to make the element visible', command: 'scroll to element', confidence: 0.9, retryable: true },
        { suggestion: 'Wait for any loading overlays to disappear', confidence: 0.7, retryable: true },
        { suggestion: 'Close any blocking modals or popups', command: 'click close button', confidence: 0.8, retryable: true },
      ];
    case 'ELEMENT_NOT_ENABLED':
      return [
        { suggestion: 'Fill in required fields first', confidence: 0.8, retryable: false },
        { suggestion: 'Complete prerequisite steps in the form', confidence: 0.7, retryable: false },
        { suggestion: 'Wait for the element to become enabled', command: 'wait for element to be enabled', confidence: 0.6, retryable: true },
      ];
    case 'ELEMENT_NOT_INTERACTABLE':
      return [
        { suggestion: 'Close any modal or popup blocking the element', command: 'click close button', confidence: 0.9, retryable: true },
        { suggestion: 'Wait for animations to complete', confidence: 0.7, retryable: true },
        { suggestion: 'Scroll the element into the viewport', command: 'scroll to element', confidence: 0.8, retryable: true },
      ];
    case 'ACTION_TIMEOUT':
      return [
        { suggestion: 'Increase the timeout duration', confidence: 0.8, retryable: true },
        { suggestion: 'Check if the condition can ever be met', confidence: 0.7, retryable: false },
        { suggestion: 'Verify the page is responding', command: 'check page status', confidence: 0.6, retryable: true },
      ];
    case 'LOW_CONFIDENCE':
      return [
        { suggestion: 'Use the exact text shown on the element', confidence: 0.9, retryable: false },
        { suggestion: 'Try a different description that more closely matches the element', confidence: 0.8, retryable: false },
        { suggestion: 'Lower the confidence threshold if the match is correct', confidence: 0.7, retryable: true },
      ];
    case 'AMBIGUOUS_MATCH':
      return [
        { suggestion: 'Be more specific about which element you mean', confidence: 0.9, retryable: false },
        { suggestion: 'Include the section or form name in the description', confidence: 0.8, retryable: false },
        { suggestion: 'Use the element ID directly', confidence: 0.7, retryable: false },
      ];
    default:
      return [
        { suggestion: 'Try a different approach or check the page state', confidence: 0.5, retryable: false },
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
          const failureDetails = createFailureDetails('ELEMENT_NOT_FOUND', `Element not found: ${id}`, {
            elementId: id,
            selectorsTried: [id],
          });
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
          const failureDetails = createFailureDetails('ELEMENT_NOT_FOUND', `Element not found: ${id}`, {
            elementId: id,
            selectorsTried: [id],
            durationMs: Date.now() - startTime,
          });
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
          const actionResult = result as { success: boolean; error?: string; elementState?: unknown };
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

          const failureDetails = createFailureDetails(errorCode, actionResult.error || 'Action failed', {
            elementId: id,
            durationMs: Date.now() - startTime,
          });

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

    getComponentState: async (id: string): Promise<APIResponse<{ state: Record<string, unknown>; computed: Record<string, unknown>; timestamp: number }>> => {
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
        const comp = component as { getState?: () => Record<string, unknown>; getComputed?: () => Record<string, unknown> };
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
        const findRequest = request as { types?: string[]; selector?: string; limit?: number } | undefined;
        const elements = registry.findElements?.(findRequest) ?? registry.getAllElements();
        return success({ elements, timestamp: Date.now(), total: (elements as unknown[]).length, durationMs: 0 }) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'FIND_ERROR');
      }
    },

    discover: async (request?: unknown) => {
      // Deprecated, delegates to find
      try {
        const findRequest = request as { types?: string[]; selector?: string; limit?: number } | undefined;
        const elements = registry.findElements?.(findRequest) ?? registry.getAllElements();
        return success({ elements, timestamp: Date.now(), total: (elements as unknown[]).length, durationMs: 0 }) as APIResponse<any>;
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

    runWorkflow: async (
      id: string,
      _request?: unknown
    ) => {
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

    aiAssertBatch: async (request: BatchAssertionRequest): Promise<APIResponse<BatchAssertionResult>> => {
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
        const elements = snapshot.elements.map(el => ({
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

    aiSemanticSearch: async (criteria: SemanticSearchCriteria): Promise<APIResponse<SemanticSearchResponse>> => {
      const startTime = performance.now();
      try {
        // Refresh elements for search
        refreshElements();

        // Get all elements
        const allElements = registry.getAllElements() as any[];

        // Convert to AI discovered elements for semantic search
        const aiElements: Array<{ element: AIDiscoveredElement; text: string }> = allElements.map(el => {
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
            const queryWords = new Set(query.split(/\s+/).filter(w => w.length > 2));
            const textWords = new Set(textLower.split(/\s+/).filter(w => w.length > 2));

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
              similarity = matchCount / queryWords.size * 0.7;
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
          .filter(r => r.similarity >= threshold)
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
        return { success: false, error: (err as Error).message, code: 'AI_SEARCH_ERROR', timestamp: Date.now() };
      }
    },

    aiExecute: async (request: NLActionRequest): Promise<APIResponse<NLActionResponse>> => {
      try {
        refreshElements();
        const response = await nlExecutor.execute(request);
        return { success: true, data: response, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, code: 'AI_EXECUTE_ERROR', timestamp: Date.now() };
      }
    },

    aiAssert: async (request: AssertionRequest): Promise<APIResponse<AssertionResult>> => {
      try {
        refreshElements();
        const result = await assertionExecutor.assert(request);
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, code: 'AI_ASSERT_ERROR', timestamp: Date.now() };
      }
    },

    aiAssertBatch: async (request: BatchAssertionRequest): Promise<APIResponse<BatchAssertionResult>> => {
      try {
        refreshElements();
        const result = await assertionExecutor.assertBatch(request);
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, code: 'AI_ASSERT_BATCH_ERROR', timestamp: Date.now() };
      }
    },

    getSemanticSnapshot: async (): Promise<APIResponse<SemanticSnapshot>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        return { success: true, data: snapshot, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, code: 'SEMANTIC_SNAPSHOT_ERROR', timestamp: Date.now() };
      }
    },

    getSemanticDiff: async (_since?: number): Promise<APIResponse<SemanticDiff | null>> => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const currentSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        const diff = diffManager.update(currentSnapshot);
        return { success: true, data: diff, timestamp: Date.now() };
      } catch (err) {
        return { success: false, error: (err as Error).message, code: 'SEMANTIC_DIFF_ERROR', timestamp: Date.now() };
      }
    },

    getPageSummary: async (): Promise<APIResponse<string>> => {
      try {
        const snapshot = registry.createSnapshot();
        // Convert snapshot elements to AI elements format for summary
        const elements = snapshot.elements.map(el => ({
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
        return { success: false, error: (err as Error).message, code: 'PAGE_SUMMARY_ERROR', timestamp: Date.now() };
      }
    },
  };
}
