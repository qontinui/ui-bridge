/**
 * UI Bridge Native Server Handlers
 *
 * Request handlers for the HTTP API endpoints.
 */

import type { NativeUIBridgeRegistry } from '../core/registry';
import type { WorkflowStep } from '../core/types';
import type { NativeActionExecutor } from '../control/types';
import type { APIResponse, HandlerContext, NativeServerHandlers } from './types';
import { createDesignHandlers } from './design-handlers';

/**
 * Result of executing a single workflow step
 */
interface WorkflowStepResult {
  stepId: string;
  type: string;
  status: 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Execute a single workflow step using the registry and executor
 */
async function executeWorkflowStep(
  step: WorkflowStep,
  registry: NativeUIBridgeRegistry,
  executor: NativeActionExecutor
): Promise<WorkflowStepResult> {
  const startTime = Date.now();

  try {
    switch (step.type) {
      case 'element-action': {
        if (!step.target || !step.action) {
          return {
            stepId: step.id,
            type: step.type,
            status: 'failed',
            error: 'element-action step requires target and action',
            durationMs: Date.now() - startTime,
          };
        }

        const response = await executor.executeAction(step.target, {
          action: step.action,
          params: step.params,
          waitOptions: step.waitOptions,
        });

        return {
          stepId: step.id,
          type: step.type,
          status: response.success ? 'completed' : 'failed',
          result: response.result,
          error: response.error,
          durationMs: Date.now() - startTime,
        };
      }

      case 'component-action': {
        if (!step.target || !step.action) {
          return {
            stepId: step.id,
            type: step.type,
            status: 'failed',
            error: 'component-action step requires target and action',
            durationMs: Date.now() - startTime,
          };
        }

        const response = await executor.executeComponentAction(step.target, {
          action: step.action,
          params: step.params,
        });

        return {
          stepId: step.id,
          type: step.type,
          status: response.success ? 'completed' : 'failed',
          result: response.result,
          error: response.error,
          durationMs: Date.now() - startTime,
        };
      }

      case 'wait': {
        if (!step.target) {
          return {
            stepId: step.id,
            type: step.type,
            status: 'failed',
            error: 'wait step requires target element id',
            durationMs: Date.now() - startTime,
          };
        }

        const waitResult = await executor.waitForElement(
          step.target,
          step.waitOptions || { visible: true, timeout: 10000, interval: 100 }
        );

        return {
          stepId: step.id,
          type: step.type,
          status: waitResult.met ? 'completed' : 'failed',
          result: waitResult.state,
          error: waitResult.error,
          durationMs: Date.now() - startTime,
        };
      }

      case 'assert': {
        if (!step.target) {
          return {
            stepId: step.id,
            type: step.type,
            status: 'failed',
            error: 'assert step requires target element id',
            durationMs: Date.now() - startTime,
          };
        }

        const element = registry.getElement(step.target);
        if (!element) {
          return {
            stepId: step.id,
            type: step.type,
            status: 'failed',
            error: `Element not found: ${step.target}`,
            durationMs: Date.now() - startTime,
          };
        }

        const state = element.getState();
        const expected = step.params || {};
        const stateRecord = state as unknown as Record<string, unknown>;
        const mismatches: string[] = [];

        for (const [key, value] of Object.entries(expected)) {
          const actual = stateRecord[key];
          const isEqual =
            typeof value === 'object' && value !== null
              ? JSON.stringify(actual) === JSON.stringify(value)
              : actual === value;
          if (!isEqual) {
            mismatches.push(
              `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`
            );
          }
        }

        return {
          stepId: step.id,
          type: step.type,
          status: mismatches.length === 0 ? 'completed' : 'failed',
          result: { state, mismatches },
          error: mismatches.length > 0 ? `Assertion failed: ${mismatches.join('; ')}` : undefined,
          durationMs: Date.now() - startTime,
        };
      }

      case 'custom': {
        if (!step.handler) {
          return {
            stepId: step.id,
            type: step.type,
            status: 'failed',
            error: 'custom step requires a handler function',
            durationMs: Date.now() - startTime,
          };
        }

        const result = await step.handler();
        // Allow handlers to signal failure by returning { success: false, error: '...' }
        const failed =
          result &&
          typeof result === 'object' &&
          'success' in result &&
          (result as Record<string, unknown>).success === false;

        return {
          stepId: step.id,
          type: step.type,
          status: failed ? 'failed' : 'completed',
          result,
          error: failed
            ? ((result as Record<string, unknown>).error as string) ||
              'Custom handler returned failure'
            : undefined,
          durationMs: Date.now() - startTime,
        };
      }

      case 'log': {
        const message = step.params?.message ?? step.params?.text ?? `[workflow] step ${step.id}`;
        console.log(`[ui-bridge-native] workflow log: ${message}`);

        return {
          stepId: step.id,
          type: step.type,
          status: 'completed',
          result: { message },
          durationMs: Date.now() - startTime,
        };
      }

      case 'navigate':
      case 'branch':
      case 'loop':
      case 'extract':
        return {
          stepId: step.id,
          type: step.type,
          status: 'skipped',
          error: `Step type "${step.type}" is not yet supported in native workflow execution`,
          durationMs: Date.now() - startTime,
        };

      default:
        return {
          stepId: step.id,
          type: step.type,
          status: 'failed',
          error: `Unknown step type: ${step.type}`,
          durationMs: Date.now() - startTime,
        };
    }
  } catch (err) {
    return {
      stepId: step.id,
      type: step.type,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
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
 * Create server handlers
 */
export function createServerHandlers(
  registry: NativeUIBridgeRegistry,
  executor: NativeActionExecutor,
  config?: { appInfo?: { appId: string; appName: string; appType: string; framework?: string } }
): NativeServerHandlers {
  const designHandlers = createDesignHandlers(registry);

  return {
    // Elements
    getElements: async () => {
      const elements = registry.getAllElements().map((e) => ({
        id: e.id,
        type: e.type,
        label: e.label,
        identifier: e.getIdentifier(),
        state: e.getState(),
        actions: e.actions,
        customActions: e.customActions ? Object.keys(e.customActions) : undefined,
      }));

      return success({ elements });
    },

    getElement: async (ctx: HandlerContext) => {
      const { id } = ctx.params;
      const element = registry.getElement(id);

      if (!element) {
        return error(`Element not found: ${id}`, 'ELEMENT_NOT_FOUND');
      }

      return success({
        element: {
          id: element.id,
          type: element.type,
          label: element.label,
          identifier: element.getIdentifier(),
          state: element.getState(),
          actions: element.actions,
          customActions: element.customActions ? Object.keys(element.customActions) : undefined,
        },
      });
    },

    getElementState: async (ctx: HandlerContext) => {
      const { id } = ctx.params;
      const element = registry.getElement(id);

      if (!element) {
        return error(`Element not found: ${id}`, 'ELEMENT_NOT_FOUND');
      }

      return success({ state: element.getState() });
    },

    executeAction: async (ctx: HandlerContext) => {
      const { id } = ctx.params;
      const body = ctx.body as {
        action: string;
        params?: Record<string, unknown>;
        waitOptions?: Record<string, unknown>;
      };

      if (!body?.action) {
        return error('Action is required', 'INVALID_REQUEST');
      }

      const response = await executor.executeAction(id, {
        action: body.action,
        params: body.params,
        waitOptions: body.waitOptions as any,
      });

      if (!response.success) {
        return error(response.error || 'Action failed', 'ACTION_FAILED');
      }

      return success(response);
    },

    // Components
    getComponents: async () => {
      const components = registry.getAllComponents().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        actions: c.actions.map((a) => ({ id: a.id, label: a.label })),
        elementIds: c.elementIds,
      }));

      return success({ components });
    },

    getComponent: async (ctx: HandlerContext) => {
      const { id } = ctx.params;
      const component = registry.getComponent(id);

      if (!component) {
        return error(`Component not found: ${id}`, 'COMPONENT_NOT_FOUND');
      }

      return success({
        component: {
          id: component.id,
          name: component.name,
          description: component.description,
          actions: component.actions.map((a) => ({
            id: a.id,
            label: a.label,
            description: a.description,
          })),
          elementIds: component.elementIds,
        },
      });
    },

    executeComponentAction: async (ctx: HandlerContext) => {
      const { id, actionId } = ctx.params;
      const body = ctx.body as { params?: Record<string, unknown> };

      const response = await executor.executeComponentAction(id, {
        action: actionId,
        params: body?.params,
      });

      if (!response.success) {
        return error(response.error || 'Action failed', 'ACTION_FAILED');
      }

      return success(response);
    },

    // Discovery
    find: async (ctx: HandlerContext) => {
      const body = ctx.body as {
        types?: string[];
        testIdPattern?: string;
        accessibilityLabelPattern?: string;
        visibleOnly?: boolean;
        limit?: number;
      };

      const response = await executor.find({
        types: body?.types as any,
        testIdPattern: body?.testIdPattern,
        accessibilityLabelPattern: body?.accessibilityLabelPattern,
        visibleOnly: body?.visibleOnly,
        limit: body?.limit,
      });

      return success(response);
    },

    getSnapshot: async () => {
      const snapshot = registry.createSnapshot();
      return success(snapshot);
    },

    // Workflows
    getWorkflows: async () => {
      const workflows = registry.getAllWorkflows().map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        stepCount: w.steps.length,
      }));

