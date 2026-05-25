/**
 * useUIElement Hook for React Native
 *
 * Register a native element with UI Bridge for control and observation.
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
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
 * Flatten an RN style prop into a plain object.
 * Uses StyleSheet.flatten which handles arrays, IDs, and nested objects.
 */
function flattenStyle(style: unknown): Record<string, unknown> | undefined {
  if (style == null) return undefined;
  try {
    const flat = StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]);
    return flat ? (flat as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Flatten state style overrides into plain objects.
 */
function flattenStateStyles(stateStyles?: {
  pressed?: unknown;
  focused?: unknown;
  disabled?: unknown;
}):
  | {
      pressed?: Record<string, unknown>;
      focused?: Record<string, unknown>;
      disabled?: Record<string, unknown>;
    }
  | undefined {
  if (!stateStyles) return undefined;
  const result: {
    pressed?: Record<string, unknown>;
    focused?: Record<string, unknown>;
    disabled?: Record<string, unknown>;
  } = {};
  if (stateStyles.pressed != null) result.pressed = flattenStyle(stateStyles.pressed);
  if (stateStyles.focused != null) result.focused = flattenStyle(stateStyles.focused);
  if (stateStyles.disabled != null) result.disabled = flattenStyle(stateStyles.disabled);
  return Object.keys(result).length > 0 ? result : undefined;
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => any;

/**
 * A press handler for `button`/`pressable` types. Matches the loose RN
 * `Pressable` `onPress` shape (no required argument), so consumers can pass
 * either a no-arg callback or one that consumes the gesture event.
 */
export type PressHandler = (event?: unknown) => void;

/**
 * Element types that require a press handler at registration. The TS
 * signature on `useUIElement` rejects these types unless `handlers.onPress`
 * is provided in options.
 *
 * Picked from the action-executor in `control/action-executor.ts` — the
 * `press` action looks up `props.onPress` (or `onPressIn` /
 * `onResponderRelease`); registering a button without one is a guaranteed
 * dead-button per the 2026-05-20 manual-test session.
 */
export type PressNeedingNativeElementType = 'button' | 'pressable';

/**
 * Base options for `useUIElement`. The discriminated union below layers
 * `handlers` requirements on top of this — see {@link UseUIElementOptions}.
 */
export interface UseUIElementOptionsBase<T extends NativeElementType = NativeElementType> {
  /** Unique identifier for the element */
  id: string;
  /** Element type (defaults to 'custom') */
  type?: T;
  /** Human-readable label */
  label?: string;
  /** Override available actions */
  actions?: NativeStandardAction[];
  /** Custom actions */
  customActions?: Record<string, NativeCustomAction>;
  /**
   * Current controlled value for text inputs. When provided, it is threaded
   * into the registered element's `state.value` so a `GET /control/element/:id`
   * (or `/state`) reflects what the user sees — without this, the input
   * registers with `value: undefined` and a bridge read returns null even
   * though the field is populated. Pass the same value you bind to the RN
   * `<TextInput value={...} />` prop; the hook keeps the registry in sync as
   * it changes.
   */
  value?: string;
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
  /** Callback when state changes */
  onStateChange?: (state: NativeElementState) => void;
  /** Parent component path for tree path generation */
  parentPath?: string;
  /** RN style prop — will be flattened for design review */
  style?: unknown;
  /** State-specific style overrides for design review (pressed, focused, disabled) */
  stateStyles?: {
    pressed?: unknown;
    focused?: unknown;
    disabled?: unknown;
  };
}

/**
 * Options shape for press-needing types — `handlers.onPress` is REQUIRED.
 * Registering a `button`/`pressable` without an `onPress` produces a
 * "No press handler found on element" error when the bridge fires
 * `POST /control/element/:id/action {"action":"press"}`. Phase 1 of plan
 * `2026-05-20-manual-test-remediation` makes that a compile-time error.
 *
 * Consumers that wire `onPress` lazily (e.g. computed from props during
 * render) should use {@link useUIElementWithProps} + `captureProps({ onPress })`
 * instead. The runtime guard in this hook also warns once per id when
 * `onPress` never reaches the registry.
 */
export interface UseUIElementOptionsHandlersRequired<
  T extends PressNeedingNativeElementType = PressNeedingNativeElementType,
> extends UseUIElementOptionsBase<T> {
  /**
   * Handler props to auto-register with the bridge for action execution.
   * For `button`/`pressable`, `onPress` is required — UI Bridge invokes it
   * when a `press` action is dispatched.
   *
   * @example
   * ```tsx
   * const { ref, onLayout, bridgeProps } = useUIElement({
   *   id: 'my-button',
   *   type: 'pressable',
   *   handlers: { onPress: handlePress },
   * });
   * ```
   */
  handlers: {
    /** Required — UI Bridge invokes this on `press`/`click` actions. */
    onPress: PressHandler;
    /** Additional handlers (`onLongPress`, `onPressIn`, etc.) */
    [key: string]: AnyHandler | undefined;
  };
}

/**
 * Options shape for non-press-needing types — `handlers` is optional.
 * Applies to `input`, `text`, `view`, `list`, etc. — anything where a
 * missing `onPress` doesn't indicate a dead button.
 */
export interface UseUIElementOptionsHandlersOptional<
  T extends NativeElementType = NativeElementType,
> extends UseUIElementOptionsBase<T> {
  /**
   * Handler props to auto-register with the bridge for action execution.
   * Optional for non-press-needing types.
   */
  handlers?: Record<string, AnyHandler | undefined>;
}

/**
 * useUIElement options — discriminated union over element type.
 *
 * For `type: 'button' | 'pressable'`, `handlers.onPress` is required.
 * For all other types, `handlers` is optional.
 */
export type UseUIElementOptions<T extends NativeElementType = NativeElementType> =
  T extends PressNeedingNativeElementType
    ? UseUIElementOptionsHandlersRequired<T>
    : UseUIElementOptionsHandlersOptional<T>;

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
  /** Update style for design review (flattens and stores in registry) */
  updateStyle: (
    style: unknown,
    stateStyles?: { pressed?: unknown; focused?: unknown; disabled?: unknown }
  ) => void;
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
/**
 * Module-scoped set of ids we've already warned about so the dead-button
 * `console.warn` only fires once per id even if the component re-mounts.
 */
const warnedDeadButtonIds = new Set<string>();

/**
 * Schedule a deferred check: after one microtask + one macrotask, look up
 * the registered element. If it's a press-needing type AND no `onPress`
 * (or fallback press handler) is on the registry's `props`, emit a
 * `console.warn` pointing at the fix. Deferred so consumers using
 * {@link useUIElementWithProps} + synchronous `captureProps({ onPress })`
 * still pass the check.
 */
function scheduleDeadButtonWarning(
  bridge: ReturnType<typeof useUIBridgeNativeOptional>,
  id: string,
  type: NativeElementType
): void {
  if (type !== 'button' && type !== 'pressable') return;
  if (warnedDeadButtonIds.has(id)) return;
  if (!bridge) return;

  // Defer via macrotask so `useUIElementWithProps` consumers that call
  // `captureProps({ onPress })` from their render body land their props
  // into the registry first. queueMicrotask alone runs before the next
  // render commit on some React schedulers; setTimeout(0) is a safer
  // "after next paint" boundary without bringing in `requestAnimationFrame`.
  setTimeout(() => {
    if (warnedDeadButtonIds.has(id)) return;
    const element = bridge.registry.getElement(id);
    if (!element) return;
    const props = (element.props ?? {}) as Record<string, unknown>;
    const hasPress =
      typeof props.onPress === 'function' ||
      typeof props.onPressIn === 'function' ||
      typeof props.onResponderRelease === 'function';
    if (hasPress) return;
    warnedDeadButtonIds.add(id);
    console.warn(
      `[UI Bridge] Registered \`${type}\` element "${id}" without an \`onPress\` handler — UI Bridge \`press\` actions on this element will fail with "No press handler found on element". Use \`useUIElementWithProps\` and \`captureProps({onPress})\` instead.`
    );
  }, 0);
}

// Public overload — narrow signature. External callers see ONLY this; the
// discriminated union forces `handlers.onPress` for press-needing types.
export function useUIElement<T extends NativeElementType = NativeElementType>(
  options: UseUIElementOptions<T>
): UseUIElementReturn;
// Implementation signature — wide. Not visible to external callers (TS
// hides the impl sig); used internally by `useUIElementWithProps` via the
// narrow public sig with a structural cast.
export function useUIElement(options: UseUIElementOptionsHandlersOptional): UseUIElementReturn {
  const bridge = useUIBridgeNativeOptional();
  const ref = useRef<NativeElementRef>(null);
  const [registered, setRegistered] = useState(false);
  const [_layout, setLayout] = useState<NativeLayout | null>(null);
  const propsRef = useRef<Record<string, unknown>>({});
  // Authoritative registration tracking. See the web `useUIElement` for
  // rationale: consumers commonly pass inline `style`/`stateStyles` objects,
  // and threading the `registered` state into the register useCallback's deps
  // creates a cleanup/run feedback loop past React's 50-update ceiling.
  const registeredRef = useRef(false);
  const registeredIdRef = useRef<string | null>(null);

  const {
    id,
    type = 'custom',
    label,
    actions,
    customActions,
    autoRegister = true,
    onStateChange,
    parentPath,
    style,
    stateStyles: stateStylesProp,
    handlers: handlersProp,
    value: valueProp,
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
    if (!bridge || registeredRef.current) return;

    bridge.registry.registerElement(id, ref, {
      type,
      label,
      actions,
      customActions,
      treePath,
      testId: id,
      accessibilityLabel: label,
      registrationRoute: bridge.getCurrentRoute(),
      flatStyle: flattenStyle(style),
      stateStyles: flattenStateStyles(stateStylesProp),
    });
    registeredRef.current = true;
    registeredIdRef.current = id;

    // Seed the controlled value into the element state so a bridge read
    // reflects what the user sees immediately on mount — before any `type`/
    // `setValue` action runs. Only write when a value was actually supplied
    // so non-input elements aren't given a spurious empty `value`.
    if (typeof valueProp === 'string') {
      bridge.registry.updateElementState(id, { value: valueProp });
    }

    setRegistered(true);

    // Runtime backstop for the type-tightening: warns once per id when a
    // press-needing type is registered without an `onPress` reaching the
    // registry. Catches JS consumers and `as any` escape hatches that
    // bypass the discriminated-union signature above. Deferred so consumers
    // using `useUIElementWithProps` + `captureProps({ onPress })` from the
    // render body still pass.
    scheduleDeadButtonWarning(bridge, id, type);
  }, [bridge, id, type, label, actions, customActions, treePath, style, stateStylesProp, valueProp]);

  // Unregister the element
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterElement(registeredIdRef.current ?? id);
    registeredRef.current = false;
    registeredIdRef.current = null;
    setRegistered(false);
  }, [bridge, id]);

  // Keep `onStateChange` in a ref so the layout callback doesn't get
  // re-created (and thereby miss the first layout event) when the consumer
  // passes an inline arrow function.
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  // Handle layout changes.
  //
  // Registry write gating uses `registeredRef.current` (not the React
  // `registered` state) so the very first `onLayout` event — which can fire
  // before `setRegistered(true)` has been committed by React — still pushes
  // layout into the registry. Without this, snapshots show layout `(?, ?)`
  // until the element is interacted with, because the initial onLayout's
  // closure captured `registered === false` and silently dropped the write.
  // updateElementState itself is also no-op when the id isn't registered,
  // so this is safe even when `onLayout` fires before mount.
  const onLayout = useCallback(
    (event: LayoutEventData) => {
      const { x, y, width, height } = event.nativeEvent.layout;

      // Visibility is derived from the element's MEASURED layout rect — the
      // RN analogue of the web SDK's bounding-box visibility check (Phase 6).
      //
      // Bug this fixes: the old code computed `visible` purely from the
      // `onLayout` event's own width/height. RN fires `onLayout` for content
      // elements (Text, flex children inside a ScrollView) with transient
      // zero dimensions before the subtree settles. That stamped
      // `visible:false` onto every content element, leaving snapshots with
      // only the tab-bar buttons (which always have intrinsic size) reported
      // visible — `visibleOnly` then returned just the tabs.
      //
      // Fix: prefer the `measureInWindow` rect (authoritative on-screen size)
      // for the visibility decision, fall back to the onLayout rect, and —
      // critically — never DOWNGRADE an already-visible element to hidden on
      // a transient zero-dim reading. A measured positive-area rect means the
      // element is genuinely laid out and on screen; a zero reading is treated
      // as "not yet measured", which the backoff `measureInWindow` retry below
      // resolves, rather than as "hidden".
      const writeLayout = (newLayout: NativeLayout, measuredW: number, measuredH: number) => {
        setLayout(newLayout);
        if (!bridge) return;

        const hasPositiveArea = measuredW > 0 && measuredH > 0;
        const prevVisible = bridge.registry.getElement(id)?.getState().visible ?? false;
        // Visible if we measured a real positive-area rect; otherwise keep the
        // prior visibility (don't strand a laid-out element on a zero blip).
        const visible = hasPositiveArea ? true : prevVisible;

        const newState: NativeElementState = {
          mounted: true,
          visible,
          enabled: true,
          focused: false,
          layout: newLayout,
        };
        bridge.registry.updateElementState(id, newState);
        onStateChangeRef.current?.(newState);
      };

      // Get absolute position + measured size using measureInWindow when
      // available. The measured w/h are the on-screen dimensions and take
      // precedence over the onLayout rect for the visibility decision.
      if (ref.current && 'measureInWindow' in ref.current) {
        (
          ref.current as {
            measureInWindow: (
              callback: (pageX: number, pageY: number, w: number, h: number) => void
            ) => void;
          }
        ).measureInWindow((pageX: number, pageY: number, w: number, h: number) => {
          // Prefer measured dims; fall back to onLayout dims if the platform
          // returns zeros (some RN versions report 0 for off-screen subtrees).
          const finalW = w > 0 ? w : width;
          const finalH = h > 0 ? h : height;
          writeLayout(
            { x, y, width: finalW, height: finalH, pageX, pageY },
            finalW,
            finalH
          );
        });
      } else {
        // Fallback when measureInWindow isn't on the ref (test fixtures, web).
        writeLayout({ x, y, width, height, pageX: x, pageY: y }, width, height);
      }
    },
    [bridge, id]
  );

  // Keep latest register/unregister in refs so the auto-register effect does
  // not re-run when consumers pass inline `style`/`stateStyles` options.
  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);

  // Auto-register on mount
  useEffect(() => {
    if (autoRegister) {
      registerRef.current();
    }

    return () => {
      if (registeredRef.current) {
        unregisterRef.current();
      }
    };
  }, [autoRegister, bridge]);

  // Layout-on-mount fallback with backoff retry.
  //
  // Bug being addressed: the registry's `layout` field shows `(?, ?)` until
  // the element is actioned. Three compounding causes:
  //   1. The first `onLayout` event used to drop its write because the
  //      callback's closure captured `registered === false` (fixed above by
  //      switching to a registry-only write path).
  //   2. Some consumers don't actually thread `onLayout={onLayout}` onto
  //      their RN component, so the layout never measures.
  //   3. Elements registered while their subtree is mounted-but-not-laid-out
  //      (Expo Router lazy tabs; routes hidden behind an overlay like a
  //      Connect/login screen) return zero dims from the first
  //      `measureInWindow` call. RN doesn't re-fire `onLayout` on visibility
  //      changes when intrinsic dimensions don't change, so a single-shot
  //      measure leaves the registry entry at `visible:false, layout:null`
  //      permanently — even after the user navigates to the screen.
  //
  // Schedule a `measureInWindow` immediately after registration, and retry
  // with backoff (50/200/500/1000/2500 ms) whenever the call returns zeros.
  // Stops on first non-zero result or after the last retry. All pending
  // timers are cleared on unmount / re-register.
  useEffect(() => {
    if (!bridge || !registered) return;
    const node = ref.current as
      | (NativeElementRef & {
          measureInWindow?: (
            callback: (pageX: number, pageY: number, w: number, h: number) => void
          ) => void;
        })
      | null;
    if (!node || typeof node.measureInWindow !== 'function') return;

    let cancelled = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const backoffMs = [50, 200, 500, 1000, 2500];
    let attempt = 0;

    const tryMeasure = () => {
      if (cancelled || !node.measureInWindow) return;
      node.measureInWindow((pageX: number, pageY: number, w: number, h: number) => {
        if (cancelled) return;
        if (w > 0 && h > 0) {
          const newLayout: NativeLayout = {
            x: pageX,
            y: pageY,
            width: w,
            height: h,
            pageX,
            pageY,
          };
          setLayout(newLayout);
          const newState: NativeElementState = {
            mounted: true,
            visible: true,
            enabled: true,
            focused: false,
            layout: newLayout,
          };
          bridge.registry.updateElementState(id, newState);
          onStateChangeRef.current?.(newState);
          return;
        }
        if (attempt >= backoffMs.length) return;
        pendingTimer = setTimeout(tryMeasure, backoffMs[attempt++]);
      });
    };

    tryMeasure();

    return () => {
      cancelled = true;
      if (pendingTimer != null) clearTimeout(pendingTimer);
    };
  }, [bridge, registered, id]);

  // Auto-register handler props (onPress, onChangeText, etc.) when provided.
  // We use a ref to track which keys were last registered so we can clear
  // stale handlers on cleanup or when the handlers object changes.
  const registeredHandlerKeysRef = useRef<string[]>([]);

  useEffect(() => {
    if (!bridge || !registered || !handlersProp) return;

    // Filter to only function values
    const fnProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(handlersProp)) {
      if (typeof value === 'function') {
        fnProps[key] = value;
      }
    }

    const newKeys = Object.keys(fnProps);

    // Clear any previously registered keys that are no longer present
    const removedKeys = registeredHandlerKeysRef.current.filter((k) => !newKeys.includes(k));
    if (removedKeys.length > 0) {
      const cleared: Record<string, unknown> = {};
      for (const key of removedKeys) {
        cleared[key] = undefined;
      }
      bridge.registry.updateElementProps(id, cleared);
    }

    if (newKeys.length > 0) {
      bridge.registry.updateElementProps(id, fnProps);
    }
    registeredHandlerKeysRef.current = newKeys;

    return () => {
      // On unmount or re-run, clear all registered handlers
      if (registeredHandlerKeysRef.current.length > 0) {
        const cleared: Record<string, unknown> = {};
        for (const key of registeredHandlerKeysRef.current) {
          cleared[key] = undefined;
        }
        bridge.registry.updateElementProps(id, cleared);
        registeredHandlerKeysRef.current = [];
      }
    };
  }, [bridge, registered, id, handlersProp]);

  // Keep the registry's `state.value` in sync with the controlled `value`
  // prop. RN controlled inputs re-render with a new `value` on every
  // keystroke; mirroring it here means a bridge read (`/control/element/:id`)
  // always reflects the live field contents, not just the value at mount or
  // the last bridge-driven `type`/`setValue`. Guarded on `registered` so the
  // write lands after registration; `updateElementState` is a no-op for
  // unknown ids anyway.
  useEffect(() => {
    if (!bridge || !registered) return;
    if (typeof valueProp !== 'string') return;
    const current = bridge.registry.getElement(id)?.getState().value;
    if (current === valueProp) return;
    bridge.registry.updateElementState(id, { value: valueProp });
  }, [bridge, registered, id, valueProp]);

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

  // Update style for design review
  const updateStyle = useCallback(
    (
      newStyle: unknown,
      newStateStyles?: { pressed?: unknown; focused?: unknown; disabled?: unknown }
    ) => {
      if (!bridge || !registered) return;
      const flat = flattenStyle(newStyle);
      if (flat) {
        bridge.registry.updateElementStyle(id, flat, flattenStateStyles(newStateStyles));
      }
    },
    [bridge, registered, id]
  );

  // Get registered element
  const registeredElement = useMemo(() => {
    if (!bridge) return null;
    return bridge.registry.getElement(id) || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    updateStyle,
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

/**
 * Loose options for `useUIElementWithProps` — `handlers` is optional for ALL
 * element types because the consumer will later call `captureProps({ onPress,
 * ... })` from the render body. The runtime warning in {@link useUIElement}
 * still backstops the "captured but never called with onPress" case.
 */
export type UseUIElementWithPropsOptions<T extends NativeElementType = NativeElementType> =
  UseUIElementOptionsHandlersOptional<T>;

export function useUIElementWithProps<T extends NativeElementType = NativeElementType>(
  options: UseUIElementWithPropsOptions<T>
): UseUIElementWithPropsReturn {
  // `useUIElement`'s narrow public signature demands `handlers.onPress` for
  // press-needing types, but the whole point of this hook is to capture
  // props after the fact (via `captureProps` returned below) — so we widen
  // through `unknown`. The runtime warning in `useUIElement` still fires if
  // no onPress ever lands in the registry, regardless of the cast.
  const elementReturn = useUIElement(options as unknown as UseUIElementOptions<'view'>);
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
