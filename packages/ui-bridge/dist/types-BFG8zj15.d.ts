import { c as NetworkRequestTracker } from './tracker-DpZSyunJ.js';

/**
 * Idle Detection Types
 *
 * Types for the idle detection system. Each signal is a first-class,
 * independently-accessible detector that also feeds into a composite.
 */

/**
 * Base interface for all idle signals.
 *
 * Each signal is independently usable — it can be queried, waited on,
 * and subscribed to without going through the composite detector.
 */
interface IdleSignal<TStatus extends SignalStatus = SignalStatus> {
    /** Unique signal name, used as API path segment and event prefix */
    readonly name: string;
    /** Whether this signal currently considers the app idle */
    isIdle(): boolean;
    /** Signal-specific detailed status */
    getStatus(): TStatus;
    /** Wait for this specific signal to become idle */
    waitForIdle(options?: SignalWaitOptions): Promise<TStatus>;
    /** Subscribe to idle/busy transitions on this signal */
    onTransition(callback: SignalTransitionCallback<TStatus>): () => void;
    /** Weight when used in composite (0-1). Higher = more important. */
    readonly weight: number;
    /** Install interceptors/observers. Called once during setup. */
    install(): void;
    /** Clean up interceptors/observers. */
    destroy(): void;
}
type SignalTransitionCallback<TStatus extends SignalStatus = SignalStatus> = (idle: boolean, status: TStatus) => void;
interface SignalWaitOptions {
    /** Maximum time to wait in ms (default: 30000) */
    timeout?: number;
    /** Minimum time the signal must remain idle before resolving (default: 0) */
    minStableMs?: number;
}
/** Base status that all signals include */
interface SignalStatus {
    idle: boolean;
    timestamp: number;
}
/** Network signal status */
interface NetworkSignalStatus extends SignalStatus {
    pendingCount: number;
    pendingRequests: PendingRequest[];
}
interface PendingRequest {
    url: string;
    method: string;
    startedAt: number;
    durationMs: number;
}
/** DOM mutation settling signal status */
interface DOMSignalStatus extends SignalStatus {
    settled: boolean;
    lastMutationAt: number;
    msSinceLastMutation: number;
    recentMutationCount: number;
}
/** Loading indicator signal status */
interface LoadingIndicatorSignalStatus extends SignalStatus {
    loading: boolean;
    indicators: DetectedLoadingIndicator[];
}
interface DetectedLoadingIndicator {
    type: 'aria-busy' | 'selector' | 'animation' | 'cursor';
    selector?: string;
    element?: string;
    details?: string;
}
/** Form mutation settling signal status */
interface FormMutationSignalStatus extends SignalStatus {
    settled: boolean;
    lastMutationAt: number;
    msSinceLastMutation: number;
    recentMutationCount: number;
    activeFieldId?: string;
}
/** Animation signal status */
interface AnimationSignalStatus extends SignalStatus {
    activeCount: number;
    animations: DetectedAnimation[];
}
interface DetectedAnimation {
    name: string;
    targetElement?: string;
    durationMs?: number;
    isInfinite: boolean;
}
/** Status of an individual signal within the composite */
interface CompositeSignalEntry<TStatus extends SignalStatus = SignalStatus> {
    name: string;
    idle: boolean;
    weight: number;
    status: TStatus;
}
/** Full composite idle status */
interface CompositeIdleStatus {
    /** Whether the composite considers the app idle */
    idle: boolean;
    /** Weighted idle score (0-1) */
    idleScore: number;
    /** Individual signal statuses, keyed by signal name */
    signals: Record<string, CompositeSignalEntry>;
    timestamp: number;
}
/** Options for composite waitForIdle */
interface CompositeWaitOptions {
    /** Maximum time to wait in ms (default: 30000) */
    timeout?: number;
    /** Minimum time composite must remain idle before resolving (default: 500) */
    minStableMs?: number;
    /** Signal names to exclude from the check */
    exclude?: string[];
}
/** Options for composite waitFor (subset of signals) */
interface SelectiveWaitOptions {
    /** Maximum time to wait in ms (default: 30000) */
    timeout?: number;
    /** Minimum stable time in ms (default: 0) */
    minStableMs?: number;
}
/** A wait target: either a signal name or a specific loading indicator */
type WaitTarget = string | {
    indicator: string;
};
/** Idle-related event types */
type IdleEventType = 'app:busy' | 'app:idle' | 'network:busy' | 'network:idle' | 'network:requestStart' | 'network:requestEnd' | 'dom:mutating' | 'dom:settled' | 'loading:detected' | 'loading:cleared' | 'form:mutating' | 'form:settled' | 'animations:active' | 'animations:idle';
/** Data for network:requestStart event */
interface NetworkRequestStartData {
    url: string;
    method: string;
    pendingCount: number;
}
/** Data for network:requestEnd event */
interface NetworkRequestEndData {
    url: string;
    method: string;
    status?: number;
    durationMs: number;
    pendingCount: number;
}
/** Network idle detector configuration */
interface NetworkIdleConfig {
    /** Time with 0 pending requests before considered idle (default: 500) */
    debounceMs?: number;
    /** URL patterns to ignore (regex strings). Matches are excluded from tracking. */
    ignorePatterns?: string[];
    /** Whether to track XHR in addition to fetch (default: true) */
    trackXHR?: boolean;
    /**
     * Optional NetworkRequestTracker instance. When provided, the idle detector
     * subscribes to tracker events instead of patching fetch/XHR directly.
     * This avoids redundant fetch interception when a tracker already exists.
     */
    tracker?: NetworkRequestTracker;
}
/** DOM settling detector configuration */
interface DOMSettlingConfig {
    /** Time with no mutations before considered settled (default: 300) */
    settleMs?: number;
    /** Root element to observe (default: document.body) */
    root?: HTMLElement;
}
/** Loading indicator detector configuration */
interface LoadingIndicatorConfig {
    /** Additional CSS selectors to check for loading indicators */
    additionalSelectors?: string[];
    /** Whether to check CSS animations for loading patterns (default: true) */
    checkAnimations?: boolean;
    /** Whether to check cursor style (default: true) */
    checkCursor?: boolean;
}
/** Form mutation detector configuration */
interface FormMutationConfig {
    /** Time with no form changes before considered settled (default: 800) */
    settleMs?: number;
}
type StuckVerdict = 'stuck' | 'loading' | 'idle' | 'unknown';
interface StuckScreenEvidence {
    /** Loading indicators found in the DOM */
    loadingIndicators: DetectedLoadingIndicator[];
    /** Whether network requests are in flight */
    networkBusy: boolean;
    /** Number of pending network requests */
    pendingNetworkRequests: number;
    /** Screenshot similarity between start and end of observation (0-1). Native capture only. */
    screenshotSimilarity?: number;
    /** Whether the screenshot changed during observation. Native capture only. */
    screenshotChanged?: boolean;
    /** Whether the UI Bridge DOM signals were available */
    uiBridgeResponsive?: boolean;
    /** Whether the DOM changed meaningfully during observation. DOM mode only. */
    domChanged?: boolean;
    /** Number of DOM mutations observed during window. DOM mode only. */
    domMutationCount?: number;
    /** Composite idle score at start of observation. DOM mode only. */
    idleScoreStart?: number;
    /** Composite idle score at end of observation. DOM mode only. */
    idleScoreEnd?: number;
}
interface StuckScreenDiagnosis {
    /** The verdict: stuck, loading, idle, or unknown */
    verdict: StuckVerdict;
    /** Confidence in the verdict (0-1) */
    confidence: number;
    /** Human-readable explanation */
    summary: string;
    /** Detailed evidence supporting the verdict */
    evidence: StuckScreenEvidence;
    /** How long the observation took (ms) */
    observationWindowMs: number;
    /** Suggested recovery actions */
    suggestions: string[];
    /** Timestamp of diagnosis */
    timestamp: number;
    /** Screenshot at end of observation (base64 PNG). Native capture only. */
    screenshot?: string;
    /** Screenshot width in pixels */
    screenshotWidth?: number;
    /** Screenshot height in pixels */
    screenshotHeight?: number;
    /** Source of screenshot capture ('runner_window' or 'primary_monitor') */
    captureSource?: string;
}
interface StuckScreenConfig {
    /** Observation window in ms (default: 3000) */
    observationWindowMs?: number;
    /** DOM mutation threshold — fewer than this = "not changing" (default: 3) */
    domMutationThreshold?: number;
}
/** Composite detector configuration */
interface CompositeIdleConfig {
    /** Network detector config */
    network?: NetworkIdleConfig & {
        weight?: number;
        enabled?: boolean;
    };
    /** DOM settling config */
    dom?: DOMSettlingConfig & {
        weight?: number;
        enabled?: boolean;
    };
    /** Loading indicator config */
    loadingIndicators?: LoadingIndicatorConfig & {
        weight?: number;
        enabled?: boolean;
    };
    /** Form mutation detector config */
    formMutation?: FormMutationConfig & {
        weight?: number;
        enabled?: boolean;
    };
    /** Minimum idle score for composite to be considered idle (default: 0.7) */
    minIdleScore?: number;
}

export type { AnimationSignalStatus as A, CompositeIdleConfig as C, DOMSettlingConfig as D, FormMutationConfig as F, IdleSignal as I, LoadingIndicatorConfig as L, NetworkIdleConfig as N, PendingRequest as P, SignalStatus as S, WaitTarget as W, CompositeIdleStatus as a, CompositeWaitOptions as b, SelectiveWaitOptions as c, CompositeSignalEntry as d, DOMSignalStatus as e, DetectedAnimation as f, DetectedLoadingIndicator as g, FormMutationSignalStatus as h, IdleEventType as i, LoadingIndicatorSignalStatus as j, NetworkRequestEndData as k, NetworkRequestStartData as l, NetworkSignalStatus as m, SignalTransitionCallback as n, SignalWaitOptions as o, StuckScreenConfig as p, StuckScreenDiagnosis as q, StuckScreenEvidence as r, StuckVerdict as s };
