'use strict';

var react = require('react');
var jsxRuntime = require('react/jsx-runtime');

// src/debug/inspector.tsx

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

// src/annotations/types.ts
var ANNOTATION_CONFIG_VERSION = "1.0.0";

// src/annotations/store.ts
var AnnotationStore = class {
  constructor() {
    this.store = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
  }
  /**
   * Get an annotation by element ID.
   */
  get(elementId) {
    return this.store.get(elementId);
  }
  /**
   * Get all annotations as a record.
   */
  getAll() {
    const result = {};
    for (const [id, annotation] of this.store) {
      result[id] = annotation;
    }
    return result;
  }
  /**
   * Set an annotation for an element. Auto-sets `updatedAt`.
   */
  set(elementId, annotation) {
    const updated = {
      ...annotation,
      updatedAt: Date.now()
    };
    this.store.set(elementId, updated);
    this.emit({
      type: "annotation:set",
      elementId,
      annotation: updated,
      timestamp: Date.now()
    });
  }
  /**
   * Delete an annotation by element ID.
   *
   * @returns true if the annotation existed and was deleted
   */
  delete(elementId) {
    const existed = this.store.delete(elementId);
    if (existed) {
      this.emit({
        type: "annotation:deleted",
        elementId,
        timestamp: Date.now()
      });
    }
    return existed;
  }
  /**
   * Check if an annotation exists for an element.
   */
  has(elementId) {
    return this.store.has(elementId);
  }
  /**
   * Get the number of stored annotations.
   */
  get count() {
    return this.store.size;
  }
  /**
   * Clear all annotations.
   */
  clear() {
    this.store.clear();
    this.emit({
      type: "annotation:cleared",
      timestamp: Date.now()
    });
  }
  /**
   * Import annotations from a config object.
   *
   * Merges with existing annotations (new values overwrite per element ID).
   *
   * @returns Number of annotations imported
   *
   * @example
   * ```ts
   * const config: AnnotationConfig = {
   *   version: '1.0.0',
   *   annotations: {
   *     'btn-1': { description: 'Submit button', tags: ['form'] },
   *     'input-1': { description: 'Name field' },
   *   },
   * };
   * const count = store.importConfig(config); // 2
   * ```
   */
  importConfig(config) {
    let count = 0;
    for (const [id, annotation] of Object.entries(config.annotations)) {
      this.store.set(id, {
        ...annotation,
        updatedAt: annotation.updatedAt ?? Date.now()
      });
      count++;
    }
    this.emit({
      type: "annotation:imported",
      count,
      timestamp: Date.now()
    });
    return count;
  }
  /**
   * Export all annotations as a config object.
   *
   * The returned object can be serialized to JSON and saved to a file,
   * then later re-imported with {@link importConfig}.
   *
   * @param metadata - Optional metadata to include (appName, description, etc.)
   * @returns AnnotationConfig with all current annotations
   *
   * @example
   * ```ts
   * const config = store.exportConfig({ appName: 'MyApp' });
   * // config.version === '1.0.0'
   * // config.annotations === { 'btn-1': { ... }, 'input-1': { ... } }
   * // config.metadata === { appName: 'MyApp', exportedAt: 1706900000000 }
   *
   * // Save to file
   * fs.writeFileSync('annotations.json', JSON.stringify(config, null, 2));
   * ```
   */
  exportConfig(metadata) {
    return {
      version: ANNOTATION_CONFIG_VERSION,
      annotations: this.getAll(),
      metadata: {
        ...metadata,
        exportedAt: Date.now()
      }
    };
  }
  /**
   * Compute annotation coverage against a set of known element IDs.
   *
   * Compares the store's annotations against the provided list of element IDs
   * to determine what percentage of elements have been annotated.
   *
   * @param allElementIds - Array of all known element IDs in the UI
   * @returns Coverage statistics including percentages and lists of annotated/unannotated IDs
   *
   * @example
   * ```ts
   * store.set('btn-1', { description: 'Submit' });
   * store.set('input-1', { description: 'Name' });
   *
   * const coverage = store.getCoverage(['btn-1', 'input-1', 'input-2', 'link-1']);
   * // coverage.totalElements === 4
   * // coverage.annotatedElements === 2
   * // coverage.coveragePercent === 50
   * // coverage.annotatedIds === ['btn-1', 'input-1']
   * // coverage.unannotatedIds === ['input-2', 'link-1']
   * ```
   */
  getCoverage(allElementIds) {
    const annotatedIds = [];
    const unannotatedIds = [];
    for (const id of allElementIds) {
      if (this.store.has(id)) {
        annotatedIds.push(id);
      } else {
        unannotatedIds.push(id);
      }
    }
    const total = allElementIds.length;
    return {
      totalElements: total,
      annotatedElements: annotatedIds.length,
      coveragePercent: total > 0 ? annotatedIds.length / total * 100 : 0,
      annotatedIds,
      unannotatedIds,
      timestamp: Date.now()
    };
  }
  /**
   * Subscribe to annotation events.
   *
   * The listener is called whenever annotations are set, deleted, imported,
   * or cleared. Returns an unsubscribe function to stop listening.
   *
   * @param listener - Callback function receiving {@link AnnotationEvent} objects
   * @returns Unsubscribe function - call it to remove the listener
   *
   * @example
   * ```ts
   * const unsubscribe = store.on((event) => {
   *   if (event.type === 'annotation:set') {
   *     console.log(`Element ${event.elementId} annotated:`, event.annotation);
   *   }
   * });
   *
   * store.set('btn-1', { description: 'Submit' });
   * // Logs: "Element btn-1 annotated: { description: 'Submit', updatedAt: ... }"
   *
   * unsubscribe(); // Stop listening
   * ```
   */
  on(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /**
   * Emit an event to all listeners.
   */
  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
};
var globalStore = null;
function getGlobalAnnotationStore() {
  if (!globalStore) {
    globalStore = new AnnotationStore();
  }
  return globalStore;
}
var overlayStyles = {
  position: "fixed",
  pointerEvents: "none",
  zIndex: 999999,
  border: "2px solid #3b82f6",
  backgroundColor: "rgba(59, 130, 246, 0.1)",
  transition: "all 0.1s ease-out"
};
var labelStyles = {
  position: "absolute",
  top: "-24px",
  left: "0",
  padding: "2px 8px",
  backgroundColor: "#3b82f6",
  color: "white",
  fontSize: "12px",
  fontFamily: "monospace",
  whiteSpace: "nowrap",
  borderRadius: "4px 4px 0 0"
};
var panelStyles = {
  position: "fixed",
  bottom: "20px",
  right: "20px",
  width: "400px",
  maxHeight: "500px",
  overflow: "auto",
  backgroundColor: "#1f2937",
  color: "#f3f4f6",
  borderRadius: "8px",
  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
  fontFamily: "monospace",
  fontSize: "12px",
  zIndex: 999998
};
var headerStyles = {
  padding: "12px 16px",
  backgroundColor: "#111827",
  borderBottom: "1px solid #374151",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderRadius: "8px 8px 0 0"
};
var sectionStyles = {
  padding: "12px 16px",
  borderBottom: "1px solid #374151"
};
var labelKeyStyles = {
  color: "#9ca3af",
  marginRight: "8px"
};
var valueStyles = {
  color: "#60a5fa"
};
function getElementState(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const state = {
    visible: rect.width > 0 && rect.height > 0 && style.display !== "none",
    enabled: !("disabled" in element && element.disabled),
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
  }
  return state;
}
function InspectorOverlay({ bounds, label }) {
  return /* @__PURE__ */ jsxRuntime.jsx(
    "div",
    {
      style: {
        ...overlayStyles,
        left: bounds.left + window.scrollX,
        top: bounds.top + window.scrollY,
        width: bounds.width,
        height: bounds.height
      },
      children: /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelStyles, children: label })
    }
  );
}
function InfoPanel({ element, onClose, registeredElement }) {
  if (!element) return null;
  const identifier = createElementIdentifier(element);
  const state = getElementState(element);
  const bestId = getBestIdentifier(element);
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: panelStyles, children: [
    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: headerStyles, children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: { fontWeight: "bold", color: "#60a5fa" }, children: "UI Bridge Inspector" }),
      /* @__PURE__ */ jsxRuntime.jsx(
        "button",
        {
          onClick: onClose,
          style: {
            background: "none",
            border: "none",
            color: "#9ca3af",
            cursor: "pointer",
            fontSize: "16px"
          },
          children: "\xD7"
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: sectionStyles, children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginBottom: "8px", fontWeight: "bold", color: "#f3f4f6" }, children: "Element" }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Tag:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: valueStyles, children: element.tagName.toLowerCase() })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Best ID:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: valueStyles, children: bestId })
      ] }),
      identifier.testId && /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "data-testid:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: valueStyles, children: identifier.testId })
      ] }),
      identifier.htmlId && /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "id:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: valueStyles, children: identifier.htmlId })
      ] }),
      registeredElement && /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Registered:" }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: { color: "#10b981" }, children: [
          "Yes (",
          registeredElement.type,
          ")"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: sectionStyles, children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginBottom: "8px", fontWeight: "bold", color: "#f3f4f6" }, children: "State" }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Visible:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: state.visible ? "#10b981" : "#ef4444" }, children: state.visible ? "Yes" : "No" })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Enabled:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: state.enabled ? "#10b981" : "#ef4444" }, children: state.enabled ? "Yes" : "No" })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Focused:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: state.focused ? "#10b981" : "#9ca3af" }, children: state.focused ? "Yes" : "No" })
      ] }),
      state.value !== void 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Value:" }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: valueStyles, children: [
          '"',
          state.value,
          '"'
        ] })
      ] }),
      state.checked !== void 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Checked:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: state.checked ? "#10b981" : "#9ca3af" }, children: state.checked ? "Yes" : "No" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: sectionStyles, children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginBottom: "8px", fontWeight: "bold", color: "#f3f4f6" }, children: "Bounds" }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Position:" }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: valueStyles, children: [
          "(",
          Math.round(state.rect.x),
          ", ",
          Math.round(state.rect.y),
          ")"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Size:" }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { style: valueStyles, children: [
          Math.round(state.rect.width),
          " \xD7 ",
          Math.round(state.rect.height)
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { ...sectionStyles, borderBottom: "none" }, children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginBottom: "8px", fontWeight: "bold", color: "#f3f4f6" }, children: "Selectors" }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { wordBreak: "break-all", marginBottom: "4px" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "CSS:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: valueStyles, children: identifier.selector })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { wordBreak: "break-all" }, children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "XPath:" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { style: valueStyles, children: identifier.xpath })
      ] })
    ] }),
    registeredElement && registeredElement.actions.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: sectionStyles, children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginBottom: "8px", fontWeight: "bold", color: "#f3f4f6" }, children: "Actions" }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px" }, children: registeredElement.actions.map((action) => /* @__PURE__ */ jsxRuntime.jsx(
        "span",
        {
          style: {
            padding: "2px 8px",
            backgroundColor: "#374151",
            borderRadius: "4px",
            color: "#60a5fa"
          },
          children: action
        },
        action
      )) })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsx(AnnotationSection, { elementId: bestId })
  ] });
}
function AnnotationSection({ elementId }) {
  const annotation = getGlobalAnnotationStore().get(elementId);
  if (!annotation) return null;
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { ...sectionStyles, borderBottom: "none" }, children: [
    /* @__PURE__ */ jsxRuntime.jsx("div", { style: { marginBottom: "8px", fontWeight: "bold", color: "#f3f4f6" }, children: "Annotation" }),
    annotation.description && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: "4px" }, children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Description:" }),
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: valueStyles, children: annotation.description })
    ] }),
    annotation.purpose && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: "4px" }, children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Purpose:" }),
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: valueStyles, children: annotation.purpose })
    ] }),
    annotation.notes && /* @__PURE__ */ jsxRuntime.jsxs("div", { style: { marginBottom: "4px" }, children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Notes:" }),
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: { color: "#fbbf24" }, children: annotation.notes })
    ] }),
    annotation.tags && annotation.tags.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: labelKeyStyles, children: "Tags:" }),
      /* @__PURE__ */ jsxRuntime.jsx("span", { style: { display: "inline-flex", flexWrap: "wrap", gap: "4px" }, children: annotation.tags.map((tag) => /* @__PURE__ */ jsxRuntime.jsx(
        "span",
        {
          style: {
            padding: "1px 6px",
            backgroundColor: "#1e3a5f",
            borderRadius: "4px",
            color: "#93c5fd",
            fontSize: "11px"
          },
          children: tag
        },
        tag
      )) })
    ] })
  ] });
}
function useInspector(options = {}) {
  const [active, setActive] = react.useState(false);
  const [hoveredElement, setHoveredElement] = react.useState(null);
  const [selectedElement, setSelectedElement] = react.useState(null);
  const shortcut = react.useMemo(
    () => options.shortcut ?? { key: "i", ctrl: true, shift: true },
    [options.shortcut]
  );
  const toggle = react.useCallback(() => {
    setActive((prev) => !prev);
    if (active) {
      setHoveredElement(null);
      setSelectedElement(null);
    }
  }, [active]);
  react.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key.toLowerCase() === shortcut.key && e.ctrlKey === !!shortcut.ctrl && e.shiftKey === !!shortcut.shift && e.altKey === !!shortcut.alt) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle, shortcut]);
  react.useEffect(() => {
    if (!active) return;
    const handleMouseOver = (e) => {
      const target = e.target;
      if (target && target !== hoveredElement) {
        setHoveredElement(target);
      }
    };
    const handleClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target;
      setSelectedElement(target);
      options.onSelect?.(target);
    };
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [active, hoveredElement, options]);
  const displayElement = selectedElement || hoveredElement;
  const bounds = displayElement?.getBoundingClientRect() || null;
  const registeredElement = displayElement ? options.getRegisteredElement?.(displayElement) : void 0;
  return {
    active,
    toggle,
    hoveredElement,
    selectedElement,
    setSelectedElement,
    displayElement,
    bounds,
    registeredElement,
    clearSelection: () => {
      setSelectedElement(null);
    }
  };
}
function Inspector({ getRegisteredElement, initialActive }) {
  const inspector = useInspector({
    getRegisteredElement
  });
  react.useEffect(() => {
    if (initialActive && !inspector.active) {
      inspector.toggle();
    }
  }, [initialActive]);
  if (!inspector.active) return null;
  return /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
    inspector.bounds && /* @__PURE__ */ jsxRuntime.jsx(
      InspectorOverlay,
      {
        bounds: inspector.bounds,
        label: inspector.displayElement ? getBestIdentifier(inspector.displayElement) : ""
      }
    ),
    inspector.selectedElement && /* @__PURE__ */ jsxRuntime.jsx(
      InfoPanel,
      {
        element: inspector.selectedElement,
        onClose: inspector.clearSelection,
        registeredElement: inspector.registeredElement
      }
    )
  ] });
}

