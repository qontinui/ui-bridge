/**
 * UI Bridge Native Server Handlers
 *
 * Request handlers for the HTTP API endpoints.
 */

import { type NativeUIBridgeRegistry, extractHandlerNames } from '../core/registry';
import type {
  NativeElementType,
  NativeLayout,
  NativeModalInfo,
  WaitOptions,
  WorkflowStep,
} from '../core/types';
import type { NativeActionExecutor } from '../control/types';
import type {
  APIResponse,
  ConsoleErrorsResponse,
  DismissModalResponse,
  FillFormFieldInput,
  FillFormFieldResult,
  FillFormResponse,
  HandlerContext,
  NativeServerHandlers,
  NetworkRequestsResponse,
  PushModalRequest,
  PushModalResponse,
  TapAtResponse,
} from './types';
import { createDesignHandlers } from './design-handlers';
import type { ConsoleErrorBuffer, NetworkRequestBuffer } from './observability';
import { diagnosePageHealth, type PageHealthElement } from './page-health';

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
 * Read `Dimensions.get('window')` from a SYNCHRONOUS context.
 *
 * Metro's `require()` inside an `async` function is uncatchable — a missing
 * module throws past any local `try`/`catch` and the error tears down the JS
 * thread. Calling this from inside an async handler isolates the require()
 * inside this sync frame, where the try/catch actually catches.
 *
 * Mirrors `getScreenDimensions()` in design-handlers.ts. Returns `{0,0}`
 * under Node / vitest where react-native isn't available; callers should
 * treat that as a "viewport unknown" signal.
 */
