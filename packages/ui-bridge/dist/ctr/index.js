'use strict';

// src/ctr/types.ts
var CTR_CONFIG_VERSION = "1.0.0";
var CTR_FILE_EXTENSION = ".ctr.uibridge.json";
var DEFAULT_SELECTOR_CONFIDENCE = 0.8;
var CONFIDENCE_BOOST = 0.05;
var CONFIDENCE_PENALTY = 0.1;
var MIN_CONFIDENCE_THRESHOLD = 0.2;

// src/ctr/self-healing.ts
function promoteSelector(entry, selector) {
  const idx = entry.selectors.indexOf(selector);
  if (idx === -1) return null;
  const oldConfidence = selector.confidence;
  selector.confidence = Math.min(1, selector.confidence + CONFIDENCE_BOOST);
  if (idx > 0) {
    const prev = entry.selectors[idx - 1];
    if (selector.confidence > prev.confidence) {
      const tmpPriority = prev.priority;
      prev.priority = selector.priority;
      selector.priority = tmpPriority;
      entry.selectors.sort((a, b) => a.priority - b.priority);
    }
  }
  if (selector.confidence !== oldConfidence) {
    return {
      type: "ctr:selector-promoted",
      logicalName: entry.logicalName,
      selector,
      timestamp: Date.now()
    };
  }
  return null;
}
function demoteSelector(entry, selector) {
  const idx = entry.selectors.indexOf(selector);
  if (idx === -1) return null;
  const oldConfidence = selector.confidence;
  selector.confidence = Math.max(0, selector.confidence - CONFIDENCE_PENALTY);
  if (selector.confidence !== oldConfidence) {
    return {
      type: "ctr:selector-demoted",
      logicalName: entry.logicalName,
      selector,
      timestamp: Date.now()
    };
  }
  return null;
}
function getViableSelectors(entry) {
  return entry.selectors.filter((s) => s.confidence >= MIN_CONFIDENCE_THRESHOLD).sort((a, b) => a.priority - b.priority);
}
function hasViableSelectors(entry) {
  return entry.selectors.some((s) => s.confidence >= MIN_CONFIDENCE_THRESHOLD);
}

