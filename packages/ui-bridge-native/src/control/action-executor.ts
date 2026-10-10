/**
 * Native Action Executor
 *
 * Executes actions on registered native elements and components.
 * In React Native, we execute actions by calling prop handlers directly
 * (onPress, onChangeText, etc.) rather than simulating DOM events.
 */

import type { NativeUIBridgeRegistry } from '../core/registry';
import type {
  NativeStandardAction,
  NativeFindRequest,
  NativeFindResponse,
  DiscoveredNativeElement,
  WaitOptions,
} from '../core/types';
import { findElementByIdentifier } from '../core/element-identifier';
import { pageRectOf, isEmptyRect, type NativePageRect } from '../core/registry';
// Phase 3 (plan 2026-08-20-ui-bridge-action-declaration-shape). A justified
// duplicate of the web SDK's primitive — see the header of `core/abortable.ts`
// for why this package cannot import it.
import { runAbortable, normalizeActionTimeoutMs, inertAbortSignal } from '../core/abortable';
// Phase 2 (same plan). A justified duplicate of the web SDK's validator — see
// the header of `core/param-schema.ts` for why this package cannot import it.
import {
  validateActionParams,
  formatParamValidationFailure,
  getDefaultParamValidationMode,
} from '../core/param-schema';
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  ComponentActionInvokeOptions,
  WaitResult,
  NativeActionExecutor,
  NativeActionEvent,
  NativeActionListener,
  TypeActionParams,
  ScrollActionParams,
  ScrollIntoViewActionParams,
  ScrollIntoViewResult,
  SwipeActionParams,
  PressActionParams,
} from './types';

/**
 * An action failure with a typed code. `executeAction` copies `code` onto the
 * response's `errorCode`, and the HTTP handler forwards it as the envelope
 * `code` (so `NOT_SUPPORTED` reaches the wire as 501, not a generic 400).
 */
export class NativeActionError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'NativeActionError';
  }
}

/** Default gap (dp) `scrollIntoView` leaves above the element. */
const SCROLL_INTO_VIEW_DEFAULT_PADDING = 16;
/** Upper bound (ms) on waiting for `measureLayout` to call back. */
const SCROLL_INTO_VIEW_MEASURE_TIMEOUT_MS = 500;

/** The slice of a `ScrollView` / `FlatList` ref `scrollIntoView` drives. */
interface ScrollContainerRef {
  scrollTo?: (options: { x?: number; y?: number; animated?: boolean }) => void;
  getInnerViewRef?: () => unknown;
  getInnerViewNode?: () => unknown;
  getScrollResponder?: () => ScrollContainerRef | null | undefined;
  getNativeScrollRef?: () => ScrollContainerRef | null | undefined;
}

/**
 * The ScrollView to drive: the ref itself when it has `scrollTo`, else (a
 * `FlatList` / `VirtualizedList` ref) the ScrollView it wraps.
 */
function scrollTargetOf(ref: ScrollContainerRef | null | undefined): ScrollContainerRef | null {
  if (!ref) return null;
  if (typeof ref.scrollTo === 'function') return ref;
  for (const inner of [ref.getNativeScrollRef?.(), ref.getScrollResponder?.()]) {
    if (inner && inner !== ref && typeof inner.scrollTo === 'function') return inner;
  }
  return null;
}

/**
 * The content view of a scroll container — what `measureLayout` must be
 * relative to so the y it reports is a content offset. A `ScrollView` exposes
 * it directly; a `FlatList` ref reaches it through its scroll responder.
 */
function innerViewOf(scroller: ScrollContainerRef): unknown {
  const direct = scroller.getInnerViewRef?.() ?? scroller.getInnerViewNode?.();
  if (direct != null) return direct;
  const responder = scroller.getScrollResponder?.();
  if (!responder || responder === scroller) return null;
  return responder.getInnerViewRef?.() ?? responder.getInnerViewNode?.() ?? null;
}

/** Is `inner` wholly inside `outer`? */
function rectContains(outer: NativePageRect, inner: NativePageRect): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.right <= outer.right &&
    inner.bottom <= outer.bottom
  );
}

