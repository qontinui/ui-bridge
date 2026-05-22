/**
 * Native Element and Component Registry
 *
 * Central registry for all UI elements and components registered with UI Bridge Native.
 * Adapted from ui-bridge for React Native environments.
 */

import type {
  RegisteredNativeElement,
  RegisteredNativeComponent,
  NativeElementState,
  NativeElementType,
  NativeStandardAction,
  NativeCustomAction,
  NativeAppInfo,
  NativeBridgeSnapshot,
  NativeElementIdentifier,
  NativeElementRef,
  NativeRegistrationCoverage,
  NativeRouteProviderLike,
  NativeSnapshotEnrichers,
  NativeSnapshotEnricher,
  Workflow,
  BridgeEvent,
  BridgeEventType,
  BridgeEventListener,
} from './types';

/**
 * Options for registering an element
 */
export interface RegisterElementOptions {
  type?: NativeElementType;
  label?: string;
  actions?: NativeStandardAction[];
  customActions?: Record<string, NativeCustomAction>;
  props?: Record<string, unknown>;
  treePath?: string;
  testId?: string;
  accessibilityLabel?: string;
  /** Route path where the element was registered (for page-scoped filtering) */
  registrationRoute?: string | null;
  /** Flattened RN style (from StyleSheet.flatten) for design review */
  flatStyle?: Record<string, unknown>;
  /** State-specific style overrides for design review */
  stateStyles?: {
    pressed?: Record<string, unknown>;
    focused?: Record<string, unknown>;
    disabled?: Record<string, unknown>;
  };
}

/**
 * Options for registering a component
 */
export interface RegisterComponentOptions {
  name: string;
  description?: string;
  actions?: Array<{
    id: string;
    label?: string;
    description?: string;
    handler: (params?: unknown) => unknown | Promise<unknown>;
  }>;
  elementIds?: string[];
}

/**
 * Registry configuration
 */
export interface NativeRegistryConfig {
  verbose?: boolean;
  onEvent?: BridgeEventListener;
}

/**
 * Extract handler function names from an element's props.
 * Returns names of props whose values are functions (e.g. ['onPress', 'onChangeText']).
 */
export function extractHandlerNames(props?: Record<string, unknown>): string[] {
  if (!props) return [];
  return Object.keys(props).filter((k) => typeof props[k] === 'function');
}

/**
 * Infer available actions based on element type
 */
function inferActions(type: NativeElementType): NativeStandardAction[] {
  const baseActions: NativeStandardAction[] = ['focus', 'blur'];

  switch (type) {
    case 'button':
    case 'touchable':
    case 'pressable':
      return [...baseActions, 'click', 'press', 'longPress', 'doubleTap'];
    case 'input':
      return [...baseActions, 'click', 'press', 'type', 'clear'];
    case 'text':
      return [...baseActions, 'click', 'press', 'longPress'];
    case 'view':
      return [...baseActions, 'click', 'press'];
    case 'scroll':
      return [...baseActions, 'scroll', 'swipe'];
    case 'list':
      return [...baseActions, 'scroll', 'swipe'];
    case 'listItem':
      return [...baseActions, 'click', 'press', 'longPress', 'swipe'];
    case 'switch':
    case 'checkbox':
      return [...baseActions, 'click', 'press', 'toggle'];
    case 'radio':
      return [...baseActions, 'click', 'press'];
    case 'image':
      return [...baseActions, 'click', 'press', 'longPress'];
    case 'modal':
      return ['focus', 'blur'];
    case 'custom':
    default:
      return [...baseActions, 'click', 'press'];
  }
}

/**
 * Native UI Bridge Registry
 *
 * Manages registration and lookup of native UI elements and components.
 */
