// src/core/query-builder.ts
var UIQuery = class _UIQuery {
  constructor(registry, resolveElements) {
    this.registry = registry;
    this.resolveElements = resolveElements;
  }
  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------
  /**
   * Create a query starting from all mounted elements in the registry.
   */
  static from(registry) {
    return new _UIQuery(
      registry,
      () => registry.getAllElements().filter((el) => el.mounted).map((el) => el.element)
    );
  }
  // ---------------------------------------------------------------------------
  // Selectors — narrow the starting set
  // ---------------------------------------------------------------------------
  /**
   * Start from elements matching a CSS selector.
   */
  select(selector) {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => {
      const scope = parent();
      const matched = /* @__PURE__ */ new Set();
      for (const el of scope) {
        try {
          if (el.matches(selector)) matched.add(el);
        } catch {
        }
      }
      return Array.from(matched);
    });
  }
  // ---------------------------------------------------------------------------
  // Traversal — move through the DOM tree
  // ---------------------------------------------------------------------------
  /**
   * Get direct children of each element in the current set.
   */
  children() {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => {
      const result = [];
      for (const el of parent()) {
        for (const child of el.children) {
          if (child instanceof HTMLElement) {
            result.push(child);
          }
        }
      }
      return result;
    });
  }
  /**
   * Get the direct parent of each element in the current set.
   */
  parent() {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => {
      const seen = /* @__PURE__ */ new Set();
      for (const el of parent()) {
        const p = el.parentElement;
        if (p && !seen.has(p)) {
          seen.add(p);
        }
      }
      return Array.from(seen);
    });
  }
  /**
   * Get all descendants matching an optional CSS selector.
   * Without a selector, returns all descendant HTMLElements.
   */
  descendants(selector) {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => {
      const result = /* @__PURE__ */ new Set();
      for (const el of parent()) {
        const matches = selector ? el.querySelectorAll(selector) : el.querySelectorAll("*");
        matches.forEach((m) => result.add(m));
      }
      return Array.from(result);
    });
  }
  /**
   * Get direct siblings (previous + next) of each element in the current set.
   */
  siblings() {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => {
      const result = /* @__PURE__ */ new Set();
      for (const el of parent()) {
        const p = el.parentElement;
        if (!p) continue;
        for (const child of p.children) {
          if (child instanceof HTMLElement && child !== el) {
            result.add(child);
          }
        }
      }
      return Array.from(result);
    });
  }
  /**
   * Find descendants matching a CSS selector (alias for descendants with required selector).
   */
  find(selector) {
    return this.descendants(selector);
  }
  /**
   * Walk up the DOM tree to find the closest ancestor matching a selector.
   */
  closest(selector) {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => {
      const result = /* @__PURE__ */ new Set();
      for (const el of parent()) {
        const match = el.closest(selector);
        if (match) result.add(match);
      }
      return Array.from(result);
    });
  }
  // ---------------------------------------------------------------------------
  // Filters — narrow by attributes / state
  // ---------------------------------------------------------------------------
  /**
   * Filter to elements whose visible text contains the given string (case-insensitive).
   */
  withText(text) {
    const parent = this.resolveElements;
    const lowerText = text.toLowerCase();
    return new _UIQuery(
      this.registry,
      () => parent().filter((el) => {
        const content = el.textContent?.trim().toLowerCase() ?? "";
        return content.includes(lowerText);
      })
    );
  }
  /**
   * Filter to elements whose visible text matches exactly (case-insensitive).
   */
  withExactText(text) {
    const parent = this.resolveElements;
    const lowerText = text.toLowerCase();
    return new _UIQuery(
      this.registry,
      () => parent().filter((el) => {
        const content = el.textContent?.trim().toLowerCase() ?? "";
        return content === lowerText;
      })
    );
  }
  /**
   * Filter to elements with a specific ARIA or HTML role.
   */
  withRole(role) {
    const parent = this.resolveElements;
    const lowerRole = role.toLowerCase();
    return new _UIQuery(
      this.registry,
      () => parent().filter((el) => {
        const elRole = el.getAttribute("role")?.toLowerCase() ?? el.tagName.toLowerCase();
        return elRole === lowerRole;
      })
    );
  }
  /**
   * Filter to elements with a specific ElementType in the registry.
   */
  withType(type) {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => {
      const registered = /* @__PURE__ */ new Map();
      for (const reg of this.registry.getAllElements()) {
        if (reg.mounted) registered.set(reg.element, reg);
      }
      return parent().filter((el) => registered.get(el)?.type === type);
    });
  }
  /**
   * Filter to elements having a specific attribute, optionally with a specific value.
   */
  withAttr(name, value) {
    const parent = this.resolveElements;
    return new _UIQuery(
      this.registry,
      () => parent().filter((el) => {
        if (value !== void 0) {
          return el.getAttribute(name) === value;
        }
        return el.hasAttribute(name);
      })
    );
  }
  /**
   * Filter to elements with a specific data-testid.
   */
  withTestId(testId) {
    return this.withAttr("data-testid", testId);
  }
  /**
   * Filter to elements that are currently visible in the viewport.
   */
  visible() {
    const parent = this.resolveElements;
    return new _UIQuery(
      this.registry,
      () => parent().filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && parseFloat(style.opacity) > 0;
      })
    );
  }
  /**
   * Filter to elements that are enabled (not disabled).
   */
  enabled() {
    const parent = this.resolveElements;
    return new _UIQuery(
      this.registry,
      () => parent().filter((el) => {
        if ("disabled" in el && el.disabled) return false;
        if (el.getAttribute("aria-disabled") === "true") return false;
        return true;
      })
    );
  }
  /**
   * Filter with a custom predicate on the DOM element.
   */
  filter(predicate) {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => parent().filter(predicate));
  }
  /**
   * Limit the result set to the first N elements.
   */
  limit(n) {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => parent().slice(0, n));
  }
  /**
   * Get the element at a specific index (0-based). Returns a single-element query.
   */
  at(index) {
    const parent = this.resolveElements;
    return new _UIQuery(this.registry, () => {
      const els = parent();
      const el = els[index];
      return el ? [el] : [];
    });
  }
  // ---------------------------------------------------------------------------
  // Terminals — execute the query and return results
  // ---------------------------------------------------------------------------
  /**
   * Execute the query and return the first matching registered element, or undefined.
   */
  first() {
    const results = this.all();
    return results[0];
  }
  /**
   * Execute the query and return all matching elements that are registered in the registry.
   * Unregistered DOM elements are excluded.
   */
  all() {
    const domElements = this.resolveElements();
    const registered = /* @__PURE__ */ new Map();
    for (const reg of this.registry.getAllElements()) {
      if (reg.mounted) registered.set(reg.element, reg);
    }
    const results = [];
    for (const el of domElements) {
      const reg = registered.get(el);
      if (reg) {
        results.push({
          element: reg,
          state: reg.getState(),
          domElement: el
        });
      }
    }
    return results;
  }
  /**
   * Execute the query and return all matching DOM elements, including unregistered ones.
   * Use this when you need to traverse DOM structure beyond registered elements.
   */
  allDom() {
    return this.resolveElements();
  }
  /**
   * Return the count of matching registered elements.
   */
  count() {
    return this.all().length;
  }
  /**
   * Return the count of matching DOM elements (including unregistered).
   */
  countDom() {
    return this.resolveElements().length;
  }
  /**
   * Check if any matching registered element exists.
   */
  exists() {
    return this.count() > 0;
  }
};

// src/core/recency.ts
var Any = Object.freeze({ kind: "any" });
var Current = Object.freeze({ kind: "current" });
function MaxAge(ms) {
  return Object.freeze({ kind: "maxAge", ms });
}
var Default = MaxAge(5e3);
var Recency = { Any, Current, MaxAge, Default };
function isSatisfiedBy(recency, ageMs) {
  switch (recency.kind) {
    case "any":
      return true;
    case "current":
      return false;
    case "maxAge":
      return ageMs <= recency.ms;
  }
}
function requiresFetch(recency) {
  return recency.kind === "current";
}
function mightRequireFetch(recency) {
  return recency.kind !== "any";
}
function parseRecency(value) {
  if (value === void 0 || value === null) return Recency.Default;
  if (value === "any") return Recency.Any;
  if (value === "current") return Recency.Current;
  const ms = typeof value === "number" ? value : parseInt(value, 10);
  if (!isNaN(ms) && ms > 0) return Recency.MaxAge(ms);
  return Recency.Default;
}

// src/core/change-observer.ts
var DEFAULT_CONFIG = {
  bufferCapacity: 5e3,
  batchIntervalMs: 16
};
var ChangeObserver = class {
  constructor(config) {
    this.buffer = [];
    this.subscribers = /* @__PURE__ */ new Set();
    // Pending batch accumulation
    this.pendingAdded = /* @__PURE__ */ new Set();
    this.pendingRemoved = /* @__PURE__ */ new Set();
    this.pendingModified = /* @__PURE__ */ new Set();
    this.batchTimer = null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  // ==========================================================================
  // Event Ingestion — called by the registry or DOM observers
  // ==========================================================================
  /** An element was registered (appeared in the DOM). */
  onElementAdded(elementId) {
    this.pendingAdded.add(elementId);
    this.pendingRemoved.delete(elementId);
    this.scheduleBatchFlush();
  }
  /** An element was unregistered (removed from the DOM). */
  onElementRemoved(elementId) {
    this.pendingRemoved.add(elementId);
    if (this.pendingAdded.delete(elementId)) {
      this.pendingRemoved.delete(elementId);
    }
    this.scheduleBatchFlush();
  }
  /** An element's state changed (value, visibility, etc.). */
  onElementModified(elementId) {
    if (!this.pendingAdded.has(elementId) && !this.pendingRemoved.has(elementId)) {
      this.pendingModified.add(elementId);
    }
    this.scheduleBatchFlush();
  }
  // ==========================================================================
  // Subscription
  // ==========================================================================
  /** Subscribe to batched change events. Returns an unsubscribe function. */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
  /** Number of active subscribers. */
  get subscriberCount() {
    return this.subscribers.size;
  }
  // ==========================================================================
  // Buffer Access
  // ==========================================================================
  /** Get buffered events since a timestamp. */
  getEventsSince(since, limit = 100) {
    return this.buffer.filter((e) => e.timestamp > since).slice(-limit);
  }
  /** Current buffer size. */
  get bufferSize() {
    return this.buffer.length;
  }
  // ==========================================================================
  // Cleanup
  // ==========================================================================
  /** Stop all timers and clear state. */
  destroy() {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingAdded.clear();
    this.pendingRemoved.clear();
    this.pendingModified.clear();
    this.subscribers.clear();
    this.buffer.length = 0;
  }
  // ==========================================================================
  // Internal
  // ==========================================================================
  scheduleBatchFlush() {
    if (this.batchTimer !== null) return;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushBatch();
    }, this.config.batchIntervalMs);
  }
  flushBatch() {
    const added = Array.from(this.pendingAdded);
    const removed = Array.from(this.pendingRemoved);
    const modified = Array.from(this.pendingModified);
    this.pendingAdded.clear();
    this.pendingRemoved.clear();
    this.pendingModified.clear();
    if (added.length === 0 && removed.length === 0 && modified.length === 0) return;
    const event = {
      type: "subtreeChanged",
      timestamp: Date.now(),
      added,
      removed,
      modified
    };
    this.buffer.push(event);
    if (this.buffer.length > this.config.bufferCapacity) {
      this.buffer.splice(0, this.buffer.length - this.config.bufferCapacity);
    }
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
      }
    }
  }
};

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
function createElementIdentifier(element) {
  return {
    testId: element.getAttribute("data-testid") || void 0,
    awasId: element.getAttribute("data-awas-element") || void 0,
    htmlId: element.id || void 0,
    xpath: generateXPath(element),
    selector: generateCSSSelector(element)
  };
}

// src/core/class-name.ts
function classString(el) {
  if (!el) return "";
  const cn = el.className;
  if (typeof cn === "string") return cn;
  const baseVal = cn?.baseVal;
  return typeof baseVal === "string" ? baseVal : "";
}
function classList(el) {
  const s = classString(el).trim();
  return s ? s.split(/\s+/) : [];
}

