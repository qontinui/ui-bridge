/**
 * useUIElement Hook for React Native
 *
 * Register a native element with UI Bridge for control and observation.
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
// `useState` is still used below for `_layout` (drives re-render on layout
// changes). `registered` was migrated to a `useRef` (mirrors the web
// `useUIElement` at packages/ui-bridge/src/react/useUIElement.ts:165) so
// the auto-register effect's synchronous call to `register()` no longer
// trips `@eslint-react/set-state-in-effect`. Consumers read
// `registered: registeredRef.current` non-reactively — same contract the
// web hook already exposes.
import type {
  NativeElementType,
  NativeStandardAction,
  NativeCustomAction,
  NativeElementState,
  NativeElementIdentifier,
  RegisteredNativeElement,
  NativeElementRef,
  NativeLayout,
  ElementBbox,
} from '../core/types';
import { useUIBridgeNativeOptional } from './UIBridgeNativeProvider';

/**
 * Local type definition for the layout data we extract from LayoutChangeEvent.
 * We use this internally to avoid type conflicts between different react-native versions
 * (e.g., when ui-bridge-native is used as a file: dependency with a different RN version).
 */
interface LayoutEventData {
  nativeEvent: {
    layout: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
}

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
  /** onLayout handler to spread onto the element - uses generic type for RN version compatibility */
  onLayout: (event: {
    nativeEvent: { layout: { x: number; y: number; width: number; height: number } };
  }) => void;
  /** Props to spread onto the element for identification */
  bridgeProps: UIBridgeProps;
  /** Whether the element is registered */
  registered: boolean;
  /** Get current state */
  getState: () => NativeElementState | null;
  /** Get element identifier */
  getIdentifier: () => NativeElementIdentifier | null;
  /** Trigger an action on this element */
  trigger: (
    action: NativeStandardAction | string,
    params?: Record<string, unknown>
  ) => Promise<void>;
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
  // Mirrors the web `useUIElement` (packages/ui-bridge/src/react/useUIElement.ts:165).
  // Tracking registration in a ref instead of state lets the auto-register
  // effect call `register()` synchronously without tripping
  // `@eslint-react/set-state-in-effect`, and avoids the duplicated-state
  // problem of mirroring the registry's truth into local React state.
  // Consumers reading `.registered` get a non-reactive snapshot — same
  // contract the web hook exposes.
  const registeredRef = useRef(false);
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

  // Register the element. Writing to `registeredRef.current` is a synchronous
  // mutation, not a state setter, so the auto-register effect can call this
  // without triggering an extra render or violating
  // `@eslint-react/set-state-in-effect`.
  const register = useCallback(() => {
    if (!bridge || registeredRef.current) return;

    bridge.registry.registerElement(id, ref, {
      type,
      label,
      actions,
      customActions,
      treePath,
      testId: id,
      accessibilityLabel: label,
    });
    registeredRef.current = true;
  }, [bridge, id, type, label, actions, customActions, treePath]);

  // Unregister the element
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterElement(id);
    registeredRef.current = false;
  }, [bridge, id]);

  // Handle layout changes
  const onLayout = useCallback(
    (event: LayoutEventData) => {
      const { x, y, width, height } = event.nativeEvent.layout;

      // Push both `NativeLayout` (native-specific, kept for RN consumers)
      // and `ElementBbox` + `visible` (parity with web SDK, consumed by
      // runners doing bbox-first click resolution) in one update site.
      //
      // `ElementBbox` uses screen-absolute coords so runners can dispatch
      // taps without a coord-space conversion. `measureInWindow`'s
      // `pageX`/`pageY` are screen-absolute; we fall back to the layout's
      // relative `x`/`y` only when `measureInWindow` is unavailable.
      const commit = (newLayout: NativeLayout) => {
        setLayout(newLayout);
        if (!bridge || !registeredRef.current) return;

        const newState: NativeElementState = {
          mounted: true,
          visible: width > 0 && height > 0,
          enabled: true,
          focused: false,
          layout: newLayout,
        };
        bridge.registry.updateElementState(id, newState);

        const bbox: ElementBbox = {
          x: newLayout.pageX,
          y: newLayout.pageY,
          width,
          height,
        };
        bridge.registry.updateElementBbox(id, bbox, width > 0 && height > 0);

        onStateChange?.(newState);
      };

      // Get absolute position using measureInWindow
      if (ref.current && 'measureInWindow' in ref.current) {
        (
          ref.current as {
            measureInWindow: (
              callback: (pageX: number, pageY: number, w: number, h: number) => void
            ) => void;
          }
        ).measureInWindow((pageX: number, pageY: number) => {
          commit({ x, y, width, height, pageX, pageY });
        });
      } else {
        // Fallback if measureInWindow not available
        commit({ x, y, width, height, pageX: x, pageY: y });
      }
    },
    [bridge, id, onStateChange]
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
      if (bridge && registeredRef.current) {
        bridge.registry.updateElementProps(id, props);
      }
    },
    [bridge, id]
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
  }, [bridge, id]);

  return {
    ref,
    onLayout,
    bridgeProps,
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

export function useUIElementWithProps(options: UseUIElementOptions): UseUIElementWithPropsReturn {
  const elementReturn = useUIElement(options);
  const bridge = useUIBridgeNativeOptional();

  // `elementReturn.registered` is now a non-reactive ref snapshot (mirrors the
  // web hook). Reading it inside the callback would capture the value at hook
  // creation time, which is `false` on the first render. Querying the registry
  // directly gives us the live truth without needing reactivity. The registry
  // is the authoritative source — same pattern used by `getState` /
  // `getIdentifier` above.
  const captureProps = useCallback(
    (props: Record<string, unknown>) => {
      if (bridge && bridge.registry.getElement(options.id)) {
        bridge.registry.updateElementProps(options.id, props);
      }
    },
    [bridge, options.id]
  );

  return {
    ...elementReturn,
    captureProps,
  };
}
