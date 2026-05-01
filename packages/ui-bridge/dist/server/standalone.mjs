// src/server/types.ts
var UI_BRIDGE_ROUTES = [
  // Render log
  { method: "GET", path: "/render-log", handler: "getRenderLog" },
  { method: "GET", path: "/control/render-log", handler: "getRenderLog" },
  // Alias under /control/
  { method: "DELETE", path: "/render-log", handler: "clearRenderLog" },
  { method: "POST", path: "/render-log/snapshot", handler: "captureSnapshot" },
  { method: "GET", path: "/render-log/path", handler: "getRenderLogPath" },
  // Control - Elements
  { method: "GET", path: "/control/elements", handler: "getElements" },
  { method: "GET", path: "/control/element/:id", handler: "getElement", params: ["id"] },
  { method: "GET", path: "/control/element/:id/state", handler: "getElementState", params: ["id"] },
  {
    method: "GET",
    path: "/control/element/:id/react-state",
    handler: "getElementReactState",
    params: ["id"]
  },
  {
    method: "POST",
    path: "/control/element/:id/action",
    handler: "executeElementAction",
    params: ["id"],
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/control/actions/batch",
    handler: "executeBatchAction",
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/control/elements/rank",
    handler: "rankElements",
    bodyRequired: true
  },
  // Control - Components
  { method: "GET", path: "/control/components", handler: "getComponents" },
  { method: "GET", path: "/control/component/:id", handler: "getComponent", params: ["id"] },
  {
    method: "GET",
    path: "/control/component/:id/state",
    handler: "getComponentState",
    params: ["id"]
  },
  {
    method: "POST",
    path: "/control/component/:id/action/:actionId",
    handler: "executeComponentAction",
    params: ["id", "actionId"],
    bodyRequired: true
  },
  // Find (formerly Discovery)
  { method: "POST", path: "/control/find", handler: "find" },
  { method: "POST", path: "/control/discover", handler: "discover" },
  // @deprecated Use /control/find
  { method: "GET", path: "/control/snapshot", handler: "getControlSnapshot" },
  { method: "POST", path: "/control/get-element-images", handler: "getElementImages" },
  // Workflows
  { method: "GET", path: "/control/workflows", handler: "getWorkflows" },
  { method: "POST", path: "/control/workflow/:id/run", handler: "runWorkflow", params: ["id"] },
  {
    method: "GET",
    path: "/control/workflow/:runId/status",
    handler: "getWorkflowStatus",
    params: ["runId"]
  },
  // Element event log
  {
    method: "GET",
    path: "/debug/element-history/:id",
    handler: "getElementHistory",
    params: ["id"]
  },
  // Debug
  { method: "GET", path: "/debug/action-history", handler: "getActionHistory" },
  { method: "GET", path: "/debug/metrics", handler: "getMetrics" },
  { method: "POST", path: "/debug/highlight/:id", handler: "highlightElement", params: ["id"] },
  { method: "GET", path: "/debug/element-tree", handler: "getElementTree" },
  { method: "GET", path: "/control/console-errors", handler: "getConsoleErrors" },
  { method: "POST", path: "/control/console-errors/clear", handler: "clearConsoleErrors" },
  // AI-native endpoints
  { method: "POST", path: "/ai/search", handler: "aiSearch", bodyRequired: true },
  { method: "POST", path: "/ai/find", handler: "aiFind", bodyRequired: true },
  { method: "POST", path: "/ai/execute", handler: "aiExecute", bodyRequired: true },
  { method: "POST", path: "/ai/assert", handler: "aiAssert", bodyRequired: true },
  { method: "POST", path: "/ai/assert/batch", handler: "aiAssertBatch", bodyRequired: true },
  { method: "GET", path: "/ai/snapshot", handler: "getSemanticSnapshot" },
  { method: "GET", path: "/ai/diff", handler: "getSemanticDiff" },
  { method: "GET", path: "/ai/summary", handler: "getPageSummary" },
  { method: "POST", path: "/ai/semantic-search", handler: "aiSemanticSearch", bodyRequired: true },
  // Change tracking
  {
    method: "POST",
    path: "/ai/execute-with-diff",
    handler: "executeWithDiff",
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/ai/wait-for-change",
    handler: "waitForChange",
    bodyRequired: true
  },
  { method: "GET", path: "/ai/categorize-last-diff", handler: "categorizeLastDiff" },
  { method: "POST", path: "/ai/scoped-diff", handler: "getScopedDiff", bodyRequired: true },
  {
    method: "POST",
    path: "/ai/summarize-diff",
    handler: "summarizeDiff",
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/ai/structured-changes",
    handler: "analyzeStructuredChanges"
  },
  // Change buffer
  { method: "POST", path: "/ai/change-buffer/enable", handler: "enableChangeBuffer" },
  { method: "POST", path: "/ai/change-buffer/disable", handler: "disableChangeBuffer" },
  { method: "POST", path: "/ai/change-buffer/drain", handler: "drainChangeBuffer" },
  { method: "GET", path: "/ai/change-buffer/size", handler: "getChangeBufferSize" },
  // Snapshot bookmarks (static routes before parameterized).
  //
  // The list/save endpoints use the plural `/ai/bookmarks` while the
  // per-resource endpoints historically used the singular `/ai/bookmark/:name`.
  // The plural variants are aliased to the same handlers so callers reading
  // the canonical reference (which uses plural throughout) don't hit 404s
  // when paths drift in their head.
  { method: "POST", path: "/ai/bookmarks", handler: "saveBookmark", bodyRequired: true },
  { method: "GET", path: "/ai/bookmarks", handler: "listBookmarks" },
  { method: "GET", path: "/ai/bookmark/:name", handler: "getBookmark", params: ["name"] },
  { method: "GET", path: "/ai/bookmarks/:name", handler: "getBookmark", params: ["name"] },
  {
    method: "DELETE",
    path: "/ai/bookmark/:name",
    handler: "deleteBookmark",
    params: ["name"]
  },
  {
    method: "DELETE",
    path: "/ai/bookmarks/:name",
    handler: "deleteBookmark",
    params: ["name"]
  },
  {
    method: "GET",
    path: "/ai/bookmark/:name/diff",
    handler: "diffFromBookmark",
    params: ["name"]
  },
  {
    method: "GET",
    path: "/ai/bookmarks/:name/diff",
    handler: "diffFromBookmark",
    params: ["name"]
  },
  // State management (static routes before parameterized)
  { method: "GET", path: "/control/states", handler: "getStates" },
  { method: "GET", path: "/control/states/active", handler: "getActiveStates" },
  { method: "GET", path: "/control/states/snapshot", handler: "getStateSnapshot" },
  { method: "POST", path: "/control/states/find-path", handler: "findPath", bodyRequired: true },
  { method: "POST", path: "/control/states/navigate", handler: "navigateTo", bodyRequired: true },
  { method: "GET", path: "/control/state/:id", handler: "getState", params: ["id"] },
  { method: "POST", path: "/control/state/:id/activate", handler: "activateState", params: ["id"] },
  {
    method: "POST",
    path: "/control/state/:id/deactivate",
    handler: "deactivateState",
    params: ["id"]
  },
  { method: "GET", path: "/control/state-groups", handler: "getStateGroups" },
  {
    method: "POST",
    path: "/control/state-group/:id/activate",
    handler: "activateStateGroup",
    params: ["id"]
  },
  {
    method: "POST",
    path: "/control/state-group/:id/deactivate",
    handler: "deactivateStateGroup",
    params: ["id"]
  },
  { method: "GET", path: "/control/transitions", handler: "getTransitions" },
  {
    method: "GET",
    path: "/control/transition/:id/can-execute",
    handler: "canExecuteTransition",
    params: ["id"]
  },
  {
    method: "POST",
    path: "/control/transition/:id/execute",
    handler: "executeTransition",
    params: ["id"]
  },
  // Intent endpoints
  { method: "GET", path: "/ai/intents", handler: "listIntents" },
  { method: "POST", path: "/ai/intents/execute", handler: "executeIntent", bodyRequired: true },
  { method: "POST", path: "/ai/intents/find", handler: "findIntent", bodyRequired: true },
  { method: "POST", path: "/ai/intents/register", handler: "registerIntent", bodyRequired: true },
  {
    method: "POST",
    path: "/ai/intents/execute-from-query",
    handler: "executeIntentFromQuery",
    bodyRequired: true
  },
  // Recovery endpoints
  {
    method: "POST",
    path: "/ai/recovery/attempt",
    handler: "attemptRecovery",
    bodyRequired: true
  },
  // Cross-app analysis endpoints
  { method: "GET", path: "/ai/analyze/data", handler: "analyzePageData" },
  { method: "GET", path: "/ai/analyze/regions", handler: "analyzePageRegions" },
  { method: "GET", path: "/ai/analyze/structured-data", handler: "analyzeStructuredData" },
  {
    method: "POST",
    path: "/ai/analyze/cross-app-compare",
    handler: "crossAppCompare",
    bodyRequired: true
  },
  // Page navigation
  { method: "POST", path: "/control/page/refresh", handler: "pageRefresh" },
  { method: "POST", path: "/control/page/navigate", handler: "pageNavigate", bodyRequired: true },
  { method: "POST", path: "/control/page/back", handler: "pageGoBack" },
  { method: "POST", path: "/control/page/forward", handler: "pageGoForward" },
  { method: "POST", path: "/control/page/evaluate", handler: "pageEvaluate", bodyRequired: true },
  { method: "POST", path: "/control/page/scroll", handler: "pageScroll", bodyRequired: true },
  // Clipboard (relay to browser for gesture-based access)
  {
    method: "POST",
    path: "/control/clipboard/write",
    handler: "clipboardWrite",
    bodyRequired: true
  },
  { method: "GET", path: "/control/clipboard/read", handler: "clipboardRead" },
  // Annotations (static routes before parameterized)
  { method: "GET", path: "/annotations", handler: "getAnnotations" },
  { method: "GET", path: "/annotations/export", handler: "exportAnnotations" },
  { method: "GET", path: "/annotations/coverage", handler: "getAnnotationCoverage" },
  { method: "POST", path: "/annotations/import", handler: "importAnnotations", bodyRequired: true },
  { method: "GET", path: "/annotations/:id", handler: "getAnnotation", params: ["id"] },
  {
    method: "PUT",
    path: "/annotations/:id",
    handler: "setAnnotation",
    params: ["id"],
    bodyRequired: true
  },
  { method: "DELETE", path: "/annotations/:id", handler: "deleteAnnotation", params: ["id"] },
  // Performance diagnostics
  { method: "GET", path: "/control/performance-entries", handler: "getPerformanceEntries" },
  {
    method: "POST",
    path: "/control/performance-entries/clear",
    handler: "clearPerformanceEntries"
  },
  { method: "GET", path: "/control/browser-events", handler: "getBrowserEvents" },
  { method: "GET", path: "/control/timeline", handler: "getTimeline" },
  { method: "GET", path: "/control/health", handler: "getHealthReport" },
  { method: "GET", path: "/control/network-chains", handler: "getNetworkChains" },
  { method: "POST", path: "/control/error-sessions/start", handler: "startErrorSession" },
  { method: "POST", path: "/control/error-sessions/end", handler: "endErrorSession" },
  { method: "GET", path: "/control/error-sessions", handler: "getErrorSessions" },
  {
    method: "POST",
    path: "/control/error-baselines/capture",
    handler: "captureErrorBaseline",
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/control/error-baselines/compare",
    handler: "compareErrorBaseline",
    bodyRequired: true
  },
  { method: "GET", path: "/control/error-snapshots", handler: "getErrorSnapshots" },
  { method: "GET", path: "/control/error-report", handler: "getErrorReport" },
  // Design review
  {
    method: "GET",
    path: "/design/element/:id/styles",
    handler: "getElementStyles",
    params: ["id"]
  },
  {
    method: "POST",
    path: "/design/element/:id/state-styles",
    handler: "getElementStateStyles",
    params: ["id"]
  },
  { method: "POST", path: "/design/snapshot", handler: "getDesignSnapshot" },
  {
    method: "POST",
    path: "/design/responsive",
    handler: "getResponsiveSnapshots",
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/control/viewport-constraints",
    handler: "setViewportConstraints",
    bodyRequired: true
  },
  { method: "POST", path: "/design/audit", handler: "runDesignAudit" },
  {
    method: "POST",
    path: "/design/style-guide/load",
    handler: "loadStyleGuide",
    bodyRequired: true
  },
  { method: "GET", path: "/design/style-guide", handler: "getStyleGuide" },
  { method: "DELETE", path: "/design/style-guide", handler: "clearStyleGuide" },
  // Quality evaluation
  { method: "POST", path: "/design/evaluate", handler: "evaluateQuality" },
  { method: "GET", path: "/design/evaluate/contexts", handler: "getQualityContexts" },
  { method: "POST", path: "/design/evaluate/baseline", handler: "saveBaseline" },
  { method: "POST", path: "/design/evaluate/diff", handler: "diffBaseline" },
  // Form state awareness
  { method: "GET", path: "/control/forms", handler: "getForms" },
  { method: "POST", path: "/control/fill", handler: "fillForm", bodyRequired: true },
  { method: "POST", path: "/control/forms/snapshot", handler: "snapshotForms" },
  {
    method: "POST",
    path: "/control/forms/diff",
    handler: "diffForms",
    bodyRequired: true
  },
  // Clipboard
  { method: "GET", path: "/control/clipboard", handler: "getClipboard" },
  { method: "POST", path: "/control/clipboard", handler: "setClipboard", bodyRequired: true },
  // Network request monitoring (static routes before parameterized)
  { method: "GET", path: "/control/network-requests", handler: "getNetworkRequests" },
  {
    method: "GET",
    path: "/control/network-requests/in-flight",
    handler: "getNetworkRequestsInFlight"
  },
  {
    method: "POST",
    path: "/control/network-requests/wait",
    handler: "waitForNetworkRequest",
    bodyRequired: true
  },
  {
    method: "GET",
    path: "/control/network-request/:id",
    handler: "getNetworkRequest",
    params: ["id"]
  },
  // Idle detection (static routes before parameterized)
  { method: "GET", path: "/control/idle-status", handler: "getIdleStatus" },
  { method: "POST", path: "/control/wait-for-idle", handler: "waitForIdle" },
  {
    method: "POST",
    path: "/control/wait-for-targets",
    handler: "waitForTargets",
    bodyRequired: true
  },
  {
    method: "GET",
    path: "/control/idle-status/:signal",
    handler: "getIdleSignalStatus",
    params: ["signal"]
  },
  {
    method: "POST",
    path: "/control/wait-for-idle/:signal",
    handler: "waitForSignalIdle",
    params: ["signal"]
  },
  // Undo/redo awareness
  { method: "GET", path: "/control/undo-state", handler: "getUndoState" },
  { method: "POST", path: "/control/undo", handler: "executeUndo" },
  { method: "POST", path: "/control/redo", handler: "executeRedo" },
  // API discovery
  { method: "GET", path: "/capabilities", handler: "getCapabilities" },
  // Specs
  { method: "GET", path: "/control/specs", handler: "getSpecs" },
  // Heartbeat
  { method: "POST", path: "/heartbeat", handler: "receiveHeartbeat" },
  // Media discovery & analysis
  { method: "POST", path: "/ai/media/find", handler: "findMedia" },
  { method: "POST", path: "/ai/media/audit/accessibility", handler: "mediaAuditAccessibility" },
  { method: "POST", path: "/ai/media/audit/performance", handler: "mediaAuditPerformance" },
  { method: "POST", path: "/ai/media/snapshot", handler: "captureMediaSnapshot" },
  { method: "POST", path: "/ai/media/compare", handler: "compareMediaSnapshots" },
  { method: "POST", path: "/ai/media/analyze", handler: "analyzeMedia" },
  { method: "POST", path: "/ai/media/analyze/batch", handler: "analyzeMediaBatch" },
  { method: "POST", path: "/ai/media/analyze/page", handler: "analyzeMediaPage" },
  // Change observation (push-based)
  { method: "GET", path: "/control/changes/since", handler: "getChangesSince" },
  // ── Route aliases ──────────────────────────────────────────────────
  // These map commonly expected paths to existing handlers.
  // Design review aliases under /control/ (static before parameterized)
  { method: "POST", path: "/control/design/snapshot", handler: "getDesignSnapshot" },
  {
    method: "POST",
    path: "/control/design/responsive",
    handler: "getResponsiveSnapshots",
    bodyRequired: true
  },
  { method: "POST", path: "/control/design/audit", handler: "runDesignAudit" },
  {
    method: "GET",
    path: "/control/design/element/:id/styles",
    handler: "getElementStyles",
    params: ["id"]
  },
  {
    method: "POST",
    path: "/control/design/element/:id/state-styles",
    handler: "getElementStateStyles",
    params: ["id"]
  },
  // Annotation aliases under /control/ (static before parameterized)
  { method: "GET", path: "/control/annotations", handler: "getAnnotations" },
  {
    method: "POST",
    path: "/control/annotation/:id",
    handler: "setAnnotation",
    params: ["id"],
    bodyRequired: true
  },
  { method: "GET", path: "/control/annotations/export", handler: "exportAnnotations" },
  { method: "GET", path: "/control/annotations/coverage", handler: "getAnnotationCoverage" },
  {
    method: "POST",
    path: "/control/annotations/import",
    handler: "importAnnotations",
    bodyRequired: true
  },
  { method: "GET", path: "/control/annotation/:id", handler: "getAnnotation", params: ["id"] },
  {
    method: "PUT",
    path: "/control/annotation/:id",
    handler: "setAnnotation",
    params: ["id"],
    bodyRequired: true
  },
  {
    method: "DELETE",
    path: "/control/annotation/:id",
    handler: "deleteAnnotation",
    params: ["id"]
  },
  // History/metrics aliases under /control/
  { method: "GET", path: "/control/action-history", handler: "getActionHistory" },
  { method: "GET", path: "/control/history", handler: "getActionHistory" },
  { method: "GET", path: "/control/metrics", handler: "getMetrics" },
  { method: "GET", path: "/control/interaction-metrics", handler: "getMetrics" },
  {
    method: "GET",
    path: "/control/element/:id/history",
    handler: "getElementHistory",
    params: ["id"]
  },
  // Intent aliases under /control/ (static before parameterized)
  { method: "GET", path: "/control/intents", handler: "listIntents" },
  { method: "POST", path: "/control/intents", handler: "registerIntent", bodyRequired: true },
  {
    method: "POST",
    path: "/control/intent/:name/execute",
    handler: "executeIntent",
    params: ["name"],
    bodyRequired: true
  },
  { method: "DELETE", path: "/control/intent/:name", handler: "deleteIntent", params: ["name"] },
  // AI assert-batch alias (hyphenated form)
  { method: "POST", path: "/ai/assert-batch", handler: "aiAssertBatch", bodyRequired: true },
  // App-agnostic convenience endpoints
  {
    method: "POST",
    path: "/control/page/click-by-text",
    handler: "clickByText",
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/control/page/click-by-selector",
    handler: "clickBySelector",
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/control/page/type-into",
    handler: "typeInto",
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/control/page/read-value",
    handler: "readValue",
    bodyRequired: true
  },
  {
    method: "POST",
    path: "/control/page/find-by-text",
    handler: "findByText",
    bodyRequired: true
  },
  // Tier 3.1 — registry-based element condition polling
  {
    method: "POST",
    path: "/ai/wait-for-element-condition",
    handler: "waitForElementByCondition",
    bodyRequired: true
  },
  // Testing-friendliness — route-change wait
  {
    method: "POST",
    path: "/ai/wait-for-route-change",
    handler: "waitForRouteChange"
  },
  {
    method: "POST",
    path: "/ai/wait-for-element",
    handler: "waitForElementRegistered",
    bodyRequired: true
  },
  // Tier 3.2 — mixed action/wait/snapshot batch
  {
    method: "POST",
    path: "/control/batch-execute",
    handler: "controlBatch",
    bodyRequired: true
  },
  // Diagnostics
  { method: "GET", path: "/diagnostics", handler: "getDiagnostics" },
  // Navigation adapter
  { method: "GET", path: "/control/page/routes", handler: "getRoutes" },
  {
    method: "POST",
    path: "/control/page/navigate-to",
    handler: "navigateByAdapter",
    bodyRequired: true
  }
];

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

