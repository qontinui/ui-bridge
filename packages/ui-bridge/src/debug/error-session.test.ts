/**
 * Error Session & Session Manager Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorSession, ErrorSessionManager } from './error-session';
import type { ErrorBaseline } from './error-session';
import type {
  AnyCapturedEvent,
  ConsoleCapturedEvent,
  ReactErrorCapturedEvent,
} from './browser-capture-types';
import type { BrowserEventCaptureLike } from './error-timeline';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let eventCounter = 0;

function makeConsoleError(message: string, stack?: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'error',
    message,
    stack,
    timestamp: Date.now() + eventCounter++,
    url: 'http://localhost:3000',
  };
}

function makeConsoleWarn(message: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'warn',
    message,
    timestamp: Date.now() + eventCounter++,
    url: 'http://localhost:3000',
  };
}

function makeUnhandledRejection(message: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'unhandledrejection',
    message,
    timestamp: Date.now() + eventCounter++,
    url: 'http://localhost:3000',
  };
}

function makeReactError(message: string): ReactErrorCapturedEvent {
  return {
    type: 'react-error',
    message,
    timestamp: Date.now() + eventCounter++,
    url: 'http://localhost:3000',
  };
}

/**
 * Build a mock BrowserEventCaptureLike that returns a fixed list of events.
 */
function mockCapture(events: AnyCapturedEvent[]): BrowserEventCaptureLike {
  return {
    getSince: (_ts: number) => events.filter((e) => e.timestamp >= _ts),
    getRecent: (_n?: number) => (_n !== undefined ? events.slice(-_n) : [...events]),
    getByType: (type) => events.filter((e) => e.type === type),
  };
}

// ---------------------------------------------------------------------------
// ErrorSession
// ---------------------------------------------------------------------------

