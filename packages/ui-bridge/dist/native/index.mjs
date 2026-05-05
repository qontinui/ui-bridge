import { createContext, useRef, useState, useCallback, useEffect, useMemo, use } from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { Dimensions, StyleSheet, TouchableOpacity, Text, Modal, View, ScrollView } from 'react-native';

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
        } catch (error2) {
          console.error(`[ui-bridge-native] Event listener error:`, error2);
        }
      }
    }
    if (this.config.onEvent) {
      try {
        this.config.onEvent(event);
      } catch (error2) {
        console.error(`[ui-bridge-native] Global event handler error:`, error2);
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
    } catch (error2) {
      return {
        success: false,
        error: error2 instanceof Error ? error2.message : String(error2),
        stack: error2 instanceof Error ? error2.stack : void 0,
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
    } catch (error2) {
      return {
        success: false,
        error: error2 instanceof Error ? error2.message : String(error2),
        stack: error2 instanceof Error ? error2.stack : void 0,
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
  return /* @__PURE__ */ jsx(UIBridgeNativeContext, { value: contextValue, children });
}
function useUIBridgeNative() {
  const context = use(UIBridgeNativeContext);
  if (!context) {
    throw new Error("useUIBridgeNative must be used within a UIBridgeNativeProvider");
  }
  return context;
}
function useUIBridgeNativeOptional() {
  return use(UIBridgeNativeContext);
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
    setRegistered((prev) => prev ? prev : true);
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

// src/native/server/types.ts
var UI_BRIDGE_NATIVE_ROUTES = {
  // Control - Elements
  GET_ELEMENTS: {
    method: "GET",
    path: "/ui-bridge/control/elements",
    description: "List all registered elements"
  },
  GET_ELEMENT: {
    method: "GET",
    path: "/ui-bridge/control/element/:id",
    description: "Get element details"
  },
  GET_ELEMENT_STATE: {
    method: "GET",
    path: "/ui-bridge/control/element/:id/state",
    description: "Get element state"
  },
  EXECUTE_ACTION: {
    method: "POST",
    path: "/ui-bridge/control/element/:id/action",
    description: "Execute action on element"
  },
  BATCH_ACTIONS: {
    method: "POST",
    path: "/ui-bridge/control/batch-actions",
    description: "Execute multiple actions in sequence with optional delay and stopOnFailure"
  },
  // Control - Components
  GET_COMPONENTS: {
    method: "GET",
    path: "/ui-bridge/control/components",
    description: "List all registered components"
  },
  GET_COMPONENT: {
    method: "GET",
    path: "/ui-bridge/control/component/:id",
    description: "Get component details"
  },
  EXECUTE_COMPONENT_ACTION: {
    method: "POST",
    path: "/ui-bridge/control/component/:id/action/:actionId",
    description: "Execute component action"
  },
  // Discovery
  FIND: {
    method: "POST",
    path: "/ui-bridge/control/find",
    description: "Find elements matching criteria"
  },
  GET_SNAPSHOT: {
    method: "GET",
    path: "/ui-bridge/control/snapshot",
    description: "Get full bridge snapshot"
  },
  // Workflows
  GET_WORKFLOWS: {
    method: "GET",
    path: "/ui-bridge/control/workflows",
    description: "List all workflows"
  },
  RUN_WORKFLOW: {
    method: "POST",
    path: "/ui-bridge/control/workflow/:id/run",
    description: "Run a workflow"
  },
  // Page Navigation
  PAGE_REFRESH: {
    method: "POST",
    path: "/ui-bridge/control/page/refresh",
    description: "Refresh the current page"
  },
  PAGE_NAVIGATE: {
    method: "POST",
    path: "/ui-bridge/control/page/navigate",
    description: "Navigate to a URL"
  },
  PAGE_GO_BACK: {
    method: "POST",
    path: "/ui-bridge/control/page/back",
    description: "Go back in navigation history"
  },
  PAGE_GO_FORWARD: {
    method: "POST",
    path: "/ui-bridge/control/page/forward",
    description: "Go forward in navigation history"
  },
  // Health
  HEALTH: {
    method: "GET",
    path: "/ui-bridge/health",
    description: "Health check"
  }
};

// src/native/server/handlers.ts
async function executeWorkflowStep(step, registry, executor) {
  const startTime = Date.now();
  try {
    switch (step.type) {
      case "element-action": {
        if (!step.target || !step.action) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "element-action step requires target and action",
            durationMs: Date.now() - startTime
          };
        }
        const response = await executor.executeAction(step.target, {
          action: step.action,
          params: step.params,
          waitOptions: step.waitOptions
        });
        return {
          stepId: step.id,
          type: step.type,
          status: response.success ? "completed" : "failed",
          result: response.result,
          error: response.error,
          durationMs: Date.now() - startTime
        };
      }
      case "component-action": {
        if (!step.target || !step.action) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "component-action step requires target and action",
            durationMs: Date.now() - startTime
          };
        }
        const response = await executor.executeComponentAction(step.target, {
          action: step.action,
          params: step.params
        });
        return {
          stepId: step.id,
          type: step.type,
          status: response.success ? "completed" : "failed",
          result: response.result,
          error: response.error,
          durationMs: Date.now() - startTime
        };
      }
      case "wait": {
        if (!step.target) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "wait step requires target element id",
            durationMs: Date.now() - startTime
          };
        }
        const waitResult = await executor.waitForElement(
          step.target,
          step.waitOptions || { visible: true, timeout: 1e4, interval: 100 }
        );
        return {
          stepId: step.id,
          type: step.type,
          status: waitResult.met ? "completed" : "failed",
          result: waitResult.state,
          error: waitResult.error,
          durationMs: Date.now() - startTime
        };
      }
      case "assert": {
        if (!step.target) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "assert step requires target element id",
            durationMs: Date.now() - startTime
          };
        }
        const element = registry.getElement(step.target);
        if (!element) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: `Element not found: ${step.target}`,
            durationMs: Date.now() - startTime
          };
        }
        const state = element.getState();
        const expected = step.params || {};
        const stateRecord = state;
        const mismatches = [];
        for (const [key, value] of Object.entries(expected)) {
          const actual = stateRecord[key];
          const isEqual = typeof value === "object" && value !== null ? JSON.stringify(actual) === JSON.stringify(value) : actual === value;
          if (!isEqual) {
            mismatches.push(
              `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`
            );
          }
        }
        return {
          stepId: step.id,
          type: step.type,
          status: mismatches.length === 0 ? "completed" : "failed",
          result: { state, mismatches },
          error: mismatches.length > 0 ? `Assertion failed: ${mismatches.join("; ")}` : void 0,
          durationMs: Date.now() - startTime
        };
      }
      case "custom": {
        if (!step.handler) {
          return {
            stepId: step.id,
            type: step.type,
            status: "failed",
            error: "custom step requires a handler function",
            durationMs: Date.now() - startTime
          };
        }
        const result = await step.handler();
        const failed = result && typeof result === "object" && "success" in result && result.success === false;
        return {
          stepId: step.id,
          type: step.type,
          status: failed ? "failed" : "completed",
          result,
          error: failed ? result.error || "Custom handler returned failure" : void 0,
          durationMs: Date.now() - startTime
        };
      }
      case "log": {
        const message = step.params?.message ?? step.params?.text ?? `[workflow] step ${step.id}`;
        console.log(`[ui-bridge-native] workflow log: ${message}`);
        return {
          stepId: step.id,
          type: step.type,
          status: "completed",
          result: { message },
          durationMs: Date.now() - startTime
        };
      }
      case "navigate":
      case "branch":
      case "loop":
      case "extract":
        return {
          stepId: step.id,
          type: step.type,
          status: "skipped",
          error: `Step type "${step.type}" is not yet supported in native workflow execution`,
          durationMs: Date.now() - startTime
        };
      default:
        return {
          stepId: step.id,
          type: step.type,
          status: "failed",
          error: `Unknown step type: ${step.type}`,
          durationMs: Date.now() - startTime
        };
    }
  } catch (err) {
    return {
      stepId: step.id,
      type: step.type,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime
    };
  }
}
function success(data) {
  return {
    success: true,
    data,
    timestamp: Date.now()
  };
}
function error(message, code) {
  return {
    success: false,
    error: message,
    code,
    timestamp: Date.now()
  };
}
function createServerHandlers(registry, executor) {
  return {
    // Elements
    getElements: async () => {
      const elements = registry.getAllElements().map((e) => ({
        id: e.id,
        type: e.type,
        label: e.label,
        identifier: e.getIdentifier(),
        state: e.getState(),
        actions: e.actions,
        customActions: e.customActions ? Object.keys(e.customActions) : void 0
      }));
      return success({ elements });
    },
    getElement: async (ctx) => {
      const { id } = ctx.params;
      const element = registry.getElement(id);
      if (!element) {
        return error(`Element not found: ${id}`, "ELEMENT_NOT_FOUND");
      }
      return success({
        element: {
          id: element.id,
          type: element.type,
          label: element.label,
          identifier: element.getIdentifier(),
          state: element.getState(),
          actions: element.actions,
          customActions: element.customActions ? Object.keys(element.customActions) : void 0
        }
      });
    },
    getElementState: async (ctx) => {
      const { id } = ctx.params;
      const element = registry.getElement(id);
      if (!element) {
        return error(`Element not found: ${id}`, "ELEMENT_NOT_FOUND");
      }
      return success({ state: element.getState() });
    },
    executeAction: async (ctx) => {
      const { id } = ctx.params;
      const body = ctx.body;
      if (!body?.action) {
        return error("Action is required", "INVALID_REQUEST");
      }
      const response = await executor.executeAction(id, {
        action: body.action,
        params: body.params,
        waitOptions: body.waitOptions
      });
      if (!response.success) {
        return error(response.error || "Action failed", "ACTION_FAILED");
      }
      return success(response);
    },
    executeBatchAction: async (ctx) => {
      const body = ctx.body;
      if (!body?.steps || !Array.isArray(body.steps)) {
        return error("steps array is required", "INVALID_REQUEST");
      }
      const startTime = Date.now();
      const results = [];
      let succeededCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let stopped = false;
      const stopOnFailure = body.stopOnFailure ?? true;
      const delayBetweenMs = body.delayBetweenMs ?? 0;
      for (let i = 0; i < body.steps.length; i++) {
        if (stopped) {
          skippedCount++;
          results.push({
            index: i,
            label: body.steps[i].label,
            elementId: body.steps[i].elementId,
            response: { success: false, error: "Skipped (previous step failed)" }
          });
          continue;
        }
        const step = body.steps[i];
        if (i > 0 && delayBetweenMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayBetweenMs));
        }
        const response = await executor.executeAction(step.elementId, step.action);
        results.push({
          index: i,
          label: step.label,
          elementId: step.elementId,
          response
        });
        if (response.success) {
          succeededCount++;
        } else {
          failedCount++;
          if (stopOnFailure) stopped = true;
        }
      }
      return success({
        success: failedCount === 0,
        results,
        succeededCount,
        failedCount,
        skippedCount,
        durationMs: Date.now() - startTime,
        timestamp: Date.now()
      });
    },
    // Components
    getComponents: async () => {
      const components = registry.getAllComponents().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        actions: c.actions.map((a) => ({ id: a.id, label: a.label })),
        elementIds: c.elementIds
      }));
      return success({ components });
    },
    getComponent: async (ctx) => {
      const { id } = ctx.params;
      const component = registry.getComponent(id);
      if (!component) {
        return error(`Component not found: ${id}`, "COMPONENT_NOT_FOUND");
      }
      return success({
        component: {
          id: component.id,
          name: component.name,
          description: component.description,
          actions: component.actions.map((a) => ({
            id: a.id,
            label: a.label,
            description: a.description
          })),
          elementIds: component.elementIds
        }
      });
    },
    executeComponentAction: async (ctx) => {
      const { id, actionId } = ctx.params;
      const body = ctx.body;
      const response = await executor.executeComponentAction(id, {
        action: actionId,
        params: body?.params
      });
      if (!response.success) {
        return error(response.error || "Action failed", "ACTION_FAILED");
      }
      return success(response);
    },
    // Discovery
    find: async (ctx) => {
      const body = ctx.body;
      const response = await executor.find({
        types: body?.types,
        testIdPattern: body?.testIdPattern,
        accessibilityLabelPattern: body?.accessibilityLabelPattern,
        visibleOnly: body?.visibleOnly,
        limit: body?.limit
      });
      return success(response);
    },
    getSnapshot: async () => {
      const snapshot = registry.createSnapshot();
      return success(snapshot);
    },
    // Workflows
    getWorkflows: async () => {
      const workflows = registry.getAllWorkflows().map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        stepCount: w.steps.length
      }));
      return success({ workflows });
    },
    runWorkflow: async (ctx) => {
      const { id } = ctx.params;
      const workflow = registry.getWorkflow(id);
      if (!workflow) {
        return error(`Workflow not found: ${id}`, "WORKFLOW_NOT_FOUND");
      }
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startTime = Date.now();
      const stepResults = [];
      let status = "completed";
      registry.emit("workflow:started", {
        runId,
        workflowId: id,
        workflowName: workflow.name,
        totalSteps: workflow.steps.length
      });
      for (const step of workflow.steps) {
        const stepResult = await executeWorkflowStep(step, registry, executor);
        stepResults.push(stepResult);
        if (stepResult.status === "completed" || stepResult.status === "skipped") {
          registry.emit("workflow:stepCompleted", {
            runId,
            workflowId: id,
            step: stepResult
          });
        }
        if (stepResult.status === "failed") {
          status = "failed";
          registry.emit("workflow:failed", {
            runId,
            workflowId: id,
            failedStep: stepResult,
            completedSteps: stepResults.length - 1,
            totalSteps: workflow.steps.length
          });
          break;
        }
      }
      if (status === "completed") {
        registry.emit("workflow:completed", {
          runId,
          workflowId: id,
          steps: stepResults,
          totalDurationMs: Date.now() - startTime
        });
      }
      return success({
        runId,
        status,
        steps: stepResults,
        totalSteps: workflow.steps.length,
        completedSteps: stepResults.filter((s) => s.status === "completed").length,
        failedSteps: stepResults.filter((s) => s.status === "failed").length,
        skippedSteps: stepResults.filter((s) => s.status === "skipped").length,
        durationMs: Date.now() - startTime
      });
    },
    // Page Navigation (stubs — React Native apps should override with their navigation provider)
    pageRefresh: async () => {
      return error("Page refresh not supported on native platform", "NOT_SUPPORTED");
    },
    pageNavigate: async () => {
      return error("Page navigation not supported on native platform", "NOT_SUPPORTED");
    },
    pageGoBack: async () => {
      return error("Page go back not supported on native platform", "NOT_SUPPORTED");
    },
    pageGoForward: async () => {
      return error("Page go forward not supported on native platform", "NOT_SUPPORTED");
    },
    // Health
    health: async () => {
      const stats = registry.getStats();
      return success({
        status: "healthy",
        timestamp: Date.now(),
        ...stats
      });
    }
  };
}