// src/debug/browser-capture-types.ts
var DEFAULT_CAPTURE_CONFIG = {
  console: true,
  network: true,
  navigation: true,
  longTasks: true,
  longAnimationFrames: true,
  resourceErrors: true,
  wsDisconnections: true,
  hmr: true,
  frameworkOverlays: true,
  webVitals: false,
  memory: false,
  memoryIntervalMs: 3e4,
  freezeDetector: false,
  freezeThresholdMs: 3e3,
  freezeIntervalMs: 200,
  domMetrics: false,
  domMetricsIntervalMs: 1e4,
  maxEntries: 200
};

// src/debug/captures/console.ts
function argsToMessage(args) {
  return args.map((a) => {
    if (a instanceof Error) return a.message;
    if (typeof a === "string") return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }).join(" ");
}
function extractStack(args) {
  const err = args.find((a) => a instanceof Error);
  return err?.stack;
}
function makeEvent(level, message, stack) {
  return {
    type: "console",
    timestamp: Date.now(),
    url: typeof window !== "undefined" ? window.location.href : "",
    level,
    message,
    stack
  };
}
function installConsoleCapture(emit) {
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args) => {
    emit(makeEvent("error", argsToMessage(args), extractStack(args)));
    originalError.apply(console, args);
  };
  console.warn = (...args) => {
    emit(makeEvent("warn", argsToMessage(args), extractStack(args)));
    originalWarn.apply(console, args);
  };
  const rejectionHandler = (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? "Unhandled rejection");
    const stack = reason instanceof Error ? reason.stack : void 0;
    emit(makeEvent("unhandledrejection", message, stack));
  };
  if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", rejectionHandler);
  }
  return () => {
    console.error = originalError;
    console.warn = originalWarn;
    if (typeof window !== "undefined") {
      window.removeEventListener("unhandledrejection", rejectionHandler);
    }
  };
}

// src/debug/captures/network.ts
var DEFAULT_IGNORE = ["/api/dev-debug/", "/api/ui-bridge/", "localhost:9876"];
function installNetworkCapture(emit, options) {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return () => {
    };
  }
  const originalFetch = window.fetch;
  const ignorePatterns = options?.ignorePatterns ?? DEFAULT_IGNORE;
  function shouldIgnore(url) {
    return ignorePatterns.some((p) => url.includes(p));
  }
  function getMethod2(input, init) {
    if (init?.method) return init.method.toUpperCase();
    if (input instanceof Request) return input.method.toUpperCase();
    return "GET";
  }
  function getUrl2(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input instanceof Request) return input.url;
    return String(input);
  }
  window.fetch = async function patchedFetch(input, init) {
    const requestUrl = getUrl2(input);
    if (shouldIgnore(requestUrl)) {
      return originalFetch.call(window, input, init);
    }
    const method = getMethod2(input, init);
    const start = performance.now();
    try {
      const response = await originalFetch.call(window, input, init);
      const durationMs = Math.round(performance.now() - start);
      if (response.status >= 400) {
        const event = {
          type: "network",
          timestamp: Date.now(),
          url: typeof window !== "undefined" ? window.location.href : "",
          method,
          requestUrl,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          kind: "http-error"
        };
        emit(event);
      }
      return response;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const errorMessage = err instanceof Error ? err.message : String(err);
      let kind = "network-error";
      if (err instanceof DOMException && err.name === "AbortError") {
        kind = "abort";
      } else if (errorMessage.includes("CORS") || errorMessage.includes("cross-origin")) {
        kind = "cors";
      } else if (errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
        kind = "timeout";
      }
      const event = {
        type: "network",
        timestamp: Date.now(),
        url: typeof window !== "undefined" ? window.location.href : "",
        method,
        requestUrl,
        durationMs,
        kind,
        errorMessage
      };
      emit(event);
      throw err;
    }
  };
  return () => {
    window.fetch = originalFetch;
  };
}

// src/debug/captures/navigation.ts
function installNavigationCapture(emit) {
  if (typeof window === "undefined" || typeof history === "undefined") {
    return () => {
    };
  }
  let lastUrl = window.location.href;
  function emitNav(to, trigger) {
    const from = lastUrl;
    lastUrl = to;
    if (from === to) return;
    emit({
      type: "navigation",
      timestamp: Date.now(),
      url: to,
      from,
      to,
      trigger
    });
  }
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    emitNav(window.location.href, "pushState");
  };
  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    emitNav(window.location.href, "replaceState");
  };
  const popstateHandler = () => {
    emitNav(window.location.href, "popstate");
  };
  window.addEventListener("popstate", popstateHandler);
  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", popstateHandler);
  };
}

// src/debug/captures/long-tasks.ts
function installLongTaskCapture(emit) {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return () => {
    };
  }
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        emit({
          type: "long-task",
          timestamp: Date.now(),
          url: window.location.href,
          durationMs: Math.round(entry.duration)
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    return () => {
      observer.disconnect();
    };
  } catch {
    return () => {
    };
  }
}

// src/debug/captures/resource-errors.ts
var TRACKED_TAGS = /* @__PURE__ */ new Set(["IMG", "SCRIPT", "LINK"]);
function installResourceErrorCapture(emit) {
  if (typeof window === "undefined") {
    return () => {
    };
  }
  const handler = (event) => {
    const target = event.target;
    if (!target || !target.tagName) return;
    if (!TRACKED_TAGS.has(target.tagName)) return;
    const resourceUrl = target.src || target.src || target.href || "";
    if (!resourceUrl) return;
    emit({
      type: "resource-error",
      timestamp: Date.now(),
      url: window.location.href,
      resourceUrl,
      tagName: target.tagName
    });
  };
  window.addEventListener("error", handler, true);
  return () => {
    window.removeEventListener("error", handler, true);
  };
}

// src/debug/captures/web-vitals.ts
function installWebVitalsCapture(emit) {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return () => {
    };
  }
  const observers = [];
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        emit({
          type: "web-vital",
          timestamp: Date.now(),
          url: window.location.href,
          metric: "LCP",
          value: Math.round(last.startTime)
        });
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    observers.push(lcpObserver);
  } catch {
  }
  try {
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value ?? 0;
        }
      }
      emit({
        type: "web-vital",
        timestamp: Date.now(),
        url: window.location.href,
        metric: "CLS",
        value: Math.round(clsValue * 1e3) / 1e3
      });
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
    observers.push(clsObserver);
  } catch {
  }
  try {
    let worstInp = 0;
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = entry.duration;
        if (duration > worstInp) {
          worstInp = duration;
          emit({
            type: "web-vital",
            timestamp: Date.now(),
            url: window.location.href,
            metric: "INP",
            value: Math.round(duration)
          });
        }
      }
    });
    inpObserver.observe({
      type: "event",
      durationThreshold: 104,
      buffered: true
    });
    observers.push(inpObserver);
  } catch {
  }
  return () => {
    for (const obs of observers) {
      obs.disconnect();
    }
  };
}

// src/debug/captures/memory.ts
function installMemoryCapture(emit, intervalMs = 3e4) {
  if (typeof window === "undefined") {
    return () => {
    };
  }
  const perf = performance;
  if (!perf.memory) {
    return () => {
    };
  }
  const tick = () => {
    const mem = perf.memory;
    if (!mem) return;
    emit({
      type: "memory",
      timestamp: Date.now(),
      url: window.location.href,
      usedJSHeapSize: mem.usedJSHeapSize,
      totalJSHeapSize: mem.totalJSHeapSize,
      jsHeapSizeLimit: mem.jsHeapSizeLimit
    });
  };
  tick();
  const id = setInterval(tick, intervalMs);
  return () => {
    clearInterval(id);
  };
}

// src/debug/captures/hmr.ts
var HMR_PATH_PATTERNS = ["/_next/webpack-hmr", "/__turbopack_hmr", "/_next/turbopack-hmr"];
function isHmrUrl(url) {
  return HMR_PATH_PATTERNS.some((p) => url.includes(p));
}
function makeEvent2(level, message, moduleName, loc) {
  return {
    type: "hmr",
    level,
    message,
    moduleName,
    loc,
    timestamp: Date.now(),
    url: typeof window !== "undefined" ? window.location.href : ""
  };
}
function processHmrMessage(data, emit) {
  try {
    const msg = JSON.parse(data);
    if (Array.isArray(msg.errors)) {
      for (const err of msg.errors) {
        emit(
          makeEvent2(
            "error",
            typeof err === "string" ? err : err.message ?? String(err),
            err.moduleName ?? err.moduleIdentifier,
            err.loc ? String(err.loc) : void 0
          )
        );
      }
    }
    if (Array.isArray(msg.warnings)) {
      for (const warn of msg.warnings) {
        emit(
          makeEvent2(
            "warning",
            typeof warn === "string" ? warn : warn.message ?? String(warn),
            warn.moduleName ?? warn.moduleIdentifier,
            warn.loc ? String(warn.loc) : void 0
          )
        );
      }
    }
    if (msg.action === "serverError" && msg.errorJSON) {
      try {
        const err = JSON.parse(msg.errorJSON);
        emit(makeEvent2("error", err.message ?? String(err)));
      } catch {
        emit(makeEvent2("error", msg.errorJSON));
      }
    }
    if ((msg.action === "turbopack-message" || msg.type === "turbopack-message") && msg.data?.diagnostics) {
      for (const diag of msg.data.diagnostics) {
        emit(
          makeEvent2(
            diag.category === "warning" ? "warning" : "error",
            diag.message ?? String(diag),
            diag.filePath,
            diag.line != null ? `${diag.line}:${diag.column ?? 0}` : void 0
          )
        );
      }
    }
  } catch {
  }
}
function installWebSocketCapture(emit, cleanups) {
  if (!window.WebSocket) return;
  const OriginalWebSocket = window.WebSocket;
  const trackedSockets = [];
  const PatchedWebSocket = function(url, protocols) {
    const ws = new OriginalWebSocket(url, protocols);
    const urlStr = typeof url === "string" ? url : url.toString();
    if (isHmrUrl(urlStr)) {
      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          processHmrMessage(event.data, emit);
        }
      });
      trackedSockets.push(ws);
    }
    return ws;
  };
  PatchedWebSocket.prototype = OriginalWebSocket.prototype;
  Object.defineProperty(PatchedWebSocket, "CONNECTING", { value: OriginalWebSocket.CONNECTING });
  Object.defineProperty(PatchedWebSocket, "OPEN", { value: OriginalWebSocket.OPEN });
  Object.defineProperty(PatchedWebSocket, "CLOSING", { value: OriginalWebSocket.CLOSING });
  Object.defineProperty(PatchedWebSocket, "CLOSED", { value: OriginalWebSocket.CLOSED });
  window.WebSocket = PatchedWebSocket;
  cleanups.push(() => {
    window.WebSocket = OriginalWebSocket;
    for (const ws of trackedSockets) {
      ws.close();
    }
    trackedSockets.length = 0;
  });
}
function installEventSourceCapture(emit, cleanups) {
  if (!window.EventSource) return;
  const OriginalEventSource = window.EventSource;
  const trackedSources = [];
  const messageHandler = (event) => {
    if (typeof event.data === "string") {
      processHmrMessage(event.data, emit);
    }
  };
  const PatchedEventSource = function(url, init) {
    const es = new OriginalEventSource(url, init);
    const urlStr = typeof url === "string" ? url : url.toString();
    if (isHmrUrl(urlStr)) {
      es.addEventListener("message", messageHandler);
      trackedSources.push(es);
    }
    return es;
  };
  PatchedEventSource.prototype = OriginalEventSource.prototype;
  Object.defineProperty(PatchedEventSource, "CONNECTING", {
    value: OriginalEventSource.CONNECTING
  });
  Object.defineProperty(PatchedEventSource, "OPEN", { value: OriginalEventSource.OPEN });
  Object.defineProperty(PatchedEventSource, "CLOSED", { value: OriginalEventSource.CLOSED });
  window.EventSource = PatchedEventSource;
  cleanups.push(() => {
    window.EventSource = OriginalEventSource;
    for (const es of trackedSources) {
      es.close();
    }
    trackedSources.length = 0;
  });
}
function installHmrCapture(emit) {
  if (typeof window === "undefined") return () => {
  };
  const cleanups = [];
  installWebSocketCapture(emit, cleanups);
  installEventSourceCapture(emit, cleanups);
  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

// src/debug/captures/long-animation-frames.ts
function installLoafCapture(emit) {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return () => {
    };
  }
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const scripts = (entry.scripts ?? []).map((s) => {
          const script = s;
          return {
            invoker: script.invoker ?? "",
            sourceURL: script.sourceURL ?? "",
            sourceFunctionName: script.sourceFunctionName ?? "",
            sourceCharPosition: script.sourceCharPosition ?? 0,
            duration: Math.round(script.duration ?? 0)
          };
        });
        emit({
          type: "long-animation-frame",
          timestamp: Date.now(),
          url: window.location.href,
          durationMs: Math.round(entry.duration),
          blockingDurationMs: Math.round(
            entry.blockingDuration ?? 0
          ),
          scripts
        });
      }
    });
    observer.observe({ type: "long-animation-frame", buffered: true });
    return () => {
      observer.disconnect();
    };
  } catch {
    return () => {
    };
  }
}