// src/core/element-fingerprint.ts
var ARIA_LANDMARKS = /* @__PURE__ */ new Set([
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search"
]);
var IMPLICIT_LANDMARKS = {
  NAV: "navigation",
  MAIN: "main",
  HEADER: "banner",
  FOOTER: "contentinfo",
  ASIDE: "complementary",
  FORM: "form",
  SEARCH: "search"
};
var IMPLICIT_ROLES = {
  BUTTON: "button",
  A: (el) => el.hasAttribute("href") ? "link" : "",
  INPUT: (el) => {
    const type = el.type?.toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "submit" || type === "reset" || type === "button") return "button";
    return "textbox";
  },
  SELECT: (el) => el.multiple ? "listbox" : "combobox",
  TEXTAREA: "textbox",
  IMG: "img",
  TABLE: "table",
  UL: "list",
  OL: "list",
  LI: "listitem",
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  DIALOG: "dialog",
  DETAILS: "group",
  SUMMARY: "button",
  PROGRESS: "progressbar",
  METER: "meter"
};
var DYNAMIC_PATTERNS = [
  // UUIDs
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  // ISO dates
  /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/g,
  // Timestamps (10+ digits)
  /\b\d{10,13}\b/g,
  // Standalone numbers (3+ digits, not part of a word)
  /\b\d{3,}\b/g,
  // Common date formats (MM/DD/YYYY, DD.MM.YYYY)
  /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g,
  // Time patterns
  /\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?/g
];
function computeStructuralPath(element) {
  const parts = [];
  let current = element;
  while (current && current.tagName !== "BODY" && current.tagName !== "HTML") {
    parts.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }
  return parts.join(" > ");
}
function computePositionZone(element) {
  let ancestor = element;
  while (ancestor) {
    if (ancestor.getAttribute("role") === "dialog" || ancestor.getAttribute("aria-modal") === "true" || ancestor.tagName === "DIALOG") {
      return "modal";
    }
    ancestor = ancestor.parentElement;
  }
  const rect = element.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw === 0 || vh === 0) return "main";
  const centerY = (rect.top + rect.bottom) / 2 / vh;
  const centerX = (rect.left + rect.right) / 2 / vw;
  if (centerY < 0.1) return "header";
  if (centerY > 0.9) return "footer";
  if (centerX < 0.2) return "sidebar-left";
  if (centerX > 0.8) return "sidebar-right";
  return "main";
}
function computeRole(element) {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const implicit = IMPLICIT_ROLES[element.tagName];
  if (typeof implicit === "function") return implicit(element);
  if (typeof implicit === "string") return implicit;
  return "";
}
function computeAccessibleName(element) {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return normalizeName(ariaLabel);
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
    if (parts.length > 0) return normalizeName(parts.join(" "));
  }
  const tag = element.tagName;
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY" || tag.match(/^H[1-6]$/) || element.getAttribute("role") === "button" || element.getAttribute("role") === "link" || element.getAttribute("role") === "tab") {
    const text = element.textContent?.trim();
    if (text) return normalizeName(text);
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label?.textContent?.trim()) return normalizeName(label.textContent.trim());
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel?.textContent?.trim()) return normalizeName(wrappingLabel.textContent.trim());
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) return normalizeName(placeholder);
  }
  return void 0;
}
function normalizeName(name) {
  let normalized = name.trim();
  for (const pattern of DYNAMIC_PATTERNS) {
    normalized = normalized.replace(pattern, "{\u2026}");
  }
  normalized = normalized.replace(/\s+/g, " ");
  if (normalized.length > 50) {
    normalized = normalized.slice(0, 50);
  }
  return normalized;
}
function computeSizeCategory(element) {
  const rect = element.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  if (viewportArea === 0) return "medium";
  const ratio = rect.width * rect.height / viewportArea;
  if (ratio < 5e-3) return "icon";
  if (ratio < 0.01) return "button";
  if (ratio < 0.03) return "small";
  if (ratio < 0.1) return "medium";
  if (ratio < 0.3) return "large";
  if (ratio < 0.6) return "fullwidth";
  return "panel";
}
function computeLandmarkContext(element) {
  let current = element.parentElement;
  while (current && current.tagName !== "BODY" && current.tagName !== "HTML") {
    const role = current.getAttribute("role");
    if (role && ARIA_LANDMARKS.has(role)) {
      return { landmark: role, label: current.getAttribute("aria-label") || void 0 };
    }
    const implicitLandmark = IMPLICIT_LANDMARKS[current.tagName];
    if (implicitLandmark) {
      return { landmark: implicitLandmark, label: current.getAttribute("aria-label") || void 0 };
    }
    current = current.parentElement;
  }
  return { landmark: "", label: void 0 };
}
function computeRepeatPattern(element) {
  const parent = element.parentElement;
  if (!parent) return void 0;
  const parentRole = parent.getAttribute("role");
  const parentTag = parent.tagName;
  let containerType;
  if (parentRole === "list" || parentTag === "UL" || parentTag === "OL") {
    containerType = "list";
  } else if (parentRole === "grid" || parentRole === "row") {
    containerType = "grid";
  } else if (parentTag === "TABLE" || parentTag === "TBODY" || parentTag === "THEAD") {
    containerType = "table";
  }
  if (!containerType) {
    const children = Array.from(parent.children);
    if (children.length >= 3) {
      const signature = (el) => `${el.tagName}|${classString(el)}`;
      const sig = signature(element);
      const matches = children.filter((c) => signature(c) === sig);
      if (matches.length >= 3) {
        containerType = "list";
      } else {
        return void 0;
      }
    } else {
      return void 0;
    }
  }
  const siblings = Array.from(parent.children);
  const itemTag = element.tagName;
  const itemClass = classString(element);
  const matchingSiblings = siblings.filter(
    (s) => s.tagName === itemTag && classString(s) === itemClass
  );
  const index = matchingSiblings.indexOf(element);
  const containerSelector = generateSimpleSelector(parent);
  const itemClassTokens = classList(element);
  const itemSelector = `${element.tagName.toLowerCase()}${itemClassTokens.length > 0 ? "." + itemClassTokens.map((c) => CSS.escape(c)).join(".") : ""}`;
  return {
    type: containerType,
    containerSelector,
    itemSelector,
    index: Math.max(0, index),
    totalCount: matchingSiblings.length
  };
}
function generateSimpleSelector(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;
  return element.tagName.toLowerCase();
}
function computeHashSync(structuralPath, positionZone, role, accessibleName, sizeCategory) {
  const input = `${structuralPath}|${positionZone}|${role}|${accessibleName ?? ""}|${sizeCategory}`;
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 ^= c * 31;
    h2 = Math.imul(h2, 16777619);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return hex1 + hex2;
}
function computeElementFingerprint(element) {
  const structuralPath = computeStructuralPath(element);
  const positionZone = computePositionZone(element);
  const role = computeRole(element);
  const accessibleName = computeAccessibleName(element);
  const sizeCategory = computeSizeCategory(element);
  const { landmark, label: landmarkLabel } = computeLandmarkContext(element);
  const repeatPattern = computeRepeatPattern(element);
  const rect = element.getBoundingClientRect();
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const fingerprint = {
    hash: computeHashSync(structuralPath, positionZone, role, accessibleName, sizeCategory),
    structuralPath,
    positionZone,
    landmarkContext: landmark,
    role,
    tagName: element.tagName.toLowerCase(),
    sizeCategory,
    relativePosition: {
      top: Math.round(rect.top / vh * 1e3) / 1e3,
      left: Math.round(rect.left / vw * 1e3) / 1e3
    },
    isRepeating: repeatPattern !== void 0
  };
  if (landmarkLabel) fingerprint.landmarkLabel = landmarkLabel;
  if (accessibleName) fingerprint.accessibleName = accessibleName;
  if (repeatPattern) fingerprint.repeatPattern = repeatPattern;
  return fingerprint;
}
function computeAllFingerprints(registry) {
  const result = /* @__PURE__ */ new Map();
  const elements = registry.getAllElements();
  for (const registered of elements) {
    if (!registered.mounted || !registered.element.isConnected) continue;
    const fingerprint = computeElementFingerprint(registered.element);
    if (!result.has(fingerprint.hash)) {
      result.set(fingerprint.hash, fingerprint);
    }
  }
  return result;
}
function computeFingerprintsWithMapping(registry) {
  const fingerprints = /* @__PURE__ */ new Map();
  const hashToElementIds = /* @__PURE__ */ new Map();
  const elementIdToHash = /* @__PURE__ */ new Map();
  const elements = registry.getAllElements();
  for (const registered of elements) {
    if (!registered.mounted || !registered.element.isConnected) continue;
    const fingerprint = computeElementFingerprint(registered.element);
    if (!fingerprints.has(fingerprint.hash)) {
      fingerprints.set(fingerprint.hash, fingerprint);
    }
    const ids = hashToElementIds.get(fingerprint.hash) || [];
    ids.push(registered.id);
    hashToElementIds.set(fingerprint.hash, ids);
    elementIdToHash.set(registered.id, fingerprint.hash);
  }
  return { fingerprints, hashToElementIds, elementIdToHash };
}
function findNearestRegisteredElement(target, registry) {
  let current = target;
  while (current && current.tagName !== "BODY") {
    const registered = registry.findByDOMElement(current);
    if (registered) return registered;
    current = current.parentElement;
  }
  return void 0;
}

// src/core/stable-ref.ts
function buildSemanticPath(element) {
  const parts = [];
  let current = element;
  let depth = 0;
  while (current && current.tagName !== "BODY" && current.tagName !== "HTML" && depth < 8) {
    let selector = current.tagName.toLowerCase();
    const testId = current.getAttribute("data-testid");
    if (testId) {
      parts.unshift(`[data-testid="${testId}"]`);
      break;
    }
    const htmlId = current.id;
    if (htmlId && !/^:r[0-9a-z]+:$/.test(htmlId)) {
      parts.unshift(`#${CSS.escape(htmlId)}`);
      break;
    }
    const role = current.getAttribute("role");
    if (role) {
      selector += `[role="${role}"]`;
    }
    const classes = Array.from(current.classList).filter(
      (c) => c.length > 2 && !c.startsWith("css-") && !c.startsWith("_")
    );
    if (classes.length > 0) {
      selector += `.${CSS.escape(classes[0])}`;
    }
    parts.unshift(selector);
    current = current.parentElement;
    depth++;
  }
  return parts.length > 0 ? parts.join(" > ") : void 0;
}
function createStableRef(element) {
  const fingerprint = computeElementFingerprint(element.element);
  const semanticPath = buildSemanticPath(element.element) ?? element.element.tagName.toLowerCase();
  const idStrategy = element.element.getAttribute("data-testid") ? "data-testid" : element.element.id && !/^:r[0-9a-z]+:$/.test(element.element.id) ? "html-id" : "prefer-existing";
  const stableId = element.element.getAttribute("data-ui-bridge-id") || void 0;
  return {
    id: element.id,
    idStrategy,
    primaryId: element.id,
    fingerprint: fingerprint.hash,
    semanticPath,
    stableId,
    lastSeenAt: Date.now()
  };
}
function resolveStableRef(ref) {
  const registry = getGlobalRegistry();
  const byId = registry.getElement(ref.primaryId);
  if (byId && byId.mounted && byId.element.isConnected) {
    return byId;
  }
  if (typeof document !== "undefined") {
    const byAttr = document.querySelector(
      `[data-ui-bridge-id="${CSS.escape(ref.primaryId)}"]`
    );
    if (byAttr) {
      const registered = registry.findByDOMElement(byAttr);
      if (registered && registered.mounted) {
        return registered;
      }
      const nearest = findNearestRegisteredElement(byAttr, registry);
      if (nearest && nearest.mounted) {
        return nearest;
      }
    }
  }
  const allElements = registry.getAllElements();
  for (const el of allElements) {
    if (!el.mounted || !el.element.isConnected) continue;
    const fp = computeElementFingerprint(el.element);
    if (fp.hash === ref.fingerprint) {
      return el;
    }
  }
  if (ref.semanticPath && typeof document !== "undefined") {
    try {
      const byPath = document.querySelector(ref.semanticPath);
      if (byPath) {
        const registered = registry.findByDOMElement(byPath);
        if (registered && registered.mounted) {
          return registered;
        }
        const nearest = findNearestRegisteredElement(byPath, registry);
        if (nearest && nearest.mounted) {
          return nearest;
        }
      }
    } catch {
    }
  }
  return null;
}

