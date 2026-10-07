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
import { pageRectOf, isEmptyRect } from '../core/registry';
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
  SwipeActionParams,
  PressActionParams,
} from './types';

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
 * An action failure that carries a machine-readable code of its own, so the
 * HTTP handler can report it as that code instead of the generic
 * `ACTION_FAILED`. Used for `NOT_SUPPORTED` — "this element cannot do that",
 * which a caller must not retry with a different request shape.
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

/** Default gap (logical dp) left above an element scrolled into view. */
const DEFAULT_SCROLL_INTO_VIEW_PADDING = 16;

/** Upper bound on waiting for `measureLayout` to call back. */
const SCROLL_INTO_VIEW_MEASURE_TIMEOUT_MS = 1000;

/** The slice of a React Native `ScrollView` instance `scrollIntoView` drives. */
interface ScrollContainerRef {
  scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => void;
  getInnerViewRef?: () => unknown;
  getInnerViewNode?: () => unknown;
}

/** The slice of a React Native host view `scrollIntoView` measures with. */
interface MeasurableRef {
  measureLayout: (
    relativeTo: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail?: () => void
  ) => void;
}

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
        ...(error instanceof NativeActionError ? { code: error.code } : {}),
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

      case 'scrollIntoView':
        return this.performScrollIntoView(
          element,
          params as ScrollIntoViewActionParams | undefined
        );

      case 'swipe':
        return this.performSwipe(props, params as unknown as SwipeActionParams);

      case 'toggle':
        return this.performToggle(props);

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
   * Perform scrollIntoView: scroll the element's DECLARED scroll container so
   * the element sits `padding` dp below the top of its viewport.
   *
   * The container comes from `scrollAncestorId` and nowhere else — the
   * registry keeps no parent chain (`RegisterElementOptions.scrollAncestorId`),
   * so there is no "nearest ScrollView" to find. Nothing here tracks a
   * ScrollView's content offset either (`performScroll` only fakes an
   * `onScroll` event), so the target is measured CONTENT-relative with
   * `measureLayout` against the container's inner content view: stateless,
   * and immune to a stale-offset race.
   *
   * Result shape mirrors the web executor's `scrollIntoView`
   * (`@qontinui/ui-bridge` `control/action-executor.ts`):
   * `{ alreadyVisible, scrolled }`, short-circuiting when the element is
   * already fully inside its clip region. "Fully visible" is only claimed when
   * it is MEASURED — a page-space rect for the element and a known,
   * non-empty clip (window ∩ declared container), read after a fresh
   * `refreshMeasurements()`. Anything unknown scrolls.
   *
   * Prerequisites are checked BEFORE the visibility short-circuit, so whether
   * the element supports the action does not depend on where it happens to be
   * on screen. Each missing prerequisite is a `NOT_SUPPORTED` failure.
   */
  private async performScrollIntoView(
    element: NonNullable<ReturnType<NativeUIBridgeRegistry['getElement']>>,
    params?: ScrollIntoViewActionParams
  ): Promise<{ alreadyVisible: boolean; scrolled: boolean }> {
    const padding = params?.padding ?? DEFAULT_SCROLL_INTO_VIEW_PADDING;
    if (typeof padding !== 'number' || !Number.isFinite(padding) || padding < 0) {
      throw new Error('scrollIntoView "padding" must be a finite, non-negative number');
    }

    const ancestorId = element.scrollAncestorId;
    if (!ancestorId) {
      throw new NativeActionError(
        `scrollIntoView is not supported on element "${element.id}": it declares no scrollAncestorId, ` +
          'and the registry keeps no parent chain to find its scroll container from',
        'NOT_SUPPORTED'
      );
    }
    const ancestor = ancestorId === element.id ? undefined : this.registry.getElement(ancestorId);
    if (!ancestor) {
      throw new NativeActionError(
        `scrollIntoView is not supported on element "${element.id}": its declared scrollAncestorId ` +
          `"${ancestorId}" is not a registered element`,
        'NOT_SUPPORTED'
      );
    }
    const container = ancestor.ref.current as unknown as Partial<ScrollContainerRef> | null;
    if (!container || typeof container.scrollTo !== 'function') {
      throw new NativeActionError(
        `scrollIntoView is not supported on element "${element.id}": its scroll ancestor ` +
          `"${ancestorId}" has no scrollTo (not a mounted ScrollView)`,
        'NOT_SUPPORTED'
      );
    }
    const innerView = container.getInnerViewRef?.() ?? container.getInnerViewNode?.();
    if (innerView === undefined || innerView === null) {
      throw new NativeActionError(
        `scrollIntoView is not supported on element "${element.id}": its scroll ancestor ` +
          `"${ancestorId}" exposes no inner content view to measure against`,
        'NOT_SUPPORTED'
      );
    }
    const target = element.ref.current as unknown as Partial<MeasurableRef> | null;
    if (!target || typeof target.measureLayout !== 'function') {
      throw new NativeActionError(
        `scrollIntoView is not supported on element "${element.id}": its ref has no measureLayout ` +
          '(not a mounted host view)',
        'NOT_SUPPORTED'
      );
    }

    // Already-visible short-circuit — only on MEASURED evidence. Re-measure
    // first (bounded; never throws), as the snapshot route does: the stored
    // layout of a row the user has since scrolled would otherwise claim it is
    // still on screen.
    // `updateElementState` REPLACES the map entry (new `getState` closure), so
    // read the re-fetched entry, not the `element` captured before the refresh.
    await this.registry.refreshMeasurements();
    const fresh = this.registry.getElement(element.id) ?? element;
    const state = fresh.getState();
    const rect = state.visible ? pageRectOf(state) : null;
    const clip = this.registry.getClipRectFor(fresh);
    if (
      rect &&
      clip &&
      !isEmptyRect(clip) &&
      rect.right > rect.left &&
      rect.bottom > rect.top &&
      rect.top >= clip.top &&
      rect.left >= clip.left &&
      rect.bottom <= clip.bottom &&
      rect.right <= clip.right
    ) {
      return { alreadyVisible: true, scrolled: false };
    }

    const contentY = await new Promise<number>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `scrollIntoView: measureLayout did not call back within ${SCROLL_INTO_VIEW_MEASURE_TIMEOUT_MS}ms`
          )
        );
      }, SCROLL_INTO_VIEW_MEASURE_TIMEOUT_MS);
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      try {
        target.measureLayout!(
          innerView,
          (_x, y) =>
            finish(() =>
              Number.isFinite(y)
                ? resolve(y)
                : reject(new Error('scrollIntoView: measureLayout returned a non-finite y'))
            ),
          () =>
            finish(() =>
              reject(
                new Error(
                  `scrollIntoView: measureLayout failed for "${element.id}" relative to "${ancestorId}"`
                )
              )
            )
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });

    container.scrollTo({ y: Math.max(0, contentY - padding), animated: false });
    return { alreadyVisible: false, scrolled: true };
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
