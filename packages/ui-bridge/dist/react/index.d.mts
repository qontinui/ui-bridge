import * as react_jsx_runtime from 'react/jsx-runtime';
import React$1, { ReactNode, ReactElement } from 'react';
import { dI as UIBridgeFeatures, t as UIBridgeConfig, ar as UIBridgeRegistry, b9 as ActionExecutor, eo as WorkflowEngine, a as WSConnectionState, as as RegisteredElement, d8 as RegisteredComponent, c as BridgeSnapshot, B as BridgeEventType, bi as BridgeEventListener, c3 as ElementEventLog, b as WSSubscriptionOptions, e as BridgeEvent, aq as OnBrowserEventCallback, ap as BrowserCaptureConfig, ca as ElementType, dv as StandardAction, bL as CustomAction, at as ElementState, c8 as ElementLogLevel, aT as RelationshipType, c7 as ElementIdentifier, r as ElementHistoryOptions, s as ElementLogEntry, en as Workflow, u as ControlActionRequest, C as ControlActionResponse, v as ComponentActionRequest, g as ComponentActionResponse, w as FindRequest, x as FindResponse, y as WorkflowRunRequest, z as WorkflowRunResponse, p as UIStateGroup, U as UIState, S as StateSnapshot, eq as WorkflowStep, T as TransitionResult, q as UITransition, N as NavigationResult, P as PathResult, bD as ContentRole, aF as DeveloperPageContext, aE as RouteInfo, aI as KeyboardShortcut, dP as UseUIRelationshipOptions, cz as InlineRelationship, dN as UseDragSourceOptions, dO as UseDropZoneOptions, ax as DeclaredUndoState } from '../types-DHAgZgSv.mjs';
import { U as UIBridgeWSClient } from '../websocket-client-DXyn4Zfr.mjs';
import { RenderLogManager } from '../render-log/index.mjs';
import { M as MetricsCollector } from '../metrics-kVxhD117.mjs';
import { N as NavigationTracker, S as ShortcutTracker, M as ModalDetector, T as ToastCapture, R as RelationshipTracker, D as DragDropDetector, U as UndoTracker } from '../drag-drop-detector-cnGBHZLF.mjs';
import { E as ElementAnnotation } from '../types-C7D5seeQ.mjs';

/**
 * UI Bridge context value
 */
interface UIBridgeContextValue {
    /** Feature flags */
    features: UIBridgeFeatures;
    /** Configuration */
    config: UIBridgeConfig;
    /** Element registry */
    registry: UIBridgeRegistry;
    /** Action executor */
    executor: ActionExecutor;
    /** Workflow engine */
    workflowEngine: WorkflowEngine;
    /** Render log manager (if enabled) */
    renderLog?: RenderLogManager;
    /** Metrics collector (if debug enabled) */
    metrics?: MetricsCollector;
    /** WebSocket client (if websocket enabled) */
    wsClient?: UIBridgeWSClient;
    /** WebSocket connection state */
    wsConnectionState: WSConnectionState;
    /** Get all registered elements */
    getElements: () => RegisteredElement[];
    /** Get all registered components */
    getComponents: () => RegisteredComponent[];
    /** Create a snapshot */
    createSnapshot: (options?: {
        componentBasePath?: string;
        getActiveTab?: () => string | null | undefined;
    }) => BridgeSnapshot;
    /** Create a snapshot asynchronously (non-blocking) */
    createSnapshotAsync: (batchSize?: number, options?: {
        componentBasePath?: string;
        getActiveTab?: () => string | null | undefined;
    }) => Promise<BridgeSnapshot>;
    /** Subscribe to events */
    on: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => () => void;
    /** Unsubscribe from events */
    off: <T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>) => void;
    /** Navigation tracker for page/route awareness */
    navigationTracker: NavigationTracker;
    /** Shortcut tracker for keyboard shortcut discovery */
    shortcutTracker: ShortcutTracker;
    /** Modal detector for modal/dialog stack detection */
    modalDetector: ModalDetector;
    /** Toast capture for notification detection */
    toastCapture: ToastCapture;
    /** Relationship tracker for element relationship management */
    relationshipTracker: RelationshipTracker;
    /** Drag-drop detector for drag source and drop zone discovery */
    dragDropDetector: DragDropDetector;
    /** Undo/redo tracker for undo awareness */
    undoTracker: UndoTracker;
    /** Element event log for per-element observability (if enabled) */
    elementEventLog?: ElementEventLog;
    /** Whether the provider is initialized */
    initialized: boolean;
    /** Connect to WebSocket server */
    wsConnect: () => Promise<void>;
    /** Disconnect from WebSocket server */
    wsDisconnect: () => void;
    /** Subscribe to WebSocket events */
    wsSubscribe: (options: WSSubscriptionOptions) => Promise<BridgeEventType[]>;
    /** Add WebSocket event listener */
    onWsEvent: (eventType: BridgeEventType | '*', listener: (event: BridgeEvent) => void) => () => void;
}
/**
 * UI Bridge provider props
 */
interface UIBridgeProviderProps {
    /** Child components */
    children: React$1.ReactNode;
    /** Feature flags */
    features?: UIBridgeFeatures;
    /** Configuration */
    config?: UIBridgeConfig;
    /** Event handler */
    onEvent?: BridgeEventListener;
    /** Callback fired for each captured browser event */
    onBrowserEvent?: OnBrowserEventCallback;
    /** Configuration for browser event capture sub-modules */
    browserCaptureConfig?: BrowserCaptureConfig;
}
/**
 * UI Bridge Provider
 *
 * Provides UI Bridge context to child components.
 */
declare function UIBridgeProvider({ children, features, config, onEvent, onBrowserEvent, browserCaptureConfig, }: UIBridgeProviderProps): react_jsx_runtime.JSX.Element;
/**
 * useUIBridgeContext hook
 *
 * Access the UI Bridge context. Throws if used outside provider.
 */
declare function useUIBridgeContext(): UIBridgeContextValue;
/**
 * useUIBridgeOptional hook
 *
 * Access the UI Bridge context, returning null if outside provider.
 */
declare function useUIBridgeOptional(): UIBridgeContextValue | null;

/**
 * useUIElement Hook
 *
 * Register a DOM element with UI Bridge for control and observation.
 */

/**
 * useUIElement options
 */
interface UseUIElementOptions {
    /** Unique identifier for the element */
    id: string;
    /** Element type (auto-detected if not provided) */
    type?: ElementType;
    /** Human-readable label */
    label?: string;
    /** Override available actions */
    actions?: StandardAction[];
    /** Custom actions */
    customActions?: Record<string, CustomAction>;
    /** Whether to automatically register on mount */
    autoRegister?: boolean;
    /** Callback when state changes */
    onStateChange?: (state: ElementState) => void;
    /** Log level override for element-scoped event logging */
    logLevel?: ElementLogLevel;
    /** Declare relationships from this element to other elements */
    relationships?: Array<{
        targetId: string;
        type: RelationshipType;
        bidirectional?: boolean;
        metadata?: Record<string, unknown>;
    }>;
    /**
     * Semantic role / intent. Common values: `"primary"`, `"secondary"`,
     * `"destructive"`, `"ghost"`, `"link"`, `"success"`, `"warning"`.
     */
    variant?: string;
    /**
     * Positional hint. Common values: `"top"`, `"bottom"`, `"left"`, `"right"`,
     * `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`, `"center"`.
     */
    position?: string;
    /**
     * Dominant color as seen by the user — CSS color name (`"red"`), hex
     * (`"#ef4444"`), or design-token alias (`"accent"`, `"danger"`).
     */
    color?: string;
    /**
     * Hierarchical semantic path for ranking across duplicate labels, e.g.
     * `"settings-modal > theme-section > accent-color"`.
     */
    contextPath?: string;
    /**
     * If true, this element stays registered in the UI Bridge registry for the
     * entire lifetime of its mount, even if surrounding visibility changes
     * (opacity:0 during a collapse animation, ancestor scroll container,
     * max-height:0 on a hidden group) would normally cause the auto-scanner
     * to skip or drop it. `useUIElement` itself already binds registration to
     * mount lifecycle, but when this flag is set the hook also stamps
     * `data-ui-bridge-persist="true"` on the DOM node so the auto-scanner
     * treats neighbouring/duplicate passes the same way.
     *
     * Use for logically-persistent elements like sidebar navigation items
     * that live inside a collapsible group but should remain discoverable for
     * UI Bridge clients regardless of the group's expanded/collapsed state.
     *
     * Default: false.
     */
    persistWhileMounted?: boolean;
}
/**
 * useUIElement return value
 */