// src/debug/captures/framework-overlays.ts
function detectNextjsOverlay() {
  const portal = document.querySelector("nextjs-portal");
  if (portal?.shadowRoot) {
    const dialog = portal.shadowRoot.querySelector("[data-nextjs-dialog]");
    if (dialog) {
      const title = portal.shadowRoot.querySelector("[data-nextjs-dialog-header] h1, [data-nextjs-dialog-header] h2")?.textContent?.trim() || portal.shadowRoot.querySelector("h1, h2")?.textContent?.trim();
      const body = portal.shadowRoot.querySelector("[data-nextjs-dialog-body]")?.textContent?.trim() || portal.shadowRoot.querySelector("p")?.textContent?.trim();
      const fileRef = portal.shadowRoot.querySelector("[data-nextjs-codeframe] div")?.textContent?.trim();
      return {
        framework: "nextjs",
        visible: true,
        title: title || "Next.js Error",
        message: truncate(body, 500),
        file: fileRef
      };
    }
    const toast = portal.shadowRoot.querySelector("[data-nextjs-toast]");
    if (toast) {
      return {
        framework: "nextjs",
        visible: true,
        title: "Next.js Error Toast",
        message: truncate(toast.textContent?.trim(), 300)
      };
    }
  }
  const buildError = document.getElementById("__next-build-error");
  if (buildError) {
    return {
      framework: "nextjs",
      visible: true,
      title: "Next.js Build Error",
      message: truncate(buildError.textContent?.trim(), 500)
    };
  }
  const errorLabel = document.querySelector('[id*="nextjs__container_errors"]');
  if (errorLabel) {
    return {
      framework: "nextjs",
      visible: true,
      title: "Next.js Error",
      message: truncate(errorLabel.closest("div")?.textContent?.trim(), 500)
    };
  }
  return null;
}
function detectViteOverlay() {
  const overlay = document.querySelector("vite-error-overlay");
  if (!overlay) return null;
  const style = window.getComputedStyle(overlay);
  if (style.display === "none" || style.visibility === "hidden") return null;
  const shadow = overlay.shadowRoot;
  let message;
  let title;
  let file;
  if (shadow) {
    title = shadow.querySelector(".message-body")?.textContent?.trim() || shadow.querySelector("h1, h2, .message")?.textContent?.trim();
    message = shadow.querySelector(".stack, pre")?.textContent?.trim();
    file = shadow.querySelector(".file, .tip code")?.textContent?.trim();
  } else {
    title = overlay.querySelector("h1, h2, .message")?.textContent?.trim();
    message = overlay.querySelector("pre, .stack")?.textContent?.trim();
  }
  return {
    framework: "vite",
    visible: true,
    title: title || "Vite Error",
    message: truncate(message, 500),
    file
  };
}
function detectReactErrorBoundary() {
  const explicit = document.querySelector("[data-react-error-boundary]");
  if (explicit) {
    const style = window.getComputedStyle(explicit);
    if (style.display !== "none" && style.visibility !== "hidden") {
      return {
        framework: "react-error-boundary",
        visible: true,
        title: "React Error Boundary",
        message: truncate(explicit.textContent?.trim(), 500)
      };
    }
  }
  const alerts = document.querySelectorAll('[role="alert"]');
  for (const alert of alerts) {
    const text = alert.textContent?.trim() || "";
    const rect = alert.getBoundingClientRect();
    const isLargeEnough = rect.width > 200 && rect.height > 100;
    const hasErrorText = /something went wrong|error occurred|unexpected error|application error/i.test(text);
    if (isLargeEnough && hasErrorText) {
      return {
        framework: "react-error-boundary",
        visible: true,
        title: "React Error Boundary",
        message: truncate(text, 500)
      };
    }
  }
  return null;
}
function truncate(s, max) {
  if (!s) return void 0;
  return s.length > max ? s.slice(0, max) + "..." : s;
}
function getActiveOverlays() {
  if (typeof document === "undefined") return [];
  const overlays = [];
  const nextjs = detectNextjsOverlay();
  if (nextjs) overlays.push(nextjs);
  const vite = detectViteOverlay();
  if (vite) overlays.push(vite);
  const react = detectReactErrorBoundary();
  if (react) overlays.push(react);
  return overlays;
}
function installFrameworkOverlayCapture(emit) {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") {
    return () => {
    };
  }
  const reported = /* @__PURE__ */ new Set();
  function check() {
    let overlays;
    try {
      overlays = getActiveOverlays();
    } catch {
      return;
    }
    const currentKeys = /* @__PURE__ */ new Set();
    for (const overlay of overlays) {
      const key = overlay.framework;
      currentKeys.add(key);
      if (!reported.has(key)) {
        reported.add(key);
        emit({
          type: "console",
          level: "error",
          timestamp: Date.now(),
          url: typeof window !== "undefined" ? window.location.href : "",
          message: `[${overlay.framework} error overlay] ${overlay.title || "Error"}${overlay.message ? ": " + overlay.message.slice(0, 200) : ""}`,
          stack: overlay.file ? `at ${overlay.file}` : void 0
        });
      }
    }
    for (const key of reported) {
      if (!currentKeys.has(key)) {
        reported.delete(key);
      }
    }
  }
  check();
  const observer = new MutationObserver(() => {
    requestAnimationFrame(check);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  return () => {
    observer.disconnect();
    reported.clear();
  };
}

// src/debug/captures/freeze-detector.ts
function installFreezeDetectorCapture(emit, intervalMs = 200, thresholdMs = 3e3) {
  if (typeof window === "undefined") {
    return () => {
    };
  }
  let lastTick = performance.now();
  const id = setInterval(() => {
    const now = performance.now();
    const gap = now - lastTick;
    if (gap > thresholdMs) {
      emit({
        type: "freeze",
        timestamp: Date.now(),
        url: window.location.href,
        gapMs: Math.round(gap),
        expectedMs: intervalMs
      });
    }
    lastTick = now;
  }, intervalMs);
  return () => {
    clearInterval(id);
  };
}

// src/debug/captures/dom-metrics.ts
function countAndEmit(emit) {
  const schedule = typeof requestIdleCallback === "function" ? requestIdleCallback : (cb) => setTimeout(cb, 0);
  schedule(() => {
    const nodeCount = document.querySelectorAll("*").length;
    const listenerCount = document.querySelectorAll(
      "button, a, input, select, textarea, [onclick], [onchange], [onkeydown]"
    ).length;
    emit({
      type: "dom-metrics",
      timestamp: Date.now(),
      url: window.location.href,
      nodeCount,
      listenerCount
    });
  });
}
function installDomMetricsCapture(emit, intervalMs = 1e4) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {
    };
  }
  countAndEmit(emit);
  const id = setInterval(() => {
    countAndEmit(emit);
  }, intervalMs);
  return () => {
    clearInterval(id);
  };
}

// src/debug/memory-trend.ts
var MAX_SNAPSHOTS = 20;
var CONSECUTIVE_GROWTH_THRESHOLD = 5;
var CRITICAL_HEAP_USAGE = 0.85;
var MemoryTrendAnalyzer = class {
  constructor() {
    this.snapshots = [];
    this.latestTrend = null;
  }
  addSnapshot(timestamp, usedJSHeapSize, jsHeapSizeLimit) {
    this.snapshots.push({ timestamp, usedJSHeapSize, jsHeapSizeLimit });
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(-MAX_SNAPSHOTS);
    }
    const result = this.analyze();
    this.latestTrend = result;
    return result;
  }
  getLatestTrend() {
    return this.latestTrend;
  }
  reset() {
    this.snapshots = [];
    this.latestTrend = null;
  }
  analyze() {
    const snaps = this.snapshots;
    if (snaps.length === 0) {
      return { trend: "stable", growthRate: 0, consecutiveGrowth: 0, heapUsagePercent: 0 };
    }
    const latest = snaps[snaps.length - 1];
    const heapUsagePercent = latest.jsHeapSizeLimit > 0 ? latest.usedJSHeapSize / latest.jsHeapSizeLimit : 0;
    let consecutiveGrowth = 0;
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i].usedJSHeapSize > snaps[i - 1].usedJSHeapSize) {
        consecutiveGrowth++;
      } else {
        break;
      }
    }
    let growthRate = 0;
    if (snaps.length >= 2) {
      const first = snaps[0];
      const timeDeltaS = (latest.timestamp - first.timestamp) / 1e3;
      if (timeDeltaS > 0) {
        growthRate = (latest.usedJSHeapSize - first.usedJSHeapSize) / timeDeltaS;
      }
    }
    let trend = "stable";
    if (heapUsagePercent > CRITICAL_HEAP_USAGE) {
      trend = "critical";
    } else if (consecutiveGrowth >= CONSECUTIVE_GROWTH_THRESHOLD) {
      trend = "growing";
    }
    return { trend, growthRate, consecutiveGrowth, heapUsagePercent };
  }
};

// src/debug/browser-capture.ts
var DEFAULT_BUFFER_CAPACITY = 250;
function resolveInitialCapacity(config) {
  if (typeof config.maxEntries === "number" && config.maxEntries > 0) {
    return config.maxEntries;
  }
  const env = globalThis.process?.env ?? null;
  const raw = env?.QONTINUI_UI_BRIDGE_ERROR_BUFFER_CAPACITY;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_BUFFER_CAPACITY;
}
var BrowserEventCapture = class {
  constructor(config) {
    this.buffer = [];
    /**
     * Parallel entry buffer (event + monotonic id). Kept in lockstep with
     * `buffer` — both are always the same length, with matching indices.
     * Storing id alongside rather than on the event itself avoids mutating
     * the event object (which the capture sub-modules freeze in some cases)
     * and avoids a WeakMap allocation per push.
     */
    this.entries = [];
    /** Monotonic counter — never reset, even on clear(). */
    this.nextId = 1;
    /** Running total of entries evicted from the buffer. */
    this.droppedCount = 0;
    this.installed = false;
    this.cleanups = [];
    this.onEvent = null;
    this.memoryTrend = null;
    this.config = config ?? {};
    this.maxEntries = resolveInitialCapacity(this.config);
  }
  /**
   * Override the buffer capacity at runtime. Useful when the runner knows
   * a high error rate is expected (e.g. driving a noisy external app) and
   * the env-var path isn't available (browser context).
   *
   * If the new capacity is smaller than the current buffer length, the
   * oldest entries are trimmed immediately and counted in `droppedCount`.
   */
  setBufferCapacity(n) {
    if (!Number.isFinite(n) || n <= 0) return;
    this.maxEntries = Math.floor(n);
    this.trim();
  }
  setOnEvent(cb) {
    this.onEvent = cb;
  }
  /**
   * Install all enabled capture sub-modules.
   * Safe to call multiple times (no-ops if already installed).
   */
  install() {
    if (this.installed) return;
    const cfg = { ...DEFAULT_CAPTURE_CONFIG, ...this.config };
    const emit = (event) => {
      if (event.type === "memory" && this.memoryTrend) {
        this.memoryTrend.addSnapshot(event.timestamp, event.usedJSHeapSize, event.jsHeapSizeLimit);
      }
      const id = this.nextId++;
      this.buffer.push(event);
      this.entries.push({ id, event });
      this.trim();
      this.onEvent?.(event);
    };
    if (cfg.console) {
      this.cleanups.push(installConsoleCapture(emit));
    }
    if (cfg.network) {
      this.cleanups.push(installNetworkCapture(emit, cfg.networkOptions));
    }
    if (cfg.navigation) {
      this.cleanups.push(installNavigationCapture(emit));
    }
    if (cfg.longTasks) {
      this.cleanups.push(installLongTaskCapture(emit));
    }
    if (cfg.longAnimationFrames) {
      this.cleanups.push(installLoafCapture(emit));
    }
    if (cfg.resourceErrors) {
      this.cleanups.push(installResourceErrorCapture(emit));
    }
    if (cfg.webVitals) {
      this.cleanups.push(installWebVitalsCapture(emit));
    }
    if (cfg.memory) {
      this.memoryTrend = new MemoryTrendAnalyzer();
      this.cleanups.push(installMemoryCapture(emit, cfg.memoryIntervalMs));
    }
    if (cfg.hmr) {
      this.cleanups.push(installHmrCapture(emit));
    }
    if (cfg.frameworkOverlays) {
      this.cleanups.push(installFrameworkOverlayCapture(emit));
    }
    if (cfg.freezeDetector) {
      this.cleanups.push(
        installFreezeDetectorCapture(emit, cfg.freezeIntervalMs, cfg.freezeThresholdMs)
      );
    }
    if (cfg.domMetrics) {
      this.cleanups.push(installDomMetricsCapture(emit, cfg.domMetricsIntervalMs));
    }
    this.installed = true;
  }
  /**
   * Uninstall all capture sub-modules.
   */
  uninstall() {
    if (!this.installed) return;
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
    this.installed = false;
  }
  // -------------------------------------------------------------------------
  // Manual event reporting (for events that can't be auto-captured)
  // -------------------------------------------------------------------------
  reportReactError(error, errorInfo) {
    const event = {
      type: "react-error",
      timestamp: Date.now(),
      url: typeof window !== "undefined" ? window.location.href : "",
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    };
    const id = this.nextId++;
    this.buffer.push(event);
    this.entries.push({ id, event });
    this.trim();
    this.onEvent?.(event);
  }
  reportWsStateChange(prev, next, reconnectAttempt) {
    if (next === "disconnected" || next === "error") {
      const event = {
        type: "ws-disconnection",
        timestamp: Date.now(),
        url: typeof window !== "undefined" ? window.location.href : "",
        previousState: prev,
        newState: next,
        reconnectAttempt
      };
      const id = this.nextId++;
      this.buffer.push(event);
      this.entries.push({ id, event });
      this.trim();
      this.onEvent?.(event);
    }
  }
  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------
  getSince(ts) {
    return this.buffer.filter((e) => e.timestamp >= ts);
  }
  getRecent(n = 50) {
    return this.buffer.slice(-n);
  }
  getByType(type) {
    return this.buffer.filter((e) => e.type === type);
  }
  /**
   * Get console errors since a timestamp (backward-compat for ActionExecutor).
   */
  getConsoleSince(ts) {
    return this.buffer.filter((e) => (e.type === "console" || e.type === "hmr") && e.timestamp >= ts).map((e) => ({
      timestamp: e.timestamp,
      level: e.type === "hmr" ? e.level === "warning" ? "warn" : e.level : e.level,
      message: e.message,
      stack: e.stack
    }));
  }
  getConsoleRecent(arg) {
    if (arg === void 0 || typeof arg === "number") {
      const response = this._getConsoleRecentImpl({ limit: arg ?? 50, sinceId: 0 });
      return response.errors;
    }
    return this._getConsoleRecentImpl(arg);
  }
  _getConsoleRecentImpl(options) {
    const sinceId = typeof options.sinceId === "number" ? options.sinceId : 0;
    const rawLimit = typeof options.limit === "number" ? options.limit : 250;
    const limit = Math.min(Math.max(rawLimit, 0), 500);
    const matching = [];
    for (const entry of this.entries) {
      if (entry.id <= sinceId) continue;
      const t = entry.event.type;
      if (t !== "console" && t !== "hmr") continue;
      matching.push(entry);
    }
    const window2 = matching.slice(0, limit);
    const errors = window2.map(({ event }) => ({
      timestamp: event.timestamp,
      level: event.type === "hmr" ? event.level === "warning" ? "warn" : event.level : event.level,
      message: event.message,
      stack: event.stack
    }));
    const nextSinceId = window2.length > 0 ? window2[window2.length - 1].id : sinceId;
    return {
      errors,
      nextSinceId,
      droppedCount: this.droppedCount,
      bufferedCount: this.buffer.length
    };
  }
  /**
   * Get currently visible framework error overlays (Next.js, Vite, React error boundary).
   * Returns empty array if no overlays are detected.
   */
  getFrameworkOverlays() {
    return getActiveOverlays();
  }
  /**
   * Get the latest memory trend analysis, if memory capture is enabled.
   */
  getMemoryTrend() {
    return this.memoryTrend?.getLatestTrend() ?? null;
  }
  clear() {
    this.buffer = [];
    this.entries = [];
  }
  trim() {
    if (this.buffer.length > this.maxEntries) {
      const overflow = this.buffer.length - this.maxEntries;
      this.buffer = this.buffer.slice(-this.maxEntries);
      this.entries = this.entries.slice(-this.maxEntries);
      this.droppedCount += overflow;
    }
  }
};

// src/debug/shared-utils.ts
function getEventStack(event) {
  if ("stack" in event) return event.stack;
  return void 0;
}

