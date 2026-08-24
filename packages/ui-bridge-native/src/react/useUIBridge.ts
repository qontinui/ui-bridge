/**
 * useUIBridge Hook for React Native
 *
 * Provides a simplified interface for common UI Bridge operations.
 */

import { useCallback, useMemo } from 'react';
import type {
  NativeActionRequest,
  NativeActionResponse,
  NativeFindRequest,
  NativeFindResponse,
  NativeBridgeSnapshot,
  RegisteredNativeElement,
  RegisteredNativeComponent,
  Workflow,
} from '../core/types';
import type { ComponentActionRequest, ComponentActionResponse } from '../control/types';
import { useUIBridgeNativeOptional } from './UIBridgeNativeProvider';

/**
 * Component action request / response.
 *
 * Re-exported from `../control/types` rather than re-declared. These were a
 * fifth and sixth copy of a shape that already existed there, and the copy had
 * already drifted: it carried neither `requestId` nor `timeoutMs`, so a React
 * Native caller reaching an action through this hook could not set a timeout
 * even though `DefaultNativeActionExecutor` has honoured one since Phase 3 of
 * plan `2026-08-20-ui-bridge-action-declaration-shape`. The executor accepted
 * it; the hook's own type refused to express it.
 *
 * `timeoutMs` is the only cancellation this seam can carry — an `AbortSignal`
 * is not JSON-serializable, and the hook does not forward the executor's
 * in-process `{ signal }` option bag.
 *
 * Collapsing rather than adding the two fields is the plan's stated direction:
 * "collapse before you extend", because eight copies drift and two already
 * had.
 */
export type {
  ComponentActionRequest,
  ComponentActionResponse,
} from '../control/types';

/**
 * useUIBridge return type
 */
export interface UseUIBridgeReturn {
  /** Whether UI Bridge is available */
  available: boolean;
  /** Whether UI Bridge is initialized */
  initialized: boolean;
  /** All registered elements */
  elements: RegisteredNativeElement[];
  /** All registered components */
  components: RegisteredNativeComponent[];
  /** All registered workflows */
  workflows: Workflow[];
  /** Create a snapshot of the current state */
  createSnapshot: () => NativeBridgeSnapshot;
  /** Execute an action on an element */
  executeAction: (elementId: string, request: NativeActionRequest) => Promise<NativeActionResponse>;
  /** Execute a component action */
  executeComponentAction: (
    componentId: string,
    request: ComponentActionRequest
  ) => Promise<ComponentActionResponse>;
  /** Find elements */
  find: (request?: NativeFindRequest) => Promise<NativeFindResponse>;
  /** Get an element by ID */
  getElement: (id: string) => RegisteredNativeElement | undefined;
  /** Get a component by ID */
  getComponent: (id: string) => RegisteredNativeComponent | undefined;
  /** Get element state by ID */
  getElementState: (id: string) => ReturnType<RegisteredNativeElement['getState']> | null;
  /** Register a workflow */
  registerWorkflow: (workflow: Workflow) => void;
  /** Unregister a workflow */
  unregisterWorkflow: (id: string) => void;
}

/**
 * useUIBridge hook
 *
 * Provides a simplified interface for accessing UI Bridge functionality.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { available, elements, executeAction, find } = useUIBridge();
 *
 *   if (!available) {
 *     return <Text>UI Bridge not available</Text>;
 *   }
 *
 *   const handlePress = async () => {
 *     // Find all buttons
 *     const result = await find({ types: ['button'] });
 *     console.log('Found buttons:', result.elements);
 *
 *     // Execute action on specific element
 *     await executeAction('submit-btn', { action: 'press' });
 *   };
 *
 *   return (
 *     <View>
 *       <Text>Elements: {elements.length}</Text>
 *       <Button title="Press" onPress={handlePress} />
 *     </View>
 *   );
 * }
 * ```
 */
export function useUIBridge(): UseUIBridgeReturn {
  const bridge = useUIBridgeNativeOptional();

  const available = bridge !== null;
  const initialized = bridge?.initialized ?? false;

  // Get elements
  const elements = useMemo(() => (bridge ? bridge.getElements() : []), [bridge]);

  // Get components
  const components = useMemo(() => (bridge ? bridge.getComponents() : []), [bridge]);

  // Get workflows
  const workflows = useMemo(() => (bridge ? bridge.registry.getAllWorkflows() : []), [bridge]);

  // Create snapshot
  const createSnapshot = useCallback((): NativeBridgeSnapshot => {
    if (!bridge) {
      return {
        timestamp: Date.now(),
        elements: [],
        components: [],
        workflows: [],
      };
    }
    return bridge.createSnapshot();
  }, [bridge]);

  // Execute action
  const executeAction = useCallback(
    async (elementId: string, request: NativeActionRequest): Promise<NativeActionResponse> => {
      if (!bridge) {
        return {
          success: false,
          error: 'UI Bridge not available',
          durationMs: 0,
          timestamp: Date.now(),
        };
      }
      return bridge.executor.executeAction(elementId, request);
    },
    [bridge]
  );

  // Execute component action
  const executeComponentAction = useCallback(
    async (
      componentId: string,
      request: ComponentActionRequest
    ): Promise<ComponentActionResponse> => {
      if (!bridge) {
        return {
          success: false,
          error: 'UI Bridge not available',
          durationMs: 0,
          timestamp: Date.now(),
        };
      }
      return bridge.executor.executeComponentAction(componentId, request);
    },
    [bridge]
  );

  // Find elements
  const find = useCallback(
    async (request?: NativeFindRequest): Promise<NativeFindResponse> => {
      if (!bridge) {
        return {
          elements: [],
          total: 0,
          durationMs: 0,
          timestamp: Date.now(),
        };
      }
      return bridge.executor.find(request || {});
    },
    [bridge]
  );

  // Get element
  const getElement = useCallback((id: string) => bridge?.registry.getElement(id), [bridge]);

  // Get component
  const getComponent = useCallback((id: string) => bridge?.registry.getComponent(id), [bridge]);

  // Get element state
  const getElementState = useCallback(
    (id: string) => {
      const element = bridge?.registry.getElement(id);
      return element?.getState() ?? null;
    },
    [bridge]
  );

  // Register workflow
  const registerWorkflow = useCallback(
    (workflow: Workflow) => {
      bridge?.registry.registerWorkflow(workflow);
    },
    [bridge]
  );

  // Unregister workflow
  const unregisterWorkflow = useCallback(
    (id: string) => {
      bridge?.registry.unregisterWorkflow(id);
    },
    [bridge]
  );

  return {
    available,
    initialized,
    elements,
    components,
    workflows,
    createSnapshot,
    executeAction,
    executeComponentAction,
    find,
    getElement,
    getComponent,
    getElementState,
    registerWorkflow,
    unregisterWorkflow,
  };
}

/**
 * useUIBridgeRequired hook
 *
 * Same as useUIBridge but throws if not available.
 */
export function useUIBridgeRequired(): UseUIBridgeReturn {
  const result = useUIBridge();
  if (!result.available) {
    throw new Error('useUIBridgeRequired must be used within a UIBridgeNativeProvider');
  }
  return result;
}
