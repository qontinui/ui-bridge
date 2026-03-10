/**
 * Action / Error Timeline & Error Diff
 *
 * Phase 3.9 (timeline) and Phase 3.11 (error diff) from the console capture plan.
 *
 * Provides a merged, chronologically-ordered timeline of user actions
 * and browser events, plus before/after error diff computation for
 * determining which errors an action introduced or resolved.
 */

import type { AnyCapturedEvent, BrowserEventType } from './browser-capture-types';
import type { ErrorSeverity } from './error-severity';
import { classifyEvent, SEVERITY_RANK } from './error-severity';
import { computeFingerprint, extractSourceLocation } from './error-fingerprint';
import { getEventStack } from './shared-utils';

// ---------------------------------------------------------------------------
// BrowserEventCaptureLike — duck-type interface for the capture instance
// ---------------------------------------------------------------------------

/**
 * Minimal interface for reading events from a BrowserEventCapture instance.
 * Matches the query methods on BrowserEventCapture without requiring a
 * concrete import (keeps this module decoupled).
 */
export interface BrowserEventCaptureLike {
  getSince(ts: number): AnyCapturedEvent[];
  getRecent(n?: number): AnyCapturedEvent[];
  getByType(type: BrowserEventType): AnyCapturedEvent[];
}

// ---------------------------------------------------------------------------
// ClassifiedBrowserEvent — enriched event with Phase 2 metadata
// ---------------------------------------------------------------------------

/**
 * A browser event enriched with severity classification, fingerprint,
 * and source location extracted from its stack trace.
 */
export interface ClassifiedBrowserEvent {
  event: AnyCapturedEvent;
  severity: ErrorSeverity;
  reason: string;
  fingerprint: string;
  sourceLocation?: string;
}

// ---------------------------------------------------------------------------
// Timeline entry types
// ---------------------------------------------------------------------------

export type TimelineEntryType = 'action' | 'browser-event';

export interface ActionTimelineEntry {
  type: 'action';
  timestamp: number;
  action: string;
  targetId: string;
  targetLabel?: string;
  success: boolean;
  durationMs: number;
  /** Browser events that occurred during/after this action */
  relatedEvents: ClassifiedBrowserEvent[];
}

export interface BrowserEventTimelineEntry {
  type: 'browser-event';
  timestamp: number;
  event: AnyCapturedEvent;
  severity: ErrorSeverity;
  reason: string;
  fingerprint: string;
  sourceLocation?: string;
}

export type TimelineEntry = ActionTimelineEntry | BrowserEventTimelineEntry;

// ---------------------------------------------------------------------------
// ErrorDiff — before/after action error diff
// ---------------------------------------------------------------------------

export interface ErrorDiff {
  /** Action that was executed */
  action: string;
  targetId: string;
  /** Events that appeared after the action (not present before) */
  newEvents: ClassifiedBrowserEvent[];
  /** Events that were present before but disappeared after */
  resolvedEvents: ClassifiedBrowserEvent[];
  /** Events present both before and after */
  persistingEvents: ClassifiedBrowserEvent[];
  /** Net change in error count (positive = more errors, negative = fewer) */
  errorDelta: number;
}

// ---------------------------------------------------------------------------
// Timeline query options
// ---------------------------------------------------------------------------

export interface TimelineQueryOptions {
  /** Only include entries at or after this timestamp */
  since?: number;
  /** Maximum number of entries to return */
  limit?: number;
  /** Minimum severity for browser events (actions are always included) */
  minSeverity?: ErrorSeverity;
}

// ---------------------------------------------------------------------------
// TimelineBuffer
// ---------------------------------------------------------------------------

/**
 * Maintains a rolling buffer of action entries and merges them with browser
 * events to produce a unified, chronologically-ordered timeline.
 */
export class TimelineBuffer {
  private actions: ActionTimelineEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  // -----------------------------------------------------------------------
  // Recording
  // -----------------------------------------------------------------------

  /**
   * Record an action with its related browser events.
   * The `type` discriminator is added automatically.
   */
  recordAction(entry: Omit<ActionTimelineEntry, 'type'>): void {
    this.actions.push({ type: 'action', ...entry });
    this.trimActions();
  }

  // -----------------------------------------------------------------------
  // Timeline query
  // -----------------------------------------------------------------------