// src/debug/error-fingerprint.ts
var UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
var UUID_TEST_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
var HEX_RE = /\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/gi;
var TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g;
var UNIX_TS_RE = /\b\d{10,13}\b/g;
var NUMBER_RE = /\b\d+\b/g;
function normalizeMessage(message) {
  return message.replace(UUID_RE, "<uuid>").replace(TIMESTAMP_RE, "<timestamp>").replace(HEX_RE, "<hex>").replace(UNIX_TS_RE, "<number>").replace(NUMBER_RE, "<n>");
}
function normalizeUrlPath(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").map((seg) => {
      if (UUID_TEST_RE.test(seg)) {
        return "<uuid>";
      }
      if (/^\d+$/.test(seg)) return "<id>";
      return seg;
    });
    return `${parsed.origin}${segments.join("/")}`;
  } catch {
    return normalizeMessage(url);
  }
}
var SKIP_FRAME_PATTERNS = [
  /node_modules/,
  /react-dom/,
  /react\.development/,
  /react\.production/,
  /scheduler\./,
  /webpack-internal/,
  /webpack:\/\//,
  /turbopack-internal/,
  /__webpack_/,
  /^native code$/,
  /^<anonymous>$/,
  /\(native\)/,
  /extensions::/,
  /chrome-extension:\/\//,
  /moz-extension:\/\//
];
var V8_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
var SPIDERMONKEY_FRAME_RE = /^(.+?)@(.+?):(\d+):(\d+)$/;
var JSC_BARE_RE = /^(.+?):(\d+):(\d+)$/;
function parseFrame(line) {
  const trimmed = line.trim();
  const v8 = trimmed.match(V8_FRAME_RE);
  if (v8) {
    return { functionName: v8[1], file: v8[2], line: v8[3], col: v8[4] };
  }
  const sm = trimmed.match(SPIDERMONKEY_FRAME_RE);
  if (sm) {
    return { functionName: sm[1], file: sm[2], line: sm[3], col: sm[4] };
  }
  const bare = trimmed.match(JSC_BARE_RE);
  if (bare) {
    return { functionName: void 0, file: bare[1], line: bare[2], col: bare[3] };
  }
  return null;
}
function isAppFrame(frame) {
  return !SKIP_FRAME_PATTERNS.some((pat) => pat.test(frame.file));
}
function extractFilename(file) {
  let clean = file.split("?")[0].split("#")[0];
  clean = clean.replace(/^https?:\/\/[^/]+/, "");
  clean = clean.replace(/^\/_next\/static\/[^/]+\//, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length > 3) {
    return parts.slice(-3).join("/");
  }
  return parts.join("/") || clean;
}
function extractSourceLocation(stack) {
  if (!stack) return void 0;
  const lines = stack.split("\n");
  for (const line of lines) {
    const frame = parseFrame(line);
    if (frame && isAppFrame(frame)) {
      const filename = extractFilename(frame.file);
      return `${filename}:${frame.line}`;
    }
  }
  for (const line of lines) {
    const frame = parseFrame(line);
    if (frame) {
      const filename = extractFilename(frame.file);
      return `${filename}:${frame.line}`;
    }
  }
  return void 0;
}
function topFrameForFingerprint(stack) {
  return extractSourceLocation(stack) ?? "";
}
function fingerprintConsole(event) {
  const normalized = normalizeMessage(event.message);
  const frame = topFrameForFingerprint(event.stack);
  return `console:${event.level}|${normalized}|${frame}`;
}
function fingerprintNetwork(event) {
  const path = normalizeUrlPath(event.requestUrl);
  return `network:${event.method}|${path}|${event.status ?? event.kind}`;
}
function fingerprintReactError(event) {
  const normalized = normalizeMessage(event.message);
  const frame = topFrameForFingerprint(event.stack);
  return `react-error|${normalized}|${frame}`;
}
function fingerprintResourceError(event) {
  const path = normalizeUrlPath(event.resourceUrl);
  return `resource-error:${event.tagName}|${path}`;
}
function fingerprintHmr(event) {
  const normalized = normalizeMessage(event.message);
  return `hmr:${event.level}|${normalized}|${event.moduleName ?? ""}`;
}
function fingerprintWsDisconnection(event) {
  return `ws-disconnection:${event.previousState}->${event.newState}`;
}
function computeFingerprint(event) {
  switch (event.type) {
    case "console":
      return fingerprintConsole(event);
    case "network":
      return fingerprintNetwork(event);
    case "react-error":
      return fingerprintReactError(event);
    case "resource-error":
      return fingerprintResourceError(event);
    case "hmr":
      return fingerprintHmr(event);
    case "ws-disconnection":
      return fingerprintWsDisconnection(event);
    case "navigation":
      return `navigation:${event.trigger}|${normalizeUrlPath(event.to)}`;
    case "long-task":
      return `long-task:${Math.round(event.durationMs / 50) * 50}ms`;
    case "long-animation-frame": {
      const scripts = event.scripts.map((s) => `${s.invoker}@${extractFilename(s.sourceURL)}`).join(",");
      return `loaf:${Math.round(event.durationMs / 50) * 50}ms|${scripts}`;
    }
    case "web-vital":
      return `web-vital:${event.metric}`;
    case "memory":
      return `memory:snapshot`;
    case "freeze":
      return `freeze:${Math.round(event.gapMs / 500) * 500}ms`;
    case "dom-metrics":
      return `dom-metrics:${Math.round(event.nodeCount / 1e3) * 1e3}`;
    default: {
      const _exhaustive = event;
      return `unknown:${_exhaustive.type}`;
    }
  }
}
function deduplicateEvents(events) {
  const groups = /* @__PURE__ */ new Map();
  const insertionOrder = [];
  for (const event of events) {
    const fingerprint = computeFingerprint(event);
    const existing = groups.get(fingerprint);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = event.timestamp;
    } else {
      const sourceLocation = extractSourceLocation(getEventStack(event));
      groups.set(fingerprint, {
        fingerprint,
        event,
        count: 1,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        sourceLocation
      });
      insertionOrder.push(fingerprint);
    }
  }
  return insertionOrder.map((fp) => groups.get(fp));
}

// src/debug/error-severity.ts
var SEVERITY_RANK = {
  crash: 0,
  error: 1,
  warning: 2,
  noise: 3
};
var DEFAULT_NOISE_PATTERNS = [
  // React dev mode noise
  "Warning: Each child in a list should have a unique",
  "Warning: Can't perform a React state update on an unmounted",
  "Warning: componentWillMount has been renamed",
  "Warning: componentWillReceiveProps has been renamed",
  "Warning: componentWillUpdate has been renamed",
  "Warning: Using UNSAFE_componentWillMount",
  "Warning: Using UNSAFE_componentWillReceiveProps",
  "Warning: Using UNSAFE_componentWillUpdate",
  "Warning: findDOMNode is deprecated",
  "Warning: Legacy context API has been detected",
  // React StrictMode double-render artifacts
  "Warning: Strict Mode",
  // HMR lifecycle (normal dev workflow, not errors)
  "Fast Refresh",
  "[HMR]",
  "[vite] connected",
  "[vite] hot updated",
  // Browser extensions (not our code)
  "chrome-extension://",
  "moz-extension://",
  "safari-extension://",
  // Common benign warnings
  "Download the React DevTools",
  "Download the Apollo DevTools",
  "React does not recognize the",
  "Unknown event handler property",
  // ResizeObserver (fires frequently, almost never a real bug)
  "ResizeObserver loop",
  "ResizeObserver loop completed with undelivered notifications",
  // Source map warnings
  "DevTools failed to load source map",
  "Could not load content for"
];
function matchesNoisePattern(message, patterns = DEFAULT_NOISE_PATTERNS) {
  return patterns.some((pattern) => message.includes(pattern));
}
var CRITICAL_ENDPOINT_PATTERNS = [
  "/api/v1/auth/",
  "/api/v1/organizations/",
  "/_next/data/",
  "/graphql"
];
function isCriticalEndpoint(url) {
  return CRITICAL_ENDPOINT_PATTERNS.some((pattern) => url.includes(pattern));
}
var COMMON_ASSET_PATTERNS = [
  "/favicon",
  ".ico",
  "/manifest.json",
  "/robots.txt",
  "/sitemap",
  "/apple-touch-icon",
  ".map"
];
function isCommonAsset404(url) {
  return COMMON_ASSET_PATTERNS.some((pattern) => url.includes(pattern));
}
function classifyConsole(event) {
  if (matchesNoisePattern(event.message)) {
    return { severity: "noise", reason: "matches noise pattern" };
  }
  switch (event.level) {
    case "unhandledrejection":
      return { severity: "crash", reason: "unhandled promise rejection" };
    case "error":
      return { severity: "error", reason: "console.error" };
    case "warn":
      return { severity: "warning", reason: "console.warn" };
    default: {
      const _exhaustive = event.level;
      return { severity: "warning", reason: `console.${_exhaustive}` };
    }
  }
}
function classifyNetwork(event) {
  const status = event.status;
  if (event.kind === "network-error" || event.kind === "timeout") {
    if (isCriticalEndpoint(event.requestUrl)) {
      return { severity: "crash", reason: `${event.kind} on critical endpoint` };
    }
    return { severity: "error", reason: event.kind };
  }
  if (event.kind === "cors") {
    return { severity: "error", reason: "CORS error" };
  }
  if (event.kind === "abort") {
    return { severity: "noise", reason: "aborted request" };
  }
  if (status !== void 0) {
    if (status >= 500) {
      if (isCriticalEndpoint(event.requestUrl)) {
        return { severity: "crash", reason: `${status} on critical endpoint` };
      }
      return { severity: "error", reason: `HTTP ${status}` };
    }
    if (status === 404 && isCommonAsset404(event.requestUrl)) {
      return { severity: "noise", reason: "404 for common asset" };
    }
    if (status >= 400) {
      return { severity: "warning", reason: `HTTP ${status}` };
    }
  }
  return { severity: "warning", reason: "network issue" };
}
function classifyReactError(_event) {
  return { severity: "crash", reason: "React error boundary" };
}
function classifyResourceError(event) {
  const tag = event.tagName.toLowerCase();
  if (tag === "script") {
    return { severity: "error", reason: "script load failed" };
  }
  if (tag === "link") {
    return { severity: "error", reason: "stylesheet load failed" };
  }
  if (tag === "img" || tag === "video" || tag === "audio" || tag === "source") {
    return { severity: "warning", reason: `${tag} load failed` };
  }
  return { severity: "warning", reason: `${tag} resource load failed` };
}
function classifyHmr(event) {
  if (event.level === "error") {
    return { severity: "error", reason: "HMR compilation error" };
  }
  return { severity: "warning", reason: "HMR warning" };
}
function classifyWsDisconnection(event) {
  if (event.reconnectAttempt !== void 0 && event.reconnectAttempt > 0) {
    return { severity: "noise", reason: `reconnect attempt ${event.reconnectAttempt}` };
  }
  return { severity: "warning", reason: "WebSocket disconnection" };
}
function classifyLongTask(event) {
  if (event.durationMs < 100) {
    return { severity: "noise", reason: "short long-task (<100ms)" };
  }
  if (event.durationMs >= 500) {
    return { severity: "warning", reason: `long task ${Math.round(event.durationMs)}ms` };
  }
  return {
    severity: "noise",
    reason: `long task ${Math.round(event.durationMs)}ms (under threshold)`
  };
}
function classifyLoaf(event) {
  if (event.blockingDurationMs >= 200) {
    return {
      severity: "warning",
      reason: `long animation frame blocking ${Math.round(event.blockingDurationMs)}ms`
    };
  }
  return { severity: "noise", reason: "long animation frame (low blocking duration)" };
}
function classifyEvent(event) {
  switch (event.type) {
    case "console":
      return classifyConsole(event);
    case "network":
      return classifyNetwork(event);
    case "react-error":
      return classifyReactError();
    case "resource-error":
      return classifyResourceError(event);
    case "hmr":
      return classifyHmr(event);
    case "ws-disconnection":
      return classifyWsDisconnection(event);
    case "long-task":
      return classifyLongTask(event);
    case "long-animation-frame":
      return classifyLoaf(event);
    case "navigation":
      return { severity: "noise", reason: "navigation event" };
    case "web-vital":
      return { severity: "noise", reason: "web vital metric" };
    case "memory":
      return { severity: "noise", reason: "memory snapshot" };
    case "freeze":
      return event.gapMs >= 5e3 ? { severity: "error", reason: `UI freeze ${Math.round(event.gapMs)}ms` } : { severity: "warning", reason: `UI freeze ${Math.round(event.gapMs)}ms` };
    case "dom-metrics":
      return event.nodeCount > 5e4 ? { severity: "warning", reason: `high DOM node count: ${event.nodeCount}` } : { severity: "noise", reason: "DOM metrics snapshot" };
    default: {
      const _exhaustive = event;
      return {
        severity: "noise",
        reason: `unhandled type: ${_exhaustive.type}`
      };
    }
  }
}
function classifyEvents(events) {
  return events.map((event) => {
    const { severity, reason } = classifyEvent(event);
    return { event, severity, reason };
  });
}
function filterBySeverity(events, minSeverity) {
  const minRank = SEVERITY_RANK[minSeverity];
  return events.filter((event) => {
    const { severity } = classifyEvent(event);
    return SEVERITY_RANK[severity] <= minRank;
  });
}

