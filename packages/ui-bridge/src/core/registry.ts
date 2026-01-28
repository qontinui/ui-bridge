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
  UIState,
  UIStateGroup,
  UITransition,
  PathResult,
  TransitionResult,
  NavigationResult,
  StateSnapshot,
  ComponentStateResponse,
  StateGetter,
} from './types';
import { createElementIdentifier } from './element-identifier';
import { fuzzyMatch, tokenSimilarity } from '../ai/fuzzy-matcher';
import { generateAliases, generateDescription, generatePurpose } from '../ai/alias-generator';
import type { SearchCriteria, SearchResult, AIDiscoveredElement } from '../ai/types';

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

  // State management
  private states = new Map<string, UIState>();
  private stateGroups = new Map<string, UIStateGroup>();
  private transitions = new Map<string, UITransition>();
  private activeStates = new Set<string>();

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

    // Check if element has an explicitly-set data-ui-id attribute (e.g., from React props)
    // If so, use that value as the ID to preserve developer intent
    // This handles timing issues where React may apply props after MutationObserver fires
    const existingUiId = element.getAttribute('data-ui-id');
    const actualId = existingUiId || id;

    // Only set data-ui-id if it wasn't already set
    // This preserves explicitly-set IDs from React props
    if (!existingUiId) {
      element.setAttribute('data-ui-id', actualId);
    }

    const registered: RegisteredElement = {
      id: actualId,
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

    this.elements.set(actualId, registered);
    this.emit('element:registered', { id: actualId, type, label: options.label });

    return registered;
  }

  /**
   * Unregister an element
   */
  unregisterElement(id: string): boolean {
    const registered = this.elements.get(id);
    if (registered) {
      registered.mounted = false;
      // Remove data-ui-id attribute from DOM element
      registered.element.removeAttribute('data-ui-id');
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
   * Search for elements using AI search criteria
   */
  searchElements(criteria: SearchCriteria): SearchResult[] {
    const results: SearchResult[] = [];
    const threshold = criteria.fuzzyThreshold ?? 0.7;

    for (const element of this.elements.values()) {
      if (!element.mounted) continue;

      const state = element.getState();

      // Skip hidden elements if not explicitly requested
      if (!criteria.fuzzy && !state.visible) continue;

      // Build searchable text from element
      const aliases = element.aliases ?? this.generateElementAliases(element);
      const textContent = state.textContent?.trim() || '';
      const label = element.label || '';

      let maxScore = 0;
      const matchReasons: string[] = [];
      const scores: SearchResult['scores'] = {};

      // Text matching
      if (criteria.text) {
        // Exact match
        if (textContent.toLowerCase() === criteria.text.toLowerCase() ||
            label.toLowerCase() === criteria.text.toLowerCase()) {
          maxScore = 1.0;
          matchReasons.push('exact text match');
          scores.text = 1.0;
        } else if (criteria.fuzzy !== false) {
          // Fuzzy match
          const textResult = fuzzyMatch(criteria.text, textContent, { threshold });
          const labelResult = fuzzyMatch(criteria.text, label, { threshold });
          const bestResult = textResult.similarity > labelResult.similarity ? textResult : labelResult;

          if (bestResult.isMatch) {
            scores.text = bestResult.similarity;
            if (bestResult.similarity > maxScore) {
              maxScore = bestResult.similarity;
              matchReasons.push(`text similarity: ${(bestResult.similarity * 100).toFixed(0)}%`);
            }
          }
        }
      }

      // Text contains
      if (criteria.textContains) {
        if (textContent.toLowerCase().includes(criteria.textContains.toLowerCase()) ||
            label.toLowerCase().includes(criteria.textContains.toLowerCase())) {
          const containsScore = 0.85;
          scores.text = Math.max(scores.text ?? 0, containsScore);
          if (containsScore > maxScore) {
            maxScore = containsScore;
            matchReasons.push('text contains');
          }
        }
      }

      // Accessible name matching
      if (criteria.accessibleName) {
        const ariaLabel = element.element.getAttribute('aria-label') || '';
        const accessibleName = ariaLabel || label || textContent;

        if (accessibleName.toLowerCase() === criteria.accessibleName.toLowerCase()) {
          scores.accessibility = 1.0;
          if (1.0 > maxScore) {
            maxScore = 1.0;
            matchReasons.push('accessible name match');
          }
        } else if (criteria.fuzzy !== false) {
          const result = fuzzyMatch(criteria.accessibleName, accessibleName, { threshold });
          if (result.isMatch) {
            scores.accessibility = result.similarity;
            if (result.similarity > maxScore) {
              maxScore = result.similarity;
              matchReasons.push(`accessible name similarity: ${(result.similarity * 100).toFixed(0)}%`);
            }
          }
        }
      }

      // Role matching
      if (criteria.role) {
        const role = element.element.getAttribute('role') || this.inferRole(element.type);
        if (role?.toLowerCase() === criteria.role.toLowerCase()) {
          scores.role = 1.0;
          if (1.0 > maxScore) {
            maxScore = 1.0;
            matchReasons.push(`role: ${criteria.role}`);
          }
        }
      }

      // Type matching
      if (criteria.type) {
        if (element.type === criteria.type) {
          const typeScore = 0.9;
          scores.role = Math.max(scores.role ?? 0, typeScore);
          if (typeScore > maxScore) {
            maxScore = typeScore;
            matchReasons.push(`type: ${criteria.type}`);
          }
        }
      }

      // Alias matching
      for (const alias of aliases) {
        const searchText = criteria.text || criteria.textContains || criteria.accessibleName;
        if (searchText) {
          if (alias.toLowerCase() === searchText.toLowerCase()) {
            scores.fuzzy = 1.0;
            if (1.0 > maxScore) {
              maxScore = 1.0;
              matchReasons.push(`alias: "${alias}"`);
            }
          } else if (criteria.fuzzy !== false) {
            const result = fuzzyMatch(searchText, alias, { threshold });
            if (result.isMatch && result.similarity > (scores.fuzzy ?? 0)) {
              scores.fuzzy = result.similarity;
              if (result.similarity > maxScore) {
                maxScore = result.similarity;
                matchReasons.push(`fuzzy alias: "${alias}"`);
              }
            }
          }
        }
      }

      // Add result if above threshold
      if (maxScore >= threshold) {
        const aiElement: AIDiscoveredElement = {
          id: element.id,
          type: element.type,
          label: element.label,
          tagName: element.element.tagName.toLowerCase(),
          role: element.element.getAttribute('role') || undefined,
          accessibleName: element.element.getAttribute('aria-label') || element.label,
          actions: element.actions,
          state,
          registered: true,
          description: element.description || generateDescription({
            textContent,
            ariaLabel: element.element.getAttribute('aria-label'),
            elementType: element.type,
            id: element.id,
            labelText: element.label,
          }),
          aliases,
          purpose: element.purpose,
          suggestedActions: [],
          semanticType: element.semanticType,
        };

        results.push({
          element: aiElement,
          confidence: maxScore,
          matchReasons,
          scores,
        });
      }
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    return results;
  }

  /**
   * Find element by visible text
   */
  findByText(text: string, fuzzy: boolean = true): RegisteredElement | undefined {
    const results = this.searchElements({ text, fuzzy, fuzzyThreshold: fuzzy ? 0.7 : 1.0 });
    if (results.length > 0) {
      return this.elements.get(results[0].element.id);
    }
    return undefined;
  }

  /**
   * Find element by accessible name
   */
  findByAccessibleName(name: string): RegisteredElement | undefined {
    const results = this.searchElements({ accessibleName: name, fuzzy: true });
    if (results.length > 0) {
      return this.elements.get(results[0].element.id);
    }
    return undefined;
  }

  /**
   * Generate aliases for an element
   */
  private generateElementAliases(element: RegisteredElement): string[] {
    const state = element.getState();
    return generateAliases({
      textContent: state.textContent,
      ariaLabel: element.element.getAttribute('aria-label'),
      placeholder: element.element.getAttribute('placeholder'),
      title: element.element.getAttribute('title'),
      elementType: element.type,
      tagName: element.element.tagName.toLowerCase(),
      id: element.id,
      labelText: element.label,
    });
  }

  /**
   * Infer ARIA role from element type
   */
  private inferRole(type: ElementType): string | undefined {
    const roleMap: Record<ElementType, string | undefined> = {
      button: 'button',
      input: 'textbox',
      select: 'combobox',
      checkbox: 'checkbox',
      radio: 'radio',
      link: 'link',
      form: undefined,
      textarea: 'textbox',
      menu: 'menu',
      menuitem: 'menuitem',
      tab: 'tab',
      dialog: 'dialog',
      custom: undefined,
      switch: 'switch',
      slider: 'slider',
      combobox: 'combobox',
      listbox: 'listbox',
      option: 'option',
      textbox: 'textbox',
      generic: undefined,
    };
    return roleMap[type];
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
      getState?: StateGetter<Record<string, unknown>>;
      getComputed?: () => Record<string, unknown>;
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
      getState: options.getState,
      getComputed: options.getComputed,
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
   * Get the current state and computed properties of a component
   */
  getComponentState(id: string): ComponentStateResponse | null {
    const component = this.components.get(id);
    if (!component || !component.mounted) {
      return null;
    }

    return {
      state: component.getState?.() ?? {},
      computed: component.getComputed?.() ?? {},
      timestamp: Date.now(),
    };
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

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Register a state
   */
  registerState(state: UIState): UIState {
    this.states.set(state.id, state);
    this.emit('element:registered', { id: state.id, type: 'state', name: state.name });
    return state;
  }

  /**
   * Unregister a state
   */
  unregisterState(id: string): boolean {
    const state = this.states.get(id);
    if (state) {
      this.activeStates.delete(id);
      this.states.delete(id);
      this.emit('element:unregistered', { id, type: 'state' });
      return true;
    }
    return false;
  }

  /**
   * Get a registered state
   */
  getState(id: string): UIState | undefined {
    return this.states.get(id);
  }

  /**
   * Get all registered states
   */
  getAllStates(): UIState[] {
    return Array.from(this.states.values());
  }

  /**
   * Register a state group
   */
  registerStateGroup(group: UIStateGroup): UIStateGroup {
    this.stateGroups.set(group.id, group);
    return group;
  }

  /**
   * Unregister a state group
   */
  unregisterStateGroup(id: string): boolean {
    return this.stateGroups.delete(id);
  }

  /**
   * Get a state group
   */
  getStateGroup(id: string): UIStateGroup | undefined {
    return this.stateGroups.get(id);
  }

  /**
   * Get all state groups
   */
  getAllStateGroups(): UIStateGroup[] {
    return Array.from(this.stateGroups.values());
  }

  /**
   * Register a transition
   */
  registerTransition(transition: UITransition): UITransition {
    this.transitions.set(transition.id, transition);
    return transition;
  }

  /**
   * Unregister a transition
   */
  unregisterTransition(id: string): boolean {
    return this.transitions.delete(id);
  }

  /**
   * Get a transition
   */
  getTransition(id: string): UITransition | undefined {
    return this.transitions.get(id);
  }

  /**
   * Get all transitions
   */
  getAllTransitions(): UITransition[] {
    return Array.from(this.transitions.values());
  }

  /**
   * Get currently active states
   */
  getActiveStates(): string[] {
    return Array.from(this.activeStates);
  }

  /**
   * Check if a state is active
   */
  isStateActive(id: string): boolean {
    return this.activeStates.has(id);
  }

  /**
   * Activate a state
   */
  activateState(id: string): boolean {
    const state = this.states.get(id);
    if (!state) {
      return false;
    }

    // Check if blocked by another state
    for (const activeId of this.activeStates) {
      const activeState = this.states.get(activeId);
      if (activeState?.blocking && activeState.id !== id) {
        // Blocked by a modal/blocking state
        return false;
      }
      if (activeState?.blocks?.includes(id)) {
        // Specifically blocked by this state
        return false;
      }
    }

    const wasActive = this.activeStates.has(id);
    this.activeStates.add(id);

    if (!wasActive) {
      this.emit('element:stateChanged', {
        stateId: id,
        active: true,
        activeStates: this.getActiveStates(),
      });
    }

    return true;
  }

  /**
   * Deactivate a state
   */
  deactivateState(id: string): boolean {
    const wasActive = this.activeStates.has(id);
    this.activeStates.delete(id);

    if (wasActive) {
      this.emit('element:stateChanged', {
        stateId: id,
        active: false,
        activeStates: this.getActiveStates(),
      });
    }

    return wasActive;
  }

  /**
   * Activate multiple states
   */
  activateStates(ids: string[]): string[] {
    const activated: string[] = [];
    for (const id of ids) {
      if (this.activateState(id)) {
        activated.push(id);
      }
    }
    return activated;
  }

  /**
   * Deactivate multiple states
   */
  deactivateStates(ids: string[]): string[] {
    const deactivated: string[] = [];
    for (const id of ids) {
      if (this.deactivateState(id)) {
        deactivated.push(id);
      }
    }
    return deactivated;
  }

  /**
   * Activate a state group (all states in the group)
   */
  activateStateGroup(groupId: string): string[] {
    const group = this.stateGroups.get(groupId);
    if (!group) return [];
    return this.activateStates(group.states);
  }

  /**
   * Deactivate a state group (all states in the group)
   */
  deactivateStateGroup(groupId: string): string[] {
    const group = this.stateGroups.get(groupId);
    if (!group) return [];
    return this.deactivateStates(group.states);
  }

  /**
   * Check if a transition can be executed from current state
   */
  canExecuteTransition(transitionId: string): boolean {
    const transition = this.transitions.get(transitionId);
    if (!transition) return false;

    // At least one fromState must be active
    return transition.fromStates.some((stateId) => this.activeStates.has(stateId));
  }

  /**
   * Execute a transition
   */
  async executeTransition(transitionId: string): Promise<TransitionResult> {
    const startTime = performance.now();
    const transition = this.transitions.get(transitionId);

    if (!transition) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: `Transition not found: ${transitionId}`,
        durationMs: performance.now() - startTime,
      };
    }

    if (!this.canExecuteTransition(transitionId)) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: 'Precondition not met: none of the fromStates are active',
        failedPhase: 'precondition',
        durationMs: performance.now() - startTime,
      };
    }

    try {
      // Phase 1: Deactivate exit states
      const deactivated = this.deactivateStates(transition.exitStates);

      // Phase 2: Deactivate exit groups
      if (transition.exitGroups) {
        for (const groupId of transition.exitGroups) {
          deactivated.push(...this.deactivateStateGroup(groupId));
        }
      }

      // Phase 3: Execute actions (if any)
      // Note: Actual action execution happens in the workflow engine
      // Here we just track that the transition occurred

      // Phase 4: Activate states
      const activated = this.activateStates(transition.activateStates);

      // Phase 5: Activate groups
      if (transition.activateGroups) {
        for (const groupId of transition.activateGroups) {
          activated.push(...this.activateStateGroup(groupId));
        }
      }

      return {
        success: true,
        activatedStates: activated,
        deactivatedStates: deactivated,
        durationMs: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: error instanceof Error ? error.message : String(error),
        failedPhase: 'execution',
        durationMs: performance.now() - startTime,
      };
    }
  }

  /**
   * Find a path from current state to target states
   *
   * Uses a simple BFS algorithm for pathfinding.
   * For more advanced pathfinding (Dijkstra, A*), use the Python state manager service.
   */
  findPath(targetStates: string[]): PathResult {
    // Check if already at target
    if (targetStates.every((t) => this.activeStates.has(t))) {
      return {
        found: true,
        transitions: [],
        totalCost: 0,
        targetStates,
        estimatedSteps: 0,
      };
    }

    // BFS to find path
    const queue: { activeStates: Set<string>; path: string[]; cost: number }[] = [
      { activeStates: new Set(this.activeStates), path: [], cost: 0 },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const stateKey = Array.from(current.activeStates).sort().join(',');

      if (visited.has(stateKey)) continue;
      visited.add(stateKey);

      // Check if target reached
      if (targetStates.every((t) => current.activeStates.has(t))) {
        return {
          found: true,
          transitions: current.path,
          totalCost: current.cost,
          targetStates,
          estimatedSteps: current.path.length,
        };
      }

      // Try each transition
      for (const transition of this.transitions.values()) {
        // Check if transition can be executed from current state
        const canExecute = transition.fromStates.some((s) => current.activeStates.has(s));
        if (!canExecute) continue;

        // Calculate new state after transition
        const newActive = new Set(current.activeStates);
        for (const s of transition.exitStates) newActive.delete(s);
        for (const s of transition.activateStates) newActive.add(s);

        const newCost = current.cost + (transition.pathCost ?? 1);

        queue.push({
          activeStates: newActive,
          path: [...current.path, transition.id],
          cost: newCost,
        });
      }
    }

    return {
      found: false,
      transitions: [],
      totalCost: 0,
      targetStates,
      estimatedSteps: 0,
    };
  }

  /**
   * Navigate to target states using pathfinding
   */
  async navigateTo(targetStates: string[]): Promise<NavigationResult> {
    const startTime = performance.now();
    const path = this.findPath(targetStates);

    if (!path.found) {
      return {
        success: false,
        path,
        executedTransitions: [],
        finalActiveStates: this.getActiveStates(),
        error: `No path found to target states: ${targetStates.join(', ')}`,
        durationMs: performance.now() - startTime,
      };
    }

    const executedTransitions: string[] = [];

    for (const transitionId of path.transitions) {
      const result = await this.executeTransition(transitionId);
      if (!result.success) {
        return {
          success: false,
          path,
          executedTransitions,
          finalActiveStates: this.getActiveStates(),
          error: result.error,
          durationMs: performance.now() - startTime,
        };
      }
      executedTransitions.push(transitionId);
    }

    return {
      success: true,
      path,
      executedTransitions,
      finalActiveStates: this.getActiveStates(),
      durationMs: performance.now() - startTime,
    };
  }

  /**
   * Create a state snapshot
   */
  createStateSnapshot(): StateSnapshot {
    return {
      timestamp: Date.now(),
      activeStates: this.getActiveStates(),
      states: this.getAllStates(),
      groups: this.getAllStateGroups(),
      transitions: this.getAllTransitions(),
    };
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
    this.states.clear();
    this.stateGroups.clear();
    this.transitions.clear();
    this.activeStates.clear();
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
    stateCount: number;
    stateGroupCount: number;
    transitionCount: number;
    activeStateCount: number;
  } {
    const elements = this.getAllElements();
    const components = this.getAllComponents();

    return {
      elementCount: elements.length,
      componentCount: components.length,
      workflowCount: this.workflows.size,
      mountedElementCount: elements.filter((e) => e.mounted).length,
      mountedComponentCount: components.filter((c) => c.mounted).length,
      stateCount: this.states.size,
      stateGroupCount: this.stateGroups.size,
      transitionCount: this.transitions.size,
      activeStateCount: this.activeStates.size,
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
