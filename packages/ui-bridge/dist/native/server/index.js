'use strict';

// src/native/server/types.ts
var UI_BRIDGE_NATIVE_ROUTES = {
  // Control - Elements
  GET_ELEMENTS: {
    method: "GET",
    path: "/ui-bridge/control/elements",
    description: "List all registered elements"
  },
  GET_ELEMENT: {
    method: "GET",
    path: "/ui-bridge/control/element/:id",
    description: "Get element details"
  },
  GET_ELEMENT_STATE: {
    method: "GET",
    path: "/ui-bridge/control/element/:id/state",
    description: "Get element state"
  },
  EXECUTE_ACTION: {
    method: "POST",
    path: "/ui-bridge/control/element/:id/action",
    description: "Execute action on element"
  },
  BATCH_ACTIONS: {
    method: "POST",
    path: "/ui-bridge/control/batch-actions",
    description: "Execute multiple actions in sequence with optional delay and stopOnFailure"
  },
  // Control - Components
  GET_COMPONENTS: {
    method: "GET",
    path: "/ui-bridge/control/components",
    description: "List all registered components"
  },
  GET_COMPONENT: {
    method: "GET",
    path: "/ui-bridge/control/component/:id",
    description: "Get component details"
  },
  EXECUTE_COMPONENT_ACTION: {
    method: "POST",
    path: "/ui-bridge/control/component/:id/action/:actionId",
    description: "Execute component action"
  },
  // Discovery
  FIND: {
    method: "POST",
    path: "/ui-bridge/control/find",
    description: "Find elements matching criteria"
  },
  GET_SNAPSHOT: {
    method: "GET",
    path: "/ui-bridge/control/snapshot",
    description: "Get full bridge snapshot"
  },
  // Workflows
  GET_WORKFLOWS: {
    method: "GET",
    path: "/ui-bridge/control/workflows",
    description: "List all workflows"
  },
  RUN_WORKFLOW: {
    method: "POST",
    path: "/ui-bridge/control/workflow/:id/run",
    description: "Run a workflow"
  },
  // Page Navigation
  PAGE_REFRESH: {
    method: "POST",
    path: "/ui-bridge/control/page/refresh",
    description: "Refresh the current page"
  },
  PAGE_NAVIGATE: {
    method: "POST",
    path: "/ui-bridge/control/page/navigate",
    description: "Navigate to a URL"
  },
  PAGE_GO_BACK: {
    method: "POST",
    path: "/ui-bridge/control/page/back",
    description: "Go back in navigation history"
  },
  PAGE_GO_FORWARD: {
    method: "POST",
    path: "/ui-bridge/control/page/forward",
    description: "Go forward in navigation history"
  },
  // Health
  HEALTH: {
    method: "GET",
    path: "/ui-bridge/health",
    description: "Health check"
  }
};