// src/debug/error-timeline.ts
var TimelineBuffer = class _TimelineBuffer {
  constructor(maxEntries = 500) {
    this.actions = [];
    this.maxEntries = maxEntries;
  }
  // -----------------------------------------------------------------------
  // Recording
  // -----------------------------------------------------------------------
  /**
   * Record an action with its related browser events.
   * The `type` discriminator is added automatically.
   */
  recordAction(entry) {
    this.actions.push({ type: "action", ...entry });
    this.trimActions();
  }
  // -----------------------------------------------------------------------
  // Timeline query
  // -----------------------------------------------------------------------
  /**
   * Build a merged timeline from recorded actions and live browser events.
   *
   * Browser events are fetched from the provided capture instance, classified,
   * and interleaved chronologically with action entries.
   *
   * @param capture - A BrowserEventCapture (or compatible) instance to read events from
   * @param options - Optional filtering (since, limit, minSeverity)
   */
  getTimeline(capture, options) {
    const { since, limit, minSeverity } = options ?? {};
    const minRank = minSeverity ? SEVERITY_RANK[minSeverity] : SEVERITY_RANK.noise;
    const rawEvents = since !== void 0 ? capture.getSince(since) : capture.getRecent();
    const browserEntries = [];
    for (const event of rawEvents) {
      const { severity, reason } = classifyEvent(event);
      if (SEVERITY_RANK[severity] > minRank) continue;
      browserEntries.push({
        type: "browser-event",
        timestamp: event.timestamp,
        event,
        severity,
        reason,
        fingerprint: computeFingerprint(event),
        sourceLocation: extractSourceLocation(getEventStack(event))
      });
    }
    const filteredActions = since !== void 0 ? this.actions.filter((a) => a.timestamp >= since) : [...this.actions];
    const merged = [...filteredActions, ...browserEntries];
    merged.sort((a, b) => a.timestamp - b.timestamp);
    if (limit !== void 0 && limit > 0 && merged.length > limit) {
      return merged.slice(-limit);
    }
    return merged;
  }
  // -----------------------------------------------------------------------
  // Static utilities
  // -----------------------------------------------------------------------
  /**
   * Compute the error diff between two snapshots of browser events,
   * taken before and after an action.
   *
   * Uses fingerprints to determine which errors are new, resolved, or persisting.
   * `errorDelta` counts only crash and error severity events (not warnings/noise).
   */
  static computeErrorDiff(action, targetId, eventsBefore, eventsAfter) {
    const classifiedBefore = _TimelineBuffer.classifyAndEnrich(eventsBefore);
    const classifiedAfter = _TimelineBuffer.classifyAndEnrich(eventsAfter);
    const beforeByFp = /* @__PURE__ */ new Map();
    for (const c of classifiedBefore) {
      if (!beforeByFp.has(c.fingerprint)) {
        beforeByFp.set(c.fingerprint, c);
      }
    }
    const afterByFp = /* @__PURE__ */ new Map();
    for (const c of classifiedAfter) {
      if (!afterByFp.has(c.fingerprint)) {
        afterByFp.set(c.fingerprint, c);
      }
    }
    const newEvents = [];
    const resolvedEvents = [];
    const persistingEvents = [];
    for (const [fp, classified] of afterByFp) {
      if (!beforeByFp.has(fp)) {
        newEvents.push(classified);
      } else {
        persistingEvents.push(classified);
      }
    }
    for (const [fp, classified] of beforeByFp) {
      if (!afterByFp.has(fp)) {
        resolvedEvents.push(classified);
      }
    }
    const isSignificant = (c) => c.severity === "crash" || c.severity === "error";
    const newSignificant = newEvents.filter(isSignificant).length;
    const resolvedSignificant = resolvedEvents.filter(isSignificant).length;
    const errorDelta = newSignificant - resolvedSignificant;
    return {
      action,
      targetId,
      newEvents,
      resolvedEvents,
      persistingEvents,
      errorDelta
    };
  }
  /**
   * Classify and enrich a batch of raw browser events.
   *
   * For each event: computes severity, reason, fingerprint, and source location.
   */
  static classifyAndEnrich(events) {
    return events.map((event) => {
      const { severity, reason } = classifyEvent(event);
      return {
        event,
        severity,
        reason,
        fingerprint: computeFingerprint(event),
        sourceLocation: extractSourceLocation(getEventStack(event))
      };
    });
  }
  // -----------------------------------------------------------------------
  // Buffer management
  // -----------------------------------------------------------------------
  /**
   * Clear all recorded actions.
   */
  clear() {
    this.actions = [];
  }
  /**
   * Current number of recorded actions.
   */
  get actionCount() {
    return this.actions.length;
  }
  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------
  trimActions() {
    if (this.actions.length > this.maxEntries) {
      this.actions = this.actions.slice(-this.maxEntries);
    }
  }
};

// src/debug/error-session.ts
function classifyAndEnrichEvent(event) {
  const { severity, reason } = classifyEvent(event);
  return {
    event,
    severity,
    reason,
    fingerprint: computeFingerprint(event),
    sourceLocation: extractSourceLocation(getEventStack(event))
  };
}
var ErrorSession = class {
  constructor(label) {
    this.events = [];
    this.fingerprints = /* @__PURE__ */ new Set();
    /** Map from fingerprint to first classified event (for getUniqueEvents) */
    this.uniqueByFingerprint = /* @__PURE__ */ new Map();
    this.id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.label = label;
    this.startedAt = Date.now();
  }
  /** Record an event into this session */
  recordEvent(event) {
    if (this.endedAt !== void 0) return;
    const classified = classifyAndEnrichEvent(event);
    this.events.push(classified);
    if (!this.fingerprints.has(classified.fingerprint)) {
      this.fingerprints.add(classified.fingerprint);
      this.uniqueByFingerprint.set(classified.fingerprint, classified);
    }
  }
  /** Record a batch of events */
  recordEvents(events) {
    for (const event of events) {
      this.recordEvent(event);
    }
  }
  /** End the session */
  end() {
    if (this.endedAt === void 0) {
      this.endedAt = Date.now();
    }
  }
  /** Get all unique events (one per fingerprint, first occurrence) */
  getUniqueEvents() {
    return Array.from(this.uniqueByFingerprint.values());
  }
  /** Get all events */
  getAllEvents() {
    return [...this.events];
  }
  /** Get the fingerprint set */
  getFingerprints() {
    return new Set(this.fingerprints);
  }
  /** Get session summary */
  getSummary() {
    const bySeverity = {
      crash: 0,
      error: 0,
      warning: 0,
      noise: 0
    };
    let hasCrashes = false;
    for (const classified of this.events) {
      bySeverity[classified.severity]++;
      if (classified.severity === "crash") {
        hasCrashes = true;
      }
    }
    return {
      id: this.id,
      label: this.label,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      uniqueErrorCount: this.fingerprints.size,
      totalEventCount: this.events.length,
      bySeverity,
      hasCrashes
    };
  }
  /** Compare this session against a baseline */
  compareToBaseline(baseline) {
    const newErrors = [];
    const knownErrors = [];
    for (const [fp, classified] of this.uniqueByFingerprint) {
      if (baseline.fingerprints.has(fp)) {
        knownErrors.push(classified);
      } else {
        newErrors.push(classified);
      }
    }
    const fixedErrors = [];
    const baselineByFp = /* @__PURE__ */ new Map();
    for (const classified of baseline.events) {
      if (!baselineByFp.has(classified.fingerprint)) {
        baselineByFp.set(classified.fingerprint, classified);
      }
    }
    for (const [fp, classified] of baselineByFp) {
      if (!this.fingerprints.has(fp)) {
        fixedErrors.push(classified);
      }
    }
    const isRegression = newErrors.some((e) => e.severity === "crash" || e.severity === "error");
    const isSignificant = (c) => c.severity === "crash" || c.severity === "error";
    const newSignificant = newErrors.filter(isSignificant).length;
    const fixedSignificant = fixedErrors.filter(isSignificant).length;
    const delta = newSignificant - fixedSignificant;
    return {
      newErrors,
      fixedErrors,
      knownErrors,
      isRegression,
      delta
    };
  }
  /** Whether the session is still active (not ended) */
  get isActive() {
    return this.endedAt === void 0;
  }
};
var ErrorSessionManager = class {
  constructor(maxSessions = 50) {
    this.sessions = [];
    this.activeSession = null;
    this.baselines = /* @__PURE__ */ new Map();
    this.maxSessions = maxSessions;
  }
  /** Start a new session. Ends the previous active session if any. */
  startSession(label) {
    if (this.activeSession !== null) {
      this.activeSession.end();
    }
    const session = new ErrorSession(label);
    this.activeSession = session;
    this.sessions.push(session);
    if (this.sessions.length > this.maxSessions) {
      this.sessions = this.sessions.slice(-this.maxSessions);
    }
    return session;
  }
  /** End the active session */
  endSession() {
    if (this.activeSession === null) return null;
    this.activeSession.end();
    const summary = this.activeSession.getSummary();
    this.activeSession = null;
    return summary;
  }
  /** Get the active session */
  getActive() {
    return this.activeSession;
  }
  /** Record an event into the active session (no-op if no active session) */
  recordEvent(event) {
    if (this.activeSession !== null) {
      this.activeSession.recordEvent(event);
    }
  }
  /** Get all session summaries */
  getSessions() {
    return this.sessions.map((s) => s.getSummary());
  }
  /** Get a specific session by ID */
  getSession(id) {
    return this.sessions.find((s) => s.id === id) ?? null;
  }
  /**
   * Capture a baseline from the current state.
   * Takes a BrowserEventCaptureLike to read recent events.
   */
  captureBaseline(label, capture) {
    const rawEvents = capture.getRecent();
    const classified = rawEvents.map(classifyAndEnrichEvent);
    const fingerprints = /* @__PURE__ */ new Set();
    const uniqueEvents = [];
    for (const c of classified) {
      if (!fingerprints.has(c.fingerprint)) {
        fingerprints.add(c.fingerprint);
        uniqueEvents.push(c);
      }
    }
    const baseline = {
      label,
      capturedAt: Date.now(),
      fingerprints,
      events: uniqueEvents
    };
    this.baselines.set(label, baseline);
    return baseline;
  }
  /** Get a baseline by label */
  getBaseline(label) {
    return this.baselines.get(label) ?? null;
  }
  /** List all baselines */
  getBaselines() {
    const result = [];
    for (const [, baseline] of this.baselines) {
      result.push({
        label: baseline.label,
        capturedAt: baseline.capturedAt,
        fingerprintCount: baseline.fingerprints.size
      });
    }
    return result;
  }
  /** Delete a baseline */
  deleteBaseline(label) {
    return this.baselines.delete(label);
  }
  /**
   * Compare the active session (or recent events) against a named baseline.
   *
   * If there is an active session, compares its accumulated events.
   * Otherwise, if a capture instance is provided, compares recent events from it.
   * Returns null if the baseline does not exist or there is nothing to compare.
   */
  compareToBaseline(baselineLabel, capture) {
    const baseline = this.baselines.get(baselineLabel);
    if (!baseline) return null;
    if (this.activeSession !== null) {
      return this.activeSession.compareToBaseline(baseline);
    }
    if (!capture) return null;
    const rawEvents = capture.getRecent();
    const classified = rawEvents.map(classifyAndEnrichEvent);
    const currentByFp = /* @__PURE__ */ new Map();
    for (const c of classified) {
      if (!currentByFp.has(c.fingerprint)) {
        currentByFp.set(c.fingerprint, c);
      }
    }
    const newErrors = [];
    const knownErrors = [];
    for (const [fp, c] of currentByFp) {
      if (baseline.fingerprints.has(fp)) {
        knownErrors.push(c);
      } else {
        newErrors.push(c);
      }
    }
    const baselineByFp = /* @__PURE__ */ new Map();
    for (const c of baseline.events) {
      if (!baselineByFp.has(c.fingerprint)) {
        baselineByFp.set(c.fingerprint, c);
      }
    }
    const fixedErrors = [];
    for (const [fp, c] of baselineByFp) {
      if (!currentByFp.has(fp)) {
        fixedErrors.push(c);
      }
    }
    const isRegression = newErrors.some((e) => e.severity === "crash" || e.severity === "error");
    const isSignificant = (c) => c.severity === "crash" || c.severity === "error";
    const newSignificant = newErrors.filter(isSignificant).length;
    const fixedSignificant = fixedErrors.filter(isSignificant).length;
    const delta = newSignificant - fixedSignificant;
    return {
      newErrors,
      fixedErrors,
      knownErrors,
      isRegression,
      delta
    };
  }
};

// src/debug/health-score.ts
var DEFAULT_WINDOW_MS = 6e4;
var DEFAULT_CRASH_IS_BROKEN = true;
var DEFAULT_DEGRADED_THRESHOLD = 3;
var DEFAULT_BROKEN_THRESHOLD = 8;
function extractMessage(event) {
  switch (event.type) {
    case "console":
      return event.message;
    case "network":
      return event.errorMessage ?? `${event.method} ${event.requestUrl} \u2192 ${event.status ?? "no response"}`;
    case "react-error":
      return event.message;
    case "resource-error":
      return `Failed to load ${event.tagName}: ${event.resourceUrl}`;
    case "hmr":
      return event.message;
    case "ws-disconnection":
      return `WebSocket ${event.previousState} \u2192 ${event.newState}`;
    case "long-task":
      return `Long task: ${Math.round(event.durationMs)}ms`;
    case "long-animation-frame":
      return `Long animation frame: ${Math.round(event.durationMs)}ms (blocking: ${Math.round(event.blockingDurationMs)}ms)`;
    case "navigation":
      return `Navigation: ${event.from} \u2192 ${event.to}`;
    case "web-vital":
      return `${event.metric}: ${event.value}`;
    case "memory":
      return `Memory: ${Math.round(event.usedJSHeapSize / 1024 / 1024)}MB used`;
    case "freeze":
      return `UI freeze: ${Math.round(event.gapMs)}ms`;
    case "dom-metrics":
      return `DOM nodes: ${event.nodeCount}`;
    default: {
      const _exhaustive = event;
      return `Unknown event: ${_exhaustive.type}`;
    }
  }
}
function formatWindow(ms) {
  if (ms < 1e3) return `${ms}ms`;
  const seconds = Math.round(ms / 1e3);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}
function computeHealthReport(capture, config) {
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
  const crashIsBroken = config?.crashIsBroken ?? DEFAULT_CRASH_IS_BROKEN;
  const degradedThreshold = config?.degradedThreshold ?? DEFAULT_DEGRADED_THRESHOLD;
  const brokenThreshold = config?.brokenThreshold ?? DEFAULT_BROKEN_THRESHOLD;
  const now = Date.now();
  const since = now - windowMs;
  const events = capture.getSince(since);
  let crashes = 0;
  let errors = 0;
  let warnings = 0;
  let topIssue;
  let topIssueRank = SEVERITY_RANK.noise + 1;
  for (const event of events) {
    const { severity } = classifyEvent(event);
    switch (severity) {
      case "crash":
        crashes++;
        break;
      case "error":
        errors++;
        break;
      case "warning":
        warnings++;
        break;
      case "noise":
        continue;
    }
    const rank = SEVERITY_RANK[severity];
    if (rank < topIssueRank || rank === topIssueRank && topIssue && event.timestamp >= topIssue.timestamp) {
      topIssueRank = rank;
      topIssue = {
        message: extractMessage(event),
        severity,
        timestamp: event.timestamp
      };
    }
  }
  let score = 100;
  score -= crashes * 40;
  score -= errors * 10;
  score -= warnings * 2;
  score = Math.max(0, score);
  let status;
  if (crashIsBroken && crashes > 0) {
    status = "broken";
  } else if (errors >= brokenThreshold) {
    status = "broken";
  } else if (errors >= degradedThreshold) {
    status = "degraded";
  } else {
    status = "healthy";
  }
  const windowMinutes = windowMs / 6e4;
  const errorRate = windowMinutes > 0 ? Math.round((crashes + errors) / windowMinutes * 100) / 100 : 0;
  const windowLabel = formatWindow(windowMs);
  let summary;
  if (status === "healthy") {
    if (warnings > 0) {
      summary = `Healthy: ${warnings} warning${warnings !== 1 ? "s" : ""} in the last ${windowLabel}`;
    } else {
      summary = `Healthy: no errors in the last ${windowLabel}`;
    }
  } else {
    const parts = [];
    if (crashes > 0) parts.push(`${crashes} crash${crashes !== 1 ? "es" : ""}`);
    if (errors > 0) parts.push(`${errors} error${errors !== 1 ? "s" : ""}`);
    if (warnings > 0) parts.push(`${warnings} warning${warnings !== 1 ? "s" : ""}`);
    const statusLabel = status === "broken" ? "Broken" : "Degraded";
    summary = `${statusLabel}: ${parts.join(" and ")} in the last ${windowLabel}`;
  }
  return {
    status,
    score,
    summary,
    breakdown: { crashes, errors, warnings },
    errorRate,
    ...topIssue !== void 0 ? { topIssue } : {},
    windowMs,
    timestamp: now
  };
}
function computeHealthScore(capture, config) {
  return computeHealthReport(capture, config).score;
}
function computeHealthStatus(capture, config) {
  return computeHealthReport(capture, config).status;
}

