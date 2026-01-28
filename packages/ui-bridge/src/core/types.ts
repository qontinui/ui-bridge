/**
 * UI Bridge Core Types
 *
 * Defines the fundamental types used throughout the UI Bridge framework,
 * plus ui-bridge-specific types (WebSocket protocol, accessibility, extended workflow types).
 */

// ============================================================================
// Core Element Types
// ============================================================================

/**
 * Element identification using multiple strategies
 */
export interface ElementIdentifier {
  /** Explicit UI Bridge identifier (data-ui-id attribute) */
  uiId?: string;
  /** Testing library convention (data-testid attribute) */
  testId?: string;
  /** Legacy AWAS support (data-awas-element attribute) */
  awasId?: string;
  /** HTML id attribute */
  htmlId?: string;
  /** Generated XPath selector */
  xpath: string;
  /** Generated CSS selector */
  selector: string;
}

/**
 * Current state of a UI element
 */
export interface ElementState {
  /** Whether the element is visible in the viewport */
  visible: boolean;
  /** Whether the element is enabled (not disabled) */
  enabled: boolean;
  /** Whether the element has focus */
  focused: boolean;
  /** Bounding rectangle of the element */
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  /** Current value for inputs */
  value?: string;
  /** Checked state for checkboxes/radios */
  checked?: boolean;
  /** Selected options for select elements */
  selectedOptions?: string[];
  /** Text content of the element */
  textContent?: string;
  /** Inner HTML of the element (sanitized) */
  innerHTML?: string;
  /** Computed styles relevant for automation */
  computedStyles?: {
    display: string;
    visibility: string;
    opacity: string;
    pointerEvents: string;
  };
}

/**
 * Types of UI elements that can be registered
 */
export type ElementType =
  | 'button'
  | 'input'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'link'
  | 'form'
  | 'textarea'
  | 'menu'
  | 'menuitem'
  | 'tab'
  | 'dialog'
  | 'custom'
  | 'switch'
  | 'slider'
  | 'combobox'
  | 'listbox'
  | 'option'
  | 'textbox'
  | 'generic';

/**
 * Standard actions available on elements
 */
export type StandardAction =
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'type'
  | 'clear'
  | 'select'
  | 'focus'
  | 'blur'
  | 'hover'
  | 'scroll'
  | 'check'
  | 'uncheck'
  | 'toggle'
  | 'setValue'
  | 'drag'
  | 'submit'
  | 'reset';

/**
 * Handler for custom actions
 */
export type ActionHandler<TParams = unknown, TResult = unknown> = (
  params?: TParams
) => TResult | Promise<TResult>;

/**
 * Custom action definition
 */
export interface CustomAction<TParams = unknown, TResult = unknown> {
  /** Action identifier */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Description of what the action does */
  description?: string;
  /** Action handler function */
  handler: ActionHandler<TParams, TResult>;
}

/**
 * A UI element registered with the bridge
 */
export interface RegisteredElement {
  /** Unique identifier for this element */
  id: string;
  /** The DOM element reference */
  element: HTMLElement;
  /** Type of UI element */
  type: ElementType;
  /** Human-readable label */
  label?: string;
  /** Available standard actions for this element */
  actions: StandardAction[];
  /** Custom actions specific to this element */
  customActions?: Record<string, CustomAction>;
  /** Function to get the current state */
  getState: () => ElementState;
  /** Function to get the element identifier */
  getIdentifier: () => ElementIdentifier;
  /** Timestamp when the element was registered */
  registeredAt: number;
  /** Whether this element is currently mounted */
  mounted: boolean;

  // AI-Native metadata
  /** Alternative names for natural language matching */
  aliases?: string[];
  /** Human-readable description for AI agents */
  description?: string;
  /** Semantic type (more descriptive than ElementType) */
  semanticType?: string;
  /** Purpose of the element */
  purpose?: string;
}

// ============================================================================
// Component Types
// ============================================================================

