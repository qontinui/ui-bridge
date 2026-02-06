/**
 * UI Bridge Native Core Types
 *
 * Defines the fundamental types used throughout the UI Bridge Native framework.
 * Adapted from ui-bridge for React Native environments.
 */

// We use a generic type for native element refs to avoid dependency on specific
// react-native versions. In practice, these will be View, TextInput, etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNativeElement = any;

// Re-export common types from the web version that don't need adaptation
// Note: In a real implementation, these would be imported from ui-bridge/core
// For now, we define WaitOptions locally to avoid the dependency
export interface WaitOptions {
  /** Wait for element to be visible */
  visible?: boolean;
  /** Wait for element to be enabled */
  enabled?: boolean;
  /** Wait for element to have focus */
  focused?: boolean;
  /** Wait for element state to match */
  state?: Record<string, unknown>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Polling interval in milliseconds */
  interval?: number;
}

// Types that would be re-exported from ui-bridge/core in a full implementation
export type ActionHandler<TParams = unknown, TResult = unknown> = (
  params?: TParams
) => TResult | Promise<TResult>;

export interface CustomAction<TParams = unknown, TResult = unknown> {
  id: string;
  label?: string;
  description?: string;
  handler: ActionHandler<TParams, TResult>;
}

export interface ComponentAction<TParams = unknown, TResult = unknown> {
  id: string;
  label?: string;
  description?: string;
  paramSchema?: Record<string, unknown>;
  handler: ActionHandler<TParams, TResult>;
}

export type WorkflowStepType =
  | 'element-action'
  | 'component-action'
  | 'wait'
  | 'assert'
  | 'navigate'
  | 'branch'
  | 'loop'
  | 'extract'
  | 'log'
  | 'custom';

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  target?: string;
  action?: string;
  params?: Record<string, unknown>;
  waitOptions?: WaitOptions;
  handler?: () => unknown | Promise<unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  defaultParams?: Record<string, unknown>;
}

export type BridgeEventType =
  | 'element:registered'
  | 'element:unregistered'
  | 'element:stateChanged'
  | 'component:registered'
  | 'component:unregistered'
  | 'action:started'
  | 'action:completed'
  | 'action:failed'
  | 'workflow:started'
  | 'workflow:stepCompleted'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'render:snapshot'
  | 'error';

export interface BridgeEvent<T = unknown> {
  type: BridgeEventType;
  timestamp: number;
  data: T;
}

export type BridgeEventListener<T = unknown> = (event: BridgeEvent<T>) => void;

/**
 * React Native element reference type.
 * Uses a generic type to avoid conflicts between different react-native versions.
 */
export type NativeElementRef = AnyNativeElement | null;

/**
 * Element identification for React Native (replaces XPath/CSS selectors)
 */
export interface NativeElementIdentifier {
  /** Explicit UI Bridge identifier */
  uiId?: string;
  /** React Native testID prop */
  testId?: string;
  /** Accessibility label */
  accessibilityLabel?: string;
  /** Accessibility hint */
  accessibilityHint?: string;
  /** Tree path for element (e.g., "App/HomeScreen/Button[0]") */
  treePath: string;
  /** Native handle (platform-specific) */
  nativeHandle?: number;
}

/**
 * Layout information from onLayout callback
 */
export interface NativeLayout {
  /** X position relative to parent */
  x: number;
  /** Y position relative to parent */
  y: number;
  /** Element width */
  width: number;
  /** Element height */
  height: number;
  /** Absolute X position on screen (from measureInWindow) */
  pageX: number;
  /** Absolute Y position on screen (from measureInWindow) */
  pageY: number;
}

/**
 * Current state of a native UI element
 */
export interface NativeElementState {
  /** Whether the element is mounted in the tree */
  mounted: boolean;
  /** Whether the element is visible on screen */
  visible: boolean;
  /** Whether the element is enabled (not disabled) */
  enabled: boolean;
  /** Whether the element has focus */
  focused: boolean;
  /** Layout information */
  layout: NativeLayout | null;
  /** Current value for text inputs */
  value?: string;
  /** Selected state for toggles/checkboxes */
  selected?: boolean;
  /** Checked state for checkboxes/radios */
  checked?: boolean;
  /** Text content of the element */
  textContent?: string;
  /** Additional accessibility state */
  accessibilityState?: {
    disabled?: boolean;
    selected?: boolean;
    checked?: boolean | 'mixed';
    busy?: boolean;
    expanded?: boolean;
  };
}

/**
 * Types of native UI elements that can be registered
 */
export type NativeElementType =
  | 'button'
  | 'input'
  | 'text'
  | 'view'
  | 'scroll'
  | 'list'
  | 'listItem'
  | 'switch'
  | 'checkbox'
  | 'radio'
  | 'image'
  | 'touchable'
  | 'pressable'
  | 'modal'
  | 'custom';

/**
 * Standard actions available on native elements
 */
export type NativeStandardAction =
  | 'press'
  | 'longPress'
  | 'doubleTap'
  | 'type'
  | 'clear'
  | 'focus'
  | 'blur'
  | 'scroll'
  | 'swipe'
  | 'toggle';

/**
 * Custom action definition for native elements
 */
