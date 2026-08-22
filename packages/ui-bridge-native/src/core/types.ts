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

// DUPLICATE OF `@qontinui/ui-bridge` `core/types.ts` — DELIBERATELY NOT A
// RE-EXPORT. Checked 2026-08-22 (plan
// 2026-08-20-ui-bridge-action-declaration-shape, Phase 3): `@qontinui/ui-bridge`
// is an OPTIONAL peerDependency of this package (`peerDependenciesMeta`) and
// appears in `dependencies` not at all, so a consumer may install
// `@qontinui/ui-bridge-native` alone. Re-exporting would resolve inside this
// monorepo (the workspace symlink) and then fail for exactly that consumer,
// whose emitted `.d.ts` would reference a module they never installed. The
// package treats the peer as runtime-optional everywhere else too — see the
// "Install @qontinui/ui-bridge for ..." fallbacks in
// `src/server/design-handlers.ts`.
//
// KEEP IN SYNC with `@qontinui/ui-bridge` `src/core/types.ts`
// `ActionHandler` / `ActionHandlerOptions` / `CustomAction` / `ComponentAction`.
// The sibling copy at `@qontinui/ui-bridge` `src/native/core/types.ts` HAS been
// collapsed to a re-export — same package, so it has no such constraint.

/**
 * Second argument handed to every {@link ActionHandler}: the option-bag shape
 * the SDK already uses to *accept* a caller's cancellation. See the canonical
 * declaration in `@qontinui/ui-bridge` for the full rationale, including where
 * the signal comes from at each seam.
 */
export interface ActionHandlerOptions {
  /**
   * Aborted when the caller cancels or the request's `timeoutMs` elapses.
   * Observing it is optional — the executor races the handler promise against
   * the abort, so a handler that ignores the signal is still abandoned.
   */
  signal?: AbortSignal;
}

export type ActionHandler<TParams = unknown, TResult = unknown> = (
  params?: TParams,
  options?: ActionHandlerOptions
) => TResult | Promise<TResult>;

/**
 * Whether an action is read-only, mutating, or destructive.
 *
 * - `"read"`        — query/navigate/reveal; no persistent state change.
 * - `"write"`       — modifies persistent state but is reversible.
 * - `"destructive"` — irreversible (delete, send, charge, deploy). **Excluded
 *   from automatic walks** — that exclusion is the annotation's only job.
 *
 * DUPLICATE, for the same reason the four types above are duplicated: this
 * package must not import from `@qontinui/ui-bridge` (an optional peer). The
 * canonical publication is
 * `qontinui-schemas/ts/src/ui-bridge-ir/primitives.ts` (`IREffect`); the web
 * SDK mirrors it at `@qontinui/ui-bridge` `src/core/types.ts`. KEEP IN SYNC
 * with both.
 */
export type IREffect = 'read' | 'write' | 'destructive';

export interface CustomAction<TParams = unknown, TResult = unknown> {
  id: string;
  label?: string;
  description?: string;
  /** Safety annotation. See {@link ComponentAction.effect}. */
  effect?: IREffect;
  handler: ActionHandler<TParams, TResult>;
}

