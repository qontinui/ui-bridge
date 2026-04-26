import { an as AIDiscoveredElement, c_ as PageContext, Q as SemanticSnapshot, at as ElementState, ak as FormsResponse, d0 as ParsedAction, b9 as ActionExecutor, am as DiscoveredElement, as as RegisteredElement, I as NLActionRequest, J as NLActionResponse, G as SearchCriteria, au as SearchResult, b0 as AIErrorContext, o as ControlSnapshot, R as SemanticDiff, V as ActionWithDiffRequest, X as ActionDiffResult, Y as ChangePredicate, Z as WaitForChangeOptions, _ as CategorizedDiff, bS as DiffSummaryOptions, a0 as ChangeBufferDrainResult, a1 as SnapshotBookmark, $ as StructuredChangeAnalysis, d6 as RecoverySuggestion, bP as DataType, a9 as PageDataMap, d7 as RegionType, aa as PageRegionMap, cG as ListSchema, dB as TableSchema, ab as StructuredDataExtraction, co as FormatDescriptor, cp as FormatMismatch, bI as CrossAppDiff, cL as MatchedElementPair, cB as InteractionParity, cU as NavigationMap, ac as ComponentInfo, bv as ComponentComparison, cD as LayoutComparison, cs as GridStructure, bB as ContentComparison, ad as CrossAppComparisonReport, aj as ResponsiveSnapshot, ah as InteractionStateName, ai as StateStyles, ag as ElementDesignData, ce as ExtendedComputedStyles, x as FindResponse, w as FindRequest } from '../types-svkOxfrJ.js';
export { a$ as AIElementRegistrationOptions, b1 as AIFindResponse, bc as AggregatedErrors, K as AssertionRequest, L as AssertionResult, ao as AssertionType, M as BatchAssertionRequest, O as BatchAssertionResult, bk as BufferEntry, bl as BufferedChange, bm as BufferedRouteChange, bn as ChangeCategory, bo as ChangeTimeline, bq as CompactElement, br as CompactModal, bs as CompactToast, bt as ComparisonIssue, bw as ComponentMatch, bA as ContentChanges, bJ as CrossAppMetricChange, bK as CrossAppStatusChange, bQ as DataValueComparison, bR as DensityComparison, c2 as ElementChange, c9 as ElementModification, ch as ExtractedDataValue, cl as FormAnalysis, cm as FormFieldAnalysis, cn as FormFieldState, av as FormState, cr as GridDiff, ct as GroupedElements, cu as HeadingChange, cv as HeadingLevelComparison, cw as HeadingMatch, cx as HierarchyDiff, a6 as Intent, a4 as IntentExecutionResult, cA as IntentParam, a5 as IntentSearchResponse, cE as ListChangeAnalysis, cF as ListItemField, cH as LoadingState, cP as MetricChange, cQ as MetricMatch, cR as ModalState, cV as NavigationPair, c$ as PageRegion, a7 as RecoveryAttemptRequest, a8 as RecoveryAttemptResult, dd as ScreenAnalysis, H as SearchResponse, a2 as SemanticSearchCriteria, a3 as SemanticSearchResponse, di as SemanticSearchResult, dv as StatusChange, dw as StatusMatch, dy as TableChangeAnalysis, dz as TableColumn, dA as TableComparison, dC as TextChange, dD as TimelineEvent } from '../types-svkOxfrJ.js';
import { k as SearchEngineConfig } from '../find-Cy9pKSdy.js';
export { D as DEFAULT_SEARCH_CONFIG, d as DecomposedTarget, e as FindCandidate, F as FindContext, f as FindOptions, a as FindResult, g as FindResultAmbiguous, h as FindResultMatch, i as FindResultNotFound, c as FormDiff, j as FormFieldDiff, b as FormSnapshot, S as SearchEngine, l as SpatialRelation, m as captureFormSnapshot, n as createSearchEngine, o as decomposeTarget, p as diffFormSnapshots, q as find, s as summarizeFormDiff } from '../find-Cy9pKSdy.js';
export { A as AssertionConfig, a as AssertionExecutor, D as DEFAULT_ASSERTION_CONFIG, c as createAssertionExecutor } from '../assertions-DNWNlpr9.js';
import { C as CompositeIdleDetector } from '../composite-idle-CVbDdYij.js';
import '../types-BFG8zj15.js';
import '../tracker-DpZSyunJ.js';

/**
 * Fuzzy Matcher
 *
 * Provides fuzzy text matching utilities for finding elements by natural language descriptions.
 * Implements multiple matching algorithms with configurable thresholds.
 */
/**
 * Configuration for fuzzy matching
 */
interface FuzzyMatchConfig {
    /** Minimum similarity threshold (0-1) */
    threshold: number;
    /** Weight for Levenshtein distance */
    levenshteinWeight: number;
    /** Weight for Jaro-Winkler similarity */
    jaroWinklerWeight: number;
    /** Weight for N-gram matching */
    ngramWeight: number;
    /** N-gram size */
    ngramSize: number;
    /** Case sensitive matching */
    caseSensitive: boolean;
    /** Ignore whitespace differences */
    ignoreWhitespace: boolean;
}
/**
 * Default fuzzy match configuration
 */
declare const DEFAULT_FUZZY_CONFIG: FuzzyMatchConfig;
/**
 * Result from a fuzzy match operation
 */
interface FuzzyMatchResult {
    /** Overall similarity score (0-1) */
    similarity: number;
    /** Whether the match passes the threshold */
    isMatch: boolean;
    /** Individual algorithm scores */
    scores: {
        levenshtein: number;
        jaroWinkler: number;
        ngram: number;
    };
    /** Normalized source string */
    normalizedSource: string;
    /** Normalized target string */
    normalizedTarget: string;
}
/**
 * Calculate Levenshtein distance between two strings
 */
declare function levenshteinDistance(s1: string, s2: string): number;
/**
 * Calculate Levenshtein similarity (0-1)
 */
declare function levenshteinSimilarity(s1: string, s2: string): number;
/**
 * Calculate Jaro similarity between two strings
 */
declare function jaroSimilarity(s1: string, s2: string): number;
/**
 * Calculate Jaro-Winkler similarity
 * Gives more weight to strings that match from the beginning
 */
declare function jaroWinklerSimilarity(s1: string, s2: string, prefixScale?: number): number;
/**
 * Generate N-grams from a string
 */
declare function generateNgrams(s: string, n: number): Set<string>;
/**
 * Calculate N-gram similarity (Jaccard coefficient)
 */
declare function ngramSimilarity(s1: string, s2: string, n?: number): number;
/**
 * Normalize a string for comparison
 */
declare function normalizeString(s: string, config?: Partial<FuzzyMatchConfig>): string;
/**
 * Main fuzzy match function
 * Combines multiple algorithms for robust matching
 */
declare function fuzzyMatch(source: string, target: string, config?: Partial<FuzzyMatchConfig>): FuzzyMatchResult;
/**
 * Find the best match from a list of candidates
 */
declare function findBestMatch(source: string, candidates: string[], config?: Partial<FuzzyMatchConfig>): {
    match: string | null;
    index: number;
    result: FuzzyMatchResult | null;
};
/**
 * Find all matches above threshold
 */
declare function findAllMatches(source: string, candidates: string[], config?: Partial<FuzzyMatchConfig>): Array<{
    candidate: string;
    index: number;
    result: FuzzyMatchResult;
}>;
/**
 * Check if source contains target (fuzzy)
 */
declare function fuzzyContains(source: string, target: string, config?: Partial<FuzzyMatchConfig>): boolean;
/**
 * Calculate word-level similarity
 * Useful for comparing phrases
 */
declare function wordSimilarity(s1: string, s2: string, config?: Partial<FuzzyMatchConfig>): number;
/**
 * Tokenize a string for matching
 * Handles camelCase, PascalCase, snake_case, kebab-case
 */
declare function tokenize(s: string): string[];
/**
 * Calculate token-based similarity
 * Better for matching identifiers and labels
 */
declare function tokenSimilarity(s1: string, s2: string): number;

/**
 * Alias Generator
 *
 * Auto-generates element aliases from visible text, aria-label, placeholders,
 * titles, and common synonyms for natural language matching.
 */
/**
 * Configuration for alias generation
 */
interface AliasGeneratorConfig {
    /** Include text content as alias */
    includeText: boolean;
    /** Include aria-label as alias */
    includeAriaLabel: boolean;
    /** Include placeholder text as alias */
    includePlaceholder: boolean;
    /** Include title attribute as alias */
    includeTitle: boolean;
    /** Include common synonyms */
    includeSynonyms: boolean;
    /** Maximum number of aliases to generate */
    maxAliases: number;
    /** Minimum alias length */
    minLength: number;
    /** Maximum alias length */
    maxLength: number;
}
/**
 * Default alias generator configuration
 */
declare const DEFAULT_ALIAS_CONFIG: AliasGeneratorConfig;
/**
 * Interface for element information used in alias generation
 */
interface AliasGeneratorInput {
    /** Element text content */
    textContent?: string | null;
    /** ARIA label */
    ariaLabel?: string | null;
    /** ARIA labelledby resolved text */
    ariaLabelledBy?: string | null;
    /** Placeholder text */
    placeholder?: string | null;
    /** Title attribute */
    title?: string | null;
    /** Element type */
    elementType?: string;
    /** Element tag name */
    tagName?: string;
    /** Input type */
    inputType?: string;
    /** Element ID */
    id?: string | null;
    /** Element name attribute */
    name?: string | null;
    /** Associated label text */
    labelText?: string | null;
    /** Value attribute */
    value?: string | null;
}
/**
 * Generate aliases for an element
 */
declare function generateAliases(input: AliasGeneratorInput, config?: Partial<AliasGeneratorConfig>): string[];
/**
 * Generate a human-readable description for an element
 */
declare function generateDescription(input: AliasGeneratorInput): string;
/**
 * Generate a purpose statement for an element
 */
declare function generatePurpose(input: AliasGeneratorInput): string | undefined;
/**
 * Generate suggested actions for an element
 */
declare function generateSuggestedActions(input: AliasGeneratorInput): string[];
/**
 * Get synonyms for a word
 */
declare function getSynonyms(word: string): string[];
/**
 * Check if two words are synonyms
 */
declare function areSynonyms(word1: string, word2: string): boolean;

