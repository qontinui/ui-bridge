/**
 * Control Module Types
 *
 * Types for the control protocol and action execution.
 */

import type {
  ActionRequest,
  ActionResponse,
  ActionFailureDetails,
  ElementIdentifier,
  ElementState,
  SerializedComponentAction,
  WaitOptions,
  ContentMetadata,
  MediaMetadata,
  FillResult,
} from '../core/types';
import type { SnapshotPageContext } from '../navigation/types';
import type { SnapshotShortcutContext } from '../shortcuts/types';
import type { SnapshotModalContext } from '../modal/types';
import type { SnapshotToastContext } from '../toast/types';
import type { SnapshotRelationshipContext } from '../relationships/types';
import type { SnapshotDragDropContext } from '../drag-drop/types';
import type { SnapshotUndoContext } from '../undo/types';
import type { EffectVerification } from './effect-types';
// Phase 6 (plan 2026-09-04-effect-calculus-joins-the-component-action-registry).
import type {
  ComponentActionPredictRequest,
  ComponentActionPredictResponse,
} from './effect-predict';
import type { Scrubbed } from '../core/redaction';
import type { SnapshotSignature } from '../core/snapshot-signature';
// Phase 2 (plan 2026-08-20-ui-bridge-action-declaration-shape).
import type { ParamValidationMode } from '../core/param-schema';

/**
 * Extended action request with additional options
 */
export interface ControlActionRequest extends ActionRequest {
  /**
   * Target a runner pop-out window for this action; omit → the main window.
   *
   * Discover live window labels via `listWindows()` (the runner returns a
   * structured error naming the missing window if the label is unknown). The
   * runner resolves the target from the `?windowLabel=` **query parameter** on
   * `POST /control/element/:id/action` (`ActionQueryParams.window_label`), so a
   * caller issuing the HTTP request directly must append `?windowLabel=<label>`
   * to the action URL — this typed field documents the option and carries it for
   * transports that forward the request bag verbatim.
   */
  windowLabel?: string;
  /** Unique request ID for tracking */
  requestId?: string;
  /** Capture snapshot after action */
  captureAfter?: boolean;
  /** Retry options if action fails */
  retryOptions?: {
    maxRetries: number;
    retryDelay: number;
    retryOn?: ('timeout' | 'notFound' | 'disabled' | 'error')[];
  };
  /**
   * Wait for idle after the action completes.
   *
   * - `'idle'` — wait for composite idle (all signals)
   * - `string` — wait for a specific signal (e.g., `'network'`, `'dom'`)
   * - `string[]` — wait for multiple signals
   * - `{ indicator: string }` — wait for a CSS selector to disappear
   */
  waitAfter?: 'idle' | string | string[] | { indicator: string };
  /** Timeout for waitAfter in ms (default: 10000) */
  waitAfterTimeout?: number;
  /** Minimum stable time for waitAfter in ms (default: 300) */
  waitAfterMinStable?: number;
  /**
   * D3 effect-calculus: opt into predict-then-verify for THIS action, even when
   * the executor's global `enableEffectVerification` flag is off. When `true`
   * and a handler effect signature resolves for the `(action, element)`, the
   * response carries `effectVerification`. The executor-wide flag still forces
   * verification on for every action when set; this is the per-request override
   * that lets a caller (e.g. the runner's `effect_check` step) request a
   * verified outcome without flipping a server-wide switch.
   */
  verifyEffect?: boolean;
  /**
   * The `BridgeSnapshot.snapshotId` this call was reasoned from. Supplying it
   * opts THIS action into stale-snapshot rejection.
   *
   * **Omitting it preserves today's behaviour exactly.** That is the whole
   * design: a caller that does snapshot-then-several-actions — the normal
   * pattern — is unaffected, while a caller that wants a hard failure instead
   * of a blind click can ask for one. Rejecting unconditionally would break
   * every existing caller; leaving it purely advisory would change nothing,
   * which is the fate of the `_meta.stale` flag that already exists.
   *
   * When supplied and superseded, the action is refused **before it runs**
   * with `errorCode: 'UB-STALE-ELEMENT'` and
   * `failureDetails.staleReason === 'snapshot-superseded'`, and the recovery is
   * to re-snapshot. This is a different question from the pre-existing stale
   * arms: those all mean "this element is gone", discovered by failing to
   * resolve. This one fires on a target that resolves perfectly well and may
   * look identical — the world simply moved under the caller's reasoning.
   *
   * An id this SDK cannot parse is treated as UNKNOWN and does **not** reject;
   * neither does a registry that has never stamped a snapshot. Refusing on
   * "cannot judge" would fail closed on the wrong axis.
   *
   * Not a total guarantee: the fold's `generation` is derived from
   * millisecond-resolution `registeredAt` values, so a remount completed inside
   * one millisecond is invisible to it. See `core/snapshot-signature.ts`.
   */
  fromSnapshotId?: string;
  /**
   * Also return the ranked list of OTHER strategies that would have resolved
   * this element, on `elementResolution.alternates`.
   *
   * The winning strategy and its stability score come back on every action that
   * resolved something — that is O(1) and withholding it would defeat the
   * purpose, since a caller cannot know it acted on a weak match if it has to
   * ask in advance whether it is about to. The ranked alternates are the
   * expensive half (they force the whole chain to run instead of stopping at
   * the first hit), so they are opt-in.
   *
   * A **request** parameter, deliberately not a config setting: a config toggle
   * would make the same call return different shapes on different machines.
   */
  includeResolutionAlternates?: boolean;
}

/**
 * Extended action response with additional info
 */
export interface ControlActionResponse extends ActionResponse {
  /** Request ID if provided */
  requestId?: string;
  /** Snapshot captured after action */
  snapshot?: unknown;
  /** Number of retries attempted */
  retryCount?: number;
  /** Wait duration before action */
  waitDurationMs?: number;
  /** Time spent waiting for idle after action (ms) */
  idleWaitMs?: number;
  /** DOM changes caused by the action (populated when captureAfter: true) */
  changes?: ActionChanges;
}

