/**
 * useUITransition Hook
 *
 * Register and execute UI state transitions with UI Bridge.
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import type { UITransition, TransitionResult, WorkflowStep } from '../core/types';
import { useUIBridgeOptional } from './UIBridgeProvider';

/**
 * useUITransition options
 */
export interface UseUITransitionOptions {
  /** Unique identifier for the transition */
  id: string;
  /** Human-readable name */
  name: string;
  /** Precondition: at least one must be active */
  fromStates: string[];
  /** States to activate */
  activateStates: string[];
  /** States to deactivate */
  exitStates: string[];
  /** Groups to activate */
  activateGroups?: string[];
  /** Groups to deactivate */
  exitGroups?: string[];
  /** Actions to execute during transition */
  actions?: WorkflowStep[];
  /** Cost for pathfinding */
  pathCost?: number;
  /** Whether source states remain visible during transition */
  staysVisible?: boolean;
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
}

/**
 * useUITransition return value
 */
export interface UseUITransitionReturn {
  /** Whether the transition is registered */
  registered: boolean;
  /** Whether this transition can be executed from current state */
  canExecute: boolean;
  /** Execute the transition */
  execute: () => Promise<TransitionResult>;
  /** Manually register the transition */
  register: () => void;
  /** Manually unregister the transition */
  unregister: () => void;
  /** The registered transition info */
  transition: UITransition | undefined;
}

/**
 * useUITransition hook
 *
 * Registers a state transition with UI Bridge.
 *
 * @example
 * ```tsx
 * function OpenModalButton() {
 *   const { canExecute, execute } = useUITransition({
 *     id: 'open-login-modal',
 *     name: 'Open Login Modal',
 *     fromStates: ['dashboard'],
 *     activateStates: ['login-modal'],
 *     exitStates: [],
 *   });
 *
 *   return (
 *     <button onClick={execute} disabled={!canExecute}>
 *       Login
 *     </button>
 *   );
 * }
 * ```
 */
export function useUITransition(options: UseUITransitionOptions): UseUITransitionReturn {
  const bridge = useUIBridgeOptional();
  const [registered, setRegistered] = useState(false);
  const [canExecute, setCanExecute] = useState(false);

  const {
    id,
    name,
    fromStates,
    activateStates,
    exitStates,
    activateGroups,
    exitGroups,
    actions,
    pathCost,
    staysVisible,
    autoRegister = true,
  } = options;

  // Register the transition
  const register = useCallback(() => {
    if (!bridge || registered) return;

    const transition: UITransition = {
      id,
      name,
      fromStates,
      activateStates,
      exitStates,
      activateGroups,
      exitGroups,
      actions,
      pathCost,
      staysVisible,
    };

    bridge.registry.registerTransition(transition);
    setRegistered(true);
    setCanExecute(bridge.registry.canExecuteTransition(id));
  }, [
    bridge,
    registered,
    id,
    name,
    fromStates,
    activateStates,
    exitStates,
    activateGroups,
    exitGroups,
    actions,
    pathCost,
    staysVisible,
  ]);

  // Unregister the transition
  const unregister = useCallback(() => {
    if (!bridge || !registered) return;

    bridge.registry.unregisterTransition(id);
    setRegistered(false);
    setCanExecute(false);
  }, [bridge, registered, id]);

  // Auto-register on mount
  useEffect(() => {
    if (autoRegister && bridge) {
      register();
    }

    return () => {
      if (registered) {
        unregister();
      }
    };
  }, [autoRegister, bridge, register, unregister, registered]);

  // Subscribe to state changes to update canExecute
  useEffect(() => {
    if (!bridge || !registered) return;

    const unsubscribe = bridge.registry.on('element:stateChanged', () => {
      setCanExecute(bridge.registry.canExecuteTransition(id));
    });

    return unsubscribe;
  }, [bridge, id, registered]);

  // Execute transition
  const execute = useCallback(async (): Promise<TransitionResult> => {
    if (!bridge) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: 'UI Bridge not available',
        durationMs: 0,
      };
    }
    const result = await bridge.registry.executeTransition(id);
    setCanExecute(bridge.registry.canExecuteTransition(id));
    return result;
  }, [bridge, id]);

  // Get registered transition
  const transition = useMemo(() => {
    if (!bridge) return undefined;
    return bridge.registry.getTransition(id);
  }, [bridge, id, registered]);

  return {
    registered,
    canExecute,
    execute,
    register,
    unregister,
    transition,
  };
}

/**
 * useTransitions hook
 *
 * Get all registered transitions.
 */
export function useTransitions(): UITransition[] {
  const bridge = useUIBridgeOptional();

  return useMemo(() => {
    if (!bridge) return [];
    return bridge.registry.getAllTransitions();
  }, [bridge]);
}

/**
 * useAvailableTransitions hook
 *
 * Get transitions that can be executed from current state.
 */
export function useAvailableTransitions(): UITransition[] {
  const bridge = useUIBridgeOptional();
  const [available, setAvailable] = useState<UITransition[]>([]);

  useEffect(() => {
    if (!bridge) return;

    const updateAvailable = () => {
      const transitions = bridge.registry.getAllTransitions();
      const availableTransitions = transitions.filter((t) =>
        bridge.registry.canExecuteTransition(t.id)
      );
      setAvailable(availableTransitions);
    };

    // Initial check
    updateAvailable();

    // Subscribe to state changes
    const unsubscribe = bridge.registry.on('element:stateChanged', updateAvailable);

    return unsubscribe;
  }, [bridge]);

  return available;
}