/**
 * Generic state getter function
 */
export type StateGetter<T = unknown> = () => T;

/**
 * Component action definition
 */
export interface ComponentAction<TParams = unknown, TResult = unknown> {
  /** Action identifier */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Description of what the action does */
  description?: string;
  /** Parameter schema (for documentation/validation) */
  paramSchema?: Record<string, unknown>;
  /** Action handler function */
  handler: ActionHandler<TParams, TResult>;
}

/**
 * A component registered with the bridge (higher-level than elements)
 */
export interface RegisteredComponent {
  /** Unique identifier for this component */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the component's purpose */
  description?: string;
  /** Available actions on this component */
  actions: ComponentAction[];
  /** Child element IDs owned by this component */
  elementIds?: string[];
  /** Timestamp when the component was registered */
  registeredAt: number;
  /** Whether this component is currently mounted */
  mounted: boolean;
  /** State getter function */
  getState?: StateGetter<Record<string, unknown>>;
  /** Computed properties getter function */
  getComputed?: () => Record<string, unknown>;
}

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Workflow step types
 */
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

/**
 * Branch condition for conditional workflow execution
 */
export interface BranchCondition {
  /** State IDs that must be active */
  activeStates?: string[];
  /** State IDs that must be inactive */
  inactiveStates?: string[];
  /** Element ID to check state of */
  elementId?: string;
  /** Expected element state */
  elementState?: Partial<ElementState>;
  /** Custom condition function */
  condition?: () => boolean | Promise<boolean>;
}

/**
 * Loop configuration for repeated workflow steps
 */
export interface LoopConfig {
  /** Maximum number of iterations */
  maxIterations?: number;
  /** Continue while these states are active */
  whileStatesActive?: string[];
  /** Continue while these states are inactive */
  whileStatesInactive?: string[];
  /** Custom continue condition */
  whileCondition?: () => boolean | Promise<boolean>;
  /** Delay between iterations in ms */
  delayMs?: number;
}

/**
 * Extract configuration for data extraction
 */
export interface ExtractConfig {
  /** Element ID to extract from */
  elementId: string;
  /** Property to extract (value, textContent, innerHTML, attribute) */
  property: 'value' | 'textContent' | 'innerHTML' | 'attribute' | 'state';
  /** Attribute name (if property is 'attribute') */
  attributeName?: string;
  /** Variable name to store extracted value */
  variableName: string;
  /** Optional transformation function */
  transform?: (value: unknown) => unknown;
}

/**
 * Log configuration for debugging
 */
export interface LogConfig {
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Message to log */
  message: string;
  /** Additional data to include */
  data?: Record<string, unknown>;
  /** Include current active states */
  includeStates?: boolean;
  /** Include element state */
  elementId?: string;
}

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  /** Step identifier */
  id: string;
  /** Type of step */
  type: WorkflowStepType;
  /** Target element or component ID */
  target?: string;
  /** Action to execute */
  action?: string;
  /** Action parameters */
  params?: Record<string, unknown>;
  /** Wait conditions */
  waitOptions?: WaitOptions;
  /** Expected state for assertions */
  expectedState?: Partial<ElementState>;
  /** Custom step handler */
  handler?: () => unknown | Promise<unknown>;
  /** Target states for navigation (type: 'navigate') */
  targetStates?: string[];
  /** Branch condition (type: 'branch') */
  branchCondition?: BranchCondition;
  /** Steps to execute if branch condition is true */
  thenSteps?: WorkflowStep[];
  /** Steps to execute if branch condition is false */
  elseSteps?: WorkflowStep[];
  /** Loop configuration (type: 'loop') */
  loopConfig?: LoopConfig;
  /** Steps to execute in loop */
  loopSteps?: WorkflowStep[];
  /** Extract configuration (type: 'extract') */
  extractConfig?: ExtractConfig;
  /** Log configuration (type: 'log') */
  logConfig?: LogConfig;
}