/**
 * Summary Generator
 *
 * Generates LLM-friendly text summaries of pages and elements
 * for AI agents to understand the current UI state.
 */

/**
 * Configuration for summary generation
 */
interface SummaryConfig {
    /** Maximum summary length in characters */
    maxLength: number;
    /** Include form details */
    includeForms: boolean;
    /** Include element counts */
    includeElementCounts: boolean;
    /** Include active modals */
    includeModals: boolean;
    /** Include focused element */
    includeFocused: boolean;
    /** Verbosity level */
    verbosity: 'brief' | 'normal' | 'detailed';
}
/**
 * Generate a page summary from elements
 */
declare function generatePageSummary(elements: AIDiscoveredElement[], pageContext?: Partial<PageContext>, config?: Partial<SummaryConfig>): string;
/**
 * Generate an element description
 */
declare function generateElementDescription(element: AIDiscoveredElement): string;
/**
 * Generate a snapshot summary
 */
declare function generateSnapshotSummary(snapshot: SemanticSnapshot, config?: Partial<SummaryConfig>): string;
/**
 * Generate diff summary
 */
declare function generateDiffSummary(appeared: string[], disappeared: string[], modified: Array<{
    description: string;
    property: string;
    from: string;
    to: string;
}>): string;
/**
 * Infer page type from URL and elements
 */
declare function inferPageType(url: string, title: string, elements: AIDiscoveredElement[]): PageContext['pageType'];

/**
 * Validation Error Heuristic Scanner
 *
 * Detects validation errors near form fields using multiple strategies:
 * 1. HTML5 Constraint Validation API
 * 2. ARIA attributes (aria-invalid, aria-errormessage, aria-describedby)
 * 3. Adjacent sibling elements with error CSS classes
 * 4. CSS class heuristics on the input itself
 *
 * Each strategy returns a confidence score. The highest-confidence match wins.
 */
interface DetectedValidationError {
    /** Associated form field element ID or DOM selector */
    fieldId: string;
    /** The error message text (may be empty if only class-based detection) */
    message: string;
    /** Confidence score 0-1 */
    confidence: number;
    /** Which strategy detected this error */
    source: 'html5' | 'aria' | 'adjacent-element' | 'css-class';
}
/**
 * Scan registered elements for validation errors using DOM heuristics.
 *
 * @param elements - Array of objects with `id` and `element` (DOM reference)
 * @returns Detected validation errors, one per field maximum
 */
declare function scanValidationErrors(elements: Array<{
    id: string;
    element: HTMLElement;
}>): DetectedValidationError[];

/**
 * Form Discovery
 *
 * Shared form discovery logic used by both the `/control/forms` endpoint
 * and `createSemanticSnapshot({ includeForms: true })`.
 *
 * Discovers all forms on the page (both explicit `<form>` elements and
 * implicit forms from orphaned inputs), analyses field state, validation
 * errors, dirty tracking, and constraints.
 */

/**
 * A registered element with DOM access — the minimal shape both the
 * server handler and snapshot manager can provide.
 */
interface FormDiscoveryElement {
    id: string;
    element: HTMLElement;
    type: string;
    label?: string;
    getState: () => ElementState;
}
/**
 * Discover all forms on the page and return a `FormsResponse`.
 *
 * This is the single source of truth for form discovery — the
 * `/control/forms` handler and the semantic snapshot both delegate here.
 */
declare function discoverForms(elements: FormDiscoveryElement[]): FormsResponse;

/**
 * Natural Language Assertion Parser
 *
 * Parses natural language assertion strings into structured assertion requests.
 * Shared between browser-side command handlers and server-side handlers.
 *
 * Examples:
 *   "a button exists"          → { target: "button", type: "exists" }
 *   "input is not visible"     → { target: "input", type: "hidden" }
 *   "button is not disabled"   → { target: "button", type: "enabled" }
 *   "checkbox is not checked"  → { target: "checkbox", type: "unchecked" }
 */
/** Input for the NL assertion parser. Target can be a string or a structured search criteria object. */
interface NLAssertionInput {
    target?: unknown;
    type?: string;
    expected?: unknown;
    assertion?: string;
}
/** Output from the NL assertion parser */
interface NLAssertionOutput {
    target: string;
    type: string;
    expected?: unknown;
}
/**
 * Parse a natural language assertion into a structured form.
 *
 * If `target` and `type` are already present, passes them through.
 * Otherwise, parses the `assertion` string into { target, type, expected }.
 */
declare function parseNLAssertion(input: NLAssertionInput): NLAssertionOutput;

/**
 * Natural Language Action Parser
 *
 * Parses natural language instructions into structured action requests.
 * Handles patterns like "click the Submit button" or "type 'hello' in the search box".
 */

/**
 * Parse a natural language instruction into a structured action
 */
declare function parseNLInstruction(instruction: string): ParsedAction | null;
/**
 * Parse multiple instructions
 */
declare function parseNLInstructions(instructions: string[]): ParsedAction[];
/**
 * Split a complex instruction into simple ones
 * e.g., "click Login and type 'admin' in username" -> ["click Login", "type 'admin' in username"]
 */
declare function splitCompoundInstruction(instruction: string): string[];
/**
 * Extract modifiers from instruction
 */
declare function extractModifiers(instruction: string): ParsedAction['modifiers'];
/**
 * Validate a parsed action
 */
declare function validateParsedAction(action: ParsedAction): {
    valid: boolean;
    errors: string[];
};
/**
 * Generate a human-readable description of a parsed action
 */
declare function describeAction(action: ParsedAction): string;

/**
 * Natural Language Action Executor
 *
 * Executes parsed natural language actions by searching for elements
 * and performing the requested actions with confidence scoring.
 */

/**
 * Configuration for the NL action executor
 */
interface NLActionExecutorConfig {
    /** Default confidence threshold for element matching */
    defaultConfidenceThreshold: number;
    /** Default timeout for actions */
    defaultTimeout: number;
    /** Maximum alternatives to return on failure */
    maxAlternatives: number;
    /** Search engine configuration */
    searchConfig?: Partial<SearchEngineConfig>;
    /** Enable verbose logging */
    verbose: boolean;
}
/**
 * Default executor configuration
 */
declare const DEFAULT_EXECUTOR_CONFIG: NLActionExecutorConfig;
/**
 * Natural Language Action Executor
 */
declare class NLActionExecutor {
    private config;
    private searchEngine;
    private actionExecutor;
    private elements;
    constructor(config?: Partial<NLActionExecutorConfig>);
    /**
     * Set the action executor for performing DOM actions
     */
    setActionExecutor(executor: ActionExecutor): void;
    /**
     * Update available elements for search
     */
    updateElements(elements: Array<DiscoveredElement | RegisteredElement>): void;
    /**
     * Execute a natural language instruction
     */
    execute(request: NLActionRequest): Promise<NLActionResponse>;
    /**
     * Execute a parsed action directly (skip parsing)
     */
    executeParsed(parsed: ParsedAction, threshold?: number): Promise<NLActionResponse>;
    /**
     * Build search criteria from a parsed action
     */
    private buildSearchCriteria;
    /**
     * Perform the actual action on an element
     */
    private performAction;
    /**
     * Create a failure response with suggestions
     */
    private createFailureResponse;
    /**
     * Generate recovery suggestions
     */
    private generateSuggestions;
    /**
     * Get rich error context for debugging
     */
    getErrorContext(errorCode: string, instruction: string, searchCriteria?: SearchCriteria, nearestMatch?: SearchResult): AIErrorContext;
}
/**
 * Create a default NL action executor
 */
declare function createNLActionExecutor(config?: Partial<NLActionExecutorConfig>): NLActionExecutor;

/**
 * Semantic Snapshot
 *
 * Creates enhanced state snapshots with AI-friendly element descriptions,
 * form analysis, and modal detection.
 */

/**
 * Configuration for semantic snapshots
 */
interface SemanticSnapshotConfig {
    /** Include form analysis */
    analyzeForms: boolean;
    /** Include modal detection */
    detectModals: boolean;
    /** Include page type inference */
    inferPageType: boolean;
    /** Generate element descriptions */
    generateDescriptions: boolean;
    /** Maximum elements to include */
    maxElements: number;
    /** Merge annotations from the annotation store (default: true) */
    useAnnotations: boolean;
    /** Include detailed form state via DOM-level form discovery (default: false) */
    includeForms: boolean;
    /**
     * Maximum estimated token budget for the snapshot (0 = unlimited).
     * When set, elements are progressively pruned by region priority
     * (main-content > form > modal > navigation > sidebar > header > footer)
     * until the serialized snapshot fits within the budget.
     * Tokens are estimated as ~4 characters per token.
     */
    maxTokens: number;
}
/**
 * Default snapshot configuration
 */
declare const DEFAULT_SNAPSHOT_CONFIG: SemanticSnapshotConfig;
/**
 * Semantic Snapshot Manager
 */
declare class SemanticSnapshotManager {
    private config;
    private searchEngine;
    private history;
    private readonly maxHistorySize;
    private snapshotCounter;
    constructor(config?: Partial<SemanticSnapshotConfig>);
    /**
     * Create a semantic snapshot from a control snapshot.
     *
     * @param controlSnapshot - The control-level snapshot of registered elements.
     * @param pageContext - Optional partial page context to merge in.
     * @param formsResponse - Pre-built FormsResponse from `discoverForms()`.
     *   When provided **and** `config.includeForms` is `true`, this is
     *   attached to the snapshot as `formsDetail`.
     */
    createSnapshot(controlSnapshot: ControlSnapshot, pageContext?: Partial<PageContext>, formsResponse?: FormsResponse): SemanticSnapshot;
    /**
     * Get the last snapshot
     */
    getLastSnapshot(): SemanticSnapshot | null;
    /**
     * Get snapshot by ID
     */
    getSnapshot(snapshotId: string): SemanticSnapshot | null;
    /**
     * Get snapshot history
     */
    getHistory(): SemanticSnapshot[];
    /**
     * Clear history
     */
    clearHistory(): void;
    /**
     * Convert control snapshot elements to AI elements
     */
    private convertElements;
    /**
     * Convert a single element to AI element
     */
    private convertElement;
    /**
     * Generate a content-specific description
     */
    private generateContentDescription;
    /**
     * Build full page context
     */
    private buildPageContext;
    /**
     * Analyze forms in the snapshot
     */
    private analyzeForms;
    /**
     * Detect implicit form from inputs
     */
    private detectImplicitForm;
    /**
     * Analyze a specific form
     */
    private analyzeForm;
    /**
     * Analyze form fields
     */
    private analyzeFormFields;
    /**
     * Detect modal dialogs
     */
    private detectModals;
    /**
     * Infer modal type
     */
    private inferModalType;
    /**
     * Count elements by type
     */
    private countElementTypes;
    /**
     * Infer form purpose from fields
     */
    private inferFormPurpose;
    /**
     * Infer tag name from element type
     */
    private inferTagName;
    /**
     * Infer ARIA role from element type
     */
    private inferRole;
    /**
     * Infer semantic type
     */
    private inferSemanticType;
    /**
     * Add snapshot to history
     */
    /**
     * Region priority for token budget pruning.
     * Higher priority regions are kept; lower priority regions are pruned first.
     */
    private static readonly REGION_PRIORITY;
    /**
     * Estimate token count from serialized JSON length.
     * Uses ~4 characters per token as a rough approximation.
     */
    private estimateTokens;
    /**
     * Apply token budget by pruning low-priority elements.
     * Uses region classification to determine which elements to keep.
     * Interactive elements in main-content are prioritized highest.
     */
    private applyTokenBudget;
    private addToHistory;
}
/**
 * Create a semantic snapshot manager
 */