interface UseUIElementReturn {
    /** Ref to attach to the element */
    ref: React.RefCallback<HTMLElement>;
    /** Current element reference */
    element: HTMLElement | null;
    /** Whether the element is registered */
    registered: boolean;
    /** Get current state */
    getState: () => ElementState | null;
    /** Get element identifier */
    getIdentifier: () => ElementIdentifier | null;
    /** Trigger an action on this element */
    trigger: (action: StandardAction | string, params?: Record<string, unknown>) => Promise<void>;
    /** Manually register the element */
    register: () => void;
    /** Manually unregister the element */
    unregister: () => void;
    /** The registered element info */
    registeredElement: RegisteredElement | null;
    /** Get element event history */
    getHistory: (options?: ElementHistoryOptions) => ElementLogEntry[];
    /** Set log level for this element */
    setLogLevel: (level: ElementLogLevel) => void;
}
/**
 * useUIElement hook
 *
 * Registers a DOM element with UI Bridge for programmatic control.
 *
 * @example
 * ```tsx
 * function SubmitButton() {
 *   const { ref, trigger } = useUIElement({
 *     id: 'submit-btn',
 *     type: 'button',
 *     label: 'Submit Form',
 *   });
 *
 *   return (
 *     <button ref={ref}>
 *       Submit
 *     </button>
 *   );
 * }
 * ```
 */
declare function useUIElement(options: UseUIElementOptions): UseUIElementReturn;
/**
 * useUIElementRef hook
 *
 * @deprecated data-ui-id is no longer used. Elements are identified through
 * the bridge registry. Use useUIElement() for full registration instead.
 * This hook is a no-op and will be removed in a future version.
 */
declare function useUIElementRef(_id: string): React.RefCallback<HTMLElement>;

/**
 * Live Bounding-Box Tracker
 *
 * Watches DOM elements for layout changes (resize, scroll, viewport resize)
 * and pushes fresh viewport-relative bounding boxes into the UI Bridge
 * registry. Used by `useUIElement` and `useAutoRegister` so runner steps can
 * target SDK-registered elements by DOM coordinates and skip VLM pixel
 * grounding.
 *
 * Key design points:
 *
 * - **One shared scroll/resize listener for the whole process.** Pages with
 *   hundreds of registered elements cannot afford per-element listeners on
 *   the `scroll` (capture) + `resize` events; we coalesce via rAF and fan
 *   out to every tracked element once per frame.
 * - **`ResizeObserver` per element**, because that's already coalesced by
 *   the browser and there's no cheaper way to notice a single element's box
 *   changing due to content reflow that doesn't touch `window` scroll.
 * - **Writes go through `UIBridgeRegistry.updateElementBbox`**, which does
 *   NOT emit events or bump `storeVersion`. Every scroll would otherwise
 *   wake `useSyncExternalStore` consumers and cascade into render loops
 *   (React error #185).
 * - **Lazy mode for auto-registered elements.** The `useAutoRegister`
 *   scanner may tag hundreds of elements on a single page (every row in a
 *   data table, every nav item in a sidebar). Eager tracking — one
 *   `ResizeObserver` per element forever — does not scale past a few
 *   hundred. In lazy mode we keep a single shared `IntersectionObserver`
 *   per group; only elements currently intersecting the viewport get an
 *   active `ResizeObserver`. Active observers stay bounded by visible
 *   element count regardless of total DOM size. Off-screen lazy elements
 *   retain their last-known bbox in the registry (so snapshot queries
 *   still see a value), and the runner's click resolution already checks
 *   `visible` before using it — so a stale off-screen bbox can't cause a
 *   wrong click, it just fails the visibility gate.
 */

/** Marker attribute the hook stamps on elements for fallback resolution. */
declare const UI_BRIDGE_ID_ATTR = "data-ui-bridge-id";
/** Options for {@link trackElementBbox}. */
interface TrackElementBboxOptions {
    /**
     * When true, defer ResizeObserver attachment until the element enters the
     * viewport. Only active elements pay the observer cost, so this scales to
     * thousands of registered elements (large tables, long lists, etc.).
     * Use for scanner-registered (`origin: 'auto'`) elements.
     *
     * Defaults to false. Hook-registered (`useUIElement`) elements stay eager
     * because they're usually few, always-interesting, and expected to report
     * a bbox immediately after mount.
     */
    lazy?: boolean;
}
/**
 * Start tracking `element` under `id` in the given registry. Returns an
 * untrack function.
 */
declare function trackElementBbox(registry: UIBridgeRegistry, id: string, element: HTMLElement, options?: TrackElementBboxOptions): () => void;
/**
 * Poll the DOM for an element tagged with `[data-ui-bridge-id="<id>"]` a few
 * times after mount. Resolves with the element, or `null` if not found
 * within the budget.
 *
 * Used by `useUIElement` as a fallback when the consumer doesn't (or can't)
 * attach the returned ref — e.g. portals, headless/context components that
 * compose multiple underlying elements, or SDKs that stamp the attribute
 * directly via `data-*` spreads.
 */
declare function pollForTaggedElement(id: string, attempts?: number, intervalMs?: number): Promise<HTMLElement | null>;

/**
 * useUIComponent Hook
 *
 * Register a component with UI Bridge for component-level actions.
 */

/**
 * Action definition for useUIComponent
 */
interface ComponentActionDef<TParams = unknown, TResult = unknown> {
    /** Action identifier */
    id: string;
    /** Human-readable label */
    label?: string;
    /** Description */
    description?: string;
    /**
     * Parameter schema — surfaced verbatim on `/control/component/:id` so
     * callers discover what shape `params` should take without reading source.
     * Keep it lightweight: a map of `{ paramName: "string" | "number" | ... }`
     * or a small JSON Schema subset. No runtime validation is performed.
     */
    paramSchema?: Record<string, unknown>;
    /** Handler function */
    handler: (params?: TParams) => TResult | Promise<TResult>;
}
/**
 * Computed property definition for useUIComponent
 */
interface ComputedPropertyDef<T = unknown> {
    /** Getter function for the computed value */
    getter: () => T;
    /** Description of what the computed property represents */
    description?: string;
}
/**
 * useUIComponent options
 */
interface UseUIComponentOptions {
    /** Unique identifier for the component */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description */
    description?: string;
    /** Actions available on this component */
    actions?: ComponentActionDef[];
    /** Child element IDs owned by this component */
    elementIds?: string[];
    /** Whether to automatically register on mount */
    autoRegister?: boolean;
    /** Function to get the current component state */
    state?: () => Record<string, unknown>;
    /** Computed properties exposed by the component */
    computed?: Record<string, ComputedPropertyDef | (() => unknown)>;
}
/**
 * useUIComponent return value
 */
interface UseUIComponentReturn {
    /** Whether the component is registered */
    registered: boolean;
    /** Execute an action on this component */
    executeAction: <TParams = unknown, TResult = unknown>(actionId: string, params?: TParams) => Promise<TResult>;
    /** Manually register the component */
    register: () => void;
    /** Manually unregister the component */
    unregister: () => void;
    /** Update actions dynamically */
    updateActions: (actions: ComponentActionDef[]) => void;
    /** Add an element ID to this component */
    addElement: (elementId: string) => void;
    /** Remove an element ID from this component */
    removeElement: (elementId: string) => void;
    /** The registered component info */
    registeredComponent: RegisteredComponent | null;
}
/**
 * useUIComponent hook
 *
 * Registers a component with UI Bridge for component-level control.
 * Components can expose high-level actions that may orchestrate multiple element interactions.
 *
 * @example
 * ```tsx
 * function LoginForm() {
 *   const [email, setEmail] = useState('');
 *   const [password, setPassword] = useState('');
 *
 *   useUIComponent({
 *     id: 'login-form',
 *     name: 'Login Form',
 *     actions: [
 *       {
 *         id: 'login',
 *         label: 'Submit Login',
 *         handler: async ({ email, password }) => {
 *           setEmail(email);
 *           setPassword(password);
 *           await submitLogin();
 *         },
 *       },
 *       {
 *         id: 'clear',
 *         label: 'Clear Form',
 *         handler: () => {
 *           setEmail('');
 *           setPassword('');
 *         },
 *       },
 *     ],
 *   });
 *
 *   return (
 *     <form>
 *       <input value={email} onChange={(e) => setEmail(e.target.value)} />
 *       <input value={password} onChange={(e) => setPassword(e.target.value)} />
 *       <button type="submit">Login</button>
 *     </form>
 *   );
 * }
 * ```
 */