/**
 * Component action request
 */
export interface ComponentActionRequest {
  /** Action ID to execute */
  action: string;
  /** Action parameters */
  params?: Record<string, unknown>;
  /** Unique request ID */
  requestId?: string;
  /**
   * Abandon the action if it has not produced a result within this many
   * milliseconds (plan `2026-08-20-ui-bridge-action-declaration-shape`,
   * Phase 3). Omitted = no timeout.
   *
   * This is the **wire-reachable** half of cancellation: an `AbortSignal`
   * cannot be JSON-serialized, so an HTTP or WebSocket caller has no other way
   * to call off a hung handler. In-process callers should prefer the
   * `{ signal }` option bag on `executeComponentAction`, which composes with
   * this one — whichever fires first wins.
   *
   * The abandonment does not depend on the handler observing its signal; the
   * executor races the handler promise. On abandonment the response is
   * `success: false` with `failureDetails.errorCode === 'UB-ACTION-TIMEOUT'`
   * and `failureDetails.cancelReason === 'timeout'`. (The `{ signal }` arm
   * reports `'UB-ACTION-FAILED'` instead — caller cancellation has no
   * dedicated code, a timeout does.)
   *
   * **Validated and clamped at the executor** — the one place every transport
   * funnels through, so no wire caller reaches a timer unchecked. `0` abandons
   * on the next tick; a negative, `NaN`, infinite or non-numeric value is
   * REFUSED with `UB-VALIDATION-ERROR` (silently ignoring it would leave the
   * action uncancellable, and coercing it to `0` would abandon every call);
   * anything above 24h is clamped, because past 2^31-1 `setTimeout` wraps
   * negative and fires immediately. See `core/abortable.ts`
   * `normalizeActionTimeoutMs`.
   */
  timeoutMs?: number;
  /**
   * D3 effect-calculus: control predict-then-verify for THIS component action
   * (Phase 5 of plan
   * `2026-09-04-effect-calculus-joins-the-component-action-registry`).
   *
   * The component path uses the **same** executor-wide switch as the element
   * path — `enableEffectVerification` / `setEffectVerificationEnabled` — so
   * the two surfaces can never disagree about whether verification is on. This
   * is the per-request override on top of it, and it is symmetric:
   *
   *   - `true`  — verify this call even with the executor-wide flag off, the
   *     same meaning `ControlActionRequest.verifyEffect` has on the element
   *     path.
   *   - `false` — do NOT verify this call, even though something else would
   *     have. This arm exists only on the component path, because only there
   *     can an author's declared `ComponentAction.signature` turn verification
   *     on by itself; a declaration is an author's default, and a caller that
   *     needs the two extra snapshots back has to be able to say no.
   *   - omitted — the executor-wide flag, or the action's own declared
   *     signature, decides.
   *
   * Verification runs only when a signature actually resolves. Nothing is
   * predicted for an action nobody described.
   */
  verifyEffect?: boolean;
}

/**
 * Per-invocation options for `ActionExecutor.executeComponentAction`.
 *
 * In-process only — nothing here survives JSON serialization, which is why
 * the wire-reachable timeout lives on {@link ComponentActionRequest} instead.
 */
export interface ComponentActionInvokeOptions {
  /**
   * Cancellation signal owned by the caller. Aborting it abandons the
   * invocation whether or not the handler observes the signal it is given.
   */
  signal?: AbortSignal;
  /**
   * What to do when `params` violate the action's declared `paramSchema`
   * (plan `2026-08-20-ui-bridge-action-declaration-shape`, Phase 2).
   *
   * Omitted = whatever `getDefaultParamValidationMode()` currently returns,
   * which starts at `DEFAULT_PARAM_VALIDATION_MODE` (`'warn'`) and is armed
   * process-wide by `setDefaultParamValidationMode()`. Deliberately NOT on
   * {@link ComponentActionRequest}: enforcement is a deployment's policy, not
   * something the caller being validated gets to switch off over the wire.
   *
   * On `'enforce'` the response is `success: false` with
   * `failureDetails.errorCode === 'UB-ACTION-REJECTED'` and
   * `failureDetails.invalidParams` naming each offending param.
   */
  paramValidation?: ParamValidationMode;
}

/**
 * Component action response
 */
export interface ComponentActionResponse {
  /** Whether the action succeeded */
  success: boolean;
  /** Result from the action */
  result?: unknown;
  /** Error message if failed (human-readable, dual-audience — plan goal #3) */
  error?: string;
  /**
   * Structured failure details. Populated on every `success: false` path
   * (plan Phase 1 — required on failure; optional at the type level only
   * because successful responses omit it). `errorCode` is a canonical
   * `UiBridgeErrorCode`; `suggestedActions` is `RecoverySuggestion[]` (D6).
   */
  failureDetails?: ActionFailureDetails;
  /** Stack trace if failed */
  stack?: string;
  /**
   * D3 effect-calculus verification: predicted-vs-observed outcome for this
   * action (present only when a signature resolved).
   *
   * The component twin of `ActionResponse.effectVerification`, added by Phase 5
   * of plan `2026-09-04-effect-calculus-joins-the-component-action-registry`.
   * Before it, the response type had no verification field at all, so the whole
   * component surface was outside the calculus no matter what an author
   * declared.
   */
  effectVerification?: EffectVerification;
  /** Duration of the action */
  durationMs: number;
  /** Timestamp when completed */
  timestamp: number;
  /** Request ID if provided */
  requestId?: string;
}

/**
 * Workflow run request
 */
export interface WorkflowRunRequest {
  /** Parameters for the workflow */
  params?: Record<string, unknown>;
  /** Request ID for tracking */
  requestId?: string;
  /** Start from a specific step */
  startStep?: string;
  /** Stop at a specific step */
  stopStep?: string;
  /** Step timeout */
  stepTimeout?: number;
  /** Total workflow timeout */
  workflowTimeout?: number;
}

