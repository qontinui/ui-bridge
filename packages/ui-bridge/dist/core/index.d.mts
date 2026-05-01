import { as as RegisteredElement, at as ElementState, ar as UIBridgeRegistry, ca as ElementType } from '../types-DHAgZgSv.mjs';
export { b2 as AccessibilityIssue, b3 as AccessibilityReport, b4 as AccessibilitySeverity, b5 as ActionBrowserEvent, b7 as ActionErrorCode, b8 as ActionErrorDiff, ba as ActionFailureDetails, bb as ActionHandler, A as ActionRequest, d as ActionResponse, bd as AriaCheckedState, bh as BranchCondition, e as BridgeEvent, bi as BridgeEventListener, B as BridgeEventType, c as BridgeSnapshot, m as CapturedError, bu as ComponentAction, bx as ComponentStateResponse, by as ComputedProperty, bC as ContentMetadata, bD as ContentRole, bE as ContentType, bL as CustomAction, bO as DEFAULT_REMOUNT_CACHE_WINDOW_MS, bZ as ElementAccessibility, b_ as ElementAssertionFailure, b$ as ElementAssertionResult, c0 as ElementAssertionSpec, c1 as ElementBbox, ag as ElementDesignData, c4 as ElementEventLogConfig, c6 as ElementFingerprintData, r as ElementHistoryOptions, c7 as ElementIdentifier, s as ElementLogEntry, c8 as ElementLogLevel, ce as ExtendedComputedStyles, cf as ExtendedWorkflowStep, cg as ExtractConfig, cj as FillAction, ck as FillFieldResult, j as FillResult, ah as InteractionStateName, cI as LogConfig, cK as LoopConfig, cM as MediaMetadata, cN as MediaType, N as NavigationResult, cY as NormalizedRect, d1 as PartialMatch, P as PathResult, d2 as PseudoElementStyles, d5 as RecoveryAction, d8 as RegisteredComponent, da as RepeatPatternData, aj as ResponsiveSnapshot, dq as SnapshotEnricher, dr as SnapshotEnrichers, dt as SnapshotRegistrationMetadata, dv as StandardAction, dw as StateGetter, S as StateSnapshot, ai as StateStyles, dz as StyleDiff, T as TransitionResult, t as UIBridgeConfig, dI as UIBridgeFeatures, U as UIState, p as UIStateGroup, q as UITransition, dQ as WCAGLevel, dR as WSChangeEventMessage, W as WSClientConfig, f as WSClientMessage, dS as WSClientMessageType, a as WSConnectionState, dT as WSDiscoverMessage, dU as WSErrorMessage, dV as WSEventMessage, dW as WSExecuteActionMessage, dX as WSExecuteComponentActionMessage, dY as WSExecuteWorkflowMessage, dZ as WSFindMessage, d_ as WSGetElementHistoryMessage, d$ as WSGetElementMessage, e0 as WSGetSnapshotMessage, e1 as WSMessageBase, e2 as WSPingMessage, e3 as WSPongMessage, e4 as WSRecordingAutoSaveMessage, e5 as WSRecordingRecoverMessage, e6 as WSRecordingStartMessage, e7 as WSRecordingStatusMessage, e8 as WSRecordingStopMessage, e9 as WSResponseMessage, ea as WSServerMessage, eb as WSServerMessageType, ec as WSSubscribeMessage, ed as WSSubscribedMessage, b as WSSubscriptionOptions, ee as WSUnsubscribeMessage, ef as WSUnsubscribedMessage, eg as WSWelcomeMessage, eh as WSWorkflowProgressMessage, ek as WaitOptions, en as Workflow, eq as WorkflowStep, er as WorkflowStepType, ev as computeAllFingerprints, ew as computeElementFingerprint, ex as computeFingerprintsWithMapping, ez as findNearestRegisteredElement, eB as getGlobalRegistry, eD as serializeRegisteredElement } from '../types-DHAgZgSv.mjs';
export { C as ChangeObserver, a as ChangeObserverConfig } from '../change-observer-Cd5EpcSy.mjs';
export { U as UIBridgeWSClient, c as createWSClient } from '../websocket-client-DXyn4Zfr.mjs';
export { D as DOMChangeEvent } from '../types-CBDaGbY1.mjs';
import '../types-CNyrSSSQ.mjs';
import '../tracker-DpZSyunJ.mjs';
import '../render-log/index.mjs';
import '../find-DUWiL8ES.mjs';
import '../style-types-B81kmWSf.mjs';
import '../types-C7D5seeQ.mjs';
import '../error-snapshot-CV--kPt-.mjs';

