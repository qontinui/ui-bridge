/**
 * Error Timeline Tests
 *
 * Covers TimelineBuffer: recording actions, merging timelines,
 * filtering, buffer management, and static computeErrorDiff.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AnyCapturedEvent, BrowserEventType } from './browser-capture-types';
import type {
  ConsoleCapturedEvent,
  ReactErrorCapturedEvent,
  NetworkCapturedEvent,
} from './browser-capture-types';
import type { BrowserEventCaptureLike, ActionTimelineEntry } from './error-timeline';
import { TimelineBuffer } from './error-timeline';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Create a mock BrowserEventCaptureLike backed by a simple event array. */
function createMockCapture(events: AnyCapturedEvent[] = []): BrowserEventCaptureLike {
  return {
    getSince(ts: number): AnyCapturedEvent[] {
      return events.filter((e) => e.timestamp >= ts);
    },
    getRecent(_n?: number): AnyCapturedEvent[] {
      return [...events];
    },
    getByType(type: BrowserEventType): AnyCapturedEvent[] {
      return events.filter((e) => e.type === type);
    },
  };
}

/** Shorthand: build a console error event. */
function consoleError(
  message: string,
  timestamp: number,
  opts?: { stack?: string; level?: 'error' | 'warn' | 'unhandledrejection' }
): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: opts?.level ?? 'error',
    message,
    timestamp,
    url: 'http://localhost:3000',
    stack: opts?.stack,
  };
}

/** Shorthand: build a console warning event. */
function consoleWarn(message: string, timestamp: number): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'warn',
    message,
    timestamp,
    url: 'http://localhost:3000',
  };
}

/** Shorthand: build a React error boundary event (crash severity). */
function reactError(message: string, timestamp: number, stack?: string): ReactErrorCapturedEvent {
  return {
    type: 'react-error',
    message,
    timestamp,
    url: 'http://localhost:3000',
    stack,
  };
}

/** Shorthand: build a navigation event (noise severity). */
function navigationEvent(timestamp: number): AnyCapturedEvent {
  return {
    type: 'navigation',
    timestamp,
    url: 'http://localhost:3000/page-a',
    from: 'http://localhost:3000/page-a',
    to: 'http://localhost:3000/page-b',
    trigger: 'pushState' as const,
  };
}

/** Shorthand: build a network error event. */
function networkError(
  requestUrl: string,
  timestamp: number,
  opts?: { status?: number; kind?: 'http-error' | 'network-error' | 'timeout' | 'cors' | 'abort' }
): NetworkCapturedEvent {
  return {
    type: 'network',
    method: 'GET',
    requestUrl,
    status: opts?.status ?? 500,
    durationMs: 120,
    kind: opts?.kind ?? 'http-error',
    timestamp,
    url: 'http://localhost:3000',
  };
}

/** Build a minimal action entry (without the `type` field, since recordAction adds it). */
function actionEntry(
  action: string,
  timestamp: number,
  opts?: Partial<Omit<ActionTimelineEntry, 'type'>>
): Omit<ActionTimelineEntry, 'type'> {
  return {
    action,
    timestamp,
    targetId: opts?.targetId ?? 'btn-1',
    targetLabel: opts?.targetLabel,
    success: opts?.success ?? true,
    durationMs: opts?.durationMs ?? 50,
    relatedEvents: opts?.relatedEvents ?? [],
  };
}

// ---------------------------------------------------------------------------
// Tests — TimelineBuffer instance methods
// ---------------------------------------------------------------------------

