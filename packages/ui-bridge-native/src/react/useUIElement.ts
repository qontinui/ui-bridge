/**
 * useUIElement Hook for React Native
 *
 * Register a native element with UI Bridge for control and observation.
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import type {
  NativeElementType,
  NativeStandardAction,
  NativeCustomAction,
  NativeElementState,
  NativeElementIdentifier,
  RegisteredNativeElement,
  NativeElementRef,
  NativeLayout,
} from '../core/types';
import { useUIBridgeNativeOptional } from './UIBridgeNativeProvider';

/**
 * useUIElement options
 */
export interface UseUIElementOptions {
  /** Unique identifier for the element */
  id: string;
  /** Element type (defaults to 'custom') */
  type?: NativeElementType;
  /** Human-readable label */
  label?: string;
  /** Override available actions */
  actions?: NativeStandardAction[];
  /** Custom actions */
  customActions?: Record<string, NativeCustomAction>;
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
  /** Callback when state changes */
  onStateChange?: (state: NativeElementState) => void;
  /** Parent component path for tree path generation */
  parentPath?: string;
}

/**
 * Bridge props to spread onto the component
 */
export interface UIBridgeProps {
  /** Test ID for automation */
  testID: string;
  /** Accessibility label */
  accessibilityLabel?: string;
}

/**
 * useUIElement return value
 */
export interface UseUIElementReturn {
  /** Ref to attach to the element */
  ref: React.RefObject<NativeElementRef>;
  /** onLayout handler to spread onto the element */
  onLayout: (event: LayoutChangeEvent) => void;
  /** Props to spread onto the element for identification */
  bridgeProps: UIBridgeProps;
  /** Whether the element is registered */
  registered: boolean;
  /** Get current state */
  getState: () => NativeElementState | null;
  /** Get element identifier */
  getIdentifier: () => NativeElementIdentifier | null;
  /** Trigger an action on this element */
  trigger: (action: NativeStandardAction | string, params?: Record<string, unknown>) => Promise<void>;
  /** Manually register the element */
  register: () => void;
  /** Manually unregister the element */
  unregister: () => void;
  /** The registered element info */
  registeredElement: RegisteredNativeElement | null;
}

/**
 * useUIElement hook for React Native
 *
 * Registers a native element with UI Bridge for programmatic control.
 *
 * @example
 * ```tsx
 * function SubmitButton() {
 *   const { ref, onLayout, bridgeProps, trigger } = useUIElement({
 *     id: 'submit-btn',
 *     type: 'button',
 *     label: 'Submit Form',
 *   });
 *
 *   return (
 *     <Pressable
 *       ref={ref}
 *       onLayout={onLayout}
 *       {...bridgeProps}
 *       onPress={() => handleSubmit()}
 *     >
 *       <Text>Submit</Text>
 *     </Pressable>
 *   );
 * }
 * ```
 */
