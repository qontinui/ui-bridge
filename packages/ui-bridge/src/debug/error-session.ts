/**
 * Error Sessions & Baselines
 *
 * Track errors per automation session and compare against baselines
 * to detect regressions and new issues.
 *
 * Phase 4.17 from the console capture plan.
 */

import type { AnyCapturedEvent } from './browser-capture-types';
import type { BrowserEventCaptureLike, ClassifiedBrowserEvent } from './error-timeline';
import type { ErrorSeverity } from './error-severity';
import { classifyEvent } from './error-severity';
import { computeFingerprint, extractSourceLocation } from './error-fingerprint';

// ---------------------------------------------------------------------------
// Helper: extract stack from an event (if present)
// ---------------------------------------------------------------------------

function getEventStack(event: AnyCapturedEvent): string | undefined {
  if ('stack' in event) return event.stack;
  return undefined;
}

// ---------------------------------------------------------------------------
// Helper: classify and enrich a single event
// ---------------------------------------------------------------------------

function classifyAndEnrichEvent(event: AnyCapturedEvent): ClassifiedBrowserEvent {
  const { severity, reason } = classifyEvent(event);
  return {
    event,
    severity,
    reason,
    fingerprint: computeFingerprint(event),
    sourceLocation: extractSourceLocation(getEventStack(event)),
  };
}

// ---------------------------------------------------------------------------
// Error Baseline
// ---------------------------------------------------------------------------

export interface ErrorBaseline {
  /** Baseline label (e.g., "clean-state", "after-deploy-v2.1") */
  label: string;
  /** When the baseline was captured */
  capturedAt: number;
  /** Set of known-acceptable error fingerprints */
  fingerprints: Set<string>;
  /** Full classified events for reference */
  events: ClassifiedBrowserEvent[];
}

export interface BaselineComparison {
  /** Errors in current session that are NOT in the baseline (regressions) */
  newErrors: ClassifiedBrowserEvent[];
  /** Errors in baseline that are no longer present (fixes) */
  fixedErrors: ClassifiedBrowserEvent[];
  /** Errors present in both (known issues) */
  knownErrors: ClassifiedBrowserEvent[];
  /** Whether the current state is a regression */
  isRegression: boolean;
  /** Net change in error count */
  delta: number;
}

// ---------------------------------------------------------------------------
// Error Session Summary
// ---------------------------------------------------------------------------

export interface ErrorSessionSummary {
  id: string;
  label?: string;
  startedAt: number;
  endedAt?: number;
  /** Total unique error fingerprints seen */
  uniqueErrorCount: number;
  /** Total event count (including duplicates) */
  totalEventCount: number;
  /** Breakdown by severity */
  bySeverity: Record<ErrorSeverity, number>;
  /** Whether any crashes occurred */
  hasCrashes: boolean;
}

// ---------------------------------------------------------------------------
// Error Session
// ---------------------------------------------------------------------------

export class ErrorSession {
  readonly id: string;
  readonly label?: string;
  readonly startedAt: number;
  private endedAt?: number;
  private events: ClassifiedBrowserEvent[] = [];
  private fingerprints = new Set<string>();
  /** Map from fingerprint to first classified event (for getUniqueEvents) */
  private uniqueByFingerprint = new Map<string, ClassifiedBrowserEvent>();

  constructor(label?: string) {
    this.id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.label = label;
    this.startedAt = Date.now();
  }

  /** Record an event into this session */
  recordEvent(event: AnyCapturedEvent): void {
    if (this.endedAt !== undefined) return;

    const classified = classifyAndEnrichEvent(event);
    this.events.push(classified);

    if (!this.fingerprints.has(classified.fingerprint)) {
      this.fingerprints.add(classified.fingerprint);
      this.uniqueByFingerprint.set(classified.fingerprint, classified);
    }
  }

  /** Record a batch of events */
  recordEvents(events: AnyCapturedEvent[]): void {
    for (const event of events) {
      this.recordEvent(event);
    }
  }

  /** End the session */
  end(): void {
    if (this.endedAt === undefined) {
      this.endedAt = Date.now();
    }
  }

