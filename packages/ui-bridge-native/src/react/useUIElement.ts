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
  /**
   * Re-publish the element's label (and the mirrored `accessibilityLabel` /
   * `testId` so spec-check and a11y stay in sync). Idempotent — no-op when
   * the new label equals the current registered value.
   *
   * Labels passed via `useUIElement({ id, label })` are captured ONCE at
   * registration; if the source state changes (e.g. a tab's active suffix,
   * or a list's "N events" count), the registry would otherwise hold the
   * mount-time label forever. Call `updateLabel(...)` from a `useEffect`
   * (or directly from a handler) to keep the registry in sync.
   *
   * @example
   * ```tsx
   * const label = `${events.length} events`;
   * const { updateLabel } = useUIElement({ id: 'events-list', label, type: 'list' });
   * useEffect(() => { updateLabel(label); }, [label, updateLabel]);
   * ```
   */
  updateLabel: (newLabel: string) => void;
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
 * Module-scoped set of ids that have already received a no-op-updateLabel
 * warning. Mirrors {@link warnedDeadButtonIds} — one warn per id per process
 * lifetime, so a hot loop calling `updateLabel(sameString)` doesn't spam
 * the console while still surfacing the case during development.
 */
const warnedRedundantUpdateLabelIds = new Set<string>();

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
  const [registered, setRegistered] = useState(false);
  const [_layout, setLayout] = useState<NativeLayout | null>(null);
  const propsRef = useRef<Record<string, unknown>>({});
  // Authoritative registration tracking. See the web `useUIElement` for
  // rationale: consumers commonly pass inline `style`/`stateStyles` objects,
  // and threading the `registered` state into the register useCallback's deps
  // creates a cleanup/run feedback loop past React's 50-update ceiling.
  const registeredRef = useRef(false);
  const registeredIdRef = useRef<string | null>(null);

  // Latest bridge for the ref interceptor below. React attaches/detaches
  // refs during the commit phase — outside any effect closure — so the
  // interceptor reads the live bridge through this ref.
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  // Element ref with attach/detach interception.
  //
  // The registry seeds `visible: true` at registration (see
  // `registerElement`) so unmeasured-but-mounted elements still appear in
  // `visibleOnly` snapshots. That seed is wrong for refs that DETACH after
  // render: conditional branches (e.g. a status element rendered only in an
  // error branch) leave stale `visible: true` + layout in the registry when
  // the branch unmounts, because RN fires no event on detach. React's only
  // detach signal for object refs is the `ref.current = null` write it
  // performs on unmount — so instead of a plain `useRef`, we hand consumers
  // a stable RefObject whose `current` setter mirrors attach/detach into the
  // registry's `visible` flag:
  //   - detach (node → null) while registered  ⇒ `visible: false`
  //   - (re)attach (null → node) while registered ⇒ `visible: true`
  //     (restores the registration seed; onLayout / measureInWindow refine
  //     it with real dimensions as usual)
  // Reads (`ref.current`) behave exactly like a normal ref.
  const nodeRef = useRef<NativeElementRef>(null);
  const refInterceptorRef = useRef<React.RefObject<NativeElementRef> | null>(null);
  if (refInterceptorRef.current === null) {
    refInterceptorRef.current = {
      get current(): NativeElementRef {
        return nodeRef.current;
      },
      set current(node: NativeElementRef) {
        const prev = nodeRef.current;
        nodeRef.current = node;
        const liveBridge = bridgeRef.current;
        const registeredId = registeredIdRef.current;
        if (!liveBridge || !registeredRef.current || registeredId === null) return;
        if (node == null && prev != null) {
          // Detached after render — the element left the tree while the hook
          // (and its registration) stayed mounted. Without this write the
          // registry keeps reporting the registration-seeded `visible: true`.
          const state = liveBridge.registry.getElement(registeredId)?.getState();
          if (state && state.visible !== false) {
            liveBridge.registry.updateElementState(registeredId, { visible: false });
          }
        } else if (node != null && prev == null) {
          // (Re)attached — restore the seed's "mounted, should be visible"
          // optimism; layout measurement refines it from here.
          const state = liveBridge.registry.getElement(registeredId)?.getState();
          if (state && state.visible !== true) {
            liveBridge.registry.updateElementState(registeredId, { visible: true });
          }
        }
      },
    } as React.RefObject<NativeElementRef>;
  }
  const ref = refInterceptorRef.current;

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
    // `ref` (the interceptor object) is created exactly once per hook
    // instance, so listing it is identity-stable — included to satisfy
    // exhaustive-deps now that it isn't a direct useRef result.
  }, [bridge, id, type, label, actions, customActions, treePath, style, stateStylesProp, valueProp, ref]);

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

      const writeLayout = (newLayout: NativeLayout) => {
        setLayout(newLayout);
        if (!bridge) return;
        const newState: NativeElementState = {
          mounted: true,
          visible: width > 0 && height > 0,
          enabled: true,
          focused: false,
          layout: newLayout,
        };
        bridge.registry.updateElementState(id, newState);
        onStateChangeRef.current?.(newState);
      };

      // Get absolute position using measureInWindow when available.
      if (ref.current && 'measureInWindow' in ref.current) {
        (
          ref.current as {
            measureInWindow: (
              callback: (pageX: number, pageY: number, w: number, h: number) => void
            ) => void;
          }
        ).measureInWindow((pageX: number, pageY: number) => {
          writeLayout({ x, y, width, height, pageX, pageY });
        });
      } else {
        // Fallback when measureInWindow isn't on the ref (test fixtures, web).
        writeLayout({ x, y, width, height, pageX: x, pageY: y });
      }
    },
    // `ref` is the once-per-hook interceptor object — identity-stable.
    [bridge, id, ref]
  );

  // Keep latest register/unregister in refs so the auto-register effect does
  // not re-run when consumers pass inline `style`/`stateStyles` options.
  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);

  // Auto-register on mount, and RE-register when `id` changes.
  //
  // `id` is a real dependency even though the effect body never reads it:
  // recycled virtualized-list cells (FlashList) re-render the same hook
  // instance with a NEW id. Without `id` in the deps, the effect never
  // re-ran, so the OLD id stayed registered forever (a stale entry no
  // re-measure can fix) and the NEW id was never registered at all.
  //
  // Ordering on an id-change render: the cleanup runs first and closes over
  // the PREVIOUS `unregisterRef.current`, whose `unregister` removes
  // `registeredIdRef.current` — i.e. the OLD id — and resets the guard
  // flags. The ref-sync effect above is declared before this one, so by the
  // time this effect's body re-runs, `registerRef.current` is the fresh
  // closure that registers the NEW id. Invariant: after a rerender that
  // changes `id` from A to B, the registry has no entry for A and a live
  // entry for B.
  useEffect(() => {
    if (autoRegister) {
      registerRef.current();
    }

    return () => {
      if (registeredRef.current) {
        unregisterRef.current();
      }
    };
  }, [autoRegister, bridge, id]);

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
    if (!node) {
      // Never attached: the hook registered the element but no rendered node
      // ever received the ref (refs attach during commit, BEFORE effects run
      // — so a null ref here means the element isn't in the tree, e.g. a
      // status element only rendered in an error branch). The registration
      // seed optimistically reports `visible: true`; correct it so snapshots
      // don't claim never-rendered elements are on screen. Mounted nodes
      // that merely haven't measured yet keep the seeded `true` (the
      // lazy-tab rationale above), and the ref interceptor flips this back
      // to `true` if the element attaches later.
      const seeded = bridge.registry.getElement(id)?.getState();
      if (seeded && seeded.visible !== false) {
        bridge.registry.updateElementState(id, { visible: false });
      }
      return;
    }
    if (typeof node.measureInWindow !== 'function') return;

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
    // `ref` is the once-per-hook interceptor object — identity-stable.
  }, [bridge, registered, id, ref]);

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

  // Re-publish label / a11y label / testId for state-driven labels.
  //
  // The bug being addressed: `useUIElement({id, label})` registers the label
  // exactly once on mount. Consumers that compute a label from state
  // (e.g. `Tab: Actions${active ? ' (active)' : ''}`, `${events.length} events`)
  // see the registry permanently stuck at the mount-time string.
  //
  // Idempotent — the registry's `updateElementMeta` returns false when no
  // field actually changed, so a hot render loop calling `updateLabel(sameString)`
  // costs one Map lookup + three equality checks. To surface obviously-redundant
  // call sites during development, we emit a one-time `console.warn` per id on
  // the first observed no-op.
  const updateLabel = useCallback(
    (newLabel: string) => {
      if (!bridge || !registered) return;
      const changed = bridge.registry.updateElementMeta(id, {
        label: newLabel,
        accessibilityLabel: newLabel,
        testId: id,
      });
      if (!changed && !warnedRedundantUpdateLabelIds.has(id)) {
        warnedRedundantUpdateLabelIds.add(id);
        console.warn(
          `[UI Bridge] updateLabel("${newLabel}") on element "${id}" was a no-op (label unchanged). Gate the call behind a useEffect with [label] deps to avoid redundant publishes.`
        );
      }
    },
    [bridge, registered, id]
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
    updateLabel,
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
