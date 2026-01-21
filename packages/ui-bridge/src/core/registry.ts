/**
 * Element and Component Registry
 *
 * Central registry for all UI elements and components registered with UI Bridge.
 * Provides methods for registration, lookup, and lifecycle management.
 */

import type {
  RegisteredElement,
  RegisteredComponent,
  Workflow,
  ElementState,
  ElementType,
  StandardAction,
  CustomAction,
  BridgeEvent,
  BridgeEventType,
  BridgeEventListener,
  BridgeSnapshot,
} from './types';
import { createElementIdentifier } from './element-identifier';

/**
 * Get the current state of an element
 */
function getElementState(element: HTMLElement): ElementState {
  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);

  const state: ElementState = {
    visible: isElementVisible(element, rect, computedStyle),
    enabled: !isElementDisabled(element),
    focused: document.activeElement === element,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    },
    textContent: element.textContent?.trim() || undefined,
    computedStyles: {
      display: computedStyle.display,
      visibility: computedStyle.visibility,
      opacity: computedStyle.opacity,
      pointerEvents: computedStyle.pointerEvents,
    },
  };

  // Add input-specific state
  if (element instanceof HTMLInputElement) {
    state.value = element.value;
    if (element.type === 'checkbox' || element.type === 'radio') {
      state.checked = element.checked;
    }
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = element.value;
  } else if (element instanceof HTMLSelectElement) {
    state.value = element.value;
    state.selectedOptions = Array.from(element.selectedOptions).map((opt) => opt.value);
  }

  return state;
}

/**
 * Check if an element is visible
 */
function isElementVisible(
  element: HTMLElement,
  rect: DOMRect,
  style: CSSStyleDeclaration
): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;

  // Check if in viewport
  const inViewport =
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0;

  return inViewport;
}

/**
 * Check if an element is disabled
 */
function isElementDisabled(element: HTMLElement): boolean {
  if ('disabled' in element && (element as HTMLButtonElement).disabled) {
    return true;
  }
  if (element.getAttribute('aria-disabled') === 'true') {
    return true;
  }
  return false;
}

/**
 * Infer available actions based on element type
 */
function inferActions(type: ElementType): StandardAction[] {
  const baseActions: StandardAction[] = ['focus', 'blur', 'hover'];

  switch (type) {
    case 'button':
      return [...baseActions, 'click', 'doubleClick', 'rightClick'];
    case 'input':
      return [...baseActions, 'click', 'type', 'clear'];
    case 'textarea':
      return [...baseActions, 'click', 'type', 'clear'];
    case 'select':
      return [...baseActions, 'click', 'select'];
    case 'checkbox':
      return [...baseActions, 'click', 'check', 'uncheck', 'toggle'];
    case 'radio':
      return [...baseActions, 'click', 'check'];
    case 'link':
      return [...baseActions, 'click'];
    case 'form':
      return ['focus', 'blur'];
    case 'menu':
    case 'menuitem':
      return [...baseActions, 'click'];
    case 'tab':
      return [...baseActions, 'click'];
    case 'dialog':
      return ['focus', 'blur'];
    case 'custom':
    default:
      return [...baseActions, 'click'];
  }
}

/**
 * Infer element type from HTML element
 */
function inferElementType(element: HTMLElement): ElementType {
  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute('role');

  // Check role first
  if (role) {
    switch (role) {
      case 'button':
        return 'button';
      case 'textbox':
        return 'input';
      case 'checkbox':
        return 'checkbox';
      case 'radio':
        return 'radio';
      case 'link':
        return 'link';
      case 'listbox':
      case 'combobox':
        return 'select';
      case 'menu':
        return 'menu';
      case 'menuitem':
        return 'menuitem';
      case 'tab':
        return 'tab';
      case 'dialog':
        return 'dialog';
    }
  }

  // Check tag name
  switch (tagName) {
    case 'button':
      return 'button';
    case 'input': {
      const inputType = (element as HTMLInputElement).type;
      if (inputType === 'checkbox') return 'checkbox';
      if (inputType === 'radio') return 'radio';
      if (inputType === 'submit' || inputType === 'button') return 'button';
      return 'input';
    }
    case 'textarea':
      return 'textarea';
    case 'select':
      return 'select';
    case 'a':
      return 'link';
    case 'form':
      return 'form';
    default:
      return 'custom';
  }
}

/**
 * Registry options
 */
export interface RegistryOptions {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Callback when an event occurs */
  onEvent?: BridgeEventListener;
}

/**
 * UI Bridge Registry
 *
 * Central registry for managing elements, components, and workflows.
 */
export class UIBridgeRegistry {
  private elements = new Map<string, RegisteredElement>();
  private components = new Map<string, RegisteredComponent>();
  private workflows = new Map<string, Workflow>();
  private eventListeners = new Map<BridgeEventType, Set<BridgeEventListener>>();
  private options: RegistryOptions;

  constructor(options: RegistryOptions = {}) {
    this.options = options;
  }

