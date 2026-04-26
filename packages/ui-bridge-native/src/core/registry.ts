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
  NativeBridgeSnapshot,
  NativeElementIdentifier,
  NativeElementRef,
  NativeRegistrationCoverage,
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
   * Get all registered elements that are visible and have a layout
   */
  getVisibleElements(): RegisteredNativeElement[] {
    return this.getAllElements().filter((e) => {
      const state = e.getState();
      return state.visible && state.layout !== null;
    });
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
   * Create a snapshot of the current state
   */
  createSnapshot(
    routeInfo?: {
      currentRoute?: string | null;
      segments?: string[];
    },
    options?: { visibleOnly?: boolean; currentRouteOnly?: boolean }
  ): NativeBridgeSnapshot {
    let elements = options?.visibleOnly ? this.getVisibleElements() : this.getAllElements();

    // Filter to only elements registered on the current route
    if (options?.currentRouteOnly && routeInfo?.currentRoute) {
      const currentRoute = routeInfo.currentRoute;
      elements = elements.filter((e) => e.registrationRoute === currentRoute);
    }

    const snapshot: NativeBridgeSnapshot = {
      timestamp: Date.now(),
      elements: elements.map((e) => {
        const handlers = extractHandlerNames(e.props);
        return {
          id: e.id,
          type: e.type,
          label: e.label,
          identifier: e.getIdentifier(),
          state: e.getState(),
          actions: e.actions,
          customActions: e.customActions ? Object.keys(e.customActions) : undefined,
          registeredHandlers: handlers.length > 0 ? handlers : undefined,
          registrationRoute: e.registrationRoute,
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
      currentRoute: routeInfo?.currentRoute ?? null,
      segments: routeInfo?.segments,
      registration: this.getRegistrationCoverage(),
    };

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
      const ctx = { elements, currentRoute: routeInfo?.currentRoute ?? null };
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