/**
 * Workflow step result
 */
export interface WorkflowStepResult {
  /** Step ID */
  stepId: string;
  /** Step type */
  stepType: string;
  /** Whether the step succeeded */
  success: boolean;
  /** Step result */
  result?: unknown;
  /** Error if failed (human-readable, dual-audience — plan goal #3) */
  error?: string;
  /**
   * Structured failure details. Populated on every `success: false` path
   * (plan Phase 1 — required on failure; optional at the type level only
   * because successful steps omit it). `errorCode` is a canonical
   * `UiBridgeErrorCode`; `suggestedActions` is `RecoverySuggestion[]` (D6).
   */
  failureDetails?: ActionFailureDetails;
  /**
   * D3 per-step effect verification, threaded from the step's underlying action
   * response (`ControlActionResponse.effectVerification`). Present only when the
   * executor has effect verification enabled AND the step's action resolved a
   * signature. Read-only passthrough — the workflow engine never computes it.
   */
  effectVerification?: EffectVerification;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp when completed */
  timestamp: number;
}

/**
 * Workflow run status
 */
export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Workflow run response
 */
export interface WorkflowRunResponse {
  /** Workflow ID */
  workflowId: string;
  /** Run ID for tracking */
  runId: string;
  /** Current status */
  status: WorkflowRunStatus;
  /** Step results */
  steps: WorkflowStepResult[];
  /** Current step index */
  currentStep?: number;
  /** Total steps */
  totalSteps: number;
  /** Overall success */
  success?: boolean;
  /** Error message if failed */
  error?: string;
  /** Start timestamp */
  startedAt: number;
  /** End timestamp */
  completedAt?: number;
  /** Total duration */
  durationMs?: number;
  /**
   * D3 workflow-level effect verification: composed-prediction vs end-to-end
   * observed delta. Present only when effect composition is enabled AND at
   * least one step had a signature.
   * Catches "every step Confirmed individually but the workflow as a whole
   * drifted".
   */
  compositionVerification?: EffectVerification;
}

/**
 * Element info for discovery
 */
export interface DiscoveredElement {
  /** Element ID */
  id: string;
  /** Element type */
  type: string;
  /** Human-readable label. §4.6 CONTENT-bearing — `Scrubbed<string>`. */
  label?: Scrubbed<string>;
  /** Tag name */
  tagName: string;
  /** Role attribute */
  role?: string;
  /** Accessible name. §4.6 CONTENT-bearing — `Scrubbed<string>`. */
  accessibleName?: Scrubbed<string>;
  /** Available actions */
  actions: string[];
  /** Current state */
  state: ElementState;
  /** Whether registered with UI Bridge */
  registered: boolean;
  /**
   * Unix-epoch ms timestamp of the element's **registration** — i.e. which
   * mount it belongs to.
   *
   * This is the only field in a find/discover payload that can make a
   * *same-shape remount* visible. The registry deliberately preserves element
   * ids across a remount (`preserveIdAcrossRemount`), and a component
   * destroyed and rebuilt in the same state renders identical text — so
   * without this, a consumer folding the payload (the runner's
   * `SnapshotSignature.generation`, or `core/snapshot-signature.ts`) folds ids
   * alone and reports "nothing changed" for a click that tore the whole
   * subtree down. See `computeMountFold`.
   *
   * **Absent for elements this SDK has not registered** — a DOM-scanned node
   * has no registration time, and synthesizing "now" would move the generation
   * fold on every single call, turning a blind detector into a lying one. An
   * absent value contributes no bytes to the fold, by the fold's own spec.
   */
  registeredAt?: number;
  /** Whether this is an interactive element, static content, or media */
  category?: 'interactive' | 'content' | 'media';
  /**
   * High-level element kind. `"content"` for plain semantic content
   * (cards/badges/pills) tagged with `data-ui-bridge-content`;
   * `"interactive"` otherwise. Mirrors `category`.
   */
  kind?: 'interactive' | 'content';
  /** Normalized text content for data-ui-bridge-content elements. §4.6 CONTENT-bearing — `Scrubbed<string>`. */
  content?: Scrubbed<string>;
  /** CSS className attribute */
  className?: string;
  /** CSS class list as array */
  classes?: string[];
  /** Metadata for content elements */
  contentMetadata?: ContentMetadata;
  /** Metadata for media elements */
  mediaMetadata?: MediaMetadata;
}

/**
 * Find request options
 *
 * Used to find/discover controllable elements in the UI.
 */
export interface FindRequest {
  /** Root element selector to start from */
  root?: string;
  /** Only find interactive elements */
  interactiveOnly?: boolean;
  /** snake_case wire alias for {@link interactiveOnly}. */
  interactive_only?: boolean;
  /**
   * Include hidden elements.
   *
   * **Defaults to TRUE (breaking change in 0.22.0).** Hidden elements are
   * INCLUDED unless the caller explicitly passes `false` — so
   * `find/discover {interactive_only: false}` returns a superset of the
   * registry elements `/control/snapshot` returns. When `false`, elements
   * failing the live DOM visibility check (`offsetParent !== null ||
   * position === 'fixed'`; serialized `state.visible !== false` when no DOM
   * node is available) are filtered out. See `src/core/find-filter.ts`.
   */
  includeHidden?: boolean;
  /** snake_case wire alias for {@link includeHidden}. Same TRUE default. */
  include_hidden?: boolean;
  /** Maximum elements to return */
  limit?: number;
  /** Filter by element type */
  types?: string[];
  /** Filter by text content, label, or accessible name (substring match, case-insensitive) */
  text?: string;
  /** Filter by ARIA role */
  role?: string;
  /** Filter by element type (single type — alias for types with one value) */
  element_type?: string;
  /** Filter by label (substring match, case-insensitive) */
  label?: string;
  /** Filter by exact text content or label (case-insensitive, trimmed) */
  exact_text?: string;
  /** Filter by selector */
  selector?: string;
  /** Filter by data-testid attribute (exact match) */
  testId?: string;
  /** Include content (non-interactive) elements in results */
  includeContent?: boolean;
  /** Only return content elements */
  contentOnly?: boolean;
  /** Filter by content role */
  contentRole?: string;
  /** Skip waiting for DOM to settle (default: false — endpoints wait by default) */
  skipSettle?: boolean;
  /** Max ms to wait for DOM settle (default: 500). Non-fatal on timeout. */
  settleTimeout?: number;
  /** Include media elements in results */
  includeMedia?: boolean;
  /** Only return media elements */
  mediaOnly?: boolean;
  /** Filter media by type (e.g., 'image', 'video', 'svg') */
  mediaType?: string;
  /** Only return media elements that failed to load */
  brokenOnly?: boolean;
  /** Only return images missing alt text */
  missingAltOnly?: boolean;
  /** Regex pattern to match against source URL */
  srcPattern?: string;
  /** Filter oversized images by ratio threshold (default: 2.0) */
  oversizeThreshold?: number;
}

