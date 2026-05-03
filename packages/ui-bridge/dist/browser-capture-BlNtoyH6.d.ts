import { ap as BrowserCaptureConfig, aq as OnBrowserEventCallback, i as AnyCapturedEvent, n as BrowserEventType, m as CapturedError, D as DetectedErrorOverlay } from './types-gR41i0Eb.js';

/**
 * Memory Trend Analyzer
 *
 * Analyzes memory snapshots over time to detect leaks and growth trends.
 * Not a capture — an analyzer that consumes memory capture events.
 */
interface MemoryTrendResult {
    trend: 'stable' | 'growing' | 'critical';
    /** Bytes per second growth rate */
    growthRate: number;
    /** Count of consecutive snapshots where heap usage increased */
    consecutiveGrowth: number;
    /** Percentage of heap limit currently in use (0-1) */
    heapUsagePercent: number;
}
declare class MemoryTrendAnalyzer {
    private snapshots;
    private latestTrend;
    addSnapshot(timestamp: number, usedJSHeapSize: number, jsHeapSizeLimit: number): MemoryTrendResult;
    getLatestTrend(): MemoryTrendResult | null;
    reset(): void;
    private analyze;
}

/**
 * Browser Event Capture Orchestrator
 *
 * Single entry point that delegates to focused sub-modules.
 * Replaces the old ConsoleCapture class with unified event capture.
 */

/**
 * Cursor response shape for the new {@link BrowserEventCapture.getConsoleRecent}
 * overload. Includes pagination (`nextSinceId`), an eviction counter
 * (`droppedCount`), and the current buffer size (`bufferedCount`).
 */
interface ConsoleRecentResponse {
    errors: CapturedError[];
    nextSinceId: number;
    droppedCount: number;
    bufferedCount: number;
}
/** Options for the new cursor-based getConsoleRecent overload. */
interface ConsoleRecentOptions {
    /** Only return entries with id > sinceId. Default 0 (return everything). */
    sinceId?: number;
    /** Max entries to return. Default 250, max 500. */
    limit?: number;
}
declare class BrowserEventCapture {
    private buffer;
    /**
     * Parallel entry buffer (event + monotonic id). Kept in lockstep with
     * `buffer` — both are always the same length, with matching indices.
     * Storing id alongside rather than on the event itself avoids mutating
     * the event object (which the capture sub-modules freeze in some cases)
     * and avoids a WeakMap allocation per push.
     */
    private entries;
    /** Monotonic counter — never reset, even on clear(). */
    private nextId;
    /** Running total of entries evicted from the buffer. */
    private droppedCount;
    private maxEntries;
    private installed;
    private cleanups;
    private onEvent;
    private config;
    private memoryTrend;
    constructor(config?: BrowserCaptureConfig);
    /**
     * Override the buffer capacity at runtime. Useful when the runner knows
     * a high error rate is expected (e.g. driving a noisy external app) and
     * the env-var path isn't available (browser context).
     *
     * If the new capacity is smaller than the current buffer length, the
     * oldest entries are trimmed immediately and counted in `droppedCount`.
     */
    setBufferCapacity(n: number): void;
    setOnEvent(cb: OnBrowserEventCallback | null): void;
    /**
     * Install all enabled capture sub-modules.
     * Safe to call multiple times (no-ops if already installed).
     */
    install(): void;
    /**
     * Uninstall all capture sub-modules.
     */
    uninstall(): void;
    reportReactError(error: Error, errorInfo: {
        componentStack?: string;
    }): void;
    reportWsStateChange(prev: string, next: string, reconnectAttempt?: number): void;
    getSince(ts: number): AnyCapturedEvent[];
    getRecent(n?: number): AnyCapturedEvent[];
    getByType(type: BrowserEventType): AnyCapturedEvent[];
    /**
     * Get console errors since a timestamp (backward-compat for ActionExecutor).
     */
    getConsoleSince(ts: number): CapturedError[];
    /**
     * Cursor-aware recent console error query.
     *
     * New callers should pass an options object to receive the full response
     * shape including `nextSinceId` (for pagination), `droppedCount` (running
     * total of evicted entries), and `bufferedCount` (current buffer size).
     *
     * @example
     *   const first = capture.getConsoleRecent({ limit: 100 });
     *   // … later …
     *   const delta = capture.getConsoleRecent({ sinceId: first.nextSinceId });
     */
    getConsoleRecent(options: ConsoleRecentOptions): ConsoleRecentResponse;
    /**
     * @deprecated Pass `{ limit: n }` instead. Retained for backward
     * compatibility with the legacy signature used by ActionExecutor and
     * direct relay handlers — returns a bare CapturedError[] so callers that
     * spread the result keep working.
     */
    getConsoleRecent(n?: number): CapturedError[];
    private _getConsoleRecentImpl;
    /**
     * Get currently visible framework error overlays (Next.js, Vite, React error boundary).
     * Returns empty array if no overlays are detected.
     */
    getFrameworkOverlays(): DetectedErrorOverlay[];
    /**
     * Get the latest memory trend analysis, if memory capture is enabled.
     */
    getMemoryTrend(): MemoryTrendResult | null;
    clear(): void;
    private trim;
}

export { BrowserEventCapture as B, MemoryTrendAnalyzer as M, type MemoryTrendResult as a };
