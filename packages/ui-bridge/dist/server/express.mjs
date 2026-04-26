var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
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
  // Snapshot bookmarks (static routes before parameterized)
  { method: "POST", path: "/ai/bookmarks", handler: "saveBookmark", bodyRequired: true },
  { method: "GET", path: "/ai/bookmarks", handler: "listBookmarks" },
  { method: "GET", path: "/ai/bookmark/:name", handler: "getBookmark", params: ["name"] },
  {
    method: "DELETE",
    path: "/ai/bookmark/:name",
    handler: "deleteBookmark",
    params: ["name"]
  },
  {
    method: "GET",
    path: "/ai/bookmark/:name/diff",
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
function wrapError(error, code) {
  return {
    success: false,
    error: typeof error === "string" ? error : error.message,
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
      } catch (error) {
        res.status(500).json(wrapError(error, "AUTH_ERROR"));
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
    } catch (error) {
      res.status(500).json(wrapError(error, "INTERNAL_ERROR"));
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

export { createExpressApp, createExpressRouter, uiBridgeMiddleware };
//# sourceMappingURL=express.mjs.map
//# sourceMappingURL=express.mjs.map