// src/native/server/http-server.ts
var NativeUIBridgeServer = class {
  constructor(registry, executor, config = {}) {
    this.registry = registry;
    this.executor = executor;
    this.running = false;
    this.config = {
      serverPort: 9876,
      cors: true,
      ...config
    };
    this.handlers = createServerHandlers(registry, executor);
  }
  /**
   * Set the server adapter
   */
  setAdapter(adapter) {
    this.adapter = adapter;
  }
  /**
   * Start the HTTP server
   */
  async start() {
    if (this.running) {
      console.warn("[ui-bridge-native] Server already running");
      return;
    }
    if (!this.adapter) {
      console.warn("[ui-bridge-native] No server adapter configured. Call setAdapter() first.");
      console.warn("[ui-bridge-native] See documentation for supported adapters.");
      return;
    }
    await this.adapter.start(this.config.serverPort, this.handleRequest.bind(this));
    this.running = true;
    console.log(`[ui-bridge-native] HTTP server started on port ${this.config.serverPort}`);
  }
  /**
   * Stop the HTTP server
   */
  async stop() {
    if (!this.running || !this.adapter) {
      return;
    }
    await this.adapter.stop();
    this.running = false;
    console.log("[ui-bridge-native] HTTP server stopped");
  }
  /**
   * Check if server is running
   */
  isRunning() {
    return this.running;
  }
  /**
   * Handle incoming HTTP request
   */
  async handleRequest(request) {
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.config.cors) {
      headers["Access-Control-Allow-Origin"] = this.config.allowedOrigins ? this.config.allowedOrigins.join(",") : "*";
      headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    }
    if (request.method === "OPTIONS") {
      return { status: 204, headers, body: "" };
    }
    try {
      const response = await this.routeRequest(request);
      return {
        status: response.success ? 200 : 400,
        headers,
        body: JSON.stringify(response)
      };
    } catch (error2) {
      const errorResponse = {
        success: false,
        error: error2 instanceof Error ? error2.message : "Internal server error",
        code: "INTERNAL_ERROR",
        timestamp: Date.now()
      };
      return {
        status: 500,
        headers,
        body: JSON.stringify(errorResponse)
      };
    }
  }
  /**
   * Route request to appropriate handler
   */
  async routeRequest(request) {
    const { method, path, query, body } = request;
    const parsePath = (pattern, actual) => {
      const patternParts = pattern.split("/");
      const actualParts = actual.split("/");
      if (patternParts.length !== actualParts.length) {
        return null;
      }
      const params2 = {};
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(":")) {
          params2[patternParts[i].slice(1)] = actualParts[i];
        } else if (patternParts[i] !== actualParts[i]) {
          return null;
        }
      }
      return params2;
    };
    if (method === "GET" && path === "/ui-bridge/health") {
      return this.handlers.health({ params: {}, query, body });
    }
    if (method === "GET" && path === "/ui-bridge/control/elements") {
      return this.handlers.getElements({ params: {}, query, body });
    }
    let params = parsePath("/ui-bridge/control/element/:id", path);
    if (method === "GET" && params) {
      return this.handlers.getElement({ params, query, body });
    }
    params = parsePath("/ui-bridge/control/element/:id/state", path);
    if (method === "GET" && params) {
      return this.handlers.getElementState({ params, query, body });
    }
    params = parsePath("/ui-bridge/control/element/:id/action", path);
    if (method === "POST" && params) {
      return this.handlers.executeAction({ params, query, body });
    }
    if (method === "POST" && path === "/ui-bridge/control/batch-actions") {
      return this.handlers.executeBatchAction({ params: {}, query, body });
    }
    if (method === "GET" && path === "/ui-bridge/control/components") {
      return this.handlers.getComponents({ params: {}, query, body });
    }
    params = parsePath("/ui-bridge/control/component/:id", path);
    if (method === "GET" && params) {
      return this.handlers.getComponent({ params, query, body });
    }
    params = parsePath("/ui-bridge/control/component/:id/action/:actionId", path);
    if (method === "POST" && params) {
      return this.handlers.executeComponentAction({ params, query, body });
    }
    if (method === "POST" && path === "/ui-bridge/control/find") {
      return this.handlers.find({ params: {}, query, body });
    }
    if (method === "GET" && path === "/ui-bridge/control/snapshot") {
      return this.handlers.getSnapshot({ params: {}, query, body });
    }
    if (method === "GET" && path === "/ui-bridge/control/workflows") {
      return this.handlers.getWorkflows({ params: {}, query, body });
    }
    params = parsePath("/ui-bridge/control/workflow/:id/run", path);
    if (method === "POST" && params) {
      return this.handlers.runWorkflow({ params, query, body });
    }
    return {
      success: false,
      error: `Route not found: ${method} ${path}`,
      code: "NOT_FOUND",
      timestamp: Date.now()
    };
  }
};
function createNativeServer(registry, executor, config) {
  return new NativeUIBridgeServer(registry, executor, config);
}
function ElementCard({
  element,
  onPress
}) {
  const state = element.getState();
  const identifier = element.getIdentifier();
  return /* @__PURE__ */ jsxs(TouchableOpacity, { style: styles.elementCard, onPress: () => onPress(element), children: [
    /* @__PURE__ */ jsxs(View, { style: styles.elementHeader, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.elementId, children: element.id }),
      /* @__PURE__ */ jsx(Text, { style: styles.elementType, children: element.type })
    ] }),
    element.label && /* @__PURE__ */ jsx(Text, { style: styles.elementLabel, children: element.label }),
    /* @__PURE__ */ jsxs(View, { style: styles.stateRow, children: [
      /* @__PURE__ */ jsx(StateIndicator, { label: "Mounted", value: state.mounted }),
      /* @__PURE__ */ jsx(StateIndicator, { label: "Visible", value: state.visible }),
      /* @__PURE__ */ jsx(StateIndicator, { label: "Enabled", value: state.enabled })
    ] }),
    identifier.testId && /* @__PURE__ */ jsxs(Text, { style: styles.testId, children: [
      "testID: ",
      identifier.testId
    ] })
  ] });
}
function StateIndicator({ label, value }) {
  return /* @__PURE__ */ jsxs(View, { style: styles.stateIndicator, children: [
    /* @__PURE__ */ jsx(View, { style: [styles.stateDot, { backgroundColor: value ? "#4CAF50" : "#F44336" }] }),
    /* @__PURE__ */ jsx(Text, { style: styles.stateLabel, children: label })
  ] });
}
function ElementDetail({
  element,
  onClose
}) {
  const state = element.getState();
  const identifier = element.getIdentifier();
  return /* @__PURE__ */ jsxs(View, { style: styles.detailContainer, children: [
    /* @__PURE__ */ jsxs(View, { style: styles.detailHeader, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.detailTitle, children: element.id }),
      /* @__PURE__ */ jsx(TouchableOpacity, { onPress: onClose, children: /* @__PURE__ */ jsx(Text, { style: styles.closeButton, children: "Close" }) })
    ] }),
    /* @__PURE__ */ jsxs(ScrollView, { style: styles.detailContent, children: [
      /* @__PURE__ */ jsx(Text, { style: styles.sectionTitle, children: "Type" }),
      /* @__PURE__ */ jsx(Text, { style: styles.sectionValue, children: element.type }),
      element.label && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(Text, { style: styles.sectionTitle, children: "Label" }),
        /* @__PURE__ */ jsx(Text, { style: styles.sectionValue, children: element.label })
      ] }),
      /* @__PURE__ */ jsx(Text, { style: styles.sectionTitle, children: "State" }),
      /* @__PURE__ */ jsxs(View, { style: styles.stateSection, children: [
        /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
          "Mounted: ",
          String(state.mounted)
        ] }),
        /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
          "Visible: ",
          String(state.visible)
        ] }),
        /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
          "Enabled: ",
          String(state.enabled)
        ] }),
        /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
          "Focused: ",
          String(state.focused)
        ] }),
        state.value !== void 0 && /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
          "Value: ",
          state.value
        ] })
      ] }),
      state.layout && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(Text, { style: styles.sectionTitle, children: "Layout" }),
        /* @__PURE__ */ jsxs(View, { style: styles.stateSection, children: [
          /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
            "Position: (",
            state.layout.x,
            ", ",
            state.layout.y,
            ")"
          ] }),
          /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
            "Size: ",
            state.layout.width,
            " x ",
            state.layout.height
          ] }),
          /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
            "Page: (",
            state.layout.pageX,
            ", ",
            state.layout.pageY,
            ")"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsx(Text, { style: styles.sectionTitle, children: "Identifier" }),
      /* @__PURE__ */ jsxs(View, { style: styles.stateSection, children: [
        identifier.uiId && /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
          "uiId: ",
          identifier.uiId
        ] }),
        identifier.testId && /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
          "testId: ",
          identifier.testId
        ] }),
        identifier.accessibilityLabel && /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
          "a11yLabel: ",
          identifier.accessibilityLabel
        ] }),
        /* @__PURE__ */ jsxs(Text, { style: styles.stateText, children: [
          "treePath: ",
          identifier.treePath
        ] })
      ] }),
      /* @__PURE__ */ jsx(Text, { style: styles.sectionTitle, children: "Actions" }),
      /* @__PURE__ */ jsx(View, { style: styles.actionsSection, children: element.actions.map((action) => /* @__PURE__ */ jsx(View, { style: styles.actionBadge, children: /* @__PURE__ */ jsx(Text, { style: styles.actionText, children: action }) }, action)) }),
      element.customActions && Object.keys(element.customActions).length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(Text, { style: styles.sectionTitle, children: "Custom Actions" }),
        /* @__PURE__ */ jsx(View, { style: styles.actionsSection, children: Object.keys(element.customActions).map((action) => /* @__PURE__ */ jsx(View, { style: [styles.actionBadge, styles.customActionBadge], children: /* @__PURE__ */ jsx(Text, { style: styles.actionText, children: action }) }, action)) })
      ] })
    ] })
  ] });
}
function UIBridgeInspector({
  visible = false,
  onClose,
  togglePosition = "bottom-right"
}) {
  const bridge = useUIBridgeNativeOptional();
  const [showInspector, setShowInspector] = useState(visible);
  const [selectedElement, setSelectedElement] = useState(null);
  const elements = useMemo(() => bridge ? bridge.getElements() : [], [bridge, showInspector]);
  const components = useMemo(() => bridge ? bridge.getComponents() : [], [bridge, showInspector]);
  const handleToggle = useCallback(() => {
    setShowInspector((prev) => !prev);
  }, []);
  const handleClose = useCallback(() => {
    setShowInspector(false);
    onClose?.();
  }, [onClose]);
  const handleSelectElement = useCallback((element) => {
    setSelectedElement(element);
  }, []);
  const handleCloseDetail = useCallback(() => {
    setSelectedElement(null);
  }, []);
  const toggleStyle = useMemo(() => {
    switch (togglePosition) {
      case "top-left":
        return { top: 50, left: 10 };
      case "top-right":
        return { top: 50, right: 10 };
      case "bottom-left":
        return { bottom: 50, left: 10 };
      case "bottom-right":
      default:
        return { bottom: 50, right: 10 };
    }
  }, [togglePosition]);
  if (!bridge) {
    return null;
  }
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(TouchableOpacity, { style: [styles.toggleButton, toggleStyle], onPress: handleToggle, children: /* @__PURE__ */ jsx(Text, { style: styles.toggleText, children: "UI" }) }),
    /* @__PURE__ */ jsx(
      Modal,
      {
        visible: showInspector,
        animationType: "slide",
        transparent: true,
        onRequestClose: handleClose,
        children: /* @__PURE__ */ jsx(View, { style: styles.modalContainer, children: /* @__PURE__ */ jsxs(View, { style: styles.inspectorContainer, children: [
          /* @__PURE__ */ jsxs(View, { style: styles.header, children: [
            /* @__PURE__ */ jsx(Text, { style: styles.headerTitle, children: "UI Bridge Inspector" }),
            /* @__PURE__ */ jsx(TouchableOpacity, { onPress: handleClose, children: /* @__PURE__ */ jsx(Text, { style: styles.closeButton, children: "X" }) })
          ] }),
          /* @__PURE__ */ jsxs(View, { style: styles.statsRow, children: [
            /* @__PURE__ */ jsxs(View, { style: styles.stat, children: [
              /* @__PURE__ */ jsx(Text, { style: styles.statValue, children: elements.length }),
              /* @__PURE__ */ jsx(Text, { style: styles.statLabel, children: "Elements" })
            ] }),
            /* @__PURE__ */ jsxs(View, { style: styles.stat, children: [
              /* @__PURE__ */ jsx(Text, { style: styles.statValue, children: components.length }),
              /* @__PURE__ */ jsx(Text, { style: styles.statLabel, children: "Components" })
            ] }),
            /* @__PURE__ */ jsxs(View, { style: styles.stat, children: [
              /* @__PURE__ */ jsx(Text, { style: styles.statValue, children: bridge.serverRunning ? "ON" : "OFF" }),
              /* @__PURE__ */ jsx(Text, { style: styles.statLabel, children: "Server" })
            ] })
          ] }),
          selectedElement ? /* @__PURE__ */ jsx(ElementDetail, { element: selectedElement, onClose: handleCloseDetail }) : /* @__PURE__ */ jsxs(ScrollView, { style: styles.elementList, children: [
            elements.map((element) => /* @__PURE__ */ jsx(ElementCard, { element, onPress: handleSelectElement }, element.id)),
            elements.length === 0 && /* @__PURE__ */ jsx(Text, { style: styles.emptyText, children: "No elements registered yet" })
          ] })
        ] }) })
      }
    )
  ] });
}
var { height: screenHeight } = Dimensions.get("window");
var styles = StyleSheet.create({
  toggleButton: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#2196F3",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1e3
  },
  toggleText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end"
  },
  inspectorContainer: {
    backgroundColor: "#1e1e1e",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: screenHeight * 0.8
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#333"
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold"
  },
  closeButton: {
    color: "#2196F3",
    fontSize: 16,
    fontWeight: "bold"
  },
  statsRow: {
    flexDirection: "row",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#333"
  },
  stat: {
    flex: 1,
    alignItems: "center"
  },
  statValue: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold"
  },
  statLabel: {
    color: "#888",
    fontSize: 12,
    marginTop: 2
  },
  elementList: {
    padding: 12
  },
  elementCard: {
    backgroundColor: "#2d2d2d",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8
  },
  elementHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  elementId: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold"
  },
  elementType: {
    color: "#888",
    fontSize: 12,
    backgroundColor: "#444",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4
  },
  elementLabel: {
    color: "#aaa",
    fontSize: 12,
    marginTop: 4
  },
  stateRow: {
    flexDirection: "row",
    marginTop: 8
  },
  stateIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 12
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4
  },
  stateLabel: {
    color: "#888",
    fontSize: 10
  },
  testId: {
    color: "#666",
    fontSize: 10,
    marginTop: 4,
    fontFamily: "monospace"
  },
  emptyText: {
    color: "#888",
    textAlign: "center",
    marginTop: 20
  },
  detailContainer: {
    flex: 1
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#333"
  },
  detailTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold"
  },
  detailContent: {
    padding: 12
  },
  sectionTitle: {
    color: "#888",
    fontSize: 12,
    marginTop: 12,
    marginBottom: 4,
    textTransform: "uppercase"
  },
  sectionValue: {
    color: "#fff",
    fontSize: 14
  },
  stateSection: {
    backgroundColor: "#2d2d2d",
    borderRadius: 8,
    padding: 8
  },
  stateText: {
    color: "#ddd",
    fontSize: 12,
    fontFamily: "monospace",
    marginBottom: 2
  },
  actionsSection: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  actionBadge: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 6
  },
  customActionBadge: {
    backgroundColor: "#9C27B0"
  },
  actionText: {
    color: "#fff",
    fontSize: 12
  }
});

export { DefaultNativeActionExecutor, NativeUIBridgeRegistry, NativeUIBridgeServer, UIBridgeInspector, UIBridgeNativeProvider, UI_BRIDGE_NATIVE_ROUTES, buildTreePath, createNativeActionExecutor, createNativeElementIdentifier, createNativeServer, createServerHandlers, findAllByPattern, findElementByIdentifier, getGlobalRegistry, matchesIdentifier, parseTreePath, resetGlobalRegistry, setGlobalRegistry, useUIBridge, useUIBridgeNative, useUIBridgeNativeOptional, useUIBridgeNativeRequired, useUIBridgeRequired, useUIComponent, useUIComponentAction, useUIElement, useUIElementWithProps };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map