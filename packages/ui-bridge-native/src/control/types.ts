/**
 * UI Bridge Native Control Types
 *
 * Types for action execution and control operations.
 */

import type {
  NativeActionRequest,
  NativeActionResponse,
  NativeFindRequest,
  NativeFindResponse,
  NativeElementState,
  WaitOptions,
} from '../core/types';
// Phase 2 (plan 2026-08-20-ui-bridge-action-declaration-shape).
import type { ParamValidationMode } from '../core/param-schema';

/**
 * Extended action request with control-specific options
 */
export interface ControlActionRequest extends NativeActionRequest {
  /** Request ID for correlation */
  requestId?: string;
  /** Capture snapshot after action */
  captureAfter?: boolean;
  /** Retry options */
  retryOptions?: {
    maxRetries?: number;
    retryDelay?: number;
  };
}

/**
 * Extended action response with control-specific data
 */
export interface ControlActionResponse extends NativeActionResponse {
  /** Request ID for correlation */
  requestId?: string;
  /** Retry count */
  retryCount?: number;
}

/**
 * Component action request
 */
export interface ComponentActionRequest {
  /** Action to execute */
  action: string;
  /** Action parameters */
  params?: Record<string, unknown>;
  /** Request ID for correlation */
  requestId?: string;
  /**
   * Abandon the action if it has not produced a result within this many
   * milliseconds (plan `2026-08-20-ui-bridge-action-declaration-shape`,
   * Phase 3). Omitted = no timeout.
   *
   * The wire-reachable half of cancellation: an `AbortSignal` cannot be
   * JSON-serialized, so an HTTP caller has no other way to call off a hung
   * handler. In-process callers should prefer the `{ signal }` option bag on
   * `executeComponentAction`; whichever fires first wins.
   *
   * Abandonment does not depend on the handler observing its signal — the
   * executor races the handler promise.
   *
   * **Validated and clamped at the executor**, so no wire caller reaches a
   * timer unchecked: `0` abandons on the next tick; a negative, `NaN`,
   * infinite or non-numeric value is REFUSED (the response is `success: false`
   * naming `timeoutMs`); anything above 24h is clamped, because past 2^31-1
   * `setTimeout` wraps negative and fires immediately. See
   * `core/abortable.ts` `normalizeActionTimeoutMs`.
   */
  timeoutMs?: number;
}

/**
 * Per-invocation options for `NativeActionExecutor.executeComponentAction`.
 *
 * In-process only — nothing here survives JSON serialization, which is why the
 * wire-reachable timeout lives on {@link ComponentActionRequest} instead.
 *
 * Mirrors `@qontinui/ui-bridge` `ComponentActionInvokeOptions`; kept local
 * because that package is an OPTIONAL peer dependency here (see
 * `core/types.ts`).
 */
export interface ComponentActionInvokeOptions {
  /**
   * Cancellation signal owned by the caller. Aborting it abandons the
   * invocation whether or not the handler observes the signal it is given.
   */
  signal?: AbortSignal;
  /**
   * What to do when `params` violate the action's declared `paramSchema`
   * (Phase 2). Omitted = `getDefaultParamValidationMode()`, which starts at
   * `'warn'`. Deliberately NOT on {@link ComponentActionRequest}: enforcement
   * is a deployment's policy, not the validated caller's to switch off.
   *
   * NOTE: this tree's {@link ComponentActionResponse} carries no
   * `failureDetails`, so an enforced rejection surfaces as a prose `error`
   * naming each offending param — the same limitation Phase 3's cancellation
   * path hit here. Giving the native channel structured failure details is a
   * separate change.
   */
  paramValidation?: ParamValidationMode;
}

/**
 * Component action response
 */
export interface ComponentActionResponse {
  /** Whether the action succeeded */
  success: boolean;
  /** Result of the action */
  result?: unknown;
  /** Error message if failed */
  error?: string;
  /** Stack trace if failed */
  stack?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
  /** Request ID for correlation */
  requestId?: string;
}

/**
 * Wait result
 */
export interface WaitResult {
  /** Whether conditions were met */
  met: boolean;
  /** Time spent waiting in milliseconds */
  waitedMs: number;
  /** Final element state */
  state?: NativeElementState;
  /** Error message if failed */
  error?: string;
}

/**
 * Action event emitted after executeAction completes (success or failure).
 */
export interface NativeActionEvent {
  elementId: string;
  action: string;
  params?: unknown;
  success: boolean;
  error?: string;
  /** ms since epoch when the executor finished the action */
  timestamp: number;
  /** request id propagated from ControlActionRequest, if any */
  requestId?: string;
  durationMs: number;
}

export type NativeActionListener = (event: NativeActionEvent) => void;

/**
 * Native action executor interface
 */
export interface NativeActionExecutor {
  /**
   * Execute an action on an element
   */
  executeAction(elementId: string, request: ControlActionRequest): Promise<ControlActionResponse>;

  /**
   * Execute a component action
   */
  executeComponentAction(
    componentId: string,
    request: ComponentActionRequest,
    options?: ComponentActionInvokeOptions
  ): Promise<ComponentActionResponse>;

  /**
   * Find elements
   */
  find(request: NativeFindRequest): Promise<NativeFindResponse>;

  /**
   * Wait for element conditions
   */
  waitForElement(elementId: string, options: WaitOptions): Promise<WaitResult>;

  /** Subscribe to action events. Returns an unsubscribe function. */
  onActionExecuted(listener: NativeActionListener): () => void;
}

/**
 * Page navigation request
 */
export interface PageNavigateRequest {
  /** URL to navigate to */
  url: string;
}

/**
 * Page navigation response
 */
export interface PageNavigationResponse {
  /** Whether the navigation succeeded */
  success: boolean;
  /** Current URL after navigation */
  url?: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Action execution options
 */
export interface ActionExecutionOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to wait for element to be ready */
  waitForReady?: boolean;
  /** Custom wait conditions */
  waitOptions?: WaitOptions;
}

/**
 * Type action params
 */
export interface TypeActionParams {
  /** Text to type */
  text: string;
  /** Typing delay between characters (ms) */
  delay?: number;
  /** Clear existing text first */
  clearFirst?: boolean;
  /** Alias for `clearFirst` matching the runner UI Bridge convention. */
  clear?: boolean;
}

/**
 * Scroll action params
 */
export interface ScrollActionParams {
  /** Scroll offset */
  offset?: { x: number; y: number };
  /** Scroll to specific position */
  position?: { x: number; y: number };
  /** Animate the scroll */
  animated?: boolean;
}

/**
 * Swipe action params
 */
export interface SwipeActionParams {
  /** Swipe direction */
  direction: 'up' | 'down' | 'left' | 'right';
  /** Swipe distance (in points) */
  distance?: number;
  /** Swipe duration (ms) */
  duration?: number;
}

/**
 * Press action params
 */
export interface PressActionParams {
  /** Position relative to element */
  position?: { x: number; y: number };
  /** Press duration (ms) for long press */
  duration?: number;
}