// src/recording/interaction-interceptor.ts
var InteractionInterceptor = class {
  constructor(registry, callback, config = {}) {
    this.active = false;
    // Keystroke coalescing state
    this.keystrokeTimer = null;
    this.keystrokeBuffer = "";
    this.keystrokeTargetId = null;
    this.keystrokeTargetElement = null;
    this.registry = registry;
    this.callback = callback;
    this.config = {
      filterUnregistered: config.filterUnregistered ?? true,
      keystrokeCoalesceMs: config.keystrokeCoalesceMs ?? 100
    };
    this.handleClick = this.onClick.bind(this);
    this.handleInput = this.onInput.bind(this);
    this.handleChange = this.onChange.bind(this);
    this.handleSubmit = this.onSubmit.bind(this);
    this.handleKeydown = this.onKeydown.bind(this);
  }
  start() {
    if (this.active) return;
    this.active = true;
    document.addEventListener("click", this.handleClick, { capture: true, passive: true });
    document.addEventListener("input", this.handleInput, { capture: true, passive: true });
    document.addEventListener("change", this.handleChange, { capture: true, passive: true });
    document.addEventListener("submit", this.handleSubmit, { capture: true, passive: true });
    document.addEventListener("keydown", this.handleKeydown, { capture: true, passive: true });
  }
  stop() {
    if (!this.active) return;
    this.active = false;
    this.flushKeystrokeBuffer();
    document.removeEventListener("click", this.handleClick, { capture: true });
    document.removeEventListener("input", this.handleInput, { capture: true });
    document.removeEventListener("change", this.handleChange, { capture: true });
    document.removeEventListener("submit", this.handleSubmit, { capture: true });
    document.removeEventListener("keydown", this.handleKeydown, { capture: true });
  }
  resolveTarget(domTarget) {
    if (!(domTarget instanceof HTMLElement)) return null;
    const registered = findNearestRegisteredElement(domTarget, this.registry);
    if (!registered && this.config.filterUnregistered) return null;
    if (!registered) return null;
    return { elementId: registered.id, element: registered.element };
  }
  emit(actionType, elementId, element, value) {
    this.callback({
      timestamp: Date.now(),
      actionType,
      targetElementId: elementId,
      targetElement: element,
      value
    });
  }
  onClick(e) {
    const target = this.resolveTarget(e.target);
    if (!target) return;
    const el = target.element;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return;
    this.emit("click", target.elementId, target.element);
  }
  onInput(e) {
    const target = this.resolveTarget(e.target);
    if (!target) return;
    const el = target.element;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    if (this.keystrokeTargetId === target.elementId) {
      this.keystrokeBuffer = el.value;
    } else {
      this.flushKeystrokeBuffer();
      this.keystrokeTargetId = target.elementId;
      this.keystrokeTargetElement = target.element;
      this.keystrokeBuffer = el.value;
    }
    if (this.keystrokeTimer) clearTimeout(this.keystrokeTimer);
    this.keystrokeTimer = setTimeout(
      () => this.flushKeystrokeBuffer(),
      this.config.keystrokeCoalesceMs
    );
  }
  flushKeystrokeBuffer() {
    if (this.keystrokeTimer) {
      clearTimeout(this.keystrokeTimer);
      this.keystrokeTimer = null;
    }
    if (this.keystrokeTargetId && this.keystrokeTargetElement && this.keystrokeBuffer) {
      this.emit("type", this.keystrokeTargetId, this.keystrokeTargetElement, this.keystrokeBuffer);
    }
    this.keystrokeTargetId = null;
    this.keystrokeTargetElement = null;
    this.keystrokeBuffer = "";
  }
  onChange(e) {
    const target = this.resolveTarget(e.target);
    if (!target) return;
    const el = target.element;
    if (el instanceof HTMLSelectElement) {
      this.emit("select", target.elementId, target.element, el.value);
    } else if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox") {
        this.emit(
          el.checked ? "check" : "uncheck",
          target.elementId,
          target.element,
          String(el.checked)
        );
      } else if (el.type === "radio") {
        this.emit("check", target.elementId, target.element, el.value);
      }
    }
  }
  onSubmit(e) {
    const target = this.resolveTarget(e.target);
    if (!target) return;
    this.flushKeystrokeBuffer();
    this.emit("submit", target.elementId, target.element);
  }
  onKeydown(e) {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    const target = this.resolveTarget(e.target);
    if (!target) return;
    if (e.key === "Enter") {
      this.flushKeystrokeBuffer();
      const form = target.element.closest("form");
      if (form) return;
      this.emit("submit", target.elementId, target.element);
    }
  }
};