// src/ctr/registry.ts
var CentralTargetRegistry = class {
  constructor() {
    this.entries = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
    // Cache successful resolutions for the session to avoid repeated DOM queries
    this.resolutionCache = /* @__PURE__ */ new Map();
    this.cacheTtlMs = 5e3;
  }
  // 5s cache
  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------
  register(entry) {
    this.entries.set(entry.logicalName, entry);
    this.emit({
      type: "ctr:entry-registered",
      logicalName: entry.logicalName,
      timestamp: Date.now()
    });
  }
  unregister(logicalName) {
    const existed = this.entries.delete(logicalName);
    if (existed) {
      this.resolutionCache.delete(logicalName);
      this.emit({ type: "ctr:entry-unregistered", logicalName, timestamp: Date.now() });
    }
    return existed;
  }
  get(logicalName) {
    return this.entries.get(logicalName);
  }
  has(logicalName) {
    return this.entries.has(logicalName);
  }
  getAll() {
    return Array.from(this.entries.values());
  }
  clear() {
    this.entries.clear();
    this.resolutionCache.clear();
    this.emit({ type: "ctr:cleared", timestamp: Date.now() });
  }
  get size() {
    return this.entries.size;
  }
  // ---------------------------------------------------------------------------
  // Selector Management
  // ---------------------------------------------------------------------------
  /**
   * Add a selector to an existing entry.
   */
  addSelector(logicalName, selector) {
    const entry = this.entries.get(logicalName);
    if (!entry) return false;
    entry.selectors.push(selector);
    entry.selectors.sort((a, b) => a.priority - b.priority);
    entry.version++;
    if (entry.metadata) {
      entry.metadata.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    this.emit({ type: "ctr:entry-updated", logicalName, selector, timestamp: Date.now() });
    return true;
  }
  /**
   * Update a specific selector within an entry.
   */
  updateSelector(logicalName, selectorIndex, updates) {
    const entry = this.entries.get(logicalName);
    if (!entry || selectorIndex < 0 || selectorIndex >= entry.selectors.length) return false;
    const selector = entry.selectors[selectorIndex];
    if (updates.value !== void 0) selector.value = updates.value;
    if (updates.priority !== void 0) selector.priority = updates.priority;
    if (updates.confidence !== void 0) selector.confidence = updates.confidence;
    entry.selectors.sort((a, b) => a.priority - b.priority);
    entry.version++;
    this.resolutionCache.delete(logicalName);
    this.emit({ type: "ctr:entry-updated", logicalName, selector, timestamp: Date.now() });
    return true;
  }
  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------
  /**
   * Resolve a logical name to a SearchCriteria that can be used by the assertion/search system.
   * Does NOT require a browser context — returns criteria, not an element.
   */
  resolveToSearchCriteria(logicalName) {
    const entry = this.entries.get(logicalName);
    if (!entry) return null;
    const cached = this.resolutionCache.get(logicalName);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return selectorToSearchCriteria(cached.selector);
    }
    const selectors = getViableSelectors(entry);
    if (selectors.length === 0) return null;
    return selectorToSearchCriteria(selectors[0]);
  }
  /**
   * Resolve a logical name to a DOM element with self-healing.
   * Requires browser context (document must be available).
   */
  resolveInDOM(logicalName) {
    const startTime = performance.now();
    const entry = this.entries.get(logicalName);
    if (!entry) {
      return {
        logicalName,
        resolved: false,
        attemptedSelectors: [],
        durationMs: performance.now() - startTime
      };
    }
    const selectors = getViableSelectors(entry);
    const attempted = [];
    for (const selector of selectors) {
      attempted.push(selector);
      const element = resolveSelectorInDOM(selector);
      if (element) {
        const event = promoteSelector(entry, selector);
        if (event) this.emit(event);
        for (const failed of attempted.slice(0, -1)) {
          const demoteEvent = demoteSelector(entry, failed);
          if (demoteEvent) this.emit(demoteEvent);
        }
        entry.lastResolved = Date.now();
        this.resolutionCache.set(logicalName, { selector, timestamp: Date.now() });
        this.emit({
          type: "ctr:resolution-succeeded",
          logicalName,
          selector,
          timestamp: Date.now()
        });
        return {
          logicalName,
          resolved: true,
          matchedSelector: selector,
          element,
          criteria: selectorToSearchCriteria(selector),
          attemptedSelectors: attempted,
          durationMs: performance.now() - startTime
        };
      }
    }
    entry.lastFailed = Date.now();
    this.resolutionCache.delete(logicalName);
    this.emit({
      type: "ctr:resolution-failed",
      logicalName,
      timestamp: Date.now()
    });
    return {
      logicalName,
      resolved: false,
      attemptedSelectors: attempted,
      durationMs: performance.now() - startTime
    };
  }
  // ---------------------------------------------------------------------------
  // Config Import/Export
  // ---------------------------------------------------------------------------
  loadConfig(config) {
    for (const entry of config.entries) {
      this.entries.set(entry.logicalName, entry);
    }
    this.resolutionCache.clear();
    this.emit({ type: "ctr:config-loaded", timestamp: Date.now() });
  }
  exportConfig() {
    return {
      version: CTR_CONFIG_VERSION,
      entries: Array.from(this.entries.values())
    };
  }
  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  off(listener) {
    this.listeners.delete(listener);
  }
  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
  // ---------------------------------------------------------------------------
  // Cache Control
  // ---------------------------------------------------------------------------
  setCacheTtl(ms) {
    this.cacheTtlMs = ms;
  }
  invalidateCache(logicalName) {
    if (logicalName) {
      this.resolutionCache.delete(logicalName);
    } else {
      this.resolutionCache.clear();
    }
  }
  // ---------------------------------------------------------------------------
  // Cross-Run Confidence Seeding
  // ---------------------------------------------------------------------------
  /**
   * Seed selector confidence scores from cross-run reliability data.
   *
   * When the runner provides historical element reliability data (via
   * GET /ui-bridge/graph/element-reliability), this method adjusts the
   * initial confidence of matching CTR entries based on observed success rates.
   *
   * Elements marked as flaky get their confidence reduced; reliable elements
   * get a boost. This prevents the CTR from starting with high confidence on
   * selectors that historically fail.
   */
  seedFromHistory(reliabilityData) {
    let seeded = 0;
    for (const data of reliabilityData) {
      for (const [, entry] of this.entries) {
        for (const selector of entry.selectors) {
          const selectorValue = typeof selector.value === "string" ? selector.value : void 0;
          if (!selectorValue) continue;
          if (selectorValue === data.element_id || entry.logicalName === data.element_id) {
            const blended = data.recommended_confidence * 0.7 + selector.confidence * 0.3;
            selector.confidence = Math.max(0.1, Math.min(1, blended));
            seeded++;
          }
        }
      }
    }
    return seeded;
  }
};
function selectorToSearchCriteria(selector) {
  switch (selector.strategy) {
    case "data-testid":
      return { idPattern: selector.value, fuzzy: false };
    case "data-awas-element":
      return { idPattern: selector.value, fuzzy: false };
    case "id":
      return { idPattern: selector.value, fuzzy: false };
    case "css":
      return { selector: selector.value, fuzzy: false };
    case "xpath":
      return { xpath: selector.value, fuzzy: false };
    case "search":
      return selector.value;
  }
}
function resolveSelectorInDOM(selector) {
  if (typeof document === "undefined") return null;
  try {
    switch (selector.strategy) {
      case "data-testid":
        return document.querySelector(
          `[data-testid="${CSS.escape(selector.value)}"]`
        );
      case "data-awas-element":
        return document.querySelector(
          `[data-awas-element="${CSS.escape(selector.value)}"]`
        );
      case "id":
        return document.querySelector(`#${CSS.escape(selector.value)}`);
      case "css":
        return document.querySelector(selector.value);
      case "xpath": {
        const result = document.evaluate(
          selector.value,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return result.singleNodeValue;
      }
      case "search":
        return null;
    }
  } catch {
    return null;
  }
}
var GLOBAL_KEY = "__uiBridgeCtr";
function getGlobalCtr() {
  const g = globalThis;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new CentralTargetRegistry();
  }
  return g[GLOBAL_KEY];
}
function setGlobalCtr(registry) {
  globalThis[GLOBAL_KEY] = registry;
}
function resetGlobalCtr() {
  delete globalThis[GLOBAL_KEY];
}
function createCtrEntry(logicalName, selectors, metadata) {
  return {
    logicalName,
    selectors: selectors.map((s, i) => ({
      strategy: s.strategy,
      value: s.value,
      priority: s.priority ?? i,
      confidence: s.confidence ?? DEFAULT_SELECTOR_CONFIDENCE
    })),
    metadata: metadata ? { ...metadata, createdAt: (/* @__PURE__ */ new Date()).toISOString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() } : void 0,
    version: 1
  };
}

