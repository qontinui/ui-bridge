import { am as DiscoveredElement, as as RegisteredElement, at as ElementState, G as SearchCriteria, H as SearchResponse, au as SearchResult, av as FormState, an as AIDiscoveredElement } from './types-gR41i0Eb.js';

/**
 * Search Engine
 *
 * Multi-strategy element search using text, role, accessibility,
 * spatial proximity, and fuzzy matching.
 */

/**
 * Configuration for the search engine
 */
interface SearchEngineConfig {
    /** Default fuzzy threshold */
    fuzzyThreshold: number;
    /** Weight for text matching */
    textWeight: number;
    /** Weight for accessibility matching */
    accessibilityWeight: number;
    /** Weight for role matching */
    roleWeight: number;
    /** Weight for spatial matching */
    spatialWeight: number;
    /** Weight for alias matching */
    aliasWeight: number;
    /** Maximum results to return */
    maxResults: number;
    /** Include hidden elements */
    includeHidden: boolean;
}
/**
 * Default search engine configuration
 */
declare const DEFAULT_SEARCH_CONFIG: SearchEngineConfig;
/**
 * Search Engine class
 */
declare class SearchEngine {
    private config;
    private cachedElements;
    private cacheTimestamp;
    private readonly cacheValidityMs;
    constructor(config?: Partial<SearchEngineConfig>);
    /**
     * Update cached elements from various sources
     */
    updateElements(elements: Array<DiscoveredElement | RegisteredElement>, getState?: (el: RegisteredElement) => ElementState): void;
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
    getCachedElementSummaries(): Array<{
        id: string;
        type: string;
    }>;
    /**
     * Convert an element to searchable format
     */
    private toSearchable;
    /**
     * Search for elements matching the criteria
     */
    search(criteria: SearchCriteria, elements?: Array<DiscoveredElement | RegisteredElement>): SearchResponse;
    /**
     * Find the best matching element
     */
    findBest(criteria: SearchCriteria, elements?: Array<DiscoveredElement | RegisteredElement>): SearchResult | null;
    /**
     * Find elements by text content
     */
    findByText(text: string, fuzzy?: boolean, elements?: Array<DiscoveredElement | RegisteredElement>): SearchResult[];
    /**
     * Find elements by role
     */
    findByRole(role: string, name?: string, elements?: Array<DiscoveredElement | RegisteredElement>): SearchResult[];
    /**
     * Find elements by accessible name
     */
    findByAccessibleName(name: string, elements?: Array<DiscoveredElement | RegisteredElement>): SearchResult[];
    /**
     * Find elements near another element
     */
    findNear(referenceId: string, criteria?: SearchCriteria, elements?: Array<DiscoveredElement | RegisteredElement>): SearchResult[];
    /**
     * Find elements within a container
     */
    findWithin(containerId: string, criteria?: SearchCriteria, elements?: Array<DiscoveredElement | RegisteredElement>): SearchResult[];
    /**
     * Score an element against search criteria
     */
    private scoreElement;
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
    private scoreTextMatch;
    /**
     * Score contains match
     */
    private scoreContainsMatch;
    /**
     * Score accessibility match
     */
    private scoreAccessibilityMatch;
    /**
     * Score role match
     */
    private scoreRoleMatch;
    /**
     * Score spatial match (proximity to another element)
     */
    private scoreSpatialMatch;
    /**
     * Calculate distance between two element rectangles
     */
    private calculateDistance;
    /**
     * Score alias match
     */
    private scoreAliasMatch;
    /**
     * Score containment match (is this element inside the specified container?)
     */
    private scoreContainmentMatch;
    /**
     * Resolve the nearest semantic container for an element.
     * Walks up the DOM tree looking for forms, dialogs, nav, sections, etc.
     */
    private resolveParentContext;
    /**
     * Known icon class patterns → semantic meaning
     */
    private static readonly ICON_CLASS_MAP;
    /**
     * Infer aliases from icon CSS classes for icon-only elements.
     */
    private inferIconAliases;
    /**
     * Match a string against a pattern (supports * wildcard)
     */
    private matchPattern;
    /**
     * Convert searchable element to AI discovered element
     */
    private toAIDiscoveredElement;
    /**
     * Infer a semantic type for the element
     */
    private inferSemanticType;
}
/**
 * Create a default search engine instance
 */
declare function createSearchEngine(config?: Partial<SearchEngineConfig>): SearchEngine;

/**
 * Form Diff Tracking
 *
 * Utilities for snapshotting form state and computing diffs between snapshots.
 * Useful for AI verification: snapshot before an action, snapshot after, diff to
 * see what the action changed.
 */

/**
 * A point-in-time capture of all form state on the page.
 */
interface FormSnapshot {
    /** All forms detected at snapshot time */
    forms: FormState[];
    /** Timestamp when the snapshot was captured */
    timestamp: number;
}
/**
 * Describes how a single form field changed between two snapshots.
 */
