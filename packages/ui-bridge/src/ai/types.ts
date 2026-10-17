/**
 * AI Module Types
 *
 * Defines types for AI-native UI Bridge functionality including
 * search criteria, natural language actions, assertions, and semantic snapshots.
 */

import type {
  ElementState,
  ElementType,
  ContentMetadata,
  SerializedElementAction,
} from '../core/types';
import type { DiscoveredElement } from '../control/types';
import type { RecoverySuggestion, UiBridgeErrorCode } from '../diagnostics';
import type { Scrubbed } from '../core/redaction';
import type { Observation } from '../observation/observation';
import type { DetectedAnimation } from '../idle/detected-animation';

// Canonical recovery suggestion (D6). Re-exported here so existing
// `from './types'` import sites keep resolving; the single definition lives in
// the generated diagnostics catalog.
export type { RecoverySuggestion } from '../diagnostics';

// ============================================================================
// Search Types
// ============================================================================

/**
 * Criteria for searching elements using multiple strategies
 */
export interface SearchCriteria {
  /** Exact visible text match: "Start Extraction" */
  text?: string;
  /** Alias for text (used by spec assertions) */
  textContent?: string;
  /** Partial text match: "Start" */
  textContains?: string;
  /** Accessible name (aria-label, associated labels) */
  accessibleName?: string;
  /** ARIA role: "button", "input" */
  role?: string;
  /** Element type (more specific than role) */
  type?: ElementType;
  /** Spatial proximity: "near the URL input" */
  near?: string;
  /** Container context: "within the login form" */
  within?: string;
  /** Enable fuzzy matching (default: true) */
  fuzzy?: boolean;
  /** Fuzzy match confidence threshold 0-1 (default: 0.7) */
  fuzzyThreshold?: number;
  /** Element ID pattern (supports wildcards) */
  idPattern?: string;
  /** CSS selector */
  selector?: string;
  /** XPath expression */
  xpath?: string;
  /** Placeholder text (for inputs) */
  placeholder?: string;
  /** Title attribute */
  title?: string;
  /** Data attributes to match */
  dataAttributes?: Record<string, string>;
  /** Filter by content role */
  contentRole?: string;
  /** Include content (non-interactive) elements in search */
  includeContent?: boolean;
  /** Only search content elements */
  contentOnly?: boolean;
  /**
   * B2 — Strict literal-match mode.
   *
   * When `true`, the search engine returns ONLY elements that have a
   * case-insensitive exact match on one of the identifying signals
   * (id, labelText, ariaLabel, textContent, title, placeholder, value,
   * name) against `text` / `textContent` / `accessibleName`. No fuzzy
   * / alias fallback. Empty result set when no element matches exactly.
   *
   * Default `false` keeps the legacy fuzzy-first behaviour — the new
   * literal-text precedence pass below STILL applies when this flag is
   * unset (literal matches just outrank fuzzy candidates instead of
   * suppressing them).
   */
  strict?: boolean;
}

/**
 * Result from a search operation
 */
export interface SearchResult {
  /** The matched element */
  element: AIDiscoveredElement;
  /** Match confidence 0-1 */
  confidence: number;
  /** Reasons why this element matched */
  matchReasons: string[];
  /** Match scores by strategy */
  scores: {
    text?: number;
    accessibility?: number;
    role?: number;
    spatial?: number;
    fuzzy?: number;
  };
}

/**
 * Response from search operations
 */
export interface SearchResponse {
  /** All matching results sorted by confidence */
  results: SearchResult[];
  /** Best match (highest confidence above threshold) */
  bestMatch: SearchResult | null;
  /** Total elements scanned */
  scannedCount: number;
  /** Search duration in milliseconds */
  durationMs: number;
  /** Search criteria used */
  criteria: SearchCriteria;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// AI-Enhanced Element Types
// ============================================================================

/**
 * Element with AI-generated metadata and descriptions
 */
export interface AIDiscoveredElement extends DiscoveredElement {
  /** Human-readable description: "Blue submit button in the form". §4.6 CONTENT-bearing — `Scrubbed<string>` (mint via `scrubContentRequired`). */
  description: Scrubbed<string>;
  /** Auto-generated aliases for natural language matching. §4.6: DOM-derived, so a redacted element contributes none (mint via `scrubAliases`). */
  aliases: Scrubbed<string>[];
  /** Inferred purpose: "Submits the form" */
  purpose?: string;
  /** Parent context identifier */
  parentContext?: string;
  /** Suggested actions in natural language */
  suggestedActions: string[];
  /** Semantic type (more descriptive than ElementType) */
  semanticType?: string;
  /** Associated label text */
  labelText?: string;
  /** Placeholder text (for inputs) */
  placeholder?: string;
  /** Title attribute */
  title?: string;
  /** ARIA description */
  ariaDescription?: string;
  /** Whether this is an interactive element, static content, or media */
  category?: 'interactive' | 'content' | 'media';
  /** Metadata for content elements */
  contentMetadata?: ContentMetadata;
  /**
   * The element's custom (application-defined) actions, carrying the author's
   * `effect` safety class.
   *
   * **Added 2026-09-11** by plan
   * `2026-09-04-effect-calculus-joins-the-component-action-registry` Design
   * decision 4 step 3. Until then this projection dropped an element's custom
   * actions ENTIRELY — `convertElement` copied `element.actions` and never
   * looked at `element.customActions` — so the only way a custom action reached
   * a semantic snapshot at all was `qontinui-runner`'s background-observer
   * snapshot builder flattening the NAMES into `actions`, which both
   * misrepresented them as standard verbs and discarded everything but the name.
   * That flatten was the ninth emitter the plan names, and this field is the
   * channel it was missing.
   *
   * Undefaulted, like every other projection of this annotation: an
   * un-annotated action arrives with `effect` absent, which means UNCLASSIFIED,
   * not `'read'`.
   */
  customActions?: SerializedElementAction[];
}

/**
 * Response from AI find operations
 */
export interface AIFindResponse {
  /** All discovered elements with AI metadata */
  elements: AIDiscoveredElement[];
  /** LLM-friendly text summary of the page */
  summary: string;
  /** Detected forms with their fields */
  forms?: FormAnalysis[];
  /** Page context information */
  pageContext: PageContext;
  /** Find duration */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Page context information
 */
export interface PageContext {
  /** Current URL */
  url: string;
  /** Page title */
  title: string;
  /** Inferred page type */
  pageType?:
    | 'login'
    | 'dashboard'
    | 'form'
    | 'list'
    | 'detail'
    | 'search'
    | 'checkout'
    | 'settings'
    | 'unknown';
  /** Active modals/dialogs */
  activeModals: string[];
  /** Currently focused element */
  focusedElement?: string;
  /** Detected navigation elements */
  navigation?: string[];
  /**
   * Pathname, page name, section and breadcrumb are copied only from the
   * `pageContext` the CALLER passes to `SemanticSnapshotManager.createSnapshot`;
   * nothing fills them from the NavigationTracker or `usePageContext`. The
   * hook-fed values live on the control snapshot's `page` (`page.pageContext`).
   *
   * There is deliberately no route pattern here: the one route channel is the
   * control snapshot's `page.route` (`RouteInfo`), which carries
   * `patternSource`, so a consumer can drop a pattern the app did not assert
   * came from its router. A second, unasserted pattern field is how a concrete
   * path gets stored as a template.
   */
  pathname?: string;
  /** Semantic page name (caller-supplied; see above) */
  pageName?: string;
  /** Application section (caller-supplied; see above) */
  section?: string;
  /** Breadcrumb trail (caller-supplied; see above) */
  breadcrumb?: string[];
}

/**
 * Form analysis result
 */
export interface FormAnalysis {
  /** Form element ID */
  id: string;
  /** Form name attribute */
  name?: string;
  /** Detected form purpose */
  purpose?: string;
  /** Form fields */
  fields: FormFieldAnalysis[];
  /** Whether form is valid */
  isValid: boolean;
  /** Submit button ID */
  submitButton?: string;
  /** Cancel/reset button ID */
  cancelButton?: string;
}

/**
 * Form field analysis
 */
export interface FormFieldAnalysis {
  /** Field element ID */
  id: string;
  /** Field label */
  label: string;
  /** Input type */
  type: string;
  /** Current value */
  value: string;
  /** Whether field is valid */
  valid: boolean;
  /** Validation error message */
  error?: string;
  /** Whether field is required */
  required: boolean;
  /** Placeholder text */
  placeholder?: string;
}

// ============================================================================
// Natural Language Action Types
// ============================================================================

/**
 * Natural language action request
 */
export interface NLActionRequest {
  /** Natural language instruction: "click the Start Extraction button" */
  instruction: string;
  /** Optional context to help disambiguate */
  context?: string;
  /** Timeout for the operation */
  timeout?: number;
  /** Confidence threshold for element matching */
  confidenceThreshold?: number;
}

/**
 * Parsed action from natural language
 */
export interface ParsedAction {
  /** Action type */
  action:
    | 'click'
    | 'type'
    | 'select'
    | 'check'
    | 'uncheck'
    | 'scroll'
    | 'wait'
    | 'assert'
    | 'hover'
    | 'focus'
    | 'clear'
    | 'doubleClick'
    | 'rightClick';
  /** Description of the target element */
  targetDescription: string;
  /** Value for type/select actions */
  value?: string;
  /** Key modifiers */
  modifiers?: ('shift' | 'ctrl' | 'alt' | 'meta')[];
  /** Scroll direction for scroll actions */
  scrollDirection?: 'up' | 'down' | 'left' | 'right';
  /** Wait condition for wait actions */
  waitCondition?: string;
  /** Assertion type for assert actions */
  assertionType?: AssertionType;
  /** Raw instruction that was parsed */
  rawInstruction: string;
  /** Parse confidence */
  parseConfidence: number;
}

/**
 * Partial match information for structured failures
 */
export interface PartialMatchInfo {
  /** Element ID */
  elementId: string;
  /** Match confidence 0-1 */
  confidence: number;
  /** Why this element was considered but not selected */
  reason: string;
  /** Element type */
  type: string;
  /** Element description/label */
  description?: string;
}

/**
 * Structured failure information for NL action responses
 */
export interface StructuredFailureInfo {
  /** Machine-readable error code */
  errorCode: string;
  /** Human-readable error message */
  message: string;
  /** Target element ID (if known) */
  elementId?: string;
  /** Selectors/strategies that were attempted */
  selectorsTried?: string[];
  /** Similar elements that were found but not used */
  partialMatches?: PartialMatchInfo[];
  /** Current state of the target element (if found) */
  elementState?: ElementState;
  /** Reference to visual context (screenshot path/id) */
  screenshotContext?: string;
  /** Suggested recovery actions */
  suggestedActions?: RecoverySuggestion[];
  /** Whether retry with same parameters might help */
  retryRecommended: boolean;
  /** Additional context data */
  context?: Record<string, unknown>;
  /** Duration before failure in milliseconds */
  durationMs?: number;
  /** Timeout value that was exceeded (for timeout errors) */
  timeoutMs?: number;
}

/**
 * Response from executing a natural language action
 */
export interface NLActionResponse {
  /** Whether the action succeeded */
  success: boolean;
  /** Human-readable description of what was done */
  executedAction: string;
  /** The element that was used */
  elementUsed: AIDiscoveredElement;
  /** Match confidence for the element */
  confidence: number;
  /** Element state after the action */
  elementState: ElementState;
  /** Action duration */
  durationMs: number;
  /** Timestamp */
  timestamp: number;

