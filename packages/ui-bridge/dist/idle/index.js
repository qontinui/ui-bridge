'use strict';

// src/idle/network-idle.ts
var NetworkIdleDetector = class {
  constructor(config = {}) {
    this.name = "network";
    this.pending = /* @__PURE__ */ new Map();
    this.nextId = 0;
    this.idleTimer = null;
    this._isIdle = true;
    this.listeners = [];
    this.installed = false;
    // Saved originals for cleanup (standalone mode only)
    this.originalFetch = null;
    this.originalXHROpen = null;
    this.originalXHRSend = null;
    // Tracker-driven mode
    this.tracker = null;
    this.trackerUnsubscribe = null;
    this.weight = config.weight ?? 0.9;
    this.debounceMs = config.debounceMs ?? 500;
    this.ignorePatterns = (config.ignorePatterns ?? []).map((p) => new RegExp(p));
    this.trackXHR = config.trackXHR ?? true;
    this.tracker = config.tracker ?? null;
  }
  install() {
    if (this.installed) return;
    this.installed = true;
    if (this.tracker) {
      this.installTrackerSubscription();
    } else {
      this.installFetchInterceptor();
      if (this.trackXHR) {
        this.installXHRInterceptor();
      }
    }
  }
  destroy() {
    if (!this.installed) return;
    this.installed = false;
    if (this.trackerUnsubscribe) {
      this.trackerUnsubscribe();
      this.trackerUnsubscribe = null;
    } else {
      if (this.originalFetch) {
        globalThis.fetch = this.originalFetch;
        this.originalFetch = null;
      }
      if (this.originalXHROpen) {
        XMLHttpRequest.prototype.open = this.originalXHROpen;
        this.originalXHROpen = null;
      }
      if (this.originalXHRSend) {
        XMLHttpRequest.prototype.send = this.originalXHRSend;
        this.originalXHRSend = null;
      }
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.pending.clear();
    this.listeners = [];
  }
  isIdle() {
    return this._isIdle;
  }
  getStatus() {
    const now = Date.now();
    const pendingRequests = [];
    for (const tracked of this.pending.values()) {
      pendingRequests.push({
        url: tracked.url,
        method: tracked.method,
        startedAt: tracked.startedAt,
        durationMs: now - tracked.startedAt
      });
    }
    return {
      idle: this._isIdle,
      pendingCount: this.pending.size,
      pendingRequests,
      timestamp: now
    };
  }
  async waitForIdle(options) {
    const timeout = options?.timeout ?? 3e4;
    const minStable = options?.minStableMs ?? 0;
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stableSince = null;
      const check = () => {
        const status = this.getStatus();
        if (status.idle) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(status);
          }
        } else {
          stableSince = null;
        }
        if (Date.now() - startTime > timeout) {
          return reject(
            new Error(
              `Network idle timeout after ${timeout}ms. ${this.pending.size} requests still pending.`
            )
          );
        }
        setTimeout(check, 50);
      };
      check();
    });
  }
  onTransition(callback) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
  // ==========================================================================
  // Private
  // ==========================================================================
  /**
   * Subscribe to a NetworkRequestTracker's events instead of patching
   * fetch/XHR directly. The idle detector only cares about request
   * start/end — not the full request metadata.
   */
  installTrackerSubscription() {
    this.trackerUnsubscribe = this.tracker.onEvent((event) => {
      const url = event.entry.request.url;
      const method = event.entry.request.method;
      if (this.shouldIgnore(url)) return;
      if (event.type === "request-start") {
        this.trackRequest(url, method);
      } else {
        let matchedId = null;
        for (const [id, tracked] of this.pending) {
          if (tracked.url === url && tracked.method === method) {
            matchedId = id;
            break;
          }
        }
        if (matchedId !== null) {
          const statusCode = event.type === "request-error" ? event.entry.response?.statusCode ?? 0 : event.entry.response?.statusCode;
          this.completeRequest(matchedId, statusCode);
        }
      }
    });
  }
  shouldIgnore(url) {
    return this.ignorePatterns.some((re) => re.test(url));
  }
  trackRequest(url, method) {
    const id = this.nextId++;
    this.pending.set(id, { url, method, startedAt: Date.now() });
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this._isIdle) {
      this._isIdle = false;
      this.notifyTransition();
    }
    this.onRequestStart?.({
      url,
      method,
      pendingCount: this.pending.size
    });
    return id;
  }
  completeRequest(id, status) {
    const tracked = this.pending.get(id);
    if (!tracked) return;
    this.pending.delete(id);
    this.onRequestEnd?.({
      url: tracked.url,
      method: tracked.method,
      status,
      durationMs: Date.now() - tracked.startedAt,
      pendingCount: this.pending.size
    });
    if (this.pending.size === 0) {
      this.scheduleIdle();
    }
  }
  scheduleIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0 && !this._isIdle) {
        this._isIdle = true;
        this.notifyTransition();
      }
    }, this.debounceMs);
  }
  notifyTransition() {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(this._isIdle, status);
      } catch {
      }
    }
  }
  installFetchInterceptor() {
    this.originalFetch = globalThis.fetch;
    const self = this;
    const original = this.originalFetch;
    globalThis.fetch = function(input, init) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method?.toUpperCase() || "GET";
      if (self.shouldIgnore(url)) {
        return original.call(globalThis, input, init);
      }
      const id = self.trackRequest(url, method);
      return original.call(globalThis, input, init).then(
        (response) => {
          self.completeRequest(id, response.status);
          return response;
        },
        (error) => {
          self.completeRequest(id, 0);
          throw error;
        }
      );
    };
  }
  installXHRInterceptor() {
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;
    const self = this;
    XMLHttpRequest.prototype.open = function(method, url, async, username, password) {
      this.__uiBridgeMethod = method;
      this.__uiBridgeUrl = typeof url === "string" ? url : url.href;
      return self.originalXHROpen.call(this, method, url, async ?? true, username, password);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const xhr = this;
      const url = xhr.__uiBridgeUrl || "";
      const method = (xhr.__uiBridgeMethod || "GET").toUpperCase();
      if (self.shouldIgnore(url)) {
        return self.originalXHRSend.call(this, body);
      }
      const id = self.trackRequest(url, method);
      xhr.__uiBridgeTrackId = id;
      xhr.addEventListener("loadend", () => {
        self.completeRequest(id, xhr.status);
      });
      return self.originalXHRSend.call(this, body);
    };
  }
};

