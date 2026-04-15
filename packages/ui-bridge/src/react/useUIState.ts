/**
 * useUIState Hook
 *
 * Register and manage UI states with UI Bridge.
 */

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
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
  // Authoritative "am I registered?" tracking. Using a ref (not the `registered`
  // state) breaks a feedback loop: consumers commonly pass inline `activeWhen`,
  // `metadata`, `elements`, which make `register`/`unregister` identity churn
  // every render. If the auto-register effect depends on those AND on the
  // `registered` state it sets, the cleanup/run cycle pings registered
  // true↔false past React's 50-update ceiling (error #185).
  const registeredRef = useRef(false);

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

  // Authoritative id of the currently-registered state. Captured at register
  // time (not at sync-effect time) so a prop change between register and the
  // first sync can't desync the baseline. Also used by `unregister` so we
  // remove the actually-registered id even if `id` has changed since.
  const registeredIdRef = useRef<string | null>(null);

  // Register the state
  const register = useCallback(() => {
    if (!bridge || registeredRef.current) return;

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
    registeredRef.current = true;
    registeredIdRef.current = id;
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
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterState(registeredIdRef.current ?? id);
    registeredRef.current = false;
    registeredIdRef.current = null;
    setRegistered(false);
    setIsActive(false);
  }, [bridge, id]);

  // Keep latest register/unregister in refs so the auto-register effect does
  // not re-run on every parent render when consumers pass inline options.
  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);

  // Auto-register on mount / bridge-or-autoRegister change
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

  // In-place option sync. When a consumer passes reactive options (dynamic
  // `name`, `metadata`, `blocking`, etc. on the same mounted instance), we
  // mirror the changes into the registry without re-emitting
  // `element:registered` — which would wake every `useSyncExternalStore`
  // consumer. An `id` change IS treated as a re-registration because the
  // registry keys by id.
  //
  // `activeWhen` is not part of the serialized key (functions aren't
  // stable); we write the latest closure into the registry copy on every
  // sync, which is cheap and keeps predicate reads fresh.
  const optionsKey =
    bridge && registeredRef.current
      ? JSON.stringify({
          id,
          name,
          elements,
          blocking,
          blocks: blocks ?? null,
          group: group ?? null,
          pathCost: pathCost ?? null,
          metadata: metadata ?? null,
        })
      : null;
  useEffect(() => {
    if (!bridge || !registeredRef.current || optionsKey === null) return;
    const registeredId = registeredIdRef.current;
    // `register()` sets registeredIdRef before this effect ever runs, so
    // null here means we're racing with an unmount path — bail out.
    if (registeredId === null) return;
    if (registeredId !== id) {
      // Id changed — re-register under the new id.
      bridge.registry.unregisterState(registeredId);
      registeredIdRef.current = id;
      bridge.registry.registerState({
        id,
        name,
        elements,
        activeWhen,
        blocking,
        blocks,
        group,
        pathCost,
        metadata,
      });
      return;
    }
    bridge.registry.updateState({
      id,
      name,
      elements,
      activeWhen,
      blocking,
      blocks,
      group,
      pathCost,
      metadata,
    });
    // activeWhen intentionally excluded from dep key (function identity is
    // unstable). We still write the latest closure into the registry above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, optionsKey]);

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
  // See useUIState above — ref-based tracking to avoid a setState feedback loop
  // when consumers pass inline `states` arrays.
  const registeredRef = useRef(false);

  const { id, name, states, autoRegister = true } = options;

  // See useUIState for rationale on capturing id at register time.
  const registeredGroupIdRef = useRef<string | null>(null);

  // Register the group
  const register = useCallback(() => {
    if (!bridge || registeredRef.current) return;

    const group: UIStateGroup = { id, name, states };
    bridge.registry.registerStateGroup(group);
    registeredRef.current = true;
    registeredGroupIdRef.current = id;
    setRegistered(true);
  }, [bridge, id, name, states]);

  // Unregister the group
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterStateGroup(registeredGroupIdRef.current ?? id);
    registeredRef.current = false;
    registeredGroupIdRef.current = null;
    setRegistered(false);
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

  // In-place option sync — see useUIState for rationale.
  const groupKey = bridge && registeredRef.current ? JSON.stringify({ id, name, states }) : null;
  useEffect(() => {
    if (!bridge || !registeredRef.current || groupKey === null) return;
    const registeredGroupId = registeredGroupIdRef.current;
    if (registeredGroupId === null) return;
    if (registeredGroupId !== id) {
      bridge.registry.unregisterStateGroup(registeredGroupId);
      registeredGroupIdRef.current = id;
      bridge.registry.registerStateGroup({ id, name, states });
      return;
    }
    bridge.registry.updateStateGroup({ id, name, states });
  }, [bridge, groupKey, id, name, states]);

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
