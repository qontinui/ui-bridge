import { i as AnyCapturedEvent, E as ErrorSeverity, n as BrowserEventType } from './types-CXCbCmRP.js';
import { c as NetworkRequestTracker } from './tracker-DpZSyunJ.js';

/**
 * Error Fingerprinting & Deduplication
 *
 * Groups identical or near-identical browser events by computing
 * a fingerprint from the error message + top stack frame.
 * 50 identical errors in a render loop become 1 error with count=50.
 */

interface FingerprintedEvent {
    /** Stable fingerprint hash for grouping */
    fingerprint: string;
    /** The representative event (first occurrence) */
    event: AnyCapturedEvent;
    /** Number of occurrences */
    count: number;
    /** First seen timestamp */
    firstSeen: number;
    /** Last seen timestamp */
    lastSeen: number;
    /** Extracted source location (file:line) if available */
    sourceLocation?: string;
}
/**
 * Extract source location (file:line) from a stack trace string.
 * Works with V8 (Chrome), SpiderMonkey (Firefox), and JavaScriptCore (Safari) stack formats.
 * Returns the first app-level frame, skipping node_modules and framework internals.
 */
declare function extractSourceLocation(stack?: string): string | undefined;
/**
 * Compute a fingerprint for an event.
 * Normalizes dynamic values (timestamps, UUIDs, hex addresses, object IDs)
 * so that the same logical error always gets the same fingerprint.
 */
declare function computeFingerprint(event: AnyCapturedEvent): string;
/**
 * Deduplicate a list of events into fingerprinted groups.
 * Events with the same fingerprint are merged: the first occurrence is kept
 * as the representative event, and the count reflects total occurrences.
 *
 * Results are ordered by first occurrence (preserving input order).
 */
declare function deduplicateEvents(events: AnyCapturedEvent[]): FingerprintedEvent[];

/**
 * Action / Error Timeline & Error Diff
 *
 * Phase 3.9 (timeline) and Phase 3.11 (error diff) from the console capture plan.
 *
 * Provides a merged, chronologically-ordered timeline of user actions
 * and browser events, plus before/after error diff computation for
 * determining which errors an action introduced or resolved.
 */

/**
 * Minimal interface for reading events from a BrowserEventCapture instance.
 * Matches the query methods on BrowserEventCapture without requiring a
 * concrete import (keeps this module decoupled).
 */
interface BrowserEventCaptureLike {
    getSince(ts: number): AnyCapturedEvent[];
    getRecent(n?: number): AnyCapturedEvent[];
    getByType(type: BrowserEventType): AnyCapturedEvent[];
}
/**
 * A browser event enriched with severity classification, fingerprint,
 * and source location extracted from its stack trace.
 */
interface ClassifiedBrowserEvent {
    event: AnyCapturedEvent;
    severity: ErrorSeverity;
    reason: string;
    fingerprint: string;
    sourceLocation?: string;
}
type TimelineEntryType = 'action' | 'browser-event';
interface ActionTimelineEntry {
    type: 'action';
    timestamp: number;
    action: string;
    targetId: string;
    targetLabel?: string;
    success: boolean;
    durationMs: number;
    /** Browser events that occurred during/after this action */
    relatedEvents: ClassifiedBrowserEvent[];
}
interface BrowserEventTimelineEntry {
    type: 'browser-event';
    timestamp: number;
    event: AnyCapturedEvent;
    severity: ErrorSeverity;
    reason: string;
    fingerprint: string;
    sourceLocation?: string;
}
type TimelineEntry = ActionTimelineEntry | BrowserEventTimelineEntry;
interface ErrorDiff {
    /** Action that was executed */
    action: string;
    targetId: string;
    /** Events that appeared after the action (not present before) */
    newEvents: ClassifiedBrowserEvent[];
    /** Events that were present before but disappeared after */
    resolvedEvents: ClassifiedBrowserEvent[];
    /** Events present both before and after */
    persistingEvents: ClassifiedBrowserEvent[];
    /** Net change in error count (positive = more errors, negative = fewer) */
    errorDelta: number;
}
interface TimelineQueryOptions {
    /** Only include entries at or after this timestamp */
    since?: number;
    /** Maximum number of entries to return */
    limit?: number;
    /** Minimum severity for browser events (actions are always included) */
    minSeverity?: ErrorSeverity;
}
/**
 * Maintains a rolling buffer of action entries and merges them with browser
 * events to produce a unified, chronologically-ordered timeline.
 */