// src/idle/dom-settling.ts
var DOMSettlingDetector = class {
  constructor(config = {}) {
    this.name = "dom";
    this.observer = null;
    this.lastMutationAt = 0;
    this.recentMutations = [];
    // timestamps of recent mutations
    this.settleTimer = null;
    this._isSettled = true;
    this.listeners = [];
    this.installed = false;
    this.weight = config.weight ?? 0.8;
    this.settleMs = config.settleMs ?? 300;
    this.root = config.root;
  }
  install() {
    if (this.installed) return;
    this.installed = true;
    const root = this.root ?? document.body;
    this.observer = new MutationObserver((mutations) => {
      const now = Date.now();
      this.lastMutationAt = now;
      this.recentMutations.push(now);
      const cutoff = now - 1e3;
      this.recentMutations = this.recentMutations.filter((t) => t >= cutoff);
      let meaningfulCount = 0;
      for (const m of mutations) {
        if (m.type === "childList" && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          meaningfulCount++;
        } else if (m.type === "attributes") {
          meaningfulCount++;
        }
      }
      if (meaningfulCount === 0) return;
      if (this._isSettled) {
        this._isSettled = false;
        this.notifyTransition();
      }
      this.resetSettleTimer();
    });
    this.observer.observe(root, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true
    });
  }
  destroy() {
    if (!this.installed) return;
    this.installed = false;
    this.observer?.disconnect();
    this.observer = null;
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.listeners = [];
  }
  isIdle() {
    return this._isSettled;
  }
  getStatus() {
    const now = Date.now();
    const cutoff = now - 1e3;
    const recentCount = this.recentMutations.filter((t) => t >= cutoff).length;
    return {
      idle: this._isSettled,
      settled: this._isSettled,
      lastMutationAt: this.lastMutationAt,
      msSinceLastMutation: this.lastMutationAt > 0 ? now - this.lastMutationAt : now,
      recentMutationCount: recentCount,
      timestamp: now
    };
  }
  async waitForIdle(options) {
    const timeout = options?.timeout ?? 3e4;
    const minStable = options?.minStableMs ?? 0;
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stableSince = null;
      const check = () => {
        const status = this.getStatus();
        if (status.settled) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(status);
          }
        } else {
          stableSince = null;
        }
        if (Date.now() - startTime > timeout) {
          return reject(
            new Error(
              `DOM settling timeout after ${timeout}ms. Last mutation ${status.msSinceLastMutation}ms ago.`
            )
          );
        }
        setTimeout(check, 50);
      };
      check();
    });
  }
  onTransition(callback) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
  // ==========================================================================
  // Private
  // ==========================================================================
  resetSettleTimer() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (!this._isSettled) {
        this._isSettled = true;
        this.notifyTransition();
      }
    }, this.settleMs);
  }
  notifyTransition() {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(this._isSettled, status);
      } catch {
      }
    }
  }
};

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