  /** Get all unique events (one per fingerprint, first occurrence) */
  getUniqueEvents(): ClassifiedBrowserEvent[] {
    return Array.from(this.uniqueByFingerprint.values());
  }

  /** Get all events */
  getAllEvents(): ClassifiedBrowserEvent[] {
    return [...this.events];
  }

  /** Get the fingerprint set */
  getFingerprints(): Set<string> {
    return new Set(this.fingerprints);
  }

  /** Get session summary */
  getSummary(): ErrorSessionSummary {
    const bySeverity: Record<ErrorSeverity, number> = {
      crash: 0,
      error: 0,
      warning: 0,
      noise: 0,
    };

    let hasCrashes = false;
    for (const classified of this.events) {
      bySeverity[classified.severity]++;
      if (classified.severity === 'crash') {
        hasCrashes = true;
      }
    }

    return {
      id: this.id,
      label: this.label,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      uniqueErrorCount: this.fingerprints.size,
      totalEventCount: this.events.length,
      bySeverity,
      hasCrashes,
    };
  }

  /** Compare this session against a baseline */
  compareToBaseline(baseline: ErrorBaseline): BaselineComparison {
    const newErrors: ClassifiedBrowserEvent[] = [];
    const knownErrors: ClassifiedBrowserEvent[] = [];

    // Walk unique events in this session
    for (const [fp, classified] of this.uniqueByFingerprint) {
      if (baseline.fingerprints.has(fp)) {
        knownErrors.push(classified);
      } else {
        newErrors.push(classified);
      }
    }

    // Fixed = in baseline but not in this session
    const fixedErrors: ClassifiedBrowserEvent[] = [];
    const baselineByFp = new Map<string, ClassifiedBrowserEvent>();
    for (const classified of baseline.events) {
      if (!baselineByFp.has(classified.fingerprint)) {
        baselineByFp.set(classified.fingerprint, classified);
      }
    }
    for (const [fp, classified] of baselineByFp) {
      if (!this.fingerprints.has(fp)) {
        fixedErrors.push(classified);
      }
    }

    // isRegression: true if there are new crash or error severity events
    const isRegression = newErrors.some((e) => e.severity === 'crash' || e.severity === 'error');

    // Delta: net change in significant (crash + error) event count
    const isSignificant = (c: ClassifiedBrowserEvent): boolean =>
      c.severity === 'crash' || c.severity === 'error';
    const newSignificant = newErrors.filter(isSignificant).length;
    const fixedSignificant = fixedErrors.filter(isSignificant).length;
    const delta = newSignificant - fixedSignificant;

    return {
      newErrors,
      fixedErrors,
      knownErrors,
      isRegression,
      delta,
    };
  }

  /** Whether the session is still active (not ended) */
  get isActive(): boolean {
    return this.endedAt === undefined;
  }
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

export class ErrorSessionManager {
  private sessions: ErrorSession[] = [];
  private activeSession: ErrorSession | null = null;
  private baselines = new Map<string, ErrorBaseline>();
  private maxSessions: number;

  constructor(maxSessions = 50) {
    this.maxSessions = maxSessions;
  }

  /** Start a new session. Ends the previous active session if any. */
  startSession(label?: string): ErrorSession {
    // End any currently active session
    if (this.activeSession !== null) {
      this.activeSession.end();
    }

    const session = new ErrorSession(label);
    this.activeSession = session;
    this.sessions.push(session);

    // Trim to maxSessions (ring buffer)
    if (this.sessions.length > this.maxSessions) {
      this.sessions = this.sessions.slice(-this.maxSessions);
    }

    return session;
  }

  /** End the active session */
  endSession(): ErrorSessionSummary | null {
    if (this.activeSession === null) return null;

    this.activeSession.end();
    const summary = this.activeSession.getSummary();
    this.activeSession = null;
    return summary;
  }

  /** Get the active session */
  getActive(): ErrorSession | null {
    return this.activeSession;
  }

  /** Record an event into the active session (no-op if no active session) */
  recordEvent(event: AnyCapturedEvent): void {
    if (this.activeSession !== null) {
      this.activeSession.recordEvent(event);
    }
  }

  /** Get all session summaries */
  getSessions(): ErrorSessionSummary[] {
    return this.sessions.map((s) => s.getSummary());
  }