// src/debug/network-chain.ts
var REQUEST_ID_HEADERS = [
  "x-request-id",
  "x-correlation-id",
  "x-trace-id",
  "traceparent",
  "x-amzn-requestid",
  "x-amzn-trace-id"
];
var DEFAULT_CONFIG = {
  maxBodyPreview: 500,
  errorBodiesOnly: true,
  correlationWindowMs: 200,
  ignorePatterns: [
    "/api/ui-bridge/",
    "/__ui-bridge/",
    "/api/dev-debug/",
    "localhost:9876",
    "chrome-extension://"
  ],
  maxChains: 200,
  captureHeaders: false
};
var xhrMetaMap = /* @__PURE__ */ new WeakMap();
var NetworkChainTracker = class {
  constructor(config) {
    this.chains = [];
    this.installed = false;
    this.cleanup = null;
    // Tracker-driven mode
    this.tracker = null;
    this.trackerUnsubscribe = null;
    const { tracker, ...rest } = config ?? {};
    this.config = { ...DEFAULT_CONFIG, ...rest };
    this.tracker = tracker ?? null;
  }
  // -------------------------------------------------------------------------
  // Install / Uninstall
  // -------------------------------------------------------------------------
  /**
   * Install the fetch and XHR interceptors (standalone mode), or subscribe
   * to a NetworkRequestTracker (tracker-driven mode).
   * No-ops in non-browser environments (SSR / Node).
   */
  install() {
    if (this.installed) return;
    if (this.tracker) {
      this.installTrackerSubscription();
      this.installed = true;
      return;
    }
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
      return;
    }
    const cleanups = [];
    const originalFetch = window.fetch;
    const self = this;
    window.fetch = async function(input, init) {
      const url = getUrl(input);
      if (self.shouldIgnore(url)) {
        return originalFetch.call(this, input, init);
      }
      const method = getMethod(input, init);
      const request = {
        id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method,
        url,
        startTime: Date.now()
      };
      if (init?.body && typeof init.body === "string") {
        request.bodyPreview = self.truncateBody(init.body);
      }
      if (self.config.captureHeaders && init?.headers) {
        request.headers = self.extractSelectedHeaders(new Headers(init.headers));
      }
      try {
        const response = await originalFetch.call(this, input, init);
        const durationMs = Date.now() - request.startTime;
        const isError = response.status >= 400;
        const chain = {
          request,
          response: {
            status: response.status,
            statusText: response.statusText,
            durationMs
          },
          requestId: self.extractRequestId(response.headers),
          correlatedErrors: [],
          isFailure: isError,
          timestamp: request.startTime
        };
        if (isError || !self.config.errorBodiesOnly) {
          try {
            const cloned = response.clone();
            const text = await cloned.text();
            chain.response.bodyPreview = self.truncateBody(text);
          } catch {
          }
        }
        if (self.config.captureHeaders) {
          chain.response.headers = self.extractSelectedHeaders(response.headers);
        }
        self.chains.push(chain);
        self.trim();
        return response;
      } catch (err) {
        const chain = {
          request,
          error: err instanceof Error ? err.message : String(err),
          correlatedErrors: [],
          isFailure: true,
          timestamp: request.startTime
        };
        self.chains.push(chain);
        self.trim();
        throw err;
      }
    };
    cleanups.push(() => {
      window.fetch = originalFetch;
    });
    if (typeof XMLHttpRequest !== "undefined") {
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        const meta = {
          method: method.toUpperCase(),
          url: typeof url === "object" && url instanceof URL ? url.href : String(url),
          requestHeaders: {}
        };
        xhrMetaMap.set(this, meta);
        return originalOpen.apply(this, [method, url, ...rest]);
      };
      XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        const meta = xhrMetaMap.get(this);
        if (meta) {
          meta.requestHeaders[name.toLowerCase()] = value;
        }
        return originalSetRequestHeader.call(this, name, value);
      };
      XMLHttpRequest.prototype.send = function(body) {
        const meta = xhrMetaMap.get(this);
        if (!meta || self.shouldIgnore(meta.url)) {
          return originalSend.call(this, body);
        }
        const request = {
          id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          method: meta.method,
          url: meta.url,
          startTime: Date.now()
        };
        if (body && typeof body === "string") {
          request.bodyPreview = self.truncateBody(body);
        }
        if (self.config.captureHeaders && Object.keys(meta.requestHeaders).length > 0) {
          request.headers = self.extractSelectedHeadersFromRecord(meta.requestHeaders);
        }
        const pushChain = (chain) => {
          self.chains.push(chain);
          self.trim();
        };
        this.addEventListener("load", function() {
          const durationMs = Date.now() - request.startTime;
          const isError = this.status >= 400;
          const chain = {
            request,
            response: {
              status: this.status,
              statusText: this.statusText,
              durationMs
            },
            correlatedErrors: [],
            isFailure: isError,
            timestamp: request.startTime
          };
          chain.requestId = self.extractRequestIdFromXHR(this);
          if (isError || !self.config.errorBodiesOnly) {
            try {
              const text = typeof this.responseText === "string" ? this.responseText : "";
              if (text) {
                chain.response.bodyPreview = self.truncateBody(text);
              }
            } catch {
            }
          }
          if (self.config.captureHeaders) {
            chain.response.headers = self.extractSelectedHeadersFromXHR(this);
          }
          pushChain(chain);
        });
        this.addEventListener("error", function() {
          pushChain({
            request,
            error: "Network error",
            correlatedErrors: [],
            isFailure: true,
            timestamp: request.startTime
          });
        });
        this.addEventListener("timeout", function() {
          pushChain({
            request,
            error: `Timeout after ${this.timeout}ms`,
            correlatedErrors: [],
            isFailure: true,
            timestamp: request.startTime
          });
        });
        this.addEventListener("abort", function() {
          pushChain({
            request,
            error: "Request aborted",
            correlatedErrors: [],
            isFailure: true,
            timestamp: request.startTime
          });
        });
        return originalSend.call(this, body);
      };
      cleanups.push(() => {
        XMLHttpRequest.prototype.open = originalOpen;
        XMLHttpRequest.prototype.send = originalSend;
        XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
      });
    }
    this.cleanup = () => {
      for (const fn of cleanups) fn();
    };
    this.installed = true;
  }
  /** Uninstall the fetch and XHR interceptors, restoring originals. */
  uninstall() {
    if (!this.installed) return;
    if (this.trackerUnsubscribe) {
      this.trackerUnsubscribe();
      this.trackerUnsubscribe = null;
    } else {
      this.cleanup?.();
      this.cleanup = null;
    }
    this.installed = false;
  }
  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------
  /** Get all chains (oldest first). */
  getAll() {
    return [...this.chains];
  }
  /** Get chains with a timestamp >= `ts`. */
  getSince(ts) {
    return this.chains.filter((c) => c.timestamp >= ts);
  }
  /** Get the most recent `n` chains (default: 50). */
  getRecent(n = 50) {
    return this.chains.slice(-n);
  }
  /** Get only failure chains (4xx/5xx/network errors). */
  getFailures() {
    return this.chains.filter((c) => c.isFailure);
  }
  /** Get chains whose request URL contains `pattern`. */
  getByUrl(pattern) {
    return this.chains.filter((c) => c.request.url.includes(pattern));
  }
  /** Find the first chain matching a request ID (from response headers). */
  findByRequestId(requestId) {
    return this.chains.find((c) => c.requestId === requestId);
  }
  // -------------------------------------------------------------------------
  // Correlation
  // -------------------------------------------------------------------------
  /**
   * Correlate console errors with network chains.
   *
   * Call this after collecting console errors to link them with recent
   * network events. Each console error is checked against all chains using
   * three correlation strategies:
   *
   * 1. **URL mention** - the error message contains the request URL (or a
   *    recognizable suffix of it).
   * 2. **Timing** - the error occurred within `correlationWindowMs` of the
   *    network response.
   * 3. **Request ID** - the error message contains the chain's `requestId`.
   *
   * Correlations are pushed to each matching chain's `correlatedErrors` array.
   */
  correlateErrors(events) {
    const consoleErrors = events.filter((e) => e.type === "console");
    if (consoleErrors.length === 0) return;
    for (const chain of this.chains) {
      const responseTime = chain.response ? chain.request.startTime + chain.response.durationMs : chain.request.startTime;
      const urlSuffix = extractUrlPath(chain.request.url);
      for (const error of consoleErrors) {
        if (chain.correlatedErrors.some(
          (ce) => ce.message === error.message && ce.timestamp === error.timestamp
        )) {
          continue;
        }
        if (urlSuffix && error.message.includes(urlSuffix)) {
          chain.correlatedErrors.push({
            message: error.message,
            timestamp: error.timestamp,
            correlationType: "url-mention"
          });
          continue;
        }
        if (error.message.includes(chain.request.url)) {
          chain.correlatedErrors.push({
            message: error.message,
            timestamp: error.timestamp,
            correlationType: "url-mention"
          });
          continue;
        }
        if (chain.requestId && error.message.includes(chain.requestId)) {
          chain.correlatedErrors.push({
            message: error.message,
            timestamp: error.timestamp,
            correlationType: "request-id"
          });
          continue;
        }
        if (chain.isFailure && Math.abs(error.timestamp - responseTime) <= this.config.correlationWindowMs) {
          chain.correlatedErrors.push({
            message: error.message,
            timestamp: error.timestamp,
            correlationType: "timing"
          });
        }
      }
    }
  }
  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  /** Clear all buffered chains. */
  clear() {
    this.chains = [];
  }
  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------
  /**
   * Subscribe to a NetworkRequestTracker's events instead of patching
   * fetch/XHR directly. Converts each completed/errored event entry into
   * a NetworkChain and pushes it to the buffer.
   */
  installTrackerSubscription() {
    this.trackerUnsubscribe = this.tracker.onEvent((event) => {
      if (event.type === "request-start") return;
      const url = event.entry.request.url;
      if (this.shouldIgnore(url)) return;
      const chain = this.entryToChain(event.entry);
      this.chains.push(chain);
      this.trim();
    });
  }
  /**
   * Convert a NetworkRequestEntry (from the tracker) to a NetworkChain.
   */
  entryToChain(entry) {
    const request = {
      id: entry.request.id,
      method: entry.request.method,
      url: entry.request.url,
      startTime: entry.request.startedAt,
      bodyPreview: entry.request.bodyPreview
    };
    if (this.config.captureHeaders && entry.request.headers) {
      request.headers = this.extractSelectedHeadersFromRecord(entry.request.headers);
    }
    const chain = {
      request,
      correlatedErrors: [],
      isFailure: entry.isFailure,
      timestamp: entry.request.startedAt
    };
    if (entry.error) {
      chain.error = entry.error;
    }
    if (entry.response) {
      chain.response = {
        status: entry.response.statusCode,
        statusText: entry.response.statusText,
        durationMs: entry.response.durationMs
      };
      if (entry.response.bodyPreview && (entry.isFailure || !this.config.errorBodiesOnly)) {
        chain.response.bodyPreview = this.truncateBody(entry.response.bodyPreview);
      }
      if (this.config.captureHeaders && entry.response.headers) {
        chain.response.headers = this.extractSelectedHeadersFromRecord(entry.response.headers);
      }
    }
    if (entry.requestId) {
      chain.requestId = entry.requestId;
    }
    return chain;
  }
  shouldIgnore(url) {
    return this.config.ignorePatterns.some((p) => url.includes(p));
  }
  /**
   * Extract a request ID from response headers.
   * Checks `REQUEST_ID_HEADERS` in priority order and returns the first match.
   */
  extractRequestId(headers) {
    for (const name of REQUEST_ID_HEADERS) {
      const value = headers.get(name);
      if (value) return value;
    }
    return void 0;
  }
  /**
   * Extract selected headers (request ID headers + content-type).
   */
  extractSelectedHeaders(headers) {
    const selected = {};
    for (const name of REQUEST_ID_HEADERS) {
      const value = headers.get(name);
      if (value) selected[name] = value;
    }
    const ct = headers.get("content-type");
    if (ct) selected["content-type"] = ct;
    return selected;
  }
  /**
   * Extract selected headers from a plain record (used by XHR interceptor for
   * request headers captured via setRequestHeader).
   */
  extractSelectedHeadersFromRecord(headers) {
    const selected = {};
    for (const name of REQUEST_ID_HEADERS) {
      const value = headers[name];
      if (value) selected[name] = value;
    }
    const ct = headers["content-type"];
    if (ct) selected["content-type"] = ct;
    return selected;
  }
  /**
   * Extract a request ID from XHR response headers.
   * Uses `getResponseHeader` to check `REQUEST_ID_HEADERS` in priority order.
   */
  extractRequestIdFromXHR(xhr) {
    for (const name of REQUEST_ID_HEADERS) {
      try {
        const value = xhr.getResponseHeader(name);
        if (value) return value;
      } catch {
      }
    }
    return void 0;
  }
  /**
   * Extract selected response headers from an XHR instance.
   */
  extractSelectedHeadersFromXHR(xhr) {
    const selected = {};
    for (const name of REQUEST_ID_HEADERS) {
      try {
        const value = xhr.getResponseHeader(name);
        if (value) selected[name] = value;
      } catch {
      }
    }
    try {
      const ct = xhr.getResponseHeader("content-type");
      if (ct) selected["content-type"] = ct;
    } catch {
    }
    return selected;
  }
  truncateBody(body) {
    if (body.length <= this.config.maxBodyPreview) return body;
    return body.slice(0, this.config.maxBodyPreview) + "\u2026";
  }
  /** Trim the buffer to `maxChains`, dropping the oldest entries. */
  trim() {
    if (this.chains.length > this.config.maxChains) {
      this.chains = this.chains.slice(this.chains.length - this.config.maxChains);
    }
  }
};
function getMethod(input, init) {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}
function getUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}
function extractUrlPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return void 0;
  }
}

