/**
 * UI Health Score
 *
 * Computes a health assessment from recent browser events.
 * Designed for AI agents that need a quick "is the app working?" answer.
 *
 * Phase 4.14 from the console capture plan.
 */

import type { AnyCapturedEvent } from './browser-capture-types';
import type { BrowserEventCaptureLike } from './error-timeline';
import type { ErrorSeverity } from './error-severity';
import { classifyEvent, SEVERITY_RANK } from './error-severity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = 'healthy' | 'degraded' | 'broken';

export interface HealthReport {
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

export interface HealthScoreConfig {
  /** Assessment window in ms (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Crash events immediately set status to 'broken' (default: true) */
  crashIsBroken?: boolean;
  /** Error count threshold for 'degraded' (default: 3) */
  degradedThreshold?: number;
  /** Error count threshold for 'broken' (default: 8) */
  brokenThreshold?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_CRASH_IS_BROKEN = true;
const DEFAULT_DEGRADED_THRESHOLD = 3;
const DEFAULT_BROKEN_THRESHOLD = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable message from any captured event.
 */
function extractMessage(event: AnyCapturedEvent): string {
  switch (event.type) {
    case 'console':
      return event.message;
    case 'network':
      return (
        event.errorMessage ??
        `${event.method} ${event.requestUrl} → ${event.status ?? 'no response'}`
      );
    case 'react-error':
      return event.message;
    case 'resource-error':
      return `Failed to load ${event.tagName}: ${event.resourceUrl}`;
    case 'hmr':
      return event.message;
    case 'ws-disconnection':
      return `WebSocket ${event.previousState} → ${event.newState}`;
    case 'long-task':
      return `Long task: ${Math.round(event.durationMs)}ms`;
    case 'long-animation-frame':
      return `Long animation frame: ${Math.round(event.durationMs)}ms (blocking: ${Math.round(event.blockingDurationMs)}ms)`;
    case 'navigation':
      return `Navigation: ${event.from} → ${event.to}`;
    case 'web-vital':
      return `${event.metric}: ${event.value}`;
    case 'memory':
      return `Memory: ${Math.round(event.usedJSHeapSize / 1024 / 1024)}MB used`;
    case 'freeze':
      return `UI freeze: ${Math.round(event.gapMs)}ms`;
    case 'dom-metrics':
      return `DOM nodes: ${event.nodeCount}`;
    default: {
      const _exhaustive: never = event;
      return `Unknown event: ${(_exhaustive as AnyCapturedEvent).type}`;
    }
  }
}

/**
 * Format a duration in milliseconds as a human-readable string.
 */
function formatWindow(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Compute a full health report from recent browser events.
 *
 * @param capture - A BrowserEventCapture (or compatible) instance
 * @param config - Optional configuration overrides
 * @returns A complete HealthReport with status, score, summary, and breakdown
 */
export function computeHealthReport(
  capture: BrowserEventCaptureLike,
  config?: HealthScoreConfig
): HealthReport {
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
  const crashIsBroken = config?.crashIsBroken ?? DEFAULT_CRASH_IS_BROKEN;
  const degradedThreshold = config?.degradedThreshold ?? DEFAULT_DEGRADED_THRESHOLD;
  const brokenThreshold = config?.brokenThreshold ?? DEFAULT_BROKEN_THRESHOLD;

  const now = Date.now();
  const since = now - windowMs;

  // 1. Get events from the assessment window
  const events = capture.getSince(since);

  // 2. Classify each event and count by severity
  let crashes = 0;
  let errors = 0;
  let warnings = 0;

  // Track the most critical issue (lowest severity rank, most recent timestamp)
  let topIssue: HealthReport['topIssue'] | undefined;
  let topIssueRank = SEVERITY_RANK.noise + 1; // Start worse than any real severity

  for (const event of events) {
    const { severity } = classifyEvent(event);

    switch (severity) {
      case 'crash':
        crashes++;
        break;
      case 'error':
        errors++;
        break;
      case 'warning':
        warnings++;
        break;
      case 'noise':
        // Ignored for health scoring
        continue;
    }

    // Track the most critical (and most recent among equal severity) issue
    const rank = SEVERITY_RANK[severity];
    if (
      rank < topIssueRank ||
      (rank === topIssueRank && topIssue && event.timestamp >= topIssue.timestamp)
    ) {
      topIssueRank = rank;
      topIssue = {
        message: extractMessage(event),
        severity,
        timestamp: event.timestamp,
      };
    }
  }

  // 3. Compute numeric score (0-100)
  let score = 100;
  score -= crashes * 40;
  score -= errors * 10;
  score -= warnings * 2;
  score = Math.max(0, score);

  // 4. Determine status
  let status: HealthStatus;
  if (crashIsBroken && crashes > 0) {
    status = 'broken';
  } else if (errors >= brokenThreshold) {
    status = 'broken';
  } else if (errors >= degradedThreshold) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  // 5. Compute error rate (crashes + errors per minute)
  const windowMinutes = windowMs / 60_000;
  const errorRate =
    windowMinutes > 0 ? Math.round(((crashes + errors) / windowMinutes) * 100) / 100 : 0;

  // 6. Generate summary
  const windowLabel = formatWindow(windowMs);
  let summary: string;

  if (status === 'healthy') {
    if (warnings > 0) {
      summary = `Healthy: ${warnings} warning${warnings !== 1 ? 's' : ''} in the last ${windowLabel}`;
    } else {
      summary = `Healthy: no errors in the last ${windowLabel}`;
    }
  } else {
    const parts: string[] = [];
    if (crashes > 0) parts.push(`${crashes} crash${crashes !== 1 ? 'es' : ''}`);
    if (errors > 0) parts.push(`${errors} error${errors !== 1 ? 's' : ''}`);
    if (warnings > 0) parts.push(`${warnings} warning${warnings !== 1 ? 's' : ''}`);

    const statusLabel = status === 'broken' ? 'Broken' : 'Degraded';
    summary = `${statusLabel}: ${parts.join(' and ')} in the last ${windowLabel}`;
  }

  return {
    status,
    score,
    summary,
    breakdown: { crashes, errors, warnings },
    errorRate,
    ...(topIssue !== undefined ? { topIssue } : {}),
    windowMs,
    timestamp: now,
  };
}

// ---------------------------------------------------------------------------
// Convenience functions
// ---------------------------------------------------------------------------

/**
 * Compute just the numeric health score (0-100).
 *
 * 100 = perfectly healthy, 0 = critically broken.
 */
export function computeHealthScore(
  capture: BrowserEventCaptureLike,
  config?: HealthScoreConfig
): number {
  return computeHealthReport(capture, config).score;
}

/**
 * Compute just the health status string.
 *
 * Returns 'healthy', 'degraded', or 'broken'.
 */
export function computeHealthStatus(
  capture: BrowserEventCaptureLike,
  config?: HealthScoreConfig
): HealthStatus {
  return computeHealthReport(capture, config).status;
}
