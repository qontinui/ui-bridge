/**
 * UI Bridge Native Server Handlers
 *
 * Request handlers for the HTTP API endpoints.
 */

import type { NativeUIBridgeRegistry } from '../core/registry';
import type { NativeActionExecutor } from '../control/types';
import type { APIResponse, HandlerContext, NativeServerHandlers } from './types';

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
  executor: NativeActionExecutor
): NativeServerHandlers {
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

      // TODO: Implement workflow execution
      return success({
        runId: `run-${Date.now()}`,
        status: 'pending',
      });
    },

    // Health
    health: async () => {
      const stats = registry.getStats();
      return success({
        status: 'healthy',
        timestamp: Date.now(),
        ...stats,
      });
    },
  };
}