// src/recording/session-manager.ts
var RecordingSessionManager = class {
  constructor(registry, changeObserver = null, config = {}) {
    // Session state
    this.sessionId = null;
    this.startTime = 0;
    this.active = false;
    this.interceptor = null;
    this.autoSaveTimer = null;
    // Collected data
    this.captures = [];
    this.allFingerprints = /* @__PURE__ */ new Map();
    this.elementIdToHash = /* @__PURE__ */ new Map();
    this.hashToElementIds = /* @__PURE__ */ new Map();
    this.interactions = [];
    this.transitions = [];
    this.variables = [];
    // Snapshot caching
    this.lastCaptureTime = 0;
    this.lastCaptureId = null;
    // Pending interaction processing (queue to avoid dropping rapid interactions)
    this.pendingSettleTimers = [];
    this.registry = registry;
    this.changeObserver = changeObserver;
    this.config = {
      debounceMs: config.debounceMs ?? 300,
      maxCaptures: config.maxCaptures ?? 500,
      filterUnregistered: config.filterUnregistered ?? true,
      keystrokeCoalesceMs: config.keystrokeCoalesceMs ?? 100,
      autoSaveIntervalMs: config.autoSaveIntervalMs ?? 3e4,
      onAutoSave: config.onAutoSave
    };
  }
  // ============================================================================
  // Lifecycle
  // ============================================================================
  start(config) {
    if (this.active) return;
    if (config) {
      this.config = {
        ...this.config,
        ...config
      };
    }
    this.sessionId = generateId("session");
    this.startTime = Date.now();
    this.active = true;
    this.captures = [];
    this.allFingerprints = /* @__PURE__ */ new Map();
    this.elementIdToHash = /* @__PURE__ */ new Map();
    this.hashToElementIds = /* @__PURE__ */ new Map();
    this.interactions = [];
    this.transitions = [];
    this.variables = [];
    this.lastCaptureTime = 0;
    this.lastCaptureId = null;
    this.takeCapture("initial");
    this.interceptor = new InteractionInterceptor(
      this.registry,
      (event) => this.onInteraction(event),
      {
        filterUnregistered: this.config.filterUnregistered,
        keystrokeCoalesceMs: this.config.keystrokeCoalesceMs
      }
    );
    this.interceptor.start();
    if (this.config.onAutoSave && this.config.autoSaveIntervalMs > 0) {
      this.autoSaveTimer = setInterval(() => {
        if (!this.active) return;
        try {
          const partialExport = this.buildExport();
          this.config.onAutoSave?.(partialExport);
        } catch {
        }
      }, this.config.autoSaveIntervalMs);
    }
  }
  stop() {
    if (!this.active || !this.sessionId) {
      throw new Error("No active recording session");
    }
    this.interceptor?.stop();
    this.interceptor = null;
    if (this.autoSaveTimer !== null) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    for (const pending of this.pendingSettleTimers) {
      clearTimeout(pending.timer);
      pending.unsubscribe?.();
    }
    this.pendingSettleTimers = [];
    this.takeCapture("final");
    const exportData = this.buildExport();
    const duration = Date.now() - this.startTime;
    const result = {
      sessionId: this.sessionId,
      duration,
      exportData,
      variables: this.variables,
      interactionCount: this.interactions.length,
      captureCount: this.captures.length
    };
    this.active = false;
    this.sessionId = null;
    return result;
  }
  getStatus() {
    return {
      active: this.active,
      sessionId: this.sessionId ?? void 0,
      duration: this.active ? Date.now() - this.startTime : 0,
      interactionCount: this.interactions.length,
      captureCount: this.captures.length
    };
  }
  // ============================================================================
  // Interaction Handling
  // ============================================================================
  onInteraction(event) {
    if (!this.active) return;
    const beforeCaptureId = this.getOrTakeBeforeCapture();
    const capturedEvent = event;
    this.waitForSettle(() => {
      if (!this.active) return;
      const afterCaptureId = this.takeCapture("action");
      const targetFingerprint = this.elementIdToHash.get(capturedEvent.targetElementId) ?? null;
      const beforeCapture = this.captures.find((c) => c.id === beforeCaptureId);
      const afterCapture = this.captures.find((c) => c.id === afterCaptureId);
      const beforeSet = new Set(beforeCapture?.fingerprintHashes ?? []);
      const afterSet = new Set(afterCapture?.fingerprintHashes ?? []);
      const appeared = [...afterSet].filter((h) => !beforeSet.has(h));
      const disappeared = [...beforeSet].filter((h) => !afterSet.has(h));
      const transitionRecord = {
        actionId: generateId("action"),
        actionType: capturedEvent.actionType,
        targetFingerprint,
        beforeCaptureId,
        afterCaptureId,
        appearedFingerprints: appeared,
        disappearedFingerprints: disappeared,
        timestamp: capturedEvent.timestamp
      };
      this.transitions.push(transitionRecord);
      const recorded = {
        id: transitionRecord.actionId,
        timestamp: capturedEvent.timestamp,
        actionType: capturedEvent.actionType,
        targetFingerprint,
        targetElementId: capturedEvent.targetElementId,
        beforeCaptureId,
        afterCaptureId,
        value: capturedEvent.value
      };
      this.interactions.push(recorded);
      if (capturedEvent.value && (capturedEvent.actionType === "type" || capturedEvent.actionType === "select")) {
        this.detectVariable(capturedEvent, targetFingerprint);
      }
    });
  }
  getOrTakeBeforeCapture() {
    const now = Date.now();
    if (this.lastCaptureId && now - this.lastCaptureTime < 200) {
      return this.lastCaptureId;
    }
    return this.takeCapture("before-action");
  }
  /**
   * Wait for DOM to settle, then invoke callback.
   * Each call creates its own independent timer — no shared mutable state.
   */
  waitForSettle(callback) {
    if (this.changeObserver) {
      let settleTimeout;
      let unsubscribe;
      const entry = { timer: settleTimeout, unsubscribe: void 0 };
      const complete = () => {
        unsubscribe?.();
        const idx = this.pendingSettleTimers.indexOf(entry);
        if (idx >= 0) this.pendingSettleTimers.splice(idx, 1);
        callback();
      };
      const resetSettle = () => {
        clearTimeout(settleTimeout);
        settleTimeout = setTimeout(complete, this.config.debounceMs);
        entry.timer = settleTimeout;
      };
      unsubscribe = this.changeObserver.subscribe(() => {
        resetSettle();
      });
      entry.unsubscribe = unsubscribe;
      this.pendingSettleTimers.push(entry);
      resetSettle();
    } else {
      const timer = setTimeout(() => {
        const idx = this.pendingSettleTimers.findIndex((e) => e.timer === timer);
        if (idx >= 0) this.pendingSettleTimers.splice(idx, 1);
        callback();
      }, this.config.debounceMs);
      this.pendingSettleTimers.push({ timer });
    }
  }
  // ============================================================================
  // Fingerprint Snapshots
  // ============================================================================
  takeCapture(_triggeredBy) {
    if (this.captures.length >= this.config.maxCaptures) {
      const referencedIds = /* @__PURE__ */ new Set();
      for (const t of this.transitions) {
        referencedIds.add(t.beforeCaptureId);
        referencedIds.add(t.afterCaptureId);
      }
      if (this.captures.length > 0) referencedIds.add(this.captures[0].id);
      if (this.captures.length > 1) referencedIds.add(this.captures[this.captures.length - 1].id);
      const evictIdx = this.captures.findIndex((c) => !referencedIds.has(c.id));
      if (evictIdx >= 0) {
        this.captures.splice(evictIdx, 1);
      } else if (this.captures.length > 1) {
        this.captures.splice(1, 1);
      }
    }
    const { fingerprints, hashToElementIds, elementIdToHash } = computeFingerprintsWithMapping(
      this.registry
    );
    for (const [hash, fp] of fingerprints) {
      if (!this.allFingerprints.has(hash)) {
        this.allFingerprints.set(hash, fp);
      }
    }
    for (const [hash, ids] of hashToElementIds) {
      this.hashToElementIds.set(hash, ids);
    }
    for (const [id, hash] of elementIdToHash) {
      this.elementIdToHash.set(id, hash);
    }
    const captureId = generateId("capture");
    const capture = {
      id: captureId,
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title,
      fingerprintHashes: Array.from(fingerprints.keys())
    };
    this.captures.push(capture);
    this.lastCaptureTime = capture.timestamp;
    this.lastCaptureId = captureId;
    return captureId;
  }
  // ============================================================================
  // Variable Detection
  // ============================================================================
  detectVariable(event, fingerprint) {
    if (!fingerprint || !event.value) return;
    if (this.variables.some((v) => v.fingerprint === fingerprint)) {
      const existing = this.variables.find((v) => v.fingerprint === fingerprint);
      if (existing) existing.enteredValue = event.value;
      return;
    }
    const el = event.targetElement;
    const inputType = el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? "select" : el instanceof HTMLTextAreaElement ? "textarea" : "text";
    const label = this.getElementLabel(el);
    this.variables.push({
      fingerprint,
      elementId: event.targetElementId,
      inputType,
      enteredValue: event.value,
      label,
      suggestedParamName: labelToCamelCase(label)
    });
  }
  getElementLabel(el) {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }
    const wrappingLabel = el.closest("label");
    if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.placeholder) return el.placeholder;
    }
    const testId = el.getAttribute("data-testid");
    if (testId) return testId;
    const name = el.getAttribute("name");
    if (name) return name;
    return "field";
  }
  // ============================================================================
  // Export Building
  // ============================================================================
  buildExport() {
    const allFingerprintHashes = Array.from(this.allFingerprints.keys());
    const fingerprintDetails = {};
    for (const [hash, fp] of this.allFingerprints) {
      fingerprintDetails[hash] = fp;
    }
    const presenceMatrix = this.captures.map((c) => ({
      captureId: c.id,
      url: c.url,
      fingerprints: c.fingerprintHashes
    }));
    const cooccurrenceCounts = {};
    for (const capture of this.captures) {
      const hashes = capture.fingerprintHashes;
      for (let i = 0; i < hashes.length; i++) {
        for (let j = i + 1; j < hashes.length; j++) {
          const a = hashes[i];
          const b = hashes[j];
          if (!cooccurrenceCounts[a]) cooccurrenceCounts[a] = {};
          if (!cooccurrenceCounts[b]) cooccurrenceCounts[b] = {};
          cooccurrenceCounts[a][b] = (cooccurrenceCounts[a][b] || 0) + 1;
          cooccurrenceCounts[b][a] = (cooccurrenceCounts[b][a] || 0) + 1;
        }
      }
    }
    const hashToCaptureEntries = /* @__PURE__ */ new Map();
    for (const capture of this.captures) {
      const hashSet = new Set(capture.fingerprintHashes);
      for (const hash of hashSet) {
        let entries = hashToCaptureEntries.get(hash);
        if (!entries) {
          entries = [];
          hashToCaptureEntries.set(hash, entries);
        }
        entries.push({ id: capture.id, timestamp: capture.timestamp });
      }
    }
    const fingerprintStats = {};
    for (const hash of allFingerprintHashes) {
      const entries = hashToCaptureEntries.get(hash) ?? [];
      let firstSeen = Infinity;
      let lastSeen = 0;
      const captureIds = [];
      for (const entry of entries) {
        captureIds.push(entry.id);
        if (entry.timestamp < firstSeen) firstSeen = entry.timestamp;
        if (entry.timestamp > lastSeen) lastSeen = entry.timestamp;
      }
      fingerprintStats[hash] = {
        totalAppearances: captureIds.length,
        captureIds,
        firstSeen: firstSeen === Infinity ? 0 : firstSeen,
        lastSeen
      };
    }
    const stateCandidates = this.computeStateCandidates(allFingerprintHashes, hashToCaptureEntries);
    return {
      sessionId: this.sessionId,
      exportedAt: Date.now(),
      allFingerprints: allFingerprintHashes,
      fingerprintDetails,
      presenceMatrix,
      cooccurrenceCounts,
      fingerprintStats,
      transitions: this.transitions,
      stateCandidates
    };
  }
  computeStateCandidates(allHashes, hashToCaptureEntries) {
    const signatureGroups = /* @__PURE__ */ new Map();
    for (const hash of allHashes) {
      const entries = hashToCaptureEntries.get(hash) ?? [];
      const captureIds = entries.map((e) => e.id).sort();
      const signature = captureIds.join(",");
      const group = signatureGroups.get(signature) || [];
      group.push(hash);
      signatureGroups.set(signature, group);
    }
    const candidates = [];
    for (const [, group] of signatureGroups) {
      if (group.length < 2) continue;
      const zones = group.map((h) => this.allFingerprints.get(h)?.positionZone).filter(Boolean);
      const landmarks = group.map((h) => this.allFingerprints.get(h)?.landmarkContext).filter(Boolean);
      candidates.push({
        fingerprints: group.sort(),
        cooccurrenceRate: 1,
        // By definition — identical presence signature
        positionZone: mostFrequent(zones),
        landmarkContext: mostFrequent(landmarks)
      });
    }
    return candidates;
  }
};
var idCounter = 0;
function generateId(prefix) {
  idCounter++;
  return `${prefix}-${Date.now()}-${idCounter}`;
}
function labelToCamelCase(label) {
  return label.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/).map(
    (word, i) => i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join("") || "field";
}
function mostFrequent(items) {
  if (items.length === 0) return void 0;
  const counts = /* @__PURE__ */ new Map();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let best = items[0];
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }
  return best;
}