  /** Get a specific session by ID */
  getSession(id: string): ErrorSession | null {
    return this.sessions.find((s) => s.id === id) ?? null;
  }

  /**
   * Capture a baseline from the current state.
   * Takes a BrowserEventCaptureLike to read recent events.
   */
  captureBaseline(label: string, capture: BrowserEventCaptureLike): ErrorBaseline {
    const rawEvents = capture.getRecent();
    const classified = rawEvents.map(classifyAndEnrichEvent);

    // Deduplicate: one event per fingerprint
    const fingerprints = new Set<string>();
    const uniqueEvents: ClassifiedBrowserEvent[] = [];
    for (const c of classified) {
      if (!fingerprints.has(c.fingerprint)) {
        fingerprints.add(c.fingerprint);
        uniqueEvents.push(c);
      }
    }

    const baseline: ErrorBaseline = {
      label,
      capturedAt: Date.now(),
      fingerprints,
      events: uniqueEvents,
    };

    this.baselines.set(label, baseline);
    return baseline;
  }

  /** Get a baseline by label */
  getBaseline(label: string): ErrorBaseline | null {
    return this.baselines.get(label) ?? null;
  }

  /** List all baselines */
  getBaselines(): Array<{ label: string; capturedAt: number; fingerprintCount: number }> {
    const result: Array<{ label: string; capturedAt: number; fingerprintCount: number }> = [];
    for (const [, baseline] of this.baselines) {
      result.push({
        label: baseline.label,
        capturedAt: baseline.capturedAt,
        fingerprintCount: baseline.fingerprints.size,
      });
    }
    return result;
  }

  /** Delete a baseline */
  deleteBaseline(label: string): boolean {
    return this.baselines.delete(label);
  }

  /**
   * Compare the active session (or recent events) against a named baseline.
   *
   * If there is an active session, compares its accumulated events.
   * Otherwise, if a capture instance is provided, compares recent events from it.
   * Returns null if the baseline does not exist or there is nothing to compare.
   */
  compareToBaseline(
    baselineLabel: string,
    capture?: BrowserEventCaptureLike
  ): BaselineComparison | null {
    const baseline = this.baselines.get(baselineLabel);
    if (!baseline) return null;

    // If there's an active session, compare directly
    if (this.activeSession !== null) {
      return this.activeSession.compareToBaseline(baseline);
    }

    // Otherwise, use the capture instance to build an ad-hoc comparison
    if (!capture) return null;

    const rawEvents = capture.getRecent();
    const classified = rawEvents.map(classifyAndEnrichEvent);

    // Deduplicate current events
    const currentByFp = new Map<string, ClassifiedBrowserEvent>();
    for (const c of classified) {
      if (!currentByFp.has(c.fingerprint)) {
        currentByFp.set(c.fingerprint, c);
      }
    }

    const newErrors: ClassifiedBrowserEvent[] = [];
    const knownErrors: ClassifiedBrowserEvent[] = [];

    for (const [fp, c] of currentByFp) {
      if (baseline.fingerprints.has(fp)) {
        knownErrors.push(c);
      } else {
        newErrors.push(c);
      }
    }

    // Fixed = in baseline but not in current
    const baselineByFp = new Map<string, ClassifiedBrowserEvent>();
    for (const c of baseline.events) {
      if (!baselineByFp.has(c.fingerprint)) {
        baselineByFp.set(c.fingerprint, c);
      }
    }

    const fixedErrors: ClassifiedBrowserEvent[] = [];
    for (const [fp, c] of baselineByFp) {
      if (!currentByFp.has(fp)) {
        fixedErrors.push(c);
      }
    }

    const isRegression = newErrors.some((e) => e.severity === 'crash' || e.severity === 'error');

    const isSignificant = (c: ClassifiedBrowserEvent): boolean =>
      c.severity === 'crash' || c.severity === 'error';
    const newSignificant = newErrors.filter(isSignificant).length;
    const fixedSignificant = fixedErrors.filter(isSignificant).length;
    const delta = newSignificant - fixedSignificant;

    return {
      newErrors,
      fixedErrors,
      knownErrors,
      isRegression,
      delta,
    };
  }
}