declare class TimelineBuffer {
    private actions;
    private maxEntries;
    constructor(maxEntries?: number);
    /**
     * Record an action with its related browser events.
     * The `type` discriminator is added automatically.
     */
    recordAction(entry: Omit<ActionTimelineEntry, 'type'>): void;
    /**
     * Build a merged timeline from recorded actions and live browser events.
     *
     * Browser events are fetched from the provided capture instance, classified,
     * and interleaved chronologically with action entries.
     *
     * @param capture - A BrowserEventCapture (or compatible) instance to read events from
     * @param options - Optional filtering (since, limit, minSeverity)
     */
    getTimeline(capture: BrowserEventCaptureLike, options?: TimelineQueryOptions): TimelineEntry[];
    /**
     * Compute the error diff between two snapshots of browser events,
     * taken before and after an action.
     *
     * Uses fingerprints to determine which errors are new, resolved, or persisting.
     * `errorDelta` counts only crash and error severity events (not warnings/noise).
     */
    static computeErrorDiff(action: string, targetId: string, eventsBefore: AnyCapturedEvent[], eventsAfter: AnyCapturedEvent[]): ErrorDiff;
    /**
     * Classify and enrich a batch of raw browser events.
     *
     * For each event: computes severity, reason, fingerprint, and source location.
     */
    static classifyAndEnrich(events: AnyCapturedEvent[]): ClassifiedBrowserEvent[];
    /**
     * Clear all recorded actions.
     */
    clear(): void;
    /**
     * Current number of recorded actions.
     */
    get actionCount(): number;
    private trimActions;
}

/**
 * UI Health Score
 *
 * Computes a health assessment from recent browser events.
 * Designed for AI agents that need a quick "is the app working?" answer.
 *
 * Phase 4.14 from the console capture plan.
 */

type HealthStatus = 'healthy' | 'degraded' | 'broken';
interface HealthReport {
    /** Overall status */
    status: HealthStatus;
    /** Numeric score 0-100 (100 = perfectly healthy) */
    score: number;
    /** Human-readable summary */
    summary: string;
    /** Breakdown of recent events by severity */
    breakdown: {
        crashes: number;
        errors: number;
        warnings: number;
    };
    /** Error rate: errors per minute over the assessment window */
    errorRate: number;
    /** Most critical recent issue, if any */
    topIssue?: {
        message: string;
        severity: ErrorSeverity;
        timestamp: number;
    };
    /** Assessment window in milliseconds */
    windowMs: number;
    /** Timestamp of this assessment */
    timestamp: number;
}
interface HealthScoreConfig {
    /** Assessment window in ms (default: 60000 = 1 minute) */
    windowMs?: number;
    /** Crash events immediately set status to 'broken' (default: true) */
    crashIsBroken?: boolean;
    /** Error count threshold for 'degraded' (default: 3) */
    degradedThreshold?: number;
    /** Error count threshold for 'broken' (default: 8) */
    brokenThreshold?: number;
}
/**
 * Compute a full health report from recent browser events.
 *
 * @param capture - A BrowserEventCapture (or compatible) instance
 * @param config - Optional configuration overrides
 * @returns A complete HealthReport with status, score, summary, and breakdown
 */
declare function computeHealthReport(capture: BrowserEventCaptureLike, config?: HealthScoreConfig): HealthReport;
/**
 * Compute just the numeric health score (0-100).
 *
 * 100 = perfectly healthy, 0 = critically broken.
 */
declare function computeHealthScore(capture: BrowserEventCaptureLike, config?: HealthScoreConfig): number;
/**
 * Compute just the health status string.
 *
 * Returns 'healthy', 'degraded', or 'broken'.
 */
declare function computeHealthStatus(capture: BrowserEventCaptureLike, config?: HealthScoreConfig): HealthStatus;

/**
 * Error Sessions & Baselines
 *
 * Track errors per automation session and compare against baselines
 * to detect regressions and new issues.
 *
 * Phase 4.17 from the console capture plan.
 */