export class NativeUIBridgeRegistry {
  private elements = new Map<string, RegisteredNativeElement>();
  private components = new Map<string, RegisteredNativeComponent>();
  private workflows = new Map<string, Workflow>();
  private eventListeners = new Map<BridgeEventType, Set<BridgeEventListener>>();
  private config: NativeRegistryConfig;
  private enrichers: NativeSnapshotEnrichers = {};
  private snapshotExtras = new Map<string, NativeSnapshotEnricher>();
  /**
   * App identification metadata (appId/appName/appType/framework). Set via
   * `setAppInfo` — typically wired in the server constructor from the
   * `NativeUIBridgeConfig` the host passes to `UIBridgeNativeProvider`.
   *
   * When set, `createSnapshot` includes it on the resulting snapshot so
   * agents can identify the app from snapshot bytes alone (parity with the
   * `uiBridge` block on the `health` response). Snapshots created before
   * this is wired simply omit the field.
   */
  private appInfo: NativeAppInfo | null = null;
  /**
   * Optional route provider. When set, `createSnapshot` reads
   * `currentRoute`/`segments` from it whenever the caller does not pass an
   * explicit `routeInfo` argument. This lets the default `getSnapshot` HTTP
   * handler — which has no direct reference to the `NativeUIBridgeServer`
   * instance — still emit a populated `currentRoute` field.
   *
   * Wired by `NativeUIBridgeServer.setRouteProvider`, which forwards the
   * provider into the registry alongside the per-handler overrides it
   * already installs.
   */
  private routeProvider: NativeRouteProviderLike | null = null;
  /**
   * Sticky flag: flips `true` the first time any element is registered and
   * stays `true` even after elements are unregistered. Lets agents distinguish
   * "this route never wired any elements" from "this route registered then
   * unmounted".
   */
  private everHadRegistrations = false;

  constructor(config: NativeRegistryConfig = {}) {
    this.config = config;
  }

  // ============================================================================
  // App Info & Route Provider
  // ============================================================================

  /**
   * Set the app identification metadata returned alongside snapshots.
   * Idempotent — re-calling with the same shape is a no-op.
   * Pass `null` (or omit a previous call) to clear.
   */
  setAppInfo(info: NativeAppInfo | null | undefined): void {
    this.appInfo = info ?? null;
  }

  /** Read-only accessor for the registered app info, if any. */
  getAppInfo(): NativeAppInfo | null {
    return this.appInfo;
  }

  /**
   * Set a route provider whose `getCurrentRoute`/`getSegments` are read by
   * `createSnapshot` when no explicit `routeInfo` argument is supplied.
   *
   * Call with `null` to detach (e.g. when the host swaps providers on HMR).
   */
  setRouteProvider(provider: NativeRouteProviderLike | null | undefined): void {
    this.routeProvider = provider ?? null;
  }

  /** Read-only accessor for the registered route provider, if any. */
  getRouteProvider(): NativeRouteProviderLike | null {
    return this.routeProvider;
  }

  // ============================================================================
  // Snapshot Enricher Slots
  // ============================================================================

  /**
   * Register/replace canonical enrichers (modal/toast/undo). HMR-safe — calling
   * with a partial set merges into existing slots instead of clobbering them.
   */
  setEnrichers(e: Partial<NativeSnapshotEnrichers>): void {
    this.enrichers = { ...this.enrichers, ...e };
  }

  /**
   * Read-only accessor for the canonical enrichers slot. Returned object is
   * the live reference, so callers can detect "no detector wired" via
   * `getEnrichers().modalDetector === undefined`. Used by the test-hook HTTP
   * handlers (`control/modal/push`, `control/modal/dismiss/:id`) which need
   * to drive the ModalDetector directly without re-instantiating it.
   */
  getEnrichers(): Readonly<NativeSnapshotEnrichers> {
    return this.enrichers;
  }

  /**
   * Register a custom snapshot enricher. The returned object will be
   * `Object.assign`ed onto the snapshot, so use unique top-level keys to avoid
   * clobbering canonical fields. Returns a disposer.
   */
  registerSnapshotEnricher(name: string, fn: NativeSnapshotEnricher): () => void {
    this.snapshotExtras.set(name, fn);
    return () => this.unregisterSnapshotEnricher(name);
  }