declare function createSnapshotManager(config?: Partial<SemanticSnapshotConfig>): SemanticSnapshotManager;

/**
 * Semantic Diff
 *
 * Tracks and describes semantic changes between snapshots
 * with LLM-friendly summaries and suggested actions.
 */

/**
 * Configuration for semantic diff
 */
interface SemanticDiffConfig {
    /** Ignore insignificant changes */
    ignoreInsignificant: boolean;
    /** Properties to track for modifications */
    trackedProperties: string[];
    /** Generate suggested actions */
    generateSuggestions: boolean;
    /** Maximum modifications to report */
    maxModifications: number;
}
/**
 * Default diff configuration
 */
declare const DEFAULT_DIFF_CONFIG: SemanticDiffConfig;
/**
 * Compute semantic diff between two snapshots
 */
declare function computeDiff(fromSnapshot: SemanticSnapshot, toSnapshot: SemanticSnapshot, config?: Partial<SemanticDiffConfig>): SemanticDiff;
/**
 * Create a diff manager for tracking changes over time
 */
declare class SemanticDiffManager {
    private config;
    private lastSnapshot;
    constructor(config?: Partial<SemanticDiffConfig>);
    /**
     * Update with new snapshot and get diff
     */
    update(newSnapshot: SemanticSnapshot): SemanticDiff | null;
    /**
     * Get diff from a specific snapshot to current
     */
    diffFrom(fromSnapshot: SemanticSnapshot): SemanticDiff | null;
    /**
     * Reset the manager
     */
    reset(): void;
    /**
     * Get the last known snapshot
     */
    getLastSnapshot(): SemanticSnapshot | null;
}
/**
 * Create a semantic diff manager
 */
declare function createDiffManager(config?: Partial<SemanticDiffConfig>): SemanticDiffManager;
/**
 * Utility: Check if any significant changes occurred
 */
declare function hasSignificantChanges(diff: SemanticDiff): boolean;
/**
 * Utility: Get a brief description of what changed
 */
declare function describeDiff(diff: SemanticDiff): string;
/**
 * Parse a numeric value from a string, handling common formats:
 * - Plain numbers: "42", "1,234", "1234.56"
 * - Percentages: "95%", "12.5%"
 * - Currency: "$1,234", "$1,234.56", "-$50"
 * - Duration: "2h 30m", "1.5s", "100ms"
 * - Negative values: "-42", "($500)"
 *
 * Returns the numeric value or null if not parseable.
 */
declare function parseNumericValue(text: string): number | null;
/**
 * Classify whether a status change is an improvement, degradation, or neutral
 */
declare function classifyStatusDirection(oldStatus: string, newStatus: string): 'improved' | 'degraded' | 'neutral';

/**
 * Change Tracker
 *
 * Orchestrates element change diffing with:
 * - Action-integrated diffing (snapshot → action → settle → snapshot → diff)
 * - Conditional waits (waitForChange with declarative predicates)
 * - Semantic change categorization
 * - Scoped diffs (within a container)
 * - Change buffer with drain
 * - Snapshot bookmarks
 */

/** Dependencies injected into ChangeTracker */
interface ChangeTrackerDeps {
    /** Creates semantic snapshots from control snapshots */
    snapshotManager: SemanticSnapshotManager;
    /** Idle detection (optional — falls back to timeout if null) */
    idleDetector: CompositeIdleDetector | null;
    /** Creates control snapshots from the current registry state */
    createControlSnapshot: () => ControlSnapshot;
    /** Executes a natural language action */
    executeNLAction?: (instruction: string) => Promise<NLActionResponse>;
    /** Executes an element action */
    executeElementAction?: (elementId: string, request: {
        action: string;
        params?: Record<string, unknown>;
    }) => Promise<unknown>;
    /** Refresh element references before snapshotting */
    refreshElements?: () => void;
    /**
     * Resolve element IDs within a CSS selector container (DOM containment).
     * When running in a browser, this uses actual `document.querySelector` + DOM traversal.
     * Returns the set of element IDs contained within the matched container.
     * If not provided, falls back to string-based scope matching.
     */
    resolveScope?: (scope: string) => Set<string> | null;
    /**
     * Subscribe to push-based change events (optional — falls back to polling).
     * Inspired by folk-js/allio's hybrid push-pull observation model.
     * When provided, waitForChange will use event-driven wakeups with a slower
     * safety-net poll instead of the default 200ms polling interval.
     */
    subscribeChanges?: (callback: (event: {
        type: string;
        timestamp: number;
    }) => void) => () => void;
    /**
     * Subscribe to browser console/error events (optional).
     * When provided, the change buffer will capture console errors while enabled.
     * The callback receives events that were emitted by the BrowserEventCapture
     * (or compatible) service. Returns an unsubscribe function.
     */
    subscribeBrowserEvents?: (callback: (event: {
        type: string;
        timestamp: number;
        level?: string;
        message?: string;
        stack?: string;
    }) => void) => () => void;
    /**
     * Subscribe to network request events (optional).
     * When provided, the change buffer will capture network requests while enabled.
     * The callback receives events from NetworkRequestTracker.onEvent.
     * Returns an unsubscribe function.
     */
    subscribeNetworkEvents?: (callback: (event: {
        type: string;
        timestamp: number;
        entry: {
            request: {
                url: string;
                method: string;
                startedAt: number;
            };
            response?: {
                statusCode: number;
                durationMs: number;
            };
        };
    }) => void) => () => void;
}
/** ChangeTracker configuration */
interface ChangeTrackerConfig {
    /** Default settle timeout for action-integrated diffing (ms) */
    defaultSettleTimeout: number;
    /** Default settle min stable time (ms) */
    defaultSettleMinStable: number;
    /** Default polling interval for waitForChange (ms) */
    defaultPollInterval: number;
    /** Default timeout for waitForChange (ms) */
    defaultWaitTimeout: number;
    /** Maximum buffer size before oldest entries are evicted */
    maxBufferSize: number;
    /** Maximum number of bookmarks */
    maxBookmarks: number;
    /** Diff configuration to use */
    diffConfig?: Partial<SemanticDiffConfig>;
}
declare class ChangeTracker {
    private deps;
    private config;
    private changeBuffer;
    private bufferEnabled;
    private bufferSequence;
    private bufferEnabledAt;
    private domMutationBuffer;
    private consoleErrorBuffer;
    private networkRequestBuffer;
    private mutationObserver;
    private unsubscribeBrowserEvents;
    private unsubscribeNetworkEvents;
    private tauriEventBuffer;
    private tauriEventNames;
    private tauriEventUnlisteners;
    private readonly tauriEventBufferCap;
    private recentRouteChanges;
    private readonly recentRouteChangesCap;
    private routeChangeListeners;
    private lastDiff;
    constructor(deps: ChangeTrackerDeps, config?: Partial<ChangeTrackerConfig>);
    /**
     * Execute an action and return the diff of what changed.
     *
     * Flow: snapshot before → execute action → wait for idle → snapshot after → diff
     */
    executeWithDiff(request: ActionWithDiffRequest): Promise<ActionDiffResult>;
    /**
     * Wait for a specific change condition to be met.
     *
     * Polls at configurable intervals, computing diffs until the predicate matches.
     */
    waitForChange(predicate: ChangePredicate, options?: WaitForChangeOptions): Promise<SemanticDiff>;
    /**
     * Push-based path: subscribe to change events, snapshot + diff only when
     * a change event arrives. Safety-net poll at 2000ms to catch missed events.
     */
    private waitForChangePush;
    /**
     * Polling path: original behavior — poll at defaultPollInterval (200ms).
     */
    private waitForChangePoll;
    /** Snapshot current state and diff against baseline. */
    private snapshotAndDiff;
    /** Handle timeout: capture final diff and throw. */
    private timeoutWithDiff;
    /**
     * Check if a diff matches a predicate
     */
    private matchesPredicate;
    /**
     * Record a timeline of changes during the settle period.
     *
     * Takes intermediate snapshots at regular intervals and records what changed
     * at each step, producing a time-ordered sequence of events.
     */
    private recordTimeline;
    /**
     * Classify a diff into a semantic category.
     */
    categorizeChanges(diff: SemanticDiff): CategorizedDiff;
    /**
     * Categorize the last computed diff (convenience for the server handler).
     */
    categorizeLastDiff(): CategorizedDiff | null;
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
    summarizeDiff(diff: SemanticDiff, options: DiffSummaryOptions): string;
    /**
     * Compute a diff scoped to elements within a CSS selector container.
     *
     * When `resolveScope` is provided (browser environment), uses actual DOM containment
     * to determine which elements are inside the container. Falls back to string-based
     * matching on parentContext, ID prefix, and description.
     */
    computeScopedDiff(fromSnapshot: SemanticSnapshot, toSnapshot: SemanticSnapshot, scope: string): SemanticDiff;
    /**
     * Get a scoped diff from the current state vs. a named bookmark.
     */
    scopedDiffFromBookmark(bookmarkName: string, scope: string): SemanticDiff | null;
    /** Enable change buffering. Starts MutationObserver and subscribes to
     * console/network events. When running inside a Tauri webview and
     * `setTauriEventNames()` has been called, also subscribes to those Tauri
     * backend events. The returned promise resolves once Tauri-event
     * subscriptions are in place; all other subscriptions are synchronous. In
     * non-Tauri hosts the promise resolves immediately. */
    enableBuffer(): Promise<void>;
    /** Disable change buffering. Stops MutationObserver and unsubscribes from services. */
    disableBuffer(): void;
    /**
     * Set the list of Tauri event names to capture in the change buffer.
     * Safe to call before or after `enableBuffer()`. When the buffer is
     * currently enabled, this unsubscribes from the previous names and
     * subscribes to the new ones (best-effort — returns a promise that
     * resolves once resubscription completes).
     */
    setTauriEventNames(names: string[]): Promise<void>;
    /**
     * Subscribe to Tauri backend events. No-op when not running inside a
     * Tauri webview (detected via `window.__TAURI_INTERNALS__`) or when the
     * event-name list is empty. Loads `@tauri-apps/api/event` via dynamic
     * import so the SDK stays usable in non-Tauri hosts without the optional
     * dependency installed.
     */
    private subscribeTauriEvents;
    /** Invoke every stored unlisten function and clear the list. */
    private unsubscribeTauriEvents;
    /** Stop MutationObserver and unsubscribe from console/network services. */
    private _teardownExtendedObservers;
    /** Whether the buffer is enabled */
    isBufferEnabled(): boolean;
    /** Get buffer size (registry-level changes only, for backward compat) */
    getBufferSize(): number;
    /**
     * Drain all buffered changes and clear the four sub-lists.
     * Observers remain active if the buffer is still enabled (incremental semantics:
     * subsequent drains return only events since the previous drain).
     *
     * Route-change and registry-diff entries are returned in `changes`, interleaved by
     * `recordedAt`. Raw DOM mutations, console errors, and network requests are returned
     * in separate typed lists.
     */
    drainBuffer(): ChangeBufferDrainResult;
    /**
     * Derive a best-effort CSS selector string for a DOM node.
     * Used for DomMutationEntry.target_selector.
     */
    private selectorFor;
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
    pushRouteChange(from: string, to: string, at?: number): void;
    /**
     * Subscribe to SPA route-change events.
     *
     * Fires synchronously from `pushRouteChange`, regardless of whether the
     * change buffer is enabled. Returns an unsubscribe function.
     */
    subscribeRouteChange(listener: (event: {
        from: string;
        to: string;
        at: number;
    }) => void): () => void;
    /**
     * Return recent route-change events from the always-on ring buffer,
     * optionally filtered to entries recorded at or after `sinceMs`.
     *
     * Used by `/ai/wait-for-route-change` to resolve immediately when a
     * matching navigation occurred between the HTTP request arriving and the
     * listener being attached.
     */
    getRecentRouteChanges(sinceMs?: number): Array<{
        from: string;
        to: string;
        at: number;
    }>;
    /** Append a diff to the buffer */
    private appendToBuffer;
    /** Trim oldest entries when the buffer exceeds its configured size. */
    private evictIfOverLimit;
    /**
     * Save a named snapshot of the current state.
     */
    saveBookmark(name: string): SnapshotBookmark;
    /**
     * Get a named bookmark.
     */
    getBookmark(name: string): SnapshotBookmark | null;
    /**
     * Delete a named bookmark.
     */
    deleteBookmark(name: string): boolean;
    /**
     * List all bookmark names.
     */
    listBookmarks(): string[];
    /**
     * Compute a diff from a named bookmark to the current state.
     */
    diffFromBookmark(name: string): SemanticDiff | null;
}
/**
 * Analyze structural changes between two snapshots at the table/list level.
 *
 * Detects tables and lists in both snapshots using spatial layout analysis,
 * then compares them to identify added/removed/modified rows or items.
 */
