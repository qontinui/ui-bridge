/**
 * Control Module Types
 *
 * Types for the control protocol and action execution.
 */

import type {
  ActionRequest,
  ActionResponse,
  ElementState,
  WaitOptions,
} from '../core/types';

/**
 * Extended action request with additional options
 */
export interface ControlActionRequest extends ActionRequest {
  /** Unique request ID for tracking */
  requestId?: string;
  /** Capture snapshot after action */
  captureAfter?: boolean;
  /** Retry options if action fails */
  retryOptions?: {
    maxRetries: number;
    retryDelay: number;
    retryOn?: ('timeout' | 'notFound' | 'disabled' | 'error')[];
  };
}

/**
 * Extended action response with additional info
 */
export interface ControlActionResponse extends ActionResponse {
  /** Request ID if provided */
  requestId?: string;
  /** Snapshot captured after action */
  snapshot?: unknown;
  /** Number of retries attempted */
  retryCount?: number;
  /** Wait duration before action */
  waitDurationMs?: number;
}

/**
 * Component action request
 */
export interface ComponentActionRequest {
  /** Action ID to execute */
  action: string;
  /** Action parameters */
  params?: Record<string, unknown>;
  /** Unique request ID */
  requestId?: string;
}

/**
 * Component action response
 */
export interface ComponentActionResponse {
  /** Whether the action succeeded */
  success: boolean;
  /** Result from the action */
  result?: unknown;
  /** Error message if failed */
  error?: string;
  /** Stack trace if failed */
  stack?: string;
  /** Duration of the action */
  durationMs: number;
  /** Timestamp when completed */
  timestamp: number;
  /** Request ID if provided */
  requestId?: string;
}

/**
 * Workflow run request
 */
export interface WorkflowRunRequest {
  /** Parameters for the workflow */
  params?: Record<string, unknown>;
  /** Request ID for tracking */
  requestId?: string;
  /** Start from a specific step */
  startStep?: string;
  /** Stop at a specific step */
  stopStep?: string;
  /** Step timeout */
  stepTimeout?: number;
  /** Total workflow timeout */
  workflowTimeout?: number;
}

/**
 * Workflow step result
 */
export interface WorkflowStepResult {
  /** Step ID */
  stepId: string;
  /** Step type */
  stepType: string;
  /** Whether the step succeeded */
  success: boolean;
  /** Step result */
  result?: unknown;
  /** Error if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp when completed */
  timestamp: number;
}

/**
 * Workflow run status
 */
export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Workflow run response
 */
export interface WorkflowRunResponse {
  /** Workflow ID */
  workflowId: string;
  /** Run ID for tracking */
  runId: string;
  /** Current status */
  status: WorkflowRunStatus;
  /** Step results */
  steps: WorkflowStepResult[];
  /** Current step index */
  currentStep?: number;
  /** Total steps */
  totalSteps: number;
  /** Overall success */
  success?: boolean;
  /** Error message if failed */
  error?: string;
  /** Start timestamp */
  startedAt: number;
  /** End timestamp */
  completedAt?: number;
  /** Total duration */
  durationMs?: number;
}

/**
 * Element info for discovery
 */
export interface DiscoveredElement {
  /** Element ID */
  id: string;
  /** Element type */
  type: string;
  /** Human-readable label */
  label?: string;
  /** Tag name */
  tagName: string;
  /** Role attribute */
  role?: string;
  /** Accessible name */
  accessibleName?: string;
  /** Available actions */
  actions: string[];
  /** Current state */
  state: ElementState;
  /** Whether registered with UI Bridge */
  registered: boolean;
}

/**
 * Discovery request options
 */
export interface DiscoveryRequest {
  /** Root element selector to start from */
  root?: string;
  /** Only discover interactive elements */
  interactiveOnly?: boolean;
  /** Include hidden elements */
  includeHidden?: boolean;
  /** Maximum elements to return */
  limit?: number;
  /** Filter by element type */
  types?: string[];
  /** Filter by selector */
  selector?: string;
}

