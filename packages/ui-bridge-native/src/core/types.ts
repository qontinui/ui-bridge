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
  | 'click'
  | 'longPress'
  | 'doubleTap'
  | 'type'
  | 'setValue'
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
  /** Route path where this element was registered (for page-scoped filtering) */
  registrationRoute?: string | null;
  /** Flattened RN style for design review */
  flatStyle?: Record<string, unknown>;
  /** State-specific style overrides (pressed, focused, disabled) */
  stateStyles?: {
    pressed?: Record<string, unknown>;
    focused?: Record<string, unknown>;
    disabled?: Record<string, unknown>;
  };
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
 * Registration coverage metadata. Lets automation agents detect routes that
 * have interactive controls but never registered any of them with the bridge,
 * without having to read source code.
 *
 * - `totalRegistered`: number of elements currently in the registry.
 * - `everHadRegistrations`: sticks `true` once any element is registered, even
 *   after every element has been unregistered. A route that registered then
 *   unmounted should NOT be reported as "never wired".
 * - `byRoute`: count of currently-registered elements grouped by
 *   `registrationRoute`. Elements registered without a route are bucketed
 *   under `'?'`, which is itself a useful diagnostic signal.
 */
export interface NativeRegistrationCoverage {
  totalRegistered: number;
  everHadRegistrations: boolean;
  byRoute: Record<string, number>;
}

/**
 * Application info reported alongside snapshots/health responses.
 *
 * Re-export of the `appInfo` shape used in `NativeUIBridgeConfig` so
 * snapshot consumers can type-narrow without importing the config.
 */
export interface NativeAppInfo {
  appId: string;
  appName: string;
  appType: 'web' | 'desktop' | 'mobile' | 'other';
  framework?: string;
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
    /** Handler names actually registered via updateElementProps (e.g. ['onPress', 'onChangeText']) */
    registeredHandlers?: string[];
    /** Route path where this element was registered (for page-scoped filtering) */
    registrationRoute?: string | null;
    /**
     * Best-effort visibility classification for the element. React Native has
     * no first-class "is this in the viewport" signal — we infer from
     * `state.visible` (set false by `markRouteOffscreen` on focus change) and
     * `state.layout` (populated by the user's `onLayout` callback).
     *
     * - `"visible"` — `visible: true` AND `layout !== null` (we measured it).
     * - `"likely-visible"` — `visible: true` AND `layout === null`. Typically
     *   means the element is registered on the active route but its first
     *   `onLayout` hasn't fired yet. Treat as visible-but-unverified.
     * - `"hidden"` — `visible: false` (markRouteOffscreen ran for this route,
     *   or the host explicitly marked it hidden). Filtered out when callers
     *   pass `visibleOnly=true`.
     *
     * Callers that need stricter guarantees should additionally check
     * `state.layout !== null`.
     */
    visibility?: 'visible' | 'likely-visible' | 'hidden';
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
  /** Current navigation route path (if a RouteProvider is configured) */
  currentRoute?: string | null;
  /** Current route segments (if a RouteProvider is configured) */
  segments?: string[];
  /** Modal/sheet/drawer context (populated when a modalDetector enricher is registered) */
  modalStack?: NativeSnapshotModalContext;
  /** Toast/snackbar context (populated when a toastCapture enricher is registered) */
  toasts?: NativeSnapshotToastContext;
  /** Undo/redo context (populated when an undoTracker enricher is registered) */
  undoRedo?: NativeSnapshotUndoContext;
  /**
   * Registration coverage metadata so agents can detect routes that have
   * interactive controls but did not register them with the bridge.
   */
  registration?: NativeRegistrationCoverage;
  /**
   * Application info — appId, appName, appType, framework.
   *
   * Populated when the host wired `config.appInfo` on the server (e.g. via
   * `UIBridgeNativeProvider`'s `config.appInfo` prop). Mirrors the `uiBridge`
   * block returned by the `health` endpoint so agents can identify the app
   * from a snapshot alone — useful for the cloud relay path where the
   * bridge URL is opaque.
   *
   * Empty (undefined) when the host did not configure appInfo.
   */
  appInfo?: NativeAppInfo;
}

// ============================================================================
// Snapshot Enrichers (modal / toast / undo)
// ============================================================================

/** A single detected modal-like surface (modal, sheet, drawer, popover, alert) */
export interface NativeModalInfo {
  id: string;
  title?: string;
  type: 'modal' | 'sheet' | 'drawer' | 'popover' | 'alertdialog' | 'dialog';
  /** Whether the modal blocks interaction with the underlying UI */
  blocking: boolean;
  /** Whether it can be dismissed by the user (backdrop tap, swipe, esc, etc.) */
  dismissible: boolean;
  detectedAt: number;
}

/**
 * Modal context attached to a snapshot. Field names match the web SDK's
 * `SnapshotModalContext` so external agents can write transport-agnostic checks
 * like `snapshot.modalStack?.hasBlockingModal`.
 */