  // Failure information (legacy fields for backward compatibility)
  /** Error message if failed */
  error?: string;
  /** Error code */
  errorCode?: string;
  /** Suggestions for recovery */
  suggestions?: string[];
  /** Alternative elements that could have been used */
  alternatives?: SearchResult[];

  // Structured failure information
  /** Detailed failure information when success is false */
  failureInfo?: StructuredFailureInfo;
}

// ============================================================================
// Assertion Types
// ============================================================================

/**
 * Types of assertions that can be made about elements
 */
export type AssertionType =
  | 'visible'
  | 'hidden'
  | 'enabled'
  | 'disabled'
  | 'focused'
  | 'checked'
  | 'unchecked'
  | 'hasText'
  | 'containsText'
  | 'hasValue'
  | 'hasClass'
  | 'exists'
  | 'notExists'
  | 'count'
  | 'attribute'
  | 'cssProperty'
  | 'cssPropertyInSet'
  | 'cssPropertyRange'
  | 'tokenCompliance'
  | 'noOverlap'
  | 'minSpacing';

/**
 * Assertion request
 */
export interface AssertionRequest {
  /** Element target (ID or natural language description) */
  target: string | SearchCriteria;
  /** Type of assertion */
  type: AssertionType;
  /** Expected value (for hasText, hasValue, count, attribute, cssProperty) */
  expected?: unknown;
  /** Attribute name (for attribute assertions) */
  attributeName?: string;
  /** CSS property name (for cssProperty, cssPropertyInSet, cssPropertyRange, tokenCompliance) */
  propertyName?: string;
  /** Allowed values set (for cssPropertyInSet) */
  allowedValues?: string[];
  /** Range bounds (for cssPropertyRange) */
  range?: { min?: number; max?: number };
  /** Token path (for tokenCompliance, e.g. "colors.primary") */
  tokenPath?: string;
  /** Timeout for waiting (ms) */
  timeout?: number;
  /** Custom failure message */
  message?: string;
  /** Whether to use fuzzy matching for element search */
  fuzzy?: boolean;
  /** Second element target for spatial assertions (noOverlap, minSpacing) */
  relatedTarget?: string | SearchCriteria;
  /** Minimum gap in pixels between elements (for minSpacing) */
  minGap?: number;
}

/**
 * Assertion result
 */
export interface AssertionResult {
  /** Whether the assertion passed */
  passed: boolean;
  /** Element target that was checked */
  target: string;
  /** Human-readable description of the target */
  targetDescription: string;
  /** Expected value */
  expected: unknown;
  /** Actual value */
  actual: unknown;
  /** Failure reason if assertion failed (human-readable, dual-audience — plan goal #3) */
  failureReason?: string;
  /**
   * Stable machine-readable diagnostic code. Populated on every failure path
   * (`passed: false`) — optional at the type level only because passing
   * results omit it. One of the `UB-ASSERT-*` codes. Enforced present on
   * failure by the Phase 1 unit tests.
   */
  failureCode?: UiBridgeErrorCode;
  /** Suggestion for fixing the failure */
  suggestion?: string;
  /** Element state at time of assertion */
  elementState?: ElementState;
  /** Search metadata from element lookup (confidence, match reasons, candidate count) */
  searchDetails?: {
    confidence: number;
    matchReasons: string[];
    candidateCount: number;
  };
  /** Duration of the assertion */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Batch assertion request
 */
export interface BatchAssertionRequest {
  /** Assertions to execute */
  assertions: AssertionRequest[];
  /** Mode: 'all' requires all to pass, 'any' requires at least one */
  mode: 'all' | 'any';
  /** Stop on first failure */
  stopOnFailure?: boolean;
}

/**
 * Batch assertion result
 */
export interface BatchAssertionResult {
  /** Overall pass/fail */
  passed: boolean;
  /** Individual assertion results */
  results: AssertionResult[];
  /** Number of passed assertions */
  passedCount: number;
  /** Number of failed assertions */
  failedCount: number;
  /** Total duration */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// Semantic Snapshot Types
// ============================================================================

/**
 * Semantic snapshot of the current page state
 */
export interface SemanticSnapshot {
  /** Snapshot timestamp */
  timestamp: number;
  /** Snapshot ID for diffing */
  snapshotId: string;
  /** Page information */
  page: PageContext;
  /** All elements with AI metadata */
  elements: AIDiscoveredElement[];
  /** Form states */
  forms: FormState[];
  /** Active modals */
  activeModals: ModalState[];
  /** Currently focused element */
  focusedElement?: string;
  /** LLM-readable summary */
  summary: string;
  /** Element count by type */
  elementCounts: Record<string, number>;
  /** Detailed form state (included when `includeForms` option is set) */
  formsDetail?: FormsResponse;
  /** Network activity summary (when network monitoring is enabled) */
  networkActivity?: {
    inFlightCount: number;
    inFlightRequests: Array<{ url: string; method: string; durationMs: number }>;
    recentFailures: Array<{
      url: string;
      method: string;
      statusCode: number;
      durationMs: number;
      error?: string;
    }>;
    recentFailureCount: number;
  };
}

/**
 * Form state in semantic snapshot
 */
export interface FormState {
  /** Form ID */
  id: string;
  /** Form name */
  name?: string;
  /** Form purpose */
  purpose?: string;
  /** Field states */
  fields: FormFieldState[];
  /** Overall validity */
  isValid: boolean;
  /** Submit button */
  submitButton?: string;
  /** Whether form is dirty (has changes) */
  isDirty: boolean;
}

/**
 * Form field state
 */
export interface FormFieldState {
  /** Field ID */
  id: string;
  /** Field label. §4.6 CONTENT-bearing — `Scrubbed<string>` (mint via `scrubContentRequired`). */
  label: Scrubbed<string>;
  /** Input type */
  type: string;
  /** Current value. §4.6 VALUE-bearing — `Scrubbed<string>` (mint via a value-axis minter). */
  value: Scrubbed<string>;
  /** Validity */
  valid: boolean;
  /** Error message. §4.6 CONTENT-bearing — `Scrubbed<string>`. */
  error?: Scrubbed<string>;
  /** Required flag */
  required: boolean;
  /** Touched flag */
  touched: boolean;
  /** Placeholder text. §4.6 CONTENT-bearing — `Scrubbed<string>`. */
  placeholder?: Scrubbed<string>;
  /** Whether the field value differs from the default */
  isDirty?: boolean;
  /** Checked state for checkboxes/radios */
  checked?: boolean;
  /** Selected options for select elements */
  selectedOptions?: string[];
  /** HTML5 constraint attributes */
  constraints?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: string;
    max?: string;
    step?: string;
  };
  /** Source of the detected validation error */
  errorSource?: 'html5' | 'aria' | 'adjacent-element' | 'css-class';
}

/**
 * Response from the /control/forms endpoint
 */
export interface FormsResponse {
  /** All detected forms on the page */
  forms: FormState[];
  /** LLM-readable summary */
  summary: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Modal/dialog state
 */
export interface ModalState {
  /** Modal ID */
  id: string;
  /** Modal title */
  title?: string;
  /** Modal type */
  type: 'dialog' | 'alert' | 'confirm' | 'prompt' | 'drawer' | 'popup';
  /** Whether modal is blocking */
  blocking: boolean;
  /** Close button ID */
  closeButton?: string;
  /** Primary action button */
  primaryAction?: string;
  /** Secondary action button */
  secondaryAction?: string;
}

// ============================================================================
// Semantic Diff Types
// ============================================================================

/**
 * Semantic diff between two snapshots
 */
export interface SemanticDiff {
  /** LLM-readable summary of changes */
  summary: string;
  /** From snapshot ID */
  fromSnapshotId: string;
  /** To snapshot ID */
  toSnapshotId: string;
  /** Detailed changes */
  changes: {
    /** Elements that appeared */
    appeared: ElementChange[];
    /** Elements that disappeared */
    disappeared: ElementChange[];
    /** Elements that were modified */
    modified: ElementModification[];
  };
  /** Content-specific changes (text, metrics, statuses) */
  contentChanges?: ContentChanges;
  /** Probable trigger for the changes */
  probableTrigger?: string;
  /** Suggested next actions based on changes */
  suggestedActions?: string[];
  /** Page context changes */
  pageChanges?: {
    urlChanged: boolean;
    titleChanged: boolean;
    newUrl?: string;
    newTitle?: string;
  };
  /** Duration of diff computation */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Content-specific changes detected between snapshots
 */
export interface ContentChanges {
  /** General text content changes */
  textChanges: TextChange[];
  /** Metric/numeric value changes with delta analysis */
  metricChanges: MetricChange[];
  /** Status/badge changes with direction analysis */
  statusChanges: StatusChange[];
  /** Human-readable summary of content changes */
  summary: string;
}

/**
 * A text content change between snapshots
 */
export interface TextChange {
  /** Element ID */
  elementId: string;
  /** Content type (e.g., 'heading', 'paragraph', 'badge') */
  contentType: string;
  /** Previous text value */
  oldText: string;
  /** New text value */
  newText: string;
  /** Whether content was modified, added, or removed */
  changeType: 'modified' | 'added' | 'removed';
}

/**
 * A metric value change with numeric analysis
 */
export interface MetricChange {
  /** Element ID */
  elementId: string;
  /** Associated label or description */
  label: string;
  /** Previous value as string */
  oldValue: string;
  /** New value as string */
  newValue: string;
  /** Numeric delta if both values are parseable */
  numericDelta?: number;
  /** Percent change if both values are parseable */
  percentChange?: number;
  /** Whether the change is significant (>10% or sign flip) */
  significant: boolean;
}

/**
 * A status change with direction analysis
 */
export interface StatusChange {
  /** Element ID */
  elementId: string;
  /** Associated label or description */
  label: string;
  /** Previous status text */
  oldStatus: string;
  /** New status text */
  newStatus: string;
  /** Whether the change is positive, negative, or neutral */
  direction: 'improved' | 'degraded' | 'neutral';
}

/**
 * Element change (appeared/disappeared)
 */
export interface ElementChange {
  /** Element ID */
  elementId: string;
  /** Element description */
  description: string;
  /** Element type */
  type: string;
  /** Semantic type */
  semanticType?: string;
}

/**
 * Element modification
 */
export interface ElementModification {
  /** Element ID */
  elementId: string;
  /** Element description */
  description: string;
  /** Property that changed */
  property: string;
  /** Previous value */
  from: string;
  /** New value */
  to: string;
  /** Whether this is a significant change */
  significant: boolean;
}

// ============================================================================
// Element Change Diffing Types
// ============================================================================

/** Semantic category for a set of changes */
export type ChangeCategory =
  | 'navigation'
  | 'feedback'
  | 'data-update'
  | 'ui-state'
  | 'loading'
  | 'no-op';

/** Result of categorizing a diff */
export interface CategorizedDiff {
  /** Primary category */
  category: ChangeCategory;
  /** Confidence in the categorization (0-1) */
  confidence: number;
  /** Secondary categories if the diff spans multiple */
  secondaryCategories: ChangeCategory[];
  /** The underlying diff */
  diff: SemanticDiff;
}

/** Request for action-integrated diffing */
export interface ActionWithDiffRequest {
  /** Natural language instruction (mutually exclusive with elementAction) */
  instruction?: string;
  /** Direct element action (mutually exclusive with instruction) */
  elementAction?: {
    elementId: string;
    action: string;
    params?: Record<string, unknown>;
  };
  /** Timeout for idle settling after action (ms, default: 5000) */
  settleTimeout?: number;
  /** Min stable time for idle (ms, default: 300) */
  settleMinStable?: number;
  /** CSS selector to scope the diff to a container */
  scope?: string;
  /** Whether to categorize the diff (default: true) */
  categorize?: boolean;
  /**
   * Record the interaction timeline (default: `true`). The timeline is the
   * default; `false` is the explicit opt-out, which settles through the idle
   * detector alone and returns no `timeline`.
   */
  timeline?: boolean;
  /** Timeline polling interval during settling (ms, default: 100) */
  timelineInterval?: number;
  /**
   * Declared UI state ids (the registry's states, as `useActiveStates` reads
   * them) the caller expects the action to enter. Each is answered in
   * `timeline.summary.expectedStates`. Requires `withinMs` and a recorded
   * timeline (`timeline !== false`).
   */
  expectStates?: string[];
  /**
   * The window (ms from action start) an expected state must be entered
   * within. The caller's threshold — the SDK ships none. Recording continues
   * until every expected state has entered or this window has elapsed, even
   * past settle, so a negative is a measured one.
   */
  withinMs?: number;
  /** If set, include a budget-aware text summary capped at this many characters */
  summaryBudget?: number;
  /** If true, detect and analyze table/list structural changes */
  analyzeStructured?: boolean;
}

/**
 * Result from action-integrated diffing.
 *
 * Over the wire (`POST /ai/execute-with-diff`) the envelope's `success` IS
 * `actionSuccess`: a failed action answers `{ success: false, error, code,
 * data: ActionDiffResult }`, keeping the diff around the failure under `data`.
 */
export interface ActionDiffResult {
  /**
   * Whether the action succeeded — strictly: `true` only when the action
   * result carried a literal `success: true`. Absent or non-boolean is `false`.
   */
  actionSuccess: boolean;
  /** Action result details */
  actionResult: unknown;
  /** Snapshot before action */
  beforeSnapshot: SemanticSnapshot;
  /** Snapshot after action + settling */
  afterSnapshot: SemanticSnapshot;
  /** Computed diff */
  diff: SemanticDiff;
  /** Semantic category (if categorize was true) */
  categorized?: CategorizedDiff;
  /** Interaction timeline — present unless the request opted out with `timeline: false` */
  timeline?: ChangeTimeline;
  /** Whether idle settling timed out */
  settleTimedOut: boolean;
  /** Budget-aware text summary (if summaryBudget was set) */
  budgetSummary?: string;
  /** Structured change analysis (if analyzeStructured was true) */
  structuredChanges?: StructuredChangeAnalysis;
  /** Total duration (action + settle + diff) */
  durationMs: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * `aiExecute` with `withDiff: true`: the NL action's own response, with the
 * diff result merged in. `success` IS `actionSuccess` (strict), and a failed
 * action always carries an `error`.
 */
export type NLActionWithDiffResponse = NLActionResponse &
  Pick<
    ActionDiffResult,
    | 'actionSuccess'
    | 'diff'
    | 'categorized'
    | 'timeline'
    | 'settleTimedOut'
    | 'budgetSummary'
    | 'structuredChanges'
  >;

/**
 * The interaction timeline: action -> every observed event -> settled, each
 * with its offset from the action, plus a derived {@link TimelineSummary}.
 */
export interface ChangeTimeline {
  /** Timestamped events, ordered by `offsetMs` (ties keep arrival order). */
  events: TimelineEvent[];
  /** Total recording duration (ms) — settle, extended by any `withinMs` window. */
  settleMs: number;
  /** Whether the UI reached a stable state within `settleTimeout`. */
  settled: boolean;
  /** Values derived from `events`; every field an {@link Observation}. */
  summary: TimelineSummary;
}

/** Fields every {@link TimelineEvent} carries. */
export interface TimelineEventBase {
  /** Time offset from action start (ms) */
  offsetMs: number;
  /** Human-readable summary */
  summary: string;
}

/** The action itself — always the first event, at offset 0. */
export interface ActionTimelineEvent extends TimelineEventBase {
  type: 'action';
}

/** Registered elements appeared, disappeared or were modified between two polls. */
export interface ElementsTimelineEvent extends TimelineEventBase {
  type: 'elements-appeared' | 'elements-disappeared' | 'elements-modified';
  /** Element IDs involved */
  elementIds: string[];
  /** Number of elements affected */
  count: number;
}

/** The page URL changed. */
export interface PageChangedTimelineEvent extends TimelineEventBase {
  type: 'page-changed';
  /** The new URL, or `null` when the diff did not carry one. */
  url: string | null;
}

/** The UI was stable for `settleMinStable` (and the idle detector, when present, reported idle). */
export interface SettledTimelineEvent extends TimelineEventBase {
  type: 'settled';
}

/** One `layout-shift` PerformanceObserver entry. */
export interface LayoutShiftTimelineEvent extends TimelineEventBase {
  type: 'layout-shift';
  /** The shift score (Layout Instability API `value`). */
  value: number;
  /** The browser's `hadRecentInput` flag for this shift. */
  hadRecentInput: boolean;
  /** `ElementFingerprintData.hash` of each shifted element still in the document. */
  shiftedFingerprints: string[];
  /** Shift sources whose node was gone (or not an element) when the entry was read. */
  unattributedSourceCount: number;
}

/** A CSS animation or transition started. */
export interface AnimationStartedTimelineEvent extends TimelineEventBase {
  type: 'animation-started';
  animation: DetectedAnimation;
}

/** A CSS animation or transition ended or was cancelled. */
export interface AnimationEndedTimelineEvent extends TimelineEventBase {
  type: 'animation-ended';
  animation: DetectedAnimation;
  endReason: 'finished' | 'cancelled';
}

/** One `longtask` PerformanceObserver entry. */
export interface LongTaskTimelineEvent extends TimelineEventBase {
  type: 'long-task';
  /** Task duration (ms). */
  durationMs: number;
}

/** A tracked network request started. */
export interface NetworkRequestStartedTimelineEvent extends TimelineEventBase {
  type: 'network-request-started';
  /** The network tracker's request id, or `null` when the source supplies none. */
  requestId: string | null;
  method: string;
  url: string;
}

/** A tracked network request completed or failed. */
export interface NetworkRequestFinishedTimelineEvent extends TimelineEventBase {
  type: 'network-request-finished';
  requestId: string | null;
  method: string;
  url: string;
  /** HTTP status, or `null` when no response arrived. */
  statusCode: number | null;
  /** Request duration as the tracker measured it, or `null` without a response. */
  durationMs: number | null;
  /** The request errored or answered >= 400. */
  failed: boolean;
}

/** A declared UI state became active / inactive. */
export interface StateTimelineEvent extends TimelineEventBase {
  type: 'state-entered' | 'state-exited';
  stateId: string;
}

/** A single event in the interaction timeline. Discriminated on `type`. */
export type TimelineEvent =
  | ActionTimelineEvent
  | ElementsTimelineEvent
  | PageChangedTimelineEvent
  | SettledTimelineEvent
  | LayoutShiftTimelineEvent
  | AnimationStartedTimelineEvent
  | AnimationEndedTimelineEvent
  | LongTaskTimelineEvent
  | NetworkRequestStartedTimelineEvent
  | NetworkRequestFinishedTimelineEvent
  | StateTimelineEvent;

/** Every {@link TimelineEvent} `type`, in declaration order. */
export type TimelineEventType = TimelineEvent['type'];

/**
 * How an expected state fared inside the caller's `withinMs` window. Exactly
 * one key is present:
 * - `enteredAtMs` — the state became active at this offset (<= `withinMs`);
 * - `notEnteredWithinMs` — it did not become active within the window (the
 *   window is echoed, so a negative carries its own bound);
 * - `activeThroughoutWithinMs` — it was already active when the action ran and
 *   stayed active for the whole window, so it never "entered".
 */
export type ExpectedStateOutcome =
  | { enteredAtMs: number }
  | { notEnteredWithinMs: number }
  | { activeThroughoutWithinMs: number };

/** One `expectStates` entry and its answer. */
export interface ExpectedStateResult {
  stateId: string;
  outcome: Observation<ExpectedStateOutcome>;
}

/**
 * Values derived from a {@link ChangeTimeline}. EVERY field is an
 * {@link Observation}: `measured` with the value, `absent` when the producer
 * looked over the whole window and the thing did not occur, or `unknown` with
 * a closed `UnknownCode` when it could not look. `measured(0)` and `unknown`
 * are different shapes on the wire. No field is a verdict and no threshold is
 * applied — thresholds are the caller's.
 */
export interface TimelineSummary {
  /**
   * Offset of the first event that is neither `action` nor `settled`.
   * `unknown{no_event_before_timeout}` when nothing happened in the window.
   */
  firstResponseMs: Observation<number>;
  /**
   * Offset of the `settled` event. `unknown{no_event_before_timeout}` when the
   * UI did not settle within `settleTimeout`.
   */
  settleMs: Observation<number>;
  /**
   * Sum of `layout-shift` values in the window (shifts with recent input
   * included; each event carries `hadRecentInput`).
   * `unknown{performance_observer_unsupported}` where the entry type is missing.
   */
  layoutShiftTotal: Observation<number>;
  /** Number of `layout-shift` events. Same unknown rule as `layoutShiftTotal`. */
  layoutShiftCount: Observation<number>;
  /**
   * Offset of the LAST layout shift minus `firstResponseMs` — how long after
   * the UI first responded it was still moving. `absent` when no shift
   * occurred; unknown when the entry type is unsupported or nothing responded.
   */
  layoutShiftAfterFirstResponseMs: Observation<number>;
  /**
   * Animations/transitions running when recording ended: started in the
   * window without ending, plus those `document.getAnimations()` reports
   * running. Where `getAnimations` is missing the value is degraded and
   * `provenance.coverage.unmeasured` names the gap (animations started before
   * the action and still running cannot be seen).
   */
  animationsUnsettledAtEnd: Observation<DetectedAnimation[]>;
  /**
   * Sum of `long-task` durations (ms).
   * `unknown{performance_observer_unsupported}` where `longtask` is missing.
   */
  longTaskTotalMs: Observation<number>;
  /** One entry per requested `expectStates` id, in request order; `[]` when none were requested. */
  expectedStates: ExpectedStateResult[];
}

/** Predicate for waitForChange — declarative conditions for detecting specific changes */
export interface ChangePredicate {
  /** Wait for a specific element to appear (by ID or description matcher) */
  elementAppeared?: string | { text?: string; type?: string };
  /** Wait for a specific element to disappear (by ID) */
  elementDisappeared?: string;
  /** Wait for an element's property to change to a value */
  propertyChanged?: {
    elementId: string;
    property: string;
    expectedValue?: string;
  };
  /** Wait for text content matching a pattern anywhere on the page */
  textContains?: {
    elementId?: string;
    text: string;
  };
  /** Wait for a specific change category */
  category?: ChangeCategory;
  /** Wait for any significant change */
  anySignificantChange?: boolean;
  /** Wait until at least N elements match (appeared + existing matching type/text) */
  elementCount?: {
    /** Minimum count required */
    min: number;
    /** Element type to count */
    type?: string;
    /** Text to match (case-insensitive substring) */
    text?: string;
  };
  /** Wait for URL/route to change */
  urlChanged?: boolean;
  /** Wait for URL to contain a specific substring */
  urlContains?: string;
  /** Wait for form to become valid (no error elements visible) */
  formValid?: {
    /** Form element ID or container scope */
    formId?: string;
  };
  /** Wait for a status change with a specific direction */
  statusChanged?: {
    /** Element ID of the status indicator */
    elementId?: string;
    /** Required direction of change */
    direction?: 'improved' | 'degraded';
    /** Specific new status text (case-insensitive) */
    newStatus?: string;
  };
}

/** Options for waitForChange */
export interface WaitForChangeOptions {
  /** Maximum time to wait (ms, default: 10000) */
  timeout?: number;
  /** Polling interval (ms, default: 200) */
  interval?: number;
  /** CSS selector to scope the diff */
  scope?: string;
}

/** A buffered DOM mutation change entry */
export interface BufferedChange {
  /** Diff */
  diff: SemanticDiff;
  /** Semantic category */
  category: ChangeCategory;
  /** Timestamp when the change was recorded */
  recordedAt: number;
  /** Sequence number */
  sequence: number;
}

/** A buffered SPA route-change entry (P1.3). Distinguished from DOM
 * mutation entries by the `type: "route-change"` discriminator so callers
 * can branch without inspecting the shape. */
export interface BufferedRouteChange {
  /** Discriminator — always `"route-change"`. */
  type: 'route-change';
  /** Previous URL (window.location.href before the navigation). */
  from: string;
  /** New URL after the navigation. */
  to: string;
  /** Timestamp when the change was recorded — `at` matches the wire
   * format documented in the runner's HTTP contract. */
  at: number;
  /** Mirror of `at` so the field matches `BufferedChange.recordedAt` for
   * consumers that sort the interleaved drain by `recordedAt`. */
  recordedAt: number;
  /** Sequence number, monotonic across the buffer (DOM + route). */
  sequence: number;
}

/** Discriminated union of every entry kind that can land in the change
 * buffer. DOM mutations keep their existing flat shape (no `type` field);
 * route changes carry `type: "route-change"`. */
export type BufferEntry = BufferedChange | BufferedRouteChange;

// ============================================================================
// Tier 3.3: Extended change-buffer entry types
// ============================================================================

/** A raw DOM mutation captured by MutationObserver while the buffer is active. */
export interface DomMutationEntry {
  /** MutationRecord.type value. */
  type: 'childList' | 'attributes' | 'characterData';
  /** Best-effort CSS selector for the mutated element. */
  target_selector: string;
  /** Number of nodes added (childList only). */
  added?: number;
  /** Number of nodes removed (childList only). */
  removed?: number;
  /** Attribute that changed (attributes only). */
  attribute_name?: string;
  /** Wall-clock timestamp (Date.now()) when the mutation was observed. */
  timestamp: number;
}

/** A console error/warn/debug/log/info/unhandledrejection captured while the buffer is active. */
export interface ConsoleErrorEntry {
  /** 'error' | 'warn' | 'debug' | 'log' | 'info' | 'unhandledrejection' */
  level: 'error' | 'warn' | 'debug' | 'log' | 'info' | 'unhandledrejection';
  /** Log message text. */
  message: string;
  /** Stack trace if available. */
  stack?: string;
  /** Wall-clock timestamp. */
  timestamp: number;
}

/** A network request captured while the buffer is active. */
export interface BufferedNetworkEntry {
  url: string;
  method: string;
  /** HTTP status code if the request has completed. */
  status?: number;
  /** Round-trip duration in milliseconds if the request has completed. */
  duration_ms?: number;
  /** Timestamp when the request started. */
  timestamp: number;
}

/** A Tauri backend event captured while the buffer is active. Only populated
 * when the SDK is running inside a Tauri webview (detected via
 * `window.__TAURI_INTERNALS__`). In non-Tauri hosts this stays empty. */
export interface BufferedTauriEvent {
  /** Tauri event name (matches the name passed to `listen()`). */
  event: string;
  /** Event payload as delivered by `@tauri-apps/api/event`. */
  payload: unknown;
  /** Wall-clock timestamp (Date.now()) when the event was observed. */
  timestamp: number;
}

/** Response from draining the change buffer */
export interface ChangeBufferDrainResult {
  /** Registry-level diffs (DOM mutations tracked via the semantic snapshot diff engine)
   * and SPA route-change entries interleaved by `recordedAt`. Backward-compatible. */
  changes: BufferEntry[];
  /** Raw DOM mutations captured by MutationObserver since last drain. */
  dom: DomMutationEntry[];
  /** Console errors/warnings captured since last drain. */
  console_errors: ConsoleErrorEntry[];
  /** Network requests that started since last drain. */
  network_requests: BufferedNetworkEntry[];
  /** Tauri backend events captured since last drain. Empty when the host is
   * not a Tauri webview or no event names were registered via
   * `setTauriEventNames()`. */
  tauri_events: BufferedTauriEvent[];
  /** Total registry-level changes drained (backward compat) */
  count: number;
  /** Timestamp when the buffer was most recently enabled. */
  enabled_at: number;
  /** Time span covered by the registry changes */
  fromTimestamp: number;
  toTimestamp: number;
}

/** Named snapshot bookmark */
export interface SnapshotBookmark {
  /** Bookmark name */
  name: string;
  /** The snapshot */
  snapshot: SemanticSnapshot;
  /** When the bookmark was saved */
  savedAt: number;
}

/** Options for budget-aware diff summary generation */
export interface DiffSummaryOptions {
  /** Maximum character count for the summary */
  budget: number;
  /** Include element IDs in the summary (default: false) */
  includeIds?: boolean;
  /** Include the category in the summary header (default: true) */
  includeCategory?: boolean;
}

/** Result of structured change analysis (table/list-level diffing) */
export interface StructuredChangeAnalysis {
  /** Table-level changes detected */
  tableChanges: TableChangeAnalysis[];
  /** List-level changes detected */
  listChanges: ListChangeAnalysis[];
  /** Whether any structured data was detected */
  hasStructuredData: boolean;
}

/** Analysis of changes to a detected table */
export interface TableChangeAnalysis {
  /** Table label/identifier */
  label: string;
  /** Column headers */
  columns: string[];
  /** Rows that were added */
  addedRows: string[][];
  /** Rows that were removed */
  removedRows: string[][];
  /** Rows with cell value changes */
  modifiedRows: {
    rowIndex: number;
    changes: { column: string; from: string; to: string }[];
  }[];
  /** Summary of table changes */
  summary: string;
}

/** Analysis of changes to a detected list */
export interface ListChangeAnalysis {
  /** List label/identifier */
  label: string;
  /** Items that were added */
  addedItems: Record<string, string>[];
  /** Items that were removed */
  removedItems: Record<string, string>[];
  /** Summary of list changes */
  summary: string;
}

// ============================================================================
// Screen Analysis Types (GET /ai/analyze)
// ============================================================================

/**
 * Compact element representation — flat, minimal, ~11 fields vs AIDiscoveredElement's 20+.
 * Bounds as [x,y,w,h] tuple saves ~60% vs full rect object.
 * Text truncated to 200 chars.
 */
export interface CompactElement {
  id: string;
  type: string;
  label?: string;
  visible: boolean;
  enabled: boolean;
  text?: string;
  value?: string;
  actions: string[];
  semanticType?: string;
  /** Bounds as [x, y, width, height] tuple */
  bounds?: [number, number, number, number];
}

/**
 * Elements pre-grouped by category so agents can skip irrelevant sections.
 */
export interface GroupedElements {
  interactive: CompactElement[];
  content: CompactElement[];
  media: CompactElement[];
}

/**
 * Compact modal representation
 */
export interface CompactModal {
  id: string;
  title?: string;
  type: string;
  blocking: boolean;
  closeButton?: string;
  primaryAction?: string;
}

/**
 * Compact toast representation
 */
export interface CompactToast {
  id: string;
  message: string;
  level?: string;
  dismissible: boolean;
}

/**
 * Aggregated error information
 */
export interface AggregatedErrors {
  count: number;
  health: 'healthy' | 'degraded' | 'broken';
  validationErrors: string[];
  runtimeError?: string;
  hasErrorOverlay: boolean;
}

/**
 * Loading/in-flight state
 */
export interface LoadingState {
  isLoading: boolean;
  inFlightRequests: number;
  activeWorkflows: number;
}

/**
 * Comprehensive screen analysis — single response combining all actionable
 * information about the current screen.
 */
export interface ScreenAnalysis {
  /** Page info (url, title, type) */
  page: {
    url: string;
    title: string;
    type?: string;
  };
  /** Viewport dimensions and scroll state */
  viewport?: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    canScrollDown: boolean;
  };
  /** LLM-readable summary */
  summary: string;
  /** Elements grouped by category */
  elements: GroupedElements;
  /** Form states */
  forms: FormState[];
  /** Active modals */
  modals: CompactModal[];
  /** Aggregated errors */
  errors: AggregatedErrors;
  /** Active toasts */
  toasts: CompactToast[];
  /** Loading state */
  loading: LoadingState;
  /** Currently focused element ID */
  focusedElement?: string;
  /** Element counts by type */
  elementCounts: Record<string, number>;
  /** Snapshot timestamp */
  timestamp: number;
}

// ============================================================================
// Semantic Search Types
// ============================================================================

/**
 * Semantic search criteria using embeddings
 */
export interface SemanticSearchCriteria {
  /** Natural language query for semantic matching */
  query: string;
  /** Minimum similarity score (0-1, default: 0.5) */
  threshold?: number;
  /** Maximum results to return */
  limit?: number;
  /** Filter by element type */
  type?: string;
  /** Filter by ARIA role */
  role?: string;
  /** Combine with text-based search */
  combineWithText?: boolean;
}

/**
 * Semantic search result
 */
export interface SemanticSearchResult {
  /** The matched element */
  element: AIDiscoveredElement;
  /** Semantic similarity score (0-1) */
  similarity: number;
  /** Rank in results (1-indexed) */
  rank: number;
  /** Text that was used for embedding */
  embeddedText: string;
}

/**
 * Response from semantic search operations
 */
export interface SemanticSearchResponse {
  /** All matching results sorted by similarity */
  results: SemanticSearchResult[];
  /** Best match (highest similarity above threshold) */
  bestMatch: SemanticSearchResult | null;
  /** Total elements scanned */
  scannedCount: number;
  /** Search duration in milliseconds */
  durationMs: number;
  /** Query used */
  query: string;
  /** Embedding provider info */
  providerInfo?: {
    provider: string;
    model: string;
    dimension: number;
  };
  /** Timestamp */
  timestamp: number;
}

/**
 * Element with embedding data
 */
export interface ElementEmbedding {
  /** Element ID */
  elementId: string;
  /** Text used for embedding */
  text: string;
  /** Embedding vector (base64 encoded float32 array) */
  embedding?: string;
  /** Whether embedding is available */
  hasEmbedding: boolean;
}

// ============================================================================
// Error Context Types
// ============================================================================

/**
 * Rich error context for AI agents
 */
export interface AIErrorContext {
  /** Error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** What action was attempted */
  attemptedAction: string;
  /** Search criteria used (if applicable) */
  searchCriteria?: SearchCriteria;

