/**
 * useUIElement Hook
 *
 * Register a DOM element with UI Bridge for control and observation.
 */

import { useRef, useEffect, useCallback, useMemo } from 'react';
import type {
  ElementType,
  StandardAction,
  CustomAction,
  ElementState,
  ElementIdentifier,
  RegisteredElement,
  ElementLogLevel,
  ElementHistoryOptions,
  ElementLogEntry,
} from '../core/types';
import type { RelationshipType } from '../relationships/types';
import { useUIBridgeOptional } from './UIBridgeProvider';

/**
 * useUIElement options
 */
export interface UseUIElementOptions {
  /** Unique identifier for the element */
  id: string;
  /** Element type (auto-detected if not provided) */
  type?: ElementType;
  /** Human-readable label */
  label?: string;
  /** Override available actions */
  actions?: StandardAction[];
  /** Custom actions */
  customActions?: Record<string, CustomAction>;
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
  /** Callback when state changes */
  onStateChange?: (state: ElementState) => void;
  /** Log level override for element-scoped event logging */
  logLevel?: ElementLogLevel;
  /** Declare relationships from this element to other elements */
  relationships?: Array<{
    targetId: string;
    type: RelationshipType;
    bidirectional?: boolean;
    metadata?: Record<string, unknown>;
  }>;
}

/**
 * useUIElement return value
 */
export interface UseUIElementReturn {
  /** Ref to attach to the element */
  ref: React.RefCallback<HTMLElement>;
  /** Current element reference */
  element: HTMLElement | null;
  /** Whether the element is registered */
  registered: boolean;
  /** Get current state */
  getState: () => ElementState | null;
  /** Get element identifier */
  getIdentifier: () => ElementIdentifier | null;
  /** Trigger an action on this element */
  trigger: (action: StandardAction | string, params?: Record<string, unknown>) => Promise<void>;
  /** Manually register the element */
  register: () => void;
  /** Manually unregister the element */
  unregister: () => void;
  /** The registered element info */
  registeredElement: RegisteredElement | null;
  /** Get element event history */
  getHistory: (options?: ElementHistoryOptions) => ElementLogEntry[];
  /** Set log level for this element */
  setLogLevel: (level: ElementLogLevel) => void;
}

/**
 * useUIElement hook
 *
 * Registers a DOM element with UI Bridge for programmatic control.
 *
 * @example
 * ```tsx
 * function SubmitButton() {
 *   const { ref, trigger } = useUIElement({
 *     id: 'submit-btn',
 *     type: 'button',
 *     label: 'Submit Form',
 *   });
 *
 *   return (
 *     <button ref={ref}>
 *       Submit
 *     </button>
 *   );
 * }
 * ```
 */
export function useUIElement(options: UseUIElementOptions): UseUIElementReturn {
  const bridge = useUIBridgeOptional();
  const elementRef = useRef<HTMLElement | null>(null);
  const registeredRef = useRef(false);

  const {
    id,
    type,
    label,
    actions,
    customActions,
    autoRegister = true,
    logLevel,
    relationships,
  } = options;

  // Register the element
  const register = useCallback(() => {
    if (!bridge || !elementRef.current || registeredRef.current) return;

    bridge.registry.registerElement(id, elementRef.current, {
      type,
      label,
      actions,
      customActions,
    });
    registeredRef.current = true;

    if (logLevel) {
      bridge.registry.setElementLogLevel(id, logLevel);
    }
  }, [bridge, id, type, label, actions, customActions, logLevel]);

  // Unregister the element
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterElement(id);
    registeredRef.current = false;
  }, [bridge, id]);

  // Ref callback
  const ref = useCallback(
    (node: HTMLElement | null) => {
      // Cleanup previous
      if (elementRef.current && elementRef.current !== node) {
        unregister();
      }

      elementRef.current = node;

      // Register new element
      if (node && autoRegister) {
        register();
      }
    },
    [autoRegister, register, unregister]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unregister();
    };
  }, [unregister]);

  // Declare relationships when registered
  const serializedRelationships = JSON.stringify(relationships);
  useEffect(() => {
    if (!bridge || !relationships || relationships.length === 0) return;

    for (const rel of relationships) {
      const opts =
        rel.bidirectional !== undefined || rel.metadata !== undefined
          ? { bidirectional: rel.bidirectional, metadata: rel.metadata }
          : undefined;
      bridge.relationshipTracker.declare(id, rel.targetId, rel.type, opts);
    }

    return () => {
      bridge.relationshipTracker.undeclareAll(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, id, serializedRelationships]);

  // Get state
  const getState = useCallback((): ElementState | null => {
    if (!bridge) return null;
    const registered = bridge.registry.getElement(id);
    return registered?.getState() || null;
  }, [bridge, id]);

  // Get identifier
  const getIdentifier = useCallback((): ElementIdentifier | null => {
    if (!bridge) return null;
    const registered = bridge.registry.getElement(id);
    return registered?.getIdentifier() || null;
  }, [bridge, id]);

  // Trigger action
  const trigger = useCallback(
    async (action: StandardAction | string, params?: Record<string, unknown>) => {
      if (!bridge) {
        throw new Error('UI Bridge not available');
      }

      const response = await bridge.executor.executeAction(id, {
        action,
        params,
      });

      if (!response.success) {
        throw new Error(response.error || 'Action failed');
      }
    },
    [bridge, id]
  );

  // Get element history
  const getHistory = useCallback(
    (historyOptions?: ElementHistoryOptions): ElementLogEntry[] => {
      if (!bridge) return [];
      return bridge.registry.getElementHistory(id, historyOptions);
    },
    [bridge, id]
  );

  // Set log level
  const setLogLevel = useCallback(
    (level: ElementLogLevel): void => {
      bridge?.registry.setElementLogLevel(id, level);
    },
    [bridge, id]
  );

  // Get registered element
  const registeredElement = useMemo(() => {
    if (!bridge) return null;
    return bridge.registry.getElement(id) || null;
  }, [bridge, id]);

  return {
    ref,
    element: elementRef.current,
    registered: registeredRef.current,
    getState,
    getIdentifier,
    trigger,
    register,
    unregister,
    registeredElement,
    getHistory,
    setLogLevel,
  };
}

/**
 * useUIElementRef hook
 *
 * @deprecated data-ui-id is no longer used. Elements are identified through
 * the bridge registry. Use useUIElement() for full registration instead.
 * This hook is a no-op and will be removed in a future version.
 */
export function useUIElementRef(_id: string): React.RefCallback<HTMLElement> {
  return useCallback((_node: HTMLElement | null) => {
    // No-op: data-ui-id is no longer set on DOM elements.
    // Elements are identified through the internal bridge registry.
  }, []);
}
