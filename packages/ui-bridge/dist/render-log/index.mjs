// src/core/element-identifier.ts
function generateXPath(element) {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();
    const testId = current.getAttribute("data-testid");
    if (testId) {
      selector += `[@data-testid="${testId}"]`;
      parts.unshift(selector);
      break;
    }
    const id = current.id;
    if (id) {
      selector += `[@id="${id}"]`;
      parts.unshift(selector);
      break;
    }
    const parentEl = current.parentElement;
    if (parentEl) {
      const currentEl = current;
      const siblings = Array.from(parentEl.children).filter(
        (child) => child.nodeName === currentEl.nodeName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(currentEl) + 1;
        selector += `[${index}]`;
      }
    }
    parts.unshift(selector);
    current = parentEl;
  }
  return "/" + parts.join("/");
}
function generateCSSSelector(element) {
  const testId = element.getAttribute("data-testid");
  if (testId) {
    return `[data-testid="${testId}"]`;
  }
  const awasId = element.getAttribute("data-awas-element");
  if (awasId) {
    return `[data-awas-element="${awasId}"]`;
  }
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }
  const path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();
    const parentTestId = current.getAttribute("data-testid");
    if (parentTestId && current !== element) {
      path.unshift(`[data-testid="${parentTestId}"]`);
      break;
    }
    if (current.id) {
      path.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const parentEl = current.parentElement;
    if (parentEl) {
      const currentEl = current;
      const siblings = Array.from(parentEl.children);
      const sameTagSiblings = siblings.filter(
        (s) => s.nodeName === currentEl.nodeName
      );
      if (sameTagSiblings.length > 1) {
        const index = siblings.indexOf(currentEl) + 1;
        selector += `:nth-child(${index})`;
      }
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(" > ");
}
function getBestIdentifier(element) {
  const uiBridgeTestId = element.getAttribute("data-ui-bridge-test-id")?.trim();
  if (uiBridgeTestId) return uiBridgeTestId;
  const testId = element.getAttribute("data-testid");
  if (testId) return testId;
  const awasId = element.getAttribute("data-awas-element");
  if (awasId) return awasId;
  if (element.id) return element.id;
  return generateCSSSelector(element);
}
function createElementIdentifier(element) {
  return {
    testId: element.getAttribute("data-testid") || void 0,
    awasId: element.getAttribute("data-awas-element") || void 0,
    htmlId: element.id || void 0,
    xpath: generateXPath(element),
    selector: generateCSSSelector(element)
  };
}

// src/render-log/dom-capture.ts
var CAPTURE_ATTRIBUTES = [
  "data-testid",
  "data-awas-element",
  "id",
  "name",
  "type",
  "href",
  "src",
  "alt",
  "title",
  "placeholder",
  "value",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-expanded",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
  "aria-hidden",
  "role",
  "tabindex",
  "disabled",
  "readonly",
  "required",
  "checked"
];
var INTERACTIVE_SELECTORS = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[onclick]",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  "[data-ui-element]",
  "[data-testid]"
];
function isInteractive(element) {
  return INTERACTIVE_SELECTORS.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
}
function getAccessibleName(element) {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const labels = labelledBy.split(" ").map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
    if (labels.length > 0) return labels.join(" ");
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent?.trim();
    }
  }
  const title = element.getAttribute("title");
  if (title) return title;
  if (element instanceof HTMLImageElement) {
    return element.alt || void 0;
  }
  if (element.matches('button, a, [role="button"], [role="link"]')) {
    return element.textContent?.trim() || void 0;
  }
  return void 0;
}
function getElementState(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const state = {
    visible: isVisible(element, rect, style),
    enabled: !isDisabled(element),
    focused: document.activeElement === element,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left
    },
    computedStyles: {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      cursor: style.cursor,
      color: style.color,
      backgroundColor: style.backgroundColor,
      colorScheme: style.colorScheme,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      position: style.position,
      zIndex: style.zIndex,
      padding: style.padding,
      margin: style.margin,
      borderColor: style.borderColor,
      borderWidth: style.borderWidth,
      borderRadius: style.borderRadius
    }
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw > 0 && vh > 0) {
    state.normalizedRect = {
      x: rect.x / vw,
      y: rect.y / vh,
      width: rect.width / vw,
      height: rect.height / vh
    };
  }
  if (element instanceof HTMLInputElement) {
    state.value = element.value;
    if (element.type === "checkbox" || element.type === "radio") {
      state.checked = element.checked;
    }
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = element.value;
  } else if (element instanceof HTMLSelectElement) {
    state.value = element.value;
    state.selectedOptions = Array.from(element.selectedOptions).map((opt) => opt.value);
    state.availableOptions = Array.from(element.options).map((opt) => ({
      value: opt.value,
      label: opt.text,
      selected: opt.selected
    }));
  }
  return state;
}
function isVisible(element, rect, style) {
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) === 0) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  return rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
}
function isDisabled(element) {
  if ("disabled" in element && element.disabled) return true;
  if (element.getAttribute("aria-disabled") === "true") return true;
  return false;
}
function captureAttributes(element) {
  const attrs = {};
  for (const attr of CAPTURE_ATTRIBUTES) {
    const value = element.getAttribute(attr);
    if (value !== null) {
      attrs[attr] = value;
    }
  }
  return attrs;
}
function captureElement(element, depth, maxTextLength) {
  const identifier = createElementIdentifier(element);
  let textContent = element.textContent?.trim();
  if (textContent && textContent.length > maxTextLength) {
    textContent = textContent.substring(0, maxTextLength) + "...";
  }
  return {
    identifier,
    bestId: getBestIdentifier(element),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") || void 0,
    accessibleName: getAccessibleName(element),
    textContent,
    state: getElementState(element),
    attributes: captureAttributes(element),
    childCount: element.children.length,
    depth
  };
}
function captureDOMSnapshot(options = {}) {
  const startTime = performance.now();
  const {
    root = document.body,
    maxDepth = 50,
    maxElements = 5e3,
    interactiveOnly = false,
    includeHidden = false,
    includeSelectors,
    excludeSelectors,
    filter,
    maxTextLength = 200
  } = options;
  const elements = [];
  let totalNodeCount = 0;
  function shouldCapture(element) {
    if (filter && !filter(element)) return false;
    if (excludeSelectors) {
      for (const selector of excludeSelectors) {
        try {
          if (element.matches(selector)) return false;
        } catch {
        }
      }
    }
    if (includeSelectors && includeSelectors.length > 0) {
      let matches = false;
      for (const selector of includeSelectors) {
        try {
          if (element.matches(selector)) {
            matches = true;
            break;
          }
        } catch {
        }
      }
      if (!matches) return false;
    }
    if (interactiveOnly && !isInteractive(element)) return false;
    if (!includeHidden) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (!isVisible(element, rect, style)) return false;
    }
    return true;
  }
  function traverse(element, depth) {
    if (depth > maxDepth || elements.length >= maxElements) return;
    totalNodeCount++;
    if (shouldCapture(element)) {
      elements.push(captureElement(element, depth, maxTextLength));
    }
    for (const child of element.children) {
      if (child instanceof HTMLElement) {
        traverse(child, depth + 1);
      }
    }
  }
  traverse(root, 0);
  const endTime = performance.now();
  return {
    timestamp: Date.now(),
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    },
    elements,
    totalNodeCount,
    captureDurationMs: endTime - startTime
  };
}
function captureInteractiveElements(options = {}) {
  return captureDOMSnapshot({ ...options, interactiveOnly: true });
}
var DOMChangeObserver = class {
  constructor(options = {}) {
    this.observer = null;
    this.changes = [];
    this.maxChanges = options.maxChanges ?? 1e3;
    this.callback = options.callback;
  }
  start(root = document.body) {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const change = this.processMutation(mutation);
        if (change) {
          this.addChange(change);
        }
      }
    });
    this.observer.observe(root, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true
    });
  }
  stop() {
    this.observer?.disconnect();
    this.observer = null;
  }
  processMutation(mutation) {
    const target = mutation.target;
    if (!(target instanceof HTMLElement)) return null;
    const elementId = getBestIdentifier(target);
    if (mutation.type === "attributes") {
      return {
        timestamp: Date.now(),
        type: "attribute",
        elementId,
        tagName: target.tagName.toLowerCase(),
        details: {
          attributeName: mutation.attributeName || void 0,
          oldValue: mutation.oldValue || void 0,
          newValue: mutation.attributeName ? target.getAttribute(mutation.attributeName) || void 0 : void 0
        }
      };
    }
    if (mutation.type === "childList") {
      if (mutation.addedNodes.length > 0) {
        return {
          timestamp: Date.now(),
          type: "added",
          elementId,
          tagName: target.tagName.toLowerCase(),
          details: {
            addedNodes: mutation.addedNodes.length
          }
        };
      }
      if (mutation.removedNodes.length > 0) {
        return {
          timestamp: Date.now(),
          type: "removed",
          elementId,
          tagName: target.tagName.toLowerCase(),
          details: {
            removedNodes: mutation.removedNodes.length
          }
        };
      }
    }
    return null;
  }
  addChange(change) {
    this.changes.push(change);
    if (this.changes.length > this.maxChanges) {
      this.changes.shift();
    }
    this.callback?.(change);
  }
  getChanges() {
    return [...this.changes];
  }
  clearChanges() {
    this.changes = [];
  }
};