function getWindowDimensions(): { width: number; height: number } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Dimensions } = require('react-native');
    const win = Dimensions.get('window');
    return { width: win.width, height: win.height };
  } catch {
    return { width: 0, height: 0 };
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
  config?: {
    appInfo?: { appId: string; appName: string; appType: string; framework?: string };
    /** Optional console-error ring buffer powering `GET /control/console-errors`. */
    consoleErrorBuffer?: ConsoleErrorBuffer;
    /** Optional network-request ring buffer powering `GET /sdk/network-requests`. */
    networkRequestBuffer?: NetworkRequestBuffer;
  }
): NativeServerHandlers {
  const designHandlers = createDesignHandlers(registry);

  return {
    // Elements
    getElements: async (ctx: HandlerContext) => {
      const visibleOnly =
        ctx.query?.visibleOnly === 'true' ||
        (ctx.body as Record<string, unknown>)?.visibleOnly === true;
      const forRoute = (ctx.query?.route || (ctx.body as Record<string, unknown>)?.route) as
        | string
        | undefined;

      // visibleOnly uses the looser mounted-visible filter so callers don't
      // miss elements whose first `onLayout` hasn't fired yet. Each element
      // carries a `visibility` field (`"visible"` / `"likely-visible"`) so
      // agents can branch on measured vs unmeasured downstream.
      let allElements = visibleOnly
        ? registry.getMountedVisibleElements()
        : registry.getAllElements();

      // Filter by specific route (injected by setRouteProvider override when currentRouteOnly is set)
      if (forRoute) {
        allElements = allElements.filter((e) => e.registrationRoute === forRoute);
      }

      const elements = allElements.map((e) => {
        const handlers = extractHandlerNames(e.props);
        const state = e.getState();
        const visibility: 'visible' | 'likely-visible' | 'hidden' = !state.visible
          ? 'hidden'
          : state.layout !== null
            ? 'visible'
            : 'likely-visible';
        return {
          id: e.id,
          type: e.type,
          label: e.label,
          identifier: e.getIdentifier(),
          state,
          actions: e.actions,
          customActions: e.customActions ? Object.keys(e.customActions) : undefined,
          registeredHandlers: handlers.length > 0 ? handlers : undefined,
          registrationRoute: e.registrationRoute,
          visibility,
        };
      });

      return success({ elements });
    },

    getElement: async (ctx: HandlerContext) => {
      const { id } = ctx.params;
      const element = registry.getElement(id);

      if (!element) {
        return error(`Element not found: ${id}`, 'ELEMENT_NOT_FOUND');
      }

      const handlers = extractHandlerNames(element.props);

      return success({
        element: {
          id: element.id,
          type: element.type,
          label: element.label,
          identifier: element.getIdentifier(),
          state: element.getState(),
          actions: element.actions,
          customActions: element.customActions ? Object.keys(element.customActions) : undefined,
          registeredHandlers: handlers.length > 0 ? handlers : undefined,
          registrationRoute: element.registrationRoute,
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
        waitOptions?: WaitOptions;
      };

      if (!body?.action) {
        return error('Action is required', 'INVALID_REQUEST');
      }

      const response = await executor.executeAction(id, {
        action: body.action,
        params: body.params,
        waitOptions: body.waitOptions,
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
    //
    // Native parity with the runner's `POST /ui-bridge/ai/find`. The runner
    // matches a free-text `query` against label > text > value > aria-label >
    // placeholder > name. We replicate that here against the native registry's
    // analogues:
    //   1. `label` (the registered display label)
    //   2. identifier fields: `testId`, `accessibilityLabel`, `treePath`, `uiId`
    //   3. registered handler names (e.g. `onPress`, `onChangeText`)
    //
    // Match is case-insensitive substring. Empty/missing query falls back to
    // the structured filters (types/visibleOnly/etc.) so callers that don't
    // pass `query` still get the legacy behaviour. Once we've narrowed by
    // query the response is shaped through the executor's NativeFindResponse
    // envelope so the wire format stays stable.
    find: async (ctx: HandlerContext) => {
      const body = ctx.body as {
        query?: string;
        types?: NativeElementType[];
        testIdPattern?: string;
        accessibilityLabelPattern?: string;
        visibleOnly?: boolean;
        limit?: number;
      };

      const response = await executor.find({
        types: body?.types,
        testIdPattern: body?.testIdPattern,
        accessibilityLabelPattern: body?.accessibilityLabelPattern,
        visibleOnly: body?.visibleOnly,
        // When `query` is supplied we apply our own limit *after* ranking so
        // the highest-priority matches survive the cap; defer slicing to us
        // by widening here.
        limit: body?.query && body.query.length > 0 ? undefined : body?.limit,
      });

      const rawQuery = typeof body?.query === 'string' ? body.query.trim() : '';
      if (rawQuery.length === 0) {
        return success(response);
      }

      const needle = rawQuery.toLowerCase();
      const containsNeedle = (value: unknown): boolean =>
        typeof value === 'string' && value.toLowerCase().includes(needle);

      // Score each discovered element by best-priority field match. Lower
      // priorityRank wins; ties keep registry insertion order (stable sort).
      const scored: Array<{ priorityRank: number; element: (typeof response.elements)[number] }> =
        [];

      for (const el of response.elements) {
        let priorityRank = Number.POSITIVE_INFINITY;

        // 1. label
        if (containsNeedle(el.label)) {
          priorityRank = Math.min(priorityRank, 0);
        }

        // 2. identifier fields
        const ident = el.identifier;
        if (ident) {
          if (containsNeedle(ident.testId)) priorityRank = Math.min(priorityRank, 1);
          if (containsNeedle(ident.accessibilityLabel)) priorityRank = Math.min(priorityRank, 1);
          if (containsNeedle(ident.treePath)) priorityRank = Math.min(priorityRank, 1);
          if (containsNeedle(ident.uiId)) priorityRank = Math.min(priorityRank, 1);
        }

        // 3. registered handler names — pull from the registry since the
        // discovered envelope doesn't include props.
        if (priorityRank === Number.POSITIVE_INFINITY) {
          const registered = registry.getElement(el.id);
          const handlers = extractHandlerNames(registered?.props);
          if (handlers.some((h) => h.toLowerCase().includes(needle))) {
            priorityRank = 2;
          }
        }

        if (priorityRank !== Number.POSITIVE_INFINITY) {
          scored.push({ priorityRank, element: el });
        }
      }

      scored.sort((a, b) => a.priorityRank - b.priorityRank);

      const limit = body?.limit && body.limit > 0 ? body.limit : undefined;
      const filtered = limit ? scored.slice(0, limit) : scored;

      return success({
        ...response,
        elements: filtered.map((s) => s.element),
        total: filtered.length,
      });
    },

    getSnapshot: async (ctx: HandlerContext) => {
      const visibleOnly =
        ctx.query?.visibleOnly === 'true' ||
        (ctx.body as Record<string, unknown>)?.visibleOnly === true;
      const currentRouteOnly =
        ctx.query?.currentRouteOnly === 'true' ||
        (ctx.body as Record<string, unknown>)?.currentRouteOnly === true;
      // Pass `undefined` (not `null`) for routeInfo so `createSnapshot`
      // falls back to a registry-registered route provider if one exists —
      // without that fallback, the cloud-relay / bare-server path would
      // emit `currentRoute: null` even when a `RouteTracker` was wired.
      const snapshot = registry.createSnapshot(undefined, { visibleOnly, currentRouteOnly });
      return success(snapshot);
    },

    getPageHealth: async (ctx: HandlerContext) => {
      // Viewport resolution priority:
      //   1. Explicit body.viewport — for offline analysis or replaying a
      //      snapshot from a different device.
      //   2. Dimensions.get('window') — the host app's live viewport, via
      //      a SYNC helper. The require() MUST run inside a synchronous
      //      function: Metro's `require()` inside an async function is
      //      uncatchable — try/catch around it doesn't fire, and the
      //      uncaught error tears down the JS thread. design-handlers.ts
      //      uses the same pattern (`getScreenDimensions`).
      //   3. {0,0} fallback (degrades to a coverage_pct=0 report rather
      //      than crashing the host app).
      const bodyViewport = (ctx.body as { viewport?: { width: number; height: number } })
        ?.viewport;
      const viewport = bodyViewport ?? getWindowDimensions();

      const elements: PageHealthElement[] = registry.getAllElements().map((e) => ({
        type: e.type,
        state: e.getState(),
      }));

      const report = diagnosePageHealth(elements, viewport);
      return success(report);
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

    pageReplace: async () => {
      return error('Page replace not supported on native platform', 'NOT_SUPPORTED');
    },

    pageGoBack: async () => {
      return error('Page go back not supported on native platform', 'NOT_SUPPORTED');
    },

    pageGoForward: async () => {
      return error('Page go forward not supported on native platform', 'NOT_SUPPORTED');
    },

    // Screenshot (stub — apps should override with their screen capture library)
    getScreenshot: async () => {
      return error(
        'Screenshot not supported. Provide a screenshotProvider to UIBridgeNativeProvider.',
        'NOT_SUPPORTED'
      );
    },

    // Keep-awake (stub — apps should override via setKeepAwakeProvider, which
    // the provider wires when a keepAwakeProvider prop is supplied)
    keepAwake: async () => {
      return error(
        'keep-awake not configured. Provide a keepAwakeProvider to UIBridgeNativeProvider.',
        'NOT_SUPPORTED'
      );
    },

    // AI helpers — runner-only endpoints that have no React Native analog.
    //
    // The mobile bridge mounts explicit NOT_SUPPORTED stubs at the runner's
    // cheatsheet paths so callers (and the /manual-test skill in particular)
    // get a structured envelope explaining the gap rather than a confusing
    // HTTP 404. Each error message names an in-tree mobile replacement so
    // operators aren't left guessing what to use instead.
    aiForms: async () => {
      return error<never>(
        'ai/forms (form discovery) is runner-only; mobile React Native has no DOM to walk. ' +
          'Use GET /ui-bridge/control/snapshot and filter for type === "input" instead.',
        'NOT_SUPPORTED'
      );
    },

    aiIdleStatus: async () => {
      return error<never>(
        'ai/idle-status (page-idle signal) is runner-only; mobile React Native has no DOM-mutation / network-idle signals. ' +
          'Use the registry event stream (WS subscribe to "element:registered"/"element:stateChanged") or poll /control/snapshot for stability.',
        'NOT_SUPPORTED'
      );
    },

    aiChangeBufferEnable: async () => {
      return error<never>(
        'ai/change-buffer (DOM mutation diff buffer) is runner-only; mobile React Native has no DOM. ' +
          'Use the WS event bridge (subscribe to "element:registered"/"element:unregistered"/"element:stateChanged") for change notifications.',
        'NOT_SUPPORTED'
      );
    },

    aiWaitForElement: async () => {
      return error<never>(
        'POST /ai/wait-for-element is runner-only on mobile. ' +
          'Use the WS "waitForElement" JSON-RPC method or "waitForCondition" instead — same semantics, no HTTP polling overhead.',
        'NOT_SUPPORTED'
      );
    },

    // Meta / Introspection (stub — server constructor overrides with real route table)
    getMethods: async () => {
      return error('Methods introspection not configured', 'NOT_SUPPORTED');
    },

    // AI helpers
    //
    // Mobile-side parity with the runner's `POST /ui-bridge/ai/fill-form`.
    // Each entry in `fields` is dispatched through the existing executor as a
    // `type` action with `clear: true` so the input value is replaced
    // atomically (the closest native equivalent to the web bridge's
    // "setValue" semantics — there is no `setValue` action on native).
    //
    // Failures do not short-circuit: every field is attempted, and the
    // response carries per-field success/error plus aggregate counts.
    fillForm: async (ctx: HandlerContext): Promise<APIResponse<FillFormResponse>> => {
      const body = ctx.body as { fields?: unknown } | undefined;
      const rawFields = body?.fields;

      if (!Array.isArray(rawFields)) {
        return error('Request body must include "fields" array', 'INVALID_REQUEST');
      }

      const results: FillFormFieldResult[] = [];

      for (let i = 0; i < rawFields.length; i++) {
        const field = rawFields[i] as Partial<FillFormFieldInput> | null | undefined;

        // Validate per-field shape; record the failure but keep going so the
        // caller gets a complete picture of what worked and what didn't.
        if (!field || typeof field !== 'object') {
          results.push({
            elementId: '',
            success: false,
            error: `fields[${i}] must be an object with "elementId" and "value"`,
          });
          continue;
        }

        const { elementId, value } = field;

        if (typeof elementId !== 'string' || elementId.length === 0) {
          results.push({
            elementId: typeof elementId === 'string' ? elementId : '',
            success: false,
            error: `fields[${i}] is missing a non-empty "elementId"`,
          });
          continue;
        }

        if (typeof value !== 'string') {
          results.push({
            elementId,
            success: false,
            error: `fields[${i}] is missing a string "value"`,
          });
          continue;
        }

        try {
          const response = await executor.executeAction(elementId, {
            action: 'type',
            params: { text: value, clear: true },
          });

          if (response.success) {
            results.push({ elementId, success: true });
          } else {
            results.push({
              elementId,
              success: false,
              error: response.error ?? 'Action failed',
            });
          }
        } catch (err) {
          // executor.executeAction normally captures errors itself, but a
          // bespoke executor implementation may still throw — surface that.
          results.push({
            elementId,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const succeededCount = results.filter((r) => r.success).length;
      const failedCount = results.length - succeededCount;

      return success({ results, succeededCount, failedCount });
    },

    // Coord-based tap
    //
    // Synthesizes a press at the given screen coordinates by scanning the
    // registered elements' layout rects for a containing match. We prefer the
    // *topmost* match (smallest area = innermost child) since native UIs
    // generally render parents before children, and the user's tap should
    // logically hit the leaf-most interactive element.
    //
    // Coords are interpreted in the absolute (screen) space published by
    // `measureInWindow`; we compare against `pageX/pageY` when available and
    // fall back to the layout's relative `x/y` so this works in test fixtures
    // that don't measure (the fallback only matches single-rooted screens but
    // is good enough for the unit suite).
    tapAt: async (ctx: HandlerContext): Promise<APIResponse<TapAtResponse>> => {
      const body = ctx.body as Partial<{
        x: number;
        y: number;
        action: 'press' | 'longPress' | 'doubleTap';
      }> | undefined;

      const x = body?.x;
      const y = body?.y;

      if (typeof x !== 'number' || !Number.isFinite(x)) {
        return error<TapAtResponse>('"x" must be a finite number', 'INVALID_REQUEST');
      }
      if (typeof y !== 'number' || !Number.isFinite(y)) {
        return error<TapAtResponse>('"y" must be a finite number', 'INVALID_REQUEST');
      }

      const action = body?.action ?? 'press';
      const allowedActions: ReadonlyArray<TapAtResponse['action']> = [
        'press',
        'longPress',
        'doubleTap',
      ];
      if (!allowedActions.includes(action)) {
        return error<TapAtResponse>(
          `"action" must be one of: ${allowedActions.join(', ')}`,
          'INVALID_REQUEST'
        );
      }

      // Collect all candidates whose layout rect contains (x, y). Prefer
      // pageX/pageY (absolute coords) when both are populated; fall back to
      // the relative x/y otherwise.
      type Candidate = {
        elementId: string;
        layout: NativeLayout;
        area: number;
      };
      const candidates: Candidate[] = [];

      for (const el of registry.getAllElements()) {
        const state = el.getState();
        const layout = state?.layout;
        if (!layout) continue;
        if (
          typeof layout.width !== 'number' ||
          typeof layout.height !== 'number' ||
          layout.width <= 0 ||
          layout.height <= 0
        ) {
          continue;
        }

        const hasPage =
          typeof layout.pageX === 'number' &&
          typeof layout.pageY === 'number' &&
          Number.isFinite(layout.pageX) &&
          Number.isFinite(layout.pageY);

        const left = hasPage ? layout.pageX : layout.x;
        const top = hasPage ? layout.pageY : layout.y;

        if (
          x >= left &&
          x <= left + layout.width &&
          y >= top &&
          y <= top + layout.height
        ) {
          candidates.push({
            elementId: el.id,
            layout,
            area: layout.width * layout.height,
          });
        }
      }

      if (candidates.length === 0) {
        return error<TapAtResponse>(
          `No element registered at (${x}, ${y})`,
          'no_element_at_coords'
        );
      }

      // Topmost = smallest area. Stable sort preserves registration order for
      // ties, so a parent and a same-size child won't flip non-deterministically.
      candidates.sort((a, b) => a.area - b.area);
      const target = candidates[0];

      const response = await executor.executeAction(target.elementId, { action });
      if (!response.success) {
        return error<TapAtResponse>(response.error || 'Action failed', 'ACTION_FAILED');
      }

      return success<TapAtResponse>({
        elementId: target.elementId,
        action,
        layout: {
          x: target.layout.x,
          y: target.layout.y,
          width: target.layout.width,
          height: target.layout.height,
          pageX: target.layout.pageX,
          pageY: target.layout.pageY,
        },
      });
    },

    // Observability — console error / network request ring buffers.
    //
    // The buffers are owned by NativeUIBridgeServer and patched onto the
    // globals on `start()` (gated behind `features.testHooks`). When no
    // buffer is provided (no testHooks, or a stripped-down server fixture),
    // these handlers gracefully return empty arrays so callers can probe
    // without 500ing.
    getConsoleErrors: async (ctx: HandlerContext): Promise<APIResponse<ConsoleErrorsResponse>> => {
      const buf = config?.consoleErrorBuffer;
      const since = ctx.query?.since !== undefined ? Number(ctx.query.since) : undefined;
      const limit = ctx.query?.limit !== undefined ? Number(ctx.query.limit) : undefined;

      if (!buf) {
        return success<ConsoleErrorsResponse>({
          entries: [],
          count: 0,
          bufferSize: 0,
        });
      }

      const entries = buf.entries({
        since: typeof since === 'number' && Number.isFinite(since) ? since : undefined,
        limit: typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined,
      });

      return success<ConsoleErrorsResponse>({
        entries,
        count: entries.length,
        bufferSize: buf.size(),
      });
    },

    getNetworkRequests: async (
      ctx: HandlerContext
    ): Promise<APIResponse<NetworkRequestsResponse>> => {
      const buf = config?.networkRequestBuffer;
      const since = ctx.query?.since !== undefined ? Number(ctx.query.since) : undefined;
      const limit = ctx.query?.limit !== undefined ? Number(ctx.query.limit) : undefined;

      if (!buf) {
        return success<NetworkRequestsResponse>({
          entries: [],
          count: 0,
          bufferSize: 0,
        });
      }

      const entries = buf.entries({
        since: typeof since === 'number' && Number.isFinite(since) ? since : undefined,
        limit: typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined,
      });

      return success<NetworkRequestsResponse>({
        entries,
        count: entries.length,
        bufferSize: buf.size(),
      });
    },

    // Test hooks — modal stack manipulation
    //
    // These two endpoints exist so external automation runners can drive
    // ModalDetector state via HTTP, mirroring the in-tree `pushModal` /
    // `dismissModal` calls that components normally make. They're gated by
    // `features.testHooks` at the route layer (see http-server.ts); the
    // handlers themselves still defend against a missing modalDetector
    // because the bare server path used by CloudRelayClient may run before
    // enrichers are wired.
    pushModal: async (ctx: HandlerContext): Promise<APIResponse<PushModalResponse>> => {
      const detector = registry.getEnrichers().modalDetector;
      if (!detector) {
        return error<PushModalResponse>(
          'modal detector not registered',
          'ENRICHER_UNAVAILABLE'
        );
      }

      const body = ctx.body as Partial<PushModalRequest> | undefined;
      const id = body?.id;
      if (typeof id !== 'string' || id.length === 0) {
        return error<PushModalResponse>(
          'pushModal requires a non-empty "id"',
          'INVALID_REQUEST'
        );
      }

      const allowedTypes = ['modal', 'sheet', 'drawer', 'popover', 'alertdialog', 'dialog'];
      const requestedType = body?.type;
      if (
        requestedType !== undefined &&
        (typeof requestedType !== 'string' || !allowedTypes.includes(requestedType))
      ) {
        return error<PushModalResponse>(
          `pushModal "type" must be one of: ${allowedTypes.join(', ')}`,
          'INVALID_REQUEST'
        );
      }

      detector.pushModal({
        id,
        title: body?.title,
        // requestedType is narrowed by the allowedTypes guard above; the cast
        // converts the validated string to the NativeModalInfo['type'] union.
        type: requestedType as NativeModalInfo['type'] | undefined,
        blocking: body?.blocking,
        dismissible: body?.dismissible,
      });

      // Pull the canonicalised entry back out so the response reflects what's
      // actually in the stack (defaults applied, detectedAt populated).
      const stored = detector.getActive().find((m) => m.id === id);
      return success<PushModalResponse>({
        pushed: true,
        id,
        title: stored?.title,
        type: stored?.type,
        blocking: stored?.blocking,
        dismissible: stored?.dismissible,
        pushedAt: stored?.detectedAt ?? Date.now(),
      });
    },

    dismissModal: async (ctx: HandlerContext): Promise<APIResponse<DismissModalResponse>> => {
      const detector = registry.getEnrichers().modalDetector;
      if (!detector) {
        return error<DismissModalResponse>(
          'modal detector not registered',
          'ENRICHER_UNAVAILABLE'
        );
      }

      const { id } = ctx.params;
      if (typeof id !== 'string' || id.length === 0) {
        return error<DismissModalResponse>(
          'dismissModal requires a modal id in the path',
          'INVALID_REQUEST'
        );
      }

      // The slot type allows `dismissModal` to return either `boolean` (the
      // canonical ModalDetector class) or `void` (legacy/duck-typed impls).
      // Probe via `getActive()` first so the result is consistent regardless
      // of the implementation's return signal.
      const wasPresent = detector.getActive().some((m) => m.id === id);
      if (!wasPresent) {
        return error<DismissModalResponse>(`modal not found: ${id}`, 'MODAL_NOT_FOUND');
      }

      detector.dismissModal(id);
      return success<DismissModalResponse>({ dismissed: id });
    },

    // Design Review
    ...designHandlers,

    // Health
    health: async () => {
      const stats = registry.getStats();
      const registration = registry.getRegistrationCoverage();
      const response: Record<string, unknown> = {
        status: 'healthy',
        timestamp: Date.now(),
        ...stats,
        registration,
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

      return success(response);
    },
  };
}