/**
 * Chainable Query DSL for UI Bridge
 *
 * Inspired by AirtestProject/Poco's fluent query API.
 * Provides a builder pattern for composing element queries with
 * parent/child/sibling traversal and attribute filtering.
 *
 * Usage:
 *   const q = UIQuery.from(registry);
 *   const btn = q.withRole('button').withText('Submit').first();
 *   const items = q.select('[data-testid="list"]').children().withRole('listitem').all();
 */

/**
 * Result of a query — a registered element with its current state.
 */
interface QueryResult {
    /** The registered element */
    element: RegisteredElement;
    /** Current element state (snapshot at query time) */
    state: ElementState;
    /** The underlying DOM element */
    domElement: HTMLElement;
}
/**
 * Chainable query builder for traversing and filtering UI Bridge elements.
 *
 * All filter methods (withText, withRole, etc.) return a new UIQuery instance,
 * keeping the original immutable. Terminal methods (first, all, count) execute
 * the query and return results.
 */
declare class UIQuery {
    private readonly registry;
    private readonly resolveElements;
    private constructor();
    /**
     * Create a query starting from all mounted elements in the registry.
     */
    static from(registry: UIBridgeRegistry): UIQuery;
    /**
     * Start from elements matching a CSS selector.
     */
    select(selector: string): UIQuery;
    /**
     * Get direct children of each element in the current set.
     */
    children(): UIQuery;
    /**
     * Get the direct parent of each element in the current set.
     */
    parent(): UIQuery;
    /**
     * Get all descendants matching an optional CSS selector.
     * Without a selector, returns all descendant HTMLElements.
     */
    descendants(selector?: string): UIQuery;
    /**
     * Get direct siblings (previous + next) of each element in the current set.
     */
    siblings(): UIQuery;
    /**
     * Find descendants matching a CSS selector (alias for descendants with required selector).
     */
    find(selector: string): UIQuery;
    /**
     * Walk up the DOM tree to find the closest ancestor matching a selector.
     */
    closest(selector: string): UIQuery;
    /**
     * Filter to elements whose visible text contains the given string (case-insensitive).
     */
    withText(text: string): UIQuery;
    /**
     * Filter to elements whose visible text matches exactly (case-insensitive).
     */
    withExactText(text: string): UIQuery;
    /**
     * Filter to elements with a specific ARIA or HTML role.
     */
    withRole(role: string): UIQuery;
    /**
     * Filter to elements with a specific ElementType in the registry.
     */
    withType(type: ElementType): UIQuery;
    /**
     * Filter to elements having a specific attribute, optionally with a specific value.
     */
    withAttr(name: string, value?: string): UIQuery;
    /**
     * Filter to elements with a specific data-testid.
     */
    withTestId(testId: string): UIQuery;
    /**
     * Filter to elements that are currently visible in the viewport.
     */
    visible(): UIQuery;
    /**
     * Filter to elements that are enabled (not disabled).
     */
    enabled(): UIQuery;
    /**
     * Filter with a custom predicate on the DOM element.
     */
    filter(predicate: (el: HTMLElement) => boolean): UIQuery;
    /**
     * Limit the result set to the first N elements.
     */
    limit(n: number): UIQuery;
    /**
     * Get the element at a specific index (0-based). Returns a single-element query.
     */
    at(index: number): UIQuery;
    /**
     * Execute the query and return the first matching registered element, or undefined.
     */
    first(): QueryResult | undefined;
    /**
     * Execute the query and return all matching elements that are registered in the registry.
     * Unregistered DOM elements are excluded.
     */
    all(): QueryResult[];
    /**
     * Execute the query and return all matching DOM elements, including unregistered ones.
     * Use this when you need to traverse DOM structure beyond registered elements.
     */
    allDom(): HTMLElement[];
    /**
     * Return the count of matching registered elements.
     */
    count(): number;
    /**
     * Return the count of matching DOM elements (including unregistered).
     */
    countDom(): number;
    /**
     * Check if any matching registered element exists.
     */
    exists(): boolean;
}