declare function analyzeStructuredChanges(before: SemanticSnapshot, after: SemanticSnapshot): StructuredChangeAnalysis;
declare function createChangeTracker(deps: ChangeTrackerDeps, config?: Partial<ChangeTrackerConfig>): ChangeTracker;

/**
 * Snapshot Bookmark Store (B2)
 *
 * Process-wide registry of named `SnapshotBookmark` entries. Mirrors the
 * design of `getGlobalStubRegistry()` in `network/stubs.ts` (F2).
 *
 * Design:
 *   - Module-level singleton accessed via `getGlobalBookmarkStore()`.
 *     Bookmarks must survive React re-renders and the parallel write/read
 *     paths in `react/commandHandlers.ts` (browser-SDK dispatcher) and
 *     `ai/change-tracker.ts` (runner ChangeTracker instances) must share
 *     the same backing map. Previously each path owned its own `Map`, so a
 *     `POST /ai/bookmarks` written via one path was invisible to a
 *     subsequent `GET /ai/bookmarks` resolved through the other.
 *   - Eviction: oldest-by-`savedAt` when at `maxBookmarks` capacity, mirroring
 *     the prior ChangeTracker behaviour.
 *   - Cleared on hard reload (module state is reinitialised); persists across
 *     soft navigations exactly like the stub registry does.
 */

/** Named snapshot bookmark stored in the registry. */
interface SnapshotBookmarkEntry {
    /** Bookmark name (unique key). */
    name: string;
    /** Semantic snapshot captured at save time. */
    snapshot: SemanticSnapshot;
    /** Epoch ms when the bookmark was saved. */
    savedAt: number;
}
/**
 * Process-wide store of named bookmarks. Created lazily by
 * `getGlobalBookmarkStore()` and shared by every code path that needs
 * to read or write bookmarks.
 */
declare class BookmarkStore {
    private bookmarks;
    private maxBookmarks;
    constructor(maxBookmarks?: number);
    /**
     * Configure the eviction cap. The store keeps the configured number of
     * most-recently-saved bookmarks. Overwriting an existing name does not
     * count toward the cap.
     */
    setMaxBookmarks(max: number): void;
    /** Save (or overwrite) a bookmark. Returns the stored entry. */
    save(entry: SnapshotBookmarkEntry): SnapshotBookmarkEntry;
    /** Get a bookmark by name, or null if missing. */
    get(name: string): SnapshotBookmarkEntry | null;
    /** Returns true if the named bookmark exists. */
    has(name: string): boolean;
    /** Delete a bookmark. Returns true if it existed. */
    delete(name: string): boolean;
    /** List bookmark names in insertion order. */
    listNames(): string[];
    /** List all bookmark entries in insertion order. */
    list(): SnapshotBookmarkEntry[];
    /** Number of bookmarks currently stored. */
    size(): number;
    /** Remove every bookmark. Returns the number cleared. */
    clear(): number;
    private findOldestKey;
}
/**
 * Access the process-wide bookmark store. Module-level so bookmarks
 * survive React re-renders and so the SDK browser dispatcher
 * (`react/commandHandlers.ts`) and the ChangeTracker class
 * (`ai/change-tracker.ts`) share a single backing map.
 */
declare function getGlobalBookmarkStore(): BookmarkStore;
/**
 * Test helper: replace the singleton with a fresh, empty store. Tests that
 * exercise bookmark behaviour should call this in `beforeEach` so they
 * don't see leftovers from earlier tests.
 */
declare function __resetGlobalBookmarkStoreForTest(maxBookmarks?: number): BookmarkStore;

/**
 * Error Context
 *
 * Creates rich error context for AI agents to understand and recover
 * from failures during UI automation.
 */

/**
 * Any element type that can be used with error context
 */
type AnyElement = DiscoveredElement | AIDiscoveredElement | RegisteredElement;
/**
 * Standard error codes
 */
declare const ErrorCodes: {
    readonly PARSE_ERROR: "PARSE_ERROR";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND";
    readonly ELEMENT_NOT_VISIBLE: "ELEMENT_NOT_VISIBLE";
    readonly ELEMENT_DISABLED: "ELEMENT_DISABLED";
    readonly ELEMENT_BLOCKED: "ELEMENT_BLOCKED";
    readonly MULTIPLE_ELEMENTS: "MULTIPLE_ELEMENTS";
    readonly LOW_CONFIDENCE: "LOW_CONFIDENCE";
    readonly AMBIGUOUS_MATCH: "AMBIGUOUS_MATCH";
    readonly ACTION_FAILED: "ACTION_FAILED";
    readonly ACTION_TIMEOUT: "ACTION_TIMEOUT";
    readonly UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION";
    readonly UNEXPECTED_STATE: "UNEXPECTED_STATE";
    readonly STALE_ELEMENT: "STALE_ELEMENT";
    readonly PAGE_LOAD_ERROR: "PAGE_LOAD_ERROR";
    readonly NAVIGATION_ERROR: "NAVIGATION_ERROR";
};
type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
/**
 * Create a rich error context
 */
declare function createErrorContext(errorCode: ErrorCode, attemptedAction: string, availableElements: AnyElement[], searchCriteria?: SearchCriteria, nearestMatch?: SearchResult): AIErrorContext;
/**
 * Format error context for display
 */
declare function formatErrorContext(context: AIErrorContext): string;
/**
 * Create a simple error response
 */
declare function createSimpleError(code: ErrorCode, message?: string): {
    code: string;
    message: string;
};
/**
 * Check if an error is recoverable
 */
declare function isRecoverableError(code: ErrorCode): boolean;
/**
 * Get the best recovery suggestion for an error
 */
declare function getBestRecoverySuggestion(context: AIErrorContext): RecoverySuggestion | null;

/**
 * Data Extraction
 *
 * Extracts labeled data values from page elements, classifies their types,
 * and normalizes values for cross-app comparison.
 */

interface DataExtractionConfig {
    /** Minimum confidence to include a value */
    minConfidence: number;
    /** Whether to normalize whitespace */
    normalizeWhitespace: boolean;
}
declare const DEFAULT_DATA_EXTRACTION_CONFIG: DataExtractionConfig;
/**
 * Classify the data type of a raw string value.
 */
declare function classifyDataType(value: string): {
    type: DataType;
    confidence: number;
};
/**
 * Normalize a value for comparison by stripping formatting differences.
 */
declare function normalizeValue(value: string, dataType: DataType): string;
/**
 * Extract labeled data values from all page elements.
 */
declare function extractPageData(elements: AIDiscoveredElement[], config?: DataExtractionConfig): PageDataMap;

