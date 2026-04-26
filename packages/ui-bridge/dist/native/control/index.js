'use strict';

// src/native/core/registry.ts

// src/native/core/element-identifier.ts
function findElementByIdentifier(identifier) {
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

exports.DefaultNativeActionExecutor = DefaultNativeActionExecutor;
exports.createNativeActionExecutor = createNativeActionExecutor;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map