/** Accept cache if younger than `ms` milliseconds, otherwise fetch. */
declare function MaxAge(ms: number): Recency;
/**
 * Recency Model for Snapshot Freshness Control
 *
 * Inspired by folk-js/allio's Recency enum. Lets callers specify freshness
 * requirements per-request instead of relying on a flat TTL.
 *
 * - `Any`        — accept any cached value (zero-latency hot path)
 * - `Current`    — always fetch fresh from the browser
 * - `MaxAge(ms)` — accept cache if younger than `ms`, otherwise fetch
 */
type Recency = {
    readonly kind: 'any';
} | {
    readonly kind: 'current';
} | {
    readonly kind: 'maxAge';
    readonly ms: number;
};
declare const Recency: {
    readonly Any: {
        readonly kind: "any";
    };
    readonly Current: {
        readonly kind: "current";
    };
    readonly MaxAge: typeof MaxAge;
    readonly Default: Recency;
};
/** Does the cached value (aged `ageMs`) satisfy this recency requirement? */
declare function isSatisfiedBy(recency: Recency, ageMs: number): boolean;
/** Will this recency *always* require a fetch (i.e. `Current`)? */
declare function requiresFetch(recency: Recency): boolean;
/** Could this recency require a fetch depending on cache age? */
declare function mightRequireFetch(recency: Recency): boolean;
/**
 * Parse a Recency value from HTTP query params or request body.
 *
 * Accepted formats:
 *   - `"any"`     → Recency.Any
 *   - `"current"` → Recency.Current
 *   - `"2000"`    → Recency.MaxAge(2000)
 *   - absent/null → Recency.Default  (MaxAge 5000 — backward-compatible)
 */
declare function parseRecency(value: string | number | undefined | null): Recency;

/**
 * Stable Element References
 *
 * Provides stable references to UI elements that survive React re-renders,
 * unmount/remount cycles, and DOM mutations. A StableElementRef captures
 * multiple identification strategies so the element can be resolved even
 * after its DOM node has been replaced.
 *
 * Resolution order:
 *   1. primaryId lookup in the registry
 *   2. data-ui-bridge-id DOM attribute query
 *   3. fingerprint match via findNearestRegisteredElement
 *   4. semanticPath traversal (CSS selector)
 */

/**
 * A stable reference to a UI element that can survive React re-renders.
 *
 * Contains multiple identification strategies so the element can be
 * resolved even after its DOM node has been replaced.
 */
interface StableElementRef {
    /** Current transient ID (changes on re-render) */
    id: string;
    /** Strategy used to generate the primaryId (e.g. 'prefer-existing', 'semantic') */
    idStrategy: string;
    /** The element's registered ID at time of creation */
    primaryId: string;
    /** Content-based fingerprint hash (survives re-renders) */
    fingerprint: string;
    /** Semantic path through the component tree (e.g., "App>Sidebar>NavItem[2]") */
    semanticPath: string;
    /** data-ui-bridge-id from DOM if present (highest priority for resolution) */
    stableId?: string;
    /** Timestamp (ms) when this ref was last confirmed to resolve */
    lastSeenAt: number;
}
/**
 * Create a StableElementRef for a registered element.
 *
 * Captures the element's ID, fingerprint hash, and semantic path
 * so it can be resolved later even after DOM replacement.
 */
declare function createStableRef(element: RegisteredElement): StableElementRef;
/**
 * Resolve a StableElementRef back to a live RegisteredElement.
 *
 * Tries resolution strategies in order:
 *   1. Direct ID lookup in the registry
 *   2. DOM query for data-ui-bridge-id attribute
 *   3. Fingerprint match across all registered elements
 *   4. Semantic path CSS selector traversal
 *
 * Returns null if no strategy finds a match.
 */
declare function resolveStableRef(ref: StableElementRef): RegisteredElement | null;