      return success({ workflows });
    },

    runWorkflow: async (ctx: HandlerContext) => {
      const { id } = ctx.params;
      const workflow = registry.getWorkflow(id);

      if (!workflow) {
        return error(`Workflow not found: ${id}`, 'WORKFLOW_NOT_FOUND');
      }

      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startTime = Date.now();
      const stepResults: WorkflowStepResult[] = [];
      let status: 'completed' | 'failed' = 'completed';

      registry.emit('workflow:started', {
        runId,
        workflowId: id,
        workflowName: workflow.name,
        totalSteps: workflow.steps.length,
      });

      for (const step of workflow.steps) {
        const stepResult = await executeWorkflowStep(step, registry, executor);
        stepResults.push(stepResult);

        if (stepResult.status === 'completed' || stepResult.status === 'skipped') {
          registry.emit('workflow:stepCompleted', {
            runId,
            workflowId: id,
            step: stepResult,
          });
        }

        if (stepResult.status === 'failed') {
          status = 'failed';
          registry.emit('workflow:failed', {
            runId,
            workflowId: id,
            failedStep: stepResult,
            completedSteps: stepResults.length - 1,
            totalSteps: workflow.steps.length,
          });
          break;
        }
      }

      if (status === 'completed') {
        registry.emit('workflow:completed', {
          runId,
          workflowId: id,
          steps: stepResults,
          totalDurationMs: Date.now() - startTime,
        });
      }

      return success({
        runId,
        status,
        steps: stepResults,
        totalSteps: workflow.steps.length,
        completedSteps: stepResults.filter((s) => s.status === 'completed').length,
        failedSteps: stepResults.filter((s) => s.status === 'failed').length,
        skippedSteps: stepResults.filter((s) => s.status === 'skipped').length,
        durationMs: Date.now() - startTime,
      });
    },

    // Page Navigation (stubs — React Native apps should override with their navigation provider)
    pageRefresh: async () => {
      return error('Page refresh not supported on native platform', 'NOT_SUPPORTED');
    },

    pageNavigate: async () => {
      return error('Page navigation not supported on native platform', 'NOT_SUPPORTED');
    },

    pageGoBack: async () => {
      return error('Page go back not supported on native platform', 'NOT_SUPPORTED');
    },

    pageGoForward: async () => {
      return error('Page go forward not supported on native platform', 'NOT_SUPPORTED');
    },

    // Screenshot (stub — apps should override with their screen capture library)
    getScreenshot: async () => {
      return error('Screenshot not supported. Provide a screenshotProvider to UIBridgeNativeProvider.', 'NOT_SUPPORTED');
    },

    // Design Review
    ...designHandlers,

    // Health
    health: async () => {
      const stats = registry.getStats();
      const response: Record<string, unknown> = {
        status: 'healthy',
        timestamp: Date.now(),
        ...stats,
      };

      if (config?.appInfo) {
        response.uiBridge = {
          version: '0.3.0',
          ...config.appInfo,
          capabilities: ['elements', 'components', 'actions', 'design'],
          elementCount: stats.elements,
          componentCount: stats.components,
        };
      }

      return success(response as any);
    },
  };
}