interface ErrorBaseline {
    /** Baseline label (e.g., "clean-state", "after-deploy-v2.1") */
    label: string;
    /** When the baseline was captured */
    capturedAt: number;
    /** Set of known-acceptable error fingerprints */
    fingerprints: Set<string>;
    /** Full classified events for reference */
    events: ClassifiedBrowserEvent[];
}
interface BaselineComparison {
    /** Errors in current session that are NOT in the baseline (regressions) */
    newErrors: ClassifiedBrowserEvent[];
    /** Errors in baseline that are no longer present (fixes) */
    fixedErrors: ClassifiedBrowserEvent[];
    /** Errors present in both (known issues) */
    knownErrors: ClassifiedBrowserEvent[];
    /** Whether the current state is a regression */
    isRegression: boolean;
    /** Net change in error count */
    delta: number;
}
interface ErrorSessionSummary {
    id: string;
    label?: string;
    startedAt: number;
    endedAt?: number;
    /** Total unique error fingerprints seen */
    uniqueErrorCount: number;
    /** Total event count (including duplicates) */
    totalEventCount: number;
    /** Breakdown by severity */
    bySeverity: Record<ErrorSeverity, number>;
    /** Whether any crashes occurred */
    hasCrashes: boolean;
}
declare class ErrorSession {
    readonly id: string;
    readonly label?: string;
    readonly startedAt: number;
    private endedAt?;
    private events;
    private fingerprints;
    /** Map from fingerprint to first classified event (for getUniqueEvents) */
    private uniqueByFingerprint;
    constructor(label?: string);
    /** Record an event into this session */
    recordEvent(event: AnyCapturedEvent): void;
    /** Record a batch of events */
    recordEvents(events: AnyCapturedEvent[]): void;
    /** End the session */
    end(): void;
    /** Get all unique events (one per fingerprint, first occurrence) */
    getUniqueEvents(): ClassifiedBrowserEvent[];
    /** Get all events */
    getAllEvents(): ClassifiedBrowserEvent[];
    /** Get the fingerprint set */
    getFingerprints(): Set<string>;
    /** Get session summary */
    getSummary(): ErrorSessionSummary;
    /** Compare this session against a baseline */
    compareToBaseline(baseline: ErrorBaseline): BaselineComparison;
    /** Whether the session is still active (not ended) */
    get isActive(): boolean;
}
declare class ErrorSessionManager {
    private sessions;
    private activeSession;
    private baselines;
    private maxSessions;
    constructor(maxSessions?: number);
    /** Start a new session. Ends the previous active session if any. */
    startSession(label?: string): ErrorSession;
    /** End the active session */
    endSession(): ErrorSessionSummary | null;
    /** Get the active session */
    getActive(): ErrorSession | null;
    /** Record an event into the active session (no-op if no active session) */
    recordEvent(event: AnyCapturedEvent): void;
    /** Get all session summaries */
    getSessions(): ErrorSessionSummary[];
    /** Get a specific session by ID */
    getSession(id: string): ErrorSession | null;
    /**
     * Capture a baseline from the current state.
     * Takes a BrowserEventCaptureLike to read recent events.
     */
    captureBaseline(label: string, capture: BrowserEventCaptureLike): ErrorBaseline;
    /** Get a baseline by label */
    getBaseline(label: string): ErrorBaseline | null;
    /** List all baselines */
    getBaselines(): Array<{
        label: string;
        capturedAt: number;
        fingerprintCount: number;
    }>;
    /** Delete a baseline */
    deleteBaseline(label: string): boolean;
    /**
     * Compare the active session (or recent events) against a named baseline.
     *
     * If there is an active session, compares its accumulated events.
     * Otherwise, if a capture instance is provided, compares recent events from it.
     * Returns null if the baseline does not exist or there is nothing to compare.
     */
    compareToBaseline(baselineLabel: string, capture?: BrowserEventCaptureLike): BaselineComparison | null;
}

/**
 * Network Request-Response-Error Chains
 *
 * Tracks the full lifecycle of HTTP requests, including request/response
 * bodies (size-limited), and correlates network failures with console
 * errors that occur shortly after.
 *
 * Unlike `captures/network.ts` which only captures *failures*, this tracks
 * ALL requests and correlates them with console errors.
 *
 * Two modes of operation:
 * 1. **Standalone** (default) — patches fetch/XHR directly.
 * 2. **Tracker-driven** — subscribes to a `NetworkRequestTracker` for events,
 *    eliminating redundant fetch/XHR patching when a tracker already exists.
 *
 * Implements Phase 3.10 (network chains) and Phase 4.16 (request ID correlation)
 * from the console capture plan.
 */

