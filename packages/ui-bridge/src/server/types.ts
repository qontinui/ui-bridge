/**
 * UI Bridge Server Types
 *
 * Shared types for server adapters.
 */

import type { UIBridgeConfig, ElementHistoryOptions } from '../core';
import type { UiBridgeErrorCode } from '../diagnostics';
import type {
  ControlActionRequest,
  ControlActionResponse,
  ComponentActionRequest,
  ComponentActionResponse,
  BatchActionRequest,
  BatchActionResponse,
  FindRequest,
  FindResponse,
  ControlSnapshot,
  WorkflowRunRequest,
  WorkflowRunResponse,
  PageNavigateRequest,
  PageNavigationResponse,
  FillFormRequest,
  EffectRecordEntry,
} from '../control';
import type { FillResult } from '../core/types';
import type { PageHealthReport } from './page-health';
import type { RenderLogEntry, RenderLogEntryType } from '../render-log';
import type {
  SearchCriteria,
  SearchResponse,
  NLActionRequest,
  NLActionResponse,
  AssertionRequest,
  AssertionResult,
  BatchAssertionRequest,
  BatchAssertionResult,
  SemanticSnapshot,
  SemanticDiff,
  SemanticSearchCriteria,
  SemanticSearchResponse,
  Intent,
  IntentSearchResponse,
  IntentExecutionResult,
  RecoveryAttemptRequest,
  RecoveryAttemptResult,
  PageDataMap,
  PageRegionMap,
  StructuredDataExtraction,
  CrossAppComparisonReport,
  ComponentInfo,
  ActionWithDiffRequest,
  ActionDiffResult,
  ChangePredicate,
  WaitForChangeOptions,
  CategorizedDiff,
  ChangeBufferDrainResult,
  SnapshotBookmark,
  FormsResponse,
  StructuredChangeAnalysis,
  FormSnapshot,
  FormDiff,
  FindResult,
  FindContext,
} from '../ai';
import type {
  InteractionStateName,
  ElementDesignData,
  StateStyles,
  ResponsiveSnapshot,
} from '../core/types';
import type { StyleGuideConfig, StyleAuditReport } from '../specs/style-types';
import type {
  QualityEvaluationReport,
  SnapshotDiffReport,
  EvaluateRequest,
} from '../specs/quality-types';
import type {
  UIState,
  UIStateGroup,
  UITransition,
  PathResult,
  TransitionResult,
  NavigationResult,
  StateSnapshot,
} from '../core';
import type { ElementAnnotation, AnnotationConfig, AnnotationCoverage } from '../annotations';
import type { CapturedError, AnyCapturedEvent } from '../debug/browser-capture-types';
import type { FingerprintedEvent } from '../debug/error-fingerprint';
import type { TimelineEntry } from '../debug/error-timeline';
import type { HealthReport } from '../debug/health-score';
import type { ErrorSessionSummary, BaselineComparison } from '../debug/error-session';
import type { NetworkChain } from '../debug/network-chain';
import type { ErrorSnapshot } from '../debug/error-snapshot';
import type { CompositeIdleStatus, SignalStatus } from '../idle';
import type { NetworkRequestEntry, WaitForRequestOptions, WaitForRequestResult } from '../network';
import type { UndoRedoState } from '../undo';

/**
 * Server configuration
 */
export interface UIBridgeServerConfig extends UIBridgeConfig {
  /** Base path for API routes */
  basePath?: string;
  /** Enable CORS */
  cors?: boolean | CORSOptions;
  /** Authentication middleware */
  authenticate?: (req: unknown) => boolean | Promise<boolean>;
  /** Rate limiting */
  rateLimit?: RateLimitOptions;
}

/**
 * CORS options
 */
export interface CORSOptions {
  /** Allowed origins */
  origin?: string | string[] | boolean;
  /** Allowed methods */
  methods?: string[];
  /** Allowed headers */
  headers?: string[];
  /** Expose headers */
  exposeHeaders?: string[];
  /** Allow credentials */
  credentials?: boolean;
  /** Max age for preflight cache */
  maxAge?: number;
}

/**
 * Rate limit options
 */
export interface RateLimitOptions {
  /** Time window in milliseconds */
  windowMs?: number;
  /** Max requests per window */
  max?: number;
  /** Message when rate limited */
  message?: string;
}

/**
 * API response wrapper
 */
export interface APIResponse<T = unknown> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response data */
  data?: T;
  /** Error message if failed (human-readable, dual-audience — plan goal #3) */
  error?: string;
  /**
   * Stable machine-readable diagnostic code. Populated on every
   * `success: false` response (plan Phase 1 — required on failure;
   * optional at the type level only because successful responses omit it).
   * Always a canonical `UiBridgeErrorCode` (mapped from internal/legacy
   * codes via the diagnostics `mapInternalErrorCode`).
   */
  code?: UiBridgeErrorCode;
  /** Request timestamp */
  timestamp: number;
  /** Response metadata (staleness, diagnostics) */
  _meta?: {
    stale?: boolean;
    staleSinceMs?: number;
    cacheAgeMs?: number;
    fallback?: boolean;
    reason?: string;
  };
  /** Recovery suggestions for error responses */
  suggestions?: string[];
  /**
   * Optional HTTP status code hint. When set, the framework adapter
   * (Express / Next.js) will use this code instead of the default 200.
   * Used by endpoints that need 4xx semantics on logical failure (e.g.
   * Phase 2.1 `/control/element/:id/expect` returns 422 when the asserted
   * predicate doesn't hold). Stripped from the JSON body before send so
   * external consumers see the same envelope shape.
   */
  httpStatus?: number;
}

/**
 * Render log query parameters
 */
/**
 * One runner-owned webview window, as returned by `listWindows()`
 * (`GET /control/runner-windows`). The wire shape mirrors the runner's
 * `ui_bridge_list_runner_windows_handler` exactly — no field remapping.
 */
export interface RunnerWindow {
  /** The window's Tauri label — the value to pass as `windowLabel`. */
  label: string;
  /** `'main'` for the runner's primary window, `'secondary'` for a pop-out. */
  kind: 'main' | 'secondary';
  /** The window's title, or `null` if unavailable. */
  title: string | null;
}

/**
 * Response payload of `listWindows()` (`GET /control/runner-windows`).
 */
export interface RunnerWindowsList {
  /** Number of windows returned. */
  count: number;
  /** The runner process's own webview windows, sorted by `label`. */
  windows: RunnerWindow[];
}

/**
 * Request body for `POST /control/page/evaluate` (`pageEvaluate`).
 *
 * The body is forwarded verbatim to the runner, so any additional fields are
 * preserved (index signature); the two known fields are typed for
 * discoverability.
 */
export interface PageEvaluateRequest {
  /** JavaScript expression to evaluate in the target window. */
  expression: string;
  /**
   * Target a runner pop-out window discoverable via `listWindows()`;
   * omit → the main window. The runner reads this from the request body
   * (`EvaluateQuery.window_label`) or the `?windowLabel=` query, **query
   * wins** (`resolve_evaluate_window`); unknown labels yield a structured
   * error naming the missing window.
   */
  windowLabel?: string;
  /** Forward-compatible: extra fields are forwarded to the runner verbatim. */
  [key: string]: unknown;
}

export interface RenderLogQuery {
  /** Filter by entry type */
  type?: RenderLogEntryType;
  /** Filter entries since timestamp */
  since?: number;
  /** Filter entries until timestamp */
  until?: number;
  /** Limit number of results */
  limit?: number;
}

/**
 * Browser events response — returned by GET /control/browser-events
 */
export interface BrowserEventsResponse {
  /** Raw events (filtered by params) */
  events: AnyCapturedEvent[] | CapturedError[];
  /** Total count of returned events */
  count: number;
  /** Deduplicated event groups (only when deduplicate=true) */
  deduplicated?: FingerprintedEvent[];
  /** Number of unique fingerprints (only when deduplicate=true) */
  uniqueCount?: number;
}

/**
 * Phase 2.1 (plan 2026-05-03) — body for POST /control/element/:id/expect.
 * Reuses the closed `WaitForElementState` enum from the SDK runtime so the
 * predicate evaluator is shared with `/ai/wait-for-element`. The critical
 * semantic difference: this endpoint **fails the request** with HTTP 422
 * when the predicate doesn't hold within `timeout`, instead of returning
 * 200 + `found:false`.
 */
export interface ElementExpectRequest {
  /** Predicate to assert. Closed enum mirroring WaitForElementState. */
  state:
    | 'present'
    | 'visible'
    | 'enabled'
    | 'disabled'
    | 'value-not-empty'
    | 'value-empty'
    | 'checked'
    | 'unchecked'
    | 'absent';
  /** Timeout in ms. Default 5000, capped at 30000. */
  timeout?: number;
  /** Poll interval in ms. Default 100, minimum 10. */
  pollMs?: number;
}

/**
 * Response from POST /control/element/:id/expect. `passed:true` rides on
 * HTTP 200; `passed:false` rides on HTTP 422 (set via `APIResponse.httpStatus`).
 */
export interface ElementExpectResponse {
  /** Whether the predicate held within the timeout window. */
  passed: boolean;
  /**
   * Element snapshot at the moment the predicate flipped true (on pass) or
   * the most recent registered snapshot before timeout (on fail). `null`
   * when the element was never registered during the wait.
   */
  observedState: {
    registered: boolean;
    state: Record<string, unknown> | null;
  } | null;
  /** Wall-clock duration of the wait in ms. */
  durationMs: number;
}

/**
 * Phase 1.3 (plan 2026-05-03) — flat machine-readable digest of "is the
 * page in a sensible state right now?". Synthesized from the live snapshot,
 * console-errors buffer, and idle detector so the caller spends one round-
 * trip instead of four. Distinct from the NL `/ai/page-summary` digest.
 */
export interface StateSummary {
  /** Count of snapshot elements that are both layout-positioned and visible. */
  visibleElementCount: number;
  /** True when the snapshot's `modalStack` has at least one entry. */
  modalOpen: boolean;
  /** True when the console-errors buffer has at least one entry. */
  hasErrors: boolean;
  /**
   * Pass-through of the idle detector's composite status, or `null` when
   * idle detection is disabled. Lets callers gate work on idle without
   * issuing a separate `/control/idle-status` round-trip.
   */
  idleSignals: CompositeIdleStatus | null;
  /** Number of components currently registered. */
  registeredComponents: number;
  /** Current page route, or `null` when undeterminable. */
  route: string | null;
  /** Currently active tab id (for tab-based apps), or `null` when not provided. */
  activeTab: string | null;
}