/**
 * F3 registration-diagnostics metadata — the registry's readiness signal.
 *
 * `everHadRegistrations` is a one-way latch: `false` means the page has not
 * hydrated/registered anything yet (caller should poll/wait), while `true`
 * with an empty element list means the page is genuinely empty. Surfaced on
 * snapshots AND find/discover responses so pollers get a typed not-ready
 * signal instead of a bare `elements: []`.
 */
export interface SnapshotRegistrationStats {
  /** Elements currently registered. */
  totalRegistered: number;
  /** One-way latch: true once ANY element has ever registered on this page. */
  everHadRegistrations: boolean;
  /** Per-route registration counts and ids. */
  byRoute: Record<string, { count: number; ids: string[] }>;
  /** Per-window breakdown (only present when a non-default window exists). */
  byRoutePerWindow?: Record<string, Record<string, { count: number; ids: string[] }>>;
}

/**
 * Find response
 *
 * Response from finding/discovering controllable elements.
 */
export interface FindResponse {
  /** Found elements */
  elements: DiscoveredElement[];
  /** Total elements found */
  total: number;
  /** Find duration */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
  /**
   * The identity fold over `elements` — the same `{ count, content,
   * generation, mountEvidence }` a `BridgeSnapshot` carries.
   *
   * A find/discover payload is what off-process drivers actually fold to
   * detect a click that changed nothing (the runner's
   * `mcp/ui_bridge/helpers.rs` re-derives exactly this shape in Rust from the
   * raw JSON). Emitting it here means such a driver compares two folds instead
   * of re-implementing one — and, more importantly, can read **`mountEvidence`
   * and know whether its own comparison is worth anything**. Zero means no
   * element in this payload carried a `registeredAt`, so the `generation` half
   * folded ids alone and a same-shape remount is invisible to it: *cannot
   * judge*, never *nothing changed*.
   *
   * **Optional, and its absence is UNKNOWN, not evidence.** A payload from an
   * SDK build predating this field carries no signature at all; a consumer
   * must treat that the same way it treats `mountEvidence: 0`, rather than
   * assuming the elements were unchanged.
   */
  signature?: SnapshotSignature;
  /**
   * Registry readiness signal (F3). `everHadRegistrations: false` + empty
   * `elements` ⇒ the page has not hydrated/registered yet — poll again;
   * `true` + empty ⇒ the page is genuinely empty. Optional because older
   * browser-side SDKs don't emit it.
   */
  registration?: SnapshotRegistrationStats;
}

/**
 * @deprecated Use FindRequest instead
 */
export type DiscoveryRequest = FindRequest;

/**
 * @deprecated Use FindResponse instead
 */
export type DiscoveryResponse = FindResponse;

/**
 * Viewport and page scroll context included in ControlSnapshot.
 */
export interface SnapshotViewportContext {
  /** Viewport (window) width in pixels */
  viewportWidth: number;
  /** Viewport (window) height in pixels */
  viewportHeight: number;
  /** Page horizontal scroll offset */
  scrollX: number;
  /** Page vertical scroll offset */
  scrollY: number;
  /** Full document width */
  documentWidth: number;
  /** Full document height */
  documentHeight: number;
  /** Whether the page can scroll further down */
  canScrollDown: boolean;
  /** Whether the page can scroll further right */
  canScrollRight: boolean;
}

/**
 * Error summary included in control snapshots.
 * Gives AI agents a quick health overview without a separate API call.
 */
export interface SnapshotErrorSummary {
  /** Number of errors in the last 30 seconds */
  errorCount: number;
  /** Number of warnings in the last 30 seconds */
  warningCount: number;
  /** Most recent critical error, if any */
  mostRecentError?: {
    message: string;
    timestamp: number;
    /** Extracted source file:line, if available */
    sourceLocation?: string;
  };
  /** Overall health assessment */
  health: 'healthy' | 'degraded' | 'broken';
  /** Framework error overlays currently visible on the page */
  errorOverlays?: import('../debug/captures/framework-overlays').DetectedErrorOverlay[];
}

/**
 * Fallback screenshot captured when the UI Bridge relay cannot reach the browser.
 * Provides visual context (via an external screenshot service) even when
 * the in-browser SDK is unresponsive, disconnected, or erroring.
 */
export interface FallbackScreenshot {
  /** Base64-encoded PNG screenshot */
  base64: string;
  /** Screenshot width in pixels */
  width: number;
  /** Screenshot height in pixels */
  height: number;
  /** Why the fallback was triggered */
  reason: 'timeout' | 'no_listeners' | 'empty_response';
}

/**
 * Control snapshot - full state of controllable UI
 */
