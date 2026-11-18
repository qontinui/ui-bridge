/**
 * useUIElement Hook for React Native
 *
 * Register a native element with UI Bridge for control and observation.
 */

import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState } from 'react';
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
 * A press handler for `button`/`pressable` types. Matches the loose RN
 * `Pressable` `onPress` shape (no required argument). Exported for parity
 * with the `@qontinui/ui-bridge-native` package — consumers using this slim
 * variant must wire press handlers via `useUIElementWithProps` +
 * `captureProps({ onPress })`.
 */
export type PressHandler = (event?: unknown) => void;

/**
 * Element types that require a press handler at registration. The TS
 * signature on `useUIElement` rejects these types in this slim variant —
 * consumers must switch to `useUIElementWithProps` + `captureProps({
 * onPress })`. See Phase 1 of plan `2026-05-20-manual-test-remediation`.
 */
export type PressNeedingNativeElementType = 'button' | 'pressable';

/**
 * Base options for `useUIElement` (slim variant — no `handlers` field).
 * Press-needing types are rejected by the discriminated union below; use
 * `useUIElementWithProps` for those.
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
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
  /** Callback when state changes */
  onStateChange?: (state: NativeElementState) => void;
  /** Parent component path for tree path generation */
  parentPath?: string;
  /**
   * React Native `accessibilityRole` to capture on the registered element's
   * props. Snapshot serializers map this to the `role` field on the wire
   * (Stream-A A.5). Pass the same value you spread onto the host component
   * (e.g. `<Pressable accessibilityRole="button" />`) so the bridge's
   * canonical-accessibility view stays in sync.
   */
  accessibilityRole?: string;
}

/**
 * Press-needing element types in this slim variant must use
 * `useUIElementWithProps`. Calling `useUIElement` with `type: 'button'`
 * is a TS error — `never`-keyed brand forces consumers to migrate.
 */
export interface UseUIElementOptionsPressNeedingForbidden<
  T extends PressNeedingNativeElementType = PressNeedingNativeElementType,
> extends UseUIElementOptionsBase<T> {
  /**
   * @deprecated Use `useUIElementWithProps` and `captureProps({onPress})`.
   * `useUIElement` does not register press handlers in this variant.
   */
  __pressNeedingTypesMustUseUseUIElementWithProps: never;
}

/**
 * useUIElement options — discriminated union over element type.
 *
 * For `type: 'button' | 'pressable'`, this slim variant FORBIDS the call;
 * consumers must use `useUIElementWithProps` to capture `onPress`.
 * For all other types, the slim shape is unchanged.
 */
export type UseUIElementOptions<T extends NativeElementType = NativeElementType> =
  T extends PressNeedingNativeElementType
    ? UseUIElementOptionsPressNeedingForbidden<T>
    : UseUIElementOptionsBase<T>;

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
/**
 * Module-scoped set of ids we've already warned about so the dead-button
 * `console.warn` only fires once per id even if the component re-mounts.
 */
const warnedDeadButtonIds = new Set<string>();