interface NetworkRequest {
    /** Auto-generated unique identifier */
    id: string;
    method: string;
    url: string;
    /** Selected headers only (request ID headers + content-type) */
    headers?: Record<string, string>;
    /** First N chars of request body */
    bodyPreview?: string;
    startTime: number;
}
interface NetworkResponse {
    status: number;
    statusText: string;
    /** Selected headers only (request ID headers + content-type) */
    headers?: Record<string, string>;
    /** First N chars of response body (for errors only by default) */
    bodyPreview?: string;
    durationMs: number;
}
interface NetworkChain {
    request: NetworkRequest;
    response?: NetworkResponse;
    /** Error message if the request failed at the network level */
    error?: string;
    /** Request ID extracted from response headers (X-Request-ID, X-Correlation-ID, etc.) */
    requestId?: string;
    /** Console errors that occurred within a correlation window after this request */
    correlatedErrors: CorrelatedError[];
    /** Whether this chain represents a failure (4xx/5xx/network error) */
    isFailure: boolean;
    /** Timestamp for sorting (same as request.startTime) */
    timestamp: number;
}
interface CorrelatedError {
    message: string;
    timestamp: number;
    /** How this error was correlated with the network chain */
    correlationType: 'url-mention' | 'timing' | 'request-id';
}
interface NetworkChainConfig {
    /** Max body preview length in chars (default: 500) */
    maxBodyPreview?: number;
    /** Only capture bodies for error responses (default: true) */
    errorBodiesOnly?: boolean;
    /** Correlation window in ms for linking console errors to network events (default: 200) */
    correlationWindowMs?: number;
    /** URL patterns to ignore (default: UI Bridge endpoints, dev-debug, etc.) */
    ignorePatterns?: string[];
    /** Max chains to buffer (default: 200) */
    maxChains?: number;
    /** Whether to capture request/response headers (default: false for perf) */
    captureHeaders?: boolean;
    /**
     * Optional NetworkRequestTracker to subscribe to instead of patching
     * fetch/XHR directly. When provided, install() subscribes to tracker
     * events rather than installing its own interceptors.
     */
    tracker?: NetworkRequestTracker;
}
declare class NetworkChainTracker {
    private chains;
    private config;
    private installed;
    private cleanup;
    private tracker;
    private trackerUnsubscribe;
    constructor(config?: NetworkChainConfig);
    /**
     * Install the fetch and XHR interceptors (standalone mode), or subscribe
     * to a NetworkRequestTracker (tracker-driven mode).
     * No-ops in non-browser environments (SSR / Node).
     */
    install(): void;
    /** Uninstall the fetch and XHR interceptors, restoring originals. */
    uninstall(): void;
    /** Get all chains (oldest first). */
    getAll(): NetworkChain[];
    /** Get chains with a timestamp >= `ts`. */
    getSince(ts: number): NetworkChain[];
    /** Get the most recent `n` chains (default: 50). */
    getRecent(n?: number): NetworkChain[];
    /** Get only failure chains (4xx/5xx/network errors). */
    getFailures(): NetworkChain[];
    /** Get chains whose request URL contains `pattern`. */
    getByUrl(pattern: string): NetworkChain[];
    /** Find the first chain matching a request ID (from response headers). */
    findByRequestId(requestId: string): NetworkChain | undefined;
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
    correlateErrors(events: AnyCapturedEvent[]): void;
    /** Clear all buffered chains. */
    clear(): void;
    /**
     * Subscribe to a NetworkRequestTracker's events instead of patching
     * fetch/XHR directly. Converts each completed/errored event entry into
     * a NetworkChain and pushes it to the buffer.
     */
    private installTrackerSubscription;
    /**
     * Convert a NetworkRequestEntry (from the tracker) to a NetworkChain.
     */
    private entryToChain;
    private shouldIgnore;
    /**
     * Extract a request ID from response headers.
     * Checks `REQUEST_ID_HEADERS` in priority order and returns the first match.
     */
    private extractRequestId;
    /**
     * Extract selected headers (request ID headers + content-type).
     */
    private extractSelectedHeaders;
    /**
     * Extract selected headers from a plain record (used by XHR interceptor for
     * request headers captured via setRequestHeader).
     */
    private extractSelectedHeadersFromRecord;
    /**
     * Extract a request ID from XHR response headers.
     * Uses `getResponseHeader` to check `REQUEST_ID_HEADERS` in priority order.
     */
    private extractRequestIdFromXHR;
    /**
     * Extract selected response headers from an XHR instance.
     */
    private extractSelectedHeadersFromXHR;
    private truncateBody;
    /** Trim the buffer to `maxChains`, dropping the oldest entries. */
    private trim;
}