export interface ControlSnapshot {
  /** Timestamp */
  timestamp: number;
  /** All registered elements */
  elements: Array<{
    id: string;
    type: string;
    /** Human-readable label. §4.6 CONTENT-bearing — `Scrubbed<string>`. */
    label?: Scrubbed<string>;
    actions: string[];
    /**
     * Custom (application-defined) action ids. Since 0.22.0 the executor
     * path emits the canonical shape, which keeps custom actions here
     * rather than merged into `actions` (the registry paths always did).
     */
    customActions?: string[];
    state: ElementState;
    /**
     * Identifier bundle for locating the element (xpath/selector always
     * present). Emitted by both the registry serializer and the DOM-fallback
     * materializer; optional here because pre-0.22.0 servers omitted it on
     * the fallback path.
     */
    identifier?: ElementIdentifier;
    /**
     * Unix-epoch ms timestamp when the element was registered (canonical
     * `UIBridgeElement` requires it). Synthesized as materialization time
     * for DOM-fallback scans.
     */
    registeredAt: number;
    /** Whether the element is currently mounted (true for DOM-fallback scans). */
    mounted: boolean;
    category?: 'interactive' | 'content' | 'media';
    /**
     * High-level element kind — `"interactive"` for clickable/typeable/etc.
     * elements, `"content"` for semantic plain-content elements (cards,
     * badges, pills) tagged with `data-ui-bridge-content`. Mirrors
     * `category`. Callers can pass `?interactiveOnly=true` on the snapshot
     * endpoint to filter `kind: "content"` entries out.
     */
    kind?: 'interactive' | 'content';
    /**
     * Normalized text content for semantic content elements tagged with
     * `data-ui-bridge-content` (whitespace-collapsed, trimmed). Lets tests
     * assert on card/badge/pill text without `/control/page/evaluate`.
     * §4.6 CONTENT-bearing — `Scrubbed<string>`.
     */
    content?: Scrubbed<string>;
    /**
     * Canonical ARIA role per W3C ARIA-in-HTML mapping. Resolves the
     * explicit `role=` attribute when set, otherwise the implicit role
     * for the tag (e.g. `<button>` → `"button"`). Source of truth for
     * `IrElementCriteria.role`.
     */
    role?: string;
    /**
     * Lowercased HTML tag name (e.g. `"button"`, `"input"`, `"a"`).
     * Source of truth for `IrElementCriteria.tag_name`.
     */
    tagName?: string;
    /**
     * Explicit `aria-label`, with `aria-labelledby` reference resolution
     * fallback. Distinct from `accessibleName`.
     * Source of truth for `IrElementCriteria.aria_label`.
     * §4.6 CONTENT-bearing — `Scrubbed<string>`.
     */
    ariaLabel?: Scrubbed<string>;
    /**
     * W3C accessible-name algorithm output. Source of truth for
     * `IrElementCriteria.accessible_name`.
     * §4.6 CONTENT-bearing — `Scrubbed<string>`.
     */
    accessibleName?: Scrubbed<string>;
    /**
     * Visible text content (innerText-equivalent), whitespace collapsed
     * and trimmed. Source of truth for `IrElementCriteria.text`.
     * §4.6 CONTENT-bearing — `Scrubbed<string>`.
     */
    text?: Scrubbed<string>;
    contentMetadata?: ContentMetadata;
    mediaMetadata?: MediaMetadata;
    /**
     * Live viewport-relative bounding box (CSS pixels) tracked by
     * `useUIElement`'s ResizeObserver + scroll/resize listeners. Present for
     * SDK-registered elements whose ref attached (or matched via the
     * `[data-ui-bridge-id]` fallback). Runners use this to dispatch clicks
     * via DOM coordinates and skip VLM pixel grounding.
     */
    bbox?: { x: number; y: number; width: number; height: number };
    /**
     * Live visibility signal (`bbox.width > 0 && bbox.height > 0`). Paired
     * with `bbox`. A cheap "rendered" hint — not a full hit-test like
     * `state.visible`.
     */
    visible?: boolean;
    /**
     * Semantic role / intent hint for disambiguation (e.g. `"primary"`,
     * `"destructive"`). Passthrough from `useUIElement` options — see
     * `RegisteredElement.variant` for common values. Lets NL queries like
     * "the destructive Confirm" rank candidates without VLM grounding.
     */
    variant?: string;
    /**
     * Positional hint for disambiguation (e.g. `"bottom-right"`).
     * Passthrough from `useUIElement` options.
     */
    position?: string;
    /**
     * Dominant color hint as seen by the user (CSS name / hex / design-token
     * alias). Passthrough from `useUIElement` options.
     */
    color?: string;
    /**
     * Hierarchical semantic path for ranking across duplicate labels
     * (e.g. `"settings-modal > theme-section > accent-color"`).
     * Passthrough from `useUIElement` options.
     */
    contextPath?: string;
  }>;
  /** All registered components */
  components: Array<{
    id: string;
    name: string;
    description?: string;
    /**
     * `ComponentActionInfo` objects, a superset of the canonical
     * `{ id, label?, description? }`. Was `string[]` of bare action ids before
     * 0.22.0.
     *
     * ⚠️ **Two projections share this type, and they do NOT emit the same
     * fields.** Which one you are holding depends on where it came from:
     *
     * | Producer | Emits |
     * |---|---|
     * | `getSnapshot()` / `createSnapshot()` → `core/registry.ts` `serializeRegisteredComponent` — i.e. THIS interface's own snapshot | `{ id, label?, description?, effect? }` — **no `paramSchema`, no `path`** |
     * | `GET /control/components` and `/control/component/:id`, whose handlers return `ControlSnapshot['components'][number]` and build it by spreading the whole registered action (`server/handlers.ts` `annotateComponentWithInvocationPaths`) | the above **plus** `paramSchema` (when declared) and a concrete `path` |
     *
     * That is why every field beyond `id` on {@link SerializedComponentAction}
     * is optional: one type has to serve both, and a required `paramSchema`
     * would not type-check against the snapshot projection.
     *
     * `handler` is dropped by both, and only because a function does not
     * survive `JSON.stringify`.
     *
     * (An earlier revision of this comment said the snapshot carried
     * `paramSchema`. It does not — read it off `/control/component/:id`, not
     * off `/control/snapshot`.)
     */
    actions: SerializedComponentAction[];
    /** URL template for invoking an action — substitute `{actionId}`. */
    actionInvocationPath?: string;
    elementIds?: string[];
    /** Unix-epoch ms registration timestamp (canonical UIBridgeComponent requires it). */
    registeredAt: number;
    /** Whether the component is currently mounted. */
    mounted: boolean;
    scope?: 'global' | 'route';
  }>;
  /** Available workflows */
  workflows: Array<{
    id: string;
    name: string;
    stepCount: number;
  }>;
  /** Active workflow runs */
  activeRuns: Array<{
    runId: string;
    workflowId: string;
    status: WorkflowRunStatus;
    currentStep: number;
    totalSteps: number;
  }>;
  /** Error/warning summary from browser event capture (populated by server handlers) */
  errorSummary?: SnapshotErrorSummary;
  /** Current page/route context (populated by server handlers via NavigationTracker) */
  page?: SnapshotPageContext;
  /** Keyboard shortcuts discovered in the application (populated by server handlers via ShortcutTracker) */
  shortcuts?: SnapshotShortcutContext;
  /** Modal/dialog stack — active modals/dialogs/drawers (populated by server handlers via ModalDetector) */
  modalStack?: SnapshotModalContext;
  /** Toast/notification snapshot — active and recently dismissed toasts (populated by server handlers via ToastCapture) */
  toasts?: SnapshotToastContext;
  /** Viewport dimensions and page scroll position */
  viewport?: SnapshotViewportContext;
  /** Element relationships — declared + auto-detected from ARIA/HTML (populated by server handlers via RelationshipTracker) */
  relationships?: SnapshotRelationshipContext;
  /** Drag sources and drop zones detected in the UI (populated by server handlers via DragDropDetector) */
  dragDrop?: SnapshotDragDropContext;
  /** Undo/redo availability and state (populated by server handlers via UndoTracker) */
  undoRedo?: SnapshotUndoContext;
  /** Fallback screenshot when the browser is unresponsive (populated by relay handlers) */
  fallbackScreenshot?: FallbackScreenshot;
  /**
   * Registry readiness signal (F3) — emitted by the browser-side
   * `getControlSnapshot` handler. See {@link SnapshotRegistrationStats}.
   */
  registration?: SnapshotRegistrationStats;
  /** Current page route (pathname) at snapshot time, when available. */
  route?: string;
}