// src/debug/error-snapshot.ts
var DEFAULT_MAX_SNAPSHOTS = 20;
var DEFAULT_TRIGGER_SEVERITIES = ["crash", "error"];
var DEFAULT_DEDUPLICATE = true;
var EMPTY_PAGE_STATE = {
  url: "",
  title: "",
  elementCount: 0,
  visibleErrors: []
};
function extractMessage2(event) {
  switch (event.type) {
    case "console":
      return event.message;
    case "network":
      return event.errorMessage ?? `${event.method} ${event.requestUrl} \u2192 ${event.status ?? "no response"}`;
    case "react-error":
      return event.message;
    case "resource-error":
      return `Failed to load ${event.tagName}: ${event.resourceUrl}`;
    case "hmr":
      return event.message;
    case "ws-disconnection":
      return `WebSocket ${event.previousState} \u2192 ${event.newState}`;
    case "long-task":
      return `Long task: ${Math.round(event.durationMs)}ms`;
    case "long-animation-frame":
      return `Long animation frame: ${Math.round(event.durationMs)}ms (blocking: ${Math.round(event.blockingDurationMs)}ms)`;
    case "navigation":
      return `Navigation: ${event.from} \u2192 ${event.to}`;
    case "web-vital":
      return `${event.metric}: ${event.value}`;
    case "memory":
      return `Memory: ${Math.round(event.usedJSHeapSize / 1024 / 1024)}MB used`;
    case "freeze":
      return `UI freeze: ${Math.round(event.gapMs)}ms`;
    case "dom-metrics":
      return `DOM nodes: ${event.nodeCount}`;
    default: {
      const _exhaustive = event;
      return `Unknown event: ${_exhaustive.type}`;
    }
  }
}
var ErrorSnapshotBuffer = class {
  constructor(config) {
    this.snapshots = [];
    this.seenFingerprints = /* @__PURE__ */ new Set();
    this.maxSnapshots = config?.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
    this.triggerSeverities = new Set(config?.triggerSeverities ?? DEFAULT_TRIGGER_SEVERITIES);
    this.deduplicate = config?.deduplicateByFingerprint ?? DEFAULT_DEDUPLICATE;
    this.capturePageState = config?.capturePageState;
    this.getRecentActions = config?.getRecentActions;
  }
  /**
   * Process a single event. If it's significant (matches trigger severities),
   * capture a snapshot and return it. Returns null if the event is not
   * significant or is a duplicate fingerprint.
   */
  processEvent(event) {
    const { severity } = classifyEvent(event);
    if (!this.triggerSeverities.has(severity)) {
      return null;
    }
    const fingerprint = computeFingerprint(event);
    if (this.deduplicate && this.seenFingerprints.has(fingerprint)) {
      return null;
    }
    const stack = getEventStack(event);
    const snapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      error: {
        message: extractMessage2(event),
        severity,
        fingerprint,
        sourceLocation: extractSourceLocation(stack),
        stack,
        timestamp: event.timestamp
      },
      pageState: this.capturePageState?.() ?? EMPTY_PAGE_STATE,
      recentActions: this.getRecentActions?.() ?? [],
      capturedAt: Date.now()
    };
    this.snapshots.push(snapshot);
    this.seenFingerprints.add(fingerprint);
    this.trimBuffer();
    return snapshot;
  }
  /**
   * Process a batch of events. Returns all snapshots that were captured.
   */
  processEvents(events) {
    const results = [];
    for (const event of events) {
      const snapshot = this.processEvent(event);
      if (snapshot !== null) {
        results.push(snapshot);
      }
    }
    return results;
  }
  /** Get all captured snapshots */
  getAll() {
    return [...this.snapshots];
  }
  /** Get the most recent N snapshots (default: 10) */
  getRecent(n = 10) {
    return this.snapshots.slice(-n);
  }
  /** Get a snapshot by its error fingerprint */
  getByFingerprint(fingerprint) {
    return this.snapshots.find((s) => s.error.fingerprint === fingerprint);
  }
  /** Clear all snapshots and the dedup set */
  clear() {
    this.snapshots = [];
    this.seenFingerprints.clear();
  }
  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------
  /**
   * Trim the buffer to maxSnapshots, removing the oldest entries.
   * Also prunes the fingerprint set to match remaining snapshots.
   */
  trimBuffer() {
    if (this.snapshots.length <= this.maxSnapshots) return;
    this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
    this.seenFingerprints.clear();
    for (const snapshot of this.snapshots) {
      this.seenFingerprints.add(snapshot.error.fingerprint);
    }
  }
};

// src/debug/ws-streaming.ts
function extractSourceLocationFromStack(stack) {
  if (!stack) return void 0;
  const V8_FRAME_RE2 = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
  const SPIDERMONKEY_FRAME_RE2 = /^(.+?)@(.+?):(\d+):(\d+)$/;
  const SKIP_PATTERNS = [
    /node_modules/,
    /react-dom/,
    /react\.development/,
    /react\.production/,
    /webpack-internal/,
    /chrome-extension:\/\//,
    /moz-extension:\/\//
  ];
  const lines = stack.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const v8 = trimmed.match(V8_FRAME_RE2);
    const frame = v8 ? { file: v8[2], line: v8[3] } : (() => {
      const sm = trimmed.match(SPIDERMONKEY_FRAME_RE2);
      return sm ? { file: sm[2], line: sm[3] } : null;
    })();
    if (frame && !SKIP_PATTERNS.some((p) => p.test(frame.file))) {
      let clean = frame.file.split("?")[0].split("#")[0];
      clean = clean.replace(/^https?:\/\/[^/]+/, "");
      const parts = clean.split("/").filter(Boolean);
      const filename = parts.length > 3 ? parts.slice(-3).join("/") : parts.join("/");
      return `${filename}:${frame.line}`;
    }
  }
  return void 0;
}
var DEFAULT_MAX_SUBSCRIPTIONS = 10;
var DEFAULT_MAX_RECENT_FINGERPRINTS = 200;
var LruFingerprintSet = class {
  constructor(maxSize) {
    this.set = /* @__PURE__ */ new Set();
    this.order = [];
    this.maxSize = maxSize;
  }
  /** Returns true if the fingerprint was already in the set. */
  has(fingerprint) {
    return this.set.has(fingerprint);
  }
  /** Add a fingerprint. Returns true if it was new (not already present). */
  add(fingerprint) {
    if (this.set.has(fingerprint)) {
      return false;
    }
    if (this.order.length >= this.maxSize) {
      const oldest = this.order.shift();
      this.set.delete(oldest);
    }
    this.set.add(fingerprint);
    this.order.push(fingerprint);
    return true;
  }
  /** Clear all entries. */
  clear() {
    this.set.clear();
    this.order = [];
  }
};
var BrowserEventStream = class {
  constructor(config) {
    this.subscriptions = /* @__PURE__ */ new Map();
    this.dedupSets = /* @__PURE__ */ new Map();
    this.maxSubscriptions = config?.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS;
    this.maxRecentFingerprints = config?.maxRecentFingerprints ?? DEFAULT_MAX_RECENT_FINGERPRINTS;
  }
  // -----------------------------------------------------------------------
  // Subscription management
  // -----------------------------------------------------------------------
  /**
   * Create a new subscription with optional filters.
   *
   * Returns the full subscription object with an auto-generated `id`.
   * Throws if the maximum number of subscriptions has been reached.
   */
  subscribe(options) {
    if (this.subscriptions.size >= this.maxSubscriptions) {
      throw new Error(
        `Maximum subscriptions reached (${this.maxSubscriptions}). Unsubscribe from an existing subscription first.`
      );
    }
    const id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const subscription = {
      id,
      ...options
    };
    this.subscriptions.set(id, subscription);
    if (subscription.deduplicate) {
      this.dedupSets.set(id, new LruFingerprintSet(this.maxRecentFingerprints));
    }
    return subscription;
  }
  /**
   * Remove a subscription by ID.
   *
   * Returns true if the subscription existed and was removed.
   */
  unsubscribe(id) {
    const existed = this.subscriptions.delete(id);
    this.dedupSets.delete(id);
    return existed;
  }
  /**
   * Get all active subscriptions.
   */
  getSubscriptions() {
    return Array.from(this.subscriptions.values());
  }
  // -----------------------------------------------------------------------
  // Event processing
  // -----------------------------------------------------------------------
  /**
   * Process a single browser event through all subscriptions.
   *
   * Classifies the event, computes its fingerprint, and checks each
   * subscription's filters. Returns a map of subscription-id to message
   * for only those subscriptions that should receive this event.
   *
   * The caller is responsible for sending the messages over WebSocket.
   */
  processEvent(event) {
    const { severity, reason } = classifyEvent(event);
    const fingerprint = computeFingerprint(event);
    const sourceLocation = extractSourceLocationFromStack(getEventStack(event));
    const message = {
      event,
      severity,
      reason,
      fingerprint,
      ...sourceLocation !== void 0 ? { sourceLocation } : {}
    };
    const results = /* @__PURE__ */ new Map();
    for (const [id, subscription] of this.subscriptions) {
      if (!this.shouldDeliver(subscription, event, severity, fingerprint)) {
        continue;
      }
      results.set(id, message);
    }
    return results;
  }
  /**
   * Process a batch of browser events through all subscriptions.
   *
   * Returns a map of subscription-id to an array of messages. Only
   * subscriptions that receive at least one event appear in the map.
   */
  processEvents(events) {
    const results = /* @__PURE__ */ new Map();
    for (const event of events) {
      const perEvent = this.processEvent(event);
      for (const [subId, message] of perEvent) {
        let messages = results.get(subId);
        if (!messages) {
          messages = [];
          results.set(subId, messages);
        }
        messages.push(message);
      }
    }
    return results;
  }
  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------
  /**
   * Check whether a subscription should receive a specific event.
   *
   * Evaluates in order:
   * 1. Severity filter (minSeverity)
   * 2. Event type filter (eventTypes)
   * 3. Deduplication (fingerprint LRU)
   */
  shouldDeliver(subscription, event, severity, fingerprint) {
    if (subscription.minSeverity) {
      if (!this.meetsMinSeverity(severity, subscription.minSeverity)) {
        return false;
      }
    }
    if (subscription.eventTypes && subscription.eventTypes.length > 0) {
      if (!subscription.eventTypes.includes(event.type)) {
        return false;
      }
    }
    if (subscription.deduplicate) {
      const dedupSet = this.dedupSets.get(subscription.id);
      if (dedupSet) {
        const isNew = dedupSet.add(fingerprint);
        if (!isNew) {
          return false;
        }
      }
    }
    return true;
  }
  /**
   * Check if an event's severity meets the minimum severity threshold.
   *
   * A lower rank number means more severe. "minSeverity: 'warning'"
   * means crash (0), error (1), and warning (2) pass, but noise (3) does not.
   */
  meetsMinSeverity(eventSeverity, minSeverity) {
    return SEVERITY_RANK[eventSeverity] <= SEVERITY_RANK[minSeverity];
  }
};

// src/debug/error-impact.ts
var DEFAULT_NAVIGATION_CHANGE_THRESHOLD_MS = 500;
var DEFAULT_RENDER_BLOCKED_THRESHOLD = 0.2;
function extractMessage3(event) {
  if ("message" in event) return event.message;
  if (event.type === "network")
    return `${event.method} ${event.requestUrl} ${event.status ?? event.kind}`;
  if (event.type === "resource-error") return `${event.tagName} load failed: ${event.resourceUrl}`;
  return event.type;
}
var ErrorImpactAssessor = class {
  constructor(config) {
    this.beforeState = null;
    this.lastAssessment = null;
    this.config = config;
  }
  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------
  /**
   * Capture a "before" snapshot of the UI state.
   * Call this before an action that might trigger errors.
   */
  captureBeforeState() {
    this.beforeState = this.config.captureUIState();
  }
  /**
   * Assess the impact of a single browser event on the UI.
   *
   * Classifies the event, captures an after-state snapshot, and computes
   * the diff against the before-state to determine UI consequences.
   */
  assessImpact(event) {
    const { severity } = classifyEvent(event);
    const fingerprint = computeFingerprint(event);
    const afterState = this.config.captureUIState();
    const consequences = this.beforeState !== null ? this.computeConsequences(this.beforeState, afterState) : this.emptyConsequences();
    const recoveryStatus = this.beforeState !== null ? this.determineRecovery(consequences) : "unknown";
    const impact = {
      error: {
        message: extractMessage3(event),
        severity,
        fingerprint,
        timestamp: event.timestamp
      },
      uiConsequences: consequences,
      recoveryStatus,
      assessedAt: Date.now()
    };
    this.lastAssessment = impact;
    return impact;
  }
  /**
   * Batch version of assessImpact.
   * Only assesses crash and error severity events (skips warning/noise).
   */
  assessEvents(events) {
    const results = [];
    for (const event of events) {
      const { severity } = classifyEvent(event);
      if (severity === "warning" || severity === "noise") continue;
      results.push(this.assessImpact(event));
    }
    return results;
  }
  /**
   * Get the most recent impact assessment, or null if none has been performed.
   */
  getLastAssessment() {
    return this.lastAssessment;
  }
  // -----------------------------------------------------------------------
  // Private: consequence computation
  // -----------------------------------------------------------------------
  /**
   * Compare before and after UI snapshots to determine what changed.
   */
  computeConsequences(before, after) {
    const renderBlockedThreshold = this.config.renderBlockedThreshold ?? DEFAULT_RENDER_BLOCKED_THRESHOLD;
    const navigationThresholdMs = this.config.navigationChangeThresholdMs ?? DEFAULT_NAVIGATION_CHANGE_THRESHOLD_MS;
    const elementsRemoved = [];
    for (const id of before.elementIds) {
      if (!after.elementIds.has(id)) {
        elementsRemoved.push(id);
      }
    }
    const elementsAdded = [];
    for (const id of after.elementIds) {
      if (!before.elementIds.has(id)) {
        elementsAdded.push(id);
      }
    }
    const elementsDisabled = [];
    for (const id of after.disabledIds) {
      if (!before.disabledIds.has(id)) {
        elementsDisabled.push(id);
      }
    }
    let navigationTriggered;
    if (before.url !== after.url && after.timestamp - before.timestamp <= navigationThresholdMs) {
      navigationTriggered = after.url;
    }
    const beforeCount = before.elementIds.size;
    const afterCount = after.elementIds.size;
    const renderBlocked = beforeCount > 0 && afterCount / beforeCount <= renderBlockedThreshold;
    const errorBoundaryTriggered = this.hasNewErrorBoundaryElements(before, after);
    return {
      elementsRemoved,
      elementsAdded,
      elementsDisabled,
      navigationTriggered,
      renderBlocked,
      errorBoundaryTriggered
    };
  }
  /**
   * Determine recovery status based on UI consequences.
   *
   * - `fatal`: render blocked OR >50% of elements removed
   * - `degraded`: error boundary triggered OR elements disabled OR some elements removed
   * - `recovered`: no significant UI changes (error was handled gracefully)
   * - `unknown`: unable to determine (e.g., no before-state)
   */
  determineRecovery(consequences) {
    if (consequences.renderBlocked) {
      return "fatal";
    }
    if (consequences.elementsRemoved.length > 0 && consequences.elementsAdded.length === 0 && this.beforeState !== null && this.beforeState.elementIds.size > 0 && consequences.elementsRemoved.length / this.beforeState.elementIds.size > 0.5) {
      return "fatal";
    }
    if (consequences.errorBoundaryTriggered) {
      return "degraded";
    }
    if (consequences.elementsDisabled.length > 0) {
      return "degraded";
    }
    if (consequences.elementsRemoved.length > 0) {
      return "degraded";
    }
    return "recovered";
  }
  // -----------------------------------------------------------------------
  // Private: helpers
  // -----------------------------------------------------------------------
  /**
   * Check if new error boundary fallback elements appeared.
   */
  hasNewErrorBoundaryElements(before, after) {
    for (const id of after.errorBoundaryElements) {
      if (!before.errorBoundaryElements.has(id)) {
        return true;
      }
    }
    return false;
  }
  /**
   * Return an empty UIConsequences (used when no before-state is available).
   */
  emptyConsequences() {
    return {
      elementsRemoved: [],
      elementsAdded: [],
      elementsDisabled: [],
      navigationTriggered: void 0,
      renderBlocked: false,
      errorBoundaryTriggered: false
    };
  }
};