describe('ErrorSession', () => {
  let session: ErrorSession;

  beforeEach(() => {
    eventCounter = 0;
    session = new ErrorSession('test-session');
  });

  // -------------------------------------------------------------------------
  // recordEvent
  // -------------------------------------------------------------------------

  describe('recordEvent()', () => {
    it('should record an event and track its fingerprint', () => {
      const event = makeConsoleError('Something broke');
      session.recordEvent(event);

      expect(session.getAllEvents()).toHaveLength(1);
      expect(session.getFingerprints().size).toBe(1);
    });

    it('should classify error-level console events as severity "error"', () => {
      session.recordEvent(makeConsoleError('An error'));
      const [classified] = session.getAllEvents();
      expect(classified.severity).toBe('error');
      expect(classified.reason).toBe('console.error');
    });

    it('should classify warn-level console events as severity "warning"', () => {
      session.recordEvent(makeConsoleWarn('A warning'));
      const [classified] = session.getAllEvents();
      expect(classified.severity).toBe('warning');
    });

    it('should classify unhandledrejection as severity "crash"', () => {
      session.recordEvent(makeUnhandledRejection('Promise failed'));
      const [classified] = session.getAllEvents();
      expect(classified.severity).toBe('crash');
    });

    it('should track duplicate fingerprints but still record every event', () => {
      const event1 = makeConsoleError('Same error');
      const event2 = makeConsoleError('Same error');
      session.recordEvent(event1);
      session.recordEvent(event2);

      // Both events recorded
      expect(session.getAllEvents()).toHaveLength(2);
      // Only one unique fingerprint
      expect(session.getFingerprints().size).toBe(1);
    });

    it('should be a no-op after the session has ended', () => {
      session.recordEvent(makeConsoleError('Before end'));
      session.end();
      session.recordEvent(makeConsoleError('After end'));

      expect(session.getAllEvents()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // recordEvents (batch)
  // -------------------------------------------------------------------------

  describe('recordEvents()', () => {
    it('should record a batch of events', () => {
      const events = [
        makeConsoleError('Error A'),
        makeConsoleWarn('Warning B'),
        makeUnhandledRejection('Crash C'),
      ];
      session.recordEvents(events);

      expect(session.getAllEvents()).toHaveLength(3);
      expect(session.getFingerprints().size).toBe(3);
    });

    it('should handle an empty batch gracefully', () => {
      session.recordEvents([]);
      expect(session.getAllEvents()).toHaveLength(0);
    });

    it('should deduplicate fingerprints across batch and existing events', () => {
      session.recordEvent(makeConsoleError('Dup error'));
      session.recordEvents([makeConsoleError('Dup error'), makeConsoleError('New error')]);

      expect(session.getAllEvents()).toHaveLength(3);
      expect(session.getFingerprints().size).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // end()
  // -------------------------------------------------------------------------

  describe('end()', () => {
    it('should mark the session as inactive', () => {
      expect(session.isActive).toBe(true);
      session.end();
      expect(session.isActive).toBe(false);
    });

    it('should be idempotent — calling end() twice does not error', () => {
      session.end();
      session.end();
      expect(session.isActive).toBe(false);
    });

    it('should set endedAt in the summary', () => {
      session.end();
      const summary = session.getSummary();
      expect(summary.endedAt).toBeDefined();
      expect(summary.endedAt).toBeGreaterThanOrEqual(summary.startedAt);
    });
  });

  // -------------------------------------------------------------------------
  // getUniqueEvents()
  // -------------------------------------------------------------------------

  describe('getUniqueEvents()', () => {
    it('should return one event per fingerprint (first occurrence)', () => {
      const first = makeConsoleError('Repeated error');
      const second = makeConsoleError('Repeated error');
      session.recordEvent(first);
      session.recordEvent(second);

      const unique = session.getUniqueEvents();
      expect(unique).toHaveLength(1);
      // The representative event should be the first one recorded
      expect(unique[0].event).toBe(first);
    });

    it('should return events with different fingerprints separately', () => {
      session.recordEvent(makeConsoleError('Error A'));
      session.recordEvent(makeConsoleWarn('Warning B'));
      session.recordEvent(makeUnhandledRejection('Crash C'));

      const unique = session.getUniqueEvents();
      expect(unique).toHaveLength(3);
    });

    it('should return empty array for empty session', () => {
      expect(session.getUniqueEvents()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAllEvents()
  // -------------------------------------------------------------------------

  describe('getAllEvents()', () => {
    it('should return all recorded events including duplicates', () => {
      session.recordEvent(makeConsoleError('Err'));
      session.recordEvent(makeConsoleError('Err'));
      session.recordEvent(makeConsoleError('Err'));

      expect(session.getAllEvents()).toHaveLength(3);
    });

    it('should return a copy so mutations do not affect internal state', () => {
      session.recordEvent(makeConsoleError('Err'));
      const events = session.getAllEvents();
      events.length = 0;

      expect(session.getAllEvents()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // getFingerprints()
  // -------------------------------------------------------------------------

  describe('getFingerprints()', () => {
    it('should return a Set of unique fingerprints', () => {
      session.recordEvent(makeConsoleError('Alpha'));
      session.recordEvent(makeConsoleError('Beta'));
      session.recordEvent(makeConsoleError('Alpha')); // duplicate

      const fps = session.getFingerprints();
      expect(fps).toBeInstanceOf(Set);
      expect(fps.size).toBe(2);
    });

    it('should return a copy so external mutations do not affect session', () => {
      session.recordEvent(makeConsoleError('Something'));
      const fps = session.getFingerprints();
      fps.clear();

      expect(session.getFingerprints().size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getSummary()
  // -------------------------------------------------------------------------

  describe('getSummary()', () => {
    it('should return correct id and label', () => {
      const summary = session.getSummary();
      expect(summary.id).toBe(session.id);
      expect(summary.label).toBe('test-session');
    });

    it('should count events by severity', () => {
      session.recordEvent(makeConsoleError('Err 1'));
      session.recordEvent(makeConsoleError('Err 2'));
      session.recordEvent(makeConsoleWarn('Warn 1'));
      session.recordEvent(makeUnhandledRejection('Crash 1'));

      const summary = session.getSummary();
      expect(summary.bySeverity.crash).toBe(1);
      expect(summary.bySeverity.error).toBe(2);
      expect(summary.bySeverity.warning).toBe(1);
      expect(summary.bySeverity.noise).toBe(0);
    });

    it('should set hasCrashes to true when an unhandled rejection is recorded', () => {
      session.recordEvent(makeUnhandledRejection('Promise failed'));
      expect(session.getSummary().hasCrashes).toBe(true);
    });

    it('should set hasCrashes to true when a react-error is recorded', () => {
      session.recordEvent(makeReactError('Component blew up'));
      expect(session.getSummary().hasCrashes).toBe(true);
    });

    it('should set hasCrashes to false when only errors and warnings are recorded', () => {
      session.recordEvent(makeConsoleError('Error'));
      session.recordEvent(makeConsoleWarn('Warning'));
      expect(session.getSummary().hasCrashes).toBe(false);
    });

    it('should track uniqueErrorCount and totalEventCount separately', () => {
      session.recordEvent(makeConsoleError('Same'));
      session.recordEvent(makeConsoleError('Same'));
      session.recordEvent(makeConsoleError('Different'));

      const summary = session.getSummary();
      expect(summary.uniqueErrorCount).toBe(2);
      expect(summary.totalEventCount).toBe(3);
    });

    it('should not have endedAt when session is still active', () => {
      session.recordEvent(makeConsoleError('E'));
      const summary = session.getSummary();
      expect(summary.endedAt).toBeUndefined();
    });

    it('should return zero counts for an empty session', () => {
      const summary = session.getSummary();
      expect(summary.uniqueErrorCount).toBe(0);
      expect(summary.totalEventCount).toBe(0);
      expect(summary.bySeverity).toEqual({ crash: 0, error: 0, warning: 0, noise: 0 });
      expect(summary.hasCrashes).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isActive
  // -------------------------------------------------------------------------

  describe('isActive', () => {
    it('should be true for a newly created session', () => {
      expect(session.isActive).toBe(true);
    });

    it('should be false after end() is called', () => {
      session.end();
      expect(session.isActive).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // compareToBaseline()
  // -------------------------------------------------------------------------

  describe('compareToBaseline()', () => {
    function makeBaseline(events: AnyCapturedEvent[]): ErrorBaseline {
      // Use the real classify/fingerprint logic by recording into a scratch session
      const scratch = new ErrorSession();
      scratch.recordEvents(events);
      return {
        label: 'test-baseline',
        capturedAt: Date.now(),
        fingerprints: scratch.getFingerprints(),
        events: scratch.getUniqueEvents(),
      };
    }

    it('should identify new errors not present in baseline', () => {
      const baseline = makeBaseline([makeConsoleError('Old error')]);
      session.recordEvent(makeConsoleError('Brand new error'));

      const comparison = session.compareToBaseline(baseline);
      expect(comparison.newErrors).toHaveLength(1);
      expect(comparison.newErrors[0].event.type).toBe('console');
      expect(comparison.knownErrors).toHaveLength(0);
      // 'Old error' from the baseline is not in the session, so it is fixed
      expect(comparison.fixedErrors).toHaveLength(1);
    });

    it('should identify fixed errors present in baseline but not in session', () => {
      const baseline = makeBaseline([makeConsoleError('Fixed bug')]);
      // Session has no events at all
      const comparison = session.compareToBaseline(baseline);
      expect(comparison.fixedErrors).toHaveLength(1);
      expect(comparison.newErrors).toHaveLength(0);
    });

    it('should identify known errors present in both', () => {
      const sharedMsg = 'Known issue';
      const baseline = makeBaseline([makeConsoleError(sharedMsg)]);
      session.recordEvent(makeConsoleError(sharedMsg));

      const comparison = session.compareToBaseline(baseline);
      expect(comparison.knownErrors).toHaveLength(1);
      expect(comparison.newErrors).toHaveLength(0);
      expect(comparison.fixedErrors).toHaveLength(0);
    });

    it('should set isRegression=true when new errors include crash or error severity', () => {
      const baseline = makeBaseline([]);
      session.recordEvent(makeConsoleError('New error'));

      const comparison = session.compareToBaseline(baseline);
      expect(comparison.isRegression).toBe(true);
    });

    it('should set isRegression=true when new errors include a crash', () => {
      const baseline = makeBaseline([]);
      session.recordEvent(makeUnhandledRejection('Crash'));

      const comparison = session.compareToBaseline(baseline);
      expect(comparison.isRegression).toBe(true);
    });

    it('should set isRegression=false when new errors are only warnings', () => {
      const baseline = makeBaseline([]);
      session.recordEvent(makeConsoleWarn('Just a warning'));

      const comparison = session.compareToBaseline(baseline);
      expect(comparison.isRegression).toBe(false);
    });

    it('should set isRegression=false when there are no new errors', () => {
      const sharedMsg = 'Existing error';
      const baseline = makeBaseline([makeConsoleError(sharedMsg)]);
      session.recordEvent(makeConsoleError(sharedMsg));

      const comparison = session.compareToBaseline(baseline);
      expect(comparison.isRegression).toBe(false);
    });

    it('should compute positive delta when more significant errors are added', () => {
      const baseline = makeBaseline([]);
      session.recordEvent(makeConsoleError('New error A'));
      session.recordEvent(makeConsoleError('New error B'));

      const comparison = session.compareToBaseline(baseline);
      expect(comparison.delta).toBe(2);
    });

    it('should compute negative delta when significant errors are fixed', () => {
      const baseline = makeBaseline([
        makeConsoleError('Fixed A'),
        makeConsoleError('Fixed B'),
        makeConsoleError('Fixed C'),
      ]);
      // Session has none of these
      const comparison = session.compareToBaseline(baseline);
      expect(comparison.delta).toBe(-3);
    });

    it('should compute zero delta when warnings are added but no errors', () => {
      const baseline = makeBaseline([]);
      session.recordEvent(makeConsoleWarn('Warn 1'));
      session.recordEvent(makeConsoleWarn('Warn 2'));

      const comparison = session.compareToBaseline(baseline);
      expect(comparison.delta).toBe(0);
    });

    it('should handle mixed scenario: some new, some fixed, some known', () => {
      const baseline = makeBaseline([makeConsoleError('Known bug'), makeConsoleError('Fixed bug')]);
      session.recordEvent(makeConsoleError('Known bug'));
      session.recordEvent(makeConsoleError('New regression'));

      const comparison = session.compareToBaseline(baseline);
      expect(comparison.knownErrors).toHaveLength(1);
      expect(comparison.fixedErrors).toHaveLength(1);
      expect(comparison.newErrors).toHaveLength(1);
      expect(comparison.isRegression).toBe(true);
      // +1 new error, -1 fixed error => delta 0
      expect(comparison.delta).toBe(0);
    });

    it('should handle empty baseline and empty session', () => {
      const baseline = makeBaseline([]);
      const comparison = session.compareToBaseline(baseline);
      expect(comparison.newErrors).toHaveLength(0);
      expect(comparison.fixedErrors).toHaveLength(0);
      expect(comparison.knownErrors).toHaveLength(0);
      expect(comparison.isRegression).toBe(false);
      expect(comparison.delta).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// ErrorSessionManager
// ---------------------------------------------------------------------------

describe('ErrorSessionManager', () => {
  let manager: ErrorSessionManager;

  beforeEach(() => {
    eventCounter = 0;
    manager = new ErrorSessionManager();
  });

  // -------------------------------------------------------------------------
  // startSession()
  // -------------------------------------------------------------------------

  describe('startSession()', () => {
    it('should create a new active session', () => {
      const session = manager.startSession('my-session');
      expect(session).toBeDefined();
      expect(session.isActive).toBe(true);
      expect(session.label).toBe('my-session');
    });

    it('should end the previous active session when starting a new one', () => {
      const first = manager.startSession('first');
      const second = manager.startSession('second');

      expect(first.isActive).toBe(false);
      expect(second.isActive).toBe(true);
    });

    it('should create a session without a label', () => {
      const session = manager.startSession();
      expect(session.label).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // endSession()
  // -------------------------------------------------------------------------

  describe('endSession()', () => {
    it('should end the active session and return its summary', () => {
      const session = manager.startSession('s');
      session.recordEvent(makeConsoleError('Err'));

      const summary = manager.endSession();
      expect(summary).not.toBeNull();
      expect(summary!.totalEventCount).toBe(1);
      expect(summary!.endedAt).toBeDefined();
    });

    it('should return null if no active session exists', () => {
      expect(manager.endSession()).toBeNull();
    });

    it('should set active session to null after ending', () => {
      manager.startSession();
      manager.endSession();
      expect(manager.getActive()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getActive()
  // -------------------------------------------------------------------------

  describe('getActive()', () => {
    it('should return the active session', () => {
      const session = manager.startSession('test');
      expect(manager.getActive()).toBe(session);
    });

    it('should return null when no session is active', () => {
      expect(manager.getActive()).toBeNull();
    });

    it('should return null after endSession()', () => {
      manager.startSession();
      manager.endSession();
      expect(manager.getActive()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // recordEvent()
  // -------------------------------------------------------------------------

  describe('recordEvent()', () => {
    it('should forward the event to the active session', () => {
      const session = manager.startSession();
      manager.recordEvent(makeConsoleError('Forwarded error'));

      expect(session.getAllEvents()).toHaveLength(1);
    });

    it('should be a no-op when no session is active', () => {
      // Should not throw
      manager.recordEvent(makeConsoleError('Orphan error'));
      expect(manager.getActive()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getSessions()
  // -------------------------------------------------------------------------

  describe('getSessions()', () => {
    it('should return summaries for all sessions', () => {
      manager.startSession('a');
      manager.startSession('b');
      manager.startSession('c');

      const sessions = manager.getSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions.map((s) => s.label)).toEqual(['a', 'b', 'c']);
    });

    it('should return an empty array when no sessions exist', () => {
      expect(manager.getSessions()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getSession()
  // -------------------------------------------------------------------------

  describe('getSession()', () => {
    it('should find a session by ID', () => {
      const session = manager.startSession('find-me');
      const found = manager.getSession(session.id);

      expect(found).toBe(session);
    });

    it('should return null for an unknown ID', () => {
      expect(manager.getSession('nonexistent-id')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // captureBaseline()
  // -------------------------------------------------------------------------

  describe('captureBaseline()', () => {
    it('should create a baseline from capture events', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleError('Baseline error A'),
        makeConsoleWarn('Baseline warn B'),
      ];
      const capture = mockCapture(events);

      const baseline = manager.captureBaseline('clean-state', capture);
      expect(baseline.label).toBe('clean-state');
      expect(baseline.fingerprints.size).toBe(2);
      expect(baseline.events).toHaveLength(2);
      expect(baseline.capturedAt).toBeGreaterThan(0);
    });

    it('should deduplicate events in the baseline', () => {
      const events: AnyCapturedEvent[] = [
        makeConsoleError('Same error'),
        makeConsoleError('Same error'),
        makeConsoleError('Same error'),
      ];
      const capture = mockCapture(events);

      const baseline = manager.captureBaseline('dedup-test', capture);
      expect(baseline.fingerprints.size).toBe(1);
      expect(baseline.events).toHaveLength(1);
    });

    it('should overwrite a baseline with the same label', () => {
      const capture1 = mockCapture([makeConsoleError('First')]);
      const capture2 = mockCapture([makeConsoleError('Second')]);

      manager.captureBaseline('label', capture1);
      const baseline = manager.captureBaseline('label', capture2);

      // The baseline should reflect the second capture
      const retrieved = manager.getBaseline('label');
      expect(retrieved).toBe(baseline);
      expect(retrieved!.events).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // getBaseline()
  // -------------------------------------------------------------------------

  describe('getBaseline()', () => {
    it('should retrieve a baseline by label', () => {
      const capture = mockCapture([makeConsoleError('E')]);
      manager.captureBaseline('my-baseline', capture);

      const baseline = manager.getBaseline('my-baseline');
      expect(baseline).not.toBeNull();
      expect(baseline!.label).toBe('my-baseline');
    });

    it('should return null for an unknown label', () => {
      expect(manager.getBaseline('unknown')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getBaselines()
  // -------------------------------------------------------------------------

  describe('getBaselines()', () => {
    it('should list all baselines with label, capturedAt, and fingerprintCount', () => {
      const capture1 = mockCapture([makeConsoleError('A'), makeConsoleWarn('B')]);
      const capture2 = mockCapture([makeConsoleError('C')]);

      manager.captureBaseline('baseline-1', capture1);
      manager.captureBaseline('baseline-2', capture2);

      const list = manager.getBaselines();
      expect(list).toHaveLength(2);

      const b1 = list.find((b) => b.label === 'baseline-1');
      const b2 = list.find((b) => b.label === 'baseline-2');
      expect(b1).toBeDefined();
      expect(b1!.fingerprintCount).toBe(2);
      expect(b2).toBeDefined();
      expect(b2!.fingerprintCount).toBe(1);
    });

    it('should return an empty array when no baselines exist', () => {
      expect(manager.getBaselines()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // deleteBaseline()
  // -------------------------------------------------------------------------

  describe('deleteBaseline()', () => {
    it('should remove a baseline and return true', () => {
      const capture = mockCapture([makeConsoleError('X')]);
      manager.captureBaseline('to-delete', capture);

      expect(manager.deleteBaseline('to-delete')).toBe(true);
      expect(manager.getBaseline('to-delete')).toBeNull();
    });

    it('should return false when deleting a nonexistent baseline', () => {
      expect(manager.deleteBaseline('nope')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // compareToBaseline()
  // -------------------------------------------------------------------------

  describe('compareToBaseline()', () => {
    it('should compare active session against a named baseline', () => {
      // Capture a baseline with one error
      const baselineCapture = mockCapture([makeConsoleError('Known error')]);
      manager.captureBaseline('ref', baselineCapture);

      // Start a session with a new error and the same known error
      manager.startSession('compare-test');
      manager.recordEvent(makeConsoleError('Known error'));
      manager.recordEvent(makeConsoleError('Brand new error'));

      const comparison = manager.compareToBaseline('ref');
      expect(comparison).not.toBeNull();
      expect(comparison!.knownErrors).toHaveLength(1);
      expect(comparison!.newErrors).toHaveLength(1);
      expect(comparison!.isRegression).toBe(true);
    });

    it('should return null when baseline does not exist', () => {
      manager.startSession();
      expect(manager.compareToBaseline('nonexistent')).toBeNull();
    });

    it('should use capture instance when no active session exists', () => {
      // Capture baseline with one error
      const baselineCapture = mockCapture([makeConsoleError('Baseline error')]);
      manager.captureBaseline('ref', baselineCapture);

      // No active session, compare using a capture with different errors
      const currentCapture = mockCapture([makeConsoleError('New error only')]);
      const comparison = manager.compareToBaseline('ref', currentCapture);

      expect(comparison).not.toBeNull();
      expect(comparison!.newErrors).toHaveLength(1);
      expect(comparison!.fixedErrors).toHaveLength(1);
      expect(comparison!.knownErrors).toHaveLength(0);
    });

    it('should return null when no active session and no capture provided', () => {
      const baselineCapture = mockCapture([makeConsoleError('E')]);
      manager.captureBaseline('ref', baselineCapture);

      const comparison = manager.compareToBaseline('ref');
      expect(comparison).toBeNull();
    });

    it('should prefer active session over capture instance', () => {
      const baselineCapture = mockCapture([]);
      manager.captureBaseline('ref', baselineCapture);

      // Start session with an error
      const session = manager.startSession();
      session.recordEvent(makeConsoleError('Session error'));

      // Provide a capture with a different error — should be ignored
      const differentCapture = mockCapture([makeConsoleError('Capture error')]);
      const comparison = manager.compareToBaseline('ref', differentCapture);

      expect(comparison).not.toBeNull();
      expect(comparison!.newErrors).toHaveLength(1);
      // Should reflect the session error, not the capture error
      expect((comparison!.newErrors[0].event as ConsoleCapturedEvent).message).toBe(
        'Session error'
      );
    });

    it('should compute correct delta via capture (no active session)', () => {
      // Baseline with 2 errors
      const baselineCapture = mockCapture([
        makeConsoleError('Fixed A'),
        makeConsoleError('Fixed B'),
      ]);
      manager.captureBaseline('ref', baselineCapture);

      // Current capture with 1 new error (and none of the baseline errors)
      const currentCapture = mockCapture([makeConsoleError('New regression')]);
      const comparison = manager.compareToBaseline('ref', currentCapture);

      expect(comparison).not.toBeNull();
      expect(comparison!.newErrors).toHaveLength(1);
      expect(comparison!.fixedErrors).toHaveLength(2);
      // +1 new error, -2 fixed => delta = -1
      expect(comparison!.delta).toBe(-1);
      expect(comparison!.isRegression).toBe(true);
    });

    it('should set isRegression=false via capture when only warnings are new', () => {
      const baselineCapture = mockCapture([]);
      manager.captureBaseline('ref', baselineCapture);

      const currentCapture = mockCapture([makeConsoleWarn('Just a warning')]);
      const comparison = manager.compareToBaseline('ref', currentCapture);

      expect(comparison).not.toBeNull();
      expect(comparison!.isRegression).toBe(false);
      expect(comparison!.delta).toBe(0);
    });

    it('should deduplicate current capture events in ad-hoc comparison', () => {
      const baselineCapture = mockCapture([]);
      manager.captureBaseline('ref', baselineCapture);

      // Current capture has duplicates
      const currentCapture = mockCapture([
        makeConsoleError('Dup error'),
        makeConsoleError('Dup error'),
        makeConsoleError('Dup error'),
      ]);
      const comparison = manager.compareToBaseline('ref', currentCapture);

      expect(comparison).not.toBeNull();
      // Should be deduplicated to 1 unique new error
      expect(comparison!.newErrors).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // maxSessions (ring buffer trimming)
  // -------------------------------------------------------------------------

  describe('maxSessions trimming', () => {
    it('should trim sessions to maxSessions limit', () => {
      const smallManager = new ErrorSessionManager(3);

      smallManager.startSession('s1');
      smallManager.startSession('s2');
      smallManager.startSession('s3');
      smallManager.startSession('s4');
      smallManager.startSession('s5');

      const sessions = smallManager.getSessions();
      expect(sessions).toHaveLength(3);
      // Should keep the 3 most recent
      expect(sessions.map((s) => s.label)).toEqual(['s3', 's4', 's5']);
    });

    it('should still function after trimming', () => {
      const smallManager = new ErrorSessionManager(2);

      const s1 = smallManager.startSession('s1');
      smallManager.startSession('s2');
      smallManager.startSession('s3');

      // s1 should be trimmed out
      expect(smallManager.getSession(s1.id)).toBeNull();

      // Active session should still work
      const active = smallManager.getActive();
      expect(active).not.toBeNull();
      expect(active!.label).toBe('s3');
    });

    it('should not trim when under the limit', () => {
      const smallManager = new ErrorSessionManager(10);

      smallManager.startSession('a');
      smallManager.startSession('b');

      expect(smallManager.getSessions()).toHaveLength(2);
    });

    it('should trim to exactly maxSessions after each startSession', () => {
      const smallManager = new ErrorSessionManager(1);

      smallManager.startSession('one');
      expect(smallManager.getSessions()).toHaveLength(1);

      smallManager.startSession('two');
      expect(smallManager.getSessions()).toHaveLength(1);
      expect(smallManager.getSessions()[0].label).toBe('two');
    });
  });
});