interface FormFieldDiff {
    /** The field ID */
    fieldId: string;
    /** The field label (human-readable name) */
    fieldName?: string;
    /** The field input type (e.g. "text", "checkbox", "select") */
    fieldType: string;
    /** Property-level changes */
    changes: {
        value?: {
            before: string;
            after: string;
        };
        checked?: {
            before: boolean;
            after: boolean;
        };
        selectedOptions?: {
            before: string[];
            after: string[];
        };
        validationError?: {
            before: string | undefined;
            after: string | undefined;
        };
        isDirty?: {
            before: boolean;
            after: boolean;
        };
        isValid?: {
            before: boolean;
            after: boolean;
        };
    };
}
/**
 * The result of comparing two form snapshots.
 */
interface FormDiff {
    /** Fields that changed between snapshots */
    changedFields: FormFieldDiff[];
    /** Field IDs added (present in after but not before) */
    addedFields: string[];
    /** Field IDs removed (present in before but not after) */
    removedFields: string[];
    /** Form IDs added between snapshots */
    formsAdded: string[];
    /** Form IDs removed between snapshots */
    formsRemoved: string[];
    /** Human-readable summary */
    summary: string;
    /** Time between snapshots in milliseconds */
    timeDeltaMs: number;
    /** Whether any changes were detected */
    hasChanges: boolean;
}
/**
 * Capture current form state as a snapshot.
 *
 * Queries all form elements and input/textarea/select elements from the DOM
 * and builds FormState objects. Designed to run in a browser environment.
 */
declare function captureFormSnapshot(): FormSnapshot;
/**
 * Compare two form snapshots and return the differences.
 *
 * Matches forms by ID and fields by field ID. Detects value changes,
 * validation state changes, dirty state changes, and added/removed
 * forms and fields.
 */
declare function diffFormSnapshots(before: FormSnapshot, after: FormSnapshot): FormDiff;
/**
 * Generate a human-readable summary of form changes.
 */
declare function summarizeFormDiff(diff: FormDiff): string;

/**
 * Target Description Decomposer
 *
 * Decomposes natural language element descriptions into structured components
 * for the search engine. Extracts element type, spatial relationships,
 * container context, ordinals, and state filters from free-form text.
 *
 * Examples:
 *   "close button near Terminal 1 tab"
 *   → { elementText: "close", elementType: "button", spatial: { relation: "near", referenceDescription: "Terminal 1 tab" } }
 *
 *   "the email input in the login form"
 *   → { elementText: "email", elementType: "input", container: "login form" }
 *
 *   "third item in the list"
 *   → { elementText: "item", container: "list", ordinal: 3 }
 *
 *   "Advanced details toggle"
 *   → { elementText: "Advanced", elementType: "disclosure" }
 *
 * Element-type recognition is driven by a single synonym table
 * (`ELEMENT_TYPE_SYNONYMS`). Multi-word phrases beat single words, so adding a
 * new family (or extending an existing one) is a one-line edit and naturally
 * resolves precedence ("details toggle" → disclosure, before "toggle" → switch).
 */
/**
 * Spatial relationship between elements
 */
type SpatialRelation = 'near' | 'above' | 'below' | 'leftOf' | 'rightOf' | 'inside';
/**
 * Decomposed target description
 */
interface DecomposedTarget {
    /** Core text to match against element content/labels */
    elementText: string;
    /** Element type hint extracted from description */
    elementType?: string;
    /** Spatial relationship to another element */
    spatial?: {
        relation: SpatialRelation;
        referenceDescription: string;
    };
    /** Container context (e.g., "the login form", "sidebar") */
    container?: string;
    /** Ordinal position (1-based) */
    ordinal?: number;
    /** State filter */
    stateFilter?: 'disabled' | 'enabled' | 'active' | 'selected' | 'checked' | 'focused' | 'hidden' | 'visible';
    /** Query value also probed against `<label>` text (for/wrapping). */
    label?: string;
    /** Query value also probed against `aria-label`. */
    ariaLabel?: string;
    /** Query value also probed against `placeholder` (input/textarea). */
    placeholder?: string;
    /** Query value also probed against the `name` attribute. */
    name?: string;
    /**
     * @internal — true when `elementType` came from a soft-hint synonym
     * (e.g., "toggle" → switch, "details" → disclosure). Consumers like
     * `find.ts` use this flag to retry a label-only search if the
     * type-constrained search returns nothing. Not part of the stable
     * external contract; external clients should ignore it.
     */
    __softTypeHint?: boolean;
}
/**
 * Decompose a natural language target description into structured components.
 */
declare function decomposeTarget(description: string): DecomposedTarget;

