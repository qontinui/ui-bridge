import { I as IdleSignal, m as NetworkSignalStatus, N as NetworkIdleConfig, o as SignalWaitOptions, n as SignalTransitionCallback, e as DOMSignalStatus, D as DOMSettlingConfig, j as LoadingIndicatorSignalStatus, L as LoadingIndicatorConfig, h as FormMutationSignalStatus, F as FormMutationConfig, p as StuckScreenConfig, q as StuckScreenDiagnosis } from '../types-CNyrSSSQ.mjs';
export { A as AnimationSignalStatus, C as CompositeIdleConfig, a as CompositeIdleStatus, d as CompositeSignalEntry, b as CompositeWaitOptions, f as DetectedAnimation, g as DetectedLoadingIndicator, i as IdleEventType, k as NetworkRequestEndData, l as NetworkRequestStartData, P as PendingRequest, c as SelectiveWaitOptions, S as SignalStatus, r as StuckScreenEvidence, s as StuckVerdict, W as WaitTarget } from '../types-CNyrSSSQ.mjs';
import { c as NetworkRequestTracker } from '../tracker-DpZSyunJ.mjs';
import { C as CompositeIdleDetector } from '../composite-idle-D2i_8D8R.mjs';
export { a as CompositeTransitionCallback } from '../composite-idle-D2i_8D8R.mjs';

/**
 * Network Idle Detector
 *
 * Tracks in-flight network requests and reports idle when no requests have
 * been pending for `debounceMs`.
 *
 * Two modes of operation:
 * 1. **Standalone** (default) — patches fetch/XHR directly.
 * 2. **Tracker-driven** — subscribes to a `NetworkRequestTracker` for events,
 *    eliminating redundant fetch/XHR patching when a tracker already exists.
 */

declare class NetworkIdleDetector implements IdleSignal<NetworkSignalStatus> {
    readonly name = "network";
    readonly weight: number;
    private pending;
    private nextId;
    private idleTimer;
    private _isIdle;
    private debounceMs;
    private ignorePatterns;
    private trackXHR;
    private listeners;
    private installed;
    private originalFetch;
    private originalXHROpen;
    private originalXHRSend;
    private tracker;
    private trackerUnsubscribe;
    onRequestStart?: (data: {
        url: string;
        method: string;
        pendingCount: number;
    }) => void;
    onRequestEnd?: (data: {
        url: string;
        method: string;
        status?: number;
        durationMs: number;
        pendingCount: number;
    }) => void;
    constructor(config?: NetworkIdleConfig & {
        weight?: number;
        tracker?: NetworkRequestTracker;
    });
    install(): void;
    destroy(): void;
    isIdle(): boolean;
    getStatus(): NetworkSignalStatus;
    waitForIdle(options?: SignalWaitOptions): Promise<NetworkSignalStatus>;
    onTransition(callback: SignalTransitionCallback<NetworkSignalStatus>): () => void;
    /**
     * Subscribe to a NetworkRequestTracker's events instead of patching
     * fetch/XHR directly. The idle detector only cares about request
     * start/end — not the full request metadata.
     */
    private installTrackerSubscription;
    private shouldIgnore;
    private trackRequest;
    private completeRequest;
    private scheduleIdle;
    private notifyTransition;
    private installFetchInterceptor;
    private installXHRInterceptor;
}

/**
 * DOM Mutation Settling Detector
 *
 * Tracks DOM mutations via MutationObserver and reports "settled" when
 * no mutations have occurred for `settleMs`.
 */

declare class DOMSettlingDetector implements IdleSignal<DOMSignalStatus> {
    readonly name = "dom";
    readonly weight: number;
    private observer;
    private settleMs;
    private root;
    private lastMutationAt;
    private recentMutations;
    private settleTimer;
    private _isSettled;
    private listeners;
    private installed;
    constructor(config?: DOMSettlingConfig & {
        weight?: number;
    });
    install(): void;
    destroy(): void;
    isIdle(): boolean;
    getStatus(): DOMSignalStatus;
    waitForIdle(options?: SignalWaitOptions): Promise<DOMSignalStatus>;
    onTransition(callback: SignalTransitionCallback<DOMSignalStatus>): () => void;
    private resetSettleTimer;
    private notifyTransition;
}

/**
 * Loading Indicator Detector
 *
 * Scans the DOM for common loading patterns: aria-busy, CSS class conventions,
 * animated spinners, cursor changes, and progress elements.
 *
 * This detector is reactive — it hooks into MutationObserver to re-scan
 * only when the DOM changes, rather than polling.
 */

