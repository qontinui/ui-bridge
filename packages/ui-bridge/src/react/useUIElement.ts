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
} from '../core/types';
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
 *     <button ref={ref} data-ui-id="submit-btn">
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

  const { id, type, label, actions, customActions, autoRegister = true } = options;

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
  }, [bridge, id, type, label, actions, customActions]);

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
  };
}

/**
 * useUIElementRef hook
 *
 * A simpler version that just adds the data-ui-id attribute.
 * Useful when you only need identification without full registration.
 */
export function useUIElementRef(id: string): React.RefCallback<HTMLElement> {
  return useCallback(
    (node: HTMLElement | null) => {
      if (node) {
        node.setAttribute('data-ui-id', id);
      }
    },
    [id]
  );
}