// src/ai/fuzzy-matcher.ts
var DEFAULT_FUZZY_CONFIG = {
  threshold: 0.7,
  levenshteinWeight: 0.3,
  jaroWinklerWeight: 0.4,
  ngramWeight: 0.3,
  ngramSize: 2,
  caseSensitive: false,
  ignoreWhitespace: true
};
function levenshteinDistance(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        // deletion
        matrix[i][j - 1] + 1,
        // insertion
        matrix[i - 1][j - 1] + cost
        // substitution
      );
    }
  }
  return matrix[len1][len2];
}
function levenshteinSimilarity(s1, s2) {
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - distance / maxLength;
}
function jaroSimilarity(s1, s2) {
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}
function jaroWinklerSimilarity(s1, s2, prefixScale = 0.1) {
  const jaroSim = jaroSimilarity(s1, s2);
  let prefixLength = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLength++;
    } else {
      break;
    }
  }
  return jaroSim + prefixLength * prefixScale * (1 - jaroSim);
}
function generateNgrams(s, n) {
  const ngrams = /* @__PURE__ */ new Set();
  if (s.length < n) {
    ngrams.add(s);
    return ngrams;
  }
  for (let i = 0; i <= s.length - n; i++) {
    ngrams.add(s.substring(i, i + n));
  }
  return ngrams;
}
function ngramSimilarity(s1, s2, n = 2) {
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  const ngrams1 = generateNgrams(s1, n);
  const ngrams2 = generateNgrams(s2, n);
  let intersection = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) {
      intersection++;
    }
  }
  const union = ngrams1.size + ngrams2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
function normalizeString(s, config = {}) {
  let normalized = s;
  if (!config.caseSensitive) {
    normalized = normalized.toLowerCase();
  }
  if (config.ignoreWhitespace !== false) {
    normalized = normalized.replace(/\s+/g, " ").trim();
  }
  return normalized;
}
function fuzzyMatch(source, target, config = {}) {
  const finalConfig = { ...DEFAULT_FUZZY_CONFIG, ...config };
  const normalizedSource = normalizeString(source, finalConfig);
  const normalizedTarget = normalizeString(target, finalConfig);
  const levenshteinScore = levenshteinSimilarity(normalizedSource, normalizedTarget);
  const jaroWinklerScore = jaroWinklerSimilarity(normalizedSource, normalizedTarget);
  const ngramScore = ngramSimilarity(normalizedSource, normalizedTarget, finalConfig.ngramSize);
  const similarity = levenshteinScore * finalConfig.levenshteinWeight + jaroWinklerScore * finalConfig.jaroWinklerWeight + ngramScore * finalConfig.ngramWeight;
  return {
    similarity,
    isMatch: similarity >= finalConfig.threshold,
    scores: {
      levenshtein: levenshteinScore,
      jaroWinkler: jaroWinklerScore,
      ngram: ngramScore
    },
    normalizedSource,
    normalizedTarget
  };
}
function tokenize(s) {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().split(" ").filter((token) => token.length > 0);
}

// src/ai/alias-generator.ts
var DEFAULT_ALIAS_CONFIG = {
  includeText: true,
  includeAriaLabel: true,
  includePlaceholder: true,
  includeTitle: true,
  includeSynonyms: true,
  maxAliases: 20,
  minLength: 2,
  maxLength: 50
};
var SYNONYMS = {
  // Submit-related
  submit: ["send", "go", "confirm", "ok", "apply", "save", "done", "finish"],
  send: ["submit", "deliver", "post"],
  save: ["submit", "store", "keep", "apply"],
  cancel: ["close", "dismiss", "abort", "back", "exit", "quit", "nevermind"],
  close: ["cancel", "dismiss", "exit", "x"],
  delete: ["remove", "trash", "erase", "clear", "destroy"],
  remove: ["delete", "clear", "discard"],
  edit: ["modify", "change", "update", "alter"],
  update: ["edit", "modify", "save", "refresh"],
  add: ["create", "new", "plus", "insert"],
  create: ["add", "new", "make"],
  search: ["find", "lookup", "query", "filter"],
  find: ["search", "locate", "lookup"],
  login: ["signin", "sign in", "log in", "authenticate", "enter"],
  logout: ["signout", "sign out", "log out", "exit"],
  register: ["signup", "sign up", "join", "create account"],
  next: ["continue", "forward", "proceed", "advance"],
  previous: ["back", "backward", "return", "prior"],
  back: ["previous", "return", "backward"],
  start: ["begin", "launch", "initiate", "run", "execute"],
  stop: ["end", "halt", "pause", "terminate"],
  enable: ["activate", "turn on", "switch on"],
  disable: ["deactivate", "turn off", "switch off"],
  show: ["display", "reveal", "view", "open"],
  hide: ["conceal", "collapse", "close"],
  expand: ["open", "show", "unfold", "reveal"],
  collapse: ["close", "hide", "fold", "minimize"],
  yes: ["ok", "confirm", "agree", "accept"],
  no: ["cancel", "decline", "reject", "deny"],
  help: ["support", "assistance", "info", "information", "faq"],
  settings: ["preferences", "options", "config", "configuration"],
  profile: ["account", "user", "me"],
  download: ["export", "save", "get"],
  upload: ["import", "load", "attach"],
  refresh: ["reload", "update", "sync"],
  copy: ["duplicate", "clone"],
  paste: ["insert"],
  select: ["choose", "pick"],
  toggle: ["switch", "flip"],
  // Form fields
  email: ["e-mail", "mail"],
  password: ["pass", "pwd", "secret"],
  username: ["user", "login", "account", "name"],
  firstname: ["first name", "given name", "forename"],
  lastname: ["last name", "surname", "family name"],
  fullname: ["full name", "name", "complete name"],
  phone: ["telephone", "tel", "mobile", "cell"],
  address: ["location", "street"],
  city: ["town"],
  country: ["nation"],
  zip: ["zipcode", "postal", "postal code", "postcode"],
  // Navigation
  home: ["main", "start", "dashboard"],
  menu: ["navigation", "nav"],
  sidebar: ["side bar", "side panel", "side menu"]
};
var ELEMENT_ACTION_WORDS = {
  button: ["button", "btn", "click"],
  input: ["input", "field", "textbox", "box"],
  textarea: ["textarea", "text area", "text field", "multiline"],
  select: ["select", "dropdown", "combo", "picker", "chooser"],
  checkbox: ["checkbox", "check", "tick"],
  radio: ["radio", "option", "choice"],
  link: ["link", "anchor", "href"],
  form: ["form"],
  menu: ["menu"],
  menuitem: ["menu item", "option"],
  tab: ["tab"],
  dialog: ["dialog", "modal", "popup"],
  switch: ["switch", "toggle"],
  slider: ["slider", "range"]
};
function normalizeAlias(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}
function extractWords(text) {
  const tokens = tokenize(text);
  return tokens.filter((t) => t.length >= 2);
}
function generateTextAliases(text, config) {
  if (!text || !config.includeText) return [];
  const aliases = [];
  const normalized = normalizeAlias(text);
  if (normalized.length >= config.minLength && normalized.length <= config.maxLength) {
    aliases.push(normalized);
  }
  const words = extractWords(text);
  for (const word of words) {
    if (word.length >= config.minLength) {
      aliases.push(word);
    }
  }
  if (words.length >= 2 && words.length <= 4) {
    const twoWords = words.slice(0, 2).join(" ");
    if (twoWords.length <= config.maxLength) {
      aliases.push(twoWords);
    }
    if (words.length > 2) {
      const lastTwo = words.slice(-2).join(" ");
      if (lastTwo.length <= config.maxLength) {
        aliases.push(lastTwo);
      }
    }
  }
  return aliases;
}
function generateSynonyms(aliases, config) {
  if (!config.includeSynonyms) return [];
  const synonyms = [];
  for (const alias of aliases) {
    const words = alias.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (SYNONYMS[word]) {
        for (const synonym of SYNONYMS[word]) {
          const newAlias = alias.toLowerCase().replace(word, synonym);
          if (newAlias !== alias.toLowerCase()) {
            synonyms.push(newAlias);
          }
          if (synonym.length >= config.minLength) {
            synonyms.push(synonym);
          }
        }
      }
    }
  }
  return synonyms;
}
function generateTypeAliases(elementType) {
  const type = elementType.toLowerCase();
  return ELEMENT_ACTION_WORDS[type] || [type];
}
function generateAliases(input, config = {}) {
  const finalConfig = { ...DEFAULT_ALIAS_CONFIG, ...config };
  const aliasSet = /* @__PURE__ */ new Set();
  const addAlias = (alias) => {
    const normalized = normalizeAlias(alias);
    if (normalized.length >= finalConfig.minLength && normalized.length <= finalConfig.maxLength) {
      aliasSet.add(normalized);
    }
  };
  const addAliases = (aliases2) => {
    for (const alias of aliases2) {
      addAlias(alias);
    }
  };
  if (finalConfig.includeText && input.textContent) {
    addAliases(generateTextAliases(input.textContent, finalConfig));
  }
  if (finalConfig.includeAriaLabel && input.ariaLabel) {
    addAliases(generateTextAliases(input.ariaLabel, finalConfig));
  }
  if (finalConfig.includeAriaLabel && input.ariaLabelledBy) {
    addAliases(generateTextAliases(input.ariaLabelledBy, finalConfig));
  }
  if (finalConfig.includePlaceholder && input.placeholder) {
    addAliases(generateTextAliases(input.placeholder, finalConfig));
  }
  if (finalConfig.includeTitle && input.title) {
    addAliases(generateTextAliases(input.title, finalConfig));
  }
  if (input.labelText) {
    addAliases(generateTextAliases(input.labelText, finalConfig));
  }
  if (input.id) {
    addAliases(extractWords(input.id));
  }
  if (input.name) {
    addAliases(extractWords(input.name));
  }
  if (input.value && (input.elementType === "button" || input.inputType === "submit" || input.inputType === "button")) {
    addAliases(generateTextAliases(input.value, finalConfig));
  }
  if (input.elementType) {
    addAliases(generateTypeAliases(input.elementType));
  }
  if (input.inputType) {
    addAlias(input.inputType);
    if (input.inputType === "email") {
      addAliases(["email", "e-mail", "email address"]);
    } else if (input.inputType === "password") {
      addAliases(["password", "pass", "pwd"]);
    } else if (input.inputType === "tel") {
      addAliases(["phone", "telephone", "mobile"]);
    } else if (input.inputType === "url") {
      addAliases(["url", "website", "link", "address"]);
    } else if (input.inputType === "search") {
      addAliases(["search", "find", "query"]);
    }
  }
  if (finalConfig.includeSynonyms) {
    const currentAliases = Array.from(aliasSet);
    addAliases(generateSynonyms(currentAliases, finalConfig));
  }
  let aliases = Array.from(aliasSet);
  aliases.sort((a, b) => a.length - b.length);
  if (aliases.length > finalConfig.maxAliases) {
    aliases = aliases.slice(0, finalConfig.maxAliases);
  }
  return aliases;
}
function generateDescription(input) {
  const parts = [];
  let name = input.ariaLabel || input.labelText || input.textContent || input.placeholder || input.title || input.id || input.name;
  if (name) {
    name = name.trim();
    if (name.length > 30) {
      name = name.substring(0, 27) + "...";
    }
    parts.push(`"${name}"`);
  }
  const typeWords = ELEMENT_ACTION_WORDS[input.elementType || ""] || [
    input.elementType || "element"
  ];
  parts.push(typeWords[0]);
  if (input.inputType && input.inputType !== "text") {
    parts.push(`(${input.inputType})`);
  }
  return parts.join(" ");
}

