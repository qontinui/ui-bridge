/**
 * useUITransition Hook
 *
 * Register and execute UI state transitions with UI Bridge.
 */

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
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
  // See useUIState — ref-based tracking to avoid a setState feedback loop when
  // consumers pass inline `fromStates`/`activateStates`/etc. arrays.
  const registeredRef = useRef(false);

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

  // See useUIState for rationale on capturing id at register time.
  const registeredTransitionIdRef = useRef<string | null>(null);

  // Register the transition
  const register = useCallback(() => {
    if (!bridge || registeredRef.current) return;

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
    registeredRef.current = true;
    registeredTransitionIdRef.current = id;
    setRegistered(true);
    setCanExecute(bridge.registry.canExecuteTransition(id));
  }, [
    bridge,
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
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterTransition(registeredTransitionIdRef.current ?? id);
    registeredRef.current = false;
    registeredTransitionIdRef.current = null;
    setRegistered(false);
    setCanExecute(false);
  }, [bridge, id]);

  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);

  // Auto-register on mount
  useEffect(() => {
    if (autoRegister && bridge) {
      registerRef.current();
    }

    return () => {
      if (registeredRef.current) {
        unregisterRef.current();
      }
    };
  }, [autoRegister, bridge]);

  // In-place option sync — see useUIState for rationale. `actions` contains
  // functions and is not serializable; we mirror it into the stored record
  // on every sync, without emitting a re-register event.
  const transitionKey =
    bridge && registeredRef.current
      ? JSON.stringify({
          id,
          name,
          fromStates,
          activateStates,
          exitStates,
          activateGroups: activateGroups ?? null,
          exitGroups: exitGroups ?? null,
          pathCost: pathCost ?? null,
          staysVisible: staysVisible ?? null,
        })
      : null;
  useEffect(() => {
    if (!bridge || !registeredRef.current || transitionKey === null) return;
    const next: UITransition = {
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
    const registeredTransitionId = registeredTransitionIdRef.current;
    if (registeredTransitionId === null) return;
    if (registeredTransitionId !== id) {
      bridge.registry.unregisterTransition(registeredTransitionId);
      registeredTransitionIdRef.current = id;
      bridge.registry.registerTransition(next);
      return;
    }
    bridge.registry.updateTransition(next);
    // actions intentionally excluded from dep key — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, transitionKey]);

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
