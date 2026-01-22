/**
 * useUIState Hook
 *
 * Register and manage UI states with UI Bridge.
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import type { UIState, UIStateGroup, StateSnapshot } from '../core/types';
import { useUIBridgeOptional } from './UIBridgeProvider';

/**
 * useUIState options
 */
export interface UseUIStateOptions {
  /** Unique identifier for the state */
  id: string;
  /** Human-readable name */
  name: string;
  /** Element IDs belonging to this state */
  elements?: string[];
  /** Function to detect if state is active */
  activeWhen?: () => boolean;
  /** If true, blocks other state activations (modal behavior) */
  blocking?: boolean;
  /** Specific state IDs this state blocks */
  blocks?: string[];
  /** State group membership */
  group?: string;
  /** Cost for pathfinding (default: 1.0) */
  pathCost?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
  /** Initial active state */
  initialActive?: boolean;
}

/**
 * useUIState return value
 */
export interface UseUIStateReturn {
  /** Whether the state is registered */
  registered: boolean;
  /** Whether the state is currently active */
  isActive: boolean;
  /** Activate this state */
  activate: () => boolean;
  /** Deactivate this state */
  deactivate: () => boolean;
  /** Toggle active state */
  toggle: () => boolean;
  /** Get all currently active states */
  activeStates: string[];
  /** Manually register the state */
  register: () => void;
  /** Manually unregister the state */
  unregister: () => void;
  /** The registered state info */
  state: UIState | undefined;
}

/**
 * useUIState hook
 *
 * Registers a UI state with UI Bridge for state management.
 *
 * @example
 * ```tsx
 * function LoginModal() {
 *   const { isActive, activate, deactivate } = useUIState({
 *     id: 'login-modal',
 *     name: 'Login Modal',
 *     blocking: true,
 *     elements: ['login-email', 'login-password', 'login-submit'],
 *   });
 *
 *   if (!isActive) return null;
 *
 *   return (
 *     <div className="modal">
 *       <button onClick={deactivate}>Close</button>
 *       ...
 *     </div>
 *   );
 * }
 * ```
 */