// src/server/websocket-handler.ts
function generateId2() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
var VERSION = "0.1.0";
var UIBridgeWSHandler = class {
  constructor(handlers, options = {}) {
    this.clients = /* @__PURE__ */ new Map();
    this.recordingManager = null;
    this.lastAutoSavedExport = null;
    this.handlers = handlers;
    this.verbose = options.verbose ?? false;
    this.log = options.log ?? console.log;
    if (options.recording) {
      this.recordingManager = new RecordingSessionManager(
        options.recording.registry,
        options.recording.changeObserver ?? null,
        {
          // Wire auto-save to store exports server-side for disconnect recovery
          onAutoSave: (partialExport) => {
            this.lastAutoSavedExport = partialExport;
          }
        }
      );
    }
  }
  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws) {
    const clientId = generateId2();
    const client = {
      id: clientId,
      ws,
      subscription: {
        events: /* @__PURE__ */ new Set(),
        elementIds: /* @__PURE__ */ new Set(),
        componentIds: /* @__PURE__ */ new Set()
      },
      connectedAt: Date.now()
    };
    this.clients.set(clientId, client);
    if (this.verbose) {
      this.log(`[WS] Client connected: ${clientId}`);
    }
    ws.onmessage = (event) => {
      this.handleMessage(clientId, event.data);
    };
    ws.onclose = () => {
      this.handleDisconnect(clientId);
    };
    this.sendToClient(clientId, {
      id: generateId2(),
      type: "welcome",
      timestamp: Date.now(),
      payload: {
        version: VERSION,
        features: {
          renderLog: true,
          control: true,
          debug: true
        },
        clientId
      }
    });
    return clientId;
  }
  /**
   * Handle client disconnect
   */
  handleDisconnect(clientId) {
    this.clients.delete(clientId);
    if (this.verbose) {
      this.log(`[WS] Client disconnected: ${clientId}`);
    }
  }
  /**
   * Handle incoming message
   */
  async handleMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;
    let message;
    try {
      message = JSON.parse(data);
    } catch (_error) {
      this.sendError(clientId, void 0, "PARSE_ERROR", "Invalid JSON message");
      return;
    }
    if (this.verbose) {
      this.log(`[WS] ${clientId} -> ${message.type}`);
    }
    try {
      switch (message.type) {
        case "ping":
          this.handlePing(clientId, message.id);
          break;
        case "subscribe":
          await this.handleSubscribe(clientId, message);
          break;
        case "unsubscribe":
          await this.handleUnsubscribe(clientId, message);
          break;
        case "find":
          await this.handleFind(clientId, message);
          break;
        case "discover":
          await this.handleFind(clientId, message);
          break;
        case "getElement":
          await this.handleGetElement(clientId, message);
          break;
        case "getSnapshot":
          await this.handleGetSnapshot(clientId, message);
          break;
        case "executeAction":
          await this.handleExecuteAction(clientId, message);
          break;
        case "executeComponentAction":
          await this.handleExecuteComponentAction(clientId, message);
          break;
        case "executeWorkflow":
          await this.handleExecuteWorkflow(clientId, message);
          break;
        case "getElementHistory":
          await this.handleGetElementHistory(clientId, message);
          break;
        case "changeEvent": {
          const changePayload = message.payload;
          this.broadcastEvent(
            {
              type: "snapshot:changed",
              timestamp: Date.now(),
              data: changePayload ?? {}
            },
            clientId
          );
          break;
        }
        case "recording:start":
          this.handleRecordingStart(clientId, message);
          break;
        case "recording:stop":
          this.handleRecordingStop(clientId, message);
          break;
        case "recording:status":
          this.handleRecordingStatus(clientId, message);
          break;
        case "recording:autosave":
          this.handleRecordingAutoSave(clientId, message);
          break;
        case "recording:recover":
          this.handleRecordingRecover(clientId, message);
          break;
        default:
          this.sendError(
            clientId,
            message.id,
            "UNKNOWN_MESSAGE",
            `Unknown message type: ${message.type}`
          );
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sendError(clientId, message.id, "HANDLER_ERROR", err.message);
    }
  }
  /**
   * Handle ping message
   */
  handlePing(clientId, _requestId) {
    this.sendToClient(clientId, {
      id: generateId2(),
      type: "pong",
      timestamp: Date.now()
    });
  }
  /**
   * Handle subscribe message
   */
  async handleSubscribe(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    const { events, elementIds, componentIds } = message.payload;
    if (events?.length) {
      for (const event of events) {
        client.subscription.events.add(event);
      }
    }
    if (elementIds?.length) {
      for (const id of elementIds) {
        client.subscription.elementIds.add(id);
      }
    }
    if (componentIds?.length) {
      for (const id of componentIds) {
        client.subscription.componentIds.add(id);
      }
    }
    this.sendToClient(clientId, {
      id: generateId2(),
      type: "subscribed",
      timestamp: Date.now(),
      payload: {
        events: Array.from(client.subscription.events)
      }
    });
  }
  /**
   * Handle unsubscribe message
   */
  async handleUnsubscribe(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    const { events } = message.payload;
    let removedEvents;
    if (events?.length) {
      removedEvents = events.filter((e) => client.subscription.events.has(e));
      for (const event of events) {
        client.subscription.events.delete(event);
      }
    } else {
      removedEvents = Array.from(client.subscription.events);
      client.subscription.events.clear();
      client.subscription.elementIds.clear();
      client.subscription.componentIds.clear();
    }
    this.sendToClient(clientId, {
      id: generateId2(),
      type: "unsubscribed",
      timestamp: Date.now(),
      payload: {
        events: removedEvents
      }
    });
  }
  /**
   * Handle find message
   */
  async handleFind(clientId, message) {
    if (!this.handlers.find) {
      this.sendResponse(clientId, message.id, false, void 0, "find handler not available");
      return;
    }
    const result = await this.handlers.find(message.payload || {});
    if (result.success && result.data) {
      this.sendResponse(clientId, message.id, true, { elements: result.data.elements });
    } else {
      this.sendResponse(clientId, message.id, false, void 0, result.error);
    }
  }
  /**
   * Handle getElement message
   */
  async handleGetElement(clientId, message) {
    const { elementId } = message.payload;
    if (!this.handlers.getElement) {
      this.sendResponse(clientId, message.id, false, void 0, "getElement handler not available");
      return;
    }
    const result = await this.handlers.getElement(elementId);
    if (result.success) {
      this.sendResponse(clientId, message.id, true, { element: result.data });
    } else {
      this.sendResponse(clientId, message.id, false, void 0, result.error);
    }
  }
  /**
   * Handle getSnapshot message
   */
  async handleGetSnapshot(clientId, message) {
    if (!this.handlers.getControlSnapshot) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        void 0,
        "getControlSnapshot handler not available"
      );
      return;
    }
    const result = await this.handlers.getControlSnapshot();
    if (result.success) {
      this.sendResponse(clientId, message.id, true, result.data);
    } else {
      this.sendResponse(clientId, message.id, false, void 0, result.error);
    }
  }
  /**
   * Handle executeAction message
   */
  async handleExecuteAction(clientId, message) {
    const { elementId, action } = message.payload;
    if (!this.handlers.executeElementAction) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        void 0,
        "executeElementAction handler not available"
      );
      return;
    }
    const result = await this.handlers.executeElementAction(elementId, action);
    this.sendResponse(clientId, message.id, result.success, result.data, result.error);
  }
  /**
   * Handle executeComponentAction message
   */
  async handleExecuteComponentAction(clientId, message) {
    const { componentId, action, params } = message.payload;
    if (!this.handlers.executeComponentAction) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        void 0,
        "executeComponentAction handler not available"
      );
      return;
    }
    const result = await this.handlers.executeComponentAction(componentId, { action, params });
    this.sendResponse(clientId, message.id, result.success, result.data, result.error);
  }
  /**
   * Handle executeWorkflow message
   */
  async handleExecuteWorkflow(clientId, message) {
    const { workflowId, params } = message.payload;
    if (!this.handlers.runWorkflow) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        void 0,
        "runWorkflow handler not available"
      );
      return;
    }
    const result = await this.handlers.runWorkflow(workflowId, { params });
    this.sendResponse(clientId, message.id, result.success, result.data, result.error);
  }
  /**
   * Handle getElementHistory message
   */
  async handleGetElementHistory(clientId, message) {
    const { elementId, options } = message.payload;
    if (!this.handlers.getElementHistory) {
      this.sendResponse(
        clientId,
        message.id,
        false,
        void 0,
        "getElementHistory handler not available"
      );
      return;
    }
    const result = await this.handlers.getElementHistory(elementId, options);
    if (result.success) {
      this.sendResponse(clientId, message.id, true, { entries: result.data });
    } else {
      this.sendResponse(clientId, message.id, false, void 0, result.error);
    }
  }
  /**
   * Broadcast event to all subscribed clients
   * @param excludeClientId - optional client ID to skip (e.g. the sender)
   */
  broadcastEvent(event, excludeClientId) {
    for (const [clientId, client] of this.clients) {
      if (clientId === excludeClientId) continue;
      if (client.subscription.events.size === 0 || client.subscription.events.has(event.type)) {
        const eventData = event.data;
        if (eventData.elementId && client.subscription.elementIds.size > 0 && !client.subscription.elementIds.has(eventData.elementId)) {
          continue;
        }
        if (eventData.componentId && client.subscription.componentIds.size > 0 && !client.subscription.componentIds.has(eventData.componentId)) {
          continue;
        }
        this.sendToClient(clientId, {
          id: generateId2(),
          type: "event",
          timestamp: Date.now(),
          payload: event
        });
      }
    }
  }
  /**
   * Send message to specific client
   */
  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== 1) return;
    try {
      client.ws.send(JSON.stringify(message));
      if (this.verbose && message.type !== "pong") {
        this.log(`[WS] ${clientId} <- ${message.type}`);
      }
    } catch (error) {
      console.error(`Failed to send message to ${clientId}:`, error);
    }
  }
  /**
   * Send response message
   */
  sendResponse(clientId, requestId, success, data, error) {
    this.sendToClient(clientId, {
      id: generateId2(),
      type: "response",
      timestamp: Date.now(),
      requestId,
      payload: {
        success,
        data,
        error
      }
    });
  }
  /**
   * Send error message
   */
  sendError(clientId, requestId, code, message) {
    this.sendToClient(clientId, {
      id: generateId2(),
      type: "error",
      timestamp: Date.now(),
      requestId,
      payload: {
        code,
        message
      }
    });
  }
  /**
   * Get connected client count
   */
  get clientCount() {
    return this.clients.size;
  }
  /**
   * Get all connected client IDs
   */
  get clientIds() {
    return Array.from(this.clients.keys());
  }
  /**
   * Disconnect all clients
   */
  disconnectAll() {
    for (const [_clientId, client] of this.clients) {
      try {
        client.ws.close();
      } catch {
      }
    }
    this.clients.clear();
  }
  // ==========================================================================
  // Recording Handlers
  // ==========================================================================
  handleRecordingStart(clientId, message) {
    if (!this.recordingManager) {
      this.sendError(
        clientId,
        message.id,
        "RECORDING_UNAVAILABLE",
        "Recording not configured \u2014 registry not provided"
      );
      return;
    }
    try {
      const config = message.payload?.config;
      this.recordingManager.start(config);
      const status = this.recordingManager.getStatus();
      this.sendResponse(clientId, message.id, true, status);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sendError(clientId, message.id, "RECORDING_START_ERROR", err.message);
    }
  }
  handleRecordingStop(clientId, message) {
    if (!this.recordingManager) {
      this.sendError(clientId, message.id, "RECORDING_UNAVAILABLE", "Recording not configured");
      return;
    }
    try {
      const result = this.recordingManager.stop();
      this.sendResponse(clientId, message.id, true, result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sendError(clientId, message.id, "RECORDING_STOP_ERROR", err.message);
    }
  }
  handleRecordingStatus(clientId, message) {
    if (!this.recordingManager) {
      this.sendResponse(clientId, message.id, true, {
        active: false,
        duration: 0,
        interactionCount: 0,
        captureCount: 0
      });
      return;
    }
    const status = this.recordingManager.getStatus();
    this.sendResponse(clientId, message.id, true, status);
  }
  /**
   * Handle recording:autosave — stores the latest auto-saved export data.
   * Called by the client or internally when the auto-save callback fires.
   */
  handleRecordingAutoSave(clientId, message) {
    try {
      const payload = message.payload;
      if (payload?.exportData) {
        this.lastAutoSavedExport = payload.exportData;
        this.sendResponse(clientId, message.id, true, { stored: true });
      } else {
        this.sendError(
          clientId,
          message.id,
          "AUTOSAVE_INVALID",
          "Missing exportData in autosave payload"
        );
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.sendError(clientId, message.id, "AUTOSAVE_ERROR", err.message);
    }
  }
  /**
   * Handle recording:recover — returns the last auto-saved export data.
   * Used by clients to recover partial recording data after a disconnect.
   */
  handleRecordingRecover(clientId, message) {
    if (this.lastAutoSavedExport) {
      this.sendResponse(clientId, message.id, true, {
        recovered: true,
        exportData: this.lastAutoSavedExport
      });
    } else {
      this.sendResponse(clientId, message.id, true, {
        recovered: false,
        exportData: null
      });
    }
  }
};

// src/server/ws-stream-adapter.ts
function createWSStreamBroadcast(wsHandler, config) {
  const log = config?.log;
  return (event) => {
    if (wsHandler.clientCount === 0) {
      return;
    }
    if (log) {
      log(`[ws-stream] Broadcasting ${event.type} to ${wsHandler.clientCount} client(s)`);
    }
    wsHandler.broadcastEvent(event);
  };
}

// src/server/sse-handler.ts
var SSEManager = class {
  constructor() {
    this.clients = /* @__PURE__ */ new Map();
    this.sequence = 0;
    this.heartbeatInterval = null;
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 15e3);
  }
  /**
   * Register a new SSE client connection.
   *
   * @param write - Function to write raw SSE data to the response
   * @param close - Function to close the connection
   * @param typeFilter - Optional comma-separated event types to filter
   * @param elementFilter - Optional comma-separated element IDs to filter
   * @returns Client ID (for cleanup on disconnect)
   */
  addClient(write, close, typeFilter, elementFilter) {
    const id = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const types = /* @__PURE__ */ new Set();
    if (typeFilter) {
      for (const t of typeFilter.split(",")) {
        const trimmed = t.trim();
        if (trimmed) types.add(trimmed);
      }
    }
    const elements = /* @__PURE__ */ new Set();
    if (elementFilter) {
      for (const e of elementFilter.split(",")) {
        const trimmed = e.trim();
        if (trimmed) elements.add(trimmed);
      }
    }
    const client = {
      id,
      write,
      close,
      typeFilter: types,
      elementFilter: elements,
      connectedAt: Date.now()
    };
    this.clients.set(id, client);
    this.sendToClient(client, "connected", {
      clientId: id,
      timestamp: Date.now(),
      filters: {
        types: types.size > 0 ? Array.from(types) : "all",
        elements: elements.size > 0 ? Array.from(elements) : "all"
      }
    });
    return id;
  }
  /**
   * Remove a client (called on disconnect)
   */
  removeClient(id) {
    this.clients.delete(id);
  }
  /**
   * Broadcast a BridgeEvent to all matching SSE clients.
   * Call this from the registry's onEvent callback.
   */
  broadcast(event) {
    if (this.clients.size === 0) return;
    const eventData = event.data;
    const elementId = eventData?.elementId || eventData?.id;
    for (const client of this.clients.values()) {
      if (client.typeFilter.size > 0 && !client.typeFilter.has(event.type)) {
        continue;
      }
      if (client.elementFilter.size > 0 && elementId && !client.elementFilter.has(elementId)) {
        continue;
      }
      this.sendToClient(client, event.type, event);
    }
  }
  /**
   * Number of connected clients
   */
  get clientCount() {
    return this.clients.size;
  }
  /**
   * Dispose — stop heartbeat and close all connections
   */
  dispose() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const client of this.clients.values()) {
      try {
        client.close();
      } catch {
      }
    }
    this.clients.clear();
  }
  // ---- Private ----
  sendToClient(client, eventType, data) {
    const id = ++this.sequence;
    const payload = `event: ${eventType}
data: ${JSON.stringify(data)}
id: ${id}

`;
    try {
      client.write(payload);
    } catch {
      this.clients.delete(client.id);
    }
  }
  sendHeartbeat() {
    const payload = `event: heartbeat
data: ${JSON.stringify({ timestamp: Date.now(), clients: this.clients.size })}

`;
    const failed = [];
    for (const client of this.clients.values()) {
      try {
        client.write(payload);
      } catch {
        failed.push(client.id);
      }
    }
    for (const id of failed) {
      this.clients.delete(id);
    }
  }
};