  /** Remove a custom snapshot enricher by name */
  unregisterSnapshotEnricher(name: string): void {
    this.snapshotExtras.delete(name);
  }

  // ============================================================================
  // Element Management
  // ============================================================================

  /**
   * Register a native element
   */
  registerElement(
    id: string,
    ref: React.RefObject<NativeElementRef>,
    options: RegisterElementOptions = {}
  ): RegisteredNativeElement {
    const {
      type = 'custom',
      label,
      actions = inferActions(type),
      customActions,
      props,
      treePath = id,
      testId,
      accessibilityLabel,
      registrationRoute,
      flatStyle,
      stateStyles,
    } = options;

    // Create state getter
    const getState = (): NativeElementState => {
      const element = ref.current;
      if (!element) {
        return {
          mounted: false,
          visible: false,
          enabled: false,
          focused: false,
          layout: null,
        };
      }

      // State is populated by the element during onLayout
      // Here we return the stored state from the element's metadata
      const stored = this.elements.get(id);
      if (stored && stored.getState !== getState) {
        return stored.getState();
      }

      return {
        mounted: true,
        visible: true,
        enabled: true,
        focused: false,
        layout: null,
      };
    };

    // Create identifier getter
    const getIdentifier = (): NativeElementIdentifier => ({
      uiId: id,
      testId: testId || id,
      accessibilityLabel,
      treePath,
    });

    const registered: RegisteredNativeElement = {
      id,
      ref,
      type,
      label,
      actions,
      customActions,
      props,
      getState,
      getIdentifier,
      registeredAt: Date.now(),
      mounted: true,
      registrationRoute: registrationRoute ?? null,
      flatStyle,
      stateStyles,
    };

    this.elements.set(id, registered);
    this.everHadRegistrations = true;

    this.emit('element:registered', { id, type, label });

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered element: ${id} (${type})`);
    }

    // Seed a sensible initial state so elements are immediately visible in snapshots
    // even before onLayout fires. Layout-measuring code can overwrite this later.
    this.updateElementState(id, {
      mounted: true,
      visible: true,
      enabled: true,
      focused: false,
      layout: null,
    });

    return registered;
  }

  /**
   * Unregister an element
   */
  unregisterElement(id: string): void {
    const element = this.elements.get(id);
    if (element) {
      this.elements.delete(id);
      this.emit('element:unregistered', { id });

      if (this.config.verbose) {
        console.log(`[ui-bridge-native] Unregistered element: ${id}`);
      }
    }
  }

  /**
   * Get a registered element
   */
  getElement(id: string): RegisteredNativeElement | undefined {
    return this.elements.get(id);
  }

  /**
   * Get all registered elements
   */
  getAllElements(): RegisteredNativeElement[] {
    return Array.from(this.elements.values());
  }

  /**
   * Get all registered elements that are visible AND have a measured layout.
   *
   * This is the *strict* visibility filter: requires `state.visible === true`
   * AND `state.layout !== null`. Use this when you need both signals
   * (e.g. coord-based tap, where you need an actual rect to hit-test against).
   *
   * Callers driving an LLM agent typically want
   * {@link getMountedVisibleElements} instead — that variant accepts
   * elements that *should* be on screen (visible:true) but whose first
   * `onLayout` has not yet fired. Without it, a snapshot taken in the gap
   * between mount and the first layout pass returns 0 elements on a fully
   * populated screen.
   */
  getVisibleElements(): RegisteredNativeElement[] {
    return this.getAllElements().filter((e) => {
      const state = e.getState();
      return state.visible && state.layout !== null;
    });
  }

  /**
   * Get all registered elements marked as visible (regardless of layout).
   *
   * Looser than {@link getVisibleElements}: includes elements whose
   * `onLayout` callback has not yet fired (so `layout === null`). React
   * Native's `onLayout` is async — there's a one-tick window after mount
   * where elements are in the tree, the user *sees* them, but the
   * registry hasn't received their measurements yet. Excluding those
   * elements makes `getSnapshot?visibleOnly=true` return 0 on a populated
   * screen, which is a worse failure mode than including a few elements
   * we can't yet locate spatially.
   *
   * Used by `createSnapshot`'s `visibleOnly` filter and by the
   * `getSnapshot` / `getElements` handlers. Each emitted element carries a
   * `visibility` discriminator (`"visible"` / `"likely-visible"`) so
   * agents that *do* require a known rect can branch downstream.
   */
  getMountedVisibleElements(): RegisteredNativeElement[] {
    return this.getAllElements().filter((e) => e.getState().visible);
  }

  /**
   * Get elements registered on a specific route (for page-scoped filtering)
   */
  getElementsForRoute(route: string): RegisteredNativeElement[] {
    return this.getAllElements().filter((e) => e.registrationRoute === route);
  }

  /**
   * Mark elements registered on a route as off-screen (visible: false, layout: null).
   *
   * Use this when a screen loses focus but stays mounted — common in React Navigation
   * tab navigators where inactive tabs remain in the tree. Without this call, stale
   * `layout` data lingers in snapshots and makes off-screen elements look rendered.
   *
   * Does NOT unregister the elements — they stay registered so the user's next visit
   * re-measures them via `onLayout` without re-mount cost. Elements without a
   * `registrationRoute` (app-wide registrations) are untouched.
   */
  markRouteOffscreen(route: string): void {
    // Guard against accidental global wipes. Elements registered without a
    // route have `registrationRoute: null` — passing null/empty here would
    // match every globally-registered element and erase their layouts.
    if (route == null || route === '') {
      if (this.config.verbose) {
        console.warn(
          `[ui-bridge-native] markRouteOffscreen called with null/empty route — ignoring`
        );
      }
      return;
    }
    let cleared = 0;
    for (const element of this.elements.values()) {
      if (element.registrationRoute === route) {
        this.updateElementState(element.id, {
          visible: false,
          layout: null,
        });
        cleared++;
      }
    }
    if (this.config.verbose && cleared > 0) {
      console.log(`[ui-bridge-native] Marked ${cleared} elements offscreen for route: ${route}`);
    }
  }

  /**
   * Update element state
   */
  updateElementState(id: string, state: Partial<NativeElementState>): void {
    const element = this.elements.get(id);
    if (element) {
      // Create a new getState that includes the updated state
      const currentState = element.getState();
      const newState = { ...currentState, ...state };

      const updated: RegisteredNativeElement = {
        ...element,
        getState: () => newState,
      };

      this.elements.set(id, updated);
      this.emit('element:stateChanged', { id, state: newState });
    }
  }

  /**
   * Update an element's descriptive metadata (label / accessibilityLabel /
   * testId). Sister to {@link updateElementState} (which carries layout +
   * visibility) and {@link updateElementProps} (which carries event handlers).
   *
   * Idempotent — if every passed field equals the existing value, the call
   * returns without mutating the entry or emitting an event. This keeps
   * `useUIElement().updateLabel(...)` cheap when consumers re-publish from a
   * render path that produces the same string on every tick.
   *
   * Returns `true` when the entry was mutated, `false` otherwise. Callers
   * that want to gate a `console.warn` on no-op invocations can use the
   * return value instead of recomputing equality.
   */
  updateElementMeta(
    id: string,
    meta: { label?: string; accessibilityLabel?: string; testId?: string }
  ): boolean {
    const element = this.elements.get(id);
    if (!element) return false;

    // The `testId` on a registered element lives inside the identifier
    // closure (see registerElement's `getIdentifier`). To rebuild it we
    // need the current value — read it via the existing identifier and
    // overlay the new one if provided.
    const currentIdentifier = element.getIdentifier();
    const nextLabel = meta.label !== undefined ? meta.label : element.label;
    const nextAccessibilityLabel =
      meta.accessibilityLabel !== undefined
        ? meta.accessibilityLabel
        : currentIdentifier.accessibilityLabel;
    const nextTestId = meta.testId !== undefined ? meta.testId : currentIdentifier.testId;

    const labelChanged = nextLabel !== element.label;
    const accessibilityLabelChanged = nextAccessibilityLabel !== currentIdentifier.accessibilityLabel;
    const testIdChanged = nextTestId !== currentIdentifier.testId;

    if (!labelChanged && !accessibilityLabelChanged && !testIdChanged) {
      return false;
    }

    const updated: RegisteredNativeElement = {
      ...element,
      label: nextLabel,
      getIdentifier: (): NativeElementIdentifier => ({
        uiId: id,
        testId: nextTestId,
        accessibilityLabel: nextAccessibilityLabel,
        treePath: currentIdentifier.treePath,
      }),
    };
    this.elements.set(id, updated);

    // Reuse `element:registered` rather than minting a new event — downstream
    // consumers already subscribe to it for label/identifier diffs, and
    // adding a new BridgeEventType ('element:metaChanged') would force a
    // SemVer-major bump on every snapshot consumer.
    this.emit('element:registered', {
      id,
      type: element.type,
      label: nextLabel,
    });

    return true;
  }

  /**
   * Update element props (for action execution)
   */
  updateElementProps(id: string, props: Record<string, unknown>): void {
    const element = this.elements.get(id);
    if (element) {
      const updated: RegisteredNativeElement = {
        ...element,
        props: { ...element.props, ...props },
      };
      this.elements.set(id, updated);
    }
  }

  /**
   * Update element style for design review
   */
  updateElementStyle(
    id: string,
    flatStyle: Record<string, unknown>,
    stateStyles?: {
      pressed?: Record<string, unknown>;
      focused?: Record<string, unknown>;
      disabled?: Record<string, unknown>;
    }
  ): void {
    const element = this.elements.get(id);
    if (element) {
      const updated: RegisteredNativeElement = {
        ...element,
        flatStyle,
        ...(stateStyles !== undefined ? { stateStyles } : {}),
      };
      this.elements.set(id, updated);
    }
  }

  /**
   * Get element style for design review
   */
  getElementStyle(id: string): Record<string, unknown> | null {
    const element = this.elements.get(id);
    return element?.flatStyle ?? null;
  }

  /**
   * Find element by testID
   */
  findByTestId(testId: string): RegisteredNativeElement | undefined {
    for (const element of this.elements.values()) {
      const identifier = element.getIdentifier();
      if (identifier.testId === testId) {
        return element;
      }
    }
    return undefined;
  }

  /**
   * Find elements by type
   */
  findByType(type: NativeElementType): RegisteredNativeElement[] {
    return Array.from(this.elements.values()).filter((e) => e.type === type);
  }

  // ============================================================================
  // Component Management
  // ============================================================================

  /**
   * Register a component
   */
  registerComponent(id: string, options: RegisterComponentOptions): RegisteredNativeComponent {
    const { name, description, actions = [], elementIds } = options;

    const registered: RegisteredNativeComponent = {
      id,
      name,
      description,
      actions: actions.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        handler: a.handler,
      })),
      elementIds,
      registeredAt: Date.now(),
      mounted: true,
    };

    this.components.set(id, registered);

    this.emit('component:registered', { id, name });

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered component: ${id} (${name})`);
    }

    return registered;
  }

  /**
   * Unregister a component
   */
  unregisterComponent(id: string): void {
    const component = this.components.get(id);
    if (component) {
      this.components.delete(id);
      this.emit('component:unregistered', { id });

      if (this.config.verbose) {
        console.log(`[ui-bridge-native] Unregistered component: ${id}`);
      }
    }
  }

  /**
   * Get a registered component
   */
  getComponent(id: string): RegisteredNativeComponent | undefined {
    return this.components.get(id);
  }

  /**
   * Get all registered components
   */
  getAllComponents(): RegisteredNativeComponent[] {
    return Array.from(this.components.values());
  }

  // ============================================================================
  // Workflow Management
  // ============================================================================

  /**
   * Register a workflow
   */
  registerWorkflow(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow);

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered workflow: ${workflow.id}`);
    }
  }

  /**
   * Unregister a workflow
   */
  unregisterWorkflow(id: string): void {
    this.workflows.delete(id);
  }

  /**
   * Get a workflow
   */
  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  // ============================================================================
  // Event System
  // ============================================================================

  /**
   * Subscribe to events
   */
  on<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): () => void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener as BridgeEventListener);

    // Return unsubscribe function
    return () => this.off(type, listener);
  }

  /**
   * Unsubscribe from events
   */
  off<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): void {
    this.eventListeners.get(type)?.delete(listener as BridgeEventListener);
  }

  /**
   * Emit an event
   */
  emit(type: BridgeEventType, data: unknown): void {
    const event: BridgeEvent = {
      type,
      timestamp: Date.now(),
      data,
    };

    // Notify listeners
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`[ui-bridge-native] Event listener error:`, error);
        }
      }
    }

    // Notify global handler
    if (this.config.onEvent) {
      try {
        this.config.onEvent(event);
      } catch (error) {
        console.error(`[ui-bridge-native] Global event handler error:`, error);
      }
    }
  }

  // ============================================================================
  // Snapshots
  // ============================================================================

  /**
   * Create a snapshot of the current state.
   *
   * Route resolution: `routeInfo` wins when provided. Otherwise — and this
   * is the path the default `getSnapshot` HTTP handler takes — we fall back
   * to the registered `routeProvider`. This means callers that never wire a
   * server-level override (the bare-server / cloud-relay path) still get a
   * populated `currentRoute` field as long as `setRouteProvider` was called
   * on the registry.
   */
  createSnapshot(
    routeInfo?: {
      currentRoute?: string | null;
      segments?: string[];
    },
    options?: { visibleOnly?: boolean; currentRouteOnly?: boolean }
  ): NativeBridgeSnapshot {
    // Resolve route info: prefer the explicit argument, fall back to a
    // registered route provider. We treat an explicitly-passed `routeInfo`
    // (even if both fields are null/undefined) as "the caller is in charge"
    // so server-layer overrides that pass `{currentRoute: null}` keep working.
    const resolvedRoute: { currentRoute: string | null; segments: string[] | undefined } = (() => {
      if (routeInfo !== undefined) {
        return {
          currentRoute: routeInfo.currentRoute ?? null,
          segments: routeInfo.segments,
        };
      }
      if (this.routeProvider) {
        try {
          return {
            currentRoute: this.routeProvider.getCurrentRoute() ?? null,
            segments: this.routeProvider.getSegments?.(),
          };
        } catch (error) {
          if (this.config.verbose) {
            console.warn(`[ui-bridge-native] routeProvider getCurrentRoute threw:`, error);
          }
          return { currentRoute: null, segments: undefined };
        }
      }
      return { currentRoute: null, segments: undefined };
    })();

    // visibleOnly uses the *looser* mounted-visible filter so a snapshot
    // taken in the gap between mount and the first `onLayout` doesn't
    // return 0 elements on a populated screen. Each element in the
    // payload carries a `visibility` field so agents can branch on
    // measured vs unmeasured.
    let elements = options?.visibleOnly
      ? this.getMountedVisibleElements()
      : this.getAllElements();

    // Filter to only elements registered on the current route
    if (options?.currentRouteOnly && resolvedRoute.currentRoute) {
      const currentRoute = resolvedRoute.currentRoute;
      elements = elements.filter((e) => e.registrationRoute === currentRoute);
    }

    const snapshot: NativeBridgeSnapshot = {
      timestamp: Date.now(),
      elements: elements.map((e) => {
        const handlers = extractHandlerNames(e.props);
        const state = e.getState();
        const visibility: 'visible' | 'likely-visible' | 'hidden' = !state.visible
          ? 'hidden'
          : state.layout !== null
            ? 'visible'
            : 'likely-visible';
        return {
          id: e.id,
          type: e.type,
          label: e.label,
          identifier: e.getIdentifier(),
          state,
          actions: e.actions,
          customActions: e.customActions ? Object.keys(e.customActions) : undefined,
          registeredHandlers: handlers.length > 0 ? handlers : undefined,
          registrationRoute: e.registrationRoute,
          visibility,
        };
      }),
      components: this.getAllComponents().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        actions: c.actions.map((a) => a.id),
        elementIds: c.elementIds,
      })),
      workflows: this.getAllWorkflows().map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        stepCount: w.steps.length,
      })),
      currentRoute: resolvedRoute.currentRoute,
      segments: resolvedRoute.segments,
      registration: this.getRegistrationCoverage(),
    };

    // Include app identification metadata so consumers can identify which
    // app produced this snapshot without a separate health probe.
    if (this.appInfo) {
      snapshot.appInfo = this.appInfo;
    }

    // Canonical enrichers — each in its own try/catch so a misbehaving tracker
    // can never break the rest of the snapshot.
    if (this.enrichers.modalDetector) {
      try {
        snapshot.modalStack = this.enrichers.modalDetector.getSnapshotModalContext();
      } catch (error) {
        if (this.config.verbose) {
          console.warn(`[ui-bridge-native] modalDetector enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.toastCapture) {
      try {
        snapshot.toasts = this.enrichers.toastCapture.getSnapshotToastContext();
      } catch (error) {
        if (this.config.verbose) {
          console.warn(`[ui-bridge-native] toastCapture enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.undoTracker) {
      try {
        snapshot.undoRedo = this.enrichers.undoTracker.getSnapshotUndoContext();
      } catch (error) {
        if (this.config.verbose) {
          console.warn(`[ui-bridge-native] undoTracker enricher threw:`, error);
        }
      }
    }

    // Custom enrichers — keys assign-merged onto the snapshot
    if (this.snapshotExtras.size > 0) {
      const ctx = { elements, currentRoute: resolvedRoute.currentRoute };
      for (const [name, fn] of this.snapshotExtras) {
        try {
          const extra = fn(ctx);
          if (extra && typeof extra === 'object') {
            Object.assign(snapshot, extra);
          }
        } catch (error) {
          if (this.config.verbose) {
            console.warn(`[ui-bridge-native] snapshot enricher "${name}" threw:`, error);
          }
        }
      }
    }

    return snapshot;
  }

  /**
   * Get registry statistics
   */
  getStats(): { elements: number; components: number; workflows: number } {
    return {
      elements: this.elements.size,
      components: this.components.size,
      workflows: this.workflows.size,
    };
  }

  /**
   * Compute registration coverage metadata for the current registry state.
   *
   * Groups currently-registered elements by `registrationRoute`, bucketing
   * elements without a route under `'?'`. `everHadRegistrations` is sticky —
   * once true, it stays true for the lifetime of the registry instance.
   */
  getRegistrationCoverage(): NativeRegistrationCoverage {
    const byRoute: Record<string, number> = {};
    for (const element of this.elements.values()) {
      const key =
        element.registrationRoute == null || element.registrationRoute === ''
          ? '?'
          : element.registrationRoute;
      byRoute[key] = (byRoute[key] ?? 0) + 1;
    }
    return {
      totalRegistered: this.elements.size,
      everHadRegistrations: this.everHadRegistrations,
      byRoute,
    };
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.elements.clear();
    this.components.clear();
    this.workflows.clear();

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registry cleared`);
    }
  }
}

// ============================================================================
// Global Registry
// ============================================================================

let globalRegistry: NativeUIBridgeRegistry | null = null;

/**
 * Set the global registry
 */
export function setGlobalRegistry(registry: NativeUIBridgeRegistry): void {
  globalRegistry = registry;
}

/**
 * Get the global registry
 */
export function getGlobalRegistry(): NativeUIBridgeRegistry | null {
  return globalRegistry;
}

/**
 * Reset the global registry
 */
export function resetGlobalRegistry(): void {
  globalRegistry?.clear();
  globalRegistry = null;
}
