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

// COLLAPSED 2026-08-22 (plan 2026-08-20-ui-bridge-action-declaration-shape,
// Phase 3). These four were byte-identical redeclarations of the canonical
// `src/core/types.ts` shapes, carrying the standing comment "Types that would
// be re-exported from ui-bridge/core in a full implementation" — so this
// finishes that. They are `export type` re-exports, which TypeScript elides
// entirely: no runtime edge is created from this React-Native tree to the web
// core, and nothing DOM-shaped is pulled in (the shapes reference only
// `AbortSignal`, which React Native provides).
//
// `WaitOptions` above stays a local declaration deliberately — see its own
// comment.
//
// `IREffect` joins them in Phase 4: the safety annotation must mean the same
// thing on both channels, and `ComponentAction.effect` (re-exported above)
// already refers to the web core's declaration — re-declaring the union here
// would create a second, drift-prone copy of the same three literals.
export type {
  ActionHandler,
  ActionHandlerOptions,
  CustomAction,
  ComponentAction,
  IREffect,
} from '../../core/types';

// Local bindings for the `NativeComponentAction` / `NativeCustomAction`
// aliases below (a re-export does not put the name in this module's scope).
import type { ComponentAction, CustomAction } from '../../core/types';

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
 * Live bounding box (screen-absolute, RN pixels) for a registered native
 * element. Parity shape with the web SDK's `ElementBbox` so the runner's
 * bbox-first click resolver can treat SDK-registered native elements the
 * same way it treats SDK-registered web elements — no VLM grounding.
 *
 * Maintained by `useUIElement`'s `onLayout` handler: the `x`/`y` here are
 * the screen-absolute coordinates (from `measureInWindow`'s `pageX`/`pageY`
 * when available, else falling back to the layout-relative `x`/`y`). That
 * matches the runner's expectation that `bbox` is directly dispatchable
 * without a coordinate-space conversion.
 *
 * Declared here (rather than imported from the web `core/types.ts`) to keep
 * the native subtree free of web-only type deps and avoid a cross-cut that
 * would be pulled into bundles that don't need the DOM registry. The shape
 * is identical by contract — runners serialize both as the same wire field.
 */
export interface ElementBbox {
  /** Left edge in pixels */
  x: number;
  /** Top edge in pixels */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
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
 * Custom action definition for native elements.
 *
 * COLLAPSED 2026-08-23 (plan `2026-08-20-ui-bridge-action-declaration-shape`),
 * for the same reason `NativeComponentAction` was collapsed below: it was a
 * copy of {@link CustomAction} with no divergence — identical field list,
 * identical semantics, only the handler type inlined instead of named.
 *
 * Keeping the copy had already cost something. `CustomAction` was exported
 * from this tree and referenced by nothing, while `RegisteredNativeElement`
 * used this type — so Phase 4's `effect` landed on the unused one, and the
 * options bag Phase 3 added to `ActionHandler` never reached a native custom
 * action's handler at all. Aliasing means both channels get the signal, and
 * there is one shape to change next time.
 *
 * A one-argument handler stays assignable, so no existing registration breaks.
 */
export type NativeCustomAction<TParams = unknown, TResult = unknown> = CustomAction<
  TParams,
  TResult
>;

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

  /**
   * Live screen-absolute bounding box in pixels, parity field with the web
   * SDK's `RegisteredElement.bbox`. Maintained by `useUIElement`'s
   * `onLayout` handler. Undefined until the first layout event fires (or
   * after unmount). Exposed in the native snapshot so runners targeting
   * React Native apps can skip VLM grounding for SDK-registered elements.
   */
  bbox?: ElementBbox;
  /**
   * Live visibility signal (`bbox.width > 0 && bbox.height > 0`), parity
   * field with the web SDK. Undefined when `bbox` is undefined.
   * `NativeLayout` doesn't carry richer visibility data so this is the
   * cheap correct approximation — a "rendered with nonzero size" hint
   * only, not a hit-test / occlusion check.
   */
  visible?: boolean;
}

/**
 * Component action definition for native components.
 *
 * COLLAPSED 2026-08-22 (plan `2026-08-20-ui-bridge-action-declaration-shape`,
 * Phase 3): this was a *fourth* copy of `ComponentAction`, duplicated inside
 * this same file next to the re-export above, and it carried no divergence —
 * identical field list, identical semantics, only the handler type inlined
 * instead of named. It is now an alias, so a component action means one thing
 * on both channels and the signal reaches this tree too.
 */
export type NativeComponentAction<TParams = unknown, TResult = unknown> = ComponentAction<
  TParams,
  TResult
>;

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
    /**
     * Live screen-absolute bounding box maintained by `useUIElement`'s
     * `onLayout`. Parity with the web snapshot's `elements[].bbox`.
     * Undefined if the hook hasn't observed a layout event yet.
     */
    bbox?: ElementBbox;
    /** Live visibility (`bbox.width > 0 && bbox.height > 0`). Paired with `bbox`. */
    visible?: boolean;
    /**
     * ARIA role passthrough from React Native's `accessibilityRole` prop
     * (e.g. `"button"`, `"link"`, `"header"`, `"image"`, `"none"`). Parity
     * with the web snapshot's `elements[].role`. Source of truth for
     * `IrElementCriteria.role` on native targets.
     */
    role?: string;
    /**
     * Lowercased component display name where determinable (e.g. `"text"`,
     * `"pressable"`, `"view"`). Native parity for the web snapshot's
     * `tagName`. Undefined for custom components without a `displayName`.
     */
    tagName?: string;
    /**
     * Passthrough of React Native's `accessibilityLabel` prop. Parity with
     * the web snapshot's `ariaLabel`. Source of truth for
     * `IrElementCriteria.aria_label` on native targets.
     */
    ariaLabel?: string;
    /**
     * Accessible name for the element. On native this is the same value
     * as `accessibilityLabel` (no separate algorithm) — kept as a distinct
     * field for wire-format parity with the web snapshot.
     */
    accessibleName?: string;
    /**
     * Visible text content. Source of truth for `IrElementCriteria.text`.
     * On native this comes from the registered element's `textContent`
     * state (set by `<Text>` children) or the `accessibilityLabel` fallback,
     * whitespace-collapsed and trimmed.
     */
    text?: string;
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
  /**
   * How many elements the registry captured — `elements.length`, restated so a
   * consumer can compare it against {@link totalInteractiveInDOM} without
   * walking the array.
   *
   * Undeclared until the `src/native/**` type gate (`tsconfig.native.json`)
   * was added, though `createSnapshot` has emitted it all along. Same class of
   * defect as the `paramSchema` / `path` wire fields plan
   * `2026-08-20-ui-bridge-action-declaration-shape` Phase 1 had to declare:
   * data that reaches consumers while the type denies it exists. Declared, not
   * deleted — the emitter and its readers are the evidence of intent.
   */
  registeredCount: number;
  /**
   * How many interactive elements exist in the DOM, for the web-hosted
   * (react-native-web) case. A large gap against {@link registeredCount} — 30
   * registered out of 120 present — is the signal that auto-registration
   * missed elements.
   *
   * `0` on a real React Native runtime, where there is no `document` to query;
   * `createSnapshot` swallows the failure. So a `0` here means "not
   * measurable", not "nothing interactive on screen".
   */
  totalInteractiveInDOM: number;
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