// src/native/server/handlers.ts
async function executeWorkflowStep(step, registry, executor) {
  const startTime = Date.now();
  try {
    switch (step.type) {
      case "element-action": {
        if (!step.target || !step.action) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "element-action step requires target and action",
            durationMs: Date.now() - startTime
          };
        }
        const response = await executor.executeAction(step.target, {
          action: step.action,
          params: step.params,
          waitOptions: step.waitOptions
        });
        return {
          stepId: step.id,
          type: step.type,
          status: response.success ? "completed" : "failed",
          result: response.result,
          error: response.error,
          durationMs: Date.now() - startTime
        };
      }
      case "component-action": {
        if (!step.target || !step.action) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "component-action step requires target and action",
            durationMs: Date.now() - startTime
          };
        }
        const response = await executor.executeComponentAction(step.target, {
          action: step.action,
          params: step.params
        });
        return {
          stepId: step.id,
          type: step.type,
          status: response.success ? "completed" : "failed",
          result: response.result,
          error: response.error,
          durationMs: Date.now() - startTime
        };
      }
      case "wait": {
        if (!step.target) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "wait step requires target element id",
            durationMs: Date.now() - startTime
          };
        }
        const waitResult = await executor.waitForElement(
          step.target,
          step.waitOptions || { visible: true, timeout: 1e4, interval: 100 }
        );
        return {
          stepId: step.id,
          type: step.type,
          status: waitResult.met ? "completed" : "failed",
          result: waitResult.state,
          error: waitResult.error,
          durationMs: Date.now() - startTime
        };
      }
      case "assert": {
        if (!step.target) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "assert step requires target element id",
            durationMs: Date.now() - startTime
          };
        }
        const element = registry.getElement(step.target);
        if (!element) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: `Element not found: ${step.target}`,
            durationMs: Date.now() - startTime
          };
        }
        const state = element.getState();
        const expected = step.params || {};
        const stateRecord = state;
        const mismatches = [];
        for (const [key, value] of Object.entries(expected)) {
          const actual = stateRecord[key];
          const isEqual = typeof value === "object" && value !== null ? JSON.stringify(actual) === JSON.stringify(value) : actual === value;
          if (!isEqual) {
            mismatches.push(
              `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`
            );
          }
        }
        return {
          stepId: step.id,
          type: step.type,
          status: mismatches.length === 0 ? "completed" : "failed",
          result: { state, mismatches },
          error: mismatches.length > 0 ? `Assertion failed: ${mismatches.join("; ")}` : void 0,
          durationMs: Date.now() - startTime
        };
      }
      case "custom": {
        if (!step.handler) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "custom step requires a handler function",
            durationMs: Date.now() - startTime
          };
        }
        const result = await step.handler();
        const failed = result && typeof result === "object" && "success" in result && result.success === false;
        return {
          stepId: step.id,
          type: step.type,
          status: failed ? "failed" : "completed",
          result,
          error: failed ? result.error || "Custom handler returned failure" : void 0,
          durationMs: Date.now() - startTime
        };
      }
      case "log": {
        const message = step.params?.message ?? step.params?.text ?? `[workflow] step ${step.id}`;
        console.log(`[ui-bridge-native] workflow log: ${message}`);
        return {
          stepId: step.id,
          type: step.type,
          status: "completed",
          result: { message },
          durationMs: Date.now() - startTime
        };
      }
      case "navigate":
      case "branch":
      case "loop":
      case "extract":
        return {
          stepId: step.id,
          type: step.type,
          status: "skipped",
          error: `Step type "${step.type}" is not yet supported in native workflow execution`,
          durationMs: Date.now() - startTime
        };
      default:
        return {
          stepId: step.id,
          type: step.type,
          status: "failed",
          error: `Unknown step type: ${step.type}`,
          durationMs: Date.now() - startTime
        };
    }
  } catch (err) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime
    };
  }
}
function success(data) {
  return {
    success: true,
    data,
    timestamp: Date.now()
  };
}
function error(message, code) {
  return {
    success: false,
    error: message,
    code,
    timestamp: Date.now()
  };
}
function createServerHandlers(registry, executor) {
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
        customActions: e.customActions ? Object.keys(e.customActions) : void 0
      }));
      return success({ elements });
    },
    getElement: async (ctx) => {
      const { id } = ctx.params;
      const element = registry.getElement(id);
      if (!element) {
        return error(`Element not found: ${id}`, "ELEMENT_NOT_FOUND");
      }
      return success({
        element: {
          id: element.id,
          type: element.type,
          label: element.label,
          identifier: element.getIdentifier(),
          state: element.getState(),
          actions: element.actions,
          customActions: element.customActions ? Object.keys(element.customActions) : void 0
        }
      });
    },
    getElementState: async (ctx) => {
      const { id } = ctx.params;
      const element = registry.getElement(id);
      if (!element) {
        return error(`Element not found: ${id}`, "ELEMENT_NOT_FOUND");
      }
      return success({ state: element.getState() });
    },
    executeAction: async (ctx) => {
      const { id } = ctx.params;
      const body = ctx.body;
      if (!body?.action) {
        return error("Action is required", "INVALID_REQUEST");
      }
      const response = await executor.executeAction(id, {
        action: body.action,
        params: body.params,
        waitOptions: body.waitOptions
      });
      if (!response.success) {
        return error(response.error || "Action failed", "ACTION_FAILED");
      }
      return success(response);
    },
    executeBatchAction: async (ctx) => {
      const body = ctx.body;
      if (!body?.steps || !Array.isArray(body.steps)) {
        return error("steps array is required", "INVALID_REQUEST");
      }
      const startTime = Date.now();
      const results = [];
      let succeededCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let stopped = false;
      const stopOnFailure = body.stopOnFailure ?? true;
      const delayBetweenMs = body.delayBetweenMs ?? 0;
      for (let i = 0; i < body.steps.length; i++) {
        if (stopped) {
          skippedCount++;
          results.push({
            index: i,
            label: body.steps[i].label,
            elementId: body.steps[i].elementId,
            response: { success: false, error: "Skipped (previous step failed)" }
          });
          continue;
        }
        const step = body.steps[i];
        if (i > 0 && delayBetweenMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayBetweenMs));
        }
        const response = await executor.executeAction(step.elementId, step.action);
        results.push({
          index: i,
          label: step.label,
          elementId: step.elementId,
          response
        });
        if (response.success) {
          succeededCount++;
        } else {
          failedCount++;
          if (stopOnFailure) stopped = true;
        }
      }
      return success({
        success: failedCount === 0,
        results,
        succeededCount,
        failedCount,
        skippedCount,
        durationMs: Date.now() - startTime,
        timestamp: Date.now()
      });
    },
    // Components
    getComponents: async () => {
      const components = registry.getAllComponents().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        actions: c.actions.map((a) => ({ id: a.id, label: a.label })),
        elementIds: c.elementIds
      }));
      return success({ components });
    },
    getComponent: async (ctx) => {
      const { id } = ctx.params;
      const component = registry.getComponent(id);
      if (!component) {
        return error(`Component not found: ${id}`, "COMPONENT_NOT_FOUND");
      }
      return success({
        component: {
          id: component.id,
          name: component.name,
          description: component.description,
          actions: component.actions.map((a) => ({
            id: a.id,
            label: a.label,
            description: a.description
          })),
          elementIds: component.elementIds
        }
      });
    },
    executeComponentAction: async (ctx) => {
      const { id, actionId } = ctx.params;
      const body = ctx.body;
      const response = await executor.executeComponentAction(id, {
        action: actionId,
        params: body?.params
      });
      if (!response.success) {
        return error(response.error || "Action failed", "ACTION_FAILED");
      }
      return success(response);
    },
    // Discovery
    find: async (ctx) => {
      const body = ctx.body;
      const response = await executor.find({
        types: body?.types,
        testIdPattern: body?.testIdPattern,
        accessibilityLabelPattern: body?.accessibilityLabelPattern,
        visibleOnly: body?.visibleOnly,
        limit: body?.limit
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
        stepCount: w.steps.length
      }));
      return success({ workflows });
    },
    runWorkflow: async (ctx) => {
      const { id } = ctx.params;
      const workflow = registry.getWorkflow(id);
      if (!workflow) {
        return error(`Workflow not found: ${id}`, "WORKFLOW_NOT_FOUND");
      }
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startTime = Date.now();
      const stepResults = [];
      let status = "completed";
      registry.emit("workflow:started", {
        runId,
        workflowId: id,
        workflowName: workflow.name,
        totalSteps: workflow.steps.length
      });
      for (const step of workflow.steps) {
        const stepResult = await executeWorkflowStep(step, registry, executor);
        stepResults.push(stepResult);
        if (stepResult.status === "completed" || stepResult.status === "skipped") {
          registry.emit("workflow:stepCompleted", {
            runId,
            workflowId: id,
            step: stepResult
          });
        }
        if (stepResult.status === "failed") {
          status = "failed";
          registry.emit("workflow:failed", {
            runId,
            workflowId: id,
            failedStep: stepResult,
            completedSteps: stepResults.length - 1,
            totalSteps: workflow.steps.length
          });
          break;
        }
      }
      if (status === "completed") {
        registry.emit("workflow:completed", {
          runId,
          workflowId: id,
          steps: stepResults,
          totalDurationMs: Date.now() - startTime
        });
      }
      return success({
        runId,
        status,
        steps: stepResults,
        totalSteps: workflow.steps.length,
        completedSteps: stepResults.filter((s) => s.status === "completed").length,
        failedSteps: stepResults.filter((s) => s.status === "failed").length,
        skippedSteps: stepResults.filter((s) => s.status === "skipped").length,
        durationMs: Date.now() - startTime
      });
    },
    // Page Navigation (stubs — React Native apps should override with their navigation provider)
    pageRefresh: async () => {
      return error("Page refresh not supported on native platform", "NOT_SUPPORTED");
    },
    pageNavigate: async () => {
      return error("Page navigation not supported on native platform", "NOT_SUPPORTED");
    },
    pageGoBack: async () => {
      return error("Page go back not supported on native platform", "NOT_SUPPORTED");
    },
    pageGoForward: async () => {
      return error("Page go forward not supported on native platform", "NOT_SUPPORTED");
    },
    // Health
    health: async () => {
      const stats = registry.getStats();
      return success({
        status: "healthy",
        timestamp: Date.now(),
        ...stats
      });
    }
  };
}