/**
 * Region Segmentation
 *
 * Segments a page into semantic regions (header, nav, sidebar, main, footer, etc.)
 * based on element positions, roles, and spatial clustering.
 */

interface RegionSegmentationConfig {
    /** Minimum elements for a region to be valid */
    minRegionElements: number;
    /** Top portion of viewport considered "header" (fraction 0-1) */
    headerFraction: number;
    /** Bottom portion considered "footer" (fraction 0-1) */
    footerFraction: number;
    /** Left portion considered "sidebar" (fraction 0-1) */
    sidebarFraction: number;
}
declare const DEFAULT_REGION_SEGMENTATION_CONFIG: RegionSegmentationConfig;
/**
 * Classify the region type of an element based on its role, position, and context.
 */
declare function classifyRegionType(el: AIDiscoveredElement, relativeY: number, relativeX: number, config?: RegionSegmentationConfig): {
    type: RegionType;
    confidence: number;
};
/**
 * Segment all page elements into semantic regions.
 */
declare function segmentPageRegions(elements: AIDiscoveredElement[], config?: RegionSegmentationConfig): PageRegionMap;

/**
 * Table & List Extraction
 *
 * Detects and extracts structured data (tables and lists) from page elements
 * based on spatial layout and semantic roles.
 */

interface TableExtractionConfig {
    /** Minimum columns to consider a group a table */
    minTableColumns: number;
    /** Minimum rows to consider a group a table */
    minTableRows: number;
    /** Minimum items to consider a group a list */
    minListItems: number;
    /** Position tolerance for column alignment (px) */
    columnTolerance: number;
    /** Position tolerance for row alignment (px) */
    rowTolerance: number;
}
declare const DEFAULT_TABLE_EXTRACTION_CONFIG: TableExtractionConfig;
/**
 * Detect a table structure from elements with grid-like spatial arrangement.
 */
declare function detectTable(elements: AIDiscoveredElement[], config?: TableExtractionConfig): TableSchema | null;
/**
 * Detect a list structure from repeating element patterns.
 */
declare function detectList(elements: AIDiscoveredElement[], config?: TableExtractionConfig): ListSchema | null;
/**
 * Extract all structured data (tables and lists) from page elements.
 */
declare function extractStructuredData(elements: AIDiscoveredElement[], config?: TableExtractionConfig): StructuredDataExtraction;

/**
 * Format Analysis
 *
 * Analyzes the display format of data values and detects
 * format mismatches between source and target pages.
 */

interface FormatAnalysisConfig {
    /** Treat minor format differences (e.g., comma vs period for thousands) as warnings rather than errors */
    lenientFormatting: boolean;
}
declare const DEFAULT_FORMAT_ANALYSIS_CONFIG: FormatAnalysisConfig;
/**
 * Detect the format pattern of a value.
 */
declare function detectFormatPattern(value: string, dataType: DataType): string;
/**
 * Analyze format of a single element's value.
 */
declare function analyzeFormat(elementId: string, label: string, rawValue: string): FormatDescriptor;
/**
 * Analyze formats for all data-bearing elements on a page.
 */
declare function analyzePageFormats(elements: AIDiscoveredElement[]): FormatDescriptor[];
/**
 * Compare formats between source and target descriptors with matching labels.
 */
declare function compareFormats(sourceFormats: FormatDescriptor[], targetFormats: FormatDescriptor[], config?: FormatAnalysisConfig): FormatMismatch[];

/**
 * Cross-App Diff
 *
 * Matches elements between source and target pages and computes
 * a structured diff of data values, formats, and unmatched elements.
 */

interface CrossAppDiffConfig {
    /** Minimum confidence to consider a match */
    matchThreshold: number;
    /** Weight for accessible name matching */
    accessibleNameWeight: number;
    /** Weight for text matching */
    textWeight: number;
    /** Weight for role + position matching */
    rolePositionWeight: number;
}
declare const DEFAULT_CROSS_APP_DIFF_CONFIG: CrossAppDiffConfig;
/**
 * Match elements between source and target using greedy assignment.
 * Elements are matched by descending confidence.
 */
declare function matchElements(sourceElements: AIDiscoveredElement[], targetElements: AIDiscoveredElement[], config?: CrossAppDiffConfig): MatchedElementPair[];
/**
 * Compute a full cross-app diff between source and target element sets.
 */
declare function computeCrossAppDiff(sourceElements: AIDiscoveredElement[], targetElements: AIDiscoveredElement[], config?: CrossAppDiffConfig): CrossAppDiff;

/**
 * Action Parity
 *
 * Compares the interactive capabilities (available actions) of matched
 * element pairs to detect missing functionality between source and target.
 */

interface ActionParityConfig {
    /** Actions to ignore in comparison (e.g., framework-internal actions) */
    ignoreActions: string[];
}
declare const DEFAULT_ACTION_PARITY_CONFIG: ActionParityConfig;
/**
 * Analyze action parity for all matched element pairs.
 */
declare function analyzeActionParity(matchedPairs: MatchedElementPair[], sourceElements: AIDiscoveredElement[], targetElements: AIDiscoveredElement[], config?: ActionParityConfig): InteractionParity[];

/**
 * Navigation Map
 *
 * Identifies navigation elements in both source and target pages
 * and maps them to each other for parity analysis.
 */

interface NavigationMapConfig {
    /** Minimum similarity for label matching */
    labelMatchThreshold: number;
}
declare const DEFAULT_NAVIGATION_MAP_CONFIG: NavigationMapConfig;
/**
 * Determine whether an element is a navigation link/item.
 */
declare function isNavigationElement(el: AIDiscoveredElement): boolean;
/**
 * Build a navigation map comparing source and target pages.
 */
declare function buildNavigationMap(sourceElements: AIDiscoveredElement[], targetElements: AIDiscoveredElement[], config?: NavigationMapConfig): NavigationMap;

/**
 * Component Comparison
 *
 * Compares registered components between source and target apps,
 * matching by name/type and diffing state keys and actions.
 */

interface ComponentComparisonConfig {
    /** Minimum similarity for name matching */
    nameMatchThreshold: number;
}
declare const DEFAULT_COMPONENT_COMPARISON_CONFIG: ComponentComparisonConfig;
/**
 * Compare components between source and target apps.
 *
 * Note: ComponentInfo is not part of SemanticSnapshot. The caller must
 * fetch component lists separately from /control/components endpoint.
 */
declare function compareComponents(sourceComponents: ComponentInfo[], targetComponents: ComponentInfo[], config?: ComponentComparisonConfig): ComponentComparison;

/**
 * Layout Comparison
 *
 * Compares the spatial layout between two pages: grid structure,
 * hierarchy depth, and information density.
 */

interface LayoutComparisonConfig {
    /** Tolerance for column/row alignment detection (px) */
    gridTolerance: number;
}
declare const DEFAULT_LAYOUT_COMPARISON_CONFIG: LayoutComparisonConfig;
/**
 * Detect the implicit grid structure from element positions.
 */
declare function detectGridStructure(elements: AIDiscoveredElement[], config?: LayoutComparisonConfig): GridStructure;
/**
 * Compute a prominence score for an element (0-1) based on size and position.
 * Larger elements nearer the top are more prominent.
 */
declare function computeProminence(element: AIDiscoveredElement, pageWidth: number, pageHeight: number): number;
/**
 * Compare layouts between source and target element sets.
 */
declare function compareLayouts(sourceElements: AIDiscoveredElement[], targetElements: AIDiscoveredElement[], sourceRegions?: PageRegionMap, targetRegions?: PageRegionMap, config?: LayoutComparisonConfig): LayoutComparison;

/**
 * Content Comparison
 *
 * Compares content elements (headings, metrics, labels, statuses, table data)
 * between source and target semantic snapshots. Produces a structured
 * ContentComparison result alongside the existing interactive element comparison.
 */

interface ContentComparisonConfig {
    /** Minimum fuzzy similarity to consider two labels as matching */
    labelMatchThreshold: number;
    /** Minimum fuzzy similarity to consider two headings as matching */
    headingMatchThreshold: number;
    /** Maximum cell differences to report per table */
    maxCellDifferences: number;
}
declare const DEFAULT_CONTENT_COMPARISON_CONFIG: ContentComparisonConfig;
/**
 * Compare content elements between source and target.
 *
 * Analyzes headings, metrics, statuses, labels, and table data,
 * producing a structured ContentComparison result.
 */
declare function compareContent(sourceElements: AIDiscoveredElement[], targetElements: AIDiscoveredElement[], config?: ContentComparisonConfig): ContentComparison;

/**
 * Comparison Report
 *
 * Orchestrates all cross-app analysis modules to produce a unified
 * comparison report with scores, issues, and a summary.
 */

interface ComparisonReportConfig {
    /** Include component comparison (requires separate ComponentInfo arrays) */
    includeComponents: boolean;
}
declare const DEFAULT_COMPARISON_REPORT_CONFIG: ComparisonReportConfig;
/**
 * Generate a comprehensive cross-app comparison report.
 *
 * @param source - Source page semantic snapshot
 * @param target - Target page semantic snapshot
 * @param options - Optional configuration and component data
 * @returns Full comparison report with scores, issues, and summary
 */
declare function generateComparisonReport(source: SemanticSnapshot, target: SemanticSnapshot, options?: {
    config?: ComparisonReportConfig;
    sourceComponents?: ComponentInfo[];
    targetComponents?: ComponentInfo[];
}): CrossAppComparisonReport;

/**
 * Design Inspector Module
 *
 * Browser-side functions for extracting design-relevant computed styles,
 * capturing interaction state variations, and responsive snapshots.
 *
 * These functions run in the browser context and use window.getComputedStyle().
 */

/**
 * Default viewport breakpoints
 */
declare const DEFAULT_VIEWPORTS: Record<string, number>;
/**
 * Extract extended computed styles from an element.
 * Uses window.getComputedStyle() to read ~40 design-relevant CSS properties.
 */
declare function getExtendedComputedStyles(el: HTMLElement): ExtendedComputedStyles;
/**
 * Get full design data for an element, including optional pseudo-elements.
 */
declare function getElementDesignData(el: HTMLElement, opts?: {
    includePseudoElements?: boolean;
    elementId?: string;
    label?: string;
    type?: string;
}): ElementDesignData;
/**
 * Capture style variations across interaction states (hover, focus, active, disabled).
 *
 * Dispatches synthetic events to trigger state changes, reads computed styles,
 * then restores the element to its default state. All wrapped in try/finally.
 *
 * Note: This modifies element state temporarily. Should not be called during
 * user interaction.
 */