/**
 * React state extracted from a DOM element's React fiber internals.
 * Used by the `/control/element/:id/react-state` endpoint.
 */
export interface ReactStateInfo {
  /** Props from __reactProps$ (functions replaced with "[Function]") */
  props: Record<string, unknown>;
  /** useState / useReducer values from the fiber memoizedState chain */
  fiberState: unknown[];
  /** Display name of the nearest React component */
  componentName?: string;
  /** Informational note (e.g. when no React internals found) */
  note?: string;
}

/**
 * Describes a single field-level change between pre- and post-action snapshots.
 */
export interface ElementFieldChange {
  /** Element ID */
  elementId: string;
  /** Field that changed (e.g. "value", "textContent", "visible") */
  field: string;
  /** Value before the action */
  before: unknown;
  /** Value after the action */
  after: unknown;
}

/**
 * Summary of DOM changes caused by an action, returned when `captureAfter: true`.
 */
export interface ActionChanges {
  /** Element IDs that appeared after the action */
  appeared: string[];
  /** Element IDs that disappeared after the action */
  disappeared: string[];
  /** Fields that changed on existing elements */
  stateChanged: ElementFieldChange[];
}

/**
 * Action types for keyboard input
 */
export interface KeyboardAction {
  /** Key to press */
  key: string;
  /** Key modifiers */
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
  /** Hold duration for key press */
  holdDuration?: number;
}

/**
 * SendKeys action — dispatches real KeyboardEvent sequences on an element.
 *
 * Unlike `type` (which sets input/textarea values via the DOM), `sendKeys`
 * fires keydown → keypress → keyup events.  This is required for elements
 * that consume keyboard events directly (e.g. xterm.js terminals, canvas
 * games, custom editors).
 */
export interface SendKeysAction {
  /** Sequence of key descriptors to dispatch */
  keys: KeyboardAction[];
  /** Delay between each key (ms, default 0) */
  delay?: number;
}

/**
 * Drag action parameters
 *
 * Drags the source element to a target element or position by dispatching
 * a sequence of mouse events: mousedown → mousemove × N → mouseup.
 * Optionally dispatches HTML5 drag events (dragstart, dragover, drop, dragend)
 * for applications that listen to those instead of mouse events.
 */
export interface DragAction {
  /** Target element to drag to (resolved via registry or DOM query) */
  target?: {
    /** UI Bridge element ID (checked in registry first) */
    elementId?: string;
    /** CSS selector */
    selector?: string;
  };
  /** Target coordinates (absolute client position, alternative to target element) */
  targetPosition?: { x: number; y: number };
  /** Source offset from element center in pixels (default: element center) */
  sourceOffset?: { x: number; y: number };
  /** Target offset from target element center in pixels (default: element center) */
  targetOffset?: { x: number; y: number };
  /** Number of intermediate mousemove steps (default: 10) */
  steps?: number;
  /** Delay in ms between mousedown and first move (default: 100) */
  holdDelay?: number;
  /** Delay in ms after mouseup (default: 50) */
  releaseDelay?: number;
  /** Also dispatch HTML5 drag events (dragstart/dragover/drop/dragend) alongside mouse events (default: false) */
  html5?: boolean;
}

/**
 * Action types for mouse input
 */
