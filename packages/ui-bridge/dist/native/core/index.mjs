// src/native/core/registry.ts
function inferActions(type) {
  const baseActions = ["focus", "blur"];
  switch (type) {
    case "button":
    case "touchable":
    case "pressable":
      return [...baseActions, "press", "longPress", "doubleTap"];
    case "input":
      return [...baseActions, "press", "type", "clear"];
    case "text":
      return [...baseActions, "press", "longPress"];
    case "view":
      return [...baseActions, "press"];
    case "scroll":
      return [...baseActions, "scroll", "swipe"];
    case "list":
      return [...baseActions, "scroll", "swipe"];
    case "listItem":
      return [...baseActions, "press", "longPress", "swipe"];
    case "switch":
    case "checkbox":
      return [...baseActions, "press", "toggle"];
    case "radio":
      return [...baseActions, "press"];
    case "image":
      return [...baseActions, "press", "longPress"];
    case "modal":
      return ["focus", "blur"];
    case "custom":
    default:
      return [...baseActions, "press"];
  }
}
var NativeUIBridgeRegistry = class {
  constructor(config = {}) {
    this.elements = /* @__PURE__ */ new Map();
    this.components = /* @__PURE__ */ new Map();
    this.workflows = /* @__PURE__ */ new Map();
    this.eventListeners = /* @__PURE__ */ new Map();
    this.config = config;
  }
  // ============================================================================
  // Element Management
  // ============================================================================
  /**
   * Register a native element
   */
  registerElement(id, ref, options = {}) {
    const {
      type = "custom",
      label,
      actions = inferActions(type),
      customActions,
      props,
      treePath = id,
      testId,
      accessibilityLabel
    } = options;
    const getState = () => {
      const element = ref.current;
      if (!element) {
        return {
          mounted: false,
          visible: false,
          enabled: false,
          focused: false,
          layout: null
        };
      }
      const stored = this.elements.get(id);
      if (stored && stored.getState !== getState) {
        return stored.getState();
      }
      return {
        mounted: true,
        visible: true,
        enabled: true,
        focused: false,
        layout: null
      };
    };
    const getIdentifier = () => ({
      uiId: id,
      testId: testId || id,
      accessibilityLabel,
      treePath
    });
    const registered = {
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
      mounted: true
    };
    this.elements.set(id, registered);
    this.emit("element:registered", { id, type, label });
    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered element: ${id} (${type})`);
    }
    return registered;
  }
  /**
   * Unregister an element
   */
  unregisterElement(id) {
    const element = this.elements.get(id);
    if (element) {
      this.elements.delete(id);
      this.emit("element:unregistered", { id });
      if (this.config.verbose) {
        console.log(`[ui-bridge-native] Unregistered element: ${id}`);
      }
    }
  }
  /**
   * Get a registered element
   */
  getElement(id) {
    return this.elements.get(id);
  }
  /**
   * Get all registered elements
   */
  getAllElements() {
    return Array.from(this.elements.values());
  }
  /**
   * Update element state
   */
  updateElementState(id, state) {
    const element = this.elements.get(id);
    if (element) {
      const currentState = element.getState();
      const newState = { ...currentState, ...state };
      const updated = {
        ...element,
        getState: () => newState
      };
      this.elements.set(id, updated);
      this.emit("element:stateChanged", { id, state: newState });
    }
  }
  /**
   * Update element props (for action execution)
   */
  updateElementProps(id, props) {
    const element = this.elements.get(id);
    if (element) {
      const updated = {
        ...element,
        props: { ...element.props, ...props }
      };
      this.elements.set(id, updated);
    }
  }
  /**
   * Update the live screen-absolute bounding box and visibility for a
   * registered element. Parity with the web registry's `updateElementBbox`.
   * Called by `useUIElement`'s `onLayout` handler.
   *
   * Intentionally does not emit `element:stateChanged` — onLayout can fire
   * on every scroll / rotation / keyboard-open, and event churn would cause
   * snapshot consumers to rebuild on every frame. Pass `undefined` for
   * both args to clear the fields.
   *
   * Returns `false` if the element is not registered.
   */
  updateElementBbox(id, bbox, visible) {
    const element = this.elements.get(id);
    if (!element) return false;
    const updated = {
      ...element,
      bbox,
      visible
    };
    this.elements.set(id, updated);
    return true;
  }
  /**
   * Find element by testID
   */
  findByTestId(testId) {
    for (const element of this.elements.values()) {
      const identifier = element.getIdentifier();
      if (identifier.testId === testId) {
        return element;
      }
    }
    return void 0;
  }
  /**
   * Find elements by type
   */
  findByType(type) {
    return Array.from(this.elements.values()).filter((e) => e.type === type);
  }
  // ============================================================================
  // Component Management
  // ============================================================================
  /**
   * Register a component
   */
  registerComponent(id, options) {
    const { name, description, actions = [], elementIds } = options;
    const registered = {
      id,
      name,
      description,
      actions: actions.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        handler: a.handler
      })),
      elementIds,
      registeredAt: Date.now(),
      mounted: true
    };
    this.components.set(id, registered);
    this.emit("component:registered", { id, name });
    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered component: ${id} (${name})`);
    }
    return registered;
  }
  /**
   * Unregister a component
   */
  unregisterComponent(id) {
    const component = this.components.get(id);
    if (component) {
      this.components.delete(id);
      this.emit("component:unregistered", { id });
      if (this.config.verbose) {
        console.log(`[ui-bridge-native] Unregistered component: ${id}`);
      }
    }
  }
  /**
   * Get a registered component
   */
  getComponent(id) {
    return this.components.get(id);
  }
  /**
   * Get all registered components
   */
  getAllComponents() {
    return Array.from(this.components.values());
  }
  // ============================================================================
  // Workflow Management
  // ============================================================================
  /**
   * Register a workflow
   */
  registerWorkflow(workflow) {
    this.workflows.set(workflow.id, workflow);
    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registered workflow: ${workflow.id}`);
    }
  }
  /**
   * Unregister a workflow
   */
  unregisterWorkflow(id) {
    this.workflows.delete(id);
  }
  /**
   * Get a workflow
   */
  getWorkflow(id) {
    return this.workflows.get(id);
  }
  /**
   * Get all workflows
   */
  getAllWorkflows() {
    return Array.from(this.workflows.values());
  }
  // ============================================================================
  // Event System
  // ============================================================================
  /**
   * Subscribe to events
   */
  on(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, /* @__PURE__ */ new Set());
    }
    this.eventListeners.get(type).add(listener);
    return () => this.off(type, listener);
  }
  /**
   * Unsubscribe from events
   */
  off(type, listener) {
    this.eventListeners.get(type)?.delete(listener);
  }
  /**
   * Emit an event
   */
  emit(type, data) {
    const event = {
      type,
      timestamp: Date.now(),
      data
    };
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
  createSnapshot() {
    const allElements = this.getAllElements();
    let totalInteractiveInDOM = 0;
    try {
      totalInteractiveInDOM = document.querySelectorAll(
        'button, input, select, textarea, a[href], [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [role="menuitem"]'
      ).length;
    } catch {
    }
    return {
      timestamp: Date.now(),
      elements: allElements.map((e) => ({
        id: e.id,
        type: e.type,
        label: e.label,
        identifier: e.getIdentifier(),
        state: e.getState(),
        actions: e.actions,
        customActions: e.customActions ? Object.keys(e.customActions) : void 0,
        // Live bbox/visibility maintained by `useUIElement`'s onLayout.
        // Parity with the web snapshot so runners can dispatch taps by
        // coords without VLM grounding for SDK-registered elements.
        bbox: e.bbox,
        visible: e.visible
      })),
      // Diagnostic: how many interactive DOM elements exist vs how many
      // the registry captured. A large gap (e.g., 30 registered out of
      // 120 in DOM) signals the auto-register missed elements.
      registeredCount: allElements.length,
      totalInteractiveInDOM,
      components: this.getAllComponents().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        actions: c.actions.map((a) => a.id),
        elementIds: c.elementIds
      })),
      workflows: this.getAllWorkflows().map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        stepCount: w.steps.length
      }))
    };
  }
  /**
   * Get registry statistics
   */
  getStats() {
    return {
      elements: this.elements.size,
      components: this.components.size,
      workflows: this.workflows.size
    };
  }
  /**
   * Clear all registrations
   */
  clear() {
    this.elements.clear();
    this.components.clear();
    this.workflows.clear();
    if (this.config.verbose) {
      console.log(`[ui-bridge-native] Registry cleared`);
    }
  }
};
var globalRegistry = null;
function setGlobalRegistry(registry) {
  globalRegistry = registry;
}
function getGlobalRegistry() {
  return globalRegistry;
}
function resetGlobalRegistry() {
  globalRegistry?.clear();
  globalRegistry = null;
}

// src/native/core/element-identifier.ts
function createNativeElementIdentifier(id, options = {}) {
  return {
    uiId: id,
    testId: options.testId || id,
    accessibilityLabel: options.accessibilityLabel,
    accessibilityHint: options.accessibilityHint,
    treePath: options.treePath || id
  };
}
function findElementByIdentifier(identifier) {
  const registry = getGlobalRegistry();
  if (!registry) return null;
  if (typeof identifier === "string") {
    const byId = registry.getElement(identifier);
    if (byId) return byId;
    const byTestId = registry.findByTestId(identifier);
    if (byTestId) return byTestId;
    return findByPattern(registry, identifier);
  }
  if (identifier.uiId) {
    const byId = registry.getElement(identifier.uiId);
    if (byId) return byId;
  }
  if (identifier.testId) {
    const byTestId = registry.findByTestId(identifier.testId);
    if (byTestId) return byTestId;
  }
  return null;
}
function findByPattern(registry, pattern) {
  if (!registry) return null;
  const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  const regex = new RegExp(`^${regexPattern}$`, "i");
  for (const element of registry.getAllElements()) {
    const identifier = element.getIdentifier();
    if (identifier.testId && regex.test(identifier.testId)) {
      return element;
    }
    if (identifier.uiId && regex.test(identifier.uiId)) {
      return element;
    }
    if (identifier.treePath && regex.test(identifier.treePath)) {
      return element;
    }
    if (identifier.accessibilityLabel && regex.test(identifier.accessibilityLabel)) {
      return element;
    }
  }
  return null;
}
function findAllByPattern(pattern) {
  const registry = getGlobalRegistry();
  if (!registry) return [];
  const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  const regex = new RegExp(`^${regexPattern}$`, "i");
  const results = [];
  for (const element of registry.getAllElements()) {
    const identifier = element.getIdentifier();
    if (identifier.testId && regex.test(identifier.testId) || identifier.uiId && regex.test(identifier.uiId) || identifier.treePath && regex.test(identifier.treePath) || identifier.accessibilityLabel && regex.test(identifier.accessibilityLabel)) {
      results.push(element);
    }
  }
  return results;
}
function buildTreePath(componentPath, elementIndex) {
  let path = componentPath.join("/");
  if (elementIndex !== void 0) {
    path += `[${elementIndex}]`;
  }
  return path;
}
function parseTreePath(treePath) {
  const indexMatch = treePath.match(/\[(\d+)\]$/);
  const index = indexMatch ? parseInt(indexMatch[1], 10) : void 0;
  const pathWithoutIndex = treePath.replace(/\[\d+\]$/, "");
  const components = pathWithoutIndex.split("/").filter(Boolean);
  return { components, index };
}
function matchesIdentifier(identifier, criteria) {
  if (criteria.uiId && identifier.uiId !== criteria.uiId) {
    return false;
  }
  if (criteria.testId && identifier.testId !== criteria.testId) {
    return false;
  }
  if (criteria.accessibilityLabel && identifier.accessibilityLabel !== criteria.accessibilityLabel) {
    return false;
  }
  if (criteria.treePath && identifier.treePath !== criteria.treePath) {
    return false;
  }
  return true;
}

export { NativeUIBridgeRegistry, buildTreePath, createNativeElementIdentifier, findAllByPattern, findElementByIdentifier, getGlobalRegistry, matchesIdentifier, parseTreePath, resetGlobalRegistry, setGlobalRegistry };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map