declare function useUIComponent(options: UseUIComponentOptions): UseUIComponentReturn;
/**
 * useUIComponentAction hook
 *
 * Create a stable action handler that can be used with useUIComponent.
 * Useful for memoizing action handlers.
 */
declare function useUIComponentAction<TParams = unknown, TResult = unknown>(handler: (params?: TParams) => TResult | Promise<TResult>, deps: React.DependencyList): (params?: TParams) => TResult | Promise<TResult>;

interface UIBridgeComponentScopeProps {
    /** ID of the `useUIComponent` that owns elements in this subtree. */
    componentId: string;
    children: ReactNode;
}
declare function UIBridgeComponentScope({ componentId, children }: UIBridgeComponentScopeProps): react_jsx_runtime.JSX.Element;
/**
 * Read the enclosing component scope ID, or `null` if not inside one.
 * `useUIElement` calls this to populate `ownedByComponent` automatically.
 */
declare function useOwningComponent(): string | null;

/**
 * useUIBridge Hook
 *
 * Main hook for accessing UI Bridge functionality.
 */

/**
 * useUIBridge return value
 */
interface UseUIBridgeReturn {
    /** Whether UI Bridge is available */
    available: boolean;
    /** Whether initialized */
    initialized: boolean;
    /** Get all registered elements */
    elements: RegisteredElement[];
    /** Get all registered components */
    components: RegisteredComponent[];
    /** Get all workflows */
    workflows: Workflow[];
    /** Create a snapshot of the current state */
    createSnapshot: () => BridgeSnapshot;
    /** Create a snapshot asynchronously (non-blocking, yields between batches) */
    createSnapshotAsync: (batchSize?: number, options?: {
        componentBasePath?: string;
        getActiveTab?: () => string | null | undefined;
    }) => Promise<BridgeSnapshot>;
    /** Execute an action on an element */
    executeAction: (elementId: string, request: ControlActionRequest) => Promise<ControlActionResponse>;
    /** Execute an action on a component */
    executeComponentAction: (componentId: string, request: ComponentActionRequest) => Promise<ComponentActionResponse>;
    /** Find controllable elements */
    find: (options?: FindRequest) => Promise<FindResponse>;
    /**
     * Discover controllable elements
     * @deprecated Use find() instead
     */
    discover: (options?: FindRequest) => Promise<FindResponse>;
    /** Run a workflow */
    runWorkflow: (workflowId: string, request?: WorkflowRunRequest) => Promise<WorkflowRunResponse>;
    /** Get workflow run status */
    getWorkflowStatus: (runId: string) => Promise<WorkflowRunResponse | null>;
    /** Get element by ID */
    getElement: (id: string) => RegisteredElement | undefined;
    /** Get component by ID */
    getComponent: (id: string) => RegisteredComponent | undefined;
    /** Get element state by ID */
    getElementState: (id: string) => ElementState | undefined;
    /** Register a workflow */
    registerWorkflow: (workflow: Workflow) => void;
    /** Unregister a workflow */
    unregisterWorkflow: (id: string) => void;
    /** Capture a render log snapshot (if enabled) */
    captureRenderLog: () => Promise<void>;
    /** Get render log entries (if enabled) */
    getRenderLogEntries: () => Promise<unknown[]>;
    /** Clear render log (if enabled) */
    clearRenderLog: () => Promise<void>;
    /** Get metrics (if debug enabled) */
    getMetrics: () => unknown | undefined;
    /** Get action history (if debug enabled) */
    getActionHistory: () => unknown[] | undefined;
    /** Direct access to the element registry (for event subscriptions, advanced usage) */
    registry: UIBridgeRegistry | null;
}
/**
 * useUIBridge hook
 *
 * Main hook for accessing UI Bridge functionality.
 * Use this to interact with registered elements, components, and workflows.
 *
 * @example
 * ```tsx
 * function AutomationController() {
 *   const bridge = useUIBridge();
 *
 *   const handleSubmit = async () => {
 *     // Execute element action
 *     await bridge.executeAction('submit-btn', { action: 'click' });
 *
 *     // Or use component action
 *     await bridge.executeComponentAction('login-form', {
 *       action: 'login',
 *       params: { email: 'user@example.com', password: 'secret' },
 *     });
 *   };
 *
 *   return (
 *     <button onClick={handleSubmit}>
 *       Automate Login
 *     </button>
 *   );
 * }
 * ```
 */
declare function useUIBridge(): UseUIBridgeReturn;
/**
 * useUIBridgeRequired hook
 *
 * Same as useUIBridge but throws if UI Bridge is not available.
 */
declare function useUIBridgeRequired(): UseUIBridgeReturn;

/**
 * IR Type Re-declarations
 *
 * These are local TYPE-ONLY mirrors of the canonical IR shapes published at
 * `@qontinui/shared-types/ui-bridge-ir`
 * (qontinui-schemas/ts/src/ui-bridge-ir/). They are duplicated here so that
 * `@qontinui/ui-bridge` does not need to take a runtime dependency on
 * `@qontinui/shared-types` just to expose IR-emitting metadata fields on its
 * existing hooks.
 *
 * KEEP IN SYNC with `qontinui-schemas/ts/src/ui-bridge-ir/`. If you change
 * an IR field there, mirror it here. The prompt for Phase 4 of the UI
 * Bridge Redesign — Section 1 Foundations — explicitly authorizes this
 * arrangement: build plugins emit IR using the canonical types; the SDK
 * accepts structurally identical shapes.
 *
 * @see https://github.com/qontinui/qontinui-schemas (ui-bridge-ir module)
 */
/**
 * Origin of an IR node. Set by the build plugin when extracting JSX wrappers,
 * by hand when authoring a JSON IR file directly, or by a generation pipeline.
 */
interface IRProvenance {
    /** How this declaration was authored. */
    source: 'hand-authored' | 'build-plugin' | 'ai-generated' | 'migrated';
    /** Source file (relative to the build root). */
    file?: string;
    /** Line number in the source file (1-based). */
    line?: number;
    /** Column in the source file (1-based). */
    column?: number;
    /** Build-plugin version that produced this node, if applicable. */
    pluginVersion?: string;
}
/**
 * Human-authored semantic context for an IR node. Aligns with the existing
 * ElementAnnotation shape (../annotations/types.ts).
 */
interface IRMetadata {
    /** Short human-readable description of what this state/transition represents. */
    description?: string;
    /** What this state/transition is for, intent-wise. */
    purpose?: string;
    /** Tags for grouping, filtering, and search. */
    tags?: string[];
    /** IDs of related elements/states/transitions. */
    relatedElements?: string[];
    /** Free-form notes for nuance that doesn't fit description/purpose. */
    notes?: string;
}
/**
 * Whether a transition is read-only, mutating, or destructive.
 *
 * - "read"        — query/navigate; no persistent state change.
 * - "write"       — modifies persistent state but is reversible (or has an undo).
 * - "destructive" — irreversible state change (delete, send, charge, deploy).
 *
 * Drives counterfactual analysis (section 6) and gates auto-regression
 * generation (section 9) — destructive transitions are excluded from
 * automatic walks.
 */
type IREffect = 'read' | 'write' | 'destructive';
/**
 * Minimal criteria to identify a DOM element.
 *
 * Mirrors `ElementCriteria` from `ui-bridge-auto/src/types/match.ts:20`.
 */
interface IRElementCriteria {
    /** ARIA role or inferred role. */
    role?: string;
    /** Exact text content (trimmed). */
    text?: string;
    /** Substring match on text content (case-insensitive). */
    textContains?: string;
    /** ARIA label (case-insensitive substring match). */
    ariaLabel?: string;
    /** Element ID (exact string or pattern-source string). */
    id?: string;
    /** HTML attributes to check (exact string match). */
    attributes?: Record<string, string>;
}