/**
 * Error-Triggered Automatic Snapshots
 *
 * When a significant error occurs (crash or error severity), automatically
 * capture a lightweight snapshot of the app state for later investigation.
 *
 * Phase 3.12 from the console capture plan.
 */

interface ErrorSnapshotPageState {
    url: string;
    title: string;
    elementCount: number;
    /** Text from elements matching common error patterns (role="alert", .error, .toast-error) */
    visibleErrors: string[];
}
interface ErrorSnapshot {
    id: string;
    error: {
        message: string;
        severity: ErrorSeverity;
        fingerprint: string;
        sourceLocation?: string;
        stack?: string;
        timestamp: number;
    };
    pageState: ErrorSnapshotPageState;
    recentActions: string[];
    capturedAt: number;
}
interface ErrorSnapshotConfig {
    /** Maximum number of snapshots to retain (default: 20) */
    maxSnapshots?: number;
    /** Severities that trigger a snapshot (default: ['crash', 'error']) */
    triggerSeverities?: ErrorSeverity[];
    /** Only one snapshot per unique error fingerprint (default: true) */
    deduplicateByFingerprint?: boolean;
    /**
     * Callback to capture current page state.
     * The module cannot access the DOM directly since it may run in Node.
     */
    capturePageState?: () => ErrorSnapshotPageState;
    /** Callback to get recent user action descriptions */
    getRecentActions?: () => string[];
}
/**
 * Extract a human-readable message from any captured event.
 */
declare function extractMessage(event: AnyCapturedEvent): string;
/**
 * Circular buffer that captures lightweight snapshots when significant
 * errors occur. Page state is provided via callback — no DOM access.
 */
declare class ErrorSnapshotBuffer {
    private snapshots;
    private seenFingerprints;
    private readonly maxSnapshots;
    private readonly triggerSeverities;
    private readonly deduplicate;
    private readonly capturePageState;
    private readonly getRecentActions;
    constructor(config?: ErrorSnapshotConfig);
    /**
     * Process a single event. If it's significant (matches trigger severities),
     * capture a snapshot and return it. Returns null if the event is not
     * significant or is a duplicate fingerprint.
     */
    processEvent(event: AnyCapturedEvent): ErrorSnapshot | null;
    /**
     * Process a batch of events. Returns all snapshots that were captured.
     */
    processEvents(events: AnyCapturedEvent[]): ErrorSnapshot[];
    /** Get all captured snapshots */
    getAll(): ErrorSnapshot[];
    /** Get the most recent N snapshots (default: 10) */
    getRecent(n?: number): ErrorSnapshot[];
    /** Get a snapshot by its error fingerprint */
    getByFingerprint(fingerprint: string): ErrorSnapshot | undefined;
    /** Clear all snapshots and the dedup set */
    clear(): void;
    /**
     * Trim the buffer to maxSnapshots, removing the oldest entries.
     * Also prunes the fingerprint set to match remaining snapshots.
     */
    private trimBuffer;
}

export { type ActionTimelineEntry as A, type BaselineComparison as B, type ClassifiedBrowserEvent as C, extractSourceLocation as D, type ErrorSessionSummary as E, type FingerprintedEvent as F, type HealthReport as H, type NetworkChain as N, type TimelineEntry as T, type ErrorSnapshot as a, type BrowserEventCaptureLike as b, type BrowserEventTimelineEntry as c, type CorrelatedError as d, type ErrorBaseline as e, type ErrorDiff as f, ErrorSession as g, ErrorSessionManager as h, ErrorSnapshotBuffer as i, type ErrorSnapshotConfig as j, type ErrorSnapshotPageState as k, type HealthScoreConfig as l, type HealthStatus as m, type NetworkChainConfig as n, NetworkChainTracker as o, type NetworkRequest as p, type NetworkResponse as q, TimelineBuffer as r, type TimelineEntryType as s, type TimelineQueryOptions as t, computeFingerprint as u, computeHealthReport as v, computeHealthScore as w, computeHealthStatus as x, deduplicateEvents as y, extractMessage as z };