/**
 * Structured NL-disambiguation query
 *
 * Given a snapshot (or any array of findable elements) and either a free-text
 * query or a structured filter object, returns ranked candidates by token-bag
 * scoring over the element's label, type, variant, position, color, and
 * contextPath fields.
 *
 * This replaces the VLM-for-disambiguation use case that the platform-scope
 * refinement (see `proj_platform_scope_split`) took off the table. When an
 * NL query like *"the red destructive Save at bottom-right"* matches
 * multiple elements by label alone, the disambiguation metadata fields
 * (set via `useUIElement`) rank the intended one without pixel inspection.
 *
 * Design notes:
 *
 * - **Pure function, no registry coupling.** Takes an array of serialized
 *   elements (snapshot shape). Works against `BridgeSnapshot.elements`,
 *   `ControlSnapshot.elements`, and any future mirror — we only read the
 *   subset of fields listed in {@link FindableElement}.
 * - **Token-bag scoring, no hardcoded keyword lists.** Design systems use
 *   their own variant/color/position tokens; a fixed "red/blue/green" list
 *   would prevent "accent" or "#ef4444" from working. Every query token is
 *   compared to every metadata field; matches accumulate score weighted by
 *   field importance.
 * - **No LLM involvement.** Deterministic, synchronous, cheap. If an LLM
 *   rerank is ever needed for tie-breaking, the caller can feed the top
 *   candidates back to one — but most queries are unambiguous once tokens
 *   overlap correctly.
 * - **Order is stable.** Ties break on visibility first, then registration
 *   order (input order of the `elements` array), so repeated calls return
 *   the same ranking.
 */
/**
 * Minimal element shape consumed by {@link findElements}. Matches the
 * serialized entries in both `BridgeSnapshot.elements` and
 * `ControlSnapshot.elements`.
 */
interface FindableElement {
    id: string;
    type?: string;
    label?: string;
    variant?: string;
    position?: string;
    color?: string;
    contextPath?: string;
    origin?: 'hook' | 'auto';
    visible?: boolean;
    /** Passthrough — callers may include arbitrary extra fields. */
    [key: string]: unknown;
}
/** Structured query shape. All fields optional; at least one must be provided. */
interface ElementQuery {
    /** Free-text query — tokens overlap against every metadata field. */
    text?: string;
    /** Exact type filter (hard constraint). */
    type?: string;
    /** Variant hint. Matched as a token; caller can repeat in `text` too. */
    variant?: string;
    /** Positional hint. */
    position?: string;
    /** Color hint. */
    color?: string;
    /** Context-path prefix (substring match against the element's contextPath). */
    contextPathContains?: string;
    /** Restrict to hook-registered, auto-registered, or either. Default: either. */
    origin?: 'hook' | 'auto';
    /** Only return candidates flagged `visible: true`. Default: false (both). */
    visibleOnly?: boolean;
    /** Maximum results to return. Default: 10. */
    limit?: number;
    /** Drop candidates with score below this. Default: 0 (keep any match). */
    minScore?: number;
}
interface ElementMatch {
    /** The element's stable id. */
    id: string;
    /** The element entry from the snapshot. */
    element: FindableElement;
    /** Total score (higher = better). */
    score: number;
    /** Which fields contributed, for debugging. */
    reasons: string[];
}
/**
 * Find and rank elements matching the given query.
 *
 * @param elements  Serialized snapshot elements.
 * @param query     Either a free-text string or a structured {@link ElementQuery}.
 *                  A plain string is treated as `{ text: <string> }`.
 * @returns Ranked matches, highest score first. Empty array if no element
 *          passes hard filters or scores above `minScore`.
 */
declare function findElements(elements: readonly FindableElement[], query: ElementQuery | string): ElementMatch[];

/**
 * SVG-safe helpers for reading an element's class string.
 *
 * Background: `Element.className` is typed as `string` on HTMLElement but as
 * `SVGAnimatedString` on SVGElement / MathMLElement. Calling `.split`,
 * `.toLowerCase`, `.trim`, etc. directly on `el.className` throws when the
 * element is an SVG/MathML node. Always route class-string reads through
 * these helpers.
 *
 * Writes (`el.className = '...'`) are fine via the native DOM API and do not
 * need this helper.
 */
/**
 * Safely extract the class string from an element, handling both HTML
 * (string className) and SVG/MathML (SVGAnimatedString).
 *
 * Returns `''` for null/undefined elements or when className is unset.
 */
declare function classString(el: Element | null | undefined): string;
/**
 * Convenience: `classString(el)` split on whitespace, empty strings filtered.
 * Prefer `el.classList` when available — only use this when you need the
 * raw token array for string matching (e.g., `.some(c => c.startsWith('btn-'))`).
 */
declare function classList(el: Element | null | undefined): string[];

export { type ElementMatch, type ElementQuery, ElementState, ElementType, type FindableElement, type QueryResult, Recency, Recency as RecencyType, RegisteredElement, type StableElementRef, UIBridgeRegistry, UIQuery, classList, classString, createStableRef, findElements, isSatisfiedBy, mightRequireFetch, parseRecency, requiresFetch, resolveStableRef };