/**
 * useUIState Hook
 *
 * Register and manage UI states with UI Bridge.
 */

/**
 * useUIState options
 *
 * The IR-emitting metadata fields (`metadata`, `provenance`, `requiredElements`)
 * are part of Phase 4 of the UI Bridge Redesign — Section 1 Foundations. They
 * are additive: existing callers that pass only the legacy fields keep
 * working unchanged. Build plugins that extract `<State>` JSX wrappers fill
 * in `provenance` automatically; hand-authored callers usually omit it.
 */
interface UseUIStateOptions {
    /** Unique identifier for the state */
    id: string;
    /** Human-readable name */
    name: string;
    /** Element IDs belonging to this state */
    elements?: string[];
    /** Function to detect if state is active */
    activeWhen?: () => boolean;
    /** If true, blocks other state activations (modal behavior) */
    blocking?: boolean;
    /** Specific state IDs this state blocks */
    blocks?: string[];
    /** State group membership */
    group?: string;
    /** Cost for pathfinding (default: 1.0) */
    pathCost?: number;
    /** Custom metadata.
     *
     * The IR-canonical {@link IRMetadata} shape (description / purpose / tags /
     * relatedElements / notes) is preferred and routes into the global
     * annotation store at registration time. Arbitrary `Record<string, unknown>`
     * is still accepted for backwards compatibility — when it does NOT match
     * the IRMetadata shape, no annotation is written.
     */
    metadata?: IRMetadata | Record<string, unknown>;
    /** IR-canonical predicate shape — element criteria that should resolve to
     *  the elements belonging to this state. Authoring-time superset of
     *  `elements`: the build plugin emits this; the runtime SDK still accepts
     *  the legacy `elements: string[]` for hand-authored callers. If both are
     *  provided, `requiredElements` wins. */
    requiredElements?: IRElementCriteria[];
    /** Where this declaration came from (set by build plugins). */
    provenance?: IRProvenance;
    /** Whether to automatically register on mount */
    autoRegister?: boolean;
    /** Initial active state */
    initialActive?: boolean;
}
/**
 * useUIState return value
 */
interface UseUIStateReturn {
    /** Whether the state is registered */
    registered: boolean;
    /** Whether the state is currently active */
    isActive: boolean;
    /** Activate this state */
    activate: () => boolean;
    /** Deactivate this state */
    deactivate: () => boolean;
    /** Toggle active state */
    toggle: () => boolean;
    /** Get all currently active states */
    activeStates: string[];
    /** Manually register the state */
    register: () => void;
    /** Manually unregister the state */
    unregister: () => void;
    /** The registered state info */
    state: UIState | undefined;
}
/**
 * useUIState hook
 *
 * Registers a UI state with UI Bridge for state management.
 *
 * @example
 * ```tsx
 * function LoginModal() {
 *   const { isActive, activate, deactivate } = useUIState({
 *     id: 'login-modal',
 *     name: 'Login Modal',
 *     blocking: true,
 *     elements: ['login-email', 'login-password', 'login-submit'],
 *   });
 *
 *   if (!isActive) return null;
 *
 *   return (
 *     <div className="modal">
 *       <button onClick={deactivate}>Close</button>
 *       ...
 *     </div>
 *   );
 * }
 * ```
 */
declare function useUIState(options: UseUIStateOptions): UseUIStateReturn;
/**
 * useUIStateGroup hook
 *
 * Register and manage a state group with UI Bridge.
 *
 * @example
 * ```tsx
 * function NavigationSection() {
 *   const { activate, deactivate } = useUIStateGroup({
 *     id: 'nav-group',
 *     name: 'Navigation',
 *     states: ['nav-home', 'nav-about', 'nav-contact'],
 *   });
 *
 *   // Activating the group activates all its states
 *   // Deactivating the group deactivates all its states
 * }
 * ```
 */
interface UseUIStateGroupOptions {
    /** Unique identifier for the group */
    id: string;
    /** Human-readable name */
    name: string;
    /** State IDs belonging to this group */
    states: string[];
    /** Whether to automatically register on mount */
    autoRegister?: boolean;
}
interface UseUIStateGroupReturn {
    /** Whether the group is registered */
    registered: boolean;
    /** Activate all states in this group */
    activate: () => string[];
    /** Deactivate all states in this group */
    deactivate: () => string[];
    /** Manually register the group */
    register: () => void;
    /** Manually unregister the group */
    unregister: () => void;
    /** The registered group info */
    group: UIStateGroup | undefined;
}
declare function useUIStateGroup(options: UseUIStateGroupOptions): UseUIStateGroupReturn;
/**
 * useActiveStates hook
 *
 * Subscribe to active states changes.
 */
declare function useActiveStates(): string[];
/**
 * useStateSnapshot hook
 *
 * Get a snapshot of all state management data.
 */
declare function useStateSnapshot(): StateSnapshot | null;

/**
 * useUITransition Hook
 *
 * Register and execute UI state transitions with UI Bridge.
 */

/**
 * useUITransition options
 *
 * The IR-emitting metadata fields (`effect`, `metadata`, `provenance`) are
 * part of Phase 4 of the UI Bridge Redesign — Section 1 Foundations. They
 * are additive: existing callers keep working unchanged. The values are
 * stored on the registered transition's `metadata` bag (under `__ir`) for
 * later consumption by the build plugin / counterfactual analysis pipeline
 * (sections 6 and 9).
 */
interface UseUITransitionOptions {
    /** Unique identifier for the transition */
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
    /** Side-effect annotation. Drives counterfactual analysis (section 6) and
     *  gates auto-regression generation (section 9) — destructive transitions
     *  are excluded from automatic walks. Stored on the registered transition's
     *  metadata bag; does NOT change runtime behavior in this section. */
    effect?: IREffect;
    /** IR-canonical semantic metadata routed through the global annotation store. */
    metadata?: IRMetadata;
    /** Where this declaration came from (set by build plugins). */
    provenance?: IRProvenance;
    /** Whether to automatically register on mount */
    autoRegister?: boolean;
}
/**
 * useUITransition return value
 */
interface UseUITransitionReturn {
    /** Whether the transition is registered */
    registered: boolean;
    /** Whether this transition can be executed from current state */
    canExecute: boolean;
    /** Execute the transition */
    execute: () => Promise<TransitionResult>;
    /** Manually register the transition */
    register: () => void;
    /** Manually unregister the transition */
    unregister: () => void;
    /** The registered transition info */
    transition: UITransition | undefined;
}
/**
 * useUITransition hook
 *
 * Registers a state transition with UI Bridge.
 *
 * @example
 * ```tsx
 * function OpenModalButton() {
 *   const { canExecute, execute } = useUITransition({
 *     id: 'open-login-modal',
 *     name: 'Open Login Modal',
 *     fromStates: ['dashboard'],
 *     activateStates: ['login-modal'],
 *     exitStates: [],
 *   });
 *
 *   return (
 *     <button onClick={execute} disabled={!canExecute}>
 *       Login
 *     </button>
 *   );
 * }
 * ```
 */
declare function useUITransition(options: UseUITransitionOptions): UseUITransitionReturn;
/**
 * useTransitions hook
 *
 * Get all registered transitions.
 */
declare function useTransitions(): UITransition[];
/**
 * useAvailableTransitions hook
 *
 * Get transitions that can be executed from current state.
 */
declare function useAvailableTransitions(): UITransition[];

/**
 * `<State>` JSX wrapper.
 *
 * Authoring-time sugar around {@link useUIState}. The build plugin extracts
 * `<State id="..." name="..." metadata={{...}}>` invocations into IR; at
 * runtime the wrapper compiles to a `useUIState` call so behavior is
 * delegated to the existing hook (no parallel registry, no behavior drift).
 *
 * Per Phase 4 / UI Bridge Redesign Section 1: this wrapper is purely
 * additive — `useUIState` continues to work identically for callers that
 * skip the JSX layer.
 *
 * @example
 * ```tsx
 * function LoginPage() {
 *   return (
 *     <State
 *       id="login-form"
 *       name="Login Form"
 *       elements={['email-input', 'password-input', 'submit-btn']}
 *       metadata={{
 *         description: 'Form for authenticating existing users',
 *         tags: ['auth', 'form'],
 *       }}
 *     >
 *       <form>
 *         <input id="email-input" />
 *         <input id="password-input" type="password" />
 *         <button id="submit-btn">Log in</button>
 *       </form>
 *     </State>
 *   );
 * }
 * ```
 */

