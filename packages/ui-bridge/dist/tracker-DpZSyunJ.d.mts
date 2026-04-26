/**
 * Network Request Monitoring Types
 *
 * Types for tracking HTTP request lifecycles, filtering results,
 * and subscribing to network events.
 */
type NetworkRequestStatus = 'in-flight' | 'completed' | 'failed' | 'cancelled';
interface TrackedNetworkRequest {
    id: string;
    method: string;
    url: string;
    pathname?: string;
    headers?: Record<string, string>;
    bodyPreview?: string;
    startedAt: number;
    status: NetworkRequestStatus;
}
interface TrackedNetworkResponse {
    statusCode: number;
    statusText: string;
    headers?: Record<string, string>;
    bodyPreview?: string;
    sizeBytes?: number;
    durationMs: number;
}
interface NetworkRequestEntry {
    request: TrackedNetworkRequest;
    response?: TrackedNetworkResponse;
    error?: string;
    requestId?: string;
    isFailure: boolean;
    completedAt?: number;
}
interface NetworkRequestFilter {
    status?: NetworkRequestStatus | NetworkRequestStatus[];
    method?: string | string[];
    urlPattern?: string;
    urlRegex?: string;
    failuresOnly?: boolean;
    since?: number;
    limit?: number;
    minStatus?: number;
    maxStatus?: number;
}
interface WaitForRequestOptions {
    urlPattern?: string;
    urlRegex?: string;
    method?: string;
    mode?: 'existing' | 'next' | 'any';
    timeout?: number;
}
interface WaitForRequestResult {
    entry: NetworkRequestEntry;
    timedOut: boolean;
}
interface NetworkTrackerConfig {
    /** URL patterns to ignore (substring match). */
    ignorePatterns?: string[];
    /** Maximum number of completed entries to retain (default: 200). */
    maxEntries?: number;
    /** Whether to intercept XMLHttpRequest in addition to fetch (default: true). */
    trackXHR?: boolean;
    /** Maximum characters to capture for body previews (default: 500). */
    maxBodyPreview?: number;
    /** Only capture response bodies for error responses (default: true). */
    errorBodiesOnly?: boolean;
    /** Whether to capture request/response headers (default: true). */
    captureHeaders?: boolean;
}
type NetworkEventType = 'request-start' | 'request-complete' | 'request-error';
interface NetworkEvent {
    type: NetworkEventType;
    entry: NetworkRequestEntry;
    pendingCount: number;
    timestamp: number;
}
type NetworkEventCallback = (event: NetworkEvent) => void;

/**
 * Network Request Tracker
 *
 * Intercepts fetch() and XMLHttpRequest to track the full lifecycle of HTTP
 * requests: in-flight tracking, response capture (status, headers, body preview),
 * filtering, and event subscription.
 *
 * Modeled after:
 * - `NetworkChainTracker` (fetch interception, body previews, request ID extraction)
 * - `NetworkIdleDetector` (XHR patching, install/destroy lifecycle, event callbacks)
 */

declare class NetworkRequestTracker {
    private config;
    private inFlight;
    private completed;
    private listeners;
    private installed;
    private requestCounter;
    private originalFetch;
    private originalXHROpen;
    private originalXHRSend;
    constructor(config?: NetworkTrackerConfig);
    /** Patch fetch and optionally XHR to begin tracking requests. */
    install(): void;
    /** Restore original fetch/XHR and clear all state. */
    destroy(): void;
    /** Return all currently in-flight request entries. */
    getInFlight(): NetworkRequestEntry[];
    /** Return completed request entries, optionally filtered. */
    getCompleted(filter?: NetworkRequestFilter): NetworkRequestEntry[];
    /** Return all entries (in-flight + completed), optionally filtered. */
    getAll(filter?: NetworkRequestFilter): NetworkRequestEntry[];
    /** Look up a single entry by its unique ID. */
    getById(id: string): NetworkRequestEntry | undefined;
    /**
     * Wait for a matching network request to complete.
     *
     * Modes:
     * - `existing` — only check currently in-flight requests.
     * - `next` — ignore existing, wait for the next matching request.
     * - `any` (default) — check in-flight first, then recently completed, then wait.
     */
    waitForRequest(options?: WaitForRequestOptions): Promise<WaitForRequestResult>;
    /** Subscribe to network events. Returns an unsubscribe function. */
    onEvent(callback: NetworkEventCallback): () => void;
    /** Clear the completed entries buffer (in-flight entries are preserved). */
    clear(): void;
    private installFetchInterceptor;
    private installXHRInterceptor;
    private shouldIgnore;
    private generateId;
    private extractHeaders;
    private captureBodyPreview;
    private captureResponsePreview;
    private extractRequestId;
    private extractRequestIdFromXHR;
    private parseXHRResponseHeaders;
    private trimCompleted;
    private emitEvent;
    private matchesFilter;
    private applyFilter;
    private matchesWaitOptions;
}

export { type NetworkTrackerConfig as N, type TrackedNetworkRequest as T, type WaitForRequestOptions as W, type NetworkRequestEntry as a, type WaitForRequestResult as b, NetworkRequestTracker as c, type NetworkEvent as d, type NetworkEventCallback as e, type NetworkEventType as f, type NetworkRequestFilter as g, type NetworkRequestStatus as h, type TrackedNetworkResponse as i };