  /**
   * Emit an event
   */
  private emit<T>(type: BridgeEventType, data: T): void {
    const event: BridgeEvent<T> = {
      type,
      timestamp: Date.now(),
      data,
    };

    // Call global handler
    this.options.onEvent?.(event);

    // Call specific listeners
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in event listener for ${type}:`, error);
        }
      }
    }

    if (this.options.verbose) {
      console.log('[UIBridge]', type, data);
    }
  }

  /**
   * Register an event listener
   */
  on<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): () => void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener as BridgeEventListener);

    // Return unsubscribe function
    return () => {
      this.eventListeners.get(type)?.delete(listener as BridgeEventListener);
    };
  }

  /**
   * Remove an event listener
   */
  off<T = unknown>(type: BridgeEventType, listener: BridgeEventListener<T>): void {
    this.eventListeners.get(type)?.delete(listener as BridgeEventListener);
  }

  /**
   * Register an element
   */
  registerElement(
    id: string,
    element: HTMLElement,
    options: {
      type?: ElementType;
      label?: string;
      actions?: StandardAction[];
      customActions?: Record<string, CustomAction>;
    } = {}
  ): RegisteredElement {
    const type = options.type ?? inferElementType(element);
    const actions = options.actions ?? inferActions(type);

    const registered: RegisteredElement = {
      id,
      element,
      type,
      label: options.label,
      actions,
      customActions: options.customActions,
      getState: () => getElementState(element),
      getIdentifier: () => createElementIdentifier(element),
      registeredAt: Date.now(),
      mounted: true,
    };

    this.elements.set(id, registered);
    this.emit('element:registered', { id, type, label: options.label });

    return registered;
  }

  /**
   * Unregister an element
   */
  unregisterElement(id: string): boolean {
    const element = this.elements.get(id);
    if (element) {
      element.mounted = false;
      this.elements.delete(id);
      this.emit('element:unregistered', { id });
      return true;
    }
    return false;
  }

  /**
   * Get a registered element
   */
  getElement(id: string): RegisteredElement | undefined {
    return this.elements.get(id);
  }

  /**
   * Get all registered elements
   */
  getAllElements(): RegisteredElement[] {
    return Array.from(this.elements.values());
  }

  /**
   * Find element by DOM element reference
   */
  findByDOMElement(element: HTMLElement): RegisteredElement | undefined {
    for (const registered of this.elements.values()) {
      if (registered.element === element) {
        return registered;
      }
    }
    return undefined;
  }

  /**
   * Register a component
   */
  registerComponent(
    id: string,
    options: {
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
  ): RegisteredComponent {
    const registered: RegisteredComponent = {
      id,
      name: options.name,
      description: options.description,
      actions:
        options.actions?.map((a) => ({
          id: a.id,
          label: a.label,
          description: a.description,
          handler: a.handler,
        })) ?? [],
      elementIds: options.elementIds,
      registeredAt: Date.now(),
      mounted: true,
    };

    this.components.set(id, registered);
    this.emit('component:registered', { id, name: options.name });

    return registered;
  }

  /**
   * Unregister a component
   */
  unregisterComponent(id: string): boolean {
    const component = this.components.get(id);
    if (component) {
      component.mounted = false;
      this.components.delete(id);
      this.emit('component:unregistered', { id });
      return true;
    }
    return false;
  }

  /**
   * Get a registered component
   */
  getComponent(id: string): RegisteredComponent | undefined {
    return this.components.get(id);
  }

  /**
   * Get all registered components
   */
  getAllComponents(): RegisteredComponent[] {
    return Array.from(this.components.values());
  }

  /**
   * Register a workflow
   */
  registerWorkflow(workflow: Workflow): Workflow {
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  /**
   * Unregister a workflow
   */
  unregisterWorkflow(id: string): boolean {
    return this.workflows.delete(id);
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

  /**
   * Create a snapshot of the current state
   */
  createSnapshot(): BridgeSnapshot {
    return {
      timestamp: Date.now(),
      elements: this.getAllElements().map((el) => ({
        id: el.id,
        type: el.type,
        label: el.label,
        identifier: el.getIdentifier(),
        state: el.getState(),
        actions: el.actions,
        customActions: el.customActions ? Object.keys(el.customActions) : undefined,
      })),
      components: this.getAllComponents().map((comp) => ({
        id: comp.id,
        name: comp.name,
        description: comp.description,
        actions: comp.actions.map((a) => a.id),
        elementIds: comp.elementIds,
      })),
      workflows: this.getAllWorkflows().map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepCount: wf.steps.length,
      })),
    };
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.elements.clear();
    this.components.clear();
    this.workflows.clear();
    this.eventListeners.clear();
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    elementCount: number;
    componentCount: number;
    workflowCount: number;
    mountedElementCount: number;
    mountedComponentCount: number;
  } {
    const elements = this.getAllElements();
    const components = this.getAllComponents();

    return {
      elementCount: elements.length,
      componentCount: components.length,
      workflowCount: this.workflows.size,
      mountedElementCount: elements.filter((e) => e.mounted).length,
      mountedComponentCount: components.filter((c) => c.mounted).length,
    };
  }
}

/**
 * Default global registry instance
 */
let globalRegistry: UIBridgeRegistry | null = null;

/**
 * Get or create the global registry
 */
export function getGlobalRegistry(): UIBridgeRegistry {
  if (!globalRegistry) {
    globalRegistry = new UIBridgeRegistry();
  }
  return globalRegistry;
}

/**
 * Set the global registry
 */
export function setGlobalRegistry(registry: UIBridgeRegistry): void {
  globalRegistry = registry;
}

/**
 * Reset the global registry
 */
export function resetGlobalRegistry(): void {
  globalRegistry?.clear();
  globalRegistry = null;
}