declare function captureStateVariations(el: HTMLElement, states?: InteractionStateName[]): Promise<StateStyles[]>;
/**
 * Registry-like interface for accessing registered elements
 */
interface DesignRegistryLike {
    getAllElements(): Array<{
        id: string;
        element: HTMLElement;
        type: string;
        label?: string;
    }>;
}
/**
 * Capture design snapshots at multiple viewport widths.
 *
 * Constrains `document.documentElement.style.width` per viewport to trigger
 * CSS media queries using max-width. Forces reflow, captures all elements,
 * then restores.
 *
 * Limitation: JS-based responsive logic reading window.innerWidth won't trigger.
 */
declare function captureResponsiveSnapshots(registry: DesignRegistryLike, viewports: Record<string, number> | number[]): Promise<ResponsiveSnapshot[]>;
/**
 * Compute WCAG 2.1 contrast ratio between foreground and background colors.
 * Returns a ratio like 4.5 (for 4.5:1 contrast).
 *
 * Colors should be in CSS color format (rgb, rgba, hex, or named).
 */
declare function computeContrastRatio(fgColor: string, bgColor: string): number;
/**
 * Check WCAG contrast compliance.
 * Level AA: 4.5:1 for normal text, 3:1 for large text
 * Level AAA: 7:1 for normal text, 4.5:1 for large text
 */
declare function checkContrastCompliance(fgColor: string, bgColor: string, fontSize: string, fontWeight: string): {
    ratio: number;
    passesAA: boolean;
    passesAAA: boolean;
};
/**
 * Extract CSS custom properties (--var-name) applied to an element.
 *
 * Reads inline style custom properties and walks document.styleSheets
 * for rules matching the element. Returns resolved values.
 */
declare function getCSSCustomProperties(el: HTMLElement): Record<string, string>;

/**
 * Media Queries
 *
 * Convenience query functions for common media-related searches.
 * These wrap the find() API with pre-configured media filters.
 */

/**
 * Accessibility audit result for media elements
 */
interface MediaAccessibilityAudit {
    /** Images missing alt text entirely */
    missingAlt: Array<{
        id: string;
        src?: string;
        tagName: string;
    }>;
    /** Images with generic/unhelpful alt text (e.g., "image", "photo", "img") */
    genericAlt: Array<{
        id: string;
        src?: string;
        altText: string;
    }>;
    /** Decorative images that should have empty alt but don't */
    decorativeWithoutEmptyAlt: Array<{
        id: string;
        src?: string;
        altText?: string;
    }>;
    /** Total media elements audited */
    totalAudited: number;
}
/**
 * Performance audit result for media elements
 */
interface MediaPerformanceAudit {
    /** Images where natural size is significantly larger than rendered size */
    oversized: Array<{
        id: string;
        src?: string;
        oversizeRatio: number;
        naturalWidth: number;
        naturalHeight: number;
        renderedWidth: number;
        renderedHeight: number;
    }>;
    /** Images with large transfer size (> 500KB) */
    largeTransferSize: Array<{
        id: string;
        src?: string;
        transferSize: number;
    }>;
    /** Above-the-fold images not using lazy loading (which is fine) vs below-fold not lazy */
    notLazyLoaded: Array<{
        id: string;
        src?: string;
        inViewport: boolean;
    }>;
    /** Total media elements audited */
    totalAudited: number;
}
/**
 * Create a find request with media filters
 */
declare function createMediaFindRequest(overrides?: Partial<FindRequest>): FindRequest;
/**
 * Create a find request for broken images
 */
declare function createBrokenImagesFindRequest(): FindRequest;
/**
 * Create a find request for images missing alt text
 */
declare function createMissingAltFindRequest(): FindRequest;
/**
 * Create a find request for oversized images
 */
declare function createOversizedImagesFindRequest(threshold?: number): FindRequest;
/**
 * Build an accessibility audit from a media find response
 */
declare function buildAccessibilityAudit(response: FindResponse): MediaAccessibilityAudit;
/**
 * Build a performance audit from a media find response
 */
declare function buildPerformanceAudit(response: FindResponse, oversizeThreshold?: number, largeTransferThreshold?: number): MediaPerformanceAudit;

/**
 * Media Snapshot
 *
 * On-demand visual snapshot capture and pixel-level comparison for media elements.
 * Never called during discovery — only when explicitly requested via API.
 */
/**
 * Captured media snapshot
 */
interface MediaSnapshotData {
    /** Base64-encoded image data */
    data: string;
    /** Width of the captured image */
    width: number;
    /** Height of the captured image */
    height: number;
    /** MIME type */
    mediaType: 'image/png' | 'image/svg+xml';
    /** Element ID this snapshot was taken from */
    elementId: string;
    /** Timestamp of capture */
    timestamp: number;
}
/**
 * Result of comparing two media snapshots
 */
interface MediaComparisonResult {
    /** Whether the images are identical */
    identical: boolean;
    /** Percentage of pixels that differ (0-100), or -1 if comparison not supported */
    diffPercentage: number;
    /** Bounding box of the region with differences */
    diffRegion?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Base64-encoded diff image highlighting differences in red */
    diffImage?: string;
    /** Error message if comparison could not be performed */
    error?: string;
}
/**
 * Capture a visual snapshot of a media element as a base64 PNG.
 *
 * - For <img>: draws the image onto a canvas
 * - For <video>: draws the current frame onto a canvas
 * - For <canvas>: reads directly via toDataURL
 * - For <svg>: serializes to XML and renders via Image
 *
 * @param element The media DOM element to capture
 * @param maxSize Maximum dimension (width or height) to resize to (default: 512)
 * @returns Base64 PNG data or null if capture fails
 */
declare function captureMediaSnapshot(element: HTMLElement, elementId: string, maxSize?: number): MediaSnapshotData | null;
/**
 * Compare two media snapshots pixel-by-pixel.
 *
 * Both snapshots must be base64 PNG data. Returns diff percentage and
 * optional diff image highlighting changed pixels in red.
 *
 * Note: This function is async because it needs to decode base64 images.
 */
declare function compareMediaSnapshots(a: MediaSnapshotData, b: MediaSnapshotData): Promise<MediaComparisonResult>;
/**
 * Options for capturing an arbitrary DOM element as an image.
 */
interface ElementCaptureOptions {
    /** Maximum dimension (width or height) to scale to (default: 1024) */
    maxSize?: number;
    /** Background color to render behind the element (default: 'white') */
    background?: string;
    /** Padding in pixels around the element (default: 0) */
    padding?: number;
}
/**
 * Capture any DOM element as a base64 PNG screenshot using a foreign-object SVG approach.
 *
 * This works for arbitrary elements (divs, sections, forms, etc.) — not just media elements.
 * It serializes the element's outer HTML into an SVG foreignObject, renders it to a canvas,
 * and returns the result as a base64 PNG.
 *
 * Limitations:
 * - External images may not render (tainted canvas / CORS)
 * - Some CSS features (backdrop-filter, clip-path) may not render correctly
 * - iframes and cross-origin content are excluded
 *
 * @param element The DOM element to capture
 * @param elementId The element's identifier string
 * @param options Capture options
 */
declare function captureElementScreenshot(element: HTMLElement, elementId: string, options?: ElementCaptureOptions): Promise<MediaSnapshotData | null>;
/**
 * Options for visual regression comparison.
 * Inspired by jest-image-snapshot's dual-threshold model.
 */
interface VisualRegressionOptions {
    /** Per-pixel color difference threshold (0-255). Differences below this are ignored.
     *  Helps with antialiasing and subpixel rendering. Default: 10 */
    pixelThreshold?: number;
    /** Maximum allowed percentage of differing pixels (0-100). Default: 0.1 (0.1%) */
    failureThreshold?: number;
    /** Whether failure threshold is a 'percent' of total pixels or an absolute 'pixel' count.
     *  Default: 'percent' */
    failureThresholdType?: 'percent' | 'pixel';
    /** Apply a Gaussian-like blur to both images before comparison to reduce
     *  noise from antialiasing. Radius in pixels. Default: 0 (disabled) */
    blur?: number;
}
/**
 * Result of a visual regression comparison.
 */
interface VisualRegressionResult {
    /** Whether the images pass the regression check (within thresholds) */
    pass: boolean;
    /** Number of pixels that differ beyond the pixel threshold */
    diffPixelCount: number;
    /** Percentage of pixels that differ (0-100) */
    diffPercentage: number;
    /** Total number of pixels compared */
    totalPixels: number;
    /** Bounding box of the diff region */
    diffRegion?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Base64-encoded diff image (red = different, dimmed = same) */
    diffImage?: string;
    /** Dimensions used for comparison */
    dimensions: {
        width: number;
        height: number;
    };
}
/**
 * Compare two snapshots for visual regression with configurable thresholds.
 *
 * Uses a dual-threshold model inspired by jest-image-snapshot:
 * - pixelThreshold: per-pixel color tolerance (handles antialiasing/subpixel)
 * - failureThreshold: overall tolerance for total differing pixels
 *
 * @param baseline The reference/expected snapshot
 * @param current The current/actual snapshot
 * @param options Comparison options
 */
declare function compareVisualRegression(baseline: MediaSnapshotData, current: MediaSnapshotData, options?: VisualRegressionOptions): Promise<VisualRegressionResult>;

/**
 * Media Analysis
 *
 * Captures media element visual content + structured metadata for AI vision model consumption.
 * The SDK captures and delivers image data — the calling agent (Claude Code, MCP server)
 * performs the actual inference.
 */

/**
 * AI-ready image data for a single media element
 */
interface MediaAnalysisResult {
    /** Base64 PNG image data, ready for vision LLM */
    image: {
        /** Base64-encoded PNG data */
        data: string;
        /** MIME type for LLM API */
        mediaType: 'image/png';
        /** Width of the captured image */
        width: number;
        /** Height of the captured image */
        height: number;
    };
    /** Structured context metadata for the LLM */
    context: {
        /** Element ID in the UI Bridge registry */
        elementId: string;
        /** Alt text if present */
        altText?: string;
        /** Source URL */
        src?: string;
        /** ARIA role */
        role?: string;
        /** Parent context description (e.g., "inside a card titled 'User Profile'") */
        parentContext?: string;
        /** Text labels of nearby sibling elements */
        siblingLabels?: string[];
        /** Current loading state */
        loadingState: string;
        /** Dimensions: natural and rendered */
        dimensions: {
            natural: [number, number];
            rendered: [number, number];
        };
    };
}
/**
 * Request to analyze a single media element
 */
