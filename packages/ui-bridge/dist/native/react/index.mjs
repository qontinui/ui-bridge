import { createContext, useRef, useState, useCallback, useEffect, useMemo, useContext } from 'react';
import { jsx } from 'react/jsx-runtime';

// src/native/react/UIBridgeNativeProvider.tsx

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

// src/native/control/action-executor.ts
var DEFAULT_WAIT_OPTIONS = {
  visible: true,
  enabled: true,
  focused: false,
  state: {},
  timeout: 1e4,
  interval: 100
};
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
var DefaultNativeActionExecutor = class {
  constructor(registry) {
    this.registry = registry;
  }
  /**
   * Execute an action on an element
   */
  async executeAction(elementId, request) {
    const startTime = Date.now();
    let waitDurationMs = 0;
    try {
      let registered = this.registry.getElement(elementId);
      if (!registered) {
        registered = findElementByIdentifier(elementId) ?? void 0;
      }
      if (!registered) {
        return {
          success: false,
          error: `Element not found: ${elementId}`,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId
        };
      }
      if (request.waitOptions) {
        const waitResult = await this.waitForElementInternal(registered.id, request.waitOptions);
        waitDurationMs = waitResult.waitedMs;
        if (!waitResult.met) {
          return {
            success: false,
            error: waitResult.error || "Wait condition not met",
            durationMs: Date.now() - startTime,
            timestamp: Date.now(),
            requestId: request.requestId,
            waitDurationMs
          };
        }
      }
      const result = await this.performAction(registered, request.action, request.params);
      return {
        success: true,
        elementState: registered.getState(),
        result,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
        waitDurationMs
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
        waitDurationMs
      };
    }
  }
  /**
   * Perform an action on an element
   */
  async performAction(element, action, params) {
    if (!element) {
      throw new Error("Element not found");
    }
    const props = element.props || {};
    if (element.customActions && action in element.customActions) {
      return element.customActions[action].handler(params);
    }
    switch (action) {
      case "press":
        return this.performPress(props, params);
      case "longPress":
        return this.performLongPress(props, params);
      case "doubleTap":
        return this.performDoubleTap(props);
      case "type":
        return this.performType(element, props, params);
      case "clear":
        return this.performClear(element, props);
      case "focus":
        return this.performFocus(element);
      case "blur":
        return this.performBlur(element);
      case "scroll":
        return this.performScroll(props, params);
      case "swipe":
        return this.performSwipe(props, params);
      case "toggle":
        return this.performToggle(props);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
  /**
   * Perform press action
   */
  async performPress(props, params) {
    const handlers = ["onPress", "onPressIn", "onResponderRelease"];
    for (const handler of handlers) {
      if (typeof props[handler] === "function") {
        const event = this.createPressEvent(params);
        props[handler](event);
        return;
      }
    }
    throw new Error("No press handler found on element");
  }
  /**
   * Perform long press action
   */
  async performLongPress(props, params) {
    if (typeof props.onLongPress === "function") {
      const event = this.createPressEvent(params);
      props.onLongPress(event);
      return;
    }
    throw new Error("No long press handler found on element");
  }
  /**
   * Perform double tap action
   */
  async performDoubleTap(props) {
    if (typeof props.onDoubleTap === "function") {
      props.onDoubleTap();
      return;
    }
    if (typeof props.onPress === "function") {
      const event = this.createPressEvent();
      props.onPress(event);
      await sleep(50);
      props.onPress(event);
      return;
    }
    throw new Error("No press handler found for double tap");
  }
  /**
   * Perform type action
   */
  async performType(element, props, params) {
    if (!params?.text) {
      throw new Error("Type action requires text parameter");
    }
    if (params.clearFirst) {
      await this.performClear(element, props);
    }
    if (params.delay && params.delay > 0) {
      const currentValue = element?.getState().value || "";
      for (const char of params.text) {
        const newValue = currentValue + char;
        if (typeof props.onChangeText === "function") {
          props.onChangeText(newValue);
        }
        await sleep(params.delay);
      }
    } else {
      if (typeof props.onChangeText === "function") {
        props.onChangeText(params.text);
      } else if (typeof props.onChange === "function") {
        props.onChange({
          nativeEvent: { text: params.text }
        });
      } else {
        throw new Error("No text change handler found on element");
      }
    }
    if (element) {
      this.registry.updateElementState(element.id, { value: params.text });
    }
  }
  /**
   * Perform clear action
   */
  async performClear(element, props) {
    if (typeof props.onChangeText === "function") {
      props.onChangeText("");
    } else if (typeof props.onChange === "function") {
      props.onChange({
        nativeEvent: { text: "" }
      });
    }
    if (element) {
      this.registry.updateElementState(element.id, { value: "" });
    }
  }
  /**
   * Perform focus action
   */
  async performFocus(element) {
    if (element?.ref.current && "focus" in element.ref.current) {
      element.ref.current.focus();
    }
    if (element) {
      this.registry.updateElementState(element.id, { focused: true });
    }
  }
  /**
   * Perform blur action
   */
  async performBlur(element) {
    if (element?.ref.current && "blur" in element.ref.current) {
      element.ref.current.blur();
    }
    if (element) {
      this.registry.updateElementState(element.id, { focused: false });
    }
  }
  /**
   * Perform scroll action
   */
  async performScroll(props, params) {
    if (typeof props.onScroll === "function") {
      const event = {
        nativeEvent: {
          contentOffset: params?.offset || { x: 0, y: 0 }
        }
      };
      props.onScroll(event);
    }
  }
  /**
   * Perform swipe action
   */
  async performSwipe(props, params) {
    if (!params?.direction) {
      throw new Error("Swipe action requires direction parameter");
    }
    const handlerMap = {
      left: "onSwipeLeft",
      right: "onSwipeRight",
      up: "onSwipeUp",
      down: "onSwipeDown"
    };
    const handler = handlerMap[params.direction];
    if (handler && typeof props[handler] === "function") {
      props[handler]();
      return;
    }
    if (typeof props.onSwipe === "function") {
      props.onSwipe(params.direction);
    }
  }
  /**
   * Perform toggle action
   */
  async performToggle(props) {
    if (typeof props.onValueChange === "function") {
      const currentValue = props.value;
      props.onValueChange(!currentValue);
      return;
    }
    if (typeof props.onPress === "function") {
      props.onPress();
      return;
    }
    throw new Error("No toggle handler found on element");
  }
  /**
   * Create a synthetic press event
   */
  createPressEvent(params) {
    return {
      nativeEvent: {
        locationX: params?.position?.x ?? 0,
        locationY: params?.position?.y ?? 0,
        timestamp: Date.now()
      },
      persist: () => {
      }
    };
  }
  /**
   * Execute a component action
   */
  async executeComponentAction(componentId, request) {
    const startTime = Date.now();
    try {
      const component = this.registry.getComponent(componentId);
      if (!component) {
        return {
          success: false,
          error: `Component not found: ${componentId}`,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId
        };
      }
      const action = component.actions.find((a) => a.id === request.action);
      if (!action) {
        return {
          success: false,
          error: `Action not found: ${request.action}`,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId
        };
      }
      const result = await action.handler(request.params);
      return {
        success: true,
        result,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId
      };
    }
  }
  /**
   * Find elements
   */
  async find(request) {
    const startTime = Date.now();
    const allElements = this.registry.getAllElements();
    let filtered = allElements;
    if (request.types && request.types.length > 0) {
      filtered = filtered.filter((e) => request.types.includes(e.type));
    }
    if (request.testIdPattern) {
      const regex = new RegExp(request.testIdPattern.replace(/\*/g, ".*").replace(/\?/g, "."));
      filtered = filtered.filter((e) => {
        const identifier = e.getIdentifier();
        return identifier.testId && regex.test(identifier.testId);
      });
    }
    if (request.accessibilityLabelPattern) {
      const regex = new RegExp(
        request.accessibilityLabelPattern.replace(/\*/g, ".*").replace(/\?/g, ".")
      );
      filtered = filtered.filter((e) => {
        const identifier = e.getIdentifier();
        return identifier.accessibilityLabel && regex.test(identifier.accessibilityLabel);
      });
    }
    if (request.visibleOnly) {
      filtered = filtered.filter((e) => e.getState().visible);
    }
    if (request.limit && request.limit > 0) {
      filtered = filtered.slice(0, request.limit);
    }
    const elements = filtered.map((e) => ({
      id: e.id,
      type: e.type,
      identifier: e.getIdentifier(),
      state: e.getState(),
      actions: e.actions,
      label: e.label
    }));
    return {
      elements,
      total: elements.length,
      durationMs: Date.now() - startTime,
      timestamp: Date.now()
    };
  }
  /**
   * Wait for element conditions
   */
  async waitForElement(elementId, options) {
    return this.waitForElementInternal(elementId, options);
  }
  /**
   * Internal wait implementation
   */
  async waitForElementInternal(elementId, options) {
    const opts = { ...DEFAULT_WAIT_OPTIONS, ...options };
    const startTime = Date.now();
    while (Date.now() - startTime < opts.timeout) {
      const element = this.registry.getElement(elementId);
      if (!element) {
        await sleep(opts.interval);
        continue;
      }
      const state = element.getState();
      let conditionsMet = true;
      if (opts.visible && !state.visible) {
        conditionsMet = false;
      }
      if (opts.enabled && !state.enabled) {
        conditionsMet = false;
      }
      if (opts.focused && !state.focused) {
        conditionsMet = false;
      }
      if (opts.state && Object.keys(opts.state).length > 0) {
        const stateRecord = state;
        for (const [key, value] of Object.entries(opts.state)) {
          if (stateRecord[key] !== value) {
            conditionsMet = false;
            break;
          }
        }
      }
      if (conditionsMet) {
        return {
          met: true,
          waitedMs: Date.now() - startTime,
          state
        };
      }
      await sleep(opts.interval);
    }
    return {
      met: false,
      waitedMs: Date.now() - startTime,
      error: `Timeout waiting for conditions on element: ${elementId}`
    };
  }
};
function createNativeActionExecutor(registry) {
  return new DefaultNativeActionExecutor(registry);
}
var UIBridgeNativeContext = createContext(null);
var EMPTY_FEATURES = {};
var EMPTY_CONFIG = {};
function UIBridgeNativeProvider({
  children,
  features = EMPTY_FEATURES,
  config = EMPTY_CONFIG,
  onEvent
}) {
  const registryRef = useRef(null);
  const executorRef = useRef(null);
  const [serverRunning, setServerRunning] = useState(false);
  if (!registryRef.current) {
    registryRef.current = new NativeUIBridgeRegistry({
      verbose: config.verbose,
      onEvent
    });
    setGlobalRegistry(registryRef.current);
  }
  const registry = registryRef.current;
  if (!executorRef.current) {
    executorRef.current = createNativeActionExecutor(registry);
  }
  const executor = executorRef.current;
  const startServer = useCallback(async () => {
    if (!features.server) {
      console.warn("[ui-bridge-native] Server feature not enabled");
      return;
    }
    console.warn(
      `[ui-bridge-native] HTTP server not available: requires a React Native HTTP server library (e.g., react-native-http-bridge). Server would listen on port ${config.serverPort || 9876}.`
    );
  }, [features.server, config.serverPort]);
  const stopServer = useCallback(() => {
    console.warn(
      "[ui-bridge-native] HTTP server stop is a no-op: no React Native HTTP server library installed."
    );
    setServerRunning(false);
  }, []);
  useEffect(() => {
    if (features.server) {
      startServer();
      return () => stopServer();
    }
  }, [features.server, startServer, stopServer]);
  useEffect(() => {
    return () => {
      stopServer();
      resetGlobalRegistry();
    };
  }, [stopServer]);
  const getElements = useCallback(() => registry.getAllElements(), [registry]);
  const getComponents = useCallback(() => registry.getAllComponents(), [registry]);
  const createSnapshot = useCallback(() => registry.createSnapshot(), [registry]);
  const on = useCallback(
    (type, listener) => registry.on(type, listener),
    [registry]
  );
  const off = useCallback(
    (type, listener) => registry.off(type, listener),
    [registry]
  );
  const contextValue = useMemo(
    () => ({
      features,
      config,
      registry,
      executor,
      getElements,
      getComponents,
      createSnapshot,
      on,
      off,
      initialized: true,
      serverRunning,
      startServer,
      stopServer
    }),
    [
      features,
      config,
      registry,
      executor,
      getElements,
      getComponents,
      createSnapshot,
      on,
      off,
      serverRunning,
      startServer,
      stopServer
    ]
  );
  return /* @__PURE__ */ jsx(UIBridgeNativeContext.Provider, { value: contextValue, children });
}
function useUIBridgeNative() {
  const context = useContext(UIBridgeNativeContext);
  if (!context) {
    throw new Error("useUIBridgeNative must be used within a UIBridgeNativeProvider");
  }
  return context;
}
function useUIBridgeNativeOptional() {
  return useContext(UIBridgeNativeContext);
}
var useUIBridgeNativeRequired = useUIBridgeNative;
function useUIElement(options) {
  const bridge = useUIBridgeNativeOptional();
  const ref = useRef(null);
  const [registered, setRegistered] = useState(false);
  const [_layout, setLayout] = useState(null);
  const propsRef = useRef({});
  const {
    id,
    type = "custom",
    label,
    actions,
    customActions,
    autoRegister = true,
    onStateChange,
    parentPath
  } = options;
  const treePath = parentPath ? `${parentPath}/${id}` : id;
  const bridgeProps = useMemo(
    () => ({
      testID: id,
      accessibilityLabel: label
    }),
    [id, label]
  );
  const register = useCallback(() => {
    if (!bridge || registered) return;
    bridge.registry.registerElement(id, ref, {
      type,
      label,
      actions,
      customActions,
      treePath,
      testId: id,
      accessibilityLabel: label
    });
    setRegistered(true);
  }, [bridge, registered, id, type, label, actions, customActions, treePath]);
  const unregister = useCallback(() => {
    if (!bridge || !registered) return;
    bridge.registry.unregisterElement(id);
    setRegistered(false);
  }, [bridge, registered, id]);
  const onLayout = useCallback(
    (event) => {
      const { x, y, width, height } = event.nativeEvent.layout;
      const commit = (newLayout) => {
        setLayout(newLayout);
        if (!bridge || !registered) return;
        const newState = {
          mounted: true,
          visible: width > 0 && height > 0,
          enabled: true,
          focused: false,
          layout: newLayout
        };
        bridge.registry.updateElementState(id, newState);
        const bbox = {
          x: newLayout.pageX,
          y: newLayout.pageY,
          width,
          height
        };
        bridge.registry.updateElementBbox(id, bbox, width > 0 && height > 0);
        onStateChange?.(newState);
      };
      if (ref.current && "measureInWindow" in ref.current) {
        ref.current.measureInWindow((pageX, pageY) => {
          commit({ x, y, width, height, pageX, pageY });
        });
      } else {
        commit({ x, y, width, height, pageX: x, pageY: y });
      }
    },
    [bridge, registered, id, onStateChange]
  );
  useEffect(() => {
    if (autoRegister) {
      register();
    }
    return () => {
      unregister();
    };
  }, [autoRegister, register, unregister]);
  useCallback(
    (props) => {
      propsRef.current = { ...propsRef.current, ...props };
      if (bridge && registered) {
        bridge.registry.updateElementProps(id, props);
      }
    },
    [bridge, registered, id]
  );
  const getState = useCallback(() => {
    if (!bridge) return null;
    const element = bridge.registry.getElement(id);
    return element?.getState() || null;
  }, [bridge, id]);
  const getIdentifier = useCallback(() => {
    if (!bridge) return null;
    const element = bridge.registry.getElement(id);
    return element?.getIdentifier() || null;
  }, [bridge, id]);
  const trigger = useCallback(
    async (action, params) => {
      if (!bridge) {
        throw new Error("UI Bridge Native not available");
      }
      const response = await bridge.executor.executeAction(id, {
        action,
        params
      });
      if (!response.success) {
        throw new Error(response.error || "Action failed");
      }
    },
    [bridge, id]
  );
  const registeredElement = useMemo(() => {
    if (!bridge) return null;
    return bridge.registry.getElement(id) || null;
  }, [bridge, id, registered]);
  return {
    ref,
    onLayout,
    bridgeProps,
    registered,
    getState,
    getIdentifier,
    trigger,
    register,
    unregister,
    registeredElement
  };
}
function useUIElementWithProps(options) {
  const elementReturn = useUIElement(options);
  const bridge = useUIBridgeNativeOptional();
  const captureProps = useCallback(
    (props) => {
      if (bridge && elementReturn.registered) {
        bridge.registry.updateElementProps(options.id, props);
      }
    },
    [bridge, elementReturn.registered, options.id]
  );
  return {
    ...elementReturn,
    captureProps
  };
}
function useUIComponent(options) {
  const bridge = useUIBridgeNativeOptional();
  const registeredRef = useRef(false);
  const actionsRef = useRef(options.actions || []);
  const elementIdsRef = useRef(options.elementIds || []);
  const { id, name, description, autoRegister = true } = options;
  useEffect(() => {
    actionsRef.current = options.actions || [];
    elementIdsRef.current = options.elementIds || [];
  }, [options.actions, options.elementIds]);
  const register = useCallback(() => {
    if (!bridge || registeredRef.current) return;
    bridge.registry.registerComponent(id, {
      name,
      description,
      actions: actionsRef.current.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        handler: a.handler
      })),
      elementIds: elementIdsRef.current
    });
    registeredRef.current = true;
  }, [bridge, id, name, description]);
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;
    bridge.registry.unregisterComponent(id);
    registeredRef.current = false;
  }, [bridge, id]);
  const executeAction = useCallback(
    async (actionId, params) => {
      if (!bridge) {
        throw new Error("UI Bridge Native not available");
      }
      const response = await bridge.executor.executeComponentAction(id, {
        action: actionId,
        params
      });
      if (!response.success) {
        throw new Error(response.error || "Action failed");
      }
      return response.result;
    },
    [bridge, id]
  );
  const updateActions = useCallback(
    (actions) => {
      actionsRef.current = actions;
      if (registeredRef.current && bridge) {
        bridge.registry.unregisterComponent(id);
        registeredRef.current = false;
        register();
      }
    },
    [bridge, id, register]
  );
  const addElement = useCallback((elementId) => {
    if (!elementIdsRef.current.includes(elementId)) {
      elementIdsRef.current = [...elementIdsRef.current, elementId];
    }
  }, []);
  const removeElement = useCallback((elementId) => {
    elementIdsRef.current = elementIdsRef.current.filter((eid) => eid !== elementId);
  }, []);
  useEffect(() => {
    if (autoRegister) {
      register();
    }
    return () => {
      unregister();
    };
  }, [autoRegister, register, unregister]);
  const registeredComponent = useMemo(() => {
    if (!bridge) return null;
    return bridge.registry.getComponent(id) || null;
  }, [bridge, id, registeredRef.current]);
  return {
    registered: registeredRef.current,
    executeAction,
    register,
    unregister,
    updateActions,
    addElement,
    removeElement,
    registeredComponent
  };
}
function useUIComponentAction(handler, deps) {
  return useCallback(handler, deps);
}
function useUIBridge() {
  const bridge = useUIBridgeNativeOptional();
  const available = bridge !== null;
  const initialized = bridge?.initialized ?? false;
  const elements = useMemo(() => bridge ? bridge.getElements() : [], [bridge]);
  const components = useMemo(() => bridge ? bridge.getComponents() : [], [bridge]);
  const workflows = useMemo(() => bridge ? bridge.registry.getAllWorkflows() : [], [bridge]);
  const createSnapshot = useCallback(() => {
    if (!bridge) {
      return {
        timestamp: Date.now(),
        elements: [],
        components: [],
        workflows: []
      };
    }
    return bridge.createSnapshot();
  }, [bridge]);
  const executeAction = useCallback(
    async (elementId, request) => {
      if (!bridge) {
        return {
          success: false,
          error: "UI Bridge not available",
          durationMs: 0,
          timestamp: Date.now()
        };
      }
      return bridge.executor.executeAction(elementId, request);
    },
    [bridge]
  );
  const executeComponentAction = useCallback(
    async (componentId, request) => {
      if (!bridge) {
        return {
          success: false,
          error: "UI Bridge not available",
          durationMs: 0,
          timestamp: Date.now()
        };
      }
      return bridge.executor.executeComponentAction(componentId, request);
    },
    [bridge]
  );
  const find = useCallback(
    async (request) => {
      if (!bridge) {
        return {
          elements: [],
          total: 0,
          durationMs: 0,
          timestamp: Date.now()
        };
      }
      return bridge.executor.find(request || {});
    },
    [bridge]
  );
  const getElement = useCallback((id) => bridge?.registry.getElement(id), [bridge]);
  const getComponent = useCallback((id) => bridge?.registry.getComponent(id), [bridge]);
  const getElementState = useCallback(
    (id) => {
      const element = bridge?.registry.getElement(id);
      return element?.getState() ?? null;
    },
    [bridge]
  );
  const registerWorkflow = useCallback(
    (workflow) => {
      bridge?.registry.registerWorkflow(workflow);
    },
    [bridge]
  );
  const unregisterWorkflow = useCallback(
    (id) => {
      bridge?.registry.unregisterWorkflow(id);
    },
    [bridge]
  );
  return {
    available,
    initialized,
    elements,
    components,
    workflows,
    createSnapshot,
    executeAction,
    executeComponentAction,
    find,
    getElement,
    getComponent,
    getElementState,
    registerWorkflow,
    unregisterWorkflow
  };
}
function useUIBridgeRequired() {
  const result = useUIBridge();
  if (!result.available) {
    throw new Error("useUIBridgeRequired must be used within a UIBridgeNativeProvider");
  }
  return result;
}
function useAutoRegister(options = {}) {
  const { enabled = false, onRegister, onUnregister } = options;
  const bridge = useUIBridgeNativeOptional();
  const registeredIdsRef = useRef(/* @__PURE__ */ new Set());
  const register = useCallback(
    (id, ref, elementOptions) => {
      if (!enabled || !bridge?.registry) return;
      if (registeredIdsRef.current.has(id)) return;
      bridge.registry.registerElement(id, ref, elementOptions);
      registeredIdsRef.current.add(id);
      onRegister?.(id);
    },
    [enabled, bridge, onRegister]
  );
  const unregister = useCallback(
    (id) => {
      if (!bridge?.registry) return;
      bridge.registry.unregisterElement(id);
      registeredIdsRef.current.delete(id);
      onUnregister?.(id);
    },
    [bridge, onUnregister]
  );
  useEffect(() => {
    return () => {
      registeredIdsRef.current.forEach((id) => {
        bridge?.registry.unregisterElement(id);
      });
      registeredIdsRef.current.clear();
    };
  }, [bridge]);
  return {
    register,
    unregister,
    isEnabled: enabled && !!bridge?.registry
  };
}

export { UIBridgeNativeProvider, useAutoRegister, useUIBridge, useUIBridgeNative, useUIBridgeNativeOptional, useUIBridgeNativeRequired, useUIBridgeRequired, useUIComponent, useUIComponentAction, useUIElement, useUIElementWithProps };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map