/**
 * Default wait options
 */
const DEFAULT_WAIT_OPTIONS: Required<WaitOptions> = {
  visible: true,
  enabled: true,
  focused: false,
  state: {},
  timeout: 10000,
  interval: 100,
};

/**
 * Sleep for a duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default native action executor implementation
 */
export class DefaultNativeActionExecutor implements NativeActionExecutor {
  private actionListeners = new Set<NativeActionListener>();

  constructor(private registry: NativeUIBridgeRegistry) {}

  onActionExecuted(listener: NativeActionListener): () => void {
    this.actionListeners.add(listener);
    return () => {
      this.actionListeners.delete(listener);
    };
  }

  /** Notify listeners out-of-band; isolate each invocation so one bad listener can't poison the rest. */
  private emitActionEvent(event: NativeActionEvent): void {
    for (const listener of this.actionListeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn(`[ui-bridge-native] Action listener error:`, error);
      }
    }
  }

  /**
   * Execute an action on an element
   */
  async executeAction(
    elementId: string,
    request: ControlActionRequest
  ): Promise<ControlActionResponse> {
    const startTime = Date.now();
    let waitDurationMs = 0;

    try {
      // Find the element
      let registered = this.registry.getElement(elementId);

      // If not in registry, try by identifier
      if (!registered) {
        registered = findElementByIdentifier(elementId) ?? undefined;
      }

      if (!registered) {
        const failTime = Date.now();
        const errorMsg = `Element not found: ${elementId}`;
        this.emitActionEvent({
          elementId,
          action: request.action,
          params: request.params,
          success: false,
          error: errorMsg,
          timestamp: failTime,
          requestId: request.requestId,
          durationMs: failTime - startTime,
        });
        return {
          success: false,
          error: errorMsg,
          durationMs: failTime - startTime,
          timestamp: failTime,
          requestId: request.requestId,
        };
      }

      // Wait for conditions if specified
      if (request.waitOptions) {
        const waitResult = await this.waitForElementInternal(registered.id, request.waitOptions);
        waitDurationMs = waitResult.waitedMs;
        if (!waitResult.met) {
          const failTime = Date.now();
          const errorMsg = waitResult.error || 'Wait condition not met';
          this.emitActionEvent({
            elementId,
            action: request.action,
            params: request.params,
            success: false,
            error: errorMsg,
            timestamp: failTime,
            requestId: request.requestId,
            durationMs: failTime - startTime,
          });
          return {
            success: false,
            error: errorMsg,
            durationMs: failTime - startTime,
            timestamp: failTime,
            requestId: request.requestId,
            waitDurationMs,
          };
        }
      }

      // Execute the action
      const result = await this.performAction(registered, request.action, request.params);

      const successTime = Date.now();
      this.emitActionEvent({
        elementId,
        action: request.action,
        params: request.params,
        success: true,
        timestamp: successTime,
        requestId: request.requestId,
        durationMs: successTime - startTime,
      });
      // Re-fetch the element from the registry rather than reusing the
      // `registered` reference captured before `performAction`. Mutating
      // actions (`type`/`setValue`/`clear`/`focus`/...) call
      // `registry.updateElementState`, which REPLACES the map entry with a
      // fresh object carrying a new `getState` closure — the captured
      // `registered.getState` is stale and omits the just-set `value`. Without
      // this re-fetch the action response's `elementState` disagrees with a
      // subsequent `GET /control/element/:id` and `/control/snapshot`, which is
      // the inconsistent read-path the manual-test session flagged.
      const fresh = this.registry.getElement(registered.id) ?? registered;
      return {
        success: true,
        elementState: fresh.getState(),
        result,
        durationMs: successTime - startTime,
        timestamp: successTime,
        requestId: request.requestId,
        waitDurationMs,
      };
    } catch (error) {
      const failTime = Date.now();
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitActionEvent({
        elementId,
        action: request.action,
        params: request.params,
        success: false,
        error: errorMsg,
        timestamp: failTime,
        requestId: request.requestId,
        durationMs: failTime - startTime,
      });
      return {
        success: false,
        error: errorMsg,
        errorCode: error instanceof NativeActionError ? error.code : undefined,
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: failTime - startTime,
        timestamp: failTime,
        requestId: request.requestId,
        waitDurationMs,
      };
    }
  }

  /**
   * Perform an action on an element
   */
  private async performAction(
    element: ReturnType<NativeUIBridgeRegistry['getElement']>,
    action: NativeStandardAction | string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    if (!element) {
      throw new Error('Element not found');
    }

    const props = element.props || {};

    // Check for custom action first
    if (element.customActions && action in element.customActions) {
      // The options bag is ALWAYS supplied — `ActionHandlerOptions` promises
      // it, and a handler written the documented way (`(params, { signal }) =>
      // …`) throws on `undefined`. An element action carries no cancellation
      // source, so the signal is inert; see `inertAbortSignal`.
      return element.customActions[action].handler(params, { signal: inertAbortSignal() });
    }

    // Execute standard actions
    switch (action) {
      case 'click': // Web UI Bridge compatibility alias
      case 'press':
        return this.performPress(props, params as PressActionParams | undefined);

      case 'longPress':
        return this.performLongPress(props, params as PressActionParams | undefined);

      case 'doubleTap':
        return this.performDoubleTap(props);

      case 'type':
        return this.performType(element, props, params as unknown as TypeActionParams);

      case 'setValue':
        return this.performSetValue(element, props, params as unknown as TypeActionParams);

      case 'clear':
        return this.performClear(element, props);

      case 'focus':
        return this.performFocus(element);

      case 'blur':
        return this.performBlur(element);

      case 'scroll':
        return this.performScroll(props, params as ScrollActionParams | undefined);

      case 'swipe':
        return this.performSwipe(props, params as unknown as SwipeActionParams);

      case 'toggle':
        return this.performToggle(props);

      case 'scrollIntoView':
        return this.performScrollIntoView(element, params as ScrollIntoViewActionParams);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Perform press action
   */
  private async performPress(
    props: Record<string, unknown>,
    params?: PressActionParams
  ): Promise<void> {
    // Try different press handlers in order of preference
    const handlers = ['onPress', 'onPressIn', 'onResponderRelease'];

    for (const handler of handlers) {
      if (typeof props[handler] === 'function') {
        // Create a synthetic event object
        const event = this.createPressEvent(params);
        (props[handler] as (event: unknown) => void)(event);
        return;
      }
    }

    throw new Error('No press handler found on element');
  }

  /**
   * Perform long press action
   */
  private async performLongPress(
    props: Record<string, unknown>,
    params?: PressActionParams
  ): Promise<void> {
    if (typeof props.onLongPress === 'function') {
      const event = this.createPressEvent(params);
      (props.onLongPress as (event: unknown) => void)(event);
      return;
    }

    throw new Error('No long press handler found on element');
  }

  /**
   * Perform double tap action
   */
  private async performDoubleTap(props: Record<string, unknown>): Promise<void> {
    // First try dedicated double tap handler
    if (typeof props.onDoubleTap === 'function') {
      (props.onDoubleTap as () => void)();
      return;
    }

    // Fall back to calling press twice
    if (typeof props.onPress === 'function') {
      const event = this.createPressEvent();
      (props.onPress as (event: unknown) => void)(event);
      await sleep(50);
      (props.onPress as (event: unknown) => void)(event);
      return;
    }

    throw new Error('No press handler found for double tap');
  }

  /**
   * Perform type action
   */
  private async performType(
    element: ReturnType<NativeUIBridgeRegistry['getElement']>,
    props: Record<string, unknown>,
    params: TypeActionParams
  ): Promise<void> {
    if (!params?.text) {
      throw new Error('Type action requires text parameter');
    }

    // Clear first if requested. Accept either `clearFirst` (native SDK
    // convention) or `clear` (runner UI Bridge convention) — so agents
    // using the same action across platforms don't hit a naming mismatch.
    if (params.clearFirst || params.clear) {
      await this.performClear(element, props);
    }

    // Type character by character if delay specified
    if (params.delay && params.delay > 0) {
      const currentValue = (element?.getState().value || '') as string;
      for (const char of params.text) {
        const newValue = currentValue + char;
        if (typeof props.onChangeText === 'function') {
          (props.onChangeText as (text: string) => void)(newValue);
        }
        await sleep(params.delay);
      }
    } else {
      // Type all at once
      if (typeof props.onChangeText === 'function') {
        (props.onChangeText as (text: string) => void)(params.text);
      } else if (typeof props.onChange === 'function') {
        (props.onChange as (event: { nativeEvent: { text: string } }) => void)({
          nativeEvent: { text: params.text },
        });
      } else {
        throw new Error('No text change handler found on element');
      }
    }

    // Update element state
    if (element) {
      this.registry.updateElementState(element.id, { value: params.text });
    }
  }

  /**
   * Perform setValue action.
   *
   * Web/runner UI Bridge parity: `setValue` replaces the input's value
   * atomically in a single call (no per-character keystroke simulation),
   * mirroring the web bridge's `setValue` semantics. On native there is no
   * DOM value to assign, so we drive the controlled-input handler
   * (`onChangeText`, falling back to `onChange`) with the full string. The
   * registry's `state.value` is then synced so a subsequent GET on the
   * element reflects the new value.
   *
   * Unlike `type`, this does not append to existing content and ignores
   * `delay` — it is the deterministic "set the field to exactly this" action.
   */
  private async performSetValue(
    element: ReturnType<NativeUIBridgeRegistry['getElement']>,
    props: Record<string, unknown>,
    params: TypeActionParams
  ): Promise<void> {
    // `text` is the canonical key; accept `value` as an alias so callers using
    // the web bridge's `{ value }` body shape work without translation.
    const next =
      typeof params?.text === 'string'
        ? params.text
        : typeof (params as { value?: unknown })?.value === 'string'
          ? ((params as { value?: string }).value as string)
          : undefined;

    if (typeof next !== 'string') {
      throw new Error('setValue action requires a string "text" (or "value") parameter');
    }

    if (typeof props.onChangeText === 'function') {
      (props.onChangeText as (text: string) => void)(next);
    } else if (typeof props.onChange === 'function') {
      (props.onChange as (event: { nativeEvent: { text: string } }) => void)({
        nativeEvent: { text: next },
      });
    } else {
      throw new Error('No text change handler found on element');
    }

    if (element) {
      this.registry.updateElementState(element.id, { value: next });
    }
  }

  /**
   * Perform clear action
   */
  private async performClear(
    element: ReturnType<NativeUIBridgeRegistry['getElement']>,
    props: Record<string, unknown>
  ): Promise<void> {
    if (typeof props.onChangeText === 'function') {
      (props.onChangeText as (text: string) => void)('');
    } else if (typeof props.onChange === 'function') {
      (props.onChange as (event: { nativeEvent: { text: string } }) => void)({
        nativeEvent: { text: '' },
      });
    }

    // Update element state
    if (element) {
      this.registry.updateElementState(element.id, { value: '' });
    }
  }

  /**
   * Perform focus action
   */
  private async performFocus(
    element: ReturnType<NativeUIBridgeRegistry['getElement']>
  ): Promise<void> {
    if (element?.ref.current && 'focus' in element.ref.current) {
      (element.ref.current as { focus: () => void }).focus();
    }

    // Update element state
    if (element) {
      this.registry.updateElementState(element.id, { focused: true });
    }
  }

  /**
   * Perform blur action
   */
  private async performBlur(
    element: ReturnType<NativeUIBridgeRegistry['getElement']>
  ): Promise<void> {
    if (element?.ref.current && 'blur' in element.ref.current) {
      (element.ref.current as { blur: () => void }).blur();
    }

    // Update element state
    if (element) {
      this.registry.updateElementState(element.id, { focused: false });
    }
  }

  /**
   * Perform scroll action
   */
  private async performScroll(
    props: Record<string, unknown>,
    params?: ScrollActionParams
  ): Promise<void> {
    if (typeof props.onScroll === 'function') {
      const event = {
        nativeEvent: {
          contentOffset: params?.offset || { x: 0, y: 0 },
        },
      };
      (props.onScroll as (event: unknown) => void)(event);
    }
  }

  /**
   * Perform scrollIntoView.
   *
   * React Native has no `element.scrollIntoView()`, and the registry keeps no
   * parent chain, so the scroll container is the one the element DECLARES via
   * `scrollAncestorId`. That container must resolve to a `ScrollView`: either
   * the ref itself, or — for a `FlatList`, whose ref has no `scrollTo` — the
   * ScrollView behind its `getNativeScrollRef()` / `getScrollResponder()`.
   * The ScrollView supplies `scrollTo` and a content view handle
   * (`getInnerViewRef` / `getInnerViewNode`).
   *
   * Nothing tracks a `ScrollView`'s content offset, so the element is measured
   * CONTENT-RELATIVE instead: `measureLayout` against the container's inner
   * view yields the element's y inside the scrolled content, and
   * `scrollTo({ y: y - padding })` puts it at the top of the container. That is
   * stateless — no recorded offset that can go stale.
   *
   * Mirrors the web SDK's result shape `{ alreadyVisible, scrolled }` and its
   * already-visible short-circuit. Fails with a typed `NOT_SUPPORTED` when no
   * scroll ancestor is declared/registered, the ancestor has no `scrollTo`, or
   * no inner-view handle resolves — never "Unknown action".
   */
  private async performScrollIntoView(
    element: NonNullable<ReturnType<NativeUIBridgeRegistry['getElement']>>,
    params?: ScrollIntoViewActionParams
  ): Promise<ScrollIntoViewResult> {
    const ancestorId = element.scrollAncestorId;
    if (!ancestorId || ancestorId === element.id) {
      throw new NativeActionError(
        `scrollIntoView on "${element.id}" needs a declared scroll container: register the element with \`scrollAncestorId\` naming its registered ScrollView/FlatList (React Native exposes no parent chain to discover one).`,
        'NOT_SUPPORTED'
      );
    }
    const ancestor = this.registry.getElement(ancestorId);
    if (!ancestor) {
      throw new NativeActionError(
        `scrollIntoView on "${element.id}": its scrollAncestorId "${ancestorId}" is not a registered element.`,
        'NOT_SUPPORTED'
      );
    }
    const scroller = scrollTargetOf(ancestor.ref.current as ScrollContainerRef | null);
    if (!scroller || typeof scroller.scrollTo !== 'function') {
      throw new NativeActionError(
        `scrollIntoView on "${element.id}": scroll ancestor "${ancestorId}" has no scrollTo() on its ref (attach the hook's ref to the ScrollView/FlatList itself).`,
        'NOT_SUPPORTED'
      );
    }
    const innerView = innerViewOf(scroller);
    if (innerView == null) {
      throw new NativeActionError(
        `scrollIntoView on "${element.id}": scroll ancestor "${ancestorId}" exposes no inner content view (getInnerViewRef/getInnerViewNode) to measure against.`,
        'NOT_SUPPORTED'
      );
    }
    const node = element.ref.current as {
      measureLayout?: (
        relativeTo: unknown,
        onSuccess: (x: number, y: number, width: number, height: number) => void,
        onFail?: () => void
      ) => void;
    } | null;
    if (!node || typeof node.measureLayout !== 'function') {
      throw new NativeActionError(
        `scrollIntoView on "${element.id}": the element's ref has no measureLayout() (attach the hook's ref to a host view).`,
        'NOT_SUPPORTED'
      );
    }

    const padding =
      typeof params?.padding === 'number' && Number.isFinite(params.padding) && params.padding >= 0
        ? params.padding
        : SCROLL_INTO_VIEW_DEFAULT_PADDING;
    const animated = params?.animated === true;

    // Already-visible short-circuit (web parity). Geometry is captured at mount
    // and RN does not re-fire onLayout on pure translation, so measure fresh.
    // An unmeasurable rect is UNKNOWN, not visible — fall through and scroll.
    // Only a measure that actually called back counts: a 'skipped' (timeout,
    // no measureInWindow) leaves a possibly stale stored rect.
    const [elOutcome, ancestorOutcome] = await Promise.all([
      this.registry.measureElement(element.id),
      this.registry.measureElement(ancestorId),
    ]);
    const freshlyMeasured = elOutcome === 'measured' && ancestorOutcome === 'measured';
    const before = pageRectOf((this.registry.getElement(element.id) ?? element).getState());
    const clip = this.registry.getClipRectFor(this.registry.getElement(element.id) ?? element);
    if (freshlyMeasured && before && clip && !isEmptyRect(clip) && rectContains(clip, before)) {
      return { alreadyVisible: true, scrolled: false, scrollAncestorId: ancestorId, inView: true };
    }

    const contentY = await new Promise<number>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`scrollIntoView on "${element.id}": measureLayout never called back.`));
      }, SCROLL_INTO_VIEW_MEASURE_TIMEOUT_MS);
      const fail = (cause?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(
            `scrollIntoView on "${element.id}": measureLayout relative to "${ancestorId}" failed${cause instanceof Error ? `: ${cause.message}` : ''}.`
          )
        );
      };
      try {
        node.measureLayout!(
          innerView,
          (_x, y) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (Number.isFinite(y)) resolve(y);
            else
              reject(
                new Error(`scrollIntoView on "${element.id}": measureLayout returned y=${y}.`)
              );
          },
          () => fail()
        );
      } catch (err) {
        fail(err);
      }
    });

    const offsetY = Math.max(0, contentY - padding);
    scroller.scrollTo({ y: offsetY, animated });

    // Confirm by observation: re-measure after the scroll lands. A rect that
    // cannot be re-measured leaves `inView` UNKNOWN (null), never assumed.
    await sleep(animated ? 400 : 32);
    let inView: boolean | null = null;
    const outcome = await this.registry.measureElement(element.id);
    if (outcome === 'measured') {
      const after = pageRectOf((this.registry.getElement(element.id) ?? element).getState());
      const afterClip = this.registry.getClipRectFor(
        this.registry.getElement(element.id) ?? element
      );
      if (after && afterClip) {
        inView =
          !isEmptyRect(afterClip) && after.top >= afterClip.top && after.top < afterClip.bottom;
      }
    }

    if (inView === false) {
      throw new Error(
        `scrollIntoView on "${element.id}": scrolled "${ancestorId}" to y=${offsetY} but a fresh measure still puts the element outside the visible region.`
      );
    }

    return {
      alreadyVisible: false,
      scrolled: true,
      scrollAncestorId: ancestorId,
      offsetY,
      inView,
    };
  }

  /**
   * Perform swipe action
   */
  private async performSwipe(
    props: Record<string, unknown>,
    params: SwipeActionParams
  ): Promise<void> {
    if (!params?.direction) {
      throw new Error('Swipe action requires direction parameter');
    }

    // Try dedicated swipe handlers
    const handlerMap: Record<string, string> = {
      left: 'onSwipeLeft',
      right: 'onSwipeRight',
      up: 'onSwipeUp',
      down: 'onSwipeDown',
    };

    const handler = handlerMap[params.direction];
    if (handler && typeof props[handler] === 'function') {
      (props[handler] as () => void)();
      return;
    }

    // Fall back to generic swipe handler
    if (typeof props.onSwipe === 'function') {
      (props.onSwipe as (direction: string) => void)(params.direction);
    }
  }

  /**
   * Perform toggle action
   */
  private async performToggle(props: Record<string, unknown>): Promise<void> {
    // For Switch components
    if (typeof props.onValueChange === 'function') {
      const currentValue = props.value as boolean;
      (props.onValueChange as (value: boolean) => void)(!currentValue);
      return;
    }

    // Fall back to press
    if (typeof props.onPress === 'function') {
      (props.onPress as () => void)();
      return;
    }

    throw new Error('No toggle handler found on element');
  }

  /**
   * Create a synthetic press event
   */
  private createPressEvent(params?: PressActionParams): object {
    return {
      nativeEvent: {
        locationX: params?.position?.x ?? 0,
        locationY: params?.position?.y ?? 0,
        timestamp: Date.now(),
      },
      persist: () => {},
    };
  }

  /**
   * Execute a component action
   */
  async executeComponentAction(
    componentId: string,
    request: ComponentActionRequest,
    options: ComponentActionInvokeOptions = {}
  ): Promise<ComponentActionResponse> {
    const startTime = Date.now();

    try {
      const component = this.registry.getComponent(componentId);

      if (!component) {
        return {
          success: false,
          error: `Component not found: ${componentId}`,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }

      // Find the action
      const action = component.actions.find((a) => a.id === request.action);

      if (!action) {
        return {
          success: false,
          error: `Action not found: ${request.action}`,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }

      // `timeoutMs` is WIRE data — the HTTP entry point forwards it verbatim
      // from a JSON body — so it is validated and clamped here, before it can
      // reach a timer. See `normalizeActionTimeoutMs` for the policy (0
      // abandons on the next tick; negative / NaN / non-numeric are refused;
      // anything above 24h is clamped, because past 2^31-1 `setTimeout` wraps
      // negative and fires immediately).
      const timeout = normalizeActionTimeoutMs(request.timeoutMs);
      if (!timeout.ok) {
        return {
          success: false,
          error: `Action "${request.action}" on component "${componentId}" was rejected: ${timeout.reason}.`,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }
      const timeoutMs = timeout.timeoutMs;

      // Phase 2: `paramSchema` is published to agents, so it has to mean
      // something. Validate BEFORE the handler runs — a rejection after a
      // side-effect is not a rejection.
      const validationMode = options.paramValidation ?? getDefaultParamValidationMode();
      if (validationMode !== 'off' && action.paramSchema !== undefined) {
        // The validator walks AUTHOR-supplied schema data. It is bounded
        // against both known fault routes (`param-schema.ts` MAX_SCHEMA_DEPTH /
        // MAX_PATTERN_LENGTH), but it is wrapped anyway: without this, a
        // validator fault would fall into the generic catch below and be
        // reported as a HANDLER failure, for a handler that never ran.
        let validation: ReturnType<typeof validateActionParams>;
        try {
          validation = validateActionParams(action.paramSchema, request.params);
        } catch (validatorFault) {
          const detail =
            validatorFault instanceof Error ? validatorFault.message : String(validatorFault);
          const faultMessage = `Action "${request.action}" on component "${componentId}": its declared paramSchema could not be evaluated (${detail}).`;
          if (validationMode === 'enforce') {
            // A gate that cannot be evaluated has not been cleared. The prose
            // names the SCHEMA, so it is not mistaken for a handler fault.
            return {
              success: false,
              error: faultMessage,
              durationMs: Date.now() - startTime,
              timestamp: Date.now(),
              requestId: request.requestId,
            };
          }
          console.warn(`[ui-bridge-native] ${faultMessage}`);
          validation = { valid: true, issues: [] };
        }
        if (!validation.valid) {
          const message = formatParamValidationFailure(
            componentId,
            request.action,
            validation.issues
          );
          if (validationMode === 'enforce') {
            // Prose `error` rather than structured `failureDetails` — this
            // tree's response type has no such field. See the note on
            // `ComponentActionInvokeOptions.paramValidation`.
            return {
              success: false,
              error: message,
              durationMs: Date.now() - startTime,
              timestamp: Date.now(),
              requestId: request.requestId,
            };
          }
          console.warn(`[ui-bridge-native] ${message}`);
        }
      }

      // The handler is *given* a signal (cooperative cancellation) and is
      // *raced* against it (enforced abandonment) — a handler that ignores its
      // signal must still be abandonable at the caller. Phase 3 of plan
      // 2026-08-20-ui-bridge-action-declaration-shape.
      const outcome = await runAbortable((signal) => action.handler(request.params, { signal }), {
        signal: options.signal,
        timeoutMs,
      });

      if (outcome.aborted) {
        // NOTE: this tree's `ComponentActionResponse` has no `failureDetails`
        // field and this package ships no diagnostics module, so the
        // cancellation surfaces as a prose `error` rather than through
        // `buildActionFailureDetails('UB-ACTION-FAILED', ...)` the way the web
        // seam does. Giving the native channel structured failure details is a
        // separate change, not Phase 3.
        return {
          success: false,
          error:
            outcome.reason === 'timeout'
              ? `Action "${request.action}" on component "${componentId}" was abandoned after its ${timeoutMs}ms timeout elapsed.`
              : `Action "${request.action}" on component "${componentId}" was cancelled by the caller's abort signal.`,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId,
        };
      }

      return {
        success: true,
        result: outcome.result,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
      };
    }
  }

  /**
   * Find elements
   */
  async find(request: NativeFindRequest): Promise<NativeFindResponse> {
    const startTime = Date.now();

    const allElements = this.registry.getAllElements();
    let filtered = allElements;

    // Filter by type
    if (request.types && request.types.length > 0) {
      filtered = filtered.filter((e) => request.types!.includes(e.type));
    }

    // Filter by testID pattern
    if (request.testIdPattern) {
      const regex = new RegExp(request.testIdPattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
      filtered = filtered.filter((e) => {
        const identifier = e.getIdentifier();
        return identifier.testId && regex.test(identifier.testId);
      });
    }

    // Filter by accessibility label pattern
    if (request.accessibilityLabelPattern) {
      const regex = new RegExp(
        request.accessibilityLabelPattern.replace(/\*/g, '.*').replace(/\?/g, '.')
      );
      filtered = filtered.filter((e) => {
        const identifier = e.getIdentifier();
        return identifier.accessibilityLabel && regex.test(identifier.accessibilityLabel);
      });
    }

    // Filter by visibility
    if (request.visibleOnly) {
      filtered = filtered.filter((e) => e.getState().visible);
    }

    // Apply limit
    if (request.limit && request.limit > 0) {
      filtered = filtered.slice(0, request.limit);
    }

    // Map to discovered elements
    const elements: DiscoveredNativeElement[] = filtered.map((e) => ({
      id: e.id,
      type: e.type,
      identifier: e.getIdentifier(),
      state: e.getState(),
      actions: e.actions,
      label: e.label,
    }));

    return {
      elements,
      total: elements.length,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  /**
   * Wait for element conditions
   */
  async waitForElement(elementId: string, options: WaitOptions): Promise<WaitResult> {
    return this.waitForElementInternal(elementId, options);
  }

  /**
   * Internal wait implementation
   */
  private async waitForElementInternal(
    elementId: string,
    options: WaitOptions
  ): Promise<WaitResult> {
    const opts = { ...DEFAULT_WAIT_OPTIONS, ...options };
    const startTime = Date.now();

    while (Date.now() - startTime < opts.timeout) {
      const element = this.registry.getElement(elementId);

      if (!element) {
        await sleep(opts.interval);
        continue;
      }

      const state = element.getState();

      // Check conditions
      let conditionsMet = true;

      if (opts.visible && !state.visible) {
        conditionsMet = false;
      }

      if (opts.enabled && !state.enabled) {
        conditionsMet = false;
      }

      if (opts.focused && !state.focused) {
        conditionsMet = false;
      }

      // Check custom state conditions
      if (opts.state && Object.keys(opts.state).length > 0) {
        const stateRecord = state as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(opts.state)) {
          if (stateRecord[key] !== value) {
            conditionsMet = false;
            break;
          }
        }
      }

      if (conditionsMet) {
        return {
          met: true,
          waitedMs: Date.now() - startTime,
          state,
        };
      }

      await sleep(opts.interval);
    }

    return {
      met: false,
      waitedMs: Date.now() - startTime,
      error: `Timeout waiting for conditions on element: ${elementId}`,
    };
  }
}

/**
 * Create a native action executor
 */
export function createNativeActionExecutor(registry: NativeUIBridgeRegistry): NativeActionExecutor {
  return new DefaultNativeActionExecutor(registry);
}