/**
 * Discovery response
 */
export interface DiscoveryResponse {
  /** Discovered elements */
  elements: DiscoveredElement[];
  /** Total elements found */
  total: number;
  /** Discovery duration */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Control snapshot - full state of controllable UI
 */
export interface ControlSnapshot {
  /** Timestamp */
  timestamp: number;
  /** All registered elements */
  elements: Array<{
    id: string;
    type: string;
    label?: string;
    actions: string[];
    state: ElementState;
  }>;
  /** All registered components */
  components: Array<{
    id: string;
    name: string;
    actions: string[];
  }>;
  /** Available workflows */
  workflows: Array<{
    id: string;
    name: string;
    stepCount: number;
  }>;
  /** Active workflow runs */
  activeRuns: Array<{
    runId: string;
    workflowId: string;
    status: WorkflowRunStatus;
    currentStep: number;
    totalSteps: number;
  }>;
}

/**
 * Action types for keyboard input
 */
export interface KeyboardAction {
  /** Key to press */
  key: string;
  /** Key modifiers */
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
  /** Hold duration for key press */
  holdDuration?: number;
}

/**
 * Action types for mouse input
 */
export interface MouseAction {
  /** Mouse button */
  button?: 'left' | 'right' | 'middle';
  /** Click count */
  clickCount?: number;
  /** Coordinates relative to element */
  position?: { x: number; y: number };
  /** Hold duration for click */
  holdDuration?: number;
}

/**
 * Action types for scroll input
 */
export interface ScrollAction {
  /** Scroll direction */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Scroll amount in pixels */
  amount?: number;
  /** Scroll to specific position */
  position?: { x: number; y: number };
  /** Scroll to element */
  toElement?: string;
  /** Smooth scroll */
  smooth?: boolean;
}

/**
 * Type action for text input
 */
export interface TypeAction {
  /** Text to type */
  text: string;
  /** Clear existing value first */
  clear?: boolean;
  /** Delay between keystrokes (ms) */
  delay?: number;
  /** Trigger events (input, change) */
  triggerEvents?: boolean;
}

/**
 * Select action for dropdowns
 */
export interface SelectAction {
  /** Value(s) to select */
  value: string | string[];
  /** Select by label instead of value */
  byLabel?: boolean;
  /** For multi-select: add to selection */
  additive?: boolean;
}

/**
 * Wait condition result
 */
export interface WaitResult {
  /** Whether the condition was met */
  met: boolean;
  /** Time waited in milliseconds */
  waitedMs: number;
  /** Final state when resolved */
  state?: ElementState;
  /** Error if timed out */
  error?: string;
}

/**
 * Action executor interface
 */
export interface ActionExecutor {
  /** Execute an action on an element */
  executeAction(
    elementId: string,
    action: ControlActionRequest
  ): Promise<ControlActionResponse>;

  /** Execute an action on a component */
  executeComponentAction(
    componentId: string,
    action: ComponentActionRequest
  ): Promise<ComponentActionResponse>;

  /** Wait for a condition */
  waitFor(
    elementId: string,
    options: WaitOptions
  ): Promise<WaitResult>;

  /** Discover controllable elements */
  discover(options?: DiscoveryRequest): Promise<DiscoveryResponse>;

  /** Get control snapshot */
  getSnapshot(): Promise<ControlSnapshot>;
}

/**
 * Workflow engine interface
 */
export interface WorkflowEngine {
  /** Run a workflow */
  run(workflowId: string, request?: WorkflowRunRequest): Promise<WorkflowRunResponse>;

  /** Get workflow run status */
  getRunStatus(runId: string): Promise<WorkflowRunResponse | null>;

  /** Cancel a running workflow */
  cancel(runId: string): Promise<boolean>;

  /** List active runs */
  listActiveRuns(): Promise<WorkflowRunResponse[]>;
}