/**
 * Phase 4.1 (plan 2026-05-03) — body for POST /control/sdk/spawn-headless.
 *
 * Wraps the already-shipped `@qontinui/ui-bridge-headless` package's
 * `launchHeadlessTab` so callers can spin up a real Chromium tab for testing
 * without manually opening a browser. The endpoint is gated behind the
 * `enableHeadlessSpawn` config flag (or `ENABLE_HEADLESS_SPAWN=1`); disabled
 * by default because it pulls in Playwright + Chromium at runtime.
 */
export interface SpawnHeadlessRequest {
  /** Target URL the headless tab should navigate to. Must start with http:// or https://. */
  url: string;
  /**
   * Max time (ms) to wait for the headless client to register a tab over UI Bridge.
   * Default 30000, capped at 60000.
   */
  timeoutMs?: number;
  /**
   * Auto-close timer (seconds). Tracked spawned tabs are also closed on
   * server shutdown. Default 300.
   */
  keepAliveSecs?: number;
  /**
   * Run Chromium without a visible window. Default `true` — the whole point
   * of this endpoint is "no manual browser".
   */
  headless?: boolean;
  /** Viewport size override. Default 1280x720. */
  viewport?: { width: number; height: number };
}

/**
 * Phase 4.1 — response from POST /control/sdk/spawn-headless.
 */
export interface SpawnHeadlessResponse {
  /** True when the tab was launched (regardless of UI Bridge registration). */
  spawned: boolean;
  /** Tab id assigned by the relay when registration succeeded; `null` otherwise. */
  tabId: string | null;
  /** True when the relay reported the tab as connected before timeout. */
  uiBridgeRegistered: boolean;
  /** URL the page actually ended up at after navigation. */
  finalUrl: string;
}

/**
 * Per-user tab scoping context (§4.2) — threaded as the final positional
 * argument of every relay-dispatching handler.
 *
 * The Next.js adapter populates `callerUserId` from the trusted
 * `X-Caller-User-Id` request header (set by the consumer's auth gate from
 * the authenticated identity — NEVER from a browser-supplied value). The
 * relay-handlers layer lifts `callerUserId` into `ownerCheck.userId` on the
 * downstream `relay.queueCommand` call so the relay refuses to dispatch
 * the command to a tab owned by a different user.
 *
 * The reason this is a dedicated final-arg `context` object instead of a
 * field in the request body / query: many handlers (e.g. `captureSnapshot`,
 * `clearRenderLog`, `getElementState(id)`) have zero-arg or args-without-bag
 * signatures, so there is no body/query for the adapter to splice
 * `__callerUserId` into. Without this explicit channel, those handlers
 * would bypass per-user scoping entirely and silently dispatch to whichever
 * tab happened to be `primaryTabId` — including tabs owned by other users.
 */
export interface HandlerContext {
  /**
   * Authenticated caller's user id, as supplied by the consumer's auth gate
   * via the `X-Caller-User-Id` header. When present, the relay restricts
   * dispatch to tabs owned by this user. When absent, the call is treated
   * as a trusted admin / server-side call and the unfiltered primary-tab
   * fallback applies.
   */
  callerUserId?: string;
}

/**
 * Server handler interface
 *
 * Implementations provide these handlers for different frameworks.
 *
 * Per-user tab scoping (§4.2): handlers that dispatch to a browser tab
 * accept an optional final `context?: HandlerContext` parameter. The
 * Next.js / Express adapters thread the authenticated caller's user id
 * through that parameter so the relay can enforce per-user dispatch
 * boundaries.
 */
export interface UIBridgeServerHandlers {
  // Render log endpoints
  getRenderLog: (
    query?: RenderLogQuery,
    context?: HandlerContext
  ) => Promise<APIResponse<RenderLogEntry[]>>;
  clearRenderLog: (context?: HandlerContext) => Promise<APIResponse<void>>;
  captureSnapshot: (context?: HandlerContext) => Promise<APIResponse<unknown>>;
  getRenderLogPath: () => Promise<APIResponse<{ path: string }>>;

