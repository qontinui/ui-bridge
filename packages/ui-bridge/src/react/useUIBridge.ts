/**
 * useUIBridge Hook
 *
 * Main hook for accessing UI Bridge functionality.
 */

import { useCallback, useMemo } from 'react';
import type {
  RegisteredElement,
  RegisteredComponent,
  BridgeSnapshot,
  ElementState,
  Workflow,
} from '../core/types';
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  DiscoveryRequest,
  DiscoveryResponse,
  WorkflowRunRequest,
  WorkflowRunResponse,
} from '../control/types';
import { useUIBridgeContext, useUIBridgeOptional } from './UIBridgeProvider';

/**
 * useUIBridge return value
 */
export interface UseUIBridgeReturn {
  /** Whether UI Bridge is available */
  available: boolean;
  /** Whether initialized */
  initialized: boolean;
  /** Get all registered elements */
  elements: RegisteredElement[];
  /** Get all registered components */
  components: RegisteredComponent[];
  /** Get all workflows */
  workflows: Workflow[];
  /** Create a snapshot of the current state */
  createSnapshot: () => BridgeSnapshot;
  /** Execute an action on an element */
  executeAction: (
    elementId: string,
    request: ControlActionRequest
  ) => Promise<ControlActionResponse>;
  /** Execute an action on a component */
  executeComponentAction: (
    componentId: string,
    request: ComponentActionRequest
  ) => Promise<ComponentActionResponse>;
  /** Discover controllable elements */
  discover: (options?: DiscoveryRequest) => Promise<DiscoveryResponse>;
  /** Run a workflow */
  runWorkflow: (workflowId: string, request?: WorkflowRunRequest) => Promise<WorkflowRunResponse>;
  /** Get element by ID */
  getElement: (id: string) => RegisteredElement | undefined;
  /** Get component by ID */
  getComponent: (id: string) => RegisteredComponent | undefined;
  /** Get element state by ID */
  getElementState: (id: string) => ElementState | undefined;
  /** Register a workflow */
  registerWorkflow: (workflow: Workflow) => void;
  /** Unregister a workflow */
  unregisterWorkflow: (id: string) => void;
  /** Capture a render log snapshot (if enabled) */
  captureRenderLog: () => Promise<void>;
  /** Get render log entries (if enabled) */
  getRenderLogEntries: () => Promise<unknown[]>;
  /** Clear render log (if enabled) */
  clearRenderLog: () => Promise<void>;
  /** Get metrics (if debug enabled) */
  getMetrics: () => unknown | undefined;
  /** Get action history (if debug enabled) */
  getActionHistory: () => unknown[] | undefined;
}

/**
 * useUIBridge hook
 *
 * Main hook for accessing UI Bridge functionality.
 * Use this to interact with registered elements, components, and workflows.
 *
 * @example
 * ```tsx
 * function AutomationController() {
 *   const bridge = useUIBridge();
 *
 *   const handleSubmit = async () => {
 *     // Execute element action
 *     await bridge.executeAction('submit-btn', { action: 'click' });
 *
 *     // Or use component action
 *     await bridge.executeComponentAction('login-form', {
 *       action: 'login',
 *       params: { email: 'user@example.com', password: 'secret' },
 *     });
 *   };
 *
 *   return (
 *     <button onClick={handleSubmit}>
 *       Automate Login
 *     </button>
 *   );
 * }
 * ```
 */
