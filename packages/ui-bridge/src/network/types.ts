/**
 * Network Request Monitoring Types
 *
 * Types for tracking HTTP request lifecycles, filtering results,
 * and subscribing to network events.
 */

// ============================================================================
// Request/Response Status
// ============================================================================

export type NetworkRequestStatus = 'in-flight' | 'completed' | 'failed' | 'cancelled';

// ============================================================================
// Tracked Request & Response
// ============================================================================

export interface TrackedNetworkRequest {
  id: string;
  method: string;
  url: string;
  pathname?: string;
  headers?: Record<string, string>;
  bodyPreview?: string;
  startedAt: number;
  status: NetworkRequestStatus;
}

export interface TrackedNetworkResponse {
  statusCode: number;
  statusText: string;
  headers?: Record<string, string>;
  bodyPreview?: string;
  sizeBytes?: number;
  durationMs: number;
}

// ============================================================================
// Network Request Entry
// ============================================================================

export interface NetworkRequestEntry {
  request: TrackedNetworkRequest;
  response?: TrackedNetworkResponse;
  error?: string;
  requestId?: string;
  isFailure: boolean;
  completedAt?: number;
}

// ============================================================================
// Filtering
// ============================================================================

export interface NetworkRequestFilter {
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

// ============================================================================
// Wait Options
// ============================================================================

export interface WaitForRequestOptions {
  urlPattern?: string;
  urlRegex?: string;
  method?: string;
  mode?: 'existing' | 'next' | 'any';
  timeout?: number;
}

export interface WaitForRequestResult {
  entry: NetworkRequestEntry;
  timedOut: boolean;
}

// ============================================================================
// Tracker Configuration
// ============================================================================

export interface NetworkTrackerConfig {
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

// ============================================================================
// Events
// ============================================================================

export type NetworkEventType = 'request-start' | 'request-complete' | 'request-error';

export interface NetworkEvent {
  type: NetworkEventType;
  entry: NetworkRequestEntry;
  pendingCount: number;
  timestamp: number;
}

export type NetworkEventCallback = (event: NetworkEvent) => void;
