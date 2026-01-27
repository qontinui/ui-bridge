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
          return error(`Element not found: ${id}`, 'NOT_FOUND');
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
      try {
        const result = await actionExecutor.executeAction(id, {
          action: request.action,
          params: request.params,
          waitOptions: request.waitOptions,
        });
        return success(result) as APIResponse<any>;
      } catch (err) {
        return error((err as Error).message, 'ACTION_ERROR');
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