/**
 * Unified Find API
 *
 * High-level natural language element finder that combines:
 * - Target description decomposition
 * - Two-pass spatial reference resolution
 * - Modal-aware scoring
 * - Container scoping
 * - Disambiguation for ambiguous matches
 *
 * Usage:
 *   const result = find("close button near Terminal 1 tab", engine);
 *   const result = find({ text: "save", role: "button" }, engine);
 */

/**
 * Context for scoping and biasing search results
 */
interface FindContext {
    /** ID of the currently active modal (elements inside it get priority) */
    activeModalId?: string;
    /** ID of the element last interacted with (for recency bias) */
    lastInteractedElement?: string;
    /** Current page section hint (e.g., "sidebar", "settings") */
    sectionHint?: string;
}
/**
 * Options for the find operation
 */
interface FindOptions {
    /** Context for scoping and biasing */
    context?: FindContext;
    /** If true, always return the best match even when ambiguous (default: true) */
    pickFirst?: boolean;
    /** Minimum confidence threshold (default: 0.5) */
    confidenceThreshold?: number;
    /** Maximum results to return in ambiguous case (default: 5) */
    maxResults?: number;
    /**
     * If true, populate `FindResultNotFound.alternatives` with the closest
     * sub-threshold candidates so callers can see which elements were
     * considered but scored below the confidence gate. Behind a flag because
     * generating the diagnostic requires an extra search pass with a relaxed
     * threshold and inflates response size — production callers stay lean.
     */
    debug?: boolean;
}
/**
 * Successful find result
 */
interface FindResultMatch {
    found: true;
    ambiguous: false;
    /** The matched element */
    element: AIDiscoveredElement;
    /** Element ID for use with action APIs */
    elementId: string;
    /** Match confidence 0-1 */
    confidence: number;
    /** Human-readable reasons for the match */
    matchReasons: string[];
    /** Other candidates that were considered */
    alternatives: FindCandidate[];
    /** Decomposed query (useful for debugging) */
    decomposed: DecomposedTarget;
    /** Search duration in ms */
    durationMs: number;
}
/**
 * Ambiguous find result (multiple high-confidence matches)
 */
interface FindResultAmbiguous {
    found: true;
    ambiguous: true;
    /** Top candidates with differentiators */
    candidates: FindCandidate[];
    /** Human-readable suggestion for disambiguation */
    suggestion: string;
    /** Decomposed query (useful for debugging) */
    decomposed: DecomposedTarget;
    /** Search duration in ms */
    durationMs: number;
}
/**
 * No match found
 */
interface FindResultNotFound {
    found: false;
    ambiguous: false;
    /** Why no match was found */
    reason: string;
    /** Partial matches that were below the find-API threshold but still
     *  cleared the underlying engine's fuzzy gate. Always populated when any
     *  element scored above the engine's internal floor. */
    partialMatches: FindCandidate[];
    /** How many elements were considered before filtering. Helps agents
     *  distinguish "searched 200 elements, none matched" from "searched
     *  10 elements (snapshot truncated / auto-register incomplete)". */
    consideredCount: number;
    /** Decomposed query (useful for debugging) */
    decomposed: DecomposedTarget;
    /** Search duration in ms */
    durationMs: number;
    /**
     * Top-3 closest candidates with sub-threshold scores. Populated only when
     * the caller passed `debug: true` in `FindOptions`. Differs from
     * `partialMatches` in that it relaxes the engine's internal fuzzy gate to
     * surface candidates that scored *anything* > 0, so agents can see "we
     * considered element X with placeholder Y but it scored 0.12 — far below
     * the 0.5 threshold". Sorted by confidence descending.
     */
    alternatives?: FindCandidate[];
}
type FindResult = FindResultMatch | FindResultAmbiguous | FindResultNotFound;
/**
 * A candidate element with disambiguation info
 */
interface FindCandidate {
    /** The element */
    element: AIDiscoveredElement;
    /** Element ID */
    elementId: string;
    /** Match confidence */
    confidence: number;
    /** Match reasons */
    matchReasons: string[];
    /** Human-readable differentiator (e.g., "in the sidebar", "in the dialog") */
    differentiator: string;
}
/**
 * Find an element by natural language description or structured criteria.
 *
 * @param query - Natural language string or structured SearchCriteria
 * @param engine - The search engine to use
 * @param options - Find options (context, thresholds, etc.)
 */
declare function find(query: string | SearchCriteria, engine: SearchEngine, options?: FindOptions): FindResult;

export { DEFAULT_SEARCH_CONFIG as D, type FindContext as F, SearchEngine as S, type FindResult as a, type FormSnapshot as b, type FormDiff as c, type DecomposedTarget as d, type FindCandidate as e, type FindOptions as f, type FindResultAmbiguous as g, type FindResultMatch as h, type FindResultNotFound as i, type FormFieldDiff as j, type SearchEngineConfig as k, type SpatialRelation as l, captureFormSnapshot as m, createSearchEngine as n, decomposeTarget as o, diffFormSnapshots as p, find as q, summarizeFormDiff as s };