/**
 * Props for the {@link State} component. Extends every option of
 * {@link UseUIStateOptions} so the wrapper is a strict superset of the
 * underlying hook.
 */
interface StateProps extends UseUIStateOptions {
    /** Children rendered as-is — the wrapper has no DOM impact. */
    children?: ReactNode;
}
/**
 * Declarative wrapper for {@link useUIState}. Renders a `Fragment` so it has
 * no DOM impact; runtime behavior is delegated entirely to the underlying
 * hook.
 */
declare function State({ children, ...options }: StateProps): ReactElement;
declare namespace State {
    var displayName: string;
}

/**
 * `<TransitionTo>` JSX wrapper.
 *
 * Authoring-time sugar around {@link useUITransition}. The component name
 * reflects the destination — the `activateStates` set — so callers read as
 * "transition to <these states>" at the call site.
 *
 * Like `<State>`, this wrapper compiles to a hook call at runtime; build
 * plugins extract the JSX into IR. Renders a `Fragment` so it has no DOM
 * impact.
 *
 * @example
 * ```tsx
 * function LoginButton() {
 *   return (
 *     <TransitionTo
 *       id="open-login"
 *       name="Open Login"
 *       fromStates={['landing']}
 *       activateStates={['login-form']}
 *       exitStates={['landing']}
 *       effect="read"
 *       metadata={{ description: 'Navigate from landing to the login form' }}
 *     >
 *       <button>Log in</button>
 *     </TransitionTo>
 *   );
 * }
 * ```
 */

/**
 * Props for the {@link TransitionTo} component. Extends every option of
 * {@link UseUITransitionOptions} so the wrapper is a strict superset of the
 * underlying hook.
 */
interface TransitionToProps extends UseUITransitionOptions {
    /** Children rendered as-is — the wrapper has no DOM impact. */
    children?: ReactNode;
}
/**
 * Declarative wrapper for {@link useUITransition}. Renders a `Fragment` so
 * it has no DOM impact; runtime behavior is delegated entirely to the
 * underlying hook.
 */
declare function TransitionTo({ children, ...options }: TransitionToProps): ReactElement;
declare namespace TransitionTo {
    var displayName: string;
}

/**
 * useUINavigation Hook
 *
 * Navigate between UI states using pathfinding with UI Bridge.
 */

/**
 * useUINavigation return value
 */
interface UseUINavigationReturn {
    /** Whether UI Bridge is available */
    available: boolean;
    /** Whether navigation is currently in progress */
    isNavigating: boolean;
    /** Last navigation result */
    lastResult: NavigationResult | null;
    /** Find a path to target states (without executing) */
    findPath: (targetStates: string[]) => PathResult;
    /** Navigate to target states */
    navigateTo: (targetStates: string[]) => Promise<NavigationResult>;
    /** Current active states */
    activeStates: string[];
}
/**
 * useUINavigation hook
 *
 * Provides state machine navigation capabilities with pathfinding.
 *
 * @example
 * ```tsx
 * function NavigationController() {
 *   const { navigateTo, findPath, isNavigating, activeStates } = useUINavigation();
 *
 *   const goToDashboard = async () => {
 *     // Find path first to check if navigation is possible
 *     const path = findPath(['dashboard']);
 *     if (!path.found) {
 *       console.log('Cannot reach dashboard from current state');
 *       return;
 *     }
 *
 *     console.log(`Will execute ${path.transitions.length} transitions`);
 *
 *     // Execute navigation
 *     const result = await navigateTo(['dashboard']);
 *     if (result.success) {
 *       console.log('Successfully navigated to dashboard');
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <p>Current states: {activeStates.join(', ')}</p>
 *       <button onClick={goToDashboard} disabled={isNavigating}>
 *         Go to Dashboard
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
declare function useUINavigation(): UseUINavigationReturn;
/**
 * useCanNavigateTo hook
 *
 * Check if navigation to target states is possible.
 *
 * @example
 * ```tsx
 * function DashboardLink() {
 *   const canNavigate = useCanNavigateTo(['dashboard']);
 *
 *   return (
 *     <button disabled={!canNavigate}>
 *       Dashboard
 *     </button>
 *   );
 * }
 * ```
 */
declare function useCanNavigateTo(targetStates: string[]): boolean;
/**
 * useNavigationPath hook
 *
 * Get the path to target states (updates when active states change).
 *
 * @example
 * ```tsx
 * function PathDisplay() {
 *   const path = useNavigationPath(['checkout']);
 *
 *   if (!path.found) {
 *     return <p>Cannot reach checkout from here</p>;
 *   }
 *
 *   return (
 *     <p>
 *       Steps to checkout: {path.transitions.join(' -> ')}
 *       (Cost: {path.totalCost})
 *     </p>
 *   );
 * }
 * ```
 */
declare function useNavigationPath(targetStates: string[]): PathResult;

/**
 * Content Discovery
 *
 * Discovers static text content elements (headings, paragraphs, table cells, etc.)
 * and generates stable IDs and semantic metadata for AI consumption.
 *
 * Separate from the interactive element discovery in useAutoRegister.ts —
 * content elements have no interactive actions and use ContentType instead of ElementType.
 */

/**
 * Options for content discovery
 */
interface ContentDiscoveryOptions {
    /** Enable content discovery (default: true) */
    enabled?: boolean;
    /** Additional CSS selectors to include */
    includeContentSelectors?: string[];
    /** Additional CSS selectors to exclude */
    excludeContentSelectors?: string[];
    /** Minimum text length to register (default: 1) */
    minTextLength?: number;
    /** Maximum content elements to register (default: 500) */
    maxContentElements?: number;
    /** Debounce interval for content registration (default: 250ms) */
    contentDebounceMs?: number;
    /** Only register elements with these content roles */
    contentRoles?: ContentRole[];
}

/**
 * Media Discovery
 *
 * Discovers media elements (images, video, canvas, SVG, picture, CSS background images)
 * and generates stable IDs and metadata for AI consumption.
 *
 * Follows the same pattern as content-discovery.ts — media elements get their own
 * category ('media') and metadata type (MediaMetadata).
 */

/**
 * Options for media discovery
 */
interface MediaDiscoveryOptions {
    /** Enable media discovery (default: true) */
    enabled?: boolean;
    /** Include elements with CSS background images (default: false) */
    includeBackgroundImages?: boolean;
    /** Maximum media elements to register (default: 200) */
    maxMediaElements?: number;
    /** Debounce interval for media registration (default: 200ms) */
    mediaDebounceMs?: number;
}

/**
 * useAutoRegister Hook
 *
 * Enables automatic registration of interactive DOM elements with the UI Bridge.
 * This eliminates the need for manual useUIElement() calls on every component.
 *
 * Features:
 * - Auto-discovers interactive elements (buttons, inputs, links, etc.)
 * - Uses MutationObserver to detect new elements
 * - Generates stable, deterministic semantic IDs from element content/attributes
 * - Registers elements via the internal bridge registry (no DOM attributes set)
 * - Debounced updates for performance
 * - Respects existing manually registered elements
 */

/**
 * ID generation strategy
 */
type IdStrategy = 'data-testid' | 'semantic' | 'auto' | 'prefer-existing';
/**
 * Options for auto-registration
 */