// src/core/registry.ts
function serializeRegisteredElement(el, options = {}) {
  const componentBasePath = options.componentBasePath ?? "/control/component";
  const kind = el.category === "content" ? "content" : el.category === "interactive" ? "interactive" : void 0;
  return {
    id: el.id,
    type: el.type,
    tagName: el.element.tagName.toLowerCase(),
    label: el.label,
    identifier: el.getIdentifier(),
    state: el.getState(),
    actions: el.actions,
    customActions: el.customActions ? Object.keys(el.customActions) : void 0,
    category: el.category,
    kind,
    content: el.content,
    role: el.role,
    contentMetadata: el.contentMetadata,
    mediaMetadata: el.mediaMetadata,
    ownedByComponent: el.ownedByComponent,
    componentActionBasePath: el.ownedByComponent ? `${componentBasePath}/${el.ownedByComponent}` : void 0,
    // Live bbox/visibility maintained by `useUIElement`. Present for elements
    // whose hook attached a ref (or that matched via `[data-ui-bridge-id]`).
    // Runners use this to dispatch clicks via DOM coords without VLM grounding.
    bbox: el.bbox,
    visible: el.visible,
    // `'hook'` for explicit useUIElement registrations, `'auto'` for
    // DOM-walker entries from useAutoRegister. Snapshot consumers that care
    // about developer-instrumented vs. scanner-discovered elements filter here.
    origin: el.origin,
    // Structured disambiguation metadata (all optional). Passthrough of the
    // four hints the consumer set on `useUIElement` so NL queries can rank
    // candidates without VLM grounding. Absent fields keep today's behavior.
    variant: el.variant,
    position: el.position,
    color: el.color,
    contextPath: el.contextPath,
    stableRef: el.element?.isConnected ? (() => {
      const ref = createStableRef(el);
      return {
        id: ref.id,
        fingerprint: ref.fingerprint,
        semanticPath: ref.semanticPath,
        stableId: ref.stableId
      };
    })() : void 0,
    // Route captured at registration time. Mirrored on the snapshot element
    // so consumers can cross-check `registration.byRoute` against individual
    // entries without a second call.
    route: el.route
  };
}
function captureFormControlState(element, state) {
  if (element.required || element.getAttribute("aria-required") === "true") {
    state.required = true;
  }
  if ("validity" in element) {
    const v = element.validity;
    if (!v.valid || element.validationMessage) {
      state.validationState = {
        valid: v.valid,
        validationMessage: element.validationMessage || void 0,
        valueMissing: v.valueMissing || void 0,
        typeMismatch: v.typeMismatch || void 0,
        patternMismatch: v.patternMismatch || void 0,
        tooShort: v.tooShort || void 0,
        tooLong: v.tooLong || void 0,
        rangeUnderflow: v.rangeUnderflow || void 0,
        rangeOverflow: v.rangeOverflow || void 0,
        stepMismatch: v.stepMismatch || void 0,
        customError: v.customError || void 0
      };
    }
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const constraints = {};
    let hasConstraint = false;
    if (element instanceof HTMLInputElement) {
      if (element.pattern) {
        constraints.pattern = element.pattern;
        hasConstraint = true;
      }
      if (element.min) {
        constraints.min = element.min;
        hasConstraint = true;
      }
      if (element.max) {
        constraints.max = element.max;
        hasConstraint = true;
      }
      if (element.step && element.step !== "any") {
        constraints.step = element.step;
        hasConstraint = true;
      }
    }
    if (element.minLength > 0) {
      constraints.minLength = element.minLength;
      hasConstraint = true;
    }
    if (element.maxLength >= 0 && element.maxLength < 524288) {
      constraints.maxLength = element.maxLength;
      hasConstraint = true;
    }
    if (hasConstraint) {
      state.constraints = constraints;
    }
  }
}
function computeAccessibleName2(element) {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter((t) => !!t);
    if (parts.length > 0) return parts.join(" ");
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      const labelText = label?.textContent?.trim();
      if (labelText) return labelText;
    }
  }
  const title = element.getAttribute("title");
  if (title) return title;
  const rawText = element.textContent?.trim();
  if (rawText) {
    return rawText.length <= 80 ? rawText : rawText.slice(0, 80);
  }
  return void 0;
}
function getElementState(element) {
  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);
  const inViewport = rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
  const roleAttr = element.getAttribute("role") || void 0;
  const accessibleName = computeAccessibleName2(element);
  const state = {
    visible: isElementVisible(element, rect, computedStyle, inViewport),
    enabled: !isElementDisabled(element),
    focused: document.activeElement === element,
    role: roleAttr,
    accessibleName,
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
    textContent: element.textContent?.trim() || void 0,
    computedStyles: {
      display: computedStyle.display,
      visibility: computedStyle.visibility,
      opacity: computedStyle.opacity,
      pointerEvents: computedStyle.pointerEvents,
      cursor: computedStyle.cursor,
      color: computedStyle.color,
      backgroundColor: computedStyle.backgroundColor,
      colorScheme: computedStyle.colorScheme,
      fontSize: computedStyle.fontSize,
      fontWeight: computedStyle.fontWeight,
      lineHeight: computedStyle.lineHeight,
      overflow: computedStyle.overflow,
      textOverflow: computedStyle.textOverflow,
      whiteSpace: computedStyle.whiteSpace,
      position: computedStyle.position,
      zIndex: computedStyle.zIndex,
      padding: computedStyle.padding,
      margin: computedStyle.margin,
      borderColor: computedStyle.borderColor,
      borderWidth: computedStyle.borderWidth,
      borderRadius: computedStyle.borderRadius
    },
    inViewport
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
  if (isScrollContainer(element, computedStyle)) {
    state.scrollInfo = {
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      canScrollUp: element.scrollTop > 0,
      canScrollDown: element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      canScrollLeft: element.scrollLeft > 0,
      canScrollRight: element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    };
  }
  if (!state.textContent) {
    state.textContent = element.getAttribute("aria-label") || element.getAttribute("title") || void 0;
  }
  const opacityVal = parseFloat(computedStyle.opacity);
  if (opacityVal === 0) {
    state.opacityHidden = true;
  }
  const contentLabel = element.getAttribute("data-content-label");
  if (contentLabel) {
    state.dataContentLabel = contentLabel;
  }
  const contentRole = element.getAttribute("data-content-role");
  if (contentRole) {
    state.dataContentRole = contentRole;
  }
  const ariaSelected = element.getAttribute("aria-selected");
  if (ariaSelected !== null) {
    state.ariaSelected = ariaSelected === "true";
  }
  const ariaPressed = element.getAttribute("aria-pressed");
  if (ariaPressed !== null) {
    state.ariaPressed = ariaPressed === "mixed" ? "mixed" : ariaPressed === "true";
  }
  const ariaCurrent = element.getAttribute("aria-current");
  if (ariaCurrent !== null && ariaCurrent !== "false") {
    state.ariaCurrent = ariaCurrent;
  }
  const ariaExpanded = element.getAttribute("aria-expanded");
  if (ariaExpanded !== null) {
    state.ariaExpanded = ariaExpanded === "true";
  } else if (element instanceof HTMLDetailsElement) {
    state.ariaExpanded = element.open;
  } else if (element.tagName === "SUMMARY") {
    const parentDetails = element.closest("details");
    if (parentDetails instanceof HTMLDetailsElement) {
      state.ariaExpanded = parentDetails.open;
    }
  }
  const ariaCheckedAttr = element.getAttribute("aria-checked");
  if (ariaCheckedAttr !== null) {
    state.ariaChecked = ariaCheckedAttr === "mixed" ? "mixed" : ariaCheckedAttr === "true";
    const role = element.getAttribute("role");
    if (role === "switch" || role === "checkbox" || role === "menuitemcheckbox" || role === "menuitemradio" || role === "radio") {
      state.checked = ariaCheckedAttr === "true";
    }
  }
  if (element instanceof HTMLInputElement) {
    state.value = element.value;
    if (element.type === "checkbox" || element.type === "radio") {
      state.checked = element.checked;
    }
    captureFormControlState(element, state);
  } else if (element instanceof HTMLTextAreaElement) {
    state.value = element.value;
    captureFormControlState(element, state);
  } else if (element instanceof HTMLSelectElement) {
    state.value = element.value;
    state.selectedOptions = Array.from(element.selectedOptions).map((opt) => opt.value);
    state.availableOptions = Array.from(element.options).map((opt) => ({
      value: opt.value,
      label: opt.label || opt.textContent?.trim() || opt.value,
      selected: opt.selected
    }));
    captureFormControlState(element, state);
  }
  if (element instanceof HTMLAnchorElement && element.href) {
    state.href = element.href;
  }
  const dataRoute = element.getAttribute("data-route");
  if (dataRoute) {
    state.dataRoute = dataRoute;
  }
  return state;
}
function isElementVisible(element, rect, style, inViewport) {
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) === 0) return false;
  if (!inViewport) return false;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (cx >= 0 && cx < window.innerWidth && cy >= 0 && cy < window.innerHeight) {
    const hit = document.elementFromPoint(cx, cy);
    if (hit !== null && hit !== element && !element.contains(hit)) {
      return false;
    }
  }
  return true;
}
function isScrollContainer(element, style) {
  if (element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth) {
    return false;
  }
  const oy = style.overflowY;
  const ox = style.overflowX;
  return oy === "auto" || oy === "scroll" || ox === "auto" || ox === "scroll";
}
function isElementDisabled(element) {
  if ("disabled" in element && element.disabled) {
    return true;
  }
  if (element.getAttribute("aria-disabled") === "true") {
    return true;
  }
  return false;
}
function inferActions(type) {
  const baseActions = ["focus", "blur", "hover", "scroll", "scrollIntoView"];
  switch (type) {
    case "button":
      return [...baseActions, "click", "doubleClick", "rightClick", "middleClick"];
    case "input":
      return [...baseActions, "click", "type", "clear"];
    case "textarea":
      return [...baseActions, "click", "type", "clear"];
    case "select":
      return [...baseActions, "click", "select"];
    case "checkbox":
      return [...baseActions, "click", "check", "uncheck", "toggle"];
    case "radio":
      return [...baseActions, "click", "check"];
    case "link":
      return [...baseActions, "click"];
    case "form":
      return ["focus", "blur"];
    case "menu":
    case "menuitem":
      return [...baseActions, "click"];
    case "tab":
      return [...baseActions, "click", "middleClick"];
    case "dialog":
      return ["focus", "blur"];
    case "custom":
    default:
      return [...baseActions, "click"];
  }
}
function inferElementType(element) {
  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute("role");
  if (role) {
    switch (role) {
      case "button":
        return "button";
      case "textbox":
        return "input";
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "link":
        return "link";
      case "listbox":
      case "combobox":
        return "select";
      case "menu":
        return "menu";
      case "menuitem":
        return "menuitem";
      case "tab":
        return "tab";
      case "dialog":
        return "dialog";
    }
  }
  switch (tagName) {
    case "button":
      return "button";
    case "input": {
      const inputType = element.type;
      if (inputType === "checkbox") return "checkbox";
      if (inputType === "radio") return "radio";
      if (inputType === "submit" || inputType === "button") return "button";
      return "input";
    }
    case "textarea":
      return "textarea";
    case "select":
      return "select";
    case "a":
      return "link";
    case "form":
      return "form";
    default:
      return "custom";
  }
}
var DEFAULT_REMOUNT_CACHE_WINDOW_MS = 2e3;
var UIBridgeRegistry = class {
  constructor(options = {}) {
    this.elements = /* @__PURE__ */ new Map();
    this.components = /* @__PURE__ */ new Map();
    this.workflows = /* @__PURE__ */ new Map();
    this.eventListeners = /* @__PURE__ */ new Map();
    // State management
    this.states = /* @__PURE__ */ new Map();
    this.stateGroups = /* @__PURE__ */ new Map();
    this.transitions = /* @__PURE__ */ new Map();
    this.activeStates = /* @__PURE__ */ new Set();
    // Recently removed elements for remount ID preservation
    this.recentlyRemoved = /* @__PURE__ */ new Map();
    // ── F3: Snapshot registration metadata ────────────────────────────────────
    // Sticky latch: flips true the first time any element registers and stays
    // true for the rest of this registry instance's lifetime, including across
    // unregister cycles. Lets snapshot consumers distinguish "bridge has never
    // seen a registration" (no SDK coverage on this page) from "registrations
    // happened but are all unmounted now". Never reset except on `clear()`.
    this.everHadRegistrationsFlag = false;
    // Per-route tally of currently-registered elements. Mirrors
    // `elements.size` partitioned by `RegisteredElement.route`. Incremented on
    // register, decremented on unregister, and a zero count is dropped from
    // the map so `byRoute` never emits `{ "/foo": 0 }`. Elements registered
    // without a route (non-DOM environment) are tracked under the empty-string
    // key `""` — snapshot serialization filters that bucket out.
    this.routeCounts = /* @__PURE__ */ new Map();
    // External store pattern for useSyncExternalStore
    this.storeVersion = 0;
    this.storeListeners = /* @__PURE__ */ new Set();
    this.cachedSnapshot = null;
    this.notifyScheduled = false;
    // ── Snapshot enricher slots ───────────────────────────────────────────────
    // Canonical enrichers wire the seven first-party trackers (navigation, modal,
    // toast, relationships, drag-drop, undo, shortcuts) into createSnapshot{,Async}
    // so any caller of those methods gets enriched output without manual glue.
    // `snapshotExtras` is the open-ended escape hatch for ad-hoc trackers (e.g.
    // a runner sidebar tab map) that aren't worth promoting into the canonical
    // set yet.
    this.enrichers = {};
    this.snapshotExtras = /* @__PURE__ */ new Map();
    this.options = options;
    this.__instanceTag = Math.random().toString(36).slice(2, 8);
  }
  /**
   * Public accessor for the instance tag — equivalent to reading
   * `__instanceTag` directly, but kept as a method so external diagnostic
   * code (which sees the type from `dist/`) can call it without TypeScript
   * complaining about touching internal fields.
   */
  getInstanceTag() {
    return this.__instanceTag;
  }
  // ============================================================================
  // Snapshot Enricher Slots
  // ============================================================================
  /**
   * Register/replace canonical enrichers (navigation/modal/toast/relationships/
   * drag-drop/undo/shortcuts). HMR-safe — calling with a partial set merges into
   * existing slots instead of clobbering them, so a remount that re-runs init
   * for one tracker doesn't drop the others.
   */
  setEnrichers(e) {
    this.enrichers = { ...this.enrichers, ...e };
  }
  /**
   * Register a custom snapshot enricher. The returned object will be
   * `Object.assign`ed onto the snapshot, so use unique top-level keys to avoid
   * clobbering canonical fields. Returns a disposer.
   */
  registerSnapshotEnricher(name, fn) {
    this.snapshotExtras.set(name, fn);
    return () => this.unregisterSnapshotEnricher(name);
  }
  /** Remove a custom snapshot enricher by name */
  unregisterSnapshotEnricher(name) {
    this.snapshotExtras.delete(name);
  }
  /**
   * Subscribe to registry changes (for useSyncExternalStore).
   * Returns an unsubscribe function.
   */
  subscribe(callback) {
    this.storeListeners.add(callback);
    return () => {
      this.storeListeners.delete(callback);
    };
  }
  /**
   * Get a stable snapshot reference that changes only when the registry mutates.
   * Designed for useSyncExternalStore.
   */
  getSnapshot() {
    if (!this.cachedSnapshot || this.cachedSnapshot.version !== this.storeVersion) {
      this.cachedSnapshot = {
        elements: Array.from(this.elements.values()),
        components: Array.from(this.components.values()),
        workflows: Array.from(this.workflows.values()),
        version: this.storeVersion
      };
    }
    return this.cachedSnapshot;
  }
  notifyStoreListeners() {
    this.storeVersion++;
    this.cachedSnapshot = null;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of this.storeListeners) {
        listener();
      }
    });
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
    this.options.onEvent?.(event);
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
      console.log("[UIBridge]", type, data);
    }
    if (typeof type === "string" && (type.startsWith("element:") || type.startsWith("component:") || type.startsWith("workflow:"))) {
      this.notifyStoreListeners();
    }
    this.options.elementEventLog?.ingest(event);
  }
  /**
   * Register an event listener
   */
  on(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, /* @__PURE__ */ new Set());
    }
    this.eventListeners.get(type).add(listener);
    return () => {
      this.eventListeners.get(type)?.delete(listener);
    };
  }
  /**
   * Dispatch an event from external sources (e.g., NavigationTracker).
   * Prefer using registry methods (registerElement, etc.) for internal events.
   */
  dispatchEvent(type, data) {
    this.emit(type, data);
  }
  /**
   * Remove an event listener
   */
  off(type, listener) {
    this.eventListeners.get(type)?.delete(listener);
  }
  /**
   * Register an element
   */
  /**
   * Update a registered element's metadata/options in place.
   * See `updateComponent` for rationale. Does not replace the DOM element
   * reference — use `registerElement` if the element itself changed.
   */
  updateElement(id, options) {
    const existing = this.elements.get(id);
    if (!existing) return false;
    if (options.type !== void 0) existing.type = options.type;
    if (options.label !== void 0) existing.label = options.label;
    if (options.actions !== void 0) existing.actions = options.actions;
    if (options.customActions !== void 0) existing.customActions = options.customActions;
    if (options.category !== void 0) existing.category = options.category;
    if (options.contentMetadata !== void 0) existing.contentMetadata = options.contentMetadata;
    if (options.mediaMetadata !== void 0) existing.mediaMetadata = options.mediaMetadata;
    if (options.variant !== void 0) existing.variant = options.variant;
    if (options.position !== void 0) existing.position = options.position;
    if (options.color !== void 0) existing.color = options.color;
    if (options.contextPath !== void 0) existing.contextPath = options.contextPath;
    return true;
  }
  /**
   * Update the live viewport-relative bounding box and visibility for a
   * registered element. Called by `useUIElement`'s ResizeObserver + scroll
   * listeners and MUST NOT emit events or bump `storeVersion` — bbox updates
   * fire on every scroll/resize and would cause `useSyncExternalStore`
   * consumers to re-render continuously (React error #185).
   *
   * Returns `false` if the element is not registered.
   */
  updateElementBbox(id, bbox, visible) {
    const existing = this.elements.get(id);
    if (!existing) return false;
    existing.bbox = bbox;
    existing.visible = visible;
    return true;
  }
  /**
   * Action-driven state refresh.
   *
   * Action handlers (`type`, `clear`, `setValue`, `check`, `uncheck`, `toggle`,
   * `select`, `sendKeys`, `focus`, `blur`) call this after mutating the DOM so
   * subsequent `getElement(id)` / snapshot reads see the post-action state
   * even when React detaches/re-creates the underlying DOM node between the
   * action and the next read.
   *
   * The fields in `updates` overlay the live `getElementState(element)` read
   * (cached values win for `value`, `checked`, `focused`, etc.). Other fields
   * (rect, computedStyles, scrollInfo) keep flowing from the live DOM read so
   * layout stays accurate. Pass `undefined` for `updates` to clear the
   * overlay.
   *
   * Returns `false` if `id` is not registered.
   */
  refreshElement(id, updates) {
    const existing = this.elements.get(id);
    if (!existing) return false;
    const ref = existing.__stateOverridesRef;
    if (!ref) {
      existing.cachedStateOverrides = updates;
      return true;
    }
    if (updates === void 0) {
      ref.value = void 0;
      existing.cachedStateOverrides = void 0;
    } else {
      const merged = { ...ref.value ?? {}, ...updates };
      ref.value = merged;
      existing.cachedStateOverrides = merged;
    }
    return true;
  }
  registerElement(id, element, options = {}) {
    const type = options.type ?? inferElementType(element);
    const actions = options.actions ?? inferActions(type);
    let actualId = id;
    if (this.options.preserveIdAcrossRemount) {
      const now = Date.now();
      const cacheWindow = this.options.remountCacheWindowMs ?? DEFAULT_REMOUNT_CACHE_WINDOW_MS;
      const fp = computeElementFingerprint(element).hash;
      for (const [key, entry] of this.recentlyRemoved) {
        if (now - entry.removedAt > cacheWindow) {
          this.recentlyRemoved.delete(key);
          continue;
        }
        if (entry.fingerprint === fp) {
          actualId = entry.id;
          this.recentlyRemoved.delete(key);
          break;
        }
      }
    }
    let ownedByComponent = options.ownedByComponent;
    if (!ownedByComponent && element && typeof element.closest === "function") {
      const scope = element.closest("[data-ui-bridge-component]");
      const attr = scope?.getAttribute("data-ui-bridge-component");
      if (attr) ownedByComponent = attr;
    }
    let route;
    if (options.route === null) {
      route = void 0;
    } else if (typeof options.route === "string") {
      route = options.route;
    } else if (typeof window !== "undefined" && window.location?.pathname) {
      route = window.location.pathname;
    }
    const stateOverridesRef = {
      value: void 0
    };
    const computeState = () => {
      const live = getElementState(element);
      return live;
    };
    const registered = {
      id: actualId,
      element,
      type,
      label: options.label,
      actions,
      customActions: options.customActions,
      getState: computeState,
      getIdentifier: () => createElementIdentifier(element),
      registeredAt: Date.now(),
      mounted: true,
      category: options.category ?? "interactive",
      contentMetadata: options.contentMetadata,
      mediaMetadata: options.mediaMetadata,
      ownedByComponent,
      // Default programmatic registrations to `'hook'` — only the DOM walker
      // in useAutoRegister passes `'auto'`. Tests and external callers that
      // pre-date this field stay on the `'hook'` side of any filter.
      origin: options.origin ?? "hook",
      // Structured disambiguation metadata (all optional). Snapshots echo
      // these through verbatim so NL queries can rank candidates without
      // VLM pixel grounding.
      variant: options.variant,
      position: options.position,
      color: options.color,
      contextPath: options.contextPath,
      route,
      // Content/role fields for data-ui-bridge-content semantic elements.
      // Undefined for interactive elements and for content registered via
      // the heading/paragraph/table-cell content-discovery path.
      content: options.content,
      role: options.role
    };
    Object.defineProperty(registered, "__stateOverridesRef", {
      value: stateOverridesRef,
      enumerable: false,
      writable: false,
      configurable: true
    });
    const prior = this.elements.get(actualId);
    if (prior) {
      this.decrementRouteCount(prior.route);
    }
    this.elements.set(actualId, registered);
    this.everHadRegistrationsFlag = true;
    this.incrementRouteCount(route);
    this.emit("element:registered", { id: actualId, type, label: options.label });
    return registered;
  }
  incrementRouteCount(route) {
    const key = route ?? "";
    this.routeCounts.set(key, (this.routeCounts.get(key) ?? 0) + 1);
  }
  decrementRouteCount(route) {
    const key = route ?? "";
    const next = (this.routeCounts.get(key) ?? 0) - 1;
    if (next <= 0) {
      this.routeCounts.delete(key);
    } else {
      this.routeCounts.set(key, next);
    }
  }
  /**
   * Register a content (non-interactive) element
   */
  registerContentElement(id, element, options) {
    return this.registerElement(id, element, {
      type: options.contentType,
      label: options.label,
      actions: [],
      category: "content",
      contentMetadata: options.contentMetadata,
      origin: options.origin ?? "auto"
    });
  }
  /**
   * Get all content (non-interactive) elements
   */
  getAllContentElements() {
    return Array.from(this.elements.values()).filter((el) => el.category === "content");
  }
  /**
   * Register a media element (image, video, canvas, SVG, etc.)
   *
   * If a `refreshMetadata` callback is provided, mediaMetadata is re-captured
   * on every `getState()` call so loading transitions and video state stay fresh.
   */
  registerMediaElement(id, element, options) {
    const registered = this.registerElement(id, element, {
      type: options.mediaType,
      label: options.label,
      actions: [],
      category: "media",
      mediaMetadata: options.mediaMetadata,
      origin: options.origin ?? "auto"
    });
    if (options.refreshMetadata) {
      const originalGetState = registered.getState;
      const refreshFn = options.refreshMetadata;
      registered.getState = () => {
        const state = originalGetState();
        const freshMeta = refreshFn(element);
        registered.mediaMetadata = freshMeta;
        state.mediaMetadata = freshMeta;
        return state;
      };
    }
    return registered;
  }
  /**
   * Get all interactive elements
   */
  getAllInteractiveElements() {
    return Array.from(this.elements.values()).filter(
      (el) => el.category !== "content" && el.category !== "media"
    );
  }
  /**
   * Get all media elements
   */
  getAllMediaElements() {
    return Array.from(this.elements.values()).filter((el) => el.category === "media");
  }
  /**
   * Unregister an element
   */
  unregisterElement(id) {
    const registered = this.elements.get(id);
    if (registered) {
      if (this.options.preserveIdAcrossRemount && registered.element) {
        const fp = computeElementFingerprint(registered.element).hash;
        this.recentlyRemoved.set(fp, { id, fingerprint: fp, removedAt: Date.now() });
        if (this.recentlyRemoved.size > 100) {
          const firstKey = this.recentlyRemoved.keys().next().value;
          if (firstKey !== void 0) {
            this.recentlyRemoved.delete(firstKey);
          }
        }
      }
      registered.mounted = false;
      this.elements.delete(id);
      this.decrementRouteCount(registered.route);
      this.emit("element:unregistered", { id });
      this.options.elementEventLog?.removeElement(id);
      return true;
    }
    return false;
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
   * Find element by DOM element reference
   */
  findByDOMElement(element) {
    for (const registered of this.elements.values()) {
      if (registered.element === element) {
        return registered;
      }
    }
    return void 0;
  }
  /**
   * Get element event history from the element event log.
   */
  getElementHistory(elementId, options) {
    return this.options.elementEventLog?.getHistory(elementId, options) ?? [];
  }
  /**
   * Set the log level override for a specific element.
   */
  setElementLogLevel(elementId, level) {
    this.options.elementEventLog?.setElementLogLevel(elementId, level);
  }
  /**
   * Get the effective log level for an element.
   */
  getElementLogLevel(elementId) {
    return this.options.elementEventLog?.getElementLogLevel(elementId) ?? "silent";
  }
  /**
   * Search for elements using AI search criteria
   */
  searchElements(criteria) {
    const results = [];
    const threshold = criteria.fuzzyThreshold ?? 0.7;
    for (const element of this.elements.values()) {
      if (!element.mounted) continue;
      const state = element.getState();
      if (!criteria.fuzzy && !state.visible) continue;
      const aliases = element.aliases ?? this.generateElementAliases(element);
      const textContent = state.textContent?.trim() || "";
      const label = element.label || "";
      let maxScore = 0;
      const matchReasons = [];
      const scores = {};
      if (criteria.text) {
        if (textContent.toLowerCase() === criteria.text.toLowerCase() || label.toLowerCase() === criteria.text.toLowerCase()) {
          maxScore = 1;
          matchReasons.push("exact text match");
          scores.text = 1;
        } else if (criteria.fuzzy !== false) {
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
      if (criteria.textContains) {
        if (textContent.toLowerCase().includes(criteria.textContains.toLowerCase()) || label.toLowerCase().includes(criteria.textContains.toLowerCase())) {
          const containsScore = 0.85;
          scores.text = Math.max(scores.text ?? 0, containsScore);
          if (containsScore > maxScore) {
            maxScore = containsScore;
            matchReasons.push("text contains");
          }
        }
      }
      if (criteria.accessibleName) {
        const ariaLabel = element.element.getAttribute("aria-label") || "";
        const accessibleName = ariaLabel || label || textContent;
        if (accessibleName.toLowerCase() === criteria.accessibleName.toLowerCase()) {
          scores.accessibility = 1;
          if (1 > maxScore) {
            maxScore = 1;
            matchReasons.push("accessible name match");
          }
        } else if (criteria.fuzzy !== false) {
          const result = fuzzyMatch(criteria.accessibleName, accessibleName, { threshold });
          if (result.isMatch) {
            scores.accessibility = result.similarity;
            if (result.similarity > maxScore) {
              maxScore = result.similarity;
              matchReasons.push(
                `accessible name similarity: ${(result.similarity * 100).toFixed(0)}%`
              );
            }
          }
        }
      }
      if (criteria.role) {
        const role = element.element.getAttribute("role") || this.inferRole(element.type);
        if (role?.toLowerCase() === criteria.role.toLowerCase()) {
          scores.role = 1;
          if (1 > maxScore) {
            maxScore = 1;
            matchReasons.push(`role: ${criteria.role}`);
          }
        }
      }
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
      for (const alias of aliases) {
        const searchText = criteria.text || criteria.textContains || criteria.accessibleName;
        if (searchText) {
          if (alias.toLowerCase() === searchText.toLowerCase()) {
            scores.fuzzy = 1;
            if (1 > maxScore) {
              maxScore = 1;
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
      if (maxScore >= threshold) {
        const aiElement = {
          id: element.id,
          type: element.type,
          label: element.label,
          tagName: element.element.tagName.toLowerCase(),
          role: element.element.getAttribute("role") || void 0,
          accessibleName: element.element.getAttribute("aria-label") || element.label,
          actions: element.actions,
          state,
          registered: true,
          description: element.description || generateDescription({
            textContent,
            ariaLabel: element.element.getAttribute("aria-label"),
            elementType: element.type,
            id: element.id,
            labelText: element.label
          }),
          aliases,
          purpose: element.purpose,
          suggestedActions: [],
          semanticType: element.semanticType
        };
        results.push({
          element: aiElement,
          confidence: maxScore,
          matchReasons,
          scores
        });
      }
    }
    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }
  /**
   * Find element by visible text
   */
  findByText(text, fuzzy = true) {
    const results = this.searchElements({ text, fuzzy, fuzzyThreshold: fuzzy ? 0.7 : 1 });
    if (results.length > 0) {
      return this.elements.get(results[0].element.id);
    }
    return void 0;
  }
  /**
   * Find element by accessible name
   */
  findByAccessibleName(name) {
    const results = this.searchElements({ accessibleName: name, fuzzy: true });
    if (results.length > 0) {
      return this.elements.get(results[0].element.id);
    }
    return void 0;
  }
  /**
   * Generate aliases for an element
   */
  generateElementAliases(element) {
    const state = element.getState();
    return generateAliases({
      textContent: state.textContent,
      ariaLabel: element.element.getAttribute("aria-label"),
      placeholder: element.element.getAttribute("placeholder"),
      title: element.element.getAttribute("title"),
      elementType: element.type,
      tagName: element.element.tagName.toLowerCase(),
      id: element.id,
      labelText: element.label
    });
  }
  /**
   * Infer ARIA role from element type
   */
  inferRole(type) {
    const roleMap = {
      button: "button",
      input: "textbox",
      select: "combobox",
      checkbox: "checkbox",
      radio: "radio",
      link: "link",
      form: void 0,
      textarea: "textbox",
      menu: "menu",
      menuitem: "menuitem",
      tab: "tab",
      dialog: "dialog",
      disclosure: "group",
      custom: void 0,
      switch: "switch",
      slider: "slider",
      combobox: "combobox",
      listbox: "listbox",
      option: "option",
      textbox: "textbox",
      generic: void 0,
      image: "img",
      video: void 0,
      canvas: void 0,
      svg: "img",
      picture: "img"
    };
    return roleMap[type];
  }
  /**
   * Update a component's options in place, without emitting a
   * `component:registered` event. Returns `false` if the component is not
   * currently registered — callers should fall back to `registerComponent`.
   *
   * Preserves `registeredAt` and `mounted`. Intended for React hooks that
   * want to reflect option changes on the same mounted consumer without
   * firing a full re-register (which would churn `useSyncExternalStore`
   * subscribers).
   */
  updateComponent(id, options) {
    const existing = this.components.get(id);
    if (!existing) return false;
    if (options.name !== void 0) existing.name = options.name;
    if (options.description !== void 0) existing.description = options.description;
    if (options.actions !== void 0) {
      existing.actions = options.actions.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        paramSchema: a.paramSchema,
        handler: a.handler
      }));
    }
    if (options.elementIds !== void 0) existing.elementIds = options.elementIds;
    if (options.getState !== void 0) existing.getState = options.getState;
    if (options.getComputed !== void 0) existing.getComputed = options.getComputed;
    return true;
  }
  /**
   * Register a component
   */
  registerComponent(id, options) {
    const registered = {
      id,
      name: options.name,
      description: options.description,
      actions: options.actions?.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        paramSchema: a.paramSchema,
        handler: a.handler
      })) ?? [],
      elementIds: options.elementIds,
      registeredAt: Date.now(),
      mounted: true,
      getState: options.getState,
      getComputed: options.getComputed
    };
    this.components.set(id, registered);
    this.emit("component:registered", { id, name: options.name });
    return registered;
  }
  /**
   * Unregister a component
   */
  unregisterComponent(id) {
    const component = this.components.get(id);
    if (component) {
      component.mounted = false;
      this.components.delete(id);
      this.emit("component:unregistered", { id });
      return true;
    }
    return false;
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
  /**
   * Get the current state and computed properties of a component
   */
  getComponentState(id) {
    const component = this.components.get(id);
    if (!component || !component.mounted) {
      return null;
    }
    return {
      state: component.getState?.() ?? {},
      computed: component.getComputed?.() ?? {},
      timestamp: Date.now()
    };
  }
  /**
   * Register a workflow
   */
  registerWorkflow(workflow) {
    this.workflows.set(workflow.id, workflow);
    this.notifyStoreListeners();
    return workflow;
  }
  /**
   * Unregister a workflow
   */
  unregisterWorkflow(id) {
    const deleted = this.workflows.delete(id);
    if (deleted) this.notifyStoreListeners();
    return deleted;
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
  // ==========================================================================
  // State Management
  // ==========================================================================
  /**
   * Register a state
   */
  registerState(state) {
    this.states.set(state.id, state);
    this.emit("element:registered", { id: state.id, type: "state", name: state.name });
    return state;
  }
  /**
   * Update a state's stored options in place. See `updateComponent` for
   * rationale — avoids re-emitting `element:registered`/`unregistered`
   * pairs on every option change so `useSyncExternalStore` consumers don't
   * re-render on minor metadata edits.
   */
  updateState(state) {
    if (!this.states.has(state.id)) return false;
    this.states.set(state.id, state);
    return true;
  }
  /**
   * Unregister a state
   */
  unregisterState(id) {
    const state = this.states.get(id);
    if (state) {
      this.activeStates.delete(id);
      this.states.delete(id);
      this.emit("element:unregistered", { id, type: "state" });
      return true;
    }
    return false;
  }
  /**
   * Get a registered state
   */
  getState(id) {
    return this.states.get(id);
  }
  /**
   * Get all registered states
   */
  getAllStates() {
    return Array.from(this.states.values());
  }
  /**
   * Register a state group
   */
  registerStateGroup(group) {
    this.stateGroups.set(group.id, group);
    return group;
  }
  /** In-place update — see `updateComponent`. */
  updateStateGroup(group) {
    if (!this.stateGroups.has(group.id)) return false;
    this.stateGroups.set(group.id, group);
    return true;
  }
  /**
   * Unregister a state group
   */
  unregisterStateGroup(id) {
    return this.stateGroups.delete(id);
  }
  /**
   * Get a state group
   */
  getStateGroup(id) {
    return this.stateGroups.get(id);
  }
  /**
   * Get all state groups
   */
  getAllStateGroups() {
    return Array.from(this.stateGroups.values());
  }
  /**
   * Register a transition
   */
  registerTransition(transition) {
    this.transitions.set(transition.id, transition);
    return transition;
  }
  /** In-place update — see `updateComponent`. */
  updateTransition(transition) {
    if (!this.transitions.has(transition.id)) return false;
    this.transitions.set(transition.id, transition);
    return true;
  }
  /**
   * Unregister a transition
   */
  unregisterTransition(id) {
    return this.transitions.delete(id);
  }
  /**
   * Get a transition
   */
  getTransition(id) {
    return this.transitions.get(id);
  }
  /**
   * Get all transitions
   */
  getAllTransitions() {
    return Array.from(this.transitions.values());
  }
  /**
   * Get currently active states
   */
  getActiveStates() {
    return Array.from(this.activeStates);
  }
  /**
   * Check if a state is active
   */
  isStateActive(id) {
    return this.activeStates.has(id);
  }
  /**
   * Activate a state
   */
  activateState(id) {
    const state = this.states.get(id);
    if (!state) {
      return false;
    }
    for (const activeId of this.activeStates) {
      const activeState = this.states.get(activeId);
      if (activeState?.blocking && activeState.id !== id) {
        return false;
      }
      if (activeState?.blocks?.includes(id)) {
        return false;
      }
    }
    const wasActive = this.activeStates.has(id);
    this.activeStates.add(id);
    if (!wasActive) {
      this.emit("element:stateChanged", {
        stateId: id,
        active: true,
        activeStates: this.getActiveStates()
      });
    }
    return true;
  }
  /**
   * Deactivate a state
   */
  deactivateState(id) {
    const wasActive = this.activeStates.has(id);
    this.activeStates.delete(id);
    if (wasActive) {
      this.emit("element:stateChanged", {
        stateId: id,
        active: false,
        activeStates: this.getActiveStates()
      });
    }
    return wasActive;
  }
  /**
   * Activate multiple states
   */
  activateStates(ids) {
    const activated = [];
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
  deactivateStates(ids) {
    const deactivated = [];
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
  activateStateGroup(groupId) {
    const group = this.stateGroups.get(groupId);
    if (!group) return [];
    return this.activateStates(group.states);
  }
  /**
   * Deactivate a state group (all states in the group)
   */
  deactivateStateGroup(groupId) {
    const group = this.stateGroups.get(groupId);
    if (!group) return [];
    return this.deactivateStates(group.states);
  }
  /**
   * Check if a transition can be executed from current state
   */
  canExecuteTransition(transitionId) {
    const transition = this.transitions.get(transitionId);
    if (!transition) return false;
    return transition.fromStates.some((stateId) => this.activeStates.has(stateId));
  }
  /**
   * Execute a transition
   */
  async executeTransition(transitionId) {
    const startTime = performance.now();
    const transition = this.transitions.get(transitionId);
    if (!transition) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: `Transition not found: ${transitionId}`,
        durationMs: performance.now() - startTime
      };
    }
    if (!this.canExecuteTransition(transitionId)) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: "Precondition not met: none of the fromStates are active",
        failedPhase: "precondition",
        durationMs: performance.now() - startTime
      };
    }
    try {
      const deactivated = this.deactivateStates(transition.exitStates);
      if (transition.exitGroups) {
        for (const groupId of transition.exitGroups) {
          deactivated.push(...this.deactivateStateGroup(groupId));
        }
      }
      const activated = this.activateStates(transition.activateStates);
      if (transition.activateGroups) {
        for (const groupId of transition.activateGroups) {
          activated.push(...this.activateStateGroup(groupId));
        }
      }
      return {
        success: true,
        activatedStates: activated,
        deactivatedStates: deactivated,
        durationMs: performance.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: error instanceof Error ? error.message : String(error),
        failedPhase: "execution",
        durationMs: performance.now() - startTime
      };
    }
  }
  /**
   * Find a path from current state to target states
   *
   * Uses a simple BFS algorithm for pathfinding.
   * For more advanced pathfinding (Dijkstra, A*), use the Python state manager service.
   */
  findPath(targetStates) {
    if (targetStates.every((t) => this.activeStates.has(t))) {
      return {
        found: true,
        transitions: [],
        totalCost: 0,
        targetStates,
        estimatedSteps: 0
      };
    }
    const queue = [
      { activeStates: new Set(this.activeStates), path: [], cost: 0 }
    ];
    const visited = /* @__PURE__ */ new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      const stateKey = Array.from(current.activeStates).sort().join(",");
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      if (targetStates.every((t) => current.activeStates.has(t))) {
        return {
          found: true,
          transitions: current.path,
          totalCost: current.cost,
          targetStates,
          estimatedSteps: current.path.length
        };
      }
      for (const transition of this.transitions.values()) {
        const canExecute = transition.fromStates.some((s) => current.activeStates.has(s));
        if (!canExecute) continue;
        const newActive = new Set(current.activeStates);
        for (const s of transition.exitStates) newActive.delete(s);
        for (const s of transition.activateStates) newActive.add(s);
        const newCost = current.cost + (transition.pathCost ?? 1);
        queue.push({
          activeStates: newActive,
          path: [...current.path, transition.id],
          cost: newCost
        });
      }
    }
    return {
      found: false,
      transitions: [],
      totalCost: 0,
      targetStates,
      estimatedSteps: 0
    };
  }
  /**
   * Navigate to target states using pathfinding
   */
  async navigateTo(targetStates) {
    const startTime = performance.now();
    const path = this.findPath(targetStates);
    if (!path.found) {
      return {
        success: false,
        path,
        executedTransitions: [],
        finalActiveStates: this.getActiveStates(),
        error: `No path found to target states: ${targetStates.join(", ")}`,
        durationMs: performance.now() - startTime
      };
    }
    const executedTransitions = [];
    for (const transitionId of path.transitions) {
      const result = await this.executeTransition(transitionId);
      if (!result.success) {
        return {
          success: false,
          path,
          executedTransitions,
          finalActiveStates: this.getActiveStates(),
          error: result.error,
          durationMs: performance.now() - startTime
        };
      }
      executedTransitions.push(transitionId);
    }
    return {
      success: true,
      path,
      executedTransitions,
      finalActiveStates: this.getActiveStates(),
      durationMs: performance.now() - startTime
    };
  }
  /**
   * Create a state snapshot
   */
  createStateSnapshot() {
    return {
      timestamp: Date.now(),
      activeStates: this.getActiveStates(),
      states: this.getAllStates(),
      groups: this.getAllStateGroups(),
      transitions: this.getAllTransitions()
    };
  }
  /**
   * Whether this registry instance has ever had an element register in its
   * lifetime. Sticky — flips true on first `registerElement` and stays true
   * until `clear()`.  Exposed primarily for tests; production code should
   * read `BridgeSnapshot.registration.everHadRegistrations`.
   */
  hasEverHadRegistrations() {
    return this.everHadRegistrationsFlag;
  }
  /**
   * Per-route counts of currently-registered elements. Returns a plain
   * object copy so callers can't mutate the internal map. Elements with
   * an undefined route are omitted. Exposed primarily for tests; production
   * code should read `BridgeSnapshot.registration.byRoute`.
   */
  getCountsByRoute() {
    const out = {};
    for (const [route, count] of this.routeCounts) {
      if (route === "") continue;
      if (count > 0) out[route] = count;
    }
    return out;
  }
  /**
   * Build the F3 registration-diagnostics metadata for a snapshot. Shared
   * by `createSnapshot` and `createSnapshotAsync` so both paths emit the
   * same shape.
   */
  buildRegistrationMetadata() {
    return {
      totalRegistered: this.elements.size,
      everHadRegistrations: this.everHadRegistrationsFlag,
      byRoute: this.getCountsByRoute()
    };
  }
  /**
   * Best-effort read of the current page route. Matches the default source
   * `registerElement` uses, so the snapshot's top-level `route` lines up
   * with the `byRoute` keys under normal operation.
   */
  currentRoute() {
    if (typeof window !== "undefined" && window.location?.pathname) {
      return window.location.pathname;
    }
    return void 0;
  }
  /**
   * Resolve the optional `activeTab` field for a snapshot. Applications that
   * decouple their visible pane from `window.location` (e.g. the runner's
   * tab-based shell) supply a `getActiveTab` callback in the snapshot options;
   * the SDK itself has no concept of "tab", so without a provider the field
   * stays undefined and non-tab-based consumers are unaffected. Errors thrown
   * by the provider are swallowed so a buggy host can never break the rest of
   * the snapshot.
   */
  resolveActiveTab(getActiveTab) {
    if (!getActiveTab) return void 0;
    try {
      const value = getActiveTab();
      return typeof value === "string" && value.length > 0 ? value : void 0;
    } catch {
      return void 0;
    }
  }
  /**
   * Run every registered snapshot enricher (canonical + pluggable extras) and
   * mutate `snapshot` in place with their output. Each call is wrapped in its
   * own try/catch so a misbehaving tracker can never break the rest of the
   * snapshot. Shared by `createSnapshot` and `createSnapshotAsync` so both
   * paths emit identically-enriched output.
   *
   * Also exposed as the public {@link runSnapshotEnrichers} entry point for
   * callers that build a snapshot shape outside `createSnapshot{,Async}` (e.g.
   * the relay/WS dispatcher in `commandHandlers.getControlSnapshot`, which
   * keeps a richer workflow + component shape but still wants the seven
   * canonical fields). Routing both shapes through this single helper keeps
   * the snapshot-two-channel-drift class structurally impossible — see
   * memory note `proj_issue_snapshot_two_channel_drift.md`.
   */
  runSnapshotEnrichers(snapshot, options = {}) {
    this.runEnrichers(snapshot, options);
  }
  runEnrichers(snapshot, options = {}) {
    if (this.enrichers.navigationTracker) {
      try {
        snapshot.page = this.enrichers.navigationTracker.getSnapshotPageContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] page enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.modalDetector) {
      try {
        snapshot.modalStack = this.enrichers.modalDetector.getSnapshotModalContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] modalStack enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.toastCapture) {
      try {
        snapshot.toasts = this.enrichers.toastCapture.getSnapshotToastContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] toasts enricher threw:`, error);
        }
      }
    }
    let elementPairs = null;
    const getElementPairs = () => {
      if (elementPairs === null) {
        elementPairs = this.getAllElements().map((e) => ({ id: e.id, element: e.element }));
      }
      return elementPairs;
    };
    if (this.enrichers.relationshipTracker) {
      try {
        snapshot.relationships = this.enrichers.relationshipTracker.getSnapshotRelationshipContext(getElementPairs());
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] relationships enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.dragDropDetector) {
      try {
        snapshot.dragDrop = this.enrichers.dragDropDetector.getSnapshotDragDropContext(getElementPairs());
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] dragDrop enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.undoTracker) {
      try {
        snapshot.undoRedo = this.enrichers.undoTracker.getSnapshotUndoContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] undoRedo enricher threw:`, error);
        }
      }
    }
    if (this.enrichers.shortcutTracker) {
      try {
        snapshot.shortcuts = this.enrichers.shortcutTracker.getSnapshotShortcutContext();
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] shortcuts enricher threw:`, error);
        }
      }
    }
    if (this.snapshotExtras.size > 0) {
      const ctx = {
        elements: getElementPairs(),
        getActiveTab: options.getActiveTab,
        snapshotSoFar: snapshot
      };
      for (const [name, fn] of this.snapshotExtras) {
        try {
          const extra = fn(ctx);
          if (extra && typeof extra === "object") {
            Object.assign(snapshot, extra);
          }
        } catch (error) {
          if (this.options.verbose) {
            console.warn(`[ui-bridge] snapshot enricher "${name}" threw:`, error);
          }
        }
      }
    }
  }
  /**
   * Create a snapshot of the current state
   */
  createSnapshot(options = {}) {
    const takenAt = Date.now();
    const activeTab = this.resolveActiveTab(options.getActiveTab);
    const snapshot = {
      timestamp: takenAt,
      snapshotTakenAtMs: takenAt,
      route: this.currentRoute(),
      ...activeTab !== void 0 ? { activeTab } : {},
      registration: this.buildRegistrationMetadata(),
      elements: this.getAllElements().map((el) => serializeRegisteredElement(el, options)),
      components: this.getAllComponents().map((comp) => ({
        id: comp.id,
        name: comp.name,
        description: comp.description,
        actions: comp.actions.map((a) => a.id),
        // Tell the caller exactly how to invoke any action on this component
        // without having to grep docs or guess the route shape.
        actionInvocationPath: `/control/component/${comp.id}/action/{actionId}`,
        elementIds: comp.elementIds
      })),
      workflows: this.getAllWorkflows().map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepCount: wf.steps.length
      }))
    };
    this.runEnrichers(snapshot, { getActiveTab: options.getActiveTab });
    return snapshot;
  }
  /**
   * Create a snapshot asynchronously, processing elements in batches to avoid
   * blocking the main thread. This prevents "Page Unresponsive" dialogs when
   * there are many registered elements (200-500+), since getState() and
   * getIdentifier() force layout/style recalculation for each element.
   */
  async createSnapshotAsync(batchSize = 50, options = {}) {
    const allElements = this.getAllElements();
    const elementSnapshots = [];
    for (let i = 0; i < allElements.length; i += batchSize) {
      const batch = allElements.slice(i, i + batchSize);
      for (const el of batch) {
        elementSnapshots.push(serializeRegisteredElement(el, options));
      }
      if (i + batchSize < allElements.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const takenAt = Date.now();
    const activeTab = this.resolveActiveTab(options.getActiveTab);
    const snapshot = {
      timestamp: takenAt,
      snapshotTakenAtMs: takenAt,
      route: this.currentRoute(),
      ...activeTab !== void 0 ? { activeTab } : {},
      registration: this.buildRegistrationMetadata(),
      elements: elementSnapshots,
      components: this.getAllComponents().map((comp) => ({
        id: comp.id,
        name: comp.name,
        description: comp.description,
        actions: comp.actions.map((a) => a.id),
        // Tell the caller exactly how to invoke any action on this component
        // without having to grep docs or guess the route shape.
        actionInvocationPath: `/control/component/${comp.id}/action/{actionId}`,
        elementIds: comp.elementIds
      })),
      workflows: this.getAllWorkflows().map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepCount: wf.steps.length
      }))
    };
    this.runEnrichers(snapshot, { getActiveTab: options.getActiveTab });
    return snapshot;
  }
  /**
   * Clear all registrations
   */
  clear() {
    this.elements.clear();
    this.components.clear();
    this.workflows.clear();
    this.eventListeners.clear();
    this.states.clear();
    this.stateGroups.clear();
    this.transitions.clear();
    this.activeStates.clear();
    this.routeCounts.clear();
    this.everHadRegistrationsFlag = false;
  }
  /**
   * Get registry statistics
   */
  getStats() {
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
      activeStateCount: this.activeStates.size
    };
  }
};
var REGISTRY_KEY = /* @__PURE__ */ Symbol.for("@qontinui/ui-bridge/globalRegistry");
function getRegistrySlot() {
  return globalThis;
}
function getGlobalRegistry() {
  const slot = getRegistrySlot();
  let current = slot[REGISTRY_KEY] ?? null;
  if (!current) {
    current = new UIBridgeRegistry();
    slot[REGISTRY_KEY] = current;
  }
  return current;
}

// src/core/find.ts
var FIELD_WEIGHTS = {
  type: 15,
  variant: 8,
  position: 6,
  color: 5,
  contextPath: 3,
  label: 5
  // per-token; full label phrase adds an extra bonus
};
var FULL_LABEL_BONUS = 10;
function findElements(elements, query) {
  const q = typeof query === "string" ? { text: query } : query;
  const textTokens = tokenize2(q.text ?? "");
  const limit = q.limit ?? 10;
  const minScore = q.minScore ?? 0;
  const results = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (q.type && el.type !== q.type) continue;
    if (q.origin && el.origin !== q.origin) continue;
    if (q.visibleOnly && el.visible !== true) continue;
    if (q.contextPathContains) {
      const cp = (el.contextPath ?? "").toLowerCase();
      if (!cp.includes(q.contextPathContains.toLowerCase())) continue;
    }
    let score = 0;
    const reasons = [];
    if (q.variant && eqCI(el.variant, q.variant)) {
      score += FIELD_WEIGHTS.variant;
      reasons.push(`variant=${el.variant}`);
    }
    if (q.position && eqCI(el.position, q.position)) {
      score += FIELD_WEIGHTS.position;
      reasons.push(`position=${el.position}`);
    }
    if (q.color && eqCI(el.color, q.color)) {
      score += FIELD_WEIGHTS.color;
      reasons.push(`color=${el.color}`);
    }
    if (textTokens.length > 0) {
      const label = (el.label ?? "").toLowerCase();
      const labelTokens = tokenize2(el.label ?? "");
      if (label && label === (q.text ?? "").trim().toLowerCase()) {
        score += FULL_LABEL_BONUS;
        reasons.push("label-full-match");
      }
      for (const token of textTokens) {
        if (labelTokens.includes(token)) {
          score += FIELD_WEIGHTS.label;
          reasons.push(`label~${token}`);
        }
        if (eqCI(el.type, token)) {
          score += FIELD_WEIGHTS.type;
          reasons.push(`type=${el.type}`);
        }
        if (containsToken(el.variant, token)) {
          score += FIELD_WEIGHTS.variant;
          reasons.push(`variant~${token}`);
        }
        if (containsToken(el.position, token)) {
          score += FIELD_WEIGHTS.position;
          reasons.push(`position~${token}`);
        }
        if (containsToken(el.color, token)) {
          score += FIELD_WEIGHTS.color;
          reasons.push(`color~${token}`);
        }
        if (containsToken(el.contextPath, token)) {
          score += FIELD_WEIGHTS.contextPath;
          reasons.push(`contextPath~${token}`);
        }
      }
    }
    if (textTokens.length > 0 && score <= minScore) continue;
    results.push({ id: el.id, element: el, score, reasons });
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aVis = a.element.visible === true ? 0 : 1;
    const bVis = b.element.visible === true ? 0 : 1;
    if (aVis !== bVis) return aVis - bVis;
    return 0;
  });
  return results.slice(0, limit);
}
function tokenize2(s) {
  if (!s) return [];
  return s.toLowerCase().split(/[^a-z0-9#-]+/).filter((t) => t.length > 0);
}
function eqCI(a, b) {
  if (a === void 0 || b === void 0) return false;
  return a.toLowerCase() === b.toLowerCase();
}
function containsToken(value, token) {
  if (!value) return false;
  const v = value.toLowerCase();
  const t = token.toLowerCase();
  if (v === t) return true;
  const hyphenated = v.split(/[^a-z0-9#-]+/).filter((p) => p.length > 0);
  if (hyphenated.includes(t)) return true;
  const split = v.split(/[^a-z0-9#]+/).filter((p) => p.length > 0);
  return split.includes(t);
}

// src/core/websocket-client.ts
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
var UIBridgeWSClient = class {
  constructor(config) {
    this.ws = null;
    this.state = "disconnected";
    this.clientId = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.pendingRequests = /* @__PURE__ */ new Map();
    // Event listeners
    this.connectionListeners = /* @__PURE__ */ new Set();
    this.eventListeners = /* @__PURE__ */ new Map();
    this.errorListeners = /* @__PURE__ */ new Set();
    // Current subscriptions
    this.subscriptions = {};
    this.config = {
      url: config.url,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 1e3,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      pingInterval: config.pingInterval ?? 3e4,
      connectionTimeout: config.connectionTimeout ?? 1e4
    };
  }
  /**
   * Get current connection state
   */
  get connectionState() {
    return this.state;
  }
  /**
   * Get assigned client ID
   */
  get id() {
    return this.clientId;
  }
  /**
   * Connect to the WebSocket server
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.state === "connected") {
        resolve();
        return;
      }
      this.setState("connecting");
      try {
        this.ws = new WebSocket(this.config.url);
      } catch (error) {
        this.setState("disconnected");
        reject(error);
        return;
      }
      const connectionTimeout = setTimeout(() => {
        if (this.state === "connecting") {
          this.ws?.close();
          this.setState("disconnected");
          reject(new Error("Connection timeout"));
        }
      }, this.config.connectionTimeout);
      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
      };
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
          if (message.type === "welcome") {
            clearTimeout(connectionTimeout);
            this.reconnectAttempts = 0;
            this.setState("connected");
            this.startPingInterval();
            if (this.subscriptions.events?.length || this.subscriptions.elementIds?.length || this.subscriptions.componentIds?.length) {
              this.subscribe(this.subscriptions);
            }
            resolve();
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };
      this.ws.onerror = (_event) => {
        clearTimeout(connectionTimeout);
        const error = new Error("WebSocket error");
        this.notifyError(error);
        if (this.state === "connecting") {
          reject(error);
        }
      };
      this.ws.onclose = () => {
        clearTimeout(connectionTimeout);
        this.stopPingInterval();
        this.clientId = null;
        const wasConnected = this.state === "connected";
        this.setState("disconnected");
        for (const [_id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("Connection closed"));
        }
        this.pendingRequests.clear();
        if (wasConnected && this.config.autoReconnect && (this.config.maxReconnectAttempts === 0 || this.reconnectAttempts < this.config.maxReconnectAttempts)) {
          this.scheduleReconnect();
        }
      };
    });
  }
  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }
  /**
   * Subscribe to events
   */
  async subscribe(options) {
    this.subscriptions = { ...this.subscriptions, ...options };
    const response = await this.sendRequest({
      id: generateId(),
      type: "subscribe",
      timestamp: Date.now(),
      payload: options
    });
    return response.events;
  }
  /**
   * Unsubscribe from events
   */
  async unsubscribe(events) {
    if (events) {
      this.subscriptions.events = this.subscriptions.events?.filter((e) => !events.includes(e));
    } else {
      this.subscriptions = {};
    }
    const response = await this.sendRequest({
      id: generateId(),
      type: "unsubscribe",
      timestamp: Date.now(),
      payload: { events }
    });
    return response.events;
  }
  /**
   * Find elements
   */
  async find(options) {
    const response = await this.sendRequest({
      id: generateId(),
      type: "find",
      timestamp: Date.now(),
      payload: options
    });
    return response.elements;
  }
  /**
   * Discover elements
   * @deprecated Use find() instead
   */
  async discover(options) {
    return this.find(options);
  }
  /**
   * Get element details
   */
  async getElement(elementId, includeState = true) {
    const response = await this.sendRequest({
      id: generateId(),
      type: "getElement",
      timestamp: Date.now(),
      payload: { elementId, includeState }
    });
    return response.element;
  }
  /**
   * Get full snapshot
   */
  async getSnapshot() {
    const response = await this.sendRequest({
      id: generateId(),
      type: "getSnapshot",
      timestamp: Date.now()
    });
    return response;
  }
  /**
   * Execute action on an element
   */
  async executeAction(elementId, action) {
    const response = await this.sendRequest({
      id: generateId(),
      type: "executeAction",
      timestamp: Date.now(),
      payload: { elementId, action }
    });
    return response;
  }
  /**
   * Execute component action
   */
  async executeComponentAction(componentId, action, params) {
    const response = await this.sendRequest({
      id: generateId(),
      type: "executeComponentAction",
      timestamp: Date.now(),
      payload: { componentId, action, params }
    });
    return response;
  }
  /**
   * Execute workflow with optional progress streaming
   */
  async executeWorkflow(workflowId, params, onProgress) {
    const id = generateId();
    const progressHandler = onProgress ? (message) => {
      if (message.type === "workflowProgress" && message.requestId === id) {
        onProgress({
          currentStep: message.payload.currentStep,
          totalSteps: message.payload.totalSteps,
          step: {
            id: message.payload.step.id,
            status: message.payload.step.status
          }
        });
      }
    } : void 0;
    const response = await this.sendRequest(
      {
        id,
        type: "executeWorkflow",
        timestamp: Date.now(),
        payload: { workflowId, params, streamProgress: !!onProgress }
      },
      progressHandler
    );
    return response;
  }
  /**
   * Add connection state listener
   */
  onConnectionChange(listener) {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }
  /**
   * Add event listener
   */
  onEvent(eventType, listener) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, /* @__PURE__ */ new Set());
    }
    this.eventListeners.get(eventType).add(listener);
    return () => this.eventListeners.get(eventType)?.delete(listener);
  }
  /**
   * Add error listener
   */
  onError(listener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
  // Private methods
  setState(state) {
    this.state = state;
    for (const listener of this.connectionListeners) {
      try {
        listener(state);
      } catch (error) {
        console.error("Connection listener error:", error);
      }
    }
  }
  handleMessage(message) {
    switch (message.type) {
      case "welcome":
        this.clientId = message.payload.clientId;
        break;
      case "pong":
        break;
      case "subscribed":
      case "unsubscribed":
        break;
      case "event":
        this.notifyEvent(message.payload);
        break;
      case "response":
        this.handleResponse(message);
        break;
      case "error":
        if (message.requestId) {
          this.handleResponse({
            ...message,
            type: "response",
            requestId: message.requestId,
            payload: {
              success: false,
              error: message.payload.message
            }
          });
        } else {
          this.notifyError(new Error(message.payload.message));
        }
        break;
    }
  }
  handleResponse(message) {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);
    if (message.type === "response") {
      if (message.payload.success) {
        pending.resolve(message.payload.data);
      } else {
        pending.reject(new Error(message.payload.error || "Request failed"));
      }
    }
  }
  notifyEvent(event) {
    const typeListeners = this.eventListeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Event listener error:", error);
        }
      }
    }
    const wildcardListeners = this.eventListeners.get("*");
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Event listener error:", error);
        }
      }
    }
  }
  notifyError(error) {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch (e) {
        console.error("Error listener error:", e);
      }
    }
  }
  /**
   * Send a fire-and-forget event (no response expected).
   * Used for push-based change observation to stream DOM changes to the server.
   */
  sendEvent(message) {
    if (!this.ws || this.state !== "connected") return;
    try {
      this.ws.send(JSON.stringify(message));
    } catch {
    }
  }
  sendRequest(message, progressHandler) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.state !== "connected") {
        reject(new Error("Not connected"));
        return;
      }
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error("Request timeout"));
      }, 3e4);
      this.pendingRequests.set(message.id, {
        resolve,
        reject,
        timeout
      });
      if (progressHandler && this.ws) {
        const originalHandler = this.ws.onmessage;
        const wsRef = this.ws;
        const wrappedHandler = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "workflowProgress") {
              progressHandler(msg);
            }
          } catch {
          }
          if (originalHandler) {
            originalHandler.call(wsRef, event);
          }
        };
        this.ws.onmessage = wrappedHandler;
      }
      this.ws.send(JSON.stringify(message));
    });
  }
  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.setState("reconnecting");
    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      3e4
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
      });
    }, delay);
  }
  startPingInterval() {
    if (this.config.pingInterval <= 0) return;
    this.pingTimer = setInterval(() => {
      if (this.ws && this.state === "connected") {
        this.ws.send(
          JSON.stringify({
            id: generateId(),
            type: "ping",
            timestamp: Date.now()
          })
        );
      }
    }, this.config.pingInterval);
  }
  stopPingInterval() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
};
function createWSClient(config) {
  return new UIBridgeWSClient(config);
}

export { ChangeObserver, DEFAULT_REMOUNT_CACHE_WINDOW_MS, Recency, UIBridgeRegistry, UIBridgeWSClient, UIQuery, classList, classString, computeAllFingerprints, computeElementFingerprint, computeFingerprintsWithMapping, createStableRef, createWSClient, findElements, findNearestRegisteredElement, getGlobalRegistry, isSatisfiedBy, mightRequireFetch, parseRecency, requiresFetch, resolveStableRef, serializeRegisteredElement };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map