function scheduleDeadButtonWarning(
  bridge: ReturnType<typeof useUIBridgeNativeOptional>,
  id: string,
  type: NativeElementType
): void {
  if (type !== 'button' && type !== 'pressable') return;
  if (warnedDeadButtonIds.has(id)) return;
  if (!bridge) return;
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
// discriminated union forbids `type: 'button' | 'pressable'` in this slim
// variant. Consumers must use `useUIElementWithProps`.
export function useUIElement<T extends NativeElementType = NativeElementType>(
  options: UseUIElementOptions<T>
): UseUIElementReturn;
// Implementation signature — wide. Used internally by `useUIElementWithProps`.
export function useUIElement(options: UseUIElementOptionsBase): UseUIElementReturn {
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

  const {
    id,
    type = 'custom',
    label,
    actions,
    customActions,
    autoRegister = true,
    onStateChange,
    parentPath,
    accessibilityRole,
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

  // `actions` and `customActions` reach `register` WITHOUT their identity in its
  // deps. A call site that writes either one inline hands a new object to
  // every render. With the identity in the deps, every render minted a new
  // `register`, and the auto-register effect below re-ran on every passive
  // flush. Each run replaced the entry (`registerElement`), wiping its
  // captured props, and emitted `element:registered`.
  //
  // `actions` is keyed by VALUE instead, so a real change still re-registers.
  // `customActions` is read from the commit-time ref that the mirror below
  // keeps, and that mirror swaps it on the entry at every commit.
  const actionsKey = JSON.stringify(actions);
  const customActionsRef = useRef(customActions);

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
      customActions: customActionsRef.current,
      treePath,
      testId: id,
      accessibilityLabel: label,
      // Forward accessibilityRole onto e.props so the snapshot serializer's
      // structural-accessibility view (Stream-A A.5) reads it as `role`.
      props: accessibilityRole !== undefined ? { accessibilityRole } : undefined,
    });
    registeredRef.current = true;

    // Runtime backstop for the type-tightening — fires once per id if a
    // press-needing type is registered without `onPress` reaching the
    // registry. Phase 1, plan `2026-05-20-manual-test-remediation`.
    scheduleDeadButtonWarning(bridge, id, type);
    // `actions` is covered by `actionsKey` (its value), and `customActions` by
    // `customActionsRef` (see above). Listing either object would re-register on
    // every render of an inline literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, id, type, label, actionsKey, treePath, accessibilityRole]);

  // Unregister the element
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    // Pass the ref we registered so the registry only removes the entry if THIS
    // instance still owns the id — slot-keyed ids (`row-<index>`) can be held
    // by a different component by the time we unmount.
    bridge.registry.unregisterElement(id, ref);
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

  // Unregister AT COMMIT on unmount (a passive cleanup runs a task later for a
  // non-discrete unmount, leaving the element listed with its DOM gone). Deps
  // are [] so a churning `bridge` keeps the passive swap above.
  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  const reregisterRef = useRef(false);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);
  useLayoutEffect(() => {
    // A Suspense boundary that re-suspends runs layout cleanups but keeps
    // passive effects mounted, then re-runs only layout mounts on reveal: put
    // back what this cleanup took out, or the entry would stay gone for good.
    if (reregisterRef.current) {
      reregisterRef.current = false;
      registerRef.current();
    }
    return () => {
      if (registeredRef.current) {
        unregisterRef.current();
        reregisterRef.current = true;
      }
    };
  }, []);

  // Publish the COMMITTED `customActions` at every commit.
  //
  // The executor reads `element.customActions[action].handler` per call, so
  // swapping the one field in place is the whole publish. The advertised set,
  // each action's `effect` and the handler that runs all come from this
  // commit's object. A handler whose closure changed runs fresh, an added
  // action is callable at commit, and a withdrawn one (or a dropped option,
  // which CLEARS the field) is refused by the executor's own fallthrough.
  //
  // It also keeps `customActionsRef` current for `register`. The write is
  // owner-guarded by `ref`, and no event is emitted. No deps: the option is
  // usually an inline literal, and the setter skips an unchanged object. This
  // is declared after the at-commit effect above, so a Suspense reveal
  // re-registers first and this then re-applies the committed set.
  useLayoutEffect(() => {
    customActionsRef.current = customActions;
    if (!bridge || !registeredRef.current) return;
    bridge.registry.setElementCustomActions(id, customActions, ref);
  });

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
  /**
   * Capture props for action execution. Call it from the render body. The
   * props are published when that render commits, so a render React abandons
   * never reaches the registry. A call made after the render committed (from
   * an effect or a handler) publishes immediately.
   *
   * Keys merge across calls and renders. A key that a later render does not
   * pass keeps its last published value. The function is created per render,
   * because it writes into that render's stage, so its identity is not stable.
   * Listing it in an effect's deps re-runs that effect at each commit. That is
   * safe as long as the effect does not set state; prefer listing the captured
   * values.
   */
  captureProps: (props: Record<string, unknown>) => void;
}

/**
 * What one render passed to `captureProps`. Each render gets its own stage, and
 * only the render that COMMITS publishes it. A render React abandons (a
 * `startTransition` render that suspends, an interrupted concurrent render, a
 * StrictMode double render) takes its captures with it.
 */
