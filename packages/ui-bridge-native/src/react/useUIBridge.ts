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
import { useUIBridgeNativeOptional } from './UIBridgeNativeProvider';

/**
 * Component action request
 */
export interface ComponentActionRequest {
  /** Action ID */
  action: string;
  /** Action parameters */
  params?: Record<string, unknown>;
}

/**
 * Component action response
 */
export interface ComponentActionResponse {
  /** Whether the action succeeded */
  success: boolean;
  /** Result of the action */
  result?: unknown;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}

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
  executeAction: (
    elementId: string,
    request: NativeActionRequest
  ) => Promise<NativeActionResponse>;
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
  const elements = useMemo(
    () => (bridge ? bridge.getElements() : []),
    [bridge]
  );

  // Get components
  const components = useMemo(
    () => (bridge ? bridge.getComponents() : []),
    [bridge]
  );

  // Get workflows
  const workflows = useMemo(
    () => (bridge ? bridge.registry.getAllWorkflows() : []),
    [bridge]
  );

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
    async (
      elementId: string,
      request: NativeActionRequest
    ): Promise<NativeActionResponse> => {
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
  const getElement = useCallback(
    (id: string) => bridge?.registry.getElement(id),
    [bridge]
  );

  // Get component
  const getComponent = useCallback(
    (id: string) => bridge?.registry.getComponent(id),
    [bridge]
  );

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