// src/native/server/http-server.ts
var NativeUIBridgeServer = class {
  constructor(registry, executor, config = {}) {
    this.registry = registry;
    this.executor = executor;
    this.running = false;
    this.config = {
      serverPort: 9876,
      cors: true,
      ...config
    };
    this.handlers = createServerHandlers(registry, executor);
  }
  /**
   * Set the server adapter
   */
  setAdapter(adapter) {
    this.adapter = adapter;
  }
  /**
   * Start the HTTP server
   */
  async start() {
    if (this.running) {
      console.warn("[ui-bridge-native] Server already running");
      return;
    }
    if (!this.adapter) {
      console.warn("[ui-bridge-native] No server adapter configured. Call setAdapter() first.");
      console.warn("[ui-bridge-native] See documentation for supported adapters.");
      return;
    }
    await this.adapter.start(this.config.serverPort, this.handleRequest.bind(this));
    this.running = true;
    console.log(`[ui-bridge-native] HTTP server started on port ${this.config.serverPort}`);
  }
  /**
   * Stop the HTTP server
   */
  async stop() {
    if (!this.running || !this.adapter) {
      return;
    }
    await this.adapter.stop();
    this.running = false;
    console.log("[ui-bridge-native] HTTP server stopped");
  }
  /**
   * Check if server is running
   */
  isRunning() {
    return this.running;
  }
  /**
   * Handle incoming HTTP request
   */
  async handleRequest(request) {
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.config.cors) {
      headers["Access-Control-Allow-Origin"] = this.config.allowedOrigins ? this.config.allowedOrigins.join(",") : "*";
      headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    }
    if (request.method === "OPTIONS") {
      return { status: 204, headers, body: "" };
    }
    try {
      const response = await this.routeRequest(request);
      return {
        status: response.success ? 200 : 400,
        headers,
        body: JSON.stringify(response)
      };
    } catch (error2) {
      const errorResponse = {
        success: false,
        error: error2 instanceof Error ? error2.message : "Internal server error",
        code: "INTERNAL_ERROR",
        timestamp: Date.now()
      };
      return {
        status: 500,
        headers,
        body: JSON.stringify(errorResponse)
      };
    }
  }
  /**
   * Route request to appropriate handler
   */
  async routeRequest(request) {
    const { method, path, query, body } = request;
    const parsePath = (pattern, actual) => {
      const patternParts = pattern.split("/");
      const actualParts = actual.split("/");
      if (patternParts.length !== actualParts.length) {
        return null;
      }
      const params2 = {};
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(":")) {
          params2[patternParts[i].slice(1)] = actualParts[i];
        } else if (patternParts[i] !== actualParts[i]) {
          return null;
        }
      }
      return params2;
    };
    if (method === "GET" && path === "/ui-bridge/health") {
      return this.handlers.health({ params: {}, query, body });
    }
    if (method === "GET" && path === "/ui-bridge/control/elements") {
      return this.handlers.getElements({ params: {}, query, body });
    }
    let params = parsePath("/ui-bridge/control/element/:id", path);
    if (method === "GET" && params) {
      return this.handlers.getElement({ params, query, body });
    }
    params = parsePath("/ui-bridge/control/element/:id/state", path);
    if (method === "GET" && params) {
      return this.handlers.getElementState({ params, query, body });
    }
    params = parsePath("/ui-bridge/control/element/:id/action", path);
    if (method === "POST" && params) {
      return this.handlers.executeAction({ params, query, body });
    }
    if (method === "POST" && path === "/ui-bridge/control/batch-actions") {
      return this.handlers.executeBatchAction({ params: {}, query, body });
    }
    if (method === "GET" && path === "/ui-bridge/control/components") {
      return this.handlers.getComponents({ params: {}, query, body });
    }
    params = parsePath("/ui-bridge/control/component/:id", path);
    if (method === "GET" && params) {
      return this.handlers.getComponent({ params, query, body });
    }
    params = parsePath("/ui-bridge/control/component/:id/action/:actionId", path);
    if (method === "POST" && params) {
      return this.handlers.executeComponentAction({ params, query, body });
    }
    if (method === "POST" && path === "/ui-bridge/control/find") {
      return this.handlers.find({ params: {}, query, body });
    }
    if (method === "GET" && path === "/ui-bridge/control/snapshot") {
      return this.handlers.getSnapshot({ params: {}, query, body });
    }
    if (method === "GET" && path === "/ui-bridge/control/workflows") {
      return this.handlers.getWorkflows({ params: {}, query, body });
    }
    params = parsePath("/ui-bridge/control/workflow/:id/run", path);
    if (method === "POST" && params) {
      return this.handlers.runWorkflow({ params, query, body });
    }
    return {
      success: false,
      error: `Route not found: ${method} ${path}`,
      code: "NOT_FOUND",
      timestamp: Date.now()
    };
  }
};
function createNativeServer(registry, executor, config) {
  return new NativeUIBridgeServer(registry, executor, config);
}

exports.NativeUIBridgeServer = NativeUIBridgeServer;
exports.UI_BRIDGE_NATIVE_ROUTES = UI_BRIDGE_NATIVE_ROUTES;
exports.createNativeServer = createNativeServer;
exports.createServerHandlers = createServerHandlers;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map