export interface MouseAction {
  /** Mouse button */
  button?: 'left' | 'right' | 'middle';
  /** Click count */
  clickCount?: number;
  /** Coordinates relative to element */
  position?: { x: number; y: number };
  /** Hold duration for click */
  holdDuration?: number;
}

/**
 * Action types for scroll input
 */
export interface ScrollAction {
  /** Scroll direction */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Scroll amount in pixels */
  amount?: number;
  /**
   * Vertical scroll delta in pixels, using wheel-event semantics:
   * positive = scroll DOWN, negative = scroll UP.
   * Takes precedence over direction+amount when provided.
   */
  deltaY?: number;
  /**
   * Horizontal scroll delta in pixels, using wheel-event semantics:
   * positive = scroll RIGHT, negative = scroll LEFT.
   * Takes precedence over direction+amount when provided.
   */
  deltaX?: number;
  /** Scroll to specific position */
  position?: { x: number; y: number };
  /** Scroll to element */
  toElement?: string;
  /** Smooth scroll */
  smooth?: boolean;
}

/**
 * Vertical/horizontal alignment for scrollIntoView (standard Web API type).
 */
export type ScrollLogicalPosition = 'start' | 'center' | 'end' | 'nearest';

/**
 * Action types for scrollIntoView — scrolls the target element into the visible area
 */
export interface ScrollIntoViewAction {
  /** Smooth scroll animation */
  smooth?: boolean;
  /** Vertical alignment: 'start' | 'center' | 'end' | 'nearest' (default: 'center') */
  block?: ScrollLogicalPosition;
  /** Horizontal alignment: 'start' | 'center' | 'end' | 'nearest' (default: 'nearest') */
  inline?: ScrollLogicalPosition;
}

/**
 * Type action for text input
 */
export interface TypeAction {
  /** Text to type */
  text: string;
  /** Clear existing value first */
  clear?: boolean;
  /** Delay between keystrokes (ms) */
  delay?: number;
  /** Trigger events (input, change) */
  triggerEvents?: boolean;
}

/**
 * Select action for dropdowns
 */
export interface SelectAction {
  /** Value(s) to select */
  value: string | string[];
  /** Select by label instead of value */
  byLabel?: boolean;
  /** For multi-select: add to selection */
  additive?: boolean;
}

/**
 * Autocomplete action for inputs with suggestion dropdowns.
 * Types text, waits for suggestions to appear, then selects a match.
 */
export interface AutocompleteAction {
  /** Text to type to trigger suggestions */
  searchText: string;
  /** Value to select from the suggestion list (matched by text content) */
  selectValue: string;
  /** Max time (ms) to wait for suggestions to appear (default: 2000) */
  suggestionTimeout?: number;
  /** Clear existing value first (default: true) */
  clear?: boolean;
}

/**
 * Wait condition result
 */
export interface WaitResult {
  /** Whether the condition was met */
  met: boolean;
  /** Time waited in milliseconds */
  waitedMs: number;
  /** Final state when resolved */
  state?: ElementState;
  /** Error if timed out */
  error?: string;
}

/**
 * Page navigation request
 */
export interface PageNavigateRequest {
  /** URL to navigate to */
  url: string;
  /**
   * Optional navigation mode (F1).
   *
   * - `"hard"` (default, back-compat): full webview reload via
   *   `window.location.href = url`. Resets all injected state.
   * - `"soft"`: SPA-friendly client-side navigation using
   *   `history.pushState` + synthetic `popstate` / `ui-bridge:navigate`
   *   events. Preserves `window.<custom-globals>` (fetch patches, spies,
   *   test tokens).
   *
   * Any other value is rejected with a 400.
   */
  mode?: 'hard' | 'soft';
  /**
   * Legacy boolean flag (pre-F1). `true` bypasses the registered navigation
   * handler and forces a full reload even when a React Router / Next.js
   * adapter is available. Kept for back-compat; prefer `mode` for new code.
   */
  hard?: boolean;
}

/**
 * Page navigation response
 */
export interface PageNavigationResponse {
  /** Whether the navigation succeeded */
  success: boolean;
  /** Current URL after navigation */
  url?: string;
  /**
   * Whether a full reload was used (`true` for `mode: "hard"`, `false` for
   * `"soft"`). Populated on every F1+ response so callers can audit which
   * path the SDK took. Legacy callers that only read this flag continue to
   * work.
   */
  hard?: boolean;
  /**
   * Echoes the mode actually executed: `"hard"` or `"soft"`. Populated on
   * every F1+ response.
   */
  mode?: 'hard' | 'soft';
  /** When true, the SDK used a registered navigate-handler (client-side). */
  clientSideNavigation?: boolean;
  /** Timestamp */
  timestamp: number;
}

/**
 * Fill form request - fill multiple form fields atomically
 */
export interface FillFormRequest {
  /** Map of element ID (or selector) to value */
  fields: Record<string, string | boolean | string[]>;
  /** Whether to trigger validation after filling (default: true) */
  triggerValidation?: boolean;
  /** Whether to clear existing values first (default: true) */
  clearFirst?: boolean;
}

// ============================================================================
// Batch Action Types
// ============================================================================

/**
 * A single step in a batch action sequence.
 */
export interface BatchActionStep {
  /** Target element ID (registry ID, CTR logical name, or CSS selector) */
  elementId: string;
  /** Action to execute */
  action: ControlActionRequest;
  /** Optional label for identifying this step in results */
  label?: string;
}

/**
 * Request to execute multiple actions in a single HTTP round-trip.
 */
export interface BatchActionRequest {
  /** Ordered sequence of actions to execute */
  steps: BatchActionStep[];
  /** Stop executing on the first failure (default: true) */
  stopOnFailure?: boolean;
  /** Delay in ms between steps (default: 0) */
  delayBetweenMs?: number;
}

/**
 * Result of a single step within a batch.
 */
