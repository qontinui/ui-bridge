/**
 * Error Severity Classification
 *
 * Classifies browser events into severity levels so AI agents
 * can focus on what matters and ignore noise.
 *
 * Severity hierarchy: crash > error > warning > noise
 */

import type { AnyCapturedEvent } from './browser-capture-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorSeverity = 'crash' | 'error' | 'warning' | 'noise';

export interface ClassifiedEvent {
  event: AnyCapturedEvent;
  severity: ErrorSeverity;
  /** Short reason for the classification */
  reason: string;
}

// ---------------------------------------------------------------------------
// Severity ordering (used by filterBySeverity)
// ---------------------------------------------------------------------------

export const SEVERITY_RANK: Record<ErrorSeverity, number> = {
  crash: 0,
  error: 1,
  warning: 2,
  noise: 3,
};

// ---------------------------------------------------------------------------
// Noise patterns
// ---------------------------------------------------------------------------

/**
 * Configurable noise patterns that should be suppressed.
 * Users can extend this set via custom classifiers or by appending to the array.
 * Matching is case-sensitive substring matching against the event message.
 */
export const DEFAULT_NOISE_PATTERNS: string[] = [
  // React dev mode noise
  'Warning: Each child in a list should have a unique',
  "Warning: Can't perform a React state update on an unmounted",
  'Warning: componentWillMount has been renamed',
  'Warning: componentWillReceiveProps has been renamed',
  'Warning: componentWillUpdate has been renamed',
  'Warning: Using UNSAFE_componentWillMount',
  'Warning: Using UNSAFE_componentWillReceiveProps',
  'Warning: Using UNSAFE_componentWillUpdate',
  'Warning: findDOMNode is deprecated',
  'Warning: Legacy context API has been detected',
  // React StrictMode double-render artifacts
  'Warning: Strict Mode',
  // HMR lifecycle (normal dev workflow, not errors)
  'Fast Refresh',
  '[HMR]',
  '[vite] connected',
  '[vite] hot updated',
  // Browser extensions (not our code)
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  // Common benign warnings
  'Download the React DevTools',
  'Download the Apollo DevTools',
  'React does not recognize the',
  'Unknown event handler property',
  // ResizeObserver (fires frequently, almost never a real bug)
  'ResizeObserver loop',
  'ResizeObserver loop completed with undelivered notifications',
  // Source map warnings
  'DevTools failed to load source map',
  'Could not load content for',
];

/**
 * Check if a message matches any noise pattern.
 */
function matchesNoisePattern(
  message: string,
  patterns: string[] = DEFAULT_NOISE_PATTERNS
): boolean {
  return patterns.some((pattern) => message.includes(pattern));
}

// ---------------------------------------------------------------------------
// Critical endpoint patterns (network errors on these are crashes)
// ---------------------------------------------------------------------------

const CRITICAL_ENDPOINT_PATTERNS = [
  '/api/v1/auth/',
  '/api/v1/organizations/',
  '/_next/data/',
  '/graphql',
];

function isCriticalEndpoint(url: string): boolean {
  return CRITICAL_ENDPOINT_PATTERNS.some((pattern) => url.includes(pattern));
}

// ---------------------------------------------------------------------------
// Common asset 404 patterns (these are warnings, not errors)
// ---------------------------------------------------------------------------

const COMMON_ASSET_PATTERNS = [
  '/favicon',
  '.ico',
  '/manifest.json',
  '/robots.txt',
  '/sitemap',
  '/apple-touch-icon',
  '.map',
];

function isCommonAsset404(url: string): boolean {
  return COMMON_ASSET_PATTERNS.some((pattern) => url.includes(pattern));
}

// ---------------------------------------------------------------------------
// Per-type classifiers
// ---------------------------------------------------------------------------