interface AutoRegisterOptions {
    /** Enable auto-registration (default: true in dev mode) */
    enabled?: boolean;
    /** Root element to observe (default: document.body) */
    root?: HTMLElement | null;
    /** ID generation strategy (default: 'prefer-existing') */
    idStrategy?: IdStrategy;
    /** Debounce time for mutation handling (ms, default: 100) */
    debounceMs?: number;
    /** Include hidden elements (default: false) */
    includeHidden?: boolean;
    /** Only register elements matching these selectors */
    includeSelectors?: string[];
    /** Exclude elements matching these selectors */
    excludeSelectors?: string[];
    /** Custom ID generator function */
    generateId?: (element: HTMLElement) => string;
    /** Callback when element is registered */
    onRegister?: (id: string, element: HTMLElement) => void;
    /** Callback when element is unregistered */
    onUnregister?: (id: string) => void;
    /** Content discovery options (enabled by default) */
    contentDiscovery?: ContentDiscoveryOptions;
    /** Media discovery options (enabled by default) */
    mediaDiscovery?: MediaDiscoveryOptions;
    /** Log level for auto-registered elements (uses global default if not set) */
    logLevel?: ElementLogLevel;
    /** Write data-ui-bridge-id attribute on registered elements (default: true) */
    writeStableAttribute?: boolean;
    /**
     * If true, elements stay registered in the UI Bridge registry for the
     * entire lifetime of their mount, even when the visibility gate would
     * normally reject them (e.g. `opacity: 0`, `max-height: 0` during a
     * collapse animation, zero bounding box because an ancestor is animating
     * out). The element's layout metadata (bbox) may become stale in those
     * states, but clients can still discover it by id/label and drive it via
     * control actions. Individual elements can also opt in via the
     * `data-ui-bridge-persist="true"` attribute without flipping this global
     * flag.
     *
     * Use for logically-persistent elements like sidebar navigation items
     * that live inside a collapsible group or scroll container but shouldn't
     * disappear from the registry when their visibility flickers.
     *
     * Default: false (legacy behavior — skip registration while invisible).
     */
    persistWhileMounted?: boolean;
}
/**
 * Attribute callers can stamp on individual DOM elements to mark them
 * persistently-registerable, regardless of the global `persistWhileMounted`
 * option. Used by `useUIElement({ persistWhileMounted: true })` and available
 * directly on any host element authors want to keep in the registry across
 * visibility flickers.
 */
declare const UI_BRIDGE_PERSIST_ATTR = "data-ui-bridge-persist";
/** HTML attribute name for opt-in semantic content registration (Item 1). */
declare const UI_BRIDGE_CONTENT_ATTR = "data-ui-bridge-content";
/** HTML attribute name for the optional role hint on content elements (Item 1). */
declare const UI_BRIDGE_ROLE_ATTR = "data-ui-bridge-role";
/** HTML attribute name for the stable-id alias on auto-discovered elements (Item 10). */
declare const UI_BRIDGE_TEST_ID_ATTR = "data-ui-bridge-test-id";
/**
 * Hook for automatic element registration
 *
 * @example
 * ```tsx
 * function App() {
 *   // Enable auto-registration for all interactive elements
 *   useAutoRegister({ enabled: true });
 *
 *   return (
 *     <div>
 *       <button data-testid="submit-btn">Submit</button>
 *       <input data-testid="email-input" />
 *     </div>
 *   );
 * }
 * ```
 */
declare function useAutoRegister(options?: AutoRegisterOptions): void;

interface AutoRegisterProviderProps extends Omit<AutoRegisterOptions, 'root'> {
    /** Children to render */
    children: ReactNode;
    /** Use this element as the observation root instead of document.body */
    scopeToChildren?: boolean;
    /** Content discovery options (enabled by default) */
    contentDiscovery?: ContentDiscoveryOptions;
}
/**
 * Provider component that enables automatic element registration.
 *
 * Features:
 * - Automatically discovers and registers interactive elements
 * - Uses MutationObserver to detect new elements
 * - Smart ID generation based on data-testid, semantic names, etc.
 * - Configurable selectors and ID strategies
 *
 * Place this component at the root of your app (inside UIBridgeProvider)
 * for comprehensive automatic element registration.
 */
declare function AutoRegisterProvider({ children, scopeToChildren, enabled, idStrategy, debounceMs, includeHidden, includeSelectors, excludeSelectors, generateId, onRegister, onUnregister, contentDiscovery, persistWhileMounted, }: AutoRegisterProviderProps): react_jsx_runtime.JSX.Element;

/**
 * useUIAnnotation Hook
 *
 * Registers a semantic annotation for a UI element in the global annotation store.
 */

/**
 * Register a semantic annotation for a UI element.
 *
 * The annotation is set in the global annotation store and persists
 * across renders. It is NOT cleaned up on unmount because annotations
 * represent persistent developer knowledge about elements.
 *
 * @param elementId - The UI Bridge element ID to annotate
 * @param annotation - The annotation data
 *
 * @example Basic annotation for a button
 * ```tsx
 * function LoginButton() {
 *   useUIAnnotation('login-btn', {
 *     description: 'Primary login button',
 *     purpose: 'Submits the login form',
 *     tags: ['auth', 'primary-action'],
 *   });
 *
 *   return <button>Log In</button>;
 * }
 * ```
 *
 * @example Annotations enrich the semantic snapshot
 * ```tsx
 * // When an element has an annotation, the semantic snapshot includes it.
 * // Without annotation, the snapshot only has DOM-derived information.
 * // With annotation, the snapshot gains human-authored context.
 *
 * function SearchBar() {
 *   useUIAnnotation('search-input', {
 *     description: 'Global search input',
 *     purpose: 'Searches across all projects and workflows',
 *     notes: 'Debounces input by 300ms. Supports advanced query syntax.',
 *     tags: ['search', 'global'],
 *     relatedElements: ['search-results-panel', 'search-clear-btn'],
 *   });
 *
 *   return <input placeholder="Search..." />;
 * }
 *
 * // The annotation data is then available via:
 * //   GET /annotations/search-input
 * //   GET /annotations/export (in the full config)
 * //   store.get('search-input')
 * ```
 */
declare function useUIAnnotation(elementId: string, annotation: ElementAnnotation): void;

/**
 * usePageContext Hook
 *
 * Allows developers to annotate the current page with semantic context
 * (name, section, breadcrumb, etc.) that gets included in snapshots.
 *
 * Usage:
 *   function TaskDetailPage({ id }: { id: string }) {
 *     usePageContext({
 *       name: 'Task Detail',
 *       section: 'tasks',
 *       breadcrumb: ['Tasks', `Task ${id}`],
 *     });
 *     return <div>...</div>;
 *   }
 */

/**
 * Annotate the current page with semantic context for AI automation.
 *
 * The context is cleared when the component unmounts, so it stays
 * in sync with the active page component.
 */
declare function usePageContext(context: DeveloperPageContext): void;

/**
 * useRouteAwareness Hook
 *
 * Provides framework-router integration for the navigation tracker.
 * Accepts structured route information and keeps the tracker updated.
 *
 * Usage with React Router:
 *   import { useLocation, useParams, useMatches } from 'react-router-dom';
 *
 *   function App() {
 *     const location = useLocation();
 *     const params = useParams();
 *     const matches = useMatches();
 *
 *     useRouteAwareness({
 *       pattern: matches[matches.length - 1]?.pathname,
 *       params,
 *       queryParams: Object.fromEntries(new URLSearchParams(location.search)),
 *       routeStack: matches.map(m => m.pathname),
 *     });
 *
 *     return <Outlet />;
 *   }
 *
 * Usage with Next.js:
 *   import { usePathname, useParams, useSearchParams } from 'next/navigation';
 *
 *   function Layout({ children }) {
 *     const pathname = usePathname();
 *     const params = useParams();
 *     const searchParams = useSearchParams();
 *
 *     useRouteAwareness({
 *       params: params as Record<string, string>,
 *       queryParams: Object.fromEntries(searchParams),
 *     });
 *
 *     return <>{children}</>;
 *   }
 */

/**
 * Provide framework router information to the navigation tracker.
 *
 * The info is cleared when the component unmounts.
 */
declare function useRouteAwareness(info: RouteInfo): void;

/**
 * useKeyboardShortcuts Hook
 *
 * Allows developers to register keyboard shortcuts with the UI Bridge
 * so AI agents can discover and use them.
 *
 * Usage:
 *   useKeyboardShortcuts([
 *     { combo: 'Ctrl+S', description: 'Save workflow', scope: 'editor' },
 *     { combo: 'Ctrl+Shift+N', description: 'New workflow' },
 *   ]);
 */

/**
 * Shortcut definition for the hook (source is always 'developer').
 */
type ShortcutDef = Omit<KeyboardShortcut, 'source'>;
/**
 * Register keyboard shortcuts with the UI Bridge.
 * Shortcuts are automatically unregistered when the component unmounts.
 */
