/**
 * useUIComponent Hook
 *
 * Register a component with UI Bridge for component-level actions.
 */

import { useEffect, useCallback, useRef, useMemo } from 'react';
import type { RegisteredComponent } from '../core/types';
import { useUIBridgeOptional } from './UIBridgeProvider';

/**
 * Action definition for useUIComponent
 */
export interface ComponentActionDef<TParams = unknown, TResult = unknown> {
  /** Action identifier */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Description */
  description?: string;
  /** Handler function */
  handler: (params?: TParams) => TResult | Promise<TResult>;
}

/**
 * useUIComponent options
 */
export interface UseUIComponentOptions {
  /** Unique identifier for the component */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description?: string;
  /** Actions available on this component */
  actions?: ComponentActionDef[];
  /** Child element IDs owned by this component */
  elementIds?: string[];
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
}

/**
 * useUIComponent return value
 */
export interface UseUIComponentReturn {
  /** Whether the component is registered */
  registered: boolean;
  /** Execute an action on this component */
  executeAction: <TParams = unknown, TResult = unknown>(
    actionId: string,
    params?: TParams
  ) => Promise<TResult>;
  /** Manually register the component */
  register: () => void;
  /** Manually unregister the component */
  unregister: () => void;
  /** Update actions dynamically */
  updateActions: (actions: ComponentActionDef[]) => void;
  /** Add an element ID to this component */
  addElement: (elementId: string) => void;
  /** Remove an element ID from this component */
  removeElement: (elementId: string) => void;
  /** The registered component info */
  registeredComponent: RegisteredComponent | null;
}

/**
 * useUIComponent hook
 *
 * Registers a component with UI Bridge for component-level control.
 * Components can expose high-level actions that may orchestrate multiple element interactions.
 *
 * @example
 * ```tsx
 * function LoginForm() {
 *   const [email, setEmail] = useState('');
 *   const [password, setPassword] = useState('');
 *
 *   useUIComponent({
 *     id: 'login-form',
 *     name: 'Login Form',
 *     actions: [
 *       {
 *         id: 'login',
 *         label: 'Submit Login',
 *         handler: async ({ email, password }) => {
 *           setEmail(email);
 *           setPassword(password);
 *           await submitLogin();
 *         },
 *       },
 *       {
 *         id: 'clear',
 *         label: 'Clear Form',
 *         handler: () => {
 *           setEmail('');
 *           setPassword('');
 *         },
 *       },
 *     ],
 *   });
 *
 *   return (
 *     <form>
 *       <input value={email} onChange={(e) => setEmail(e.target.value)} />
 *       <input value={password} onChange={(e) => setPassword(e.target.value)} />
 *       <button type="submit">Login</button>
 *     </form>
 *   );
 * }
 * ```
 */
export function useUIComponent(options: UseUIComponentOptions): UseUIComponentReturn {
  const bridge = useUIBridgeOptional();
  const registeredRef = useRef(false);
  const actionsRef = useRef(options.actions || []);
  const elementIdsRef = useRef(options.elementIds || []);

  const { id, name, description, autoRegister = true } = options;

  // Update refs when options change
  useEffect(() => {
    actionsRef.current = options.actions || [];
    elementIdsRef.current = options.elementIds || [];
  }, [options.actions, options.elementIds]);

  // Register the component
  const register = useCallback(() => {
    if (!bridge || registeredRef.current) return;

    bridge.registry.registerComponent(id, {
      name,
      description,
      actions: actionsRef.current.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        handler: a.handler,
      })),
      elementIds: elementIdsRef.current,
    });
    registeredRef.current = true;
  }, [bridge, id, name, description]);

  // Unregister the component
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterComponent(id);
    registeredRef.current = false;
  }, [bridge, id]);

  // Execute an action
  const executeAction = useCallback(
    async <TParams = unknown, TResult = unknown>(
      actionId: string,
      params?: TParams
    ): Promise<TResult> => {
      if (!bridge) {
        throw new Error('UI Bridge not available');
      }

      const response = await bridge.executor.executeComponentAction(id, {
        action: actionId,
        params: params as Record<string, unknown>,
      });

      if (!response.success) {
        throw new Error(response.error || 'Action failed');
      }

      return response.result as TResult;
    },
    [bridge, id]
  );

  // Update actions dynamically
  const updateActions = useCallback(
    (actions: ComponentActionDef[]) => {
      actionsRef.current = actions;

      // Re-register with updated actions if already registered
      if (registeredRef.current && bridge) {
        bridge.registry.unregisterComponent(id);
        registeredRef.current = false;
        register();
      }
    },
    [bridge, id, register]
  );

  // Add element ID
  const addElement = useCallback(
    (elementId: string) => {
      if (!elementIdsRef.current.includes(elementId)) {
        elementIdsRef.current = [...elementIdsRef.current, elementId];
      }
    },
    []
  );

  // Remove element ID
  const removeElement = useCallback((elementId: string) => {
    elementIdsRef.current = elementIdsRef.current.filter((id) => id !== elementId);
  }, []);

  // Auto-register on mount
  useEffect(() => {
    if (autoRegister) {
      register();
    }

    return () => {
      unregister();
    };
  }, [autoRegister, register, unregister]);

  // Get registered component
  const registeredComponent = useMemo(() => {
    if (!bridge) return null;
    return bridge.registry.getComponent(id) || null;
  }, [bridge, id]);

  return {
    registered: registeredRef.current,
    executeAction,
    register,
    unregister,
    updateActions,
    addElement,
    removeElement,
    registeredComponent,
  };
}

/**
 * useUIComponentAction hook
 *
 * Create a stable action handler that can be used with useUIComponent.
 * Useful for memoizing action handlers.
 */
export function useUIComponentAction<TParams = unknown, TResult = unknown>(
  handler: (params?: TParams) => TResult | Promise<TResult>,
  deps: React.DependencyList
): (params?: TParams) => TResult | Promise<TResult> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(handler, deps);
}