function classifyConsole(event: AnyCapturedEvent & { type: 'console' }): {
  severity: ErrorSeverity;
  reason: string;
} {
  // Noise check first (applies to all levels)
  if (matchesNoisePattern(event.message)) {
    return { severity: 'noise', reason: 'matches noise pattern' };
  }

  switch (event.level) {
    case 'unhandledrejection':
      return { severity: 'crash', reason: 'unhandled promise rejection' };
    case 'error':
      return { severity: 'error', reason: 'console.error' };
    case 'warn':
      return { severity: 'warning', reason: 'console.warn' };
    default: {
      const _exhaustive: never = event.level;
      return { severity: 'warning', reason: `console.${_exhaustive}` };
    }
  }
}

function classifyNetwork(event: AnyCapturedEvent & { type: 'network' }): {
  severity: ErrorSeverity;
  reason: string;
} {
  const status = event.status;

  // Network-level failures (no response at all)
  if (event.kind === 'network-error' || event.kind === 'timeout') {
    if (isCriticalEndpoint(event.requestUrl)) {
      return { severity: 'crash', reason: `${event.kind} on critical endpoint` };
    }
    return { severity: 'error', reason: event.kind };
  }

  // CORS errors
  if (event.kind === 'cors') {
    return { severity: 'error', reason: 'CORS error' };
  }

  // Aborted requests are usually intentional (component unmount, navigation)
  if (event.kind === 'abort') {
    return { severity: 'noise', reason: 'aborted request' };
  }

  // HTTP status-based classification
  if (status !== undefined) {
    if (status >= 500) {
      if (isCriticalEndpoint(event.requestUrl)) {
        return { severity: 'crash', reason: `${status} on critical endpoint` };
      }
      return { severity: 'error', reason: `HTTP ${status}` };
    }
    if (status === 404 && isCommonAsset404(event.requestUrl)) {
      return { severity: 'noise', reason: '404 for common asset' };
    }
    if (status >= 400) {
      return { severity: 'warning', reason: `HTTP ${status}` };
    }
  }

  return { severity: 'warning', reason: 'network issue' };
}

function classifyReactError(_event: AnyCapturedEvent & { type: 'react-error' }): {
  severity: ErrorSeverity;
  reason: string;
} {
  // React error boundaries always indicate a crash
  return { severity: 'crash', reason: 'React error boundary' };
}

function classifyResourceError(event: AnyCapturedEvent & { type: 'resource-error' }): {
  severity: ErrorSeverity;
  reason: string;
} {
  const tag = event.tagName.toLowerCase();

  // Script load failures are real errors (app may be broken)
  if (tag === 'script') {
    return { severity: 'error', reason: 'script load failed' };
  }

  // Link (stylesheet) failures affect rendering
  if (tag === 'link') {
    return { severity: 'error', reason: 'stylesheet load failed' };
  }

  // Image/video/audio failures are usually non-fatal
  if (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'source') {
    return { severity: 'warning', reason: `${tag} load failed` };
  }

  return { severity: 'warning', reason: `${tag} resource load failed` };
}

function classifyHmr(event: AnyCapturedEvent & { type: 'hmr' }): {
  severity: ErrorSeverity;
  reason: string;
} {
  if (event.level === 'error') {
    return { severity: 'error', reason: 'HMR compilation error' };
  }
  return { severity: 'warning', reason: 'HMR warning' };
}

function classifyWsDisconnection(event: AnyCapturedEvent & { type: 'ws-disconnection' }): {
  severity: ErrorSeverity;
  reason: string;
} {
  // Reconnect attempts after the first are noise (expected backoff behavior)
  if (event.reconnectAttempt !== undefined && event.reconnectAttempt > 0) {
    return { severity: 'noise', reason: `reconnect attempt ${event.reconnectAttempt}` };
  }
  return { severity: 'warning', reason: 'WebSocket disconnection' };
}

