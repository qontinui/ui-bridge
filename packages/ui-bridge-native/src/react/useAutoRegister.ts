/**
 * useAutoRegister Hook for React Native
 *
 * Enables automatic registration of interactive React Native components.
 * Unlike the web version, this doesn't use MutationObserver (no DOM).
 * Instead, it provides a simple API for components to register themselves.
 *
 * For comprehensive coverage in React Native, components should:
 * 1. Use this hook at the app root to enable the registry
 * 2. Use useUIElement on interactive components (or wrap with Pressable/TouchableOpacity)
 */

import { useEffect, useRef, useCallback } from 'react';
import { useUIBridgeNativeOptional } from './UIBridgeNativeProvider';
import type { NativeElementType, NativeElementRef } from '../core/types';
import type { RegisterElementOptions } from '../core/registry';

/**
 * Options for auto-registration in React Native
 */
export interface NativeAutoRegisterOptions {
  /** Enable auto-registration (default: true in dev mode) */
  enabled?: boolean;
  /** Callback when element is registered */
  onRegister?: (id: string) => void;
  /** Callback when element is unregistered */
  onUnregister?: (id: string) => void;
}

/**
 * Handle returned by useAutoRegister for programmatic registration
 */
export interface NativeAutoRegisterHandle {
  /** Register an element programmatically */
  register: (id: string, ref: React.RefObject<NativeElementRef>, options?: RegisterElementOptions) => void;
  /** Unregister an element programmatically */
  unregister: (id: string) => void;
  /** Check if auto-registration is enabled */
  isEnabled: boolean;
}

/**
 * Hook for enabling automatic element registration in React Native.
 *
 * Since React Native doesn't have a DOM to observe, this hook provides
 * a handle for programmatic registration. For most use cases, you should
 * use useUIElement directly on interactive components.
 *
 * @example
 * ```tsx
 * function App() {
 *   const autoRegister = useAutoRegister({ enabled: __DEV__ });
 *
 *   // Programmatic registration (rare use case)
 *   useEffect(() => {
 *     autoRegister.register('custom-element', {
 *       type: 'button',
 *       label: 'Custom Button',
 *     });
 *
 *     return () => autoRegister.unregister('custom-element');
 *   }, []);
 *
 *   return <YourApp />;
 * }
 * ```
 */
export function useAutoRegister(
  options: NativeAutoRegisterOptions = {}
): NativeAutoRegisterHandle {
  // Note: __DEV__ is a React Native global, but TypeScript doesn't know about it by default
  // Using false as a safe default - consumers should explicitly set enabled: __DEV__ in their app
  const { enabled = false, onRegister, onUnregister } = options;

  const bridge = useUIBridgeNativeOptional();
  const registeredIdsRef = useRef(new Set<string>());

  /**
   * Register an element
   */
  const register = useCallback(
    (id: string, ref: React.RefObject<NativeElementRef>, elementOptions?: RegisterElementOptions): void => {
      if (!enabled || !bridge?.registry) return;

      // Avoid duplicate registration
      if (registeredIdsRef.current.has(id)) return;

      bridge.registry.registerElement(id, ref, elementOptions);
      registeredIdsRef.current.add(id);
      onRegister?.(id);
    },
    [enabled, bridge, onRegister]
  );

  /**
   * Unregister an element
   */
  const unregister = useCallback(
    (id: string): void => {
      if (!bridge?.registry) return;

      bridge.registry.unregisterElement(id);
      registeredIdsRef.current.delete(id);
      onUnregister?.(id);
    },
    [bridge, onUnregister]
  );

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      // Unregister all elements on unmount
      registeredIdsRef.current.forEach((id) => {
        bridge?.registry.unregisterElement(id);
      });
      registeredIdsRef.current.clear();
    };
  }, [bridge]);

  return {
    register,
    unregister,
    isEnabled: enabled && !!bridge?.registry,
  };
}

export default useAutoRegister;