// src/ctr/auto-populate.ts
function autoPopulateCtr(uiRegistry, ctr, options = {}) {
  const { overwrite = false, prefix = "", filter } = options;
  const unsubscribe = uiRegistry.on("element:registered", (event) => {
    const element = event.data;
    if (!element) return;
    if (filter && !filter(element)) return;
    const logicalName = prefix + element.id;
    if (!overwrite && ctr.has(logicalName)) return;
    const selectors = buildSelectorsFromElement(element);
    if (selectors.length === 0) return;
    const entry = {
      logicalName,
      selectors,
      metadata: {
        description: element.description ?? element.label,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      version: 1
    };
    ctr.register(entry);
  });
  return unsubscribe;
}
function buildSelectorsFromElement(registered) {
  const selectors = [];
  let priority = 0;
  const el = registered.element;
  if (!el) return selectors;
  const testId = el.getAttribute("data-testid");
  if (testId) {
    selectors.push({
      strategy: "data-testid",
      value: testId,
      priority: priority++,
      confidence: DEFAULT_SELECTOR_CONFIDENCE
    });
  }
  const awasId = el.getAttribute("data-awas-element");
  if (awasId) {
    selectors.push({
      strategy: "data-awas-element",
      value: awasId,
      priority: priority++,
      confidence: DEFAULT_SELECTOR_CONFIDENCE
    });
  }
  if (el.id) {
    selectors.push({
      strategy: "id",
      value: el.id,
      priority: priority++,
      confidence: DEFAULT_SELECTOR_CONFIDENCE
    });
  }
  if (registered.id) {
    selectors.push({
      strategy: "search",
      value: { idPattern: registered.id, fuzzy: false },
      priority,
      confidence: DEFAULT_SELECTOR_CONFIDENCE * 0.9
    });
  }
  return selectors;
}

exports.CONFIDENCE_BOOST = CONFIDENCE_BOOST;
exports.CONFIDENCE_PENALTY = CONFIDENCE_PENALTY;
exports.CTR_CONFIG_VERSION = CTR_CONFIG_VERSION;
exports.CTR_FILE_EXTENSION = CTR_FILE_EXTENSION;
exports.CentralTargetRegistry = CentralTargetRegistry;
exports.DEFAULT_SELECTOR_CONFIDENCE = DEFAULT_SELECTOR_CONFIDENCE;
exports.MIN_CONFIDENCE_THRESHOLD = MIN_CONFIDENCE_THRESHOLD;
exports.autoPopulateCtr = autoPopulateCtr;
exports.createCtrEntry = createCtrEntry;
exports.demoteSelector = demoteSelector;
exports.getGlobalCtr = getGlobalCtr;
exports.getViableSelectors = getViableSelectors;
exports.hasViableSelectors = hasViableSelectors;
exports.promoteSelector = promoteSelector;
exports.resetGlobalCtr = resetGlobalCtr;
exports.setGlobalCtr = setGlobalCtr;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map