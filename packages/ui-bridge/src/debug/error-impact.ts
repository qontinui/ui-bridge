/**
 * Error Impact Assessment
 *
 * Determines whether an error actually affected the UI by comparing
 * UI state snapshots before and after the error occurred.
 *
 * Phase 4.15 from the console capture plan.
 *
 * This module is DOM-agnostic — all UI state is provided via the
 * `captureUIState` callback in the config.
 */

import type { AnyCapturedEvent } from './browser-capture-types';
import type { ErrorSeverity } from './error-severity';
import { classifyEvent } from './error-severity';
import { computeFingerprint } from './error-fingerprint';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UIConsequences {
  /** Element IDs that disappeared after the error */
  elementsRemoved: string[];
  /** New elements that appeared (e.g., error boundary fallback) */
  elementsAdded: string[];
  /** Elements that became disabled after the error */
  elementsDisabled: string[];
  /** Unexpected navigation destination, if any */
  navigationTriggered?: string;
  /** Entire component tree crashed (e.g., white screen) */
  renderBlocked: boolean;
  /** React error boundary caught the error */
  errorBoundaryTriggered: boolean;
}

export interface ErrorImpact {
  error: {
    message: string;
    severity: ErrorSeverity;
    fingerprint: string;
    timestamp: number;
  };
  uiConsequences: UIConsequences;
  recoveryStatus: 'recovered' | 'degraded' | 'fatal' | 'unknown';
  assessedAt: number;
}

export interface UIStateSnapshot {
  /** Set of registered element IDs */
  elementIds: Set<string>;
  /** Subset that are disabled */
  disabledIds: Set<string>;
  /** Elements that match error boundary fallback patterns */
  errorBoundaryElements: Set<string>;
  /** Current URL */
  url: string;
  /** When this snapshot was taken */
  timestamp: number;
}

export interface ErrorImpactConfig {
  /** Callback to capture current UI state (module is DOM-agnostic) */
  captureUIState: () => UIStateSnapshot;
  /** Time window after error to check for navigation changes (default: 500ms) */
  navigationChangeThresholdMs?: number;
  /** If element count drops below this fraction of before-count, consider render blocked (default: 0.2 = 80% elements lost) */
  renderBlockedThreshold?: number;
}

// ---------------------------------------------------------------------------
// Default config values
// ---------------------------------------------------------------------------

const DEFAULT_NAVIGATION_CHANGE_THRESHOLD_MS = 500;
const DEFAULT_RENDER_BLOCKED_THRESHOLD = 0.2;

// ---------------------------------------------------------------------------
// Helper: extract message from an event
// ---------------------------------------------------------------------------

function extractMessage(event: AnyCapturedEvent): string {
  if ('message' in event) return (event as { message: string }).message;
  if (event.type === 'network')
    return `${event.method} ${event.requestUrl} ${event.status ?? event.kind}`;
  if (event.type === 'resource-error') return `${event.tagName} load failed: ${event.resourceUrl}`;
  return event.type;
}

// ---------------------------------------------------------------------------
// ErrorImpactAssessor
// ---------------------------------------------------------------------------

export class ErrorImpactAssessor {
  private config: ErrorImpactConfig;
  private beforeState: UIStateSnapshot | null = null;
  private lastAssessment: ErrorImpact | null = null;