declare function useKeyboardShortcuts(shortcuts: ShortcutDef[]): void;

/**
 * useUIRelationship Hook
 *
 * Declares a semantic relationship between two UI elements.
 * The relationship is registered on mount and removed on unmount.
 *
 * @example
 * ```tsx
 * // Search input filters the results list
 * useUIRelationship('search-input', 'results-list', 'filters');
 *
 * // Tab activates a panel (bidirectional)
 * useUIRelationship('tab-settings', 'settings-panel', 'activates', {
 *   bidirectional: true,
 * });
 *
 * // With metadata
 * useUIRelationship('sort-dropdown', 'data-table', 'controls', {
 *   metadata: { field: 'sortOrder' },
 * });
 * ```
 */

/**
 * Declare a semantic relationship between two UI elements.
 *
 * The relationship is registered when the component mounts and
 * removed when it unmounts. If any parameter changes, the old
 * relationship is undeclared and the new one is declared.
 */
declare function useUIRelationship(sourceId: string, targetId: string, type: RelationshipType, options?: UseUIRelationshipOptions): void;
/**
 * useUIRelationships Hook
 *
 * Declares multiple relationships at once. Useful when an element has
 * many relationships.
 *
 * @example
 * ```tsx
 * useUIRelationships('save-button', [
 *   { target: 'name-input', type: 'submits' },
 *   { target: 'email-input', type: 'submits' },
 *   { target: 'form-status', type: 'populates' },
 * ]);
 * ```
 */
declare function useUIRelationships(sourceId: string, relationships: Array<InlineRelationship>): void;

/**
 * useDragSource / useDropZone Hooks
 *
 * Declare drag sources and drop zones for AI-driven drag-and-drop discovery.
 * Declarations are registered on mount and removed on unmount.
 *
 * @example
 * ```tsx
 * // Mark a sortable item as a drag source
 * useDragSource('step-3', { dataType: 'workflow-step' });
 *
 * // Mark a list as a drop zone that accepts workflow steps
 * useDropZone('step-list', {
 *   accepts: ['workflow-step'],
 *   effect: 'reorder',
 * });
 * ```
 */

/**
 * Declare an element as a drag source.
 *
 * The declaration is registered when the component mounts and
 * removed when it unmounts. If parameters change, the old
 * declaration is replaced.
 */
declare function useDragSource(elementId: string, options?: UseDragSourceOptions): void;
/**
 * Declare an element as a drop zone.
 *
 * The declaration is registered when the component mounts and
 * removed when it unmounts. If parameters change, the old
 * declaration is replaced.
 */
declare function useDropZone(elementId: string, options?: UseDropZoneOptions): void;

/**
 * useUndoRedo Hook
 *
 * Allows developers to declare their application's undo/redo state
 * to the UI Bridge. This provides authoritative undo stack information
 * that overrides heuristic DOM detection.
 *
 * Usage:
 * ```tsx
 * function MyEditor() {
 *   const { canUndo, canRedo, undo, redo, undoStack } = useMyUndoSystem();
 *
 *   useUndoRedo({
 *     canUndo,
 *     canRedo,
 *     undoDescription: undoStack[0]?.description,
 *     undoStack: undoStack.map(e => e.description),
 *     onUndo: undo,
 *     onRedo: redo,
 *   });
 *
 *   return <div>...</div>;
 * }
 * ```
 */

/**
 * Declare undo/redo state to the UI Bridge.
 *
 * The declared state is authoritative and overrides all heuristic detection.
 * When the component unmounts, the declaration is cleared.
 */
declare function useUndoRedo(options: DeclaredUndoState): void;

interface UseCommandRelayOptions {
    /** Whether the relay is enabled (default: true) */
    enabled?: boolean;
    /** Base path for UI Bridge API routes (default: '/api/ui-bridge') */
    basePath?: string;
    /** Heartbeat interval in ms (default: 10000) */
    heartbeatInterval?: number;
    /**
     * Explicit runner URL override for phone-home registration.
     * Default: 'http://127.0.0.1:9876'. When set, phone-home fires regardless
     * of hostname; otherwise it is gated to localhost-family hosts.
     */
    runnerUrl?: string;
    /** Opt out of the phone-home registration entirely. */
    disablePhoneHome?: boolean;
    /** Stable identity for this app in the runner's registry. Default: hostname. */
    appId?: string;
    /** Display name. Default: `document.title || location.hostname`. */
    appName?: string;
    /** App classification. Default: 'web'. */
    appType?: 'web' | 'desktop' | 'mobile' | 'dashboard' | 'other';
    /** Framework hint. Default: 'react'. */
    framework?: string;
    /** Capability tags. Default: ['control']. */
    capabilities?: string[];
    /**
     * Optional SDK / app version string surfaced on heartbeats so the server
     * can report what is actually connected (rather than relying on
     * build-time defaults baked into a static config).
     */
    version?: string;
}
/**
 * Hook that connects the browser to the server's command relay.
 *
 * 1. Connects to `{basePath}/commands/stream` via SSE
 * 2. Receives commands, executes via UIBridge registry + browser APIs
 * 3. POSTs results back to `{basePath}/commands`
 * 4. Sends heartbeat every 10s to `{basePath}/heartbeat`
 * 5. Handles reconnection on visibility change
 */
declare function useCommandRelay(options?: UseCommandRelayOptions): void;

interface CommandRelayListenerProps {
    /** Base path for UI Bridge API routes (default: '/api/ui-bridge') */
    basePath?: string;
    /** Whether the relay is enabled (default: true) */
    enabled?: boolean;
    /** Heartbeat interval in ms (default: 10000) */
    heartbeatInterval?: number;
    /**
     * Explicit runner URL override for phone-home registration.
     * Default: 'http://127.0.0.1:9876'. When set, phone-home fires regardless
     * of hostname; otherwise it is gated to localhost-family hosts.
     */
    runnerUrl?: string;
    /** Opt out of the phone-home registration entirely. */
    disablePhoneHome?: boolean;
    /** Stable identity for this app in the runner's registry. Default: hostname. */
    appId?: string;
    /** Display name. Default: `document.title || location.hostname`. */
    appName?: string;
    /** App classification. Default: 'web'. */
    appType?: 'web' | 'desktop' | 'mobile' | 'dashboard' | 'other';
    /** Framework hint. Default: 'react'. */
    framework?: string;
    /** Capability tags. Default: ['control']. */
    capabilities?: string[];
    /**
     * Optional SDK / app version string forwarded to the server on each
     * heartbeat. Lets `/supervisor-bridge/health` (and equivalent runner
     * endpoints) report what's actually connected instead of build-time
     * defaults baked into the static config.
     */
    version?: string;
}
declare function CommandRelayListener(props: CommandRelayListenerProps): null;

/**
 * useUIBridgeEcho Hook
 *
 * Register a hidden readOnly `<input>` whose value is the serialised form of
 * an arbitrary JSON-compatible state. The value is surfaced in every UI
 * Bridge `/control/snapshot` response, which lets external automation read
 * state that doesn't have a natural DOM surface (e.g. data received via
 * `window.postMessage` from an iframe, or internal React state that should
 * be observable by an automation driver).
 *
 * The snapshot does NOT expose `<body>` data-attributes, so mirroring state
 * there is invisible to automation. An echo input solves that: the input is
 * registered with UI Bridge via `useUIElement`, so its value appears on
 * `element.state.value` in the snapshot.
 *
 * Usage:
 * ```tsx
 * function CaptureHost() {
 *   const [bbox, setBbox] = useState<Bbox | null>(null);
 *   const echo = useUIBridgeEcho('capture-last-bbox', bbox);
 *   return (
 *     <>
 *       <iframe ... />
 *       {echo}
 *     </>
 *   );
 * }
 * ```
 *
 * The external driver reads the echoed value from the snapshot:
 * ```python
 * snap = client.get_control_snapshot()
 * for el in snap['elements']:
 *     if el['id'] == 'capture-last-bbox':
 *         bbox = json.loads(el['state']['value'])
 * ```
 */

