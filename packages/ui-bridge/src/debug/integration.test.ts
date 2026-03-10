/**
 * Integration Tests — Error System Wiring
 *
 * Tests that error events flow through the full pipeline:
 *   BrowserEventCapture → onEvent callback → sessions, snapshots, health, streaming
 *
 * Also tests the error diff computation in the context of before/after action events.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  AnyCapturedEvent,
  ConsoleCapturedEvent,
  BrowserEventType,
} from './browser-capture-types';
import { computeHealthReport } from './health-score';
import { ErrorSessionManager } from './error-session';
import { ErrorSnapshotBuffer } from './error-snapshot';
import { BrowserEventStream } from './ws-streaming';
import { TimelineBuffer } from './error-timeline';
import type { BrowserEventCaptureLike } from './error-timeline';
import { classifyEvent } from './error-severity';

// ---------------------------------------------------------------------------
// Mock BrowserEventCapture — simulates the real capture instance
// ---------------------------------------------------------------------------

class MockBrowserEventCapture implements BrowserEventCaptureLike {
  private events: AnyCapturedEvent[] = [];
  private onEventCallback: ((event: AnyCapturedEvent) => void) | null = null;

  /** Simulate the real BrowserEventCapture.setOnEvent() method */
  setOnEvent(cb: (event: AnyCapturedEvent) => void): void {
    this.onEventCallback = cb;
  }

  /** Simulate a browser event being captured (e.g., console.error fires) */
  inject(event: AnyCapturedEvent): void {
    this.events.push(event);
    // Fire the callback, just like the real capture does
    this.onEventCallback?.(event);
  }

  // BrowserEventCaptureLike interface
  getSince(ts: number): AnyCapturedEvent[] {
    return this.events.filter((e) => e.timestamp >= ts);
  }

  getRecent(n = 100): AnyCapturedEvent[] {
    return this.events.slice(-n);
  }

  getByType(type: BrowserEventType): AnyCapturedEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  clear(): void {
    this.events = [];
  }

  // Legacy ConsoleCapturelike methods
  getConsoleSince(ts: number): AnyCapturedEvent[] {
    return this.getSince(ts).filter((e) => e.type === 'console');
  }
  getConsoleRecent(n = 100): AnyCapturedEvent[] {
    return this.getRecent(n).filter((e) => e.type === 'console');
  }
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

function makeConsoleError(message: string, ts = Date.now()): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'error',
    message,
    timestamp: ts,
    url: 'http://localhost:3000/app',
    stack: `Error: ${message}\n    at App (http://localhost:3000/src/App.tsx:10:5)`,
  };
}

function makeConsoleWarning(message: string, ts = Date.now()): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'warn',
    message,
    timestamp: ts,
    url: 'http://localhost:3000/app',
  };
}

function makeUnhandledRejection(message: string, ts = Date.now()): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'unhandledrejection',
    message,
    timestamp: ts,
    url: 'http://localhost:3000/app',
    stack: `Error: ${message}\n    at fetchData (http://localhost:3000/src/api.ts:25:3)`,
  };
}

// ---------------------------------------------------------------------------
// Integration: Full pipeline wiring
// ---------------------------------------------------------------------------