export function useUIElement(options: UseUIElementOptions): UseUIElementReturn {
  const bridge = useUIBridgeNativeOptional();
  const ref = useRef<NativeElementRef>(null);
  const [registered, setRegistered] = useState(false);
  const [_layout, setLayout] = useState<NativeLayout | null>(null);
  const propsRef = useRef<Record<string, unknown>>({});

  const {
    id,
    type = 'custom',
    label,
    actions,
    customActions,
    autoRegister = true,
    onStateChange,
    parentPath,
  } = options;

  // Build tree path
  const treePath = parentPath ? `${parentPath}/${id}` : id;

  // Bridge props to spread onto the element
  const bridgeProps: UIBridgeProps = useMemo(
    () => ({
      testID: id,
      accessibilityLabel: label,
    }),
    [id, label]
  );

  // Register the element
  const register = useCallback(() => {
    if (!bridge || registered) return;

    bridge.registry.registerElement(id, ref, {
      type,
      label,
      actions,
      customActions,
      treePath,
      testId: id,
      accessibilityLabel: label,
    });
    setRegistered(true);
  }, [bridge, registered, id, type, label, actions, customActions, treePath]);

  // Unregister the element
  const unregister = useCallback(() => {
    if (!bridge || !registered) return;

    bridge.registry.unregisterElement(id);
    setRegistered(false);
  }, [bridge, registered, id]);

  // Handle layout changes
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { x, y, width, height } = event.nativeEvent.layout;

      // Get absolute position using measureInWindow
      if (ref.current && 'measureInWindow' in ref.current) {
        (ref.current as { measureInWindow: (callback: (pageX: number, pageY: number, w: number, h: number) => void) => void }).measureInWindow(
          (pageX: number, pageY: number) => {
            const newLayout: NativeLayout = {
              x,
              y,
              width,
              height,
              pageX,
              pageY,
            };
            setLayout(newLayout);

            // Update state in registry
            if (bridge && registered) {
              const newState: NativeElementState = {
                mounted: true,
                visible: width > 0 && height > 0,
                enabled: true,
                focused: false,
                layout: newLayout,
              };
              bridge.registry.updateElementState(id, newState);
              onStateChange?.(newState);
            }
          }
        );
      } else {
        // Fallback if measureInWindow not available
        const newLayout: NativeLayout = {
          x,
          y,
          width,
          height,
          pageX: x,
          pageY: y,
        };
        setLayout(newLayout);

        if (bridge && registered) {
          const newState: NativeElementState = {
            mounted: true,
            visible: width > 0 && height > 0,
            enabled: true,
            focused: false,
            layout: newLayout,
          };
          bridge.registry.updateElementState(id, newState);
          onStateChange?.(newState);
        }
      }
    },
    [bridge, registered, id, onStateChange]
  );

  // Auto-register on mount
  useEffect(() => {
    if (autoRegister) {
      register();
    }

    return () => {
      unregister();
    };
  }, [autoRegister, register, unregister]);

  // Update props for action execution (allows accessing onPress, onChangeText, etc.)
  const _updateProps = useCallback(
    (props: Record<string, unknown>) => {
      propsRef.current = { ...propsRef.current, ...props };
      if (bridge && registered) {
        bridge.registry.updateElementProps(id, props);
      }
    },
    [bridge, registered, id]
  );

  // Get state
  const getState = useCallback((): NativeElementState | null => {
    if (!bridge) return null;
    const element = bridge.registry.getElement(id);
    return element?.getState() || null;
  }, [bridge, id]);

  // Get identifier
  const getIdentifier = useCallback((): NativeElementIdentifier | null => {
    if (!bridge) return null;
    const element = bridge.registry.getElement(id);
    return element?.getIdentifier() || null;
  }, [bridge, id]);

  // Trigger action
  const trigger = useCallback(
    async (action: NativeStandardAction | string, params?: Record<string, unknown>) => {
      if (!bridge) {
        throw new Error('UI Bridge Native not available');
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
  }, [bridge, id, registered]);

  return {
    ref,
    onLayout,
    bridgeProps,
    registered,
    getState,
    getIdentifier,
    trigger,
    register,
    unregister,
    registeredElement,
  };
}

/**
 * useUIElementWithProps hook
 *
 * Extended version that also captures component props for action execution.
 * Useful when you need the bridge to be able to call onPress, onChangeText, etc.
 *
 * @example
 * ```tsx
 * function TextInputField({ onChangeText, value }) {
 *   const { ref, onLayout, bridgeProps, captureProps } = useUIElementWithProps({
 *     id: 'email-input',
 *     type: 'input',
 *   });
 *
 *   // Capture props so bridge can call onChangeText
 *   captureProps({ onChangeText, value });
 *
 *   return (
 *     <TextInput
 *       ref={ref}
 *       onLayout={onLayout}
 *       {...bridgeProps}
 *       value={value}
 *       onChangeText={onChangeText}
 *     />
 *   );
 * }
 * ```
 */
export interface UseUIElementWithPropsReturn extends UseUIElementReturn {
  /** Capture props for action execution */
  captureProps: (props: Record<string, unknown>) => void;
}

export function useUIElementWithProps(
  options: UseUIElementOptions
): UseUIElementWithPropsReturn {
  const elementReturn = useUIElement(options);
  const bridge = useUIBridgeNativeOptional();

  const captureProps = useCallback(
    (props: Record<string, unknown>) => {
      if (bridge && elementReturn.registered) {
        bridge.registry.updateElementProps(options.id, props);
      }
    },
    [bridge, elementReturn.registered, options.id]
  );

  return {
    ...elementReturn,
    captureProps,
  };
}