interface CapturedPropsStage {
  /** The merged props of every `captureProps` call this render made. */
  props: Record<string, unknown> | undefined;
  /** Set by this render's commit. After that, a call publishes immediately. */
  committed: boolean;
}

/**
 * Loose options for `useUIElementWithProps` — accepts ALL element types
 * including `button`/`pressable` (which `useUIElement` rejects in this slim
 * variant). The runtime warning in `useUIElement` still backstops the
 * "captured but never called with onPress" case.
 */
export type UseUIElementWithPropsOptions<T extends NativeElementType = NativeElementType> =
  UseUIElementOptionsBase<T>;

export function useUIElementWithProps<T extends NativeElementType = NativeElementType>(
  options: UseUIElementWithPropsOptions<T>
): UseUIElementWithPropsReturn {
  // `useUIElement`'s public signature rejects press-needing types in this
  // slim variant — but the whole point of `useUIElementWithProps` is to
  // capture `onPress` later via the returned `captureProps` callback. Widen
  // through `unknown` to bypass; runtime warning still fires if no onPress
  // ever lands in the registry.
  const elementReturn = useUIElement(options as unknown as UseUIElementOptions<'view'>);
  const bridge = useUIBridgeNativeOptional();

  // `captureProps` is called from the render body, and it used to write the
  // registry right there. A render that React then abandoned still published
  // its handlers, so a bridge `press` could run an `onPress` that never
  // committed. Each render now stages its captures in its own object, and the
  // layout effect of the render that COMMITS publishes exactly that stage.
  //
  // A single ref shared by every render would not be enough. Abandoned renders
  // write it too, so their keys would ride into the next commit. A Suspense
  // reveal re-runs this effect without a render, and with a shared ref it would
  // re-publish whatever render ran last.
  //
  // That is also why `captureProps` is created per render rather than
  // memoized. A stable function cannot tell a call from the render body, which
  // must wait for that render's commit, from a call made after the commit,
  // which must publish now. A render that never commits leaves nothing behind
  // that such a function could check. Listing this one in an effect's deps
  // re-runs that effect at each commit, and its call publishes at once. That
  // is safe as long as the effect does not set state; prefer listing the
  // captured values instead.
  //
  // `elementReturn.registered` is a non-reactive snapshot (it mirrors the web
  // hook), so no guard reads it. Every write passes the ref `useUIElement`
  // registered with instead. That is the registry's ownership guard, so a
  // write is a no-op unless this instance holds the entry, which also covers
  // "not registered".
  const { ref } = elementReturn;
  const stage: CapturedPropsStage = { props: undefined, committed: false };
  const captureProps = (props: Record<string, unknown>) => {
    stage.props = { ...stage.props, ...props };
    // Called after this render committed, from an effect or a handler. There
    // is no commit left to wait for, so publish now, as this always did.
    if (stage.committed && bridge) {
      bridge.registry.updateElementProps(options.id, props, ref);
    }
  };

  // No deps: every commit publishes its own render's captures. A Suspense
  // reveal re-runs layout effects without re-rendering, so this also puts the
  // captures back on the entry that the reveal re-registered.
  useLayoutEffect(() => {
    stage.committed = true;
    if (!bridge || !stage.props) return;
    bridge.registry.updateElementProps(options.id, stage.props, ref);
  });

  // The same stage once more, after the passive flush. `useUIElement`
  // registers in a passive effect, which runs AFTER the layout effect above,
  // and registering never re-renders this hook. So on mount, and after any
  // re-registration (which replaces the entry, props included), nothing else
  // would publish this commit's captures. The press-handler warning would also
  // report a `button` that did capture its `onPress`.
  //
  // It runs after the auto-register effect, because `useUIElement` declared
  // that one first. Re-applying this commit's own stage cannot publish anything
  // stale: React flushes a commit's passive effects before it starts the next
  // commit.
  useEffect(() => {
    if (!bridge || !stage.props) return;
    bridge.registry.updateElementProps(options.id, stage.props, ref);
  });

  return {
    ...elementReturn,
    captureProps,
  };
}
