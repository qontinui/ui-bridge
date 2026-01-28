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
 * Infer available actions based on element type
 */
function inferActions(type: NativeElementType): NativeStandardAction[] {
  const baseActions: NativeStandardAction[] = ['focus', 'blur'];

  switch (type) {
    case 'button':
    case 'touchable':
    case 'pressable':
      return [...baseActions, 'press', 'longPress', 'doubleTap'];
    case 'input':
      return [...baseActions, 'press', 'type', 'clear'];
    case 'text':
      return [...baseActions, 'press', 'longPress'];
    case 'view':
      return [...baseActions, 'press'];
    case 'scroll':
      return [...baseActions, 'scroll', 'swipe'];
    case 'list':
      return [...baseActions, 'scroll', 'swipe'];
    case 'listItem':
      return [...baseActions, 'press', 'longPress', 'swipe'];
    case 'switch':
    case 'checkbox':
      return [...baseActions, 'press', 'toggle'];
    case 'radio':
      return [...baseActions, 'press'];
    case 'image':
      return [...baseActions, 'press', 'longPress'];
    case 'modal':
      return ['focus', 'blur'];
    case 'custom':
    default:
      return [...baseActions, 'press'];
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

  constructor(config: NativeRegistryConfig = {}) {
    this.config = config;
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
    };

    this.elements.set(id, registered);

    this.emit('element:registered', { id, type, label });

    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered element: ${id} (${type})`);
    }

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
  private emit(type: BridgeEventType, data: unknown): void {
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
  createSnapshot(): NativeBridgeSnapshot {
    return {
      timestamp: Date.now(),
      elements: this.getAllElements().map((e) => ({
        id: e.id,
        type: e.type,
        label: e.label,
        identifier: e.getIdentifier(),
        state: e.getState(),
        actions: e.actions,
        customActions: e.customActions ? Object.keys(e.customActions) : undefined,
      })),
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
    };
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