export interface BatchActionStepResult {
  /** Index of this step in the batch */
  index: number;
  /** Label if provided */
  label?: string;
  /** The target element ID */
  elementId: string;
  /** The action response */
  response: ControlActionResponse;
}

/**
 * Result of a batch action execution.
 */
export interface BatchActionResponse {
  /** Whether all steps succeeded */
  success: boolean;
  /** Individual step results */
  results: BatchActionStepResult[];
  /** Number of steps that succeeded */
  succeededCount: number;
  /** Number of steps that failed */
  failedCount: number;
  /** Number of steps that were skipped (due to stopOnFailure) */
  skippedCount: number;
  /** Total duration across all steps */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// Server-Side Batch Types (matches Rust POST /ui-bridge/batch endpoint)
// ============================================================================

/**
 * A single operation in a server-side batch request.
 * Maps to the Rust `BatchOperation` struct.
 */
export interface ServerBatchOperation {
  /** Unique ID for this operation within the batch (for result correlation) */
  id: string;
  /** The operation type (e.g., "get_elements", "execute_action", "discover") */
  operation: string;
  /** Operation-specific parameters */
  params?: Record<string, unknown>;
}

/**
 * Options for the server-side batch() call.
 */
export interface ServerBatchOptions {
  /** If true, stop executing on first error (default: false) */
  stopOnError?: boolean;
}

/**
 * Result of a single operation within a server-side batch response.
 * Maps to the Rust `BatchOperationResult` struct.
 */
export interface ServerBatchOperationResult {
  /** Correlation ID matching the request operation */
  id: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Operation result data */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Structured error detail */
  errorDetail?: {
    code: string;
    message: string;
    recoveryHint?: string;
  };
  /** Duration of this operation in milliseconds */
  durationMs: number;
}

/**
 * Response from a server-side batch execution.
 * Maps to the Rust `BatchResponse` struct.
 */
export interface ServerBatchResponse {
  /** True only if all operations succeeded */
  success: boolean;
  /** Per-operation results in request order */
  results: ServerBatchOperationResult[];
  /** Total wall-clock time for the entire batch in milliseconds */
  totalDurationMs: number;
}

/**
 * A single step in a control batch request (simplified form for the
 * standalone `controlBatch()` helper).
 */
export interface ControlBatchStep {
  /** Target element ID */
  elementId: string;
  /** Action name (e.g., "click", "type", "select") */
  action: string;
  /** Action-specific parameters */
  params?: Record<string, unknown>;
}

/**
 * Per-step result returned by the `/control/batch` endpoint.
 */
export interface ControlBatchStepResult {
  /** Zero-based step index */
  step: number;
  /** Whether the step succeeded */
  success: boolean;
  /** Wall-clock time in ms */
  durationMs: number;
  /** Target element ID */
  elementId: string;
  /** Action executed */
  action: string;
  /** Raw response from the step */
  response: Record<string, unknown>;
}

/**
 * Response from the `/control/batch` endpoint.
 */
export interface ControlBatchResponse {
  /** True only if every executed step succeeded */
  success: boolean;
  /** Per-step results in request order */
  results: ControlBatchStepResult[];
  /** Total wall-clock time in ms */
  totalMs: number;
  /** Snapshot diff (element IDs added / removed) */
  snapshotDiff: Record<string, unknown> | null;
  /** Whether execution was stopped early due to an error */
  stoppedEarly: boolean;
}

/**
 * Action executor interface
 */
export interface ActionExecutor {
  /** Execute an action on an element */
  executeAction(elementId: string, action: ControlActionRequest): Promise<ControlActionResponse>;

  /**
   * Execute an action on a component.
   *
   * `options.signal` lets an in-process caller abandon the invocation;
   * `action.timeoutMs` is the wire-reachable equivalent (Phase 3).
   */
  executeComponentAction(
    componentId: string,
    action: ComponentActionRequest,
    options?: ComponentActionInvokeOptions
  ): Promise<ComponentActionResponse>;

  /**
   * Ask the effect twin what invoking a component action WOULD do, **without
   * invoking it** (Phase 6 of plan
   * `2026-09-04-effect-calculus-joins-the-component-action-registry`).
   *
   * Resolves the action's {@link EffectSignature}, captures a pre-snapshot and
   * evaluates `predicts(params, omegaPre)`. The handler is never called, no
   * settle window is opened, and nothing is written to the effect store.
   *
   * A `predicted: null` answer means UNCLASSIFIED — nobody described the
   * action — and never "harmless"; the response says so in `status` and in
   * `coverageCaveat` rather than leaving it to be inferred from an absent
   * field [policy: unknown-must-not-render-as-a-default].
   */
  predictComponentAction(
    componentId: string,
    actionId: string,
    request?: ComponentActionPredictRequest
  ): Promise<ComponentActionPredictResponse>;

  /** Wait for a condition */
  waitFor(elementId: string, options: WaitOptions): Promise<WaitResult>;

  /** Find controllable elements */
  find(options?: FindRequest): Promise<FindResponse>;

  /**
   * @deprecated Use find() instead
   */
  discover(options?: FindRequest): Promise<FindResponse>;

  /** Get control snapshot */
  getSnapshot(): Promise<ControlSnapshot>;

  /** Fill multiple form fields atomically */
  fillForm(request: FillFormRequest): Promise<FillResult>;

  /** Execute multiple actions in a single batch, reducing IPC round-trips */
  executeBatch(request: BatchActionRequest): Promise<BatchActionResponse>;
}

/**
 * Workflow engine interface
 */
export interface WorkflowEngine {
  /** Run a workflow */
  run(workflowId: string, request?: WorkflowRunRequest): Promise<WorkflowRunResponse>;

  /** Get workflow run status */
  getRunStatus(runId: string): Promise<WorkflowRunResponse | null>;

  /** Cancel a running workflow */
  cancel(runId: string): Promise<boolean>;

  /** List active runs */
  listActiveRuns(): Promise<WorkflowRunResponse[]>;
}