/**
 * Extended workflow step with additional branch/loop/extract support
 */
export interface ExtendedWorkflowStep extends WorkflowStep {
  /** Branch condition (type: 'branch') */
  branchCondition?: BranchCondition;
  /** Steps to execute if branch condition is true */
  thenSteps?: ExtendedWorkflowStep[];
  /** Steps to execute if branch condition is false */
  elseSteps?: ExtendedWorkflowStep[];
  /** Loop configuration (type: 'loop') */
  loopConfig?: LoopConfig;
  /** Steps to execute in loop */
  loopSteps?: ExtendedWorkflowStep[];
  /** Extract configuration (type: 'extract') */
  extractConfig?: ExtractConfig;
  /** Log configuration (type: 'log') */
  logConfig?: LogConfig;
}

/**
 * Workflow definition
 */
export interface Workflow {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the workflow does */
  description?: string;
  /** Steps to execute */
  steps: WorkflowStep[];
  /** Default parameters for the workflow */
  defaultParams?: Record<string, unknown>;
}

/**
 * Wait options for actions
 */
export interface WaitOptions {
  /** Wait for element to be visible */
  visible?: boolean;
  /** Wait for element to be enabled */
  enabled?: boolean;
  /** Wait for element to have focus */
  focused?: boolean;
  /** Wait for element state to match */
  state?: Partial<ElementState>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Polling interval in milliseconds */
  interval?: number;
}

/**
 * Action request sent to the control API
 */
export interface ActionRequest {
  /** Action to execute */
  action: StandardAction | string;
  /** Action parameters */
  params?: {
    /** Text to type */
    text?: string;
    /** Value to select */
    value?: string;
    /** Scroll offset */
    offset?: { x: number; y: number };
    /** Key modifiers */
    modifiers?: {
      ctrl?: boolean;
      shift?: boolean;
      alt?: boolean;
      meta?: boolean;
    };
    /** Additional custom parameters */
    [key: string]: unknown;
  };
  /** Wait options before executing */
  waitOptions?: WaitOptions;
}

/**
 * Response from an action execution
 */
export interface ActionResponse {
  /** Whether the action succeeded */
  success: boolean;
  /** Element state after the action */
  elementState?: ElementState;
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
}

// ============================================================================
// Action Failure Types
// ============================================================================

/**
 * Machine-readable error codes for action failures
 */
export type ActionErrorCode =
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_NOT_VISIBLE'
  | 'ELEMENT_NOT_ENABLED'
  | 'ELEMENT_NOT_INTERACTABLE'
  | 'ACTION_TIMEOUT'
  | 'ACTION_REJECTED'
  | 'STATE_NOT_REACHED'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'AMBIGUOUS_MATCH'
  | 'LOW_CONFIDENCE'
  | 'UNSUPPORTED_ACTION'
  | 'UNKNOWN_ERROR';

/**
 * Partial element match found during search
 */
export interface PartialMatch {
  /** Element ID of the partial match */
  elementId: string;
  /** Match confidence score (0-1) */
  confidence: number;
  /** Reason for partial match */
  reason: string;
  /** Type of match */
  type: string;
  /** Description of the match */
  description?: string;
}

/**
 * Suggested recovery action
 */
export interface RecoveryAction {
  /** Human-readable suggestion */
  suggestion: string;
  /** Optional command to execute */
  command?: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether the original action can be retried */
  retryable: boolean;
}

/**
 * Structured error details for action failures
 */
export interface ActionFailureDetails {
  /** Machine-readable error code */
  errorCode: ActionErrorCode;
  /** Human-readable error message */
  message: string;
  /** Element ID that was targeted */
  elementId?: string;
  /** CSS selectors that were tried */
  selectorsTried?: string[];
  /** Partial matches found during element search */
  partialMatches?: PartialMatch[];
  /** Element state at time of failure */
  elementState?: ElementState;
  /** Screenshot context (base64 or URL) */
  screenshotContext?: string;
  /** Suggested recovery actions */
  suggestedActions: RecoveryAction[];
  /** Whether retrying is recommended */
  retryRecommended: boolean;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Duration of the action in milliseconds */
  durationMs?: number;
  /** Timeout that was configured in milliseconds */
  timeoutMs?: number;
}

