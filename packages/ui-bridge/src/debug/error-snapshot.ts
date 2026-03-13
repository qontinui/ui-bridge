/**
 * Error-Triggered Automatic Snapshots
 *
 * When a significant error occurs (crash or error severity), automatically
 * capture a lightweight snapshot of the app state for later investigation.
 *
 * Phase 3.12 from the console capture plan.
 */

import type { AnyCapturedEvent } from './browser-capture-types';
import type { ErrorSeverity } from './error-severity';
import { classifyEvent } from './error-severity';
import { computeFingerprint, extractSourceLocation } from './error-fingerprint';
import { getEventStack } from './shared-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorSnapshotPageState {
  url: string;
  title: string;
  elementCount: number;
  /** Text from elements matching common error patterns (role="alert", .error, .toast-error) */
  visibleErrors: string[];
}

export interface ErrorSnapshot {
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

export interface ErrorSnapshotConfig {
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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SNAPSHOTS = 20;
const DEFAULT_TRIGGER_SEVERITIES: ErrorSeverity[] = ['crash', 'error'];
const DEFAULT_DEDUPLICATE = true;

const EMPTY_PAGE_STATE: ErrorSnapshotPageState = {
  url: '',
  title: '',
  elementCount: 0,
  visibleErrors: [],
};

// ---------------------------------------------------------------------------
// Public helper: extract message from any captured event
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable message from any captured event.
 */
export function extractMessage(event: AnyCapturedEvent): string {
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

// ---------------------------------------------------------------------------
// ErrorSnapshotBuffer
// ---------------------------------------------------------------------------

/**
 * Circular buffer that captures lightweight snapshots when significant
 * errors occur. Page state is provided via callback — no DOM access.
 */
export class ErrorSnapshotBuffer {
  private snapshots: ErrorSnapshot[] = [];
  private seenFingerprints = new Set<string>();

  private readonly maxSnapshots: number;
  private readonly triggerSeverities: Set<ErrorSeverity>;
  private readonly deduplicate: boolean;
  private readonly capturePageState: (() => ErrorSnapshotPageState) | undefined;
  private readonly getRecentActions: (() => string[]) | undefined;

  constructor(config?: ErrorSnapshotConfig) {
    this.maxSnapshots = config?.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
    this.triggerSeverities = new Set(config?.triggerSeverities ?? DEFAULT_TRIGGER_SEVERITIES);
    this.deduplicate = config?.deduplicateByFingerprint ?? DEFAULT_DEDUPLICATE;
    this.capturePageState = config?.capturePageState;
    this.getRecentActions = config?.getRecentActions;
  }

  /**
   * Process a single event. If it's significant (matches trigger severities),
   * capture a snapshot and return it. Returns null if the event is not
   * significant or is a duplicate fingerprint.
   */
  processEvent(event: AnyCapturedEvent): ErrorSnapshot | null {
    const { severity } = classifyEvent(event);

    // Only trigger on configured severities
    if (!this.triggerSeverities.has(severity)) {
      return null;
    }

    const fingerprint = computeFingerprint(event);

    // Deduplicate: skip if we already have a snapshot for this fingerprint
    if (this.deduplicate && this.seenFingerprints.has(fingerprint)) {
      return null;
    }

    // Build the snapshot
    const stack = getEventStack(event);
    const snapshot: ErrorSnapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      error: {
        message: extractMessage(event),
        severity,
        fingerprint,
        sourceLocation: extractSourceLocation(stack),
        stack,
        timestamp: event.timestamp,
      },
      pageState: this.capturePageState?.() ?? EMPTY_PAGE_STATE,
      recentActions: this.getRecentActions?.() ?? [],
      capturedAt: Date.now(),
    };

    // Store and trim
    this.snapshots.push(snapshot);
    this.seenFingerprints.add(fingerprint);
    this.trimBuffer();

    return snapshot;
  }

  /**
   * Process a batch of events. Returns all snapshots that were captured.
   */
  processEvents(events: AnyCapturedEvent[]): ErrorSnapshot[] {
    const results: ErrorSnapshot[] = [];
    for (const event of events) {
      const snapshot = this.processEvent(event);
      if (snapshot !== null) {
        results.push(snapshot);
      }
    }
    return results;
  }

  /** Get all captured snapshots */
  getAll(): ErrorSnapshot[] {
    return [...this.snapshots];
  }

  /** Get the most recent N snapshots (default: 10) */
  getRecent(n = 10): ErrorSnapshot[] {
    return this.snapshots.slice(-n);
  }

  /** Get a snapshot by its error fingerprint */
  getByFingerprint(fingerprint: string): ErrorSnapshot | undefined {
    return this.snapshots.find((s) => s.error.fingerprint === fingerprint);
  }

  /** Clear all snapshots and the dedup set */
  clear(): void {
    this.snapshots = [];
    this.seenFingerprints.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Trim the buffer to maxSnapshots, removing the oldest entries.
   * Also prunes the fingerprint set to match remaining snapshots.
   */
  private trimBuffer(): void {
    if (this.snapshots.length <= this.maxSnapshots) return;

    // Remove oldest snapshots
    this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);

    // Rebuild the fingerprint set from remaining snapshots
    // (removed fingerprints should be eligible for re-capture)
    this.seenFingerprints.clear();
    for (const snapshot of this.snapshots) {
      this.seenFingerprints.add(snapshot.error.fingerprint);
    }
  }
}