describe('Integration: Error System Pipeline', () => {
  let capture: MockBrowserEventCapture;
  let sessionManager: ErrorSessionManager;
  let snapshotBuffer: ErrorSnapshotBuffer;
  let eventStream: BrowserEventStream;
  let timelineBuffer: TimelineBuffer;
  let emittedBridgeEvents: Array<{ type: string; severity: string }>;

  beforeEach(() => {
    capture = new MockBrowserEventCapture();
    sessionManager = new ErrorSessionManager();
    snapshotBuffer = new ErrorSnapshotBuffer();
    eventStream = new BrowserEventStream();
    timelineBuffer = new TimelineBuffer(500);
    emittedBridgeEvents = [];

    // Wire up the pipeline — same as handlers.ts does
    capture.setOnEvent((event: AnyCapturedEvent) => {
      // Feed session manager
      sessionManager.recordEvent(event);

      // Feed snapshot buffer
      snapshotBuffer.processEvent(event);

      // Feed event stream
      const messages = eventStream.processEvent(event);

      // Emit bridge events (simulating WS broadcast)
      if (messages.size > 0) {
        const { severity } = classifyEvent(event);
        emittedBridgeEvents.push({ type: `browser:${severity}`, severity });
      }
    });
  });

  describe('Event forwarding to all consumers', () => {
    it('should forward errors to session manager when session is active', () => {
      const session = sessionManager.startSession('test');
      capture.inject(makeConsoleError('Something broke'));

      const summary = session.getSummary();
      expect(summary.totalEventCount).toBe(1);
      expect(summary.bySeverity.error).toBe(1);
    });

    it('should forward crash events to snapshot buffer', () => {
      capture.inject(makeUnhandledRejection('Promise failed'));

      const snapshots = snapshotBuffer.getAll();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].error.severity).toBe('crash');
      expect(snapshots[0].error.message).toBe('Promise failed');
    });

    it('should NOT create snapshots for warnings', () => {
      capture.inject(makeConsoleWarning('Minor issue'));

      const snapshots = snapshotBuffer.getAll();
      expect(snapshots).toHaveLength(0);
    });

    it('should forward to stream subscribers', () => {
      eventStream.subscribe({ minSeverity: 'error' });

      capture.inject(makeConsoleError('Stream test error'));

      // Bridge event should have been emitted
      expect(emittedBridgeEvents).toHaveLength(1);
      expect(emittedBridgeEvents[0].type).toBe('browser:error');
    });

    it('should NOT emit bridge events when no stream subscribers', () => {
      // No subscriptions
      capture.inject(makeConsoleError('No subscribers'));

      expect(emittedBridgeEvents).toHaveLength(0);
    });
  });

  describe('Health score reflects captured events', () => {
    it('should be healthy with no events', () => {
      const report = computeHealthReport(capture);
      expect(report.status).toBe('healthy');
      expect(report.score).toBe(100);
    });

    it('should degrade after multiple errors', () => {
      const now = Date.now();
      capture.inject(makeConsoleError('Error 1', now - 1000));
      capture.inject(makeConsoleError('Error 2', now - 2000));
      capture.inject(makeConsoleError('Error 3', now - 3000));

      const report = computeHealthReport(capture);
      expect(report.status).toBe('degraded');
      expect(report.score).toBe(70); // 100 - 3*10
      expect(report.breakdown.errors).toBe(3);
    });

    it('should be broken after a crash', () => {
      capture.inject(makeUnhandledRejection('Fatal error'));

      const report = computeHealthReport(capture);
      expect(report.status).toBe('broken');
      expect(report.breakdown.crashes).toBe(1);
    });
  });

  describe('Error sessions capture and compare', () => {
    it('should accumulate errors during an active session', () => {
      sessionManager.startSession('automation-run');

      capture.inject(makeConsoleError('Error A'));
      capture.inject(makeConsoleError('Error B'));
      capture.inject(makeConsoleWarning('Warning C'));

      const summary = sessionManager.endSession();
      expect(summary).not.toBeNull();
      expect(summary!.totalEventCount).toBe(3);
      expect(summary!.bySeverity.error).toBe(2);
      expect(summary!.bySeverity.warning).toBe(1);
      expect(summary!.uniqueErrorCount).toBe(3);
    });

    it('should detect regressions when comparing to baseline', () => {
      // Capture baseline with one known error
      capture.inject(makeConsoleError('Known bug'));
      sessionManager.captureBaseline('clean-state', capture);

      // Start a new session and inject a NEW error
      capture.clear();
      sessionManager.startSession('test-run');
      capture.inject(makeConsoleError('Known bug')); // known
      capture.inject(makeConsoleError('New regression bug')); // NEW

      const comparison = sessionManager.compareToBaseline('clean-state');
      expect(comparison).not.toBeNull();
      expect(comparison!.newErrors).toHaveLength(1);
      expect(comparison!.knownErrors).toHaveLength(1);
      expect(comparison!.isRegression).toBe(true);
      expect(comparison!.delta).toBe(1);
    });

    it('should detect fixes when baseline errors disappear', () => {
      // Baseline with two errors
      capture.inject(makeConsoleError('Bug A'));
      capture.inject(makeConsoleError('Bug B'));
      sessionManager.captureBaseline('before-fix', capture);

      // Session with only one error (Bug B was fixed)
      capture.clear();
      sessionManager.startSession('after-fix');
      capture.inject(makeConsoleError('Bug A'));

      const comparison = sessionManager.compareToBaseline('before-fix');
      expect(comparison).not.toBeNull();
      expect(comparison!.fixedErrors).toHaveLength(1);
      expect(comparison!.knownErrors).toHaveLength(1);
      expect(comparison!.newErrors).toHaveLength(0);
      expect(comparison!.isRegression).toBe(false);
      expect(comparison!.delta).toBe(-1);
    });
  });

  describe('Error diff: before/after action', () => {
    it('should detect new errors introduced by an action', () => {
      const now = Date.now();
      const eventsBefore = [makeConsoleWarning('Existing warning', now - 5000)];
      const eventsAfter = [
        makeConsoleWarning('Existing warning', now - 5000),
        makeConsoleError('New error from action', now - 100),
      ];

      const diff = TimelineBuffer.computeErrorDiff(
        'click',
        'submit-button',
        eventsBefore,
        eventsAfter
      );

      expect(diff.newEvents).toHaveLength(1);
      expect(diff.newEvents[0].severity).toBe('error');
      expect(diff.resolvedEvents).toHaveLength(0);
      expect(diff.errorDelta).toBe(1); // +1 error-severity event
    });

    it('should detect errors resolved by an action', () => {
      const now = Date.now();
      const eventsBefore = [
        makeConsoleError('Network error', now - 5000),
        makeConsoleWarning('Warning', now - 4000),
      ];
      const eventsAfter = [makeConsoleWarning('Warning', now - 4000)];

      const diff = TimelineBuffer.computeErrorDiff(
        'click',
        'retry-button',
        eventsBefore,
        eventsAfter
      );

      expect(diff.resolvedEvents).toHaveLength(1);
      expect(diff.resolvedEvents[0].severity).toBe('error');
      expect(diff.errorDelta).toBe(-1); // -1 error-severity event
    });

    it('should track persisting errors across an action', () => {
      const now = Date.now();
      const consoleError = makeConsoleError('Persistent bug', now - 5000);
      const eventsBefore = [consoleError];
      const eventsAfter = [consoleError];

      const diff = TimelineBuffer.computeErrorDiff(
        'click',
        'some-button',
        eventsBefore,
        eventsAfter
      );

      expect(diff.persistingEvents).toHaveLength(1);
      expect(diff.newEvents).toHaveLength(0);
      expect(diff.resolvedEvents).toHaveLength(0);
      expect(diff.errorDelta).toBe(0);
    });

    it('should count errorDelta using only crash+error severity', () => {
      const now = Date.now();
      const eventsBefore: AnyCapturedEvent[] = [];
      const eventsAfter: AnyCapturedEvent[] = [
        makeConsoleError('Real error', now),
        makeConsoleWarning('Just a warning', now),
      ];

      const diff = TimelineBuffer.computeErrorDiff('click', 'button', eventsBefore, eventsAfter);

      // Only the error counts toward delta, not the warning
      expect(diff.newEvents).toHaveLength(2);
      expect(diff.errorDelta).toBe(1);
    });
  });

  describe('Timeline merges actions with browser events', () => {
    it('should merge action entries with classified browser events', () => {
      const now = Date.now();

      // Record an action
      timelineBuffer.recordAction({
        timestamp: now - 2000,
        action: 'click',
        targetId: 'btn-1',
        targetLabel: 'Submit',
        success: true,
        durationMs: 50,
        relatedEvents: [],
      });

      // Inject some browser events
      capture.inject(makeConsoleError('Error after click', now - 1500));
      capture.inject(makeConsoleWarning('Warning', now - 1000));

      const timeline = timelineBuffer.getTimeline(capture);

      expect(timeline).toHaveLength(3);
      // Should be sorted chronologically
      expect(timeline[0].type).toBe('action');
      expect(timeline[1].type).toBe('browser-event');
      expect(timeline[2].type).toBe('browser-event');

      // Browser events should be classified
      const browserEntry = timeline[1] as { severity: string; fingerprint: string };
      expect(browserEntry.severity).toBe('error');
      expect(browserEntry.fingerprint).toBeTruthy();
    });

    it('should filter browser events by minSeverity', () => {
      const now = Date.now();
      capture.inject(makeConsoleError('Error', now - 2000));
      capture.inject(makeConsoleWarning('Warning', now - 1000));

      const timeline = timelineBuffer.getTimeline(capture, { minSeverity: 'error' });

      // Only the error should appear (warning filtered out)
      expect(timeline).toHaveLength(1);
      expect((timeline[0] as { severity: string }).severity).toBe('error');
    });
  });

  describe('Snapshot deduplication across events', () => {
    it('should capture only one snapshot per unique error fingerprint', () => {
      // Same error message = same fingerprint
      capture.inject(makeConsoleError('Repeated error'));
      capture.inject(makeConsoleError('Repeated error'));
      capture.inject(makeConsoleError('Repeated error'));

      const snapshots = snapshotBuffer.getAll();
      expect(snapshots).toHaveLength(1);
    });

    it('should capture separate snapshots for different errors', () => {
      capture.inject(makeConsoleError('Error A'));
      capture.inject(makeConsoleError('Error B'));
      capture.inject(makeUnhandledRejection('Promise C'));

      const snapshots = snapshotBuffer.getAll();
      expect(snapshots).toHaveLength(3);
    });
  });

  describe('End-to-end: workflow error tracking scenario', () => {
    it('should track health degradation across a simulated workflow', () => {
      // 1. Start clean — health should be perfect
      let report = computeHealthReport(capture);
      expect(report.status).toBe('healthy');
      expect(report.score).toBe(100);

      // 2. Capture baseline
      sessionManager.captureBaseline('clean', capture);

      // 3. Start automation session
      sessionManager.startSession('workflow-run');

      // 4. First action — minor warning
      const now = Date.now();
      capture.inject(makeConsoleWarning('Deprecation warning', now - 5000));

      report = computeHealthReport(capture);
      expect(report.status).toBe('healthy');
      expect(report.score).toBe(98); // 100 - 1*2

      // 5. Second action — triggers errors
      capture.inject(makeConsoleError('API call failed', now - 3000));
      capture.inject(makeConsoleError('Retry failed', now - 2000));
      capture.inject(makeConsoleError('Component crashed', now - 1000));

      report = computeHealthReport(capture);
      expect(report.status).toBe('degraded');
      expect(report.score).toBe(68); // 100 - 3*10 - 1*2
      expect(report.breakdown.errors).toBe(3);
      expect(report.breakdown.warnings).toBe(1);

      // 6. Third action — causes a crash
      capture.inject(makeUnhandledRejection('Unhandled promise rejection', now));

      report = computeHealthReport(capture);
      expect(report.status).toBe('broken');
      expect(report.breakdown.crashes).toBe(1);
      expect(report.topIssue?.severity).toBe('crash');

      // 7. End session and verify summary
      const summary = sessionManager.endSession();
      expect(summary).not.toBeNull();
      expect(summary!.totalEventCount).toBe(5);
      expect(summary!.hasCrashes).toBe(true);
      expect(summary!.bySeverity.crash).toBe(1);
      expect(summary!.bySeverity.error).toBe(3);
      expect(summary!.bySeverity.warning).toBe(1);

      // 8. Compare to baseline — all errors are regressions
      const comparison = sessionManager.compareToBaseline('clean', capture);
      expect(comparison).not.toBeNull();
      expect(comparison!.isRegression).toBe(true);
      expect(comparison!.newErrors.length).toBeGreaterThan(0);
      expect(comparison!.fixedErrors).toHaveLength(0);
      expect(comparison!.delta).toBeGreaterThan(0);

      // 9. Snapshots should have been captured for error+ events
      const snapshots = snapshotBuffer.getAll();
      expect(snapshots.length).toBeGreaterThanOrEqual(3); // 3 unique errors + 1 crash
    });

    it('should track error resolution across sessions', () => {
      const now = Date.now();

      // Session 1: has errors
      sessionManager.startSession('run-1');
      capture.inject(makeConsoleError('Bug X', now - 10000));
      capture.inject(makeConsoleError('Bug Y', now - 9000));
      sessionManager.captureBaseline('with-bugs', capture);
      sessionManager.endSession();

      // Session 2: Bug Y is fixed, but Bug X remains
      capture.clear();
      sessionManager.startSession('run-2');
      capture.inject(makeConsoleError('Bug X', now - 5000));

      const comparison = sessionManager.compareToBaseline('with-bugs');
      expect(comparison).not.toBeNull();
      expect(comparison!.fixedErrors).toHaveLength(1);
      expect(comparison!.knownErrors).toHaveLength(1);
      expect(comparison!.newErrors).toHaveLength(0);
      expect(comparison!.isRegression).toBe(false);
      expect(comparison!.delta).toBe(-1);

      sessionManager.endSession();

      // Verify session list
      const sessions = sessionManager.getSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].label).toBe('run-1');
      expect(sessions[1].label).toBe('run-2');
    });
  });
});