  /** Information about what was found */
  searchResults: {
    /** Number of candidates found */
    candidatesFound: number;
    /** Nearest match if any */
    nearestMatch?: {
      element: AIDiscoveredElement;
      confidence: number;
      whyNotSelected: string;
    };
  };

  /** Page state at time of error */
  pageContext: {
    url: string;
    title: string;
    visibleElements: number;
    /** Possible blockers like modals */
    possibleBlockers: string[];
  };

  /** Recovery suggestions */
  suggestions: RecoverySuggestion[];

  /** Stack trace if available */
  stack?: string;
  /** Timestamp */
  timestamp: number;
}

// (Canonical `RecoverySuggestion` is defined in the generated diagnostics
// catalog and re-exported at the top of this file — D6.)

// ============================================================================
// Extended RegisteredElement Type
// ============================================================================

/**
 * Extended element registration options with AI metadata
 */
export interface AIElementRegistrationOptions {
  /** Alternative names for the element */
  aliases?: string[];
  /** Human-readable description */
  description?: string;
  /** Semantic type (more descriptive than ElementType) */
  semanticType?: string;
  /** Purpose of the element */
  purpose?: string;
  /** Whether to auto-generate aliases */
  autoGenerateAliases?: boolean;
}

// ============================================================================
// Intent Types
// ============================================================================

/**
 * Parameter definition for an intent
 */
export interface IntentParam {
  /** Parameter type (e.g., 'string', 'number', 'boolean') */
  type: string;
  /** Whether the parameter is required */
  required?: boolean;
  /** Description of the parameter */
  description?: string;
  /** Default value */
  default?: unknown;
}

/**
 * An intent represents a high-level user goal that can be executed
 */
export interface Intent {
  /** Unique intent identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the intent does */
  description: string;
  /** Tags for categorization and search */
  tags?: string[];
  /** Parameters the intent accepts */
  params?: Record<string, IntentParam>;
  /** Handler identifier */
  handler?: string;
}

/**
 * Response from intent search/find operations
 */
export interface IntentSearchResponse {
  /** Matched intents with confidence scores */
  intents: Array<{ intent: Intent; confidence: number }>;
}

/**
 * Result from executing an intent
 */
export interface IntentExecutionResult {
  /** Whether the intent executed successfully */
  success: boolean;
  /** ID of the intent that was executed */
  intentId: string;
  /** Result data from the intent execution */
  result?: unknown;
  /** Error message if failed */
  error?: string;
  /** Duration of intent execution in milliseconds */
  durationMs: number;
}

// ============================================================================
// Recovery Types
// ============================================================================

/**
 * Request to attempt recovery from a failure
 */
export interface RecoveryAttemptRequest {
  /** The failure to recover from */
  failure: StructuredFailureInfo;
  /** Natural language instruction for recovery */
  instruction: string;
  /** Optional element ID related to the failure */
  elementId?: string;
  /** Maximum number of retries */
  maxRetries: number;
}

/**
 * Result from a recovery attempt
 */
export interface RecoveryAttemptResult {
  /** Whether recovery was successful */
  recovered: boolean;
  /** Names of strategies that were attempted */
  strategiesAttempted: string[];
  /** Final action result if recovery succeeded */
  finalResult?: NLActionResponse;
  /** Error message if recovery failed */
  error?: string;
  /** Duration of recovery attempts in milliseconds */
  durationMs: number;
}

// ============================================================================
// Cross-App Comparison Types
// ============================================================================

// --- Data Extraction ---

/** Classified data type for extracted values */
export type DataType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'email'
  | 'url'
  | 'phone'
  | 'percentage'
  | 'boolean'
  | 'enum'
  | 'unknown';

/** A single extracted data value from a page element */
export interface ExtractedDataValue {
  /** Source element ID */
  elementId: string;
  /** Accessible name or label */
  label: string;
  /** Raw text value */
  rawValue: string;
  /** Normalized value for comparison */
  normalizedValue: string;
  /** Classified data type */
  dataType: DataType;
  /** Confidence in the classification (0-1) */
  confidence: number;
}

/** Map of labeled data values extracted from a page */
export interface PageDataMap {
  /** All extracted values keyed by label */
  values: Record<string, ExtractedDataValue>;
  /** Total elements scanned */
  scannedCount: number;
  /** Elements with extractable data */
  extractedCount: number;
}

// --- Region Segmentation ---

/** Semantic region type */
export type RegionType =
  | 'header'
  | 'navigation'
  | 'sidebar'
  | 'main-content'
  | 'footer'
  | 'form'
  | 'table'
  | 'card'
  | 'modal'
  | 'toolbar'
  | 'unknown';

/** A segmented region of a page */
export interface PageRegion {
  /** Region type */
  type: RegionType;
  /** Bounding box */
  bounds: { x: number; y: number; width: number; height: number };
  /** Element IDs contained in this region */
  elementIds: string[];
  /** Computed label for the region */
  label: string;
  /** Confidence in the classification (0-1) */
  confidence: number;
}

/** All regions on a page */
export interface PageRegionMap {
  /** Detected regions */
  regions: PageRegion[];
  /** Total elements assigned to regions */
  assignedCount: number;
  /** Elements not assigned to any region */
  unassignedIds: string[];
}

// --- Table / List Extraction ---

/** Column definition for an extracted table */
export interface TableColumn {
  /** Column header text */
  header: string;
  /** Index in the table */
  index: number;
  /** Detected data type for the column */
  dataType: DataType;
}

/** Schema of an extracted table */
export interface TableSchema {
  /** Table label or caption */
  label: string;
  /** Columns */
  columns: TableColumn[];
  /** Row data (array of row arrays) */
  rows: string[][];
  /** Source element ID */
  sourceElementId?: string;
}

/** Field definition for a list item */
export interface ListItemField {
  /** Field label */
  label: string;
  /** Detected data type */
  dataType: DataType;
}

/** Schema of an extracted list */
export interface ListSchema {
  /** List label */
  label: string;
  /** Item fields */
  fields: ListItemField[];
  /** Items (array of field-value maps) */
  items: Record<string, string>[];
  /** Source element ID */
  sourceElementId?: string;
}

/** All structured data extracted from a page */
export interface StructuredDataExtraction {
  /** Extracted tables */
  tables: TableSchema[];
  /** Extracted lists */
  lists: ListSchema[];
}

// --- Format Analysis ---

/** Describes the format of a data value */
export interface FormatDescriptor {
  /** Element ID */
  elementId: string;
  /** Label */
  label: string;
  /** Data type */
  dataType: DataType;
  /** Detected format pattern (e.g., "MM/DD/YYYY", "$#,###.##") */
  pattern: string;
  /** Example value */
  example: string;
}

/** A format mismatch between source and target */
export interface FormatMismatch {
  /** Label of the data field */
  label: string;
  /** Source format */
  sourceFormat: FormatDescriptor;
  /** Target format */
  targetFormat: FormatDescriptor;
  /** Severity: 'info' | 'warning' | 'error' */
  severity: 'info' | 'warning' | 'error';
  /** Human-readable description of the mismatch */
  description: string;
}

// --- Cross-App Diff ---

/** A pair of matched elements across apps */
export interface MatchedElementPair {
  /** Source element ID */
  sourceId: string;
  /** Target element ID */
  targetId: string;
  /** Source element label */
  sourceLabel: string;
  /** Target element label */
  targetLabel: string;
  /** Match confidence (0-1) */
  confidence: number;
  /** Strategy that matched them */
  matchStrategy: string;
}

/** Comparison of a data value between source and target */
export interface DataValueComparison {
  /** Field label */
  label: string;
  /** Source value */
  sourceValue: string;
  /** Target value */
  targetValue: string;
  /** Whether values match after normalization */
  valuesMatch: boolean;
  /** Whether formats match */
  formatsMatch: boolean;
}

/** Full cross-app diff result */
export interface CrossAppDiff {
  /** Matched element pairs */
  matchedPairs: MatchedElementPair[];
  /** Source elements with no match */
  unmatchedSourceIds: string[];
  /** Target elements with no match */
  unmatchedTargetIds: string[];
  /** Data value comparisons for matched pairs */
  dataComparisons: DataValueComparison[];
  /** Format mismatches */
  formatMismatches: FormatMismatch[];
}

// --- Action Parity ---

/** Comparison of interactive capabilities between matched elements */
export interface InteractionParity {
  /** Matched element pair */
  pair: MatchedElementPair;
  /** Actions available in source */
  sourceActions: string[];
  /** Actions available in target */
  targetActions: string[];
  /** Actions present in source but missing in target */
  missingInTarget: string[];
  /** Actions present in target but missing in source */
  missingInSource: string[];
}

// --- Navigation Map ---

/** A pair of navigation elements across apps */
export interface NavigationPair {
  /** Source navigation element */
  sourceId: string;
  /** Target navigation element */
  targetId: string;
  /** Link text or label */
  label: string;
  /** Source href/destination */
  sourceHref?: string;
  /** Target href/destination */
  targetHref?: string;
  /** Whether the destination is equivalent */
  destinationMatch: boolean;
}

/** Full navigation map comparison */
export interface NavigationMap {
  /** Matched navigation pairs */
  pairs: NavigationPair[];
  /** Navigation items only in source */
  sourceOnly: string[];
  /** Navigation items only in target */
  targetOnly: string[];
}

// --- Component Comparison ---

/** Information about a component (from /control/components) */
export interface ComponentInfo {
  /** Component ID */
  id: string;
  /** Component name */
  name: string;
  /** Component type */
  type: string;
  /** State keys */
  stateKeys: string[];
  /**
   * Actions — bare action-id strings (pre-0.22.0 wire) or canonical
   * `ComponentActionInfo` objects (`{ id, label?, description? }`, the
   * 0.22.0 canonical-shape wire). Comparison code normalizes to the id.
   */
  actions: Array<string | { id: string; label?: string; description?: string }>;
}

/** A matched pair of components */
export interface ComponentMatch {
  /** Source component */
  source: ComponentInfo;
  /** Target component */
  target: ComponentInfo;
  /** Match confidence (0-1) */
  confidence: number;
  /** State key differences */
  stateKeyDiff: { missing: string[]; extra: string[] };
  /** Action differences */
  actionDiff: { missing: string[]; extra: string[] };
}

/** Full component comparison result */
export interface ComponentComparison {
  /** Matched component pairs */
  matches: ComponentMatch[];
  /** Source-only components */
  sourceOnly: ComponentInfo[];
  /** Target-only components */
  targetOnly: ComponentInfo[];
}

// --- Layout Comparison ---

/** Detected grid structure from element positions */
export interface GridStructure {
  /** Detected column positions (x-coordinates) */
  columns: number[];
  /** Detected row positions (y-coordinates) */
  rows: number[];
  /** Column count */
  columnCount: number;
  /** Row count */
  rowCount: number;
}

/** Differences in grid structure */
export interface GridDiff {
  /** Source grid */
  sourceGrid: GridStructure;
  /** Target grid */
  targetGrid: GridStructure;
  /** Column count difference */
  columnDiff: number;
  /** Row count difference */
  rowDiff: number;
}

/** Differences in element hierarchy depth */
export interface HierarchyDiff {
  /** Source max nesting depth */
  sourceDepth: number;
  /** Target max nesting depth */
  targetDepth: number;
  /** Difference */
  depthDiff: number;
}

/** Information density comparison */
export interface DensityComparison {
  /** Source elements per region */
  sourceDensity: number;
  /** Target elements per region */
  targetDensity: number;
  /** Ratio (source/target) */
  ratio: number;
}

/** Full layout comparison result */
export interface LayoutComparison {
  /** Grid structure differences */
  gridDiff: GridDiff;
  /** Hierarchy differences */
  hierarchyDiff: HierarchyDiff;
  /** Density comparison */
  density: DensityComparison;
  /** Overall layout similarity (0-1) */
  similarity: number;
}

// --- Content Comparison ---

/** A matched heading pair */
export interface HeadingMatch {
  /** Source heading text */
  source: string;
  /** Target heading text */
  target: string;
  /** Heading level (1-6) */
  level?: number;
}

/** A changed heading pair */
export interface HeadingChange {
  /** Source heading text */
  source: string;
  /** Target heading text */
  target: string;
  /** Heading level (1-6) */
  level?: number;
}

/** A matched metric pair */
export interface MetricMatch {
  /** Metric label */
  label: string;
  /** Source value */
  sourceValue: string;
  /** Target value */
  targetValue: string;
}

/** A changed metric pair (cross-app comparison) */
export interface CrossAppMetricChange {
  /** Metric label */
  label: string;
  /** Source value */
  sourceValue: string;
  /** Target value */
  targetValue: string;
}

/** A matched status pair */
export interface StatusMatch {
  /** Status label */
  label: string;
  /** Source status text */
  sourceStatus: string;
  /** Target status text */
  targetStatus: string;
}

/** A changed status pair (cross-app comparison) */
export interface CrossAppStatusChange {
  /** Status label */
  label: string;
  /** Source status text */
  sourceStatus: string;
  /** Target status text */
  targetStatus: string;
}

/** Heading comparison for a specific level */
export interface HeadingLevelComparison {
  /** Heading level (1-6) */
  level: number;
  /** Source heading count */
  sourceCount: number;
  /** Target heading count */
  targetCount: number;
}

/** Table structure comparison */
export interface TableComparison {
  /** Table label (source) */
  sourceLabel: string;
  /** Table label (target) */
  targetLabel: string;
  /** Whether column headers match */
  columnsMatch: boolean;
  /** Column headers only in source */
  sourceOnlyColumns: string[];
  /** Column headers only in target */
  targetOnlyColumns: string[];
  /** Number of rows in source */
  sourceRowCount: number;
  /** Number of rows in target */
  targetRowCount: number;
  /** Cell value differences (row, column, source value, target value) */
  cellDifferences: Array<{
    row: number;
    column: string;
    sourceValue: string;
    targetValue: string;
  }>;
}

/** Full content comparison result */
export interface ContentComparison {
  /** Heading comparison */
  headings: {
    matched: HeadingMatch[];
    sourceOnly: string[];
    targetOnly: string[];
    changed: HeadingChange[];
  };
  /** Metric comparison */
  metrics: {
    matched: MetricMatch[];
    changed: CrossAppMetricChange[];
    sourceOnly: string[];
    targetOnly: string[];
  };
  /** Status comparison */
  statuses: {
    matched: StatusMatch[];
    changed: CrossAppStatusChange[];
  };
  /** Labels / text comparison */
  labels: {
    matched: string[];
    sourceOnly: string[];
    targetOnly: string[];
  };
  /** Table structure comparison */
  tables: TableComparison[];
  /** Heading hierarchy comparison */
  headingHierarchy: HeadingLevelComparison[];
  /** Content parity score (0-1) */
  contentParity: number;
}

// --- Comparison Report ---

/** A single issue found during comparison */
export interface ComparisonIssue {
  /** Issue severity */
  severity: 'info' | 'warning' | 'error';
  /** Issue category */
  category:
    | 'missing-data'
    | 'format-mismatch'
    | 'value-mismatch'
    | 'missing-action'
    | 'navigation-gap'
    | 'layout-difference'
    | 'component-mismatch'
    | 'content-difference';
  /** Human-readable description */
  description: string;
  /** Source element ID (if applicable) */
  sourceElementId?: string;
  /** Target element ID (if applicable) */
  targetElementId?: string;
}

/** Full cross-app comparison report */
export interface CrossAppComparisonReport {
  /** Source page URL */
  sourceUrl: string;
  /** Target page URL */
  targetUrl: string;
  /** Timestamp */
  timestamp: number;
  /** Duration of comparison in ms */
  durationMs: number;
  /** Scores (0-1) */
  scores: {
    dataCompleteness: number;
    formatAlignment: number;
    presentationAlignment: number;
    navigationParity: number;
    actionParity: number;
    overallScore: number;
  };
  /** Cross-app diff */
  diff: CrossAppDiff;
  /** Navigation map */
  navigation: NavigationMap;
  /** Layout comparison */
  layout: LayoutComparison;
  /** Component comparison (included when components are provided) */
  components?: ComponentComparison;
  /** Content comparison (headings, metrics, statuses, labels, tables) */
  contentComparison?: ContentComparison;
  /** All issues sorted by severity */
  issues: ComparisonIssue[];
  /** LLM-readable summary */
  summary: string;
}