export function useUIBridge(): UseUIBridgeReturn {
  const context = useUIBridgeOptional();

  const available = !!context;
  const initialized = context?.initialized ?? false;

  // Get collections
  const elements = useMemo(() => context?.getElements() ?? [], [context]);

  const components = useMemo(() => context?.getComponents() ?? [], [context]);

  const workflows = useMemo(() => context?.registry.getAllWorkflows() ?? [], [context]);

  // Create snapshot
  const createSnapshot = useCallback((): BridgeSnapshot => {
    if (!context) {
      return {
        timestamp: Date.now(),
        elements: [],
        components: [],
        workflows: [],
      };
    }
    return context.createSnapshot();
  }, [context]);

  // Execute element action
  const executeAction = useCallback(
    async (elementId: string, request: ControlActionRequest): Promise<ControlActionResponse> => {
      if (!context) {
        return {
          success: false,
          error: 'UI Bridge not available',
          durationMs: 0,
          timestamp: Date.now(),
        };
      }
      return context.executor.executeAction(elementId, request);
    },
    [context]
  );

  // Execute component action
  const executeComponentAction = useCallback(
    async (
      componentId: string,
      request: ComponentActionRequest
    ): Promise<ComponentActionResponse> => {
      if (!context) {
        return {
          success: false,
          error: 'UI Bridge not available',
          durationMs: 0,
          timestamp: Date.now(),
        };
      }
      return context.executor.executeComponentAction(componentId, request);
    },
    [context]
  );

  // Discover elements
  const discover = useCallback(
    async (options?: DiscoveryRequest): Promise<DiscoveryResponse> => {
      if (!context) {
        return {
          elements: [],
          total: 0,
          durationMs: 0,
          timestamp: Date.now(),
        };
      }
      return context.executor.discover(options);
    },
    [context]
  );

  // Run workflow
  const runWorkflow = useCallback(
    async (workflowId: string, request?: WorkflowRunRequest): Promise<WorkflowRunResponse> => {
      if (!context) {
        return {
          workflowId,
          runId: '',
          status: 'failed',
          steps: [],
          totalSteps: 0,
          success: false,
          error: 'UI Bridge not available',
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 0,
        };
      }
      return context.workflowEngine.run(workflowId, request);
    },
    [context]
  );

  // Get element by ID
  const getElement = useCallback(
    (id: string): RegisteredElement | undefined => {
      return context?.registry.getElement(id);
    },
    [context]
  );

  // Get component by ID
  const getComponent = useCallback(
    (id: string): RegisteredComponent | undefined => {
      return context?.registry.getComponent(id);
    },
    [context]
  );

  // Get element state
  const getElementState = useCallback(
    (id: string): ElementState | undefined => {
      const element = context?.registry.getElement(id);
      return element?.getState();
    },
    [context]
  );

  // Register workflow
  const registerWorkflow = useCallback(
    (workflow: Workflow): void => {
      context?.registry.registerWorkflow(workflow);
    },
    [context]
  );

  // Unregister workflow
  const unregisterWorkflow = useCallback(
    (id: string): void => {
      context?.registry.unregisterWorkflow(id);
    },
    [context]
  );

  // Render log methods
  const captureRenderLog = useCallback(async (): Promise<void> => {
    await context?.renderLog?.captureSnapshot();
  }, [context]);

  const getRenderLogEntries = useCallback(async (): Promise<unknown[]> => {
    return (await context?.renderLog?.getEntries()) ?? [];
  }, [context]);

  const clearRenderLog = useCallback(async (): Promise<void> => {
    await context?.renderLog?.clear();
  }, [context]);

  // Metrics methods
  const getMetrics = useCallback((): unknown | undefined => {
    return context?.metrics?.getMetrics();
  }, [context]);

  const getActionHistory = useCallback((): unknown[] | undefined => {
    return context?.metrics?.getHistory();
  }, [context]);

  return {
    available,
    initialized,
    elements,
    components,
    workflows,
    createSnapshot,
    executeAction,
    executeComponentAction,
    discover,
    runWorkflow,
    getElement,
    getComponent,
    getElementState,
    registerWorkflow,
    unregisterWorkflow,
    captureRenderLog,
    getRenderLogEntries,
    clearRenderLog,
    getMetrics,
    getActionHistory,
  };
}

/**
 * useUIBridgeRequired hook
 *
 * Same as useUIBridge but throws if UI Bridge is not available.
 */
export function useUIBridgeRequired(): UseUIBridgeReturn {
  useUIBridgeContext(); // Will throw if not in provider
  return useUIBridge();
}