// src/server/standalone.ts
var DEFAULT_CONFIG = {
  host: "localhost",
  port: 9876,
  websocket: false,
  websocketPort: 9876,
  log: console.log
};
function wrapError(error, code) {
  return {
    success: false,
    error: typeof error === "string" ? error : error.message,
    code,
    timestamp: Date.now()
  };
}
var StandaloneServer = class {
  constructor(handlers, config = {}) {
    this.server = null;
    this.wsServer = null;
    this.wsHandler = null;
    this.wsConnections = /* @__PURE__ */ new Set();
    this.handlers = handlers;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sseManager = new SSEManager();
    if (this.config.websocket) {
      this.wsHandler = new UIBridgeWSHandler(handlers, {
        verbose: true,
        log: this.config.log,
        recording: this.config.recording
      });
    }
  }
  /**
   * Get enabled capabilities based on handlers
   */
  getCapabilities() {
    return [
      "elements",
      "components",
      "discovery",
      "navigation",
      "ai",
      "change_tracking",
      "idle_detection",
      "network",
      "forms",
      "design",
      "debug",
      "events",
      "annotations",
      "state_management",
      "clipboard",
      "undo_redo",
      "recovery",
      "intents"
    ];
  }
  /**
   * Start the server
   */
  async start() {
    const http = await import('http');
    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });
    if (this.config.websocket && this.wsHandler) {
      await this.startWebSocketServer();
    }
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, () => {
        this.config.log(
          `UI Bridge server listening on http://${this.config.host}:${this.config.port}`
        );
        if (this.config.websocket) {
          const wsPort = this.config.websocketPort || this.config.port;
          this.config.log(
            `UI Bridge WebSocket server listening on ws://${this.config.host}:${wsPort}`
          );
        }
        resolve();
      });
      this.server.on("error", reject);
    });
  }
  /**
   * Start WebSocket server
   */
  async startWebSocketServer() {
    try {
      const { WebSocketServer } = await import('ws');
      const wsPort = this.config.websocketPort || this.config.port;
      const useSamePort = wsPort === this.config.port;
      if (useSamePort && this.server) {
        this.wsServer = new WebSocketServer({ server: this.server });
      } else {
        this.wsServer = new WebSocketServer({
          host: this.config.host,
          port: wsPort
        });
      }
      const wss = this.wsServer;
      wss.on("connection", (ws) => {
        this.wsConnections.add(ws);
        this.wsHandler.handleConnection(ws);
        ws.onclose = () => {
          this.wsConnections.delete(ws);
        };
      });
      wss.on("error", (error) => {
        this.config.log(`WebSocket server error: ${error.message}`);
      });
    } catch (_error) {
      this.config.log(
        'Warning: WebSocket support requires the "ws" package. Install it with: npm install ws'
      );
      this.wsHandler = null;
    }
  }
  /**
   * Stop the server
   */
  async stop() {
    if (this.wsHandler) {
      this.wsHandler.disconnectAll();
    }
    if (this.wsServer) {
      const wss = this.wsServer;
      wss.close();
      this.wsServer = null;
    }
    for (const ws of this.wsConnections) {
      ws.close();
    }
    this.wsConnections.clear();
    this.sseManager.dispose();
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  /**
   * Handle an HTTP request
   */
  async handleRequest(req, res) {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const method = req.method || "GET";
    const basePath = this.config.basePath || "/ui-bridge";
    if (this.config.cors) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/health" || url.pathname === "/status") {
      const healthResponse = { status: "ok", timestamp: Date.now() };
      if (this.config.appInfo) {
        const uiBridge = {
          version: "0.3.0",
          ...this.config.appInfo,
          capabilities: this.getCapabilities()
        };
        try {
          const snapshotResult = await this.handlers.getControlSnapshot?.();
          if (snapshotResult?.success && snapshotResult.data) {
            const data = snapshotResult.data;
            uiBridge.elementCount = data.elements?.length ?? 0;
            uiBridge.componentCount = data.components?.length ?? 0;
          }
        } catch {
        }
        healthResponse.uiBridge = uiBridge;
      }
      this.sendJSON(res, healthResponse);
      return;
    }
    let path = url.pathname;
    if (path.startsWith(basePath)) {
      path = path.slice(basePath.length) || "/";
    }
    if (path === "/control/events/stream" && method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      const types = url.searchParams.get("types") || void 0;
      const elements = url.searchParams.get("elements") || void 0;
      const clientId = this.sseManager.addClient(
        (data) => {
          res.write(data);
          return true;
        },
        () => {
          if (!res.writableEnded) res.end();
        },
        types,
        elements
      );
      req.on("close", () => {
        this.sseManager.removeClient(clientId);
      });
      return;
    }
    if (path === "/control/changes/stream" && method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      const clientId = this.sseManager.addClient(
        (data) => {
          res.write(data);
          return true;
        },
        () => {
          if (!res.writableEnded) res.end();
        },
        "snapshot:changed"
      );
      req.on("close", () => {
        this.sseManager.removeClient(clientId);
      });
      return;
    }
    const route = this.findRoute(path, method);
    if (!route) {
      this.sendJSON(res, wrapError("Not found", "NOT_FOUND"), 404);
      return;
    }
    try {
      let body = {};
      if (method === "POST" || method === "PUT" || method === "PATCH" || route.bodyRequired) {
        body = await this.parseBody(req);
      }
      const params = this.extractParams(path, route.path);
      const handlerName = route.handler;
      const handler = this.handlers[handlerName];
      if (!handler) {
        this.sendJSON(res, wrapError("Not implemented", "NOT_IMPLEMENTED"), 501);
        return;
      }
      const args = [];
      if (route.params) {
        for (const param of route.params) {
          args.push(params[param]);
        }
      }
      if (route.bodyRequired || method === "POST" || method === "PUT" || method === "PATCH") {
        args.push(body);
      }
      if (method === "GET") {
        const query = Object.fromEntries(url.searchParams);
        if (Object.keys(query).length > 0) {
          args.push(query);
        }
      }
      const result = await handler(
        ...args
      );
      this.sendJSON(res, result);
    } catch (error) {
      this.config.log(`Error handling ${method} ${path}: ${error}`);
      this.sendJSON(res, wrapError(error, "INTERNAL_ERROR"), 500);
    }
  }
  /**
   * Find a matching route
   */
  findRoute(path, method) {
    for (const route of UI_BRIDGE_ROUTES) {
      if (route.method !== method) continue;
      const routeRegex = route.path.replace(/:[^/]+/g, "([^/]+)").replace(/\//g, "\\/");
      const regex = new RegExp(`^${routeRegex}$`);
      if (regex.test(path)) {
        return route;
      }
    }
    return null;
  }
  /**
   * Extract params from path
   */
  extractParams(path, routePath) {
    const params = {};
    const routeParts = routePath.split("/");
    const pathParts = path.split("/");
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        params[routeParts[i].slice(1)] = pathParts[i];
      }
    }
    return params;
  }
  /**
   * Parse request body
   */
  parseBody(req, maxBytes = 10 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      let data = "";
      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        if (bytes > maxBytes) {
          req.destroy();
          reject(new Error("Request body too large"));
          return;
        }
        data += chunk;
      });
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
      req.on("error", reject);
    });
  }
  /**
   * Send JSON response (safe against circular refs from DOM nodes)
   */
  sendJSON(res, data, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json" });
    const seen = /* @__PURE__ */ new WeakSet();
    res.end(
      JSON.stringify(data, (_key, val) => {
        if (val !== null && typeof val === "object") {
          if (typeof Node !== "undefined" && val instanceof Node)
            return `[${val.constructor.name}]`;
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        if (typeof val === "function") return void 0;
        return val;
      })
    );
  }
  /**
   * Broadcast a message to all WebSocket connections (legacy)
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const ws of this.wsConnections) {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }
  /**
   * Broadcast an event to all subscribed WebSocket and SSE clients
   */
  broadcastEvent(event) {
    if (this.wsHandler) {
      this.wsHandler.broadcastEvent(event);
    }
    this.sseManager.broadcast(event);
  }
  /**
   * Get the SSE manager for direct access (e.g., wiring to registry.onEvent)
   */
  getSSEManager() {
    return this.sseManager;
  }
  /**
   * Create an `onBrowserEvent` callback wired to the WS handler's broadcast.
   *
   * Call this **before** `createHandlers()` to get a callback you can pass as
   * `config.onBrowserEvent`. The internal BrowserEventStream in handlers.ts
   * will auto-subscribe and forward classified events through this callback
   * to all connected WebSocket clients.
   *
   * Returns `undefined` if WebSocket is not enabled, so it's safe to spread
   * into the config unconditionally.
   *
   * @example
   * ```ts
   * const server = new StandaloneServer({}, { websocket: true, port: 9876 });
   * const handlers = createHandlers(registry, executor, {
   *   onBrowserEvent: server.createBrowserEventCallback(),
   * });
   * ```
   */
  createBrowserEventCallback() {
    if (!this.wsHandler) {
      return void 0;
    }
    return createWSStreamBroadcast(this.wsHandler, { log: this.config.log });
  }
  /**
   * Create an `onChangeEvent` callback wired to SSE + WS broadcast.
   *
   * Call this **before** `createHandlers()` to get a callback you can pass as
   * `config.onChangeEvent`. The ChangeObserver in handlers.ts will forward
   * batched DOM change events through this callback to all connected clients.
   */
  createChangeEventCallback() {
    return (event) => {
      this.broadcastEvent(event);
    };
  }
  /**
   * Get WebSocket handler for direct access
   */
  getWSHandler() {
    return this.wsHandler;
  }
  /**
   * Get number of connected WebSocket clients
   */
  get wsClientCount() {
    return this.wsHandler?.clientCount ?? 0;
  }
  /**
   * Get the server address
   */
  getAddress() {
    const address = this.server?.address();
    if (!address || typeof address === "string") return null;
    return { host: this.config.host, port: address.port };
  }
};
async function createStandaloneServer(handlers, config) {
  const server = new StandaloneServer(handlers, config);
  await server.start();
  return server;
}
async function startCLI(handlers, args = process.argv.slice(2)) {
  const config = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === "--port" || arg === "-p") {
      config.port = parseInt(nextArg);
      i++;
    } else if (arg === "--host" || arg === "-h") {
      config.host = nextArg;
      i++;
    } else if (arg === "--cors") {
      config.cors = true;
    }
  }
  const server = await createStandaloneServer(handlers, config);
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await server.stop();
    process.exit(0);
  });
}

export { StandaloneServer, createStandaloneServer, startCLI };
//# sourceMappingURL=standalone.mjs.map
//# sourceMappingURL=standalone.mjs.map