  /**
   * Build a merged timeline from recorded actions and live browser events.
   *
   * Browser events are fetched from the provided capture instance, classified,
   * and interleaved chronologically with action entries.
   *
   * @param capture - A BrowserEventCapture (or compatible) instance to read events from
   * @param options - Optional filtering (since, limit, minSeverity)
   */
  getTimeline(capture: BrowserEventCaptureLike, options?: TimelineQueryOptions): TimelineEntry[] {
    const { since, limit, minSeverity } = options ?? {};
    const minRank = minSeverity ? SEVERITY_RANK[minSeverity] : SEVERITY_RANK.noise;

    // Fetch browser events
    const rawEvents: AnyCapturedEvent[] =
      since !== undefined ? capture.getSince(since) : capture.getRecent();

    // Classify browser events into timeline entries
    const browserEntries: BrowserEventTimelineEntry[] = [];
    for (const event of rawEvents) {
      const { severity, reason } = classifyEvent(event);

      // Apply severity filter to browser events
      if (SEVERITY_RANK[severity] > minRank) continue;

      browserEntries.push({
        type: 'browser-event',
        timestamp: event.timestamp,
        event,
        severity,
        reason,
        fingerprint: computeFingerprint(event),
        sourceLocation: extractSourceLocation(getEventStack(event)),
      });
    }

    // Filter actions by timestamp if `since` is provided
    const filteredActions: ActionTimelineEntry[] =
      since !== undefined ? this.actions.filter((a) => a.timestamp >= since) : [...this.actions];

    // Merge and sort chronologically
    const merged: TimelineEntry[] = [...filteredActions, ...browserEntries];
    merged.sort((a, b) => a.timestamp - b.timestamp);

    // Apply limit
    if (limit !== undefined && limit > 0 && merged.length > limit) {
      return merged.slice(-limit);
    }

    return merged;
  }

  // -----------------------------------------------------------------------
  // Static utilities
  // -----------------------------------------------------------------------

  /**
   * Compute the error diff between two snapshots of browser events,
   * taken before and after an action.
   *
   * Uses fingerprints to determine which errors are new, resolved, or persisting.
   * `errorDelta` counts only crash and error severity events (not warnings/noise).
   */
  static computeErrorDiff(
    action: string,
    targetId: string,
    eventsBefore: AnyCapturedEvent[],
    eventsAfter: AnyCapturedEvent[]
  ): ErrorDiff {
    const classifiedBefore = TimelineBuffer.classifyAndEnrich(eventsBefore);
    const classifiedAfter = TimelineBuffer.classifyAndEnrich(eventsAfter);

    // Build fingerprint -> classified event maps
    const beforeByFp = new Map<string, ClassifiedBrowserEvent>();
    for (const c of classifiedBefore) {
      // Keep the first occurrence per fingerprint
      if (!beforeByFp.has(c.fingerprint)) {
        beforeByFp.set(c.fingerprint, c);
      }
    }

    const afterByFp = new Map<string, ClassifiedBrowserEvent>();
    for (const c of classifiedAfter) {
      if (!afterByFp.has(c.fingerprint)) {
        afterByFp.set(c.fingerprint, c);
      }
    }

    const newEvents: ClassifiedBrowserEvent[] = [];
    const resolvedEvents: ClassifiedBrowserEvent[] = [];
    const persistingEvents: ClassifiedBrowserEvent[] = [];

    // New = in after but not in before
    for (const [fp, classified] of afterByFp) {
      if (!beforeByFp.has(fp)) {
        newEvents.push(classified);
      } else {
        persistingEvents.push(classified);
      }
    }

    // Resolved = in before but not in after
    for (const [fp, classified] of beforeByFp) {
      if (!afterByFp.has(fp)) {
        resolvedEvents.push(classified);
      }
    }

    // Error delta: count only crash/error severity (not warning/noise)
    const isSignificant = (c: ClassifiedBrowserEvent): boolean =>
      c.severity === 'crash' || c.severity === 'error';

    const newSignificant = newEvents.filter(isSignificant).length;
    const resolvedSignificant = resolvedEvents.filter(isSignificant).length;
    const errorDelta = newSignificant - resolvedSignificant;

    return {
      action,
      targetId,
      newEvents,
      resolvedEvents,
      persistingEvents,
      errorDelta,
    };
  }

  /**
   * Classify and enrich a batch of raw browser events.
   *
   * For each event: computes severity, reason, fingerprint, and source location.
   */
  static classifyAndEnrich(events: AnyCapturedEvent[]): ClassifiedBrowserEvent[] {
    return events.map((event) => {
      const { severity, reason } = classifyEvent(event);
      return {
        event,
        severity,
        reason,
        fingerprint: computeFingerprint(event),
        sourceLocation: extractSourceLocation(getEventStack(event)),
      };
    });
  }

  // -----------------------------------------------------------------------
  // Buffer management
  // -----------------------------------------------------------------------

  /**
   * Clear all recorded actions.
   */
  clear(): void {
    this.actions = [];
  }

  /**
   * Current number of recorded actions.
   */
  get actionCount(): number {
    return this.actions.length;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private trimActions(): void {
    if (this.actions.length > this.maxEntries) {
      this.actions = this.actions.slice(-this.maxEntries);
    }
  }
}