// ============================================================================
// Bridge Snapshot & Event Types
// ============================================================================

/**
 * Snapshot of the entire UI bridge state
 */
export interface BridgeSnapshot {
  /** Timestamp of the snapshot */
  timestamp: number;
  /** All registered elements */
  elements: Array<{
    id: string;
    type: ElementType;
    label?: string;
    identifier: ElementIdentifier;
    state: ElementState;
    actions: StandardAction[];
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
 * Event types emitted by the bridge
 */
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

/**
 * Event payload structure
 */
export interface BridgeEvent<T = unknown> {
  type: BridgeEventType;
  timestamp: number;
  data: T;
}

/**
 * Event listener function
 */
export type BridgeEventListener<T = unknown> = (event: BridgeEvent<T>) => void;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * UI Bridge feature flags
 */
export interface UIBridgeFeatures {
  /** Enable render logging (DOM observation) */
  renderLog?: boolean;
  /** Enable HTTP control endpoints */
  control?: boolean;
  /** Enable debug tools (inspector, metrics) */
  debug?: boolean;
}

/**
 * UI Bridge configuration
 */
export interface UIBridgeConfig {
  /** Port for standalone server */
  serverPort?: number;
  /** API path prefix for integrated servers */
  apiPath?: string;
  /** Enable WebSocket for real-time updates */
  websocket?: boolean;
  /** WebSocket port (defaults to serverPort) */
  websocketPort?: number;
  /** Log file path for render logs */
  logFilePath?: string;
  /** Maximum number of render log entries to keep */
  maxLogEntries?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

// ============================================================================
// Component State Types
// ============================================================================

/**
 * Computed property definition
 */
export interface ComputedProperty<T = unknown> {
  /** Getter function for the computed value */
  getter: () => T;
  /** Description of what the computed property represents */
  description?: string;
}

/**
 * Response from getting component state
 */
export interface ComponentStateResponse {
  /** Current state values */
  state: Record<string, unknown>;
  /** Current computed property values */
  computed: Record<string, unknown>;
  /** Timestamp when the state was captured */
  timestamp: number;
}

// ============================================================================
// State Management Types
// ============================================================================

/**
 * UI State definition
 *
 * Represents a distinct state in the UI (e.g., "LoginForm", "Dashboard", "Modal").
 * States can be active or inactive, and can block other states from activating.
 */
export interface UIState {
  /** Unique state identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Element IDs belonging to this state */
  elements: string[];
  /** Optional function to detect if state is active */
  activeWhen?: () => boolean;
  /** If true, blocks other state activations (modal behavior) */
  blocking?: boolean;
  /** Specific state IDs this state blocks */
  blocks?: string[];
  /** State group membership */
  group?: string;
  /** Cost for pathfinding (default: 1.0) */
  pathCost?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * State group - states that activate/deactivate atomically
 *
 * When a group is activated, all its states are activated together.
 * When deactivated, all states are deactivated together.
 */
export interface UIStateGroup {
  /** Unique group identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** State IDs belonging to this group */
  states: string[];
}

/**
 * State transition definition
 *
 * Defines how to move from one set of states to another,
 * including any actions to execute during the transition.
 */
export interface UITransition {
  /** Unique transition identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Precondition: at least one must be active */
  fromStates: string[];
  /** States to activate */
  activateStates: string[];
  /** States to deactivate */
  exitStates: string[];
  /** Groups to activate */
  activateGroups?: string[];
  /** Groups to deactivate */
  exitGroups?: string[];
  /** Actions to execute during transition */
  actions?: WorkflowStep[];
  /** Cost for pathfinding */
  pathCost?: number;
  /** Whether source states remain visible during transition */
  staysVisible?: boolean;
}

/**
 * Path result from pathfinding
 *
 * Returned when searching for a path to target states.
 */
export interface PathResult {
  /** Whether a path was found */
  found: boolean;
  /** Transition IDs in order to reach target */
  transitions: string[];
  /** Total cost of the path */
  totalCost: number;
  /** Target state IDs */
  targetStates: string[];
  /** Estimated number of steps */
  estimatedSteps: number;
}

/**
 * Transition execution result
 */
export interface TransitionResult {
  /** Whether the transition succeeded */
  success: boolean;
  /** States that were activated */
  activatedStates: string[];
  /** States that were deactivated */
  deactivatedStates: string[];
  /** Error message if failed */
  error?: string;
  /** Phase where failure occurred (if any) */
  failedPhase?: string;
  /** Duration of the transition in milliseconds */
  durationMs: number;
}

/**
 * Navigation result
 *
 * Returned after navigating to target states via pathfinding.
 */
export interface NavigationResult {
  /** Whether navigation succeeded */
  success: boolean;
  /** The path that was followed */
  path: PathResult;
  /** Transitions that were executed */
  executedTransitions: string[];
  /** Final active states after navigation */
  finalActiveStates: string[];
  /** Error message if failed */
  error?: string;
  /** Duration of the navigation in milliseconds */
  durationMs: number;
}

/**
 * State manager snapshot
 */
export interface StateSnapshot {
  /** Timestamp of the snapshot */
  timestamp: number;
  /** Currently active state IDs */
  activeStates: string[];
  /** All registered states */
  states: UIState[];
  /** All registered state groups */
  groups: UIStateGroup[];
  /** All registered transitions */
  transitions: UITransition[];
}

// ============================================================================
// WebSocket Protocol Types
// ============================================================================

/**
 * WebSocket message types from client to server
 */
export type WSClientMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'ping'
  | 'find'
  | 'discover'
  | 'getElement'
  | 'getSnapshot'
  | 'executeAction'
  | 'executeComponentAction'
  | 'executeWorkflow';

/**
 * WebSocket message types from server to client
 */
export type WSServerMessageType =
  | 'welcome'
  | 'pong'
  | 'subscribed'
  | 'unsubscribed'
  | 'event'
  | 'response'
  | 'error'
  | 'workflowProgress';

/**
 * Base WebSocket message structure
 */
export interface WSMessageBase {
  /** Unique message ID for request/response correlation */
  id: string;
  /** Message type */
  type: WSClientMessageType | WSServerMessageType;
  /** Timestamp when message was created */
  timestamp: number;
}

/**
 * Client message: Subscribe to events
 */
export interface WSSubscribeMessage extends WSMessageBase {
  type: 'subscribe';
  payload: {
    events?: BridgeEventType[];
    elementIds?: string[];
    componentIds?: string[];
  };
}

/**
 * Client message: Unsubscribe from events
 */
export interface WSUnsubscribeMessage extends WSMessageBase {
  type: 'unsubscribe';
  payload: {
    events?: BridgeEventType[];
  };
}

/**
 * Client message: Ping (keepalive)
 */
export interface WSPingMessage extends WSMessageBase {
  type: 'ping';
}

/**
 * Client message: Find elements
 */
export interface WSFindMessage extends WSMessageBase {
  type: 'find';
  payload?: {
    interactiveOnly?: boolean;
    includeState?: boolean;
    selector?: string;
  };
}

/**
 * Client message: Discover elements (deprecated)
 * @deprecated Use WSFindMessage instead
 */
export interface WSDiscoverMessage extends WSMessageBase {
  type: 'discover';
  payload?: {
    interactiveOnly?: boolean;
    includeState?: boolean;
    selector?: string;
  };
}

/**
 * Client message: Get element details
 */
export interface WSGetElementMessage extends WSMessageBase {
  type: 'getElement';
  payload: {
    elementId: string;
    includeState?: boolean;
  };
}

/**
 * Client message: Get full snapshot
 */
export interface WSGetSnapshotMessage extends WSMessageBase {
  type: 'getSnapshot';
}

/**
 * Client message: Execute action on element
 */
export interface WSExecuteActionMessage extends WSMessageBase {
  type: 'executeAction';
  payload: {
    elementId: string;
    action: {
      action: string;
      params?: Record<string, unknown>;
      waitOptions?: WaitOptions;
    };
  };
}

/**
 * Client message: Execute component action
 */
export interface WSExecuteComponentActionMessage extends WSMessageBase {
  type: 'executeComponentAction';
  payload: {
    componentId: string;
    action: string;
    params?: Record<string, unknown>;
  };
}

/**
 * Client message: Execute workflow
 */
export interface WSExecuteWorkflowMessage extends WSMessageBase {
  type: 'executeWorkflow';
  payload: {
    workflowId: string;
    params?: Record<string, unknown>;
    streamProgress?: boolean;
  };
}

/**
 * Union type for all client messages
 */
export type WSClientMessage =
  | WSSubscribeMessage
  | WSUnsubscribeMessage
  | WSPingMessage
  | WSFindMessage
  | WSDiscoverMessage
  | WSGetElementMessage
  | WSGetSnapshotMessage
  | WSExecuteActionMessage
  | WSExecuteComponentActionMessage
  | WSExecuteWorkflowMessage;

/**
 * Server message: Welcome (sent on connection)
 */
export interface WSWelcomeMessage extends WSMessageBase {
  type: 'welcome';
  payload: {
    version: string;
    features: UIBridgeFeatures;
    clientId: string;
  };
}

/**
 * Server message: Pong (response to ping)
 */
export interface WSPongMessage extends WSMessageBase {
  type: 'pong';
}

/**
 * Server message: Subscription confirmed
 */
export interface WSSubscribedMessage extends WSMessageBase {
  type: 'subscribed';
  payload: {
    events: BridgeEventType[];
  };
}

/**
 * Server message: Unsubscription confirmed
 */
export interface WSUnsubscribedMessage extends WSMessageBase {
  type: 'unsubscribed';
  payload: {
    events: BridgeEventType[];
  };
}

/**
 * Server message: Event notification
 */
export interface WSEventMessage extends WSMessageBase {
  type: 'event';
  payload: BridgeEvent;
}

/**
 * Server message: Response to a request
 */
export interface WSResponseMessage<T = unknown> extends WSMessageBase {
  type: 'response';
  requestId: string;
  payload: {
    success: boolean;
    data?: T;
    error?: string;
  };
}

/**
 * Server message: Error
 */
export interface WSErrorMessage extends WSMessageBase {
  type: 'error';
  requestId?: string;
  payload: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Server message: Workflow progress update
 */
export interface WSWorkflowProgressMessage extends WSMessageBase {
  type: 'workflowProgress';
  requestId: string;
  payload: {
    workflowId: string;
    currentStep: number;
    totalSteps: number;
    step: {
      id: string;
      type: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
    };
    stepResult?: unknown;
    error?: string;
  };
}

/**
 * Union type for all server messages
 */
export type WSServerMessage =
  | WSWelcomeMessage
  | WSPongMessage
  | WSSubscribedMessage
  | WSUnsubscribedMessage
  | WSEventMessage
  | WSResponseMessage
  | WSErrorMessage
  | WSWorkflowProgressMessage;

/**
 * WebSocket connection state
 */
export type WSConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * WebSocket client configuration
 */
export interface WSClientConfig {
  /** WebSocket server URL */
  url: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in milliseconds */
  reconnectDelay?: number;
  /** Maximum reconnect attempts (0 = infinite) */
  maxReconnectAttempts?: number;
  /** Ping interval in milliseconds (0 = disabled) */
  pingInterval?: number;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
}

/**
 * Subscription options for WebSocket client
 */
export interface WSSubscriptionOptions {
  /** Event types to subscribe to */
  events?: BridgeEventType[];
  /** Filter by element IDs */
  elementIds?: string[];
  /** Filter by component IDs */
  componentIds?: string[];
}

// ============================================================================
// Accessibility Types
// ============================================================================

/**
 * ARIA checked state (can be boolean or 'mixed' for indeterminate)
 */
export type AriaCheckedState = boolean | 'mixed';

/**
 * Accessibility information for a UI element
 */
export interface ElementAccessibility {
  /** The element's computed role (explicit or implicit) */
  role: string;
  /** Computed accessible name following ARIA name computation */
  accessibleName?: string;
  /** Computed accessible description */
  accessibleDescription?: string;
  /** Value of aria-label attribute */
  ariaLabel?: string;
  /** Value of aria-labelledby attribute */
  ariaLabelledBy?: string;
  /** Value of aria-describedby attribute */
  ariaDescribedBy?: string;
  /** Whether element is expanded (for expandable elements) */
  ariaExpanded?: boolean;
  /** Whether element is selected (for selectable elements) */
  ariaSelected?: boolean;
  /** Checked state (for checkboxes, can be true/false/'mixed') */
  ariaChecked?: AriaCheckedState;
  /** Whether element is hidden from accessibility tree */
  ariaHidden?: boolean;
  /** Whether element is disabled via aria-disabled */
  ariaDisabled?: boolean;
  /** Whether element is required (for form inputs) */
  ariaRequired?: boolean;
  /** Current aria-live value for live regions */
  ariaLive?: 'off' | 'polite' | 'assertive';
  /** Tab index value */
  tabIndex: number;
  /** Whether element is in the tab order (tabindex >= 0 or naturally focusable) */
  isInTabOrder: boolean;
  /** Whether element can receive keyboard focus */
  isKeyboardAccessible: boolean;
  /** The implicit role based on element type (before explicit role override) */
  implicitRole?: string;
  /** Whether element has an explicit role attribute */
  hasExplicitRole: boolean;
}

/**
 * WCAG conformance level
 */
export type WCAGLevel = 'A' | 'AA' | 'AAA';

/**
 * Accessibility issue severity
 */
export type AccessibilitySeverity = 'critical' | 'serious' | 'moderate' | 'minor';

/**
 * An accessibility issue found during validation
 */
export interface AccessibilityIssue {
  /** Unique identifier for this issue instance */
  id: string;
  /** The WCAG success criterion this issue relates to (e.g., "4.1.2") */
  wcagCriterion: string;
  /** How severe this issue is */
  severity: AccessibilitySeverity;
  /** WCAG conformance level this criterion belongs to */
  level: WCAGLevel;
  /** Human-readable description of the issue */
  message: string;
  /** ID of the element with the issue */
  elementId: string;
  /** Selector to find the element */
  elementSelector?: string;
  /** Suggested fix for the issue */
  suggestion: string;
  /** The rule ID that detected this issue */
  ruleId: string;
}

/**
 * Accessibility validation report
 */
export interface AccessibilityReport {
  /** When the validation was performed */
  timestamp: number;
  /** URL of the page that was validated */
  url: string;
  /** Number of elements that were scanned */
  elementsScanned: number;
  /** All issues found during validation */
  issues: AccessibilityIssue[];
  /** Number of checks that passed */
  passedCount: number;
  /** Number of checks that failed */
  failedCount: number;
  /** Whether the page meets WCAG 2.1 Level A */
  meetsWCAG_A: boolean;
  /** Whether the page meets WCAG 2.1 Level AA */
  meetsWCAG_AA: boolean;
  /** Human-readable summary of the validation */
  summary: string;
  /** Duration of the validation in milliseconds */
  durationMs: number;
}