interface MediaAnalyzeRequest {
    /** Element ID to analyze */
    elementId: string;
    /** Maximum image dimension (default: 512) */
    maxSize?: number;
}
/**
 * Request to analyze multiple media elements
 */
interface MediaAnalyzeBatchRequest {
    /** Element IDs to analyze */
    elementIds: string[];
    /** Maximum image dimension per element (default: 512) */
    maxSize?: number;
}
/**
 * Request to analyze all visible media on the page
 */
interface MediaAnalyzePageRequest {
    /** Maximum number of elements to capture (default: 20) */
    maxElements?: number;
    /** Maximum image dimension per element (default: 512) */
    maxSize?: number;
    /** Include context metadata (default: true) */
    includeContext?: boolean;
}
/**
 * Capture a media element's visual content + metadata for AI consumption.
 *
 * Returns base64 PNG image data and structured context, formatted for
 * direct use with Claude's vision API.
 */
declare function analyzeMediaElement(registeredElement: RegisteredElement, maxSize?: number): MediaAnalysisResult | null;
/**
 * Analyze multiple media elements for batch comparison.
 */
declare function analyzeMediaBatch(elements: RegisteredElement[], maxSize?: number): MediaAnalysisResult[];
/**
 * Analyze all visible media elements on the page.
 */
declare function analyzeMediaPage(allMediaElements: RegisteredElement[], maxElements?: number, maxSize?: number, includeContext?: boolean): MediaAnalysisResult[];

/**
 * Background Observer — Continuous background capture for white-box UI Bridge apps.
 *
 * Inspired by screenpipe's continuous capture, adapted for UI Bridge's rich observation.
 * Periodically captures semantic snapshots and emits them when significant changes are
 * detected. Results are intended for the activity timeline (searchable capture history).
 *
 * Unlike ChangeTracker (which is action-integrated), BackgroundObserver runs independently
 * and captures changes as they happen — even when no automation is running.
 *
 * @example
 * ```ts
 * const observer = new BackgroundObserver({
 *   snapshotManager,
 *   createControlSnapshot: () => actionExecutor.getSnapshot(),
 *   onCapture: async (payload) => {
 *     await fetch('/api/activity-timeline', { method: 'POST', body: JSON.stringify(payload) });
 *   },
 * });
 * observer.start();
 * // ... later ...
 * observer.stop();
 * ```
 */

/**
 * Payload emitted when a background capture detects meaningful changes.
 * Matches the ActivityTimelineInput structure on the Rust side.
 */
interface TimelineCapturePayload {
    /** Concatenated text from all visible elements. */
    textContent: string;
    /** SHA-256 of normalized textContent for deduplication. */
    contentHash: string;
    /** Always 'ui_bridge' for BackgroundObserver. */
    sourceType: 'ui_bridge';
    /** Always 'white_box' for UI Bridge apps. */
    captureMode: 'white_box';
    /** Application name (from page context). */
    appName: string;
    /** Window/page title. */
    windowTitle: string;
    /** Page URL. */
    url: string;
    /** Number of elements in snapshot. */
    elementCount: number;
    /** Metadata JSON (page type, form count, modal count, change summary). */
    metadataJson: string;
}
interface BackgroundObserverConfig {
    /** Minimum interval between captures in ms. Default: 5000. */
    minCaptureIntervalMs?: number;
    /** Maximum interval before forcing a capture in ms. Default: 60000. */
    maxCaptureIntervalMs?: number;
    /** Max consecutive tick failures before auto-stopping. Default: 10. */
    maxConsecutiveErrors?: number;
}
interface BackgroundObserverDeps {
    /** Snapshot manager for creating semantic snapshots. */
    snapshotManager: SemanticSnapshotManager;
    /** Factory for creating control snapshots from the registry. */
    createControlSnapshot: () => ControlSnapshot;
    /** Callback invoked when a meaningful capture is detected. */
    onCapture: (payload: TimelineCapturePayload) => Promise<void>;
}
/**
 * Continuous background observer that captures UI state changes
 * and emits them as timeline entries for the activity timeline.
 */
declare class BackgroundObserver {
    private readonly config;
    private readonly deps;
    private intervalId;
    private lastSnapshot;
    private lastContentHash;
    private lastCaptureTime;
    private running;
    private consecutiveErrors;
    constructor(deps: BackgroundObserverDeps, config?: BackgroundObserverConfig);
    /** Start background observation. */
    start(): void;
    /** Stop background observation. */
    stop(): void;
    /** Whether the observer is currently running. */
    get isRunning(): boolean;
    private tick;
    /**
     * Serialize a semantic snapshot's visible text for full-text search indexing.
     * Concatenates element descriptions, text content, form labels, and modal content.
     */
    private serializeSnapshotText;
    /**
     * Compute SHA-256 hash of normalized text.
     * Uses crypto.subtle when available (secure contexts), falls back to a
     * simple string hash for HTTP dev environments. The fallback is not
     * cryptographically secure but sufficient for deduplication.
     */
    private computeHash;
}

/**
 * wait-for — thin client for POST /ui-bridge/ai/wait-for.
 *
 * Lets tests wait for declarative UI state instead of sleeping + re-snapshotting.
 * The server polls at ~100ms cadence and returns the moment the predicate is
 * satisfied, or times out (with `timedOut: true`). Server-side hard ceiling on
 * `timeoutMs` is 30_000.
 */
type WaitForPredicate = {
    type: 'textVisible';
    text: string;
} | {
    type: 'elementVisible';
    id: string;
} | {
    type: 'elementDisappeared';
    id: string;
} | {
    type: 'snapshotChanged';
    since: number;
} | {
    type: 'elementValue';
    id: string;
    equals: string;
};
interface WaitForResult {
    satisfied: boolean;
    elapsedMs: number;
    timedOut?: boolean;
    lastError?: string;
}
interface WaitForOptions {
    /**
     * Base URL of the runner, e.g. `http://localhost:9876`. Defaults to
     * same-origin for browser callers. Required when running from Node.
     */
    baseUrl?: string;
    /** Optional fetch implementation (useful for tests). */
    fetchImpl?: typeof fetch;
    /**
     * Optional AbortSignal. If it fires before the server responds, the
     * returned promise rejects with the abort reason.
     */
    signal?: AbortSignal;
}
/**
 * Wait for `predicate` to be satisfied or until `timeoutMs` elapses.
 *
 * Returns `{ satisfied: true, elapsedMs }` on success, or
 * `{ satisfied: false, elapsedMs, timedOut: true, lastError? }` on timeout.
 *
 * @throws if the network call itself fails (non-2xx response, fetch error,
 *   abort). The timeout-without-satisfaction case is not an error — it's
 *   surfaced as `{ satisfied: false, timedOut: true }`.
 */
declare function waitFor(predicate: WaitForPredicate, timeoutMs: number, options?: WaitForOptions): Promise<WaitForResult>;

/**
 * wait-for-element — element-level state polling.
 *
 * Companion to `waitFor` (whole-page idle / textVisible / value-equals). This
 * polls the **registry** every `pollMs` until an element-state predicate flips
 * true, or `timeoutMs` elapses. Resolves `{ found, durationMs, finalState }` on
 * success, `{ found: false, durationMs, lastObservedState }` on timeout.
 *
 * The HTTP wrapper POSTs to `/ui-bridge/ai/wait-for-element` with a body
 * carrying a `state` discriminator (e.g. `"value-not-empty"`). The runner's
 * Rust handler routes by body shape — when `state` is present, it forwards to
 * the SDK runtime (`wait_for_element_state_predicate`) which evaluates the
 * predicate against the live registry. `found: false` is **NOT** an error —
 * the HTTP status stays 200, predicate result lives in `data.found`.
 *
 * The pure predicate evaluator (`evaluateElementPredicate`) is exported so
 * tests + the SDK runtime handler can share one implementation.
 */

type WaitForElementState = 'present' | 'visible' | 'enabled' | 'disabled' | 'value-not-empty' | 'value-empty' | 'checked' | 'unchecked' | 'absent';
declare const WAIT_FOR_ELEMENT_STATES: readonly WaitForElementState[];
interface WaitForElementRequest {
    /** Element registry ID. One of `elementId` / `selector` is required. */
    elementId?: string;
    /** CSS selector to query if `elementId` doesn't resolve. */
    selector?: string;
    /** Predicate to wait for. */
    state: WaitForElementState;
    /** Timeout in ms. Default 5000, max 30000. */
    timeoutMs?: number;
    /** Poll interval in ms. Default 50, min 10. */
    pollMs?: number;
}
interface WaitForElementFoundResult {
    found: true;
    durationMs: number;
    finalState: SerializedElementState;
}
interface WaitForElementTimeoutResult {
    found: false;
    durationMs: number;
    /** Last observed element state. `null` if the element was absent the whole time. */
    lastObservedState: SerializedElementState | null;
}
type WaitForElementResult = WaitForElementFoundResult | WaitForElementTimeoutResult;
/**
 * Trimmed-down element snapshot returned in the response. Mirrors the
 * registry's `RegisteredElement` + `ElementState` shape minus the live DOM
 * reference (which is not serializable).
 */
interface SerializedElementState {
    id: string;
    type?: string;
    label?: string;
    registered: boolean;
    /** True when an element was found in the registry; false for selector-only DOM matches. */
    fromRegistry: boolean;
    state: Partial<ElementState> | null;
}
interface WaitForElementOptions {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}
/**
 * Snapshot of what the element looks like at one poll instant — produced by
 * the dispatcher and fed into `evaluateElementPredicate`. Decoupled from
 * `RegisteredElement` so tests and runner code can both feed it without
 * needing a live React tree.
 */