// src/debug/element-event-log.ts
var LEVEL_RANK = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3
};
var ERROR_EVENTS = /* @__PURE__ */ new Set([
  "action:failed",
  "workflow:failed",
  "error",
  "browser:error",
  "browser:crash"
]);
var INFO_EVENTS = /* @__PURE__ */ new Set([
  "action:started",
  "action:completed",
  "element:stateChanged",
  "workflow:started",
  "workflow:stepCompleted",
  "workflow:completed"
]);
var entryCounter = 0;
function classifyLevel(eventType) {
  if (ERROR_EVENTS.has(eventType)) return "error";
  if (INFO_EVENTS.has(eventType)) return "info";
  return "debug";
}
function extractElementId(eventType, data) {
  if (data == null || typeof data !== "object") return void 0;
  const d = data;
  if (eventType === "element:registered" || eventType === "element:unregistered") {
    return typeof d.id === "string" ? d.id : void 0;
  }
  return typeof d.elementId === "string" ? d.elementId : void 0;
}
function buildMessage(eventType, elementId, data) {
  const d = data;
  switch (eventType) {
    case "action:failed":
      return `Action failed on ${elementId}: ${d?.error ?? "unknown error"}`;
    case "action:started":
      return `Action started on ${elementId}: ${d?.action ?? ""}`;
    case "action:completed":
      return `Action completed on ${elementId}: ${d?.action ?? ""}`;
    case "element:registered":
      return `Element registered: ${elementId}`;
    case "element:unregistered":
      return `Element unregistered: ${elementId}`;
    case "element:stateChanged":
      return `State changed: ${elementId}`;
    default:
      return `${eventType} on ${elementId}`;
  }
}
var ElementEventLog = class {
  constructor(config = {}) {
    this.buffer = [];
    this.levelOverrides = /* @__PURE__ */ new Map();
    this.maxEntries = config.maxEntries ?? 2e3;
    this.defaultLevel = config.defaultLogLevel ?? "error";
  }
  /**
   * Ingest a bridge event. Extracts element ID, classifies level,
   * gates against the effective level, and appends to the shared buffer.
   */
  ingest(event) {
    const elementId = extractElementId(event.type, event.data);
    if (!elementId) return;
    const level = classifyLevel(event.type);
    const effectiveLevel = this.getElementLogLevel(elementId);
    if (LEVEL_RANK[level] > LEVEL_RANK[effectiveLevel]) return;
    const entry = {
      id: `eel-${++entryCounter}`,
      elementId,
      eventType: event.type,
      level,
      timestamp: event.timestamp,
      message: buildMessage(event.type, elementId, event.data),
      data: event.data
    };
    this.buffer.push(entry);
    while (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }
  }
  /**
   * Query the history for a specific element.
   */
  getHistory(elementId, options = {}) {
    const { eventTypes, minLevel, since, limit, order = "asc" } = options;
    const minRank = minLevel ? LEVEL_RANK[minLevel] : 0;
    let results = [];
    for (const entry of this.buffer) {
      if (entry.elementId !== elementId) continue;
      if (since !== void 0 && entry.timestamp < since) continue;
      if (eventTypes && !eventTypes.includes(entry.eventType)) continue;
      if (minLevel && LEVEL_RANK[entry.level] > minRank) continue;
      results.push(entry);
    }
    if (order === "desc") {
      results.reverse();
    }
    if (limit !== void 0 && results.length > limit) {
      results = results.slice(0, limit);
    }
    return results;
  }
  /**
   * Set a per-element log level override.
   */
  setElementLogLevel(elementId, level) {
    this.levelOverrides.set(elementId, level);
  }
  /**
   * Get the effective log level for an element.
   */
  getElementLogLevel(elementId) {
    return this.levelOverrides.get(elementId) ?? this.defaultLevel;
  }
  /**
   * Remove per-element override and clean up. Entries age out via FIFO.
   */
  removeElement(elementId) {
    this.levelOverrides.delete(elementId);
  }
  /**
   * Clear all entries and overrides.
   */
  clear() {
    this.buffer.length = 0;
    this.levelOverrides.clear();
  }
  /**
   * Get stats about the current buffer.
   */
  getStats() {
    const uniqueElements = /* @__PURE__ */ new Set();
    for (const entry of this.buffer) {
      uniqueElements.add(entry.elementId);
    }
    return {
      totalEntries: this.buffer.length,
      uniqueElements: uniqueElements.size,
      oldestTimestamp: this.buffer.length > 0 ? this.buffer[0].timestamp : null
    };
  }
};

// src/debug/metrics.ts
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
}
var MetricsCollector = class {
  constructor(options = {}) {
    this.history = [];
    this.maxHistoryEntries = options.maxHistoryEntries ?? 1e3;
    this.rateWindow = options.rateWindow ?? 6e4;
  }
  /**
   * Record an element action
   */
  recordElementAction(target, action, response, params) {
    const entry = {
      id: generateId(),
      timestamp: response.timestamp,
      type: "element",
      target,
      action,
      success: response.success,
      durationMs: response.durationMs,
      error: response.error,
      params,
      response: response.elementState
    };
    this.addEntry(entry);
    return entry;
  }
  /**
   * Record a component action
   */
  recordComponentAction(target, action, response, params) {
    const entry = {
      id: generateId(),
      timestamp: response.timestamp,
      type: "component",
      target,
      action,
      success: response.success,
      durationMs: response.durationMs,
      error: response.error,
      params,
      response: response.result
    };
    this.addEntry(entry);
    return entry;
  }
  /**
   * Record a workflow step
   */
  recordWorkflowStep(workflowId, result) {
    const entry = {
      id: generateId(),
      timestamp: result.timestamp,
      type: "workflow-step",
      target: workflowId,
      action: result.stepId,
      success: result.success,
      durationMs: result.durationMs,
      error: result.error,
      response: result.result
    };
    this.addEntry(entry);
    return entry;
  }
  /**
   * Record from a bridge event
   */
  recordEvent(event) {
    if (event.type === "action:completed" || event.type === "action:failed") {
      const data = event.data;
      if (data.elementId) {
        this.recordElementAction(
          data.elementId,
          data.action,
          data.response,
          data.params
        );
      } else if (data.componentId) {
        this.recordComponentAction(
          data.componentId,
          data.action,
          data.response,
          data.params
        );
      }
    }
  }
  /**
   * Get action history
   */
  getHistory(options) {
    let results = [...this.history];
    if (options?.type) {
      results = results.filter((e) => e.type === options.type);
    }
    if (options?.target) {
      results = results.filter((e) => e.target === options.target);
    }
    if (options?.action) {
      results = results.filter((e) => e.action === options.action);
    }
    if (options?.success !== void 0) {
      results = results.filter((e) => e.success === options.success);
    }
    if (options?.since) {
      results = results.filter((e) => e.timestamp >= options.since);
    }
    if (options?.limit) {
      results = results.slice(-options.limit);
    }
    return results;
  }
  /**
   * Get performance metrics
   */
  getMetrics(since) {
    const entries = since ? this.history.filter((e) => e.timestamp >= since) : this.history;
    if (entries.length === 0) {
      return {
        totalActions: 0,
        successfulActions: 0,
        failedActions: 0,
        successRate: 0,
        avgDurationMs: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
        p95DurationMs: 0,
        actionsPerSecond: 0,
        errorsByType: {},
        actionsByType: {}
      };
    }
    const successful = entries.filter((e) => e.success);
    const failed = entries.filter((e) => !e.success);
    const durations = entries.map((e) => e.durationMs).sort((a, b) => a - b);
    const now = Date.now();
    const windowStart = now - this.rateWindow;
    const recentActions = this.history.filter((e) => e.timestamp >= windowStart);
    const windowSeconds = this.rateWindow / 1e3;
    const errorsByType = {};
    for (const entry of failed) {
      const errorType = entry.error?.split(":")[0] || "Unknown";
      errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
    }
    const actionsByType = {};
    for (const entry of entries) {
      const key = `${entry.type}:${entry.action}`;
      actionsByType[key] = (actionsByType[key] || 0) + 1;
    }
    return {
      totalActions: entries.length,
      successfulActions: successful.length,
      failedActions: failed.length,
      successRate: successful.length / entries.length,
      avgDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDurationMs: durations[0],
      maxDurationMs: durations[durations.length - 1],
      p95DurationMs: durations[Math.floor(durations.length * 0.95)],
      actionsPerSecond: recentActions.length / windowSeconds,
      errorsByType,
      actionsByType
    };
  }
  /**
   * Get recent errors
   */
  getRecentErrors(limit = 10) {
    return this.history.filter((e) => !e.success).slice(-limit);
  }
  /**
   * Get slowest actions
   */
  getSlowestActions(limit = 10) {
    return [...this.history].sort((a, b) => b.durationMs - a.durationMs).slice(0, limit);
  }
  /**
   * Clear history
   */
  clearHistory() {
    this.history = [];
  }
  /**
   * Export history as JSON
   */
  exportHistory() {
    return JSON.stringify(this.history, null, 2);
  }
  /**
   * Import history from JSON
   */
  importHistory(json) {
    const entries = JSON.parse(json);
    this.history = entries.slice(-this.maxHistoryEntries);
  }
  addEntry(entry) {
    this.history.push(entry);
    while (this.history.length > this.maxHistoryEntries) {
      this.history.shift();
    }
  }
};
function createMetricsCollector(options) {
  return new MetricsCollector(options);
}
function formatDuration(ms) {
  if (ms < 1) return "<1ms";
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  if (ms < 6e4) return `${(ms / 1e3).toFixed(1)}s`;
  return `${(ms / 6e4).toFixed(1)}m`;
}
function formatPercentage(value) {
  return `${(value * 100).toFixed(1)}%`;
}

// src/debug/click-highlight.ts
var DEFAULT_OPTIONS = {
  color: "#00c800",
  duration: 800,
  size: 30,
  ripple: true
};
var HIGHLIGHT_CLASS = "ui-bridge-click-highlight";
var styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      border-radius: 50%;
      border: 3px solid var(--highlight-color, #00c800);
      opacity: 1;
      transform: scale(0.5);
      animation: ui-bridge-click-fade var(--highlight-duration, 800ms) ease-out forwards;
    }

    .${HIGHLIGHT_CLASS}--ripple {
      position: fixed;
      pointer-events: none;
      z-index: 999998;
      border-radius: 50%;
      border: 2px solid var(--highlight-color, #00c800);
      opacity: 0.5;
      transform: scale(0.5);
      animation: ui-bridge-click-ripple var(--highlight-duration, 800ms) ease-out forwards;
    }

    @keyframes ui-bridge-click-fade {
      0% {
        opacity: 1;
        transform: scale(0.5);
      }
      50% {
        opacity: 0.8;
        transform: scale(1);
      }
      100% {
        opacity: 0;
        transform: scale(1.2);
      }
    }

    @keyframes ui-bridge-click-ripple {
      0% {
        opacity: 0.5;
        transform: scale(0.5);
      }
      100% {
        opacity: 0;
        transform: scale(2);
      }
    }
  `;
  document.head.appendChild(style);
}
function showClickHighlight(x, y, options) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  injectStyles();
  const el = document.createElement("div");
  el.className = HIGHLIGHT_CLASS;
  el.style.setProperty("--highlight-color", opts.color);
  el.style.setProperty("--highlight-duration", `${opts.duration}ms`);
  el.style.width = `${opts.size}px`;
  el.style.height = `${opts.size}px`;
  el.style.left = `${x - opts.size / 2}px`;
  el.style.top = `${y - opts.size / 2}px`;
  document.body.appendChild(el);
  if (opts.ripple) {
    const ripple = document.createElement("div");
    ripple.className = `${HIGHLIGHT_CLASS}--ripple`;
    ripple.style.setProperty("--highlight-color", opts.color);
    ripple.style.setProperty("--highlight-duration", `${opts.duration}ms`);
    ripple.style.width = `${opts.size}px`;
    ripple.style.height = `${opts.size}px`;
    ripple.style.left = `${x - opts.size / 2}px`;
    ripple.style.top = `${y - opts.size / 2}px`;
    document.body.appendChild(ripple);
    setTimeout(() => {
      ripple.remove();
    }, opts.duration);
  }
  setTimeout(() => {
    el.remove();
  }, opts.duration);
}
function showElementHighlight(element, options) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  showClickHighlight(centerX, centerY, options);
}
var HIGHLIGHT_COLORS = {
  click: "#00c800",
  // Green
  type: "#0064ff",
  // Blue
  scroll: "#ff8c00",
  // Orange
  select: "#b400b4",
  // Purple
  focus: "#00b4b4",
  // Teal
  error: "#ff0000"
  // Red
};

exports.BrowserEventCapture = BrowserEventCapture;
exports.BrowserEventStream = BrowserEventStream;
exports.DEFAULT_CAPTURE_CONFIG = DEFAULT_CAPTURE_CONFIG;
exports.DEFAULT_NOISE_PATTERNS = DEFAULT_NOISE_PATTERNS;
exports.ElementEventLog = ElementEventLog;
exports.ErrorImpactAssessor = ErrorImpactAssessor;
exports.ErrorSession = ErrorSession;
exports.ErrorSessionManager = ErrorSessionManager;
exports.ErrorSnapshotBuffer = ErrorSnapshotBuffer;
exports.HIGHLIGHT_COLORS = HIGHLIGHT_COLORS;
exports.InfoPanel = InfoPanel;
exports.Inspector = Inspector;
exports.InspectorOverlay = InspectorOverlay;
exports.MemoryTrendAnalyzer = MemoryTrendAnalyzer;
exports.MetricsCollector = MetricsCollector;
exports.NetworkChainTracker = NetworkChainTracker;
exports.SEVERITY_RANK = SEVERITY_RANK;
exports.TimelineBuffer = TimelineBuffer;
exports.classifyEvent = classifyEvent;
exports.classifyEvents = classifyEvents;
exports.computeFingerprint = computeFingerprint;
exports.computeHealthReport = computeHealthReport;
exports.computeHealthScore = computeHealthScore;
exports.computeHealthStatus = computeHealthStatus;
exports.createMetricsCollector = createMetricsCollector;
exports.deduplicateEvents = deduplicateEvents;
exports.extractMessage = extractMessage2;
exports.extractSourceLocation = extractSourceLocation;
exports.filterBySeverity = filterBySeverity;
exports.formatDuration = formatDuration;
exports.formatPercentage = formatPercentage;
exports.getActiveOverlays = getActiveOverlays;
exports.getEventStack = getEventStack;
exports.installFrameworkOverlayCapture = installFrameworkOverlayCapture;
exports.showClickHighlight = showClickHighlight;
exports.showElementHighlight = showElementHighlight;
exports.useInspector = useInspector;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map