/**
 * AI Module Types
 *
 * Defines types for AI-native UI Bridge functionality including
 * search criteria, natural language actions, assertions, and semantic snapshots.
 */

import type { ElementState, ElementType, ContentMetadata } from '../core/types';
import type { DiscoveredElement } from '../control/types';

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
  /** Human-readable description: "Blue submit button in the form" */
  description: string;
  /** Auto-generated aliases for natural language matching */
  aliases: string[];
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
  /** Whether this is an interactive element or static content */
  category?: 'interactive' | 'content';
  /** Metadata for content elements */
  contentMetadata?: ContentMetadata;
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
 * Recovery suggestion for structured failures
 */
export interface RecoverySuggestionInfo {
  /** Human-readable suggestion */
  suggestion: string;
  /** Machine-executable command (if applicable) */
  command?: string;
  /** Confidence that this action will help (0-1) */
  confidence: number;
  /** Whether retry with same parameters might help */
  retryable: boolean;
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
  suggestedActions?: RecoverySuggestionInfo[];
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
  | 'cssProperty';

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
  /** CSS property name (for cssProperty assertions) */
  propertyName?: string;
  /** Timeout for waiting (ms) */
  timeout?: number;
  /** Custom failure message */
  message?: string;
  /** Whether to use fuzzy matching for element search */
  fuzzy?: boolean;
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
  /** Failure reason if assertion failed */
  failureReason?: string;
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
  /** Field label */
  label: string;
  /** Input type */
  type: string;
  /** Current value */
  value: string;
  /** Validity */
  valid: boolean;
  /** Error message */
  error?: string;
  /** Required flag */
  required: boolean;
  /** Touched flag */
  touched: boolean;
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

/**
 * Recovery suggestion for errors
 */
export interface RecoverySuggestion {
  /** Human-readable action description */
  action: string;
  /** Command to execute (if applicable) */
  command?: string;
  /** Confidence that this will help */
  confidence: number;
  /** Priority (lower = try first) */
  priority: number;
}

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
  /** Action names */
  actions: string[];
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