declare class LoadingIndicatorDetector implements IdleSignal<LoadingIndicatorSignalStatus> {
    readonly name = "loading-indicators";
    readonly weight: number;
    private selectors;
    private checkAnimations;
    private checkCursor;
    private observer;
    private _indicators;
    private _isIdle;
    private scanTimer;
    private listeners;
    private installed;
    constructor(config?: LoadingIndicatorConfig & {
        weight?: number;
    });
    install(): void;
    destroy(): void;
    isIdle(): boolean;
    getStatus(): LoadingIndicatorSignalStatus;
    waitForIdle(options?: SignalWaitOptions): Promise<LoadingIndicatorSignalStatus>;
    onTransition(callback: SignalTransitionCallback<LoadingIndicatorSignalStatus>): () => void;
    /**
     * Wait for a specific CSS selector to disappear from the loading indicators.
     */
    waitForIndicatorCleared(selector: string, timeout?: number): Promise<LoadingIndicatorSignalStatus>;
    private scan;
    private isElementVisible;
    private getElementId;
    private notifyTransition;
}

/**
 * Form Mutation Detector
 *
 * Tracks form field changes (input, change, focusin/focusout events) and
 * reports "settled" when no form mutations have occurred for `settleMs`.
 *
 * Lower weight (0.5) than network/DOM signals since form mutations are
 * user-driven and shouldn't block idle determination for network operations.
 */

declare class FormMutationDetector implements IdleSignal<FormMutationSignalStatus> {
    readonly name = "form-mutation";
    readonly weight: number;
    private settleMs;
    private lastMutationAt;
    private recentMutations;
    private settleTimer;
    private _isSettled;
    private activeFieldId;
    private listeners;
    private installed;
    private handleInput;
    private handleChange;
    private handleFocusIn;
    private handleFocusOut;
    constructor(config?: FormMutationConfig & {
        weight?: number;
    });
    install(): void;
    destroy(): void;
    isIdle(): boolean;
    getStatus(): FormMutationSignalStatus;
    waitForIdle(options?: SignalWaitOptions): Promise<FormMutationSignalStatus>;
    onTransition(callback: SignalTransitionCallback<FormMutationSignalStatus>): () => void;
    private isFormElement;
    private onFormEvent;
    private onFocusIn;
    private onFocusOut;
    private resetSettleTimer;
    private notifyTransition;
}

/**
 * Element Stability Wait
 *
 * Watches a single HTMLElement for visual and DOM stability. Resolves when
 * no MutationObserver mutations AND no bounding-box changes have occurred
 * for `quietMs` milliseconds, or resolves with `stable: false` on timeout.
 */
interface ElementSettlingOptions {
    /** Milliseconds of quiet (no mutations, no bbox changes) before resolving. Default 500. */
    quietMs?: number;
    /** Overall timeout in milliseconds. Default 5000. */
    timeout?: number;
    /** Observe attribute changes on the element. Default true. */
    observeAttributes?: boolean;
    /** Observe subtree mutations. Default false (avoids false timeouts from child mutations). */
    observeSubtree?: boolean;
}
interface ElementSettlingResult {
    stable: boolean;
    elapsed: number;
}
/**
 * Wait until an element is visually and structurally stable.
 *
 * "Stable" means: no DOM mutations on the element (per MutationObserver)
 * AND no bounding-box changes (per requestAnimationFrame polling) for at
 * least `quietMs` consecutive milliseconds.
 *
 * Resolves with `{ stable: true, elapsed }` on success or
 * `{ stable: false, elapsed }` on timeout — never rejects.
 */
declare function waitForElementStable(element: HTMLElement, options?: ElementSettlingOptions): Promise<ElementSettlingResult>;

/**
 * Stuck Screen Detector
 *
 * On-demand diagnostic that determines whether an application is stuck on a
 * loading screen. Works by taking two snapshots separated by an observation
 * window and comparing signals: if loading indicators are present but the DOM
 * hasn't changed and the network is idle, the app is stuck.
 *
 * This is general-purpose — it does not know about any specific app. It relies
 * on the existing LoadingIndicatorDetector, DOMSettlingDetector, and
 * NetworkIdleDetector signals via the CompositeIdleDetector.
 */

declare class StuckScreenDetector {
    private detector;
    private observationWindowMs;
    private domMutationThreshold;
    constructor(detector: CompositeIdleDetector, config?: StuckScreenConfig);
    /**
     * Run a stuck-screen diagnosis.
     *
     * Takes two snapshots separated by the observation window and compares them
     * to determine if the app is stuck, loading normally, idle, or in an
     * ambiguous state.
     */
    diagnose(): Promise<StuckScreenDiagnosis>;
    private captureSnapshot;
    private describeIndicators;
}

export { CompositeIdleDetector, DOMSettlingConfig, DOMSettlingDetector, DOMSignalStatus, type ElementSettlingOptions, type ElementSettlingResult, FormMutationConfig, FormMutationDetector, FormMutationSignalStatus, IdleSignal, LoadingIndicatorConfig, LoadingIndicatorDetector, LoadingIndicatorSignalStatus, NetworkIdleConfig, NetworkIdleDetector, NetworkSignalStatus, SignalTransitionCallback, SignalWaitOptions, StuckScreenConfig, StuckScreenDetector, StuckScreenDiagnosis, waitForElementStable };