export function useUIState(options: UseUIStateOptions): UseUIStateReturn {
  const bridge = useUIBridgeOptional();
  const [registered, setRegistered] = useState(false);
  const [isActive, setIsActive] = useState(options.initialActive ?? false);
  const [activeStates, setActiveStates] = useState<string[]>([]);

  const {
    id,
    name,
    elements = [],
    activeWhen,
    blocking,
    blocks,
    group,
    pathCost,
    metadata,
    autoRegister = true,
    initialActive = false,
  } = options;

  // Register the state
  const register = useCallback(() => {
    if (!bridge || registered) return;

    const state: UIState = {
      id,
      name,
      elements,
      activeWhen,
      blocking,
      blocks,
      group,
      pathCost,
      metadata,
    };

    bridge.registry.registerState(state);
    setRegistered(true);

    // Set initial active state
    if (initialActive) {
      bridge.registry.activateState(id);
      setIsActive(true);
    }

    // Update active states
    setActiveStates(bridge.registry.getActiveStates());
  }, [
    bridge,
    registered,
    id,
    name,
    elements,
    activeWhen,
    blocking,
    blocks,
    group,
    pathCost,
    metadata,
    initialActive,
  ]);

  // Unregister the state
  const unregister = useCallback(() => {
    if (!bridge || !registered) return;

    bridge.registry.unregisterState(id);
    setRegistered(false);
    setIsActive(false);
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

  // Subscribe to state changes
  useEffect(() => {
    if (!bridge) return;

    const unsubscribe = bridge.registry.on('element:stateChanged', (event) => {
      const data = event.data as { stateId: string; active: boolean; activeStates: string[] };
      if (data.stateId === id) {
        setIsActive(data.active);
      }
      setActiveStates(data.activeStates);
    });

    return unsubscribe;
  }, [bridge, id]);

  // Activate state
  const activate = useCallback((): boolean => {
    if (!bridge) return false;
    const success = bridge.registry.activateState(id);
    if (success) {
      setIsActive(true);
      setActiveStates(bridge.registry.getActiveStates());
    }
    return success;
  }, [bridge, id]);

  // Deactivate state
  const deactivate = useCallback((): boolean => {
    if (!bridge) return false;
    const success = bridge.registry.deactivateState(id);
    if (success) {
      setIsActive(false);
      setActiveStates(bridge.registry.getActiveStates());
    }
    return success;
  }, [bridge, id]);

  // Toggle state
  const toggle = useCallback((): boolean => {
    return isActive ? deactivate() : activate();
  }, [isActive, activate, deactivate]);

  // Get registered state
  const state = useMemo(() => {
    if (!bridge) return undefined;
    return bridge.registry.getState(id);
  }, [bridge, id, registered]);

  return {
    registered,
    isActive,
    activate,
    deactivate,
    toggle,
    activeStates,
    register,
    unregister,
    state,
  };
}

/**
 * useUIStateGroup hook
 *
 * Register and manage a state group with UI Bridge.
 *
 * @example
 * ```tsx
 * function NavigationSection() {
 *   const { activate, deactivate } = useUIStateGroup({
 *     id: 'nav-group',
 *     name: 'Navigation',
 *     states: ['nav-home', 'nav-about', 'nav-contact'],
 *   });
 *
 *   // Activating the group activates all its states
 *   // Deactivating the group deactivates all its states
 * }
 * ```
 */
export interface UseUIStateGroupOptions {
  /** Unique identifier for the group */
  id: string;
  /** Human-readable name */
  name: string;
  /** State IDs belonging to this group */
  states: string[];
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
}

export interface UseUIStateGroupReturn {
  /** Whether the group is registered */
  registered: boolean;
  /** Activate all states in this group */
  activate: () => string[];
  /** Deactivate all states in this group */
  deactivate: () => string[];
  /** Manually register the group */
  register: () => void;
  /** Manually unregister the group */
  unregister: () => void;
  /** The registered group info */
  group: UIStateGroup | undefined;
}

export function useUIStateGroup(options: UseUIStateGroupOptions): UseUIStateGroupReturn {
  const bridge = useUIBridgeOptional();
  const [registered, setRegistered] = useState(false);

  const { id, name, states, autoRegister = true } = options;

  // Register the group
  const register = useCallback(() => {
    if (!bridge || registered) return;

    const group: UIStateGroup = { id, name, states };
    bridge.registry.registerStateGroup(group);
    setRegistered(true);
  }, [bridge, registered, id, name, states]);

  // Unregister the group
  const unregister = useCallback(() => {
    if (!bridge || !registered) return;

    bridge.registry.unregisterStateGroup(id);
    setRegistered(false);
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

  // Activate group
  const activate = useCallback((): string[] => {
    if (!bridge) return [];
    return bridge.registry.activateStateGroup(id);
  }, [bridge, id]);

  // Deactivate group
  const deactivate = useCallback((): string[] => {
    if (!bridge) return [];
    return bridge.registry.deactivateStateGroup(id);
  }, [bridge, id]);

  // Get registered group
  const group = useMemo(() => {
    if (!bridge) return undefined;
    return bridge.registry.getStateGroup(id);
  }, [bridge, id, registered]);

  return {
    registered,
    activate,
    deactivate,
    register,
    unregister,
    group,
  };
}

/**
 * useActiveStates hook
 *
 * Subscribe to active states changes.
 */
export function useActiveStates(): string[] {
  const bridge = useUIBridgeOptional();
  const [activeStates, setActiveStates] = useState<string[]>([]);

  useEffect(() => {
    if (!bridge) return;

    // Get initial active states
    setActiveStates(bridge.registry.getActiveStates());

    // Subscribe to changes
    const unsubscribe = bridge.registry.on('element:stateChanged', (event) => {
      const data = event.data as { activeStates: string[] };
      setActiveStates(data.activeStates);
    });

    return unsubscribe;
  }, [bridge]);

  return activeStates;
}

/**
 * useStateSnapshot hook
 *
 * Get a snapshot of all state management data.
 */
export function useStateSnapshot(): StateSnapshot | null {
  const bridge = useUIBridgeOptional();

  return useMemo(() => {
    if (!bridge) return null;
    return bridge.registry.createStateSnapshot();
  }, [bridge]);
}
