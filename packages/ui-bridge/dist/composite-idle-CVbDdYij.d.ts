import { C as CompositeIdleConfig, I as IdleSignal, a as CompositeIdleStatus, S as SignalStatus, b as CompositeWaitOptions, W as WaitTarget, c as SelectiveWaitOptions } from './types-BFG8zj15.js';

/**
 * Composite Idle Detector
 *
 * Aggregates multiple IdleSignal detectors into a unified idle status.
 * Individual signals remain first-class — they can be accessed, queried,
 * and waited on independently through getSignal().
 */

type CompositeTransitionCallback = (status: CompositeIdleStatus) => void;
declare class CompositeIdleDetector {
    private signals;
    private listeners;
    private lastIdle;
    private minIdleScore;
    constructor(config?: {
        minIdleScore?: number;
    });
    /**
     * Create a composite detector with default signals from config.
     */
    static create(config?: CompositeIdleConfig): CompositeIdleDetector;
    /**
     * Add a signal to the composite. Installs it and subscribes to transitions.
     */
    addSignal(signal: IdleSignal): void;
    /**
     * Remove a signal by name. Destroys it.
     */
    removeSignal(name: string): boolean;
    /**
     * Get an individual signal by name for direct access.
     */
    getSignal<T extends IdleSignal = IdleSignal>(name: string): T | undefined;
    /**
     * List all registered signal names.
     */
    getSignalNames(): string[];
    /**
     * Whether the composite considers the app idle.
     */
    isIdle(): boolean;
    /**
     * Get full composite status including per-signal breakdown.
     */
    getStatus(exclude?: string[]): CompositeIdleStatus;
    /**
     * Get the status of a single signal by name.
     */
    getSignalStatus(name: string): SignalStatus | undefined;
    /**
     * Wait for the composite to become idle.
     */
    waitForIdle(options?: CompositeWaitOptions): Promise<CompositeIdleStatus>;
    /**
     * Wait for a specific subset of signals to become idle.
     * Targets can be signal names or { indicator: '.selector' } for specific loading indicators.
     */
    waitFor(targets: WaitTarget[], options?: SelectiveWaitOptions): Promise<Record<string, SignalStatus>>;
    /**
     * Wait for a single signal by name.
     */
    waitForSignal(name: string, options?: {
        timeout?: number;
        minStableMs?: number;
    }): Promise<SignalStatus>;
    /**
     * Subscribe to composite idle/busy transitions.
     */
    onTransition(callback: CompositeTransitionCallback): () => void;
    /**
     * Install all signals. Called automatically by addSignal, but can be
     * called explicitly if signals were added without install.
     */
    installAll(): void;
    /**
     * Clean up all signals.
     */
    destroy(): void;
    private evaluate;
    private isElementVisible;
}

export { CompositeIdleDetector as C, type CompositeTransitionCallback as a };
