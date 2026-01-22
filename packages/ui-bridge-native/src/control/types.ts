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
 * Native action executor interface
 */
export interface NativeActionExecutor {
  /**
   * Execute an action on an element
   */
  executeAction(
    elementId: string,
    request: ControlActionRequest
  ): Promise<ControlActionResponse>;

  /**
   * Execute a component action
   */
  executeComponentAction(
    componentId: string,
    request: ComponentActionRequest
  ): Promise<ComponentActionResponse>;

  /**
   * Find elements
   */
  find(request: NativeFindRequest): Promise<NativeFindResponse>;

  /**
   * Wait for element conditions
   */
  waitForElement(
    elementId: string,
    options: WaitOptions
  ): Promise<WaitResult>;
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