export interface NativeCustomAction<TParams = unknown, TResult = unknown> {
  /** Action identifier */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Description of what the action does */
  description?: string;
  /** Action handler function */
  handler: (params?: TParams) => TResult | Promise<TResult>;
}

/**
 * A native UI element registered with the bridge
 */
export interface RegisteredNativeElement {
  /** Unique identifier for this element */
  id: string;
  /** Reference to the native element */
  ref: React.RefObject<NativeElementRef>;
  /** Type of UI element */
  type: NativeElementType;
  /** Human-readable label */
  label?: string;
  /** Available standard actions for this element */
  actions: NativeStandardAction[];
  /** Custom actions specific to this element */
  customActions?: Record<string, NativeCustomAction>;
  /** Props passed to the element (for action execution) */
  props?: Record<string, unknown>;
  /** Function to get the current state */
  getState: () => NativeElementState;
  /** Function to get the element identifier */
  getIdentifier: () => NativeElementIdentifier;
  /** Timestamp when the element was registered */
  registeredAt: number;
  /** Whether this element is currently mounted */
  mounted: boolean;
}

/**
 * Component action definition for native components
 */
export interface NativeComponentAction<TParams = unknown, TResult = unknown> {
  /** Action identifier */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Description of what the action does */
  description?: string;
  /** Parameter schema (for documentation/validation) */
  paramSchema?: Record<string, unknown>;
  /** Action handler function */
  handler: (params?: TParams) => TResult | Promise<TResult>;
}

/**
 * A native component registered with the bridge (higher-level than elements)
 */
export interface RegisteredNativeComponent {
  /** Unique identifier for this component */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the component's purpose */
  description?: string;
  /** Available actions on this component */
  actions: NativeComponentAction[];
  /** Child element IDs owned by this component */
  elementIds?: string[];
  /** Timestamp when the component was registered */
  registeredAt: number;
  /** Whether this component is currently mounted */
  mounted: boolean;
}

/**
 * Action request for native elements
 */
export interface NativeActionRequest {
  /** Action to execute */
  action: NativeStandardAction | string;
  /** Action parameters */
  params?: {
    /** Text to type */
    text?: string;
    /** Scroll offset */
    offset?: { x: number; y: number };
    /** Swipe direction */
    direction?: 'up' | 'down' | 'left' | 'right';
    /** Duration in milliseconds */
    duration?: number;
    /** Additional custom parameters */
    [key: string]: unknown;
  };
  /** Wait options before executing */
  waitOptions?: WaitOptions;
}

/**
 * Response from a native action execution
 */
export interface NativeActionResponse {
  /** Whether the action succeeded */
  success: boolean;
  /** Element state after the action */
  elementState?: NativeElementState;
  /** Result of the action (for custom actions) */
  result?: unknown;
  /** Error message if failed */
  error?: string;
  /** Stack trace if failed */
  stack?: string;
  /** Duration of the action in milliseconds */
  durationMs: number;
  /** Timestamp when the action completed */
  timestamp: number;
  /** Request ID for correlation */
  requestId?: string;
  /** Time spent waiting for conditions */
  waitDurationMs?: number;
}

/**
 * Snapshot of the entire native UI bridge state
 */
export interface NativeBridgeSnapshot {
  /** Timestamp of the snapshot */
  timestamp: number;
  /** All registered elements */
  elements: Array<{
    id: string;
    type: NativeElementType;
    label?: string;
    identifier: NativeElementIdentifier;
    state: NativeElementState;
    actions: NativeStandardAction[];
    customActions?: string[];
  }>;
  /** All registered components */
  components: Array<{
    id: string;
    name: string;
    description?: string;
    actions: string[];
    elementIds?: string[];
  }>;
  /** Available workflows */
  workflows: Array<{
    id: string;
    name: string;
    description?: string;
    stepCount: number;
  }>;
}

/**
 * UI Bridge Native feature flags
 */
export interface NativeUIBridgeFeatures {
  /** Enable HTTP control server */
  server?: boolean;
  /** Enable debug tools (inspector overlay) */
  debug?: boolean;
}

/**
 * UI Bridge Native configuration
 */
export interface NativeUIBridgeConfig {
  /** Port for HTTP server */
  serverPort?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Path prefix for parent components (for treePath generation) */
  parentPath?: string;
}

/**
 * Find request for discovering native elements
 */
export interface NativeFindRequest {
  /** Filter by element type */
  types?: NativeElementType[];
  /** Filter by testID pattern (supports wildcards) */
  testIdPattern?: string;
  /** Filter by accessibility label pattern */
  accessibilityLabelPattern?: string;
  /** Include only visible elements */
  visibleOnly?: boolean;
  /** Maximum number of results */
  limit?: number;
}

/**
 * Discovered native element
 */
export interface DiscoveredNativeElement {
  /** Element ID */
  id: string;
  /** Element type */
  type: NativeElementType;
  /** Element identifier */
  identifier: NativeElementIdentifier;
  /** Current state */
  state: NativeElementState;
  /** Available actions */
  actions: NativeStandardAction[];
  /** Label */
  label?: string;
}

/**
 * Find response
 */
export interface NativeFindResponse {
  /** Discovered elements */
  elements: DiscoveredNativeElement[];
  /** Total count */
  total: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}