/** Options for {@link useUIBridgeEcho}. */
interface UseUIBridgeEchoOptions<T> {
    /** Human-readable label exposed via UI Bridge. */
    label?: string;
    /**
     * Custom serializer for *value*.  Defaults to `JSON.stringify`, which
     * returns `"null"`/`"undefined"`/`""` for falsy values (see behaviour).
     */
    serialize?: (value: T) => string;
    /**
     * Behaviour for `null`/`undefined` values.
     *   - `"empty"` (default): echo an empty string.
     *   - `"serialize"`: pass through to *serialize* (which returns `"null"`).
     */
    onNullish?: 'empty' | 'serialize';
    /** Override the rendered input's style. */
    style?: React.CSSProperties;
}
/**
 * Register a hidden echo input and return a ReactElement the caller should
 * render into their tree.  The input's `value` is `serialize(value)`, kept
 * in sync with the prop via React's normal render cycle.
 *
 * @param id     UI Bridge element id (must be unique within the page).
 * @param value  JSON-compatible state to echo.
 * @param options Optional overrides (label, serializer, nullish behaviour).
 * @returns A `<input>` element the caller renders anywhere in their tree.
 */
declare function useUIBridgeEcho<T>(id: string, value: T, options?: UseUIBridgeEchoOptions<T>): ReactElement;

/** Default UI Bridge element IDs. Override for multiple hosts per page. */
declare const DEFAULT_CAPTURE_HOST_IDS: {
    readonly urlInput: "capture-next-url";
    readonly advance: "capture-advance";
    readonly echo: "capture-last-echo";
};
interface CaptureHostFrameProps {
    /** Starting URL for the iframe (before the first advance). */
    initialSrc?: string;
    /**
     * Message `kind` to listen for on postMessage events. Any event whose
     * `data.kind === messageKind` will have its full data echoed into
     * `{echoId}` input. Defaults to `'capture-host-echo'`.
     */
    messageKind?: string;
    /** Override the registered element IDs. */
    ids?: Partial<typeof DEFAULT_CAPTURE_HOST_IDS>;
    /** Optional title shown above the iframe. */
    title?: string;
    /** Optional header content rendered above the iframe (replaces title). */
    header?: ReactNode;
    /** Iframe style overrides. */
    iframeStyle?: React.CSSProperties;
    /** Iframe element title (a11y). */
    iframeTitle?: string;
    /** Optional callback fired whenever a matching postMessage arrives. */
    onEcho?: (payload: unknown) => void;
    /**
     * Optional hook for any incoming message (all `kind` values). Useful for
     * debugging — runs before `onEcho` filtering.
     */
    onMessage?: (data: unknown, ev: MessageEvent) => void;
}
/**
 * Outer capture-host React component. Renders a URL input, advance button,
 * inner iframe, and a hidden echo input. External automation drives the
 * input/button via UI Bridge and reads measurements from the echo input.
 */
declare function CaptureHostFrame(props: CaptureHostFrameProps): react_jsx_runtime.JSX.Element;

/**
 * useBuildIdWatcher Hook
 *
 * Detects when a server-side rebuild has shipped a new bundle while the
 * dashboard tab is still running the old code. Pairs with a server that:
 *
 *   1. Injects `<meta name="build-id" content="...">` into the served HTML
 *      so the initial value is observable from the document.
 *   2. Either:
 *      a. Emits `buildId` on a Server-Sent Events stream (default
 *         `/health/stream`), or
 *      b. Exposes a fetch-able snapshot the hook polls on an interval, or
 *      c. Provides a custom getter (e.g. a Tauri `invoke` for desktop apps
 *         where the binary's compiled-in build-id differs from the
 *         meta tag baked into the embedded HTML at the time the webview
 *         loaded it).
 *
 * On mount, the hook reads the meta-tag value as the "current" build-id and
 * starts whichever source is configured. When the source reports a build-id
 * that differs from the current value, `onBuildIdChange` is invoked once;
 * subsequent events do not re-fire it. The source is torn down on unmount.
 *
 * No-ops cleanly when:
 *   - The meta tag is missing (no initial build-id to compare against).
 *   - The chosen source is unavailable (e.g. `EventSource` undefined in SSR,
 *     `fetch` undefined in non-browser env).
 *
 * Usage (SSE — default; supervisor dashboard pattern):
 *   useBuildIdWatcher({ onBuildIdChange: () => setStale(true) });
 *
 * Usage (polling — Next.js / qontinui-web / runner pattern):
 *   useBuildIdWatcher({
 *     pollUrl: '/api/health',
 *     pollIntervalMs: 30_000,
 *     onBuildIdChange: () => setStale(true),
 *   });
 *
 * Usage (custom getter — e.g. Tauri invoke):
 *   useBuildIdWatcher({
 *     getCurrentBuildId: () => invoke<string>('get_build_id'),
 *     pollIntervalMs: 0, // one-shot; binary swap is the only divergence cause
 *     onBuildIdChange: () => setStale(true),
 *   });
 */
interface UseBuildIdWatcherOptions {
    /**
     * URL of the SSE stream that emits a `buildId` field on each event payload.
     * Defaults to `/health/stream`. Ignored when `pollUrl` or
     * `getCurrentBuildId` is provided.
     */
    healthStreamUrl?: string;
    /**
     * URL the hook will GET periodically. Response body must be JSON with a
     * top-level `buildId` field. When set, the SSE path is not used.
     */
    pollUrl?: string;
    /**
     * Custom build-id getter. Called once on mount and (if `pollIntervalMs > 0`)
     * on the configured interval. When set, the SSE and `pollUrl` paths are
     * not used.
     */
    getCurrentBuildId?: () => Promise<string> | string;
    /**
     * Polling interval in milliseconds for `pollUrl` / `getCurrentBuildId`.
     * Defaults to 30_000 (30s). Set to 0 for a one-shot check on mount only.
     * Ignored for the SSE path.
     */
    pollIntervalMs?: number;
    /**
     * Callback invoked the first time the watched source reports a build-id
     * that differs from the value read from the `<meta name="build-id">` tag
     * at mount time. Called at most once per mount.
     */
    onBuildIdChange?: (oldId: string, newId: string) => void;
}
declare function useBuildIdWatcher(options?: UseBuildIdWatcherOptions): void;

export { type AutoRegisterOptions, AutoRegisterProvider, type AutoRegisterProviderProps, CaptureHostFrame, type CaptureHostFrameProps, CommandRelayListener, type CommandRelayListenerProps, type ComponentActionDef, type ComputedPropertyDef, type ContentDiscoveryOptions, DEFAULT_CAPTURE_HOST_IDS, type IREffect, type IRElementCriteria, type IRMetadata, type IRProvenance, type IdStrategy, type MediaDiscoveryOptions, type ShortcutDef, State, type StateProps, TransitionTo, type TransitionToProps, UIBridgeComponentScope, type UIBridgeComponentScopeProps, type UIBridgeContextValue, UIBridgeProvider, type UIBridgeProviderProps, UI_BRIDGE_CONTENT_ATTR, UI_BRIDGE_ID_ATTR, UI_BRIDGE_PERSIST_ATTR, UI_BRIDGE_ROLE_ATTR, UI_BRIDGE_TEST_ID_ATTR, type UseBuildIdWatcherOptions, type UseCommandRelayOptions, type UseUIBridgeEchoOptions, type UseUIBridgeReturn, type UseUIComponentOptions, type UseUIComponentReturn, type UseUIElementOptions, type UseUIElementReturn, type UseUINavigationReturn, type UseUIStateGroupOptions, type UseUIStateGroupReturn, type UseUIStateOptions, type UseUIStateReturn, type UseUITransitionOptions, type UseUITransitionReturn, pollForTaggedElement, trackElementBbox, useActiveStates, useAutoRegister, useAvailableTransitions, useBuildIdWatcher, useCanNavigateTo, useCommandRelay, useDragSource, useDropZone, useKeyboardShortcuts, useNavigationPath, useOwningComponent, usePageContext, useRouteAwareness, useStateSnapshot, useTransitions, useUIAnnotation, useUIBridge, useUIBridgeContext, useUIBridgeEcho, useUIBridgeOptional, useUIBridgeRequired, useUIComponent, useUIComponentAction, useUIElement, useUIElementRef, useUINavigation, useUIRelationship, useUIRelationships, useUIState, useUIStateGroup, useUITransition, useUndoRedo };