describe('TimelineBuffer', () => {
  let buffer: TimelineBuffer;

  beforeEach(() => {
    buffer = new TimelineBuffer();
  });

  // -------------------------------------------------------------------------
  // recordAction
  // -------------------------------------------------------------------------

  describe('recordAction', () => {
    it('records an action and increments actionCount', () => {
      expect(buffer.actionCount).toBe(0);
      buffer.recordAction(actionEntry('click', 1000));
      expect(buffer.actionCount).toBe(1);
    });

    it('records multiple actions in order', () => {
      buffer.recordAction(actionEntry('click', 1000));
      buffer.recordAction(actionEntry('type', 2000));
      buffer.recordAction(actionEntry('scroll', 3000));
      expect(buffer.actionCount).toBe(3);
    });

    it('adds type:"action" discriminator automatically', () => {
      buffer.recordAction(actionEntry('click', 1000));
      const capture = createMockCapture();
      const timeline = buffer.getTimeline(capture);
      expect(timeline).toHaveLength(1);
      expect(timeline[0].type).toBe('action');
    });
  });

  // -------------------------------------------------------------------------
  // actionCount
  // -------------------------------------------------------------------------

  describe('actionCount', () => {
    it('returns 0 for an empty buffer', () => {
      expect(buffer.actionCount).toBe(0);
    });

    it('returns correct count after multiple recordings', () => {
      buffer.recordAction(actionEntry('click', 100));
      buffer.recordAction(actionEntry('click', 200));
      expect(buffer.actionCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe('clear', () => {
    it('resets actionCount to 0', () => {
      buffer.recordAction(actionEntry('click', 1000));
      buffer.recordAction(actionEntry('type', 2000));
      expect(buffer.actionCount).toBe(2);

      buffer.clear();
      expect(buffer.actionCount).toBe(0);
    });

    it('produces an empty timeline after clear', () => {
      buffer.recordAction(actionEntry('click', 1000));
      buffer.clear();
      const capture = createMockCapture();
      const timeline = buffer.getTimeline(capture);
      expect(timeline).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Buffer trimming
  // -------------------------------------------------------------------------

  describe('buffer trimming', () => {
    it('trims oldest entries when exceeding maxEntries', () => {
      const smallBuffer = new TimelineBuffer(3);
      smallBuffer.recordAction(actionEntry('a', 100));
      smallBuffer.recordAction(actionEntry('b', 200));
      smallBuffer.recordAction(actionEntry('c', 300));
      expect(smallBuffer.actionCount).toBe(3);

      // Adding a 4th should trim the oldest
      smallBuffer.recordAction(actionEntry('d', 400));
      expect(smallBuffer.actionCount).toBe(3);

      // The timeline should contain b, c, d (oldest 'a' trimmed)
      const capture = createMockCapture();
      const timeline = smallBuffer.getTimeline(capture);
      expect(timeline).toHaveLength(3);
      expect((timeline[0] as ActionTimelineEntry).action).toBe('b');
      expect((timeline[1] as ActionTimelineEntry).action).toBe('c');
      expect((timeline[2] as ActionTimelineEntry).action).toBe('d');
    });

    it('respects custom maxEntries of 1', () => {
      const tiny = new TimelineBuffer(1);
      tiny.recordAction(actionEntry('first', 100));
      tiny.recordAction(actionEntry('second', 200));
      expect(tiny.actionCount).toBe(1);

      const capture = createMockCapture();
      const timeline = tiny.getTimeline(capture);
      expect(timeline).toHaveLength(1);
      expect((timeline[0] as ActionTimelineEntry).action).toBe('second');
    });
  });

  // -------------------------------------------------------------------------
  // getTimeline
  // -------------------------------------------------------------------------

  describe('getTimeline', () => {
    it('merges actions and browser events chronologically', () => {
      buffer.recordAction(actionEntry('click', 1000));
      buffer.recordAction(actionEntry('type', 3000));

      const capture = createMockCapture([
        consoleError('Something broke', 2000),
        navigationEvent(4000),
      ]);

      const timeline = buffer.getTimeline(capture);
      expect(timeline).toHaveLength(4);
      expect(timeline[0].timestamp).toBe(1000);
      expect(timeline[0].type).toBe('action');
      expect(timeline[1].timestamp).toBe(2000);
      expect(timeline[1].type).toBe('browser-event');
      expect(timeline[2].timestamp).toBe(3000);
      expect(timeline[2].type).toBe('action');
      expect(timeline[3].timestamp).toBe(4000);
      expect(timeline[3].type).toBe('browser-event');
    });

    it('returns an empty timeline when no actions or events exist', () => {
      const capture = createMockCapture();
      const timeline = buffer.getTimeline(capture);
      expect(timeline).toHaveLength(0);
    });

    it('returns only actions when capture has no events', () => {
      buffer.recordAction(actionEntry('click', 1000));
      const capture = createMockCapture();
      const timeline = buffer.getTimeline(capture);
      expect(timeline).toHaveLength(1);
      expect(timeline[0].type).toBe('action');
    });

    it('returns only browser events when no actions are recorded', () => {
      const capture = createMockCapture([consoleError('err', 500)]);
      const timeline = buffer.getTimeline(capture);
      expect(timeline).toHaveLength(1);
      expect(timeline[0].type).toBe('browser-event');
    });

    it('classifies browser events with severity, fingerprint, and sourceLocation', () => {
      const stack = '    at MyComponent (http://localhost:3000/src/App.tsx:42:10)';
      const capture = createMockCapture([consoleError('Test error', 1000, { stack })]);

      const timeline = buffer.getTimeline(capture);
      expect(timeline).toHaveLength(1);

      const entry = timeline[0];
      expect(entry.type).toBe('browser-event');
      if (entry.type === 'browser-event') {
        expect(entry.severity).toBe('error');
        expect(entry.fingerprint).toBeTruthy();
        expect(entry.sourceLocation).toBe('src/App.tsx:42');
        expect(entry.reason).toBe('console.error');
      }
    });

    // -----------------------------------------------------------------------
    // since filter
    // -----------------------------------------------------------------------

    describe('since filter', () => {
      it('filters actions by timestamp', () => {
        buffer.recordAction(actionEntry('old-click', 500));
        buffer.recordAction(actionEntry('new-click', 1500));

        const capture = createMockCapture();
        const timeline = buffer.getTimeline(capture, { since: 1000 });
        expect(timeline).toHaveLength(1);
        expect((timeline[0] as ActionTimelineEntry).action).toBe('new-click');
      });

      it('filters browser events by timestamp', () => {
        const capture = createMockCapture([
          consoleError('old error', 500),
          consoleError('new error', 1500),
        ]);

        const timeline = buffer.getTimeline(capture, { since: 1000 });
        expect(timeline).toHaveLength(1);
        if (timeline[0].type === 'browser-event') {
          expect(timeline[0].event.timestamp).toBe(1500);
        }
      });

      it('filters both actions and events together', () => {
        buffer.recordAction(actionEntry('old', 100));
        buffer.recordAction(actionEntry('new', 2000));

        const capture = createMockCapture([
          consoleError('old err', 200),
          consoleError('new err', 3000),
        ]);

        const timeline = buffer.getTimeline(capture, { since: 1000 });
        expect(timeline).toHaveLength(2);
        expect(timeline[0].timestamp).toBe(2000);
        expect(timeline[1].timestamp).toBe(3000);
      });

      it('includes events exactly at the since timestamp', () => {
        buffer.recordAction(actionEntry('exact', 1000));
        const capture = createMockCapture([consoleError('exact err', 1000)]);

        const timeline = buffer.getTimeline(capture, { since: 1000 });
        expect(timeline).toHaveLength(2);
      });
    });

    // -----------------------------------------------------------------------
    // limit option
    // -----------------------------------------------------------------------

    describe('limit option', () => {
      it('returns latest N entries when limit is set', () => {
        buffer.recordAction(actionEntry('a', 1000));
        buffer.recordAction(actionEntry('b', 2000));
        buffer.recordAction(actionEntry('c', 3000));

        const capture = createMockCapture();
        const timeline = buffer.getTimeline(capture, { limit: 2 });
        expect(timeline).toHaveLength(2);
        // Should be the last two entries
        expect((timeline[0] as ActionTimelineEntry).action).toBe('b');
        expect((timeline[1] as ActionTimelineEntry).action).toBe('c');
      });

      it('returns all entries if limit exceeds total count', () => {
        buffer.recordAction(actionEntry('a', 1000));
        const capture = createMockCapture();
        const timeline = buffer.getTimeline(capture, { limit: 100 });
        expect(timeline).toHaveLength(1);
      });

      it('returns all entries when limit is 0', () => {
        buffer.recordAction(actionEntry('a', 1000));
        buffer.recordAction(actionEntry('b', 2000));
        const capture = createMockCapture();
        const timeline = buffer.getTimeline(capture, { limit: 0 });
        expect(timeline).toHaveLength(2);
      });

      it('applies limit after merging actions and browser events', () => {
        buffer.recordAction(actionEntry('click', 1000));
        buffer.recordAction(actionEntry('type', 3000));

        const capture = createMockCapture([
          consoleError('err-1', 2000),
          consoleError('err-2', 4000),
        ]);

        const timeline = buffer.getTimeline(capture, { limit: 2 });
        expect(timeline).toHaveLength(2);
        // Last 2 of [1000, 2000, 3000, 4000] => 3000, 4000
        expect(timeline[0].timestamp).toBe(3000);
        expect(timeline[1].timestamp).toBe(4000);
      });
    });

    // -----------------------------------------------------------------------
    // minSeverity filter
    // -----------------------------------------------------------------------

    describe('minSeverity filter', () => {
      it('filters browser events by minimum severity', () => {
        const capture = createMockCapture([
          // error severity
          consoleError('real error', 1000),
          // noise severity (navigation)
          navigationEvent(2000),
          // warning severity
          consoleWarn('a warning', 3000),
        ]);

        const timeline = buffer.getTimeline(capture, { minSeverity: 'error' });
        // Only the console error should pass (severity: error, rank: 1)
        // Navigation is noise (rank: 3 > 1), warning is (rank: 2 > 1)
        expect(timeline).toHaveLength(1);
        expect(timeline[0].type).toBe('browser-event');
        expect(timeline[0].timestamp).toBe(1000);
      });

      it('does not filter actions regardless of minSeverity', () => {
        buffer.recordAction(actionEntry('click', 500));

        const capture = createMockCapture([
          navigationEvent(1000), // noise — will be filtered out
        ]);

        const timeline = buffer.getTimeline(capture, { minSeverity: 'crash' });
        // Action should still be present, navigation should be filtered
        expect(timeline).toHaveLength(1);
        expect(timeline[0].type).toBe('action');
      });

      it('minSeverity="warning" includes crash, error, and warning events', () => {
        const capture = createMockCapture([
          reactError('React crash', 100), // crash
          consoleError('An error', 200), // error
          consoleWarn('A warning', 300), // warning
          navigationEvent(400), // noise
        ]);

        const timeline = buffer.getTimeline(capture, { minSeverity: 'warning' });
        expect(timeline).toHaveLength(3);
      });

      it('minSeverity="noise" includes all events', () => {
        const capture = createMockCapture([consoleError('err', 100), navigationEvent(200)]);

        const timeline = buffer.getTimeline(capture, { minSeverity: 'noise' });
        expect(timeline).toHaveLength(2);
      });

      it('combines minSeverity with since and limit', () => {
        buffer.recordAction(actionEntry('click', 500));

        const capture = createMockCapture([
          consoleError('old-err', 100),
          consoleError('err-1', 1000),
          consoleWarn('warn-1', 2000), // filtered by minSeverity='error'
          consoleError('err-2', 3000),
          navigationEvent(4000), // filtered by minSeverity='error'
        ]);

        const timeline = buffer.getTimeline(capture, {
          since: 500,
          minSeverity: 'error',
          limit: 2,
        });
        // After since: click(500), err-1(1000), err-2(3000) — 3 entries
        // limit: 2 => last two => err-1(1000), err-2(3000)
        expect(timeline).toHaveLength(2);
        expect(timeline[0].timestamp).toBe(1000);
        expect(timeline[1].timestamp).toBe(3000);
      });
    });
  });

  // -------------------------------------------------------------------------
  // computeErrorDiff (static)
  // -------------------------------------------------------------------------

  describe('computeErrorDiff', () => {
    it('returns an empty diff when before and after are both empty', () => {
      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', [], []);
      expect(diff.action).toBe('click');
      expect(diff.targetId).toBe('btn-1');
      expect(diff.newEvents).toHaveLength(0);
      expect(diff.resolvedEvents).toHaveLength(0);
      expect(diff.persistingEvents).toHaveLength(0);
      expect(diff.errorDelta).toBe(0);
    });

    it('returns empty diff when before and after have the same events', () => {
      const events = [consoleError('same error', 1000)];
      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', events, events);
      expect(diff.newEvents).toHaveLength(0);
      expect(diff.resolvedEvents).toHaveLength(0);
      expect(diff.persistingEvents).toHaveLength(1);
      expect(diff.errorDelta).toBe(0);
    });

    it('detects new errors that appear after an action', () => {
      const before: AnyCapturedEvent[] = [];
      const after: AnyCapturedEvent[] = [consoleError('new error', 2000)];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      expect(diff.newEvents).toHaveLength(1);
      expect(diff.newEvents[0].event).toBe(after[0]);
      expect(diff.resolvedEvents).toHaveLength(0);
      expect(diff.persistingEvents).toHaveLength(0);
    });

    it('detects resolved errors that disappear after an action', () => {
      const before: AnyCapturedEvent[] = [consoleError('will be fixed', 1000)];
      const after: AnyCapturedEvent[] = [];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      expect(diff.newEvents).toHaveLength(0);
      expect(diff.resolvedEvents).toHaveLength(1);
      expect(diff.resolvedEvents[0].event).toBe(before[0]);
      expect(diff.persistingEvents).toHaveLength(0);
    });

    it('detects persisting errors present in both before and after', () => {
      const errorEvent = consoleError('persists', 1000);
      const before: AnyCapturedEvent[] = [errorEvent];
      // Same logical error at a different timestamp (same fingerprint)
      const afterCopy = consoleError('persists', 2000);
      const after: AnyCapturedEvent[] = [afterCopy];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      expect(diff.persistingEvents).toHaveLength(1);
      expect(diff.newEvents).toHaveLength(0);
      expect(diff.resolvedEvents).toHaveLength(0);
    });

    it('computes errorDelta counting only crash and error severity', () => {
      const before: AnyCapturedEvent[] = [];
      const after: AnyCapturedEvent[] = [
        // error severity (console.error) => counted
        consoleError('an error', 1000),
        // crash severity (react-error) => counted
        reactError('react crash', 1100),
        // warning severity (console.warn) => NOT counted
        consoleWarn('a warning', 1200),
        // noise severity (navigation) => NOT counted
        navigationEvent(1300),
      ];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      // 1 error + 1 crash = 2 significant new events, 0 resolved
      expect(diff.errorDelta).toBe(2);
    });

    it('computes negative errorDelta when errors are resolved', () => {
      const before: AnyCapturedEvent[] = [
        consoleError('error-1', 1000),
        reactError('crash-1', 1100),
      ];
      const after: AnyCapturedEvent[] = [];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      expect(diff.errorDelta).toBe(-2);
    });

    it('does not count warnings or noise in errorDelta', () => {
      const before: AnyCapturedEvent[] = [consoleWarn('old warning', 500)];
      const after: AnyCapturedEvent[] = [consoleWarn('new warning', 1500), navigationEvent(1600)];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      // Old warning resolved (not significant), new warning + navigation added (not significant)
      expect(diff.errorDelta).toBe(0);
    });

    it('same error with different timestamps but same fingerprint is not a new error', () => {
      const before: AnyCapturedEvent[] = [consoleError('Repeated error', 1000)];
      const after: AnyCapturedEvent[] = [
        consoleError('Repeated error', 5000), // different timestamp, same message
      ];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      expect(diff.newEvents).toHaveLength(0);
      expect(diff.resolvedEvents).toHaveLength(0);
      expect(diff.persistingEvents).toHaveLength(1);
      expect(diff.errorDelta).toBe(0);
    });

    it('handles a mix of new, resolved, and persisting events', () => {
      const before: AnyCapturedEvent[] = [
        consoleError('persists', 100),
        consoleError('will resolve', 200),
        reactError('old crash', 300),
      ];
      const after: AnyCapturedEvent[] = [
        consoleError('persists', 500), // same fingerprint => persisting
        consoleError('brand new error', 600), // new
        reactError('new crash', 700), // new
      ];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      expect(diff.persistingEvents).toHaveLength(1);
      expect(diff.resolvedEvents).toHaveLength(2); // 'will resolve' + 'old crash'
      expect(diff.newEvents).toHaveLength(2); // 'brand new error' + 'new crash'
      // errorDelta: new significant (1 error + 1 crash = 2) - resolved significant (1 error + 1 crash = 2) = 0
      expect(diff.errorDelta).toBe(0);
    });

    it('deduplicates by fingerprint — keeps first occurrence per fingerprint', () => {
      const before: AnyCapturedEvent[] = [];
      const after: AnyCapturedEvent[] = [
        consoleError('same error', 1000),
        consoleError('same error', 2000), // duplicate fingerprint
        consoleError('same error', 3000), // duplicate fingerprint
      ];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      // All three have the same fingerprint, so only 1 new event
      expect(diff.newEvents).toHaveLength(1);
      expect(diff.errorDelta).toBe(1);
    });

    it('treats different error messages as different fingerprints', () => {
      const before: AnyCapturedEvent[] = [];
      const after: AnyCapturedEvent[] = [
        consoleError('Error A', 1000),
        consoleError('Error B', 2000),
      ];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      expect(diff.newEvents).toHaveLength(2);
      expect(diff.errorDelta).toBe(2);
    });

    it('network errors on critical endpoints count as crash severity', () => {
      const before: AnyCapturedEvent[] = [];
      const after: AnyCapturedEvent[] = [
        networkError('http://localhost:3000/api/v1/auth/me', 1000, {
          kind: 'network-error',
        }),
      ];

      const diff = TimelineBuffer.computeErrorDiff('click', 'btn-1', before, after);
      expect(diff.newEvents).toHaveLength(1);
      expect(diff.newEvents[0].severity).toBe('crash');
      expect(diff.errorDelta).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // classifyAndEnrich (static)
  // -------------------------------------------------------------------------

  describe('classifyAndEnrich', () => {
    it('returns an empty array for empty input', () => {
      const result = TimelineBuffer.classifyAndEnrich([]);
      expect(result).toHaveLength(0);
    });

    it('enriches events with severity, reason, fingerprint, and sourceLocation', () => {
      const stack = '    at handleClick (http://localhost:3000/src/Button.tsx:15:5)';
      const events: AnyCapturedEvent[] = [consoleError('Something failed', 1000, { stack })];

      const result = TimelineBuffer.classifyAndEnrich(events);
      expect(result).toHaveLength(1);
      expect(result[0].severity).toBe('error');
      expect(result[0].reason).toBe('console.error');
      expect(result[0].fingerprint).toBeTruthy();
      expect(result[0].sourceLocation).toBe('src/Button.tsx:15');
      expect(result[0].event).toBe(events[0]);
    });

    it('classifies multiple event types correctly', () => {
      const events: AnyCapturedEvent[] = [
        reactError('React crash', 100),
        consoleWarn('A warning', 200),
        navigationEvent(300),
      ];

      const result = TimelineBuffer.classifyAndEnrich(events);
      expect(result).toHaveLength(3);
      expect(result[0].severity).toBe('crash');
      expect(result[1].severity).toBe('warning');
      expect(result[2].severity).toBe('noise');
    });
  });
});