  constructor(config: ErrorImpactConfig) {
    this.config = config;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Capture a "before" snapshot of the UI state.
   * Call this before an action that might trigger errors.
   */
  captureBeforeState(): void {
    this.beforeState = this.config.captureUIState();
  }

  /**
   * Assess the impact of a single browser event on the UI.
   *
   * Classifies the event, captures an after-state snapshot, and computes
   * the diff against the before-state to determine UI consequences.
   */
  assessImpact(event: AnyCapturedEvent): ErrorImpact {
    const { severity } = classifyEvent(event);
    const fingerprint = computeFingerprint(event);
    const afterState = this.config.captureUIState();

    const consequences =
      this.beforeState !== null
        ? this.computeConsequences(this.beforeState, afterState)
        : this.emptyConsequences();

    const recoveryStatus =
      this.beforeState !== null ? this.determineRecovery(consequences) : 'unknown';

    const impact: ErrorImpact = {
      error: {
        message: extractMessage(event),
        severity,
        fingerprint,
        timestamp: event.timestamp,
      },
      uiConsequences: consequences,
      recoveryStatus,
      assessedAt: Date.now(),
    };

    this.lastAssessment = impact;
    return impact;
  }

  /**
   * Batch version of assessImpact.
   * Only assesses crash and error severity events (skips warning/noise).
   */
  assessEvents(events: AnyCapturedEvent[]): ErrorImpact[] {
    const results: ErrorImpact[] = [];

    for (const event of events) {
      const { severity } = classifyEvent(event);
      if (severity === 'warning' || severity === 'noise') continue;
      results.push(this.assessImpact(event));
    }

    return results;
  }

  /**
   * Get the most recent impact assessment, or null if none has been performed.
   */
  getLastAssessment(): ErrorImpact | null {
    return this.lastAssessment;
  }

  // -----------------------------------------------------------------------
  // Private: consequence computation
  // -----------------------------------------------------------------------

  /**
   * Compare before and after UI snapshots to determine what changed.
   */
  private computeConsequences(before: UIStateSnapshot, after: UIStateSnapshot): UIConsequences {
    const renderBlockedThreshold =
      this.config.renderBlockedThreshold ?? DEFAULT_RENDER_BLOCKED_THRESHOLD;
    const navigationThresholdMs =
      this.config.navigationChangeThresholdMs ?? DEFAULT_NAVIGATION_CHANGE_THRESHOLD_MS;

    // Elements removed: in before but not in after
    const elementsRemoved: string[] = [];
    for (const id of before.elementIds) {
      if (!after.elementIds.has(id)) {
        elementsRemoved.push(id);
      }
    }

    // Elements added: in after but not in before
    const elementsAdded: string[] = [];
    for (const id of after.elementIds) {
      if (!before.elementIds.has(id)) {
        elementsAdded.push(id);
      }
    }

    // Elements disabled: in after's disabled set but not in before's disabled set
    const elementsDisabled: string[] = [];
    for (const id of after.disabledIds) {
      if (!before.disabledIds.has(id)) {
        elementsDisabled.push(id);
      }
    }

    // Navigation triggered: URL changed within the threshold window
    let navigationTriggered: string | undefined;
    if (before.url !== after.url && after.timestamp - before.timestamp <= navigationThresholdMs) {
      navigationTriggered = after.url;
    }

    // Render blocked: element count dropped below the threshold fraction
    const beforeCount = before.elementIds.size;
    const afterCount = after.elementIds.size;
    const renderBlocked = beforeCount > 0 && afterCount / beforeCount <= renderBlockedThreshold;

    // Error boundary triggered: new error boundary elements appeared
    const errorBoundaryTriggered = this.hasNewErrorBoundaryElements(before, after);

    return {
      elementsRemoved,
      elementsAdded,
      elementsDisabled,
      navigationTriggered,
      renderBlocked,
      errorBoundaryTriggered,
    };
  }

  /**
   * Determine recovery status based on UI consequences.
   *
   * - `fatal`: render blocked OR >50% of elements removed
   * - `degraded`: error boundary triggered OR elements disabled OR some elements removed
   * - `recovered`: no significant UI changes (error was handled gracefully)
   * - `unknown`: unable to determine (e.g., no before-state)
   */
  private determineRecovery(
    consequences: UIConsequences
  ): 'recovered' | 'degraded' | 'fatal' | 'unknown' {
    // Fatal: render blocked or massive element loss
    if (consequences.renderBlocked) {
      return 'fatal';
    }

    // Fatal: more than 50% of elements removed
    if (
      consequences.elementsRemoved.length > 0 &&
      consequences.elementsAdded.length === 0 &&
      this.beforeState !== null &&
      this.beforeState.elementIds.size > 0 &&
      consequences.elementsRemoved.length / this.beforeState.elementIds.size > 0.5
    ) {
      return 'fatal';
    }

    // Degraded: error boundary, disabled elements, or partial element removal
    if (consequences.errorBoundaryTriggered) {
      return 'degraded';
    }
    if (consequences.elementsDisabled.length > 0) {
      return 'degraded';
    }
    if (consequences.elementsRemoved.length > 0) {
      return 'degraded';
    }

    // Recovered: no significant UI changes detected
    return 'recovered';
  }

  // -----------------------------------------------------------------------
  // Private: helpers
  // -----------------------------------------------------------------------

  /**
   * Check if new error boundary fallback elements appeared.
   */
  private hasNewErrorBoundaryElements(before: UIStateSnapshot, after: UIStateSnapshot): boolean {
    for (const id of after.errorBoundaryElements) {
      if (!before.errorBoundaryElements.has(id)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Return an empty UIConsequences (used when no before-state is available).
   */
  private emptyConsequences(): UIConsequences {
    return {
      elementsRemoved: [],
      elementsAdded: [],
      elementsDisabled: [],
      navigationTriggered: undefined,
      renderBlocked: false,
      errorBoundaryTriggered: false,
    };
  }
}
