/**
 * Error Impact Assessment Tests
 */

import { describe, it, expect } from 'vitest';
import { ErrorImpactAssessor, type UIStateSnapshot, type ErrorImpactConfig } from './error-impact';
import type { AnyCapturedEvent } from './browser-capture-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConsoleError(message: string, ts = Date.now()): AnyCapturedEvent {
  return {
    type: 'console',
    level: 'error',
    message,
    timestamp: ts,
    stack: `Error: ${message}\n    at App (src/App.tsx:10:5)`,
  };
}

function makeReactError(message: string, ts = Date.now()): AnyCapturedEvent {
  return {
    type: 'react-error',
    message,
    stack: `Error: ${message}\n    at Component (src/Widget.tsx:5:3)`,
    componentStack: '\n    in Widget\n    in App',
    timestamp: ts,
  };
}

function makeSnapshot(overrides: Partial<UIStateSnapshot> = {}): UIStateSnapshot {
  return {
    elementIds: new Set(['btn-1', 'btn-2', 'input-1', 'header', 'footer']),
    disabledIds: new Set<string>(),
    errorBoundaryElements: new Set<string>(),
    url: 'http://localhost:3000/app',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeAssessor(snapshots: {
  before: UIStateSnapshot;
  after: UIStateSnapshot;
}): ErrorImpactAssessor {
  let callCount = 0;
  const config: ErrorImpactConfig = {
    captureUIState: () => {
      callCount++;
      // First call is captureBeforeState, subsequent calls are after-state
      return callCount <= 1 ? snapshots.before : snapshots.after;
    },
  };
  return new ErrorImpactAssessor(config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErrorImpactAssessor', () => {
  describe('assessImpact', () => {
    it('should return "recovered" when UI state does not change', () => {
      const before = makeSnapshot();
      const after = makeSnapshot({ timestamp: Date.now() + 100 });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const impact = assessor.assessImpact(makeConsoleError('Something failed'));

      expect(impact.recoveryStatus).toBe('recovered');
      expect(impact.uiConsequences.elementsRemoved).toEqual([]);
      expect(impact.uiConsequences.elementsAdded).toEqual([]);
      expect(impact.uiConsequences.elementsDisabled).toEqual([]);
      expect(impact.uiConsequences.renderBlocked).toBe(false);
      expect(impact.uiConsequences.errorBoundaryTriggered).toBe(false);
    });

    it('should detect elements removed after error', () => {
      const before = makeSnapshot();
      const after = makeSnapshot({
        elementIds: new Set(['btn-1', 'header', 'footer']),
        timestamp: Date.now() + 100,
      });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const impact = assessor.assessImpact(makeConsoleError('Component crashed'));

      expect(impact.uiConsequences.elementsRemoved).toContain('btn-2');
      expect(impact.uiConsequences.elementsRemoved).toContain('input-1');
      expect(impact.recoveryStatus).toBe('degraded');
    });

    it('should detect elements added after error', () => {
      const before = makeSnapshot();
      const after = makeSnapshot({
        elementIds: new Set([...before.elementIds, 'error-banner']),
        timestamp: Date.now() + 100,
      });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const impact = assessor.assessImpact(makeConsoleError('Something broke'));

      expect(impact.uiConsequences.elementsAdded).toContain('error-banner');
    });

    it('should detect elements disabled after error', () => {
      const before = makeSnapshot();
      const after = makeSnapshot({
        disabledIds: new Set(['btn-1', 'input-1']),
        timestamp: Date.now() + 100,
      });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const impact = assessor.assessImpact(makeConsoleError('Service unavailable'));

      expect(impact.uiConsequences.elementsDisabled).toContain('btn-1');
      expect(impact.uiConsequences.elementsDisabled).toContain('input-1');
      expect(impact.recoveryStatus).toBe('degraded');
    });

    it('should detect render blocked when most elements disappear', () => {
      const before = makeSnapshot();
      // Only 1 element remains out of 5 → 0.2 ratio → renderBlocked
      const after = makeSnapshot({
        elementIds: new Set(['footer']),
        timestamp: Date.now() + 100,
      });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const impact = assessor.assessImpact(makeReactError('App crashed'));

      expect(impact.uiConsequences.renderBlocked).toBe(true);
      expect(impact.recoveryStatus).toBe('fatal');
    });

    it('should detect fatal when >50% elements removed with no additions', () => {
      const before = makeSnapshot();
      // 2 out of 5 remain, 3 removed = 60% removed > 50% threshold
      const after = makeSnapshot({
        elementIds: new Set(['btn-1', 'header']),
        timestamp: Date.now() + 100,
      });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const impact = assessor.assessImpact(makeConsoleError('Massive failure'));

      expect(impact.recoveryStatus).toBe('fatal');
    });

    it('should detect error boundary triggered', () => {
      const before = makeSnapshot();
      const after = makeSnapshot({
        errorBoundaryElements: new Set(['error-boundary-1']),
        timestamp: Date.now() + 100,
      });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const impact = assessor.assessImpact(makeReactError('Render error'));

      expect(impact.uiConsequences.errorBoundaryTriggered).toBe(true);
      expect(impact.recoveryStatus).toBe('degraded');
    });

    it('should detect navigation triggered within threshold', () => {
      const before = makeSnapshot({ timestamp: Date.now() });
      const after = makeSnapshot({
        url: 'http://localhost:3000/error',
        timestamp: Date.now() + 200,
      });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const impact = assessor.assessImpact(makeConsoleError('Auth failed'));

      expect(impact.uiConsequences.navigationTriggered).toBe('http://localhost:3000/error');
    });

    it('should NOT detect navigation if time difference exceeds threshold', () => {
      const before = makeSnapshot({ timestamp: Date.now() });
      const after = makeSnapshot({
        url: 'http://localhost:3000/other',
        timestamp: Date.now() + 1000, // > 500ms default threshold
      });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const impact = assessor.assessImpact(makeConsoleError('Late nav'));

      expect(impact.uiConsequences.navigationTriggered).toBeUndefined();
    });

    it('should return "unknown" when no before state was captured', () => {
      const after = makeSnapshot();
      const assessor = new ErrorImpactAssessor({
        captureUIState: () => {
          return after;
        },
      });

      // Don't call captureBeforeState — go straight to assess
      const impact = assessor.assessImpact(makeConsoleError('No baseline'));

      expect(impact.recoveryStatus).toBe('unknown');
      expect(impact.uiConsequences.elementsRemoved).toEqual([]);
    });

    it('should include error metadata in the impact', () => {
      const before = makeSnapshot();
      const after = makeSnapshot({ timestamp: Date.now() + 100 });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      const event = makeConsoleError('TypeError: x is undefined');
      const impact = assessor.assessImpact(event);

      expect(impact.error.message).toBe('TypeError: x is undefined');
      expect(impact.error.severity).toBe('error');
      expect(impact.error.fingerprint).toBeTruthy();
      expect(impact.error.timestamp).toBe(event.timestamp);
      expect(impact.assessedAt).toBeGreaterThan(0);
    });
  });

  describe('assessEvents', () => {
    it('should only assess crash and error severity events', () => {
      const before = makeSnapshot();
      const after = makeSnapshot({ timestamp: Date.now() + 100 });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();

      const events: AnyCapturedEvent[] = [
        makeConsoleError('Real error'),
        {
          type: 'console',
          level: 'warn',
          message: 'Just a warning',
          timestamp: Date.now(),
        } as AnyCapturedEvent,
        makeReactError('React crash'),
      ];

      const impacts = assessor.assessEvents(events);

      // Should skip the warning event (severity=warning)
      expect(impacts).toHaveLength(2);
      expect(impacts[0].error.severity).toBe('error');
      expect(impacts[1].error.severity).toBe('crash');
    });
  });

  describe('getLastAssessment', () => {
    it('should return null before any assessment', () => {
      const assessor = new ErrorImpactAssessor({
        captureUIState: () => makeSnapshot(),
      });
      expect(assessor.getLastAssessment()).toBeNull();
    });

    it('should return the most recent assessment', () => {
      const before = makeSnapshot();
      const after = makeSnapshot({ timestamp: Date.now() + 100 });
      const assessor = makeAssessor({ before, after });

      assessor.captureBeforeState();
      assessor.assessImpact(makeConsoleError('First error'));
      const last = assessor.assessImpact(makeConsoleError('Second error'));

      expect(assessor.getLastAssessment()).toBe(last);
    });
  });
});
