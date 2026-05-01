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

// src/debug/shared-utils.ts
var shared_utils_exports = {};
__export(shared_utils_exports, {
  getEventStack: () => getEventStack
});
function getEventStack(event) {
  if ("stack" in event) return event.stack;
  return void 0;
}
var init_shared_utils = __esm({
  "src/debug/shared-utils.ts"() {
  }
});

// src/debug/error-fingerprint.ts
var error_fingerprint_exports = {};
__export(error_fingerprint_exports, {
  computeFingerprint: () => computeFingerprint,
  deduplicateEvents: () => deduplicateEvents,
  extractSourceLocation: () => extractSourceLocation
});
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
var UUID_RE, UUID_TEST_RE, HEX_RE, TIMESTAMP_RE, UNIX_TS_RE, NUMBER_RE, SKIP_FRAME_PATTERNS, V8_FRAME_RE, SPIDERMONKEY_FRAME_RE, JSC_BARE_RE;
var init_error_fingerprint = __esm({
  "src/debug/error-fingerprint.ts"() {
    init_shared_utils();
    UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    UUID_TEST_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    HEX_RE = /\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/gi;
    TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g;
    UNIX_TS_RE = /\b\d{10,13}\b/g;
    NUMBER_RE = /\b\d+\b/g;
    SKIP_FRAME_PATTERNS = [
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
    V8_FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
    SPIDERMONKEY_FRAME_RE = /^(.+?)@(.+?):(\d+):(\d+)$/;
    JSC_BARE_RE = /^(.+?):(\d+):(\d+)$/;
  }
});

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

// src/server/dom-fallback.ts
var INTERACTIVE_SELECTORS = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="textbox"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  "[onclick]",
  "[data-ui-element]",
  "[data-testid]",
  "details > summary"
];
var COMBINED_SELECTOR = INTERACTIVE_SELECTORS.join(", ");
function inferType(el) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  if (role) return role;
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "select") return "select";
  if (tag === "textarea") return "textarea";
  if (tag === "details" || tag === "summary") return "disclosure";
  if (tag === "input") {
    const inputType = el.type?.toLowerCase() ?? "text";
    if (inputType === "checkbox") return "checkbox";
    if (inputType === "radio") return "radio";
    if (inputType === "submit" || inputType === "button" || inputType === "reset") return "button";
    return "input";
  }
  if (el.hasAttribute("contenteditable")) return "textbox";
  return "interactive";
}
function inferActions(type) {
  switch (type) {
    case "button":
      return ["click"];
    case "link":
      return ["click"];
    case "input":
    case "textbox":
    case "textarea":
      return ["click", "type", "clear", "focus"];
    case "checkbox":
    case "radio":
    case "switch":
    case "disclosure":
      return ["click", "toggle"];
    case "select":
    case "combobox":
    case "listbox":
      return ["click", "select"];
    case "tab":
    case "menuitem":
    case "option":
      return ["click"];
    case "slider":
    case "spinbutton":
      return ["click", "setValue"];
    default:
      return ["click"];
  }
}
function getLabel(el) {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent?.trim() ?? "";
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent?.trim() ?? "";
    }
  }
  const title = el.getAttribute("title");
  if (title) return title;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return el.placeholder;
  }
  const text = el.textContent?.trim() ?? "";
  return text.length > 200 ? text.slice(0, 200) + "\u2026" : text;
}
function isVisible(el) {
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function generateId(el, index) {
  const testId = el.getAttribute("data-testid");
  if (testId) return `dom-${testId}`;
  if (el.id) return `dom-${el.id}`;
  const tag = el.tagName.toLowerCase();
  const type = inferType(el);
  const text = getLabel(el).slice(0, 30).replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  if (text) return `dom-${tag}-${text}`;
  return `dom-${type}-${index}`;
}
function scanDOMForInteractiveElements(root) {
  const container = document.body;
  if (!container) return [];
  const nodeList = container.querySelectorAll(COMBINED_SELECTOR);
  const elements = [];
  const seenIds = /* @__PURE__ */ new Set();
  nodeList.forEach((el, index) => {
    let id = generateId(el, index);
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }
    seenIds.add(id);
    const type = inferType(el);
    const rect = el.getBoundingClientRect();
    elements.push({
      id,
      type,
      label: getLabel(el),
      actions: inferActions(type),
      visible: isVisible(el),
      tagName: el.tagName.toLowerCase(),
      state: {
        textContent: (el.textContent?.trim() ?? "").slice(0, 500),
        value: "value" in el ? el.value : void 0,
        checked: "checked" in el ? el.checked : void 0,
        disabled: "disabled" in el ? el.disabled : void 0,
        visible: isVisible(el),
        enabled: !("disabled" in el && el.disabled),
        focused: document.activeElement === el,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          left: Math.round(rect.left)
        }
      },
      identifiers: {
        testId: el.getAttribute("data-testid") ?? void 0,
        ariaLabel: el.getAttribute("aria-label") ?? void 0,
        htmlId: el.id || void 0
      },
      _domFallback: true
    });
  });
  return elements;
}
function countDOMInteractiveElements(root) {
  const container = document.body;
  if (!container) return 0;
  return container.querySelectorAll(COMBINED_SELECTOR).length;
}
function findElementsByText(text, options) {
  const container = options?.root ?? document.body;
  if (!container) return [];
  const tag = options?.tag;
  const selector = tag ? CSS.escape(tag) : "*";
  const candidates = container.querySelectorAll(selector);
  const results = [];
  const searchText = text.toLowerCase();
  candidates.forEach((el) => {
    const elText = el.textContent?.trim().toLowerCase() ?? "";
    if (options?.exact ? elText === searchText : elText.includes(searchText)) {
      results.push(el);
    }
  });
  return results;
}
function findElementBySelector(selector, index, root) {
  const container = document.body;
  if (!container) return null;
  if (index !== void 0 && index > 0) {
    const all = container.querySelectorAll(selector);
    return all[index] ?? null;
  }
  return container.querySelector(selector);
}
function findElementByLabel(labelText, root) {
  const container = document.body;
  if (!container) return null;
  const labels = container.querySelectorAll("label");
  const searchText = labelText.toLowerCase();
  for (const label of labels) {
    const text = label.textContent?.trim().toLowerCase() ?? "";
    if (text.includes(searchText)) {
      if (label.htmlFor) {
        const target = document.getElementById(label.htmlFor);
        if (target) return target;
      }
      const nested = label.querySelector("input, select, textarea");
      if (nested) return nested;
    }
  }
  const escaped = CSS.escape(labelText);
  const ariaMatch = container.querySelector(`[aria-label*="${escaped}" i]`);
  if (ariaMatch) return ariaMatch;
  const placeholderMatch = container.querySelector(
    `input[placeholder*="${escaped}" i], textarea[placeholder*="${escaped}" i]`
  );
  return placeholderMatch;
}

// src/server/selector-match.ts
function matchesElementSelector(el, selector) {
  if (selector.id && el.id !== selector.id) return false;
  if (selector.type && el.type !== selector.type) return false;
  if (selector.title) {
    const needle = selector.title.toLowerCase();
    const t = (el.title ?? "").toLowerCase();
    const a = (el.ariaLabel ?? "").toLowerCase();
    const l = (el.label ?? "").toLowerCase();
    if (!t.includes(needle) && !a.includes(needle) && !l.includes(needle)) return false;
  }
  if (selector.aria_label) {
    const needle = selector.aria_label.toLowerCase();
    const a = (el.ariaLabel ?? "").toLowerCase();
    const l = (el.label ?? "").toLowerCase();
    if (!a.includes(needle) && !l.includes(needle)) return false;
  }
  if (selector.text) {
    const needle = selector.text.toLowerCase();
    const l = (el.label ?? "").toLowerCase();
    const i = el.id.toLowerCase();
    if (!l.includes(needle) && !i.includes(needle)) return false;
  }
  return true;
}

// src/navigation/navigation-adapter.ts
var WindowLocationAdapter = class {
  getRoutes() {
    return [
      {
        name: document.title || "Current Page",
        path: window.location.pathname
      }
    ];
  }
  async navigate(target) {
    if (target.startsWith("/") || target.startsWith("http")) {
      window.location.href = target;
    } else {
      window.location.href = "/" + target;
    }
  }
  getCurrentRoute() {
    return {
      name: document.title || "Current Page",
      path: window.location.pathname + window.location.search + window.location.hash
    };
  }
};

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

// src/control/action-executor.ts
init_error_fingerprint();

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

// src/debug/error-impact.ts
init_error_fingerprint();

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

// src/control/action-executor.ts
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

// src/ai/nl-assertion-parser.ts
function parseNLAssertion(input) {
  if (input.target && input.type) {
    return { target: String(input.target), type: input.type, expected: input.expected };
  }
  const text = input.assertion ?? "";
  if (!text) {
    return {
      target: String(input.target ?? ""),
      type: String(input.type ?? "exists"),
      expected: input.expected
    };
  }
  const lc = text.toLowerCase().trim();
  if (/\b(no |not |isn't |aren't |doesn't |don't )/.test(lc)) {
    if (/\bvisible\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\s*(is\s+)?visible.*/, "").replace(/\b(there\s+are|on\s+the\s+page)\b/g, "").trim() || text;
      return { target: target2, type: "hidden" };
    }
    if (/\bdisabled\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\s*(is\s+)?disabled.*/, "").trim() || text;
      return { target: target2, type: "enabled" };
    }
    if (/\bchecked\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\s*(is\s+)?checked.*/, "").trim() || text;
      return { target: target2, type: "unchecked" };
    }
    if (/\benabled\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\s*(is\s+)?enabled.*/, "").trim() || text;
      return { target: target2, type: "disabled" };
    }
    if (/\b(exist|present|on the page)\b/.test(lc)) {
      const target2 = lc.replace(/.*?(no|not|doesn't|don't)\s+/, "").replace(/\s*(exist|present|on the page).*/, "").replace(/\b(there\s+are|there\s+is)\b/g, "").trim() || text;
      return { target: target2, type: "notExists" };
    }
    const target = lc.replace(/.*?(no|not|isn't|aren't)\s+/, "").replace(/\b(on the page|visible|exist)\b/g, "").trim() || text;
    return { target, type: "notExists" };
  }
  const typePatterns = [
    [/\bvisible\b/, "visible"],
    [/\benabled\b/, "enabled"],
    [/\bdisabled\b/, "disabled"],
    [/\bhidden\b/, "hidden"],
    [/\bchecked\b/, "checked"],
    [/\bunchecked\b/, "unchecked"],
    [/\bfocused\b/, "focused"],
    [/\bempty\b/, "hasValue"],
    [/\bexist/, "exists"],
    [/\bpresent\b/, "exists"],
    [/\bon the page\b/, "exists"],
    [/\bhas loaded\b/, "exists"],
    [/\bcontains?\b.*['"](.+?)['"]/, "hasText"]
  ];
  for (const [pattern, type] of typePatterns) {
    if (pattern.test(lc)) {
      let target = lc.replace(/\b(is|are|has|have|should be|must be|exists?|present)\b/g, "").replace(pattern, "").replace(/\b(the|a|an|on|page|this)\b/g, "").trim().replace(/\s+/g, " ").trim();
      if (!target) target = text;
      if (type === "hasText") {
        const match = lc.match(/contains?\s+['"](.+?)['"]/);
        if (match) {
          return {
            target: target.replace(/['"].*?['"]/g, "").trim() || text,
            type,
            expected: match[1]
          };
        }
      }
      if (type === "hasValue" && input.expected === void 0) {
        return { target, type, expected: "" };
      }
      return { target, type };
    }
  }
  return { target: text, type: "exists" };
}

// src/ai/target-decomposer.ts
var NOISE_WORDS = /* @__PURE__ */ new Set(["the", "a", "an", "that", "this", "those", "these", "its", "my"]);
var ELEMENT_TYPE_SYNONYMS = [
  // Inputs / form
  { type: "textarea", synonyms: ["text area", "text field", "text box"] },
  { type: "input", synonyms: ["input", "field", "textbox"] },
  { type: "select", synonyms: ["drop down", "dropdown", "combo box", "combobox", "select"] },
  { type: "checkbox", synonyms: ["check box", "checkbox"] },
  { type: "radio", synonyms: ["radio button", "radio"] },
  // Buttons / links
  // 'icon' is a soft hint — "settings icon" is usually a button but could
  // also be a passive image; let the label match decide if the type fails.
  { type: "button", synonyms: ["button"] },
  { type: "button", synonyms: ["icon"], softHint: true },
  { type: "link", synonyms: ["link", "hyperlink", "anchor"] },
  // Navigation
  { type: "tab", synonyms: ["tab"] },
  { type: "menuitem", synonyms: ["menu item", "menuitem"] },
  { type: "menu", synonyms: ["menu"] },
  // Disclosure / accordion family
  // Multi-word phrases (e.g., "details toggle") sit above the bare "toggle"
  // synonym below so they win precedence. The single-word "details" is
  // softHint because it commonly appears as label text ("Job details"); a
  // label match should still work when nothing else flags this as
  // a disclosure.
  {
    type: "disclosure",
    synonyms: [
      "details toggle",
      "details panel",
      "disclosure",
      "accordion",
      "collapsible",
      "expander",
      "expandable"
    ]
  },
  {
    type: "disclosure",
    synonyms: ["expand", "collapse", "details"],
    softHint: true
  },
  // Switch / toggle
  // Plain "toggle" is a soft hint — "details toggle" already routed above to
  // disclosure; in other contexts the matcher should fall back to a
  // label-only retry rather than hard-pinning the type.
  { type: "switch", synonyms: ["switch"] },
  { type: "switch", synonyms: ["toggle"], softHint: true },
  // Misc
  { type: "slider", synonyms: ["slider"] },
  { type: "label", synonyms: ["label"] },
  { type: "heading", synonyms: ["heading"] }
];
function compileSynonym(type, synonym, softHint) {
  const tokens = synonym.trim().split(/\s+/);
  const escaped = tokens.map((t) => escapeRegExp(t)).join("\\s+");
  return {
    pattern: new RegExp(`\\b${escaped}\\b`, "i"),
    type,
    softHint,
    synonym,
    wordCount: tokens.length
  };
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var COMPILED_ELEMENT_TYPE_SYNONYMS = (() => {
  const compiled = [];
  for (const entry of ELEMENT_TYPE_SYNONYMS) {
    for (const syn of entry.synonyms) {
      compiled.push(compileSynonym(entry.type, syn, entry.softHint === true));
    }
  }
  compiled.sort((a, b) => {
    if (b.wordCount !== a.wordCount) return b.wordCount - a.wordCount;
    return b.synonym.length - a.synonym.length;
  });
  return compiled;
})();
function isSoftTypeHint(decomposed) {
  return decomposed.__softTypeHint === true;
}
var SPATIAL_PATTERNS = [
  { pattern: /\bnext\s+to\s+(.+)$/i, relation: "near" },
  { pattern: /\bbeside\s+(.+)$/i, relation: "near" },
  { pattern: /\bnear\s+(.+)$/i, relation: "near" },
  { pattern: /\babove\s+(.+)$/i, relation: "above" },
  { pattern: /\bbelow\s+(.+)$/i, relation: "below" },
  { pattern: /\bunder(?:neath)?\s+(.+)$/i, relation: "below" },
  { pattern: /\bleft\s+of\s+(.+)$/i, relation: "leftOf" },
  { pattern: /\bright\s+of\s+(.+)$/i, relation: "rightOf" },
  { pattern: /\binside\s+(.+)$/i, relation: "inside" }
];
var CONTAINER_PATTERNS = [
  /\b(?:in|within|inside)\s+(?:the\s+)?(.+?)(?:\s+(?:near|above|below|left of|right of|next to|beside)|\s*$)/i
];
var ORDINAL_MAP = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  last: -1,
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
  "4th": 4,
  "5th": 5,
  "6th": 6,
  "7th": 7,
  "8th": 8,
  "9th": 9,
  "10th": 10
};
var STATE_FILTERS = /* @__PURE__ */ new Set([
  "disabled",
  "enabled",
  "active",
  "selected",
  "checked",
  "focused",
  "hidden",
  "visible"
]);
function decomposeTarget(description) {
  let remaining = description.trim();
  const result = { elementText: "" };
  remaining = extractStateFilter(remaining, result);
  remaining = extractSpatialRelation(remaining, result);
  if (!result.spatial || result.spatial.relation !== "inside") {
    remaining = extractContainer(remaining, result);
  } else {
    result.container = result.spatial.referenceDescription;
    result.spatial = void 0;
  }
  remaining = extractOrdinal(remaining, result);
  remaining = extractElementType(remaining, result);
  result.elementText = cleanElementText(remaining);
  if (result.elementText) {
    result.label = result.elementText;
    result.ariaLabel = result.elementText;
    result.placeholder = result.elementText;
    result.name = result.elementText;
  }
  return result;
}
function extractStateFilter(text, result) {
  for (const state of STATE_FILTERS) {
    const regex = new RegExp(`\\b${state}\\b`, "i");
    if (regex.test(text)) {
      result.stateFilter = state;
      return text.replace(regex, " ").trim();
    }
  }
  return text;
}
function extractSpatialRelation(text, result) {
  for (const { pattern, relation } of SPATIAL_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.spatial = {
        relation,
        referenceDescription: cleanReferenceDescription(match[1])
      };
      return text.slice(0, match.index).trim();
    }
  }
  return text;
}
function extractContainer(text, result) {
  for (const pattern of CONTAINER_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const container = cleanReferenceDescription(match[1]);
      if (container.length > 2 && !isPartOfCompoundWord(text, match.index)) {
        result.container = container;
        return text.slice(0, match.index).trim();
      }
    }
  }
  return text;
}
function isPartOfCompoundWord(text, matchIndex, _word) {
  const before = text.slice(0, matchIndex).trim().toLowerCase();
  const compoundPrefixes = ["sign", "log", "opt", "check", "plug", "fill", "zoom", "fade", "drop"];
  return compoundPrefixes.some((prefix) => before.endsWith(prefix));
}
function extractOrdinal(text, result) {
  for (const [word, value] of Object.entries(ORDINAL_MAP)) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(text)) {
      result.ordinal = value;
      return text.replace(regex, " ").trim();
    }
  }
  const numericMatch = text.match(/\b(\d+)(?:st|nd|rd|th)\b/i);
  if (numericMatch) {
    result.ordinal = parseInt(numericMatch[1], 10);
    return text.replace(numericMatch[0], " ").trim();
  }
  return text;
}
function extractElementType(text, result) {
  for (const entry of COMPILED_ELEMENT_TYPE_SYNONYMS) {
    if (entry.pattern.test(text)) {
      result.elementType = entry.type;
      if (entry.softHint) {
        result.__softTypeHint = true;
      }
      return text.replace(entry.pattern, " ").trim();
    }
  }
  return text;
}
function cleanElementText(text) {
  const words = text.split(/\s+/).filter((w) => !NOISE_WORDS.has(w.toLowerCase()));
  return words.join(" ").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
}
function cleanReferenceDescription(text) {
  return text.replace(/^(?:the|a|an)\s+/i, "").replace(/\s+/g, " ").trim();
}

// src/ai/find.ts
var DEFAULT_FIND_OPTIONS = {
  context: {},
  pickFirst: true,
  confidenceThreshold: 0.5,
  maxResults: 5
};
var AMBIGUITY_GAP = 0.1;
var MODAL_PENALTY = 0.3;
var RECENCY_BONUS = 0.05;
function find(query, engine, options) {
  const startTime = performance.now();
  const opts = { ...DEFAULT_FIND_OPTIONS, ...options };
  if (typeof opts.confidenceThreshold !== "number" || Number.isNaN(opts.confidenceThreshold)) {
    opts.confidenceThreshold = DEFAULT_FIND_OPTIONS.confidenceThreshold;
  }
  let criteria;
  let decomposed;
  if (typeof query === "string") {
    decomposed = decomposeTarget(query);
    criteria = resolveCriteria(decomposed, engine, opts);
  } else {
    criteria = query;
    const elementText = query.text || query.textContent || query.accessibleName || "";
    decomposed = {
      elementText,
      elementType: query.type,
      label: elementText || void 0,
      ariaLabel: query.accessibleName || elementText || void 0,
      placeholder: query.placeholder || elementText || void 0,
      name: elementText || void 0
    };
  }
  let searchResponse = engine.search(criteria);
  let results = applyContextScoring(searchResponse.results, opts.context || {}, engine);
  if (decomposed.stateFilter) {
    results = applyStateFilter(results, decomposed.stateFilter);
  }
  if (decomposed.ordinal) {
    results = applyOrdinalFilter(results, decomposed.ordinal);
  }
  let viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);
  if (viableResults.length === 0 && typeof query === "string" && isSoftTypeHint(decomposed) && criteria.type) {
    const relaxed = { ...criteria };
    delete relaxed.type;
    searchResponse = engine.search(relaxed);
    results = applyContextScoring(searchResponse.results, opts.context || {}, engine);
    if (decomposed.stateFilter) {
      results = applyStateFilter(results, decomposed.stateFilter);
    }
    if (decomposed.ordinal) {
      results = applyOrdinalFilter(results, decomposed.ordinal);
    }
    viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);
  }
  if (viableResults.length === 0 && typeof query === "string" && criteria.type && decomposed.elementType) {
    const cachedTypeLower = String(criteria.type).toLowerCase();
    const cachedSummaries = engine.getCachedElementSummaries();
    const typeIsPresent = cachedSummaries.some((el) => el.type.toLowerCase() === cachedTypeLower);
    if (!typeIsPresent) {
      const relaxed = { ...criteria };
      delete relaxed.type;
      searchResponse = engine.search(relaxed);
      results = applyContextScoring(searchResponse.results, opts.context || {}, engine);
      if (decomposed.stateFilter) {
        results = applyStateFilter(results, decomposed.stateFilter);
      }
      if (decomposed.ordinal) {
        results = applyOrdinalFilter(results, decomposed.ordinal);
      }
      viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);
    }
  }
  const durationMs = performance.now() - startTime;
  if (viableResults.length === 0) {
    return {
      found: false,
      ambiguous: false,
      reason: results.length > 0 ? `Best match confidence (${(results[0].confidence * 100).toFixed(0)}%) below threshold (${(opts.confidenceThreshold * 100).toFixed(0)}%)` : `No elements matching "${decomposed.elementText}" found`,
      partialMatches: results.slice(0, opts.maxResults).map((r) => toCandidate(r)),
      // Diagnostic: how many elements were considered before filtering.
      // Helps agents distinguish "searched 200 elements, none matched" from
      // "searched 10 elements (snapshot truncated?)".
      consideredCount: searchResponse.results.length,
      decomposed,
      durationMs
    };
  }
  const isAmbiguous = viableResults.length >= 2 && viableResults[0].confidence - viableResults[1].confidence < AMBIGUITY_GAP;
  if (isAmbiguous && !opts.pickFirst) {
    const candidates = viableResults.slice(0, opts.maxResults).map((r) => toCandidate(r));
    return {
      found: true,
      ambiguous: true,
      candidates,
      suggestion: generateDisambiguationSuggestion(candidates, decomposed),
      decomposed,
      durationMs
    };
  }
  const best = viableResults[0];
  const alternatives = viableResults.slice(1, opts.maxResults).map((r) => toCandidate(r));
  return {
    found: true,
    ambiguous: false,
    element: best.element,
    elementId: best.element.id,
    confidence: best.confidence,
    matchReasons: best.matchReasons,
    alternatives,
    decomposed,
    durationMs
  };
}
function resolveCriteria(decomposed, engine, opts) {
  const criteria = {
    fuzzy: true,
    fuzzyThreshold: opts.confidenceThreshold
  };
  if (decomposed.elementText) {
    criteria.text = decomposed.elementText;
  }
  if (decomposed.elementType) {
    criteria.type = decomposed.elementType;
  }
  if (decomposed.label && decomposed.label !== decomposed.elementText) {
    criteria.accessibleName = decomposed.label;
  } else if (decomposed.ariaLabel && decomposed.ariaLabel !== decomposed.elementText && !criteria.accessibleName) {
    criteria.accessibleName = decomposed.ariaLabel;
  }
  if (decomposed.placeholder && decomposed.placeholder !== decomposed.elementText) {
    criteria.placeholder = decomposed.placeholder;
  }
  if (decomposed.spatial) {
    const refResult = engine.findBest({
      text: decomposed.spatial.referenceDescription,
      fuzzy: true,
      fuzzyThreshold: 0.5
    });
    if (refResult && refResult.confidence >= 0.5) {
      criteria.near = refResult.element.id;
    }
  }
  if (decomposed.container) {
    const containerResult = engine.findBest({
      text: decomposed.container,
      fuzzy: true,
      fuzzyThreshold: 0.4
    });
    if (containerResult && containerResult.confidence >= 0.4) {
      criteria.within = containerResult.element.id;
    }
  }
  return criteria;
}
function applyContextScoring(results, context, engine) {
  if (!context.activeModalId && !context.lastInteractedElement) {
    return results;
  }
  return results.map((result) => {
    let adjustedConfidence = result.confidence;
    const extraReasons = [...result.matchReasons];
    if (context.activeModalId) {
      const inModal = isElementInContainer(result.element, context.activeModalId, engine);
      if (!inModal) {
        adjustedConfidence *= MODAL_PENALTY;
        extraReasons.push("penalty: outside active modal");
      } else {
        extraReasons.push("boost: inside active modal");
      }
    }
    if (context.lastInteractedElement) {
      const nearLastInteracted = isNearElement(
        result.element,
        context.lastInteractedElement,
        engine,
        300
      );
      if (nearLastInteracted) {
        adjustedConfidence = Math.min(1, adjustedConfidence + RECENCY_BONUS);
        extraReasons.push("boost: near last interacted");
      }
    }
    return {
      ...result,
      confidence: adjustedConfidence,
      matchReasons: extraReasons
    };
  }).sort((a, b) => b.confidence - a.confidence);
}
function isElementInContainer(element, containerId, engine) {
  if (element.parentContext && element.parentContext.includes(containerId)) {
    return true;
  }
  const containerResults = engine.findByText(containerId, false);
  if (containerResults.length === 0) return false;
  const containerRect = containerResults[0].element.state.rect;
  const elementRect = element.state.rect;
  return elementRect.x >= containerRect.x && elementRect.y >= containerRect.y && elementRect.x + elementRect.width <= containerRect.x + containerRect.width && elementRect.y + elementRect.height <= containerRect.y + containerRect.height;
}
function isNearElement(element, referenceId, engine, maxDistance) {
  const refResults = engine.findByText(referenceId, false);
  if (refResults.length === 0) return false;
  const refRect = refResults[0].element.state.rect;
  const elRect = element.state.rect;
  const dx = elRect.x + elRect.width / 2 - (refRect.x + refRect.width / 2);
  const dy = elRect.y + elRect.height / 2 - (refRect.y + refRect.height / 2);
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance <= maxDistance;
}
function applyStateFilter(results, stateFilter) {
  return results.filter((r) => {
    const state = r.element.state;
    switch (stateFilter) {
      case "disabled":
        return !state.enabled;
      case "enabled":
        return state.enabled;
      case "focused":
        return state.focused;
      case "visible":
        return state.visible;
      case "hidden":
        return !state.visible;
      case "checked":
        return state.checked === true;
      case "selected":
        return state.ariaSelected === true;
      case "active":
        return state.focused || state.ariaSelected === true;
      default:
        return true;
    }
  });
}
function applyOrdinalFilter(results, ordinal) {
  if (results.length === 0) return results;
  const sorted = [...results].sort((a, b) => {
    const aRect = a.element.state.rect;
    const bRect = b.element.state.rect;
    const yDiff = aRect.y - bRect.y;
    if (Math.abs(yDiff) > 10) return yDiff;
    return aRect.x - bRect.x;
  });
  if (ordinal === -1) {
    return [sorted[sorted.length - 1]];
  }
  const index = ordinal - 1;
  if (index >= 0 && index < sorted.length) {
    return [sorted[index]];
  }
  return results;
}
function toCandidate(result) {
  return {
    element: result.element,
    elementId: result.element.id,
    confidence: result.confidence,
    matchReasons: result.matchReasons,
    differentiator: generateDifferentiator(result.element)
  };
}
function generateDifferentiator(element) {
  const parts = [];
  if (element.parentContext) {
    parts.push(`in ${element.parentContext}`);
  }
  const rect = element.state.rect;
  if (rect.y < 80) {
    parts.push("at the top of the page");
  } else if (rect.y > 800) {
    parts.push("near the bottom of the page");
  }
  if (rect.x < 250) {
    parts.push("in the left panel");
  } else if (rect.x > 1e3) {
    parts.push("in the right panel");
  }
  if (!element.state.enabled) {
    parts.push("(disabled)");
  }
  if (element.state.focused) {
    parts.push("(focused)");
  }
  if (element.semanticType && element.semanticType !== element.type) {
    parts.push(`[${element.semanticType}]`);
  }
  return parts.length > 0 ? parts.join(", ") : `ID: ${element.id}`;
}
function generateDisambiguationSuggestion(candidates, decomposed) {
  const lines = [`Found ${candidates.length} matching "${decomposed.elementText}" elements:`];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const desc = c.element.description || c.element.label || c.elementId;
    lines.push(`  ${i + 1}. "${desc}" \u2014 ${c.differentiator} (${(c.confidence * 100).toFixed(0)}%)`);
  }
  lines.push("");
  lines.push('Try adding spatial context: "... near X" or "... in the Y"');
  return lines.join("\n");
}

// src/ai/form-diff.ts
function captureFormSnapshot() {
  if (typeof document === "undefined") {
    return { forms: [], timestamp: Date.now() };
  }
  const forms = [];
  const formElements = document.querySelectorAll("form");
  const allInputs = document.querySelectorAll("input, textarea, select");
  const inputsInForms = /* @__PURE__ */ new Set();
  formElements.forEach((formEl) => {
    const formInputs = [];
    allInputs.forEach((input) => {
      if (formEl.contains(input)) {
        formInputs.push(input);
        inputsInForms.add(input);
      }
    });
    const fields = buildFieldStates(formInputs);
    const submitButton = formEl.querySelector(
      'button[type="submit"], input[type="submit"]'
    );
    forms.push({
      id: formEl.id || `form-${forms.length}`,
      name: formEl.getAttribute("name") || void 0,
      purpose: inferPurposeFromFields(fields),
      fields,
      isValid: fields.every((f) => f.valid),
      submitButton: submitButton?.id || void 0,
      isDirty: fields.some((f) => f.isDirty)
    });
  });
  const orphanInputs = [];
  allInputs.forEach((input) => {
    if (!inputsInForms.has(input)) {
      orphanInputs.push(input);
    }
  });
  if (orphanInputs.length > 0) {
    const fields = buildFieldStates(orphanInputs);
    forms.push({
      id: "implicit-form",
      purpose: inferPurposeFromFields(fields),
      fields,
      isValid: fields.every((f) => f.valid),
      isDirty: fields.some((f) => f.isDirty)
    });
  }
  return {
    forms,
    timestamp: Date.now()
  };
}
function diffFormSnapshots(before, after) {
  const beforeFormIds = new Set(before.forms.map((f) => f.id));
  const afterFormIds = new Set(after.forms.map((f) => f.id));
  const formsAdded = after.forms.filter((f) => !beforeFormIds.has(f.id)).map((f) => f.id);
  const formsRemoved = before.forms.filter((f) => !afterFormIds.has(f.id)).map((f) => f.id);
  const beforeFields = buildFieldMap(before.forms);
  const afterFields = buildFieldMap(after.forms);
  const beforeFieldIds = new Set(beforeFields.keys());
  const afterFieldIds = new Set(afterFields.keys());
  const addedFields = [];
  afterFieldIds.forEach((id) => {
    if (!beforeFieldIds.has(id)) {
      addedFields.push(id);
    }
  });
  const removedFields = [];
  beforeFieldIds.forEach((id) => {
    if (!afterFieldIds.has(id)) {
      removedFields.push(id);
    }
  });
  const changedFields = [];
  beforeFieldIds.forEach((id) => {
    if (!afterFieldIds.has(id)) return;
    const beforeField = beforeFields.get(id);
    const afterField = afterFields.get(id);
    const diff = diffFields(beforeField, afterField);
    if (diff) {
      changedFields.push(diff);
    }
  });
  const timeDeltaMs = after.timestamp - before.timestamp;
  const hasChanges = changedFields.length > 0 || addedFields.length > 0 || removedFields.length > 0 || formsAdded.length > 0 || formsRemoved.length > 0;
  const summary = summarizeFormDiff({
    changedFields,
    addedFields,
    removedFields,
    formsAdded,
    formsRemoved,
    hasChanges
  });
  return {
    changedFields,
    addedFields,
    removedFields,
    formsAdded,
    formsRemoved,
    summary,
    timeDeltaMs,
    hasChanges
  };
}
function summarizeFormDiff(diff) {
  if (!diff.hasChanges) {
    return "No changes detected";
  }
  const parts = [];
  if (diff.formsAdded.length > 0) {
    parts.push(`Forms added: ${diff.formsAdded.join(", ")}`);
  }
  if (diff.formsRemoved.length > 0) {
    parts.push(`Forms removed: ${diff.formsRemoved.join(", ")}`);
  }
  for (const field of diff.changedFields) {
    const fieldLabel = field.fieldName || field.fieldId;
    const changeParts = [];
    if (field.changes.value) {
      const before = field.changes.value.before || "(empty)";
      const after = field.changes.value.after || "(empty)";
      changeParts.push(`value: "${before}" -> "${after}"`);
    }
    if (field.changes.checked) {
      changeParts.push(
        `checked: ${field.changes.checked.before} -> ${field.changes.checked.after}`
      );
    }
    if (field.changes.selectedOptions) {
      const before = field.changes.selectedOptions.before.join(", ") || "(none)";
      const after = field.changes.selectedOptions.after.join(", ") || "(none)";
      changeParts.push(`selected: [${before}] -> [${after}]`);
    }
    if (field.changes.validationError) {
      const before = field.changes.validationError.before || "(none)";
      const after = field.changes.validationError.after || "(none)";
      changeParts.push(`error: "${before}" -> "${after}"`);
    }
    if (field.changes.isValid) {
      changeParts.push(`valid: ${field.changes.isValid.before} -> ${field.changes.isValid.after}`);
    }
    if (field.changes.isDirty) {
      changeParts.push(`dirty: ${field.changes.isDirty.before} -> ${field.changes.isDirty.after}`);
    }
    if (changeParts.length > 0) {
      parts.push(`${fieldLabel}: ${changeParts.join(", ")}`);
    }
  }
  if (diff.addedFields.length > 0) {
    parts.push(`Fields added: ${diff.addedFields.join(", ")}`);
  }
  if (diff.removedFields.length > 0) {
    parts.push(`Fields removed: ${diff.removedFields.join(", ")}`);
  }
  return parts.join("; ");
}
function buildFieldMap(forms) {
  const map = /* @__PURE__ */ new Map();
  for (const form of forms) {
    for (const field of form.fields) {
      map.set(field.id, field);
    }
  }
  return map;
}
function diffFields(before, after) {
  const changes = {};
  if (before.value !== after.value) {
    changes.value = { before: before.value, after: after.value };
  }
  if (before.checked !== after.checked && (before.checked !== void 0 || after.checked !== void 0)) {
    changes.checked = {
      before: before.checked ?? false,
      after: after.checked ?? false
    };
  }
  if (!arraysEqual(before.selectedOptions, after.selectedOptions)) {
    changes.selectedOptions = {
      before: before.selectedOptions ?? [],
      after: after.selectedOptions ?? []
    };
  }
  if (before.error !== after.error) {
    changes.validationError = {
      before: before.error,
      after: after.error
    };
  }
  if (before.isDirty !== after.isDirty) {
    changes.isDirty = {
      before: before.isDirty ?? false,
      after: after.isDirty ?? false
    };
  }
  if (before.valid !== after.valid) {
    changes.isValid = {
      before: before.valid,
      after: after.valid
    };
  }
  if (Object.keys(changes).length === 0) {
    return null;
  }
  return {
    fieldId: after.id,
    fieldName: after.label || before.label,
    fieldType: after.type,
    changes
  };
}
function arraysEqual(a, b) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function buildFieldStates(inputs) {
  return inputs.map((el) => {
    const isInput = el instanceof HTMLInputElement;
    const isTextarea = el instanceof HTMLTextAreaElement;
    const isSelect = el instanceof HTMLSelectElement;
    let value = "";
    let checked;
    let selectedOptions;
    let inputType = "text";
    if (isInput) {
      inputType = el.type || "text";
      if (inputType === "checkbox" || inputType === "radio") {
        checked = el.checked;
        value = el.value;
      } else {
        value = el.value;
      }
    } else if (isTextarea) {
      inputType = "textarea";
      value = el.value;
    } else if (isSelect) {
      inputType = "select";
      value = el.value;
      selectedOptions = Array.from(el.selectedOptions).map((o) => o.value);
    }
    const validity = el.validity;
    const valid = validity ? validity.valid : true;
    const validationMessage = el.validationMessage || void 0;
    const label = el.getAttribute("aria-label") || getLabelTextForElement(el) || el.getAttribute("placeholder") || el.id || el.getAttribute("name") || "";
    const defaultValue = el.getAttribute("value") ?? "";
    const isDirty = value !== defaultValue;
    return {
      id: el.id || el.getAttribute("name") || `field-${Math.random().toString(36).slice(2, 8)}`,
      label,
      type: inputType,
      value,
      valid,
      error: validationMessage,
      required: el.hasAttribute("required"),
      touched: (value?.length ?? 0) > 0,
      placeholder: el.getAttribute("placeholder") || void 0,
      isDirty,
      checked,
      selectedOptions
    };
  });
}
function getLabelTextForElement(element) {
  if (typeof document === "undefined") return void 0;
  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const parentLabel = element.closest("label");
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll("input, textarea, select");
    inputs.forEach((inp) => inp.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }
  return void 0;
}
function inferPurposeFromFields(fields) {
  const labels = fields.map((f) => f.label.toLowerCase()).join(" ");
  if (labels.includes("email") && labels.includes("password")) {
    if (labels.includes("confirm") || labels.includes("name") || labels.includes("register")) {
      return "Registration";
    }
    return "Login";
  }
  if (labels.includes("search")) return "Search";
  if (labels.includes("address") || labels.includes("city")) return "Address";
  if (labels.includes("card") || labels.includes("payment")) return "Payment";
  if (labels.includes("contact") || labels.includes("message")) return "Contact";
  return "Form";
}

// src/ai/validation-scanner.ts
var ERROR_CONTAINER_SELECTORS = [
  ".error",
  ".field-error",
  ".form-error",
  ".invalid-feedback",
  ".help-block.error",
  ".error-message",
  ".validation-error",
  ".form-text.text-danger",
  '[role="alert"]',
  // Material UI
  ".MuiFormHelperText-root.Mui-error",
  // Ant Design
  ".ant-form-item-explain-error",
  // Chakra UI
  ".chakra-form__error-message",
  // Tailwind UI common patterns
  ".text-red-500",
  ".text-red-600",
  ".text-destructive"
];
var INPUT_ERROR_CLASSES = [
  "is-invalid",
  "has-error",
  "error",
  "invalid",
  "field-error",
  "border-red-500",
  "border-destructive",
  "Mui-error",
  "ant-input-status-error"
];
function scanValidationErrors(elements) {
  const errors = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { id, element } of elements) {
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) && !(element instanceof HTMLSelectElement)) {
      continue;
    }
    const result = detectFieldError(id, element);
    if (result && !seen.has(id)) {
      errors.push(result);
      seen.add(id);
    }
  }
  return errors;
}
function detectFieldError(fieldId, element) {
  if ("validity" in element && !element.validity.valid) {
    return {
      fieldId,
      message: element.validationMessage || "Invalid value",
      confidence: 1,
      source: "html5"
    };
  }
  if (element.getAttribute("aria-invalid") === "true") {
    const errorMessage = getAriaErrorMessage(element);
    return {
      fieldId,
      message: errorMessage || "",
      confidence: 0.95,
      source: "aria"
    };
  }
  const adjacentError = findAdjacentError(element);
  if (adjacentError) {
    return {
      fieldId,
      message: adjacentError,
      confidence: 0.8,
      source: "adjacent-element"
    };
  }
  if (hasErrorClass(element)) {
    return {
      fieldId,
      message: "",
      confidence: 0.6,
      source: "css-class"
    };
  }
  return null;
}
function getAriaErrorMessage(element) {
  const errorMsgId = element.getAttribute("aria-errormessage");
  if (errorMsgId) {
    const errorEl = document.getElementById(errorMsgId);
    if (errorEl?.textContent?.trim()) {
      return errorEl.textContent.trim();
    }
  }
  const describedById = element.getAttribute("aria-describedby");
  if (describedById) {
    const ids = describedById.split(/\s+/);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el?.textContent?.trim()) {
        const text = el.textContent.trim();
        if (el.getAttribute("role") === "alert" || hasErrorClass(el) || text.length < 200) {
          return text;
        }
      }
    }
  }
  return null;
}
function findAdjacentError(element) {
  const container = element.closest(
    '.form-group, .form-field, .field, .form-item, [class*="field"], [class*="form-group"], [class*="FormControl"], .MuiFormControl-root, .ant-form-item, .chakra-form-control'
  ) || element.parentElement;
  if (!container) return null;
  for (const selector of ERROR_CONTAINER_SELECTORS) {
    try {
      const errorEl = container.querySelector(selector);
      if (errorEl && errorEl !== element) {
        const text = errorEl.textContent?.trim();
        if (text) return text;
      }
    } catch {
    }
  }
  const next = element.nextElementSibling;
  if (next && hasErrorClass(next)) {
    const text = next.textContent?.trim();
    if (text) return text;
  }
  return null;
}
function hasErrorClass(element) {
  for (const cls of INPUT_ERROR_CLASSES) {
    if (element.classList.contains(cls)) return true;
  }
  if (element.getAttribute("data-invalid") === "true" || element.getAttribute("data-error") !== null) {
    return true;
  }
  return false;
}

// src/ai/form-discovery.ts
function discoverForms(elements) {
  const validationErrors = scanValidationErrors(
    elements.map((el) => ({ id: el.id, element: el.element }))
  );
  const errorsByField = new Map(validationErrors.map((e) => [e.fieldId, e]));
  const formElements = elements.filter((el) => el.type === "form");
  const inputTypes = /* @__PURE__ */ new Set([
    "input",
    "textarea",
    "select",
    "checkbox",
    "radio",
    "textbox",
    "combobox",
    "switch",
    "slider",
    "listbox"
  ]);
  const allInputs = elements.filter((el) => inputTypes.has(el.type));
  const forms = [];
  if (formElements.length > 0) {
    for (const formEl of formElements) {
      const formDom = formEl.element;
      const formInputs = allInputs.filter((input) => formDom.contains(input.element));
      const fields = buildFormFields(formInputs, errorsByField);
      const submitButton = elements.find(
        (el) => el.type === "button" && formDom.contains(el.element) && (el.element.getAttribute("type") === "submit" || el.element.textContent?.toLowerCase().match(/submit|save|send|continue|sign in|log in/))
      );
      forms.push({
        id: formEl.id,
        name: formEl.label || formDom.getAttribute("name") || void 0,
        purpose: inferFormPurpose(formInputs),
        fields,
        isValid: fields.every((f) => f.valid),
        submitButton: submitButton?.id,
        isDirty: fields.some((f) => f.isDirty)
      });
    }
  }
  const inputsInForms = new Set(
    formElements.flatMap(
      (f) => allInputs.filter((i) => f.element.contains(i.element)).map((i) => i.id)
    )
  );
  const orphanInputs = allInputs.filter((i) => !inputsInForms.has(i.id));
  if (orphanInputs.length > 0) {
    const fields = buildFormFields(orphanInputs, errorsByField);
    const submitButton = elements.find(
      (el) => el.type === "button" && !formElements.some((f) => f.element.contains(el.element)) && el.element.textContent?.toLowerCase().match(/submit|save|send|continue|sign in|log in/)
    );
    forms.push({
      id: "implicit-form",
      purpose: inferFormPurpose(orphanInputs),
      fields,
      isValid: fields.every((f) => f.valid),
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.isDirty)
    });
  }
  const totalFields = forms.reduce((sum, f) => sum + f.fields.length, 0);
  const totalErrors = forms.reduce((sum, f) => sum + f.fields.filter((ff) => !ff.valid).length, 0);
  const filledFields = forms.reduce(
    (sum, f) => sum + f.fields.filter((ff) => ff.value !== "" || ff.checked).length,
    0
  );
  const summaryParts = [`${forms.length} form(s), ${totalFields} field(s)`];
  if (filledFields > 0) summaryParts.push(`${filledFields} filled`);
  if (totalErrors > 0) summaryParts.push(`${totalErrors} error(s)`);
  return {
    forms,
    summary: summaryParts.join(", "),
    timestamp: Date.now()
  };
}
function getLabelText(element) {
  if (typeof document === "undefined") return void 0;
  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const parentLabel = element.closest("label");
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll("input, textarea, select");
    inputs.forEach((inp) => inp.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }
  return void 0;
}
function buildFormFields(inputs, errorsByField) {
  return inputs.map((input) => {
    const state = input.getState();
    const el = input.element;
    const detectedError = errorsByField.get(input.id);
    let valid = true;
    let errorMsg;
    let errorSource;
    if (state.validationState && !state.validationState.valid) {
      valid = false;
      errorMsg = state.validationState.validationMessage;
      errorSource = "html5";
    } else if (detectedError) {
      valid = false;
      errorMsg = detectedError.message || void 0;
      errorSource = detectedError.source;
    }
    const defaultValue = el.getAttribute("value") ?? "";
    const isDirty = state.value !== void 0 && state.value !== defaultValue;
    return {
      id: input.id,
      label: el.getAttribute("aria-label") || input.label || getLabelText(el) || el.getAttribute("placeholder") || input.id,
      type: el instanceof HTMLInputElement ? el.type : input.type,
      value: state.value ?? "",
      valid,
      error: errorMsg,
      errorSource,
      required: state.required ?? false,
      touched: state.focused || (state.value?.length ?? 0) > 0,
      placeholder: el.getAttribute("placeholder") || void 0,
      isDirty,
      checked: state.checked,
      selectedOptions: state.selectedOptions,
      constraints: state.constraints
    };
  });
}
function inferFormPurpose(fields) {
  const labels = fields.map(
    (f) => (f.element.getAttribute("aria-label") || f.label || f.element.getAttribute("name") || "").toLowerCase()
  ).join(" ");
  if (labels.includes("email") && labels.includes("password")) {
    if (labels.includes("confirm") || labels.includes("name") || labels.includes("register")) {
      return "Registration";
    }
    return "Login";
  }
  if (labels.includes("search")) return "Search";
  if (labels.includes("address") || labels.includes("city")) return "Address";
  if (labels.includes("card") || labels.includes("payment")) return "Payment";
  if (labels.includes("contact") || labels.includes("message")) return "Contact";
  return "Form";
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
function fuzzyContains(source, target, config = {}) {
  const finalConfig = { ...DEFAULT_FUZZY_CONFIG, ...config };
  const normalizedSource = normalizeString(source, finalConfig);
  const normalizedTarget = normalizeString(target, finalConfig);
  if (normalizedSource.includes(normalizedTarget)) {
    return true;
  }
  const sourceWords = normalizedSource.split(/\s+/);
  const targetWords = normalizedTarget.split(/\s+/);
  for (const targetWord of targetWords) {
    const hasMatch = sourceWords.some((sourceWord) => {
      const result = fuzzyMatch(sourceWord, targetWord, { ...finalConfig, threshold: 0.8 });
      return result.isMatch;
    });
    if (!hasMatch) {
      return false;
    }
  }
  return true;
}
function wordSimilarity(s1, s2, config = {}) {
  const finalConfig = { ...DEFAULT_FUZZY_CONFIG, ...config };
  const words1 = normalizeString(s1, finalConfig).split(/\s+/);
  const words2 = normalizeString(s2, finalConfig).split(/\s+/);
  if (words1.length === 0 && words2.length === 0) return 1;
  if (words1.length === 0 || words2.length === 0) return 0;
  let totalSimilarity = 0;
  let matchCount = 0;
  for (const word1 of words1) {
    let bestSim = 0;
    for (const word2 of words2) {
      const result = fuzzyMatch(word1, word2, finalConfig);
      if (result.similarity > bestSim) {
        bestSim = result.similarity;
      }
    }
    totalSimilarity += bestSim;
    if (bestSim >= finalConfig.threshold) {
      matchCount++;
    }
  }
  const avgSimilarity = totalSimilarity / words1.length;
  const matchRatio = matchCount / Math.max(words1.length, words2.length);
  return avgSimilarity * 0.5 + matchRatio * 0.5;
}
function tokenize(s) {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().split(" ").filter((token) => token.length > 0);
}
function tokenSimilarity(s1, s2) {
  const tokens1 = tokenize(s1);
  const tokens2 = tokenize(s2);
  if (tokens1.length === 0 && tokens2.length === 0) return 1;
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  let intersection = 0;
  for (const token of set1) {
    if (set2.has(token)) {
      intersection++;
    }
  }
  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : intersection / union;
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
var CONTENT_TYPES = /* @__PURE__ */ new Set([
  "heading",
  "paragraph",
  "list-item",
  "table-cell",
  "table-header",
  "label",
  "caption",
  "blockquote",
  "code-block",
  "badge",
  "status-message",
  "metric-value",
  "description-text",
  "nav-text",
  "content-generic"
]);
function generatePurpose(input) {
  const text = (input.textContent || input.ariaLabel || input.title || "").toLowerCase();
  const type = input.elementType?.toLowerCase() || "";
  const inputType = input.inputType?.toLowerCase() || "";
  if (CONTENT_TYPES.has(type)) {
    switch (type) {
      case "heading":
        return "Section heading";
      case "paragraph":
        return "Body text content";
      case "list-item":
        return "List item";
      case "table-cell":
        return "Table data cell";
      case "table-header":
        return "Table column header";
      case "label":
        return "Field label or definition term";
      case "caption":
        return "Figure or table caption";
      case "blockquote":
        return "Quoted content";
      case "code-block":
        return "Code or preformatted text";
      case "badge":
        return "Status badge or tag";
      case "status-message":
        return "Dynamic status indicator";
      case "metric-value":
        return "Metric or statistic value";
      case "description-text":
        return "Description or definition";
      case "nav-text":
        return "Navigation label";
      case "content-generic":
        return "Text content";
      default:
        return "Static content";
    }
  }
  if (type === "button" || inputType === "submit") {
    if (text.match(/submit|send|save|confirm|ok|done|finish|apply/)) {
      return "Submits the form";
    }
    if (text.match(/cancel|close|dismiss|back|exit/)) {
      return "Cancels or closes the current action";
    }
    if (text.match(/delete|remove|trash|clear/)) {
      return "Deletes or removes an item";
    }
    if (text.match(/edit|modify|change|update/)) {
      return "Edits or modifies an item";
    }
    if (text.match(/add|create|new|\+/)) {
      return "Creates or adds a new item";
    }
    if (text.match(/search|find|lookup/)) {
      return "Performs a search";
    }
    if (text.match(/login|sign.?in/)) {
      return "Signs the user in";
    }
    if (text.match(/logout|sign.?out/)) {
      return "Signs the user out";
    }
    if (text.match(/register|sign.?up|join/)) {
      return "Creates a new account";
    }
    if (text.match(/next|continue|proceed/)) {
      return "Proceeds to the next step";
    }
    if (text.match(/previous|back|return/)) {
      return "Returns to the previous step";
    }
  }
  if (type === "input" || type === "textarea") {
    if (inputType === "email") return "Accepts email address input";
    if (inputType === "password") return "Accepts password input";
    if (inputType === "search") return "Accepts search query input";
    if (inputType === "tel") return "Accepts phone number input";
    if (inputType === "url") return "Accepts URL input";
    if (inputType === "number") return "Accepts numeric input";
    if (inputType === "date") return "Accepts date input";
    if (inputType === "file") return "Accepts file upload";
  }
  if (type === "checkbox") {
    return "Toggles an option on or off";
  }
  if (type === "radio") {
    return "Selects one option from a group";
  }
  if (type === "select") {
    return "Selects an option from a dropdown";
  }
  if (type === "link") {
    return "Navigates to another page";
  }
  return void 0;
}
function generateSuggestedActions(input) {
  const type = input.elementType?.toLowerCase() || "";
  const inputType = input.inputType?.toLowerCase() || "";
  const text = (input.textContent || input.ariaLabel || "").toLowerCase();
  const actions = [];
  if (CONTENT_TYPES.has(type)) {
    actions.push("read text content", "verify text matches expected");
    return actions;
  }
  switch (type) {
    case "button":
      actions.push(`click "${text || "this button"}"`);
      break;
    case "input":
      if (inputType === "checkbox") {
        actions.push("check to enable", "uncheck to disable");
      } else if (inputType === "radio") {
        actions.push("select this option");
      } else {
        actions.push(`type into "${text || "this field"}"`);
        actions.push("clear the field");
      }
      break;
    case "textarea":
      actions.push(`type into "${text || "this text area"}"`);
      actions.push("clear the content");
      break;
    case "select":
      actions.push(`select an option from "${text || "this dropdown"}"`);
      break;
    case "checkbox":
      actions.push("check to enable", "uncheck to disable");
      break;
    case "radio":
      actions.push("select this option");
      break;
    case "link":
      actions.push(`click to navigate to "${text || "the linked page"}"`);
      break;
    case "switch":
      actions.push("toggle on", "toggle off");
      break;
    default:
      actions.push("click");
  }
  return actions;
}
function areSynonyms(word1, word2) {
  const w1 = word1.toLowerCase().trim();
  const w2 = word2.toLowerCase().trim();
  if (w1 === w2) return true;
  const synonyms1 = SYNONYMS[w1] || [];
  const synonyms2 = SYNONYMS[w2] || [];
  return synonyms1.includes(w2) || synonyms2.includes(w1);
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
function inferActions2(type) {
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
        } catch (error3) {
          console.error(`Error in event listener for ${type}:`, error3);
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
    const actions = options.actions ?? inferActions2(type);
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
    } catch (error3) {
      return {
        success: false,
        activatedStates: [],
        deactivatedStates: [],
        error: error3 instanceof Error ? error3.message : String(error3),
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
      } catch (error3) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] page enricher threw:`, error3);
        }
      }
    }
    if (this.enrichers.modalDetector) {
      try {
        snapshot.modalStack = this.enrichers.modalDetector.getSnapshotModalContext();
      } catch (error3) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] modalStack enricher threw:`, error3);
        }
      }
    }
    if (this.enrichers.toastCapture) {
      try {
        snapshot.toasts = this.enrichers.toastCapture.getSnapshotToastContext();
      } catch (error3) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] toasts enricher threw:`, error3);
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
      } catch (error3) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] relationships enricher threw:`, error3);
        }
      }
    }
    if (this.enrichers.dragDropDetector) {
      try {
        snapshot.dragDrop = this.enrichers.dragDropDetector.getSnapshotDragDropContext(getElementPairs());
      } catch (error3) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] dragDrop enricher threw:`, error3);
        }
      }
    }
    if (this.enrichers.undoTracker) {
      try {
        snapshot.undoRedo = this.enrichers.undoTracker.getSnapshotUndoContext();
      } catch (error3) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] undoRedo enricher threw:`, error3);
        }
      }
    }
    if (this.enrichers.shortcutTracker) {
      try {
        snapshot.shortcuts = this.enrichers.shortcutTracker.getSnapshotShortcutContext();
      } catch (error3) {
        if (this.options.verbose) {
          console.warn(`[ui-bridge] shortcuts enricher threw:`, error3);
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
        } catch (error3) {
          if (this.options.verbose) {
            console.warn(`[ui-bridge] snapshot enricher "${name}" threw:`, error3);
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

// src/ai/search-engine.ts
function isFindDebugEnabled() {
  try {
    const proc = globalThis.process;
    if (proc?.env?.UI_BRIDGE_DEBUG_FIND === "1") {
      return true;
    }
  } catch {
  }
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === "function") {
      if (ls.getItem("UI_BRIDGE_DEBUG_FIND") === "1") {
        return true;
      }
    }
  } catch {
  }
  return false;
}
function truncForDebug(s, max = 80) {
  if (!s) return s;
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}
var TOKEN_PUNCTUATION_RE = /[:,.;!?/()\\[\]{}<>"`—–-]+/g;
function tokenizeForAlignment(s) {
  return s.toLowerCase().replace(TOKEN_PUNCTUATION_RE, " ").replace(/_+/g, " ").split(/\s+/).filter((t) => t.length > 0);
}
function analyzeTokenAlignment(query, target) {
  const queryTokens = tokenizeForAlignment(query);
  const targetTokens = tokenizeForAlignment(target);
  const totalQueryTokens = queryTokens.length;
  if (totalQueryTokens === 0 || targetTokens.length === 0) {
    return { kind: "none", matchedTokenCount: 0, totalQueryTokens };
  }
  let prefixMatches = 0;
  for (const qt of queryTokens) {
    if (targetTokens.some((tt) => tt.startsWith(qt))) {
      prefixMatches += 1;
    }
  }
  if (prefixMatches === totalQueryTokens) {
    return { kind: "prefix-aligned", matchedTokenCount: prefixMatches, totalQueryTokens };
  }
  let presenceMatches = 0;
  for (const qt of queryTokens) {
    if (targetTokens.some((tt) => tt.includes(qt))) {
      presenceMatches += 1;
    }
  }
  if (presenceMatches === totalQueryTokens) {
    return {
      kind: "all-tokens-present",
      matchedTokenCount: presenceMatches,
      totalQueryTokens
    };
  }
  if (presenceMatches > 0) {
    return { kind: "partial", matchedTokenCount: presenceMatches, totalQueryTokens };
  }
  return { kind: "none", matchedTokenCount: 0, totalQueryTokens };
}
var DEFAULT_SEARCH_CONFIG = {
  fuzzyThreshold: 0.7,
  textWeight: 0.35,
  accessibilityWeight: 0.25,
  roleWeight: 0.15,
  spatialWeight: 0.1,
  aliasWeight: 0.15,
  maxResults: 20,
  includeHidden: false
};
var _SearchEngine = class _SearchEngine {
  // Cache valid for 100ms
  constructor(config = {}) {
    this.cachedElements = [];
    this.cacheTimestamp = 0;
    this.cacheValidityMs = 100;
    this.config = { ...DEFAULT_SEARCH_CONFIG, ...config };
  }
  /**
   * Update cached elements from various sources
   */
  updateElements(elements, getState) {
    this.cachedElements = elements.map((el) => this.toSearchable(el, getState));
    this.cacheTimestamp = Date.now();
  }
  /**
   * Peek at the engine's current cache of {id, type} pairs.
   *
   * Used by callers like `find.ts` that need to know whether a given
   * element-type guess is even present in the cached page before deciding to
   * relax type-pinned criteria. Returns a copy so callers can iterate freely
   * without affecting the engine's internal state — and never exposes the
   * full `SearchableElement` shape so we don't leak internal scoring helpers
   * across the module boundary.
   */
  getCachedElementSummaries() {
    return this.cachedElements.map((el) => ({ id: el.id, type: el.type }));
  }
  /**
   * Convert an element to searchable format
   */
  toSearchable(element, getState) {
    let state;
    let textContent;
    let tagName;
    let role;
    let ariaLabel;
    let placeholder;
    let title;
    let labelText;
    let value;
    let name;
    if ("getState" in element && typeof element.getState === "function") {
      state = getState ? getState(element) : element.getState();
      textContent = state.textContent || void 0;
      try {
        tagName = element.element.tagName.toLowerCase();
      } catch {
        tagName = element.type || "unknown";
      }
      try {
        role = element.element.getAttribute("role") || void 0;
        ariaLabel = element.element.getAttribute("aria-label") || void 0;
        placeholder = element.element.getAttribute("placeholder") || void 0;
        title = element.element.getAttribute("title") || void 0;
        name = element.element.getAttribute("name") || void 0;
      } catch {
      }
      if (!ariaLabel && element.label) {
        ariaLabel = element.label;
      }
      try {
        if (element.element.id) {
          const labelEl = document.querySelector(`label[for="${element.element.id}"]`);
          labelText = labelEl?.textContent?.trim() || void 0;
        }
        if (!labelText) {
          let ancestor = element.element.parentElement;
          while (ancestor) {
            if (ancestor.tagName.toLowerCase() === "label") {
              labelText = ancestor.textContent?.trim() || void 0;
              break;
            }
            ancestor = ancestor.parentElement;
          }
        }
      } catch {
      }
      if (!labelText && element.label) {
        labelText = element.label;
      }
      if (!textContent && element.label) {
        textContent = element.label;
      }
      try {
        if (element.element instanceof HTMLInputElement || element.element instanceof HTMLTextAreaElement || element.element instanceof HTMLSelectElement) {
          value = element.element.value || void 0;
        }
      } catch {
        value = state.value || void 0;
      }
    } else {
      const discovered = element;
      state = discovered.state;
      textContent = state.textContent || void 0;
      tagName = discovered.tagName;
      role = discovered.role || void 0;
      ariaLabel = discovered.accessibleName || void 0;
      if (!labelText && element.label) {
        labelText = element.label;
      }
    }
    let aliases = generateAliases({
      textContent,
      ariaLabel,
      placeholder,
      title,
      elementType: element.type,
      id: element.id,
      labelText,
      value
    });
    if ("aliases" in element && Array.isArray(element.aliases) && element.aliases.length > 0) {
      const aliasSet = /* @__PURE__ */ new Set([
        ...aliases,
        ...element.aliases.map((a) => a.toLowerCase())
      ]);
      aliases = [...aliasSet];
    }
    let description = generateDescription({
      textContent,
      ariaLabel,
      placeholder,
      title,
      elementType: element.type,
      id: element.id,
      labelText
    });
    if (!description && "description" in element && element.description) {
      description = element.description;
    }
    const annotation = getGlobalAnnotationStore().get(element.id);
    if (annotation) {
      if (annotation.description) {
        description = annotation.description;
      }
      if (annotation.tags && annotation.tags.length > 0) {
        const tagSet = /* @__PURE__ */ new Set([...aliases, ...annotation.tags.map((t) => t.toLowerCase())]);
        aliases = [...tagSet];
      }
      if (annotation.notes) {
        aliases.push(annotation.notes.toLowerCase());
      }
    }
    const parentContext = this.resolveParentContext(element);
    const iconAliases = this.inferIconAliases(element);
    if (iconAliases.length > 0 && !textContent && !ariaLabel) {
      const aliasSet = /* @__PURE__ */ new Set([...aliases, ...iconAliases]);
      aliases = [...aliasSet];
      if (!textContent) {
        textContent = iconAliases[0];
      }
    }
    return {
      id: element.id,
      element,
      state,
      textContent,
      ariaLabel,
      placeholder,
      title,
      role,
      tagName,
      type: element.type,
      aliases,
      description,
      rect: state.rect,
      labelText,
      value,
      name,
      parentContext
    };
  }
  /**
   * Search for elements matching the criteria
   */
  search(criteria, elements) {
    const startTime = performance.now();
    if (elements) {
      this.updateElements(elements);
    }
    let searchableElements = this.cachedElements;
    if (!this.config.includeHidden && !criteria.fuzzy) {
      searchableElements = searchableElements.filter((el) => el.state.visible);
    }
    const debugEnabled = isFindDebugEnabled();
    let candidateElementsForDebug;
    let allScoredForDebug;
    if (debugEnabled) {
      const criteriaTypeLower = criteria.type?.toLowerCase();
      candidateElementsForDebug = this.cachedElements.filter((el) => {
        const idHit = el.id.toLowerCase().includes("advanced");
        const typeHit = criteriaTypeLower ? el.type.toLowerCase() === criteriaTypeLower : false;
        return idHit || typeHit;
      }).map((el) => ({
        id: el.id,
        type: el.type,
        labelText: truncForDebug(el.labelText),
        ariaLabel: truncForDebug(el.ariaLabel)
      }));
      allScoredForDebug = [];
      try {
        console.debug("[ui-bridge:find] cachedElements.length=", this.cachedElements.length);
        console.debug(
          "[ui-bridge:find] searchableElements.length (post visibility filter)=",
          searchableElements.length
        );
        console.debug("[ui-bridge:find] criteria=", JSON.stringify(criteria));
        console.debug(
          "[ui-bridge:find] candidateElements=",
          JSON.stringify(candidateElementsForDebug)
        );
      } catch {
      }
    }
    const results = [];
    for (const searchable of searchableElements) {
      const result = this.scoreElement(searchable, criteria);
      if (debugEnabled && allScoredForDebug && result.confidence > 0) {
        allScoredForDebug.push({
          id: searchable.id,
          confidence: result.confidence,
          scores: result.scores
        });
      }
      if (result.confidence >= (criteria.fuzzyThreshold ?? this.config.fuzzyThreshold)) {
        results.push(result);
      }
    }
    results.sort((a, b) => b.confidence - a.confidence);
    const limitedResults = results.slice(0, this.config.maxResults);
    if (debugEnabled && allScoredForDebug && candidateElementsForDebug) {
      const topScored = allScoredForDebug.slice().sort((a, b) => b.confidence - a.confidence).slice(0, 5);
      let registryTags;
      try {
        const tags = [];
        let getGlobalRegistryTag = null;
        try {
          const reg = getGlobalRegistry();
          if (reg && typeof reg.__instanceTag === "string") {
            getGlobalRegistryTag = reg.__instanceTag;
            tags.push({ source: "getGlobalRegistry()", tag: reg.__instanceTag });
          }
        } catch {
        }
        let windowProvidersTag = null;
        let windowProvidersHasRegistry = false;
        try {
          const w = globalThis.__UI_BRIDGE__;
          if (w && typeof w === "object") {
            const candidate = w.registry;
            if (candidate && typeof candidate.__instanceTag === "string") {
              windowProvidersHasRegistry = true;
              windowProvidersTag = candidate.__instanceTag;
              tags.push({
                source: "globalThis.__UI_BRIDGE__.registry",
                tag: candidate.__instanceTag
              });
            }
          }
        } catch {
        }
        registryTags = {
          getGlobalRegistryTag,
          windowProvidersTag,
          windowProvidersHasRegistry,
          allWindowTags: tags
        };
      } catch {
      }
      const diagnostic = {
        cachedElementsLength: this.cachedElements.length,
        searchableElementsLength: searchableElements.length,
        candidateElements: candidateElementsForDebug,
        topScored,
        criteria,
        threshold: criteria.fuzzyThreshold ?? this.config.fuzzyThreshold,
        resultsAboveThreshold: limitedResults.length,
        registryTags,
        timestamp: Date.now()
      };
      try {
        console.debug("[ui-bridge:find] topScored=", JSON.stringify(topScored));
      } catch {
      }
      try {
        globalThis.__UI_BRIDGE_LAST_FIND_DIAGNOSTIC__ = diagnostic;
      } catch {
      }
    }
    return {
      results: limitedResults,
      bestMatch: limitedResults.length > 0 ? limitedResults[0] : null,
      scannedCount: searchableElements.length,
      durationMs: performance.now() - startTime,
      criteria,
      timestamp: Date.now()
    };
  }
  /**
   * Find the best matching element
   */
  findBest(criteria, elements) {
    const response = this.search(criteria, elements);
    return response.bestMatch;
  }
  /**
   * Find elements by text content
   */
  findByText(text, fuzzy = true, elements) {
    return this.search({ text, fuzzy }, elements).results;
  }
  /**
   * Find elements by role
   */
  findByRole(role, name, elements) {
    const criteria = { role };
    if (name) {
      criteria.accessibleName = name;
    }
    return this.search(criteria, elements).results;
  }
  /**
   * Find elements by accessible name
   */
  findByAccessibleName(name, elements) {
    return this.search({ accessibleName: name, fuzzy: true }, elements).results;
  }
  /**
   * Find elements near another element
   */
  findNear(referenceId, criteria, elements) {
    return this.search({ ...criteria, near: referenceId }, elements).results;
  }
  /**
   * Find elements within a container
   */
  findWithin(containerId, criteria, elements) {
    return this.search({ ...criteria, within: containerId }, elements).results;
  }
  /**
   * Score an element against search criteria
   */
  scoreElement(searchable, criteria) {
    const scores = {};
    const matchReasons = [];
    let totalWeight = 0;
    let weightedScore = 0;
    const fuzzyConfig = {
      ...DEFAULT_FUZZY_CONFIG,
      threshold: criteria.fuzzyThreshold ?? this.config.fuzzyThreshold
    };
    if (criteria.text) {
      const textScore = this.scoreTextMatch(
        searchable,
        criteria.text,
        criteria.fuzzy !== false,
        fuzzyConfig.threshold
      );
      scores.text = textScore.score;
      if (textScore.score > 0) {
        matchReasons.push(...textScore.reasons);
      }
      weightedScore += textScore.score * this.config.textWeight;
      totalWeight += this.config.textWeight;
    }
    if (criteria.textContent && !criteria.text) {
      const alternatives = criteria.textContent.includes("|") ? criteria.textContent.split("|").map((s) => s.trim()).filter(Boolean) : [criteria.textContent];
      let bestScore = 0;
      let bestReasons = [];
      for (const alt of alternatives) {
        const exactScore = this.scoreTextMatch(
          searchable,
          alt,
          criteria.fuzzy !== false,
          fuzzyConfig.threshold
        );
        const containsScore = this.scoreContainsMatch(searchable, alt, criteria.fuzzy !== false);
        const altBest = Math.max(exactScore.score, containsScore.score);
        if (altBest > bestScore) {
          bestScore = altBest;
          bestReasons = exactScore.score >= containsScore.score ? exactScore.reasons : containsScore.reasons;
        }
      }
      scores.text = bestScore;
      if (bestScore > 0) {
        matchReasons.push(...bestReasons);
      }
      weightedScore += bestScore * this.config.textWeight;
      totalWeight += this.config.textWeight;
    }
    if (criteria.textContains) {
      const containsScore = this.scoreContainsMatch(
        searchable,
        criteria.textContains,
        criteria.fuzzy !== false
      );
      scores.text = Math.max(scores.text || 0, containsScore.score);
      if (containsScore.score > 0 && containsScore.reasons.length > 0) {
        matchReasons.push(...containsScore.reasons);
      }
      weightedScore += containsScore.score * this.config.textWeight;
      totalWeight += this.config.textWeight;
    }
    if (criteria.accessibleName) {
      const accessibilityScore = this.scoreAccessibilityMatch(
        searchable,
        criteria.accessibleName,
        criteria.fuzzy !== false,
        fuzzyConfig.threshold
      );
      scores.accessibility = accessibilityScore.score;
      if (accessibilityScore.score > 0) {
        matchReasons.push(...accessibilityScore.reasons);
      }
      weightedScore += accessibilityScore.score * this.config.accessibilityWeight;
      totalWeight += this.config.accessibilityWeight;
    }
    if (criteria.role) {
      const roleScore = this.scoreRoleMatch(searchable, criteria.role);
      scores.role = roleScore.score;
      if (roleScore.score > 0) {
        matchReasons.push(...roleScore.reasons);
      }
      weightedScore += roleScore.score * this.config.roleWeight;
      totalWeight += this.config.roleWeight;
    }
    if (criteria.type) {
      const typeMatch = searchable.type.toLowerCase() === criteria.type.toLowerCase();
      if (typeMatch) {
        matchReasons.push(`type: ${criteria.type}`);
        weightedScore += 1 * this.config.roleWeight;
        totalWeight += this.config.roleWeight;
      }
    }
    if (criteria.near) {
      const spatialScore = this.scoreSpatialMatch(searchable, criteria.near);
      scores.spatial = spatialScore.score;
      if (spatialScore.score > 0) {
        matchReasons.push(...spatialScore.reasons);
      }
      weightedScore += spatialScore.score * this.config.spatialWeight;
      totalWeight += this.config.spatialWeight;
    }
    if (criteria.placeholder && searchable.placeholder) {
      const placeholderResult = fuzzyMatch(
        searchable.placeholder,
        criteria.placeholder,
        fuzzyConfig
      );
      if (placeholderResult.isMatch) {
        matchReasons.push(`placeholder matches`);
        weightedScore += placeholderResult.similarity * this.config.textWeight;
        totalWeight += this.config.textWeight;
      }
    }
    if (criteria.title && searchable.title) {
      const titleResult = fuzzyMatch(searchable.title, criteria.title, fuzzyConfig);
      if (titleResult.isMatch) {
        matchReasons.push(`title matches`);
        weightedScore += titleResult.similarity * this.config.textWeight;
        totalWeight += this.config.textWeight;
      }
    }
    if (criteria.idPattern) {
      const idMatch = this.matchPattern(searchable.id, criteria.idPattern);
      if (idMatch) {
        matchReasons.push(`id matches pattern`);
        weightedScore += 1 * this.config.textWeight;
        totalWeight += this.config.textWeight;
      }
    }
    if (criteria.within) {
      const containmentScore = this.scoreContainmentMatch(searchable, criteria.within);
      if (containmentScore.score === 0) {
        const aiElement2 = this.toAIDiscoveredElement(searchable);
        return { element: aiElement2, confidence: 0, matchReasons: [], scores: {} };
      }
      matchReasons.push(...containmentScore.reasons);
      weightedScore += 0.1;
      totalWeight += 0.1;
    }
    const aliasScore = this.scoreAliasMatch(searchable, criteria, fuzzyConfig.threshold);
    if (aliasScore.score > 0) {
      scores.fuzzy = aliasScore.score;
      matchReasons.push(...aliasScore.reasons);
      weightedScore += aliasScore.score * this.config.aliasWeight;
      totalWeight += this.config.aliasWeight;
    }
    const confidence = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const aiElement = this.toAIDiscoveredElement(searchable);
    return {
      element: aiElement,
      confidence,
      matchReasons,
      scores
    };
  }
  /**
   * Score text match.
   *
   * Probes multiple element-side signals so that form inputs with no visible
   * text content can still be located by their identifying attributes.
   * Each source has a weight that establishes precedence:
   *   label (1.00) > aria-label (0.95) > placeholder (0.90) > text (1.00) > name (0.80)
   * The final per-element score is `bestSimilarity * sourceWeight` taken across
   * all sources — i.e., best-matching signal wins, with weaker sources slightly
   * down-ranked so a weak `name` match cannot beat a strong placeholder match.
   */
  scoreTextMatch(searchable, text, fuzzy, threshold) {
    const reasons = [];
    let maxScore = 0;
    const sources = [
      { value: searchable.labelText, label: "label", weight: 1 },
      { value: searchable.ariaLabel, label: "aria-label", weight: 0.95 },
      { value: searchable.placeholder, label: "placeholder", weight: 0.9 },
      { value: searchable.textContent, label: "text", weight: 1 },
      { value: searchable.value, label: "value", weight: 1 },
      { value: searchable.name, label: "name", weight: 0.8 }
    ];
    for (const { value: targetText, label: sourceLabel, weight } of sources) {
      if (!targetText) continue;
      if (targetText.toLowerCase() === text.toLowerCase()) {
        const score = 1 * weight;
        if (score > maxScore) {
          maxScore = score;
          reasons.push(`exact ${sourceLabel} match`);
        }
        continue;
      }
      if (fuzzy) {
        const result = fuzzyMatch(targetText, text, { threshold });
        if (result.isMatch) {
          const score = result.similarity * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} similarity: ${(result.similarity * 100).toFixed(0)}%`);
          }
        }
        const wordSim = wordSimilarity(targetText, text, { threshold });
        if (wordSim >= threshold) {
          const score = wordSim * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} word match: ${(wordSim * 100).toFixed(0)}%`);
          }
        }
        const tokenAnalysis = analyzeTokenAlignment(text, targetText);
        if (tokenAnalysis.kind !== "none") {
          const baseScore = tokenAnalysis.kind === "prefix-aligned" ? 0.95 : tokenAnalysis.kind === "all-tokens-present" ? 0.85 : 0.7;
          const score = baseScore * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(
              `${sourceLabel} ${tokenAnalysis.kind === "prefix-aligned" ? "prefix-aligns" : tokenAnalysis.kind === "all-tokens-present" ? "contains all tokens of" : "partially contains"} "${text}"`
            );
          }
        } else if (targetText.toLowerCase().includes(text.toLowerCase())) {
          const score = 0.85 * weight;
          if (score > maxScore) {
            maxScore = score;
            reasons.push(`${sourceLabel} contains "${text}"`);
          }
        }
      }
    }
    return { score: maxScore, reasons };
  }
  /**
   * Score contains match
   */
  scoreContainsMatch(searchable, text, fuzzy) {
    const reasons = [];
    let maxScore = 0;
    const textsToMatch = [
      searchable.textContent,
      searchable.labelText,
      searchable.ariaLabel
    ].filter(Boolean);
    for (const targetText of textsToMatch) {
      if (targetText.toLowerCase().includes(text.toLowerCase())) {
        maxScore = Math.max(maxScore, 0.9);
        reasons.push("text contains match");
        continue;
      }
      if (fuzzy && fuzzyContains(targetText, text)) {
        maxScore = Math.max(maxScore, 0.7);
        reasons.push("fuzzy contains match");
      }
    }
    return { score: maxScore, reasons };
  }
  /**
   * Score accessibility match
   */
  scoreAccessibilityMatch(searchable, name, fuzzy, threshold) {
    const reasons = [];
    let maxScore = 0;
    const accessibleNames = [
      searchable.ariaLabel,
      searchable.ariaLabelledBy,
      searchable.labelText,
      searchable.title
    ].filter(Boolean);
    for (const accessibleName of accessibleNames) {
      if (accessibleName.toLowerCase() === name.toLowerCase()) {
        maxScore = Math.max(maxScore, 1);
        reasons.push("exact accessible name match");
        continue;
      }
      if (fuzzy) {
        const result = fuzzyMatch(accessibleName, name, { threshold });
        if (result.isMatch && result.similarity > maxScore) {
          maxScore = result.similarity;
          reasons.push(`accessible name similarity: ${(result.similarity * 100).toFixed(0)}%`);
        }
      }
    }
    return { score: maxScore, reasons };
  }
  /**
   * Score role match
   */
  scoreRoleMatch(searchable, role) {
    const reasons = [];
    const normalizedRole = role.toLowerCase();
    if (searchable.role?.toLowerCase() === normalizedRole) {
      return { score: 1, reasons: [`role: ${role}`] };
    }
    const tagRoleMap = {
      button: ["button", "input[type=button]", "input[type=submit]"],
      textbox: ["input", "textarea"],
      checkbox: ["input[type=checkbox]"],
      radio: ["input[type=radio]"],
      link: ["a"],
      listbox: ["select"],
      combobox: ["select", "input[list]"],
      navigation: ["nav"],
      main: ["main"],
      heading: ["h1", "h2", "h3", "h4", "h5", "h6"]
    };
    const inferredRoles = tagRoleMap[normalizedRole] || [];
    if (inferredRoles.some(
      (r) => searchable.tagName === r || searchable.type.toLowerCase() === normalizedRole
    )) {
      return { score: 0.8, reasons: [`inferred role: ${role}`] };
    }
    return { score: 0, reasons };
  }
  /**
   * Score spatial match (proximity to another element)
   */
  scoreSpatialMatch(searchable, nearId) {
    const reference = this.cachedElements.find((el) => el.id === nearId);
    if (!reference) {
      return { score: 0, reasons: [] };
    }
    const distance = this.calculateDistance(searchable.rect, reference.rect);
    const nearThreshold = 200;
    if (distance > nearThreshold * 3) {
      return { score: 0, reasons: [] };
    }
    const score = Math.max(0, 1 - distance / (nearThreshold * 3));
    return {
      score,
      reasons: [`${distance.toFixed(0)}px from ${nearId}`]
    };
  }
  /**
   * Calculate distance between two element rectangles
   */
  calculateDistance(rect1, rect2) {
    const center1 = {
      x: rect1.x + rect1.width / 2,
      y: rect1.y + rect1.height / 2
    };
    const center2 = {
      x: rect2.x + rect2.width / 2,
      y: rect2.y + rect2.height / 2
    };
    return Math.sqrt(Math.pow(center1.x - center2.x, 2) + Math.pow(center1.y - center2.y, 2));
  }
  /**
   * Score alias match
   */
  scoreAliasMatch(searchable, criteria, threshold) {
    const reasons = [];
    let maxScore = 0;
    const searchTerms = [];
    if (criteria.text) searchTerms.push(criteria.text);
    if (criteria.textContains) searchTerms.push(criteria.textContains);
    if (criteria.accessibleName) searchTerms.push(criteria.accessibleName);
    for (const searchTerm of searchTerms) {
      const termLower = searchTerm.toLowerCase();
      for (const alias of searchable.aliases) {
        if (alias === termLower) {
          maxScore = Math.max(maxScore, 1);
          reasons.push(`alias match: "${alias}"`);
          continue;
        }
        const searchWords = termLower.split(/\s+/);
        const aliasWords = alias.split(/\s+/);
        for (const searchWord of searchWords) {
          for (const aliasWord of aliasWords) {
            if (areSynonyms(searchWord, aliasWord)) {
              maxScore = Math.max(maxScore, 0.85);
              reasons.push(`synonym match: "${searchWord}" ~ "${aliasWord}"`);
            }
          }
        }
        const result = fuzzyMatch(alias, termLower, { threshold });
        if (result.isMatch && result.similarity > maxScore) {
          maxScore = result.similarity;
          reasons.push(`fuzzy alias: "${alias}" (${(result.similarity * 100).toFixed(0)}%)`);
        }
        const tokenSim = tokenSimilarity(alias, termLower);
        if (tokenSim > maxScore && tokenSim >= threshold) {
          maxScore = tokenSim;
          reasons.push(`token match: "${alias}"`);
        }
      }
    }
    return { score: maxScore, reasons };
  }
  /**
   * Score containment match (is this element inside the specified container?)
   */
  scoreContainmentMatch(searchable, containerId) {
    if (searchable.parentContext) {
      const ctx = searchable.parentContext.toLowerCase();
      if (ctx.includes(containerId.toLowerCase()) || containerId.toLowerCase().includes(ctx)) {
        return { score: 1, reasons: [`inside ${searchable.parentContext}`] };
      }
    }
    const container = this.cachedElements.find((el) => el.id === containerId);
    if (container) {
      try {
        if ("getState" in searchable.element && "getState" in container.element) {
          const containerEl = container.element.element;
          const targetEl = searchable.element.element;
          if (containerEl && targetEl && containerEl.contains(targetEl)) {
            return { score: 1, reasons: [`DOM child of ${containerId}`] };
          }
        }
      } catch {
      }
      const cRect = container.rect;
      const eRect = searchable.rect;
      if (eRect.x >= cRect.x - 5 && eRect.y >= cRect.y - 5 && eRect.x + eRect.width <= cRect.x + cRect.width + 5 && eRect.y + eRect.height <= cRect.y + cRect.height + 5) {
        return { score: 0.8, reasons: [`spatially within ${containerId}`] };
      }
    }
    const containerLower = containerId.toLowerCase();
    if (searchable.parentContext) {
      const contextLower = searchable.parentContext.toLowerCase();
      for (const part of containerLower.split(/[\s-_]+/)) {
        if (part.length > 2 && contextLower.includes(part)) {
          return { score: 0.6, reasons: [`parent context partially matches ${containerId}`] };
        }
      }
    }
    return { score: 0, reasons: [] };
  }
  /**
   * Resolve the nearest semantic container for an element.
   * Walks up the DOM tree looking for forms, dialogs, nav, sections, etc.
   */
  resolveParentContext(element) {
    try {
      let el = null;
      if ("getState" in element && typeof element.getState === "function") {
        el = element.element;
      }
      if (!el) return void 0;
      let ancestor = el.parentElement;
      while (ancestor) {
        const role = ancestor.getAttribute("role");
        const tag = ancestor.tagName.toLowerCase();
        const isContainer = role === "dialog" || role === "alertdialog" || role === "form" || role === "navigation" || role === "region" || role === "group" || role === "tabpanel" || role === "toolbar" || role === "complementary" || tag === "form" || tag === "nav" || tag === "section" || tag === "aside" || tag === "dialog" || tag === "details" || tag === "fieldset" || tag === "main" || tag === "header" || tag === "footer";
        if (isContainer) {
          const label = ancestor.getAttribute("aria-label") || ancestor.getAttribute("data-testid") || ancestor.id || "";
          return label ? `${role || tag}[${label}]` : role || tag;
        }
        ancestor = ancestor.parentElement;
      }
    } catch {
    }
    return void 0;
  }
  /**
   * Infer aliases from icon CSS classes for icon-only elements.
   */
  inferIconAliases(element) {
    try {
      let el = null;
      if ("getState" in element && typeof element.getState === "function") {
        el = element.element;
      }
      if (!el) return [];
      const classSource = [Array.from(el.classList).join(" ")];
      const iconChild = el.querySelector('svg, [class*="icon"], i[class]');
      if (iconChild) {
        classSource.push(Array.from(iconChild.classList).join(" "));
      }
      const allClasses = classSource.join(" ").toLowerCase();
      if (!allClasses) return [];
      const foundAliases = [];
      for (const [meaning, patterns] of Object.entries(_SearchEngine.ICON_CLASS_MAP)) {
        if (patterns.some((p) => allClasses.includes(p))) {
          foundAliases.push(meaning);
        }
      }
      return foundAliases;
    } catch {
      return [];
    }
  }
  /**
   * Match a string against a pattern (supports * wildcard)
   */
  matchPattern(str, pattern) {
    const regexPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
    return new RegExp(`^${regexPattern}$`, "i").test(str);
  }
  /**
   * Convert searchable element to AI discovered element
   */
  toAIDiscoveredElement(searchable) {
    const discoveredBase = "getState" in searchable.element ? {
      id: searchable.id,
      type: searchable.type,
      label: searchable.element.label,
      tagName: searchable.tagName,
      role: searchable.role,
      accessibleName: searchable.ariaLabel,
      actions: searchable.element.actions,
      state: searchable.state,
      registered: true
    } : searchable.element;
    return {
      ...discoveredBase,
      description: searchable.description,
      aliases: searchable.aliases,
      purpose: generatePurpose({
        textContent: searchable.textContent,
        ariaLabel: searchable.ariaLabel,
        elementType: searchable.type,
        tagName: searchable.tagName
      }),
      parentContext: searchable.parentContext,
      suggestedActions: generateSuggestedActions({
        textContent: searchable.textContent,
        ariaLabel: searchable.ariaLabel,
        elementType: searchable.type,
        tagName: searchable.tagName
      }),
      semanticType: this.inferSemanticType(searchable),
      labelText: searchable.labelText,
      placeholder: searchable.placeholder,
      title: searchable.title
    };
  }
  /**
   * Infer a semantic type for the element
   */
  inferSemanticType(searchable) {
    const text = (searchable.textContent || searchable.ariaLabel || "").toLowerCase();
    const type = searchable.type.toLowerCase();
    if (type === "input" || type === "textarea") {
      if (searchable.placeholder?.toLowerCase().includes("email") || text.includes("email")) {
        return "email-input";
      }
      if (searchable.placeholder?.toLowerCase().includes("password") || text.includes("password")) {
        return "password-input";
      }
      if (searchable.placeholder?.toLowerCase().includes("search") || text.includes("search")) {
        return "search-input";
      }
      return "text-input";
    }
    if (type === "button") {
      if (text.match(/submit|save|confirm|ok|done|apply/)) return "submit-button";
      if (text.match(/cancel|close|dismiss/)) return "cancel-button";
      if (text.match(/delete|remove|trash/)) return "delete-button";
      if (text.match(/add|create|new|\+/)) return "add-button";
      if (text.match(/edit|modify/)) return "edit-button";
      if (text.match(/next|continue/)) return "next-button";
      if (text.match(/back|previous/)) return "back-button";
      return "action-button";
    }
    if (type === "link") {
      if (text.match(/home|dashboard/)) return "home-link";
      if (text.match(/login|sign.?in/)) return "login-link";
      if (text.match(/logout|sign.?out/)) return "logout-link";
      return "navigation-link";
    }
    return type;
  }
};
/**
 * Known icon class patterns → semantic meaning
 */
_SearchEngine.ICON_CLASS_MAP = {
  close: [
    "close",
    "x-mark",
    "times",
    "dismiss",
    "lucide-x",
    "fa-times",
    "mdi-close",
    "ri-close-line",
    "icon-x"
  ],
  delete: [
    "trash",
    "delete",
    "remove",
    "lucide-trash",
    "fa-trash",
    "mdi-delete",
    "ri-delete-bin"
  ],
  edit: ["edit", "pencil", "pen", "lucide-pencil", "fa-edit", "mdi-pencil", "ri-edit"],
  search: ["search", "magnify", "lucide-search", "fa-search", "mdi-magnify", "ri-search"],
  menu: ["menu", "hamburger", "bars", "lucide-menu", "fa-bars", "mdi-menu", "ri-menu"],
  more: ["more", "dots", "ellipsis", "lucide-more", "fa-ellipsis", "mdi-dots", "ri-more"],
  add: ["plus", "add", "lucide-plus", "fa-plus", "mdi-plus", "ri-add"],
  back: [
    "arrow-left",
    "chevron-left",
    "back",
    "lucide-arrow-left",
    "fa-arrow-left",
    "ri-arrow-left"
  ],
  forward: ["arrow-right", "chevron-right", "forward", "lucide-arrow-right", "ri-arrow-right"],
  expand: ["chevron-down", "expand", "caret-down", "lucide-chevron-down", "fa-caret-down"],
  collapse: ["chevron-up", "collapse", "caret-up", "lucide-chevron-up", "fa-caret-up"],
  settings: ["gear", "cog", "settings", "lucide-settings", "fa-cog", "mdi-cog", "ri-settings"],
  info: ["info", "circle-info", "lucide-info", "fa-info-circle", "ri-information"],
  warning: [
    "warning",
    "alert-triangle",
    "exclamation",
    "lucide-alert-triangle",
    "fa-exclamation-triangle"
  ],
  copy: ["copy", "clipboard", "lucide-copy", "fa-copy", "mdi-content-copy", "ri-file-copy"],
  download: ["download", "lucide-download", "fa-download", "mdi-download", "ri-download"],
  upload: ["upload", "lucide-upload", "fa-upload", "mdi-upload", "ri-upload"],
  refresh: ["refresh", "reload", "rotate", "lucide-refresh-cw", "fa-sync", "mdi-refresh"],
  save: ["save", "floppy", "lucide-save", "fa-save", "mdi-content-save"],
  home: ["home", "house", "lucide-home", "fa-home", "mdi-home", "ri-home"],
  user: ["user", "person", "avatar", "lucide-user", "fa-user", "mdi-account", "ri-user"],
  lock: ["lock", "lucide-lock", "fa-lock", "mdi-lock", "ri-lock"],
  unlock: ["unlock", "lucide-unlock", "fa-unlock", "mdi-lock-open"],
  star: ["star", "favorite", "lucide-star", "fa-star", "mdi-star", "ri-star"],
  heart: ["heart", "like", "lucide-heart", "fa-heart", "mdi-heart"],
  filter: ["filter", "funnel", "lucide-filter", "fa-filter", "mdi-filter", "ri-filter"],
  sort: ["sort", "lucide-arrow-up-down", "fa-sort", "mdi-sort"],
  share: ["share", "lucide-share", "fa-share", "mdi-share", "ri-share"],
  play: ["play", "lucide-play", "fa-play", "mdi-play", "ri-play"],
  pause: ["pause", "lucide-pause", "fa-pause", "mdi-pause", "ri-pause"],
  stop: ["stop", "square", "lucide-square", "fa-stop", "mdi-stop"]
};
var SearchEngine = _SearchEngine;

// src/ai/summary-generator.ts
var DEFAULT_SUMMARY_CONFIG = {
  maxLength: 2e3,
  includeForms: true,
  includeElementCounts: true,
  includeModals: true,
  includeFocused: true,
  verbosity: "normal"
};
function generatePageSummary(elements, pageContext, config = {}) {
  const finalConfig = { ...DEFAULT_SUMMARY_CONFIG, ...config };
  const lines = [];
  if (pageContext) {
    if (pageContext.title) {
      lines.push(`Page: "${pageContext.title}"`);
    }
    if (pageContext.pageType && pageContext.pageType !== "unknown") {
      lines.push(`Type: ${formatPageType(pageContext.pageType)}`);
    }
  }
  if (finalConfig.includeElementCounts) {
    const counts = countElementTypes(elements);
    const countParts = [];
    if (counts.button > 0)
      countParts.push(`${counts.button} button${counts.button > 1 ? "s" : ""}`);
    if (counts.input > 0) countParts.push(`${counts.input} input${counts.input > 1 ? "s" : ""}`);
    if (counts.link > 0) countParts.push(`${counts.link} link${counts.link > 1 ? "s" : ""}`);
    if (counts.select > 0)
      countParts.push(`${counts.select} dropdown${counts.select > 1 ? "s" : ""}`);
    if (counts.checkbox > 0)
      countParts.push(`${counts.checkbox} checkbox${counts.checkbox > 1 ? "es" : ""}`);
    if (countParts.length > 0) {
      lines.push(`Contains: ${countParts.join(", ")}`);
    }
  }
  if (finalConfig.includeForms) {
    const forms = detectForms(elements);
    if (forms.length > 0) {
      lines.push("");
      lines.push("Forms:");
      for (const form of forms) {
        lines.push(generateFormSummary(form, finalConfig.verbosity));
      }
    }
  }
  if (finalConfig.includeModals && pageContext?.activeModals && pageContext.activeModals.length > 0) {
    lines.push("");
    lines.push(`Active modals: ${pageContext.activeModals.join(", ")}`);
  }
  if (finalConfig.includeFocused && pageContext?.focusedElement) {
    lines.push(`Focus: ${pageContext.focusedElement}`);
  }
  const keyElements = getKeyElements(elements);
  if (keyElements.length > 0) {
    lines.push("");
    lines.push("Key elements:");
    for (const el of keyElements) {
      lines.push(`  - ${el.description}${el.state.enabled ? "" : " (disabled)"}`);
    }
  }
  let summary = lines.join("\n");
  if (summary.length > finalConfig.maxLength) {
    summary = summary.substring(0, finalConfig.maxLength - 3) + "...";
  }
  return summary;
}
function generateFormSummary(form, verbosity) {
  const lines = [];
  const formName = form.name || form.purpose || form.id;
  lines.push(`  ${formName}:`);
  if (verbosity === "brief") {
    const fieldCount = form.fields.length;
    const filledCount = form.fields.filter((f) => f.value).length;
    lines.push(
      `    ${filledCount}/${fieldCount} fields filled, ${form.isValid ? "valid" : "has errors"}`
    );
  } else {
    for (const field of form.fields) {
      let fieldLine = `    - ${field.label || field.id}`;
      if (field.value) {
        fieldLine += ` = "${truncate(field.value, 15)}"`;
      } else if (field.placeholder) {
        fieldLine += ` (${field.placeholder})`;
      } else {
        fieldLine += " (empty)";
      }
      if (!field.valid && field.error) {
        fieldLine += ` [ERROR: ${field.error}]`;
      } else if (field.required && !field.value) {
        fieldLine += " [required]";
      }
      lines.push(fieldLine);
    }
    if (form.submitButton) {
      lines.push(`    Submit: ${form.submitButton}`);
    }
  }
  return lines.join("\n");
}
function generateDiffSummary(appeared, disappeared, modified) {
  const lines = [];
  if (appeared.length > 0) {
    lines.push(`Appeared: ${appeared.join(", ")}`);
  }
  if (disappeared.length > 0) {
    lines.push(`Disappeared: ${disappeared.join(", ")}`);
  }
  if (modified.length > 0) {
    lines.push("Changed:");
    for (const mod of modified.slice(0, 5)) {
      lines.push(
        `  - ${mod.description}: ${mod.property} changed from "${mod.from}" to "${mod.to}"`
      );
    }
    if (modified.length > 5) {
      lines.push(`  ... and ${modified.length - 5} more changes`);
    }
  }
  if (lines.length === 0) {
    return "No changes detected";
  }
  return lines.join("\n");
}
function countElementTypes(elements) {
  const counts = {};
  for (const el of elements) {
    const type = el.type.toLowerCase();
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}
function detectForms(elements) {
  const formElements = elements.filter(
    (el) => el.type === "input" || el.type === "textarea" || el.type === "select" || el.type === "checkbox"
  );
  if (formElements.length === 0) return [];
  const forms = [];
  const submitButtons = elements.filter(
    (el) => el.type === "button" && (el.state.textContent?.toLowerCase().includes("submit") || el.state.textContent?.toLowerCase().includes("save") || el.state.textContent?.toLowerCase().includes("send") || el.semanticType === "submit-button")
  );
  const defaultForm = {
    id: "detected-form",
    purpose: inferFormPurpose2(formElements),
    fields: formElements.map((el) => ({
      id: el.id,
      label: el.labelText || el.accessibleName || el.placeholder || el.id,
      type: el.type,
      value: el.state.value || "",
      valid: true,
      // Can't determine without validation state
      required: false,
      // Can't determine without DOM access
      placeholder: el.placeholder
    })),
    isValid: true,
    submitButton: submitButtons[0]?.id
  };
  if (defaultForm.fields.length > 0) {
    forms.push(defaultForm);
  }
  return forms;
}
function inferFormPurpose2(fields) {
  const labels = fields.map(
    (f) => (f.labelText || f.accessibleName || f.placeholder || "").toLowerCase()
  );
  const allLabels = labels.join(" ");
  if (allLabels.includes("email") && allLabels.includes("password")) {
    if (allLabels.includes("confirm") || allLabels.includes("name")) {
      return "Registration form";
    }
    return "Login form";
  }
  if (allLabels.includes("search")) {
    return "Search form";
  }
  if (allLabels.includes("address") || allLabels.includes("city") || allLabels.includes("zip")) {
    return "Address form";
  }
  if (allLabels.includes("card") || allLabels.includes("cvv") || allLabels.includes("expir")) {
    return "Payment form";
  }
  if (allLabels.includes("contact") || allLabels.includes("message")) {
    return "Contact form";
  }
  return "Form";
}
function getKeyElements(elements) {
  const keyElements = [];
  const actionButtons = elements.filter(
    (el) => el.type === "button" && el.state.visible && (el.semanticType?.includes("submit") || el.semanticType?.includes("action") || el.semanticType?.includes("next"))
  );
  keyElements.push(...actionButtons.slice(0, 2));
  const primaryInputs = elements.filter(
    (el) => (el.type === "input" || el.type === "textarea") && el.state.visible
  );
  keyElements.push(...primaryInputs.slice(0, 3));
  const links = elements.filter((el) => el.type === "link" && el.state.visible);
  keyElements.push(...links.slice(0, 2));
  const unique = [...new Map(keyElements.map((e) => [e.id, e])).values()];
  return unique.slice(0, 8);
}
function formatPageType(pageType) {
  const typeLabels = {
    login: "Login page",
    dashboard: "Dashboard",
    form: "Form page",
    list: "List/table page",
    detail: "Detail page",
    search: "Search page",
    checkout: "Checkout page",
    settings: "Settings page",
    unknown: "Unknown"
  };
  return typeLabels[pageType || "unknown"] || "Page";
}
function truncate(str, maxLength) {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}
function inferPageType(url, title, elements) {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();
  if (urlLower.includes("login") || urlLower.includes("signin")) return "login";
  if (urlLower.includes("dashboard")) return "dashboard";
  if (urlLower.includes("search")) return "search";
  if (urlLower.includes("checkout") || urlLower.includes("payment")) return "checkout";
  if (urlLower.includes("settings") || urlLower.includes("preferences")) return "settings";
  if (titleLower.includes("login") || titleLower.includes("sign in")) return "login";
  if (titleLower.includes("dashboard")) return "dashboard";
  if (titleLower.includes("search")) return "search";
  const hasLoginForm = elements.some((el) => el.type === "input" && el.semanticType === "email-input") && elements.some((el) => el.type === "input" && el.semanticType === "password-input");
  if (hasLoginForm) return "login";
  const hasSearchInput = elements.some(
    (el) => el.type === "input" && el.semanticType === "search-input"
  );
  if (hasSearchInput) return "search";
  const inputCount = elements.filter(
    (el) => el.type === "input" || el.type === "textarea" || el.type === "select"
  ).length;
  if (inputCount >= 3) return "form";
  const hasTable = elements.some((el) => el.tagName === "table");
  const hasMany = elements.length > 20;
  if (hasTable || hasMany) return "list";
  return "unknown";
}

// src/ai/nl-action-parser.ts
var ACTION_PATTERNS = [
  // Click patterns
  {
    regex: /^click\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button)?$/i,
    action: "click",
    targetGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^press\s+(?:the\s+)?(.+?)(?:\s+button)?$/i,
    action: "click",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^tap\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "click",
    targetGroup: 1,
    confidence: 0.85
  },
  {
    regex: /^activate\s+(?:the\s+)?(.+)$/i,
    action: "click",
    targetGroup: 1,
    confidence: 0.8
  },
  // Double click patterns
  {
    regex: /^double[\s-]?click\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "doubleClick",
    targetGroup: 1,
    confidence: 0.95
  },
  // Right click patterns
  {
    regex: /^right[\s-]?click\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "rightClick",
    targetGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^context\s+click\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "rightClick",
    targetGroup: 1,
    confidence: 0.9
  },
  // Type patterns - "type X in Y"
  {
    regex: /^type\s+["'](.+?)["']\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^type\s+(.+?)\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.85
  },
  // Type patterns - "enter X in Y"
  {
    regex: /^enter\s+["'](.+?)["']\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^enter\s+(.+?)\s+(?:in(?:to)?|on)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.85
  },
  // Type patterns - "input X into Y"
  {
    regex: /^input\s+["'](.+?)["']\s+(?:in(?:to)?)\s+(?:the\s+)?(.+)$/i,
    action: "type",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.9
  },
  // Type patterns - "fill Y with X"
  {
    regex: /^fill\s+(?:in\s+)?(?:the\s+)?(.+?)\s+with\s+["'](.+?)["']$/i,
    action: "type",
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.95
  },
  {
    regex: /^fill\s+(?:in\s+)?(?:the\s+)?(.+?)\s+with\s+(.+)$/i,
    action: "type",
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.85
  },
  // Type patterns - "set Y to X"
  {
    regex: /^set\s+(?:the\s+)?(.+?)\s+to\s+["'](.+?)["']$/i,
    action: "type",
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.9
  },
  // Select patterns
  {
    regex: /^select\s+["'](.+?)["']\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    action: "select",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.95
  },
  {
    regex: /^choose\s+["'](.+?)["']\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    action: "select",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^pick\s+["'](.+?)["']\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    action: "select",
    targetGroup: 2,
    valueGroup: 1,
    confidence: 0.85
  },
  // Check patterns
  {
    regex: /^check\s+(?:the\s+)?(.+?)(?:\s+checkbox)?$/i,
    action: "check",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^enable\s+(?:the\s+)?(.+)$/i,
    action: "check",
    targetGroup: 1,
    confidence: 0.8
  },
  {
    regex: /^tick\s+(?:the\s+)?(.+)$/i,
    action: "check",
    targetGroup: 1,
    confidence: 0.85
  },
  // Uncheck patterns
  {
    regex: /^uncheck\s+(?:the\s+)?(.+?)(?:\s+checkbox)?$/i,
    action: "uncheck",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^disable\s+(?:the\s+)?(.+)$/i,
    action: "uncheck",
    targetGroup: 1,
    confidence: 0.8
  },
  {
    regex: /^untick\s+(?:the\s+)?(.+)$/i,
    action: "uncheck",
    targetGroup: 1,
    confidence: 0.85
  },
  // Clear patterns
  {
    regex: /^clear\s+(?:the\s+)?(.+)$/i,
    action: "clear",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^erase\s+(?:the\s+)?(.+)$/i,
    action: "clear",
    targetGroup: 1,
    confidence: 0.85
  },
  {
    regex: /^empty\s+(?:the\s+)?(.+)$/i,
    action: "clear",
    targetGroup: 1,
    confidence: 0.8
  },
  // Hover patterns
  {
    regex: /^hover\s+(?:over\s+)?(?:the\s+)?(.+)$/i,
    action: "hover",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^mouse\s+over\s+(?:the\s+)?(.+)$/i,
    action: "hover",
    targetGroup: 1,
    confidence: 0.85
  },
  // Focus patterns
  {
    regex: /^focus\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    action: "focus",
    targetGroup: 1,
    confidence: 0.9
  },
  // Scroll patterns
  {
    regex: /^scroll\s+(up|down|left|right)$/i,
    action: "scroll",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^scroll\s+(?:the\s+)?(.+?)\s+(up|down|left|right)$/i,
    action: "scroll",
    targetGroup: 1,
    confidence: 0.85
  },
  {
    regex: /^scroll\s+to\s+(?:the\s+)?(.+)$/i,
    action: "scroll",
    targetGroup: 1,
    confidence: 0.85
  },
  // Wait patterns
  {
    regex: /^wait\s+(?:for\s+)?(?:the\s+)?(.+?)(?:\s+to\s+(?:be\s+)?(.+))?$/i,
    action: "wait",
    targetGroup: 1,
    confidence: 0.85
  },
  {
    regex: /^wait\s+until\s+(?:the\s+)?(.+?)(?:\s+(?:is|becomes)\s+(.+))?$/i,
    action: "wait",
    targetGroup: 1,
    confidence: 0.85
  },
  // Assert patterns
  {
    regex: /^(?:assert|verify|check)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+(?:is\s+)?(visible|hidden|enabled|disabled|checked|unchecked|focused)$/i,
    action: "assert",
    targetGroup: 1,
    confidence: 0.9
  },
  {
    regex: /^(?:assert|verify|check)\s+(?:that\s+)?(?:the\s+)?(.+?)\s+(?:contains|has)\s+["'](.+?)["']$/i,
    action: "assert",
    targetGroup: 1,
    valueGroup: 2,
    confidence: 0.9
  },
  {
    regex: /^(?:the\s+)?(.+?)\s+should\s+(?:be\s+)?(visible|hidden|enabled|disabled|checked|unchecked|focused)$/i,
    action: "assert",
    targetGroup: 1,
    confidence: 0.85
  }
];
var ASSERTION_TYPE_MAP = {
  visible: "visible",
  hidden: "hidden",
  enabled: "enabled",
  disabled: "disabled",
  checked: "checked",
  unchecked: "unchecked",
  focused: "focused",
  contains: "containsText",
  has: "hasText"
};
function parseNLInstruction(instruction) {
  const trimmed = instruction.trim();
  if (!trimmed) return null;
  for (const pattern of ACTION_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      const parsed = {
        action: pattern.action,
        targetDescription: cleanTargetDescription(match[pattern.targetGroup] || ""),
        rawInstruction: instruction,
        parseConfidence: pattern.confidence
      };
      if (pattern.valueGroup && match[pattern.valueGroup]) {
        parsed.value = match[pattern.valueGroup];
      }
      if (pattern.modifierExtractor) {
        parsed.modifiers = pattern.modifierExtractor(match);
      }
      if (pattern.action === "scroll") {
        const directionMatch = trimmed.match(/(up|down|left|right)/i);
        if (directionMatch) {
          parsed.scrollDirection = directionMatch[1].toLowerCase();
        }
      }
      if (pattern.action === "assert") {
        const assertMatch = trimmed.match(
          /(visible|hidden|enabled|disabled|checked|unchecked|focused|contains|has)/i
        );
        if (assertMatch) {
          parsed.assertionType = ASSERTION_TYPE_MAP[assertMatch[1].toLowerCase()];
        }
      }
      if (pattern.action === "wait") {
        const waitCondition = match[2];
        if (waitCondition) {
          parsed.waitCondition = waitCondition;
        }
      }
      return parsed;
    }
  }
  return inferAction(trimmed);
}
function cleanTargetDescription(target) {
  return target.trim().replace(/^(the|a|an)\s+/i, "").replace(/\s+(button|field|input|link|dropdown|checkbox|radio)$/i, "").trim();
}
function inferAction(instruction) {
  const lower = instruction.toLowerCase();
  if (lower.includes("click") || lower.includes("press") || lower.includes("tap")) {
    const target = instruction.replace(/click|press|tap|on|the/gi, "").trim();
    if (target) {
      return {
        action: "click",
        targetDescription: cleanTargetDescription(target),
        rawInstruction: instruction,
        parseConfidence: 0.6
      };
    }
  }
  if (lower.includes("type") || lower.includes("enter") || lower.includes("input")) {
    const quotedMatch = instruction.match(/["'](.+?)["']/);
    if (quotedMatch) {
      const target = instruction.replace(/type|enter|input|into|in|the|["'].*?["']/gi, "").trim();
      return {
        action: "type",
        targetDescription: cleanTargetDescription(target),
        value: quotedMatch[1],
        rawInstruction: instruction,
        parseConfidence: 0.5
      };
    }
  }
  return null;
}
function validateParsedAction(action) {
  const errors = [];
  if (!action.targetDescription && action.action !== "scroll") {
    errors.push("No target element specified");
  }
  if ((action.action === "type" || action.action === "select") && !action.value) {
    errors.push(`No value specified for ${action.action} action`);
  }
  if (action.parseConfidence < 0.5) {
    errors.push("Low confidence parsing - instruction may be ambiguous");
  }
  return {
    valid: errors.length === 0,
    errors
  };
}
function describeAction(action) {
  switch (action.action) {
    case "click":
      return `Click on "${action.targetDescription}"`;
    case "doubleClick":
      return `Double-click on "${action.targetDescription}"`;
    case "rightClick":
      return `Right-click on "${action.targetDescription}"`;
    case "type":
      return `Type "${action.value}" into "${action.targetDescription}"`;
    case "select":
      return `Select "${action.value}" from "${action.targetDescription}"`;
    case "check":
      return `Check "${action.targetDescription}"`;
    case "uncheck":
      return `Uncheck "${action.targetDescription}"`;
    case "clear":
      return `Clear "${action.targetDescription}"`;
    case "hover":
      return `Hover over "${action.targetDescription}"`;
    case "focus":
      return `Focus on "${action.targetDescription}"`;
    case "scroll":
      if (action.scrollDirection) {
        return `Scroll ${action.scrollDirection}`;
      }
      return `Scroll to "${action.targetDescription}"`;
    case "wait":
      return `Wait for "${action.targetDescription}"${action.waitCondition ? ` to be ${action.waitCondition}` : ""}`;
    case "assert":
      return `Assert "${action.targetDescription}" is ${action.assertionType || "valid"}`;
    default:
      return `${action.action} on "${action.targetDescription}"`;
  }
}

// src/ai/error-context.ts
function getElementState2(el) {
  if ("state" in el && el.state) {
    return el.state;
  }
  if ("getState" in el && typeof el.getState === "function") {
    try {
      return el.getState();
    } catch {
      return void 0;
    }
  }
  return void 0;
}
var ERROR_MESSAGES = {
  PARSE_ERROR: "Could not parse the natural language instruction",
  VALIDATION_ERROR: "The parsed action failed validation",
  ELEMENT_NOT_FOUND: "No element matching the description could be found",
  ELEMENT_NOT_VISIBLE: "The element exists but is not visible",
  ELEMENT_DISABLED: "The element is disabled and cannot be interacted with",
  ELEMENT_BLOCKED: "The element is blocked by another element",
  MULTIPLE_ELEMENTS: "Multiple elements match the description",
  LOW_CONFIDENCE: "The best match has low confidence",
  AMBIGUOUS_MATCH: "Multiple elements match with similar confidence",
  ACTION_FAILED: "The action could not be completed",
  ACTION_TIMEOUT: "The action timed out waiting for a condition",
  UNSUPPORTED_ACTION: "The requested action is not supported",
  UNEXPECTED_STATE: "The element is in an unexpected state",
  STALE_ELEMENT: "The element is no longer attached to the DOM",
  PAGE_LOAD_ERROR: "The page failed to load correctly",
  NAVIGATION_ERROR: "Navigation to the target page failed"
};
var ERROR_SUGGESTIONS = {
  PARSE_ERROR: [
    {
      action: 'Use a simpler instruction format like "click Submit button"',
      confidence: 0.8,
      priority: 1
    },
    {
      action: "Use specific element names visible on the page",
      confidence: 0.7,
      priority: 2
    }
  ],
  VALIDATION_ERROR: [
    {
      action: "Provide required parameters for the action",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Check the instruction format",
      confidence: 0.7,
      priority: 2
    }
  ],
  ELEMENT_NOT_FOUND: [
    {
      action: "Wait for the page to fully load",
      command: "wait for page to load",
      confidence: 0.7,
      priority: 1
    },
    {
      action: "Use a different description for the element",
      confidence: 0.8,
      priority: 2
    },
    {
      action: "Scroll the page to reveal the element",
      command: "scroll down",
      confidence: 0.6,
      priority: 3
    }
  ],
  ELEMENT_NOT_VISIBLE: [
    {
      action: "Scroll to make the element visible",
      command: "scroll to element",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Close any overlaying elements",
      confidence: 0.7,
      priority: 2
    },
    {
      action: "Wait for loading to complete",
      command: "wait for loading",
      confidence: 0.6,
      priority: 3
    }
  ],
  ELEMENT_DISABLED: [
    {
      action: "Fill in required fields first",
      confidence: 0.8,
      priority: 1
    },
    {
      action: "Complete prerequisite steps",
      confidence: 0.7,
      priority: 2
    },
    {
      action: "Wait for the element to become enabled",
      command: "wait for element to be enabled",
      confidence: 0.6,
      priority: 3
    }
  ],
  ELEMENT_BLOCKED: [
    {
      action: "Close the modal or popup",
      command: "click close button",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Dismiss the overlay",
      confidence: 0.8,
      priority: 2
    },
    {
      action: "Wait for the blocking element to disappear",
      confidence: 0.6,
      priority: 3
    }
  ],
  MULTIPLE_ELEMENTS: [
    {
      action: "Use a more specific description",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Include the element position (first, second, etc.)",
      confidence: 0.8,
      priority: 2
    },
    {
      action: "Use the element ID directly",
      confidence: 0.7,
      priority: 3
    }
  ],
  LOW_CONFIDENCE: [
    {
      action: "Use the exact text shown on the element",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Lower the confidence threshold if the match is correct",
      confidence: 0.7,
      priority: 2
    },
    {
      action: "Try a different way to describe the element",
      confidence: 0.6,
      priority: 3
    }
  ],
  AMBIGUOUS_MATCH: [
    {
      action: "Be more specific about which element you mean",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Include the section or form name",
      confidence: 0.8,
      priority: 2
    }
  ],
  ACTION_FAILED: [
    {
      action: "Check if the element is interactable",
      confidence: 0.7,
      priority: 1
    },
    {
      action: "Wait and retry the action",
      command: "wait 1 second then retry",
      confidence: 0.6,
      priority: 2
    }
  ],
  ACTION_TIMEOUT: [
    {
      action: "Increase the timeout duration",
      confidence: 0.8,
      priority: 1
    },
    {
      action: "Check if the condition can ever be met",
      confidence: 0.7,
      priority: 2
    }
  ],
  UNSUPPORTED_ACTION: [
    {
      action: "Use a different action type",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Break down into simpler actions",
      confidence: 0.7,
      priority: 2
    }
  ],
  UNEXPECTED_STATE: [
    {
      action: "Refresh the page state",
      command: "refresh",
      confidence: 0.7,
      priority: 1
    },
    {
      action: "Wait for state to stabilize",
      command: "wait 2 seconds",
      confidence: 0.6,
      priority: 2
    }
  ],
  STALE_ELEMENT: [
    {
      action: "Re-find the element",
      confidence: 0.9,
      priority: 1
    },
    {
      action: "Wait for page to stabilize",
      command: "wait 1 second",
      confidence: 0.7,
      priority: 2
    }
  ],
  PAGE_LOAD_ERROR: [
    {
      action: "Refresh the page",
      command: "refresh page",
      confidence: 0.8,
      priority: 1
    },
    {
      action: "Check network connectivity",
      confidence: 0.6,
      priority: 2
    }
  ],
  NAVIGATION_ERROR: [
    {
      action: "Try the navigation again",
      confidence: 0.7,
      priority: 1
    },
    {
      action: "Check if the URL is correct",
      confidence: 0.6,
      priority: 2
    }
  ]
};
function createErrorContext(errorCode, attemptedAction, availableElements, searchCriteria, nearestMatch) {
  const message = ERROR_MESSAGES[errorCode] || "An unknown error occurred";
  const baseSuggestions = ERROR_SUGGESTIONS[errorCode] || [];
  const possibleBlockers = detectPossibleBlockers(availableElements);
  const visibleElements = availableElements.filter((el) => {
    const state = getElementState2(el);
    return state?.visible ?? false;
  }).length;
  const suggestions = enhanceSuggestions(
    baseSuggestions,
    errorCode,
    nearestMatch,
    possibleBlockers
  );
  return {
    code: errorCode,
    message,
    attemptedAction,
    searchCriteria,
    searchResults: {
      candidatesFound: availableElements.length,
      nearestMatch: nearestMatch ? {
        element: nearestMatch.element,
        confidence: nearestMatch.confidence,
        whyNotSelected: determineWhyNotSelected(errorCode, nearestMatch)
      } : void 0
    },
    pageContext: {
      url: typeof window !== "undefined" ? window.location.href : "",
      title: typeof document !== "undefined" ? document.title : "",
      visibleElements,
      possibleBlockers
    },
    suggestions,
    timestamp: Date.now()
  };
}
function detectPossibleBlockers(elements) {
  const blockers = [];
  for (const el of elements) {
    const state = getElementState2(el);
    if (!state) continue;
    if (el.type === "dialog" && state.visible) {
      blockers.push(`Modal dialog: ${el.id}`);
    }
    if (state.computedStyles?.pointerEvents === "none") {
      continue;
    }
  }
  return blockers;
}
function enhanceSuggestions(baseSuggestions, errorCode, nearestMatch, possibleBlockers) {
  const suggestions = [...baseSuggestions];
  if (possibleBlockers && possibleBlockers.length > 0) {
    suggestions.unshift({
      action: `Close the blocking element: ${possibleBlockers[0]}`,
      command: "click close button",
      confidence: 0.85,
      priority: 0
    });
  }
  if (nearestMatch && errorCode === "LOW_CONFIDENCE") {
    suggestions.unshift({
      action: `Did you mean: "${nearestMatch.element.description}"?`,
      command: `click "${nearestMatch.element.description}"`,
      confidence: nearestMatch.confidence,
      priority: 0
    });
  }
  suggestions.sort((a, b) => a.priority - b.priority);
  return suggestions;
}
function determineWhyNotSelected(errorCode, nearestMatch) {
  switch (errorCode) {
    case "LOW_CONFIDENCE":
      return `Confidence (${(nearestMatch.confidence * 100).toFixed(0)}%) below threshold`;
    case "ELEMENT_NOT_VISIBLE":
      return "Element is not visible";
    case "ELEMENT_DISABLED":
      return "Element is disabled";
    case "AMBIGUOUS_MATCH":
      return "Multiple elements with similar confidence";
    default:
      return "Did not meet selection criteria";
  }
}

// src/ai/nl-action-executor.ts
var DEFAULT_EXECUTOR_CONFIG = {
  defaultConfidenceThreshold: 0.7,
  defaultTimeout: 5e3,
  maxAlternatives: 3,
  verbose: false
};
var NLActionExecutor = class {
  constructor(config = {}) {
    this.actionExecutor = null;
    this.elements = [];
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    this.searchEngine = new SearchEngine(this.config.searchConfig);
  }
  /**
   * Set the action executor for performing DOM actions
   */
  setActionExecutor(executor) {
    this.actionExecutor = executor;
  }
  /**
   * Update available elements for search
   */
  updateElements(elements) {
    this.elements = elements;
    this.searchEngine.updateElements(elements);
  }
  /**
   * Execute a natural language instruction
   */
  async execute(request) {
    const startTime = performance.now();
    const threshold = request.confidenceThreshold ?? this.config.defaultConfidenceThreshold;
    const parsed = parseNLInstruction(request.instruction);
    if (!parsed) {
      return this.createFailureResponse(
        startTime,
        "PARSE_ERROR",
        `Could not parse instruction: "${request.instruction}"`,
        request.instruction,
        [],
        threshold
      );
    }
    const validation = validateParsedAction(parsed);
    if (!validation.valid) {
      return this.createFailureResponse(
        startTime,
        "VALIDATION_ERROR",
        validation.errors.join("; "),
        request.instruction,
        [],
        threshold
      );
    }
    const searchCriteria = this.buildSearchCriteria(parsed);
    const searchResponse = this.searchEngine.search(searchCriteria);
    if (!searchResponse.bestMatch) {
      return this.createFailureResponse(
        startTime,
        "ELEMENT_NOT_FOUND",
        `Could not find element matching: "${parsed.targetDescription}"`,
        request.instruction,
        searchResponse.results,
        threshold,
        searchCriteria
      );
    }
    if (searchResponse.bestMatch.confidence < threshold) {
      const alternatives = searchResponse.results.slice(0, this.config.maxAlternatives);
      return this.createFailureResponse(
        startTime,
        "LOW_CONFIDENCE",
        `Best match confidence (${(searchResponse.bestMatch.confidence * 100).toFixed(0)}%) is below threshold (${(threshold * 100).toFixed(0)}%)`,
        request.instruction,
        alternatives,
        threshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
    try {
      const result = await this.performAction(
        parsed,
        searchResponse.bestMatch.element,
        request.timeout ?? this.config.defaultTimeout
      );
      return {
        success: true,
        executedAction: describeAction(parsed),
        elementUsed: searchResponse.bestMatch.element,
        confidence: searchResponse.bestMatch.confidence,
        elementState: result.elementState,
        durationMs: performance.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error3) {
      const errorMessage = error3 instanceof Error ? error3.message : String(error3);
      const alternatives = searchResponse.results.filter((r) => r !== searchResponse.bestMatch).slice(0, this.config.maxAlternatives);
      return this.createFailureResponse(
        startTime,
        "ACTION_FAILED",
        errorMessage,
        request.instruction,
        alternatives,
        threshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
  }
  /**
   * Execute a parsed action directly (skip parsing)
   */
  async executeParsed(parsed, threshold) {
    const startTime = performance.now();
    const confidenceThreshold = threshold ?? this.config.defaultConfidenceThreshold;
    const searchCriteria = this.buildSearchCriteria(parsed);
    const searchResponse = this.searchEngine.search(searchCriteria);
    if (!searchResponse.bestMatch) {
      return this.createFailureResponse(
        startTime,
        "ELEMENT_NOT_FOUND",
        `Could not find element: "${parsed.targetDescription}"`,
        parsed.rawInstruction,
        [],
        confidenceThreshold,
        searchCriteria
      );
    }
    if (searchResponse.bestMatch.confidence < confidenceThreshold) {
      return this.createFailureResponse(
        startTime,
        "LOW_CONFIDENCE",
        `Best match confidence too low`,
        parsed.rawInstruction,
        searchResponse.results.slice(0, this.config.maxAlternatives),
        confidenceThreshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
    try {
      const result = await this.performAction(
        parsed,
        searchResponse.bestMatch.element,
        this.config.defaultTimeout
      );
      return {
        success: true,
        executedAction: describeAction(parsed),
        elementUsed: searchResponse.bestMatch.element,
        confidence: searchResponse.bestMatch.confidence,
        elementState: result.elementState,
        durationMs: performance.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error3) {
      return this.createFailureResponse(
        startTime,
        "ACTION_FAILED",
        error3 instanceof Error ? error3.message : String(error3),
        parsed.rawInstruction,
        searchResponse.results.filter((r) => r !== searchResponse.bestMatch).slice(0, this.config.maxAlternatives),
        confidenceThreshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
  }
  /**
   * Build search criteria from a parsed action.
   *
   * If `targetDescription` is `"element <kebab-id>"`, treat it as a direct
   * id lookup against the cached element registry — the planner uses this
   * form to bypass fuzzy label matching for elements with stable ids
   * (e.g. registered disclosures). Falls back to text + type-hint matching
   * for free-form descriptions.
   */
  buildSearchCriteria(parsed) {
    const idMatch = parsed.targetDescription.match(/^element\s+([\w-]+)$/i);
    if (idMatch) {
      const id = idMatch[1];
      const exists = this.elements.some((el) => el.id === id);
      if (exists) {
        return { idPattern: id };
      }
    }
    const criteria = {
      text: parsed.targetDescription,
      fuzzy: true,
      fuzzyThreshold: this.config.defaultConfidenceThreshold
    };
    switch (parsed.action) {
      case "click":
      case "doubleClick":
      case "rightClick":
        break;
      case "type":
      case "clear":
        criteria.type = "input";
        break;
      case "select":
        criteria.type = "select";
        break;
      case "check":
      case "uncheck":
        criteria.type = "checkbox";
        break;
    }
    return criteria;
  }
  /**
   * Perform the actual action on an element
   */
  async performAction(parsed, element, timeout) {
    if (!this.actionExecutor) {
      throw new Error("No action executor configured");
    }
    const actionMap = {
      click: "click",
      doubleClick: "doubleClick",
      rightClick: "rightClick",
      type: "type",
      select: "select",
      check: "check",
      uncheck: "uncheck",
      scroll: "scroll",
      wait: null,
      // Special handling
      assert: null,
      // Special handling
      hover: "hover",
      focus: "focus",
      clear: "clear"
    };
    const standardAction = actionMap[parsed.action];
    if (!standardAction) {
      if (parsed.action === "wait") {
        const waitResult = await this.actionExecutor.waitFor(element.id, {
          visible: true,
          timeout
        });
        if (!waitResult.met) {
          throw new Error(waitResult.error || "Wait condition not met");
        }
        return { elementState: waitResult.state };
      }
      if (parsed.action === "assert") {
        throw new Error("Use the assertions module for assert actions");
      }
      throw new Error(`Unsupported action: ${parsed.action}`);
    }
    const actionRequest = {
      action: standardAction,
      waitOptions: {
        visible: true,
        enabled: true,
        timeout
      }
    };
    if (standardAction === "type" && parsed.value) {
      actionRequest.params = { text: parsed.value };
    } else if (standardAction === "select" && parsed.value) {
      actionRequest.params = { value: parsed.value };
    } else if (standardAction === "scroll" && parsed.scrollDirection) {
      actionRequest.params = { direction: parsed.scrollDirection };
    }
    const response = await this.actionExecutor.executeAction(element.id, actionRequest);
    if (!response.success) {
      throw new Error(response.error || "Action failed");
    }
    return { elementState: response.elementState };
  }
  /**
   * Create a failure response with suggestions
   */
  createFailureResponse(startTime, errorCode, errorMessage, instruction, alternatives, threshold, searchCriteria, nearestMatch) {
    const suggestions = this.generateSuggestions(
      errorCode,
      instruction,
      alternatives,
      nearestMatch
    );
    const dummyElement = nearestMatch?.element || {
      id: "not-found",
      type: "unknown",
      tagName: "unknown",
      actions: [],
      state: {
        visible: false,
        enabled: false,
        focused: false,
        rect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }
      },
      registered: false,
      description: "Element not found",
      aliases: [],
      suggestedActions: []
    };
    return {
      success: false,
      executedAction: instruction,
      elementUsed: dummyElement,
      confidence: nearestMatch?.confidence || 0,
      elementState: dummyElement.state,
      durationMs: performance.now() - startTime,
      timestamp: Date.now(),
      error: errorMessage,
      errorCode,
      suggestions,
      alternatives: alternatives.slice(0, this.config.maxAlternatives)
    };
  }
  /**
   * Generate recovery suggestions
   */
  generateSuggestions(errorCode, instruction, alternatives, nearestMatch) {
    const suggestions = [];
    switch (errorCode) {
      case "PARSE_ERROR":
        suggestions.push('Try using a simpler phrase like "click Submit button"');
        suggestions.push(
          'Ensure the instruction follows patterns like "click X" or "type Y into X"'
        );
        break;
      case "ELEMENT_NOT_FOUND":
        if (alternatives.length > 0) {
          suggestions.push(`Did you mean: "${alternatives[0].element.description}"?`);
        }
        suggestions.push("Check if the element is visible on the page");
        suggestions.push("Try using a more specific description");
        break;
      case "LOW_CONFIDENCE":
        if (nearestMatch) {
          suggestions.push(
            `Found "${nearestMatch.element.description}" with ${(nearestMatch.confidence * 100).toFixed(0)}% confidence`
          );
        }
        suggestions.push("Try using the exact text shown on the element");
        suggestions.push("Lower the confidence threshold if this match is correct");
        break;
      case "ACTION_FAILED":
        suggestions.push("Check if the element is enabled");
        suggestions.push("Wait for any loading to complete");
        suggestions.push("Ensure no modal or overlay is blocking the element");
        break;
      default:
        suggestions.push("Try a different approach or check the page state");
    }
    return suggestions;
  }
  /**
   * Get rich error context for debugging
   */
  getErrorContext(errorCode, instruction, searchCriteria, nearestMatch) {
    return createErrorContext(
      errorCode,
      instruction,
      this.elements,
      searchCriteria,
      nearestMatch
    );
  }
};

// src/ai/assertions.ts
var DEFAULT_ASSERTION_CONFIG = {
  defaultTimeout: 5e3,
  pollInterval: 100,
  fuzzyThreshold: 0.7,
  includeSuggestions: true
};
var AssertionExecutor = class {
  constructor(config = {}) {
    this.elements = [];
    this.config = { ...DEFAULT_ASSERTION_CONFIG, ...config };
    this.searchEngine = new SearchEngine({ fuzzyThreshold: this.config.fuzzyThreshold });
  }
  /**
   * Update available elements for assertions
   */
  updateElements(elements) {
    this.elements = elements;
    this.searchEngine.updateElements(elements);
  }
  /**
   * Execute a single assertion
   */
  async assert(request) {
    const startTime = performance.now();
    const timeout = request.timeout ?? this.config.defaultTimeout;
    const searchResult = this.findElementDetailed(request.target, request.fuzzy !== false);
    const element = searchResult?.element ?? null;
    const searchDetails = searchResult ? {
      confidence: searchResult.confidence,
      matchReasons: searchResult.matchReasons,
      candidateCount: this.elements.length
    } : void 0;
    if (!element && request.type !== "notExists") {
      const result2 = this.createResult(
        false,
        typeof request.target === "string" ? request.target : JSON.stringify(request.target),
        "element not found",
        request.type === "exists" ? true : request.expected,
        null,
        "Element could not be found",
        this.config.includeSuggestions ? "Check if the element exists and is properly labeled" : void 0,
        startTime
      );
      if (searchDetails) {
        result2.searchDetails = searchDetails;
      }
      return result2;
    }
    const result = await this.executeAssertion(request, element, timeout, startTime);
    if (searchDetails) {
      result.searchDetails = searchDetails;
    }
    return result;
  }
  /**
   * Execute multiple assertions
   */
  async assertBatch(request) {
    const startTime = performance.now();
    const results = [];
    let passedCount = 0;
    let failedCount = 0;
    for (const assertion of request.assertions) {
      const result = await this.assert(assertion);
      results.push(result);
      if (result.passed) {
        passedCount++;
      } else {
        failedCount++;
        if (request.stopOnFailure) {
          break;
        }
      }
    }
    const passed = request.mode === "all" ? failedCount === 0 : passedCount > 0;
    return {
      passed,
      results,
      passedCount,
      failedCount,
      durationMs: performance.now() - startTime,
      timestamp: Date.now()
    };
  }
  /**
   * Convenience method: assert element is visible
   */
  async assertVisible(target, timeout) {
    return this.assert({ target, type: "visible", timeout });
  }
  /**
   * Convenience method: assert element is hidden
   */
  async assertHidden(target, timeout) {
    return this.assert({ target, type: "hidden", timeout });
  }
  /**
   * Convenience method: assert element is enabled
   */
  async assertEnabled(target, timeout) {
    return this.assert({ target, type: "enabled", timeout });
  }
  /**
   * Convenience method: assert element is disabled
   */
  async assertDisabled(target, timeout) {
    return this.assert({ target, type: "disabled", timeout });
  }
  /**
   * Convenience method: assert element has text
   */
  async assertHasText(target, text, timeout) {
    return this.assert({ target, type: "hasText", expected: text, timeout });
  }
  /**
   * Convenience method: assert element contains text
   */
  async assertContainsText(target, text, timeout) {
    return this.assert({ target, type: "containsText", expected: text, timeout });
  }
  /**
   * Convenience method: assert element has value
   */
  async assertHasValue(target, value, timeout) {
    return this.assert({ target, type: "hasValue", expected: value, timeout });
  }
  /**
   * Convenience method: assert element exists
   */
  async assertExists(target, timeout) {
    return this.assert({ target, type: "exists", timeout });
  }
  /**
   * Convenience method: assert element does not exist
   */
  async assertNotExists(target, timeout) {
    return this.assert({ target, type: "notExists", timeout });
  }
  /**
   * Convenience method: assert checkbox is checked
   */
  async assertChecked(target, timeout) {
    return this.assert({ target, type: "checked", timeout });
  }
  /**
   * Convenience method: assert checkbox is unchecked
   */
  async assertUnchecked(target, timeout) {
    return this.assert({ target, type: "unchecked", timeout });
  }
  /**
   * Convenience method: assert element count
   */
  async assertCount(target, expectedCount, timeout) {
    return this.assert({ target, type: "count", expected: expectedCount, timeout });
  }
  /**
   * Find element by target with full search metadata.
   * Returns the SearchResult (including confidence, matchReasons, scores)
   * or null if no match above the fuzzy threshold.
   *
   * Uses the unified find() function for element resolution — the same path
   * used by aiFind — to ensure consistent matching behavior.
   */
  findElementDetailed(target, fuzzy = true) {
    if (typeof target === "string") {
      const directResult = this.searchEngine.search({
        text: target,
        fuzzy,
        fuzzyThreshold: this.config.fuzzyThreshold
      });
      if (directResult.bestMatch && directResult.bestMatch.confidence >= this.config.fuzzyThreshold) {
        return directResult.bestMatch;
      }
    }
    const query = typeof target === "string" ? target : { ...target, fuzzy };
    const findResult = find(query, this.searchEngine, {
      confidenceThreshold: this.config.fuzzyThreshold,
      pickFirst: true
    });
    if (findResult.found && !findResult.ambiguous) {
      return {
        element: findResult.element,
        confidence: findResult.confidence,
        matchReasons: findResult.matchReasons,
        scores: {}
      };
    }
    if (findResult.found && findResult.ambiguous && findResult.candidates.length > 0) {
      const best = findResult.candidates[0];
      return {
        element: best.element,
        confidence: best.confidence,
        matchReasons: best.matchReasons,
        scores: {}
      };
    }
    return null;
  }
  /**
   * Find element by target (string or criteria).
   * Public for use by condition evaluation in SpecExecutor.
   */
  async findElement(target, fuzzy = true) {
    const result = this.findElementDetailed(target, fuzzy);
    return result?.element ?? null;
  }
  /**
   * Execute the actual assertion
   */
  async executeAssertion(request, element, timeout, startTime) {
    const targetStr = typeof request.target === "string" ? request.target : JSON.stringify(request.target);
    const elementDescription = element?.description || targetStr;
    switch (request.type) {
      case "visible":
        return this.assertVisibility(
          element,
          true,
          elementDescription,
          request.message,
          startTime
        );
      case "hidden":
        return this.assertVisibility(
          element,
          false,
          elementDescription,
          request.message,
          startTime
        );
      case "enabled":
        return this.assertEnabledState(
          element,
          true,
          elementDescription,
          request.message,
          startTime
        );
      case "disabled":
        return this.assertEnabledState(
          element,
          false,
          elementDescription,
          request.message,
          startTime
        );
      case "focused":
        return this.assertFocused(element, elementDescription, request.message, startTime);
      case "checked":
        return this.assertCheckedState(
          element,
          true,
          elementDescription,
          request.message,
          startTime
        );
      case "unchecked":
        return this.assertCheckedState(
          element,
          false,
          elementDescription,
          request.message,
          startTime
        );
      case "hasText":
        return this.assertTextMatch(
          element,
          request.expected,
          true,
          elementDescription,
          request.message,
          startTime
        );
      case "containsText":
        return this.assertTextMatch(
          element,
          request.expected,
          false,
          elementDescription,
          request.message,
          startTime
        );
      case "hasValue":
        return this.assertValue(
          element,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "exists":
        return this.createResult(
          element !== null,
          targetStr,
          elementDescription,
          true,
          element !== null,
          element === null ? "Element does not exist" : void 0,
          void 0,
          startTime,
          element?.state
        );
      case "notExists":
        return this.createResult(
          element === null,
          targetStr,
          elementDescription,
          false,
          element === null,
          element !== null ? "Element exists but should not" : void 0,
          void 0,
          startTime,
          element?.state
        );
      case "count":
        return this.assertElementCount(
          request.target,
          request.expected,
          targetStr,
          request.message,
          startTime
        );
      case "attribute":
        return this.assertAttribute(
          element,
          request.attributeName,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "hasClass":
        return this.assertHasClass(
          element,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "cssProperty":
        return this.assertCssProperty(
          element,
          request.propertyName,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "cssPropertyInSet":
        return this.assertCssPropertyInSet(
          element,
          request.propertyName,
          request.allowedValues || [],
          elementDescription,
          request.message,
          startTime
        );
      case "cssPropertyRange":
        return this.assertCssPropertyRange(
          element,
          request.propertyName,
          request.range || {},
          elementDescription,
          request.message,
          startTime
        );
      case "tokenCompliance":
        return this.assertTokenCompliance(
          element,
          request.propertyName,
          request.tokenPath || "",
          request.expected,
          elementDescription,
          request.message,
          startTime
        );
      case "noOverlap": {
        const relatedResult = this.findElementDetailed(
          request.relatedTarget,
          request.fuzzy !== false
        );
        if (!relatedResult) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            "no overlap",
            null,
            "Related target element not found",
            "Check if the related target element exists and is properly labeled",
            startTime,
            element?.state
          );
        }
        const rectA = element.state.rect;
        const rectB = relatedResult.element.state.rect;
        if (!rectA || !rectB) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            "no overlap",
            null,
            "Rect data not available for one or both elements",
            "Ensure elements have rect data in their state",
            startTime,
            element?.state
          );
        }
        const overlaps = rectA.right > rectB.left && rectA.left < rectB.right && rectA.bottom > rectB.top && rectA.top < rectB.bottom;
        const overlapDesc = overlaps ? `elements overlap (A: ${rectA.left},${rectA.top}-${rectA.right},${rectA.bottom} B: ${rectB.left},${rectB.top}-${rectB.right},${rectB.bottom})` : `no overlap (gap exists)`;
        return this.createResult(
          !overlaps,
          targetStr,
          elementDescription,
          "no overlap",
          overlapDesc,
          overlaps ? "Elements overlap when they should not" : void 0,
          overlaps ? "Adjust element positions or sizes to remove overlap" : void 0,
          startTime,
          element?.state
        );
      }
      case "minSpacing": {
        const relatedResult2 = this.findElementDetailed(
          request.relatedTarget,
          request.fuzzy !== false
        );
        if (!relatedResult2) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            `min gap ${request.minGap ?? 0}px`,
            null,
            "Related target element not found",
            "Check if the related target element exists and is properly labeled",
            startTime,
            element?.state
          );
        }
        const rA = element.state.rect;
        const rB = relatedResult2.element.state.rect;
        if (!rA || !rB) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            `min gap ${request.minGap ?? 0}px`,
            null,
            "Rect data not available for one or both elements",
            "Ensure elements have rect data in their state",
            startTime,
            element?.state
          );
        }
        const gapLeft = rB.left - rA.right;
        const gapRight = rA.left - rB.right;
        const gapTop = rB.top - rA.bottom;
        const gapBottom = rA.top - rB.bottom;
        const actualGap = Math.max(gapLeft, gapRight, gapTop, gapBottom);
        const requiredGap = request.minGap ?? 0;
        const spacingPassed = actualGap >= requiredGap;
        return this.createResult(
          spacingPassed,
          targetStr,
          elementDescription,
          `min gap ${requiredGap}px`,
          `${actualGap}px`,
          spacingPassed ? void 0 : `Spacing is ${actualGap}px but expected at least ${requiredGap}px`,
          spacingPassed ? void 0 : "Increase margin or padding between elements",
          startTime,
          element?.state
        );
      }
      default:
        return this.createResult(
          false,
          targetStr,
          elementDescription,
          void 0,
          void 0,
          `Unknown assertion type: ${request.type}`,
          void 0,
          startTime
        );
    }
  }
  /**
   * Assert visibility state
   */
  assertVisibility(element, expectedVisible, description, message, startTime = performance.now()) {
    const isVisible2 = element.state.visible;
    const passed = isVisible2 === expectedVisible;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedVisible,
      isVisible2,
      passed ? void 0 : message || `Element is ${isVisible2 ? "visible" : "hidden"} but expected ${expectedVisible ? "visible" : "hidden"}`,
      passed ? void 0 : "Check if element is covered by another element or has display:none",
      startTime,
      element.state
    );
  }
  /**
   * Assert enabled state
   */
  assertEnabledState(element, expectedEnabled, description, message, startTime = performance.now()) {
    const isEnabled = element.state.enabled;
    const passed = isEnabled === expectedEnabled;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedEnabled,
      isEnabled,
      passed ? void 0 : message || `Element is ${isEnabled ? "enabled" : "disabled"} but expected ${expectedEnabled ? "enabled" : "disabled"}`,
      passed ? void 0 : "Check if the element has a disabled attribute or aria-disabled",
      startTime,
      element.state
    );
  }
  /**
   * Assert focused state
   */
  assertFocused(element, description, message, startTime = performance.now()) {
    const isFocused = element.state.focused;
    return this.createResult(
      isFocused,
      element.id,
      description,
      true,
      isFocused,
      isFocused ? void 0 : message || "Element is not focused",
      isFocused ? void 0 : "Click or focus the element first",
      startTime,
      element.state
    );
  }
  /**
   * Assert checked state
   */
  assertCheckedState(element, expectedChecked, description, message, startTime = performance.now()) {
    const isChecked = element.state.checked ?? false;
    const passed = isChecked === expectedChecked;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedChecked,
      isChecked,
      passed ? void 0 : message || `Element is ${isChecked ? "checked" : "unchecked"} but expected ${expectedChecked ? "checked" : "unchecked"}`,
      passed ? void 0 : "Click the checkbox to change its state",
      startTime,
      element.state
    );
  }
  /**
   * Assert text content
   */
  assertTextMatch(element, expectedText, exact, description, message, startTime = performance.now()) {
    const actualText = element.state.textContent || "";
    const passed = exact ? actualText === expectedText : actualText.includes(expectedText);
    return this.createResult(
      passed,
      element.id,
      description,
      expectedText,
      actualText,
      passed ? void 0 : message || (exact ? `Text "${actualText}" does not match expected "${expectedText}"` : `Text "${actualText}" does not contain "${expectedText}"`),
      passed ? void 0 : "Verify the element contains the expected text",
      startTime,
      element.state
    );
  }
  /**
   * Assert input value
   */
  assertValue(element, expectedValue, description, message, startTime = performance.now()) {
    const actualValue = element.state.value || "";
    const passed = actualValue === expectedValue;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedValue,
      actualValue,
      passed ? void 0 : message || `Value "${actualValue}" does not match expected "${expectedValue}"`,
      passed ? void 0 : "Type the expected value into the input",
      startTime,
      element.state
    );
  }
  /**
   * Assert element count
   */
  assertElementCount(criteria, expectedCount, targetStr, message, startTime = performance.now()) {
    const searchResponse = this.searchEngine.search(criteria);
    const actualCount = searchResponse.results.length;
    const passed = actualCount === expectedCount;
    return this.createResult(
      passed,
      targetStr,
      `${actualCount} elements matching criteria`,
      expectedCount,
      actualCount,
      passed ? void 0 : message || `Found ${actualCount} elements but expected ${expectedCount}`,
      passed ? void 0 : "Adjust search criteria or wait for elements to load",
      startTime
    );
  }
  /**
   * Assert attribute value (placeholder for DOM attribute assertions)
   */
  assertAttribute(element, attributeName, expectedValue, description, message, startTime = performance.now()) {
    let actualValue;
    switch (attributeName.toLowerCase()) {
      case "placeholder":
        actualValue = element.placeholder;
        break;
      case "title":
        actualValue = element.title;
        break;
      default:
        return this.createResult(
          false,
          element.id,
          description,
          expectedValue,
          void 0,
          `Cannot check attribute "${attributeName}" without DOM access`,
          "Use the server API to check element attributes",
          startTime,
          element.state
        );
    }
    const passed = actualValue === expectedValue;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedValue,
      actualValue,
      passed ? void 0 : message || `Attribute "${attributeName}" is "${actualValue}" but expected "${expectedValue}"`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Assert element has CSS class
   */
  assertHasClass(element, className, description, message, startTime = performance.now()) {
    return this.createResult(
      false,
      element.id,
      description,
      className,
      void 0,
      "Cannot check CSS classes without DOM access",
      "Use the server API to check element classes",
      startTime,
      element.state
    );
  }
  /**
   * Assert CSS property value is in a set of allowed values
   */
  assertCssPropertyInSet(element, propertyName, allowedValues, description, message, startTime = performance.now()) {
    const computedStyles = element.state.computedStyles;
    if (!computedStyles) {
      return this.createResult(
        false,
        element.id,
        description,
        allowedValues,
        void 0,
        "Computed styles not available",
        "Request element state with computed styles",
        startTime,
        element.state
      );
    }
    const styleKey = propertyName;
    const actualValue = computedStyles[styleKey] || "";
    const normalizedActual = actualValue.trim().toLowerCase();
    const passed = allowedValues.some((v) => v.trim().toLowerCase() === normalizedActual);
    return this.createResult(
      passed,
      element.id,
      description,
      allowedValues,
      actualValue,
      passed ? void 0 : message || `CSS property "${propertyName}" is "${actualValue}" but expected one of [${allowedValues.join(", ")}]`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Assert CSS property numeric value is within a range
   */
  assertCssPropertyRange(element, propertyName, range, description, message, startTime = performance.now()) {
    const computedStyles = element.state.computedStyles;
    if (!computedStyles) {
      return this.createResult(
        false,
        element.id,
        description,
        range,
        void 0,
        "Computed styles not available",
        "Request element state with computed styles",
        startTime,
        element.state
      );
    }
    const styleKey = propertyName;
    const actualValue = computedStyles[styleKey] || "";
    const numericValue = parseFloat(actualValue);
    if (isNaN(numericValue)) {
      return this.createResult(
        false,
        element.id,
        description,
        range,
        actualValue,
        `Cannot parse "${actualValue}" as a number for range check`,
        void 0,
        startTime,
        element.state
      );
    }
    const aboveMin = range.min === void 0 || numericValue >= range.min;
    const belowMax = range.max === void 0 || numericValue <= range.max;
    const passed = aboveMin && belowMax;
    return this.createResult(
      passed,
      element.id,
      description,
      range,
      numericValue,
      passed ? void 0 : message || `CSS property "${propertyName}" is ${numericValue} but expected range [${range.min ?? "-\u221E"}, ${range.max ?? "\u221E"}]`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Assert CSS property matches a design token value.
   * Note: Token resolution requires the token value to be provided as `expected`.
   */
  assertTokenCompliance(element, propertyName, tokenPath, expectedTokenValue, description, message, startTime = performance.now()) {
    const computedStyles = element.state.computedStyles;
    if (!computedStyles) {
      return this.createResult(
        false,
        element.id,
        description,
        expectedTokenValue,
        void 0,
        "Computed styles not available",
        "Request element state with computed styles",
        startTime,
        element.state
      );
    }
    if (expectedTokenValue === void 0) {
      return this.createResult(
        false,
        element.id,
        description,
        void 0,
        void 0,
        `Token value not provided for "${tokenPath}"`,
        "Provide the resolved token value in the expected field",
        startTime,
        element.state
      );
    }
    const styleKey = propertyName;
    const actualValue = (computedStyles[styleKey] || "").trim().toLowerCase();
    const expectedStr = String(expectedTokenValue).trim().toLowerCase();
    const passed = actualValue === expectedStr;
    return this.createResult(
      passed,
      element.id,
      description,
      `${expectedTokenValue} (token: ${tokenPath})`,
      actualValue,
      passed ? void 0 : message || `CSS property "${propertyName}" is "${actualValue}" but expected token "${tokenPath}" (${expectedTokenValue})`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Assert CSS property value
   */
  assertCssProperty(element, propertyName, expectedValue, description, message, startTime = performance.now()) {
    const computedStyles = element.state.computedStyles;
    if (!computedStyles) {
      return this.createResult(
        false,
        element.id,
        description,
        expectedValue,
        void 0,
        "Computed styles not available",
        "Request element state with computed styles",
        startTime,
        element.state
      );
    }
    const styleKey = propertyName;
    const actualValue = computedStyles[styleKey];
    const passed = actualValue === expectedValue;
    return this.createResult(
      passed,
      element.id,
      description,
      expectedValue,
      actualValue,
      passed ? void 0 : message || `CSS property "${propertyName}" is "${actualValue}" but expected "${expectedValue}"`,
      void 0,
      startTime,
      element.state
    );
  }
  /**
   * Create an assertion result
   */
  createResult(passed, target, targetDescription, expected, actual, failureReason, suggestion, startTime = performance.now(), elementState) {
    return {
      passed,
      target,
      targetDescription,
      expected,
      actual,
      failureReason,
      suggestion: this.config.includeSuggestions ? suggestion : void 0,
      elementState,
      durationMs: performance.now() - startTime,
      timestamp: Date.now()
    };
  }
};

// src/ai/region-segmentation.ts
var DEFAULT_REGION_SEGMENTATION_CONFIG = {
  minRegionElements: 1,
  headerFraction: 0.12,
  footerFraction: 0.9,
  sidebarFraction: 0.2
};
function toBounded(el) {
  const rect = el.state?.rect;
  if (!rect) return null;
  return {
    element: el,
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0
  };
}
function classifyRegionType(el, relativeY, relativeX, config = DEFAULT_REGION_SEGMENTATION_CONFIG) {
  const role = (el.role || "").toLowerCase();
  const semanticType = (el.semanticType || "").toLowerCase();
  const tag = (el.tagName || "").toLowerCase();
  if (role === "navigation" || role === "nav" || tag === "nav") {
    return { type: "navigation", confidence: 0.95 };
  }
  if (role === "banner" || tag === "header") {
    return { type: "header", confidence: 0.95 };
  }
  if (role === "contentinfo" || tag === "footer") {
    return { type: "footer", confidence: 0.95 };
  }
  if (role === "main" || tag === "main") {
    return { type: "main-content", confidence: 0.95 };
  }
  if (role === "complementary" || tag === "aside") {
    return { type: "sidebar", confidence: 0.9 };
  }
  if (role === "form" || tag === "form") {
    return { type: "form", confidence: 0.9 };
  }
  if (role === "table" || tag === "table") {
    return { type: "table", confidence: 0.9 };
  }
  if (role === "dialog" || role === "alertdialog") {
    return { type: "modal", confidence: 0.95 };
  }
  if (role === "toolbar") {
    return { type: "toolbar", confidence: 0.9 };
  }
  if (semanticType.includes("card")) {
    return { type: "card", confidence: 0.8 };
  }
  if (relativeY < config.headerFraction) {
    return { type: "header", confidence: 0.6 };
  }
  if (relativeY > config.footerFraction) {
    return { type: "footer", confidence: 0.6 };
  }
  if (relativeX < config.sidebarFraction) {
    return { type: "sidebar", confidence: 0.5 };
  }
  return { type: "main-content", confidence: 0.3 };
}
function segmentPageRegions(elements, config = DEFAULT_REGION_SEGMENTATION_CONFIG) {
  const bounded = elements.map(toBounded).filter((b) => b !== null);
  if (bounded.length === 0) {
    return { regions: [], assignedCount: 0, unassignedIds: elements.map((e) => e.id) };
  }
  let maxX = 0;
  let maxY = 0;
  for (const b of bounded) {
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (maxX === 0) maxX = 1;
  if (maxY === 0) maxY = 1;
  const regionGroups = /* @__PURE__ */ new Map();
  const unassignedIds = [];
  for (const b of bounded) {
    const relativeX = b.x / maxX;
    const relativeY = b.y / maxY;
    const { type, confidence } = classifyRegionType(b.element, relativeY, relativeX, config);
    if (!regionGroups.has(type)) {
      regionGroups.set(type, { elements: [], confidences: [] });
    }
    regionGroups.get(type).elements.push(b);
    regionGroups.get(type).confidences.push(confidence);
  }
  const regions = [];
  let assignedCount = 0;
  for (const [type, group] of regionGroups) {
    if (group.elements.length < config.minRegionElements) {
      for (const b of group.elements) unassignedIds.push(b.element.id);
      continue;
    }
    let minX = Infinity, minY = Infinity, maxRX = 0, maxRY = 0;
    const elementIds = [];
    for (const b of group.elements) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxRX = Math.max(maxRX, b.x + b.width);
      maxRY = Math.max(maxRY, b.y + b.height);
      elementIds.push(b.element.id);
    }
    const avgConfidence = group.confidences.reduce((a, b) => a + b, 0) / group.confidences.length;
    regions.push({
      type,
      bounds: { x: minX, y: minY, width: maxRX - minX, height: maxRY - minY },
      elementIds,
      label: type.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      confidence: Math.round(avgConfidence * 100) / 100
    });
    assignedCount += elementIds.length;
  }
  return { regions, assignedCount, unassignedIds };
}

// src/ai/semantic-snapshot.ts
var DEFAULT_SNAPSHOT_CONFIG = {
  analyzeForms: true,
  detectModals: true,
  inferPageType: true,
  generateDescriptions: true,
  maxElements: 500,
  useAnnotations: true,
  includeForms: false,
  maxTokens: 0
};
var _SemanticSnapshotManager = class _SemanticSnapshotManager {
  constructor(config = {}) {
    this.history = [];
    this.maxHistorySize = 10;
    this.snapshotCounter = 0;
    this.config = { ...DEFAULT_SNAPSHOT_CONFIG, ...config };
    this.searchEngine = new SearchEngine();
  }
  /**
   * Create a semantic snapshot from a control snapshot.
   *
   * @param controlSnapshot - The control-level snapshot of registered elements.
   * @param pageContext - Optional partial page context to merge in.
   * @param formsResponse - Pre-built FormsResponse from `discoverForms()`.
   *   When provided **and** `config.includeForms` is `true`, this is
   *   attached to the snapshot as `formsDetail`.
   */
  createSnapshot(controlSnapshot, pageContext, formsResponse) {
    const snapshotId = `snapshot-${++this.snapshotCounter}-${Date.now()}`;
    const aiElements = this.convertElements(controlSnapshot.elements);
    this.searchEngine.updateElements(aiElements);
    const fullPageContext = this.buildPageContext(aiElements, pageContext);
    const forms = this.config.analyzeForms ? this.analyzeForms(aiElements) : [];
    const modals = this.config.detectModals ? this.detectModals(aiElements) : [];
    const elementCounts = this.countElementTypes(aiElements);
    const summary = generatePageSummary(aiElements, fullPageContext);
    const focusedElement = aiElements.find((el) => el.state.focused)?.id;
    let budgetedElements = aiElements.slice(0, this.config.maxElements);
    if (this.config.maxTokens > 0) {
      budgetedElements = this.applyTokenBudget(budgetedElements, this.config.maxTokens);
    }
    const snapshot = {
      timestamp: Date.now(),
      snapshotId,
      page: fullPageContext,
      elements: budgetedElements,
      forms,
      activeModals: modals,
      focusedElement,
      summary,
      elementCounts
    };
    if (formsResponse) {
      snapshot.formsDetail = formsResponse;
    }
    this.addToHistory(snapshot);
    return snapshot;
  }
  /**
   * Get the last snapshot
   */
  getLastSnapshot() {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1].snapshot;
  }
  /**
   * Get snapshot by ID
   */
  getSnapshot(snapshotId) {
    const entry = this.history.find((h) => h.snapshot.snapshotId === snapshotId);
    return entry?.snapshot || null;
  }
  /**
   * Get snapshot history
   */
  getHistory() {
    return this.history.map((h) => h.snapshot);
  }
  /**
   * Clear history
   */
  clearHistory() {
    this.history = [];
  }
  /**
   * Convert control snapshot elements to AI elements
   */
  convertElements(elements) {
    return elements.map((el) => this.convertElement(el));
  }
  /**
   * Convert a single element to AI element
   */
  convertElement(element) {
    const isContent = element.category === "content";
    const aliases = generateAliases({
      textContent: element.state.textContent,
      elementType: element.type,
      id: element.id,
      labelText: element.label
    });
    let description;
    if (isContent && element.contentMetadata) {
      description = this.generateContentDescription(element);
    } else if (this.config.generateDescriptions) {
      description = generateDescription({
        textContent: element.state.textContent,
        elementType: element.type,
        id: element.id,
        labelText: element.label
      });
    } else {
      description = element.label || element.id;
    }
    const purpose = isContent ? generatePurpose({ textContent: element.state.textContent, elementType: element.type }) : generatePurpose({ textContent: element.state.textContent, elementType: element.type });
    const suggestedActions = isContent ? generateSuggestedActions({
      textContent: element.state.textContent,
      elementType: element.type
    }) : generateSuggestedActions({
      textContent: element.state.textContent,
      elementType: element.type
    });
    let finalDescription = description;
    let finalPurpose = purpose;
    let finalAliases = aliases;
    if (this.config.useAnnotations) {
      const annotation = getGlobalAnnotationStore().get(element.id);
      if (annotation) {
        if (annotation.description) {
          finalDescription = annotation.description;
        }
        if (annotation.purpose) {
          finalPurpose = annotation.purpose;
        }
        if (annotation.tags && annotation.tags.length > 0) {
          const tagSet = /* @__PURE__ */ new Set([...finalAliases, ...annotation.tags.map((t) => t.toLowerCase())]);
          finalAliases = [...tagSet];
        }
      }
    }
    return {
      id: element.id,
      type: element.type,
      label: element.label,
      tagName: this.inferTagName(element.type),
      role: this.inferRole(element.type),
      accessibleName: element.label || element.state.textContent?.trim(),
      actions: element.actions,
      state: element.state,
      registered: true,
      description: finalDescription,
      aliases: finalAliases,
      purpose: finalPurpose,
      suggestedActions,
      semanticType: this.inferSemanticType(element),
      category: element.category,
      contentMetadata: element.contentMetadata
    };
  }
  /**
   * Generate a content-specific description
   */
  generateContentDescription(element) {
    const meta = element.contentMetadata;
    const text = element.state.textContent?.trim() || "";
    const truncatedText = text.length > 60 ? text.substring(0, 57) + "..." : text;
    if (!meta) return `"${truncatedText}"`;
    switch (meta.contentRole) {
      case "heading":
        return `Level ${meta.headingLevel || "?"} heading: '${truncatedText}'`;
      case "table-cell":
        return `Table cell${meta.structuralContext ? ` (${meta.structuralContext})` : ""}: '${truncatedText}'`;
      case "table-header":
        return `Table header${meta.structuralContext ? ` (${meta.structuralContext})` : ""}: '${truncatedText}'`;
      case "status":
        return `Status message: '${truncatedText}'`;
      case "badge":
        return `Badge: '${truncatedText}'`;
      case "metric":
        return `Metric value: '${truncatedText}'`;
      case "body-text":
        return `Text: '${truncatedText}'`;
      case "list-item":
        return `List item: '${truncatedText}'`;
      case "quote":
        return `Blockquote: '${truncatedText}'`;
      case "code":
        return `Code block: '${truncatedText}'`;
      case "caption":
        return `Caption: '${truncatedText}'`;
      case "label":
        return `Label: '${truncatedText}'`;
      case "description":
        return `Description: '${truncatedText}'`;
      case "navigation":
        return `Navigation text: '${truncatedText}'`;
      default:
        return `Content: '${truncatedText}'`;
    }
  }
  /**
   * Build full page context
   */
  buildPageContext(elements, partial) {
    const url = partial?.url || (typeof window !== "undefined" ? window.location.href : "");
    const title = partial?.title || (typeof document !== "undefined" ? document.title : "");
    const pageType = this.config.inferPageType ? inferPageType(url, title, elements) : partial?.pageType || "unknown";
    const activeModals = elements.filter((el) => el.type === "dialog" && el.state.visible).map((el) => el.id);
    return {
      url,
      title,
      pageType,
      activeModals: partial?.activeModals || activeModals,
      focusedElement: partial?.focusedElement || elements.find((el) => el.state.focused)?.id,
      navigation: partial?.navigation,
      pathname: partial?.pathname,
      pageName: partial?.pageName,
      section: partial?.section,
      breadcrumb: partial?.breadcrumb,
      routePattern: partial?.routePattern,
      routeParams: partial?.routeParams
    };
  }
  /**
   * Analyze forms in the snapshot
   */
  analyzeForms(elements) {
    const forms = [];
    const formElements = elements.filter((el) => el.type === "form");
    if (formElements.length === 0) {
      const implicitForm = this.detectImplicitForm(elements);
      if (implicitForm) {
        forms.push(implicitForm);
      }
    } else {
      for (const form of formElements) {
        const formState = this.analyzeForm(form, elements);
        if (formState) {
          forms.push(formState);
        }
      }
    }
    return forms;
  }
  /**
   * Detect implicit form from inputs
   */
  detectImplicitForm(elements) {
    const inputs = elements.filter(
      (el) => el.type === "input" || el.type === "textarea" || el.type === "select" || el.type === "checkbox"
    );
    if (inputs.length === 0) return null;
    const submitButton = elements.find(
      (el) => el.type === "button" && el.state.visible && (el.semanticType === "submit-button" || el.state.textContent?.toLowerCase().match(/submit|save|send|continue/))
    );
    const fields = this.analyzeFormFields(inputs);
    const hasErrors = fields.some((f) => !f.valid);
    return {
      id: "implicit-form",
      purpose: this.inferFormPurpose(inputs),
      fields,
      isValid: !hasErrors,
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.isDirty)
    };
  }
  /**
   * Analyze a specific form
   */
  analyzeForm(form, allElements) {
    const inputs = allElements.filter(
      (el) => (el.type === "input" || el.type === "textarea" || el.type === "select") && el.state.visible
    );
    const fields = this.analyzeFormFields(inputs);
    const hasErrors = fields.some((f) => !f.valid);
    const submitButton = allElements.find(
      (el) => el.type === "button" && el.state.visible && el.semanticType === "submit-button"
    );
    return {
      id: form.id,
      name: form.label,
      purpose: form.purpose,
      fields,
      isValid: !hasErrors,
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.isDirty)
    };
  }
  /**
   * Analyze form fields
   */
  analyzeFormFields(inputs) {
    return inputs.map((input) => {
      const valid = input.state.validationState ? input.state.validationState.valid : true;
      const error3 = input.state.validationState?.validationMessage || void 0;
      return {
        id: input.id,
        label: input.accessibleName || input.label || input.id,
        type: input.type,
        value: input.state.value || "",
        valid,
        error: error3,
        required: input.state.required ?? false,
        touched: input.state.focused || (input.state.value?.length || 0) > 0,
        placeholder: void 0,
        // Not available from AIDiscoveredElement
        isDirty: (input.state.value?.length || 0) > 0,
        checked: input.state.checked,
        selectedOptions: input.state.selectedOptions,
        constraints: input.state.constraints
      };
    });
  }
  /**
   * Detect modal dialogs
   */
  detectModals(elements) {
    const modals = [];
    const dialogElements = elements.filter((el) => el.type === "dialog" && el.state.visible);
    for (const dialog of dialogElements) {
      const closeButton = elements.find(
        (el) => el.type === "button" && el.state.visible && (el.semanticType === "cancel-button" || el.state.textContent?.toLowerCase().match(/close|cancel|x|dismiss/))
      );
      const primaryAction = elements.find(
        (el) => el.type === "button" && el.state.visible && el.semanticType === "submit-button"
      );
      modals.push({
        id: dialog.id,
        title: dialog.accessibleName || dialog.label,
        type: this.inferModalType(dialog),
        blocking: true,
        // Assume dialogs are blocking
        closeButton: closeButton?.id,
        primaryAction: primaryAction?.id
      });
    }
    return modals;
  }
  /**
   * Infer modal type
   */
  inferModalType(dialog) {
    const text = (dialog.accessibleName || dialog.state.textContent || "").toLowerCase();
    if (text.includes("alert") || text.includes("warning") || text.includes("error")) {
      return "alert";
    }
    if (text.includes("confirm") || text.includes("are you sure")) {
      return "confirm";
    }
    if (text.includes("prompt") || text.includes("enter")) {
      return "prompt";
    }
    return "dialog";
  }
  /**
   * Count elements by type
   */
  countElementTypes(elements) {
    const counts = {};
    for (const el of elements) {
      const type = el.type.toLowerCase();
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }
  /**
   * Infer form purpose from fields
   */
  inferFormPurpose(fields) {
    const labels = fields.map((f) => (f.accessibleName || f.label || "").toLowerCase());
    const allLabels = labels.join(" ");
    if (allLabels.includes("email") && allLabels.includes("password")) {
      if (allLabels.includes("confirm") || allLabels.includes("name")) {
        return "Registration";
      }
      return "Login";
    }
    if (allLabels.includes("search")) return "Search";
    if (allLabels.includes("address") || allLabels.includes("city")) return "Address";
    if (allLabels.includes("card") || allLabels.includes("payment")) return "Payment";
    if (allLabels.includes("contact") || allLabels.includes("message")) return "Contact";
    return "Form";
  }
  /**
   * Infer tag name from element type
   */
  inferTagName(type) {
    const typeMap = {
      button: "button",
      input: "input",
      textarea: "textarea",
      select: "select",
      checkbox: "input",
      radio: "input",
      link: "a",
      form: "form",
      dialog: "dialog"
    };
    return typeMap[type] || "div";
  }
  /**
   * Infer ARIA role from element type
   */
  inferRole(type) {
    const roleMap = {
      button: "button",
      input: "textbox",
      textarea: "textbox",
      select: "combobox",
      checkbox: "checkbox",
      radio: "radio",
      link: "link",
      dialog: "dialog",
      menu: "menu",
      menuitem: "menuitem",
      tab: "tab"
    };
    return roleMap[type];
  }
  /**
   * Infer semantic type
   */
  inferSemanticType(element) {
    if (element.category === "content" && element.contentMetadata) {
      const role = element.contentMetadata.contentRole;
      if (role === "heading" && element.contentMetadata.headingLevel) {
        return `heading-${element.contentMetadata.headingLevel}`;
      }
      return role;
    }
    const text = (element.state.textContent || element.label || "").toLowerCase();
    const type = element.type.toLowerCase();
    if (type === "button") {
      if (text.match(/submit|save|confirm|ok|done|apply/)) return "submit-button";
      if (text.match(/cancel|close|dismiss/)) return "cancel-button";
      if (text.match(/delete|remove|trash/)) return "delete-button";
      if (text.match(/add|create|new|\+/)) return "add-button";
      if (text.match(/edit|modify/)) return "edit-button";
      if (text.match(/next|continue/)) return "next-button";
      if (text.match(/back|previous/)) return "back-button";
      return "action-button";
    }
    if (type === "input") {
      if (text.includes("email") || element.id.includes("email")) return "email-input";
      if (text.includes("password") || element.id.includes("password")) return "password-input";
      if (text.includes("search") || element.id.includes("search")) return "search-input";
      return "text-input";
    }
    return type;
  }
  /**
   * Estimate token count from serialized JSON length.
   * Uses ~4 characters per token as a rough approximation.
   */
  estimateTokens(elements) {
    let charCount = 0;
    for (const el of elements) {
      charCount += (el.id?.length ?? 0) + (el.type?.length ?? 0);
      charCount += (el.label?.length ?? 0) + (el.description?.length ?? 0);
      charCount += el.purpose?.length ?? 0;
      if (el.aliases) charCount += el.aliases.join(",").length;
      if (el.suggestedActions) charCount += el.suggestedActions.join(",").length;
      charCount += 100;
      if (el.contentMetadata) charCount += 50;
    }
    return Math.ceil(charCount / 4);
  }
  /**
   * Apply token budget by pruning low-priority elements.
   * Uses region classification to determine which elements to keep.
   * Interactive elements in main-content are prioritized highest.
   */
  applyTokenBudget(elements, maxTokens) {
    if (this.estimateTokens(elements) <= maxTokens) {
      return elements;
    }
    const scored = elements.map((el) => {
      const viewportHeight = (typeof window !== "undefined" ? window.innerHeight : 0) || 800;
      const viewportWidth = (typeof window !== "undefined" ? window.innerWidth : 0) || 1280;
      const relativeY = (el.state?.rect?.y ?? 0) / viewportHeight;
      const relativeX = (el.state?.rect?.x ?? 0) / viewportWidth;
      const region = classifyRegionType(el, relativeY, relativeX);
      const regionPriority = _SemanticSnapshotManager.REGION_PRIORITY[region.type] ?? 50;
      const interactiveBoost = el.type === "content" ? 0 : 20;
      const visibleBoost = el.state?.visible ? 10 : 0;
      const focusBoost = el.state?.focused ? 30 : 0;
      return {
        element: el,
        priority: regionPriority + interactiveBoost + visibleBoost + focusBoost
      };
    });
    scored.sort((a, b) => b.priority - a.priority);
    const result = [];
    let currentTokens = 0;
    for (const { element } of scored) {
      const elementTokens = this.estimateTokens([element]);
      if (currentTokens + elementTokens > maxTokens && result.length > 0) {
        break;
      }
      result.push(element);
      currentTokens += elementTokens;
    }
    return result;
  }
  addToHistory(snapshot) {
    this.history.push({
      snapshot,
      timestamp: Date.now()
    });
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }
};
/**
 * Add snapshot to history
 */
/**
 * Region priority for token budget pruning.
 * Higher priority regions are kept; lower priority regions are pruned first.
 */
_SemanticSnapshotManager.REGION_PRIORITY = {
  "main-content": 100,
  form: 90,
  modal: 85,
  table: 80,
  card: 75,
  toolbar: 70,
  navigation: 50,
  sidebar: 40,
  header: 30,
  footer: 20,
  unknown: 10
};
var SemanticSnapshotManager = _SemanticSnapshotManager;

// src/ai/semantic-diff.ts
var DEFAULT_DIFF_CONFIG = {
  ignoreInsignificant: true,
  trackedProperties: ["visible", "enabled", "focused", "checked", "value", "textContent"],
  generateSuggestions: true,
  maxModifications: 20
};
var INSIGNIFICANT_PROPERTIES = /* @__PURE__ */ new Set(["rect", "computedStyles", "innerHTML"]);
function computeDiff(fromSnapshot, toSnapshot, config = {}) {
  const startTime = performance.now();
  const finalConfig = { ...DEFAULT_DIFF_CONFIG, ...config };
  const fromElements = new Map(fromSnapshot.elements.map((el) => [el.id, el]));
  const toElements = new Map(toSnapshot.elements.map((el) => [el.id, el]));
  const appeared = [];
  for (const [id, element] of toElements) {
    if (!fromElements.has(id)) {
      appeared.push({
        elementId: id,
        description: element.description,
        type: element.type,
        semanticType: element.semanticType
      });
    }
  }
  const disappeared = [];
  for (const [id, element] of fromElements) {
    if (!toElements.has(id)) {
      disappeared.push({
        elementId: id,
        description: element.description,
        type: element.type,
        semanticType: element.semanticType
      });
    }
  }
  const modified = [];
  for (const [id, toElement] of toElements) {
    const fromElement = fromElements.get(id);
    if (fromElement) {
      const modifications = compareElements(fromElement, toElement, finalConfig);
      modified.push(...modifications);
    }
  }
  const limitedModifications = modified.slice(0, finalConfig.maxModifications);
  const probableTrigger = detectTrigger(appeared, disappeared, limitedModifications);
  const suggestedActions = finalConfig.generateSuggestions ? generateSuggestedActionsFromDiff(appeared, disappeared, limitedModifications, probableTrigger) : void 0;
  const pageChanges = detectPageChanges(fromSnapshot, toSnapshot);
  const contentChanges = detectContentChanges(fromElements, toElements);
  const summary = generateDiffSummary(
    appeared.map((e) => e.description),
    disappeared.map((e) => e.description),
    limitedModifications
  );
  return {
    summary,
    fromSnapshotId: fromSnapshot.snapshotId,
    toSnapshotId: toSnapshot.snapshotId,
    changes: {
      appeared,
      disappeared,
      modified: limitedModifications
    },
    contentChanges: contentChanges || void 0,
    probableTrigger,
    suggestedActions,
    pageChanges,
    durationMs: performance.now() - startTime,
    timestamp: Date.now()
  };
}
function compareElements(fromElement, toElement, config) {
  const modifications = [];
  for (const property of config.trackedProperties) {
    const fromValue = getPropertyValue(fromElement, property);
    const toValue = getPropertyValue(toElement, property);
    if (fromValue !== toValue) {
      const isSignificant = isSignificantChange(property, fromValue, toValue);
      if (!config.ignoreInsignificant || isSignificant) {
        modifications.push({
          elementId: toElement.id,
          description: toElement.description,
          property,
          from: formatValue(fromValue),
          to: formatValue(toValue),
          significant: isSignificant
        });
      }
    }
  }
  return modifications;
}
function getPropertyValue(element, property) {
  if (property in element.state) {
    return element.state[property];
  }
  return element[property];
}
function isSignificantChange(property, fromValue, toValue) {
  if (INSIGNIFICANT_PROPERTIES.has(property)) {
    return false;
  }
  if (property === "visible") {
    return true;
  }
  if (property === "enabled") {
    return true;
  }
  if (property === "focused") {
    return true;
  }
  if (property === "checked") {
    return true;
  }
  if (property === "value") {
    return Boolean(fromValue) || Boolean(toValue);
  }
  if (property === "textContent") {
    const fromText = String(fromValue || "");
    const toText = String(toValue || "");
    return fromText.trim() !== toText.trim();
  }
  return true;
}
function formatValue(value) {
  if (value === void 0) return "undefined";
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (value.length > 50) {
      return value.substring(0, 47) + "...";
    }
    return value;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}
function detectTrigger(appeared, disappeared, modified) {
  const hasNewErrors = appeared.some(
    (e) => e.description.toLowerCase().includes("error") || e.type === "error"
  );
  if (hasNewErrors) {
    return "Form validation";
  }
  const hasNewModal = appeared.some(
    (e) => e.type === "dialog" || e.semanticType?.includes("dialog")
  );
  if (hasNewModal) {
    return "Modal opened";
  }
  const hasModalDismissed = disappeared.some(
    (e) => e.type === "dialog" || e.semanticType?.includes("dialog")
  );
  if (hasModalDismissed) {
    return "Modal closed";
  }
  const hasLoading = modified.some((m) => m.description.toLowerCase().includes("loading"));
  if (hasLoading) {
    return "Loading state change";
  }
  const hasFocusChange = modified.some((m) => m.property === "focused");
  if (hasFocusChange && modified.length <= 2) {
    return "Focus changed";
  }
  const hasValueChange = modified.some((m) => m.property === "value");
  if (hasValueChange && modified.length <= 2) {
    return "User input";
  }
  const visibilityChanges = modified.filter((m) => m.property === "visible");
  if (visibilityChanges.length > 0 && visibilityChanges.length <= 5) {
    return "UI expansion/collapse";
  }
  if (appeared.length > 5) {
    return "Page navigation";
  }
  return void 0;
}
function detectPageChanges(fromSnapshot, toSnapshot) {
  const urlChanged = fromSnapshot.page.url !== toSnapshot.page.url;
  const titleChanged = fromSnapshot.page.title !== toSnapshot.page.title;
  if (!urlChanged && !titleChanged) {
    return void 0;
  }
  return {
    urlChanged,
    titleChanged,
    newUrl: urlChanged ? toSnapshot.page.url : void 0,
    newTitle: titleChanged ? toSnapshot.page.title : void 0
  };
}
function generateSuggestedActionsFromDiff(appeared, disappeared, modified, trigger) {
  const suggestions = [];
  if (trigger === "Form validation") {
    suggestions.push("Fix the validation errors before submitting");
  }
  if (trigger === "Modal opened") {
    const modal = appeared.find((e) => e.type === "dialog" || e.semanticType?.includes("dialog"));
    if (modal) {
      suggestions.push(`Interact with the "${modal.description}" dialog`);
    }
  }
  if (trigger === "Modal closed") {
    suggestions.push("Continue with the main page interaction");
  }
  for (const element of appeared.slice(0, 3)) {
    if (element.type === "button" && element.semanticType === "submit-button") {
      suggestions.push(`Click the "${element.description}" to proceed`);
    }
    if (element.description.toLowerCase().includes("error")) {
      suggestions.push(`Address the error: ${element.description}`);
    }
  }
  for (const mod of modified.slice(0, 3)) {
    if (mod.property === "enabled" && mod.to === "true") {
      suggestions.push(`"${mod.description}" is now enabled`);
    }
    if (mod.property === "visible" && mod.to === "true") {
      suggestions.push(`"${mod.description}" is now visible`);
    }
  }
  return suggestions.slice(0, 5);
}
var SemanticDiffManager = class {
  constructor(config = {}) {
    this.lastSnapshot = null;
    this.config = { ...DEFAULT_DIFF_CONFIG, ...config };
  }
  /**
   * Update with new snapshot and get diff
   */
  update(newSnapshot) {
    if (!this.lastSnapshot) {
      this.lastSnapshot = newSnapshot;
      return null;
    }
    const diff = computeDiff(this.lastSnapshot, newSnapshot, this.config);
    this.lastSnapshot = newSnapshot;
    return diff;
  }
  /**
   * Get diff from a specific snapshot to current
   */
  diffFrom(fromSnapshot) {
    if (!this.lastSnapshot) return null;
    return computeDiff(fromSnapshot, this.lastSnapshot, this.config);
  }
  /**
   * Reset the manager
   */
  reset() {
    this.lastSnapshot = null;
  }
  /**
   * Get the last known snapshot
   */
  getLastSnapshot() {
    return this.lastSnapshot;
  }
};
function hasSignificantChanges(diff) {
  if (diff.changes.appeared.length > 0) return true;
  if (diff.changes.disappeared.length > 0) return true;
  if (diff.changes.modified.some((m) => m.significant)) return true;
  if (diff.pageChanges?.urlChanged) return true;
  if (diff.contentChanges) {
    const cc = diff.contentChanges;
    if (cc.textChanges.length > 0) return true;
    if (cc.metricChanges.some((m) => m.significant)) return true;
    if (cc.statusChanges.length > 0) return true;
  }
  return false;
}
var METRIC_CONTENT_TYPES = /* @__PURE__ */ new Set(["metric-value"]);
var STATUS_CONTENT_TYPES = /* @__PURE__ */ new Set(["status-message", "badge"]);
var HEADING_CONTENT_TYPES = /* @__PURE__ */ new Set(["heading"]);
function isContentElement(element) {
  return element.category === "content" || element.contentMetadata !== void 0;
}
function getContentType(element) {
  if (element.contentMetadata?.contentRole) {
    return element.contentMetadata.contentRole;
  }
  return element.type;
}
function detectContentChanges(fromElements, toElements) {
  const textChanges = [];
  const metricChanges = [];
  const statusChanges = [];
  for (const [id, toElement] of toElements) {
    const fromElement = fromElements.get(id);
    if (fromElement) {
      if (isContentElement(toElement) || isContentElement(fromElement)) {
        const fromText = (fromElement.state.textContent || "").trim();
        const toText = (toElement.state.textContent || "").trim();
        if (fromText !== toText) {
          const contentType = getContentType(toElement);
          const label = toElement.description || toElement.accessibleName || id;
          if (METRIC_CONTENT_TYPES.has(contentType) || contentType === "metric") {
            const parsed = parseMetricChange(fromText, toText, id, label);
            if (parsed) {
              metricChanges.push(parsed);
            }
          } else if (STATUS_CONTENT_TYPES.has(contentType) || contentType === "status") {
            statusChanges.push({
              elementId: id,
              label,
              oldStatus: fromText,
              newStatus: toText,
              direction: classifyStatusDirection(fromText, toText)
            });
          } else {
            textChanges.push({
              elementId: id,
              contentType,
              oldText: fromText,
              newText: toText,
              changeType: "modified"
            });
          }
        }
      }
    } else {
      if (isContentElement(toElement)) {
        const toText = (toElement.state.textContent || "").trim();
        if (toText) {
          textChanges.push({
            elementId: id,
            contentType: getContentType(toElement),
            oldText: "",
            newText: toText,
            changeType: "added"
          });
        }
      }
    }
  }
  for (const [id, fromElement] of fromElements) {
    if (!toElements.has(id) && isContentElement(fromElement)) {
      const fromText = (fromElement.state.textContent || "").trim();
      if (fromText) {
        textChanges.push({
          elementId: id,
          contentType: getContentType(fromElement),
          oldText: fromText,
          newText: "",
          changeType: "removed"
        });
      }
    }
  }
  if (textChanges.length === 0 && metricChanges.length === 0 && statusChanges.length === 0) {
    return null;
  }
  return {
    textChanges,
    metricChanges,
    statusChanges,
    summary: generateContentChangeSummary(textChanges, metricChanges, statusChanges)
  };
}
function parseNumericValue(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let working = trimmed;
  let negate = false;
  if (working.startsWith("(") && working.endsWith(")")) {
    working = working.slice(1, -1).trim();
    negate = true;
  }
  if (working.startsWith("-")) {
    negate = !negate;
    working = working.slice(1).trim();
  }
  if (working.startsWith("+")) {
    working = working.slice(1).trim();
  }
  working = working.replace(/^[£€¥₹$]/, "").trim();
  const isPercent = working.endsWith("%");
  if (isPercent) {
    working = working.slice(0, -1).trim();
  }
  working = working.replace(/\s*(ms|s|m|h|d|hrs?|mins?|secs?|days?)$/i, "").trim();
  working = working.replace(/,/g, "");
  const num = Number(working);
  if (isNaN(num) || !isFinite(num) || working === "") {
    return null;
  }
  return negate ? -num : num;
}
function parseMetricChange(fromText, toText, elementId, label) {
  const fromNum = parseNumericValue(fromText);
  const toNum = parseNumericValue(toText);
  let numericDelta;
  let percentChange;
  let significant = false;
  if (fromNum !== null && toNum !== null) {
    numericDelta = toNum - fromNum;
    if (fromNum !== 0) {
      percentChange = (toNum - fromNum) / Math.abs(fromNum) * 100;
    }
    if (percentChange !== void 0 && Math.abs(percentChange) > 10) {
      significant = true;
    }
    if (fromNum > 0 && toNum < 0) significant = true;
    if (fromNum < 0 && toNum > 0) significant = true;
    if (fromNum === 0 && toNum !== 0) significant = true;
    if (fromNum !== 0 && toNum === 0) significant = true;
  } else {
    significant = fromText !== toText;
  }
  return {
    elementId,
    label,
    oldValue: fromText,
    newValue: toText,
    numericDelta,
    percentChange: percentChange !== void 0 ? Math.round(percentChange * 100) / 100 : void 0,
    significant
  };
}
var STATUS_PROGRESSIONS = [
  [
    "failed",
    "error",
    "pending",
    "queued",
    "running",
    "in progress",
    "completed",
    "success",
    "done"
  ],
  ["disconnected", "connecting", "connected"],
  ["unhealthy", "degraded", "healthy"],
  ["offline", "online"],
  ["inactive", "active"],
  ["disabled", "enabled"],
  ["down", "up"],
  ["stopped", "starting", "started", "running"],
  ["closed", "open"],
  ["blocked", "unblocked"],
  ["rejected", "pending", "approved"],
  ["critical", "warning", "info", "ok"],
  ["red", "yellow", "green"]
];
function classifyStatusDirection(oldStatus, newStatus) {
  const oldLower = oldStatus.toLowerCase().trim();
  const newLower = newStatus.toLowerCase().trim();
  for (const progression of STATUS_PROGRESSIONS) {
    let oldIndex = -1;
    let newIndex = -1;
    for (let i = 0; i < progression.length; i++) {
      if (oldLower.includes(progression[i])) oldIndex = i;
      if (newLower.includes(progression[i])) newIndex = i;
    }
    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      return newIndex > oldIndex ? "improved" : "degraded";
    }
  }
  return "neutral";
}
function generateContentChangeSummary(textChanges, metricChanges, statusChanges) {
  const parts = [];
  const modified = textChanges.filter((t) => t.changeType === "modified").length;
  const added = textChanges.filter((t) => t.changeType === "added").length;
  const removed = textChanges.filter((t) => t.changeType === "removed").length;
  const headingChanges = textChanges.filter(
    (t) => HEADING_CONTENT_TYPES.has(t.contentType) || t.contentType === "heading"
  );
  if (headingChanges.length > 0) {
    parts.push(`${headingChanges.length} heading${headingChanges.length > 1 ? "s" : ""} changed`);
  }
  if (metricChanges.length > 0) {
    const significantMetrics = metricChanges.filter((m) => m.significant);
    if (significantMetrics.length > 0) {
      parts.push(
        `${significantMetrics.length} metric${significantMetrics.length > 1 ? "s" : ""} changed significantly`
      );
    } else {
      parts.push(`${metricChanges.length} metric${metricChanges.length > 1 ? "s" : ""} changed`);
    }
  }
  if (statusChanges.length > 0) {
    const degraded = statusChanges.filter((s) => s.direction === "degraded");
    const improved = statusChanges.filter((s) => s.direction === "improved");
    if (degraded.length > 0) {
      parts.push(`${degraded.length} status${degraded.length > 1 ? "es" : ""} degraded`);
    }
    if (improved.length > 0) {
      parts.push(`${improved.length} status${improved.length > 1 ? "es" : ""} improved`);
    }
    const neutral = statusChanges.length - degraded.length - improved.length;
    if (neutral > 0 && degraded.length === 0 && improved.length === 0) {
      parts.push(`${neutral} status${neutral > 1 ? "es" : ""} changed`);
    }
  }
  const otherModified = modified - headingChanges.filter((h) => h.changeType === "modified").length;
  if (otherModified > 0) {
    parts.push(`${otherModified} text${otherModified > 1 ? " values" : " value"} modified`);
  }
  if (added > 0) {
    parts.push(`${added} content${added > 1 ? " elements" : " element"} added`);
  }
  if (removed > 0) {
    parts.push(`${removed} content${removed > 1 ? " elements" : " element"} removed`);
  }
  if (parts.length === 0) {
    return "No content changes";
  }
  return parts.join(", ");
}

// src/ai/data-extraction.ts
var DEFAULT_DATA_EXTRACTION_CONFIG = {
  minConfidence: 0.3,
  normalizeWhitespace: true
};
function classifyDataType(value) {
  const trimmed = value.trim();
  if (!trimmed) return { type: "unknown", confidence: 0 };
  if (/^(true|false|yes|no|on|off)$/i.test(trimmed)) {
    return { type: "boolean", confidence: 0.95 };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { type: "email", confidence: 0.95 };
  }
  if (/^https?:\/\/\S+/.test(trimmed)) {
    return { type: "url", confidence: 0.95 };
  }
  if (/^[+]?[\d\s\-().]{7,20}$/.test(trimmed) && /\d{3,}/.test(trimmed)) {
    return { type: "phone", confidence: 0.7 };
  }
  if (/^[£$€¥₹][\s]?[\d,.]+$/.test(trimmed) || /^[\d,.]+[\s]?[£$€¥₹]$/.test(trimmed)) {
    return { type: "currency", confidence: 0.9 };
  }
  if (/^[\d,.]+\s?%$/.test(trimmed)) {
    return { type: "percentage", confidence: 0.95 };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed) || /^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(trimmed) || /^\w{3,9}\s+\d{1,2},?\s+\d{4}$/.test(trimmed)) {
    return { type: "date", confidence: 0.85 };
  }
  if (/^-?[\d,]+\.?\d*$/.test(trimmed) && trimmed !== "") {
    return { type: "number", confidence: 0.9 };
  }
  return { type: "text", confidence: 0.5 };
}
function normalizeValue(value, dataType) {
  const trimmed = value.trim();
  switch (dataType) {
    case "number":
    case "currency":
    case "percentage": {
      const numeric = trimmed.replace(/[^0-9.-]/g, "");
      const parsed = parseFloat(numeric);
      return isNaN(parsed) ? trimmed.toLowerCase() : parsed.toString();
    }
    case "date": {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? trimmed.toLowerCase() : d.toISOString().split("T")[0];
    }
    case "boolean":
      return /^(true|yes|on)$/i.test(trimmed) ? "true" : "false";
    case "email":
      return trimmed.toLowerCase();
    case "url":
      return trimmed.replace(/\/+$/, "").toLowerCase();
    case "phone":
      return trimmed.replace(/[^\d+]/g, "");
    default:
      return trimmed.toLowerCase().replace(/\s+/g, " ");
  }
}
function extractElementValue(element) {
  const state = element.state;
  if (state?.value !== void 0 && state.value !== "") {
    return String(state.value);
  }
  if (state?.textContent !== void 0 && state.textContent !== "") {
    return String(state.textContent);
  }
  return "";
}
function extractLabel(element) {
  return element.accessibleName || element.labelText || element.label || element.description || element.id;
}
function extractPageData(elements, config = DEFAULT_DATA_EXTRACTION_CONFIG) {
  const values = {};
  let extractedCount = 0;
  for (const element of elements) {
    const rawValue = extractElementValue(element);
    if (!rawValue) continue;
    const label = extractLabel(element);
    const { type: dataType, confidence } = classifyDataType(rawValue);
    if (confidence < config.minConfidence) continue;
    const normalizedValue = normalizeValue(rawValue, dataType);
    values[label] = {
      elementId: element.id,
      label,
      rawValue: config.normalizeWhitespace ? rawValue.replace(/\s+/g, " ").trim() : rawValue,
      normalizedValue,
      dataType,
      confidence
    };
    extractedCount++;
  }
  return {
    values,
    scannedCount: elements.length,
    extractedCount
  };
}

// src/ai/table-extraction.ts
var DEFAULT_TABLE_EXTRACTION_CONFIG = {
  minTableColumns: 2,
  minTableRows: 2,
  minListItems: 2,
  columnTolerance: 20,
  rowTolerance: 10
};
function getElementBounds(el) {
  const rect = el.state?.rect;
  if (!rect || rect.width === 0) return null;
  const text = el.state?.textContent ?? el.state?.value ?? "";
  if (!text) return null;
  return {
    element: el,
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    text: text.trim()
  };
}
function clusterPositions(values, tolerance) {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - clusters[clusters.length - 1] > tolerance) {
      clusters.push(sorted[i]);
    }
  }
  return clusters;
}
function assignToCluster(value, clusters, tolerance) {
  let best = 0;
  let bestDist = Math.abs(value - clusters[0]);
  for (let i = 1; i < clusters.length; i++) {
    const dist = Math.abs(value - clusters[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return bestDist <= tolerance ? best : -1;
}
function detectTable(elements, config = DEFAULT_TABLE_EXTRACTION_CONFIG) {
  const withBounds = elements.map(getElementBounds).filter((b) => b !== null);
  if (withBounds.length < config.minTableColumns * config.minTableRows) return null;
  const xPositions = withBounds.map((b) => b.x);
  const yPositions = withBounds.map((b) => b.y);
  const columnClusters = clusterPositions(xPositions, config.columnTolerance);
  const rowClusters = clusterPositions(yPositions, config.rowTolerance);
  if (columnClusters.length < config.minTableColumns || rowClusters.length < config.minTableRows) {
    return null;
  }
  const grid = Array.from(
    { length: rowClusters.length },
    () => Array(columnClusters.length).fill(null)
  );
  for (const b of withBounds) {
    const col = assignToCluster(b.x, columnClusters, config.columnTolerance);
    const row = assignToCluster(b.y, rowClusters, config.rowTolerance);
    if (col >= 0 && row >= 0 && grid[row][col] === null) {
      grid[row][col] = b.text;
    }
  }
  const headers = grid[0].map((h) => h ?? "");
  const columns = headers.map((header, index) => {
    const bodyCells = grid.slice(1).map((r) => r[index]).filter((c) => c !== null);
    const types = bodyCells.map((c) => classifyDataType(c).type);
    const mostCommon = mode(types) ?? "text";
    return { header, index, dataType: mostCommon };
  });
  const rows = grid.slice(1).map((row) => row.map((cell) => cell ?? ""));
  return {
    label: headers[0] || "Table",
    columns,
    rows
  };
}
function detectList(elements, config = DEFAULT_TABLE_EXTRACTION_CONFIG) {
  const withBounds = elements.map(getElementBounds).filter((b) => b !== null);
  if (withBounds.length < config.minListItems) return null;
  const sorted = [...withBounds].sort((a, b) => a.y - b.y);
  const yPositions = sorted.map((b) => b.y);
  const rowClusters = clusterPositions(yPositions, config.rowTolerance);
  if (rowClusters.length < config.minListItems) return null;
  const rowGroups = /* @__PURE__ */ new Map();
  for (const b of sorted) {
    const row = assignToCluster(b.y, rowClusters, config.rowTolerance);
    if (row >= 0) {
      if (!rowGroups.has(row)) rowGroups.set(row, []);
      rowGroups.get(row).push(b);
    }
  }
  const items = [];
  const fieldLabels = [];
  let fieldLabelsInitialized = false;
  for (const [, rowElements] of [...rowGroups.entries()].sort(([a], [b]) => a - b)) {
    const sortedRow = [...rowElements].sort((a, b) => a.x - b.x);
    const item = {};
    for (let i = 0; i < sortedRow.length; i++) {
      const label = `field_${i}`;
      if (!fieldLabelsInitialized) fieldLabels.push(label);
      item[label] = sortedRow[i].text;
    }
    fieldLabelsInitialized = true;
    items.push(item);
  }
  if (items.length < config.minListItems) return null;
  const fields = fieldLabels.map((label) => {
    const values = items.map((item) => item[label]).filter(Boolean);
    const types = values.map((v) => classifyDataType(v).type);
    return { label, dataType: mode(types) ?? "text" };
  });
  return {
    label: "List",
    fields,
    items
  };
}
function extractStructuredData(elements, config = DEFAULT_TABLE_EXTRACTION_CONFIG) {
  const tables = [];
  const lists = [];
  const table = detectTable(elements, config);
  if (table) {
    tables.push(table);
  }
  const listCandidates = elements.filter((el) => {
    const role = el.role || el.type;
    return ["listitem", "row", "option", "link", "button"].includes(role);
  });
  if (listCandidates.length >= config.minListItems) {
    const list = detectList(listCandidates, config);
    if (list) {
      lists.push(list);
    }
  }
  return { tables, lists };
}
function mode(arr) {
  if (arr.length === 0) return void 0;
  const counts = /* @__PURE__ */ new Map();
  let best = arr[0];
  let bestCount = 0;
  for (const v of arr) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

// src/ai/bookmarks.ts
var BookmarkStore = class {
  constructor(maxBookmarks = 50) {
    this.bookmarks = /* @__PURE__ */ new Map();
    this.maxBookmarks = Math.max(1, maxBookmarks);
  }
  /**
   * Configure the eviction cap. The store keeps the configured number of
   * most-recently-saved bookmarks. Overwriting an existing name does not
   * count toward the cap.
   */
  setMaxBookmarks(max) {
    this.maxBookmarks = Math.max(1, max);
    while (this.bookmarks.size > this.maxBookmarks) {
      const oldest = this.findOldestKey();
      if (oldest === null) break;
      this.bookmarks.delete(oldest);
    }
  }
  /** Save (or overwrite) a bookmark. Returns the stored entry. */
  save(entry) {
    if (this.bookmarks.size >= this.maxBookmarks && !this.bookmarks.has(entry.name)) {
      const oldest = this.findOldestKey();
      if (oldest !== null) {
        this.bookmarks.delete(oldest);
      }
    }
    this.bookmarks.set(entry.name, entry);
    return entry;
  }
  /** Get a bookmark by name, or null if missing. */
  get(name) {
    return this.bookmarks.get(name) ?? null;
  }
  /** Returns true if the named bookmark exists. */
  has(name) {
    return this.bookmarks.has(name);
  }
  /** Delete a bookmark. Returns true if it existed. */
  delete(name) {
    return this.bookmarks.delete(name);
  }
  /** List bookmark names in insertion order. */
  listNames() {
    return [...this.bookmarks.keys()];
  }
  /** List all bookmark entries in insertion order. */
  list() {
    return [...this.bookmarks.values()];
  }
  /** Number of bookmarks currently stored. */
  size() {
    return this.bookmarks.size;
  }
  /** Remove every bookmark. Returns the number cleared. */
  clear() {
    const n = this.bookmarks.size;
    this.bookmarks.clear();
    return n;
  }
  findOldestKey() {
    let oldestKey = null;
    let oldestSavedAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.bookmarks) {
      if (entry.savedAt < oldestSavedAt) {
        oldestSavedAt = entry.savedAt;
        oldestKey = key;
      }
    }
    return oldestKey;
  }
};
var globalStore2 = null;
function getGlobalBookmarkStore() {
  if (!globalStore2) {
    globalStore2 = new BookmarkStore();
  }
  return globalStore2;
}

// src/ai/change-tracker.ts
var DEFAULT_CONFIG = {
  defaultSettleTimeout: 5e3,
  defaultSettleMinStable: 300,
  defaultPollInterval: 200,
  defaultWaitTimeout: 1e4,
  maxBufferSize: 1e3,
  maxBookmarks: 50
};
var ChangeTracker = class {
  constructor(deps, config) {
    // Bookmarks — backed by the process-wide singleton store
    // (`getGlobalBookmarkStore()`). Previously this was a per-instance Map,
    // but parallel code paths (the SDK browser dispatcher and the runner-side
    // ChangeTracker) each owned their own map, so a `POST /ai/bookmarks` save
    // wasn't visible to a follow-up `GET /ai/bookmarks` list resolved through
    // the other path. The singleton ensures every reader/writer hits the
    // same backing storage. See B2 / `ai/bookmarks.ts`.
    // Change buffer — DOM mutations and SPA route changes share the same
    // buffer so a drain returns them interleaved by `recordedAt`. The DOM
    // entry shape is unchanged for backward compatibility; route entries
    // carry `type: "route-change"` as a discriminator (P1.3).
    this.changeBuffer = [];
    this.bufferEnabled = false;
    this.bufferSequence = 0;
    this.bufferEnabledAt = 0;
    // Tier 3.3: Extended change-buffer sub-lists
    this.domMutationBuffer = [];
    this.consoleErrorBuffer = [];
    this.networkRequestBuffer = [];
    // Tier 3.3: Active subscriptions / observers (live while buffer is enabled)
    this.mutationObserver = null;
    this.unsubscribeBrowserEvents = null;
    this.unsubscribeNetworkEvents = null;
    // Phase 2a: Tauri events sub-buffer. Only populated inside a Tauri webview
    // (guarded by `window.__TAURI_INTERNALS__`). `@tauri-apps/api` is loaded via
    // dynamic import so non-Tauri hosts don't pay for the dependency.
    this.tauriEventBuffer = [];
    this.tauriEventNames = [];
    this.tauriEventUnlisteners = [];
    this.tauriEventBufferCap = 200;
    // Recent route-change ring buffer — always on, independent of `bufferEnabled`.
    // Used by `/ai/wait-for-route-change` to resolve immediately when a matching
    // navigation happened between the HTTP request arriving and the subscription
    // being attached.
    this.recentRouteChanges = [];
    this.recentRouteChangesCap = 100;
    // Listeners fired synchronously from `pushRouteChange`. Independent of the
    // buffer-enabled gate so consumers like wait-for-route-change can subscribe
    // without first having to toggle the change buffer.
    this.routeChangeListeners = /* @__PURE__ */ new Set();
    // Last diff for categorization
    this.lastDiff = null;
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
    getGlobalBookmarkStore().setMaxBookmarks(this.config.maxBookmarks);
  }
  // ==========================================================================
  // Feature 1: Action-Integrated Diffing
  // ==========================================================================
  /**
   * Execute an action and return the diff of what changed.
   *
   * Flow: snapshot before → execute action → wait for idle → snapshot after → diff
   */
  async executeWithDiff(request) {
    const startTime = performance.now();
    let changeReceivedDuringAction = false;
    const unsubscribeChanges = this.deps.subscribeChanges?.(() => {
      changeReceivedDuringAction = true;
    });
    this.deps.refreshElements?.();
    const beforeControl = this.deps.createControlSnapshot();
    const beforeSnapshot = this.deps.snapshotManager.createSnapshot(beforeControl);
    let actionResult;
    let actionSuccess;
    if (request.instruction && this.deps.executeNLAction) {
      const nlResult = await this.deps.executeNLAction(request.instruction);
      actionResult = nlResult;
      actionSuccess = nlResult.success;
    } else if (request.elementAction && this.deps.executeElementAction) {
      const result = await this.deps.executeElementAction(request.elementAction.elementId, {
        action: request.elementAction.action,
        params: request.elementAction.params
      });
      actionResult = result;
      actionSuccess = result !== null && typeof result === "object" && "success" in result && result.success;
    } else {
      throw new Error(
        "Either instruction (with executeNLAction) or elementAction (with executeElementAction) must be provided"
      );
    }
    const settleTimeout = request.settleTimeout ?? this.config.defaultSettleTimeout;
    const settleMinStable = request.settleMinStable ?? this.config.defaultSettleMinStable;
    let settleTimedOut = false;
    let timeline;
    if (request.timeline) {
      timeline = await this.recordTimeline(
        beforeSnapshot,
        startTime,
        settleTimeout,
        settleMinStable,
        request.timelineInterval ?? 100,
        request.scope
      );
      settleTimedOut = !timeline.settled;
    } else if (this.deps.idleDetector) {
      try {
        await this.deps.idleDetector.waitForIdle({
          timeout: settleTimeout,
          minStableMs: settleMinStable
        });
      } catch {
        settleTimedOut = true;
      }
    } else {
      await sleep(settleMinStable);
    }
    this.deps.refreshElements?.();
    const afterControl = this.deps.createControlSnapshot();
    const afterSnapshot = this.deps.snapshotManager.createSnapshot(afterControl);
    let diff;
    if (this.deps.subscribeChanges && !changeReceivedDuringAction && afterControl.elements?.length === beforeControl.elements?.length) {
      diff = computeDiff(beforeSnapshot, afterSnapshot, this.config.diffConfig);
    } else if (request.scope) {
      diff = this.computeScopedDiff(beforeSnapshot, afterSnapshot, request.scope);
    } else {
      diff = computeDiff(beforeSnapshot, afterSnapshot, this.config.diffConfig);
    }
    const categorize = request.categorize !== false;
    const categorized = categorize ? this.categorizeChanges(diff) : void 0;
    this.lastDiff = diff;
    if (this.bufferEnabled) {
      this.appendToBuffer(diff, categorized?.category ?? this.categorizeChanges(diff).category);
    }
    const budgetSummary = request.summaryBudget != null ? this.summarizeDiff(diff, {
      budget: request.summaryBudget,
      includeCategory: !!categorized
    }) : void 0;
    const structuredChanges = request.analyzeStructured ? analyzeStructuredChanges(beforeSnapshot, afterSnapshot) : void 0;
    unsubscribeChanges?.();
    return {
      actionSuccess,
      actionResult,
      beforeSnapshot,
      afterSnapshot,
      diff,
      categorized,
      timeline,
      settleTimedOut,
      budgetSummary,
      structuredChanges,
      durationMs: performance.now() - startTime,
      timestamp: Date.now()
    };
  }
  // ==========================================================================
  // Feature 2: waitForChange
  // ==========================================================================
  /**
   * Wait for a specific change condition to be met.
   *
   * Polls at configurable intervals, computing diffs until the predicate matches.
   */
  async waitForChange(predicate, options) {
    const timeout = options?.timeout ?? this.config.defaultWaitTimeout;
    const startTime = performance.now();
    this.deps.refreshElements?.();
    const baselineControl = this.deps.createControlSnapshot();
    const baselineSnapshot = this.deps.snapshotManager.createSnapshot(baselineControl);
    if (this.deps.subscribeChanges) {
      return this.waitForChangePush(predicate, baselineSnapshot, options, startTime, timeout);
    }
    return this.waitForChangePoll(predicate, baselineSnapshot, options, startTime, timeout);
  }
  /**
   * Push-based path: subscribe to change events, snapshot + diff only when
   * a change event arrives. Safety-net poll at 2000ms to catch missed events.
   */
  async waitForChangePush(predicate, baselineSnapshot, options, startTime, timeout) {
    const safetyPollMs = 2e3;
    let changeReceived = false;
    let unsubscribe = null;
    try {
      unsubscribe = this.deps.subscribeChanges(() => {
        changeReceived = true;
      });
      while (performance.now() - startTime < timeout) {
        await sleep(
          changeReceived ? 0 : Math.min(safetyPollMs, timeout - (performance.now() - startTime))
        );
        changeReceived = false;
        const diff = this.snapshotAndDiff(baselineSnapshot, options);
        if (this.matchesPredicate(diff, predicate)) {
          this.lastDiff = diff;
          if (this.bufferEnabled) {
            this.appendToBuffer(diff, this.categorizeChanges(diff).category);
          }
          return diff;
        }
      }
    } finally {
      unsubscribe?.();
    }
    return this.timeoutWithDiff(baselineSnapshot, options, timeout);
  }
  /**
   * Polling path: original behavior — poll at defaultPollInterval (200ms).
   */
  async waitForChangePoll(predicate, baselineSnapshot, options, startTime, timeout) {
    const interval = options?.interval ?? this.config.defaultPollInterval;
    while (performance.now() - startTime < timeout) {
      await sleep(interval);
      const diff = this.snapshotAndDiff(baselineSnapshot, options);
      if (this.matchesPredicate(diff, predicate)) {
        this.lastDiff = diff;
        if (this.bufferEnabled) {
          this.appendToBuffer(diff, this.categorizeChanges(diff).category);
        }
        return diff;
      }
    }
    return this.timeoutWithDiff(baselineSnapshot, options, timeout);
  }
  /** Snapshot current state and diff against baseline. */
  snapshotAndDiff(baselineSnapshot, options) {
    this.deps.refreshElements?.();
    const currentControl = this.deps.createControlSnapshot();
    const currentSnapshot = this.deps.snapshotManager.createSnapshot(currentControl);
    if (options?.scope) {
      return this.computeScopedDiff(baselineSnapshot, currentSnapshot, options.scope);
    }
    return computeDiff(baselineSnapshot, currentSnapshot, this.config.diffConfig);
  }
  /** Handle timeout: capture final diff and throw. */
  timeoutWithDiff(baselineSnapshot, options, timeout) {
    const finalDiff = this.snapshotAndDiff(baselineSnapshot, options);
    this.lastDiff = finalDiff;
    throw new Error(
      `waitForChange timed out after ${timeout}ms. Changes detected: ${finalDiff.changes.appeared.length} appeared, ${finalDiff.changes.disappeared.length} disappeared, ${finalDiff.changes.modified.length} modified`
    );
  }
  /**
   * Check if a diff matches a predicate
   */
  matchesPredicate(diff, predicate) {
    if (predicate.anySignificantChange) {
      if (hasSignificantChanges(diff)) return true;
    }
    if (predicate.elementAppeared !== void 0) {
      const matcher = predicate.elementAppeared;
      if (typeof matcher === "string") {
        const found = diff.changes.appeared.some(
          (e) => e.elementId === matcher || e.description.toLowerCase().includes(matcher.toLowerCase())
        );
        if (found) return true;
      } else {
        const found = diff.changes.appeared.some((e) => {
          if (matcher.text && !e.description.toLowerCase().includes(matcher.text.toLowerCase())) {
            return false;
          }
          if (matcher.type && e.type !== matcher.type) {
            return false;
          }
          return true;
        });
        if (found) return true;
      }
    }
    if (predicate.elementDisappeared !== void 0) {
      const found = diff.changes.disappeared.some(
        (e) => e.elementId === predicate.elementDisappeared || e.description.toLowerCase().includes(predicate.elementDisappeared.toLowerCase())
      );
      if (found) return true;
    }
    if (predicate.propertyChanged) {
      const { elementId, property, expectedValue } = predicate.propertyChanged;
      const found = diff.changes.modified.some((m) => {
        if (m.elementId !== elementId) return false;
        if (m.property !== property) return false;
        if (expectedValue !== void 0 && m.to !== expectedValue) return false;
        return true;
      });
      if (found) return true;
    }
    if (predicate.textContains) {
      const { elementId, text } = predicate.textContains;
      const textLower = text.toLowerCase();
      if (elementId) {
        const found = diff.changes.modified.some(
          (m) => m.elementId === elementId && m.property === "textContent" && m.to.toLowerCase().includes(textLower)
        );
        if (found) return true;
        const appeared = diff.changes.appeared.some(
          (e) => e.elementId === elementId && e.description.toLowerCase().includes(textLower)
        );
        if (appeared) return true;
      } else {
        const inModified = diff.changes.modified.some(
          (m) => m.property === "textContent" && m.to.toLowerCase().includes(textLower)
        );
        if (inModified) return true;
        const inAppeared = diff.changes.appeared.some(
          (e) => e.description.toLowerCase().includes(textLower)
        );
        if (inAppeared) return true;
        if (diff.contentChanges) {
          const inText = diff.contentChanges.textChanges.some(
            (t) => t.newText.toLowerCase().includes(textLower)
          );
          if (inText) return true;
        }
      }
    }
    if (predicate.category) {
      const categorized = this.categorizeChanges(diff);
      if (categorized.category === predicate.category || categorized.secondaryCategories.includes(predicate.category)) {
        return true;
      }
    }
    if (predicate.elementCount) {
      const { min, type, text } = predicate.elementCount;
      const matchingAppeared = diff.changes.appeared.filter((e) => {
        if (type && e.type !== type) return false;
        if (text && !e.description.toLowerCase().includes(text.toLowerCase())) return false;
        return true;
      });
      if (matchingAppeared.length >= min) return true;
    }
    if (predicate.urlChanged) {
      if (diff.pageChanges?.urlChanged) return true;
    }
    if (predicate.urlContains) {
      if (diff.pageChanges?.urlChanged && diff.pageChanges.newUrl?.toLowerCase().includes(predicate.urlContains.toLowerCase())) {
        return true;
      }
    }
    if (predicate.formValid) {
      const { formId } = predicate.formValid;
      const errorAppeared = diff.changes.appeared.some((e) => {
        const desc = e.description.toLowerCase();
        const inScope = !formId || e.elementId.toLowerCase().includes(formId.toLowerCase());
        return inScope && (desc.includes("error") || desc.includes("invalid") || desc.includes("validation"));
      });
      const errorDisappeared = diff.changes.disappeared.some((e) => {
        const desc = e.description.toLowerCase();
        const inScope = !formId || e.elementId.toLowerCase().includes(formId.toLowerCase());
        return inScope && (desc.includes("error") || desc.includes("invalid") || desc.includes("validation"));
      });
      if (errorDisappeared && !errorAppeared) return true;
    }
    if (predicate.statusChanged) {
      const { elementId, direction, newStatus } = predicate.statusChanged;
      if (diff.contentChanges?.statusChanges) {
        const found = diff.contentChanges.statusChanges.some((s) => {
          if (elementId && s.elementId !== elementId) return false;
          if (direction && s.direction !== direction) return false;
          if (newStatus && !s.newStatus.toLowerCase().includes(newStatus.toLowerCase()))
            return false;
          return true;
        });
        if (found) return true;
      }
    }
    return false;
  }
  // ==========================================================================
  // Feature: Change Timeline
  // ==========================================================================
  /**
   * Record a timeline of changes during the settle period.
   *
   * Takes intermediate snapshots at regular intervals and records what changed
   * at each step, producing a time-ordered sequence of events.
   */
  async recordTimeline(beforeSnapshot, actionStartTime, settleTimeout, settleMinStable, intervalMs, scope) {
    const events = [];
    let lastSnapshot = beforeSnapshot;
    let stableMs = 0;
    let settled = false;
    const timelineStart = performance.now();
    events.push({
      offsetMs: 0,
      type: "action",
      summary: "Action executed"
    });
    while (performance.now() - timelineStart < settleTimeout) {
      await sleep(intervalMs);
      const offsetMs = Math.round(performance.now() - actionStartTime);
      this.deps.refreshElements?.();
      const control = this.deps.createControlSnapshot();
      const currentSnapshot = this.deps.snapshotManager.createSnapshot(control);
      const incrementalDiff = scope ? this.computeScopedDiff(lastSnapshot, currentSnapshot, scope) : computeDiff(lastSnapshot, currentSnapshot, this.config.diffConfig);
      const hasChanges = hasSignificantChanges(incrementalDiff);
      if (hasChanges) {
        stableMs = 0;
        if (incrementalDiff.changes.appeared.length > 0) {
          events.push({
            offsetMs,
            type: "elements-appeared",
            summary: `${incrementalDiff.changes.appeared.length} element(s) appeared`,
            elementIds: incrementalDiff.changes.appeared.map((e) => e.elementId),
            count: incrementalDiff.changes.appeared.length
          });
        }
        if (incrementalDiff.changes.disappeared.length > 0) {
          events.push({
            offsetMs,
            type: "elements-disappeared",
            summary: `${incrementalDiff.changes.disappeared.length} element(s) disappeared`,
            elementIds: incrementalDiff.changes.disappeared.map((e) => e.elementId),
            count: incrementalDiff.changes.disappeared.length
          });
        }
        const significantMods = incrementalDiff.changes.modified.filter((m) => m.significant);
        if (significantMods.length > 0) {
          events.push({
            offsetMs,
            type: "elements-modified",
            summary: `${significantMods.length} element(s) modified`,
            elementIds: significantMods.map((m) => m.elementId),
            count: significantMods.length
          });
        }
        if (incrementalDiff.pageChanges?.urlChanged) {
          events.push({
            offsetMs,
            type: "page-changed",
            summary: `URL changed to ${incrementalDiff.pageChanges.newUrl ?? "unknown"}`
          });
        }
        lastSnapshot = currentSnapshot;
      } else {
        stableMs += intervalMs;
        if (stableMs >= settleMinStable) {
          settled = true;
          events.push({
            offsetMs,
            type: "settled",
            summary: `UI settled after ${stableMs}ms of stability`
          });
          break;
        }
      }
    }
    return {
      events,
      settleMs: Math.round(performance.now() - timelineStart),
      settled
    };
  }
  // ==========================================================================
  // Feature 3: Semantic Change Categories
  // ==========================================================================
  /**
   * Classify a diff into a semantic category.
   */
  categorizeChanges(diff) {
    const scores = {
      navigation: 0,
      feedback: 0,
      "data-update": 0,
      "ui-state": 0,
      loading: 0,
      "no-op": 0
    };
    if (!hasSignificantChanges(diff)) {
      return {
        category: "no-op",
        confidence: 1,
        secondaryCategories: [],
        diff
      };
    }
    if (diff.pageChanges?.urlChanged) {
      scores.navigation += 0.8;
    }
    if (diff.changes.appeared.length > 10 && diff.changes.disappeared.length > 10) {
      scores.navigation += 0.4;
    }
    if (diff.probableTrigger === "Page navigation") {
      scores.navigation += 0.6;
    }
    const feedbackAppeared = diff.changes.appeared.filter((e) => {
      const desc = e.description.toLowerCase();
      return desc.includes("error") || desc.includes("success") || desc.includes("warning") || desc.includes("toast") || desc.includes("notification") || desc.includes("alert") || desc.includes("validation") || e.type === "dialog";
    });
    if (feedbackAppeared.length > 0) {
      scores.feedback += 0.3 + Math.min(feedbackAppeared.length * 0.2, 0.5);
    }
    if (diff.probableTrigger === "Form validation") {
      scores.feedback += 0.6;
    }
    if (diff.probableTrigger === "Modal opened" || diff.probableTrigger === "Modal closed") {
      scores.feedback += 0.3;
    }
    if (diff.contentChanges?.statusChanges && diff.contentChanges.statusChanges.length > 0) {
      scores.feedback += 0.3;
    }
    if (diff.contentChanges?.metricChanges && diff.contentChanges.metricChanges.length > 0) {
      scores["data-update"] += 0.3 + Math.min(diff.contentChanges.metricChanges.length * 0.15, 0.5);
    }
    if (diff.contentChanges?.textChanges) {
      const dataTextChanges = diff.contentChanges.textChanges.filter(
        (t) => t.changeType === "modified"
      );
      if (dataTextChanges.length > 0) {
        scores["data-update"] += 0.2 + Math.min(dataTextChanges.length * 0.1, 0.4);
      }
    }
    const visibilityMods = diff.changes.modified.filter(
      (m) => m.property === "visible" || m.property === "enabled" || m.property === "checked"
    );
    if (visibilityMods.length > 0) {
      scores["ui-state"] += 0.3 + Math.min(visibilityMods.length * 0.15, 0.5);
    }
    if (diff.probableTrigger === "UI expansion/collapse" || diff.probableTrigger === "Focus changed") {
      scores["ui-state"] += 0.4;
    }
    const loadingAppeared = diff.changes.appeared.filter((e) => {
      const desc = e.description.toLowerCase();
      return desc.includes("loading") || desc.includes("spinner") || desc.includes("skeleton") || desc.includes("progress");
    });
    const loadingDisappeared = diff.changes.disappeared.filter((e) => {
      const desc = e.description.toLowerCase();
      return desc.includes("loading") || desc.includes("spinner") || desc.includes("skeleton") || desc.includes("progress");
    });
    if (loadingAppeared.length > 0 || loadingDisappeared.length > 0) {
      scores.loading += 0.5 + Math.min((loadingAppeared.length + loadingDisappeared.length) * 0.15, 0.4);
    }
    if (diff.probableTrigger === "Loading state change") {
      scores.loading += 0.5;
    }
    const sortedCategories = Object.entries(scores).filter(([, score]) => score > 0).sort(([, a], [, b]) => b - a);
    if (sortedCategories.length === 0) {
      return {
        category: "ui-state",
        confidence: 0.3,
        secondaryCategories: [],
        diff
      };
    }
    const [primary, primaryScore] = sortedCategories[0];
    const secondaryCategories = sortedCategories.slice(1).filter(([, score]) => score > 0.2).map(([cat]) => cat);
    const confidence = Math.min(primaryScore, 1);
    return {
      category: primary,
      confidence,
      secondaryCategories,
      diff
    };
  }
  /**
   * Categorize the last computed diff (convenience for the server handler).
   */
  categorizeLastDiff() {
    if (!this.lastDiff) return null;
    return this.categorizeChanges(this.lastDiff);
  }
  // ==========================================================================
  // Feature: Budget-Aware Diff Summary
  // ==========================================================================
  /**
   * Generate a text summary of a diff that fits within a character budget.
   *
   * Prioritizes information by importance:
   * 1. Category header (if available)
   * 2. Page changes (URL/title)
   * 3. Appeared elements
   * 4. Disappeared elements
   * 5. Significant modifications
   * 6. Content changes (metrics, statuses, text)
   * 7. Minor modifications
   *
   * Each section is only included if there's remaining budget.
   */
  summarizeDiff(diff, options) {
    const { budget, includeIds = false, includeCategory = true } = options;
    const sections = [];
    let remaining = budget;
    const addSection = (text) => {
      if (text.length + 1 > remaining) return false;
      sections.push(text);
      remaining -= text.length + 1;
      return true;
    };
    const truncateText = (text, max) => {
      if (text.length <= max) return text;
      return text.substring(0, max - 3) + "...";
    };
    if (includeCategory) {
      const cat = this.categorizeChanges(diff);
      const header = `[${cat.category}] (${Math.round(cat.confidence * 100)}% confidence)`;
      addSection(header);
    }
    if (diff.pageChanges?.urlChanged) {
      addSection(`Page: navigated to ${diff.pageChanges.newUrl ?? "new URL"}`);
    } else if (diff.pageChanges?.titleChanged) {
      addSection(`Page: title changed to "${diff.pageChanges.newTitle ?? ""}"`);
    }
    if (diff.changes.appeared.length > 0) {
      const count = diff.changes.appeared.length;
      if (count <= 3 && remaining > 80) {
        const details = diff.changes.appeared.map((e) => {
          const id = includeIds ? ` [${e.elementId}]` : "";
          return `  + ${truncateText(e.description, 40)}${id}`;
        }).join("\n");
        addSection(`Appeared (${count}):
${details}`);
      } else {
        const firstFew = diff.changes.appeared.slice(0, 2).map((e) => e.description).join(", ");
        addSection(`Appeared: ${count} elements (${truncateText(firstFew, 50)}...)`);
      }
    }
    if (diff.changes.disappeared.length > 0) {
      const count = diff.changes.disappeared.length;
      if (count <= 3 && remaining > 80) {
        const details = diff.changes.disappeared.map((e) => {
          const id = includeIds ? ` [${e.elementId}]` : "";
          return `  - ${truncateText(e.description, 40)}${id}`;
        }).join("\n");
        addSection(`Disappeared (${count}):
${details}`);
      } else {
        addSection(`Disappeared: ${count} elements`);
      }
    }
    const significantMods = diff.changes.modified.filter((m) => m.significant);
    if (significantMods.length > 0 && remaining > 40) {
      const maxItems = Math.min(significantMods.length, 3);
      const details = significantMods.slice(0, maxItems).map((m) => `  ~ ${m.description}: ${m.property} "${m.from}" -> "${m.to}"`).join("\n");
      const suffix = significantMods.length > maxItems ? `
  ... +${significantMods.length - maxItems} more` : "";
      addSection(
        `Modified (${significantMods.length} significant):
${truncateText(details + suffix, remaining - 30)}`
      );
    }
    if (diff.contentChanges && remaining > 30) {
      const { metricChanges, statusChanges, textChanges } = diff.contentChanges;
      if (metricChanges.length > 0) {
        const metricSummary = metricChanges.slice(0, 2).map((m) => `${m.label}: ${m.oldValue} -> ${m.newValue}`).join(", ");
        addSection(`Metrics: ${truncateText(metricSummary, remaining - 12)}`);
      }
      if (statusChanges.length > 0 && remaining > 20) {
        const statusSummary = statusChanges.slice(0, 2).map((s) => `${s.label}: ${s.oldStatus} -> ${s.newStatus} (${s.direction})`).join(", ");
        addSection(`Statuses: ${truncateText(statusSummary, remaining - 12)}`);
      }
      if (textChanges.length > 0 && remaining > 20) {
        addSection(`Text changes: ${textChanges.length}`);
      }
    }
    const minorMods = diff.changes.modified.filter((m) => !m.significant);
    if (minorMods.length > 0 && remaining > 30) {
      addSection(`Minor changes: ${minorMods.length}`);
    }
    if (sections.length === 0) {
      return "No changes detected";
    }
    return sections.join("\n");
  }
  // ==========================================================================
  // Feature 4: Scoped Diffs
  // ==========================================================================
  /**
   * Compute a diff scoped to elements within a CSS selector container.
   *
   * When `resolveScope` is provided (browser environment), uses actual DOM containment
   * to determine which elements are inside the container. Falls back to string-based
   * matching on parentContext, ID prefix, and description.
   */
  computeScopedDiff(fromSnapshot, toSnapshot, scope) {
    const domScopedIds = this.deps.resolveScope?.(scope) ?? null;
    const filterElements = (elements) => {
      if (domScopedIds) {
        return elements.filter((el) => domScopedIds.has(el.id));
      }
      const scopeLower = scope.toLowerCase();
      return elements.filter((el) => {
        if (el.parentContext && el.parentContext.toLowerCase().includes(scopeLower)) {
          return true;
        }
        if (el.id.toLowerCase().startsWith(scopeLower)) {
          return true;
        }
        if (el.description.toLowerCase().includes(scopeLower)) {
          return true;
        }
        return false;
      });
    };
    const scopedFrom = {
      ...fromSnapshot,
      snapshotId: `${fromSnapshot.snapshotId}:scoped(${scope})`,
      elements: filterElements(fromSnapshot.elements)
    };
    const scopedTo = {
      ...toSnapshot,
      snapshotId: `${toSnapshot.snapshotId}:scoped(${scope})`,
      elements: filterElements(toSnapshot.elements)
    };
    return computeDiff(scopedFrom, scopedTo, this.config.diffConfig);
  }
  /**
   * Get a scoped diff from the current state vs. a named bookmark.
   */
  scopedDiffFromBookmark(bookmarkName, scope) {
    const bookmark = getGlobalBookmarkStore().get(bookmarkName);
    if (!bookmark) return null;
    this.deps.refreshElements?.();
    const currentControl = this.deps.createControlSnapshot();
    const currentSnapshot = this.deps.snapshotManager.createSnapshot(currentControl);
    return this.computeScopedDiff(bookmark.snapshot, currentSnapshot, scope);
  }
  // ==========================================================================
  // Feature 5: Change Buffer
  // ==========================================================================
  /** Enable change buffering. Starts MutationObserver and subscribes to
   * console/network events. When running inside a Tauri webview and
   * `setTauriEventNames()` has been called, also subscribes to those Tauri
   * backend events. The returned promise resolves once Tauri-event
   * subscriptions are in place; all other subscriptions are synchronous. In
   * non-Tauri hosts the promise resolves immediately. */
  async enableBuffer() {
    this.bufferEnabled = true;
    this.bufferEnabledAt = Date.now();
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && !this.mutationObserver) {
      this.mutationObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (this.domMutationBuffer.length >= 500) {
            this.domMutationBuffer.shift();
          }
          const entry = {
            type: record.type,
            target_selector: this.selectorFor(record.target),
            timestamp: Date.now()
          };
          if (record.type === "childList") {
            entry.added = record.addedNodes.length;
            entry.removed = record.removedNodes.length;
          } else if (record.type === "attributes") {
            entry.attribute_name = record.attributeName ?? void 0;
          }
          this.domMutationBuffer.push(entry);
        }
      });
      try {
        this.mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
          attributeOldValue: false,
          characterDataOldValue: false
        });
      } catch {
        this.mutationObserver = null;
      }
    }
    if (this.deps.subscribeBrowserEvents && !this.unsubscribeBrowserEvents) {
      const enabledAt = this.bufferEnabledAt;
      this.unsubscribeBrowserEvents = this.deps.subscribeBrowserEvents((event) => {
        if (event.timestamp < enabledAt) return;
        if (event.type !== "console") return;
        if (this.consoleErrorBuffer.length >= 100) {
          this.consoleErrorBuffer.shift();
        }
        this.consoleErrorBuffer.push({
          level: event.level ?? "error",
          message: event.message ?? "",
          stack: event.stack,
          timestamp: event.timestamp
        });
      });
    }
    if (this.deps.subscribeNetworkEvents && !this.unsubscribeNetworkEvents) {
      const enabledAt = this.bufferEnabledAt;
      this.unsubscribeNetworkEvents = this.deps.subscribeNetworkEvents((event) => {
        if (event.type === "request-start") {
          if (event.entry.request.startedAt < enabledAt) return;
          if (this.networkRequestBuffer.length >= 200) {
            this.networkRequestBuffer.shift();
          }
          this.networkRequestBuffer.push({
            url: event.entry.request.url,
            method: event.entry.request.method,
            timestamp: event.entry.request.startedAt
          });
        } else if (event.type === "request-complete" || event.type === "request-error") {
          if (event.entry.request.startedAt < enabledAt) return;
          const existing = this.networkRequestBuffer.find(
            (e) => e.url === event.entry.request.url && e.timestamp === event.entry.request.startedAt
          );
          if (existing) {
            existing.status = event.entry.response?.statusCode;
            existing.duration_ms = event.entry.response?.durationMs;
          } else {
            if (this.networkRequestBuffer.length >= 200) {
              this.networkRequestBuffer.shift();
            }
            this.networkRequestBuffer.push({
              url: event.entry.request.url,
              method: event.entry.request.method,
              status: event.entry.response?.statusCode,
              duration_ms: event.entry.response?.durationMs,
              timestamp: event.entry.request.startedAt
            });
          }
        }
      });
    }
    await this.subscribeTauriEvents();
  }
  /** Disable change buffering. Stops MutationObserver and unsubscribes from services. */
  disableBuffer() {
    this.bufferEnabled = false;
    this._teardownExtendedObservers();
  }
  /**
   * Set the list of Tauri event names to capture in the change buffer.
   * Safe to call before or after `enableBuffer()`. When the buffer is
   * currently enabled, this unsubscribes from the previous names and
   * subscribes to the new ones (best-effort — returns a promise that
   * resolves once resubscription completes).
   */
  async setTauriEventNames(names) {
    this.tauriEventNames = [...names];
    if (this.bufferEnabled) {
      this.unsubscribeTauriEvents();
      await this.subscribeTauriEvents();
    }
  }
  /**
   * Subscribe to Tauri backend events. No-op when not running inside a
   * Tauri webview (detected via `window.__TAURI_INTERNALS__`) or when the
   * event-name list is empty. Loads `@tauri-apps/api/event` via dynamic
   * import so the SDK stays usable in non-Tauri hosts without the optional
   * dependency installed.
   */
  async subscribeTauriEvents() {
    if (this.tauriEventUnlisteners.length > 0) return;
    if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
      return;
    }
    if (this.tauriEventNames.length === 0) return;
    const globalTauri = window.__TAURI__;
    let listen = globalTauri?.event?.listen;
    if (typeof listen !== "function") {
      try {
        const specifier = `@tauri-apps/api/event`;
        const mod = await loadTauriEventModule(specifier);
        const dynListen = mod.listen;
        if (typeof dynListen === "function") {
          listen = dynListen;
        }
      } catch (err) {
        console.warn("[ui-bridge] Tauri event subscription unavailable:", err);
        return;
      }
    }
    if (typeof listen !== "function") {
      return;
    }
    for (const name of this.tauriEventNames) {
      try {
        const unlisten = await listen(name, (e) => {
          if (!this.bufferEnabled) return;
          if (this.tauriEventBuffer.length >= this.tauriEventBufferCap) return;
          this.tauriEventBuffer.push({
            event: e.event,
            payload: e.payload,
            timestamp: Date.now()
          });
        });
        if (!this.bufferEnabled) {
          try {
            unlisten();
          } catch {
          }
          return;
        }
        this.tauriEventUnlisteners.push(unlisten);
      } catch (err) {
        console.warn(`[ui-bridge] Failed to subscribe to Tauri event "${name}":`, err);
      }
    }
  }
  /** Invoke every stored unlisten function and clear the list. */
  unsubscribeTauriEvents() {
    for (const unlisten of this.tauriEventUnlisteners) {
      try {
        unlisten();
      } catch {
      }
    }
    this.tauriEventUnlisteners = [];
  }
  /** Stop MutationObserver and unsubscribe from console/network services. */
  _teardownExtendedObservers() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.unsubscribeBrowserEvents) {
      try {
        this.unsubscribeBrowserEvents();
      } catch {
      }
      this.unsubscribeBrowserEvents = null;
    }
    if (this.unsubscribeNetworkEvents) {
      try {
        this.unsubscribeNetworkEvents();
      } catch {
      }
      this.unsubscribeNetworkEvents = null;
    }
    this.unsubscribeTauriEvents();
    this.tauriEventBuffer = [];
  }
  /** Whether the buffer is enabled */
  isBufferEnabled() {
    return this.bufferEnabled;
  }
  /** Get buffer size (registry-level changes only, for backward compat) */
  getBufferSize() {
    return this.changeBuffer.length;
  }
  /**
   * Drain all buffered changes and clear the four sub-lists.
   * Observers remain active if the buffer is still enabled (incremental semantics:
   * subsequent drains return only events since the previous drain).
   *
   * Route-change and registry-diff entries are returned in `changes`, interleaved by
   * `recordedAt`. Raw DOM mutations, console errors, and network requests are returned
   * in separate typed lists.
   */
  drainBuffer() {
    const changes = [...this.changeBuffer];
    this.changeBuffer = [];
    changes.sort((a, b) => a.recordedAt - b.recordedAt || a.sequence - b.sequence);
    const dom = [...this.domMutationBuffer];
    this.domMutationBuffer = [];
    const console_errors = [...this.consoleErrorBuffer];
    this.consoleErrorBuffer = [];
    const network_requests = [...this.networkRequestBuffer];
    this.networkRequestBuffer = [];
    const tauri_events = [...this.tauriEventBuffer];
    this.tauriEventBuffer = [];
    return {
      changes,
      dom,
      console_errors,
      network_requests,
      tauri_events,
      count: changes.length,
      enabled_at: this.bufferEnabledAt,
      fromTimestamp: changes.length > 0 ? changes[0].recordedAt : 0,
      toTimestamp: changes.length > 0 ? changes[changes.length - 1].recordedAt : 0
    };
  }
  /**
   * Derive a best-effort CSS selector string for a DOM node.
   * Used for DomMutationEntry.target_selector.
   */
  selectorFor(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return node.nodeName.toLowerCase();
    }
    const el = node;
    const parts = [el.tagName.toLowerCase()];
    if (el.id) {
      return `#${el.id}`;
    }
    const cls = classList(el).slice(0, 2).join(".");
    if (cls) parts.push(`.${cls}`);
    return parts.join("");
  }
  /**
   * Push a SPA route-change entry into the buffer (P1.3). Called by the
   * runner's `useChangeTrackingEvents` integration when the
   * NavigationTracker fires a `navigation:change` event.
   *
   * Always feeds the always-on `recentRouteChanges` ring buffer and fires
   * any `subscribeRouteChange` listeners, regardless of `bufferEnabled`, so
   * that `/ai/wait-for-route-change` can resolve without the change buffer
   * being explicitly enabled. The existing `changeBuffer` append remains
   * gated on `bufferEnabled` for backward compatibility with drain semantics.
   */
  pushRouteChange(from, to, at) {
    const recordedAt = at ?? Date.now();
    this.recentRouteChanges.push({ from, to, at: recordedAt });
    if (this.recentRouteChanges.length > this.recentRouteChangesCap) {
      this.recentRouteChanges.splice(
        0,
        this.recentRouteChanges.length - this.recentRouteChangesCap
      );
    }
    for (const listener of this.routeChangeListeners) {
      try {
        listener({ from, to, at: recordedAt });
      } catch {
      }
    }
    if (!this.bufferEnabled) return;
    const entry = {
      type: "route-change",
      from,
      to,
      at: recordedAt,
      recordedAt,
      sequence: this.bufferSequence++
    };
    this.changeBuffer.push(entry);
    this.evictIfOverLimit();
  }
  /**
   * Subscribe to SPA route-change events.
   *
   * Fires synchronously from `pushRouteChange`, regardless of whether the
   * change buffer is enabled. Returns an unsubscribe function.
   */
  subscribeRouteChange(listener) {
    this.routeChangeListeners.add(listener);
    return () => {
      this.routeChangeListeners.delete(listener);
    };
  }
  /**
   * Return recent route-change events from the always-on ring buffer,
   * optionally filtered to entries recorded at or after `sinceMs`.
   *
   * Used by `/ai/wait-for-route-change` to resolve immediately when a
   * matching navigation occurred between the HTTP request arriving and the
   * listener being attached.
   */
  getRecentRouteChanges(sinceMs) {
    if (sinceMs === void 0) return [...this.recentRouteChanges];
    return this.recentRouteChanges.filter((entry) => entry.at >= sinceMs);
  }
  /** Append a diff to the buffer */
  appendToBuffer(diff, category) {
    if (!this.bufferEnabled) return;
    const entry = {
      diff,
      category,
      recordedAt: Date.now(),
      sequence: this.bufferSequence++
    };
    this.changeBuffer.push(entry);
    this.evictIfOverLimit();
  }
  /** Trim oldest entries when the buffer exceeds its configured size. */
  evictIfOverLimit() {
    if (this.changeBuffer.length > this.config.maxBufferSize) {
      this.changeBuffer = this.changeBuffer.slice(
        this.changeBuffer.length - this.config.maxBufferSize
      );
    }
  }
  // ==========================================================================
  // Feature 6: Snapshot Bookmarks
  // ==========================================================================
  /**
   * Save a named snapshot of the current state.
   */
  saveBookmark(name) {
    this.deps.refreshElements?.();
    const controlSnapshot = this.deps.createControlSnapshot();
    const snapshot = this.deps.snapshotManager.createSnapshot(controlSnapshot);
    const bookmark = {
      name,
      snapshot,
      savedAt: Date.now()
    };
    getGlobalBookmarkStore().save(bookmark);
    return bookmark;
  }
  /**
   * Get a named bookmark.
   */
  getBookmark(name) {
    return getGlobalBookmarkStore().get(name);
  }
  /**
   * Delete a named bookmark.
   */
  deleteBookmark(name) {
    return getGlobalBookmarkStore().delete(name);
  }
  /**
   * List all bookmark names.
   */
  listBookmarks() {
    return getGlobalBookmarkStore().listNames();
  }
  /**
   * Compute a diff from a named bookmark to the current state.
   */
  diffFromBookmark(name) {
    const bookmark = getGlobalBookmarkStore().get(name);
    if (!bookmark) return null;
    this.deps.refreshElements?.();
    const currentControl = this.deps.createControlSnapshot();
    const currentSnapshot = this.deps.snapshotManager.createSnapshot(currentControl);
    const diff = computeDiff(bookmark.snapshot, currentSnapshot, this.config.diffConfig);
    this.lastDiff = diff;
    return diff;
  }
};
function analyzeStructuredChanges(before, after) {
  const tableChanges = [];
  const listChanges = [];
  const beforeTable = detectTable(before.elements);
  const afterTable = detectTable(after.elements);
  if (beforeTable || afterTable) {
    const analysis = diffTables(beforeTable, afterTable);
    if (analysis) {
      tableChanges.push(analysis);
    }
  }
  const beforeList = detectList(before.elements);
  const afterList = detectList(after.elements);
  if (beforeList || afterList) {
    const analysis = diffLists(beforeList, afterList);
    if (analysis) {
      listChanges.push(analysis);
    }
  }
  return {
    tableChanges,
    listChanges,
    hasStructuredData: tableChanges.length > 0 || listChanges.length > 0
  };
}
function diffTables(before, after) {
  if (!before && after) {
    return {
      label: after.label,
      columns: after.columns.map((c) => c.header),
      addedRows: after.rows,
      removedRows: [],
      modifiedRows: [],
      summary: `Table "${after.label}" appeared with ${after.rows.length} rows`
    };
  }
  if (before && !after) {
    return {
      label: before.label,
      columns: before.columns.map((c) => c.header),
      addedRows: [],
      removedRows: before.rows,
      modifiedRows: [],
      summary: `Table "${before.label}" disappeared (had ${before.rows.length} rows)`
    };
  }
  if (before && after) {
    const columns = after.columns.map((c) => c.header);
    const addedRows = [];
    const removedRows = [];
    const modifiedRows = [];
    const keyFn = (row) => row[0] ?? row.join("|");
    const beforeRowMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < before.rows.length; i++) {
      beforeRowMap.set(keyFn(before.rows[i]), { row: before.rows[i], index: i });
    }
    const afterRowMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < after.rows.length; i++) {
      afterRowMap.set(keyFn(after.rows[i]), { row: after.rows[i], index: i });
    }
    for (const [key, { row }] of afterRowMap) {
      if (!beforeRowMap.has(key)) {
        addedRows.push(row);
      }
    }
    for (const [key, { row }] of beforeRowMap) {
      if (!afterRowMap.has(key)) {
        removedRows.push(row);
      }
    }
    for (const [key, afterEntry] of afterRowMap) {
      const beforeEntry = beforeRowMap.get(key);
      if (beforeEntry) {
        const changes = [];
        const maxCols = Math.max(beforeEntry.row.length, afterEntry.row.length);
        for (let c = 0; c < maxCols; c++) {
          const fromVal = beforeEntry.row[c] ?? "";
          const toVal = afterEntry.row[c] ?? "";
          if (fromVal !== toVal) {
            changes.push({
              column: columns[c] ?? `col_${c}`,
              from: fromVal,
              to: toVal
            });
          }
        }
        if (changes.length > 0) {
          modifiedRows.push({ rowIndex: afterEntry.index, changes });
        }
      }
    }
    if (addedRows.length === 0 && removedRows.length === 0 && modifiedRows.length === 0) {
      return null;
    }
    const parts = [];
    if (addedRows.length > 0) parts.push(`${addedRows.length} rows added`);
    if (removedRows.length > 0) parts.push(`${removedRows.length} rows removed`);
    if (modifiedRows.length > 0) parts.push(`${modifiedRows.length} rows modified`);
    return {
      label: after.label,
      columns,
      addedRows,
      removedRows,
      modifiedRows,
      summary: `Table "${after.label}": ${parts.join(", ")}`
    };
  }
  return null;
}
function diffLists(before, after) {
  if (!before && after) {
    return {
      label: after.label,
      addedItems: after.items,
      removedItems: [],
      summary: `List appeared with ${after.items.length} items`
    };
  }
  if (before && !after) {
    return {
      label: before.label,
      addedItems: [],
      removedItems: before.items,
      summary: `List disappeared (had ${before.items.length} items)`
    };
  }
  if (before && after) {
    const itemKey = (item) => Object.values(item).join("|");
    const beforeKeys = new Set(before.items.map(itemKey));
    const afterKeys = new Set(after.items.map(itemKey));
    const addedItems = after.items.filter((item) => !beforeKeys.has(itemKey(item)));
    const removedItems = before.items.filter((item) => !afterKeys.has(itemKey(item)));
    if (addedItems.length === 0 && removedItems.length === 0) {
      return null;
    }
    const parts = [];
    if (addedItems.length > 0) parts.push(`${addedItems.length} items added`);
    if (removedItems.length > 0) parts.push(`${removedItems.length} items removed`);
    return {
      label: after.label,
      addedItems,
      removedItems,
      summary: `List: ${parts.join(", ")}`
    };
  }
  return null;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function loadTauriEventModule(specifier) {
  return import(
    /* @vite-ignore */
    specifier
  );
}

// src/ai/format-analysis.ts
var DEFAULT_FORMAT_ANALYSIS_CONFIG = {
  lenientFormatting: true
};
function detectFormatPattern(value, dataType) {
  const trimmed = value.trim();
  switch (dataType) {
    case "currency": {
      const hasLeadingSymbol = /^[£$€¥₹]/.test(trimmed);
      const hasTrailingSymbol = /[£$€¥₹]$/.test(trimmed);
      const usesCommaThousands = /\d{1,3}(,\d{3})+/.test(trimmed);
      const usesPeriodThousands = /\d{1,3}(\.\d{3})+,/.test(trimmed);
      let pattern = hasLeadingSymbol ? "$" : "";
      if (usesCommaThousands) pattern += "#,###";
      else if (usesPeriodThousands) pattern += "#.###";
      else pattern += "#";
      if (/\.\d{2}$/.test(trimmed)) pattern += ".##";
      else if (/,\d{2}$/.test(trimmed)) pattern += ",##";
      if (hasTrailingSymbol) pattern += "$";
      return pattern;
    }
    case "date": {
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return "YYYY-MM-DD";
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return "MM/DD/YYYY";
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) return "DD.MM.YYYY";
      if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(trimmed)) return "M/D/YY";
      if (/^\w{3,9}\s+\d{1,2},?\s+\d{4}$/.test(trimmed)) return "Month DD, YYYY";
      return "date";
    }
    case "percentage":
      return /\s%$/.test(trimmed) ? "#.## %" : "#.##%";
    case "number": {
      const hasCommas = /,/.test(trimmed);
      const decimalPlaces = trimmed.includes(".") ? trimmed.split(".")[1]?.length || 0 : 0;
      return (hasCommas ? "#,###" : "#") + (decimalPlaces > 0 ? "." + "#".repeat(decimalPlaces) : "");
    }
    case "phone": {
      if (/^\(\d{3}\)\s?\d{3}-\d{4}$/.test(trimmed)) return "(###) ###-####";
      if (/^\d{3}-\d{3}-\d{4}$/.test(trimmed)) return "###-###-####";
      if (/^\+\d/.test(trimmed)) return "+# ###...";
      return "phone";
    }
    default:
      return dataType;
  }
}
function analyzeFormat(elementId, label, rawValue) {
  const { type: dataType } = classifyDataType(rawValue);
  const pattern = detectFormatPattern(rawValue, dataType);
  return {
    elementId,
    label,
    dataType,
    pattern,
    example: rawValue.trim()
  };
}
function analyzePageFormats(elements) {
  const descriptors = [];
  for (const el of elements) {
    const rawValue = el.state?.value ?? el.state?.textContent ?? "";
    if (!rawValue) continue;
    const label = el.accessibleName || el.labelText || el.label || el.description || el.id;
    descriptors.push(analyzeFormat(el.id, label, rawValue));
  }
  return descriptors;
}
function compareFormats(sourceFormats, targetFormats, config = DEFAULT_FORMAT_ANALYSIS_CONFIG) {
  const mismatches = [];
  const targetByLabel = /* @__PURE__ */ new Map();
  for (const t of targetFormats) {
    targetByLabel.set(t.label.toLowerCase(), t);
  }
  for (const source of sourceFormats) {
    const target = targetByLabel.get(source.label.toLowerCase());
    if (!target) continue;
    if (source.dataType !== target.dataType) {
      mismatches.push({
        label: source.label,
        sourceFormat: source,
        targetFormat: target,
        severity: "error",
        description: `Data type mismatch: source is ${source.dataType}, target is ${target.dataType}`
      });
      continue;
    }
    if (source.pattern !== target.pattern) {
      const severity = config.lenientFormatting ? "warning" : "error";
      mismatches.push({
        label: source.label,
        sourceFormat: source,
        targetFormat: target,
        severity,
        description: `Format differs: source uses "${source.pattern}", target uses "${target.pattern}"`
      });
    }
  }
  return mismatches;
}

// src/ai/cross-app-diff.ts
var DEFAULT_CROSS_APP_DIFF_CONFIG = {
  matchThreshold: 0.5,
  accessibleNameWeight: 1,
  textWeight: 0.95,
  rolePositionWeight: 0.7
};
function getElementText(el) {
  return el.accessibleName || el.labelText || el.label || el.state?.textContent || el.description || "";
}
function getRole(el) {
  return (el.role || el.type || "").toLowerCase();
}
function getCenter(el) {
  const rect = el.state?.rect;
  if (!rect) return null;
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}
function computeMatchScore(source, target, config) {
  let bestScore = 0;
  let bestStrategy = "none";
  const srcName = (source.accessibleName || "").trim();
  const tgtName = (target.accessibleName || "").trim();
  if (srcName && tgtName && srcName.toLowerCase() === tgtName.toLowerCase()) {
    return { score: config.accessibleNameWeight, strategy: "accessible-name-exact" };
  }
  const srcText = getElementText(source);
  const tgtText = getElementText(target);
  if (srcText && tgtText && srcText.toLowerCase() === tgtText.toLowerCase()) {
    const score = config.textWeight;
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = "text-exact";
    }
  }
  if (srcText && tgtText) {
    const srcNorm = normalizeString(srcText);
    const tgtNorm = normalizeString(tgtText);
    const similarity = jaroWinklerSimilarity(srcNorm, tgtNorm);
    const score = similarity * 0.85;
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = "text-fuzzy";
    }
  }
  const srcRole = getRole(source);
  const tgtRole = getRole(target);
  if (srcRole && srcRole === tgtRole) {
    const srcCenter = getCenter(source);
    const tgtCenter = getCenter(target);
    if (srcCenter && tgtCenter) {
      const dx = Math.abs(srcCenter.x - tgtCenter.x) / 1920;
      const dy = Math.abs(srcCenter.y - tgtCenter.y) / 1080;
      const posSimilarity = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const score = config.rolePositionWeight * posSimilarity;
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = "role-position";
      }
    }
  }
  const srcVal = source.state?.value ?? source.state?.textContent ?? "";
  const tgtVal = target.state?.value ?? target.state?.textContent ?? "";
  if (srcVal && tgtVal) {
    const srcType = classifyDataType(srcVal).type;
    const tgtType = classifyDataType(tgtVal).type;
    const srcNorm = normalizeValue(srcVal, srcType);
    const tgtNorm = normalizeValue(tgtVal, tgtType);
    if (srcNorm === tgtNorm && srcNorm !== "") {
      const score = 0.6;
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = "data-overlap";
      }
    }
  }
  return { score: bestScore, strategy: bestStrategy };
}
function matchElements(sourceElements, targetElements, config = DEFAULT_CROSS_APP_DIFF_CONFIG) {
  const candidates = [];
  for (let si = 0; si < sourceElements.length; si++) {
    for (let ti = 0; ti < targetElements.length; ti++) {
      const { score, strategy } = computeMatchScore(sourceElements[si], targetElements[ti], config);
      if (score >= config.matchThreshold) {
        candidates.push({ sourceIdx: si, targetIdx: ti, score, strategy });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedSource = /* @__PURE__ */ new Set();
  const usedTarget = /* @__PURE__ */ new Set();
  const pairs = [];
  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);
    const src = sourceElements[c.sourceIdx];
    const tgt = targetElements[c.targetIdx];
    pairs.push({
      sourceId: src.id,
      targetId: tgt.id,
      sourceLabel: getElementText(src) || src.id,
      targetLabel: getElementText(tgt) || tgt.id,
      confidence: Math.round(c.score * 100) / 100,
      matchStrategy: c.strategy
    });
  }
  return pairs;
}
function computeCrossAppDiff(sourceElements, targetElements, config = DEFAULT_CROSS_APP_DIFF_CONFIG) {
  const matchedPairs = matchElements(sourceElements, targetElements, config);
  const matchedSourceIds = new Set(matchedPairs.map((p) => p.sourceId));
  const matchedTargetIds = new Set(matchedPairs.map((p) => p.targetId));
  const unmatchedSourceIds = sourceElements.filter((e) => !matchedSourceIds.has(e.id)).map((e) => e.id);
  const unmatchedTargetIds = targetElements.filter((e) => !matchedTargetIds.has(e.id)).map((e) => e.id);
  const sourceData = extractPageData(sourceElements);
  const targetData = extractPageData(targetElements);
  const dataComparisons = [];
  for (const pair of matchedPairs) {
    const srcEntry = Object.values(sourceData.values).find((v) => v.elementId === pair.sourceId);
    const tgtEntry = Object.values(targetData.values).find((v) => v.elementId === pair.targetId);
    if (srcEntry && tgtEntry) {
      dataComparisons.push({
        label: pair.sourceLabel,
        sourceValue: srcEntry.rawValue,
        targetValue: tgtEntry.rawValue,
        valuesMatch: srcEntry.normalizedValue === tgtEntry.normalizedValue,
        formatsMatch: srcEntry.dataType === tgtEntry.dataType
      });
    }
  }
  const sourceFormats = analyzePageFormats(sourceElements);
  const targetFormats = analyzePageFormats(targetElements);
  const formatMismatches = compareFormats(sourceFormats, targetFormats);
  return {
    matchedPairs,
    unmatchedSourceIds,
    unmatchedTargetIds,
    dataComparisons,
    formatMismatches
  };
}

// src/ai/action-parity.ts
var DEFAULT_ACTION_PARITY_CONFIG = {
  ignoreActions: []
};
function getActions(el, ignoreActions) {
  const actions = el.actions || el.suggestedActions || [];
  const ignoreSet = new Set(ignoreActions.map((a) => a.toLowerCase()));
  return actions.map(
    (a) => typeof a === "string" ? a : a.action || a.name || ""
  ).filter((a) => a && !ignoreSet.has(a.toLowerCase()));
}
function analyzeActionParity(matchedPairs, sourceElements, targetElements, config = DEFAULT_ACTION_PARITY_CONFIG) {
  const sourceById = new Map(sourceElements.map((e) => [e.id, e]));
  const targetById = new Map(targetElements.map((e) => [e.id, e]));
  const results = [];
  for (const pair of matchedPairs) {
    const src = sourceById.get(pair.sourceId);
    const tgt = targetById.get(pair.targetId);
    if (!src || !tgt) continue;
    const sourceActions = getActions(src, config.ignoreActions);
    const targetActions = getActions(tgt, config.ignoreActions);
    const sourceSet = new Set(sourceActions.map((a) => a.toLowerCase()));
    const targetSet = new Set(targetActions.map((a) => a.toLowerCase()));
    const missingInTarget = sourceActions.filter((a) => !targetSet.has(a.toLowerCase()));
    const missingInSource = targetActions.filter((a) => !sourceSet.has(a.toLowerCase()));
    results.push({
      pair,
      sourceActions,
      targetActions,
      missingInTarget,
      missingInSource
    });
  }
  return results;
}

// src/ai/navigation-map.ts
var DEFAULT_NAVIGATION_MAP_CONFIG = {
  labelMatchThreshold: 0.8
};
function isNavigationElement(el) {
  const role = (el.role || "").toLowerCase();
  const type = (el.type || "").toLowerCase();
  const semanticType = (el.semanticType || "").toLowerCase();
  if (["link", "menuitem", "tab"].includes(role)) return true;
  if (["link", "menuitem"].includes(type)) return true;
  if (semanticType.includes("nav") || semanticType.includes("menu") || semanticType.includes("tab")) {
    return true;
  }
  const context = (el.parentContext || "").toLowerCase();
  if (context.includes("nav") || context.includes("menu") || context.includes("sidebar")) {
    if (role === "button" || type === "button" || role === "link" || type === "link") {
      return true;
    }
  }
  return false;
}
function getNavLabel(el) {
  return el.accessibleName || el.labelText || el.label || el.description || el.id;
}
function getHref(el) {
  return el.state?.href || void 0;
}
function hrefsMatch(a, b) {
  if (!a || !b) return false;
  const normalize = (h) => h.replace(/^https?:\/\//, "").replace(/localhost:\d+/, "").replace(/\/+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}
function buildNavigationMap(sourceElements, targetElements, config = DEFAULT_NAVIGATION_MAP_CONFIG) {
  const sourceNav = sourceElements.filter(isNavigationElement);
  const targetNav = targetElements.filter(isNavigationElement);
  const pairs = [];
  const matchedTargetIds = /* @__PURE__ */ new Set();
  for (const src of sourceNav) {
    const srcLabel = getNavLabel(src);
    const srcNorm = normalizeString(srcLabel);
    let bestTarget = null;
    let bestScore = 0;
    for (const tgt of targetNav) {
      if (matchedTargetIds.has(tgt.id)) continue;
      const tgtLabel = getNavLabel(tgt);
      const tgtNorm = normalizeString(tgtLabel);
      if (srcNorm === tgtNorm) {
        bestTarget = tgt;
        break;
      }
      const similarity = jaroWinklerSimilarity(srcNorm, tgtNorm);
      if (similarity > bestScore && similarity >= config.labelMatchThreshold) {
        bestScore = similarity;
        bestTarget = tgt;
      }
    }
    if (bestTarget) {
      matchedTargetIds.add(bestTarget.id);
      const srcHref = getHref(src);
      const tgtHref = getHref(bestTarget);
      pairs.push({
        sourceId: src.id,
        targetId: bestTarget.id,
        label: srcLabel,
        sourceHref: srcHref,
        targetHref: tgtHref,
        destinationMatch: hrefsMatch(srcHref, tgtHref)
      });
    }
  }
  const sourceOnly = sourceNav.filter((s) => !pairs.some((p) => p.sourceId === s.id)).map((s) => s.id);
  const targetOnly = targetNav.filter((t) => !matchedTargetIds.has(t.id)).map((t) => t.id);
  return { pairs, sourceOnly, targetOnly };
}

// src/ai/component-comparison.ts
var DEFAULT_COMPONENT_COMPARISON_CONFIG = {
  nameMatchThreshold: 0.75
};
function computeComponentMatchScore(source, target) {
  if (source.name.toLowerCase() === target.name.toLowerCase()) return 1;
  let score = 0;
  if (source.type === target.type) {
    score += 0.3;
  }
  const nameSimilarity = jaroWinklerSimilarity(
    normalizeString(source.name),
    normalizeString(target.name)
  );
  score += nameSimilarity * 0.7;
  return score;
}
function compareComponents(sourceComponents, targetComponents, config = DEFAULT_COMPONENT_COMPARISON_CONFIG) {
  const candidates = [];
  for (let si = 0; si < sourceComponents.length; si++) {
    for (let ti = 0; ti < targetComponents.length; ti++) {
      const score = computeComponentMatchScore(sourceComponents[si], targetComponents[ti]);
      if (score >= config.nameMatchThreshold) {
        candidates.push({ sourceIdx: si, targetIdx: ti, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedSource = /* @__PURE__ */ new Set();
  const usedTarget = /* @__PURE__ */ new Set();
  const matches = [];
  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);
    const src = sourceComponents[c.sourceIdx];
    const tgt = targetComponents[c.targetIdx];
    const srcKeys = new Set(src.stateKeys);
    const tgtKeys = new Set(tgt.stateKeys);
    const missingKeys = src.stateKeys.filter((k) => !tgtKeys.has(k));
    const extraKeys = tgt.stateKeys.filter((k) => !srcKeys.has(k));
    const srcActions = new Set(src.actions.map((a) => a.toLowerCase()));
    const tgtActions = new Set(tgt.actions.map((a) => a.toLowerCase()));
    const missingActions = src.actions.filter((a) => !tgtActions.has(a.toLowerCase()));
    const extraActions = tgt.actions.filter((a) => !srcActions.has(a.toLowerCase()));
    matches.push({
      source: src,
      target: tgt,
      confidence: Math.round(c.score * 100) / 100,
      stateKeyDiff: { missing: missingKeys, extra: extraKeys },
      actionDiff: { missing: missingActions, extra: extraActions }
    });
  }
  const sourceOnly = sourceComponents.filter((_, i) => !usedSource.has(i));
  const targetOnly = targetComponents.filter((_, i) => !usedTarget.has(i));
  return { matches, sourceOnly, targetOnly };
}

// src/ai/layout-comparison.ts
var DEFAULT_LAYOUT_COMPARISON_CONFIG = {
  gridTolerance: 20
};
function getRect(el) {
  const rect = el.state?.rect;
  if (!rect || !rect.width) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
function clusterValues(values, tolerance) {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - clusters[clusters.length - 1] > tolerance) {
      clusters.push(sorted[i]);
    }
  }
  return clusters;
}
function detectGridStructure(elements, config = DEFAULT_LAYOUT_COMPARISON_CONFIG) {
  const rects = elements.map(getRect).filter((r) => r !== null);
  const xPositions = rects.map((r) => r.x);
  const yPositions = rects.map((r) => r.y);
  const columns = clusterValues(xPositions, config.gridTolerance);
  const rows = clusterValues(yPositions, config.gridTolerance);
  return {
    columns,
    rows,
    columnCount: columns.length,
    rowCount: rows.length
  };
}
function computeMaxDepth(elements) {
  let maxDepth = 0;
  for (const el of elements) {
    const context = el.parentContext || "";
    const depth = context ? context.split(">").length : 1;
    maxDepth = Math.max(maxDepth, depth);
  }
  return maxDepth;
}
function compareLayouts(sourceElements, targetElements, sourceRegions, targetRegions, config = DEFAULT_LAYOUT_COMPARISON_CONFIG) {
  const sourceGrid = detectGridStructure(sourceElements, config);
  const targetGrid = detectGridStructure(targetElements, config);
  const gridDiff = {
    sourceGrid,
    targetGrid,
    columnDiff: sourceGrid.columnCount - targetGrid.columnCount,
    rowDiff: sourceGrid.rowCount - targetGrid.rowCount
  };
  const sourceDepth = computeMaxDepth(sourceElements);
  const targetDepth = computeMaxDepth(targetElements);
  const hierarchyDiff = {
    sourceDepth,
    targetDepth,
    depthDiff: sourceDepth - targetDepth
  };
  const sourceRegionCount = sourceRegions?.regions.length || 1;
  const targetRegionCount = targetRegions?.regions.length || 1;
  const sourceDensity = sourceElements.length / sourceRegionCount;
  const targetDensity = targetElements.length / targetRegionCount;
  const density = {
    sourceDensity: Math.round(sourceDensity * 100) / 100,
    targetDensity: Math.round(targetDensity * 100) / 100,
    ratio: targetDensity > 0 ? Math.round(sourceDensity / targetDensity * 100) / 100 : 0
  };
  const gridSimilarity = sourceGrid.columnCount === 0 && targetGrid.columnCount === 0 ? 1 : 1 - Math.abs(gridDiff.columnDiff) / Math.max(sourceGrid.columnCount, targetGrid.columnCount, 1);
  const hierarchySimilarity = sourceDepth === 0 && targetDepth === 0 ? 1 : 1 - Math.abs(hierarchyDiff.depthDiff) / Math.max(sourceDepth, targetDepth, 1);
  const densitySimilarity = density.ratio > 0 ? Math.min(density.ratio, 1 / density.ratio) : 0;
  const similarity = Math.round((gridSimilarity * 0.4 + hierarchySimilarity * 0.3 + densitySimilarity * 0.3) * 100) / 100;
  return {
    gridDiff,
    hierarchyDiff,
    density,
    similarity
  };
}

// src/ai/content-comparison.ts
var DEFAULT_CONTENT_COMPARISON_CONFIG = {
  labelMatchThreshold: 0.8,
  headingMatchThreshold: 0.75,
  maxCellDifferences: 50
};
function getElementText2(el) {
  return (el.accessibleName || el.labelText || el.label || el.state?.textContent || el.description || "").trim();
}
function getContentRole(el) {
  if (el.contentMetadata?.contentRole) {
    return el.contentMetadata.contentRole;
  }
  const t = (el.type || "").toLowerCase();
  if (t === "heading" || t.startsWith("h") && /^h[1-6]$/.test(t)) return "heading";
  if (t === "metric-value" || t === "metric") return "metric";
  if (t === "status-message" || t === "status") return "status";
  if (t === "label") return "label";
  if (t === "badge") return "badge";
  if (t === "table-cell") return "table-cell";
  if (t === "table-header") return "table-header";
  if (t === "caption") return "caption";
  return null;
}
function getHeadingLevel(el) {
  if (el.contentMetadata?.headingLevel) {
    return el.contentMetadata.headingLevel;
  }
  const tag = (el.tagName || el.type || "").toLowerCase();
  const match = /^h([1-6])$/.exec(tag);
  if (match) return parseInt(match[1], 10);
  return void 0;
}
function isContentElement2(el) {
  if (el.category === "content") return true;
  if (el.contentMetadata) return true;
  const role = getContentRole(el);
  return role !== null;
}
function normalizeText(text) {
  return normalizeString(text, { caseSensitive: false, ignoreWhitespace: true });
}
function parseMetricText(el) {
  const text = getElementText2(el);
  const colonMatch = text.match(/^(.+?):\s*(.+)$/);
  if (colonMatch) {
    return { label: colonMatch[1].trim(), value: colonMatch[2].trim() };
  }
  const dashMatch = text.match(/^(.+?)\s*[-]\s*(.+)$/);
  if (dashMatch) {
    return { label: dashMatch[1].trim(), value: dashMatch[2].trim() };
  }
  const elLabel = el.accessibleName || el.labelText || el.label || el.id;
  return { label: elLabel, value: text };
}
function filterHeadings(elements) {
  return elements.filter((el) => getContentRole(el) === "heading");
}
function filterMetrics(elements) {
  return elements.filter((el) => getContentRole(el) === "metric");
}
function filterStatuses(elements) {
  return elements.filter((el) => {
    const role = getContentRole(el);
    return role === "status" || role === "badge";
  });
}
function filterLabels(elements) {
  return elements.filter((el) => {
    const role = getContentRole(el);
    return role === "label" || role === "caption";
  });
}
function matchTexts(sourceTexts, targetTexts, threshold) {
  const candidates = [];
  for (let si = 0; si < sourceTexts.length; si++) {
    const sNorm = normalizeText(sourceTexts[si]);
    if (!sNorm) continue;
    for (let ti = 0; ti < targetTexts.length; ti++) {
      const tNorm = normalizeText(targetTexts[ti]);
      if (!tNorm) continue;
      const score = sNorm === tNorm ? 1 : jaroWinklerSimilarity(sNorm, tNorm);
      if (score >= threshold) {
        candidates.push({ sourceIdx: si, targetIdx: ti, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedSource = /* @__PURE__ */ new Set();
  const usedTarget = /* @__PURE__ */ new Set();
  const matched = [];
  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);
    matched.push(c);
  }
  const unmatchedSource = sourceTexts.map((_, i) => i).filter((i) => !usedSource.has(i));
  const unmatchedTarget = targetTexts.map((_, i) => i).filter((i) => !usedTarget.has(i));
  return { matched, unmatchedSource, unmatchedTarget };
}
function compareHeadings(sourceElements, targetElements, config) {
  const srcHeadings = filterHeadings(sourceElements);
  const tgtHeadings = filterHeadings(targetElements);
  const srcTexts = srcHeadings.map(getElementText2);
  const tgtTexts = tgtHeadings.map(getElementText2);
  const { matched, unmatchedSource, unmatchedTarget } = matchTexts(
    srcTexts,
    tgtTexts,
    config.headingMatchThreshold
  );
  const headingMatched = [];
  const headingChanged = [];
  for (const m of matched) {
    const srcText = srcTexts[m.sourceIdx];
    const tgtText = tgtTexts[m.targetIdx];
    const srcLevel = getHeadingLevel(srcHeadings[m.sourceIdx]);
    const tgtLevel = getHeadingLevel(tgtHeadings[m.targetIdx]);
    if (normalizeText(srcText) === normalizeText(tgtText)) {
      headingMatched.push({
        source: srcText,
        target: tgtText,
        level: srcLevel
      });
    } else {
      headingChanged.push({
        source: srcText,
        target: tgtText,
        level: srcLevel ?? tgtLevel
      });
    }
  }
  return {
    matched: headingMatched,
    sourceOnly: unmatchedSource.map((i) => srcTexts[i]),
    targetOnly: unmatchedTarget.map((i) => tgtTexts[i]),
    changed: headingChanged
  };
}
function compareMetrics(sourceElements, targetElements, config) {
  const srcMetrics = filterMetrics(sourceElements);
  const tgtMetrics = filterMetrics(targetElements);
  const srcParsed = srcMetrics.map(parseMetricText);
  const tgtParsed = tgtMetrics.map(parseMetricText);
  const srcLabels = srcParsed.map((p) => p.label);
  const tgtLabels = tgtParsed.map((p) => p.label);
  const { matched, unmatchedSource, unmatchedTarget } = matchTexts(
    srcLabels,
    tgtLabels,
    config.labelMatchThreshold
  );
  const metricMatched = [];
  const metricChanged = [];
  for (const m of matched) {
    const src = srcParsed[m.sourceIdx];
    const tgt = tgtParsed[m.targetIdx];
    if (normalizeText(src.value) === normalizeText(tgt.value)) {
      metricMatched.push({
        label: src.label,
        sourceValue: src.value,
        targetValue: tgt.value
      });
    } else {
      metricChanged.push({
        label: src.label,
        sourceValue: src.value,
        targetValue: tgt.value
      });
    }
  }
  return {
    matched: metricMatched,
    changed: metricChanged,
    sourceOnly: unmatchedSource.map((i) => srcParsed[i].label),
    targetOnly: unmatchedTarget.map((i) => tgtParsed[i].label)
  };
}
function compareStatuses(sourceElements, targetElements, config) {
  const srcStatuses = filterStatuses(sourceElements);
  const tgtStatuses = filterStatuses(targetElements);
  const srcParsed = srcStatuses.map(parseMetricText);
  const tgtParsed = tgtStatuses.map(parseMetricText);
  const srcLabels = srcParsed.map((p) => p.label);
  const tgtLabels = tgtParsed.map((p) => p.label);
  const { matched } = matchTexts(srcLabels, tgtLabels, config.labelMatchThreshold);
  const statusMatched = [];
  const statusChanged = [];
  for (const m of matched) {
    const src = srcParsed[m.sourceIdx];
    const tgt = tgtParsed[m.targetIdx];
    if (normalizeText(src.value) === normalizeText(tgt.value)) {
      statusMatched.push({
        label: src.label,
        sourceStatus: src.value,
        targetStatus: tgt.value
      });
    } else {
      statusChanged.push({
        label: src.label,
        sourceStatus: src.value,
        targetStatus: tgt.value
      });
    }
  }
  return {
    matched: statusMatched,
    changed: statusChanged
  };
}
function compareLabels(sourceElements, targetElements, config) {
  const srcLabels = filterLabels(sourceElements);
  const tgtLabels = filterLabels(targetElements);
  const srcTexts = srcLabels.map(getElementText2);
  const tgtTexts = tgtLabels.map(getElementText2);
  const { matched, unmatchedSource, unmatchedTarget } = matchTexts(
    srcTexts,
    tgtTexts,
    config.labelMatchThreshold
  );
  return {
    matched: matched.map((m) => srcTexts[m.sourceIdx]),
    sourceOnly: unmatchedSource.map((i) => srcTexts[i]),
    targetOnly: unmatchedTarget.map((i) => tgtTexts[i])
  };
}
function compareTables(sourceElements, targetElements, config) {
  const srcData = extractStructuredData(sourceElements);
  const tgtData = extractStructuredData(targetElements);
  const srcTables = srcData.tables;
  const tgtTables = tgtData.tables;
  if (srcTables.length === 0 || tgtTables.length === 0) {
    return [];
  }
  const srcTableLabels = srcTables.map((t) => t.label || "");
  const tgtTableLabels = tgtTables.map((t) => t.label || "");
  const { matched } = matchTexts(srcTableLabels, tgtTableLabels, config.labelMatchThreshold);
  const tablePairs = [];
  if (matched.length > 0) {
    for (const m of matched) {
      tablePairs.push({ srcIdx: m.sourceIdx, tgtIdx: m.targetIdx });
    }
  } else if (srcTables.length === 1 && tgtTables.length === 1) {
    tablePairs.push({ srcIdx: 0, tgtIdx: 0 });
  }
  const comparisons = [];
  for (const pair of tablePairs) {
    const srcTable = srcTables[pair.srcIdx];
    const tgtTable = tgtTables[pair.tgtIdx];
    const srcHeaders = srcTable.columns.map((c) => c.header);
    const tgtHeaders = tgtTable.columns.map((c) => c.header);
    const srcHeaderSet = new Set(srcHeaders.map(normalizeText));
    const tgtHeaderSet = new Set(tgtHeaders.map(normalizeText));
    const sourceOnlyColumns = srcHeaders.filter((h) => !tgtHeaderSet.has(normalizeText(h)));
    const targetOnlyColumns = tgtHeaders.filter((h) => !srcHeaderSet.has(normalizeText(h)));
    const columnsMatch = sourceOnlyColumns.length === 0 && targetOnlyColumns.length === 0;
    const cellDifferences = [];
    const commonHeaders = srcHeaders.filter((h) => tgtHeaderSet.has(normalizeText(h)));
    const minRows = Math.min(srcTable.rows.length, tgtTable.rows.length);
    for (let row = 0; row < minRows; row++) {
      if (cellDifferences.length >= config.maxCellDifferences) break;
      for (const header of commonHeaders) {
        const srcColIdx = srcHeaders.indexOf(header);
        const tgtColIdx = tgtHeaders.findIndex((h) => normalizeText(h) === normalizeText(header));
        if (srcColIdx < 0 || tgtColIdx < 0) continue;
        const srcValue = srcTable.rows[row]?.[srcColIdx] ?? "";
        const tgtValue = tgtTable.rows[row]?.[tgtColIdx] ?? "";
        if (normalizeText(srcValue) !== normalizeText(tgtValue)) {
          cellDifferences.push({
            row,
            column: header,
            sourceValue: srcValue,
            targetValue: tgtValue
          });
        }
      }
    }
    comparisons.push({
      sourceLabel: srcTable.label,
      targetLabel: tgtTable.label,
      columnsMatch,
      sourceOnlyColumns,
      targetOnlyColumns,
      sourceRowCount: srcTable.rows.length,
      targetRowCount: tgtTable.rows.length,
      cellDifferences
    });
  }
  return comparisons;
}
function compareHeadingHierarchy(sourceElements, targetElements) {
  const srcHeadings = filterHeadings(sourceElements);
  const tgtHeadings = filterHeadings(targetElements);
  const srcByLevel = /* @__PURE__ */ new Map();
  const tgtByLevel = /* @__PURE__ */ new Map();
  for (const el of srcHeadings) {
    const level = getHeadingLevel(el) ?? 0;
    srcByLevel.set(level, (srcByLevel.get(level) ?? 0) + 1);
  }
  for (const el of tgtHeadings) {
    const level = getHeadingLevel(el) ?? 0;
    tgtByLevel.set(level, (tgtByLevel.get(level) ?? 0) + 1);
  }
  const allLevels = /* @__PURE__ */ new Set([...srcByLevel.keys(), ...tgtByLevel.keys()]);
  const result = [];
  for (const level of [...allLevels].sort()) {
    result.push({
      level,
      sourceCount: srcByLevel.get(level) ?? 0,
      targetCount: tgtByLevel.get(level) ?? 0
    });
  }
  return result;
}
function compareContent(sourceElements, targetElements, config = DEFAULT_CONTENT_COMPARISON_CONFIG) {
  const srcContent = sourceElements.filter(isContentElement2);
  const tgtContent = targetElements.filter(isContentElement2);
  const headings = compareHeadings(srcContent, tgtContent, config);
  const metrics = compareMetrics(srcContent, tgtContent, config);
  const statuses = compareStatuses(srcContent, tgtContent, config);
  const labels = compareLabels(srcContent, tgtContent, config);
  const tables = compareTables(sourceElements, targetElements, config);
  const headingHierarchy2 = compareHeadingHierarchy(srcContent, tgtContent);
  const contentParity = calculateContentParity(headings, metrics, statuses, labels, tables);
  return {
    headings,
    metrics,
    statuses,
    labels,
    tables,
    headingHierarchy: headingHierarchy2,
    contentParity
  };
}
function calculateContentParity(headings, metrics, statuses, labels, tables) {
  const scores = [];
  const totalHeadings = headings.matched.length + headings.changed.length + headings.sourceOnly.length + headings.targetOnly.length;
  if (totalHeadings > 0) {
    scores.push(headings.matched.length / totalHeadings);
  }
  const totalMetrics = metrics.matched.length + metrics.changed.length + metrics.sourceOnly.length + metrics.targetOnly.length;
  if (totalMetrics > 0) {
    const metricScore = (metrics.matched.length + metrics.changed.length * 0.5) / totalMetrics;
    scores.push(metricScore);
  }
  const totalStatuses = statuses.matched.length + statuses.changed.length;
  if (totalStatuses > 0) {
    scores.push(statuses.matched.length / totalStatuses);
  }
  const totalLabels = labels.matched.length + labels.sourceOnly.length + labels.targetOnly.length;
  if (totalLabels > 0) {
    scores.push(labels.matched.length / totalLabels);
  }
  if (tables.length > 0) {
    let tableScore = 0;
    for (const table of tables) {
      let tScore = table.columnsMatch ? 0.5 : 0;
      if (table.sourceRowCount > 0) {
        const rowRatio = Math.min(
          table.targetRowCount / table.sourceRowCount,
          table.sourceRowCount / table.targetRowCount
        );
        tScore += rowRatio * 0.3;
      } else {
        tScore += 0.3;
      }
      const totalCells = Math.max(table.sourceRowCount, 1) * Math.max(
        table.sourceOnlyColumns.length + table.targetOnlyColumns.length + (table.columnsMatch ? 1 : 0),
        1
      );
      const diffRatio = totalCells > 0 ? 1 - Math.min(table.cellDifferences.length / totalCells, 1) : 1;
      tScore += diffRatio * 0.2;
      tableScore += tScore;
    }
    scores.push(tableScore / tables.length);
  }
  if (scores.length === 0) return 1;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100;
}

// src/ai/comparison-report.ts
var DEFAULT_COMPARISON_REPORT_CONFIG = {
  includeComponents: false
};
function generateComparisonReport(source, target, options) {
  const startTime = Date.now();
  const config = { ...DEFAULT_COMPARISON_REPORT_CONFIG, ...options?.config };
  const srcElements = source.elements;
  const tgtElements = target.elements;
  const diff = computeCrossAppDiff(srcElements, tgtElements);
  const navigation = buildNavigationMap(srcElements, tgtElements);
  const sourceRegions = segmentPageRegions(srcElements);
  const targetRegions = segmentPageRegions(tgtElements);
  const layout = compareLayouts(srcElements, tgtElements, sourceRegions, targetRegions);
  const actionParityResults = analyzeActionParity(diff.matchedPairs, srcElements, tgtElements);
  const componentComparison = config.includeComponents && options?.sourceComponents && options?.targetComponents ? compareComponents(options.sourceComponents, options.targetComponents) : null;
  const contentComparison = compareContent(srcElements, tgtElements);
  const sourceData = extractPageData(srcElements);
  extractPageData(tgtElements);
  const sourceFieldCount = Object.keys(sourceData.values).length;
  const matchedDataCount = diff.dataComparisons.length;
  const dataCompleteness = sourceFieldCount > 0 ? Math.round(matchedDataCount / sourceFieldCount * 100) / 100 : 1;
  const formatMatchCount = diff.dataComparisons.filter((c) => c.formatsMatch).length;
  const formatAlignment = matchedDataCount > 0 ? Math.round(formatMatchCount / matchedDataCount * 100) / 100 : 1;
  const presentationAlignment = layout.similarity;
  const totalNavItems = navigation.pairs.length + navigation.sourceOnly.length;
  const navigationParity = totalNavItems > 0 ? Math.round(navigation.pairs.length / totalNavItems * 100) / 100 : 1;
  const totalActionChecks = actionParityResults.length;
  const fullParityCount = actionParityResults.filter((r) => r.missingInTarget.length === 0).length;
  const actionParity = totalActionChecks > 0 ? Math.round(fullParityCount / totalActionChecks * 100) / 100 : 1;
  const contentParity = contentComparison.contentParity;
  const overallScore = Math.round(
    (dataCompleteness * 0.2 + formatAlignment * 0.1 + presentationAlignment * 0.15 + navigationParity * 0.15 + actionParity * 0.15 + contentParity * 0.25) * 100
  ) / 100;
  const issues = [];
  for (const srcId of diff.unmatchedSourceIds) {
    const srcVal = Object.values(sourceData.values).find((v) => v.elementId === srcId);
    if (srcVal) {
      issues.push({
        severity: "warning",
        category: "missing-data",
        description: `Data field "${srcVal.label}" (${srcVal.dataType}) exists in source but has no match in target`,
        sourceElementId: srcId
      });
    }
  }
  for (const comp of diff.dataComparisons) {
    if (!comp.valuesMatch) {
      issues.push({
        severity: "error",
        category: "value-mismatch",
        description: `Value mismatch for "${comp.label}": source="${comp.sourceValue}", target="${comp.targetValue}"`
      });
    }
  }
  for (const fm of diff.formatMismatches) {
    issues.push({
      severity: fm.severity,
      category: "format-mismatch",
      description: fm.description
    });
  }
  for (const ap of actionParityResults) {
    for (const action of ap.missingInTarget) {
      issues.push({
        severity: "warning",
        category: "missing-action",
        description: `Action "${action}" available on source element "${ap.pair.sourceLabel}" is missing in target`,
        sourceElementId: ap.pair.sourceId,
        targetElementId: ap.pair.targetId
      });
    }
  }
  for (const srcId of navigation.sourceOnly) {
    issues.push({
      severity: "warning",
      category: "navigation-gap",
      description: `Navigation item "${srcId}" in source has no match in target`,
      sourceElementId: srcId
    });
  }
  if (layout.similarity < 0.5) {
    issues.push({
      severity: "warning",
      category: "layout-difference",
      description: `Layout similarity is low (${layout.similarity}). Grid: ${layout.gridDiff.sourceGrid.columnCount} cols vs ${layout.gridDiff.targetGrid.columnCount} cols`
    });
  }
  if (componentComparison) {
    for (const src of componentComparison.sourceOnly) {
      issues.push({
        severity: "info",
        category: "component-mismatch",
        description: `Component "${src.name}" (${src.type}) exists in source but not target`
      });
    }
    for (const match of componentComparison.matches) {
      if (match.stateKeyDiff.missing.length > 0) {
        issues.push({
          severity: "warning",
          category: "component-mismatch",
          description: `Component "${match.source.name}": state keys missing in target: ${match.stateKeyDiff.missing.join(", ")}`
        });
      }
    }
  }
  for (const heading of contentComparison.headings.sourceOnly) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Heading "${heading}" exists in source but not in target`
    });
  }
  for (const heading of contentComparison.headings.targetOnly) {
    issues.push({
      severity: "info",
      category: "content-difference",
      description: `Heading "${heading}" exists in target but not in source`
    });
  }
  for (const change of contentComparison.headings.changed) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Heading changed: "${change.source}" -> "${change.target}"`
    });
  }
  for (const change of contentComparison.metrics.changed) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Metric "${change.label}" value differs: "${change.sourceValue}" vs "${change.targetValue}"`
    });
  }
  for (const label of contentComparison.metrics.sourceOnly) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Metric "${label}" exists in source but not in target`
    });
  }
  for (const change of contentComparison.statuses.changed) {
    issues.push({
      severity: "warning",
      category: "content-difference",
      description: `Status "${change.label}" differs: "${change.sourceStatus}" vs "${change.targetStatus}"`
    });
  }
  for (const table of contentComparison.tables) {
    if (!table.columnsMatch) {
      issues.push({
        severity: "warning",
        category: "content-difference",
        description: `Table "${table.sourceLabel}" column mismatch: source-only=[${table.sourceOnlyColumns.join(", ")}], target-only=[${table.targetOnlyColumns.join(", ")}]`
      });
    }
    if (table.sourceRowCount !== table.targetRowCount) {
      issues.push({
        severity: "info",
        category: "content-difference",
        description: `Table "${table.sourceLabel}" row count differs: ${table.sourceRowCount} vs ${table.targetRowCount}`
      });
    }
    if (table.cellDifferences.length > 0) {
      issues.push({
        severity: "warning",
        category: "content-difference",
        description: `Table "${table.sourceLabel}" has ${table.cellDifferences.length} cell value difference(s)`
      });
    }
  }
  const severityOrder = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;
  const summaryLines = [
    `Cross-app comparison: ${source.page.url} vs ${target.page.url}`,
    `Overall score: ${(overallScore * 100).toFixed(0)}%`,
    `Matched elements: ${diff.matchedPairs.length}`,
    `Unmatched: ${diff.unmatchedSourceIds.length} source, ${diff.unmatchedTargetIds.length} target`,
    `Navigation: ${navigation.pairs.length} matched, ${navigation.sourceOnly.length} source-only, ${navigation.targetOnly.length} target-only`
  ];
  if (componentComparison) {
    summaryLines.push(
      `Components: ${componentComparison.matches.length} matched, ${componentComparison.sourceOnly.length} source-only, ${componentComparison.targetOnly.length} target-only`
    );
  }
  const hMatched = contentComparison.headings.matched.length;
  const hChanged = contentComparison.headings.changed.length;
  const hSrcOnly = contentComparison.headings.sourceOnly.length;
  const hTgtOnly = contentComparison.headings.targetOnly.length;
  const mMatched = contentComparison.metrics.matched.length;
  const mChanged = contentComparison.metrics.changed.length;
  const sMatched = contentComparison.statuses.matched.length;
  const sChanged = contentComparison.statuses.changed.length;
  const totalContent = hMatched + hChanged + hSrcOnly + hTgtOnly + mMatched + mChanged + sMatched + sChanged;
  if (totalContent > 0) {
    summaryLines.push(
      `Content: headings=${hMatched} matched/${hChanged} changed/${hSrcOnly + hTgtOnly} unmatched, metrics=${mMatched} matched/${mChanged} changed, statuses=${sMatched} matched/${sChanged} changed, parity=${(contentParity * 100).toFixed(0)}%`
    );
  }
  summaryLines.push(`Issues: ${errorCount} errors, ${warningCount} warnings, ${infoCount} info`);
  const summary = summaryLines.join("\n");
  const report = {
    sourceUrl: source.page.url,
    targetUrl: target.page.url,
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
    scores: {
      dataCompleteness,
      formatAlignment,
      presentationAlignment,
      navigationParity,
      actionParity,
      overallScore
    },
    diff,
    navigation,
    layout,
    contentComparison,
    issues,
    summary
  };
  if (componentComparison) {
    report.components = componentComparison;
  }
  return report;
}

// src/ai/design-inspector.ts
var DESIGN_PROPERTIES = [
  // Layout
  "display",
  "position",
  "boxSizing",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "overflow",
  "overflowX",
  "overflowY",
  // Flex/Grid
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "alignSelf",
  "gap",
  "gridTemplateColumns",
  "gridTemplateRows",
  // Typography
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textDecoration",
  "color",
  // Visual
  "backgroundColor",
  "backgroundImage",
  "border",
  "borderRadius",
  "boxShadow",
  "opacity",
  "outline",
  // Effects
  "transform",
  "transition",
  "cursor",
  "zIndex",
  "visibility",
  "pointerEvents"
];
var INTERACTION_STATES = ["hover", "focus", "active", "disabled"];
var DEFAULT_VIEWPORTS = {
  mobile: 375,
  tablet: 768,
  desktop: 1280,
  wide: 1920
};
function getExtendedComputedStyles(el) {
  const computed = window.getComputedStyle(el);
  const styles = {};
  for (const prop of DESIGN_PROPERTIES) {
    styles[prop] = computed.getPropertyValue(camelToKebab(prop)) || computed[prop] || "";
  }
  return styles;
}
function getElementDesignData(el, opts) {
  const rect = el.getBoundingClientRect();
  const styles = getExtendedComputedStyles(el);
  const pseudoElements = [];
  if (opts?.includePseudoElements) {
    for (const selector of ["::before", "::after"]) {
      const pseudo = getPseudoElementStyles(el, selector);
      if (pseudo) {
        pseudoElements.push(pseudo);
      }
    }
  }
  const customProperties = getCSSCustomProperties(el);
  return {
    elementId: opts?.elementId || el.id || el.getAttribute("data-testid") || "",
    label: opts?.label,
    type: opts?.type || el.tagName.toLowerCase(),
    styles,
    pseudoElements: pseudoElements.length > 0 ? pseudoElements : void 0,
    customProperties: Object.keys(customProperties).length > 0 ? customProperties : void 0,
    className: classString(el) || void 0,
    classes: el.classList.length > 0 ? Array.from(el.classList) : void 0,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }
  };
}
async function captureStateVariations(el, states) {
  const targetStates = states || INTERACTION_STATES;
  const defaultStyles = getExtendedComputedStyles(el);
  const results = [];
  results.push({
    state: "default",
    styles: defaultStyles,
    diffFromDefault: []
  });
  for (const stateName of targetStates) {
    if (stateName === "default") continue;
    try {
      applyInteractionState(el, stateName);
      await waitFrame();
      const stateStyles = getExtendedComputedStyles(el);
      const diff = computeStyleDiff(defaultStyles, stateStyles);
      results.push({
        state: stateName,
        styles: stateStyles,
        diffFromDefault: diff
      });
    } finally {
      restoreInteractionState(el, stateName);
      await waitFrame();
    }
  }
  return results;
}
async function captureResponsiveSnapshots(registry, viewports) {
  const viewportEntries = Array.isArray(viewports) ? viewports.map((w) => [`${w}px`, w]) : Object.entries(viewports);
  const docEl = document.documentElement;
  const originalWidth = docEl.style.width;
  const originalMinWidth = docEl.style.minWidth;
  const originalMaxWidth = docEl.style.maxWidth;
  const originalOverflow = docEl.style.overflow;
  const snapshots = [];
  try {
    for (const [label, width] of viewportEntries) {
      docEl.style.width = `${width}px`;
      docEl.style.minWidth = `${width}px`;
      docEl.style.maxWidth = `${width}px`;
      docEl.style.overflow = "hidden";
      void docEl.offsetHeight;
      await waitFrame();
      const elements = registry.getAllElements();
      const elementData = elements.map(
        (regEl) => getElementDesignData(regEl.element, {
          elementId: regEl.id,
          label: regEl.label,
          type: regEl.type
        })
      );
      snapshots.push({
        viewportWidth: width,
        viewportLabel: label,
        elements: elementData,
        timestamp: Date.now()
      });
    }
  } finally {
    docEl.style.width = originalWidth;
    docEl.style.minWidth = originalMinWidth;
    docEl.style.maxWidth = originalMaxWidth;
    docEl.style.overflow = originalOverflow;
  }
  return snapshots;
}
function getCSSCustomProperties(el) {
  const result = {};
  const computed = window.getComputedStyle(el);
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i];
    if (prop.startsWith("--")) {
      result[prop] = computed.getPropertyValue(prop).trim();
    }
  }
  try {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        try {
          if (!el.matches(rule.selectorText)) continue;
        } catch {
          continue;
        }
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          if (prop.startsWith("--")) {
            result[prop] = computed.getPropertyValue(prop).trim();
          }
        }
      }
    }
  } catch {
  }
  return result;
}
function camelToKebab(str) {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}
function getPseudoElementStyles(el, selector) {
  let computed;
  try {
    computed = window.getComputedStyle(el, selector);
  } catch {
    return null;
  }
  const content = computed.getPropertyValue("content");
  if (!content || content === "none" || content === "normal") {
    return null;
  }
  const styles = {};
  for (const prop of DESIGN_PROPERTIES) {
    const val = computed.getPropertyValue(camelToKebab(prop)) || computed[prop] || "";
    if (val) {
      styles[prop] = val;
    }
  }
  return { selector, content, styles };
}
function computeStyleDiff(defaultStyles, stateStyles) {
  const diffs = [];
  for (const prop of DESIGN_PROPERTIES) {
    if (defaultStyles[prop] !== stateStyles[prop]) {
      diffs.push({
        property: prop,
        defaultValue: defaultStyles[prop],
        stateValue: stateStyles[prop]
      });
    }
  }
  return diffs;
}
function applyInteractionState(el, state) {
  switch (state) {
    case "hover":
      el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      break;
    case "focus":
      el.focus();
      el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      break;
    case "active":
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      break;
    case "disabled":
      el.disabled = true;
      break;
  }
}
function restoreInteractionState(el, state) {
  switch (state) {
    case "hover":
      el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      break;
    case "focus":
      el.blur();
      el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      break;
    case "active":
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      break;
    case "disabled":
      el.disabled = false;
      break;
  }
}
function waitFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// src/specs/style-validator.ts
function resolveTokenValue(tokenPath, tokens) {
  const parts = tokenPath.split(".");
  let current = tokens;
  for (const part of parts) {
    if (current === null || current === void 0 || typeof current !== "object") {
      return null;
    }
    current = current[part];
  }
  if (typeof current === "string") {
    return current;
  }
  if (typeof current === "number") {
    return String(current);
  }
  return null;
}
function evaluateConstraint(constraint, styles, tokens, customProperties) {
  const isCustomProp = constraint.property.startsWith("--");
  const actualValue = isCustomProp ? customProperties?.[constraint.property] ?? "" : styles[constraint.property] || "";
  switch (constraint.type) {
    case "exact": {
      const passed = normalizeStyleValue(actualValue) === normalizeStyleValue(constraint.value);
      return {
        passed,
        constraint,
        actualValue,
        expectedValue: constraint.value,
        message: passed ? void 0 : `Expected ${constraint.property} to be "${constraint.value}", got "${actualValue}"`
      };
    }
    case "oneOf": {
      const normalizedActual = normalizeStyleValue(actualValue);
      const passed = constraint.values.some((v) => normalizeStyleValue(v) === normalizedActual);
      return {
        passed,
        constraint,
        actualValue,
        expectedValue: `one of [${constraint.values.join(", ")}]`,
        message: passed ? void 0 : `Expected ${constraint.property} to be one of [${constraint.values.join(", ")}], got "${actualValue}"`
      };
    }
    case "tokenRef": {
      const tokenValue = resolveTokenValue(constraint.tokenPath, tokens);
      if (tokenValue === null) {
        return {
          passed: false,
          constraint,
          actualValue,
          expectedValue: `token(${constraint.tokenPath})`,
          message: `Token "${constraint.tokenPath}" not found in design tokens`
        };
      }
      const passed = normalizeStyleValue(actualValue) === normalizeStyleValue(tokenValue);
      return {
        passed,
        constraint,
        actualValue,
        expectedValue: `${tokenValue} (token: ${constraint.tokenPath})`,
        message: passed ? void 0 : `Expected ${constraint.property} to match token "${constraint.tokenPath}" (${tokenValue}), got "${actualValue}"`
      };
    }
    case "range": {
      const numericValue = parseFloat(actualValue);
      if (isNaN(numericValue)) {
        return {
          passed: false,
          constraint,
          actualValue,
          expectedValue: `${constraint.min ?? "\u221E"} - ${constraint.max ?? "\u221E"}${constraint.unit || ""}`,
          message: `Cannot parse "${actualValue}" as a number for range check on ${constraint.property}`
        };
      }
      const aboveMin = constraint.min === void 0 || numericValue >= constraint.min;
      const belowMax = constraint.max === void 0 || numericValue <= constraint.max;
      const passed = aboveMin && belowMax;
      return {
        passed,
        constraint,
        actualValue,
        expectedValue: `${constraint.min ?? "\u221E"} - ${constraint.max ?? "\u221E"}${constraint.unit || ""}`,
        message: passed ? void 0 : `Expected ${constraint.property} to be in range [${constraint.min ?? "\u221E"}, ${constraint.max ?? "\u221E"}], got ${numericValue}`
      };
    }
    case "responsive": {
      const firstBreakpoint = Object.keys(constraint.breakpoints)[0];
      const expectedVal = constraint.breakpoints[firstBreakpoint];
      if (typeof expectedVal === "string") {
        const passed = normalizeStyleValue(actualValue) === normalizeStyleValue(expectedVal);
        return {
          passed,
          constraint,
          actualValue,
          expectedValue: `${expectedVal} (at ${firstBreakpoint})`,
          message: passed ? void 0 : `Expected ${constraint.property} to be "${expectedVal}" at ${firstBreakpoint}, got "${actualValue}"`
        };
      }
      return evaluateConstraint(expectedVal, styles, tokens, customProperties);
    }
  }
}
function ruleMatchesElement(rule, elementData) {
  if (rule.elementType && elementData.type !== rule.elementType) {
    return false;
  }
  if (rule.selector) {
    const id = elementData.elementId.toLowerCase();
    const sel = rule.selector.toLowerCase();
    if (sel.startsWith(".")) {
      const targetClass = sel.slice(1);
      if (elementData.classes) {
        return elementData.classes.some((c) => c.toLowerCase() === targetClass);
      }
      return id.includes(targetClass);
    }
    if (sel.startsWith("#") && id !== sel.slice(1)) {
      return false;
    }
    if (!sel.startsWith(".") && !sel.startsWith("#") && elementData.type !== sel) {
      return false;
    }
  }
  return true;
}
function validateElement(data, rules, tokens) {
  const results = [];
  for (const rule of rules) {
    if (!ruleMatchesElement(rule, data)) continue;
    const constraintResults = [];
    let allPassed = true;
    for (const constraint of rule.constraints) {
      const result = evaluateConstraint(constraint, data.styles, tokens, data.customProperties);
      constraintResults.push(result);
      if (!result.passed) allPassed = false;
    }
    results.push({
      elementId: data.elementId,
      ruleId: rule.id,
      passed: allPassed,
      constraintResults,
      severity: rule.severity || "warning"
    });
  }
  return results;
}
function runStyleAudit(elements, guide) {
  const startTime = Date.now();
  const allResults = [];
  for (const element of elements) {
    const results = validateElement(element, guide.rules, guide.tokens);
    allResults.push(...results);
  }
  const passedCount = allResults.filter((r) => r.passed).length;
  const failedCount = allResults.filter((r) => !r.passed).length;
  return {
    guideName: guide.name,
    totalElements: elements.length,
    totalRules: guide.rules.length,
    passedCount,
    failedCount,
    results: allResults,
    summary: {
      errors: allResults.filter((r) => !r.passed && r.severity === "error"),
      warnings: allResults.filter((r) => !r.passed && r.severity === "warning"),
      info: allResults.filter((r) => !r.passed && r.severity === "info")
    },
    timestamp: Date.now(),
    durationMs: Date.now() - startTime
  };
}
function normalizeStyleValue(value) {
  return value.trim().toLowerCase();
}

// src/specs/color-utils.ts
var NAMED_COLORS = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  aqua: "#00ffff",
  teal: "#008080",
  navy: "#000080",
  fuchsia: "#ff00ff",
  purple: "#800080",
  orange: "#ffa500",
  transparent: "#00000000"
};
function parseColor(str) {
  if (!str || typeof str !== "string") return null;
  const trimmed = str.trim().toLowerCase();
  if (!trimmed || trimmed === "none" || trimmed === "initial" || trimmed === "inherit") return null;
  if (NAMED_COLORS[trimmed]) {
    return parseColor(NAMED_COLORS[trimmed]);
  }
  if (trimmed.startsWith("#")) {
    return parseHex(trimmed);
  }
  if (trimmed.startsWith("rgb")) {
    return parseRgbFunction(trimmed);
  }
  return null;
}
function parseHex(hex) {
  const h = hex.slice(1);
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: 1
    };
  }
  if (h.length === 4) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: parseInt(h[3] + h[3], 16) / 255
    };
  }
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1
    };
  }
  if (h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: parseInt(h.slice(6, 8), 16) / 255
    };
  }
  return null;
}
function parseRgbFunction(str) {
  const match = str.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)[,%\s]+(\d+(?:\.\d+)?)[,%\s]+(\d+(?:\.\d+)?)(?:[,/\s]+(\d+(?:\.\d+)?%?))?\s*\)/
  );
  if (!match) return null;
  const r = Math.min(255, Math.max(0, Math.round(parseFloat(match[1]))));
  const g = Math.min(255, Math.max(0, Math.round(parseFloat(match[2]))));
  const b = Math.min(255, Math.max(0, Math.round(parseFloat(match[3]))));
  let a = 1;
  if (match[4] !== void 0) {
    const aStr = match[4];
    a = aStr.endsWith("%") ? parseFloat(aStr) / 100 : parseFloat(aStr);
    a = Math.min(1, Math.max(0, a));
  }
  return { r, g, b, a };
}
function rgbToHsl(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) {
    return { h: 0, s: 0, l: l * 100 };
  }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function linearize(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relativeLuminance(color) {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}
function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
function colorDistance(c1, c2) {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}
function clusterColors(colors, threshold = 25) {
  if (colors.length === 0) return [];
  const parent = colors.map((_, i) => i);
  function find2(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find2(a);
    const rb = find2(b);
    if (ra !== rb) parent[ra] = rb;
  }
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      if (colorDistance(colors[i], colors[j]) < threshold) {
        union(i, j);
      }
    }
  }
  const clusters = /* @__PURE__ */ new Map();
  for (let i = 0; i < colors.length; i++) {
    const root = find2(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(colors[i]);
  }
  return Array.from(clusters.values());
}
function isGrayscale(color, threshold = 5) {
  const hsl = rgbToHsl(color);
  return hsl.s < threshold;
}
function hueDistance(h1, h2) {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d);
}

// src/specs/quality-metrics.ts
function parsePx(value) {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}
function coefficientOfVariation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function elementArea(el) {
  return el.rect.width * el.rect.height;
}
function isInteractive(el) {
  const t = el.type.toLowerCase();
  return t === "button" || t === "input" || t === "select" || t === "textarea" || t === "link" || t === "a" || t === "checkbox" || t === "radio" || t === "switch" || t === "pressable" || t === "touchable";
}
function makeResult(metricId, label, category, score, findings, rawData) {
  return {
    metricId,
    score: Math.round(clamp(score, 0, 100)),
    label,
    category,
    enabled: true,
    weight: 0,
    // set by evaluator from context
    findings,
    rawData
  };
}
var CONTENT_BEARING_TYPES = /* @__PURE__ */ new Set([
  "heading",
  "paragraph",
  "label",
  "metric-value",
  "badge",
  "input",
  "textarea",
  "select",
  "list-item",
  "table-cell",
  "table-header",
  "caption",
  "description-text",
  "status-message",
  "code-block",
  "blockquote",
  "nav-text"
]);
function isContentBearing(el) {
  return CONTENT_BEARING_TYPES.has(el.type.toLowerCase());
}
function isContainerElement(el) {
  const hasBg = parseColor(el.styles.backgroundColor) !== null;
  const hasRadius = parsePx(el.styles.borderRadius) > 0;
  const hasPadding = parsePx(el.styles.paddingTop) > 0 || parsePx(el.styles.paddingLeft) > 0;
  const largeEnough = el.rect.width >= 100 && el.rect.height >= 80;
  return hasBg && (hasRadius || hasPadding) && largeEnough;
}
function rectContains(outer, inner, tolerance = 2) {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance && inner.y + inner.height <= outer.y + outer.height + tolerance;
}
var contentOverflow = (elements, viewport) => {
  if (elements.length === 0)
    return makeResult("contentOverflow", "Content Overflow", "ux", 100, []);
  const maxBottom = Math.max(...elements.map((el) => el.rect.y + el.rect.height));
  const overflowPx = maxBottom - viewport.height;
  if (overflowPx <= 0) return makeResult("contentOverflow", "Content Overflow", "ux", 100, []);
  const overflowRatio = overflowPx / viewport.height;
  const score = Math.max(0, 100 - overflowRatio * 100);
  const findings = [
    {
      severity: overflowRatio > 0.5 ? "error" : "warning",
      message: `Content extends ${Math.round(overflowPx)}px (${(overflowRatio * 100).toFixed(0)}%) below the viewport.`,
      recommendation: "Reduce content height, use more compact layouts, or prioritize above-fold content."
    }
  ];
  return makeResult("contentOverflow", "Content Overflow", "ux", score, findings, {
    overflowPx,
    overflowRatio,
    maxBottom,
    viewportHeight: viewport.height
  });
};
var aboveFoldRatio = (elements, viewport) => {
  const contentElements = elements.filter(isContentBearing);
  if (contentElements.length === 0)
    return makeResult("aboveFoldRatio", "Above Fold Ratio", "ux", 100, []);
  const visibleCount = contentElements.filter(
    (el) => el.rect.y + el.rect.height <= viewport.height
  ).length;
  const score = visibleCount / contentElements.length * 100;
  const findings = [];
  if (score < 70) {
    const belowCount = contentElements.length - visibleCount;
    findings.push({
      severity: score < 40 ? "error" : "warning",
      message: `Only ${visibleCount} of ${contentElements.length} content elements are above the fold (${belowCount} require scrolling).`,
      recommendation: "Move critical content above the fold or reduce vertical space usage."
    });
  }
  return makeResult("aboveFoldRatio", "Above Fold Ratio", "ux", score, findings, {
    visibleCount,
    totalCount: contentElements.length
  });
};
var informationDensity = (elements, _viewport) => {
  const contentElements = elements.filter(isContentBearing);
  if (contentElements.length === 0 || elements.length === 0)
    return makeResult("informationDensity", "Information Density", "ux", 100, []);
  const contentArea = contentElements.reduce((sum, el) => sum + elementArea(el), 0);
  const totalArea = elements.reduce((sum, el) => sum + elementArea(el), 0);
  if (totalArea === 0)
    return makeResult("informationDensity", "Information Density", "ux", 100, []);
  const ratio = contentArea / totalArea;
  const findings = [];
  let score;
  if (ratio >= 0.3) {
    score = 100;
  } else {
    score = ratio / 0.3 * 100;
    findings.push({
      severity: ratio < 0.15 ? "error" : "warning",
      message: `Only ${(ratio * 100).toFixed(0)}% of element area contains content. Too much chrome/decoration.`,
      recommendation: "Reduce container padding, decorative elements, or oversized headers."
    });
  }
  return makeResult("informationDensity", "Information Density", "ux", score, findings, {
    contentArea,
    totalArea,
    ratio,
    contentElementCount: contentElements.length
  });
};
var containerEfficiency = (elements, _viewport) => {
  const containers = elements.filter(isContainerElement);
  if (containers.length === 0)
    return makeResult("containerEfficiency", "Container Efficiency", "ux", 100, []);
  const efficiencies = [];
  const inefficientContainers = [];
  for (const container of containers) {
    const children = elements.filter(
      (el) => el.elementId !== container.elementId && rectContains(container.rect, el.rect)
    );
    if (children.length === 0) continue;
    const childArea = children.reduce((sum, el) => sum + elementArea(el), 0);
    const containerArea = elementArea(container);
    if (containerArea === 0) continue;
    const efficiency = Math.min(1, childArea / containerArea);
    efficiencies.push(efficiency);
    if (efficiency < 0.2) {
      inefficientContainers.push(container.elementId);
    }
  }
  if (efficiencies.length === 0)
    return makeResult("containerEfficiency", "Container Efficiency", "ux", 100, []);
  const avgEfficiency = efficiencies.reduce((s, v) => s + v, 0) / efficiencies.length;
  const score = avgEfficiency >= 0.3 ? 100 : avgEfficiency / 0.3 * 100;
  const findings = [];
  if (inefficientContainers.length > 0) {
    findings.push({
      severity: avgEfficiency < 0.15 ? "error" : "warning",
      message: `${inefficientContainers.length} container(s) are oversized for their content (avg efficiency: ${(avgEfficiency * 100).toFixed(0)}%).`,
      recommendation: "Reduce container dimensions to better fit their child content.",
      elementIds: inefficientContainers.slice(0, 10)
    });
  }
  return makeResult("containerEfficiency", "Container Efficiency", "ux", score, findings, {
    avgEfficiency,
    containerCount: efficiencies.length,
    inefficientCount: inefficientContainers.length
  });
};
var viewportUtilization = (elements, viewport) => {
  if (elements.length === 0)
    return makeResult("viewportUtilization", "Viewport Utilization", "ux", 100, []);
  const minX = Math.max(0, Math.min(...elements.map((el) => el.rect.x)));
  const minY = Math.max(0, Math.min(...elements.map((el) => el.rect.y)));
  const maxX = Math.min(
    viewport.width,
    Math.max(...elements.map((el) => el.rect.x + el.rect.width))
  );
  const maxY = Math.min(
    viewport.height,
    Math.max(...elements.map((el) => el.rect.y + el.rect.height))
  );
  const usedWidth = maxX - minX;
  const usedHeight = maxY - minY;
  const widthRatio = viewport.width > 0 ? usedWidth / viewport.width : 1;
  const heightRatio = viewport.height > 0 ? usedHeight / viewport.height : 1;
  const utilization = (widthRatio + heightRatio) / 2;
  const score = utilization >= 0.7 ? 100 : utilization / 0.7 * 100;
  const findings = [];
  if (score < 70) {
    const issues = [];
    if (widthRatio < 0.6) issues.push(`width (${(widthRatio * 100).toFixed(0)}% used)`);
    if (heightRatio < 0.6) issues.push(`height (${(heightRatio * 100).toFixed(0)}% used)`);
    findings.push({
      severity: "warning",
      message: `Low viewport utilization: ${issues.join(", ")}. Content occupies only ${(utilization * 100).toFixed(0)}% of available space.`,
      recommendation: "Expand content to use more of the available viewport, or center content meaningfully."
    });
  }
  return makeResult("viewportUtilization", "Viewport Utilization", "ux", score, findings, {
    widthRatio,
    heightRatio,
    utilization,
    boundingBox: { minX, minY, maxX, maxY }
  });
};
var elementDensity = (elements, viewport) => {
  const viewportArea = viewport.width * viewport.height;
  if (viewportArea === 0)
    return makeResult("elementDensity", "Element Density", "density", 100, []);
  const totalElementArea = elements.reduce((sum, el) => sum + elementArea(el), 0);
  const coverage = totalElementArea / viewportArea;
  const findings = [];
  let score;
  if (coverage >= 0.3 && coverage <= 0.7) {
    score = 100;
  } else if (coverage < 0.3) {
    score = coverage / 0.3 * 100;
    findings.push({
      severity: "warning",
      message: `Low element density (${(coverage * 100).toFixed(1)}%). Page may feel empty.`,
      recommendation: "Consider adding content or reducing whitespace."
    });
  } else {
    score = Math.max(0, 100 - (coverage - 0.7) / 0.3 * 100);
    findings.push({
      severity: "warning",
      message: `High element density (${(coverage * 100).toFixed(1)}%). Page may feel cluttered.`,
      recommendation: "Consider reducing content density or increasing spacing."
    });
  }
  return makeResult("elementDensity", "Element Density", "density", score, findings, { coverage });
};
var whitespaceRatio = (elements, viewport) => {
  const viewportArea = viewport.width * viewport.height;
  if (viewportArea === 0)
    return makeResult("whitespaceRatio", "Whitespace Ratio", "density", 100, []);
  const totalElementArea = elements.reduce((sum, el) => sum + elementArea(el), 0);
  const ratio = 1 - Math.min(1, totalElementArea / viewportArea);
  const findings = [];
  let score;
  if (ratio >= 0.25 && ratio <= 0.75) {
    score = 100;
  } else if (ratio < 0.25) {
    score = ratio / 0.25 * 100;
    findings.push({
      severity: "warning",
      message: `Very low whitespace (${(ratio * 100).toFixed(1)}%). UI feels cramped.`,
      recommendation: "Increase padding and margins between elements."
    });
  } else {
    score = Math.max(0, 100 - (ratio - 0.75) / 0.25 * 100);
    findings.push({
      severity: "info",
      message: `Very high whitespace (${(ratio * 100).toFixed(1)}%). Page may feel sparse.`,
      recommendation: "Consider whether the empty space serves a purpose."
    });
  }
  return makeResult("whitespaceRatio", "Whitespace Ratio", "density", score, findings, { ratio });
};
var localDensityBalance = (elements, viewport) => {
  if (elements.length < 4)
    return makeResult("localDensityBalance", "Local Density Balance", "density", 100, []);
  const gridCols = 4;
  const gridRows = 4;
  const cellW = viewport.width / gridCols;
  const cellH = viewport.height / gridRows;
  const densities = [];
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const cellX = col * cellW;
      const cellY = row * cellH;
      let cellArea = 0;
      for (const el of elements) {
        const overlapX = Math.max(
          0,
          Math.min(el.rect.x + el.rect.width, cellX + cellW) - Math.max(el.rect.x, cellX)
        );
        const overlapY = Math.max(
          0,
          Math.min(el.rect.y + el.rect.height, cellY + cellH) - Math.max(el.rect.y, cellY)
        );
        cellArea += overlapX * overlapY;
      }
      densities.push(cellArea / (cellW * cellH));
    }
  }
  const cv = coefficientOfVariation(densities);
  const findings = [];
  let score;
  if (cv <= 0.3) {
    score = 100;
  } else if (cv >= 1) {
    score = 0;
    findings.push({
      severity: "error",
      message: `Highly unbalanced density distribution (CV=${cv.toFixed(2)}). Some regions are much denser than others.`,
      recommendation: "Redistribute content more evenly across the page."
    });
  } else {
    score = 100 - (cv - 0.3) / 0.7 * 100;
    if (score < 60) {
      findings.push({
        severity: "warning",
        message: `Uneven density distribution (CV=${cv.toFixed(2)}).`,
        recommendation: "Balance content distribution across page regions."
      });
    }
  }
  return makeResult("localDensityBalance", "Local Density Balance", "density", score, findings, {
    cv,
    gridDensities: densities
  });
};
var horizontalBalance = (elements, viewport) => {
  if (elements.length === 0)
    return makeResult("horizontalBalance", "Horizontal Balance", "density", 100, []);
  const midX = viewport.width / 2;
  let leftArea = 0;
  let rightArea = 0;
  for (const el of elements) {
    const elMidX = el.rect.x + el.rect.width / 2;
    const area = elementArea(el);
    if (elMidX < midX) leftArea += area;
    else rightArea += area;
  }
  const total = leftArea + rightArea;
  if (total === 0) return makeResult("horizontalBalance", "Horizontal Balance", "density", 100, []);
  const ratio = Math.min(leftArea, rightArea) / Math.max(leftArea, rightArea);
  const findings = [];
  let score;
  if (ratio >= 0.8) {
    score = 100;
  } else {
    score = ratio / 0.8 * 100;
    const heavier = leftArea > rightArea ? "left" : "right";
    findings.push({
      severity: ratio < 0.5 ? "warning" : "info",
      message: `Horizontal imbalance: ${heavier} side is heavier (ratio=${ratio.toFixed(2)}).`,
      recommendation: `Consider redistributing visual weight toward the ${heavier === "left" ? "right" : "left"} side.`
    });
  }
  return makeResult("horizontalBalance", "Horizontal Balance", "density", score, findings, {
    ratio,
    leftArea,
    rightArea
  });
};
var verticalBalance = (elements, viewport) => {
  if (elements.length === 0)
    return makeResult("verticalBalance", "Vertical Balance", "density", 100, []);
  const midY = viewport.height / 2;
  let topArea = 0;
  let bottomArea = 0;
  for (const el of elements) {
    const elMidY = el.rect.y + el.rect.height / 2;
    const area = elementArea(el);
    if (elMidY < midY) topArea += area;
    else bottomArea += area;
  }
  const total = topArea + bottomArea;
  if (total === 0) return makeResult("verticalBalance", "Vertical Balance", "density", 100, []);
  const ratio = Math.min(topArea, bottomArea) / Math.max(topArea, bottomArea);
  const findings = [];
  let score;
  if (ratio >= 0.8) {
    score = 100;
  } else {
    score = ratio / 0.8 * 100;
    const heavier = topArea > bottomArea ? "top" : "bottom";
    findings.push({
      severity: ratio < 0.5 ? "warning" : "info",
      message: `Vertical imbalance: ${heavier} half is heavier (ratio=${ratio.toFixed(2)}).`,
      recommendation: `Consider redistributing visual weight toward the ${heavier === "top" ? "bottom" : "top"}.`
    });
  }
  return makeResult("verticalBalance", "Vertical Balance", "density", score, findings, {
    ratio,
    topArea,
    bottomArea
  });
};
var alignmentConsistency = (elements, _viewport) => {
  if (elements.length < 3)
    return makeResult("alignmentConsistency", "Alignment Consistency", "density", 100, []);
  const tolerance = 2;
  const xEdges = elements.map((el) => el.rect.x);
  const yEdges = elements.map((el) => el.rect.y);
  function countOnLines(values) {
    const sorted = [...values].sort((a, b) => a - b);
    let onLine = 0;
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (j < sorted.length && sorted[j] - sorted[i] <= tolerance) j++;
      if (j - i >= 2) onLine += j - i;
      i = j;
    }
    return onLine;
  }
  const xOnLine = countOnLines(xEdges);
  const yOnLine = countOnLines(yEdges);
  const totalChecks = elements.length * 2;
  const aligned = xOnLine + yOnLine;
  const ratio = totalChecks > 0 ? aligned / totalChecks : 1;
  const score = ratio * 100;
  const findings = [];
  if (score < 60) {
    findings.push({
      severity: "warning",
      message: `Only ${(ratio * 100).toFixed(0)}% of elements align to shared grid lines.`,
      recommendation: "Use a consistent grid system to align element edges."
    });
  }
  return makeResult("alignmentConsistency", "Alignment Consistency", "density", score, findings, {
    ratio,
    xOnLine,
    yOnLine
  });
};
var spacingScaleAdherence = (elements) => {
  const spacingValues = [];
  for (const el of elements) {
    for (const prop of [
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft"
    ]) {
      const v = parsePx(el.styles[prop]);
      if (v > 0) spacingValues.push(v);
    }
  }
  if (spacingValues.length === 0)
    return makeResult("spacingScaleAdherence", "Spacing Scale Adherence", "spacing", 100, []);
  const onGrid = spacingValues.filter((v) => v % 4 === 0).length;
  const ratio = onGrid / spacingValues.length;
  const score = ratio * 100;
  const findings = [];
  if (score < 70) {
    const offGrid = spacingValues.filter((v) => v % 4 !== 0);
    const uniqueOffGrid = [...new Set(offGrid)].sort((a, b) => a - b).slice(0, 5);
    findings.push({
      severity: "warning",
      message: `${((1 - ratio) * 100).toFixed(0)}% of spacing values are not multiples of 4px.`,
      recommendation: `Off-grid values: ${uniqueOffGrid.map((v) => v + "px").join(", ")}. Snap to 4px grid.`
    });
  }
  return makeResult(
    "spacingScaleAdherence",
    "Spacing Scale Adherence",
    "spacing",
    score,
    findings,
    { ratio, total: spacingValues.length }
  );
};
var spacingConsistency = (elements) => {
  if (elements.length < 3)
    return makeResult("spacingConsistency", "Spacing Consistency", "spacing", 100, []);
  const yTolerance = 5;
  const sorted = [...elements].sort((a, b) => a.rect.y - b.rect.y);
  const rows = [];
  let currentRow = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].rect.y - sorted[i - 1].rect.y) <= yTolerance) {
      currentRow.push(sorted[i]);
    } else {
      if (currentRow.length >= 2) rows.push(currentRow);
      currentRow = [sorted[i]];
    }
  }
  if (currentRow.length >= 2) rows.push(currentRow);
  if (rows.length === 0)
    return makeResult("spacingConsistency", "Spacing Consistency", "spacing", 100, []);
  const allGaps = [];
  for (const row of rows) {
    const byX = [...row].sort((a, b) => a.rect.x - b.rect.x);
    for (let i = 1; i < byX.length; i++) {
      const gap = byX[i].rect.x - (byX[i - 1].rect.x + byX[i - 1].rect.width);
      if (gap > 0) allGaps.push(gap);
    }
  }
  if (allGaps.length < 2)
    return makeResult("spacingConsistency", "Spacing Consistency", "spacing", 100, []);
  const cv = coefficientOfVariation(allGaps);
  const score = Math.max(0, 100 - cv * 100);
  const findings = [];
  if (score < 60) {
    findings.push({
      severity: "warning",
      message: `Inconsistent horizontal spacing between sibling elements (CV=${cv.toFixed(2)}).`,
      recommendation: "Use uniform gap values for elements in the same row."
    });
  }
  return makeResult("spacingConsistency", "Spacing Consistency", "spacing", score, findings, {
    cv,
    gapCount: allGaps.length
  });
};
var lineHeightRatio = (elements) => {
  const ratios = [];
  const badElements = [];
  for (const el of elements) {
    const fontSize = parsePx(el.styles.fontSize);
    const lh = parsePx(el.styles.lineHeight);
    if (fontSize > 0 && lh > 0) {
      const r = lh / fontSize;
      ratios.push(r);
      if (r < 1.2 || r > 1.8) badElements.push(el.elementId);
    }
  }
  if (ratios.length === 0)
    return makeResult("lineHeightRatio", "Line Height Ratio", "spacing", 100, []);
  const inRange = ratios.filter((r) => r >= 1.2 && r <= 1.8).length;
  const score = inRange / ratios.length * 100;
  const findings = [];
  if (score < 80) {
    findings.push({
      severity: "warning",
      message: `${ratios.length - inRange} text elements have line-height outside the 1.2-1.8x range.`,
      recommendation: "Aim for line-height between 1.4-1.6x font-size for body text.",
      elementIds: badElements.slice(0, 10)
    });
  }
  return makeResult("lineHeightRatio", "Line Height Ratio", "spacing", score, findings, {
    total: ratios.length,
    inRange
  });
};
var interGroupSpacingRatio = (elements) => {
  if (elements.length < 4)
    return makeResult("interGroupSpacingRatio", "Inter-Group Spacing Ratio", "spacing", 100, []);
  const distances = [];
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const dx = elements[i].rect.x + elements[i].rect.width / 2 - (elements[j].rect.x + elements[j].rect.width / 2);
      const dy = elements[i].rect.y + elements[i].rect.height / 2 - (elements[j].rect.y + elements[j].rect.height / 2);
      distances.push(Math.sqrt(dx * dx + dy * dy));
    }
  }
  if (distances.length === 0)
    return makeResult("interGroupSpacingRatio", "Inter-Group Spacing Ratio", "spacing", 100, []);
  distances.sort((a, b) => a - b);
  const median = distances[Math.floor(distances.length / 2)];
  const threshold = median * 1.5;
  const intraGroup = distances.filter((d) => d <= threshold);
  const interGroup = distances.filter((d) => d > threshold);
  if (intraGroup.length === 0 || interGroup.length === 0)
    return makeResult("interGroupSpacingRatio", "Inter-Group Spacing Ratio", "spacing", 100, []);
  const avgIntra = intraGroup.reduce((s, d) => s + d, 0) / intraGroup.length;
  const avgInter = interGroup.reduce((s, d) => s + d, 0) / interGroup.length;
  const ratio = avgIntra > 0 ? avgInter / avgIntra : 1;
  const score = ratio >= 2.5 ? 100 : ratio / 2.5 * 100;
  const findings = [];
  if (score < 60) {
    findings.push({
      severity: "warning",
      message: `Weak visual grouping: inter-group spacing is only ${ratio.toFixed(1)}x intra-group spacing.`,
      recommendation: "Increase spacing between groups to at least 2.5x the spacing within groups."
    });
  }
  return makeResult(
    "interGroupSpacingRatio",
    "Inter-Group Spacing Ratio",
    "spacing",
    score,
    findings,
    { ratio }
  );
};
var uniqueColorCount = (elements) => {
  const colors = [];
  for (const el of elements) {
    for (const prop of ["color", "backgroundColor"]) {
      const parsed = parseColor(el.styles[prop]);
      if (parsed && parsed.a > 0.1) colors.push(parsed);
    }
  }
  if (colors.length === 0)
    return makeResult("uniqueColorCount", "Unique Color Count", "color", 100, []);
  const clusters = clusterColors(colors, 25);
  const count = clusters.length;
  const findings = [];
  let score;
  if (count >= 3 && count <= 8) {
    score = 100;
  } else if (count < 3) {
    score = 60 + count / 3 * 40;
    findings.push({
      severity: "info",
      message: `Only ${count} distinct color(s). Palette may be too limited.`,
      recommendation: "Consider adding accent colors for visual hierarchy."
    });
  } else {
    score = Math.max(0, 100 - (count - 8) * 8);
    findings.push({
      severity: "warning",
      message: `${count} distinct colors used. Palette may be too varied.`,
      recommendation: "Consolidate similar colors and limit palette to 5-8 colors."
    });
  }
  return makeResult("uniqueColorCount", "Unique Color Count", "color", score, findings, {
    count,
    totalSampled: colors.length
  });
};
var wcagContrastCompliance = (elements) => {
  let passing = 0;
  let total = 0;
  const failingElements = [];
  for (const el of elements) {
    const fg = parseColor(el.styles.color);
    let bg = parseColor(el.styles.backgroundColor);
    if (!fg) continue;
    if (!bg || bg.a < 0.1) bg = { r: 255, g: 255, b: 255, a: 1 };
    total++;
    const ratio = contrastRatio(fg, bg);
    if (ratio >= 4.5) {
      passing++;
    } else {
      failingElements.push(el.elementId);
    }
  }
  if (total === 0)
    return makeResult("wcagContrastCompliance", "WCAG Contrast Compliance", "color", 100, []);
  const score = passing / total * 100;
  const findings = [];
  if (failingElements.length > 0) {
    findings.push({
      severity: "error",
      message: `${failingElements.length} of ${total} text elements fail WCAG AA contrast (4.5:1 minimum).`,
      recommendation: "Increase contrast between text color and background color.",
      elementIds: failingElements.slice(0, 10)
    });
  }
  return makeResult(
    "wcagContrastCompliance",
    "WCAG Contrast Compliance",
    "color",
    score,
    findings,
    { passing, total }
  );
};
var colorHarmony = (elements) => {
  const hues = [];
  for (const el of elements) {
    for (const prop of ["color", "backgroundColor"]) {
      const parsed = parseColor(el.styles[prop]);
      if (parsed && parsed.a > 0.1 && !isGrayscale(parsed)) {
        const hsl = rgbToHsl(parsed);
        hues.push(hsl.h);
      }
    }
  }
  if (hues.length < 2) return makeResult("colorHarmony", "Color Harmony", "color", 100, []);
  const uniqueHues = [...new Set(hues.map((h) => Math.round(h / 10) * 10))];
  if (uniqueHues.length < 2) return makeResult("colorHarmony", "Color Harmony", "color", 100, []);
  const patterns = [
    { name: "monochromatic", test: () => checkMonochromatic(uniqueHues) },
    { name: "complementary", test: () => checkComplementary(uniqueHues) },
    { name: "analogous", test: () => checkAnalogous(uniqueHues) },
    { name: "triadic", test: () => checkTriadic(uniqueHues) }
  ];
  let bestScore = 0;
  let bestPattern = "none";
  for (const p of patterns) {
    const s = p.test();
    if (s > bestScore) {
      bestScore = s;
      bestPattern = p.name;
    }
  }
  const findings = [];
  if (bestScore < 50) {
    findings.push({
      severity: "warning",
      message: `Color palette does not follow a clear harmony pattern.`,
      recommendation: "Use complementary (opposite hues), analogous (adjacent hues), or triadic (evenly spaced hues) color schemes."
    });
  }
  return makeResult("colorHarmony", "Color Harmony", "color", bestScore, findings, {
    bestPattern,
    distinctHues: uniqueHues.length
  });
};
function checkMonochromatic(hues) {
  if (hues.length <= 1) return 100;
  const base = hues[0];
  const maxDist = Math.max(...hues.map((h) => hueDistance(h, base)));
  return maxDist <= 15 ? 100 : maxDist <= 30 ? 70 : 30;
}
function checkComplementary(hues) {
  let bestFit = 0;
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      const dist = hueDistance(hues[i], hues[j]);
      const fit = dist >= 165 && dist <= 195 ? 100 : Math.max(0, 100 - Math.abs(dist - 180) * 2);
      if (fit > bestFit) bestFit = fit;
    }
  }
  return hues.length <= 3 ? bestFit : bestFit * 0.7;
}
function checkAnalogous(hues) {
  const sorted = [...hues].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
  }
  if (sorted.length > 1) {
    maxGap = Math.max(maxGap, 360 - sorted[sorted.length - 1] + sorted[0]);
  }
  const span = 360 - maxGap;
  return span <= 60 ? 100 : span <= 90 ? 70 : span <= 120 ? 40 : 20;
}
function checkTriadic(hues) {
  if (hues.length < 3) return 0;
  const sorted = [...hues].sort((a, b) => a - b);
  let bestScore = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      for (let k = j + 1; k < sorted.length; k++) {
        const d1 = hueDistance(sorted[i], sorted[j]);
        const d2 = hueDistance(sorted[j], sorted[k]);
        const d3 = hueDistance(sorted[i], sorted[k]);
        const avgDeviation = (Math.abs(d1 - 120) + Math.abs(d2 - 120) + Math.abs(d3 - 120)) / 3;
        const s = Math.max(0, 100 - avgDeviation * 2);
        if (s > bestScore) bestScore = s;
      }
    }
  }
  return bestScore;
}
var saturationConsistency = (elements) => {
  const saturations = [];
  for (const el of elements) {
    for (const prop of ["color", "backgroundColor"]) {
      const parsed = parseColor(el.styles[prop]);
      if (parsed && parsed.a > 0.1 && !isGrayscale(parsed)) {
        const hsl = rgbToHsl(parsed);
        saturations.push(hsl.s);
      }
    }
  }
  if (saturations.length < 2)
    return makeResult("saturationConsistency", "Saturation Consistency", "color", 100, []);
  const cv = coefficientOfVariation(saturations);
  const score = Math.max(0, 100 - cv * 100);
  const findings = [];
  if (score < 60) {
    findings.push({
      severity: "info",
      message: `Inconsistent color saturation levels (CV=${cv.toFixed(2)}).`,
      recommendation: "Use a consistent saturation level across your color palette."
    });
  }
  return makeResult("saturationConsistency", "Saturation Consistency", "color", score, findings, {
    cv,
    count: saturations.length
  });
};
var typeScaleAdherence = (elements) => {
  const fontSizes = /* @__PURE__ */ new Set();
  for (const el of elements) {
    const size = parsePx(el.styles.fontSize);
    if (size > 0) fontSizes.add(Math.round(size * 10) / 10);
  }
  const sizes = [...fontSizes].sort((a, b) => a - b);
  if (sizes.length < 2)
    return makeResult("typeScaleAdherence", "Type Scale Adherence", "typography", 100, []);
  const scales = [
    { name: "minor-second", ratio: 1.067 },
    { name: "major-second", ratio: 1.125 },
    { name: "minor-third", ratio: 1.2 },
    { name: "major-third", ratio: 1.25 },
    { name: "perfect-fourth", ratio: 1.333 },
    { name: "augmented-fourth", ratio: 1.414 },
    { name: "perfect-fifth", ratio: 1.5 }
  ];
  let bestScore = 0;
  let bestScale = "none";
  for (const scale of scales) {
    for (const base of sizes) {
      let onScale = 0;
      for (const size of sizes) {
        if (size <= 0 || base <= 0) continue;
        const n = Math.log(size / base) / Math.log(scale.ratio);
        if (Math.abs(n - Math.round(n)) < 0.15) onScale++;
      }
      const fit = onScale / sizes.length * 100;
      if (fit > bestScore) {
        bestScore = fit;
        bestScale = scale.name;
      }
    }
  }
  const findings = [];
  if (bestScore < 60) {
    findings.push({
      severity: "warning",
      message: `Font sizes (${sizes.join(", ")}px) don't follow a consistent type scale.`,
      recommendation: "Adopt a standard type scale (e.g., Major Third 1.25x or Perfect Fourth 1.333x)."
    });
  }
  return makeResult(
    "typeScaleAdherence",
    "Type Scale Adherence",
    "typography",
    bestScore,
    findings,
    {
      bestScale,
      distinctSizes: sizes.length,
      sizes
    }
  );
};
var fontWeightConsistency = (elements) => {
  const weights = /* @__PURE__ */ new Set();
  for (const el of elements) {
    if (el.styles.fontWeight) weights.add(el.styles.fontWeight);
  }
  const count = weights.size;
  const findings = [];
  let score;
  if (count >= 2 && count <= 3) {
    score = 100;
  } else if (count === 1) {
    score = 70;
    findings.push({
      severity: "info",
      message: "Only one font weight used. Consider adding a bold weight for hierarchy.",
      recommendation: "Use 2-3 font weights (e.g., 400 regular, 600 semi-bold, 700 bold)."
    });
  } else if (count === 4) {
    score = 80;
  } else {
    score = Math.max(0, 100 - (count - 3) * 20);
    findings.push({
      severity: "warning",
      message: `${count} different font weights used. Too many weights reduce visual consistency.`,
      recommendation: "Limit to 2-3 font weights for a cleaner hierarchy."
    });
  }
  return makeResult(
    "fontWeightConsistency",
    "Font Weight Consistency",
    "typography",
    score,
    findings,
    {
      count,
      weights: [...weights]
    }
  );
};
var headingHierarchy = (elements) => {
  const headings = [];
  for (const el of elements) {
    const type = el.type.toLowerCase();
    let level = 0;
    if (type === "heading" || type.startsWith("h")) {
      const match = type.match(/h(\d)/);
      if (match) level = parseInt(match[1], 10);
    }
    if (level === 0 && el.elementId) {
      const match = el.elementId.match(/h(\d)/i);
      if (match) level = parseInt(match[1], 10);
    }
    if (level >= 1 && level <= 6) {
      headings.push({ level, fontSize: parsePx(el.styles.fontSize), elementId: el.elementId });
    }
  }
  if (headings.length < 2)
    return makeResult("headingHierarchy", "Heading Hierarchy", "typography", 100, []);
  const sorted = [...headings].sort((a, b) => a.level - b.level);
  let checks = 0;
  let passing = 0;
  const issues = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].level > sorted[i - 1].level) {
      checks++;
      if (sorted[i].fontSize < sorted[i - 1].fontSize) {
        passing++;
      } else {
        issues.push(
          `h${sorted[i].level} (${sorted[i].fontSize}px) is not smaller than h${sorted[i - 1].level} (${sorted[i - 1].fontSize}px)`
        );
      }
    }
  }
  const levels = [...new Set(headings.map((h) => h.level))].sort();
  for (let i = 1; i < levels.length; i++) {
    checks++;
    if (levels[i] - levels[i - 1] === 1) {
      passing++;
    } else {
      issues.push(`Skipped heading level: h${levels[i - 1]} to h${levels[i]}`);
    }
  }
  const score = checks > 0 ? passing / checks * 100 : 100;
  const findings = [];
  if (issues.length > 0) {
    findings.push({
      severity: "warning",
      message: `Heading hierarchy issues: ${issues.join("; ")}.`,
      recommendation: "Ensure heading sizes decrease with level and no levels are skipped."
    });
  }
  return makeResult("headingHierarchy", "Heading Hierarchy", "typography", score, findings, {
    headingCount: headings.length,
    levels
  });
};
var fontFamilyCount = (elements) => {
  const families = /* @__PURE__ */ new Set();
  for (const el of elements) {
    if (el.styles.fontFamily) {
      const first = el.styles.fontFamily.split(",")[0].trim().replace(/["']/g, "").toLowerCase();
      if (first) families.add(first);
    }
  }
  const count = families.size;
  const findings = [];
  let score;
  if (count >= 1 && count <= 2) {
    score = 100;
  } else if (count === 3) {
    score = 75;
    findings.push({
      severity: "info",
      message: `3 font families used (${[...families].join(", ")}). Consider reducing to 2.`,
      recommendation: "Use one font for body text and optionally one for headings."
    });
  } else if (count === 0) {
    score = 80;
  } else {
    score = Math.max(0, 100 - (count - 2) * 25);
    findings.push({
      severity: "warning",
      message: `${count} font families used. Too many fonts reduce visual coherence.`,
      recommendation: "Limit to 1-2 font families."
    });
  }
  return makeResult("fontFamilyCount", "Font Family Count", "typography", score, findings, {
    count,
    families: [...families]
  });
};
function computeConsistencyScore(elements, getValues) {
  if (elements.length < 2) return { score: 100, cv: 0 };
  const allValues = elements.map(getValues);
  const numProps = allValues[0]?.length ?? 0;
  if (numProps === 0) return { score: 100, cv: 0 };
  const cvs = [];
  for (let p = 0; p < numProps; p++) {
    const vals = allValues.map((v) => v[p]).filter((v) => v > 0);
    if (vals.length >= 2) cvs.push(coefficientOfVariation(vals));
  }
  if (cvs.length === 0) return { score: 100, cv: 0 };
  const avgCv = cvs.reduce((s, v) => s + v, 0) / cvs.length;
  return { score: Math.max(0, 100 - avgCv * 200), cv: avgCv };
}
var buttonConsistency = (elements) => {
  const buttons = elements.filter((el) => {
    const t = el.type.toLowerCase();
    return t === "button" || t === "pressable";
  });
  if (buttons.length < 2)
    return makeResult("buttonConsistency", "Button Consistency", "consistency", 100, []);
  const { score, cv } = computeConsistencyScore(buttons, (el) => [
    parsePx(el.styles.height),
    parsePx(el.styles.paddingTop) + parsePx(el.styles.paddingBottom),
    parsePx(el.styles.paddingLeft) + parsePx(el.styles.paddingRight),
    parsePx(el.styles.borderRadius),
    parsePx(el.styles.fontSize)
  ]);
  const findings = [];
  if (score < 70) {
    findings.push({
      severity: "warning",
      message: `Buttons have inconsistent styling (CV=${cv.toFixed(2)}).`,
      recommendation: "Standardize button height, padding, border-radius, and font-size.",
      elementIds: buttons.map((el) => el.elementId).slice(0, 10)
    });
  }
  return makeResult("buttonConsistency", "Button Consistency", "consistency", score, findings, {
    buttonCount: buttons.length,
    cv
  });
};
var cardConsistency = (elements) => {
  const cards = elements.filter((el) => {
    const hasBg = parseColor(el.styles.backgroundColor) !== null;
    const hasRadius = parsePx(el.styles.borderRadius) > 0;
    const hasPadding = parsePx(el.styles.paddingTop) > 0 || parsePx(el.styles.paddingLeft) > 0;
    const largeEnough = el.rect.width >= 100 && el.rect.height >= 80;
    return hasBg && hasRadius && hasPadding && largeEnough;
  });
  if (cards.length < 2)
    return makeResult("cardConsistency", "Card Consistency", "consistency", 100, []);
  const { score, cv } = computeConsistencyScore(cards, (el) => [
    parsePx(el.styles.borderRadius),
    parsePx(el.styles.paddingTop),
    parsePx(el.styles.paddingLeft),
    el.rect.width
  ]);
  const findings = [];
  if (score < 70) {
    findings.push({
      severity: "warning",
      message: `Card-like elements have inconsistent styling (CV=${cv.toFixed(2)}).`,
      recommendation: "Standardize border-radius, padding, and width for card components.",
      elementIds: cards.map((el) => el.elementId).slice(0, 10)
    });
  }
  return makeResult("cardConsistency", "Card Consistency", "consistency", score, findings, {
    cardCount: cards.length,
    cv
  });
};
var inputConsistency = (elements) => {
  const inputs = elements.filter((el) => {
    const t = el.type.toLowerCase();
    return t === "input" || t === "textarea" || t === "select";
  });
  if (inputs.length < 2)
    return makeResult("inputConsistency", "Input Consistency", "consistency", 100, []);
  const { score, cv } = computeConsistencyScore(inputs, (el) => [
    parsePx(el.styles.height),
    parsePx(el.styles.paddingTop) + parsePx(el.styles.paddingBottom),
    parsePx(el.styles.paddingLeft) + parsePx(el.styles.paddingRight),
    parsePx(el.styles.borderRadius),
    parsePx(el.styles.fontSize)
  ]);
  const findings = [];
  if (score < 70) {
    findings.push({
      severity: "warning",
      message: `Input fields have inconsistent styling (CV=${cv.toFixed(2)}).`,
      recommendation: "Standardize input height, padding, border-radius, and font-size.",
      elementIds: inputs.map((el) => el.elementId).slice(0, 10)
    });
  }
  return makeResult("inputConsistency", "Input Consistency", "consistency", score, findings, {
    inputCount: inputs.length,
    cv
  });
};
var touchTargetCompliance = (elements) => {
  const interactive = elements.filter(isInteractive);
  if (interactive.length === 0)
    return makeResult("touchTargetCompliance", "Touch Target Compliance", "consistency", 100, []);
  const minSize = 44;
  let compliant = 0;
  const failingElements = [];
  for (const el of interactive) {
    if (el.rect.width >= minSize && el.rect.height >= minSize) {
      compliant++;
    } else {
      failingElements.push(el.elementId);
    }
  }
  const score = compliant / interactive.length * 100;
  const findings = [];
  if (failingElements.length > 0) {
    findings.push({
      severity: "error",
      message: `${failingElements.length} interactive elements are smaller than ${minSize}x${minSize}px.`,
      recommendation: `Ensure all interactive elements are at least ${minSize}x${minSize}px for accessibility.`,
      elementIds: failingElements.slice(0, 10)
    });
  }
  return makeResult(
    "touchTargetCompliance",
    "Touch Target Compliance",
    "consistency",
    score,
    findings,
    {
      total: interactive.length,
      compliant
    }
  );
};
var COLOR_PROPERTIES = ["color", "backgroundColor", "borderColor", "outlineColor"];
var customPropertyConsistency = (elements) => {
  const findings = [];
  const elementsWithVars = elements.filter(
    (el) => el.customProperties && Object.keys(el.customProperties).length > 0
  );
  const adoptionRate = elements.length > 0 ? elementsWithVars.length / elements.length : 0;
  const adoptionScore = Math.min(adoptionRate * 200, 100);
  if (adoptionRate < 0.1 && elements.length > 5) {
    findings.push({
      severity: "info",
      message: `Only ${(adoptionRate * 100).toFixed(0)}% of elements use CSS custom properties`,
      recommendation: "Consider using CSS variables for consistent theming"
    });
  }
  const varValues = /* @__PURE__ */ new Map();
  for (const el of elementsWithVars) {
    for (const [prop, val] of Object.entries(el.customProperties)) {
      if (!varValues.has(prop)) varValues.set(prop, /* @__PURE__ */ new Set());
      varValues.get(prop).add(val);
    }
  }
  const totalVars = varValues.size;
  const inconsistentVars = [...varValues.entries()].filter(([, vals]) => vals.size > 1);
  const consistencyRate = totalVars > 0 ? 1 - inconsistentVars.length / totalVars : 1;
  const consistencyScore = consistencyRate * 100;
  if (inconsistentVars.length > 0) {
    const varNames = inconsistentVars.slice(0, 3).map(([name]) => name);
    findings.push({
      severity: "warning",
      message: `${inconsistentVars.length} CSS variable(s) resolve to different values: ${varNames.join(", ")}`,
      recommendation: "Ensure CSS variables resolve consistently across components"
    });
  }
  let totalColorProps = 0;
  let hardcodedColors = 0;
  for (const el of elements) {
    const customProps = el.customProperties ?? {};
    const customVals = new Set(Object.values(customProps));
    for (const prop of COLOR_PROPERTIES) {
      const val = el.styles[prop];
      if (val && val !== "transparent" && val !== "inherit" && val !== "initial") {
        totalColorProps++;
        if (!customVals.has(val)) {
          hardcodedColors++;
        }
      }
    }
  }
  const avoidanceRate = totalColorProps > 0 ? 1 - hardcodedColors / totalColorProps : 1;
  const avoidanceScore = avoidanceRate * 100;
  if (hardcodedColors > 5) {
    findings.push({
      severity: "info",
      message: `${hardcodedColors} color properties appear hardcoded without CSS variable backing`,
      recommendation: "Use CSS custom properties for color values to support theming"
    });
  }
  const score = adoptionScore * 0.5 + consistencyScore * 0.3 + avoidanceScore * 0.2;
  return makeResult(
    "customPropertyConsistency",
    "Custom Property Consistency",
    "consistency",
    score,
    findings,
    {
      totalElements: elements.length,
      elementsWithVars: elementsWithVars.length,
      adoptionRate: Math.round(adoptionRate * 100),
      totalVars,
      inconsistentVars: inconsistentVars.length,
      hardcodedColors
    }
  );
};
var METRIC_FUNCTIONS = {
  // UX
  contentOverflow,
  aboveFoldRatio,
  informationDensity,
  containerEfficiency,
  viewportUtilization,
  // Density
  elementDensity,
  whitespaceRatio,
  localDensityBalance,
  horizontalBalance,
  verticalBalance,
  alignmentConsistency,
  // Spacing
  spacingScaleAdherence,
  spacingConsistency,
  lineHeightRatio,
  interGroupSpacingRatio,
  // Color
  uniqueColorCount,
  wcagContrastCompliance,
  colorHarmony,
  saturationConsistency,
  // Typography
  typeScaleAdherence,
  fontWeightConsistency,
  headingHierarchy,
  fontFamilyCount,
  // Consistency
  buttonConsistency,
  cardConsistency,
  inputConsistency,
  touchTargetCompliance,
  customPropertyConsistency
};

// src/specs/quality-contexts.ts
var DEFAULT_CONFIG2 = {
  enabled: true,
  weight: 0.045,
  // ~1/22
  thresholds: { good: 80, warning: 50 }
};
function defineContext(name, description, overrides) {
  const metrics = {};
  for (const [id, partial] of Object.entries(overrides)) {
    metrics[id] = { ...DEFAULT_CONFIG2, ...partial };
  }
  return { name, description, metrics };
}
var general = defineContext(
  "general",
  "Balanced evaluation suitable for most web applications.",
  {
    // UX (5) — total ~0.20
    contentOverflow: { weight: 0.05 },
    aboveFoldRatio: { weight: 0.04 },
    informationDensity: { weight: 0.04 },
    containerEfficiency: { weight: 0.04 },
    viewportUtilization: { weight: 0.03 },
    // Density (6) — total ~0.16
    elementDensity: { weight: 0.03 },
    whitespaceRatio: { weight: 0.03 },
    localDensityBalance: { weight: 0.025 },
    horizontalBalance: { weight: 0.025 },
    verticalBalance: { weight: 0.025 },
    alignmentConsistency: { weight: 0.025 },
    // Spacing (4) — total ~0.16
    spacingScaleAdherence: { weight: 0.04 },
    spacingConsistency: { weight: 0.04 },
    lineHeightRatio: { weight: 0.04 },
    interGroupSpacingRatio: { weight: 0.04 },
    // Color (4) — total ~0.16
    uniqueColorCount: { weight: 0.03 },
    wcagContrastCompliance: { weight: 0.05 },
    colorHarmony: { weight: 0.04 },
    saturationConsistency: { weight: 0.04 },
    // Typography (4) — total ~0.16
    typeScaleAdherence: { weight: 0.04 },
    fontWeightConsistency: { weight: 0.04 },
    headingHierarchy: { weight: 0.04 },
    fontFamilyCount: { weight: 0.04 },
    // Consistency (5) — total ~0.19
    buttonConsistency: { weight: 0.04 },
    cardConsistency: { weight: 0.04 },
    inputConsistency: { weight: 0.04 },
    touchTargetCompliance: { weight: 0.04 },
    customPropertyConsistency: { weight: 0.03 }
  }
);
var minimal = defineContext(
  "minimal",
  "Emphasizes whitespace, simplicity, and restrained use of color. Ideal for landing pages and editorial layouts.",
  {
    // UX (5) — total ~0.12 (minimalist pages use space intentionally)
    contentOverflow: { weight: 0.03 },
    aboveFoldRatio: { weight: 0.025 },
    informationDensity: { weight: 0.02 },
    containerEfficiency: { weight: 0.02 },
    viewportUtilization: { weight: 0.025 },
    // Density & Layout
    elementDensity: { weight: 0.025, thresholds: { good: 85, warning: 60 } },
    whitespaceRatio: { weight: 0.09, thresholds: { good: 85, warning: 60 } },
    localDensityBalance: { weight: 0.035 },
    horizontalBalance: { weight: 0.035 },
    verticalBalance: { weight: 0.035 },
    alignmentConsistency: { weight: 0.04 },
    // Spacing
    spacingScaleAdherence: { weight: 0.05 },
    spacingConsistency: { weight: 0.05 },
    lineHeightRatio: { weight: 0.045 },
    interGroupSpacingRatio: { weight: 0.05 },
    // Color
    uniqueColorCount: { weight: 0.05, thresholds: { good: 85, warning: 55 } },
    wcagContrastCompliance: { weight: 0.045 },
    colorHarmony: { weight: 0.05 },
    saturationConsistency: { weight: 0.04 },
    // Typography
    typeScaleAdherence: { weight: 0.05 },
    fontWeightConsistency: { weight: 0.035 },
    headingHierarchy: { weight: 0.035 },
    fontFamilyCount: { weight: 0.035 },
    // Consistency
    buttonConsistency: { weight: 0.025 },
    cardConsistency: { weight: 0.015 },
    inputConsistency: { weight: 0.025 },
    touchTargetCompliance: { weight: 0.035 },
    customPropertyConsistency: { weight: 0.035 }
  }
);
var dataDense = defineContext(
  "data-dense",
  "Optimized for dashboards and data-heavy UIs. Lenient on density, strict on alignment and consistency.",
  {
    // UX (5) — total ~0.25 (dashboards are where these problems appear most)
    contentOverflow: { weight: 0.06 },
    aboveFoldRatio: { weight: 0.05 },
    informationDensity: { weight: 0.05 },
    containerEfficiency: { weight: 0.05, thresholds: { good: 75, warning: 45 } },
    viewportUtilization: { weight: 0.04 },
    // Density & Layout
    elementDensity: { weight: 0.015, thresholds: { good: 70, warning: 40 } },
    whitespaceRatio: { weight: 0.015, thresholds: { good: 70, warning: 40 } },
    localDensityBalance: { weight: 0.03 },
    horizontalBalance: { weight: 0.02 },
    verticalBalance: { weight: 0.02 },
    alignmentConsistency: { weight: 0.06, thresholds: { good: 85, warning: 60 } },
    // Spacing
    spacingScaleAdherence: { weight: 0.05 },
    spacingConsistency: { weight: 0.06, thresholds: { good: 85, warning: 60 } },
    lineHeightRatio: { weight: 0.03 },
    interGroupSpacingRatio: { weight: 0.04 },
    // Color
    uniqueColorCount: { weight: 0.03 },
    wcagContrastCompliance: { weight: 0.05 },
    colorHarmony: { weight: 0.02 },
    saturationConsistency: { weight: 0.02 },
    // Typography
    typeScaleAdherence: { weight: 0.03 },
    fontWeightConsistency: { weight: 0.03 },
    headingHierarchy: { weight: 0.02 },
    fontFamilyCount: { weight: 0.03 },
    // Consistency
    buttonConsistency: { weight: 0.045 },
    cardConsistency: { weight: 0.045 },
    inputConsistency: { weight: 0.045 },
    touchTargetCompliance: { weight: 0.04 },
    customPropertyConsistency: { weight: 0.04 }
  }
);
var mobile = defineContext(
  "mobile",
  "Optimized for mobile devices. Prioritizes touch targets, readability, and simple hierarchy.",
  {
    // UX (5) — total ~0.22 (viewport constraints make overflow critical)
    contentOverflow: { weight: 0.06, thresholds: { good: 85, warning: 50 } },
    aboveFoldRatio: { weight: 0.05 },
    informationDensity: { weight: 0.04 },
    containerEfficiency: { weight: 0.04 },
    viewportUtilization: { weight: 0.03 },
    // Density & Layout
    elementDensity: { weight: 0.03 },
    whitespaceRatio: { weight: 0.04 },
    localDensityBalance: { weight: 0.02 },
    horizontalBalance: { weight: 0.03 },
    verticalBalance: { weight: 0.02 },
    alignmentConsistency: { weight: 0.03 },
    // Spacing
    spacingScaleAdherence: { weight: 0.04 },
    spacingConsistency: { weight: 0.04 },
    lineHeightRatio: { weight: 0.05, thresholds: { good: 85, warning: 55 } },
    interGroupSpacingRatio: { weight: 0.04 },
    // Color
    uniqueColorCount: { weight: 0.03 },
    wcagContrastCompliance: { weight: 0.05 },
    colorHarmony: { weight: 0.03 },
    saturationConsistency: { weight: 0.02 },
    // Typography
    typeScaleAdherence: { weight: 0.03 },
    fontWeightConsistency: { weight: 0.03 },
    headingHierarchy: { weight: 0.03 },
    fontFamilyCount: { weight: 0.04 },
    // Consistency
    buttonConsistency: { weight: 0.04 },
    cardConsistency: { weight: 0.03 },
    inputConsistency: { weight: 0.04 },
    touchTargetCompliance: { weight: 0.07, thresholds: { good: 90, warning: 70 } },
    customPropertyConsistency: { weight: 0.03 }
  }
);
var accessibility = defineContext(
  "accessibility",
  "Focused on WCAG compliance and assistive technology support. Visual-only metrics are disabled.",
  {
    // UX (5) — total ~0.15 (content reachability matters for assistive tech)
    contentOverflow: { weight: 0.04 },
    aboveFoldRatio: { weight: 0.03 },
    informationDensity: { weight: 0.03 },
    containerEfficiency: { weight: 0.02 },
    viewportUtilization: { weight: 0.03 },
    // Density — mostly disabled for accessibility
    elementDensity: { enabled: false, weight: 0 },
    whitespaceRatio: { enabled: false, weight: 0 },
    localDensityBalance: { enabled: false, weight: 0 },
    horizontalBalance: { enabled: false, weight: 0 },
    verticalBalance: { enabled: false, weight: 0 },
    alignmentConsistency: { weight: 0.03 },
    // Spacing
    spacingScaleAdherence: { weight: 0.04 },
    spacingConsistency: { weight: 0.04 },
    lineHeightRatio: { weight: 0.07, thresholds: { good: 90, warning: 65 } },
    interGroupSpacingRatio: { weight: 0.04 },
    // Color
    uniqueColorCount: { enabled: false, weight: 0 },
    wcagContrastCompliance: { weight: 0.22, thresholds: { good: 95, warning: 80 } },
    colorHarmony: { enabled: false, weight: 0 },
    saturationConsistency: { enabled: false, weight: 0 },
    // Typography
    typeScaleAdherence: { weight: 0.04 },
    fontWeightConsistency: { weight: 0.035 },
    headingHierarchy: { weight: 0.13, thresholds: { good: 90, warning: 70 } },
    fontFamilyCount: { weight: 0.04 },
    // Consistency
    buttonConsistency: { weight: 0.015 },
    cardConsistency: { weight: 0.015 },
    inputConsistency: { weight: 0.015 },
    touchTargetCompliance: { weight: 0.12, thresholds: { good: 95, warning: 80 } },
    customPropertyConsistency: { enabled: false, weight: 0 }
  }
);
var BUILT_IN_CONTEXTS = {
  general,
  minimal,
  "data-dense": dataDense,
  mobile,
  accessibility
};
function getContext(name) {
  return BUILT_IN_CONTEXTS[name];
}
function listContexts() {
  return Object.values(BUILT_IN_CONTEXTS).map((c) => ({
    name: c.name,
    description: c.description
  }));
}

// src/specs/quality-evaluator.ts
function assignGrade(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}
function resolveContext(context) {
  if (!context) return BUILT_IN_CONTEXTS["general"];
  if (typeof context === "string") {
    const found = getContext(context);
    if (!found)
      throw new Error(
        `Unknown quality context: "${context}". Available: ${Object.keys(BUILT_IN_CONTEXTS).join(", ")}`
      );
    return found;
  }
  return context;
}
function evaluateQuality(elements, viewport, context) {
  const startTime = Date.now();
  const ctx = resolveContext(context);
  const metricResults = [];
  let weightedSum = 0;
  let totalWeight = 0;
  const metricIds = Object.keys(METRIC_FUNCTIONS);
  for (const metricId of metricIds) {
    const config = ctx.metrics[metricId];
    const enabled = config?.enabled ?? true;
    const weight = config?.weight ?? 0.045;
    if (!enabled) {
      metricResults.push({
        metricId,
        score: 0,
        label: metricId,
        category: getCategoryForMetric(metricId),
        enabled: false,
        weight: 0,
        findings: []
      });
      continue;
    }
    const fn = METRIC_FUNCTIONS[metricId];
    const result = fn(elements, viewport);
    result.weight = weight;
    result.enabled = true;
    if (config?.thresholds) {
      for (const finding of result.findings) {
        if (result.score < config.thresholds.warning) {
          finding.severity = "error";
        } else if (result.score < config.thresholds.good) {
          finding.severity = finding.severity === "error" ? "error" : "warning";
        }
      }
    }
    metricResults.push(result);
    weightedSum += result.score * weight;
    totalWeight += weight;
  }
  const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 100;
  const uxMetrics = metricResults.filter(
    (r) => r.enabled && getCategoryForMetric(r.metricId) === "ux"
  );
  let uxWeightedSum = 0;
  let uxTotalWeight = 0;
  for (const r of uxMetrics) {
    uxWeightedSum += r.score * r.weight;
    uxTotalWeight += r.weight;
  }
  const uxScore = uxTotalWeight > 0 ? Math.round(uxWeightedSum / uxTotalWeight) : 100;
  const allFindings = [];
  for (const result of metricResults) {
    if (!result.enabled) continue;
    for (const finding of result.findings) {
      allFindings.push({ ...finding, _weight: result.weight });
    }
  }
  allFindings.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2 };
    const sDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sDiff !== 0) return sDiff;
    return b._weight - a._weight;
  });
  const topIssues = allFindings.slice(0, 10).map(({ _weight, ...finding }) => finding);
  return {
    overallScore,
    grade: assignGrade(overallScore),
    uxScore,
    uxGrade: assignGrade(uxScore),
    contextName: ctx.name,
    metrics: metricResults,
    topIssues,
    totalElements: elements.length,
    viewport,
    timestamp: Date.now(),
    durationMs: Date.now() - startTime
  };
}
var METRIC_CATEGORIES = {
  contentOverflow: "ux",
  aboveFoldRatio: "ux",
  informationDensity: "ux",
  containerEfficiency: "ux",
  viewportUtilization: "ux",
  elementDensity: "density",
  whitespaceRatio: "density",
  localDensityBalance: "density",
  horizontalBalance: "density",
  verticalBalance: "density",
  alignmentConsistency: "density",
  spacingScaleAdherence: "spacing",
  spacingConsistency: "spacing",
  lineHeightRatio: "spacing",
  interGroupSpacingRatio: "spacing",
  uniqueColorCount: "color",
  wcagContrastCompliance: "color",
  colorHarmony: "color",
  saturationConsistency: "color",
  typeScaleAdherence: "typography",
  fontWeightConsistency: "typography",
  headingHierarchy: "typography",
  fontFamilyCount: "typography",
  buttonConsistency: "consistency",
  cardConsistency: "consistency",
  inputConsistency: "consistency",
  touchTargetCompliance: "consistency",
  customPropertyConsistency: "consistency"
};
function getCategoryForMetric(metricId) {
  return METRIC_CATEGORIES[metricId] ?? "density";
}

// src/specs/quality-diff.ts
function createBaseline(elements, viewport, label) {
  return {
    elements: structuredClone(elements),
    viewport: { ...viewport },
    timestamp: Date.now(),
    label
  };
}
var STYLE_PROPERTIES = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textDecoration",
  "color",
  "backgroundColor",
  "border",
  "borderRadius",
  "boxShadow",
  "opacity",
  "gap",
  "flexDirection",
  "justifyContent",
  "alignItems"
];
function diffSnapshots(baseline, current, options) {
  const layoutThreshold = 2;
  const clsThreshold = 0.1;
  const baseMap = /* @__PURE__ */ new Map();
  for (const el of baseline.elements) {
    baseMap.set(el.elementId, el);
  }
  const currentMap = /* @__PURE__ */ new Map();
  for (const el of current) {
    currentMap.set(el.elementId, el);
  }
  const added = [];
  const removed = [];
  const modified = [];
  let totalLayoutShift = 0;
  const viewportArea = baseline.viewport.width * baseline.viewport.height || 1;
  for (const el of current) {
    if (!baseMap.has(el.elementId)) {
      added.push({ elementId: el.elementId, changeType: "added" });
    }
  }
  for (const el of baseline.elements) {
    if (!currentMap.has(el.elementId)) {
      removed.push({ elementId: el.elementId, changeType: "removed" });
    }
  }
  for (const el of current) {
    const baseEl = baseMap.get(el.elementId);
    if (!baseEl) continue;
    const styleChanges = diffStyles(
      baseEl.styles,
      el.styles,
      baseEl.customProperties,
      el.customProperties
    );
    const layoutShift = diffLayout(baseEl, el, layoutThreshold);
    if (styleChanges.length > 0 || layoutShift) {
      modified.push({
        elementId: el.elementId,
        changeType: "modified",
        styleChanges: styleChanges.length > 0 ? styleChanges : void 0,
        layoutShift: layoutShift ?? void 0
      });
      if (layoutShift) {
        const area = el.rect.width * el.rect.height;
        const distance = Math.sqrt(layoutShift.dx ** 2 + layoutShift.dy ** 2);
        const impactFraction = area / viewportArea;
        const distanceFraction = distance / Math.max(baseline.viewport.width, baseline.viewport.height);
        totalLayoutShift += impactFraction * distanceFraction;
      }
    }
  }
  const hasSignificantChanges2 = added.length > 0 || removed.length > 0 || totalLayoutShift > clsThreshold || modified.some((m) => (m.styleChanges?.length ?? 0) > 3);
  return {
    added,
    removed,
    modified,
    cumulativeLayoutShift: Math.round(totalLayoutShift * 1e4) / 1e4,
    hasSignificantChanges: hasSignificantChanges2
  };
}
function diffStyles(oldStyles, newStyles, oldCustomProps, newCustomProps) {
  const changes = [];
  for (const prop of STYLE_PROPERTIES) {
    const oldVal = oldStyles[prop] ?? "";
    const newVal = newStyles[prop] ?? "";
    if (oldVal !== newVal) {
      changes.push({ property: prop, oldValue: oldVal, newValue: newVal });
    }
  }
  const allCustomKeys = /* @__PURE__ */ new Set([
    ...Object.keys(oldCustomProps ?? {}),
    ...Object.keys(newCustomProps ?? {})
  ]);
  for (const key of allCustomKeys) {
    const oldVal = oldCustomProps?.[key] ?? "";
    const newVal = newCustomProps?.[key] ?? "";
    if (oldVal !== newVal) {
      changes.push({ property: key, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}
function diffLayout(oldEl, newEl, threshold) {
  const dx = newEl.rect.x - oldEl.rect.x;
  const dy = newEl.rect.y - oldEl.rect.y;
  const dWidth = newEl.rect.width - oldEl.rect.width;
  const dHeight = newEl.rect.height - oldEl.rect.height;
  if (Math.abs(dx) > threshold || Math.abs(dy) > threshold || Math.abs(dWidth) > threshold || Math.abs(dHeight) > threshold) {
    return { dx, dy, dWidth, dHeight };
  }
  return null;
}

// src/specs/types.ts
var SPEC_CONFIG_VERSION = "1.0.0";
var VALID_ASSERTION_TYPES = [
  "visible",
  "hidden",
  "enabled",
  "disabled",
  "focused",
  "checked",
  "unchecked",
  "hasText",
  "containsText",
  "hasValue",
  "hasClass",
  "exists",
  "notExists",
  "count",
  "attribute",
  "cssProperty",
  "cssPropertyInSet",
  "cssPropertyRange",
  "tokenCompliance",
  "noOverlap",
  "minSpacing"
];
var VALID_SPEC_CATEGORIES = [
  "element-presence",
  "accessibility",
  "form-validation",
  "state-consistency",
  "modal-dialog",
  "navigation",
  "cross-page-consistency",
  "semantic",
  "design",
  "custom",
  "layout"
];
var VALID_SPEC_SEVERITIES = [
  "critical",
  "warning",
  "info"
];
var VALID_SPEC_SOURCES = [
  "auto",
  "manual",
  "ai-generated"
];

// src/specs/validator.ts
function isValidAssertionType(value) {
  return typeof value === "string" && VALID_ASSERTION_TYPES.includes(value);
}
function isValidSpecCategory(value) {
  return typeof value === "string" && VALID_SPEC_CATEGORIES.includes(value);
}
function isValidSpecSeverity(value) {
  return typeof value === "string" && VALID_SPEC_SEVERITIES.includes(value);
}
function isValidSpecSource(value) {
  return typeof value === "string" && VALID_SPEC_SOURCES.includes(value);
}
function validateSpecAssertion(data, path = "assertion") {
  const errors = [];
  if (!data || typeof data !== "object") {
    errors.push({ path, message: "must be an object" });
    return errors;
  }
  const obj = data;
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: "must be a non-empty string" });
  }
  if (typeof obj.description !== "string") {
    errors.push({ path: `${path}.description`, message: "must be a string" });
  }
  if (!isValidSpecCategory(obj.category)) {
    errors.push({
      path: `${path}.category`,
      message: `must be one of: ${VALID_SPEC_CATEGORIES.join(", ")}`
    });
  }
  if (!isValidSpecSeverity(obj.severity)) {
    errors.push({
      path: `${path}.severity`,
      message: `must be one of: ${VALID_SPEC_SEVERITIES.join(", ")}`
    });
  }
  if (!obj.target || typeof obj.target !== "object") {
    errors.push({ path: `${path}.target`, message: "must be an object" });
  } else {
    const target = obj.target;
    if (target.type === "elementId") {
      if (typeof target.elementId !== "string" || target.elementId.length === 0) {
        errors.push({ path: `${path}.target.elementId`, message: "must be a non-empty string" });
      }
    } else if (target.type === "search") {
      if (!target.criteria || typeof target.criteria !== "object") {
        errors.push({ path: `${path}.target.criteria`, message: "must be an object" });
      }
    } else if (target.type === "ctr") {
      if (typeof target.logicalName !== "string" || target.logicalName.length === 0) {
        errors.push({ path: `${path}.target.logicalName`, message: "must be a non-empty string" });
      }
    } else {
      errors.push({
        path: `${path}.target.type`,
        message: 'must be "elementId", "search", or "ctr"'
      });
    }
  }
  if (!isValidAssertionType(obj.assertionType)) {
    errors.push({
      path: `${path}.assertionType`,
      message: `must be one of: ${VALID_ASSERTION_TYPES.join(", ")}`
    });
  }
  if (!isValidSpecSource(obj.source)) {
    errors.push({
      path: `${path}.source`,
      message: `must be one of: ${VALID_SPEC_SOURCES.join(", ")}`
    });
  }
  if (typeof obj.reviewed !== "boolean") {
    errors.push({ path: `${path}.reviewed`, message: "must be a boolean" });
  }
  if (typeof obj.enabled !== "boolean") {
    errors.push({ path: `${path}.enabled`, message: "must be a boolean" });
  }
  if (obj.timeout !== void 0 && (typeof obj.timeout !== "number" || obj.timeout < 0)) {
    errors.push({ path: `${path}.timeout`, message: "must be a non-negative number" });
  }
  return errors;
}
function validateSpecGroup(data, path = "group") {
  const errors = [];
  if (!data || typeof data !== "object") {
    errors.push({ path, message: "must be an object" });
    return errors;
  }
  const obj = data;
  if (typeof obj.id !== "string" || obj.id.length === 0) {
    errors.push({ path: `${path}.id`, message: "must be a non-empty string" });
  }
  if (typeof obj.name !== "string") {
    errors.push({ path: `${path}.name`, message: "must be a string" });
  }
  if (typeof obj.description !== "string") {
    errors.push({ path: `${path}.description`, message: "must be a string" });
  }
  if (!isValidSpecCategory(obj.category)) {
    errors.push({
      path: `${path}.category`,
      message: `must be one of: ${VALID_SPEC_CATEGORIES.join(", ")}`
    });
  }
  if (!isValidSpecSource(obj.source)) {
    errors.push({
      path: `${path}.source`,
      message: `must be one of: ${VALID_SPEC_SOURCES.join(", ")}`
    });
  }
  if (!Array.isArray(obj.assertions)) {
    errors.push({ path: `${path}.assertions`, message: "must be an array" });
  } else {
    for (let i = 0; i < obj.assertions.length; i++) {
      errors.push(...validateSpecAssertion(obj.assertions[i], `${path}.assertions[${i}]`));
    }
  }
  return errors;
}
function validateSpecConfig(data) {
  const errors = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: [{ path: "", message: "must be an object" }] };
  }
  const obj = data;
  if (obj.version !== SPEC_CONFIG_VERSION) {
    errors.push({ path: "version", message: `must be "${SPEC_CONFIG_VERSION}"` });
  }
  if (obj.description !== void 0 && typeof obj.description !== "string") {
    errors.push({ path: "description", message: "must be a string if provided" });
  }
  if (!Array.isArray(obj.groups)) {
    errors.push({ path: "groups", message: "must be an array" });
  } else {
    for (let i = 0; i < obj.groups.length; i++) {
      errors.push(...validateSpecGroup(obj.groups[i], `groups[${i}]`));
    }
  }
  if (obj.assertions !== void 0) {
    if (!Array.isArray(obj.assertions)) {
      errors.push({ path: "assertions", message: "must be an array if provided" });
    } else {
      for (let i = 0; i < obj.assertions.length; i++) {
        errors.push(...validateSpecAssertion(obj.assertions[i], `assertions[${i}]`));
      }
    }
  }
  if (obj.metadata !== void 0 && (typeof obj.metadata !== "object" || obj.metadata === null)) {
    errors.push({ path: "metadata", message: "must be an object if provided" });
  }
  return { valid: errors.length === 0, errors };
}

// src/specs/store.ts
var SpecStore = class {
  constructor() {
    this.configs = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
  }
  // ---------------------------------------------------------------------------
  // CRUD — Config Level
  // ---------------------------------------------------------------------------
  load(specId, config) {
    this.configs.set(specId, config);
    this.emit({ type: "spec:loaded", specId, timestamp: Date.now() });
  }
  unload(specId) {
    const existed = this.configs.delete(specId);
    if (existed) {
      this.emit({ type: "spec:unloaded", specId, timestamp: Date.now() });
    }
    return existed;
  }
  get(specId) {
    return this.configs.get(specId);
  }
  has(specId) {
    return this.configs.has(specId);
  }
  getIds() {
    return Array.from(this.configs.keys());
  }
  getAll() {
    return new Map(this.configs);
  }
  get count() {
    return this.configs.size;
  }
  clear() {
    this.configs.clear();
    this.emit({ type: "spec:cleared", timestamp: Date.now() });
  }
  // ---------------------------------------------------------------------------
  // CRUD — Group Level
  // ---------------------------------------------------------------------------
  addGroup(specId, group) {
    const config = this.configs.get(specId);
    if (!config) return false;
    config.groups.push(group);
    this.emit({ type: "spec:group-added", specId, groupId: group.id, timestamp: Date.now() });
    return true;
  }
  removeGroup(specId, groupId) {
    const config = this.configs.get(specId);
    if (!config) return false;
    const idx = config.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return false;
    config.groups.splice(idx, 1);
    this.emit({ type: "spec:group-removed", specId, groupId, timestamp: Date.now() });
    return true;
  }
  getGroup(specId, groupId) {
    const config = this.configs.get(specId);
    if (!config) return void 0;
    return config.groups.find((g) => g.id === groupId);
  }
  // ---------------------------------------------------------------------------
  // CRUD — Assertion Level
  // ---------------------------------------------------------------------------
  addAssertion(specId, groupId, assertion) {
    const config = this.configs.get(specId);
    if (!config) return false;
    if (groupId) {
      const group = config.groups.find((g) => g.id === groupId);
      if (!group) return false;
      group.assertions.push(assertion);
    } else {
      if (!config.assertions) config.assertions = [];
      config.assertions.push(assertion);
    }
    this.emit({
      type: "spec:assertion-added",
      specId,
      groupId: groupId ?? void 0,
      assertionId: assertion.id,
      timestamp: Date.now()
    });
    return true;
  }
  removeAssertion(specId, groupId, assertionId) {
    const config = this.configs.get(specId);
    if (!config) return false;
    let removed = false;
    if (groupId) {
      const group = config.groups.find((g) => g.id === groupId);
      if (group) {
        const idx = group.assertions.findIndex((a) => a.id === assertionId);
        if (idx !== -1) {
          group.assertions.splice(idx, 1);
          removed = true;
        }
      }
    } else if (config.assertions) {
      const idx = config.assertions.findIndex((a) => a.id === assertionId);
      if (idx !== -1) {
        config.assertions.splice(idx, 1);
        removed = true;
      }
    }
    if (removed) {
      this.emit({
        type: "spec:assertion-removed",
        specId,
        groupId: groupId ?? void 0,
        assertionId,
        timestamp: Date.now()
      });
    }
    return removed;
  }
  toggleAssertion(specId, groupId, assertionId) {
    const assertion = this.findAssertion(specId, groupId, assertionId);
    if (!assertion) return false;
    assertion.enabled = !assertion.enabled;
    this.emit({ type: "spec:updated", specId, timestamp: Date.now() });
    return true;
  }
  markReviewed(specId, groupId, assertionId) {
    const assertion = this.findAssertion(specId, groupId, assertionId);
    if (!assertion) return false;
    assertion.reviewed = !assertion.reviewed;
    this.emit({ type: "spec:updated", specId, timestamp: Date.now() });
    return true;
  }
  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  getAllAssertions() {
    const result = [];
    for (const config of this.configs.values()) {
      for (const group of config.groups) {
        result.push(...group.assertions);
      }
      if (config.assertions) {
        result.push(...config.assertions);
      }
    }
    return result;
  }
  filterAssertions(opts) {
    return this.getAllAssertions().filter((a) => {
      if (opts.categories && !opts.categories.includes(a.category)) return false;
      if (opts.severities && !opts.severities.includes(a.severity)) return false;
      if (opts.enabledOnly && !a.enabled) return false;
      if (opts.reviewedOnly && !a.reviewed) return false;
      return true;
    });
  }
  // ---------------------------------------------------------------------------
  // Coverage
  // ---------------------------------------------------------------------------
  getCoverage(allElementIds) {
    const specifiedIdSet = /* @__PURE__ */ new Set();
    for (const assertion of this.getAllAssertions()) {
      if (assertion.target.type === "elementId") {
        specifiedIdSet.add(assertion.target.elementId);
      }
    }
    const specifiedIds = [];
    const unspecifiedIds = [];
    for (const id of allElementIds) {
      if (specifiedIdSet.has(id)) {
        specifiedIds.push(id);
      } else {
        unspecifiedIds.push(id);
      }
    }
    const total = allElementIds.length;
    return {
      totalElements: total,
      specifiedElements: specifiedIds.length,
      coveragePercent: total > 0 ? specifiedIds.length / total * 100 : 0,
      specifiedIds,
      unspecifiedIds,
      timestamp: Date.now()
    };
  }
  // ---------------------------------------------------------------------------
  // Import / Export
  // ---------------------------------------------------------------------------
  importConfig(specId, config) {
    const result = validateSpecConfig(config);
    if (!result.valid) return false;
    this.configs.set(specId, config);
    this.emit({ type: "spec:loaded", specId, timestamp: Date.now() });
    return true;
  }
  exportConfig(specId) {
    const config = this.configs.get(specId);
    if (!config) return void 0;
    return {
      ...config,
      version: SPEC_CONFIG_VERSION,
      metadata: {
        ...config.metadata,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  }
  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  on(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
  // Private Helpers
  // ---------------------------------------------------------------------------
  findAssertion(specId, groupId, assertionId) {
    const config = this.configs.get(specId);
    if (!config) return void 0;
    if (groupId) {
      const group = config.groups.find((g) => g.id === groupId);
      if (!group) return void 0;
      return group.assertions.find((a) => a.id === assertionId);
    }
    return config.assertions?.find((a) => a.id === assertionId);
  }
};
var GLOBAL_KEY = "__uiBridgeSpecStore";
function getGlobalSpecStore() {
  const g = globalThis;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new SpecStore();
  }
  return g[GLOBAL_KEY];
}

// src/server/handlers.ts
init_error_fingerprint();

// src/debug/error-timeline.ts
init_error_fingerprint();
init_shared_utils();
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

// src/debug/error-session.ts
init_error_fingerprint();
init_shared_utils();
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

// src/debug/network-chain.ts
var REQUEST_ID_HEADERS = [
  "x-request-id",
  "x-correlation-id",
  "x-trace-id",
  "traceparent",
  "x-amzn-requestid",
  "x-amzn-trace-id"
];
var DEFAULT_CONFIG3 = {
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
    this.config = { ...DEFAULT_CONFIG3, ...rest };
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
      for (const error3 of consoleErrors) {
        if (chain.correlatedErrors.some(
          (ce) => ce.message === error3.message && ce.timestamp === error3.timestamp
        )) {
          continue;
        }
        if (urlSuffix && error3.message.includes(urlSuffix)) {
          chain.correlatedErrors.push({
            message: error3.message,
            timestamp: error3.timestamp,
            correlationType: "url-mention"
          });
          continue;
        }
        if (error3.message.includes(chain.request.url)) {
          chain.correlatedErrors.push({
            message: error3.message,
            timestamp: error3.timestamp,
            correlationType: "url-mention"
          });
          continue;
        }
        if (chain.requestId && error3.message.includes(chain.requestId)) {
          chain.correlatedErrors.push({
            message: error3.message,
            timestamp: error3.timestamp,
            correlationType: "request-id"
          });
          continue;
        }
        if (chain.isFailure && Math.abs(error3.timestamp - responseTime) <= this.config.correlationWindowMs) {
          chain.correlatedErrors.push({
            message: error3.message,
            timestamp: error3.timestamp,
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
init_error_fingerprint();
init_shared_utils();
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
init_error_fingerprint();
init_shared_utils();
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
        (error3) => {
          self.completeRequest(id, 0);
          throw error3;
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

// src/network/tracker.ts
var REQUEST_ID_HEADERS2 = [
  "x-request-id",
  "x-amzn-requestid",
  "x-amz-request-id",
  "cf-ray",
  "x-trace-id",
  "traceparent"
];
var NetworkRequestTracker = class {
  constructor(config) {
    this.inFlight = /* @__PURE__ */ new Map();
    this.completed = [];
    this.listeners = [];
    this.installed = false;
    this.requestCounter = 0;
    // Saved originals for restore
    this.originalFetch = null;
    this.originalXHROpen = null;
    this.originalXHRSend = null;
    this.config = {
      ignorePatterns: config?.ignorePatterns ?? [],
      maxEntries: config?.maxEntries ?? 200,
      trackXHR: config?.trackXHR ?? true,
      maxBodyPreview: config?.maxBodyPreview ?? 500,
      errorBodiesOnly: config?.errorBodiesOnly ?? true,
      captureHeaders: config?.captureHeaders ?? true
    };
  }
  // =========================================================================
  // Install / Destroy
  // =========================================================================
  /** Patch fetch and optionally XHR to begin tracking requests. */
  install() {
    if (this.installed) return;
    this.installed = true;
    this.installFetchInterceptor();
    if (this.config.trackXHR) {
      this.installXHRInterceptor();
    }
  }
  /** Restore original fetch/XHR and clear all state. */
  destroy() {
    if (!this.installed) return;
    this.installed = false;
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
    this.inFlight.clear();
    this.completed = [];
    this.listeners = [];
    this.requestCounter = 0;
  }
  // =========================================================================
  // Query Methods
  // =========================================================================
  /** Return all currently in-flight request entries. */
  getInFlight() {
    return [...this.inFlight.values()];
  }
  /** Return completed request entries, optionally filtered. */
  getCompleted(filter) {
    if (!filter) return [...this.completed];
    return this.applyFilter([...this.completed], filter);
  }
  /** Return all entries (in-flight + completed), optionally filtered. */
  getAll(filter) {
    const all = [...this.inFlight.values(), ...this.completed];
    if (!filter) return all;
    return this.applyFilter(all, filter);
  }
  /** Look up a single entry by its unique ID. */
  getById(id) {
    return this.inFlight.get(id) ?? this.completed.find((e) => e.request.id === id);
  }
  // =========================================================================
  // Wait
  // =========================================================================
  /**
   * Wait for a matching network request to complete.
   *
   * Modes:
   * - `existing` — only check currently in-flight requests.
   * - `next` — ignore existing, wait for the next matching request.
   * - `any` (default) — check in-flight first, then recently completed, then wait.
   */
  async waitForRequest(options) {
    const timeout = options?.timeout ?? 3e4;
    const mode2 = options?.mode ?? "any";
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      if (mode2 !== "next") {
        for (const entry of this.inFlight.values()) {
          if (this.matchesWaitOptions(entry, options ?? {})) {
            const unsub2 = this.onEvent((event) => {
              if (event.entry.request.id === entry.request.id && event.type !== "request-start") {
                unsub2();
                clearTimeout(timer2);
                resolve({ entry: event.entry, timedOut: false });
              }
            });
            const timer2 = setTimeout(() => {
              unsub2();
              resolve({ entry, timedOut: true });
            }, timeout);
            return;
          }
        }
      }
      if (mode2 === "any") {
        const match = [...this.completed].reverse().find(
          (e) => this.matchesWaitOptions(e, options ?? {}) && e.completedAt != null && e.completedAt >= startTime - 1e3
        );
        if (match) {
          resolve({ entry: match, timedOut: false });
          return;
        }
      }
      const unsub = this.onEvent((event) => {
        if (event.type !== "request-start" && this.matchesWaitOptions(event.entry, options ?? {})) {
          unsub();
          clearTimeout(timer);
          resolve({ entry: event.entry, timedOut: false });
        }
      });
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`waitForRequest timed out after ${timeout}ms`));
      }, timeout);
    });
  }
  // =========================================================================
  // Event Subscription
  // =========================================================================
  /** Subscribe to network events. Returns an unsubscribe function. */
  onEvent(callback) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
  /** Clear the completed entries buffer (in-flight entries are preserved). */
  clear() {
    this.completed = [];
  }
  // =========================================================================
  // Private — Interceptors
  // =========================================================================
  installFetchInterceptor() {
    const origFetch = globalThis.fetch;
    this.originalFetch = origFetch;
    const tracker = this;
    globalThis.fetch = async function(input, init) {
      const url = getUrl2(input);
      if (tracker.shouldIgnore(url)) {
        return origFetch.call(globalThis, input, init);
      }
      const method = getMethod2(input, init);
      const id = tracker.generateId();
      const entry = {
        request: {
          id,
          method,
          url,
          pathname: tryParsePathname(url),
          headers: tracker.extractHeaders(init?.headers, tracker.config.captureHeaders),
          bodyPreview: await tracker.captureBodyPreview(init?.body),
          startedAt: Date.now(),
          status: "in-flight"
        },
        isFailure: false
      };
      tracker.inFlight.set(id, entry);
      tracker.emitEvent({
        type: "request-start",
        entry,
        pendingCount: tracker.inFlight.size,
        timestamp: Date.now()
      });
      try {
        const response = await origFetch.call(globalThis, input, init);
        const durationMs = Date.now() - entry.request.startedAt;
        const isError = response.status >= 400;
        entry.request.status = isError ? "failed" : "completed";
        entry.response = {
          statusCode: response.status,
          statusText: response.statusText,
          headers: tracker.extractHeaders(response.headers, tracker.config.captureHeaders),
          durationMs
        };
        entry.isFailure = isError;
        entry.completedAt = Date.now();
        entry.requestId = tracker.extractRequestId(response.headers);
        entry.response.bodyPreview = await tracker.captureResponsePreview(
          response.clone(),
          isError
        );
        tracker.inFlight.delete(id);
        tracker.completed.push(entry);
        tracker.trimCompleted();
        tracker.emitEvent({
          type: isError ? "request-error" : "request-complete",
          entry,
          pendingCount: tracker.inFlight.size,
          timestamp: Date.now()
        });
        return response;
      } catch (err) {
        entry.request.status = "failed";
        entry.error = err instanceof Error ? err.message : String(err);
        entry.isFailure = true;
        entry.completedAt = Date.now();
        tracker.inFlight.delete(id);
        tracker.completed.push(entry);
        tracker.trimCompleted();
        tracker.emitEvent({
          type: "request-error",
          entry,
          pendingCount: tracker.inFlight.size,
          timestamp: Date.now()
        });
        throw err;
      }
    };
  }
  installXHRInterceptor() {
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;
    const tracker = this;
    XMLHttpRequest.prototype.open = function(method, url, async, username, password) {
      const xhr = this;
      xhr.__netTrackerMethod = method;
      xhr.__netTrackerUrl = typeof url === "string" ? url : url.href;
      return tracker.originalXHROpen.call(this, method, url, async ?? true, username, password);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const xhr = this;
      const url = xhr.__netTrackerUrl || "";
      const method = (xhr.__netTrackerMethod || "GET").toUpperCase();
      if (tracker.shouldIgnore(url)) {
        return tracker.originalXHRSend.call(this, body);
      }
      const id = tracker.generateId();
      xhr.__netTrackerId = id;
      const entry = {
        request: {
          id,
          method,
          url,
          pathname: tryParsePathname(url),
          bodyPreview: typeof body === "string" ? truncate2(body, tracker.config.maxBodyPreview) : void 0,
          startedAt: Date.now(),
          status: "in-flight"
        },
        isFailure: false
      };
      tracker.inFlight.set(id, entry);
      tracker.emitEvent({
        type: "request-start",
        entry,
        pendingCount: tracker.inFlight.size,
        timestamp: Date.now()
      });
      xhr.addEventListener("loadend", () => {
        const durationMs = Date.now() - entry.request.startedAt;
        const isError = xhr.status === 0 || xhr.status >= 400;
        entry.request.status = isError ? "failed" : "completed";
        entry.response = {
          statusCode: xhr.status,
          statusText: xhr.statusText,
          durationMs
        };
        entry.isFailure = isError;
        entry.completedAt = Date.now();
        if (isError || !tracker.config.errorBodiesOnly) {
          try {
            const responseText = xhr.responseType === "" || xhr.responseType === "text" ? xhr.responseText : void 0;
            if (responseText) {
              entry.response.bodyPreview = truncate2(responseText, tracker.config.maxBodyPreview);
            }
          } catch {
          }
        }
        entry.requestId = tracker.extractRequestIdFromXHR(xhr);
        if (tracker.config.captureHeaders) {
          entry.response.headers = tracker.parseXHRResponseHeaders(xhr);
        }
        tracker.inFlight.delete(id);
        tracker.completed.push(entry);
        tracker.trimCompleted();
        tracker.emitEvent({
          type: isError ? "request-error" : "request-complete",
          entry,
          pendingCount: tracker.inFlight.size,
          timestamp: Date.now()
        });
      });
      xhr.addEventListener("error", () => {
        entry.error = "Network error";
      });
      xhr.addEventListener("abort", () => {
        entry.request.status = "cancelled";
        entry.error = "Request aborted";
      });
      return tracker.originalXHRSend.call(this, body);
    };
  }
  // =========================================================================
  // Private — Helpers
  // =========================================================================
  shouldIgnore(url) {
    return this.config.ignorePatterns.some((p) => url.includes(p));
  }
  generateId() {
    return `net-${++this.requestCounter}`;
  }
  extractHeaders(headers, capture) {
    if (!capture || !headers) return void 0;
    const result = {};
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        result[key] = value;
      });
    } else if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        result[key] = value;
      }
    } else {
      for (const [key, value] of Object.entries(headers)) {
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : void 0;
  }
  async captureBodyPreview(body) {
    if (!body) return void 0;
    if (typeof body === "string") {
      return truncate2(body, this.config.maxBodyPreview);
    }
    return void 0;
  }
  async captureResponsePreview(response, isError) {
    if (!isError && this.config.errorBodiesOnly) return void 0;
    try {
      const text = await response.text();
      return truncate2(text, this.config.maxBodyPreview);
    } catch {
      return void 0;
    }
  }
  extractRequestId(headers) {
    for (const name of REQUEST_ID_HEADERS2) {
      const value = headers.get(name);
      if (value) return value;
    }
    return void 0;
  }
  extractRequestIdFromXHR(xhr) {
    for (const name of REQUEST_ID_HEADERS2) {
      const value = xhr.getResponseHeader(name);
      if (value) return value;
    }
    return void 0;
  }
  parseXHRResponseHeaders(xhr) {
    const raw = xhr.getAllResponseHeaders();
    if (!raw) return void 0;
    const result = {};
    const lines = raw.trim().split(/[\r\n]+/);
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : void 0;
  }
  trimCompleted() {
    if (this.completed.length > this.config.maxEntries) {
      this.completed = this.completed.slice(this.completed.length - this.config.maxEntries);
    }
  }
  emitEvent(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
  matchesFilter(entry, filter) {
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      if (!statuses.includes(entry.request.status)) return false;
    }
    if (filter.method) {
      const methods = Array.isArray(filter.method) ? filter.method : [filter.method];
      const upperMethods = methods.map((m) => m.toUpperCase());
      if (!upperMethods.includes(entry.request.method)) return false;
    }
    if (filter.urlPattern) {
      if (!entry.request.url.includes(filter.urlPattern)) return false;
    }
    if (filter.urlRegex) {
      const re = new RegExp(filter.urlRegex);
      if (!re.test(entry.request.url)) return false;
    }
    if (filter.failuresOnly && !entry.isFailure) return false;
    if (filter.since != null && entry.request.startedAt < filter.since) return false;
    if (filter.minStatus != null && entry.response) {
      if (entry.response.statusCode < filter.minStatus) return false;
    }
    if (filter.maxStatus != null && entry.response) {
      if (entry.response.statusCode > filter.maxStatus) return false;
    }
    return true;
  }
  applyFilter(entries, filter) {
    let result = entries.filter((e) => this.matchesFilter(e, filter));
    if (filter.limit != null && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }
    return result;
  }
  matchesWaitOptions(entry, options) {
    if (options.method && entry.request.method !== options.method.toUpperCase()) {
      return false;
    }
    if (options.urlPattern && !entry.request.url.includes(options.urlPattern)) {
      return false;
    }
    if (options.urlRegex) {
      const re = new RegExp(options.urlRegex);
      if (!re.test(entry.request.url)) return false;
    }
    return true;
  }
};
function getUrl2(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}
function getMethod2(input, init) {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}
function tryParsePathname(url) {
  try {
    const parsed = new URL(url, typeof location !== "undefined" ? location.href : void 0);
    return parsed.pathname;
  } catch {
    return void 0;
  }
}
function truncate2(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// src/core/change-observer.ts
var DEFAULT_CONFIG4 = {
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
    this.config = { ...DEFAULT_CONFIG4, ...config };
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

// src/server/handlers.ts
function parseNLAssertion2(request) {
  if (request.target && request.type) return request;
  const parsed = parseNLAssertion(request);
  return {
    ...request,
    target: parsed.target,
    type: parsed.type,
    expected: parsed.expected
  };
}
function normalizeBatchAssertions(request) {
  return {
    ...request,
    mode: request.mode || "all",
    assertions: (request.assertions || []).map(
      (a) => typeof a === "string" ? parseNLAssertion2({ assertion: a }) : parseNLAssertion2(a)
    )
  };
}
function materializeElements(rawElements) {
  return rawElements.map((raw) => {
    const el = raw;
    const ariaLabel = el.element?.getAttribute?.("aria-label") ?? void 0;
    const titleAttr = el.element?.getAttribute?.("title") ?? void 0;
    return {
      id: el.id,
      type: el.type,
      tagName: el.element?.tagName?.toLowerCase?.(),
      label: el.label,
      ariaLabel: ariaLabel || void 0,
      title: titleAttr || void 0,
      identifier: el.getIdentifier?.(),
      state: el.getState?.(),
      actions: el.actions,
      customActions: el.customActions ? Object.keys(el.customActions) : void 0,
      category: el.category,
      contentMetadata: el.contentMetadata,
      mediaMetadata: el.mediaMetadata,
      // Live bbox/visibility maintained by `useUIElement`. Present for
      // SDK-registered elements; absent for DOM-fallback scans.
      bbox: el.bbox,
      visible: el.visible
    };
  });
}
function annotateComponentWithInvocationPaths(comp) {
  const c = comp ?? {};
  const id = typeof c.id === "string" ? c.id : "";
  const rawActions = Array.isArray(c.actions) ? c.actions : [];
  const annotatedActions = rawActions.map((a) => {
    if (a && typeof a === "object" && "id" in a) {
      const action = a;
      return {
        ...action,
        path: `/control/component/${id}/action/${action.id}`
      };
    }
    return a;
  });
  return {
    ...c,
    actions: annotatedActions,
    actionInvocationPath: `/control/component/${id}/action/{actionId}`
  };
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
function getRecoverySuggestions(errorCode) {
  switch (errorCode) {
    case "ELEMENT_NOT_FOUND":
      return [
        {
          suggestion: "Wait for the page to fully load",
          command: "wait for page to load",
          confidence: 0.7,
          retryable: true
        },
        {
          suggestion: "Use a different description for the element",
          confidence: 0.8,
          retryable: false
        },
        {
          suggestion: "Scroll the page to reveal the element",
          command: "scroll down",
          confidence: 0.6,
          retryable: true
        }
      ];
    case "ELEMENT_NOT_VISIBLE":
      return [
        {
          suggestion: "Scroll to make the element visible",
          command: "scroll to element",
          confidence: 0.9,
          retryable: true
        },
        {
          suggestion: "Wait for any loading overlays to disappear",
          confidence: 0.7,
          retryable: true
        },
        {
          suggestion: "Close any blocking modals or popups",
          command: "click close button",
          confidence: 0.8,
          retryable: true
        }
      ];
    case "ELEMENT_NOT_ENABLED":
      return [
        { suggestion: "Fill in required fields first", confidence: 0.8, retryable: false },
        {
          suggestion: "Complete prerequisite steps in the form",
          confidence: 0.7,
          retryable: false
        },
        {
          suggestion: "Wait for the element to become enabled",
          command: "wait for element to be enabled",
          confidence: 0.6,
          retryable: true
        }
      ];
    case "ELEMENT_NOT_INTERACTABLE":
      return [
        {
          suggestion: "Close any modal or popup blocking the element",
          command: "click close button",
          confidence: 0.9,
          retryable: true
        },
        { suggestion: "Wait for animations to complete", confidence: 0.7, retryable: true },
        {
          suggestion: "Scroll the element into the viewport",
          command: "scroll to element",
          confidence: 0.8,
          retryable: true
        }
      ];
    case "ACTION_TIMEOUT":
      return [
        { suggestion: "Increase the timeout duration", confidence: 0.8, retryable: true },
        { suggestion: "Check if the condition can ever be met", confidence: 0.7, retryable: false },
        {
          suggestion: "Verify the page is responding",
          command: "check page status",
          confidence: 0.6,
          retryable: true
        }
      ];
    case "LOW_CONFIDENCE":
      return [
        {
          suggestion: "Use the exact text shown on the element",
          confidence: 0.9,
          retryable: false
        },
        {
          suggestion: "Try a different description that more closely matches the element",
          confidence: 0.8,
          retryable: false
        },
        {
          suggestion: "Lower the confidence threshold if the match is correct",
          confidence: 0.7,
          retryable: true
        }
      ];
    case "AMBIGUOUS_MATCH":
      return [
        {
          suggestion: "Be more specific about which element you mean",
          confidence: 0.9,
          retryable: false
        },
        {
          suggestion: "Include the section or form name in the description",
          confidence: 0.8,
          retryable: false
        },
        { suggestion: "Use the element ID directly", confidence: 0.7, retryable: false }
      ];
    default:
      return [
        {
          suggestion: "Try a different approach or check the page state",
          confidence: 0.5,
          retryable: false
        }
      ];
  }
}
function createFailureDetails(errorCode, message, options = {}) {
  const retryableErrors = [
    "ELEMENT_NOT_VISIBLE",
    "ACTION_TIMEOUT",
    "LOW_CONFIDENCE",
    "NETWORK_ERROR",
    "STATE_NOT_REACHED"
  ];
  return {
    errorCode,
    message,
    elementId: options.elementId,
    selectorsTried: options.selectorsTried,
    suggestedActions: getRecoverySuggestions(errorCode),
    retryRecommended: retryableErrors.includes(errorCode),
    durationMs: options.durationMs,
    timeoutMs: options.timeoutMs
  };
}
function createHandlers(registry, actionExecutor, config = {}) {
  const searchEngine = new SearchEngine();
  const nlExecutor = new NLActionExecutor();
  const assertionExecutor = new AssertionExecutor();
  const snapshotManager = new SemanticSnapshotManager();
  const diffManager = new SemanticDiffManager();
  const intentRegistry = /* @__PURE__ */ new Map();
  const consoleCapture = config.consoleCapture ?? null;
  const modalDetector = config.modalDetector ?? null;
  const navAdapter = config.navigationAdapter ?? new WindowLocationAdapter();
  const undoTracker = config.undoTracker ?? null;
  const specStore = config.specStore ?? getGlobalSpecStore();
  const timelineBuffer = new TimelineBuffer(500);
  const errorSessionManager = new ErrorSessionManager();
  const networkTracker = config.networkMonitoring !== false ? new NetworkRequestTracker(
    typeof config.networkMonitoring === "object" ? config.networkMonitoring : void 0
  ) : null;
  if (networkTracker) {
    networkTracker.install();
  }
  const networkChainTracker = new NetworkChainTracker(
    networkTracker ? { tracker: networkTracker } : void 0
  );
  networkChainTracker.install();
  const errorSnapshotBuffer = new ErrorSnapshotBuffer({
    capturePageState: () => {
      const snapshot = registry.createSnapshot();
      const visibleErrors = [];
      if (typeof document !== "undefined") {
        const errorElements = document.querySelectorAll(
          '[role="alert"], .error, .toast-error, .error-message, [data-error]'
        );
        errorElements.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) visibleErrors.push(text.slice(0, 200));
        });
      }
      return {
        url: typeof window !== "undefined" ? window.location.href : "",
        title: typeof document !== "undefined" ? document.title : "",
        elementCount: snapshot.elements.length,
        visibleErrors
      };
    },
    getRecentActions: () => {
      const history = registry.getActionHistory?.();
      return (history ?? []).slice(-5).map((a) => a.description ?? "unknown action");
    }
  });
  const browserEventStream = new BrowserEventStream();
  if (config.onBrowserEvent) {
    browserEventStream.subscribe({
      minSeverity: "warning",
      deduplicate: true
    });
  }
  function hasFullEventAPI(cap) {
    return cap !== null && "getSince" in cap && "getRecent" in cap && "getByType" in cap;
  }
  const browserEventListeners = [];
  if (consoleCapture && "setOnEvent" in consoleCapture && typeof consoleCapture.setOnEvent === "function") {
    const emitBrowserEvent = config.onBrowserEvent;
    consoleCapture.setOnEvent((event) => {
      errorSessionManager.recordEvent(event);
      errorSnapshotBuffer.processEvent(event);
      const messages = browserEventStream.processEvent(event);
      if (emitBrowserEvent && messages.size > 0) {
        const { severity } = classifyEvent(event);
        const eventType = severity === "crash" ? "browser:crash" : severity === "error" ? "browser:error" : "browser:warning";
        emitBrowserEvent({
          type: eventType,
          timestamp: Date.now(),
          data: { event, severity }
        });
      }
      for (const listener of browserEventListeners) {
        try {
          listener(event);
        } catch {
        }
      }
    });
  }
  const annotationStore = config.annotationStore ?? getGlobalAnnotationStore();
  let loadedStyleGuide = null;
  let savedBaseline = null;
  const idleDetector = config.idleDetection !== false ? CompositeIdleDetector.create(
    (() => {
      const idleConfig = typeof config.idleDetection === "object" ? { ...config.idleDetection } : {};
      if (networkTracker) {
        idleConfig.network = { ...idleConfig.network, tracker: networkTracker };
      }
      return idleConfig;
    })()
  ) : null;
  if (idleDetector && config.onIdleEvent) {
    const emit = config.onIdleEvent;
    const mkEvent = (type, data) => ({
      type,
      timestamp: Date.now(),
      data
    });
    idleDetector.onTransition((status) => {
      emit(mkEvent(status.idle ? "app:idle" : "app:busy", status));
    });
    const networkSignal = idleDetector.getSignal("network");
    if (networkSignal) {
      networkSignal.onTransition((idle, status) => {
        emit(mkEvent(idle ? "network:idle" : "network:busy", status));
      });
      networkSignal.onRequestStart = (data) => {
        emit(mkEvent("network:requestStart", data));
      };
      networkSignal.onRequestEnd = (data) => {
        emit(mkEvent("network:requestEnd", data));
      };
    }
    const domSignal = idleDetector.getSignal("dom");
    if (domSignal) {
      domSignal.onTransition((idle, status) => {
        emit(mkEvent(idle ? "dom:settled" : "dom:mutating", status));
      });
    }
    const loadingSignal = idleDetector.getSignal("loading-indicators");
    if (loadingSignal) {
      loadingSignal.onTransition((idle, status) => {
        emit(mkEvent(idle ? "loading:cleared" : "loading:detected", status));
      });
    }
    const formMutationSignal = idleDetector.getSignal("form-mutation");
    if (formMutationSignal) {
      formMutationSignal.onTransition((idle, status) => {
        emit(mkEvent(idle ? "form:settled" : "form:mutating", status));
      });
    }
  }
  if (idleDetector && typeof actionExecutor.setIdleDetector === "function") {
    actionExecutor.setIdleDetector(idleDetector);
  }
  async function awaitDOMSettled(timeout = 500) {
    if (!idleDetector) return;
    const domSignal = idleDetector.getSignal("dom");
    if (!domSignal || domSignal.isIdle()) return;
    try {
      await domSignal.waitForIdle({ timeout, minStableMs: 0 });
    } catch {
    }
  }
  const changeObserver = new ChangeObserver({ bufferCapacity: 5e3, batchIntervalMs: 16 });
  if (registry.on) {
    registry.on("element:registered", (event) => {
      const id = event.data?.id;
      if (id) changeObserver.onElementAdded(id);
    });
    registry.on("element:unregistered", (event) => {
      const id = event.data?.id;
      if (id) changeObserver.onElementRemoved(id);
    });
    registry.on("element:stateChanged", (event) => {
      const id = event.data?.id ?? event.data?.elementId;
      if (id) changeObserver.onElementModified(id);
    });
  }
  if (config.onChangeEvent) {
    const emitChange = config.onChangeEvent;
    changeObserver.subscribe((domChange) => {
      emitChange({
        type: "snapshot:changed",
        timestamp: domChange.timestamp,
        data: domChange
      });
    });
  }
  const changeTracker = new ChangeTracker({
    snapshotManager,
    idleDetector,
    createControlSnapshot: () => registry.createSnapshot(),
    executeNLAction: async (instruction) => {
      refreshElements();
      return nlExecutor.execute({ instruction });
    },
    executeElementAction: async (elementId, request) => {
      return actionExecutor.executeAction(elementId, request);
    },
    refreshElements: () => refreshElements(),
    subscribeChanges: (callback) => {
      return changeObserver.subscribe((event) => {
        callback({ type: "snapshot:changed", timestamp: event.timestamp });
      });
    },
    resolveScope: (scope) => {
      if (typeof document === "undefined") return null;
      try {
        const container = document.querySelector(scope);
        if (!container) return null;
        const ids = /* @__PURE__ */ new Set();
        const allElements = registry.getAllElements();
        for (const el of allElements) {
          if (el.element && container.contains(el.element)) {
            ids.add(el.id);
          }
        }
        return ids;
      } catch {
        return null;
      }
    },
    // Tier 3.3: hook into BrowserEventCapture for console errors via the shared broadcaster
    subscribeBrowserEvents: consoleCapture && "setOnEvent" in consoleCapture ? (callback) => {
      const listener = (event) => {
        if (event.type === "console") {
          callback({
            type: event.type,
            timestamp: event.timestamp,
            level: event.level,
            message: event.message,
            stack: event.stack
          });
        }
      };
      browserEventListeners.push(listener);
      return () => {
        const idx = browserEventListeners.indexOf(listener);
        if (idx >= 0) browserEventListeners.splice(idx, 1);
      };
    } : void 0,
    // Tier 3.3: hook into NetworkRequestTracker for network requests
    subscribeNetworkEvents: networkTracker ? (callback) => {
      return networkTracker.onEvent((event) => {
        callback({
          type: event.type,
          timestamp: event.timestamp,
          entry: {
            request: {
              url: event.entry.request.url,
              method: event.entry.request.method,
              startedAt: event.entry.request.startedAt
            },
            response: event.entry.response ? {
              statusCode: event.entry.response.statusCode,
              durationMs: event.entry.response.durationMs
            } : void 0
          }
        });
      });
    } : void 0
  });
  function refreshElements() {
    let elements = registry.getAllElements();
    if (elements.length === 0) {
      const domElements = scanDOMForInteractiveElements();
      if (domElements.length > 0) {
        elements = domElements;
      }
    }
    searchEngine.updateElements(elements);
    nlExecutor.updateElements(elements);
    nlExecutor.setActionExecutor(actionExecutor);
    assertionExecutor.updateElements(elements);
  }
  function applyFindFilters(elements, request) {
    return elements.filter((el) => {
      if (request.interactiveOnly || request.interactive_only) {
        if (el.kind === "content") return false;
        const interactiveTypes = /* @__PURE__ */ new Set([
          "button",
          "input",
          "select",
          "textarea",
          "link",
          "checkbox",
          "radio",
          "switch",
          "tab",
          "slider",
          "menuitem"
        ]);
        const isInteractive2 = interactiveTypes.has(el.type) || el.actions && el.actions.length > 0;
        if (!isInteractive2) return false;
      }
      if (request.types && el.type && !request.types.includes(el.type)) return false;
      if (request.element_type && el.type && el.type !== request.element_type) return false;
      if (request.role) {
        const elRole = (el.role || "").toLowerCase();
        if (elRole !== request.role.toLowerCase()) return false;
      }
      if (request.text) {
        const searchText = request.text.toLowerCase();
        const label = (el.label || "").toLowerCase();
        const textContent = (el.state?.textContent || el.textContent || "").toLowerCase();
        const accessibleName = (el.accessibleName || "").toLowerCase();
        if (!label.includes(searchText) && !textContent.includes(searchText) && !accessibleName.includes(searchText)) {
          return false;
        }
      }
      if (request.exact_text) {
        const exactLc = request.exact_text.toLowerCase();
        const elLabel = (el.label || "").toLowerCase();
        const textContent = (el.state?.textContent || el.textContent || "").trim().toLowerCase();
        const accessibleName = (el.accessibleName || "").toLowerCase();
        if (elLabel !== exactLc && textContent !== exactLc && accessibleName !== exactLc) {
          return false;
        }
      }
      if (request.label) {
        const labelSearch = request.label.toLowerCase();
        const elLabel = (el.label || "").toLowerCase();
        if (!elLabel.includes(labelSearch)) return false;
      }
      if (request.testId) {
        const elTestId = el.testId || el.identifiers?.testId || "";
        if (elTestId !== request.testId) return false;
      }
      return true;
    });
  }
  return {
    // =========================================================================
    // Render Log Handlers
    // =========================================================================
    getRenderLog: async (query) => {
      try {
        const entries = registry.getRenderLog?.() ?? [];
        let filtered = entries;
        if (query?.type) {
          filtered = filtered.filter((e) => e.type === query.type);
        }
        if (query?.since) {
          filtered = filtered.filter((e) => e.timestamp >= query.since);
        }
        if (query?.until) {
          filtered = filtered.filter((e) => e.timestamp <= query.until);
        }
        if (query?.limit) {
          filtered = filtered.slice(0, query.limit);
        }
        return success(filtered);
      } catch (err) {
        return error(err.message, "RENDER_LOG_ERROR");
      }
    },
    clearRenderLog: async () => {
      try {
        registry.clearRenderLog?.();
        return success(void 0);
      } catch (err) {
        return error(err.message, "RENDER_LOG_ERROR");
      }
    },
    captureSnapshot: async () => {
      try {
        const snapshot = registry.captureSnapshot?.();
        return success(snapshot);
      } catch (err) {
        return error(err.message, "SNAPSHOT_ERROR");
      }
    },
    getRenderLogPath: async () => {
      return success({ path: config.renderLogPath || "" });
    },
    // =========================================================================
    // Element Handlers
    // =========================================================================
    getElements: async (options) => {
      try {
        const elements = registry.getAllElements();
        let materialized = materializeElements(elements);
        if (options?.title || options?.aria_label || options?.text) {
          materialized = materialized.filter(
            (el) => matchesElementSelector(el, {
              title: options?.title,
              aria_label: options?.aria_label,
              text: options?.text
            })
          );
        }
        return success(materialized);
      } catch (err) {
        return error(err.message, "ELEMENTS_ERROR");
      }
    },
    rankElements: async (request) => {
      try {
        const elements = registry.getAllElements();
        const materialized = materializeElements(elements);
        const matches = findElements(
          materialized,
          request ?? {}
        );
        return success(
          matches.map((m) => ({
            id: m.id,
            score: m.score,
            reasons: m.reasons,
            element: m.element
          }))
        );
      } catch (err) {
        return error(err.message, "RANK_ELEMENTS_ERROR");
      }
    },
    getElement: async (id) => {
      try {
        const element = registry.getElement(id);
        if (!element) {
          const failureDetails = createFailureDetails(
            "ELEMENT_NOT_FOUND",
            `Element not found: ${id}`,
            {
              elementId: id,
              selectorsTried: [id]
            }
          );
          return {
            success: false,
            error: `Element not found: ${id}`,
            code: "ELEMENT_NOT_FOUND",
            data: { failureDetails },
            timestamp: Date.now()
          };
        }
        return success(materializeElements([element])[0]);
      } catch (err) {
        return error(err.message, "ELEMENT_ERROR");
      }
    },
    getElementState: async (id) => {
      try {
        const element = registry.getElement(id);
        if (!element) {
          return error(`Element not found: ${id}`, "NOT_FOUND");
        }
        return success(element.state);
      } catch (err) {
        return error(err.message, "ELEMENT_STATE_ERROR");
      }
    },
    getElementReactState: async (id) => {
      try {
        const element = registry.getElement(id);
        if (!element) {
          return error(`Element not found: ${id}`, "NOT_FOUND");
        }
        if (!element.element) {
          return error(`Element ${id} has no DOM node`, "NO_DOM_NODE");
        }
        const reactState = extractReactState(element.element);
        if (!reactState) {
          return success({
            props: {},
            fiberState: [],
            componentName: void 0,
            note: "No React internals found on this element"
          });
        }
        return success(reactState);
      } catch (err) {
        return error(err.message, "REACT_STATE_ERROR");
      }
    },
    executeElementAction: async (id, request) => {
      const startTime = Date.now();
      try {
        const isPageScrollSentinel = request.action === "scroll" && (id === "document" || id === "body" || id === "window");
        let element = isPageScrollSentinel ? true : registry.getElement(id);
        if (!element && !isPageScrollSentinel) {
          refreshElements();
          element = registry.getElement(id);
        }
        let preActionStates;
        if (request.captureAfter) {
          preActionStates = /* @__PURE__ */ new Map();
          for (const rawEl of registry.getAllElements()) {
            const el = rawEl;
            try {
              if (el.getState) {
                const state = el.getState();
                preActionStates.set(el.id, { id: el.id, state });
              }
            } catch {
            }
          }
        }
        const result = await actionExecutor.executeAction(id, {
          action: request.action,
          params: request.params,
          waitOptions: request.waitOptions
        });
        if (undoTracker && result && typeof result === "object" && "success" in result && result.success) {
          undoTracker.recordAction({
            id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            target: id,
            action: request.action,
            params: request.params
          });
        }
        if (result && typeof result === "object" && "success" in result && !result.success) {
          const actionResult = result;
          let errorCode = "UNKNOWN_ERROR";
          const errorMsg = actionResult.error?.toLowerCase() || "";
          if (errorMsg.includes("not found")) {
            errorCode = "ELEMENT_NOT_FOUND";
          } else if (errorMsg.includes("not visible") || errorMsg.includes("hidden")) {
            errorCode = "ELEMENT_NOT_VISIBLE";
          } else if (errorMsg.includes("disabled") || errorMsg.includes("not enabled")) {
            errorCode = "ELEMENT_NOT_ENABLED";
          } else if (errorMsg.includes("timeout")) {
            errorCode = "ACTION_TIMEOUT";
          } else if (errorMsg.includes("blocked") || errorMsg.includes("interactable")) {
            errorCode = "ELEMENT_NOT_INTERACTABLE";
          }
          const failureDetails = createFailureDetails(
            errorCode,
            actionResult.error || "Action failed",
            {
              elementId: id,
              durationMs: Date.now() - startTime
            }
          );
          return success({
            ...actionResult,
            failureDetails
          });
        }
        if (request.captureAfter && preActionStates && result && typeof result === "object") {
          const postElements = registry.getAllElements();
          const postIds = new Set(postElements.map((el) => el.id));
          const preIds = new Set(preActionStates.keys());
          const appeared = [...postIds].filter((eid) => !preIds.has(eid));
          const disappeared = [...preIds].filter((eid) => !postIds.has(eid));
          const stateChanged = [];
          const compareFields = [
            "visible",
            "enabled",
            "focused",
            "value",
            "checked",
            "textContent"
          ];
          for (const el of postElements) {
            const pre = preActionStates.get(el.id);
            if (!pre || !el.getState) continue;
            try {
              const postState = el.getState();
              const preState = pre.state;
              for (const field of compareFields) {
                const before = preState[field];
                const after = postState[field];
                if (before !== after && (before !== void 0 || after !== void 0)) {
                  stateChanged.push({ elementId: el.id, field, before, after });
                }
              }
            } catch {
            }
          }
          const changes = { appeared, disappeared, stateChanged };
          result.changes = changes;
        }
        return success(result);
      } catch (err) {
        const errorMessage = err.message;
        let errorCode = "UNKNOWN_ERROR";
        if (errorMessage.includes("not found")) {
          errorCode = "ELEMENT_NOT_FOUND";
        } else if (errorMessage.includes("timeout")) {
          errorCode = "ACTION_TIMEOUT";
        } else if (errorMessage.includes("network") || errorMessage.includes("fetch")) {
          errorCode = "NETWORK_ERROR";
        }
        const failureDetails = createFailureDetails(errorCode, errorMessage, {
          elementId: id,
          durationMs: Date.now() - startTime
        });
        return {
          success: false,
          error: errorMessage,
          code: errorCode,
          data: {
            success: false,
            error: errorMessage,
            failureDetails,
            durationMs: Date.now() - startTime,
            timestamp: Date.now()
          },
          timestamp: Date.now()
        };
      }
    },
    executeBatchAction: async (request) => {
      try {
        if (!request?.steps || !Array.isArray(request.steps) || request.steps.length === 0) {
          return error('Batch request must include a non-empty "steps" array', "VALIDATION_ERROR");
        }
        if (actionExecutor.executeBatch) {
          const result = await actionExecutor.executeBatch(request);
          return success(result);
        }
        const startTime = performance.now();
        const results = [];
        let succeededCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        let stopped = false;
        const stopOnFailure = request.stopOnFailure ?? true;
        const delayBetweenMs = request.delayBetweenMs ?? 0;
        for (let i = 0; i < request.steps.length; i++) {
          if (stopped) {
            skippedCount++;
            continue;
          }
          const step = request.steps[i];
          if (i > 0 && delayBetweenMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayBetweenMs));
          }
          refreshElements();
          const response = await actionExecutor.executeAction(step.elementId, step.action);
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
          durationMs: performance.now() - startTime,
          timestamp: Date.now()
        });
      } catch (err) {
        return error(err.message, "BATCH_ACTION_ERROR");
      }
    },
    // =========================================================================
    // Component Handlers
    // =========================================================================
    getComponents: async () => {
      try {
        const components = registry.getAllComponents().map(annotateComponentWithInvocationPaths);
        return success(components);
      } catch (err) {
        return error(err.message, "COMPONENTS_ERROR");
      }
    },
    getComponent: async (id) => {
      try {
        const component = registry.getComponent(id);
        if (!component) {
          return error(`Component not found: ${id}`, "NOT_FOUND");
        }
        return success(
          annotateComponentWithInvocationPaths(component)
        );
      } catch (err) {
        return error(err.message, "COMPONENT_ERROR");
      }
    },
    getComponentState: async (id) => {
      try {
        const component = registry.getComponent(id);
        if (!component) {
          return error(`Component not found: ${id}`, "NOT_FOUND");
        }
        if (registry.getComponentState) {
          const stateResponse = registry.getComponentState(id);
          if (!stateResponse) {
            return error(`Component not found or not mounted: ${id}`, "NOT_FOUND");
          }
          return success(stateResponse);
        }
        const comp = component;
        return success({
          state: comp.getState?.() ?? {},
          computed: comp.getComputed?.() ?? {},
          timestamp: Date.now()
        });
      } catch (err) {
        return error(err.message, "COMPONENT_STATE_ERROR");
      }
    },
    executeComponentAction: async (id, request) => {
      try {
        const result = await actionExecutor.executeComponentAction(id, {
          action: request.action,
          params: request.params
        });
        return success(result);
      } catch (err) {
        return error(err.message, "COMPONENT_ACTION_ERROR");
      }
    },
    // =========================================================================
    // Find/Discovery Handlers
    // =========================================================================
    find: async (request) => {
      try {
        const findRequest = request;
        if (!findRequest?.skipSettle) {
          await awaitDOMSettled(findRequest?.settleTimeout);
        }
        let elements = registry.findElements?.(findRequest) ?? registry.getAllElements();
        if (findRequest) {
          elements = applyFindFilters(elements, findRequest);
        }
        if (elements.length === 0) {
          const domElements = scanDOMForInteractiveElements();
          if (domElements.length > 0) {
            elements = findRequest ? applyFindFilters(domElements, findRequest) : domElements;
          }
        }
        return success({
          elements: materializeElements(elements),
          timestamp: Date.now(),
          total: elements.length,
          durationMs: 0
        });
      } catch (err) {
        return error(err.message, "FIND_ERROR");
      }
    },
    getElementImages: async (_request) => {
      return success({
        images: [],
        total: 0,
        note: "Use relay mode for DOM image scanning"
      });
    },
    discover: async (request) => {
      try {
        const findRequest = request;
        if (!findRequest?.skipSettle) {
          await awaitDOMSettled(findRequest?.settleTimeout);
        }
        let elements = registry.findElements?.(findRequest) ?? registry.getAllElements();
        if (findRequest) {
          elements = applyFindFilters(elements, findRequest);
        }
        if (elements.length === 0) {
          const domElements = scanDOMForInteractiveElements();
          if (domElements.length > 0) {
            elements = findRequest ? applyFindFilters(domElements, findRequest) : domElements;
          }
        }
        return success({
          elements: materializeElements(elements),
          timestamp: Date.now(),
          total: elements.length,
          durationMs: 0
        });
      } catch (err) {
        return error(err.message, "DISCOVER_ERROR");
      }
    },
    getControlSnapshot: async (request) => {
      try {
        const shouldSkip = request?.skipSettle === true || request?.skipSettle === "true";
        if (!shouldSkip) {
          const timeout = typeof request?.settleTimeout === "string" ? parseInt(request.settleTimeout, 10) || void 0 : request?.settleTimeout;
          await awaitDOMSettled(timeout);
        }
        const snapshot = registry.createSnapshot();
        const wantInteractiveOnly = request?.interactiveOnly === true || request?.interactiveOnly === "true" || request?.interactive_only === true || request?.interactive_only === "true";
        if (wantInteractiveOnly) {
          snapshot.elements = snapshot.elements.filter(
            (e) => e.kind !== "content"
          );
        }
        if (snapshot.elements.length === 0) {
          const registryElements = registry.getAllElements();
          if (registryElements.length > 0) {
            snapshot.elements = materializeElements(registryElements);
          }
        }
        if (snapshot.elements.length === 0) {
          const domElements = scanDOMForInteractiveElements();
          if (domElements.length > 0) {
            snapshot.elements = domElements;
          }
        }
        if (consoleCapture) {
          const thirtySecondsAgo = Date.now() - 3e4;
          const recentErrors = consoleCapture.getConsoleSince(thirtySecondsAgo);
          const errorCount = recentErrors.filter(
            (e) => e.level === "error" || e.level === "unhandledrejection"
          ).length;
          const warningCount = recentErrors.filter((e) => e.level === "warn").length;
          const criticalError = recentErrors.find(
            (e) => e.level === "error" || e.level === "unhandledrejection"
          );
          const errorOverlays = hasFullEventAPI(consoleCapture) ? consoleCapture.getFrameworkOverlays?.() ?? [] : [];
          const hasVisibleOverlay = errorOverlays.length > 0;
          snapshot.errorSummary = {
            errorCount,
            warningCount,
            mostRecentError: criticalError ? {
              message: criticalError.message,
              timestamp: criticalError.timestamp,
              sourceLocation: extractSourceLocation(criticalError.stack)
            } : void 0,
            health: hasVisibleOverlay ? "broken" : errorCount === 0 ? "healthy" : errorCount <= 2 && !recentErrors.some((e) => e.level === "unhandledrejection") ? "degraded" : "broken",
            errorOverlays: hasVisibleOverlay ? errorOverlays : void 0
          };
        }
        if (!snapshot.page && typeof window !== "undefined") {
          snapshot.page = {
            url: window.location.href,
            title: document.title,
            pathname: window.location.pathname,
            search: window.location.search,
            hash: window.location.hash,
            recentNavigations: []
          };
        }
        if (typeof window !== "undefined") {
          const docEl = document.documentElement;
          snapshot.viewport = {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            documentWidth: docEl.scrollWidth,
            documentHeight: docEl.scrollHeight,
            canScrollDown: window.scrollY + window.innerHeight < docEl.scrollHeight - 1,
            canScrollRight: window.scrollX + window.innerWidth < docEl.scrollWidth - 1
          };
        }
        return success(snapshot);
      } catch (err) {
        return error(err.message, "SNAPSHOT_ERROR");
      }
    },
    // =========================================================================
    // Workflow Handlers
    // =========================================================================
    getWorkflows: async () => {
      try {
        const workflows = registry.getAllWorkflows?.() ?? [];
        return success(workflows);
      } catch (err) {
        return error(err.message, "WORKFLOWS_ERROR");
      }
    },
    runWorkflow: async (id, request) => {
      try {
        const workflow = registry.getWorkflow?.(id);
        if (!workflow) {
          console.warn(
            `[handlers] Workflow "${id}" not in local registry \u2014 proxying to runner anyway`
          );
        }
        const runnerPort = 9876;
        const req = request && typeof request === "object" ? request : {};
        const body = {
          force_fresh_start: req.forceFreshStart ?? req.force_fresh_start ?? false,
          task_run_id: req.taskRunId ?? req.task_run_id,
          monitor_index: req.monitorIndex ?? req.monitor_index
        };
        const response = await fetch(
          `http://127.0.0.1:${runnerPort}/unified-workflows/${encodeURIComponent(id)}/run`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          }
        );
        const result = await response.json();
        if (!response.ok || result.success === false) {
          return error(result.error || `Runner returned ${response.status}`, "WORKFLOW_ERROR");
        }
        const data = result.data || result;
        return success({
          runId: data.task_run_id || data.execution_id || `run-${Date.now()}`,
          workflowId: id,
          status: "running",
          startedAt: Date.now(),
          steps: [],
          totalSteps: 0
        });
      } catch (err) {
        return error(err.message, "WORKFLOW_ERROR");
      }
    },
    getWorkflowStatus: async (runId) => {
      try {
        const runnerPort = 9876;
        const response = await fetch(
          `http://127.0.0.1:${runnerPort}/task-runs/${encodeURIComponent(runId)}`
        );
        const result = await response.json();
        if (!response.ok || result.success === false) {
          return error(
            result.error || `Runner returned ${response.status}`,
            "WORKFLOW_STATUS_ERROR"
          );
        }
        const data = result.data || result;
        const statusMap = {
          in_progress: "running",
          running: "running",
          completed: "completed",
          success: "completed",
          failed: "failed",
          error: "failed",
          cancelled: "cancelled",
          stopped: "cancelled"
        };
        return success({
          runId,
          workflowId: data.workflow_id || data.workflowId || "",
          status: statusMap[data.status] || "pending",
          steps: data.steps || [],
          totalSteps: data.total_steps || data.totalSteps || 0,
          currentStep: data.current_step || data.currentStep,
          startedAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
          completedAt: data.completed_at ? new Date(data.completed_at).getTime() : void 0,
          durationMs: data.duration_ms || data.durationMs,
          success: ["completed", "success", "failed", "error", "cancelled", "stopped"].includes(
            data.status
          ) ? data.status === "completed" || data.status === "success" : void 0,
          error: data.error
        });
      } catch (err) {
        return error(err.message, "WORKFLOW_STATUS_ERROR");
      }
    },
    // =========================================================================
    // Debug Handlers
    // =========================================================================
    getActionHistory: async (limit) => {
      try {
        const history = registry.getActionHistory?.() ?? [];
        const limited = limit ? history.slice(-limit) : history;
        return success(limited);
      } catch (err) {
        return error(err.message, "ACTION_HISTORY_ERROR");
      }
    },
    getMetrics: async () => {
      try {
        const metrics = registry.getMetrics?.() ?? {
          elementCount: registry.getAllElements().length,
          componentCount: registry.getAllComponents().length
        };
        return success(metrics);
      } catch (err) {
        return error(err.message, "METRICS_ERROR");
      }
    },
    highlightElement: async (id) => {
      try {
        registry.highlightElement?.(id);
        return success(void 0);
      } catch (err) {
        return error(err.message, "HIGHLIGHT_ERROR");
      }
    },
    getElementTree: async () => {
      try {
        const tree = registry.getElementTree?.() ?? { root: null, elements: [] };
        return success(tree);
      } catch (err) {
        return error(err.message, "ELEMENT_TREE_ERROR");
      }
    },
    getConsoleErrors: async (params) => {
      try {
        if (!consoleCapture) {
          if (params?.group) {
            return success({ groups: [], totalErrors: 0, totalGroups: 0 });
          }
          return success({
            errors: [],
            count: 0,
            nextSinceId: typeof params?.sinceId === "number" ? params.sinceId : 0,
            droppedCount: 0,
            bufferedCount: 0
          });
        }
        if (typeof params?.sinceId === "number" || !params?.group) {
          const hasNewApi = consoleCapture && typeof consoleCapture.getConsoleRecent === "function";
          if (typeof params?.sinceId === "number" && hasNewApi && // The new signature accepts an options object — detect by trying it.
          // The legacy numeric signature just returns CapturedError[], which
          // we'd also detect via Array.isArray below.
          true) {
            const response = consoleCapture.getConsoleRecent({
              sinceId: params.sinceId,
              limit: params.limit
            });
            if (response && !Array.isArray(response) && "errors" in response) {
              if (!params?.group) {
                return success({
                  errors: response.errors,
                  count: response.errors.length,
                  nextSinceId: response.nextSinceId,
                  droppedCount: response.droppedCount,
                  bufferedCount: response.bufferedCount
                });
              }
            }
          }
        }
        const errors = params?.since ? consoleCapture.getConsoleSince(params.since) : consoleCapture.getConsoleRecent(params?.limit ?? 50);
        if (!params?.group) {
          let nextSinceId;
          let droppedCount;
          let bufferedCount;
          try {
            const maybe = consoleCapture.getConsoleRecent?.({
              sinceId: 0,
              limit: params?.limit ?? 50
            });
            if (maybe && typeof maybe === "object" && !Array.isArray(maybe) && "errors" in maybe) {
              const m = maybe;
              nextSinceId = m.nextSinceId;
              droppedCount = m.droppedCount;
              bufferedCount = m.bufferedCount;
            }
          } catch {
          }
          return success({
            errors,
            count: errors.length,
            ...nextSinceId !== void 0 ? { nextSinceId } : {},
            ...droppedCount !== void 0 ? { droppedCount } : {},
            ...bufferedCount !== void 0 ? { bufferedCount } : {}
          });
        }
        const groupBy = params.groupBy ?? "fingerprint";
        const { computeFingerprint: fp, extractSourceLocation: extractSrc } = await Promise.resolve().then(() => (init_error_fingerprint(), error_fingerprint_exports));
        const { getEventStack: getStack } = await Promise.resolve().then(() => (init_shared_utils(), shared_utils_exports));
        let rawEvents = [];
        if (hasFullEventAPI(consoleCapture)) {
          rawEvents = (params.since ? consoleCapture.getSince(params.since) : consoleCapture.getRecent((params.limit ?? 50) * 10)).filter((e) => e.type === "console" || e.type === "hmr");
        }
        if (rawEvents.length === 0) {
          const groups2 = errors.map((e) => ({
            fingerprint: `msg:${e.message}`,
            count: 1,
            firstSeen: e.timestamp,
            lastSeen: e.timestamp,
            level: e.level,
            message: e.message,
            source: void 0,
            sample: e
          }));
          return success({ groups: groups2, totalErrors: errors.length, totalGroups: groups2.length });
        }
        const groupMap = /* @__PURE__ */ new Map();
        const order = [];
        for (const event of rawEvents) {
          let key;
          if (groupBy === "message") {
            key = `msg:${event.message ?? ""}`;
          } else if (groupBy === "source") {
            key = `src:${extractSrc(getStack(event)) ?? "unknown"}`;
          } else {
            key = fp(event);
          }
          const existing = groupMap.get(key);
          if (existing) {
            existing.count += 1;
            existing.lastSeen = event.timestamp;
          } else {
            const msg = event.message ?? "";
            const lvl = event.type === "hmr" ? event.level === "warning" ? "warn" : event.level : event.level;
            const src = extractSrc(getStack(event));
            groupMap.set(key, {
              fingerprint: key,
              count: 1,
              firstSeen: event.timestamp,
              lastSeen: event.timestamp,
              level: lvl,
              message: msg,
              source: src,
              sample: {
                timestamp: event.timestamp,
                level: lvl,
                message: msg,
                stack: event.stack
              }
            });
            order.push(key);
          }
        }
        const groups = order.map((k) => groupMap.get(k));
        return success({ groups, totalErrors: rawEvents.length, totalGroups: groups.length });
      } catch (err) {
        return error(err.message, "CONSOLE_ERRORS_ERROR");
      }
    },
    clearConsoleErrors: async () => {
      try {
        if (!consoleCapture) {
          return success({ cleared: false });
        }
        consoleCapture.clear();
        return success({ cleared: true });
      } catch (err) {
        return error(err.message, "CONSOLE_CLEAR_ERROR");
      }
    },
    // =========================================================================
    // AI-Native Handlers
    // =========================================================================
    aiSearch: async (criteria) => {
      try {
        refreshElements();
        const resolved = { ...criteria };
        if (!resolved.text && criteria.query) {
          resolved.text = criteria.query;
          if (resolved.fuzzy === void 0) {
            resolved.fuzzy = true;
          }
        }
        const response = searchEngine.search(resolved);
        return success(response);
      } catch (err) {
        return error(err.message, "AI_SEARCH_ERROR");
      }
    },
    aiFind: async (request) => {
      try {
        if (!request.skipSettle) {
          await awaitDOMSettled(request.settleTimeout);
        }
        refreshElements();
        const context = { ...request.context };
        if (!context.activeModalId && modalDetector) {
          try {
            const modalStack = modalDetector.detect();
            if (modalStack.modals.length > 0) {
              const topModal = modalStack.modals[modalStack.modals.length - 1];
              context.activeModalId = topModal.id;
            }
          } catch {
          }
        }
        const result = find(request.query, searchEngine, {
          context,
          confidenceThreshold: request.confidenceThreshold,
          pickFirst: true
        });
        return success(result);
      } catch (err) {
        return error(err.message, "AI_FIND_ERROR");
      }
    },
    aiExecute: async (request) => {
      try {
        const reqAny = request;
        if (!reqAny.skipSettle && !request.withDiff) {
          await awaitDOMSettled(reqAny.settleTimeout);
        }
        refreshElements();
        if (request.withDiff) {
          const diffResult = await changeTracker.executeWithDiff({
            instruction: request.instruction,
            settleTimeout: request.settleTimeout,
            settleMinStable: request.settleMinStable,
            scope: request.scope,
            categorize: true,
            summaryBudget: request.summaryBudget,
            analyzeStructured: request.analyzeStructured
          });
          const nlResult = diffResult.actionResult;
          return success({
            ...nlResult,
            diff: diffResult.diff,
            categorized: diffResult.categorized,
            budgetSummary: diffResult.budgetSummary,
            structuredChanges: diffResult.structuredChanges,
            settleTimedOut: diffResult.settleTimedOut,
            timeline: diffResult.timeline
          });
        }
        const result = await nlExecutor.execute(request);
        return success(result);
      } catch (err) {
        return error(err.message, "AI_EXECUTE_ERROR");
      }
    },
    aiAssert: async (request) => {
      try {
        const reqAny = request;
        if (!reqAny.skipSettle) {
          await awaitDOMSettled(reqAny.settleTimeout);
        }
        refreshElements();
        const normalized = parseNLAssertion2(request);
        const result = await assertionExecutor.assert(normalized);
        return success(result);
      } catch (err) {
        return error(err.message, "AI_ASSERT_ERROR");
      }
    },
    aiAssertBatch: async (request) => {
      try {
        const reqAny = request;
        if (!reqAny.skipSettle) {
          await awaitDOMSettled(reqAny.settleTimeout);
        }
        refreshElements();
        const normalized = normalizeBatchAssertions(request);
        const result = await assertionExecutor.assertBatch(normalized);
        return success(result);
      } catch (err) {
        return error(err.message, "AI_ASSERT_BATCH_ERROR");
      }
    },
    getSemanticSnapshot: async (options) => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const wantForms = options?.includeForms === true || options?.includeForms === "true";
        const formsResponse = wantForms ? discoverForms(registry.getAllElements()) : void 0;
        const snapshot = snapshotManager.createSnapshot(controlSnapshot, void 0, formsResponse);
        if (networkTracker) {
          const inFlight = networkTracker.getInFlight();
          const failures = networkTracker.getCompleted({ failuresOnly: true, limit: 10 });
          const now = Date.now();
          snapshot.networkActivity = {
            inFlightCount: inFlight.length,
            inFlightRequests: inFlight.map((e) => ({
              url: e.request.url,
              method: e.request.method,
              durationMs: now - e.request.startedAt
            })),
            recentFailures: failures.map((e) => ({
              url: e.request.url,
              method: e.request.method,
              statusCode: e.response?.statusCode ?? 0,
              durationMs: e.response?.durationMs ?? 0,
              error: e.error
            })),
            recentFailureCount: failures.length
          };
        }
        return success(snapshot);
      } catch (err) {
        return error(err.message, "SEMANTIC_SNAPSHOT_ERROR");
      }
    },
    getSemanticDiff: async (_since) => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const currentSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        const diff = diffManager.update(currentSnapshot);
        return success(diff);
      } catch (err) {
        return error(err.message, "SEMANTIC_DIFF_ERROR");
      }
    },
    getPageSummary: async () => {
      try {
        const snapshot = registry.createSnapshot();
        let elements = snapshot.elements.map((el) => ({
          ...el,
          description: el.label || el.id,
          aliases: [],
          suggestedActions: [],
          tagName: el.type,
          accessibleName: el.label,
          registered: true
        }));
        if (elements.length === 0) {
          const domElements = scanDOMForInteractiveElements();
          elements = domElements.map((el) => ({
            ...el,
            description: el.label || el.id,
            aliases: [],
            suggestedActions: el.actions.map((a) => ({ action: a })),
            accessibleName: el.label,
            registered: false
          }));
        }
        const summary = generatePageSummary(elements);
        return success(summary);
      } catch (err) {
        return error(err.message, "PAGE_SUMMARY_ERROR");
      }
    },
    // =========================================================================
    // App-Agnostic Convenience Endpoints
    // =========================================================================
    clickByText: async (request) => {
      try {
        if (!request.text?.trim()) {
          return error("text is required and must not be empty", "INVALID_PARAMS");
        }
        const matches = findElementsByText(request.text, {
          tag: request.tag,
          exact: request.exact
        });
        if (matches.length === 0) {
          return error(`No element found with text "${request.text}"`, "ELEMENT_NOT_FOUND");
        }
        const el = matches[0];
        el.click();
        return success({
          clicked: true,
          element: {
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 200) ?? "",
            rect: el.getBoundingClientRect()
          }
        });
      } catch (err) {
        return error(err.message, "CLICK_BY_TEXT_ERROR");
      }
    },
    clickBySelector: async (request) => {
      try {
        if (!request.selector?.trim()) {
          return error("selector is required and must not be empty", "INVALID_PARAMS");
        }
        const el = findElementBySelector(request.selector, request.index);
        if (!el) {
          return error(`No element found for selector "${request.selector}"`, "ELEMENT_NOT_FOUND");
        }
        el.click();
        return success({
          clicked: true,
          element: {
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 200) ?? "",
            rect: el.getBoundingClientRect()
          }
        });
      } catch (err) {
        return error(err.message, "CLICK_BY_SELECTOR_ERROR");
      }
    },
    typeInto: async (request) => {
      try {
        if (!request.label && !request.selector) {
          return error("Either label or selector is required", "INVALID_PARAMS");
        }
        let el = null;
        if (request.label) {
          el = findElementByLabel(request.label);
        } else if (request.selector) {
          el = findElementBySelector(request.selector);
        }
        if (!el) {
          return error(
            `No input found for ${request.label ? 'label "' + request.label + '"' : 'selector "' + request.selector + '"'}`,
            "ELEMENT_NOT_FOUND"
          );
        }
        el.focus();
        if (request.clear) {
          if ("value" in el) {
            el.value = "";
          } else {
            el.textContent = "";
          }
        }
        if ("value" in el) {
          el.value += request.text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (el.isContentEditable) {
          document.execCommand("insertText", false, request.text);
        }
        return success({
          typed: true,
          element: {
            tag: el.tagName.toLowerCase(),
            value: "value" in el ? el.value : el.textContent
          }
        });
      } catch (err) {
        return error(err.message, "TYPE_INTO_ERROR");
      }
    },
    readValue: async (request) => {
      try {
        if (!request.selector?.trim()) {
          return error("selector is required and must not be empty", "INVALID_PARAMS");
        }
        const el = findElementBySelector(request.selector, request.index);
        if (!el) {
          return error(`No element found for selector "${request.selector}"`, "ELEMENT_NOT_FOUND");
        }
        const value = "value" in el ? el.value : el.textContent ?? null;
        return success({
          value,
          length: value?.length ?? 0
        });
      } catch (err) {
        return error(err.message, "READ_VALUE_ERROR");
      }
    },
    findByText: async (request) => {
      try {
        if (!request.text?.trim()) {
          return error("text is required and must not be empty", "INVALID_PARAMS");
        }
        const matches = findElementsByText(request.text, {
          tag: request.tag,
          exact: request.exact
        });
        const results = matches.map((el, i) => {
          const rect = el.getBoundingClientRect();
          return {
            index: i,
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 200) ?? "",
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            disabled: "disabled" in el ? !!el.disabled : false,
            visible: el.offsetParent !== null || getComputedStyle(el).position === "fixed"
          };
        });
        return success(results);
      } catch (err) {
        return error(err.message, "FIND_BY_TEXT_ERROR");
      }
    },
    // =========================================================================
    // Diagnostics Endpoint
    // =========================================================================
    getDiagnostics: async () => {
      try {
        const registeredCount = registry.getAllElements().length;
        const domCount = countDOMInteractiveElements();
        const globalBridge = typeof window !== "undefined" ? window.__UI_BRIDGE__ : null;
        return success({
          sdk_initialized: !!globalBridge,
          auto_register_active: !!globalBridge?.autoRegisterActive,
          registered_elements: registeredCount,
          dom_interactive_elements: domCount,
          mutation_observer_active: !!globalBridge?.mutationObserverActive,
          navigation_adapter: config.navigationAdapter ? "custom" : "window-location",
          page_title: typeof document !== "undefined" ? document.title : "",
          page_url: typeof window !== "undefined" ? window.location.href : "",
          page_ready: typeof document !== "undefined" ? document.readyState === "complete" : false,
          providers_mounted: globalBridge?.providers ?? [],
          last_discover_at: null,
          capabilities: [
            "control",
            "find",
            "ai",
            ...config.consoleCapture ? ["debug"] : [],
            ...config.navigationTracker ? ["navigation"] : [],
            ...config.navigationAdapter ? ["navigation-adapter"] : []
          ]
        });
      } catch (err) {
        return error(err.message, "DIAGNOSTICS_ERROR");
      }
    },
    // =========================================================================
    // Navigation Adapter Endpoints
    // =========================================================================
    getRoutes: async () => {
      try {
        const routes = navAdapter.getRoutes();
        return success(routes);
      } catch (err) {
        return error(err.message, "GET_ROUTES_ERROR");
      }
    },
    navigateByAdapter: async (request) => {
      try {
        await navAdapter.navigate(request.page);
        const current = navAdapter.getCurrentRoute();
        return success({ navigated: true, route: current });
      } catch (err) {
        return error(err.message, "NAVIGATE_ERROR");
      }
    },
    // =========================================================================
    // Change Tracking Handlers
    // =========================================================================
    executeWithDiff: async (request) => {
      try {
        refreshElements();
        const result = await changeTracker.executeWithDiff(request);
        return success(result);
      } catch (err) {
        return error(err.message, "EXECUTE_WITH_DIFF_ERROR");
      }
    },
    waitForChange: async (request) => {
      try {
        refreshElements();
        const diff = await changeTracker.waitForChange(request.predicate, request.options);
        return success(diff);
      } catch (err) {
        return error(err.message, "WAIT_FOR_CHANGE_ERROR");
      }
    },
    categorizeLastDiff: async () => {
      try {
        const result = changeTracker.categorizeLastDiff();
        return success(result);
      } catch (err) {
        return error(err.message, "CATEGORIZE_DIFF_ERROR");
      }
    },
    getScopedDiff: async (request) => {
      try {
        if (request.fromBookmark) {
          const diff2 = changeTracker.scopedDiffFromBookmark(request.fromBookmark, request.scope);
          return success(diff2);
        }
        refreshElements();
        const controlSnapshot = registry.createSnapshot();
        const currentSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        const lastSnapshot = diffManager.getLastSnapshot();
        if (!lastSnapshot) {
          return success(null);
        }
        const diff = changeTracker.computeScopedDiff(lastSnapshot, currentSnapshot, request.scope);
        return success(diff);
      } catch (err) {
        return error(err.message, "SCOPED_DIFF_ERROR");
      }
    },
    summarizeDiff: async (request) => {
      try {
        if (!request.budget || request.budget < 1) {
          return error("Budget must be a positive number", "VALIDATION_ERROR");
        }
        let diff = null;
        if (request.fromBookmark) {
          diff = changeTracker.diffFromBookmark(request.fromBookmark);
          if (!diff) return error(`Bookmark not found: ${request.fromBookmark}`, "NOT_FOUND");
        } else {
          diff = changeTracker.categorizeLastDiff()?.diff ?? null;
          if (!diff)
            return error(
              "No diff available. Execute an action or diff from a bookmark first.",
              "NO_DIFF"
            );
        }
        const summary = changeTracker.summarizeDiff(diff, {
          budget: request.budget,
          includeIds: request.includeIds,
          includeCategory: request.includeCategory
        });
        return success({ summary });
      } catch (err) {
        return error(err.message, "SUMMARIZE_DIFF_ERROR");
      }
    },
    analyzeStructuredChanges: async (request) => {
      try {
        let beforeSnapshot;
        let afterSnapshot;
        if (request?.fromBookmark) {
          const bookmark = changeTracker.getBookmark(request.fromBookmark);
          if (!bookmark) return error(`Bookmark not found: ${request.fromBookmark}`, "NOT_FOUND");
          beforeSnapshot = bookmark.snapshot;
          refreshElements();
          const controlSnapshot = registry.createSnapshot();
          afterSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        } else {
          const lastSnapshot = diffManager.getLastSnapshot();
          if (!lastSnapshot) {
            return error(
              "No previous snapshot available. Save a bookmark or take a snapshot first.",
              "NO_SNAPSHOT"
            );
          }
          beforeSnapshot = lastSnapshot;
          refreshElements();
          const controlSnapshot = registry.createSnapshot();
          afterSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        }
        const result = analyzeStructuredChanges(beforeSnapshot, afterSnapshot);
        return success(result);
      } catch (err) {
        return error(err.message, "STRUCTURED_CHANGES_ERROR");
      }
    },
    // =========================================================================
    // Change Buffer Handlers
    // =========================================================================
    enableChangeBuffer: async () => {
      try {
        await changeTracker.enableBuffer();
        return success({ enabled: true });
      } catch (err) {
        return error(err.message, "CHANGE_BUFFER_ERROR");
      }
    },
    disableChangeBuffer: async () => {
      try {
        changeTracker.disableBuffer();
        return success({ enabled: false });
      } catch (err) {
        return error(err.message, "CHANGE_BUFFER_ERROR");
      }
    },
    drainChangeBuffer: async () => {
      try {
        const result = changeTracker.drainBuffer();
        return success(result);
      } catch (err) {
        return error(err.message, "CHANGE_BUFFER_ERROR");
      }
    },
    getChangeBufferSize: async () => {
      try {
        return success({
          size: changeTracker.getBufferSize(),
          enabled: changeTracker.isBufferEnabled()
        });
      } catch (err) {
        return error(err.message, "CHANGE_BUFFER_ERROR");
      }
    },
    // =========================================================================
    // Snapshot Bookmark Handlers
    // =========================================================================
    saveBookmark: async (request) => {
      try {
        if (!request.name) {
          return error("Bookmark name is required", "VALIDATION_ERROR");
        }
        const bookmark = changeTracker.saveBookmark(request.name);
        return success(bookmark);
      } catch (err) {
        return error(err.message, "BOOKMARK_ERROR");
      }
    },
    getBookmark: async (name) => {
      try {
        const bookmark = changeTracker.getBookmark(name);
        if (!bookmark) {
          return error(`Bookmark not found: ${name}`, "NOT_FOUND");
        }
        return success(bookmark);
      } catch (err) {
        return error(err.message, "BOOKMARK_ERROR");
      }
    },
    deleteBookmark: async (name) => {
      try {
        const deleted = changeTracker.deleteBookmark(name);
        return success({ deleted });
      } catch (err) {
        return error(err.message, "BOOKMARK_ERROR");
      }
    },
    listBookmarks: async () => {
      try {
        return success(changeTracker.listBookmarks());
      } catch (err) {
        return error(err.message, "BOOKMARK_ERROR");
      }
    },
    diffFromBookmark: async (name) => {
      try {
        const diff = changeTracker.diffFromBookmark(name);
        if (diff === null && !changeTracker.getBookmark(name)) {
          return error(`Bookmark not found: ${name}`, "NOT_FOUND");
        }
        return success(diff);
      } catch (err) {
        return error(err.message, "BOOKMARK_ERROR");
      }
    },
    // =========================================================================
    // Semantic Search Handler (Embedding-based)
    // =========================================================================
    // =========================================================================
    // Page Navigation Handlers
    // =========================================================================
    pageRefresh: async () => {
      try {
        window.location.reload();
        return success({ success: true, url: window.location.href, timestamp: Date.now() });
      } catch (err) {
        return error(err.message, "PAGE_REFRESH_ERROR");
      }
    },
    pageNavigate: async (request) => {
      try {
        if (!request.url) {
          return error("URL is required", "INVALID_REQUEST");
        }
        const rawMode = request.mode;
        if (rawMode !== void 0 && rawMode !== "hard" && rawMode !== "soft") {
          return error(`invalid mode: "${rawMode}" (expected "hard" or "soft")`, "INVALID_REQUEST");
        }
        const mode2 = rawMode ?? "hard";
        try {
          const parsed = new URL(request.url, window.location.origin);
          if (!["http:", "https:"].includes(parsed.protocol) && !request.url.startsWith("/")) {
            return error(
              "Invalid URL protocol \u2014 only http/https and relative paths allowed",
              "INVALID_REQUEST"
            );
          }
        } catch {
          if (!request.url.startsWith("/")) {
            return error("Invalid URL format", "INVALID_REQUEST");
          }
        }
        if (mode2 === "soft") {
          let pathname = request.url;
          try {
            const target = new URL(request.url, window.location.origin);
            if (target.origin === window.location.origin) {
              pathname = target.pathname + target.search + target.hash;
            }
          } catch {
          }
          window.history.pushState(null, "", pathname);
          try {
            window.dispatchEvent(new PopStateEvent("popstate"));
          } catch {
            window.dispatchEvent(new Event("popstate"));
          }
          window.dispatchEvent(
            new CustomEvent("ui-bridge:navigate", { detail: { url: pathname, mode: "soft" } })
          );
          return success({
            success: true,
            url: pathname,
            hard: false,
            mode: "soft",
            timestamp: Date.now()
          });
        }
        window.dispatchEvent(
          new CustomEvent("ui-bridge-navigate", {
            detail: { page: request.url, url: request.url }
          })
        );
        if (request.url.startsWith("/") || request.url.startsWith("http")) {
          window.location.href = request.url;
        }
        return success({
          success: true,
          url: request.url,
          hard: true,
          mode: "hard",
          timestamp: Date.now()
        });
      } catch (err) {
        return error(err.message, "PAGE_NAVIGATE_ERROR");
      }
    },
    pageGoBack: async () => {
      try {
        window.history.back();
        return success({ success: true, url: window.location.href, timestamp: Date.now() });
      } catch (err) {
        return error(err.message, "PAGE_GO_BACK_ERROR");
      }
    },
    pageGoForward: async () => {
      try {
        window.history.forward();
        return success({ success: true, url: window.location.href, timestamp: Date.now() });
      } catch (err) {
        return error(err.message, "PAGE_GO_FORWARD_ERROR");
      }
    },
    // =========================================================================
    // Annotation Handlers
    //
    // REST API endpoints for managing element annotations:
    //   GET    /annotations           - List all annotations
    //   GET    /annotations/export    - Export all annotations as AnnotationConfig
    //   GET    /annotations/coverage  - Get annotation coverage statistics
    //   GET    /annotations/:id       - Get annotation for a specific element
    //   PUT    /annotations/:id       - Create or update an annotation
    //   DELETE /annotations/:id       - Delete an annotation
    //   POST   /annotations/import    - Import annotations from AnnotationConfig
    // =========================================================================
    getAnnotations: async () => {
      try {
        return success(annotationStore.getAll());
      } catch (err) {
        return error(err.message, "ANNOTATIONS_ERROR");
      }
    },
    getAnnotation: async (id) => {
      try {
        const annotation = annotationStore.get(id);
        if (!annotation) {
          return error(`Annotation not found: ${id}`, "NOT_FOUND");
        }
        return success(annotation);
      } catch (err) {
        return error(err.message, "ANNOTATION_ERROR");
      }
    },
    setAnnotation: async (id, annotation) => {
      try {
        annotationStore.set(id, annotation);
        return success(annotationStore.get(id));
      } catch (err) {
        return error(err.message, "ANNOTATION_SET_ERROR");
      }
    },
    deleteAnnotation: async (id) => {
      try {
        const existed = annotationStore.delete(id);
        if (!existed) {
          return error(`Annotation not found: ${id}`, "NOT_FOUND");
        }
        return success(void 0);
      } catch (err) {
        return error(err.message, "ANNOTATION_DELETE_ERROR");
      }
    },
    importAnnotations: async (config2) => {
      try {
        const count = annotationStore.importConfig(config2);
        return success({ count });
      } catch (err) {
        return error(err.message, "ANNOTATION_IMPORT_ERROR");
      }
    },
    exportAnnotations: async () => {
      try {
        return success(annotationStore.exportConfig());
      } catch (err) {
        return error(err.message, "ANNOTATION_EXPORT_ERROR");
      }
    },
    getAnnotationCoverage: async () => {
      try {
        const allElements = registry.getAllElements();
        const allIds = allElements.map((el) => el.id);
        return success(annotationStore.getCoverage(allIds));
      } catch (err) {
        return error(err.message, "ANNOTATION_COVERAGE_ERROR");
      }
    },
    aiSemanticSearch: async (criteria) => {
      const startTime = performance.now();
      try {
        refreshElements();
        const allElements = registry.getAllElements();
        const aiElements = allElements.map(
          (el) => {
            const textParts = [];
            const state = "getState" in el ? el.getState() : el.state;
            const textContent = state?.textContent || "";
            const label = el.label || "";
            const accessibleName = el.accessibleName || "";
            const placeholder = el.placeholder || "";
            const title = el.title || "";
            if (label) textParts.push(label);
            if (accessibleName && accessibleName !== label) textParts.push(accessibleName);
            if (textContent && textContent !== label && textContent !== accessibleName) {
              textParts.push(textContent);
            }
            if (placeholder) textParts.push(`placeholder: ${placeholder}`);
            if (title) textParts.push(title);
            const combinedText = textParts.join(" ").trim() || el.id;
            return {
              element: {
                id: el.id,
                type: el.type,
                label: el.label,
                tagName: el.tagName || el.type,
                role: el.role,
                accessibleName: el.accessibleName,
                actions: el.actions || [],
                state: state || {},
                registered: true,
                description: label || el.id,
                aliases: [],
                suggestedActions: []
              },
              text: combinedText
            };
          }
        );
        let filteredElements = aiElements;
        if (criteria.type) {
          filteredElements = filteredElements.filter(
            ({ element }) => element.type.toLowerCase() === criteria.type.toLowerCase()
          );
        }
        if (criteria.role) {
          filteredElements = filteredElements.filter(
            ({ element }) => element.role?.toLowerCase() === criteria.role.toLowerCase()
          );
        }
        const query = criteria.query.toLowerCase();
        const threshold = criteria.threshold ?? 0.5;
        const limit = criteria.limit ?? 10;
        const scoredResults = filteredElements.map(({ element, text }) => {
          const textLower = text.toLowerCase();
          let similarity = 0;
          if (textLower.includes(query)) {
            similarity = 0.9;
          } else {
            const queryWords = new Set(query.split(/\s+/).filter((w) => w.length > 2));
            const textWords = new Set(textLower.split(/\s+/).filter((w) => w.length > 2));
            if (queryWords.size > 0 && textWords.size > 0) {
              let matchCount = 0;
              for (const word of queryWords) {
                for (const textWord of textWords) {
                  if (textWord.includes(word) || word.includes(textWord)) {
                    matchCount++;
                    break;
                  }
                }
              }
              similarity = matchCount / queryWords.size * 0.7;
            }
          }
          return {
            element,
            similarity,
            rank: 0,
            // Will be set after sorting
            embeddedText: text
          };
        });
        const filteredResults = scoredResults.filter((r) => r.similarity >= threshold).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
        filteredResults.forEach((result, index) => {
          result.rank = index + 1;
        });
        const response = {
          results: filteredResults,
          bestMatch: filteredResults.length > 0 ? filteredResults[0] : null,
          scannedCount: filteredElements.length,
          durationMs: performance.now() - startTime,
          query: criteria.query,
          providerInfo: {
            provider: "text-fallback",
            model: "simple-similarity",
            dimension: 0
          },
          timestamp: Date.now()
        };
        return success(response);
      } catch (err) {
        return error(err.message, "AI_SEMANTIC_SEARCH_ERROR");
      }
    },
    // =========================================================================
    // State Management Handlers
    // =========================================================================
    getStates: async () => {
      try {
        const states = registry.getStates?.() ?? [];
        return success(states);
      } catch (err) {
        return error(err.message, "STATES_ERROR");
      }
    },
    getState: async (id) => {
      try {
        const state = registry.getState?.(id);
        if (!state) {
          return error(`State not found: ${id}`, "NOT_FOUND");
        }
        return success(state);
      } catch (err) {
        return error(err.message, "STATE_ERROR");
      }
    },
    getActiveStates: async () => {
      try {
        const states = registry.getActiveStates?.() ?? [];
        return success(states);
      } catch (err) {
        return error(err.message, "ACTIVE_STATES_ERROR");
      }
    },
    activateState: async (id) => {
      try {
        if (!registry.activateState) {
          return error("State management not available", "NOT_IMPLEMENTED");
        }
        registry.activateState(id);
        return success(void 0);
      } catch (err) {
        return error(err.message, "ACTIVATE_STATE_ERROR");
      }
    },
    deactivateState: async (id) => {
      try {
        if (!registry.deactivateState) {
          return error("State management not available", "NOT_IMPLEMENTED");
        }
        registry.deactivateState(id);
        return success(void 0);
      } catch (err) {
        return error(err.message, "DEACTIVATE_STATE_ERROR");
      }
    },
    getStateGroups: async () => {
      try {
        const groups = registry.getStateGroups?.() ?? [];
        return success(groups);
      } catch (err) {
        return error(err.message, "STATE_GROUPS_ERROR");
      }
    },
    activateStateGroup: async (id) => {
      try {
        if (!registry.activateStateGroup) {
          return error("State group management not available", "NOT_IMPLEMENTED");
        }
        registry.activateStateGroup(id);
        return success(void 0);
      } catch (err) {
        return error(err.message, "ACTIVATE_STATE_GROUP_ERROR");
      }
    },
    deactivateStateGroup: async (id) => {
      try {
        if (!registry.deactivateStateGroup) {
          return error("State group management not available", "NOT_IMPLEMENTED");
        }
        registry.deactivateStateGroup(id);
        return success(void 0);
      } catch (err) {
        return error(err.message, "DEACTIVATE_STATE_GROUP_ERROR");
      }
    },
    getTransitions: async () => {
      try {
        const transitions = registry.getTransitions?.() ?? [];
        return success(transitions);
      } catch (err) {
        return error(err.message, "TRANSITIONS_ERROR");
      }
    },
    canExecuteTransition: async (id) => {
      try {
        if (!registry.canExecuteTransition) {
          return error("Transition management not available", "NOT_IMPLEMENTED");
        }
        const result = registry.canExecuteTransition(id);
        return success(result);
      } catch (err) {
        return error(err.message, "CAN_EXECUTE_TRANSITION_ERROR");
      }
    },
    executeTransition: async (id) => {
      try {
        if (!registry.executeTransition) {
          return error("Transition execution not available", "NOT_IMPLEMENTED");
        }
        const result = await registry.executeTransition(id);
        return success(result);
      } catch (err) {
        return error(err.message, "EXECUTE_TRANSITION_ERROR");
      }
    },
    findPath: async (request) => {
      try {
        if (!registry.findPath) {
          return error("Pathfinding not available", "NOT_IMPLEMENTED");
        }
        const result = registry.findPath(request.targetStates);
        return success(result);
      } catch (err) {
        return error(err.message, "FIND_PATH_ERROR");
      }
    },
    navigateTo: async (request) => {
      try {
        if (!registry.navigateTo) {
          return error("Navigation not available", "NOT_IMPLEMENTED");
        }
        const result = await registry.navigateTo(request.targetStates);
        return success(result);
      } catch (err) {
        return error(err.message, "NAVIGATE_TO_ERROR");
      }
    },
    getStateSnapshot: async () => {
      try {
        if (!registry.getStateSnapshot) {
          const snapshot = {
            timestamp: Date.now(),
            activeStates: (registry.getActiveStates?.() ?? []).map((s) => s.id),
            states: registry.getStates?.() ?? [],
            groups: registry.getStateGroups?.() ?? [],
            transitions: registry.getTransitions?.() ?? []
          };
          return success(snapshot);
        }
        return success(registry.getStateSnapshot());
      } catch (err) {
        return error(err.message, "STATE_SNAPSHOT_ERROR");
      }
    },
    // =========================================================================
    // Intent Handlers
    // =========================================================================
    executeIntent: async (request) => {
      const startTime = Date.now();
      try {
        refreshElements();
        const intent = intentRegistry.get(request.intentId);
        if (!intent) {
          return error(`Intent not found: ${request.intentId}`, "NOT_FOUND");
        }
        const nlResponse = await nlExecutor.execute({
          instruction: intent.description,
          context: `Executing intent: ${intent.name}`
        });
        return success({
          success: nlResponse.success,
          intentId: request.intentId,
          result: nlResponse,
          error: nlResponse.error,
          durationMs: Date.now() - startTime
        });
      } catch (err) {
        return error(err.message, "EXECUTE_INTENT_ERROR");
      }
    },
    findIntent: async (request) => {
      try {
        const query = request.query.toLowerCase();
        const results = [];
        for (const intent of intentRegistry.values()) {
          let confidence = 0;
          const nameLower = intent.name.toLowerCase();
          const descLower = intent.description.toLowerCase();
          if (nameLower === query) {
            confidence = 1;
          } else if (nameLower.includes(query) || query.includes(nameLower)) {
            confidence = 0.8;
          } else if (descLower.includes(query)) {
            confidence = 0.6;
          } else if (intent.tags?.some((t) => t.toLowerCase().includes(query))) {
            confidence = 0.5;
          }
          if (confidence > 0) {
            results.push({ intent, confidence });
          }
        }
        results.sort((a, b) => b.confidence - a.confidence);
        return success({ intents: results });
      } catch (err) {
        return error(err.message, "FIND_INTENT_ERROR");
      }
    },
    listIntents: async () => {
      try {
        return success(Array.from(intentRegistry.values()));
      } catch (err) {
        return error(err.message, "LIST_INTENTS_ERROR");
      }
    },
    registerIntent: async (intent) => {
      try {
        intentRegistry.set(intent.id, intent);
        return success(intent);
      } catch (err) {
        return error(err.message, "REGISTER_INTENT_ERROR");
      }
    },
    deleteIntent: async (name) => {
      try {
        let found = false;
        for (const [id, intent] of intentRegistry.entries()) {
          if (intent.name === name || id === name) {
            intentRegistry.delete(id);
            found = true;
            break;
          }
        }
        return success({ deleted: found });
      } catch (err) {
        return error(err.message, "DELETE_INTENT_ERROR");
      }
    },
    executeIntentFromQuery: async (request) => {
      const startTime = Date.now();
      try {
        refreshElements();
        const query = request.query.toLowerCase();
        let bestIntent = null;
        let bestConfidence = 0;
        for (const intent of intentRegistry.values()) {
          let confidence = 0;
          const nameLower = intent.name.toLowerCase();
          const descLower = intent.description.toLowerCase();
          if (nameLower === query) {
            confidence = 1;
          } else if (nameLower.includes(query) || query.includes(nameLower)) {
            confidence = 0.8;
          } else if (descLower.includes(query)) {
            confidence = 0.6;
          }
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestIntent = intent;
          }
        }
        if (!bestIntent) {
          return success({
            success: false,
            intentId: "",
            error: `No intent found matching query: ${request.query}`,
            durationMs: Date.now() - startTime
          });
        }
        const nlResponse = await nlExecutor.execute({
          instruction: bestIntent.description,
          context: `Executing intent from query: ${request.query}`
        });
        return success({
          success: nlResponse.success,
          intentId: bestIntent.id,
          result: nlResponse,
          error: nlResponse.error,
          durationMs: Date.now() - startTime
        });
      } catch (err) {
        return error(err.message, "EXECUTE_INTENT_FROM_QUERY_ERROR");
      }
    },
    // =========================================================================
    // Recovery Handler
    // =========================================================================
    attemptRecovery: async (request) => {
      const startTime = Date.now();
      try {
        refreshElements();
        const strategiesAttempted = [];
        let lastResult;
        const suggestions = request.failure.suggestedActions ?? [];
        for (let i = 0; i < Math.min(suggestions.length, request.maxRetries); i++) {
          const suggestion = suggestions[i];
          strategiesAttempted.push(suggestion.suggestion || `strategy-${i}`);
          const instruction = suggestion.command || request.instruction;
          try {
            const result = await nlExecutor.execute({
              instruction,
              context: `Recovery attempt ${i + 1}: ${suggestion.suggestion}`
            });
            lastResult = result;
            if (result.success) {
              return success({
                recovered: true,
                strategiesAttempted,
                finalResult: result,
                durationMs: Date.now() - startTime
              });
            }
          } catch {
          }
        }
        if (strategiesAttempted.length === 0 || !lastResult?.success) {
          strategiesAttempted.push("direct-instruction");
          try {
            const result = await nlExecutor.execute({
              instruction: request.instruction,
              context: "Recovery: direct instruction attempt"
            });
            lastResult = result;
            if (result.success) {
              return success({
                recovered: true,
                strategiesAttempted,
                finalResult: result,
                durationMs: Date.now() - startTime
              });
            }
          } catch {
          }
        }
        return success({
          recovered: false,
          strategiesAttempted,
          finalResult: lastResult,
          error: "All recovery strategies exhausted",
          durationMs: Date.now() - startTime
        });
      } catch (err) {
        return error(err.message, "RECOVERY_ERROR");
      }
    },
    // =========================================================================
    // Cross-App Analysis Handlers
    // =========================================================================
    analyzePageData: async () => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        const result = extractPageData(snapshot.elements);
        return success(result);
      } catch (err) {
        return error(err.message, "ANALYZE_DATA_ERROR");
      }
    },
    analyzePageRegions: async () => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        const result = segmentPageRegions(snapshot.elements);
        return success(result);
      } catch (err) {
        return error(err.message, "ANALYZE_REGIONS_ERROR");
      }
    },
    analyzeStructuredData: async () => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const snapshot = snapshotManager.createSnapshot(controlSnapshot);
        const result = extractStructuredData(snapshot.elements);
        return success(result);
      } catch (err) {
        return error(err.message, "ANALYZE_STRUCTURED_DATA_ERROR");
      }
    },
    crossAppCompare: async (request) => {
      try {
        const hasComponents = request.sourceComponents && request.targetComponents;
        const report = generateComparisonReport(
          request.sourceSnapshot,
          request.targetSnapshot,
          hasComponents ? {
            config: { includeComponents: true },
            sourceComponents: request.sourceComponents,
            targetComponents: request.targetComponents
          } : void 0
        );
        return success(report);
      } catch (err) {
        return error(err.message, "CROSS_APP_COMPARE_ERROR");
      }
    },
    // =========================================================================
    // Performance Diagnostics Handlers
    // =========================================================================
    getPerformanceEntries: async () => {
      return {
        success: true,
        data: { navigation: null, resources: [], paint: [] },
        timestamp: Date.now()
      };
    },
    clearPerformanceEntries: async () => {
      return { success: true, data: { cleared: true }, timestamp: Date.now() };
    },
    getBrowserEvents: async (params) => {
      try {
        if (!hasFullEventAPI(consoleCapture)) {
          if (consoleCapture) {
            const errors = params?.since ? consoleCapture.getConsoleSince(params.since) : consoleCapture.getConsoleRecent(params?.limit ?? 50);
            return success({ events: errors, count: errors.length });
          }
          return success({ events: [], count: 0 });
        }
        let events;
        if (params?.type) {
          events = consoleCapture.getByType(params.type);
          if (params.since) {
            events = events.filter((e) => e.timestamp >= params.since);
          }
        } else if (params?.since) {
          events = consoleCapture.getSince(params.since);
        } else {
          events = consoleCapture.getRecent(params?.limit ?? 100);
        }
        if (params?.severity) {
          events = filterBySeverity(events, params.severity);
        }
        if (params?.deduplicate) {
          const grouped = deduplicateEvents(events);
          return success({
            events,
            count: events.length,
            deduplicated: grouped,
            uniqueCount: grouped.length
          });
        }
        if (params?.limit && events.length > params.limit) {
          events = events.slice(-params.limit);
        }
        return success({ events, count: events.length });
      } catch (err) {
        return error(err.message, "BROWSER_EVENTS_ERROR");
      }
    },
    getTimeline: async (params) => {
      try {
        if (!hasFullEventAPI(consoleCapture)) {
          return success({ entries: [], count: 0 });
        }
        const entries = timelineBuffer.getTimeline(consoleCapture, {
          since: params?.since,
          limit: params?.limit,
          minSeverity: params?.minSeverity
        });
        return success({ entries, count: entries.length });
      } catch (err) {
        return error(err.message, "TIMELINE_ERROR");
      }
    },
    // =========================================================================
    // Health Score Handler
    // =========================================================================
    getHealthReport: async (params) => {
      try {
        if (!hasFullEventAPI(consoleCapture)) {
          return success({
            status: "healthy",
            score: 100,
            summary: "No event capture available",
            breakdown: { crashes: 0, errors: 0, warnings: 0 },
            errorRate: 0,
            windowMs: params?.windowMs ?? 6e4,
            timestamp: Date.now()
          });
        }
        const report = computeHealthReport(consoleCapture, {
          windowMs: params?.windowMs
        });
        if (hasFullEventAPI(consoleCapture)) {
          const overlays = consoleCapture.getFrameworkOverlays?.() ?? [];
          if (overlays.length > 0) {
            report.status = "broken";
            report.score = Math.min(report.score, 10);
            const overlayNames = overlays.map((o) => o.framework).join(", ");
            report.summary = `Broken: ${overlayNames} error overlay visible. ${report.summary}`;
          }
        }
        return success(report);
      } catch (err) {
        return error(err.message, "HEALTH_REPORT_ERROR");
      }
    },
    // =========================================================================
    // Network Chain Handlers
    // =========================================================================
    getNetworkChains: async (params) => {
      try {
        let chains;
        if (params?.failuresOnly) {
          chains = networkChainTracker.getFailures();
        } else if (params?.url) {
          chains = networkChainTracker.getByUrl(params.url);
        } else if (params?.since) {
          chains = networkChainTracker.getSince(params.since);
        } else {
          chains = networkChainTracker.getRecent(params?.limit ?? 50);
        }
        if (params?.since && !params?.failuresOnly && !params?.url) {
        } else if (params?.since) {
          chains = chains.filter((c) => c.timestamp >= params.since);
        }
        if (params?.limit && chains.length > params.limit) {
          chains = chains.slice(-params.limit);
        }
        if (hasFullEventAPI(consoleCapture)) {
          const recentEvents = consoleCapture.getRecent(100);
          networkChainTracker.correlateErrors(recentEvents);
        }
        return success({ chains, count: chains.length });
      } catch (err) {
        return error(err.message, "NETWORK_CHAINS_ERROR");
      }
    },
    // =========================================================================
    // Error Session Handlers
    // =========================================================================
    startErrorSession: async (request) => {
      try {
        const session = errorSessionManager.startSession(request.label);
        return success({ sessionId: session.id });
      } catch (err) {
        return error(err.message, "SESSION_ERROR");
      }
    },
    endErrorSession: async () => {
      try {
        const summary = errorSessionManager.endSession();
        return success(summary);
      } catch (err) {
        return error(err.message, "SESSION_ERROR");
      }
    },
    getErrorSessions: async () => {
      try {
        return success(errorSessionManager.getSessions());
      } catch (err) {
        return error(err.message, "SESSION_ERROR");
      }
    },
    captureErrorBaseline: async (request) => {
      try {
        const label = request?.label;
        if (!label) {
          return error('Missing required "label" field in request body', "VALIDATION_ERROR");
        }
        if (!hasFullEventAPI(consoleCapture)) {
          return error("Browser event capture not available", "NO_CAPTURE");
        }
        const baseline = errorSessionManager.captureBaseline(label, consoleCapture);
        return success({
          label: baseline.label,
          capturedAt: baseline.capturedAt,
          fingerprintCount: baseline.fingerprints.size
        });
      } catch (err) {
        return error(err.message, "BASELINE_ERROR");
      }
    },
    compareErrorBaseline: async (request) => {
      try {
        const label = request?.label;
        if (!label) {
          return error('Missing required "label" field in request body', "VALIDATION_ERROR");
        }
        const comparison = errorSessionManager.compareToBaseline(
          label,
          hasFullEventAPI(consoleCapture) ? consoleCapture : void 0
        );
        if (comparison === null) {
          return error(`Baseline '${label}' not found`, "NOT_FOUND");
        }
        return success(comparison);
      } catch (err) {
        return error(err.message, "BASELINE_ERROR");
      }
    },
    // =========================================================================
    // Error Snapshot Handlers
    // =========================================================================
    getErrorSnapshots: async (params) => {
      try {
        const snapshots = errorSnapshotBuffer.getRecent(params?.limit ?? 10);
        return success({ snapshots, count: snapshots.length });
      } catch (err) {
        return error(err.message, "ERROR_SNAPSHOTS_ERROR");
      }
    },
    // =========================================================================
    // Composite Error Report (one-call summary)
    // =========================================================================
    getErrorReport: async () => {
      try {
        const health = hasFullEventAPI(consoleCapture) ? computeHealthReport(consoleCapture) : {
          status: "healthy",
          score: 100,
          summary: "No event capture available",
          breakdown: { crashes: 0, errors: 0, warnings: 0 },
          errorRate: 0,
          windowMs: 6e4,
          timestamp: Date.now()
        };
        const recentErrors = hasFullEventAPI(consoleCapture) ? filterBySeverity(consoleCapture.getSince(Date.now() - 3e4), "error") : [];
        const activeSession = errorSessionManager.getActive()?.getSummary() ?? null;
        const snapshots = errorSnapshotBuffer.getRecent(5);
        return success({ health, recentErrors, activeSession, snapshots });
      } catch (err) {
        return error(err.message, "ERROR_REPORT_ERROR");
      }
    },
    // =========================================================================
    // Design Review Handlers
    // =========================================================================
    getElementStyles: async (id) => {
      try {
        const rawElement = registry.getElement(id);
        if (!rawElement) {
          return error(`Element not found: ${id}`, "ELEMENT_NOT_FOUND");
        }
        const el = rawElement;
        if (!el.element || !(el.element instanceof HTMLElement)) {
          return error("Element does not have a DOM reference", "NO_DOM_REFERENCE");
        }
        const data = getElementDesignData(el.element, {
          elementId: el.id,
          label: el.label,
          type: el.type,
          includePseudoElements: true
        });
        return success(data);
      } catch (err) {
        return error(err.message, "DESIGN_STYLES_ERROR");
      }
    },
    getElementStateStyles: async (id, request) => {
      try {
        const rawElement = registry.getElement(id);
        if (!rawElement) {
          return error(`Element not found: ${id}`, "ELEMENT_NOT_FOUND");
        }
        const el = rawElement;
        if (!el.element || !(el.element instanceof HTMLElement)) {
          return error("Element does not have a DOM reference", "NO_DOM_REFERENCE");
        }
        const stateStyles = await captureStateVariations(el.element, request.states);
        return success({ elementId: id, stateStyles });
      } catch (err) {
        return error(err.message, "DESIGN_STATE_STYLES_ERROR");
      }
    },
    getDesignSnapshot: async (request) => {
      try {
        const allElements = registry.getAllElements();
        const elements = request?.elementIds ? allElements.filter((el) => request.elementIds.includes(el.id)) : allElements;
        const designData = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type,
                includePseudoElements: request?.includePseudoElements
              })
            );
          }
        }
        return success({ elements: designData, timestamp: Date.now() });
      } catch (err) {
        return error(err.message, "DESIGN_SNAPSHOT_ERROR");
      }
    },
    getResponsiveSnapshots: async (request) => {
      try {
        const viewports = request.viewports || DEFAULT_VIEWPORTS;
        const allElements = registry.getAllElements();
        const filteredElements = request.elementIds ? allElements.filter((el) => request.elementIds.includes(el.id)) : allElements;
        const registryAdapter = {
          getAllElements: () => filteredElements.filter((el) => el.element instanceof HTMLElement).map((el) => ({
            id: el.id,
            element: el.element,
            type: el.type,
            label: el.label
          }))
        };
        const snapshots = await captureResponsiveSnapshots(registryAdapter, viewports);
        return success(snapshots);
      } catch (err) {
        return error(err.message, "RESPONSIVE_SNAPSHOT_ERROR");
      }
    },
    setViewportConstraints: async (request) => {
      try {
        const root = document.documentElement;
        if (request.restore) {
          root.style.removeProperty("max-width");
          root.style.removeProperty("margin");
          root.style.removeProperty("overflow-x");
        } else if (request.width && request.width > 0) {
          root.style.maxWidth = `${request.width}px`;
          root.style.margin = "0 auto";
          root.style.overflowX = "hidden";
        }
        return success({
          success: true,
          viewportWidth: window.innerWidth,
          constrainedWidth: root.clientWidth,
          timestamp: Date.now()
        });
      } catch (err) {
        return error(err.message, "VIEWPORT_CONSTRAINTS_ERROR");
      }
    },
    runDesignAudit: async (request) => {
      try {
        const guide = request?.guide || loadedStyleGuide;
        if (!guide) {
          return error("No style guide loaded or provided", "NO_STYLE_GUIDE");
        }
        const allElements = registry.getAllElements();
        const elements = request?.elementIds ? allElements.filter((el) => request.elementIds.includes(el.id)) : allElements;
        const designData = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type
              })
            );
          }
        }
        const report = runStyleAudit(designData, guide);
        return success(report);
      } catch (err) {
        return error(err.message, "DESIGN_AUDIT_ERROR");
      }
    },
    loadStyleGuide: async (request) => {
      try {
        loadedStyleGuide = request.guide;
        return success({ loaded: true });
      } catch (err) {
        return error(err.message, "LOAD_STYLE_GUIDE_ERROR");
      }
    },
    getStyleGuide: async () => {
      return success(loadedStyleGuide);
    },
    clearStyleGuide: async () => {
      loadedStyleGuide = null;
      return success({ cleared: true });
    },
    // Quality evaluation endpoints
    evaluateQuality: async (request) => {
      try {
        const allElements = registry.getAllElements();
        const elements = request?.elementIds ? allElements.filter((el) => request.elementIds.includes(el.id)) : allElements;
        const designData = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type
              })
            );
          }
        }
        const viewport = request?.viewport ?? {
          width: window.innerWidth,
          height: window.innerHeight
        };
        let context = request?.customContext ?? request?.context ?? "general";
        if (typeof context === "string" && loadedStyleGuide?.qualityContexts?.[context]) {
          context = loadedStyleGuide.qualityContexts[context];
        }
        const report = evaluateQuality(designData, viewport, context);
        return success(report);
      } catch (err) {
        return error(err.message, "QUALITY_EVALUATION_ERROR");
      }
    },
    getQualityContexts: async () => {
      return success(listContexts());
    },
    saveBaseline: async (request) => {
      try {
        const allElements = registry.getAllElements();
        const elements = request?.elementIds ? allElements.filter((el) => request.elementIds.includes(el.id)) : allElements;
        const designData = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type
              })
            );
          }
        }
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight
        };
        savedBaseline = createBaseline(designData, viewport, request?.label);
        return success({ saved: true, elementCount: designData.length });
      } catch (err) {
        return error(err.message, "SAVE_BASELINE_ERROR");
      }
    },
    diffBaseline: async (request) => {
      try {
        if (!savedBaseline) {
          return error("No baseline saved. Call saveBaseline first.", "NO_BASELINE");
        }
        const allElements = registry.getAllElements();
        const elements = request?.elementIds ? allElements.filter((el) => request.elementIds.includes(el.id)) : allElements;
        const designData = [];
        for (const el of elements) {
          if (el.element && el.element instanceof HTMLElement) {
            designData.push(
              getElementDesignData(el.element, {
                elementId: el.id,
                label: el.label,
                type: el.type
              })
            );
          }
        }
        const report = diffSnapshots(savedBaseline, designData);
        return success(report);
      } catch (err) {
        return error(err.message, "DIFF_BASELINE_ERROR");
      }
    },
    // =========================================================================
    // Form State Awareness Handlers
    // =========================================================================
    getForms: async () => {
      try {
        refreshElements();
        const elements = registry.getAllElements();
        return success(discoverForms(elements));
      } catch (err) {
        return error(err.message, "FORMS_ERROR");
      }
    },
    fillForm: async (request) => {
      try {
        if (!request?.fields || Object.keys(request.fields).length === 0) {
          return error('Request must include a non-empty "fields" map', "VALIDATION_ERROR");
        }
        if (actionExecutor.fillForm) {
          const result = await actionExecutor.fillForm(request);
          return success(result);
        }
        return error("fillForm is not supported by the current action executor", "UNSUPPORTED");
      } catch (err) {
        return error(err.message, "FILL_FORM_ERROR");
      }
    },
    snapshotForms: async () => {
      try {
        const snapshot = captureFormSnapshot();
        return success(snapshot);
      } catch (err) {
        return error(err.message, "FORM_SNAPSHOT_ERROR");
      }
    },
    diffForms: async (request) => {
      try {
        if (!request.before || !request.after) {
          return error('Both "before" and "after" snapshots are required', "INVALID_REQUEST");
        }
        const diff = diffFormSnapshots(request.before, request.after);
        return success(diff);
      } catch (err) {
        return error(err.message, "FORM_DIFF_ERROR");
      }
    },
    // =========================================================================
    // Clipboard Handlers
    // =========================================================================
    getClipboard: async () => {
      try {
        if (typeof navigator === "undefined" || !navigator.clipboard) {
          return error("Clipboard API not available in this environment", "CLIPBOARD_UNAVAILABLE");
        }
        try {
          const perm = await navigator.permissions.query({
            name: "clipboard-read"
          });
          if (perm.state === "denied") {
            return error("Clipboard read permission denied", "CLIPBOARD_PERMISSION_DENIED");
          }
        } catch {
        }
        const text = await navigator.clipboard.readText();
        const formats = ["text/plain"];
        return success({ text, formats });
      } catch (err) {
        return error(err.message, "CLIPBOARD_READ_ERROR");
      }
    },
    setClipboard: async (request) => {
      try {
        if (typeof navigator === "undefined" || !navigator.clipboard) {
          return error("Clipboard API not available in this environment", "CLIPBOARD_UNAVAILABLE");
        }
        if (!request?.text && !request?.html) {
          return error('Request must include "text" or "html"', "VALIDATION_ERROR");
        }
        const formats = [];
        if (request.html) {
          const items = [
            new ClipboardItem({
              "text/html": new Blob([request.html], { type: "text/html" }),
              "text/plain": new Blob([request.text || ""], { type: "text/plain" })
            })
          ];
          await navigator.clipboard.write(items);
          formats.push("text/html", "text/plain");
        } else {
          await navigator.clipboard.writeText(request.text);
          formats.push("text/plain");
        }
        return success({ written: true, formats });
      } catch (err) {
        return error(err.message, "CLIPBOARD_WRITE_ERROR");
      }
    },
    // =========================================================================
    // Network Request Monitoring Handlers
    // =========================================================================
    getNetworkRequests: async (params) => {
      if (!networkTracker) {
        return error("Network monitoring is disabled", "NETWORK_MONITORING_DISABLED");
      }
      const filter = {};
      if (params?.status) filter.status = params.status;
      if (params?.method) filter.method = params.method;
      if (params?.urlPattern) filter.urlPattern = params.urlPattern;
      if (params?.failuresOnly) filter.failuresOnly = params.failuresOnly;
      if (params?.since) filter.since = params.since;
      if (params?.limit) filter.limit = params.limit;
      const requests = networkTracker.getAll(filter);
      const inFlight = networkTracker.getInFlight();
      return {
        success: true,
        data: { requests, count: requests.length, inFlightCount: inFlight.length },
        timestamp: Date.now()
      };
    },
    getNetworkRequestsInFlight: async () => {
      if (!networkTracker) {
        return error("Network monitoring is disabled", "NETWORK_MONITORING_DISABLED");
      }
      const requests = networkTracker.getInFlight();
      return {
        success: true,
        data: { requests, count: requests.length },
        timestamp: Date.now()
      };
    },
    waitForNetworkRequest: async (request) => {
      if (!networkTracker) {
        return error("Network monitoring is disabled", "NETWORK_MONITORING_DISABLED");
      }
      try {
        const result = await networkTracker.waitForRequest(request);
        return {
          success: true,
          data: result,
          timestamp: Date.now()
        };
      } catch (err) {
        return error(err.message, "NETWORK_WAIT_ERROR");
      }
    },
    getNetworkRequest: async (id) => {
      if (!networkTracker) {
        return error("Network monitoring is disabled", "NETWORK_MONITORING_DISABLED");
      }
      const entry = networkTracker.getById(id);
      if (!entry) {
        return {
          success: false,
          error: `Request not found: ${id}`,
          code: "NOT_FOUND",
          timestamp: Date.now()
        };
      }
      return {
        success: true,
        data: entry,
        timestamp: Date.now()
      };
    },
    // =========================================================================
    // Idle Detection Handlers
    // =========================================================================
    getIdleStatus: async () => {
      if (!idleDetector) {
        return error("Idle detection is disabled", "IDLE_DISABLED");
      }
      return success(idleDetector.getStatus());
    },
    getIdleSignalStatus: async (signal) => {
      if (!idleDetector) {
        return error("Idle detection is disabled", "IDLE_DISABLED");
      }
      const status = idleDetector.getSignalStatus(signal);
      if (!status) {
        return error(
          `Signal not found: ${signal}. Available: ${idleDetector.getSignalNames().join(", ")}`,
          "SIGNAL_NOT_FOUND"
        );
      }
      return success(status);
    },
    waitForIdle: async (request) => {
      if (!idleDetector) {
        return error("Idle detection is disabled", "IDLE_DISABLED");
      }
      try {
        const status = await idleDetector.waitForIdle({
          timeout: request?.timeout,
          minStableMs: request?.minStableMs,
          exclude: request?.exclude
        });
        return success(status);
      } catch (err) {
        return error(err.message, "IDLE_TIMEOUT");
      }
    },
    waitForSignalIdle: async (signal, request) => {
      if (!idleDetector) {
        return error("Idle detection is disabled", "IDLE_DISABLED");
      }
      try {
        const status = await idleDetector.waitForSignal(signal, {
          timeout: request?.timeout,
          minStableMs: request?.minStableMs
        });
        return success(status);
      } catch (err) {
        return error(err.message, "IDLE_TIMEOUT");
      }
    },
    waitForTargets: async (request) => {
      if (!idleDetector) {
        return error("Idle detection is disabled", "IDLE_DISABLED");
      }
      try {
        const results = await idleDetector.waitFor(request.targets, {
          timeout: request.timeout,
          minStableMs: request.minStableMs
        });
        return success(results);
      } catch (err) {
        return error(err.message, "IDLE_TIMEOUT");
      }
    },
    // Undo/redo awareness endpoints
    getUndoState: async () => {
      if (!undoTracker) {
        return error("Undo tracking is not available", "UNDO_UNAVAILABLE");
      }
      try {
        const state = undoTracker.getState();
        return success(state);
      } catch (err) {
        return error(err.message, "UNDO_ERROR");
      }
    },
    executeUndo: async () => {
      if (!undoTracker) {
        return error("Undo tracking is not available", "UNDO_UNAVAILABLE");
      }
      try {
        const executed = undoTracker.executeUndo();
        return success({ executed });
      } catch (err) {
        return error(err.message, "UNDO_ERROR");
      }
    },
    executeRedo: async () => {
      if (!undoTracker) {
        return error("Undo tracking is not available", "UNDO_UNAVAILABLE");
      }
      try {
        const executed = undoTracker.executeRedo();
        return success({ executed });
      } catch (err) {
        return error(err.message, "UNDO_ERROR");
      }
    },
    // =========================================================================
    // API Discovery
    // =========================================================================
    getCapabilities: async () => {
      return {
        success: true,
        data: {
          version: "0.3.0",
          categories: {
            elements: {
              description: "Discover, inspect, and interact with UI elements",
              endpoints: [
                {
                  method: "GET",
                  path: "/control/elements",
                  description: "List all registered elements"
                },
                {
                  method: "GET",
                  path: "/control/element/:id",
                  description: "Get element details by ID"
                },
                {
                  method: "GET",
                  path: "/control/element/:id/state",
                  description: "Get element state"
                },
                {
                  method: "GET",
                  path: "/control/element/:id/react-state",
                  description: "Get React props and fiber state for element"
                },
                {
                  method: "POST",
                  path: "/control/element/:id/action",
                  description: "Execute action on element"
                },
                {
                  method: "POST",
                  path: "/control/actions/batch",
                  description: "Execute batch actions on multiple elements"
                },
                {
                  method: "POST",
                  path: "/control/get-element-images",
                  description: "Get rendered images for elements"
                }
              ]
            },
            components: {
              description: "Inspect and interact with UI components",
              endpoints: [
                {
                  method: "GET",
                  path: "/control/components",
                  description: "List all registered components"
                },
                {
                  method: "GET",
                  path: "/control/component/:id",
                  description: "Get component details by ID"
                },
                {
                  method: "GET",
                  path: "/control/component/:id/state",
                  description: "Get component state"
                },
                {
                  method: "POST",
                  path: "/control/component/:id/action/:actionId",
                  description: "Execute action on component"
                }
              ]
            },
            discovery: {
              description: "Find elements and capture page snapshots",
              endpoints: [
                {
                  method: "POST",
                  path: "/control/find",
                  description: "Find elements matching criteria"
                },
                {
                  method: "POST",
                  path: "/control/discover",
                  description: "Discover elements (deprecated, use /control/find)"
                },
                {
                  method: "GET",
                  path: "/control/snapshot",
                  description: "Capture full control snapshot"
                },
                { method: "GET", path: "/control/workflows", description: "List all workflows" },
                {
                  method: "POST",
                  path: "/control/workflow/:id/run",
                  description: "Run a workflow"
                },
                {
                  method: "GET",
                  path: "/control/workflow/:runId/status",
                  description: "Get workflow run status"
                }
              ]
            },
            navigation: {
              description: "Page navigation controls",
              endpoints: [
                {
                  method: "POST",
                  path: "/control/page/refresh",
                  description: "Refresh current page"
                },
                { method: "POST", path: "/control/page/navigate", description: "Navigate to URL" },
                { method: "POST", path: "/control/page/back", description: "Navigate back" },
                { method: "POST", path: "/control/page/forward", description: "Navigate forward" }
              ]
            },
            ai: {
              description: "AI-native search, execution, assertions, and semantic analysis",
              endpoints: [
                {
                  method: "POST",
                  path: "/ai/search",
                  description: "Search elements using natural language"
                },
                {
                  method: "POST",
                  path: "/ai/find",
                  description: "Find element by natural language query"
                },
                {
                  method: "POST",
                  path: "/ai/execute",
                  description: "Execute action via natural language"
                },
                { method: "POST", path: "/ai/assert", description: "Assert UI condition" },
                {
                  method: "POST",
                  path: "/ai/assert/batch",
                  description: "Assert multiple UI conditions"
                },
                {
                  method: "GET",
                  path: "/ai/snapshot",
                  description: "Get semantic snapshot of current page"
                },
                {
                  method: "GET",
                  path: "/ai/diff",
                  description: "Get semantic diff since last snapshot"
                },
                {
                  method: "GET",
                  path: "/ai/summary",
                  description: "Get natural language page summary"
                },
                {
                  method: "POST",
                  path: "/ai/semantic-search",
                  description: "Search using semantic embeddings"
                }
              ]
            },
            change_tracking: {
              description: "Track, diff, and analyze UI changes",
              endpoints: [
                {
                  method: "POST",
                  path: "/ai/execute-with-diff",
                  description: "Execute action and capture diff"
                },
                {
                  method: "POST",
                  path: "/ai/wait-for-change",
                  description: "Wait for UI change matching predicate"
                },
                {
                  method: "GET",
                  path: "/ai/categorize-last-diff",
                  description: "Categorize the last diff"
                },
                {
                  method: "POST",
                  path: "/ai/scoped-diff",
                  description: "Get diff scoped to element/region"
                },
                {
                  method: "POST",
                  path: "/ai/summarize-diff",
                  description: "Summarize diff within token budget"
                },
                {
                  method: "POST",
                  path: "/ai/structured-changes",
                  description: "Analyze structured changes (tables, lists)"
                },
                {
                  method: "POST",
                  path: "/ai/change-buffer/enable",
                  description: "Enable change buffer"
                },
                {
                  method: "POST",
                  path: "/ai/change-buffer/disable",
                  description: "Disable change buffer"
                },
                {
                  method: "POST",
                  path: "/ai/change-buffer/drain",
                  description: "Drain buffered changes"
                },
                {
                  method: "GET",
                  path: "/ai/change-buffer/size",
                  description: "Get change buffer size"
                },
                { method: "POST", path: "/ai/bookmarks", description: "Save snapshot bookmark" },
                { method: "GET", path: "/ai/bookmarks", description: "List all bookmarks" },
                { method: "GET", path: "/ai/bookmark/:name", description: "Get bookmark by name" },
                { method: "DELETE", path: "/ai/bookmark/:name", description: "Delete bookmark" },
                {
                  method: "GET",
                  path: "/ai/bookmark/:name/diff",
                  description: "Get diff from bookmark"
                }
              ]
            },
            idle_detection: {
              description: "Detect and wait for UI idle states",
              endpoints: [
                {
                  method: "GET",
                  path: "/control/idle-status",
                  description: "Get composite idle status"
                },
                {
                  method: "POST",
                  path: "/control/wait-for-idle",
                  description: "Wait for UI to become idle"
                },
                {
                  method: "POST",
                  path: "/control/wait-for-targets",
                  description: "Wait for specific idle targets"
                },
                {
                  method: "GET",
                  path: "/control/idle-status/:signal",
                  description: "Get idle status for specific signal"
                },
                {
                  method: "POST",
                  path: "/control/wait-for-idle/:signal",
                  description: "Wait for specific signal to become idle"
                }
              ]
            },
            network: {
              description: "Monitor network requests",
              endpoints: [
                {
                  method: "GET",
                  path: "/control/network-requests",
                  description: "List network requests"
                },
                {
                  method: "GET",
                  path: "/control/network-requests/in-flight",
                  description: "List in-flight requests"
                },
                {
                  method: "POST",
                  path: "/control/network-requests/wait",
                  description: "Wait for network request matching criteria"
                },
                {
                  method: "GET",
                  path: "/control/network-request/:id",
                  description: "Get network request details"
                },
                {
                  method: "GET",
                  path: "/control/network-chains",
                  description: "Get network request chains"
                }
              ]
            },
            forms: {
              description: "Form state inspection, filling, and diffing",
              endpoints: [
                { method: "GET", path: "/control/forms", description: "Get all form states" },
                { method: "POST", path: "/control/fill", description: "Fill form fields" },
                {
                  method: "POST",
                  path: "/control/forms/snapshot",
                  description: "Capture form snapshot"
                },
                {
                  method: "POST",
                  path: "/control/forms/diff",
                  description: "Diff two form snapshots"
                }
              ]
            },
            design: {
              description: "Design review, style auditing, and quality evaluation",
              endpoints: [
                {
                  method: "GET",
                  path: "/design/element/:id/styles",
                  description: "Get element computed styles"
                },
                {
                  method: "POST",
                  path: "/design/element/:id/state-styles",
                  description: "Get element styles across interaction states"
                },
                {
                  method: "POST",
                  path: "/design/snapshot",
                  description: "Capture design snapshot"
                },
                {
                  method: "POST",
                  path: "/design/responsive",
                  description: "Capture responsive snapshots at viewports"
                },
                { method: "POST", path: "/design/audit", description: "Run design style audit" },
                {
                  method: "POST",
                  path: "/design/style-guide/load",
                  description: "Load style guide configuration"
                },
                {
                  method: "GET",
                  path: "/design/style-guide",
                  description: "Get current style guide"
                },
                { method: "DELETE", path: "/design/style-guide", description: "Clear style guide" },
                { method: "POST", path: "/design/evaluate", description: "Evaluate UI quality" },
                {
                  method: "GET",
                  path: "/design/evaluate/contexts",
                  description: "List quality evaluation contexts"
                },
                {
                  method: "POST",
                  path: "/design/evaluate/baseline",
                  description: "Save quality baseline"
                },
                {
                  method: "POST",
                  path: "/design/evaluate/diff",
                  description: "Diff against quality baseline"
                }
              ]
            },
            debug: {
              description: "Debugging tools, diagnostics, and error tracking",
              endpoints: [
                { method: "GET", path: "/debug/action-history", description: "Get action history" },
                { method: "GET", path: "/debug/metrics", description: "Get bridge metrics" },
                {
                  method: "POST",
                  path: "/debug/highlight/:id",
                  description: "Highlight element in UI"
                },
                {
                  method: "GET",
                  path: "/debug/element-tree",
                  description: "Get element tree structure"
                },
                {
                  method: "GET",
                  path: "/debug/element-history/:id",
                  description: "Get element event history"
                },
                {
                  method: "GET",
                  path: "/control/console-errors",
                  description: "Get captured console errors",
                  queryParams: {
                    since: "number (epoch ms) \u2014 filter errors after this timestamp",
                    sinceId: "number \u2014 monotonic cursor id; return entries with id > sinceId (takes precedence over since)",
                    limit: "number (default 50, max 500) \u2014 max errors to return",
                    group: "boolean (default false) \u2014 group errors by fingerprint",
                    groupBy: "'fingerprint' | 'message' | 'source' (default 'fingerprint') \u2014 grouping strategy"
                  }
                },
                {
                  method: "POST",
                  path: "/control/console-errors/clear",
                  description: "Clear captured console errors"
                },
                {
                  method: "GET",
                  path: "/control/performance-entries",
                  description: "Get performance entries"
                },
                {
                  method: "POST",
                  path: "/control/performance-entries/clear",
                  description: "Clear performance entries"
                },
                {
                  method: "GET",
                  path: "/control/browser-events",
                  description: "Get captured browser events"
                },
                { method: "GET", path: "/control/timeline", description: "Get error timeline" },
                { method: "GET", path: "/control/health", description: "Get health score report" },
                {
                  method: "POST",
                  path: "/control/error-sessions/start",
                  description: "Start error tracking session"
                },
                {
                  method: "POST",
                  path: "/control/error-sessions/end",
                  description: "End error tracking session"
                },
                {
                  method: "GET",
                  path: "/control/error-sessions",
                  description: "List error sessions"
                },
                {
                  method: "POST",
                  path: "/control/error-baselines/capture",
                  description: "Capture error baseline"
                },
                {
                  method: "POST",
                  path: "/control/error-baselines/compare",
                  description: "Compare against error baseline"
                },
                {
                  method: "GET",
                  path: "/control/error-snapshots",
                  description: "Get auto-captured error snapshots"
                },
                {
                  method: "GET",
                  path: "/control/error-report",
                  description: "Get composite error report"
                },
                { method: "GET", path: "/render-log", description: "Get render log entries" },
                {
                  method: "GET",
                  path: "/control/render-log",
                  description: "Get render log entries (alias)"
                },
                { method: "DELETE", path: "/render-log", description: "Clear render log" },
                {
                  method: "POST",
                  path: "/render-log/snapshot",
                  description: "Capture render snapshot"
                },
                {
                  method: "GET",
                  path: "/render-log/path",
                  description: "Get render log file path"
                }
              ]
            },
            events: {
              description: "Real-time event streaming via SSE and browser event capture",
              endpoints: [
                {
                  method: "GET",
                  path: "/control/events/stream",
                  description: "SSE stream of bridge events"
                },
                {
                  method: "GET",
                  path: "/control/changes/stream",
                  description: "SSE stream of UI changes"
                },
                {
                  method: "GET",
                  path: "/control/changes/since",
                  description: "Get changes since timestamp"
                },
                {
                  method: "GET",
                  path: "/control/browser-events",
                  description: "Get captured browser events"
                }
              ]
            },
            annotations: {
              description: "Element annotation CRUD, import/export, and coverage",
              endpoints: [
                { method: "GET", path: "/annotations", description: "Get all annotations" },
                {
                  method: "GET",
                  path: "/annotations/:id",
                  description: "Get annotation by element ID"
                },
                {
                  method: "PUT",
                  path: "/annotations/:id",
                  description: "Set annotation for element"
                },
                { method: "DELETE", path: "/annotations/:id", description: "Delete annotation" },
                {
                  method: "POST",
                  path: "/annotations/import",
                  description: "Import annotations from config"
                },
                {
                  method: "GET",
                  path: "/annotations/export",
                  description: "Export all annotations"
                },
                {
                  method: "GET",
                  path: "/annotations/coverage",
                  description: "Get annotation coverage report"
                }
              ]
            },
            state_management: {
              description: "UI state machines, transitions, and navigation",
              endpoints: [
                { method: "GET", path: "/control/states", description: "List all states" },
                { method: "GET", path: "/control/states/active", description: "Get active states" },
                {
                  method: "GET",
                  path: "/control/states/snapshot",
                  description: "Get state snapshot"
                },
                {
                  method: "POST",
                  path: "/control/states/find-path",
                  description: "Find path to target states"
                },
                {
                  method: "POST",
                  path: "/control/states/navigate",
                  description: "Navigate to target states"
                },
                { method: "GET", path: "/control/state/:id", description: "Get state by ID" },
                {
                  method: "POST",
                  path: "/control/state/:id/activate",
                  description: "Activate state"
                },
                {
                  method: "POST",
                  path: "/control/state/:id/deactivate",
                  description: "Deactivate state"
                },
                { method: "GET", path: "/control/state-groups", description: "List state groups" },
                {
                  method: "POST",
                  path: "/control/state-group/:id/activate",
                  description: "Activate state group"
                },
                {
                  method: "POST",
                  path: "/control/state-group/:id/deactivate",
                  description: "Deactivate state group"
                },
                {
                  method: "GET",
                  path: "/control/transitions",
                  description: "List all transitions"
                },
                {
                  method: "GET",
                  path: "/control/transition/:id/can-execute",
                  description: "Check if transition can execute"
                },
                {
                  method: "POST",
                  path: "/control/transition/:id/execute",
                  description: "Execute transition"
                }
              ]
            },
            clipboard: {
              description: "Read and write clipboard contents",
              endpoints: [
                {
                  method: "GET",
                  path: "/control/clipboard",
                  description: "Read clipboard contents"
                },
                { method: "POST", path: "/control/clipboard", description: "Write to clipboard" }
              ]
            },
            undo_redo: {
              description: "Undo/redo state inspection and execution",
              endpoints: [
                { method: "GET", path: "/control/undo-state", description: "Get undo/redo state" },
                { method: "POST", path: "/control/undo", description: "Execute undo" },
                { method: "POST", path: "/control/redo", description: "Execute redo" }
              ]
            },
            recovery: {
              description: "Error recovery attempts",
              endpoints: [
                {
                  method: "POST",
                  path: "/ai/recovery/attempt",
                  description: "Attempt error recovery"
                }
              ]
            },
            intents: {
              description: "Intent-based action discovery and execution",
              endpoints: [
                { method: "GET", path: "/ai/intents", description: "List available intents" },
                {
                  method: "POST",
                  path: "/ai/intents/execute",
                  description: "Execute intent by ID"
                },
                {
                  method: "POST",
                  path: "/ai/intents/find",
                  description: "Find intent matching query"
                },
                {
                  method: "POST",
                  path: "/ai/intents/register",
                  description: "Register new intent"
                },
                {
                  method: "POST",
                  path: "/ai/intents/execute-from-query",
                  description: "Find and execute intent from query"
                }
              ]
            },
            specs: {
              description: "Loaded spec configurations for runner discovery",
              endpoints: [
                { method: "GET", path: "/control/specs", description: "List all loaded specs" }
              ]
            },
            analysis: {
              description: "Cross-app page analysis and structured data extraction",
              endpoints: [
                {
                  method: "GET",
                  path: "/ai/analyze/data",
                  description: "Analyze page data"
                },
                {
                  method: "GET",
                  path: "/ai/analyze/regions",
                  description: "Analyze page regions"
                },
                {
                  method: "GET",
                  path: "/ai/analyze/structured-data",
                  description: "Analyze structured data on page"
                },
                {
                  method: "POST",
                  path: "/ai/analyze/cross-app-compare",
                  description: "Compare data across apps"
                }
              ]
            },
            media: {
              description: "Media discovery, analysis, and auditing",
              endpoints: [
                {
                  method: "POST",
                  path: "/ai/media/find",
                  description: "Find media elements on page"
                },
                {
                  method: "POST",
                  path: "/ai/media/audit/accessibility",
                  description: "Audit media accessibility"
                },
                {
                  method: "POST",
                  path: "/ai/media/audit/performance",
                  description: "Audit media performance"
                },
                {
                  method: "POST",
                  path: "/ai/media/snapshot",
                  description: "Capture media snapshot"
                },
                {
                  method: "POST",
                  path: "/ai/media/compare",
                  description: "Compare media snapshots"
                },
                {
                  method: "POST",
                  path: "/ai/media/analyze",
                  description: "Analyze media element"
                },
                {
                  method: "POST",
                  path: "/ai/media/analyze/batch",
                  description: "Batch analyze media elements"
                },
                {
                  method: "POST",
                  path: "/ai/media/analyze/page",
                  description: "Analyze all media on page"
                }
              ]
            },
            system: {
              description: "System and lifecycle endpoints",
              endpoints: [
                {
                  method: "POST",
                  path: "/heartbeat",
                  description: "Send heartbeat to keep connection alive"
                },
                {
                  method: "GET",
                  path: "/capabilities",
                  description: "Get API capabilities and endpoint listing"
                }
              ]
            }
          }
        },
        timestamp: Date.now()
      };
    },
    // =========================================================================
    // Specs
    // =========================================================================
    getSpecs: async () => {
      const allSpecs = specStore.getAll();
      const result = {};
      for (const [specId, config2] of allSpecs) {
        result[specId] = config2;
      }
      return {
        success: true,
        data: result,
        timestamp: Date.now()
      };
    },
    receiveHeartbeat: async () => {
      return {
        success: true,
        data: { received: true },
        timestamp: Date.now()
      };
    },
    getElementHistory: async (elementId, options) => {
      try {
        const entries = registry.getElementHistory?.(elementId, options) ?? [];
        return success(entries);
      } catch (err) {
        return error(err.message, "ELEMENT_HISTORY_ERROR");
      }
    },
    // =========================================================================
    // Media Discovery & Analysis (delegated to browser via relay in relay-handlers)
    // =========================================================================
    findMedia: async (_request) => {
      try {
        refreshElements();
        const allElements = registry.getAllElements();
        const mediaTypes = /* @__PURE__ */ new Set(["image", "video", "audio", "svg", "picture", "icon"]);
        const rawMediaElements = allElements.filter((el) => {
          const elType = el.type ?? "";
          return mediaTypes.has(elType);
        });
        const mediaElements = rawMediaElements.map((raw) => {
          const el = raw;
          const state = el.getState?.() ?? {};
          return {
            id: el.id,
            type: el.type ?? "unknown",
            label: el.label,
            tagName: el.element?.tagName?.toLowerCase?.() ?? el.tagName ?? el.type ?? "unknown",
            role: el.role,
            accessibleName: el.accessibleName,
            actions: el.actions ?? [],
            state,
            registered: true,
            category: el.category ?? "media",
            contentMetadata: el.contentMetadata,
            mediaMetadata: el.mediaMetadata
          };
        });
        const response = {
          elements: mediaElements,
          total: mediaElements.length,
          durationMs: 0,
          timestamp: Date.now()
        };
        return success(response);
      } catch (err) {
        return error(err.message, "FIND_MEDIA_ERROR");
      }
    },
    mediaAuditAccessibility: async () => {
      return error(
        "mediaAuditAccessibility not implemented in direct handlers \u2014 use relay-handlers",
        "NOT_IMPLEMENTED"
      );
    },
    mediaAuditPerformance: async () => {
      return error(
        "mediaAuditPerformance not implemented in direct handlers \u2014 use relay-handlers",
        "NOT_IMPLEMENTED"
      );
    },
    captureMediaSnapshot: async (_request) => {
      return error(
        "captureMediaSnapshot not implemented in direct handlers \u2014 use relay-handlers",
        "NOT_IMPLEMENTED"
      );
    },
    compareMediaSnapshots: async (_request) => {
      return error(
        "compareMediaSnapshots not implemented in direct handlers \u2014 use relay-handlers",
        "NOT_IMPLEMENTED"
      );
    },
    analyzeMedia: async (_request) => {
      return error(
        "analyzeMedia not implemented in direct handlers \u2014 use relay-handlers",
        "NOT_IMPLEMENTED"
      );
    },
    analyzeMediaBatch: async (_request) => {
      return error(
        "analyzeMediaBatch not implemented in direct handlers \u2014 use relay-handlers",
        "NOT_IMPLEMENTED"
      );
    },
    analyzeMediaPage: async (_request) => {
      return error(
        "analyzeMediaPage not implemented in direct handlers \u2014 use relay-handlers",
        "NOT_IMPLEMENTED"
      );
    },
    getChangesSince: async (_params) => {
      return success({ events: [], count: 0 });
    },
    pageEvaluate: async (_request) => {
      return error("pageEvaluate requires browser context \u2014 use relay-handlers", "NOT_IMPLEMENTED");
    },
    pageScroll: async (_request) => {
      return error("pageScroll requires browser context \u2014 use relay-handlers", "NOT_IMPLEMENTED");
    },
    clipboardWrite: async (_request) => {
      return error(
        "clipboardWrite requires browser context \u2014 use relay-handlers",
        "NOT_IMPLEMENTED"
      );
    },
    clipboardRead: async () => {
      return error(
        "clipboardRead requires browser context \u2014 use relay-handlers",
        "NOT_IMPLEMENTED"
      );
    },
    // =========================================================================
    // Enhanced Discovery & Navigation
    // =========================================================================
    query: async (request) => {
      try {
        const { selector, limit = 50, includeState = true } = request;
        const found = document.querySelectorAll(selector);
        const results = [];
        for (let i = 0; i < Math.min(found.length, limit); i++) {
          const el = found[i];
          const info = {
            tagName: el.tagName.toLowerCase(),
            id: el.id || void 0,
            className: classString(el) || void 0,
            textContent: el.textContent?.trim().substring(0, 200) || "",
            visible: el.offsetParent !== null
          };
          if (includeState) {
            const rect = el.getBoundingClientRect();
            info.rect = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            };
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              info.value = el.value;
              info.placeholder = el.placeholder;
              info.disabled = el.disabled;
            }
            if (el instanceof HTMLSelectElement) {
              info.value = el.value;
              info.options = Array.from(el.options).map((o) => ({
                value: o.value,
                text: o.text,
                selected: o.selected
              }));
            }
            if (el instanceof HTMLButtonElement) info.disabled = el.disabled;
            const attrs = {};
            for (const a of [
              "data-tutorial-id",
              "title",
              "aria-label",
              "role",
              "href",
              "placeholder"
            ]) {
              const v = el.getAttribute(a);
              if (v) attrs[a] = v;
            }
            if (Object.keys(attrs).length > 0) info.attributes = attrs;
          }
          results.push(info);
        }
        return success({ elements: results, count: found.length });
      } catch (err) {
        return error(err.message, "QUERY_ERROR");
      }
    },
    waitForElement: async (request) => {
      const { selector, elementId, timeout = 1e4, pollInterval = 200 } = request;
      const target = selector || (elementId ? `#${elementId}, [data-testid="${elementId}"]` : null);
      if (!target) return error("Must provide selector or elementId", "INVALID_REQUEST");
      const start = Date.now();
      return new Promise((resolve) => {
        const check = () => {
          const el = document.querySelector(target);
          const waited = Date.now() - start;
          if (el && el.offsetParent !== null) {
            resolve(
              success({
                found: true,
                element: {
                  tagName: el.tagName.toLowerCase(),
                  id: el.id,
                  textContent: el.textContent?.trim().substring(0, 200),
                  visible: true
                },
                waitedMs: waited
              })
            );
          } else if (waited >= timeout) {
            resolve(success({ found: false, waitedMs: waited }));
          } else {
            setTimeout(check, pollInterval);
          }
        };
        check();
      });
    },
    // =========================================================================
    // Tier 3.1 — Registry-based wait-for-element with structured conditions
    // =========================================================================
    waitForElementByCondition: async (request) => {
      const { selector = {}, condition = "present", text_match } = request;
      const timeoutMs = Math.min(
        Math.max(typeof request.timeout_ms === "number" ? request.timeout_ms : 5e3, 100),
        6e4
      );
      const start = Date.now();
      const POLL_MS = 100;
      function matchesSelector(el) {
        if (selector.type) {
          const elType = (typeof el.type === "string" ? el.type : "").toLowerCase();
          const elTag = (typeof el.tagName === "string" ? el.tagName : "").toLowerCase();
          const needle = selector.type.toLowerCase();
          if (!elType.includes(needle) && !elTag.includes(needle)) return false;
        }
        return matchesElementSelector(el, {
          id: selector.id,
          title: selector.title,
          aria_label: selector.aria_label,
          text: selector.text
        });
      }
      function checkCondition(el, domEl) {
        switch (condition) {
          case "present":
            return true;
          case "visible": {
            if (!domEl) return false;
            if (domEl.offsetParent === null) return false;
            const rect = domEl.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          case "clickable": {
            if (!domEl) return false;
            if (domEl.offsetParent === null) return false;
            const rect = domEl.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            if (domEl.disabled) return false;
            if (domEl.getAttribute("aria-disabled") === "true") return false;
            return true;
          }
          case "text-matches": {
            if (!text_match) return true;
            const needle = text_match.toLowerCase();
            const label = (typeof el.label === "string" ? el.label : "").toLowerCase();
            const ariaLabel = (typeof el.ariaLabel === "string" ? el.ariaLabel : "").toLowerCase();
            const title = (typeof el.title === "string" ? el.title : "").toLowerCase();
            const textContent = domEl?.textContent?.toLowerCase() ?? "";
            return label.includes(needle) || ariaLabel.includes(needle) || title.includes(needle) || textContent.includes(needle);
          }
          default:
            return true;
        }
      }
      return new Promise((resolve) => {
        let done = false;
        const poll = () => {
          if (done) return;
          const waited_ms = Date.now() - start;
          try {
            const raw = registry.getAllElements();
            const materialized = materializeElements(raw);
            for (const el of materialized) {
              if (!matchesSelector(el)) continue;
              const rawEl = raw.find((r) => r.id === el.id);
              const domEl = rawEl?.element ?? null;
              if (checkCondition(el, domEl)) {
                done = true;
                resolve(
                  success({
                    matched: true,
                    element: el,
                    waited_ms
                  })
                );
                return;
              }
            }
          } catch {
          }
          if (waited_ms >= timeoutMs) {
            done = true;
            resolve(
              // 408-style: matched=false, no element, waited_ms reflects the timeout
              success({
                matched: false,
                waited_ms
              })
            );
            return;
          }
          setTimeout(poll, POLL_MS);
        };
        poll();
      });
    },
    // =========================================================================
    // Testing-friendliness — wait-for-route-change + wait-for-element
    // =========================================================================
    waitForRouteChange: async (request) => {
      const req = request ?? {};
      const matchMode = req.matchMode ?? "exact";
      let toMatcher = null;
      if (typeof req.toRoute === "string" && req.toRoute.length > 0) {
        const needle = req.toRoute;
        if (matchMode === "exact") {
          toMatcher = (c) => c === needle;
        } else if (matchMode === "prefix") {
          toMatcher = (c) => c.startsWith(needle);
        } else if (matchMode === "regex") {
          let re;
          try {
            re = new RegExp(needle);
          } catch (err) {
            return error(`Invalid regex toRoute: ${err.message}`, "VALIDATION_ERROR");
          }
          toMatcher = (c) => re.test(c);
        }
      }
      const fromMatcher = typeof req.fromRoute === "string" && req.fromRoute.length > 0 ? (candidate) => candidate === req.fromRoute : null;
      const timeoutMs = Math.min(
        Math.max(typeof req.timeoutMs === "number" ? req.timeoutMs : 5e3, 100),
        6e4
      );
      const started = Date.now();
      const matchEntry = (entry) => {
        if (fromMatcher && !fromMatcher(entry.from)) return false;
        if (toMatcher && !toMatcher(entry.to)) return false;
        return true;
      };
      const lookbackFrom = started - timeoutMs;
      const recent = changeTracker.getRecentRouteChanges(lookbackFrom);
      for (const entry of recent) {
        if (matchEntry(entry)) {
          return success({
            from: entry.from,
            to: entry.to,
            elapsedMs: 0
          });
        }
      }
      return new Promise((resolve) => {
        let settled = false;
        let unsubscribe = null;
        let timer = null;
        const done = (value) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          unsubscribe?.();
          resolve(value);
        };
        unsubscribe = changeTracker.subscribeRouteChange((evt) => {
          if (!matchEntry(evt)) return;
          done(
            success({
              from: evt.from,
              to: evt.to,
              elapsedMs: Date.now() - started
            })
          );
        });
        timer = setTimeout(() => {
          const history = changeTracker.getRecentRouteChanges();
          const lastKnownRoute = history.length > 0 ? history[history.length - 1].to : void 0;
          done(
            success({
              reason: "timeout",
              lastKnownRoute,
              elapsedMs: Date.now() - started
            })
          );
        }, timeoutMs);
      });
    },
    waitForElementRegistered: async (request) => {
      const predicate = request?.predicate ?? {};
      const requirement = request?.requirement ?? "registered";
      const pollMs = Math.min(
        Math.max(typeof request?.pollMs === "number" ? request.pollMs : 100, 50),
        1e3
      );
      const timeoutMs = Math.min(
        Math.max(typeof request?.timeoutMs === "number" ? request.timeoutMs : 5e3, 100),
        6e4
      );
      const labelNeedle = typeof predicate.label === "string" && predicate.label.length > 0 ? predicate.label.toLowerCase() : null;
      function predicateMatches(el, domEl) {
        if (typeof predicate.id === "string" && predicate.id.length > 0) {
          if (el.id !== predicate.id) return false;
        }
        if (labelNeedle) {
          const label = typeof el.label === "string" ? el.label.toLowerCase() : "";
          const ariaLabel = typeof el.ariaLabel === "string" ? el.ariaLabel.toLowerCase() : "";
          const accessible = typeof el.state?.accessibleName === "string" ? el.state.accessibleName.toLowerCase() : "";
          if (!label.includes(labelNeedle) && !ariaLabel.includes(labelNeedle) && !accessible.includes(labelNeedle)) {
            return false;
          }
        }
        if (typeof predicate.testId === "string" && predicate.testId.length > 0) {
          const testId = domEl?.getAttribute?.("data-testid");
          if (testId !== predicate.testId) return false;
        }
        return true;
      }
      function requirementMet(el, domEl) {
        if (requirement === "registered") return true;
        const state = el.state;
        if (requirement === "visible") {
          if (state && typeof state.visible === "boolean") return state.visible;
          if (!domEl) return false;
          if (domEl.offsetParent === null) return false;
          const rect = domEl.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        if (requirement === "has-layout") {
          const w = state?.rect?.width ?? 0;
          const h = state?.rect?.height ?? 0;
          if (w > 0 && h > 0) return true;
          if (domEl) {
            const rect = domEl.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          return false;
        }
        return true;
      }
      const started = Date.now();
      function attempt() {
        try {
          const raw = registry.getAllElements();
          const materialized = materializeElements(raw);
          for (const el of materialized) {
            const rawEl = raw.find((r) => r.id === el.id);
            const domEl = rawEl?.element ?? null;
            if (!predicateMatches(el, domEl)) continue;
            if (!requirementMet(el, domEl)) continue;
            return { element: el, domEl };
          }
        } catch {
        }
        if (typeof predicate.selector === "string" && predicate.selector.length > 0 && typeof document !== "undefined") {
          try {
            const domEl = document.querySelector(predicate.selector);
            if (domEl) {
              const syntheticEl = {
                id: domEl.id || `dom-${predicate.selector}`,
                label: domEl.getAttribute("aria-label") ?? domEl.textContent?.trim() ?? void 0,
                type: domEl.tagName?.toLowerCase?.(),
                ariaLabel: domEl.getAttribute("aria-label") ?? void 0
              };
              if (!requirementMet(syntheticEl, domEl)) return null;
              return { element: syntheticEl, domEl };
            }
          } catch {
          }
        }
        return null;
      }
      const first = attempt();
      if (first) {
        return success({
          element: first.element,
          elapsedMs: Date.now() - started
        });
      }
      return new Promise((resolve) => {
        let done = false;
        let lastPartial;
        const poll = () => {
          if (done) return;
          const elapsed = Date.now() - started;
          const match = attempt();
          if (match) {
            done = true;
            resolve(
              success({
                element: match.element,
                elapsedMs: Date.now() - started
              })
            );
            return;
          }
          if (requirement !== "registered") {
            try {
              const raw = registry.getAllElements();
              const materialized = materializeElements(raw);
              for (const el of materialized) {
                const rawEl = raw.find((r) => r.id === el.id);
                const domEl = rawEl?.element ?? null;
                if (predicateMatches(el, domEl)) {
                  lastPartial = el;
                  break;
                }
              }
            } catch {
            }
          }
          if (elapsed >= timeoutMs) {
            done = true;
            resolve(
              success({
                reason: "timeout",
                elapsedMs: elapsed,
                closestMatch: lastPartial
              })
            );
            return;
          }
          setTimeout(poll, pollMs);
        };
        setTimeout(poll, pollMs);
      });
    },
    // =========================================================================
    // Tier 3.2 — Mixed action/wait/snapshot batch execution
    // =========================================================================
    controlBatch: async (request) => {
      const { actions = [], stop_on_error = true } = request;
      const results = [];
      let completed = 0;
      for (let i = 0; i < actions.length; i++) {
        const step = actions[i];
        let stepResult;
        try {
          if (step.type === "wait") {
            await new Promise((r) => setTimeout(r, step.ms));
            stepResult = { index: i, success: true, data: { waited_ms: step.ms } };
          } else if (step.type === "snapshot") {
            try {
              const snap = registry.createSnapshot();
              stepResult = { index: i, success: true, data: snap };
            } catch (snapErr) {
              stepResult = {
                index: i,
                success: false,
                error: snapErr.message ?? "Snapshot failed"
              };
            }
          } else if (step.type === "action") {
            refreshElements();
            const actionResult = await actionExecutor.executeAction(step.element_id, {
              action: step.action,
              params: step.params
            });
            const resultAny = actionResult;
            if (resultAny?.success !== false) {
              stepResult = { index: i, success: true, data: actionResult };
            } else {
              stepResult = {
                index: i,
                success: false,
                error: resultAny.error ?? "Action failed"
              };
            }
          } else {
            stepResult = {
              index: i,
              success: false,
              error: `Unknown step type: ${step.type}`
            };
          }
        } catch (err) {
          stepResult = {
            index: i,
            success: false,
            error: err.message ?? String(err)
          };
        }
        results.push(stepResult);
        completed++;
        if (!stepResult.success && stop_on_error) {
          break;
        }
      }
      return success({
        results,
        completed,
        total: actions.length
      });
    }
  };
}
function createAIHandlers(registry, actionExecutor) {
  const searchEngine = new SearchEngine();
  const nlExecutor = new NLActionExecutor();
  const assertionExecutor = new AssertionExecutor();
  const snapshotManager = new SemanticSnapshotManager();
  const diffManager = new SemanticDiffManager();
  function refreshElements() {
    let elements = registry.getAllElements();
    if (elements.length === 0) {
      const domElements = scanDOMForInteractiveElements();
      if (domElements.length > 0) {
        elements = domElements;
      }
    }
    searchEngine.updateElements(elements);
    nlExecutor.updateElements(elements);
    nlExecutor.setActionExecutor(actionExecutor);
    assertionExecutor.updateElements(elements);
  }
  return {
    aiSearch: async (criteria) => {
      try {
        refreshElements();
        const resolved = { ...criteria };
        if (!resolved.text && criteria.query) {
          resolved.text = criteria.query;
          if (resolved.fuzzy === void 0) {
            resolved.fuzzy = true;
          }
        }
        const response = searchEngine.search(resolved);
        return { success: true, data: response, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          code: "AI_SEARCH_ERROR",
          timestamp: Date.now()
        };
      }
    },
    aiFind: async (request) => {
      try {
        refreshElements();
        const result = find(request.query, searchEngine, {
          context: request.context,
          confidenceThreshold: request.confidenceThreshold,
          pickFirst: true
        });
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          code: "AI_FIND_ERROR",
          timestamp: Date.now()
        };
      }
    },
    aiExecute: async (request) => {
      try {
        refreshElements();
        const response = await nlExecutor.execute(request);
        return { success: true, data: response, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          code: "AI_EXECUTE_ERROR",
          timestamp: Date.now()
        };
      }
    },
    aiAssert: async (request) => {
      try {
        refreshElements();
        const normalized = parseNLAssertion2(request);
        const result = await assertionExecutor.assert(normalized);
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          code: "AI_ASSERT_ERROR",
          timestamp: Date.now()
        };
      }
    },
    aiAssertBatch: async (request) => {
      try {
        refreshElements();
        const normalized = normalizeBatchAssertions(request);
        const result = await assertionExecutor.assertBatch(normalized);
        return { success: true, data: result, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          code: "AI_ASSERT_BATCH_ERROR",
          timestamp: Date.now()
        };
      }
    },
    getSemanticSnapshot: async (options) => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const wantForms = options?.includeForms === true || options?.includeForms === "true";
        const formsResponse = wantForms ? discoverForms(registry.getAllElements()) : void 0;
        const snapshot = snapshotManager.createSnapshot(controlSnapshot, void 0, formsResponse);
        return { success: true, data: snapshot, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          code: "SEMANTIC_SNAPSHOT_ERROR",
          timestamp: Date.now()
        };
      }
    },
    getSemanticDiff: async (_since) => {
      try {
        const controlSnapshot = registry.createSnapshot();
        const currentSnapshot = snapshotManager.createSnapshot(controlSnapshot);
        const diff = diffManager.update(currentSnapshot);
        return { success: true, data: diff, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          code: "SEMANTIC_DIFF_ERROR",
          timestamp: Date.now()
        };
      }
    },
    getPageSummary: async () => {
      try {
        const snapshot = registry.createSnapshot();
        const elements = snapshot.elements.map((el) => ({
          ...el,
          description: el.label || el.id,
          aliases: [],
          suggestedActions: [],
          tagName: el.type,
          accessibleName: el.label,
          registered: true
        }));
        const summary = generatePageSummary(elements);
        return { success: true, data: summary, timestamp: Date.now() };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          code: "PAGE_SUMMARY_ERROR",
          timestamp: Date.now()
        };
      }
    }
  };
}

// src/server/express.ts
function createCORSMiddleware(options) {
  const corsOptions = typeof options === "boolean" ? { origin: options, methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] } : options;
  return (req, res, next) => {
    if (corsOptions.origin === true) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (typeof corsOptions.origin === "string") {
      res.setHeader("Access-Control-Allow-Origin", corsOptions.origin);
    } else if (Array.isArray(corsOptions.origin)) {
      const origin = req.headers.origin;
      if (origin && corsOptions.origin.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
    }
    if (corsOptions.methods) {
      res.setHeader("Access-Control-Allow-Methods", corsOptions.methods.join(", "));
    }
    if (corsOptions.headers) {
      res.setHeader("Access-Control-Allow-Headers", corsOptions.headers.join(", "));
    } else {
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With"
      );
    }
    if (corsOptions.credentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (corsOptions.maxAge) {
      res.setHeader("Access-Control-Max-Age", String(corsOptions.maxAge));
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}
function wrapError(error3, code) {
  return {
    success: false,
    error: typeof error3 === "string" ? error3 : error3.message,
    code,
    timestamp: Date.now()
  };
}
function createExpressRouter(handlers, config = {}) {
  const express = __require("express");
  const router = express.Router();
  if (config.cors) {
    router.use(createCORSMiddleware(config.cors));
  }
  if (config.useBodyParser) {
    router.use(express.json());
  }
  if (config.authenticate) {
    router.use(async (req, res, next) => {
      try {
        const authenticated = await config.authenticate(req);
        if (!authenticated) {
          res.status(401).json(wrapError("Unauthorized", "UNAUTHORIZED"));
          return;
        }
        next();
      } catch (error3) {
        res.status(500).json(wrapError(error3, "AUTH_ERROR"));
      }
    });
  }
  for (const route of UI_BRIDGE_ROUTES) {
    const method = route.method.toLowerCase();
    const path = route.path;
    const handlerName = route.handler;
    const handler = handlers[handlerName];
    if (!handler) {
      console.warn(`Handler not found for route: ${route.method} ${route.path}`);
      continue;
    }
    router[method](
      path,
      createRouteHandler(route, handler)
    );
  }
  if (config.sseManager) {
    const sse = config.sseManager;
    router.get("/control/events/stream", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      const types = req.query.types;
      const elements = req.query.elements;
      const clientId = sse.addClient(
        (data) => res.write(data),
        () => {
          if (!res.writableEnded) res.end();
        },
        types,
        elements
      );
      req.on("close", () => {
        sse.removeClient(clientId);
      });
    });
    router.get("/control/changes/stream", (changesReq, changesRes) => {
      changesRes.setHeader("Content-Type", "text/event-stream");
      changesRes.setHeader("Cache-Control", "no-cache");
      changesRes.setHeader("Connection", "keep-alive");
      changesRes.setHeader("X-Accel-Buffering", "no");
      changesRes.flushHeaders();
      const clientId = sse.addClient(
        (data) => changesRes.write(data),
        () => {
          if (!changesRes.writableEnded) changesRes.end();
        },
        "snapshot:changed"
        // Pre-filter to change events only
      );
      changesReq.on("close", () => {
        sse.removeClient(clientId);
      });
    });
  }
  return router;
}
function createRouteHandler(route, handler) {
  return async (req, res) => {
    try {
      const args = [];
      if (route.params) {
        for (const param of route.params) {
          args.push(req.params[param]);
        }
      }
      if (route.bodyRequired || route.method === "POST") {
        args.push(req.body);
      }
      if (route.method === "GET" && Object.keys(req.query).length > 0) {
        args.push(req.query);
      }
      const result = await handler(...args);
      res.json(result);
    } catch (error3) {
      res.status(500).json(wrapError(error3, "INTERNAL_ERROR"));
    }
  };
}
function createExpressApp(handlers, config = {}) {
  const express = __require("express");
  const app = express();
  app.use(express.json());
  const basePath = config.basePath || "/ui-bridge";
  const router = createExpressRouter(handlers, { ...config, useBodyParser: false });
  app.use(basePath, router);
  app.get(["/health", "/status"], (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });
  return app;
}
function uiBridgeMiddleware(handlers, config = {}) {
  return createExpressRouter(handlers, config);
}

// src/server/cdp-tabs.ts
var CDPTabDiscovery = class {
  constructor(config) {
    this.endpoint = (config?.endpoint || process.env.CDP_ENDPOINT || "").replace(/\/$/, "");
    this.timeout = config?.timeout ?? 5e3;
    this.enabled = this.endpoint.length > 0;
  }
  isEnabled() {
    return this.enabled;
  }
  /**
   * List all CDP targets (tabs, service workers, etc.).
   * Returns an empty array if CDP is disabled or unreachable.
   */
  async listTargets() {
    if (!this.enabled) return [];
    try {
      const response = await fetch(`${this.endpoint}/json`, {
        signal: AbortSignal.timeout(this.timeout)
      });
      if (!response.ok) return [];
      const targets = await response.json();
      return targets.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        url: t.url,
        webSocketDebuggerUrl: t.webSocketDebuggerUrl
      }));
    } catch {
      return [];
    }
  }
  /**
   * Activate (bring to front) a tab by its CDP target ID.
   */
  async activateTarget(targetId) {
    if (!this.enabled) return false;
    try {
      const response = await fetch(
        `${this.endpoint}/json/activate/${encodeURIComponent(targetId)}`,
        { signal: AbortSignal.timeout(this.timeout) }
      );
      return response.ok;
    } catch {
      return false;
    }
  }
  /**
   * Close a tab by its CDP target ID.
   */
  async closeTarget(targetId) {
    if (!this.enabled) return false;
    try {
      const response = await fetch(`${this.endpoint}/json/close/${encodeURIComponent(targetId)}`, {
        signal: AbortSignal.timeout(this.timeout)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  /**
   * Open a new tab, optionally navigated to a URL.
   * Returns the new target metadata, or null on failure.
   */
  async openNewTab(url) {
    if (!this.enabled) return null;
    try {
      const query = url ? `?${encodeURIComponent(url)}` : "";
      const response = await fetch(`${this.endpoint}/json/new${query}`, {
        signal: AbortSignal.timeout(this.timeout)
      });
      if (!response.ok) return null;
      const target = await response.json();
      return {
        id: target.id,
        type: target.type,
        title: target.title,
        url: target.url,
        webSocketDebuggerUrl: target.webSocketDebuggerUrl
      };
    } catch {
      return null;
    }
  }
  /**
   * Merge CDP targets with SDK-connected tab metadata.
   *
   * For each CDP target, checks if any SDK tab has a matching URL.
   * If so, sets hasSDK=true and sdkTabId on the target.
   */
  mergeWithSDKTabs(cdpTargets, sdkTabMetadata) {
    const urlToTabId = /* @__PURE__ */ new Map();
    for (const [tabId, meta] of sdkTabMetadata) {
      if (meta.url) {
        urlToTabId.set(meta.url, tabId);
      }
    }
    return cdpTargets.map((target) => {
      const sdkTabId = urlToTabId.get(target.url);
      if (sdkTabId) {
        return { ...target, hasSDK: true, sdkTabId };
      }
      return { ...target, hasSDK: false };
    });
  }
};

// src/server/nextjs.ts
function wrapError2(error3, code) {
  return {
    success: false,
    error: typeof error3 === "string" ? error3 : error3.message,
    code,
    timestamp: Date.now()
  };
}
function safeJsonStringify(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === "object") {
      if (typeof Node !== "undefined" && val instanceof Node) {
        return `[${val.constructor.name}]`;
      }
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    if (typeof val === "function") return void 0;
    return val;
  });
}
function jsonResponse(data, status = 200) {
  return new Response(safeJsonStringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function createNextRouteHandlers(handlers, config = {}) {
  const authenticate = config.authenticate;
  const cdp = new CDPTabDiscovery();
  async function handleRequest(request, context) {
    try {
      if (authenticate) {
        const authenticated = await authenticate(request);
        if (!authenticated) {
          return jsonResponse(wrapError2("Unauthorized", "UNAUTHORIZED"), 401);
        }
      }
      const pathParam = context.params.path;
      const path = Array.isArray(pathParam) ? "/" + pathParam.join("/") : "/" + pathParam;
      const method = request.method;
      if (method === "GET" && path === "/control/events/stream" && config.sseManager) {
        return createSSEStreamResponse(request, config.sseManager);
      }
      if (method === "GET" && path === "/control/changes/stream" && config.sseManager) {
        return createSSEStreamResponse(request, config.sseManager, "snapshot:changed");
      }
      const cdpResponse = await handleCDPRoute(method, path, request, cdp);
      if (cdpResponse) return cdpResponse;
      if (config.relay) {
        const relayResponse = handleRelayRoute(method, path, request, config.relay, config);
        if (relayResponse) return await relayResponse;
      }
      const route = findMatchingRoute(path, method);
      if (!route) {
        return jsonResponse(wrapError2("Not found", "NOT_FOUND"), 404);
      }
      const params = extractParams(path, route);
      const handlerName = route.handler;
      const handler = handlers[handlerName];
      if (!handler) {
        return jsonResponse(wrapError2("Handler not found", "NOT_IMPLEMENTED"), 501);
      }
      const args = [];
      if (route.params) {
        for (const param of route.params) {
          args.push(params[param]);
        }
      }
      if (route.bodyRequired || method === "POST" || method === "PUT" || method === "PATCH") {
        try {
          const body = await request.json();
          args.push(body);
        } catch {
          args.push({});
        }
      }
      if (method === "GET") {
        const searchParams = Object.fromEntries(request.nextUrl.searchParams);
        if (Object.keys(searchParams).length > 0) {
          args.push(searchParams);
        }
      }
      const result = await handler(
        ...args
      );
      return jsonResponse(result);
    } catch (error3) {
      console.error("UI Bridge error:", error3);
      return jsonResponse(wrapError2(error3, "INTERNAL_ERROR"), 500);
    }
  }
  return {
    GET: handleRequest,
    POST: handleRequest,
    PUT: handleRequest,
    DELETE: handleRequest
  };
}
function findMatchingRoute(path, method) {
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
function extractParams(path, route) {
  const params = {};
  if (!route.params) return params;
  const routeParts = route.path.split("/");
  const pathParts = path.split("/");
  for (let i = 0; i < routeParts.length; i++) {
    const routePart = routeParts[i];
    if (routePart.startsWith(":")) {
      const paramName = routePart.slice(1);
      params[paramName] = pathParts[i];
    }
  }
  return params;
}
function createRenderLogHandlers(handlers) {
  return {
    async GET(request) {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const query = {
        type: searchParams.type,
        since: searchParams.since ? parseInt(searchParams.since) : void 0,
        until: searchParams.until ? parseInt(searchParams.until) : void 0,
        limit: searchParams.limit ? parseInt(searchParams.limit) : void 0
      };
      const result = await handlers.getRenderLog(query);
      return jsonResponse(result);
    },
    async DELETE() {
      const result = await handlers.clearRenderLog();
      return jsonResponse(result);
    }
  };
}
function createControlHandlers(handlers) {
  return {
    elements: {
      async GET() {
        const result = await handlers.getElements();
        return jsonResponse(result);
      }
    },
    element: {
      async GET(_request, context) {
        const result = await handlers.getElement(context.params.id);
        return jsonResponse(result);
      },
      async POST(request, context) {
        const body = await request.json();
        const result = await handlers.executeElementAction(context.params.id, body);
        return jsonResponse(result);
      }
    },
    components: {
      async GET() {
        const result = await handlers.getComponents();
        return jsonResponse(result);
      }
    },
    component: {
      async GET(_request, context) {
        const result = await handlers.getComponent(context.params.id);
        return jsonResponse(result);
      },
      async POST(request, context) {
        const body = await request.json();
        const result = await handlers.executeComponentAction(context.params.id, {
          ...body,
          action: context.params.actionId
        });
        return jsonResponse(result);
      }
    },
    find: {
      async POST(request) {
        const body = await request.json();
        const result = await handlers.find(body);
        return jsonResponse(result);
      }
    },
    discover: {
      /**
       * @deprecated Use /control/find instead
       */
      async POST(request) {
        const body = await request.json();
        const result = await handlers.discover(body);
        return jsonResponse(result);
      }
    },
    snapshot: {
      async GET(request) {
        const url = request.nextUrl?.searchParams?.get("url") ?? void 0;
        const targetTabId = request.nextUrl?.searchParams?.get("targetTabId") ?? void 0;
        const skipSettle = request.nextUrl?.searchParams?.get("skipSettle") ?? void 0;
        const settleTimeout = request.nextUrl?.searchParams?.get("settleTimeout") ?? void 0;
        const result = await handlers.getControlSnapshot({
          targetTabId,
          url,
          skipSettle,
          settleTimeout
        });
        return jsonResponse(result);
      }
    },
    workflows: {
      async GET() {
        const result = await handlers.getWorkflows();
        return jsonResponse(result);
      }
    },
    workflow: {
      async POST(request, context) {
        const body = await request.json();
        const result = await handlers.runWorkflow(context.params.id, body);
        return jsonResponse(result);
      }
    }
  };
}
function createDebugHandlers(handlers) {
  return {
    actionHistory: {
      async GET(request) {
        const limit = request.nextUrl.searchParams.get("limit");
        const result = await handlers.getActionHistory(limit ? parseInt(limit) : void 0);
        return jsonResponse(result);
      }
    },
    metrics: {
      async GET() {
        const result = await handlers.getMetrics();
        return jsonResponse(result);
      }
    },
    highlight: {
      async POST(_request, context) {
        const result = await handlers.highlightElement(context.params.id);
        return jsonResponse(result);
      }
    }
  };
}
function createUIBridgeHandler(config) {
  const registry = {
    getAllElements: () => [],
    getElement: () => void 0,
    getAllComponents: () => [],
    getComponent: () => void 0,
    createSnapshot: () => ({
      timestamp: Date.now(),
      elements: [],
      components: [],
      workflows: [],
      activeRuns: []
    })
  };
  const executor = {
    executeAction: async () => ({
      success: false,
      error: "Server-side action execution not available. Use the runtime injection proxy.",
      timestamp: Date.now()
    }),
    executeComponentAction: async () => ({
      success: false,
      error: "Server-side action execution not available. Use the runtime injection proxy.",
      timestamp: Date.now()
    })
  };
  const handlers = createHandlers(registry, executor);
  const routeHandlers = createNextRouteHandlers(handlers, config);
  return routeHandlers.GET;
}
var SSE_HEARTBEAT_INTERVAL_MS = 15e3;
async function handleCDPRoute(method, path, request, cdp) {
  if (method === "GET" && path === "/tabs/cdp") {
    if (!cdp.isEnabled()) {
      return jsonResponse(
        {
          success: false,
          error: "CDP not configured. Launch Chrome with --remote-debugging-port=9222 and set CDP_ENDPOINT env var.",
          code: "CDP_DISABLED"
        },
        503
      );
    }
    const targets = await cdp.listTargets();
    return jsonResponse({
      success: true,
      data: { targets, endpoint: "configured" },
      timestamp: Date.now()
    });
  }
  if (method === "POST" && path === "/tabs/cdp/new") {
    if (!cdp.isEnabled()) {
      return jsonResponse(
        { success: false, error: "CDP not configured.", code: "CDP_DISABLED" },
        503
      );
    }
    const body = await request.json().catch(() => ({}));
    const url = body.url;
    const target = await cdp.openNewTab(url);
    return jsonResponse({ success: !!target, data: target, timestamp: Date.now() });
  }
  const activateMatch = method === "POST" && path.match(/^\/tabs\/cdp\/([^/]+)\/activate$/);
  if (activateMatch) {
    if (!cdp.isEnabled()) {
      return jsonResponse(
        { success: false, error: "CDP not configured.", code: "CDP_DISABLED" },
        503
      );
    }
    const targetId = decodeURIComponent(activateMatch[1]);
    const ok = await cdp.activateTarget(targetId);
    return jsonResponse({ success: ok, timestamp: Date.now() });
  }
  const closeMatch = method === "POST" && path.match(/^\/tabs\/cdp\/([^/]+)\/close$/);
  if (closeMatch) {
    if (!cdp.isEnabled()) {
      return jsonResponse(
        { success: false, error: "CDP not configured.", code: "CDP_DISABLED" },
        503
      );
    }
    const targetId = decodeURIComponent(closeMatch[1]);
    const ok = await cdp.closeTarget(targetId);
    return jsonResponse({ success: ok, timestamp: Date.now() });
  }
  return null;
}
var RELAY_COMMAND_STREAM_HEARTBEAT_MS = 15e3;
function handleRelayRoute(method, path, request, relay, config) {
  if (method === "GET" && path === "/commands/stream") {
    return createCommandStreamResponse(request, relay);
  }
  if (method === "POST" && path === "/commands") {
    return handleCommandResponse(request, relay);
  }
  if (method === "POST" && path === "/heartbeat") {
    return (async () => {
      let heartbeatTabId;
      try {
        const body = await request.json();
        heartbeatTabId = body?.tabId;
        relay.receiveHeartbeat(heartbeatTabId, {
          url: body?.url,
          title: body?.title,
          visibility: body?.visibility
        });
      } catch {
        relay.receiveHeartbeat();
      }
      const diag = relay.getTransportDiagnostics();
      const tabRegistered = heartbeatTabId !== void 0 && diag.connectedTabs.includes(heartbeatTabId);
      return jsonResponse({
        success: true,
        data: { received: true, tabRegistered },
        timestamp: Date.now()
      });
    })();
  }
  if (method === "GET" && (path === "/health" || path === "/status")) {
    const diagnostics = relay.getTransportDiagnostics();
    const response = {
      success: true,
      data: {
        responsive: relay.isAppResponsive(),
        lastHeartbeat: relay.getLastHeartbeat(),
        ...diagnostics
      },
      timestamp: Date.now()
    };
    if (config.appInfo) {
      response.uiBridge = {
        ...config.appInfo,
        capabilities: ["control", "renderLog", "debug"]
      };
    }
    return jsonResponse(response);
  }
  if (method === "GET" && path === "/tabs/wait") {
    const url = new URL(request.url);
    const timeoutMs = Math.min(
      12e4,
      Math.max(100, Number.parseInt(url.searchParams.get("timeoutMs") ?? "30000", 10) || 3e4)
    );
    const pollMs = Math.max(
      50,
      Number.parseInt(url.searchParams.get("pollMs") ?? "250", 10) || 250
    );
    return (async () => {
      const startedAt = Date.now();
      const deadline = startedAt + timeoutMs;
      while (Date.now() < deadline) {
        const diag = relay.getTransportDiagnostics();
        if (diag.connectedTabs.length > 0) {
          const tabs = diag.connectedTabs.map((tabId) => ({
            tabId,
            ...diag.tabMetadata[tabId] || {},
            lastHeartbeat: diag.tabHeartbeats[tabId] ?? null,
            isPrimary: tabId === diag.primaryTabId,
            isDemoted: diag.demotedTabs.includes(tabId)
          }));
          return jsonResponse({
            success: true,
            data: { tabs, waitedMs: Date.now() - startedAt },
            timestamp: Date.now()
          });
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      return jsonResponse(
        {
          success: false,
          error: "timeout",
          data: { timeoutMs, waitedMs: Date.now() - startedAt },
          timestamp: Date.now()
        },
        504
      );
    })();
  }
  if (method === "GET" && path === "/tabs") {
    const url = new URL(request.url);
    const detailed = url.searchParams.get("detailed") === "true";
    const diag = relay.getTransportDiagnostics();
    if (detailed) {
      return (async () => {
        const tabInfos = await relay.getTabsWithInfo();
        const tabs2 = tabInfos.map((info) => ({
          ...info,
          ...diag.tabMetadata[info.tabId] || {},
          lastHeartbeat: diag.tabHeartbeats[info.tabId] ?? null,
          isPrimary: info.tabId === diag.primaryTabId,
          isDemoted: diag.demotedTabs.includes(info.tabId)
        }));
        return jsonResponse({ success: true, data: { tabs: tabs2 }, timestamp: Date.now() });
      })();
    }
    const tabs = diag.connectedTabs.map((tabId) => ({
      tabId,
      ...diag.tabMetadata[tabId] || {},
      lastHeartbeat: diag.tabHeartbeats[tabId] ?? null,
      isPrimary: tabId === diag.primaryTabId,
      isDemoted: diag.demotedTabs.includes(tabId)
    }));
    return jsonResponse({
      success: true,
      data: { tabs },
      timestamp: Date.now()
    });
  }
  if (method === "POST" && path.match(/^\/tabs\/([^/]+)\/activate$/)) {
    const targetTabId = decodeURIComponent(path.split("/")[2]);
    return (async () => {
      try {
        const result = await relay.queueCommand("tabActivate", {}, { targetTabId });
        return jsonResponse({ success: true, data: result, timestamp: Date.now() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ success: false, error: msg, timestamp: Date.now() }, 500);
      }
    })();
  }
  if (method === "POST" && path.match(/^\/tabs\/([^/]+)\/close$/)) {
    const targetTabId = decodeURIComponent(path.split("/")[2]);
    return (async () => {
      try {
        const result = await relay.queueCommand("tabClose", {}, { targetTabId });
        return jsonResponse({ success: true, data: result, timestamp: Date.now() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResponse({ success: false, error: msg, timestamp: Date.now() }, 500);
      }
    })();
  }
  return null;
}
function createCommandStreamResponse(request, relay) {
  const url = new URL(request.url);
  const tabId = url.searchParams.get("tabId") ?? void 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let heartbeat = null;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        unsubscribe();
      };
      try {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "connected", buildId: relay.buildId, timestamp: Date.now() })}

`
          )
        );
      } catch {
      }
      const unsubscribe = relay.subscribeToCommands((command) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(command)}

`));
        } catch {
          cleanup();
        }
      }, tabId);
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat

`));
        } catch {
          cleanup();
        }
      }, RELAY_COMMAND_STREAM_HEARTBEAT_MS);
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
        }
      });
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
async function handleCommandResponse(request, relay) {
  try {
    const body = await request.json();
    const { commandId, success: ok, result, error: errorMsg, tabId: responseTabId } = body;
    if (!commandId) {
      return jsonResponse(
        { success: false, error: "Missing commandId", timestamp: Date.now() },
        400
      );
    }
    if (ok) {
      relay.resolveCommand(commandId, result, responseTabId);
    } else {
      relay.rejectCommand(
        commandId,
        errorMsg || result?.error || "Unknown error"
      );
    }
    return jsonResponse({ success: true, timestamp: Date.now() });
  } catch {
    return jsonResponse(
      { success: false, error: "Invalid request body", timestamp: Date.now() },
      400
    );
  }
}
function createSSEStreamResponse(request, sseManager, typeFilterOverride) {
  const url = new URL(request.url);
  const typeFilter = typeFilterOverride ?? url.searchParams.get("types") ?? void 0;
  const elementFilter = url.searchParams.get("elements") ?? void 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let clientId = null;
      let heartbeat = null;
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (clientId) {
          sseManager.removeClient(clientId);
          clientId = null;
        }
      };
      clientId = sseManager.addClient(
        (data) => {
          try {
            controller.enqueue(encoder.encode(data));
            return true;
          } catch {
            cleanup();
            return false;
          }
        },
        () => {
          cleanup();
          try {
            controller.close();
          } catch {
          }
        },
        typeFilter,
        elementFilter
      );
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat

`));
        } catch {
          cleanup();
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
        }
      });
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
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
    this.sessionId = generateId2("session");
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
        actionId: generateId2("action"),
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
    const captureId = generateId2("capture");
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
function generateId2(prefix) {
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
function generateId3() {
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
    const clientId = generateId3();
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
      id: generateId3(),
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
    } catch (error3) {
      const err = error3 instanceof Error ? error3 : new Error(String(error3));
      this.sendError(clientId, message.id, "HANDLER_ERROR", err.message);
    }
  }
  /**
   * Handle ping message
   */
  handlePing(clientId, _requestId) {
    this.sendToClient(clientId, {
      id: generateId3(),
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
      id: generateId3(),
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
      id: generateId3(),
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
          id: generateId3(),
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
    } catch (error3) {
      console.error(`Failed to send message to ${clientId}:`, error3);
    }
  }
  /**
   * Send response message
   */
  sendResponse(clientId, requestId, success3, data, error3) {
    this.sendToClient(clientId, {
      id: generateId3(),
      type: "response",
      timestamp: Date.now(),
      requestId,
      payload: {
        success: success3,
        data,
        error: error3
      }
    });
  }
  /**
   * Send error message
   */
  sendError(clientId, requestId, code, message) {
    this.sendToClient(clientId, {
      id: generateId3(),
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
    } catch (error3) {
      const err = error3 instanceof Error ? error3 : new Error(String(error3));
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
    } catch (error3) {
      const err = error3 instanceof Error ? error3 : new Error(String(error3));
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
    } catch (error3) {
      const err = error3 instanceof Error ? error3 : new Error(String(error3));
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
var WSStreamAdapter = class {
  constructor(stream, options) {
    this.subscription = null;
    this.stream = stream;
    this.broadcast = options.broadcast;
    this.config = {
      minSeverity: options.minSeverity ?? "warning",
      deduplicate: options.deduplicate ?? true
    };
    this.log = options.log;
  }
  /**
   * Create a subscription on the stream. Safe to call multiple times
   * (no-op if already subscribed).
   */
  attach() {
    if (this.subscription) {
      return this.subscription;
    }
    this.subscription = this.stream.subscribe({
      minSeverity: this.config.minSeverity,
      deduplicate: this.config.deduplicate
    });
    if (this.log) {
      this.log(
        `[ws-stream] Attached subscription ${this.subscription.id} (minSeverity=${this.config.minSeverity}, deduplicate=${this.config.deduplicate})`
      );
    }
    return this.subscription;
  }
  /**
   * Remove the subscription from the stream. Safe to call multiple times
   * (no-op if not subscribed).
   */
  detach() {
    if (!this.subscription) {
      return;
    }
    const id = this.subscription.id;
    this.stream.unsubscribe(id);
    this.subscription = null;
    if (this.log) {
      this.log(`[ws-stream] Detached subscription ${id}`);
    }
  }
  /**
   * Update subscription based on WS client count.
   * Subscribes when the first client connects, unsubscribes when the last
   * client disconnects.
   */
  notifyClientChange(clientCount) {
    if (clientCount > 0 && !this.subscription) {
      this.attach();
    } else if (clientCount === 0 && this.subscription) {
      this.detach();
    }
  }
  /**
   * Process a raw browser event through the stream and broadcast any
   * messages that pass subscription filters.
   *
   * Call this from the capture's onEvent callback when using direct mode.
   */
  processAndBroadcast(event) {
    if (!this.subscription) {
      return;
    }
    const messages = this.stream.processEvent(event);
    if (messages.size === 0) {
      return;
    }
    for (const [_subId, message] of messages) {
      this.broadcast(toBridgeEvent(message));
    }
  }
  /** Whether the adapter currently has an active subscription */
  get isAttached() {
    return this.subscription !== null;
  }
  /** The current subscription ID, or null */
  get subscriptionId() {
    return this.subscription?.id ?? null;
  }
};
function toBridgeEvent(message) {
  const eventType = message.severity === "crash" ? "browser:crash" : message.severity === "error" ? "browser:error" : "browser:warning";
  return {
    type: eventType,
    timestamp: Date.now(),
    data: {
      event: message.event,
      severity: message.severity,
      reason: message.reason,
      fingerprint: message.fingerprint,
      ...message.sourceLocation !== void 0 ? { sourceLocation: message.sourceLocation } : {}
    }
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
var DEFAULT_CONFIG5 = {
  host: "localhost",
  port: 9876,
  websocket: false,
  websocketPort: 9876,
  log: console.log
};
function wrapError3(error3, code) {
  return {
    success: false,
    error: typeof error3 === "string" ? error3 : error3.message,
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
    this.config = { ...DEFAULT_CONFIG5, ...config };
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
      wss.on("error", (error3) => {
        this.config.log(`WebSocket server error: ${error3.message}`);
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
      this.sendJSON(res, wrapError3("Not found", "NOT_FOUND"), 404);
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
        this.sendJSON(res, wrapError3("Not implemented", "NOT_IMPLEMENTED"), 501);
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
    } catch (error3) {
      this.config.log(`Error handling ${method} ${path}: ${error3}`);
      this.sendJSON(res, wrapError3(error3, "INTERNAL_ERROR"), 500);
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

// src/server/command-relay.ts
var DEFAULT_FIRE_AND_FORGET = /* @__PURE__ */ new Set(["pageNavigate", "pageRefresh"]);
var CommandRelay = class {
  constructor(options) {
    // Cleanup interval handle
    this.cleanupInterval = null;
    // --------------------------------------------------------------------------
    // Push-Based Change Events
    // --------------------------------------------------------------------------
    this.changeEventBuffer = [];
    this.changeEventSubscribers = /* @__PURE__ */ new Set();
    this.maxChangeEvents = 5e3;
    this.prefix = options?.globalPrefix ?? "__uiBridge";
    this.wsTimeoutMs = options?.wsTimeoutMs ?? 1e4;
    this.sseTimeoutMs = options?.sseTimeoutMs ?? 8e3;
    this.multiTabGraceMs = options?.multiTabGraceMs ?? 3e3;
    this.maxPendingCommands = options?.maxPendingCommands ?? 200;
    this.heartbeatStaleMs = options?.heartbeatStaleMs ?? 3e4;
    this.tabDemotionTtlMs = options?.tabDemotionTtlMs ?? 6e4;
    const g = globalThis;
    const key = (suffix) => `${this.prefix}${suffix}`;
    if (!g[key("PendingCommands")]) g[key("PendingCommands")] = /* @__PURE__ */ new Map();
    if (!g[key("TabListeners")]) g[key("TabListeners")] = /* @__PURE__ */ new Map();
    if (!g[key("WsClients")]) g[key("WsClients")] = /* @__PURE__ */ new Map();
    if (!g[key("DemotedTabs")]) g[key("DemotedTabs")] = /* @__PURE__ */ new Set();
    if (!g[key("CommandQueue")]) g[key("CommandQueue")] = [];
    if (!g[key("PrimaryTabId")]) g[key("PrimaryTabId")] = null;
    if (!g[key("TabHeartbeats")]) g[key("TabHeartbeats")] = /* @__PURE__ */ new Map();
    if (!g[key("TabMetadata")]) g[key("TabMetadata")] = /* @__PURE__ */ new Map();
    if (!g[key("TabLastSuccess")]) g[key("TabLastSuccess")] = /* @__PURE__ */ new Map();
    if (!g[key("BuildId")]) g[key("BuildId")] = Date.now().toString();
    if (!g[key("ConnectionReady")]) {
      let resolve = null;
      const promise = new Promise((r) => {
        resolve = r;
      });
      g[key("ConnectionReady")] = promise;
      g[key("ConnectionReadyResolve")] = resolve;
    }
    this.connectionReady = g[key("ConnectionReady")];
    this.connectionReadyResolve = g[key("ConnectionReadyResolve")];
    this.pendingCommands = g[key("PendingCommands")];
    this.tabListeners = g[key("TabListeners")];
    this.wsClients = g[key("WsClients")];
    this.demotedTabs = g[key("DemotedTabs")];
    this.commandQueue = g[key("CommandQueue")];
    this.primaryTabId = g[key("PrimaryTabId")];
    this.tabHeartbeats = g[key("TabHeartbeats")];
    this.tabMetadata = g[key("TabMetadata")];
    this.tabLastSuccess = g[key("TabLastSuccess")];
    this.buildId = g[key("BuildId")];
    if (!g[key("CleanupInterval")]) {
      g[key("CleanupInterval")] = setInterval(() => {
        this.cleanupStaleTabs();
      }, 3e4);
    }
    this.cleanupInterval = g[key("CleanupInterval")];
  }
  /**
   * Remove entries from tabHeartbeats and demotedTabs for tabs no longer connected.
   */
  cleanupStaleTabs() {
    const now = Date.now();
    for (const [tabId, lastBeat] of this.tabHeartbeats.entries()) {
      const hasListener = this.tabListeners.has(tabId);
      const hasWs = this.wsClients.has(tabId);
      if (!hasListener && !hasWs) {
        if (now - lastBeat > this.tabDemotionTtlMs) {
          this.tabHeartbeats.delete(tabId);
          this.demotedTabs.delete(tabId);
          this.tabLastSuccess.delete(tabId);
          this.tabMetadata.delete(tabId);
        }
      }
    }
    for (const tabId of this.demotedTabs) {
      if (!this.tabListeners.has(tabId) && !this.wsClients.has(tabId) && !this.tabHeartbeats.has(tabId)) {
        this.demotedTabs.delete(tabId);
      }
    }
  }
  /**
   * Reset the connection readiness gate when all transports have disconnected.
   * The next call to queueCommand() will block until a new transport connects.
   */
  resetConnectionGateIfEmpty() {
    if (this.tabListeners.size === 0 && this.wsClients.size === 0 && !this.connectionReadyResolve) {
      const g = globalThis;
      const key = (suffix) => `${this.prefix}${suffix}`;
      let resolve = null;
      const promise = new Promise((r) => {
        resolve = r;
      });
      g[key("ConnectionReady")] = promise;
      g[key("ConnectionReadyResolve")] = resolve;
      this.connectionReady = promise;
      this.connectionReadyResolve = resolve;
    }
  }
  // --------------------------------------------------------------------------
  // Primary Tab Routing
  // --------------------------------------------------------------------------
  getPrimaryTabId() {
    const now = Date.now();
    for (const tabId of Array.from(this.demotedTabs)) {
      const lastBeat = this.tabHeartbeats.get(tabId);
      if (lastBeat && now - lastBeat < this.heartbeatStaleMs) {
        if (this.tabListeners.has(tabId) || this.wsClients.has(tabId)) {
          this.demotedTabs.delete(tabId);
          console.log(`[ui-bridge] Re-promoted tab with fresh heartbeat: ${tabId}`);
        }
      }
    }
    if (this.primaryTabId && !this.demotedTabs.has(this.primaryTabId)) {
      if (this.tabListeners.has(this.primaryTabId) || this.wsClients.has(this.primaryTabId)) {
        return this.primaryTabId;
      }
      this.primaryTabId = null;
      this.persistPrimaryTab();
    }
    const candidates = [];
    for (const tab of this.tabListeners.keys()) {
      if (!this.demotedTabs.has(tab)) {
        candidates.push(tab);
      }
    }
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected() && !this.demotedTabs.has(clientId) && !candidates.includes(clientId)) {
        candidates.push(clientId);
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aSuccess = this.tabLastSuccess.get(a) ?? 0;
      const bSuccess = this.tabLastSuccess.get(b) ?? 0;
      return bSuccess - aSuccess;
    });
    this.setPrimaryTab(candidates[0]);
    return this.primaryTabId;
  }
  setPrimaryTab(tabId) {
    this.primaryTabId = tabId;
    this.persistPrimaryTab();
    console.log(`[ui-bridge] Primary tab: ${tabId}`);
  }
  persistPrimaryTab() {
    globalThis[`${this.prefix}PrimaryTabId`] = this.primaryTabId;
  }
  demotePrimaryTab(tabId) {
    this.demotedTabs.add(tabId);
    if (this.primaryTabId === tabId) {
      this.primaryTabId = null;
      this.persistPrimaryTab();
      console.log(`[ui-bridge] Primary tab demoted: ${tabId}`);
    }
  }
  // --------------------------------------------------------------------------
  // Command Queue
  // --------------------------------------------------------------------------
  generateCommandId() {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
  /**
   * Queue a command with primary tab routing, automatic failover,
   * and retry-on-disconnect.
   */
  async queueCommand(action, payload, options) {
    if (!options?.targetTabId && this.tabListeners.size === 0 && this.wsClients.size === 0) {
      await Promise.race([
        this.connectionReady,
        new Promise(
          (_, reject) => setTimeout(
            () => reject(
              new Error(
                "No browser connected \u2014 no WebSocket clients and no SSE listeners. Open the web app in a browser tab, or launch a headless one with `npx @qontinui/ui-bridge-headless --url <your-app-url>`. Use `GET /tabs/wait?timeoutMs=<ms>` to block until the tab registers."
              )
            ),
            3e3
          )
        )
      ]);
    }
    try {
      return await this.queueCommandInner(action, payload, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("SDK_DISCONNECTED") || msg.includes("No browser connected")) {
        console.log(`[ui-bridge] ${action} failed (disconnected), waiting for reconnection...`);
        try {
          await Promise.race([
            this.connectionReady,
            new Promise(
              (_, reject) => setTimeout(() => reject(new Error("Reconnection timeout")), 2e3)
            )
          ]);
          console.log(`[ui-bridge] Reconnected, retrying ${action}`);
          return await this.queueCommandInner(action, payload, options);
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }
  /**
   * Inner command queue implementation (no retry logic).
   */
  async queueCommandInner(action, payload, options) {
    const targetTabId = options?.targetTabId;
    if (targetTabId) {
      return this.sendCommand(action, payload, options);
    }
    const primaryId = this.getPrimaryTabId();
    if (primaryId) {
      return this.sendCommand(action, payload, { targetTabId: primaryId }).catch(
        (firstError) => {
          this.demotePrimaryTab(primaryId);
          const newPrimaryId = this.getPrimaryTabId();
          if (newPrimaryId) {
            console.log(
              `[ui-bridge] Primary tab ${primaryId} failed for ${action}, retrying on ${newPrimaryId}`
            );
            return this.sendCommand(action, payload, { targetTabId: newPrimaryId });
          }
          throw firstError;
        }
      );
    }
    return this.sendCommand(action, payload);
  }
  /**
   * Low-level: send a command to a specific tab or broadcast to all.
   */
  sendCommand(action, payload, options) {
    const targetTabId = options?.targetTabId;
    const commandId = this.generateCommandId();
    const fireAndForget = DEFAULT_FIRE_AND_FORGET.has(action);
    console.log(
      `[ui-bridge] queueCommand: ${action} (ws=${this.wsClients.size}, sse=${this.tabListeners.size}${targetTabId ? `, target=${targetTabId}` : ""}${fireAndForget ? ", fire-and-forget" : ""})`
    );
    return new Promise((resolve, reject) => {
      const sentViaWebSocket = this.sendCommandViaWebSocket(
        commandId,
        action,
        payload,
        targetTabId
      );
      let transport = "none";
      let timeoutMs = this.sseTimeoutMs;
      if (sentViaWebSocket) {
        transport = "WebSocket";
        timeoutMs = this.wsTimeoutMs;
      }
      if (!sentViaWebSocket && this.tabListeners.size === 0) {
        reject(
          new Error(
            `SDK_DISCONNECTED: No browser connected to receive ${action} command. No WebSocket clients and no SSE listeners registered. Open the web app in a browser tab, or launch a headless one with \`npx @qontinui/ui-bridge-headless --url <your-app-url>\`. Use \`GET /tabs/wait?timeoutMs=<ms>\` to block until the tab registers.`
          )
        );
        return;
      }
      if (fireAndForget) {
        if (!sentViaWebSocket && this.tabListeners.size > 0) {
          const command = { commandId, action, payload, timestamp: Date.now() };
          this.broadcastToListeners(command, targetTabId);
        }
        resolve({ success: true, fireAndForget: true, action, timestamp: Date.now() });
        return;
      }
      const timeout = setTimeout(() => {
        const pending2 = this.pendingCommands.get(commandId);
        if (pending2?.graceTimeout) clearTimeout(pending2.graceTimeout);
        const notified = pending2?.tabsNotified ?? 0;
        this.pendingCommands.delete(commandId);
        reject(
          new Error(
            `Command ${action} timed out after ${timeoutMs}ms (${transport}). ${notified} client(s) were notified but none responded. The UI Bridge SDK may not be loaded or the page may be unresponsive.`
          )
        );
      }, timeoutMs);
      if (this.pendingCommands.size >= this.maxPendingCommands) {
        const oldestKey = this.pendingCommands.keys().next().value;
        if (oldestKey) {
          const oldest = this.pendingCommands.get(oldestKey);
          if (oldest) {
            clearTimeout(oldest.timeout);
            if (oldest.graceTimeout) clearTimeout(oldest.graceTimeout);
            oldest.reject(new Error("Command evicted: too many pending commands"));
          }
          this.pendingCommands.delete(oldestKey);
        }
      }
      const pending = {
        resolve,
        reject,
        timeout,
        tabsNotified: sentViaWebSocket ? 1 : 0,
        errorResponseCount: 0
      };
      this.pendingCommands.set(commandId, pending);
      if (!sentViaWebSocket) {
        const command = { commandId, action, payload, timestamp: Date.now() };
        if (this.tabListeners.size > 0) {
          transport = "SSE";
          pending.tabsNotified = this.broadcastToListeners(command, targetTabId);
          if (pending.tabsNotified === 0) {
            clearTimeout(timeout);
            this.pendingCommands.delete(commandId);
            reject(
              new Error(
                `No active UI Bridge SDK client received the ${action} command. ${this.tabListeners.size} SSE listener(s) registered but none accepted the command. Ensure the web app is open in a browser tab with the UI Bridge SDK loaded.`
              )
            );
            return;
          }
        } else {
          transport = "HTTP-poll";
          this.commandQueue.push(command);
          while (this.commandQueue.length > 100) {
            const dropped = this.commandQueue.shift();
            if (dropped) {
              const p = this.pendingCommands.get(dropped.commandId);
              if (p) {
                clearTimeout(p.timeout);
                p.reject(new Error("Command dropped from queue"));
                this.pendingCommands.delete(dropped.commandId);
              }
            }
          }
        }
      }
    });
  }
  broadcastToListeners(command, targetTabId) {
    if (targetTabId) {
      const listener = this.tabListeners.get(targetTabId);
      if (listener) {
        try {
          listener.callback(command);
          return 1;
        } catch {
        }
      }
      return 0;
    }
    let notified = 0;
    for (const listener of this.tabListeners.values()) {
      try {
        listener.callback(command);
        notified++;
      } catch {
      }
    }
    return notified;
  }
  // --------------------------------------------------------------------------
  // WebSocket Client Registry
  // --------------------------------------------------------------------------
  sendCommandViaWebSocket(commandId, action, payload, targetTabId) {
    const clientEntry = this.getConnectedClient(targetTabId);
    if (!clientEntry) return false;
    try {
      clientEntry.client.send(
        JSON.stringify({
          type: "command",
          commandId,
          action,
          payload,
          timestamp: Date.now()
        })
      );
      clientEntry.lastActivity = Date.now();
      return true;
    } catch (e) {
      console.error("[UIBridge] Failed to send WebSocket command:", e);
      return false;
    }
  }
  getConnectedClient(targetTabId) {
    if (targetTabId) {
      const entry = this.wsClients.get(targetTabId);
      if (entry) {
        if (entry.client.isConnected()) return entry;
        this.wsClients.delete(targetTabId);
      }
      return null;
    }
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected()) return entry;
      this.wsClients.delete(clientId);
    }
    return null;
  }
  /**
   * Register a WebSocket client for command delivery.
   */
  registerWebSocketClient(client) {
    const now = Date.now();
    this.wsClients.set(client.clientId, { client, connectedAt: now, lastActivity: now });
    if (this.connectionReadyResolve) {
      this.connectionReadyResolve();
      this.connectionReadyResolve = null;
    }
    console.log(`[UIBridge] WebSocket client registered: ${client.clientId}`);
    setTimeout(async () => {
      if (!this.wsClients.has(client.clientId)) return;
      try {
        const result = await this.queueCommand(
          "getControlSnapshot",
          {},
          { targetTabId: client.clientId }
        );
        if (result.elements && result.elements.length > 0) {
          console.log(
            `[ui-bridge] Proactive WS snapshot captured: ${result.elements.length} elements`
          );
        }
      } catch {
      }
    }, 500);
  }
  /**
   * Unregister a WebSocket client.
   */
  unregisterWebSocketClient(clientId) {
    this.wsClients.delete(clientId);
    console.log(`[UIBridge] WebSocket client unregistered: ${clientId}`);
    this.resetConnectionGateIfEmpty();
  }
  /**
   * Update WebSocket client activity timestamp.
   */
  updateClientActivity(clientId) {
    const entry = this.wsClients.get(clientId);
    if (entry) entry.lastActivity = Date.now();
  }
  /**
   * Get connected WebSocket client count.
   */
  getWebSocketClientCount() {
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (!entry.client.isConnected()) this.wsClients.delete(clientId);
    }
    return this.wsClients.size;
  }
  /**
   * Broadcast an event to all connected WebSocket clients.
   */
  broadcastEvent(eventType, data) {
    const message = JSON.stringify({ type: eventType, data, timestamp: Date.now() });
    for (const [clientId, entry] of this.wsClients.entries()) {
      if (entry.client.isConnected()) {
        try {
          entry.client.send(message);
          entry.lastActivity = Date.now();
        } catch {
          this.wsClients.delete(clientId);
        }
      } else {
        this.wsClients.delete(clientId);
      }
    }
  }
  // --------------------------------------------------------------------------
  // Command Resolution
  // --------------------------------------------------------------------------
  /**
   * Resolve a pending command with a response from the browser.
   */
  resolveCommand(commandId, result, tabId) {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
    this.pendingCommands.delete(commandId);
    pending.resolve(result);
    if (tabId) {
      this.tabLastSuccess.set(tabId, Date.now());
      this.demotedTabs.delete(tabId);
    }
    return true;
  }
  /**
   * Reject a pending command with an error from the browser.
   */
  rejectCommand(commandId, errorMessage) {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) return false;
    pending.errorResponseCount++;
    if (!pending.firstError) {
      pending.firstError = new Error(errorMessage);
    }
    if (pending.errorResponseCount >= pending.tabsNotified) {
      clearTimeout(pending.timeout);
      if (pending.graceTimeout) clearTimeout(pending.graceTimeout);
      this.pendingCommands.delete(commandId);
      pending.reject(pending.firstError);
      return true;
    }
    if (!pending.graceTimeout) {
      pending.graceTimeout = setTimeout(() => {
        const stillPending = this.pendingCommands.get(commandId);
        if (stillPending) {
          clearTimeout(stillPending.timeout);
          this.pendingCommands.delete(commandId);
          stillPending.reject(stillPending.firstError || new Error(errorMessage));
        }
      }, this.multiTabGraceMs);
    }
    return true;
  }
  // --------------------------------------------------------------------------
  // Tab / Client Management
  // --------------------------------------------------------------------------
  /**
   * Subscribe to commands via SSE. Returns an unsubscribe function.
   */
  subscribeToCommands(listener, tabId) {
    const id = tabId || `anon_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.tabListeners.set(id, { tabId: id, callback: listener });
    this.demotedTabs.delete(id);
    this.setPrimaryTab(id);
    if (this.connectionReadyResolve) {
      this.connectionReadyResolve();
      this.connectionReadyResolve = null;
    }
    console.log(`[ui-bridge] SSE listener connected: ${id} (total: ${this.tabListeners.size})`);
    let retryTimer = null;
    const captureSnapshot = async () => {
      if (!this.tabListeners.has(id)) return false;
      try {
        const result = await this.queueCommand(
          "getControlSnapshot",
          {},
          { targetTabId: id }
        );
        if (result.elements && result.elements.length > 0) {
          console.log(
            `[ui-bridge] Proactive snapshot captured: ${result.elements.length} elements`
          );
          return true;
        }
      } catch {
      }
      return false;
    };
    const proactiveTimer = setTimeout(async () => {
      const captured = await captureSnapshot();
      if (!captured && this.tabListeners.has(id)) {
        retryTimer = setTimeout(() => captureSnapshot(), 1500);
      }
    }, 500);
    return () => {
      clearTimeout(proactiveTimer);
      if (retryTimer) clearTimeout(retryTimer);
      this.tabListeners.delete(id);
      this.demotedTabs.delete(id);
      this.tabMetadata.delete(id);
      console.log(
        `[ui-bridge] SSE listener disconnected: ${id} (total: ${this.tabListeners.size})`
      );
      this.resetConnectionGateIfEmpty();
    };
  }
  /**
   * Check if any SSE listeners are connected.
   */
  hasCommandListeners() {
    return this.tabListeners.size > 0;
  }
  /**
   * Get list of connected tab IDs.
   */
  getConnectedTabs() {
    return Array.from(this.tabListeners.keys());
  }
  /**
   * Get connected tabs with page info by querying each tab.
   */
  async getTabsWithInfo() {
    const tabIds = this.getConnectedTabs();
    return Promise.all(
      tabIds.map(async (tabId) => {
        try {
          const info = await Promise.race([
            this.queueCommand(
              "getTabInfo",
              {},
              { targetTabId: tabId }
            ),
            new Promise((resolve) => setTimeout(() => resolve(null), 3e3))
          ]);
          return { tabId, url: info?.url, pathname: info?.pathname, title: info?.title };
        } catch {
          return { tabId };
        }
      })
    );
  }
  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------
  /**
   * Record a heartbeat from the browser, optionally per-tab.
   */
  receiveHeartbeat(tabId, metadata) {
    const now = Date.now();
    if (tabId) {
      this.tabHeartbeats.set(tabId, now);
      if (metadata) {
        this.tabMetadata.set(tabId, {
          url: metadata.url ?? "",
          title: metadata.title ?? "",
          visibility: metadata.visibility ?? "unknown",
          lastSeen: now
        });
      }
    } else {
      this.tabHeartbeats.set("__anonymous__", now);
    }
  }
  /**
   * Check if the browser app is responsive based on heartbeat freshness.
   * Returns true if ANY tab has a heartbeat within the stale threshold.
   */
  isAppResponsive() {
    const now = Date.now();
    for (const lastBeat of this.tabHeartbeats.values()) {
      if (now - lastBeat < this.heartbeatStaleMs) return true;
    }
    return false;
  }
  /**
   * Get the last heartbeat timestamp (max across all tabs).
   */
  getLastHeartbeat() {
    let max = 0;
    for (const lastBeat of this.tabHeartbeats.values()) {
      if (lastBeat > max) max = lastBeat;
    }
    return max;
  }
  // --------------------------------------------------------------------------
  // Diagnostics
  // --------------------------------------------------------------------------
  /**
   * Get internal transport state for debugging.
   */
  getTransportDiagnostics() {
    return {
      pendingCommandCount: this.pendingCommands.size,
      pendingCommandIds: Array.from(this.pendingCommands.keys()),
      commandListenerCount: this.tabListeners.size,
      connectedTabs: Array.from(this.tabListeners.keys()),
      primaryTabId: this.getPrimaryTabId(),
      demotedTabs: Array.from(this.demotedTabs),
      buildId: this.buildId,
      wsClientCount: this.wsClients.size,
      wsClientIds: Array.from(this.wsClients.keys()),
      commandQueueLength: this.commandQueue.length,
      tabHeartbeats: Object.fromEntries(this.tabHeartbeats),
      tabMetadata: Object.fromEntries(this.tabMetadata)
    };
  }
  /**
   * Get pending commands for legacy HTTP polling fallback.
   */
  getPendingCommands() {
    return this.commandQueue.splice(0, this.commandQueue.length);
  }
  /**
   * Push a change event from a browser tab into the relay's ring buffer
   * and notify all subscribers.
   */
  pushChangeEvent(event) {
    this.changeEventBuffer.push(event);
    if (this.changeEventBuffer.length > this.maxChangeEvents) {
      this.changeEventBuffer.splice(0, this.changeEventBuffer.length - this.maxChangeEvents);
    }
    for (const sub of this.changeEventSubscribers) {
      try {
        sub(event);
      } catch {
      }
    }
  }
  /**
   * Subscribe to push-based change events. Returns an unsubscribe function.
   */
  subscribeChanges(callback) {
    this.changeEventSubscribers.add(callback);
    return () => {
      this.changeEventSubscribers.delete(callback);
    };
  }
  /**
   * Get buffered change events since a timestamp.
   */
  getChangeEventsSince(since, limit = 100) {
    return this.changeEventBuffer.filter((e) => e.timestamp > since).slice(-limit);
  }
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.tabHeartbeats.clear();
    this.tabMetadata.clear();
    this.tabLastSuccess.clear();
    this.demotedTabs.clear();
    this.tabListeners.clear();
    this.commandQueue.length = 0;
    this.changeEventBuffer.length = 0;
    this.changeEventSubscribers.clear();
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
function parseRecency(value) {
  if (value === void 0 || value === null) return Recency.Default;
  if (value === "any") return Recency.Any;
  if (value === "current") return Recency.Current;
  const ms = typeof value === "number" ? value : parseInt(value, 10);
  if (!isNaN(ms) && ms > 0) return Recency.MaxAge(ms);
  return Recency.Default;
}

// src/server/relay-handlers.ts
function success2(data, _meta) {
  const response = { success: true, data, timestamp: Date.now() };
  if (_meta) response._meta = _meta;
  return response;
}
function error2(message, code, suggestions) {
  return {
    success: false,
    error: message,
    code,
    timestamp: Date.now(),
    ...suggestions ? { suggestions } : {}
  };
}
var MAX_SCREENSHOT_RESPONSE_BYTES = 10 * 1024 * 1024;
async function fetchFallbackScreenshot(url, reason) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5e3);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_SCREENSHOT_RESPONSE_BYTES) {
      return null;
    }
    const text = await response.text();
    if (text.length > MAX_SCREENSHOT_RESPONSE_BYTES) {
      return null;
    }
    const body = JSON.parse(text);
    if (body?.success && body?.data?.screenshot) {
      return {
        base64: body.data.screenshot,
        width: body.data.width ?? 0,
        height: body.data.height ?? 0,
        reason
      };
    }
    return null;
  } catch {
    return null;
  }
}
function createRelayHandlers(relay, options) {
  const version = options?.version ?? "0.1.0";
  const screenshotFallbackUrl = options?.screenshotFallbackUrl;
  const injectedSpecs = options?.specs ?? [];
  let renderLogEntries = [];
  const MAX_ENTRIES = 50;
  let latestControlSnapshot = {
    timestamp: Date.now(),
    elements: [],
    components: [],
    workflows: [],
    activeRuns: []
  };
  let latestSemanticSnapshot = null;
  let lastConsoleErrorsCache = null;
  async function relayCommand(action, payload = {}, opts) {
    try {
      const result = await relay.queueCommand(action, payload, opts);
      return success2(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hasListeners = relay.hasCommandListeners() || relay.getWebSocketClientCount() > 0;
      const isTimeout = msg.includes("timeout") || msg.includes("Timeout");
      const hint = !hasListeners ? " No browser tab is connected \u2014 ensure the app is open and the UI Bridge SDK is loaded." : isTimeout ? " The browser did not respond in time \u2014 the page may be unresponsive or navigating." : "";
      const isUnsupported = msg.includes("unsupported") || msg.includes("Unsupported") || msg.includes("not supported");
      const suggestions = isTimeout ? [
        "Check if the browser tab is responsive",
        "The page may be navigating or loading heavy content",
        "Try again after the page settles"
      ] : !hasListeners ? [
        "Ensure the app is open in a browser tab",
        "Verify the UI Bridge SDK is loaded in the app"
      ] : isUnsupported ? [
        "Check that the action is supported for this element type",
        "Use getControlSnapshot() to see element capabilities",
        "Supported actions: click, type, select, toggle, scroll, focus"
      ] : void 0;
      const code = isTimeout ? "TIMEOUT" : isUnsupported ? "UNSUPPORTED_ACTION" : "COMMAND_FAILED";
      return error2(`${msg}${hint}`, code, suggestions);
    }
  }
  async function relayWithFallback(action, payload = {}, fallback) {
    try {
      const result = await relay.queueCommand(action, payload);
      return success2(result);
    } catch {
      return success2(fallback, {
        fallback: true,
        reason: `Relay command '${action}' failed or timed out \u2014 returning default value. Ensure the target app is connected and responsive.`
      });
    }
  }
  function filterCachedElements(elements, criteria) {
    const interactiveTypes = /* @__PURE__ */ new Set([
      "button",
      "input",
      "select",
      "textarea",
      "link",
      "checkbox",
      "radio"
    ]);
    let filtered = [...elements];
    if (criteria.interactive_only || criteria.interactiveOnly) {
      filtered = filtered.filter((e) => {
        if (e.kind === "content") return false;
        return interactiveTypes.has(e.type) || e.actions && e.actions.length > 0;
      });
    }
    if (criteria.element_type) {
      const t = criteria.element_type;
      filtered = filtered.filter((e) => e.type === t);
    }
    if (criteria.types && Array.isArray(criteria.types)) {
      const ts = criteria.types;
      filtered = filtered.filter((e) => ts.includes(e.type));
    }
    if (criteria.text) {
      const lc = criteria.text.toLowerCase();
      filtered = filtered.filter(
        (e) => (e.label ?? "").toLowerCase().includes(lc) || e.id.toLowerCase().includes(lc)
      );
    }
    if (criteria.exact_text) {
      const lc = criteria.exact_text.toLowerCase();
      filtered = filtered.filter((e) => (e.label ?? "").toLowerCase() === lc);
    }
    if (criteria.role) {
      const r = criteria.role.toLowerCase();
      filtered = filtered.filter((e) => e.type.toLowerCase() === r);
    }
    if (criteria.label) {
      const lc = criteria.label.toLowerCase();
      filtered = filtered.filter((e) => (e.label ?? "").toLowerCase().includes(lc));
    }
    return filtered.map((e) => ({
      ...e,
      tagName: e.type,
      registered: true
    }));
  }
  const defaultRecency = Recency.MaxAge(options?.cacheTtlMs ?? 5e3);
  let snapshotStaleSince = null;
  function staleMeta() {
    const cacheAgeMs = Date.now() - latestControlSnapshot.timestamp;
    if (snapshotStaleSince) {
      return { stale: true, staleSinceMs: Date.now() - snapshotStaleSince, cacheAgeMs };
    }
    return { stale: false, cacheAgeMs };
  }
  let inflightRefresh = null;
  async function refreshSnapshotIfNeeded(recency, isEmpty) {
    if (recency.kind === "any" && !isEmpty) return;
    const ageMs = Date.now() - latestControlSnapshot.timestamp;
    if (!isEmpty && isSatisfiedBy(recency, ageMs)) return;
    if (inflightRefresh) {
      await inflightRefresh;
      return;
    }
    inflightRefresh = (async () => {
      try {
        const result = await relay.queueCommand("getControlSnapshot", {});
        latestControlSnapshot = result;
        snapshotStaleSince = null;
      } catch {
        if (!snapshotStaleSince) snapshotStaleSince = Date.now();
      }
    })();
    try {
      await inflightRefresh;
    } finally {
      inflightRefresh = null;
    }
  }
  function resolveRecency(opts) {
    return opts?.recency ? parseRecency(opts.recency) : defaultRecency;
  }
  const changeEventBuffer = [];
  const MAX_CHANGE_EVENTS = 5e3;
  const changeEventSubscribers = /* @__PURE__ */ new Set();
  function pushChangeEvent(event) {
    changeEventBuffer.push(event);
    if (changeEventBuffer.length > MAX_CHANGE_EVENTS) {
      changeEventBuffer.splice(0, changeEventBuffer.length - MAX_CHANGE_EVENTS);
    }
    if (!snapshotStaleSince) snapshotStaleSince = Date.now();
    for (const sub of changeEventSubscribers) {
      try {
        sub(event);
      } catch {
      }
    }
  }
  const handlers = {
    // ========================================================================
    // Render Log (server-side)
    // ========================================================================
    async getRenderLog(query) {
      try {
        const result = await relay.queueCommand("getRenderLog", query ?? {});
        if (result && typeof result === "object" && "entries" in result) {
          return success2(result.entries);
        }
      } catch {
      }
      let results = [...renderLogEntries];
      if (query?.type) results = results.filter((e) => e.type === query.type);
      if (query?.since) results = results.filter((e) => e.timestamp >= query.since);
      if (query?.until) results = results.filter((e) => e.timestamp <= query.until);
      if (query?.limit) results = results.slice(-query.limit);
      return success2(results);
    },
    async clearRenderLog() {
      renderLogEntries = [];
      try {
        await relay.queueCommand("clearRenderLog", {});
      } catch {
      }
      return success2(void 0);
    },
    async captureSnapshot() {
      return relayCommand("captureSnapshot");
    },
    async getRenderLogPath() {
      return success2({ path: "/api/ui-bridge/render-log" });
    },
    // ========================================================================
    // Control — Elements
    // ========================================================================
    async getElements(options2) {
      const recency = resolveRecency(options2);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.elements.length === 0);
      const _meta = staleMeta();
      let elements = latestControlSnapshot.elements;
      if (options2?.title || options2?.aria_label || options2?.text) {
        elements = elements.filter(
          (el) => matchesElementSelector(el, {
            title: options2?.title,
            aria_label: options2?.aria_label,
            text: options2?.text
          })
        );
      }
      return success2(elements, _meta);
    },
    async rankElements(request) {
      const recency = resolveRecency(request);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.elements.length === 0);
      const query = request ?? {};
      const matches = findElements(
        latestControlSnapshot.elements,
        query
      );
      return success2(
        matches.map((m) => ({
          id: m.id,
          score: m.score,
          reasons: m.reasons,
          element: m.element
        }))
      );
    },
    async getElement(id, options2) {
      try {
        const result = await relay.queueCommand("getElement", { id });
        if (result) return success2(result);
      } catch {
      }
      let element = latestControlSnapshot.elements.find((e) => e.id === id);
      if (!element) {
        const recency = resolveRecency(options2);
        await refreshSnapshotIfNeeded(recency.kind === "any" ? Recency.Current : recency, true);
        element = latestControlSnapshot.elements.find((e) => e.id === id);
      }
      if (!element) {
        const count = latestControlSnapshot.elements.length;
        return error2(
          `Element "${id}" not found (${count} elements registered). Use find() or getControlSnapshot() to see available elements.`,
          "ELEMENT_NOT_FOUND",
          [
            "Use find() to search for elements by description or type",
            "Use getControlSnapshot() to see all available elements",
            "The element may not be rendered yet \u2014 wait for the page to fully load"
          ]
        );
      }
      return success2(element);
    },
    async getElementState(id) {
      try {
        const result = await relay.queueCommand("getElementState", { id });
        if (result) return success2(result);
      } catch {
      }
      const element = latestControlSnapshot.elements.find((e) => e.id === id);
      if (element && "state" in element) return success2(element.state);
      return error2(`Element state for ${id} not available (browser disconnected)`, "NOT_FOUND");
    },
    async getElementReactState(id) {
      return relayCommand("getElementReactState", { id });
    },
    async executeElementAction(id, request) {
      return relayCommand("executeElementAction", { id, request });
    },
    async executeBatchAction(request) {
      return relayCommand("executeBatchAction", { request });
    },
    // ========================================================================
    // Control — Components
    // ========================================================================
    async getComponents(options2) {
      const recency = resolveRecency(options2);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.components.length === 0);
      const _meta = staleMeta();
      return success2(latestControlSnapshot.components, _meta);
    },
    async getComponent(id, options2) {
      let component = latestControlSnapshot.components.find((c) => c.id === id);
      if (!component) {
        const recency = resolveRecency(options2);
        await refreshSnapshotIfNeeded(recency.kind === "any" ? Recency.Current : recency, true);
        component = latestControlSnapshot.components.find((c) => c.id === id);
      }
      if (!component) {
        const available = latestControlSnapshot.components.map((c) => c.id);
        return error2(
          `Component "${id}" not found. Available components: [${available.join(", ")}]. Components are only available when their page is active \u2014 navigate to the page that contains this component and try again.`,
          "NOT_FOUND",
          [
            "Use getControlSnapshot() to see all available components",
            "Navigate to the page containing this component first",
            "Components mount/unmount with page navigation \u2014 ensure the correct page is active"
          ]
        );
      }
      return success2(component);
    },
    async getComponentState(id) {
      return relayCommand("getComponentState", { id });
    },
    async executeComponentAction(id, request, body) {
      let normalizedRequest;
      if (typeof request === "string") {
        normalizedRequest = { action: request, params: body?.params };
      } else {
        normalizedRequest = request;
      }
      return relayCommand("executeComponentAction", { id, request: normalizedRequest });
    },
    // ========================================================================
    // Find / Discovery
    // ========================================================================
    async find(request) {
      const {
        targetTabId,
        recency: recencyParam,
        ...payload
      } = request || {};
      const result = await relayCommand("find", payload, { targetTabId });
      if (result.success) return result;
      const recency = parseRecency(recencyParam);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.elements.length === 0);
      const filtered = filterCachedElements(latestControlSnapshot.elements, payload);
      const _meta = staleMeta();
      return success2(
        {
          elements: filtered,
          total: filtered.length,
          durationMs: 0,
          timestamp: Date.now()
        },
        _meta
      );
    },
    /**
     * @deprecated Use {@link find} instead. `discover()` is a back-compat alias
     * that forwards to `find()`. The runner only dispatches the `find` action,
     * so browser-side wrappers no longer need a separate `discover` handler.
     * Will be removed in a future major version.
     */
    async discover(request) {
      return handlers.find(request);
    },
    async getElementImages(request) {
      const { targetTabId, ...payload } = request || {};
      return relayCommand("getElementImages", payload, { targetTabId });
    },
    async getControlSnapshot(request) {
      const recency = parseRecency(request?.recency);
      if (recency.kind === "any" && latestControlSnapshot.elements.length > 0) {
        const _meta = staleMeta();
        return success2(latestControlSnapshot, _meta);
      }
      const hasListeners = relay.hasCommandListeners() || relay.getWebSocketClientCount() > 0;
      if (!hasListeners) {
        const snapshot = { ...latestControlSnapshot, timestamp: Date.now() };
        if (screenshotFallbackUrl) {
          const fallback = await fetchFallbackScreenshot(screenshotFallbackUrl, "no_listeners");
          if (fallback) {
            snapshot.fallbackScreenshot = fallback;
          }
        }
        const _meta = staleMeta();
        return success2(snapshot, _meta);
      }
      if (recency.kind === "maxAge") {
        const ageMs = Date.now() - latestControlSnapshot.timestamp;
        if (isSatisfiedBy(recency, ageMs) && latestControlSnapshot.elements.length > 0) {
          const _meta = staleMeta();
          return success2(latestControlSnapshot, _meta);
        }
      }
      try {
        const result = await relay.queueCommand(
          "getControlSnapshot",
          {},
          { targetTabId: request?.targetTabId }
        );
        latestControlSnapshot = result;
        snapshotStaleSince = null;
        const isEmpty = result.elements.length === 0 && result.components.length === 0;
        if (isEmpty && screenshotFallbackUrl) {
          const fallback = await fetchFallbackScreenshot(screenshotFallbackUrl, "empty_response");
          if (fallback) {
            return success2(
              { ...result, fallbackScreenshot: fallback },
              { stale: false, cacheAgeMs: 0 }
            );
          }
        }
        return success2(result, { stale: false, cacheAgeMs: 0 });
      } catch (_e) {
        if (!snapshotStaleSince) snapshotStaleSince = Date.now();
        const snapshot = { ...latestControlSnapshot, timestamp: Date.now() };
        if (screenshotFallbackUrl) {
          const fallback = await fetchFallbackScreenshot(screenshotFallbackUrl, "timeout");
          if (fallback) {
            snapshot.fallbackScreenshot = fallback;
          }
        }
        const _meta = staleMeta();
        return success2(snapshot, _meta);
      }
    },
    // ========================================================================
    // Workflows
    // ========================================================================
    async getWorkflows(options2) {
      const recency = resolveRecency(options2);
      await refreshSnapshotIfNeeded(recency, latestControlSnapshot.workflows.length === 0);
      const _meta = staleMeta();
      return success2(latestControlSnapshot.workflows, _meta);
    },
    async runWorkflow(id, request) {
      return relayCommand("runWorkflow", { id, request });
    },
    async getWorkflowStatus(runId) {
      return relayCommand("getWorkflowStatus", { runId });
    },
    // ========================================================================
    // Debug
    // ========================================================================
    async getActionHistory(limit) {
      return relayWithFallback("getActionHistory", { limit }, []);
    },
    async getMetrics() {
      return success2({
        timestamp: Date.now(),
        uptime: typeof process !== "undefined" ? process.uptime() * 1e3 : 0,
        memory: typeof process !== "undefined" ? process.memoryUsage() : {},
        pendingCommands: relay.getTransportDiagnostics().pendingCommandCount,
        commandQueueLength: relay.getTransportDiagnostics().commandQueueLength
      });
    },
    async highlightElement(id) {
      return relayCommand("highlightElement", { id });
    },
    async getElementTree() {
      return relayCommand("getElementTree");
    },
    async getConsoleErrors(params) {
      const isGrouped = params?.group === true;
      try {
        const result = await relay.queueCommand(
          "getConsoleErrors",
          params ?? {}
        );
        if (!isGrouped && result && typeof result === "object") {
          lastConsoleErrorsCache = success2(result);
        }
        return success2(result);
      } catch {
        if (!isGrouped && lastConsoleErrorsCache)
          return lastConsoleErrorsCache;
        if (isGrouped) {
          return success2({ groups: [], totalErrors: 0, totalGroups: 0 });
        }
        return success2({ errors: [], count: 0 });
      }
    },
    async clearConsoleErrors() {
      return relayCommand("clearConsoleErrors");
    },
    // ========================================================================
    // AI-Native
    // ========================================================================
    async aiSearch(criteria) {
      return relayCommand("aiSearch", criteria);
    },
    async aiFind(request) {
      return relayCommand("aiFind", request);
    },
    async aiExecute(request) {
      return relayCommand("aiExecute", request);
    },
    async aiAssert(request) {
      return relayCommand("aiAssert", request);
    },
    async aiAssertBatch(request) {
      return relayCommand("aiAssertBatch", request);
    },
    async getSemanticSnapshot(options2) {
      try {
        const result = await relay.queueCommand(
          "getSemanticSnapshot",
          options2 ?? {}
        );
        latestSemanticSnapshot = result;
        return success2(result);
      } catch (e) {
        if (latestSemanticSnapshot) return success2(latestSemanticSnapshot);
        return error2(e.message, "COMMAND_FAILED");
      }
    },
    async getSemanticDiff(since) {
      return relayCommand("getSemanticDiff", { since });
    },
    async getPageSummary() {
      return relayCommand("getPageSummary");
    },
    // ========================================================================
    // Change Tracking
    // ========================================================================
    async executeWithDiff(request) {
      return relayCommand("executeWithDiff", request);
    },
    async waitForChange(request) {
      return relayCommand("waitForChange", request);
    },
    async categorizeLastDiff() {
      return relayCommand("categorizeLastDiff");
    },
    async getScopedDiff(request) {
      return relayCommand("getScopedDiff", request);
    },
    async summarizeDiff(request) {
      return relayCommand("summarizeDiff", request);
    },
    async analyzeStructuredChanges(request) {
      return relayCommand("analyzeStructuredChanges", request);
    },
    // ========================================================================
    // Change Buffer
    // ========================================================================
    async enableChangeBuffer() {
      return relayCommand("enableChangeBuffer");
    },
    async disableChangeBuffer() {
      return relayCommand("disableChangeBuffer");
    },
    async drainChangeBuffer() {
      return relayCommand("drainChangeBuffer");
    },
    async getChangeBufferSize() {
      return relayCommand("getChangeBufferSize");
    },
    // ========================================================================
    // Snapshot Bookmarks
    // ========================================================================
    async saveBookmark(request) {
      return relayCommand("saveBookmark", request);
    },
    async getBookmark(name) {
      return relayCommand("getBookmark", { name });
    },
    async deleteBookmark(name) {
      return relayCommand("deleteBookmark", { name });
    },
    async listBookmarks() {
      return relayCommand("listBookmarks");
    },
    async diffFromBookmark(name) {
      return relayCommand("diffFromBookmark", { name });
    },
    // ========================================================================
    // Semantic Search
    // ========================================================================
    async aiSemanticSearch(criteria) {
      return relayCommand("aiSemanticSearch", criteria);
    },
    // ========================================================================
    // State Management
    // ========================================================================
    async getStates() {
      return relayWithFallback("getStates", {}, []);
    },
    async getState(id) {
      return relayCommand("getState", { id });
    },
    async getActiveStates() {
      return relayWithFallback("getActiveStates", {}, []);
    },
    async activateState(id) {
      return relayCommand("activateState", { id });
    },
    async deactivateState(id) {
      return relayCommand("deactivateState", { id });
    },
    async getStateGroups() {
      return relayWithFallback("getStateGroups", {}, []);
    },
    async activateStateGroup(id) {
      return relayCommand("activateStateGroup", { id });
    },
    async deactivateStateGroup(id) {
      return relayCommand("deactivateStateGroup", { id });
    },
    async getTransitions() {
      return relayWithFallback("getTransitions", {}, []);
    },
    async canExecuteTransition(id) {
      return relayCommand("canExecuteTransition", { id });
    },
    async executeTransition(id) {
      return relayCommand("executeTransition", { id });
    },
    async findPath(request) {
      return relayCommand("findPath", request);
    },
    async navigateTo(request) {
      return relayCommand("navigateTo", request);
    },
    async getStateSnapshot() {
      return relayWithFallback(
        "getStateSnapshot",
        {},
        {
          timestamp: Date.now(),
          activeStates: [],
          states: [],
          groups: [],
          transitions: []
        }
      );
    },
    // ========================================================================
    // Intent
    // ========================================================================
    async executeIntent(request) {
      return relayCommand("executeIntent", request);
    },
    async findIntent(request) {
      return relayCommand("findIntent", request);
    },
    async listIntents() {
      return relayWithFallback("listIntents", {}, []);
    },
    async registerIntent(intent) {
      return relayCommand("registerIntent", intent);
    },
    async executeIntentFromQuery(request) {
      return relayCommand("executeIntentFromQuery", request);
    },
    async deleteIntent(name) {
      return relayCommand("deleteIntent", { name });
    },
    // ========================================================================
    // Recovery
    // ========================================================================
    async attemptRecovery(request) {
      return relayCommand("attemptRecovery", request);
    },
    // ========================================================================
    // Cross-App Analysis
    // ========================================================================
    async analyzePageData() {
      return relayCommand("analyzePageData");
    },
    async analyzePageRegions() {
      return relayCommand("analyzePageRegions");
    },
    async analyzeStructuredData() {
      return relayCommand("analyzeStructuredData");
    },
    async crossAppCompare(request) {
      return relayCommand("crossAppCompare", request);
    },
    // ========================================================================
    // Page Navigation
    // ========================================================================
    async pageRefresh() {
      return relayCommand("pageRefresh");
    },
    async pageNavigate(request) {
      const { targetTabId, ...payload } = request;
      const url = payload.url;
      if (!url) {
        return error2("URL is required", "INVALID_REQUEST");
      }
      const dangerousProtocols = ["javascript:", "data:", "blob:", "vbscript:"];
      try {
        const parsed = new URL(url);
        if (dangerousProtocols.includes(parsed.protocol)) {
          return error2(
            `Dangerous URL protocol rejected: "${parsed.protocol}". Only http, https, and relative paths are allowed.`,
            "INVALID_URL_PROTOCOL"
          );
        }
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return error2(
            `Invalid URL protocol "${parsed.protocol}". Only http, https, and relative paths are allowed.`,
            "INVALID_URL_PROTOCOL"
          );
        }
      } catch {
        if (!url.startsWith("/")) {
          return error2(
            'Invalid URL format. Only http, https, and relative paths starting with "/" are allowed.',
            "INVALID_URL_FORMAT"
          );
        }
      }
      return relayCommand("pageNavigate", payload, { targetTabId });
    },
    async pageGoBack() {
      return relayCommand("pageGoBack");
    },
    async pageGoForward() {
      return relayCommand("pageGoForward");
    },
    async pageEvaluate(request) {
      return relayCommand("pageEvaluate", request);
    },
    async pageScroll(request) {
      return relayCommand("pageScroll", request);
    },
    // ========================================================================
    // Annotations
    // ========================================================================
    async getAnnotations() {
      return relayWithFallback("getAnnotations", {}, {});
    },
    async getAnnotation(id) {
      return relayCommand("getAnnotation", { id });
    },
    async setAnnotation(id, annotation) {
      return relayCommand("setAnnotation", { id, annotation });
    },
    async deleteAnnotation(id) {
      return relayCommand("deleteAnnotation", { id });
    },
    async importAnnotations(config) {
      return relayCommand("importAnnotations", config);
    },
    async exportAnnotations() {
      return relayCommand("exportAnnotations");
    },
    async getAnnotationCoverage() {
      return relayCommand("getAnnotationCoverage");
    },
    // ========================================================================
    // Clipboard (relayed to browser for gesture-based access)
    // ========================================================================
    /**
     * @deprecated Use {@link setClipboard} instead. `clipboardWrite()` is a
     * back-compat alias that forwards to `setClipboard()`. The runner only
     * dispatches the `setClipboard` action.
     * Will be removed in a future major version.
     */
    async clipboardWrite(request) {
      return handlers.setClipboard(request);
    },
    /**
     * @deprecated Use {@link getClipboard} instead. `clipboardRead()` is a
     * back-compat alias that forwards to `getClipboard()`. The runner only
     * dispatches the `getClipboard` action.
     * Will be removed in a future major version.
     */
    async clipboardRead() {
      return handlers.getClipboard();
    },
    // ========================================================================
    // Performance Diagnostics
    // ========================================================================
    async getPerformanceEntries() {
      return relayCommand("getPerformanceEntries");
    },
    async clearPerformanceEntries() {
      return relayCommand("clearPerformanceEntries");
    },
    async getBrowserEvents(params) {
      return relayCommand("getBrowserEvents", params ?? {});
    },
    async getTimeline(params) {
      return relayCommand("getTimeline", params ?? {});
    },
    // ========================================================================
    // Health & Error Debugging
    // ========================================================================
    async getHealthReport(params) {
      return relayCommand("getHealthReport", params ?? {});
    },
    async getNetworkChains(params) {
      return relayCommand("getNetworkChains", params ?? {});
    },
    async startErrorSession(request) {
      return relayCommand("startErrorSession", request);
    },
    async endErrorSession() {
      return relayCommand("endErrorSession");
    },
    async getErrorSessions() {
      return relayCommand("getErrorSessions");
    },
    async captureErrorBaseline(request) {
      return relayCommand("captureErrorBaseline", request);
    },
    async compareErrorBaseline(request) {
      return relayCommand("compareErrorBaseline", request);
    },
    async getErrorSnapshots(params) {
      return relayCommand("getErrorSnapshots", params ?? {});
    },
    async getErrorReport() {
      return relayCommand("getErrorReport");
    },
    // ========================================================================
    // Design Review
    // ========================================================================
    async getElementStyles(id) {
      return relayCommand("getElementStyles", { id });
    },
    async getElementStateStyles(id, request) {
      return relayCommand("getElementStateStyles", { id, ...request });
    },
    async getDesignSnapshot(request) {
      return relayCommand("getDesignSnapshot", request ?? {});
    },
    async getResponsiveSnapshots(request) {
      return relayCommand("getResponsiveSnapshots", request);
    },
    async setViewportConstraints(request) {
      return relayCommand("setViewportConstraints", request);
    },
    async runDesignAudit(request) {
      return relayCommand("runDesignAudit", request ?? {});
    },
    async loadStyleGuide(request) {
      return relayCommand("loadStyleGuide", request);
    },
    async getStyleGuide() {
      return relayCommand("getStyleGuide");
    },
    async clearStyleGuide() {
      return relayCommand("clearStyleGuide");
    },
    // ========================================================================
    // Quality Evaluation
    // ========================================================================
    async evaluateQuality(request) {
      return relayCommand("evaluateQuality", request ?? {});
    },
    async getQualityContexts() {
      return relayCommand("getQualityContexts");
    },
    async saveBaseline(request) {
      return relayCommand("saveBaseline", request ?? {});
    },
    async diffBaseline(request) {
      return relayCommand("diffBaseline", request ?? {});
    },
    // ========================================================================
    // Form State Awareness
    // ========================================================================
    async getForms() {
      return relayCommand("getForms");
    },
    async fillForm(request) {
      return relayCommand("fillForm", request);
    },
    async snapshotForms() {
      return relayCommand("snapshotForms");
    },
    async diffForms(request) {
      return relayCommand("diffForms", request);
    },
    // ========================================================================
    // Clipboard
    // ========================================================================
    async getClipboard() {
      return relayCommand("getClipboard");
    },
    async setClipboard(request) {
      return relayCommand("setClipboard", request);
    },
    // ========================================================================
    // Network Request Monitoring
    // ========================================================================
    async getNetworkRequests(params) {
      return relayCommand("getNetworkRequests", params ?? {});
    },
    async getNetworkRequestsInFlight() {
      return relayCommand("getNetworkRequestsInFlight");
    },
    async waitForNetworkRequest(request) {
      return relayCommand("waitForNetworkRequest", request);
    },
    async getNetworkRequest(id) {
      return relayCommand("getNetworkRequest", { id });
    },
    // ========================================================================
    // Idle Detection
    // ========================================================================
    async getIdleStatus() {
      return relayCommand("getIdleStatus");
    },
    async getIdleSignalStatus(signal) {
      return relayCommand("getIdleSignalStatus", { signal });
    },
    async waitForIdle(request) {
      return relayCommand("waitForIdle", request ?? {});
    },
    async waitForSignalIdle(signal, request) {
      return relayCommand("waitForSignalIdle", { signal, ...request });
    },
    async waitForTargets(request) {
      return relayCommand("waitForTargets", request);
    },
    // ========================================================================
    // Undo/Redo
    // ========================================================================
    async getUndoState() {
      return relayCommand("getUndoState");
    },
    async executeUndo() {
      return relayCommand("executeUndo");
    },
    async executeRedo() {
      return relayCommand("executeRedo");
    },
    // ========================================================================
    // API Discovery (server-only)
    // ========================================================================
    async getCapabilities() {
      return success2({
        version,
        categories: {
          control: {
            description: "Element and component control",
            endpoints: [
              { method: "GET", path: "/control/elements", description: "List registered elements" },
              { method: "GET", path: "/control/snapshot", description: "Get control snapshot" },
              { method: "POST", path: "/control/find", description: "Find elements" },
              {
                method: "POST",
                path: "/control/element/:id/action",
                description: "Execute element action"
              }
            ]
          },
          ai: {
            description: "AI-native search and execution",
            endpoints: [
              { method: "POST", path: "/ai/search", description: "Semantic element search" },
              {
                method: "POST",
                path: "/ai/execute",
                description: "Natural language action execution"
              },
              { method: "POST", path: "/ai/assert", description: "UI assertion" },
              { method: "GET", path: "/ai/snapshot", description: "Semantic snapshot" }
            ]
          },
          media: {
            description: "Media element discovery and analysis",
            endpoints: [
              {
                method: "POST",
                path: "/ai/media/find",
                description: "Find media elements with filters"
              },
              {
                method: "POST",
                path: "/ai/media/audit/accessibility",
                description: "Alt text audit"
              },
              {
                method: "POST",
                path: "/ai/media/audit/performance",
                description: "Oversized/transfer size audit"
              },
              { method: "POST", path: "/ai/media/snapshot", description: "Capture media snapshot" },
              { method: "POST", path: "/ai/media/compare", description: "Compare two snapshots" },
              {
                method: "POST",
                path: "/ai/media/analyze",
                description: "Capture image + context for AI analysis"
              },
              {
                method: "POST",
                path: "/ai/media/analyze/batch",
                description: "Capture multiple images for comparison"
              },
              {
                method: "POST",
                path: "/ai/media/analyze/page",
                description: "Capture all visible media on page"
              }
            ]
          },
          debug: {
            description: "Debugging and diagnostics",
            endpoints: [
              { method: "GET", path: "/debug/metrics", description: "Server metrics" },
              { method: "GET", path: "/control/health", description: "Health report" },
              { method: "GET", path: "/control/browser-events", description: "Browser events" }
            ]
          }
        }
      });
    },
    // ========================================================================
    // Heartbeat (server-only)
    // ========================================================================
    async receiveHeartbeat() {
      relay.receiveHeartbeat();
      return success2({ received: true });
    },
    // ========================================================================
    // Media Discovery & Analysis
    // ========================================================================
    async findMedia(request) {
      return relayCommand("findMedia", request ?? {});
    },
    async mediaAuditAccessibility() {
      return relayCommand("mediaAuditAccessibility");
    },
    async mediaAuditPerformance() {
      return relayCommand("mediaAuditPerformance");
    },
    async captureMediaSnapshot(request) {
      return relayCommand("captureMediaSnapshot", request);
    },
    async compareMediaSnapshots(request) {
      return relayCommand("compareMediaSnapshots", request);
    },
    async analyzeMedia(request) {
      return relayCommand("analyzeMedia", request);
    },
    async analyzeMediaBatch(request) {
      return relayCommand("analyzeMediaBatch", request);
    },
    async analyzeMediaPage(request) {
      return relayCommand("analyzeMediaPage", request ?? {});
    },
    async getSpecs() {
      const result = await relayWithFallback("getSpecs", {}, {});
      if (result.success && result.data && Object.keys(result.data).length > 0) {
        return result;
      }
      if (injectedSpecs.length > 0) {
        const data = {};
        for (const spec of injectedSpecs) {
          data[spec.specId] = spec.config;
        }
        return success2(data);
      }
      return result;
    },
    async getElementHistory(elementId, options2) {
      return relayWithFallback("getElementHistory", { elementId, options: options2 }, []);
    },
    // ========================================================================
    // Change Observation (push-based)
    // ========================================================================
    async getChangesSince(params) {
      const since = params?.since ?? 0;
      const limit = params?.limit ?? 100;
      const events = changeEventBuffer.filter((e) => e.timestamp > since).slice(-limit);
      return success2({ events, count: events.length });
    },
    // Enhanced discovery — relay to browser context
    async query(request) {
      return relayCommand("query", request);
    },
    async waitForElement(request) {
      return relayCommand("waitForElement", request);
    },
    // Tier 3.1 — relay to browser context so the JS SDK can do registry polling
    async waitForElementByCondition(request) {
      return relayCommand("waitForElementByCondition", request);
    },
    // Testing-friendliness — relay route-change waits to the browser
    // context, which owns the ChangeTracker state.
    async waitForRouteChange(request) {
      return relayCommand("waitForRouteChange", request);
    },
    async waitForElementRegistered(request) {
      return relayCommand("waitForElementRegistered", request);
    },
    // Tier 3.2 — relay batch to browser context
    async controlBatch(request) {
      return relayCommand("controlBatch", request);
    },
    // App-agnostic convenience endpoints
    async clickByText(request) {
      return relayCommand("clickByText", request);
    },
    async clickBySelector(request) {
      return relayCommand("clickBySelector", request);
    },
    async typeInto(request) {
      return relayCommand("typeInto", request);
    },
    async readValue(request) {
      return relayCommand("readValue", request);
    },
    async findByText(request) {
      return relayCommand("findByText", request);
    },
    // Diagnostics
    async getDiagnostics() {
      return relayCommand("getDiagnostics");
    },
    // Navigation adapter
    async getRoutes() {
      return relayCommand("getRoutes");
    },
    async navigateByAdapter(request) {
      return relayCommand("navigateByAdapter", request);
    }
  };
  handlers.__addRenderLogEntry = (entry) => {
    renderLogEntries.push(entry);
    while (renderLogEntries.length > MAX_ENTRIES) renderLogEntries.shift();
  };
  handlers.__addRenderLogEntries = (entries) => {
    for (const entry of entries) {
      renderLogEntries.push(entry);
      while (renderLogEntries.length > MAX_ENTRIES) renderLogEntries.shift();
    }
  };
  handlers.__pushChangeEvent = pushChangeEvent;
  handlers.__subscribeChanges = (callback) => {
    changeEventSubscribers.add(callback);
    return () => {
      changeEventSubscribers.delete(callback);
    };
  };
  return handlers;
}

export { CDPTabDiscovery, CommandRelay, SSEManager, StandaloneServer, UIBridgeWSHandler, UI_BRIDGE_ROUTES, WSStreamAdapter, createAIHandlers, createControlHandlers, createDebugHandlers, createExpressApp, createExpressRouter, createHandlers, createNextRouteHandlers, createRelayHandlers, createRenderLogHandlers, createStandaloneServer, createUIBridgeHandler, createWSStreamBroadcast, matchesElementSelector, startCLI, uiBridgeMiddleware };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map