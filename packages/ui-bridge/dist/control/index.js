'use strict';

var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/debug/click-highlight.ts
var click_highlight_exports = {};
__export(click_highlight_exports, {
  HIGHLIGHT_COLORS: () => HIGHLIGHT_COLORS,
  showClickHighlight: () => showClickHighlight,
  showElementHighlight: () => showElementHighlight
});
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
var DEFAULT_OPTIONS, HIGHLIGHT_CLASS, styleInjected, HIGHLIGHT_COLORS;
var init_click_highlight = __esm({
  "src/debug/click-highlight.ts"() {
    DEFAULT_OPTIONS = {
      color: "#00c800",
      duration: 800,
      size: 30,
      ripple: true
    };
    HIGHLIGHT_CLASS = "ui-bridge-click-highlight";
    styleInjected = false;
    HIGHLIGHT_COLORS = {
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
  }
});

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
function filterBySeverity(events, minSeverity) {
  const minRank = SEVERITY_RANK[minSeverity];
  return events.filter((event) => {
    const { severity } = classifyEvent(event);
    return SEVERITY_RANK[severity] <= minRank;
  });
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

// src/core/element-identifier.ts
function findElementByIdentifier(identifier, root = document) {
  if (typeof identifier === "string") {
    const byTestId = root.querySelector(`[data-testid="${identifier}"]`);
    if (byTestId) return byTestId;
    const byAwasId = root.querySelector(`[data-awas-element="${identifier}"]`);
    if (byAwasId) return byAwasId;
    const byId = root.querySelector(`#${CSS.escape(identifier)}`);
    if (byId) return byId;
    try {
      const bySelector = root.querySelector(identifier);
      if (bySelector) return bySelector;
    } catch {
    }
    try {
      const result = document.evaluate(
        identifier,
        root,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      if (result.singleNodeValue instanceof HTMLElement) {
        return result.singleNodeValue;
      }
    } catch {
    }
    return null;
  }
  if (identifier.testId) {
    const el = root.querySelector(`[data-testid="${identifier.testId}"]`);
    if (el) return el;
  }
  if (identifier.awasId) {
    const el = root.querySelector(`[data-awas-element="${identifier.awasId}"]`);
    if (el) return el;
  }
  if (identifier.htmlId) {
    const el = root.querySelector(`#${CSS.escape(identifier.htmlId)}`);
    if (el) return el;
  }
  if (identifier.selector) {
    try {
      const el = root.querySelector(identifier.selector);
      if (el) return el;
    } catch {
    }
  }
  if (identifier.xpath) {
    try {
      const result = document.evaluate(
        identifier.xpath,
        root,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      if (result.singleNodeValue instanceof HTMLElement) {
        return result.singleNodeValue;
      }
    } catch {
    }
  }
  return null;
}

// src/control/fill-form.ts
function fillFormFields(fields, options) {
  const results = {};
  let filledCount = 0;
  let errorCount = 0;
  const triggerValidation = options?.triggerValidation !== false;
  const clearFirst = options?.clearFirst !== false;
  for (const [fieldId, value] of Object.entries(fields)) {
    try {
      let element = findElementByIdentifier(fieldId);
      if (!element && typeof document !== "undefined") {
        try {
          element = document.querySelector(fieldId);
        } catch {
        }
      }
      if (!element) {
        results[fieldId] = { success: false, error: `Element not found: ${fieldId}` };
        errorCount++;
        continue;
      }
      fillSingleField(element, value, clearFirst);
      let validationError;
      if (triggerValidation && "reportValidity" in element) {
        const isValid = element.reportValidity();
        if (!isValid) {
          validationError = element.validationMessage || "Validation failed";
        }
      }
      results[fieldId] = { success: true, validationError };
      filledCount++;
    } catch (err) {
      results[fieldId] = {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
      errorCount++;
    }
  }
  return {
    success: errorCount === 0,
    filledCount,
    errorCount,
    fields: results
  };
}
function fillSingleField(element, value, clearFirst) {
  if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
    const checked = typeof value === "boolean" ? value : value === "true";
    if (element.checked !== checked) {
      element.focus();
      element.checked = checked;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
    }
    return;
  }
  if (element instanceof HTMLSelectElement) {
    element.focus();
    if (element.multiple && Array.isArray(value)) {
      for (const option of element.options) {
        option.selected = value.includes(option.value);
      }
    } else {
      const strValue = Array.isArray(value) ? value[0] : String(value);
      element.value = strValue;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
    return;
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const strValue = String(value);
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    element.focus();
    element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    if (clearFirst) {
      if (nativeSetter) {
        nativeSetter.call(element, "");
      } else {
        element.value = "";
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (nativeSetter) {
      nativeSetter.call(element, strValue);
    } else {
      element.value = strValue;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    return;
  }
  throw new Error(`Unsupported element type for fill: ${element.tagName.toLowerCase()}`);
}

// src/debug/error-impact.ts
var DEFAULT_NAVIGATION_CHANGE_THRESHOLD_MS = 500;
var DEFAULT_RENDER_BLOCKED_THRESHOLD = 0.2;
function extractMessage(event) {
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
        message: extractMessage(event),
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

// src/core/class-name.ts
function classString(el) {
  if (!el) return "";
  const cn = el.className;
  if (typeof cn === "string") return cn;
  const baseVal = cn?.baseVal;
  return typeof baseVal === "string" ? baseVal : "";
}

// src/ctr/types.ts
var CTR_CONFIG_VERSION = "1.0.0";
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

// src/control/action-executor.ts
var _canonicalPerformAction;
function getCanonicalPerformAction() {
  if (_canonicalPerformAction !== void 0) return _canonicalPerformAction;
  try {
    const mod = __require("@qontinui/ui-bridge-auto");
    _canonicalPerformAction = typeof mod.performAction === "function" ? mod.performAction : null;
  } catch {
    _canonicalPerformAction = null;
  }
  return _canonicalPerformAction;
}
function hasNestedQuantifiers(pattern) {
  return /(\((?:[^()]*[+*}])[^()]*\))[+*?]|\(\?:[^()]*[+*}][^()]*\)[+*?]/.test(pattern);
}
var SUPPORTED_ACTIONS = /* @__PURE__ */ new Set([
  "click",
  "doubleClick",
  "rightClick",
  "middleClick",
  "type",
  "sendKeys",
  "clear",
  "select",
  "focus",
  "blur",
  "hover",
  "scroll",
  "scrollIntoView",
  "check",
  "uncheck",
  "toggle",
  "drag",
  "setValue",
  "submit",
  "reset",
  "autocomplete"
]);
var DEFAULT_WAIT_OPTIONS = {
  visible: true,
  enabled: true,
  focused: false,
  state: {},
  timeout: 1e4,
  interval: 100
};
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
  const rawText = element.textContent?.trim();
  if (rawText) {
    state.textContent = rawText.replace(/\s+/g, " ").slice(0, 500);
  }
  if (!state.textContent) {
    state.textContent = element.getAttribute("aria-label") || element.getAttribute("title") || void 0;
  }
  const opacityVal = parseFloat(style.opacity);
  if (opacityVal === 0) {
    state.opacityHidden = true;
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
  return rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
}
function isDisabled(element) {
  if ("disabled" in element && element.disabled) return true;
  if (element.getAttribute("aria-disabled") === "true") return true;
  return false;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function createMouseEvent(type, element, options) {
  const rect = element.getBoundingClientRect();
  const x = options?.position?.x ?? rect.width / 2;
  const y = options?.position?.y ?? rect.height / 2;
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    button: options?.button === "right" ? 2 : options?.button === "middle" ? 1 : 0,
    clientX: rect.left + x,
    clientY: rect.top + y
  });
}
function elementFromPointSafe(x, y) {
  if (typeof document.elementFromPoint === "function") {
    return document.elementFromPoint(x, y);
  }
  return null;
}
function createMouseEventAt(type, clientX, clientY) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY
  });
}
var MUTATION_ACTIONS = /* @__PURE__ */ new Set([
  "type",
  "sendKeys",
  "clear",
  "setValue",
  "select",
  "check",
  "uncheck",
  "toggle",
  "submit",
  "reset",
  "autocomplete"
]);
var STATE_ACTIONS = /* @__PURE__ */ new Set(["focus", "blur"]);
function pickRefreshFields(action, state) {
  if (MUTATION_ACTIONS.has(action)) {
    const updates = {
      visible: state.visible,
      enabled: state.enabled,
      focused: state.focused
    };
    if (state.value !== void 0) updates.value = state.value;
    if (state.checked !== void 0) updates.checked = state.checked;
    if (state.selectedOptions !== void 0) updates.selectedOptions = state.selectedOptions;
    if (state.availableOptions !== void 0) updates.availableOptions = state.availableOptions;
    if (state.textContent !== void 0) updates.textContent = state.textContent;
    if (state.ariaChecked !== void 0) updates.ariaChecked = state.ariaChecked;
    if (state.ariaPressed !== void 0) updates.ariaPressed = state.ariaPressed;
    if (state.ariaExpanded !== void 0) updates.ariaExpanded = state.ariaExpanded;
    if (state.ariaSelected !== void 0) updates.ariaSelected = state.ariaSelected;
    if (state.validationState !== void 0) updates.validationState = state.validationState;
    return updates;
  }
  if (STATE_ACTIONS.has(action)) {
    return { focused: state.focused };
  }
  return void 0;
}
var DefaultActionExecutor = class {
  constructor(registry, consoleCapture, options) {
    this.registry = registry;
    this.consoleCapture = consoleCapture;
    /**
     * Cache of DOM elements found during discover/find that aren't in the
     * registry.  Keyed by the deterministic ID returned to the caller so that
     * a subsequent executeAction(id, …) can resolve the same element.
     * Cleared at the start of each find() call so stale references don't
     * accumulate.
     */
    this.discoveryCache = /* @__PURE__ */ new Map();
    this.maxDiscoveryCacheSize = options?.maxDiscoveryCacheSize ?? 500;
    if (typeof document !== "undefined") {
      this.impactAssessor = new ErrorImpactAssessor({
        captureUIState: () => this.captureUIStateSnapshot()
      });
    }
  }
  /**
   * Set the idle detector for waitAfter support on actions.
   */
  setIdleDetector(detector) {
    this.idleDetector = detector;
  }
  /**
   * Evict oldest entries from the discovery cache when it exceeds the size limit.
   * Map iterates in insertion order, so the first entries are the oldest.
   */
  evictDiscoveryCache() {
    if (this.discoveryCache.size <= this.maxDiscoveryCacheSize) return;
    const excess = this.discoveryCache.size - this.maxDiscoveryCacheSize;
    const iter = this.discoveryCache.keys();
    for (let i = 0; i < excess; i++) {
      const key = iter.next().value;
      if (key !== void 0) this.discoveryCache.delete(key);
    }
  }
  /**
   * Capture a lightweight UI state snapshot for error impact assessment.
   */
  captureUIStateSnapshot() {
    const allElements = this.registry.getAllElements();
    const elementIds = /* @__PURE__ */ new Set();
    const disabledIds = /* @__PURE__ */ new Set();
    const errorBoundaryElements = /* @__PURE__ */ new Set();
    for (const el of allElements) {
      elementIds.add(el.id);
      if (el.element) {
        if (isDisabled(el.element)) {
          disabledIds.add(el.id);
        }
        if (el.element.getAttribute("role") === "alert" || el.element.dataset.errorBoundary !== void 0 || el.element.classList.contains("error-boundary")) {
          errorBoundaryElements.add(el.id);
        }
      }
    }
    return {
      elementIds,
      disabledIds,
      errorBoundaryElements,
      url: typeof window !== "undefined" ? window.location.href : "",
      timestamp: Date.now()
    };
  }
  /**
   * Execute an action on an element
   */
  async executeAction(elementId, request) {
    const startTime = performance.now();
    let waitDurationMs = 0;
    const actionName = request.action;
    if (!SUPPORTED_ACTIONS.has(actionName)) {
      const registered = this.registry.getElement(elementId);
      const isCtrTarget = !registered && getGlobalCtr().has(elementId);
      if (!registered?.customActions?.[actionName] && !isCtrTarget) {
        return {
          success: false,
          error: `Unsupported action: '${actionName}'. Supported: ${Array.from(SUPPORTED_ACTIONS).join(", ")}`,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId
        };
      }
    }
    try {
      const registered = this.registry.getElement(elementId);
      let element = registered?.element ?? null;
      if (element && !element.isConnected) {
        element = null;
      }
      if (!element) {
        element = findElementByIdentifier(elementId);
      }
      if (!element) {
        const ctr = getGlobalCtr();
        if (ctr.has(elementId)) {
          const result2 = ctr.resolveInDOM(elementId);
          if (result2.resolved && result2.element) {
            element = result2.element;
          }
        }
      }
      if (!element) {
        const cached = this.discoveryCache.get(elementId);
        if (cached && cached.isConnected) {
          element = cached;
        } else if (cached) {
          this.discoveryCache.delete(elementId);
        }
      }
      if (!element && request.action === "scroll") {
        const sentinel = elementId.toLowerCase();
        if (sentinel === "document" || sentinel === "body" || sentinel === "window") {
          element = document.documentElement;
        }
      }
      if (!element) {
        const wasRegistered = this.registry.getElement(elementId);
        const wasInCache = this.discoveryCache.has(elementId);
        let hint;
        if (wasRegistered && !wasRegistered.element?.isConnected) {
          hint = `Element '${elementId}' was registered but is no longer in the DOM (component may have unmounted). Try re-discovering with find() or navigate to the page containing this element.`;
        } else if (wasInCache) {
          hint = `Element '${elementId}' was previously discovered but its DOM node was detached. Run find() again to get a fresh reference.`;
        } else {
          hint = `Element '${elementId}' was never registered or discovered. Check the ID is correct, ensure the page containing it is mounted, or use find()/discover() to locate it first.`;
        }
        return {
          success: false,
          error: `Element not found: ${elementId}. ${hint}`,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId
        };
      }
      if (request.waitOptions) {
        const waitResult = await this.waitForElement(element, request.waitOptions);
        waitDurationMs = waitResult.waitedMs;
        if (!waitResult.met) {
          return {
            success: false,
            error: waitResult.error || "Wait condition not met",
            durationMs: performance.now() - startTime,
            timestamp: Date.now(),
            requestId: request.requestId,
            waitDurationMs
          };
        }
      }
      const actionStartTime = Date.now();
      const eventsBefore = this.consoleCapture ? this.consoleCapture.getRecent(100) : [];
      const fingerprintsBefore = new Set(eventsBefore.map(computeFingerprint));
      this.impactAssessor?.captureBeforeState();
      let actionParams = request.params;
      if (request.action === "drag") {
        const req = request;
        const dragRootFields = {};
        for (const key of [
          "targetPosition",
          "target",
          "targetOffset",
          "sourceOffset",
          "steps",
          "holdDelay",
          "releaseDelay",
          "html5"
        ]) {
          if (req[key] !== void 0) {
            dragRootFields[key] = req[key];
          }
        }
        if (Object.keys(dragRootFields).length > 0) {
          actionParams = { ...dragRootFields, ...request.params };
        }
      }
      const result = await this.performAction(element, request.action, actionParams);
      try {
        const { showElementHighlight: showElementHighlight2, HIGHLIGHT_COLORS: HIGHLIGHT_COLORS2 } = await Promise.resolve().then(() => (init_click_highlight(), click_highlight_exports));
        const highlightAction = request.action;
        const color = HIGHLIGHT_COLORS2[highlightAction] ?? HIGHLIGHT_COLORS2.click;
        showElementHighlight2(element, { color, duration: 600 });
      } catch {
      }
      let consoleErrors;
      let browserEvents;
      let errorDiff;
      let errorImpact;
      if (this.consoleCapture) {
        await sleep(50);
        const errors = this.consoleCapture.getConsoleSince(actionStartTime);
        if (errors.length > 0) consoleErrors = errors;
        const allEventsSince = this.consoleCapture.getSince(actionStartTime);
        if (allEventsSince.length > 0) {
          const significantEvents = filterBySeverity(allEventsSince, "warning");
          if (significantEvents.length > 0) {
            browserEvents = enrichEvents(significantEvents);
          }
        }
        const eventsAfter = this.consoleCapture.getRecent(100);
        errorDiff = computeActionErrorDiff(fingerprintsBefore, eventsBefore, eventsAfter);
        if (this.impactAssessor && errorDiff && errorDiff.newErrors.length > 0) {
          const topNewError = errorDiff.newErrors[0];
          errorImpact = this.impactAssessor.assessImpact(topNewError.event);
        }
      }
      let idleWaitMs;
      if (request.waitAfter && this.idleDetector) {
        const idleWaitStart = performance.now();
        const waitTimeout = request.waitAfterTimeout ?? 1e4;
        const waitMinStable = request.waitAfterMinStable ?? 300;
        try {
          await this.waitAfterAction(request.waitAfter, waitTimeout, waitMinStable);
        } catch {
        }
        idleWaitMs = performance.now() - idleWaitStart;
      }
      const elementState = getElementState(element);
      try {
        const refreshUpdates = pickRefreshFields(request.action, elementState);
        if (refreshUpdates && this.registry.refreshElement) {
          this.registry.refreshElement(elementId, refreshUpdates);
        }
      } catch {
      }
      return {
        success: true,
        elementState,
        result,
        consoleErrors,
        browserEvents,
        errorDiff,
        errorImpact,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
        waitDurationMs,
        idleWaitMs
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId,
        waitDurationMs
      };
    }
  }
  /**
   * Execute an action on a component
   */
  async executeComponentAction(componentId, request) {
    const startTime = performance.now();
    try {
      const component = this.registry.getComponent(componentId);
      if (!component) {
        return {
          success: false,
          error: `Component "${componentId}" not found. Components are only available when their page is active.`,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId
        };
      }
      const action = component.actions.find((a) => a.id === request.action);
      if (!action) {
        return {
          success: false,
          error: `Action not found: ${request.action}`,
          durationMs: performance.now() - startTime,
          timestamp: Date.now(),
          requestId: request.requestId
        };
      }
      const result = await action.handler(request.params);
      return {
        success: true,
        result,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
        requestId: request.requestId
      };
    }
  }
  /**
   * Wait for a condition on an element
   */
  async waitFor(elementId, options) {
    const registered = this.registry.getElement(elementId);
    let element = registered?.element ?? null;
    if (!element) {
      element = findElementByIdentifier(elementId);
    }
    if (!element) {
      return {
        met: false,
        waitedMs: 0,
        error: `Element not found: ${elementId}`
      };
    }
    return this.waitForElement(element, options);
  }
  /**
   * Find controllable elements
   */
  async find(options) {
    this.discoveryCache.clear();
    const startTime = performance.now();
    const elements = [];
    let root = document.body;
    if (options?.root) {
      const rootEl = document.querySelector(options.root);
      if (rootEl) root = rootEl;
    }
    if (!options?.contentOnly) {
      const interactiveSelectors = [
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
      const selector = options?.selector || interactiveSelectors.join(", ");
      const foundElements = root.querySelectorAll(selector);
      for (const el of foundElements) {
        if (options?.limit && elements.length >= options.limit) break;
        const state = getElementState(el);
        if (!options?.includeHidden && !state.visible) continue;
        if (options?.types) {
          const type = this.inferElementType(el);
          if (!options.types.includes(type)) continue;
        }
        if (options?.element_type) {
          const type = this.inferElementType(el);
          if (type !== options.element_type) continue;
        }
        if (options?.role) {
          const roleLc = options.role.toLowerCase();
          const elRole = el.getAttribute("role")?.toLowerCase();
          const inferredType = this.inferElementType(el).toLowerCase();
          if (elRole !== roleLc && inferredType !== roleLc) continue;
        }
        if (options?.text) {
          const searchText = options.text.toLowerCase();
          const label = this.getElementLabel(el)?.toLowerCase() || "";
          const textContent = (state.textContent || "").toLowerCase();
          const accessibleName = this.getAccessibleName(el)?.toLowerCase() || "";
          if (!label.includes(searchText) && !textContent.includes(searchText) && !accessibleName.includes(searchText)) {
            continue;
          }
        }
        if (options?.label) {
          const labelLc = options.label.toLowerCase();
          const elLabel = (this.getElementLabel(el) || "").toLowerCase();
          if (!elLabel.includes(labelLc)) continue;
        }
        if (options?.exact_text) {
          const exactLc = options.exact_text.toLowerCase();
          const elLabel = (this.getElementLabel(el) || "").toLowerCase();
          const elText = (state.textContent || "").trim().toLowerCase();
          if (elLabel !== exactLc && elText !== exactLc) continue;
        }
        if (options?.interactiveOnly) {
          const interactiveTypes = /* @__PURE__ */ new Set([
            "button",
            "input",
            "select",
            "textarea",
            "link",
            "checkbox",
            "radio"
          ]);
          const elType = this.inferElementType(el);
          const elActions = this.inferActions(el);
          if (!interactiveTypes.has(elType) && elActions.length === 0) continue;
        }
        const registered = this.registry.findByDOMElement(el);
        const id = registered?.id || this.getElementId(el);
        if (!registered) {
          this.discoveryCache.set(id, el);
          this.evictDiscoveryCache();
        }
        elements.push({
          id,
          type: registered?.type || this.inferElementType(el),
          label: registered?.label || this.getElementLabel(el),
          tagName: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || void 0,
          accessibleName: this.getAccessibleName(el),
          actions: registered?.actions || this.inferActions(el),
          state,
          registered: !!registered,
          category: registered?.category || "interactive",
          className: classString(el) || void 0,
          classes: el.classList?.length > 0 ? Array.from(el.classList) : void 0,
          contentMetadata: registered?.contentMetadata
        });
      }
    }
    if (options?.includeContent || options?.contentOnly || options?.interactiveOnly === false) {
      const contentElements = this.registry.getAllContentElements();
      for (const el of contentElements) {
        if (options?.limit && elements.length >= options.limit) break;
        const state = el.getState();
        if (!options?.includeHidden && !state.visible) continue;
        if (options?.contentRole && el.contentMetadata?.contentRole !== options.contentRole) {
          continue;
        }
        if (options?.label) {
          const labelLc = options.label.toLowerCase();
          const elLabel = (el.label || "").toLowerCase();
          if (!elLabel.includes(labelLc)) continue;
        }
        if (options?.exact_text) {
          const exactLc = options.exact_text.toLowerCase();
          const elLabel = (el.label || "").toLowerCase();
          const elText = (state.textContent || "").trim().toLowerCase();
          if (elLabel !== exactLc && elText !== exactLc) continue;
        }
        elements.push({
          id: el.id,
          type: el.type,
          label: el.label,
          tagName: el.element.tagName.toLowerCase(),
          role: el.element.getAttribute("role") || void 0,
          accessibleName: el.label || state.textContent?.trim(),
          actions: [],
          state,
          registered: true,
          category: "content",
          className: classString(el.element) || void 0,
          classes: el.element.classList?.length > 0 ? Array.from(el.element.classList) : void 0,
          contentMetadata: el.contentMetadata
        });
      }
    }
    if (options?.includeMedia || options?.mediaOnly) {
      const mediaElements = this.registry.getAllMediaElements();
      for (const el of mediaElements) {
        if (options?.limit && elements.length >= options.limit) break;
        const state = el.getState();
        if (!options?.includeHidden && !state.visible) continue;
        const meta = el.mediaMetadata;
        if (options?.mediaType && meta?.mediaType !== options.mediaType) continue;
        if (options?.brokenOnly && meta?.loadingState !== "error") continue;
        if (options?.missingAltOnly) {
          if (meta?.altText !== void 0 && meta?.altText !== null) continue;
          if (meta?.isDecorative) continue;
        }
        if (options?.srcPattern && meta?.src) {
          if (options.srcPattern.length > 200 || hasNestedQuantifiers(options.srcPattern)) {
            if (!meta.src.includes(options.srcPattern)) continue;
          } else {
            try {
              const regex = new RegExp(options.srcPattern);
              if (!regex.test(meta.src)) continue;
            } catch {
              if (!meta.src.includes(options.srcPattern)) continue;
            }
          }
        }
        if (options?.oversizeThreshold && meta?.oversizeRatio) {
          if (meta.oversizeRatio < options.oversizeThreshold) continue;
        }
        if (options?.label) {
          const labelLc = options.label.toLowerCase();
          const elLabel = (el.label || "").toLowerCase();
          if (!elLabel.includes(labelLc)) continue;
        }
        if (options?.exact_text) {
          const exactLc = options.exact_text.toLowerCase();
          const elLabel = (el.label || "").toLowerCase();
          const altText = (meta?.altText || "").toLowerCase();
          if (elLabel !== exactLc && altText !== exactLc) continue;
        }
        elements.push({
          id: el.id,
          type: el.type,
          label: el.label,
          tagName: el.element.tagName.toLowerCase(),
          role: el.element.getAttribute("role") || void 0,
          accessibleName: el.label || meta?.altText,
          actions: [],
          state,
          registered: true,
          category: "media",
          className: classString(el.element) || void 0,
          classes: el.element.classList?.length > 0 ? Array.from(el.element.classList) : void 0,
          mediaMetadata: meta
        });
      }
    }
    return {
      elements,
      total: elements.length,
      durationMs: performance.now() - startTime,
      timestamp: Date.now()
    };
  }
  /**
   * Discover controllable elements
   * @deprecated Use find() instead
   */
  async discover(options) {
    return this.find(options);
  }
  /**
   * Get control snapshot
   */
  async getSnapshot() {
    const elements = this.registry.getAllElements();
    const components = this.registry.getAllComponents();
    const workflows = this.registry.getAllWorkflows();
    return {
      timestamp: Date.now(),
      elements: elements.map((el) => ({
        id: el.id,
        type: el.type,
        label: el.label,
        actions: [...el.actions, ...el.customActions ? Object.keys(el.customActions) : []],
        state: el.getState(),
        category: el.category,
        contentMetadata: el.contentMetadata,
        mediaMetadata: el.mediaMetadata
      })),
      components: components.map((comp) => ({
        id: comp.id,
        name: comp.name,
        actions: comp.actions.map((a) => a.id)
      })),
      workflows: workflows.map((wf) => ({
        id: wf.id,
        name: wf.name,
        stepCount: wf.steps.length
      })),
      activeRuns: []
      // Workflow engine manages this
    };
  }
  /**
   * Fill multiple form fields atomically.
   *
   * For each field entry, finds the element by registered ID or DOM query,
   * sets the value based on element type, dispatches proper events, and
   * optionally triggers validation.
   */
  async fillForm(request) {
    const fields = {};
    let filledCount = 0;
    let errorCount = 0;
    const triggerValidation = request.triggerValidation !== false;
    const clearFirst = request.clearFirst !== false;
    for (const [fieldId, value] of Object.entries(request.fields)) {
      try {
        const registered = this.registry.getElement(fieldId);
        let element = registered?.element ?? null;
        if (!element) {
          element = findElementByIdentifier(fieldId);
        }
        if (!element) {
          fields[fieldId] = { success: false, error: `Element not found: ${fieldId}` };
          errorCount++;
          continue;
        }
        fillSingleField(element, value, clearFirst);
        let validationError;
        if (triggerValidation && "reportValidity" in element) {
          const isValid = element.reportValidity();
          if (!isValid) {
            validationError = element.validationMessage || "Validation failed";
          }
        }
        fields[fieldId] = { success: true, validationError };
        filledCount++;
      } catch (err) {
        fields[fieldId] = {
          success: false,
          error: err instanceof Error ? err.message : String(err)
        };
        errorCount++;
      }
    }
    return {
      success: errorCount === 0,
      filledCount,
      errorCount,
      fields
    };
  }
  /**
   * Wait for element conditions
   */
  async waitForElement(element, options) {
    const opts = { ...DEFAULT_WAIT_OPTIONS, ...options };
    const startTime = performance.now();
    const deadline = startTime + opts.timeout;
    while (performance.now() < deadline) {
      const state = getElementState(element);
      let allMet = true;
      if (opts.visible && !state.visible) allMet = false;
      if (opts.enabled && !state.enabled) allMet = false;
      if (opts.focused && !state.focused) allMet = false;
      if (opts.state) {
        for (const [key, value] of Object.entries(opts.state)) {
          if (state[key] !== value) {
            allMet = false;
            break;
          }
        }
      }
      if (allMet) {
        return {
          met: true,
          waitedMs: performance.now() - startTime,
          state
        };
      }
      await sleep(opts.interval);
    }
    return {
      met: false,
      waitedMs: performance.now() - startTime,
      state: getElementState(element),
      error: `Timeout waiting for conditions after ${opts.timeout}ms`
    };
  }
  /**
   * Wait for idle after an action based on the waitAfter specification.
   */
  async waitAfterAction(waitAfter, timeout, minStableMs) {
    if (!this.idleDetector) return;
    if (waitAfter === "idle") {
      await this.idleDetector.waitForIdle({ timeout, minStableMs });
    } else if (typeof waitAfter === "string") {
      await this.idleDetector.waitForSignal(waitAfter, { timeout, minStableMs });
    } else if (Array.isArray(waitAfter)) {
      await this.idleDetector.waitFor(waitAfter, { timeout, minStableMs });
    } else if ("indicator" in waitAfter) {
      await this.idleDetector.waitFor([waitAfter], { timeout, minStableMs });
    }
  }
  /**
   * Perform an action on an element
   */
  async performAction(element, action, params) {
    const canonical = getCanonicalPerformAction();
    if (canonical) {
      const enriched = action === "drag" && params && !("resolveElement" in params) ? {
        ...params,
        resolveElement: (id) => {
          const reg = this.registry.getElement(id);
          return reg?.element ?? findElementByIdentifier(id);
        }
      } : params;
      return canonical(element, action, enriched);
    }
    const computedStyle = window.getComputedStyle(element);
    if (parseFloat(computedStyle.opacity) === 0 && element.parentElement) {
      this.performHover(element.parentElement);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    switch (action) {
      case "click":
        return this.performClick(element, params);
      case "doubleClick":
        return this.performDoubleClick(element, params);
      case "rightClick":
        return this.performRightClick(element, params);
      case "middleClick":
        return this.performMiddleClick(element, params);
      case "type":
        return this.performType(element, params);
      case "sendKeys":
        return this.performSendKeys(element, params);
      case "clear":
        return this.performClear(element);
      case "select":
        return this.performSelect(element, params);
      case "focus":
        return this.performFocus(element);
      case "blur":
        return this.performBlur(element);
      case "hover":
        return this.performHover(element);
      case "scroll":
        return this.performScroll(element, params);
      case "scrollIntoView": {
        const scrollParams = params;
        return element.scrollIntoView({
          behavior: scrollParams?.smooth ? "smooth" : "auto",
          block: scrollParams?.block || "center",
          inline: scrollParams?.inline || "nearest"
        });
      }
      case "check":
        return this.performCheck(element, true);
      case "uncheck":
        return this.performCheck(element, false);
      case "toggle":
        return this.performToggle(element);
      case "drag":
        return this.performDrag(element, params);
      case "setValue":
        return this.performSetValue(element, params);
      case "autocomplete":
        return this.performAutocomplete(
          element,
          params
        );
      case "submit":
        return this.performSubmit(element);
      case "reset":
        return this.performReset(element);
      default: {
        const registered = this.registry.findByDOMElement(element);
        if (registered?.customActions?.[action]) {
          return registered.customActions[action].handler(params);
        }
        throw new Error(`Unknown action: ${action}`);
      }
    }
  }
  performClick(element, options) {
    element.dispatchEvent(createMouseEvent("mousedown", element, options));
    element.dispatchEvent(createMouseEvent("mouseup", element, options));
    element.click();
    const anchor = element.closest("a");
    if (anchor && anchor !== element && anchor.hasAttribute("href")) {
      anchor.click();
    }
  }
  performDoubleClick(element, options) {
    this.performClick(element, options);
    this.performClick(element, options);
    element.dispatchEvent(createMouseEvent("dblclick", element, options));
  }
  performRightClick(element, options) {
    const opts = { ...options, button: "right" };
    element.dispatchEvent(createMouseEvent("mousedown", element, opts));
    element.dispatchEvent(createMouseEvent("mouseup", element, opts));
    element.dispatchEvent(createMouseEvent("contextmenu", element, opts));
  }
  performMiddleClick(element, options) {
    const opts = { ...options, button: "middle" };
    element.dispatchEvent(createMouseEvent("mousedown", element, opts));
    element.dispatchEvent(createMouseEvent("mouseup", element, opts));
    element.dispatchEvent(createMouseEvent("auxclick", element, opts));
  }
  async performType(element, options) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new Error("Type action requires an input or textarea element");
    }
    const optsAsRecord = options;
    if (typeof options?.text !== "string") {
      const hasValueAlias = optsAsRecord != null && typeof optsAsRecord["value"] === "string";
      const hint = hasValueAlias ? " Got `value` \u2014 the `type` action expects `text` instead. (Tip: `select`/`setValue` use `value`, but `type` uses `text`.)" : "";
      throw new Error(
        `Type action requires a 'text' string parameter (the characters to type into the field).${hint}`
      );
    }
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const el = element;
    const reactPropsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    const reactProps = reactPropsKey ? el[reactPropsKey] : void 0;
    const notifyReact = (oldValue) => {
      const tracker = element._valueTracker;
      if (tracker) tracker.setValue(oldValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      if (reactProps?.onChange && typeof reactProps.onChange === "function") {
        const syntheticEvent = {
          target: element,
          currentTarget: element,
          type: "change",
          bubbles: true,
          preventDefault: () => {
          },
          stopPropagation: () => {
          },
          nativeEvent: new Event("input")
        };
        reactProps.onChange(syntheticEvent);
      }
    };
    element.focus();
    if (options?.clear) {
      const prevClear = element.value;
      if (nativeSetter) {
        nativeSetter.call(element, "");
      } else {
        element.value = "";
      }
      notifyReact(prevClear);
    }
    const text = options?.text || "";
    const delay = options?.delay || 0;
    for (const char of text) {
      const current = element.value;
      if (nativeSetter) {
        nativeSetter.call(element, current + char);
      } else {
        element.value = current + char;
      }
      if (options?.triggerEvents !== false) {
        notifyReact(current);
      }
      if (delay > 0) {
        await sleep(delay);
      }
    }
    if (options?.triggerEvents !== false) {
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  /**
   * Dispatch real KeyboardEvent sequences on an element.
   *
   * For each key descriptor, fires keydown → keypress → keyup (keypress is
   * skipped for non-printable keys like Enter, Escape, Arrow*, etc.).
   * This is the correct way to interact with elements that consume raw
   * keyboard events (xterm.js terminals, CodeMirror, Monaco, canvas games).
   */
  async performSendKeys(element, options) {
    if (!Array.isArray(options?.keys) || options.keys.length === 0) {
      throw new Error(
        "sendKeys action requires a non-empty 'keys' array of {key: '<KeyName>', modifiers?} descriptors. (Example: { keys: [{ key: 'Enter' }] }.)"
      );
    }
    element.focus();
    const delay = options.delay || 0;
    const NON_PRINTABLE = /* @__PURE__ */ new Set([
      "Enter",
      "Tab",
      "Escape",
      "Backspace",
      "Delete",
      "Insert",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      "F6",
      "F7",
      "F8",
      "F9",
      "F10",
      "F11",
      "F12",
      "Control",
      "Shift",
      "Alt",
      "Meta",
      "CapsLock",
      "NumLock",
      "ScrollLock"
    ]);
    for (const keyDesc of options.keys) {
      const { key } = keyDesc;
      if (!key || typeof key !== "string") continue;
      const mods = keyDesc.modifiers || {};
      const eventInit = {
        key,
        code: this.keyToCode(key),
        bubbles: true,
        cancelable: true,
        ctrlKey: mods.ctrl || false,
        shiftKey: mods.shift || false,
        altKey: mods.alt || false,
        metaKey: mods.meta || false
      };
      element.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      const isInputElement = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      if (key.length === 1 && !NON_PRINTABLE.has(key) && !mods.ctrl && !mods.alt && !mods.meta) {
        element.dispatchEvent(new KeyboardEvent("keypress", eventInit));
        if (isInputElement) {
          const start = element.selectionStart ?? element.value.length;
          const end = element.selectionEnd ?? start;
          element.value = element.value.slice(0, start) + key + element.value.slice(end);
          element.selectionStart = element.selectionEnd = start + 1;
          element.dispatchEvent(
            new InputEvent("input", { bubbles: true, data: key, inputType: "insertText" })
          );
        }
      } else if (key === "Backspace" && isInputElement && !mods.ctrl && !mods.alt && !mods.meta) {
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? start;
        if (start !== end) {
          element.value = element.value.slice(0, start) + element.value.slice(end);
          element.selectionStart = element.selectionEnd = start;
        } else if (start > 0) {
          element.value = element.value.slice(0, start - 1) + element.value.slice(start);
          element.selectionStart = element.selectionEnd = start - 1;
        }
        element.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })
        );
      } else if (key === "Delete" && isInputElement && !mods.ctrl && !mods.alt && !mods.meta) {
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? start;
        if (start !== end) {
          element.value = element.value.slice(0, start) + element.value.slice(end);
          element.selectionStart = element.selectionEnd = start;
        } else if (start < element.value.length) {
          element.value = element.value.slice(0, start) + element.value.slice(start + 1);
          element.selectionStart = element.selectionEnd = start;
        }
        element.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "deleteContentForward" })
        );
      }
      element.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }
  /**
   * Map a key name to a KeyboardEvent.code value.
   */
  keyToCode(key) {
    if (!key || typeof key !== "string") return "";
    if (key.length === 1) {
      const upper = key.toUpperCase();
      if (upper >= "A" && upper <= "Z") return `Key${upper}`;
      if (upper >= "0" && upper <= "9") return `Digit${upper}`;
    }
    const codeMap = {
      Enter: "Enter",
      Tab: "Tab",
      Escape: "Escape",
      Backspace: "Backspace",
      Delete: "Delete",
      " ": "Space",
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight"
    };
    return codeMap[key] || key;
  }
  performClear(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const previousValue = element.value;
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(element, "");
      } else {
        element.value = "";
      }
      const tracker = element._valueTracker;
      if (tracker) tracker.setValue(previousValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      const el = element;
      const reactPropsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
      const reactProps = reactPropsKey ? el[reactPropsKey] : void 0;
      if (reactProps?.onChange && typeof reactProps.onChange === "function") {
        reactProps.onChange({
          target: element,
          currentTarget: element,
          type: "change",
          bubbles: true,
          preventDefault: () => {
          },
          stopPropagation: () => {
          },
          nativeEvent: new Event("input")
        });
      }
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  async performSelect(element, options) {
    if (options?.value === void 0 || options.value === null) {
      throw new Error(
        "select action requires a 'value' parameter (string or string[]) \u2014 the option value(s) to select."
      );
    }
    if (!(element instanceof HTMLSelectElement)) {
      const role = element.getAttribute("role");
      if (role === "combobox" || element.hasAttribute("aria-expanded")) {
        await this.performComboboxSelect(element, options);
        return;
      }
      throw new Error(
        `Cannot select on ${element.tagName}. Use a <select> element or a combobox (role="combobox").`
      );
    }
    const values = Array.isArray(options?.value) ? options.value : [options?.value];
    const previousValue = element.value;
    if (!options?.additive) {
      for (const option of element.options) {
        option.selected = false;
      }
    }
    let selectedValue;
    for (const option of element.options) {
      const matchValue = options?.byLabel ? option.text : option.value;
      if (values.includes(matchValue)) {
        option.selected = true;
        selectedValue = option.value;
      }
    }
    const tracker = element._valueTracker;
    if (tracker) {
      tracker.setValue(previousValue);
    }
    const el = element;
    const reactPropsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    if (reactPropsKey) {
      const props = el[reactPropsKey];
      if (props?.onChange && typeof props.onChange === "function") {
        const syntheticEvent = {
          target: element,
          currentTarget: element,
          type: "change",
          bubbles: true,
          preventDefault: () => {
          },
          stopPropagation: () => {
          },
          nativeEvent: new Event("change")
        };
        props.onChange(syntheticEvent);
        return;
      }
    }
    if (selectedValue !== void 0) {
      const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )?.set;
      if (nativeSelectValueSetter) {
        nativeSelectValueSetter.call(element, selectedValue);
      }
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  /**
   * Handle select on combobox elements (Radix, headless UI, MUI, Select2, Ant Design, etc.)
   * Strategy: click to open → find listbox/dropdown → find option → click option
   */
  performComboboxSelect(element, options) {
    const targetValue = Array.isArray(options?.value) ? options.value[0] : options?.value;
    if (!targetValue) {
      throw new Error("Select action on combobox requires a value");
    }
    element.click();
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 5;
      const attemptInterval = 50;
      const tryFindOption = () => {
        attempts++;
        const dropdown = this.findOpenDropdown(element);
        if (!dropdown && attempts < maxAttempts) {
          setTimeout(tryFindOption, attemptInterval);
          return;
        }
        if (!dropdown) {
          console.warn(
            `[ui-bridge] performComboboxSelect: dropdown not found after ${maxAttempts} attempts for value "${targetValue}"`
          );
          resolve();
          return;
        }
        const matched = this.findDropdownOption(dropdown, targetValue, options?.byLabel);
        if (matched) {
          matched.click();
        } else {
          console.warn(
            `[ui-bridge] performComboboxSelect: option "${targetValue}" not found in dropdown`
          );
        }
        resolve();
      };
      requestAnimationFrame(tryFindOption);
    });
  }
  /**
   * Find the open dropdown/listbox associated with an element.
   * Supports: ARIA listbox, Radix, MUI, Select2, Ant Design, Headless UI.
   */
  findOpenDropdown(trigger) {
    const listboxId = trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns");
    if (listboxId) {
      const el = document.getElementById(listboxId);
      if (el) return el;
    }
    const radixListbox = document.querySelector(
      '[data-radix-popper-content-wrapper] [role="listbox"], [data-state="open"] [role="listbox"]'
    );
    if (radixListbox) return radixListbox;
    const ariaListbox = document.querySelector('[role="listbox"]');
    if (ariaListbox) return ariaListbox;
    const muiListbox = document.querySelector(
      '.MuiPopover-root [role="listbox"], .MuiPopper-root [role="listbox"], .MuiMenu-list'
    );
    if (muiListbox) return muiListbox;
    const select2Dropdown = document.querySelector(
      ".select2-container--open .select2-results__options"
    );
    if (select2Dropdown) return select2Dropdown;
    const antDropdown = document.querySelector(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden)"
    );
    if (antDropdown) return antDropdown;
    const headlessListbox = document.querySelector(
      '[data-headlessui-state~="open"] [role="listbox"]'
    );
    if (headlessListbox) return headlessListbox;
    const generic = document.querySelector('[role="menu"][data-state="open"], .dropdown-menu.show');
    return generic;
  }
  /**
   * Find a matching option element within a dropdown container.
   * Handles various option patterns across frameworks.
   */
  findDropdownOption(dropdown, targetValue, byLabel) {
    const targetLower = targetValue.toLowerCase();
    const optionSelectors = [
      '[role="option"]',
      // ARIA standard
      ".ant-select-item-option",
      // Ant Design
      ".select2-results__option",
      // Select2
      ".MuiMenuItem-root",
      // MUI
      '[data-headlessui-state] [role="option"]',
      // Headless UI
      "li[data-value]"
      // Generic data-value
    ];
    for (const selector of optionSelectors) {
      const options = dropdown.querySelectorAll(selector);
      if (options.length === 0) continue;
      for (const opt of options) {
        const optDataValue = opt.getAttribute("data-value") ?? "";
        const optText = opt.textContent?.trim() ?? "";
        if (byLabel || !optDataValue) {
          if (optText === targetValue || optText.toLowerCase() === targetLower) {
            return opt;
          }
        } else {
          if (optDataValue === targetValue || optDataValue.toLowerCase() === targetLower) {
            return opt;
          }
        }
        const ariaLabel = opt.getAttribute("aria-label");
        if (ariaLabel && ariaLabel.toLowerCase() === targetLower) {
          return opt;
        }
      }
    }
    return null;
  }
  /**
   * Handle autocomplete inputs: type search text, wait for suggestions,
   * then click the matching suggestion.
   */
  async performAutocomplete(element, options) {
    if (!options?.searchText) {
      throw new Error("Autocomplete action requires searchText parameter");
    }
    const timeout = options.suggestionTimeout ?? 2e3;
    const selectValue = options.selectValue || options.searchText;
    if (options.clear !== false) {
      await this.performClear(element);
    }
    await this.performType(element, { text: options.searchText });
    const startTime = Date.now();
    const pollInterval = 100;
    while (Date.now() - startTime < timeout) {
      await new Promise((r) => setTimeout(r, pollInterval));
      const dropdown = this.findOpenDropdown(element);
      if (!dropdown) continue;
      const match = this.findDropdownOption(dropdown, selectValue);
      if (match) {
        match.click();
        return;
      }
    }
    throw new Error(
      `Autocomplete: no matching suggestion for "${selectValue}" within ${timeout}ms`
    );
  }
  performFocus(element) {
    element.focus();
    element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  }
  performBlur(element) {
    element.blur();
    element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  }
  performHover(element) {
    element.dispatchEvent(createMouseEvent("mouseenter", element));
    element.dispatchEvent(createMouseEvent("mouseover", element));
  }
  async performScroll(element, options) {
    const scrollTarget = this.findScrollableElement(element);
    const isSmooth = !!options?.smooth;
    const before = { scrollTop: scrollTarget.scrollTop, scrollLeft: scrollTarget.scrollLeft };
    if (options?.toElement) {
      const target = document.querySelector(options.toElement);
      if (target) {
        target.scrollIntoView({ behavior: isSmooth ? "smooth" : "auto" });
      }
    } else if (options?.position) {
      scrollTarget.scrollTo({
        left: options.position.x,
        top: options.position.y,
        behavior: isSmooth ? "smooth" : "auto"
      });
    } else if (options?.deltaY !== void 0 || options?.deltaX !== void 0) {
      const dx = options.deltaX ?? 0;
      const dy = options.deltaY ?? 0;
      scrollTarget.scrollBy({ left: dx, top: dy, behavior: isSmooth ? "smooth" : "auto" });
    } else {
      const amount = options?.amount || 100;
      const direction = options?.direction || "down";
      switch (direction) {
        case "up":
          scrollTarget.scrollBy({ top: -amount, behavior: isSmooth ? "smooth" : "auto" });
          break;
        case "down":
          scrollTarget.scrollBy({ top: amount, behavior: isSmooth ? "smooth" : "auto" });
          break;
        case "left":
          scrollTarget.scrollBy({ left: -amount, behavior: isSmooth ? "smooth" : "auto" });
          break;
        case "right":
          scrollTarget.scrollBy({ left: amount, behavior: isSmooth ? "smooth" : "auto" });
          break;
      }
    }
    if (isSmooth) {
      await new Promise((resolve) => {
        let lastTop = scrollTarget.scrollTop;
        let lastLeft = scrollTarget.scrollLeft;
        let stableFrames = 0;
        const check = () => {
          if (scrollTarget.scrollTop === lastTop && scrollTarget.scrollLeft === lastLeft) {
            stableFrames++;
            if (stableFrames >= 3) {
              resolve();
              return;
            }
          } else {
            stableFrames = 0;
            lastTop = scrollTarget.scrollTop;
            lastLeft = scrollTarget.scrollLeft;
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
        setTimeout(resolve, 1e3);
      });
    }
    if (!isSmooth) {
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    const after = { scrollTop: scrollTarget.scrollTop, scrollLeft: scrollTarget.scrollLeft };
    return {
      scrollInfo: {
        before,
        after,
        changed: before.scrollTop !== after.scrollTop || before.scrollLeft !== after.scrollLeft
      }
    };
  }
  findScrollableElement(element) {
    let current = element;
    while (current && current !== document.body) {
      const style = getComputedStyle(current);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      const isScrollable = (overflowY === "auto" || overflowY === "scroll" || overflowX === "auto" || overflowX === "scroll") && (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth);
      if (isScrollable) return current;
      current = current.parentElement;
    }
    if (document.body.scrollHeight > document.body.clientHeight || document.body.scrollWidth > document.body.clientWidth) {
      return document.body;
    }
    return document.documentElement;
  }
  performCheck(element, checked) {
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      if (element.checked !== checked) {
        element.checked = checked;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (element.getAttribute("role") === "switch") {
      const isChecked = element.getAttribute("aria-checked") === "true";
      if (isChecked !== checked) {
        element.click();
      }
    }
  }
  performToggle(element) {
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      element.checked = !element.checked;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (element instanceof HTMLDetailsElement) {
      element.open = !element.open;
      element.dispatchEvent(new Event("toggle", { bubbles: false }));
      return;
    }
    if (typeof HTMLDialogElement !== "undefined" && element instanceof HTMLDialogElement) {
      if (element.open) {
        element.close();
      } else if (typeof element.showModal === "function") {
        element.showModal();
      } else {
        element.setAttribute("open", "");
        element.dispatchEvent(new Event("close", { bubbles: false }));
      }
      return;
    }
    const ariaExpanded = element.getAttribute("aria-expanded");
    if (ariaExpanded !== null) {
      const next = ariaExpanded === "true" ? "false" : "true";
      element.setAttribute("aria-expanded", next);
      element.click();
      return;
    }
    if (element.getAttribute("role") === "switch") {
      element.click();
      return;
    }
    element.click();
  }
  performSetValue(element, params) {
    const value = params?.value;
    if (value === void 0) {
      throw new Error('setValue requires a "value" parameter');
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const previousValue = element.value;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value"
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }
      const tracker = element._valueTracker;
      if (tracker) tracker.setValue(previousValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      const el = element;
      const reactPropsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
      const reactProps = reactPropsKey ? el[reactPropsKey] : void 0;
      if (reactProps?.onChange && typeof reactProps.onChange === "function") {
        reactProps.onChange({
          target: element,
          currentTarget: element,
          type: "change",
          bubbles: true,
          preventDefault: () => {
          },
          stopPropagation: () => {
          },
          nativeEvent: new Event("input")
        });
      }
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (element instanceof HTMLSelectElement) {
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  performSubmit(element) {
    const form = element instanceof HTMLFormElement ? element : element.closest("form");
    if (form) {
      const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
      if (form.dispatchEvent(submitEvent)) {
        form.requestSubmit();
      }
    } else {
      throw new Error("No form found for submit action");
    }
  }
  performReset(element) {
    const form = element instanceof HTMLFormElement ? element : element.closest("form");
    if (form) {
      form.reset();
      form.dispatchEvent(new Event("reset", { bubbles: true }));
    } else {
      throw new Error("No form found for reset action");
    }
  }
  /**
   * Perform a drag operation by dispatching a sequence of mouse events.
   *
   * Follows the same composite pattern as the qontinui core library:
   * mousedown on source → wait → mousemove × N along path → mouseup on target.
   *
   * Optionally dispatches HTML5 drag events (dragstart/dragover/drop/dragend)
   * for apps that use the HTML5 Drag and Drop API instead of mouse events.
   */
  async performDrag(sourceElement, options) {
    const computedStyle = window.getComputedStyle(sourceElement);
    const isDraggable = sourceElement.draggable || sourceElement.getAttribute("aria-grabbed") !== null || sourceElement.getAttribute("role") === "slider" || computedStyle.cursor === "grab" || computedStyle.cursor === "move" || computedStyle.cursor === "grabbing";
    const sourceRect = sourceElement.getBoundingClientRect();
    const sourceX = sourceRect.left + (options?.sourceOffset?.x ?? sourceRect.width / 2);
    const sourceY = sourceRect.top + (options?.sourceOffset?.y ?? sourceRect.height / 2);
    let targetX;
    let targetY;
    if (options?.targetPosition) {
      targetX = options.targetPosition.x;
      targetY = options.targetPosition.y;
    } else if (options?.target) {
      const targetElement = this.resolveTargetElement(options.target);
      if (!targetElement) {
        throw new Error(`Drag target element not found: ${JSON.stringify(options.target)}`);
      }
      const targetRect = targetElement.getBoundingClientRect();
      targetX = targetRect.left + (options?.targetOffset?.x ?? targetRect.width / 2);
      targetY = targetRect.top + (options?.targetOffset?.y ?? targetRect.height / 2);
    } else {
      throw new Error("Drag requires either target or targetPosition");
    }
    const steps = options?.steps ?? 10;
    const holdDelay = options?.holdDelay ?? 100;
    const releaseDelay = options?.releaseDelay ?? 50;
    sourceElement.dispatchEvent(createMouseEventAt("mousedown", sourceX, sourceY));
    const canHTML5 = options?.html5 && typeof DragEvent !== "undefined";
    if (canHTML5) {
      sourceElement.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          clientX: sourceX,
          clientY: sourceY
        })
      );
    }
    if (holdDelay > 0) {
      await sleep(holdDelay);
    }
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const currentX = sourceX + (targetX - sourceX) * progress;
      const currentY = sourceY + (targetY - sourceY) * progress;
      const dispatchTarget = elementFromPointSafe(currentX, currentY) || sourceElement;
      dispatchTarget.dispatchEvent(createMouseEventAt("mousemove", currentX, currentY));
      if (canHTML5) {
        dispatchTarget.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: currentX,
            clientY: currentY
          })
        );
      }
    }
    const dropTarget = elementFromPointSafe(targetX, targetY) || sourceElement;
    dropTarget.dispatchEvent(createMouseEventAt("mouseup", targetX, targetY));
    if (canHTML5) {
      dropTarget.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: targetX,
          clientY: targetY
        })
      );
      sourceElement.dispatchEvent(
        new DragEvent("dragend", {
          bubbles: true,
          cancelable: true,
          clientX: targetX,
          clientY: targetY
        })
      );
    }
    if (releaseDelay > 0) {
      await sleep(releaseDelay);
    }
    return {
      warning: isDraggable ? void 0 : "Element does not appear to be draggable (no draggable attribute, aria-grabbed, or grab/move cursor). Drag events were dispatched but may have no effect."
    };
  }
  /**
   * Resolve a drag target element from a target descriptor.
   */
  resolveTargetElement(target) {
    if (target.elementId) {
      const registered = this.registry.getElement(target.elementId);
      if (registered?.element) return registered.element;
      return findElementByIdentifier(target.elementId);
    }
    if (target.selector) {
      return document.querySelector(target.selector);
    }
    return null;
  }
  /**
   * Generate a deterministic, semantic ID for an unregistered element.
   *
   * Priority:
   *  1. data-testid attribute
   *  2. HTML id attribute (skip React auto-generated IDs like `:r1a:`)
   *  3. Semantic ID: {tagName}-{slugified label}[-{index}]
   *
   * The semantic fallback produces stable IDs across discover() calls as
   * long as the element's label and DOM position don't change, making
   * them usable with executeAction().
   */
  getElementId(element) {
    const testId = element.getAttribute("data-testid");
    if (testId) return testId;
    const htmlId = element.id;
    if (htmlId && !/^:r[0-9a-z]+:$/i.test(htmlId)) return htmlId;
    const tag = element.tagName.toLowerCase();
    const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent?.trim().slice(0, 40) || "";
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    const base = slug ? `${tag}-${slug}` : tag;
    if (!this.discoveryCache.has(base)) return base;
    let i = 1;
    while (this.discoveryCache.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }
  getElementLabel(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const resolved = labelledBy.split(" ").map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ");
      if (resolved) return resolved;
    }
    return element.getAttribute("title") || element.textContent?.trim().substring(0, 50) || void 0;
  }
  getAccessibleName(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labels = labelledBy.split(" ").map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
      if (labels.length > 0) return labels.join(" ");
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) return label.textContent?.trim();
      }
    }
    return element.getAttribute("title") || element.textContent?.trim().substring(0, 50) || void 0;
  }
  inferElementType(element) {
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
        const type = element.type;
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "submit" || type === "button") return "button";
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
  inferActions(element) {
    const type = this.inferElementType(element);
    const baseActions = ["focus", "blur", "hover", "sendKeys", "scroll", "scrollIntoView"];
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
      case "tab":
        return [...baseActions, "click", "middleClick"];
      default:
        return [...baseActions, "click"];
    }
  }
  // ---------------------------------------------------------------------------
  // Batch execution
  // ---------------------------------------------------------------------------
  /**
   * Execute multiple actions sequentially in a single call, reducing IPC round-trips.
   */
  async executeBatch(request) {
    const startTime = performance.now();
    const { steps, stopOnFailure = true, delayBetweenMs = 0 } = request;
    const results = [];
    let succeededCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let stopped = false;
    for (let i = 0; i < steps.length; i++) {
      if (stopped) {
        skippedCount++;
        continue;
      }
      const step = steps[i];
      if (i > 0 && delayBetweenMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayBetweenMs));
      }
      const response = await this.executeAction(step.elementId, step.action);
      const stepResult = {
        index: i,
        label: step.label,
        elementId: step.elementId,
        response
      };
      results.push(stepResult);
      if (response.success) {
        succeededCount++;
      } else {
        failedCount++;
        if (stopOnFailure) {
          stopped = true;
        }
      }
    }
    return {
      success: failedCount === 0,
      results,
      succeededCount,
      failedCount,
      skippedCount,
      durationMs: performance.now() - startTime,
      timestamp: Date.now()
    };
  }
};
function enrichEvents(events) {
  return events.map((event) => {
    const { severity, reason } = classifyEvent(event);
    const fingerprint = computeFingerprint(event);
    const stack = "stack" in event ? event.stack : void 0;
    return {
      event,
      severity,
      reason,
      fingerprint,
      sourceLocation: extractSourceLocation(stack)
    };
  });
}
function computeActionErrorDiff(fingerprintsBefore, eventsBefore, eventsAfter) {
  const fingerprintsAfter = new Set(eventsAfter.map(computeFingerprint));
  const newFingerprints = /* @__PURE__ */ new Set();
  for (const fp of fingerprintsAfter) {
    if (!fingerprintsBefore.has(fp)) newFingerprints.add(fp);
  }
  const resolvedFingerprints = /* @__PURE__ */ new Set();
  for (const fp of fingerprintsBefore) {
    if (!fingerprintsAfter.has(fp)) resolvedFingerprints.add(fp);
  }
  if (newFingerprints.size === 0 && resolvedFingerprints.size === 0) {
    return void 0;
  }
  const newErrors = enrichEvents(
    eventsAfter.filter((e) => newFingerprints.has(computeFingerprint(e)))
  );
  const resolvedErrors = enrichEvents(
    eventsBefore.filter((e) => resolvedFingerprints.has(computeFingerprint(e)))
  );
  const deduped = (list) => {
    const seen = /* @__PURE__ */ new Set();
    return list.filter((e) => {
      if (seen.has(e.fingerprint)) return false;
      seen.add(e.fingerprint);
      return true;
    });
  };
  const dedupedNew = deduped(newErrors);
  const dedupedResolved = deduped(resolvedErrors);
  const countErrors = (list) => list.filter((e) => e.severity === "crash" || e.severity === "error").length;
  return {
    newErrors: dedupedNew,
    resolvedErrors: dedupedResolved,
    errorDelta: countErrors(dedupedNew) - countErrors(dedupedResolved)
  };
}
function safeSerialize(value, seen = /* @__PURE__ */ new WeakSet()) {
  if (value === null || value === void 0) return value;
  if (typeof value === "function") return "[Function]";
  if (typeof value !== "object") return value;
  const obj = value;
  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);
  if (Array.isArray(obj)) {
    return obj.map((item) => safeSerialize(item, seen));
  }
  const result = {};
  for (const key of Object.keys(obj)) {
    try {
      result[key] = safeSerialize(obj[key], seen);
    } catch {
      result[key] = "[Error reading property]";
    }
  }
  return result;
}
function extractReactState(element) {
  const el = element;
  const reactPropsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  const reactFiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!reactPropsKey && !reactFiberKey) {
    return null;
  }
  const rawProps = reactPropsKey ? el[reactPropsKey] ?? {} : {};
  const props = safeSerialize(rawProps);
  const fiberState = [];
  let componentName;
  if (reactFiberKey) {
    const fiber = el[reactFiberKey];
    if (fiber) {
      let current = fiber;
      while (current) {
        const type = current.type;
        if (typeof type === "function") {
          componentName = type.displayName || type.name || void 0;
          break;
        }
        current = current.return;
      }
      const componentFiber = current || fiber;
      let stateNode = componentFiber?.memoizedState;
      let stateCount = 0;
      const maxStates = 20;
      while (stateNode && stateCount < maxStates) {
        fiberState.push(safeSerialize(stateNode.memoizedState));
        stateNode = stateNode.next;
        stateCount++;
      }
    }
  }
  return { props, fiberState, componentName };
}
function createActionExecutor(registry, consoleCapture) {
  return new DefaultActionExecutor(registry, consoleCapture);
}
var MAX_BATCH_SIZE = 50;
async function batch(baseUrl, operations, options) {
  if (operations.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${operations.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
  }
  const url = `${baseUrl.replace(/\/+$/, "")}/ui-bridge/batch`;
  const body = JSON.stringify({
    operations,
    stopOnError: options?.stopOnError ?? false
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let detail;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error ?? parsed.data?.error ?? text;
    } catch {
      detail = text;
    }
    throw new Error(`Batch request failed (HTTP ${response.status}): ${detail}`);
  }
  const json = await response.json();
  const payload = json.data ?? json;
  return {
    success: payload.success,
    results: payload.results,
    totalDurationMs: payload.totalDurationMs
  };
}
async function controlBatch(baseUrl, steps, options) {
  if (steps.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${steps.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
  }
  const url = `${baseUrl.replace(/\/+$/, "")}/ui-bridge/control/batch`;
  const body = JSON.stringify({
    steps,
    stopOnError: options?.stopOnError ?? true
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let detail;
    try {
      const parsed = JSON.parse(text);
      const errorData = parsed.error ? JSON.parse(parsed.error) : parsed.data;
      if (errorData?.error === "batch_size_exceeded") {
        throw new Error(
          `Batch size exceeded: max ${errorData.max}, received ${errorData.received}`
        );
      }
      detail = parsed.error ?? parsed.data?.error ?? text;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Batch size exceeded")) throw e;
      detail = text;
    }
    throw new Error(`Control batch request failed (HTTP ${response.status}): ${detail}`);
  }
  const json = await response.json();
  const payload = json.data ?? json;
  return {
    success: payload.success ?? json.success,
    results: payload.results ?? [],
    totalMs: payload.totalMs ?? 0,
    snapshotDiff: payload.snapshotDiff ?? null,
    stoppedEarly: payload.stoppedEarly ?? false
  };
}

// src/control/workflow-engine.ts
function generateRunId() {
  return `run-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
}
var DefaultWorkflowEngine = class {
  constructor(registry, executor) {
    this.registry = registry;
    this.executor = executor;
    this.activeRuns = /* @__PURE__ */ new Map();
  }
  /**
   * Run a workflow
   */
  async run(workflowId, request) {
    const workflow = this.registry.getWorkflow(workflowId);
    if (!workflow) {
      return {
        workflowId,
        runId: generateRunId(),
        status: "failed",
        steps: [],
        totalSteps: 0,
        success: false,
        error: `Workflow not found: ${workflowId}`,
        startedAt: Date.now(),
        completedAt: Date.now(),
        durationMs: 0
      };
    }
    const runId = generateRunId();
    const state = {
      workflowId,
      runId,
      workflow,
      request,
      status: "running",
      steps: [],
      currentStep: 0,
      startedAt: Date.now()
    };
    this.activeRuns.set(runId, state);
    try {
      await this.executeWorkflow(state);
    } catch (error) {
      state.status = "failed";
      state.error = error instanceof Error ? error.message : String(error);
    }
    state.completedAt = Date.now();
    state.durationMs = state.completedAt - state.startedAt;
    state.success = state.status === "completed" && state.steps.every((s) => s.success);
    setTimeout(() => {
      this.activeRuns.delete(runId);
    }, 6e4);
    return this.buildResponse(state);
  }
  /**
   * Get workflow run status
   */
  async getRunStatus(runId) {
    const state = this.activeRuns.get(runId);
    if (!state) return null;
    return this.buildResponse(state);
  }
  /**
   * Cancel a running workflow
   */
  async cancel(runId) {
    const state = this.activeRuns.get(runId);
    if (!state || state.status !== "running") return false;
    state.status = "cancelled";
    state.completedAt = Date.now();
    state.durationMs = state.completedAt - state.startedAt;
    state.error = "Workflow cancelled by user";
    return true;
  }
  /**
   * List active runs
   */
  async listActiveRuns() {
    return Array.from(this.activeRuns.values()).filter((state) => state.status === "running").map((state) => this.buildResponse(state));
  }
  /**
   * Execute a workflow
   */
  async executeWorkflow(state) {
    const { workflow, request } = state;
    const params = { ...workflow.defaultParams, ...request?.params };
    let startIndex = 0;
    if (request?.startStep) {
      const idx = workflow.steps.findIndex((s) => s.id === request.startStep);
      if (idx >= 0) startIndex = idx;
    }
    let stopIndex = workflow.steps.length;
    if (request?.stopStep) {
      const idx = workflow.steps.findIndex((s) => s.id === request.stopStep);
      if (idx >= 0) stopIndex = idx + 1;
    }
    for (let i = startIndex; i < stopIndex; i++) {
      if (state.status === "cancelled") break;
      state.currentStep = i;
      const step = workflow.steps[i];
      const stepResult = await this.executeStep(step, params, request?.stepTimeout);
      state.steps.push(stepResult);
      if (!stepResult.success) {
        state.status = "failed";
        state.error = stepResult.error;
        return;
      }
    }
    state.status = "completed";
  }
  /**
   * Execute a single step
   */
  async executeStep(step, params, timeout) {
    const startTime = performance.now();
    try {
      const timeoutPromise = timeout ? new Promise(
        (_, reject) => setTimeout(() => reject(new Error("Step timeout")), timeout)
      ) : null;
      const executePromise = this.executeStepInternal(step, params);
      const result = timeoutPromise ? await Promise.race([executePromise, timeoutPromise]) : await executePromise;
      return {
        stepId: step.id,
        stepType: step.type,
        success: true,
        result,
        durationMs: performance.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        stepId: step.id,
        stepType: step.type,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - startTime,
        timestamp: Date.now()
      };
    }
  }
  /**
   * Execute step internal logic
   */
  async executeStepInternal(step, params) {
    const resolvedParams = this.interpolateParams(step.params || {}, params);
    switch (step.type) {
      case "element-action":
        if (!step.target || !step.action) {
          throw new Error("Element action requires target and action");
        }
        return this.executor.executeAction(step.target, {
          action: step.action,
          params: resolvedParams,
          waitOptions: step.waitOptions
        });
      case "component-action":
        if (!step.target || !step.action) {
          throw new Error("Component action requires target and action");
        }
        return this.executor.executeComponentAction(step.target, {
          action: step.action,
          params: resolvedParams
        });
      case "wait": {
        if (!step.target) {
          throw new Error("Wait step requires target");
        }
        const waitResult = await this.executor.waitFor(step.target, step.waitOptions || {});
        if (!waitResult.met) {
          throw new Error(waitResult.error || "Wait condition not met");
        }
        return waitResult;
      }
      case "assert":
        if (!step.target || !step.expectedState) {
          throw new Error("Assert step requires target and expectedState");
        }
        return this.performAssertion(step.target, step.expectedState);
      case "custom":
        if (!step.handler) {
          throw new Error("Custom step requires handler");
        }
        return step.handler();
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }
  /**
   * Perform state assertion
   */
  async performAssertion(target, expectedState) {
    const snapshot = await this.executor.getSnapshot();
    const element = snapshot.elements.find((e) => e.id === target);
    if (!element) {
      throw new Error(`Element not found for assertion: ${target}`);
    }
    const differences = [];
    for (const [key, expected] of Object.entries(expectedState)) {
      const actual = element.state[key];
      if (actual !== expected) {
        differences.push(`${key}: expected ${expected}, got ${actual}`);
      }
    }
    if (differences.length > 0) {
      throw new Error(`Assertion failed:
${differences.join("\n")}`);
    }
    return { passed: true, differences };
  }
  /**
   * Interpolate parameters with {{param}} syntax
   */
  interpolateParams(stepParams, workflowParams) {
    const result = {};
    for (const [key, value] of Object.entries(stepParams)) {
      if (typeof value === "string") {
        result[key] = value.replace(/\{\{(\w+)\}\}/g, (_, name) => {
          return String(workflowParams[name] ?? "");
        });
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  /**
   * Build response from state
   */
  buildResponse(state) {
    return {
      workflowId: state.workflowId,
      runId: state.runId,
      status: state.status,
      steps: [...state.steps],
      currentStep: state.currentStep,
      totalSteps: state.workflow.steps.length,
      success: state.success,
      error: state.error,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      durationMs: state.durationMs
    };
  }
};
function createWorkflowEngine(registry, executor) {
  return new DefaultWorkflowEngine(registry, executor);
}

exports.DefaultActionExecutor = DefaultActionExecutor;
exports.DefaultWorkflowEngine = DefaultWorkflowEngine;
exports.MAX_BATCH_SIZE = MAX_BATCH_SIZE;
exports.batch = batch;
exports.controlBatch = controlBatch;
exports.createActionExecutor = createActionExecutor;
exports.createWorkflowEngine = createWorkflowEngine;
exports.extractReactState = extractReactState;
exports.fillFormFields = fillFormFields;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map