// src/render-log/snapshot.ts
var InMemoryRenderLogStorage = class {
  constructor(maxEntries = 1e3) {
    this.entries = [];
    this.maxEntries = maxEntries;
  }
  async append(entry) {
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }
  async getEntries(options) {
    let results = [...this.entries];
    if (options?.type) {
      results = results.filter((e) => e.type === options.type);
    }
    if (options?.since) {
      results = results.filter((e) => e.timestamp >= options.since);
    }
    if (options?.until) {
      results = results.filter((e) => e.timestamp <= options.until);
    }
    if (options?.limit) {
      results = results.slice(-options.limit);
    }
    return results;
  }
  async clear() {
    this.entries = [];
  }
  async count() {
    return this.entries.length;
  }
  /** Get entries synchronously (for in-memory only) */
  getEntriesSync() {
    return [...this.entries];
  }
};
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
var RenderLogManager = class {
  constructor(options = {}) {
    this.changeObserver = null;
    this.snapshotTimer = null;
    this.pendingChanges = [];
    this.started = false;
    this.options = options;
    this.storage = options.storage ?? new InMemoryRenderLogStorage(options.maxEntries);
  }
  /**
   * Start capturing
   */
  start() {
    if (this.started) return;
    this.started = true;
    if (this.options.captureChanges !== false) {
      this.changeObserver = new DOMChangeObserver({
        callback: (change) => {
          this.pendingChanges.push(change);
          if (this.pendingChanges.length > 2e3) {
            this.pendingChanges = this.pendingChanges.slice(-1e3);
          }
        }
      });
      this.changeObserver.start();
    }
    if (this.options.captureOnNavigation !== false) {
      this.setupNavigationObserver();
    }
    if (this.options.snapshotInterval) {
      this.snapshotTimer = setInterval(() => {
        this.captureSnapshot();
      }, this.options.snapshotInterval);
    }
    this.captureSnapshot();
  }
  /**
   * Stop capturing
   */
  stop() {
    if (!this.started) return;
    this.started = false;
    this.changeObserver?.stop();
    this.changeObserver = null;
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }
  /**
   * Capture a DOM snapshot
   */
  async captureSnapshot(metadata) {
    if (this.pendingChanges.length > 0) {
      await this.flushChanges();
    }
    const snapshot = captureDOMSnapshot(this.options.captureOptions);
    const entry = {
      id: generateId(),
      type: "snapshot",
      timestamp: snapshot.timestamp,
      data: snapshot,
      metadata
    };
    await this.addEntry(entry);
    return entry;
  }
  /**
   * Flush pending DOM changes
   */
  async flushChanges() {
    if (this.pendingChanges.length === 0) return null;
    const changes = [...this.pendingChanges];
    this.pendingChanges = [];
    const entry = {
      id: generateId(),
      type: "change",
      timestamp: Date.now(),
      data: changes
    };
    await this.addEntry(entry);
    return entry;
  }
  /**
   * Log an interaction
   */
  async logInteraction(eventType, details) {
    const entry = {
      id: generateId(),
      type: "interaction",
      timestamp: Date.now(),
      data: {
        eventType,
        ...details
      }
    };
    await this.addEntry(entry);
    return entry;
  }
  /**
   * Log an error
   */
  async logError(message, details) {
    const entry = {
      id: generateId(),
      type: "error",
      timestamp: Date.now(),
      data: {
        message,
        ...details
      }
    };
    await this.addEntry(entry);
    return entry;
  }
  /**
   * Log a navigation
   */
  async logNavigation(from, to, navigationType) {
    const entry = {
      id: generateId(),
      type: "navigation",
      timestamp: Date.now(),
      data: {
        from,
        to,
        navigationType
      }
    };
    await this.addEntry(entry);
    return entry;
  }
  /**
   * Add a custom entry
   */
  async logCustom(data, metadata) {
    const entry = {
      id: generateId(),
      type: "custom",
      timestamp: Date.now(),
      data,
      metadata
    };
    await this.addEntry(entry);
    return entry;
  }
  /**
   * Get log entries
   */
  async getEntries(options) {
    return this.storage.getEntries(options);
  }
  /**
   * Clear the log
   */
  async clear() {
    this.pendingChanges = [];
    await this.storage.clear();
  }
  /**
   * Get entry count
   */
  async count() {
    return this.storage.count();
  }
  /**
   * Get the latest snapshot
   */
  async getLatestSnapshot() {
    const snapshots = await this.storage.getEntries({ type: "snapshot", limit: 1 });
    return snapshots[0] || null;
  }
  async addEntry(entry) {
    await this.storage.append(entry);
    this.options.onEntry?.(entry);
  }
  setupNavigationObserver() {
    let lastUrl = window.location.href;
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = (...args) => {
      const result = originalPushState.apply(history, args);
      const newUrl = window.location.href;
      if (newUrl !== lastUrl) {
        this.logNavigation(lastUrl, newUrl, "push");
        this.captureSnapshot({ trigger: "navigation" });
        lastUrl = newUrl;
      }
      return result;
    };
    history.replaceState = (...args) => {
      const result = originalReplaceState.apply(history, args);
      const newUrl = window.location.href;
      if (newUrl !== lastUrl) {
        this.logNavigation(lastUrl, newUrl, "replace");
        this.captureSnapshot({ trigger: "navigation" });
        lastUrl = newUrl;
      }
      return result;
    };
    window.addEventListener("popstate", () => {
      const newUrl = window.location.href;
      if (newUrl !== lastUrl) {
        this.logNavigation(lastUrl, newUrl, "pop");
        this.captureSnapshot({ trigger: "navigation" });
        lastUrl = newUrl;
      }
    });
  }
};
function createRenderLogManager(options) {
  return new RenderLogManager(options);
}

export { DOMChangeObserver, InMemoryRenderLogStorage, RenderLogManager, captureDOMSnapshot, captureInteractiveElements, createRenderLogManager };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map