function classifyLongTask(event: AnyCapturedEvent & { type: 'long-task' }): {
  severity: ErrorSeverity;
  reason: string;
} {
  if (event.durationMs < 100) {
    return { severity: 'noise', reason: 'short long-task (<100ms)' };
  }
  if (event.durationMs >= 500) {
    return { severity: 'warning', reason: `long task ${Math.round(event.durationMs)}ms` };
  }
  return {
    severity: 'noise',
    reason: `long task ${Math.round(event.durationMs)}ms (under threshold)`,
  };
}

function classifyLoaf(event: AnyCapturedEvent & { type: 'long-animation-frame' }): {
  severity: ErrorSeverity;
  reason: string;
} {
  if (event.blockingDurationMs >= 200) {
    return {
      severity: 'warning',
      reason: `long animation frame blocking ${Math.round(event.blockingDurationMs)}ms`,
    };
  }
  return { severity: 'noise', reason: 'long animation frame (low blocking duration)' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a single event's severity.
 *
 * Classification rules:
 * - **crash**: React error boundary, unhandled rejection, network errors on critical endpoints
 * - **error**: console.error (not noise), network 5xx, script/stylesheet load failures, HMR errors
 * - **warning**: console.warn (not noise), network 4xx, image load failures, WS disconnection,
 *   long tasks >= 500ms, long animation frames with high blocking duration
 * - **noise**: Noise-pattern matches, long tasks < 100ms, navigation, memory, web vitals,
 *   HMR reconnect messages, aborted requests, WS reconnect attempts
 */
export function classifyEvent(event: AnyCapturedEvent): {
  severity: ErrorSeverity;
  reason: string;
} {
  switch (event.type) {
    case 'console':
      return classifyConsole(event);
    case 'network':
      return classifyNetwork(event);
    case 'react-error':
      return classifyReactError(event);
    case 'resource-error':
      return classifyResourceError(event);
    case 'hmr':
      return classifyHmr(event);
    case 'ws-disconnection':
      return classifyWsDisconnection(event);
    case 'long-task':
      return classifyLongTask(event);
    case 'long-animation-frame':
      return classifyLoaf(event);
    case 'navigation':
      return { severity: 'noise', reason: 'navigation event' };
    case 'web-vital':
      return { severity: 'noise', reason: 'web vital metric' };
    case 'memory':
      return { severity: 'noise', reason: 'memory snapshot' };
    case 'freeze':
      return event.gapMs >= 5000
        ? { severity: 'error', reason: `UI freeze ${Math.round(event.gapMs)}ms` }
        : { severity: 'warning', reason: `UI freeze ${Math.round(event.gapMs)}ms` };
    case 'dom-metrics':
      return event.nodeCount > 50000
        ? { severity: 'warning', reason: `high DOM node count: ${event.nodeCount}` }
        : { severity: 'noise', reason: 'DOM metrics snapshot' };
    default: {
      const _exhaustive: never = event;
      return {
        severity: 'noise',
        reason: `unhandled type: ${(_exhaustive as AnyCapturedEvent).type}`,
      };
    }
  }
}

/**
 * Classify a batch of events with their severity and reason.
 */
export function classifyEvents(events: AnyCapturedEvent[]): ClassifiedEvent[] {
  return events.map((event) => {
    const { severity, reason } = classifyEvent(event);
    return { event, severity, reason };
  });
}

/**
 * Filter events to only those at or above a minimum severity.
 *
 * Severity order: crash > error > warning > noise
 *
 * Examples:
 * - `filterBySeverity(events, 'warning')` returns crash + error + warning events
 * - `filterBySeverity(events, 'error')` returns crash + error events
 * - `filterBySeverity(events, 'noise')` returns all events (everything is at least noise)
 */
export function filterBySeverity(
  events: AnyCapturedEvent[],
  minSeverity: ErrorSeverity
): AnyCapturedEvent[] {
  const minRank = SEVERITY_RANK[minSeverity];
  return events.filter((event) => {
    const { severity } = classifyEvent(event);
    return SEVERITY_RANK[severity] <= minRank;
  });
}
