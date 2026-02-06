/**
 * AI Module Types
 *
 * Defines types for AI-native UI Bridge functionality including
 * search criteria, natural language actions, assertions, and semantic snapshots.
 */

import type { ElementState, ElementType } from '../core/types';
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