  // Control endpoints
  getElements: (
    options?: {
      recency?: string;
      /** Case-insensitive substring filter on the element's title DOM attribute */
      title?: string;
      /** Case-insensitive substring filter on the element's aria-label DOM attribute */
      aria_label?: string;
      /** Case-insensitive substring filter on the element's visible text / label */
      text?: string;
      /**
       * Phase 3.2 (plan 2026-05-03) — return only elements whose `reveals`
       * array contains an entry that matches this query. Bi-directional glob
       * match: query may be a concrete id matching a `*`-glob entry, or a
       * `*`-glob matching concrete entries.
       */
      revealsAny?: string;
      /**
       * Target a runner pop-out window discoverable via `listWindows()`;
       * omit → the main window. Serialized as the `?windowLabel=` query
       * parameter (the runner reads it from the query on `GET
       * /control/elements`); unknown labels yield a structured error naming
       * the missing window.
       */
      windowLabel?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<ControlSnapshot['elements']>>;
  /**
   * Enumerate the runner process's OWN webview windows — the main window plus
   * any pop-out terminal windows — so callers can discover valid `windowLabel`
   * targets before issuing a window-scoped command. Maps to
   * `GET /control/runner-windows`.
   *
   * **Runner-only.** This is answered by the qontinui-runner, which owns the
   * Tauri webviews. Non-runner server contexts (a plain React-app server, the
   * relay's browser-tab path) host no runner windows and return a
   * `NOT_IMPLEMENTED` error — discover windows via direct HTTP to the runner.
   * Distinct from `/control/windows`, which enumerates OS desktop windows.
   */
  listWindows: (context?: HandlerContext) => Promise<APIResponse<RunnerWindowsList>>;
  getElement: (
    id: string,
    options?: { recency?: string },
    context?: HandlerContext
  ) => Promise<APIResponse<ControlSnapshot['elements'][0]>>;
  getElementState: (id: string, context?: HandlerContext) => Promise<APIResponse<unknown>>;
  getElementReactState: (
    id: string,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  executeElementAction: (
    id: string,
    request: ControlActionRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<ControlActionResponse>>;
  executeBatchAction: (
    request: BatchActionRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<BatchActionResponse>>;
  /**
   * Rank snapshot elements by natural-language query against the
   * structured disambiguation metadata (variant, position, color,
   * contextPath, label, type). Returns scored matches.
   *
   * Free-text input is tokenised and matched token-bag style; structured
   * filters (type, origin, visibleOnly, contextPathContains) act as hard
   * filters. See `@qontinui/ui-bridge/core` `findElements` for the
   * scoring model.
   */
  rankElements: (
    request: {
      text?: string;
      type?: string;
      variant?: string;
      position?: string;
      color?: string;
      contextPathContains?: string;
      origin?: 'hook' | 'auto';
      visibleOnly?: boolean;
      limit?: number;
      minScore?: number;
    },
    context?: HandlerContext
  ) => Promise<
    APIResponse<
      Array<{
        id: string;
        score: number;
        reasons: string[];
        element: ControlSnapshot['elements'][0];
      }>
    >
  >;

  // Component endpoints
  // F2 (Direction B): `data` is `{components: [...]}` so the envelope matches
  // the runner's direct `/ui-bridge/control/components` route and aligns with
  // every other rich endpoint convention (object-shaped `data`).
  getComponents: (
    options?: {
      recency?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ components: ControlSnapshot['components'] }>>;
  getComponent: (
    id: string,
    options?: { recency?: string },
    context?: HandlerContext
  ) => Promise<APIResponse<ControlSnapshot['components'][0]>>;
  getComponentState: (
    id: string,
    context?: HandlerContext
  ) => Promise<
    APIResponse<{
      state: Record<string, unknown>;
      computed: Record<string, unknown>;
      timestamp: number;
    }>
  >;
  executeComponentAction: (
    id: string,
    request: ComponentActionRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<ComponentActionResponse>>;

  // Find endpoints
  find: (
    request?: FindRequest & { recency?: string },
    context?: HandlerContext
  ) => Promise<APIResponse<FindResponse>>;
  /**
   * @deprecated Use find() instead
   */
  discover: (
    request?: FindRequest & { recency?: string },
    context?: HandlerContext
  ) => Promise<APIResponse<FindResponse>>;
  getControlSnapshot: (
    request?: {
    targetTabId?: string;
    url?: string;
    skipSettle?: boolean | string;
    settleTimeout?: number | string;
    recency?: string;
    /**
     * Item 1 filter: when `true`, drop elements with `kind: "content"`
     * (semantic `data-ui-bridge-content` entries) from the response.
     * Default `false` — include everything.
     */
    interactiveOnly?: boolean | string;
    /** snake_case alias for `interactiveOnly`. */
    interactive_only?: boolean | string;
    /**
     * Manual-test remediation 2026-05-10 (Item 2) filter: when `true`,
     * keep only elements that report disabled by any of these signals in
     * the snapshot's `state`: `disabled === true`, `ariaDisabled === true`
     * (or the pre-R8 `"true"` string), or `enabled === false`. Default `false` —
     * include everything. All other snapshot metadata (route, activeTab,
     * registration, viewport, errorSummary) is preserved unchanged.
     */
    withDisabledOnly?: boolean | string;
    /** snake_case alias for `withDisabledOnly`. */
    with_disabled_only?: boolean | string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<ControlSnapshot>>;

  // Vision pipeline endpoints — runner-direct; SDK stubs only.
  visionCapture: (
    request?: Record<string, unknown>,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  visionAnnotate: (
    request?: Record<string, unknown>,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  visionDiff: (
    request?: Record<string, unknown>,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  visionRaw: (
    request?: Record<string, unknown>,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  visionCacheStream: (sha256: string, context?: HandlerContext) => Promise<APIResponse<unknown>>;
  visionHealth: (context?: HandlerContext) => Promise<APIResponse<unknown>>;
  // Phase 4 — text-bearing outputs.
  visionExtract: (
    request?: Record<string, unknown>,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  visionDescribe: (
    request?: Record<string, unknown>,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  // Phase 6 — analyzers + assertion DSL + baselines + frontend mutation signal.
  visionAnalyze: (
    request?: Record<string, unknown>,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  visionAssert: (
    request?: Record<string, unknown>,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  visionBaseline: (
    request?: Record<string, unknown>,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  visionBaselinesList: (context?: HandlerContext) => Promise<APIResponse<unknown>>;
  visionMutationOccurred: (context?: HandlerContext) => Promise<APIResponse<unknown>>;

  // Workflow endpoints
  getWorkflows: (
    options?: {
      recency?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<ControlSnapshot['workflows']>>;
  runWorkflow: (
    id: string,
    request?: WorkflowRunRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<WorkflowRunResponse>>;
  getWorkflowStatus: (
    runId: string,
    context?: HandlerContext
  ) => Promise<APIResponse<WorkflowRunResponse>>;

  // Debug endpoints
  getActionHistory: (
    limit?: number,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown[]>>;
  // D3 Effect Calculus (Phase 2) — read-only recent predict-then-verify
  // cycles from the process-global effect store. Newest-first; `limit` caps
  // the slice (omitted = all retained, default ring-buffer cap 100).
  getRecentEffects: (
    options?: { limit?: number },
    context?: HandlerContext
  ) => Promise<APIResponse<EffectRecordEntry[]>>;
  getMetrics: () => Promise<APIResponse<unknown>>;
  highlightElement: (id: string, context?: HandlerContext) => Promise<APIResponse<void>>;
  getElementTree: (context?: HandlerContext) => Promise<APIResponse<unknown>>;
  getConsoleErrors: (
    params?: {
      since?: number;
      /**
       * Monotonic id cursor — return only entries with `id > sinceId`.
       * Paired with `nextSinceId` in the ungrouped response for pagination.
       * Takes precedence over the legacy `since` timestamp filter when both
       * are provided.
       */
      sinceId?: number;
      limit?: number;
      group?: boolean;
      groupBy?: 'fingerprint' | 'message' | 'source';
    },
    context?: HandlerContext
  ) => Promise<
    APIResponse<
      | {
          errors: CapturedError[];
          count: number;
          /** Cursor for the next call — last returned entry's id, or `sinceId` if empty. */
          nextSinceId?: number;
          /** Lifetime total of entries evicted from the underlying buffer. */
          droppedCount?: number;
          /** Current buffer size (not filtered by level/since). */
          bufferedCount?: number;
        }
      | { groups: unknown[]; totalErrors: number; totalGroups: number }
    >
  >;
  clearConsoleErrors: (context?: HandlerContext) => Promise<APIResponse<{ cleared: boolean }>>;

  // AI-native endpoints
  aiSearch: (
    criteria: SearchCriteria,
    context?: HandlerContext
  ) => Promise<APIResponse<SearchResponse>>;
  aiFind: (
    request: {
      query: string;
      context?: FindContext;
      confidenceThreshold?: number;
      /**
       * B2 — strict literal-match mode. When `true`, returns only elements
       * with a case-insensitive exact match against id / labelText /
       * ariaLabel / textContent / title / placeholder / value / name; no
       * fuzzy fallback. Default `false` keeps fuzzy behaviour.
       */
      strict?: boolean;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<FindResult>>;
  aiExecute: (
    request: NLActionRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<NLActionResponse>>;
  aiAssert: (
    request: AssertionRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<AssertionResult>>;
  aiAssertBatch: (
    request: BatchAssertionRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<BatchAssertionResult>>;
  getSemanticSnapshot: (
    options?: {
      includeForms?: string | boolean;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<SemanticSnapshot>>;
  getSemanticDiff: (
    since?: number,
    context?: HandlerContext
  ) => Promise<APIResponse<SemanticDiff | null>>;
  getPageSummary: (context?: HandlerContext) => Promise<APIResponse<string>>;

  // Change tracking endpoints
  executeWithDiff: (
    request: ActionWithDiffRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<ActionDiffResult>>;
  waitForChange: (
    request: {
      predicate: ChangePredicate;
      options?: WaitForChangeOptions;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<SemanticDiff>>;
  categorizeLastDiff: (context?: HandlerContext) => Promise<APIResponse<CategorizedDiff | null>>;
  getScopedDiff: (
    request: {
      scope: string;
      fromBookmark?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<SemanticDiff | null>>;
  // Budget-aware diff summary
  summarizeDiff: (
    request: {
      budget: number;
      includeIds?: boolean;
      includeCategory?: boolean;
      fromBookmark?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ summary: string }>>;
  // Structured change analysis (table/list-aware)
  analyzeStructuredChanges: (
    request: {
      fromBookmark?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<StructuredChangeAnalysis>>;

  // Change buffer endpoints
  enableChangeBuffer: (context?: HandlerContext) => Promise<APIResponse<{ enabled: boolean }>>;
  disableChangeBuffer: (context?: HandlerContext) => Promise<APIResponse<{ enabled: boolean }>>;
  drainChangeBuffer: (
    context?: HandlerContext
  ) => Promise<APIResponse<ChangeBufferDrainResult>>;
  getChangeBufferSize: (
    context?: HandlerContext
  ) => Promise<APIResponse<{ size: number; enabled: boolean }>>;

  // Snapshot bookmark endpoints
  saveBookmark: (
    request: { name: string },
    context?: HandlerContext
  ) => Promise<APIResponse<SnapshotBookmark>>;
  getBookmark: (name: string, context?: HandlerContext) => Promise<APIResponse<SnapshotBookmark>>;
  deleteBookmark: (
    name: string,
    context?: HandlerContext
  ) => Promise<APIResponse<{ deleted: boolean }>>;
  listBookmarks: (context?: HandlerContext) => Promise<APIResponse<string[]>>;
  diffFromBookmark: (
    name: string,
    context?: HandlerContext
  ) => Promise<APIResponse<SemanticDiff | null>>;

  // Semantic search (embedding-based)
  aiSemanticSearch: (
    criteria: SemanticSearchCriteria,
    context?: HandlerContext
  ) => Promise<APIResponse<SemanticSearchResponse>>;

  // State management endpoints
  getStates: (context?: HandlerContext) => Promise<APIResponse<UIState[]>>;
  getState: (id: string, context?: HandlerContext) => Promise<APIResponse<UIState>>;
  getActiveStates: (context?: HandlerContext) => Promise<APIResponse<UIState[]>>;
  activateState: (id: string, context?: HandlerContext) => Promise<APIResponse<void>>;
  deactivateState: (id: string, context?: HandlerContext) => Promise<APIResponse<void>>;
  getStateGroups: (context?: HandlerContext) => Promise<APIResponse<UIStateGroup[]>>;
  activateStateGroup: (id: string, context?: HandlerContext) => Promise<APIResponse<void>>;
  deactivateStateGroup: (id: string, context?: HandlerContext) => Promise<APIResponse<void>>;
  getTransitions: (context?: HandlerContext) => Promise<APIResponse<UITransition[]>>;
  canExecuteTransition: (
    id: string,
    context?: HandlerContext
  ) => Promise<APIResponse<{ canExecute: boolean; reason?: string }>>;
  executeTransition: (
    id: string,
    context?: HandlerContext
  ) => Promise<APIResponse<TransitionResult>>;
  findPath: (
    request: { targetStates: string[] },
    context?: HandlerContext
  ) => Promise<APIResponse<PathResult>>;
  navigateTo: (
    request: { targetStates: string[] },
    context?: HandlerContext
  ) => Promise<APIResponse<NavigationResult>>;
  getStateSnapshot: (context?: HandlerContext) => Promise<APIResponse<StateSnapshot>>;

  // Intent endpoints
  executeIntent: (
    request: {
      intentId: string;
      params?: Record<string, unknown>;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<IntentExecutionResult>>;
  findIntent: (
    request: { query: string },
    context?: HandlerContext
  ) => Promise<APIResponse<IntentSearchResponse>>;
  listIntents: (context?: HandlerContext) => Promise<APIResponse<Intent[]>>;
  registerIntent: (intent: Intent, context?: HandlerContext) => Promise<APIResponse<Intent>>;
  executeIntentFromQuery: (
    request: {
      query: string;
      params?: Record<string, unknown>;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<IntentExecutionResult>>;
  deleteIntent: (
    name: string,
    context?: HandlerContext
  ) => Promise<APIResponse<{ deleted: boolean }>>;

  // Recovery endpoints
  attemptRecovery: (
    request: RecoveryAttemptRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<RecoveryAttemptResult>>;

  // Cross-app analysis endpoints
  analyzePageData: (context?: HandlerContext) => Promise<APIResponse<PageDataMap>>;
  analyzePageRegions: (context?: HandlerContext) => Promise<APIResponse<PageRegionMap>>;
  analyzeStructuredData: (
    context?: HandlerContext
  ) => Promise<APIResponse<StructuredDataExtraction>>;
  crossAppCompare: (
    request: {
      sourceSnapshot: SemanticSnapshot;
      targetSnapshot: SemanticSnapshot;
      sourceComponents?: ComponentInfo[];
      targetComponents?: ComponentInfo[];
    },
    context?: HandlerContext
  ) => Promise<APIResponse<CrossAppComparisonReport>>;

  // Page navigation endpoints
  pageRefresh: (context?: HandlerContext) => Promise<APIResponse<PageNavigationResponse>>;
  pageNavigate: (
    request: PageNavigateRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<PageNavigationResponse>>;
  pageGoBack: (context?: HandlerContext) => Promise<APIResponse<PageNavigationResponse>>;
  pageGoForward: (context?: HandlerContext) => Promise<APIResponse<PageNavigationResponse>>;
  pageEvaluate: (
    request: PageEvaluateRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown>>;
  pageScroll: (request: unknown, context?: HandlerContext) => Promise<APIResponse<unknown>>;

  // Clipboard endpoints (browser gesture-based)
  clipboardWrite: (request: unknown, context?: HandlerContext) => Promise<APIResponse<unknown>>;
  clipboardRead: (context?: HandlerContext) => Promise<APIResponse<unknown>>;

  // Annotation endpoints
  getAnnotations: (
    context?: HandlerContext
  ) => Promise<APIResponse<Record<string, ElementAnnotation>>>;
  getAnnotation: (
    id: string,
    context?: HandlerContext
  ) => Promise<APIResponse<ElementAnnotation>>;
  setAnnotation: (
    id: string,
    annotation: ElementAnnotation,
    context?: HandlerContext
  ) => Promise<APIResponse<ElementAnnotation>>;
  deleteAnnotation: (id: string, context?: HandlerContext) => Promise<APIResponse<void>>;
  importAnnotations: (
    config: AnnotationConfig,
    context?: HandlerContext
  ) => Promise<APIResponse<{ count: number }>>;
  exportAnnotations: (context?: HandlerContext) => Promise<APIResponse<AnnotationConfig>>;
  getAnnotationCoverage: (
    context?: HandlerContext
  ) => Promise<APIResponse<AnnotationCoverage>>;

  // Performance diagnostics endpoints
  getPerformanceEntries: (context?: HandlerContext) => Promise<APIResponse<unknown>>;
  clearPerformanceEntries: (
    context?: HandlerContext
  ) => Promise<APIResponse<{ cleared: boolean }>>;
  getBrowserEvents: (
    params?: {
      type?: string;
      since?: number;
      limit?: number;
      severity?: string;
      deduplicate?: boolean;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<BrowserEventsResponse>>;
  getTimeline: (
    params?: {
      since?: number;
      limit?: number;
      minSeverity?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ entries: TimelineEntry[]; count: number }>>;

  // Health score endpoint
  getHealthReport: (
    params?: { windowMs?: number },
    context?: HandlerContext
  ) => Promise<APIResponse<HealthReport>>;

  // Network chain endpoints
  getNetworkChains: (
    params?: {
      since?: number;
      limit?: number;
      failuresOnly?: boolean;
      url?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ chains: NetworkChain[]; count: number }>>;

  // Error session endpoints
  startErrorSession: (
    request: { label?: string },
    context?: HandlerContext
  ) => Promise<APIResponse<{ sessionId: string }>>;
  endErrorSession: (
    context?: HandlerContext
  ) => Promise<APIResponse<ErrorSessionSummary | null>>;
  getErrorSessions: (context?: HandlerContext) => Promise<APIResponse<ErrorSessionSummary[]>>;
  captureErrorBaseline: (
    request: { label: string },
    context?: HandlerContext
  ) => Promise<APIResponse<{ label: string; capturedAt: number; fingerprintCount: number }>>;
  compareErrorBaseline: (
    request: { label: string },
    context?: HandlerContext
  ) => Promise<APIResponse<BaselineComparison | null>>;

  // Error snapshots (auto-captured on significant errors)
  getErrorSnapshots: (
    params?: {
      limit?: number;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ snapshots: ErrorSnapshot[]; count: number }>>;

  // Composite error report (health + recent errors + session in one call)
  getErrorReport: (
    context?: HandlerContext
  ) => Promise<
    APIResponse<{
      health: HealthReport;
      recentErrors: AnyCapturedEvent[];
      activeSession: ErrorSessionSummary | null;
      snapshots: ErrorSnapshot[];
    }>
  >;

  // Design review endpoints
  getElementStyles: (
    id: string,
    context?: HandlerContext
  ) => Promise<APIResponse<ElementDesignData>>;
  getElementStateStyles: (
    id: string,
    request: { states?: InteractionStateName[] },
    context?: HandlerContext
  ) => Promise<APIResponse<{ elementId: string; stateStyles: StateStyles[] }>>;
  getDesignSnapshot: (
    request?: {
      elementIds?: string[];
      includePseudoElements?: boolean;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ elements: ElementDesignData[]; timestamp: number }>>;
  getResponsiveSnapshots: (
    request: {
      viewports?: Record<string, number>;
      elementIds?: string[];
    },
    context?: HandlerContext
  ) => Promise<APIResponse<ResponsiveSnapshot[]>>;
  setViewportConstraints: (
    request: { width?: number; restore?: boolean },
    context?: HandlerContext
  ) => Promise<
    APIResponse<{
      success: boolean;
      viewportWidth: number;
      constrainedWidth: number;
      timestamp: number;
    }>
  >;
  runDesignAudit: (
    request?: {
      guide?: StyleGuideConfig;
      elementIds?: string[];
    },
    context?: HandlerContext
  ) => Promise<APIResponse<StyleAuditReport>>;
  loadStyleGuide: (
    request: {
      guide: StyleGuideConfig;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ loaded: boolean }>>;
  getStyleGuide: (context?: HandlerContext) => Promise<APIResponse<StyleGuideConfig | null>>;
  clearStyleGuide: (context?: HandlerContext) => Promise<APIResponse<{ cleared: boolean }>>;

  // Quality evaluation endpoints
  evaluateQuality: (
    request?: EvaluateRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<QualityEvaluationReport>>;
  getQualityContexts: (
    context?: HandlerContext
  ) => Promise<APIResponse<Array<{ name: string; description: string }>>>;
  saveBaseline: (
    request?: {
      label?: string;
      elementIds?: string[];
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ saved: boolean; elementCount: number }>>;
  diffBaseline: (
    request?: { elementIds?: string[] },
    context?: HandlerContext
  ) => Promise<APIResponse<SnapshotDiffReport>>;

  // Form state awareness endpoints
  getForms: (context?: HandlerContext) => Promise<APIResponse<FormsResponse>>;
  fillForm: (
    request: FillFormRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<FillResult>>;
  snapshotForms: (context?: HandlerContext) => Promise<APIResponse<FormSnapshot>>;
  diffForms: (
    request: {
      before: FormSnapshot;
      after: FormSnapshot;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<FormDiff>>;

  // Clipboard endpoints
  getClipboard: (
    context?: HandlerContext
  ) => Promise<APIResponse<{ text: string | null; formats: string[] }>>;
  setClipboard: (
    request: {
      text: string;
      html?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ written: boolean; formats: string[] }>>;

  // Network request monitoring endpoints
  getNetworkRequests: (
    params?: {
      status?: string;
      method?: string;
      urlPattern?: string;
      failuresOnly?: boolean;
      since?: number;
      limit?: number;
    },
    context?: HandlerContext
  ) => Promise<
    APIResponse<{ requests: NetworkRequestEntry[]; count: number; inFlightCount: number }>
  >;

  getNetworkRequestsInFlight: (
    context?: HandlerContext
  ) => Promise<APIResponse<{ requests: NetworkRequestEntry[]; count: number }>>;

  waitForNetworkRequest: (
    request: WaitForRequestOptions,
    context?: HandlerContext
  ) => Promise<APIResponse<WaitForRequestResult>>;

  getNetworkRequest: (
    id: string,
    context?: HandlerContext
  ) => Promise<APIResponse<NetworkRequestEntry>>;

  // Idle detection endpoints
  getIdleStatus: (context?: HandlerContext) => Promise<APIResponse<CompositeIdleStatus>>;
  getIdleSignalStatus: (
    signal: string,
    context?: HandlerContext
  ) => Promise<APIResponse<SignalStatus>>;
  waitForIdle: (
    request?: {
      timeout?: number;
      minStableMs?: number;
      exclude?: string[];
    },
    context?: HandlerContext
  ) => Promise<APIResponse<CompositeIdleStatus>>;
  waitForSignalIdle: (
    signal: string,
    request?: { timeout?: number; minStableMs?: number },
    context?: HandlerContext
  ) => Promise<APIResponse<SignalStatus>>;
  waitForTargets: (
    request: {
      targets: Array<string | { indicator: string }>;
      timeout?: number;
      minStableMs?: number;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<Record<string, SignalStatus>>>;

  // Undo/redo awareness endpoints
  getUndoState: (context?: HandlerContext) => Promise<APIResponse<UndoRedoState>>;
  executeUndo: (context?: HandlerContext) => Promise<APIResponse<{ executed: boolean }>>;
  executeRedo: (context?: HandlerContext) => Promise<APIResponse<{ executed: boolean }>>;

  // Phase 1.3 (plan 2026-05-03) — flat machine-readable digest of "is the
  // page in a sensible state right now?" so callers don't have to fan out
  // five round-trips (snapshot + console-errors + idle-status + …) just to
  // pre-flight an interaction. Distinct from `/ai/page-summary` which
  // returns NL prose for human consumption.
  getStateSummary: () => Promise<APIResponse<StateSummary>>;

  // Phase 2.1 (plan 2026-05-03) — assert an element predicate.
  // Returns 200 + passed:true on success, 422 + passed:false on timeout
  // (set via APIResponse.httpStatus). Shares predicate evaluation with
  // `/ai/wait-for-element` so semantics stay aligned.
  expectElement: (
    id: string,
    request: ElementExpectRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<ElementExpectResponse>>;

  // Phase 4.1 (plan 2026-05-03) — spawn a real Chromium tab via
  // `@qontinui/ui-bridge-headless` so callers can drive the web bridge
  // without manually opening a browser. Gated behind `enableHeadlessSpawn`
  // (off by default); returns 503 when disabled or when the optional peer
  // dependency isn't installed; 400 on bad input.
  spawnHeadless: (
    request: SpawnHeadlessRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<SpawnHeadlessResponse>>;

  // Page health diagnostics — runs the same spatial-coverage / layout /
  // text-signal heuristics as the runner's `/control/page-health` analyzer
  // (qontinui-runner src-tauri/src/mcp/ui_bridge/screenshots.rs) but
  // server-side over the current snapshot. Pure data-over-elements; no
  // browser context required beyond a relayed snapshot.
  pageHealth: () => Promise<APIResponse<PageHealthReport>>;

  // Occlusion sweep — WHAT IS COVERING WHAT, page-wide and directed.
  // `pageHealth` and `discover` both report per-element visibility, but
  // neither answers "is a floating widget hiding something?", which needs
  // the occluder -> occluded relation rather than a per-element boolean.
  visibility: (params?: {
    minRatio?: number;
    includeExpected?: boolean;
  }) => Promise<APIResponse<VisibilityReport>>;

  // API discovery
  getCapabilities: () => Promise<APIResponse<CapabilitiesResponse>>;

  // Specs endpoint — serves all loaded specs for runner discovery
  getSpecs: () => Promise<APIResponse<Record<string, unknown>>>;

  // Heartbeat (app health detection)
  receiveHeartbeat: () => Promise<APIResponse<{ received: boolean }>>;

  // Element event log
  getElementHistory: (
    elementId: string,
    options?: ElementHistoryOptions,
    context?: HandlerContext
  ) => Promise<APIResponse<unknown[]>>;

  // Media discovery & analysis endpoints — removed in Phase 2 of the
  // UI Bridge Vision Pipeline (2026-05-13). The `/control/screenshot`,
  // `/control/annotated-screenshot`, `/control/element-screenshot`,
  // `/control/capture-element-images`, `/control/get-element-images`,
  // `/control/diagnose-stuck-screen`, and `/ai/media/*` routes are
  // superseded by `/vision/{capture,annotate,diff,raw,cache,health}`
  // declared above (handlers prefixed `vision*`). The runner answers those
  // routes directly; the SDK keeps stubs for type-completeness.

  // Change observation (push-based)
  getChangesSince: (params?: {
    since?: number;
    limit?: number;
  }) => Promise<APIResponse<{ events: DOMChangeEvent[]; count: number }>>;

  /** Tear down internal subscriptions and observers to prevent resource leaks. */
  destroy?: () => void;

  // Enhanced discovery endpoints
  query: (
    request: {
      selector: string;
      limit?: number;
      includeState?: boolean;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ elements: unknown[]; count: number }>>;

  waitForElement: (
    request: {
      selector?: string;
      elementId?: string;
      timeout?: number;
      pollInterval?: number;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ found: boolean; element?: unknown; waitedMs: number }>>;

  /**
   * Tier 3.1 — Wait for an element matching a structured selector to satisfy
   * a given condition (present / visible / clickable / text-matches).
   *
   * Implemented via registry polling so it works with both DOM and native elements.
   */
  waitForElementByCondition: (
    request: WaitForElementByConditionRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<WaitForElementByConditionResponse>>;

  /**
   * Testing-friendliness — Wait for an SPA route change with optional
   * from/to matching. Returns a timeout shape (reason: 'timeout') when no
   * matching navigation occurs before `timeoutMs`.
   */
  waitForRouteChange: (
    request?: WaitForRouteChangeRequest,
    context?: HandlerContext
  ) => Promise<
    APIResponse<
      WaitForRouteChangeResponse | { reason: 'timeout'; lastKnownRoute?: string; elapsedMs: number }
    >
  >;

  /**
   * Testing-friendliness — Wait for an element matching `predicate` to be
   * registered (or visible / have layout, per `requirement`). Polls the
   * in-memory registry; falls back to `document.querySelector` when
   * `predicate.selector` is given.
   */
  waitForElementRegistered: (
    request: WaitForElementRequest,
    context?: HandlerContext
  ) => Promise<
    APIResponse<
      | WaitForElementSuccessResponse
      | { reason: 'timeout'; elapsedMs: number; closestMatch?: Record<string, unknown> }
    >
  >;

  /**
   * Tier 3.2 — Execute a heterogeneous sequence of actions, waits, and
   * snapshots in one round-trip.
   */
  controlBatch: (
    request: ControlBatchRequest,
    context?: HandlerContext
  ) => Promise<APIResponse<ControlBatchResponse>>;

  // App-agnostic convenience endpoints
  clickByText: (
    request: {
      text: string;
      tag?: string;
      exact?: boolean;
      /** Target a runner pop-out window discoverable via `listWindows()`; omit → main window. Read from the body. */
      windowLabel?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ clicked: boolean; element?: unknown }>>;

  clickBySelector: (
    request: {
      selector: string;
      index?: number;
      /** Target a runner pop-out window discoverable via `listWindows()`; omit → main window. Read from the body. */
      windowLabel?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ clicked: boolean; element?: unknown }>>;

  typeInto: (
    request: {
      selector?: string;
      label?: string;
      text: string;
      clear?: boolean;
      /** Target a runner pop-out window discoverable via `listWindows()`; omit → main window. Read from the body. */
      windowLabel?: string;
    },
    context?: HandlerContext
  ) => Promise<APIResponse<{ typed: boolean; element?: unknown }>>;

  readValue: (
    request: {
      selector: string;
      index?: number;
      /**
       * Return EVERY matching element's value in `values[]` instead of just the
       * addressed one. Mutually exclusive with `index` — passing both is a
       * 400, never a silent pick. (Was accepted and silently dropped before.)
       */
      all?: boolean;
      /** Target a runner pop-out window discoverable via `listWindows()`; omit → main window. Read from the body. */
      windowLabel?: string;
    },
    context?: HandlerContext
  ) => Promise<
    APIResponse<{
      value: string | null;
      length: number;
      /** Matches for the selector, reported whether or not `all` was set. */
      totalMatches: number;
      /** Every match, in document order. Present iff `all: true`. */
      values?: Array<{ index: number; value: string | null; length: number }>;
    }>
  >;

  /**
   * Dispatch a key sequence at the DOCUMENT level rather than at an element.
   *
   * The element-scoped `sendKeys` action only reaches elements that advertise
   * it, so behavior implemented as a global `document.addEventListener(
   * 'keydown', …)` — Escape-to-close on dropdowns/modals/command palettes —
   * was unreachable and could regress silently.
   */
  sendKeysToPage: (
    request: {
      /**
       * `"Escape"` / `"ctrl+Enter"` (ONE key), an array of such strings, or the
       * explicit `[{ key, modifiers? }]` descriptor form. A bare string is never
       * re-read as a character sequence — use `typeInto` to type text.
       */
      keys: string | string[] | Array<{ key: string; modifiers?: Record<string, boolean> }>;
      /** Dispatch node. Default `document`. An unknown value is a 400, not a fallback. */
      target?: 'document' | 'body' | 'window' | 'activeElement';
      /** Milliseconds between keys. */
      delay?: number;
      /** Target a runner pop-out window discoverable via `listWindows()`; omit → main window. Read from the body. */
      windowLabel?: string;
    },
    context?: HandlerContext
  ) => Promise<
    APIResponse<{
      dispatched: number;
      target: string;
      keys: string[];
      outcomes: Array<{ key: string; defaultPrevented: boolean }>;
    }>
  >;

  findByText: (
    request: { text: string; tag?: string; exact?: boolean; windowLabel?: string },
    context?: HandlerContext
  ) => Promise<
    APIResponse<
      Array<{
        index: number;
        tag: string;
        text: string;
        rect: { x: number; y: number; width: number; height: number };
        disabled: boolean;
        visible: boolean;
      }>
    >
  >;

  // Diagnostics endpoint
  getDiagnostics: (context?: HandlerContext) => Promise<
    APIResponse<{
      sdk_initialized: boolean;
      auto_register_active: boolean;
      registered_elements: number;
      dom_interactive_elements: number;
      mutation_observer_active: boolean;
      navigation_adapter: string;
      page_title: string;
      page_url: string;
      page_ready: boolean;
      providers_mounted: string[];
      last_discover_at: string | null;
      capabilities: string[];
    }>
  >;

  // Navigation adapter endpoints
  getRoutes: (
    context?: HandlerContext
  ) => Promise<APIResponse<Array<{ name: string; path: string }>>>;
  navigateByAdapter: (
    request: { page: string },
    context?: HandlerContext
  ) => Promise<APIResponse<{ navigated: boolean; route: { name: string; path: string } }>>;
}

/**
 * Push-based DOM change event.
 *
 * Batched subtree-change events emitted by the ChangeObserver and relayed
 * through the CommandRelay. Inspired by folk-js/allio's SubtreeChanged event.
 */
export interface DOMChangeEvent {
  type: 'subtreeChanged';
  timestamp: number;
  added: string[];
  removed: string[];
  modified: string[];
}

/**
 * Endpoint description for API discovery
 */
export interface EndpointInfo {
  method: string;
  path: string;
  description: string;
  queryParams?: Record<string, string>;
}

/**
 * Category of related endpoints
 */
export interface EndpointCategory {
  description: string;
  endpoints: EndpointInfo[];
}

/**
 * Response from the /capabilities endpoint
 */
export interface CapabilitiesResponse {
  version: string;
  categories: Record<string, EndpointCategory>;
}

/**
 * Selector criteria for waitForElementByCondition.
 * All provided fields are ANDed together (case-insensitive substring match).
 */
export interface ElementConditionSelector {
  /** Match by element id (exact or substring) */
  id?: string;
  /** Match by title attribute (substring) */
  title?: string;
  /** Match by aria-label attribute (substring) */
  aria_label?: string;
  /** Match by visible text / label (substring) */
  text?: string;
  /** Match by element type (e.g. "button", "input") */
  type?: string;
}

/**
 * Request body for POST /ai/wait-for-element (Tier 3.1)
 */
export interface WaitForElementByConditionRequest {
  /** Selector criteria — all provided fields must match */
  selector: ElementConditionSelector;
  /** Max wait in ms (default 5000, capped at 60000) */
  timeout_ms?: number;
  /** Condition to check on each poll */
  condition?: 'present' | 'visible' | 'clickable' | 'text-matches';
  /** Substring to match when condition is "text-matches" (case-insensitive) */
  text_match?: string;
}

/**
 * Response body for POST /ai/wait-for-element (Tier 3.1)
 */
export interface WaitForElementByConditionResponse {
  /** Whether the condition was satisfied before timeout */
  matched: boolean;
  /** The matched element (present when matched is true) */
  element?: unknown;
  /** How long we actually waited in ms */
  waited_ms: number;
}

/**
 * Request body for POST /ai/wait-for-route-change.
 *
 * Blocks until the SPA route changes. Optionally filters by the prior
 * route (`fromRoute`) and/or the new route (`toRoute` with `matchMode`).
 * When a matching route change happened between the request arriving and
 * the subscription being set, the handler resolves immediately with
 * `elapsedMs: 0` by scanning the always-on recent-route-change buffer.
 */
export interface WaitForRouteChangeRequest {
  /** Only fire when the prior route equals this exact string. */
  fromRoute?: string;
  /** Only fire when the new route matches this (per `matchMode`). */
  toRoute?: string;
  /** How to compare `toRoute` against the new route. Default: `"exact"`. */
  matchMode?: 'exact' | 'prefix' | 'regex';
  /** Max wait in ms. Default 5000, clamped to [100, 60000]. */
  timeoutMs?: number;
}

/**
 * Response body for POST /ai/wait-for-route-change (success case).
 */
export interface WaitForRouteChangeResponse {
  from: string;
  to: string;
  elapsedMs: number;
}

/**
 * Selector predicate for POST /ai/wait-for-element.
 *
 * All provided fields are ANDed. At least one field should be provided;
 * otherwise the first registered element is returned.
 */
export interface WaitForElementPredicate {
  /** Match by element id (exact). */
  id?: string;
  /** Match by label / accessible name (case-insensitive substring). */
  label?: string;
  /** Match by data-testid attribute (exact). */
  testId?: string;
  /** CSS selector — falls back to document.querySelector if element is not in registry. */
  selector?: string;
}

/**
 * Request body for POST /ai/wait-for-element.
 *
 * Polls the in-memory registry for an element matching `predicate`. When
 * `selector` is supplied, falls back to `document.querySelector` once per
 * poll so the wait also covers elements that aren't SDK-registered.
 */
export interface WaitForElementRequest {
  predicate: WaitForElementPredicate;
  /**
   * Additional requirement on the matched element.
   * - `"registered"` (default): element exists in the registry.
   * - `"visible"`: element exists AND is visible per snapshot rules.
   * - `"has-layout"`: element exists AND `layout.width > 0 && layout.height > 0`.
   */
  requirement?: 'registered' | 'visible' | 'has-layout';
  /** Poll interval in ms. Default 100, clamped to [50, 1000]. */
  pollMs?: number;
  /** Max wait in ms. Default 5000, clamped to [100, 60000]. */
  timeoutMs?: number;
}

/**
 * Response body for POST /ai/wait-for-element (success case).
 */
export interface WaitForElementSuccessResponse {
  element: {
    id: string;
    label?: string;
    type?: string;
    [key: string]: unknown;
  };
  elapsedMs: number;
}

/**
 * A single step in a Tier 3.2 control batch request.
 */
export type ControlBatchStep =
  | {
      type: 'action';
      /** ID of the element to act on */
      element_id: string;
      /** Action name (click, type, focus, …) */
      action: string;
      /** Optional action parameters */
      params?: Record<string, unknown>;
    }
  | {
      type: 'wait';
      /** Milliseconds to sleep */
      ms: number;
    }
  | {
      type: 'snapshot';
    };

/**
 * Request body for POST /control/batch (Tier 3.2)
 */
export interface ControlBatchRequest {
  actions: ControlBatchStep[];
  /** When true (default), stop executing on the first error */
  stop_on_error?: boolean;
}

/**
 * Per-step result in a Tier 3.2 batch response
 */
export interface ControlBatchStepResult {
  index: number;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Response body for POST /control/batch (Tier 3.2)
 */
export interface ControlBatchResponse {
  results: ControlBatchStepResult[];
  completed: number;
  total: number;
}

/**
 * Route definition
 */
export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: string; // Key in UIBridgeServerHandlers
  params?: string[]; // URL params to extract
  bodyRequired?: boolean;
}

/**
 * All UI Bridge routes
 */
export const UI_BRIDGE_ROUTES: RouteDefinition[] = [
  // Render log
  { method: 'GET', path: '/render-log', handler: 'getRenderLog' },
  { method: 'GET', path: '/control/render-log', handler: 'getRenderLog' }, // Alias under /control/
  { method: 'DELETE', path: '/render-log', handler: 'clearRenderLog' },
  { method: 'POST', path: '/render-log/snapshot', handler: 'captureSnapshot' },
  { method: 'GET', path: '/render-log/path', handler: 'getRenderLogPath' },

  // Control - Elements
  { method: 'GET', path: '/control/elements', handler: 'getElements' },
  // Discover the runner process's own webview windows (main + pop-outs) so
  // callers can resolve a `windowLabel` target. Runner-owned; promoted out of
  // the runner_only_baseline allow-list once the SDK declared it here (plan
  // 2026-06-07-multi-window-sdk-automation, Phase 2).
  { method: 'GET', path: '/control/runner-windows', handler: 'listWindows' },
  { method: 'GET', path: '/control/element/:id', handler: 'getElement', params: ['id'] },
  { method: 'GET', path: '/control/element/:id/state', handler: 'getElementState', params: ['id'] },
  {
    method: 'GET',
    path: '/control/element/:id/react-state',
    handler: 'getElementReactState',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/control/element/:id/action',
    handler: 'executeElementAction',
    params: ['id'],
    bodyRequired: true,
  },
  // Phase 2.1 (plan 2026-05-03) — assert an element predicate. Returns
  // 200 + passed:true on success, 422 + passed:false on timeout.
  {
    method: 'POST',
    path: '/control/element/:id/expect',
    handler: 'expectElement',
    params: ['id'],
    bodyRequired: true,
  },
  // Phase 4.1 (plan 2026-05-03) — spawn a real Chromium tab via
  // `@qontinui/ui-bridge-headless`. Gated behind `enableHeadlessSpawn`
  // / `ENABLE_HEADLESS_SPAWN=1`; returns 503 when disabled or the
  // optional peer dependency is absent.
  {
    method: 'POST',
    path: '/control/sdk/spawn-headless',
    handler: 'spawnHeadless',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/actions/batch',
    handler: 'executeBatchAction',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/elements/rank',
    handler: 'rankElements',
    bodyRequired: true,
  },

  // Control - Components
  { method: 'GET', path: '/control/components', handler: 'getComponents' },
  { method: 'GET', path: '/control/component/:id', handler: 'getComponent', params: ['id'] },
  {
    method: 'GET',
    path: '/control/component/:id/state',
    handler: 'getComponentState',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/control/component/:id/action/:actionId',
    handler: 'executeComponentAction',
    params: ['id', 'actionId'],
    bodyRequired: true,
  },

  // Find (formerly Discovery)
  { method: 'POST', path: '/control/find', handler: 'find' },
  { method: 'POST', path: '/control/discover', handler: 'discover' }, // @deprecated Use /control/find
  { method: 'GET', path: '/control/snapshot', handler: 'getControlSnapshot' },
  // Phase 1.3 (plan 2026-05-03) — flat digest synthesized from snapshot +
  // console-errors + idle-status. One call instead of five.
  { method: 'GET', path: '/control/state-summary', handler: 'getStateSummary' },

  // Page health diagnostics — runs the spatial-coverage / layout / text-
  // signal heuristics defined in `./page-health.ts`. Byte-equivalent output
  // shape to the runner's `/control/page-health` handler so the page-health
  // skill (.claude/skills/page-health/SKILL.md) sees identical payloads
  // regardless of transport. POST (matches runner) — body reserved for
  // future per-check toggles (currently ignored).
  { method: 'POST', path: '/control/page-health', handler: 'pageHealth' },

  // Occlusion sweep. POST so the filter knobs (`minRatio`,
  // `includeExpected`) ride in a body rather than a query string, matching
  // page-health's shape.
  { method: 'POST', path: '/control/visibility', handler: 'visibility' },

  // Workflows
  { method: 'GET', path: '/control/workflows', handler: 'getWorkflows' },
  { method: 'POST', path: '/control/workflow/:id/run', handler: 'runWorkflow', params: ['id'] },
  {
    method: 'GET',
    path: '/control/workflow/:runId/status',
    handler: 'getWorkflowStatus',
    params: ['runId'],
  },

  // Element event log
  {
    method: 'GET',
    path: '/debug/element-history/:id',
    handler: 'getElementHistory',
    params: ['id'],
  },

  // Debug
  { method: 'GET', path: '/debug/action-history', handler: 'getActionHistory' },
  // D3 Effect Calculus (Phase 2) — read-only recent predict-then-verify cycles.
  { method: 'GET', path: '/effects/recent', handler: 'getRecentEffects' },
  { method: 'GET', path: '/debug/metrics', handler: 'getMetrics' },
  { method: 'POST', path: '/debug/highlight/:id', handler: 'highlightElement', params: ['id'] },
  { method: 'GET', path: '/debug/element-tree', handler: 'getElementTree' },
  { method: 'GET', path: '/control/console-errors', handler: 'getConsoleErrors' },
  { method: 'POST', path: '/control/console-errors/clear', handler: 'clearConsoleErrors' },

  // AI-native endpoints
  { method: 'POST', path: '/ai/search', handler: 'aiSearch', bodyRequired: true },
  { method: 'POST', path: '/ai/find', handler: 'aiFind', bodyRequired: true },
  { method: 'POST', path: '/ai/execute', handler: 'aiExecute', bodyRequired: true },
  { method: 'POST', path: '/ai/assert', handler: 'aiAssert', bodyRequired: true },
  { method: 'POST', path: '/ai/assert/batch', handler: 'aiAssertBatch', bodyRequired: true },
  { method: 'GET', path: '/ai/snapshot', handler: 'getSemanticSnapshot' },
  { method: 'GET', path: '/ai/diff', handler: 'getSemanticDiff' },
  { method: 'GET', path: '/ai/summary', handler: 'getPageSummary' },
  { method: 'POST', path: '/ai/semantic-search', handler: 'aiSemanticSearch', bodyRequired: true },

  // Change tracking
  {
    method: 'POST',
    path: '/ai/execute-with-diff',
    handler: 'executeWithDiff',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/ai/wait-for-change',
    handler: 'waitForChange',
    bodyRequired: true,
  },
  { method: 'GET', path: '/ai/categorize-last-diff', handler: 'categorizeLastDiff' },
  { method: 'POST', path: '/ai/scoped-diff', handler: 'getScopedDiff', bodyRequired: true },
  {
    method: 'POST',
    path: '/ai/summarize-diff',
    handler: 'summarizeDiff',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/ai/structured-changes',
    handler: 'analyzeStructuredChanges',
    bodyRequired: true,
  },

  // Change buffer
  { method: 'POST', path: '/ai/change-buffer/enable', handler: 'enableChangeBuffer' },
  { method: 'POST', path: '/ai/change-buffer/disable', handler: 'disableChangeBuffer' },
  { method: 'POST', path: '/ai/change-buffer/drain', handler: 'drainChangeBuffer' },
  { method: 'GET', path: '/ai/change-buffer/size', handler: 'getChangeBufferSize' },

  // Snapshot bookmarks (static routes before parameterized).
  //
  // The list/save endpoints use the plural `/ai/bookmarks` while the
  // per-resource endpoints historically used the singular `/ai/bookmark/:name`.
  // The plural variants are aliased to the same handlers so callers reading
  // the canonical reference (which uses plural throughout) don't hit 404s
  // when paths drift in their head.
  { method: 'POST', path: '/ai/bookmarks', handler: 'saveBookmark', bodyRequired: true },
  { method: 'GET', path: '/ai/bookmarks', handler: 'listBookmarks' },
  { method: 'GET', path: '/ai/bookmark/:name', handler: 'getBookmark', params: ['name'] },
  { method: 'GET', path: '/ai/bookmarks/:name', handler: 'getBookmark', params: ['name'] },
  {
    method: 'DELETE',
    path: '/ai/bookmark/:name',
    handler: 'deleteBookmark',
    params: ['name'],
  },
  {
    method: 'DELETE',
    path: '/ai/bookmarks/:name',
    handler: 'deleteBookmark',
    params: ['name'],
  },
  {
    method: 'GET',
    path: '/ai/bookmark/:name/diff',
    handler: 'diffFromBookmark',
    params: ['name'],
  },
  {
    method: 'GET',
    path: '/ai/bookmarks/:name/diff',
    handler: 'diffFromBookmark',
    params: ['name'],
  },

  // State management (static routes before parameterized)
  { method: 'GET', path: '/control/states', handler: 'getStates' },
  { method: 'GET', path: '/control/states/active', handler: 'getActiveStates' },
  { method: 'GET', path: '/control/states/snapshot', handler: 'getStateSnapshot' },
  { method: 'POST', path: '/control/states/find-path', handler: 'findPath', bodyRequired: true },
  { method: 'POST', path: '/control/states/navigate', handler: 'navigateTo', bodyRequired: true },
  { method: 'GET', path: '/control/state/:id', handler: 'getState', params: ['id'] },
  { method: 'POST', path: '/control/state/:id/activate', handler: 'activateState', params: ['id'] },
  {
    method: 'POST',
    path: '/control/state/:id/deactivate',
    handler: 'deactivateState',
    params: ['id'],
  },
  { method: 'GET', path: '/control/state-groups', handler: 'getStateGroups' },
  {
    method: 'POST',
    path: '/control/state-group/:id/activate',
    handler: 'activateStateGroup',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/control/state-group/:id/deactivate',
    handler: 'deactivateStateGroup',
    params: ['id'],
  },
  { method: 'GET', path: '/control/transitions', handler: 'getTransitions' },
  {
    method: 'GET',
    path: '/control/transition/:id/can-execute',
    handler: 'canExecuteTransition',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/control/transition/:id/execute',
    handler: 'executeTransition',
    params: ['id'],
  },

  // Intent endpoints
  { method: 'GET', path: '/ai/intents', handler: 'listIntents' },
  { method: 'POST', path: '/ai/intents/execute', handler: 'executeIntent', bodyRequired: true },
  { method: 'POST', path: '/ai/intents/find', handler: 'findIntent', bodyRequired: true },
  { method: 'POST', path: '/ai/intents/register', handler: 'registerIntent', bodyRequired: true },
  {
    method: 'POST',
    path: '/ai/intents/execute-from-query',
    handler: 'executeIntentFromQuery',
    bodyRequired: true,
  },

  // Recovery endpoints
  {
    method: 'POST',
    path: '/ai/recovery/attempt',
    handler: 'attemptRecovery',
    bodyRequired: true,
  },

  // Cross-app analysis endpoints
  { method: 'GET', path: '/ai/analyze/data', handler: 'analyzePageData' },
  { method: 'GET', path: '/ai/analyze/regions', handler: 'analyzePageRegions' },
  { method: 'GET', path: '/ai/analyze/structured-data', handler: 'analyzeStructuredData' },
  {
    method: 'POST',
    path: '/ai/analyze/cross-app-compare',
    handler: 'crossAppCompare',
    bodyRequired: true,
  },

  // Page navigation
  { method: 'POST', path: '/control/page/refresh', handler: 'pageRefresh' },
  { method: 'POST', path: '/control/page/navigate', handler: 'pageNavigate', bodyRequired: true },
  { method: 'POST', path: '/control/page/back', handler: 'pageGoBack' },
  { method: 'POST', path: '/control/page/forward', handler: 'pageGoForward' },
  { method: 'POST', path: '/control/page/evaluate', handler: 'pageEvaluate', bodyRequired: true },
  { method: 'POST', path: '/control/page/scroll', handler: 'pageScroll', bodyRequired: true },

  // Clipboard (relay to browser for gesture-based access)
  {
    method: 'POST',
    path: '/control/clipboard/write',
    handler: 'clipboardWrite',
    bodyRequired: true,
  },
  { method: 'GET', path: '/control/clipboard/read', handler: 'clipboardRead' },

  // Annotations (static routes before parameterized)
  { method: 'GET', path: '/annotations', handler: 'getAnnotations' },
  { method: 'GET', path: '/annotations/export', handler: 'exportAnnotations' },
  { method: 'GET', path: '/annotations/coverage', handler: 'getAnnotationCoverage' },
  { method: 'POST', path: '/annotations/import', handler: 'importAnnotations', bodyRequired: true },
  { method: 'GET', path: '/annotations/:id', handler: 'getAnnotation', params: ['id'] },
  {
    method: 'PUT',
    path: '/annotations/:id',
    handler: 'setAnnotation',
    params: ['id'],
    bodyRequired: true,
  },
  { method: 'DELETE', path: '/annotations/:id', handler: 'deleteAnnotation', params: ['id'] },

  // Performance diagnostics
  { method: 'GET', path: '/control/performance-entries', handler: 'getPerformanceEntries' },
  {
    method: 'POST',
    path: '/control/performance-entries/clear',
    handler: 'clearPerformanceEntries',
  },
  { method: 'GET', path: '/control/browser-events', handler: 'getBrowserEvents' },
  { method: 'GET', path: '/control/timeline', handler: 'getTimeline' },
  { method: 'GET', path: '/control/health', handler: 'getHealthReport' },
  { method: 'GET', path: '/control/network-chains', handler: 'getNetworkChains' },
  { method: 'POST', path: '/control/error-sessions/start', handler: 'startErrorSession' },
  { method: 'POST', path: '/control/error-sessions/end', handler: 'endErrorSession' },
  { method: 'GET', path: '/control/error-sessions', handler: 'getErrorSessions' },
  {
    method: 'POST',
    path: '/control/error-baselines/capture',
    handler: 'captureErrorBaseline',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/error-baselines/compare',
    handler: 'compareErrorBaseline',
    bodyRequired: true,
  },
  { method: 'GET', path: '/control/error-snapshots', handler: 'getErrorSnapshots' },
  { method: 'GET', path: '/control/error-report', handler: 'getErrorReport' },

  // Design review
  {
    method: 'GET',
    path: '/design/element/:id/styles',
    handler: 'getElementStyles',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/design/element/:id/state-styles',
    handler: 'getElementStateStyles',
    params: ['id'],
  },
  { method: 'POST', path: '/design/snapshot', handler: 'getDesignSnapshot' },
  {
    method: 'POST',
    path: '/design/responsive',
    handler: 'getResponsiveSnapshots',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/viewport-constraints',
    handler: 'setViewportConstraints',
    bodyRequired: true,
  },
  { method: 'POST', path: '/design/audit', handler: 'runDesignAudit' },
  {
    method: 'POST',
    path: '/design/style-guide/load',
    handler: 'loadStyleGuide',
    bodyRequired: true,
  },
  { method: 'GET', path: '/design/style-guide', handler: 'getStyleGuide' },
  { method: 'DELETE', path: '/design/style-guide', handler: 'clearStyleGuide' },

  // Quality evaluation
  { method: 'POST', path: '/design/evaluate', handler: 'evaluateQuality' },
  { method: 'GET', path: '/design/evaluate/contexts', handler: 'getQualityContexts' },
  { method: 'POST', path: '/design/evaluate/baseline', handler: 'saveBaseline' },
  { method: 'POST', path: '/design/evaluate/diff', handler: 'diffBaseline' },

  // Form state awareness
  { method: 'GET', path: '/control/forms', handler: 'getForms' },
  { method: 'POST', path: '/control/fill', handler: 'fillForm', bodyRequired: true },
  { method: 'POST', path: '/control/forms/snapshot', handler: 'snapshotForms' },
  {
    method: 'POST',
    path: '/control/forms/diff',
    handler: 'diffForms',
    bodyRequired: true,
  },

  // Clipboard
  { method: 'GET', path: '/control/clipboard', handler: 'getClipboard' },
  { method: 'POST', path: '/control/clipboard', handler: 'setClipboard', bodyRequired: true },

  // Network request monitoring (static routes before parameterized)
  { method: 'GET', path: '/control/network-requests', handler: 'getNetworkRequests' },
  {
    method: 'GET',
    path: '/control/network-requests/in-flight',
    handler: 'getNetworkRequestsInFlight',
  },
  {
    method: 'POST',
    path: '/control/network-requests/wait',
    handler: 'waitForNetworkRequest',
    bodyRequired: true,
  },
  {
    method: 'GET',
    path: '/control/network-request/:id',
    handler: 'getNetworkRequest',
    params: ['id'],
  },

  // Idle detection (static routes before parameterized).
  //
  // `/ai/idle-status` is a **byte-identical alias** of `/control/idle-status`
  // — same handler key, same payload. The `/control/*` form is canonical
  // (matches the `/control/*` family convention) and the `/ai/*` alias
  // exists so semantic-search / AI consumers can reach idle state under
  // the namespace they already query. Mirrors the runner's
  // `add_dual!(router, get, "idle-status", …)` registration at
  // `qontinui-runner/src-tauri/src/mcp/ui_bridge/errors.rs::routes`. See
  // `docs-site/docs/api/runner-features.md` for the canonicalisation rule.
  { method: 'GET', path: '/control/idle-status', handler: 'getIdleStatus' },
  { method: 'GET', path: '/ai/idle-status', handler: 'getIdleStatus' },
  { method: 'POST', path: '/control/wait-for-idle', handler: 'waitForIdle' },
  {
    method: 'POST',
    path: '/control/wait-for-targets',
    handler: 'waitForTargets',
    bodyRequired: true,
  },
  {
    method: 'GET',
    path: '/control/idle-status/:signal',
    handler: 'getIdleSignalStatus',
    params: ['signal'],
  },
  {
    method: 'POST',
    path: '/control/wait-for-idle/:signal',
    handler: 'waitForSignalIdle',
    params: ['signal'],
  },

  // Undo/redo awareness
  { method: 'GET', path: '/control/undo-state', handler: 'getUndoState' },
  { method: 'POST', path: '/control/undo', handler: 'executeUndo' },
  { method: 'POST', path: '/control/redo', handler: 'executeRedo' },

  // API discovery
  { method: 'GET', path: '/capabilities', handler: 'getCapabilities' },

  // Specs
  { method: 'GET', path: '/control/specs', handler: 'getSpecs' },

  // Heartbeat
  { method: 'POST', path: '/heartbeat', handler: 'receiveHeartbeat' },

  // Vision pipeline (Phase 2, plan 2026-05-13). Replaces the legacy
  // `/control/{screenshot,annotated-screenshot,element-screenshot,
  // capture-element-images,get-element-images,diagnose-stuck-screen}`
  // and `/ai/media/*` routes. The runner answers these directly; the
  // SDK exposes stubs that return `runner_required` so the route table
  // stays the single source of truth.
  { method: 'POST', path: '/vision/capture', handler: 'visionCapture' },
  { method: 'POST', path: '/vision/annotate', handler: 'visionAnnotate' },
  { method: 'POST', path: '/vision/diff', handler: 'visionDiff' },
  { method: 'POST', path: '/vision/raw', handler: 'visionRaw' },
  // Phase 4 — text-bearing outputs (OCR + VLM caption).
  { method: 'POST', path: '/vision/extract', handler: 'visionExtract' },
  { method: 'POST', path: '/vision/describe', handler: 'visionDescribe' },
  // Phase 6 — declarative analyzers + assertion DSL.
  { method: 'POST', path: '/vision/analyze', handler: 'visionAnalyze' },
  { method: 'POST', path: '/vision/assert', handler: 'visionAssert' },
  { method: 'POST', path: '/vision/baseline', handler: 'visionBaseline' },
  { method: 'GET', path: '/vision/baselines', handler: 'visionBaselinesList' },
  // Frontend → runner mutation signal (Phase 6).
  {
    method: 'POST',
    path: '/vision/mutation-occurred',
    handler: 'visionMutationOccurred',
  },
  {
    method: 'GET',
    path: '/vision/cache/:sha256',
    handler: 'visionCacheStream',
    params: ['sha256'],
  },
  { method: 'GET', path: '/vision/health', handler: 'visionHealth' },

  // Change observation (push-based)
  { method: 'GET', path: '/control/changes/since', handler: 'getChangesSince' },

  // ── Route aliases ──────────────────────────────────────────────────
  // These map commonly expected paths to existing handlers.

  // Design review aliases under /control/ (static before parameterized)
  { method: 'POST', path: '/control/design/snapshot', handler: 'getDesignSnapshot' },
  {
    method: 'POST',
    path: '/control/design/responsive',
    handler: 'getResponsiveSnapshots',
    bodyRequired: true,
  },
  { method: 'POST', path: '/control/design/audit', handler: 'runDesignAudit' },
  {
    method: 'GET',
    path: '/control/design/element/:id/styles',
    handler: 'getElementStyles',
    params: ['id'],
  },
  {
    method: 'POST',
    path: '/control/design/element/:id/state-styles',
    handler: 'getElementStateStyles',
    params: ['id'],
  },

  // Annotation aliases under /control/ (static before parameterized)
  { method: 'GET', path: '/control/annotations', handler: 'getAnnotations' },
  {
    method: 'POST',
    path: '/control/annotation/:id',
    handler: 'setAnnotation',
    params: ['id'],
    bodyRequired: true,
  },
  { method: 'GET', path: '/control/annotations/export', handler: 'exportAnnotations' },
  { method: 'GET', path: '/control/annotations/coverage', handler: 'getAnnotationCoverage' },
  {
    method: 'POST',
    path: '/control/annotations/import',
    handler: 'importAnnotations',
    bodyRequired: true,
  },
  { method: 'GET', path: '/control/annotation/:id', handler: 'getAnnotation', params: ['id'] },
  {
    method: 'PUT',
    path: '/control/annotation/:id',
    handler: 'setAnnotation',
    params: ['id'],
    bodyRequired: true,
  },
  {
    method: 'DELETE',
    path: '/control/annotation/:id',
    handler: 'deleteAnnotation',
    params: ['id'],
  },

  // History/metrics aliases under /control/
  { method: 'GET', path: '/control/action-history', handler: 'getActionHistory' },
  { method: 'GET', path: '/control/history', handler: 'getActionHistory' },
  { method: 'GET', path: '/control/metrics', handler: 'getMetrics' },
  { method: 'GET', path: '/control/interaction-metrics', handler: 'getMetrics' },
  {
    method: 'GET',
    path: '/control/element/:id/history',
    handler: 'getElementHistory',
    params: ['id'],
  },

  // Intent aliases under /control/ (static before parameterized)
  { method: 'GET', path: '/control/intents', handler: 'listIntents' },
  { method: 'POST', path: '/control/intents', handler: 'registerIntent', bodyRequired: true },
  {
    method: 'POST',
    path: '/control/intent/:name/execute',
    handler: 'executeIntent',
    params: ['name'],
    bodyRequired: true,
  },
  { method: 'DELETE', path: '/control/intent/:name', handler: 'deleteIntent', params: ['name'] },

  // AI assert-batch alias (hyphenated form)
  { method: 'POST', path: '/ai/assert-batch', handler: 'aiAssertBatch', bodyRequired: true },

  // App-agnostic convenience endpoints
  {
    method: 'POST',
    path: '/control/page/click-by-text',
    handler: 'clickByText',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/page/click-by-selector',
    handler: 'clickBySelector',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/page/type-into',
    handler: 'typeInto',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/page/read-value',
    handler: 'readValue',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/page/find-by-text',
    handler: 'findByText',
    bodyRequired: true,
  },
  {
    method: 'POST',
    path: '/control/page/send-keys',
    handler: 'sendKeysToPage',
    bodyRequired: true,
  },

  // Tier 3.1 — registry-based element condition polling
  {
    method: 'POST',
    path: '/ai/wait-for-element-condition',
    handler: 'waitForElementByCondition',
    bodyRequired: true,
  },

  // Testing-friendliness — route-change wait
  {
    method: 'POST',
    path: '/ai/wait-for-route-change',
    handler: 'waitForRouteChange',
  },
  {
    method: 'POST',
    path: '/ai/wait-for-element',
    handler: 'waitForElementRegistered',
    bodyRequired: true,
  },

  // Tier 3.2 — mixed action/wait/snapshot batch
  {
    method: 'POST',
    path: '/control/batch-execute',
    handler: 'controlBatch',
    bodyRequired: true,
  },

  // Diagnostics
  { method: 'GET', path: '/diagnostics', handler: 'getDiagnostics' },

  // Navigation adapter
  { method: 'GET', path: '/control/page/routes', handler: 'getRoutes' },
  {
    method: 'POST',
    path: '/control/page/navigate-to',
    handler: 'navigateByAdapter',
    bodyRequired: true,
  },
];

/**
 * Canonical app-agnostic interaction relay command actions.
 *
 * These are the cross-platform "convenience" interactions (click/type/read)
 * that the server relays verbatim over the SDK command channel (SSE for web,
 * WebSocket for the runner). The *action string* here is the single source of
 * truth shared by three sites:
 *
 *   1. `relay-handlers.ts` — `relayCommand('<action>', request)` queues it for
 *      the connected browser/native tab.
 *   2. `react/commandHandlers.ts` — the browser-side `executeCommand` switch
 *      MUST have a matching `case '<action>'`, otherwise the relay hits
 *      `default: throw new Error('Unknown command action')` and the runner
 *      silently falls back to its own Tauri webview (masking the failure).
 *   3. `native/react/commandHandlers.ts` — the React-Native relay parity case.
 *
 * The drift guard test (`relay-handlers.contract.test.ts`) asserts every entry
 * here resolves to a handler case so the browser executor can never again
 * queue an action it cannot execute. Add new app-agnostic interactions here
 * first, then wire all three sites.
 */
export const INTERACTION_RELAY_COMMAND_ACTIONS = [
  'clickByText',
  'clickBySelector',
  'typeInto',
  'readValue',
  'findByText',
  'sendKeysToPage',
] as const;

/**
 * Union of the canonical interaction relay command action strings.
 */
export type InteractionRelayCommandAction =
  (typeof INTERACTION_RELAY_COMMAND_ACTIONS)[number];

/**
 * WebSocket message types
 */
export type WebSocketMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'event'
  | 'snapshot'
  | 'action'
  | 'error';

/**
 * WebSocket message
 */
export interface WebSocketMessage<T = unknown> {
  type: WebSocketMessageType;
  channel?: string;
  data?: T;
  error?: string;
  timestamp: number;
}

/**
 * One element painting over another, as reported by `/control/visibility`.
 *
 * The relation is DIRECTED: `occludedBy` is on top, `element` is hidden.
 * That direction is the whole value — "these two boxes intersect" does not
 * tell you which one the user can actually read.
 */
export interface VisibilityOcclusionEntry {
  /** Registry id of the element being covered. */
  element: string;
  label?: string;
  /** The covered element's text, when it has any. */
  text?: string;
  /** Registry id (or DOM descriptor) of the element on top. */
  occludedBy: string;
  /** Fraction of the covered element's area that is hidden, 0..1. */
  ratio: number;
  /**
   * True when the occluder is a tracked modal/dropdown — expected, not a bug.
   *
   * Resolved against the snapshot's `modalStack` (the `modalDetector`
   * enricher). Only identity-bearing matches count — the occluder registered
   * under the modal's own id, or an unregistered occluder whose DOM id is the
   * modal's. Class and bare-tag descriptors are not identities and never
   * match, because an entry marked expected is dropped from the default
   * response and a loose rule would hide real regressions.
   *
   * Always `false` when the report's `expectedOverlayDetection` is
   * `unavailable`: no modal stack means nothing could be classified, which is
   * not the same as nothing being an expected overlay.
   */
  isExpectedOverlay: boolean;
  /** True when the covered element has text. Ranks above blank occlusions. */
  hidesText: boolean;
  /**
   * Which probe found it. Always `hit-test` from this package — the
   * geometric z-order model lives in ui-bridge-auto, which depends on this
   * one, so importing it here would make the two mutually dependent. The
   * field is kept as a union because a consumer merging results from both
   * sides needs to say which is which.
   */
  source: 'geometry' | 'hit-test';
}

export interface VisibilityReport {
  occlusions: VisibilityOcclusionEntry[];
  elementCount: number;
  minRatio: number;
  /** Echo of the request's `includeExpected` (default `false`). */
  includeExpected: boolean;
  /**
   * Whether expected-overlay classification could run at all.
   *
   * `modal-stack` — a `modalDetector` enricher is registered and its tracked
   * modals were used to classify every occluder.
   *
   * `unavailable` — no modal stack, so nothing was classified: every
   * `isExpectedOverlay` is `false` and `includeExpected` filtered nothing.
   * This is UNKNOWN, not "no expected overlays" — the same
   * absence-is-not-zero distinction `unknown_empty_registry` draws for an
   * empty registry.
   */
  expectedOverlayDetection: 'modal-stack' | 'unavailable';
  /**
   * How many occlusions were dropped as expected overlays.
   *
   * Always `0` when `includeExpected` is true or detection is `unavailable`.
   * Without it a filtered list is indistinguishable from a clean one.
   */
  expectedOverlaysFiltered: number;
  /**
   * `unknown_empty_registry` exists so an empty `occlusions` list from a
   * registry with no elements cannot be read as "nothing is covered".
   */
  verdict: 'clear' | 'occlusions_found' | 'unknown_empty_registry';
}