export interface NativeSnapshotModalContext {
  modals: NativeModalInfo[];
  topModal?: NativeModalInfo;
  hasBlockingModal: boolean;
  count: number;
}

/** A captured toast/snackbar */
export interface NativeCapturedToast {
  id: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error' | 'loading' | 'unknown';
  appearedAt: number;
  dismissedAt?: number;
  visible: boolean;
  /** Total duration in ms (lifetime so far if still visible, total if dismissed) */
  durationMs: number;
}

/** Toast context attached to a snapshot */
export interface NativeSnapshotToastContext {
  /** Toasts currently on screen */
  active: NativeCapturedToast[];
  /** Recently-dismissed toasts retained by the capture buffer (most recent first) */
  recent: NativeCapturedToast[];
  /** Total number of toasts ever captured by this tracker */
  totalCaptured: number;
}

/**
 * Undo/redo context attached to a snapshot. Mirrors the web SDK's
 * `SnapshotUndoContext` minus DOM-only fields — RN has no `document.execCommand`
 * or selectors, so the native variant relies entirely on developer declaration.
 */
export interface NativeSnapshotUndoContext {
  /** Whether undo appears to be available */
  canUndo: boolean;
  /** Whether redo appears to be available */
  canRedo: boolean;
  /** Description of what undo would reverse */
  undoDescription?: string;
  /** Description of what redo would restore */
  redoDescription?: string;
  /** Undo stack depth (if known) */
  undoDepth?: number;
  /** Redo stack depth (if known) */
  redoDepth?: number;
  /** Human-readable summary for AI */
  summary: string;
}

/**
 * Modal-stack tracker contract. Surfaced in NativeSnapshotEnrichers so the
 * test-hook HTTP endpoints (`control/modal/push`, `control/modal/dismiss/:id`)
 * can drive the same instance the snapshot reads from. Any duck-typed
 * implementation that satisfies this shape can fill the slot — production
 * uses the `ModalDetector` class.
 */
export interface NativeModalDetectorLike {
  getSnapshotModalContext(): NativeSnapshotModalContext;
  pushModal(modal: {
    id: string;
    title?: string;
    type?: NativeModalInfo['type'];
    blocking?: boolean;
    dismissible?: boolean;
  }): void;
  dismissModal(id: string): boolean | void;
  getActive(): NativeModalInfo[];
}

/**
 * Canonical enricher slot. Each tracker exposes a `getSnapshot*Context()` method
 * that the registry calls during `createSnapshot`. NavigationTracker is intentionally
 * NOT here — route info already flows through `currentRoute` / `segments`.
 */
export interface NativeSnapshotEnrichers {
  modalDetector?: NativeModalDetectorLike;
  toastCapture?: { getSnapshotToastContext(): NativeSnapshotToastContext };
  undoTracker?: { getSnapshotUndoContext(): NativeSnapshotUndoContext };
}

/**
 * Pluggable snapshot enricher: receives base context and returns extra fields
 * that get `Object.assign`ed onto the snapshot. Used for ad-hoc/custom trackers
 * (e.g. runner sidebar tabs) without growing the canonical enricher set.
 */
export type NativeSnapshotEnricher = (ctx: {
  elements: RegisteredNativeElement[];
  currentRoute: string | null;
}) => Record<string, unknown>;

/**
 * Minimal route-provider shape consumed by `NativeUIBridgeRegistry.createSnapshot`.
 *
 * Intentionally a structural subset of `RouteProvider` (defined in `server/types`)
 * so `core/registry` stays free of server-layer imports. The full `RouteProvider`
 * (which adds `subscribe`) widens this interface; both can be passed to
 * `registry.setRouteProvider(...)` interchangeably.
 *
 * The registry uses this fallback when `createSnapshot` is called WITHOUT an
 * explicit `routeInfo` argument — the canonical case is the default
 * `getSnapshot` HTTP handler, which has no direct reference to the
 * `NativeUIBridgeServer` instance and therefore couldn't read the route
 * before this hook existed.
 */
export interface NativeRouteProviderLike {
  getCurrentRoute: () => string | null;
  getSegments?: () => string[];
}

/**
 * UI Bridge Native feature flags
 */
export interface NativeUIBridgeFeatures {
  /** Enable HTTP control server */
  server?: boolean;
  /** Enable debug tools (inspector overlay) */
  debug?: boolean;
  /**
   * Enable test-only HTTP endpoints that let external runners drive
   * registry-internal state (currently `control/modal/push` and
   * `control/modal/dismiss/:id`). Default `false` so production builds
   * cannot have their modal stack manipulated remotely; set to `true`
   * (typically gated on `__DEV__`) when running automated tests.
   */
  testHooks?: boolean;
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
  /** Application info for discovery */
  appInfo?: {
    appId: string;
    appName: string;
    appType: 'web' | 'desktop' | 'mobile' | 'other';
    framework?: string;
  };
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