// src/idle/loading-indicators.ts
var DEFAULT_LOADING_SELECTORS = [
  // ARIA
  '[aria-busy="true"]',
  '[role="progressbar"]',
  // Common class conventions
  ".loading",
  ".spinner",
  ".skeleton",
  ".shimmer",
  ".loader",
  ".pending",
  '[class*="loading"]',
  '[class*="spinner"]',
  '[class*="skeleton"]',
  '[class*="shimmer"]',
  // HTML elements
  'progress:not([value="100"]):not([value="1"])',
  // Framework-specific (popular libraries)
  ".MuiCircularProgress-root",
  ".MuiLinearProgress-root",
  ".MuiSkeleton-root",
  ".ant-spin",
  ".ant-skeleton",
  ".chakra-spinner",
  // Data attributes
  '[data-loading="true"]',
  '[data-pending="true"]',
  '[data-state="loading"]'
];
var LOADING_ANIMATION_KEYWORDS = [
  "spin",
  "rotate",
  "pulse",
  "shimmer",
  "bounce",
  "skeleton",
  "loading",
  "progress",
  "indeterminate"
];
var LoadingIndicatorDetector = class {
  constructor(config = {}) {
    this.name = "loading-indicators";
    this.observer = null;
    this._indicators = [];
    this._isIdle = true;
    this.scanTimer = null;
    this.listeners = [];
    this.installed = false;
    this.weight = config.weight ?? 0.7;
    this.selectors = [...DEFAULT_LOADING_SELECTORS, ...config.additionalSelectors ?? []];
    this.checkAnimations = config.checkAnimations ?? true;
    this.checkCursor = config.checkCursor ?? true;
  }
  install() {
    if (this.installed) return;
    this.installed = true;
    this.scan();
    this.observer = new MutationObserver(() => {
      if (this.scanTimer) clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => {
        this.scanTimer = null;
        this.scan();
      }, 100);
    });
    this.observer.observe(document.body, {
      childList: true,
      attributes: true,
      subtree: true,
      attributeFilter: ["class", "aria-busy", "data-loading", "data-pending", "data-state"]
    });
  }
  destroy() {
    if (!this.installed) return;
    this.installed = false;
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.listeners = [];
  }
  isIdle() {
    return this._isIdle;
  }
  getStatus() {
    return {
      idle: this._isIdle,
      loading: !this._isIdle,
      indicators: [...this._indicators],
      timestamp: Date.now()
    };
  }
  async waitForIdle(options) {
    const timeout = options?.timeout ?? 3e4;
    const minStable = options?.minStableMs ?? 0;
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stableSince = null;
      const check = () => {
        this.scan();
        const status = this.getStatus();
        if (status.idle) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(status);
          }
        } else {
          stableSince = null;
        }
        if (Date.now() - startTime > timeout) {
          return reject(
            new Error(
              `Loading indicator timeout after ${timeout}ms. ${this._indicators.length} indicators still active.`
            )
          );
        }
        setTimeout(check, 100);
      };
      check();
    });
  }
  onTransition(callback) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
  /**
   * Wait for a specific CSS selector to disappear from the loading indicators.
   */
  async waitForIndicatorCleared(selector, timeout = 3e4) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        this.scan();
        const matchingSelector = this.selectors.includes(selector) ? selector : void 0;
        const hasMatch = matchingSelector ? document.querySelector(selector) !== null && this.isElementVisible(document.querySelector(selector)) : false;
        if (!hasMatch) {
          return resolve(this.getStatus());
        }
        if (Date.now() - startTime > timeout) {
          return reject(new Error(`Indicator "${selector}" still present after ${timeout}ms.`));
        }
        setTimeout(check, 100);
      };
      check();
    });
  }
  // ==========================================================================
  // Private
  // ==========================================================================
  scan() {
    const indicators = [];
    for (const selector of this.selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (this.isElementVisible(el)) {
            indicators.push({
              type: selector.startsWith("[aria-busy") ? "aria-busy" : "selector",
              selector,
              element: this.getElementId(el)
            });
          }
        }
      } catch {
      }
    }
    if (this.checkAnimations && typeof document.getAnimations === "function") {
      try {
        const animations = document.getAnimations();
        for (const anim of animations) {
          const cssAnim = anim;
          const name = cssAnim.animationName || "";
          if (name && LOADING_ANIMATION_KEYWORDS.some((k) => name.toLowerCase().includes(k))) {
            const target = anim.effect?.target;
            if (target && this.isElementVisible(target)) {
              indicators.push({
                type: "animation",
                element: this.getElementId(target),
                details: name
              });
            }
          }
        }
      } catch {
      }
    }
    if (this.checkCursor) {
      try {
        const bodyStyle = getComputedStyle(document.body);
        if (bodyStyle.cursor === "wait" || bodyStyle.cursor === "progress") {
          indicators.push({
            type: "cursor",
            details: bodyStyle.cursor
          });
        }
      } catch {
      }
    }
    const seen = /* @__PURE__ */ new Set();
    const deduped = indicators.filter((ind) => {
      const key = `${ind.type}:${ind.element || ""}:${ind.selector || ""}:${ind.details || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const wasIdle = this._isIdle;
    this._indicators = deduped;
    this._isIdle = deduped.length === 0;
    if (wasIdle !== this._isIdle) {
      this.notifyTransition();
    }
  }
  isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }
  getElementId(el) {
    return el.getAttribute("data-testid") || el.getAttribute("data-ui-bridge-id") || el.id || `${el.tagName.toLowerCase()}.${classList(el)[0] || "unknown"}`;
  }
  notifyTransition() {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(this._isIdle, status);
      } catch {
      }
    }
  }
};

// src/idle/form-mutation.ts
var FormMutationDetector = class {
  constructor(config = {}) {
    this.name = "form-mutation";
    this.lastMutationAt = 0;
    this.recentMutations = [];
    this.settleTimer = null;
    this._isSettled = true;
    this.listeners = [];
    this.installed = false;
    this.weight = config.weight ?? 0.5;
    this.settleMs = config.settleMs ?? 800;
    this.handleInput = this.onFormEvent.bind(this);
    this.handleChange = this.onFormEvent.bind(this);
    this.handleFocusIn = this.onFocusIn.bind(this);
    this.handleFocusOut = this.onFocusOut.bind(this);
  }
  install() {
    if (this.installed) return;
    this.installed = true;
    document.addEventListener("input", this.handleInput, true);
    document.addEventListener("change", this.handleChange, true);
    document.addEventListener("focusin", this.handleFocusIn, true);
    document.addEventListener("focusout", this.handleFocusOut, true);
  }
  destroy() {
    if (!this.installed) return;
    this.installed = false;
    document.removeEventListener("input", this.handleInput, true);
    document.removeEventListener("change", this.handleChange, true);
    document.removeEventListener("focusin", this.handleFocusIn, true);
    document.removeEventListener("focusout", this.handleFocusOut, true);
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.listeners = [];
  }
  isIdle() {
    return this._isSettled;
  }
  getStatus() {
    const now = Date.now();
    const cutoff = now - 1e3;
    const recentCount = this.recentMutations.filter((t) => t >= cutoff).length;
    return {
      idle: this._isSettled,
      settled: this._isSettled,
      lastMutationAt: this.lastMutationAt,
      msSinceLastMutation: this.lastMutationAt > 0 ? now - this.lastMutationAt : now,
      recentMutationCount: recentCount,
      activeFieldId: this.activeFieldId,
      timestamp: now
    };
  }
  async waitForIdle(options) {
    const timeout = options?.timeout ?? 3e4;
    const minStable = options?.minStableMs ?? 0;
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stableSince = null;
      const check = () => {
        const status = this.getStatus();
        if (status.settled) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(status);
          }
        } else {
          stableSince = null;
        }
        if (Date.now() - startTime > timeout) {
          return reject(
            new Error(
              `Form mutation settling timeout after ${timeout}ms. Last mutation ${status.msSinceLastMutation}ms ago.`
            )
          );
        }
        setTimeout(check, 50);
      };
      check();
    });
  }
  onTransition(callback) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
  // ==========================================================================
  // Private
  // ==========================================================================
  isFormElement(target) {
    if (!target || !(target instanceof HTMLElement)) return false;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  }
  onFormEvent(e) {
    if (!this.isFormElement(e.target)) return;
    const now = Date.now();
    this.lastMutationAt = now;
    this.recentMutations.push(now);
    const cutoff = now - 1e3;
    this.recentMutations = this.recentMutations.filter((t) => t >= cutoff);
    if (this._isSettled) {
      this._isSettled = false;
      this.notifyTransition();
    }
    this.resetSettleTimer();
  }
  onFocusIn(e) {
    if (!this.isFormElement(e.target)) return;
    const el = e.target;
    this.activeFieldId = el.id || el.getAttribute("name") || void 0;
  }
  onFocusOut(e) {
    if (!this.isFormElement(e.target)) return;
    this.activeFieldId = void 0;
  }
  resetSettleTimer() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (!this._isSettled) {
        this._isSettled = true;
        this.notifyTransition();
      }
    }, this.settleMs);
  }
  notifyTransition() {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(this._isSettled, status);
      } catch {
      }
    }
  }
};

// src/idle/composite-idle.ts
var CompositeIdleDetector = class _CompositeIdleDetector {
  constructor(config) {
    this.signals = /* @__PURE__ */ new Map();
    this.listeners = [];
    this.lastIdle = null;
    this.minIdleScore = config?.minIdleScore ?? 0.7;
  }
  /**
   * Create a composite detector with default signals from config.
   */
  static create(config = {}) {
    const detector = new _CompositeIdleDetector({ minIdleScore: config.minIdleScore });
    if (config.network?.enabled !== false) {
      detector.addSignal(
        new NetworkIdleDetector({
          weight: config.network?.weight ?? 0.9,
          debounceMs: config.network?.debounceMs,
          ignorePatterns: config.network?.ignorePatterns,
          trackXHR: config.network?.trackXHR,
          tracker: config.network?.tracker
        })
      );
    }
    if (config.dom?.enabled !== false) {
      detector.addSignal(
        new DOMSettlingDetector({
          weight: config.dom?.weight ?? 0.8,
          settleMs: config.dom?.settleMs,
          root: config.dom?.root
        })
      );
    }
    if (config.loadingIndicators?.enabled !== false) {
      detector.addSignal(
        new LoadingIndicatorDetector({
          weight: config.loadingIndicators?.weight ?? 0.7,
          additionalSelectors: config.loadingIndicators?.additionalSelectors,
          checkAnimations: config.loadingIndicators?.checkAnimations,
          checkCursor: config.loadingIndicators?.checkCursor
        })
      );
    }
    if (config.formMutation?.enabled !== false) {
      detector.addSignal(
        new FormMutationDetector({
          weight: config.formMutation?.weight ?? 0.5,
          settleMs: config.formMutation?.settleMs
        })
      );
    }
    return detector;
  }
  /**
   * Add a signal to the composite. Installs it and subscribes to transitions.
   */
  addSignal(signal) {
    this.signals.set(signal.name, signal);
    signal.install();
    signal.onTransition(() => this.evaluate());
  }
  /**
   * Remove a signal by name. Destroys it.
   */
  removeSignal(name) {
    const signal = this.signals.get(name);
    if (!signal) return false;
    signal.destroy();
    this.signals.delete(name);
    return true;
  }
  /**
   * Get an individual signal by name for direct access.
   */
  getSignal(name) {
    return this.signals.get(name);
  }
  /**
   * List all registered signal names.
   */
  getSignalNames() {
    return Array.from(this.signals.keys());
  }
  /**
   * Whether the composite considers the app idle.
   */
  isIdle() {
    return this.getStatus().idle;
  }
  /**
   * Get full composite status including per-signal breakdown.
   */
  getStatus(exclude) {
    const signalEntries = {};
    const excludeSet = new Set(exclude ?? []);
    let totalWeight = 0;
    let idleWeight = 0;
    let allCriticalIdle = true;
    for (const [name, signal] of this.signals) {
      if (excludeSet.has(name)) continue;
      const idle = signal.isIdle();
      const status = signal.getStatus();
      signalEntries[name] = {
        name,
        idle,
        weight: signal.weight,
        status
      };
      totalWeight += signal.weight;
      if (idle) idleWeight += signal.weight;
      if (signal.weight >= 0.8 && !idle) {
        allCriticalIdle = false;
      }
    }
    const idleScore = totalWeight > 0 ? idleWeight / totalWeight : 1;
    return {
      idle: allCriticalIdle && idleScore >= this.minIdleScore,
      idleScore,
      signals: signalEntries,
      timestamp: Date.now()
    };
  }
  /**
   * Get the status of a single signal by name.
   */
  getSignalStatus(name) {
    return this.signals.get(name)?.getStatus();
  }
  /**
   * Wait for the composite to become idle.
   */
  async waitForIdle(options) {
    const timeout = options?.timeout ?? 3e4;
    const minStable = options?.minStableMs ?? 500;
    const exclude = options?.exclude;
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stableSince = null;
      const check = () => {
        const status = this.getStatus(exclude);
        if (status.idle) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(status);
          }
        } else {
          stableSince = null;
        }
        if (Date.now() - startTime > timeout) {
          const busySignals = Object.values(status.signals).filter((s) => !s.idle).map((s) => s.name);
          return reject(
            new Error(
              `Idle timeout after ${timeout}ms. Busy signals: ${busySignals.join(", ") || "none"}. Score: ${status.idleScore.toFixed(2)}`
            )
          );
        }
        setTimeout(check, 50);
      };
      check();
    });
  }
  /**
   * Wait for a specific subset of signals to become idle.
   * Targets can be signal names or { indicator: '.selector' } for specific loading indicators.
   */
  async waitFor(targets, options) {
    const timeout = options?.timeout ?? 3e4;
    const minStable = options?.minStableMs ?? 0;
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stableSince = null;
      const check = () => {
        let allIdle = true;
        const results = {};
        for (const target of targets) {
          if (typeof target === "string") {
            const signal = this.signals.get(target);
            if (signal) {
              const status = signal.getStatus();
              results[target] = status;
              if (!status.idle) allIdle = false;
            }
          } else {
            const el = document.querySelector(target.indicator);
            const present = el !== null && this.isElementVisible(el);
            const key = `indicator:${target.indicator}`;
            results[key] = { idle: !present, timestamp: Date.now() };
            if (present) allIdle = false;
          }
        }
        if (allIdle) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(results);
          }
        } else {
          stableSince = null;
        }
        if (Date.now() - startTime > timeout) {
          const busy = Object.entries(results).filter(([, s]) => !s.idle).map(([k]) => k);
          return reject(
            new Error(`Selective wait timeout after ${timeout}ms. Still busy: ${busy.join(", ")}`)
          );
        }
        setTimeout(check, 50);
      };
      check();
    });
  }
  /**
   * Wait for a single signal by name.
   */
  async waitForSignal(name, options) {
    const signal = this.signals.get(name);
    if (!signal) {
      throw new Error(`Signal not found: ${name}. Available: ${this.getSignalNames().join(", ")}`);
    }
    return signal.waitForIdle(options);
  }
  /**
   * Subscribe to composite idle/busy transitions.
   */
  onTransition(callback) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
  /**
   * Install all signals. Called automatically by addSignal, but can be
   * called explicitly if signals were added without install.
   */
  installAll() {
    for (const signal of this.signals.values()) {
      signal.install();
    }
  }
  /**
   * Clean up all signals.
   */
  destroy() {
    for (const signal of this.signals.values()) {
      signal.destroy();
    }
    this.signals.clear();
    this.listeners = [];
    this.lastIdle = null;
  }
  // ==========================================================================
  // Private
  // ==========================================================================
  evaluate() {
    const status = this.getStatus();
    if (this.lastIdle !== status.idle) {
      this.lastIdle = status.idle;
      for (const listener of this.listeners) {
        try {
          listener(status);
        } catch {
        }
      }
    }
  }
  isElementVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }
};

// src/idle/element-settling.ts
function waitForElementStable(element, options) {
  const quietMs = options?.quietMs ?? 500;
  const timeout = options?.timeout ?? 5e3;
  const observeAttributes = options?.observeAttributes ?? true;
  const observeSubtree = options?.observeSubtree ?? false;
  return new Promise((resolve) => {
    const startTime = Date.now();
    let lastActivityAt = Date.now();
    let rafId = null;
    let timeoutId = null;
    let quietCheckId = null;
    let prevRect = null;
    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (quietCheckId !== null) clearTimeout(quietCheckId);
    }
    function recordActivity() {
      lastActivityAt = Date.now();
      scheduleQuietCheck();
    }
    function scheduleQuietCheck() {
      if (quietCheckId !== null) clearTimeout(quietCheckId);
      quietCheckId = setTimeout(
        () => {
          const elapsed = Date.now() - lastActivityAt;
          if (elapsed >= quietMs) {
            cleanup();
            resolve({ stable: true, elapsed: Date.now() - startTime });
          } else {
            scheduleQuietCheck();
          }
        },
        quietMs - (Date.now() - lastActivityAt) + 1
      );
    }
    const observer = new MutationObserver((mutations) => {
      let meaningful = false;
      for (const m of mutations) {
        if (m.type === "childList" && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          meaningful = true;
          break;
        }
        if (m.type === "attributes" || m.type === "characterData") {
          meaningful = true;
          break;
        }
      }
      if (meaningful) recordActivity();
    });
    observer.observe(element, {
      childList: true,
      attributes: observeAttributes,
      characterData: true,
      subtree: observeSubtree
    });
    function pollBBox() {
      if (cleaned) return;
      const rect = element.getBoundingClientRect();
      if (prevRect !== null && !rectsEqual(prevRect, rect)) {
        recordActivity();
      }
      prevRect = rect;
      rafId = requestAnimationFrame(pollBBox);
    }
    rafId = requestAnimationFrame(pollBBox);
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ stable: false, elapsed: Date.now() - startTime });
    }, timeout);
    scheduleQuietCheck();
  });
}
function rectsEqual(a, b, epsilon = 0.5) {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.width - b.width) < epsilon && Math.abs(a.height - b.height) < epsilon;
}

// src/idle/stuck-screen.ts
var StuckScreenDetector = class {
  constructor(detector, config = {}) {
    this.detector = detector;
    this.observationWindowMs = config.observationWindowMs ?? 3e3;
    this.domMutationThreshold = config.domMutationThreshold ?? 3;
  }
  /**
   * Run a stuck-screen diagnosis.
   *
   * Takes two snapshots separated by the observation window and compares them
   * to determine if the app is stuck, loading normally, idle, or in an
   * ambiguous state.
   */
  async diagnose() {
    const snap1 = this.captureSnapshot();
    await new Promise((resolve) => setTimeout(resolve, this.observationWindowMs));
    const snap2 = this.captureSnapshot();
    const actualWindowMs = snap2.timestamp - snap1.timestamp;
    const peakMutations = Math.max(snap1.recentDOMMutations, snap2.recentDOMMutations);
    const domChanged = peakMutations >= this.domMutationThreshold || !snap1.domSettled || !snap2.domSettled;
    const evidence = {
      loadingIndicators: snap2.loadingIndicators,
      domChanged,
      domMutationCount: peakMutations,
      networkBusy: !snap2.networkIdle,
      pendingNetworkRequests: snap2.pendingNetworkRequests,
      idleScoreStart: snap1.idleScore,
      idleScoreEnd: snap2.idleScore
    };
    const hasLoadingIndicators = snap1.loadingIndicators.length > 0 && snap2.loadingIndicators.length > 0;
    const hadLoadingIndicators = snap1.loadingIndicators.length > 0 || snap2.loadingIndicators.length > 0;
    let verdict;
    let confidence;
    let summary;
    const suggestions = [];
    if (!hadLoadingIndicators) {
      verdict = "idle";
      confidence = 0.9;
      summary = "No loading indicators detected. The app appears to be in a normal resting state.";
    } else if (hasLoadingIndicators && !domChanged && snap2.networkIdle) {
      verdict = "stuck";
      confidence = 0.95;
      const indicatorDesc = this.describeIndicators(snap2.loadingIndicators);
      summary = `The app appears stuck. Loading indicators (${indicatorDesc}) have been visible throughout the ${Math.round(actualWindowMs / 1e3)}s observation window with no meaningful DOM changes and no pending network requests.`;
      suggestions.push("Try refreshing the page.");
      suggestions.push("Check the browser console for JavaScript errors.");
      suggestions.push("Check if a required backend service is running.");
    } else if (hasLoadingIndicators && !domChanged && !snap2.networkIdle) {
      verdict = "stuck";
      confidence = 0.7;
      summary = `The app appears stuck. Loading indicators are visible with no DOM changes, but ${snap2.pendingNetworkRequests} network request(s) are still in flight. A network request may be hanging.`;
      suggestions.push("Check if a network request is hanging (e.g., unresponsive API server).");
      suggestions.push("Check the network tab for requests that have been pending too long.");
      suggestions.push("Verify the server or API endpoint is reachable.");
    } else if (hadLoadingIndicators && domChanged) {
      verdict = "loading";
      confidence = 0.85;
      summary = `The app is loading. Loading indicators are visible and the DOM is actively changing (${peakMutations} recent mutations), indicating content is being rendered.`;
    } else if (!hasLoadingIndicators && hadLoadingIndicators) {
      verdict = "idle";
      confidence = 0.8;
      summary = "Loading indicators were present at the start but cleared during observation. The app has finished loading.";
    } else {
      verdict = "unknown";
      confidence = 0.4;
      summary = "The app state is ambiguous. Signals do not clearly indicate stuck, loading, or idle.";
      suggestions.push("Try running the diagnosis again with a longer observation window.");
    }
    return {
      verdict,
      confidence,
      summary,
      evidence,
      observationWindowMs: actualWindowMs,
      suggestions,
      timestamp: Date.now()
    };
  }
  captureSnapshot() {
    const compositeStatus = this.detector.getStatus();
    const loadingSig = compositeStatus.signals["loading-indicators"];
    const domSig = compositeStatus.signals["dom"];
    const networkSig = compositeStatus.signals["network"];
    const loadingStatus = loadingSig?.status;
    const domStatus = domSig?.status;
    const networkStatus = networkSig?.status;
    return {
      loadingIndicators: loadingStatus?.indicators ?? [],
      domSettled: domSig?.idle ?? true,
      recentDOMMutations: domStatus?.recentMutationCount ?? 0,
      networkIdle: networkSig?.idle ?? true,
      pendingNetworkRequests: networkStatus?.pendingCount ?? 0,
      idleScore: compositeStatus.idleScore,
      timestamp: Date.now()
    };
  }
  describeIndicators(indicators) {
    if (indicators.length === 0) return "none";
    const descriptions = indicators.slice(0, 3).map((ind) => {
      if (ind.type === "animation") return `animation "${ind.details}"`;
      if (ind.type === "cursor") return `cursor: ${ind.details}`;
      if (ind.selector) return ind.selector;
      return ind.element ?? ind.type;
    });
    const suffix = indicators.length > 3 ? ` +${indicators.length - 3} more` : "";
    return descriptions.join(", ") + suffix;
  }
};

exports.CompositeIdleDetector = CompositeIdleDetector;
exports.DOMSettlingDetector = DOMSettlingDetector;
exports.FormMutationDetector = FormMutationDetector;
exports.LoadingIndicatorDetector = LoadingIndicatorDetector;
exports.NetworkIdleDetector = NetworkIdleDetector;
exports.StuckScreenDetector = StuckScreenDetector;
exports.waitForElementStable = waitForElementStable;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map