interface ElementSnapshot {
    /** Whether the registry currently has this element. */
    registered: boolean;
    /** Live element state from `RegisteredElement.getState()`, if available. */
    state: Partial<ElementState> | null;
}
/**
 * Evaluates one of the WaitForElementState predicates against an element
 * snapshot. Pure function — no DOM, no globals, no time. Same logic the
 * runner-side handler uses on each poll tick.
 *
 * Predicate semantics (see M1 spec):
 *   - present:         registered AND has rect
 *   - visible:         registered AND visible AND rect has area
 *   - enabled:         registered AND enabled !== false
 *   - disabled:        registered AND enabled === false
 *   - value-not-empty: registered AND (value is non-empty string OR checked === true)
 *   - value-empty:     registered AND value is empty/missing
 *   - checked:         registered AND checked === true
 *   - unchecked:       registered AND (checked === false OR no checked field)
 *   - absent:          NOT registered OR visible === false
 */
declare function evaluateElementPredicate(snapshot: ElementSnapshot, predicate: WaitForElementState): boolean;
/**
 * Validate a request body against the spec. Returns `null` on success, or
 * a human-readable error string on failure. Callers map the error to HTTP
 * 400. Shared by the SDK client and (mirrored in) the runner handler.
 */
declare function validateWaitForElementRequest(body: {
    elementId?: unknown;
    selector?: unknown;
    state?: unknown;
    timeoutMs?: unknown;
    pollMs?: unknown;
}): string | null;
interface PollWaitForElementOptions {
    /** Called once per poll tick — must return the current snapshot. */
    takeSnapshot: () => ElementSnapshot;
    predicate: WaitForElementState;
    /** Resolved (clamped) timeout in ms. */
    timeoutMs: number;
    /** Resolved (clamped) poll interval in ms. */
    pollMs: number;
    /** Optional injection point for tests — defaults to `setTimeout`/`Date.now`. */
    now?: () => number;
    schedule?: (cb: () => void, ms: number) => void;
}
interface PollWaitForElementOutcome {
    found: boolean;
    durationMs: number;
    /**
     * The snapshot at the moment the predicate flipped true (on success), or
     * the most recent registered snapshot before timeout (on failure). Null if
     * the element was never registered.
     */
    observed: ElementSnapshot | null;
}
/**
 * Runs the predicate poll loop. Resolves the moment the predicate is true,
 * or `timeoutMs` after the first attempt. Tolerates the element being absent
 * → present mid-wait by tracking the last registered snapshot in
 * `lastObserved`. Caller is expected to clamp `timeoutMs`/`pollMs` to the
 * spec ranges before invoking.
 */
declare function pollWaitForElement(options: PollWaitForElementOptions): Promise<PollWaitForElementOutcome>;
/**
 * POST /ui-bridge/ai/wait-for-element. Returns the predicate outcome —
 * `found: false` on timeout is **not** thrown; HTTP 4xx/5xx is.
 */
declare function waitForElement(request: WaitForElementRequest, options?: WaitForElementOptions): Promise<WaitForElementResult>;
declare function snapshotFromRegisteredElement(el: RegisteredElement | null | undefined): ElementSnapshot;
declare function serializeSnapshot(el: RegisteredElement | null | undefined, snapshot: ElementSnapshot, fallbackId: string | undefined): SerializedElementState;

/**
 * network-probe — thin client for POST /ui-bridge/ai/network-probe.
 *
 * Performs a server-side HTTP request against a loopback destination so tests
 * can read backend state independent of the React app's polling lifecycle.
 *
 * The runner enforces a loopback-only allow-list (`127.0.0.1`, `::1`,
 * `localhost`, `*.local`). Non-loopback URLs are rejected with HTTP 400.
 */
interface NetworkProbeRequest {
    url: string;
    method?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
    body?: string;
}
interface NetworkProbeResult {
    ok: boolean;
    status?: number;
    headers?: Record<string, string>;
    body?: string;
    elapsedMs: number;
    error?: string;
}
interface NetworkProbeOptions {
    /**
     * Base URL of the runner, e.g. `http://localhost:9876`. Defaults to
     * same-origin for browser callers. Required when running from Node.
     */
    baseUrl?: string;
    /** Optional fetch implementation (useful for tests). */
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}
/**
 * Perform a server-side HTTP request against a loopback target.
 *
 * @throws if the network call to the runner itself fails, or the runner
 *   rejects the request (e.g. non-loopback host, invalid URL, non-2xx response).
 *   The target-server-failure case (e.g. connection refused to the probed
 *   backend) is not an error — it's surfaced as `{ ok: false, error: "..." }`.
 */
declare function networkProbe(request: NetworkProbeRequest, options?: NetworkProbeOptions): Promise<NetworkProbeResult>;

export { AIDiscoveredElement, AIErrorContext, ActionDiffResult, type ActionParityConfig, ActionWithDiffRequest, type AliasGeneratorConfig, type AliasGeneratorInput, BackgroundObserver, type BackgroundObserverConfig, type BackgroundObserverDeps, BookmarkStore, CategorizedDiff, ChangeBufferDrainResult, ChangePredicate, ChangeTracker, type ChangeTrackerConfig, type ChangeTrackerDeps, type ComparisonReportConfig, ComponentComparison, type ComponentComparisonConfig, ComponentInfo, ContentComparison, type ContentComparisonConfig, CrossAppComparisonReport, CrossAppDiff, type CrossAppDiffConfig, DEFAULT_ACTION_PARITY_CONFIG, DEFAULT_ALIAS_CONFIG, DEFAULT_COMPARISON_REPORT_CONFIG, DEFAULT_COMPONENT_COMPARISON_CONFIG, DEFAULT_CONTENT_COMPARISON_CONFIG, DEFAULT_CROSS_APP_DIFF_CONFIG, DEFAULT_DATA_EXTRACTION_CONFIG, DEFAULT_DIFF_CONFIG, DEFAULT_EXECUTOR_CONFIG, DEFAULT_FORMAT_ANALYSIS_CONFIG, DEFAULT_FUZZY_CONFIG, DEFAULT_LAYOUT_COMPARISON_CONFIG, DEFAULT_NAVIGATION_MAP_CONFIG, DEFAULT_REGION_SEGMENTATION_CONFIG, DEFAULT_SNAPSHOT_CONFIG, DEFAULT_TABLE_EXTRACTION_CONFIG, DEFAULT_VIEWPORTS, type DataExtractionConfig, DataType, type DesignRegistryLike, type DetectedValidationError, DiffSummaryOptions, type ElementCaptureOptions, type ElementSnapshot, type ErrorCode, ErrorCodes, type FormDiscoveryElement, type FormatAnalysisConfig, FormatDescriptor, FormatMismatch, FormsResponse, type FuzzyMatchConfig, type FuzzyMatchResult, GridStructure, InteractionParity, LayoutComparison, type LayoutComparisonConfig, ListSchema, MatchedElementPair, type MediaAccessibilityAudit, type MediaAnalysisResult, type MediaAnalyzeBatchRequest, type MediaAnalyzePageRequest, type MediaAnalyzeRequest, type MediaComparisonResult, type MediaPerformanceAudit, type MediaSnapshotData, NLActionExecutor, type NLActionExecutorConfig, NLActionRequest, NLActionResponse, type NLAssertionInput, type NLAssertionOutput, NavigationMap, type NavigationMapConfig, type NetworkProbeOptions, type NetworkProbeRequest, type NetworkProbeResult, PageContext, PageDataMap, PageRegionMap, ParsedAction, type PollWaitForElementOptions, type PollWaitForElementOutcome, RecoverySuggestion, type RegionSegmentationConfig, RegionType, SearchCriteria, SearchEngineConfig, SearchResult, SemanticDiff, type SemanticDiffConfig, SemanticDiffManager, SemanticSnapshot, type SemanticSnapshotConfig, SemanticSnapshotManager, type SerializedElementState, SnapshotBookmark, type SnapshotBookmarkEntry, StructuredChangeAnalysis, StructuredDataExtraction, type SummaryConfig, type TableExtractionConfig, TableSchema, type TimelineCapturePayload, type VisualRegressionOptions, type VisualRegressionResult, WAIT_FOR_ELEMENT_STATES, WaitForChangeOptions, type WaitForElementFoundResult, type WaitForElementOptions, type WaitForElementRequest, type WaitForElementResult, type WaitForElementState, type WaitForElementTimeoutResult, type WaitForOptions, type WaitForPredicate, type WaitForResult, __resetGlobalBookmarkStoreForTest, analyzeActionParity, analyzeFormat, analyzeMediaBatch, analyzeMediaElement, analyzeMediaPage, analyzePageFormats, analyzeStructuredChanges, areSynonyms, buildAccessibilityAudit, buildNavigationMap, buildPerformanceAudit, captureElementScreenshot, captureMediaSnapshot, captureResponsiveSnapshots, captureStateVariations, checkContrastCompliance, classifyDataType, classifyRegionType, classifyStatusDirection, compareComponents, compareContent, compareFormats, compareLayouts, compareMediaSnapshots, compareVisualRegression, computeContrastRatio, computeCrossAppDiff, computeDiff, computeProminence, createBrokenImagesFindRequest, createChangeTracker, createDiffManager, createErrorContext, createMediaFindRequest, createMissingAltFindRequest, createNLActionExecutor, createOversizedImagesFindRequest, createSimpleError, createSnapshotManager, describeAction, describeDiff, detectFormatPattern, detectGridStructure, detectList, detectTable, discoverForms, evaluateElementPredicate, extractModifiers, extractPageData, extractStructuredData, findAllMatches, findBestMatch, formatErrorContext, fuzzyContains, fuzzyMatch, generateAliases, generateComparisonReport, generateDescription, generateDiffSummary, generateElementDescription, generateNgrams, generatePageSummary, generatePurpose, generateSnapshotSummary, generateSuggestedActions, getBestRecoverySuggestion, getCSSCustomProperties, getElementDesignData, getExtendedComputedStyles, getGlobalBookmarkStore, getSynonyms, hasSignificantChanges, inferPageType, isNavigationElement, isRecoverableError, jaroSimilarity, jaroWinklerSimilarity, levenshteinDistance, levenshteinSimilarity, matchElements, networkProbe, ngramSimilarity, normalizeString, normalizeValue, parseNLAssertion, parseNLInstruction, parseNLInstructions, parseNumericValue, pollWaitForElement, scanValidationErrors, segmentPageRegions, serializeSnapshot, snapshotFromRegisteredElement, splitCompoundInstruction, tokenSimilarity, tokenize, validateParsedAction, validateWaitForElementRequest, waitFor, waitForElement, wordSimilarity };