export interface ComponentAction<TParams = unknown, TResult = unknown> {
  id: string;
  label?: string;
  description?: string;
  paramSchema?: Record<string, unknown>;
  /**
   * Safety annotation — the per-registration override (Phase 4 of plan
   * `2026-08-20-ui-bridge-action-declaration-shape`).
   *
   * **Precedence: this wins.** `resolveActionEffect()`
   * (`core/action-effect.ts`) reads `action.effect ??
   * NATIVE_STANDARD_ACTION_EFFECTS[action.id]`, so an explicit value beats the
   * static verb map, which only applies when `id` is a standard native verb at
   * all. No verb ever defaults to `'destructive'` — destructiveness depends on
   * what a control does, not on what it is called, so declaring it here is the
   * only way it can be true.
   */
  effect?: IREffect;
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
 * Component action definition for native components.
 *
 * COLLAPSED 2026-08-22 (plan `2026-08-20-ui-bridge-action-declaration-shape`,
 * Phase 3): this was a *fourth* copy of `ComponentAction`, duplicated inside
 * this same file, with no divergence from it — identical field list, identical
 * semantics, only the handler type inlined instead of named. Unlike the
 * cross-package case above, this collapse is purely intra-file and so carries
 * no dependency constraint at all.
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
 * Per-element pixel-space bounding box projected into a snapshot.
 *
 * SHAPE IS DELIBERATELY `{x, y, w, h}` (not the web SDK's
 * `{x, y, width, height}`). The runner's vision pipeline
 * (`POST /ui-bridge/vision/{analyze,assert}`) deserializes a snapshot's
 * `elements[].bbox` straight into the Rust `qontinui_vision_core::Region`
 * struct, which is `{x, y, w, h}: u32` with NO `width`/`height` serde alias.
 * Emitting `{width, height}` returns a 422 "missing field `w`". This was
 * verified empirically against a live runner (2026-06-03):
 *   - `{x,y,w,h}`           → HTTP 200 (analyzers run)
 *   - `{x,y,width,height}`  → 422 "missing field `w`"
 * So the mobile bridge emits the runner-native shape directly, letting a
 * visual-audit caller post the snapshot through with no transform. The web
 * SDK keeps its `{width,height}` shape because its consumers project before
 * posting; mobile skips that projection layer.
 *
 * Units are PHYSICAL pixels (RN `state.layout` is logical dp; we multiply by
 * `PixelRatio.get()`) so the box aligns with the runner's adb screencap frame.
 * Values are clamped to non-negative integers.
 */
export interface NativeElementBbox {
  /** Absolute left edge in physical pixels. */
  x: number;
  /** Absolute top edge in physical pixels. */
  y: number;
  /** Width in physical pixels. */
  w: number;
  /** Height in physical pixels. */
  h: number;
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
    /**
     * Pixel-space bounding box, runner-native `{x, y, w, h}` shape (see
     * {@link NativeElementBbox}). Projected from `state.layout` (logical dp)
     * × `PixelRatio.get()`.
     *
     * Emitted ONLY for elements that are both `visibility: 'visible'` AND have
     * a measured `state.layout` — i.e. we have a real, current-route rect to
     * trust. Omitted for `hidden` / `likely-visible` / unmeasured elements so
     * stale off-screen coords from other routes (the flat registry mixes
     * routes) can't overflow the runner's frame and poison region checks.
     */
    bbox?: NativeElementBbox;
    /**
     * True when the element accepts pointer/key input (has a press/click-type
     * action or is an interactive type). Drives the runner's elements analyzer
     * (interactive coverage) + layout analyzer (WCAG target size). Emitted for
     * ALL elements (not just visible ones) so coverage counts are accurate —
     * mirrors the web SDK's per-element `interactable` signal. Snake_case +
     * always present: deserializes straight into `qontinui_vision_core::Element`
     * (serde default `false`). See {@link projectVisionFields}.
     */
    interactable?: boolean;
    /**
     * Human-visible text (`state.value` / `state.textContent` / `label`).
     * Runner's elements analyzer (`no_text`) + color analyzer (contrast gate)
     * read this. Omitted when the element carries no text. Snake_case shape
     * matches the Rust `Element.text: Option<String>`.
     */
    text?: string;
    /**
     * ARIA-ish role mapped from `type` (button/textbox/switch/...). Matches the
     * web SDK's role vocabulary the runner's analyzer expects. Omitted for
     * generic containers (scroll/view/custom). Snake-compatible top-level
     * `role` → `Element.role: Option<String>`.
     */
    role?: string;
    /**
     * Foreground (text/icon) color as `{r,g,b}`, parsed from
     * `flatStyle.color`. Present only when the host wired styles via
     * `captureStyle`/`updateElementStyle` AND the value parsed. Feeds the
     * runner's color analyzer (WCAG contrast). RN has no `getComputedStyle`,
     * so this is the declared style color, not a resolved-up-the-tree value.
     */
    fg_color?: { r: number; g: number; b: number };
    /**
     * Background color as `{r,g,b}`, parsed from `flatStyle.backgroundColor`.
     * Same source/limits as {@link fg_color}. RN does NOT resolve the effective
     * opaque ancestor background — a transparent/absent backgroundColor is
     * omitted, and the color analyzer soft-skips (or samples pixels under the
     * bbox) when either color is missing.
     */
    bg_color?: { r: number; g: number; b: number };
    /**
     * Computed font size in px, from `flatStyle.fontSize` (RN number is already
     * dp/px). Feeds the runner's typography analyzer (size drift). Omitted when
     * no fontSize was declared on the element's style.
     */
    font_size_px?: number;
    /**
     * Font family from `flatStyle.fontFamily`. Feeds the typography analyzer
     * (family drift). Omitted when no fontFamily was declared.
     */
    font_family?: string;
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
  /**
   * Enable the read-only observability capture (console.error/warn +
   * fetch/XHR ring buffers backing `GET /control/console-errors` and
   * `GET /sdk/network-requests`).
   *
   * Defaults to the `testHooks` value so existing consumers are unchanged,
   * but can be set independently: `observability: true` with
   * `testHooks: false` enables release-build capture WITHOUT exposing the
   * testHooks-gated control surface (`control/modal/*` etc.). Setting it to
   * `false` explicitly disables capture even when `testHooks` is on.
   */
  observability?: boolean;
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
