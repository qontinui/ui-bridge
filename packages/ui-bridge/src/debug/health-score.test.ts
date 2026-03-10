/**
 * Health Score Tests
 *
 * Comprehensive tests for computeHealthReport, computeHealthScore,
 * and computeHealthStatus from the health-score module.
 */

import { describe, it, expect } from 'vitest';
import { computeHealthReport, computeHealthScore, computeHealthStatus } from './health-score';
import type { HealthScoreConfig } from './health-score';
import type { BrowserEventCaptureLike } from './error-timeline';
import type {
  AnyCapturedEvent,
  BrowserEventType,
  ConsoleCapturedEvent,
  ReactErrorCapturedEvent,
  NetworkCapturedEvent,
  ResourceErrorCapturedEvent,
} from './browser-capture-types';

// ---------------------------------------------------------------------------
// Mock BrowserEventCaptureLike
// ---------------------------------------------------------------------------

/**
 * Simple mock capture that stores events and implements the duck-type
 * interface used by the health-score module.
 */
class MockCapture implements BrowserEventCaptureLike {
  private events: AnyCapturedEvent[];

  constructor(events: AnyCapturedEvent[] = []) {
    this.events = events;
  }

  getSince(ts: number): AnyCapturedEvent[] {
    return this.events.filter((e) => e.timestamp >= ts);
  }

  getRecent(n = 50): AnyCapturedEvent[] {
    return this.events.slice(-n);
  }

  getByType(type: BrowserEventType): AnyCapturedEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

// ---------------------------------------------------------------------------
// Event factory helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3000';

function makeConsoleError(message: string, tsOffset = 0): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'error',
    message,
    timestamp: Date.now() - tsOffset,
    url: BASE_URL,
  };
}

function makeConsoleWarn(message: string, tsOffset = 0): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'warn',
    message,
    timestamp: Date.now() - tsOffset,
    url: BASE_URL,
  };
}

function makeUnhandledRejection(message: string, tsOffset = 0): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'unhandledrejection',
    message,
    timestamp: Date.now() - tsOffset,
    url: BASE_URL,
  };
}

function makeReactError(message: string, tsOffset = 0): ReactErrorCapturedEvent {
  return {
    type: 'react-error',
    message,
    timestamp: Date.now() - tsOffset,
    url: BASE_URL,
  };
}

function makeNetworkCrash(endpoint: string, tsOffset = 0): NetworkCapturedEvent {
  return {
    type: 'network',
    method: 'GET',
    requestUrl: endpoint,
    status: 500,
    durationMs: 50,
    kind: 'http-error',
    timestamp: Date.now() - tsOffset,
    url: BASE_URL,
  };
}

function makeNetworkError(endpoint: string, tsOffset = 0): NetworkCapturedEvent {
  return {
    type: 'network',
    method: 'GET',
    requestUrl: endpoint,
    status: 500,
    durationMs: 100,
    kind: 'http-error',
    timestamp: Date.now() - tsOffset,
    url: BASE_URL,
  };
}

function makeNetwork4xx(endpoint: string, tsOffset = 0): NetworkCapturedEvent {
  return {
    type: 'network',
    method: 'GET',
    requestUrl: endpoint,
    status: 400,
    durationMs: 50,
    kind: 'http-error',
    timestamp: Date.now() - tsOffset,
    url: BASE_URL,
  };
}

function makeResourceError(
  tagName: string,
  resourceUrl: string,
  tsOffset = 0
): ResourceErrorCapturedEvent {
  return {
    type: 'resource-error',
    tagName,
    resourceUrl,
    timestamp: Date.now() - tsOffset,
    url: BASE_URL,
  };
}

// ---------------------------------------------------------------------------
// Tests: computeHealthReport
// ---------------------------------------------------------------------------

describe('computeHealthReport', () => {
  // -------------------------------------------------------------------------
  // No events
  // -------------------------------------------------------------------------

  describe('with no events', () => {
    it('returns healthy status, score 100, no top issue', () => {
      const capture = new MockCapture([]);
      const report = computeHealthReport(capture);

      expect(report.status).toBe('healthy');
      expect(report.score).toBe(100);
      expect(report.topIssue).toBeUndefined();
      expect(report.breakdown).toEqual({ crashes: 0, errors: 0, warnings: 0 });
      expect(report.errorRate).toBe(0);
    });

    it('generates a clean summary with no errors', () => {
      const capture = new MockCapture([]);
      const report = computeHealthReport(capture);

      expect(report.summary).toBe('Healthy: no errors in the last 1m');
    });

    it('includes the assessment window and timestamp', () => {
      const capture = new MockCapture([]);
      const before = Date.now();
      const report = computeHealthReport(capture);

      expect(report.windowMs).toBe(60_000);
      expect(report.timestamp).toBeGreaterThanOrEqual(before);
      expect(report.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  // -------------------------------------------------------------------------
  // Warning events
  // -------------------------------------------------------------------------

  describe('with warning events', () => {
    it('stays healthy, reduces score by 2 per warning', () => {
      const capture = new MockCapture([
        makeConsoleWarn('Something minor', 1000),
        makeConsoleWarn('Another minor thing', 2000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.status).toBe('healthy');
      expect(report.score).toBe(96); // 100 - 2*2
      expect(report.breakdown.warnings).toBe(2);
    });

    it('includes a summary mentioning warnings', () => {
      const capture = new MockCapture([makeConsoleWarn('Something minor', 1000)]);
      const report = computeHealthReport(capture);

      expect(report.summary).toBe('Healthy: 1 warning in the last 1m');
    });

    it('pluralizes warnings correctly', () => {
      const capture = new MockCapture([
        makeConsoleWarn('warn1', 1000),
        makeConsoleWarn('warn2', 2000),
        makeConsoleWarn('warn3', 3000),
      ]);
      const report = computeHealthReport(capture);

      // 3 warnings with 0 errors stays healthy (degraded requires errors)
      expect(report.summary).toContain('3 warnings');
    });

    it('sets topIssue to the most recent warning', () => {
      const capture = new MockCapture([
        makeConsoleWarn('Older warning', 5000),
        makeConsoleWarn('Newer warning', 1000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.topIssue).toBeDefined();
      expect(report.topIssue!.severity).toBe('warning');
      expect(report.topIssue!.message).toBe('Newer warning');
    });

    it('clamps score at 0 even with many warnings', () => {
      const warnings = Array.from({ length: 60 }, (_, i) => makeConsoleWarn(`warn ${i}`, i * 100));
      const capture = new MockCapture(warnings);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error events
  // -------------------------------------------------------------------------

  describe('with error events', () => {
    it('reduces score by 10 per error', () => {
      const capture = new MockCapture([
        makeConsoleError('Error one', 1000),
        makeConsoleError('Error two', 2000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(80); // 100 - 2*10
      expect(report.breakdown.errors).toBe(2);
    });

    it('becomes degraded at default threshold (3 errors)', () => {
      const capture = new MockCapture([
        makeConsoleError('e1', 1000),
        makeConsoleError('e2', 2000),
        makeConsoleError('e3', 3000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.status).toBe('degraded');
      expect(report.score).toBe(70); // 100 - 3*10
    });

    it('stays healthy with fewer errors than degradedThreshold', () => {
      const capture = new MockCapture([makeConsoleError('e1', 1000), makeConsoleError('e2', 2000)]);
      const report = computeHealthReport(capture);

      expect(report.status).toBe('healthy');
    });

    it('becomes broken at default brokenThreshold (8 errors)', () => {
      const errors = Array.from({ length: 8 }, (_, i) => makeConsoleError(`error ${i}`, i * 100));
      const capture = new MockCapture(errors);
      const report = computeHealthReport(capture);

      expect(report.status).toBe('broken');
      expect(report.score).toBe(20); // 100 - 8*10
    });

    it('generates a degraded summary with error count', () => {
      const capture = new MockCapture([
        makeConsoleError('e1', 1000),
        makeConsoleError('e2', 2000),
        makeConsoleError('e3', 3000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.summary).toBe('Degraded: 3 errors in the last 1m');
    });

    it('generates a broken summary with error count', () => {
      const errors = Array.from({ length: 8 }, (_, i) => makeConsoleError(`error ${i}`, i * 100));
      const capture = new MockCapture(errors);
      const report = computeHealthReport(capture);

      expect(report.summary).toBe('Broken: 8 errors in the last 1m');
    });
  });

  // -------------------------------------------------------------------------
  // Crash events
  // -------------------------------------------------------------------------

  describe('with crash events', () => {
    it('reduces score by 40 per crash', () => {
      const capture = new MockCapture([makeReactError('Component exploded', 1000)]);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(60); // 100 - 1*40
      expect(report.breakdown.crashes).toBe(1);
    });

    it('sets status to broken when crashIsBroken=true (default)', () => {
      const capture = new MockCapture([makeReactError('Component exploded', 1000)]);
      const report = computeHealthReport(capture);

      expect(report.status).toBe('broken');
    });

    it('classifies unhandled rejections as crashes', () => {
      const capture = new MockCapture([makeUnhandledRejection('Async failure', 1000)]);
      const report = computeHealthReport(capture);

      expect(report.status).toBe('broken');
      expect(report.breakdown.crashes).toBe(1);
      expect(report.score).toBe(60);
    });

    it('classifies network errors on critical endpoints as crashes', () => {
      const capture = new MockCapture([makeNetworkCrash('/api/v1/auth/users/me', 1000)]);
      const report = computeHealthReport(capture);

      expect(report.status).toBe('broken');
      expect(report.breakdown.crashes).toBe(1);
    });

    it('clamps score at 0 with multiple crashes', () => {
      const capture = new MockCapture([
        makeReactError('crash1', 1000),
        makeReactError('crash2', 2000),
        makeReactError('crash3', 3000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(0); // 100 - 3*40 = -20, clamped to 0
    });

    it('generates a broken summary with crash count', () => {
      const capture = new MockCapture([
        makeReactError('crash1', 1000),
        makeReactError('crash2', 2000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.summary).toBe('Broken: 2 crashes in the last 1m');
    });
  });

  // -------------------------------------------------------------------------
  // Mixed severity events
  // -------------------------------------------------------------------------

  describe('with mixed severity events', () => {
    it('combines score deductions from crashes, errors, and warnings', () => {
      const capture = new MockCapture([
        makeReactError('crash', 1000), // -40
        makeConsoleError('error1', 2000), // -10
        makeConsoleError('error2', 3000), // -10
        makeConsoleWarn('warning', 4000), // -2
      ]);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(38); // 100 - 40 - 10 - 10 - 2
      expect(report.breakdown).toEqual({ crashes: 1, errors: 2, warnings: 1 });
    });

    it('generates a summary with crashes and errors and warnings', () => {
      const capture = new MockCapture([
        makeReactError('crash', 1000),
        makeConsoleError('error', 2000),
        makeConsoleError('error', 2500),
        makeConsoleError('error', 2700),
        makeConsoleWarn('warning', 3000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.summary).toBe('Broken: 1 crash and 3 errors and 1 warning in the last 1m');
    });

    it('pluralizes correctly with multiple of each', () => {
      const capture = new MockCapture([
        makeReactError('crash1', 1000),
        makeReactError('crash2', 1500),
        makeConsoleError('e1', 2000),
        makeConsoleError('e2', 2500),
        makeConsoleWarn('w1', 3000),
        makeConsoleWarn('w2', 3500),
      ]);
      const report = computeHealthReport(capture);

      expect(report.summary).toContain('2 crashes');
      expect(report.summary).toContain('2 errors');
      expect(report.summary).toContain('2 warnings');
    });
  });

  // -------------------------------------------------------------------------
  // Noise events (should be ignored)
  // -------------------------------------------------------------------------

  describe('with noise events', () => {
    it('ignores navigation events', () => {
      const capture = new MockCapture([
        {
          type: 'navigation' as const,
          from: '/',
          to: '/about',
          trigger: 'pushState' as const,
          timestamp: Date.now() - 1000,
          url: BASE_URL,
        },
      ]);
      const report = computeHealthReport(capture);

      expect(report.status).toBe('healthy');
      expect(report.score).toBe(100);
      expect(report.topIssue).toBeUndefined();
    });

    it('ignores memory events', () => {
      const capture = new MockCapture([
        {
          type: 'memory' as const,
          usedJSHeapSize: 50_000_000,
          totalJSHeapSize: 100_000_000,
          jsHeapSizeLimit: 200_000_000,
          timestamp: Date.now() - 1000,
          url: BASE_URL,
        },
      ]);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(100);
    });

    it('ignores web vital events', () => {
      const capture = new MockCapture([
        {
          type: 'web-vital' as const,
          metric: 'LCP' as const,
          value: 2500,
          timestamp: Date.now() - 1000,
          url: BASE_URL,
        },
      ]);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(100);
    });

    it('ignores console errors that match noise patterns', () => {
      const capture = new MockCapture([
        makeConsoleError('ResizeObserver loop completed with undelivered notifications', 1000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(100);
      expect(report.breakdown.errors).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Custom config
  // -------------------------------------------------------------------------

  describe('with custom config', () => {
    it('respects custom windowMs', () => {
      // Events 30 seconds ago, window is only 10 seconds
      const capture = new MockCapture([makeConsoleError('old error', 30_000)]);
      const report = computeHealthReport(capture, { windowMs: 10_000 });

      expect(report.score).toBe(100);
      expect(report.breakdown.errors).toBe(0);
      expect(report.windowMs).toBe(10_000);
    });

    it('includes events within custom windowMs', () => {
      const capture = new MockCapture([makeConsoleError('recent error', 5000)]);
      const report = computeHealthReport(capture, { windowMs: 10_000 });

      expect(report.score).toBe(90);
      expect(report.breakdown.errors).toBe(1);
    });

    it('formats summary for short window durations', () => {
      const capture = new MockCapture([]);
      const report = computeHealthReport(capture, { windowMs: 500 });

      expect(report.summary).toBe('Healthy: no errors in the last 500ms');
    });

    it('formats summary for window durations in seconds', () => {
      const capture = new MockCapture([]);
      const report = computeHealthReport(capture, { windowMs: 30_000 });

      expect(report.summary).toBe('Healthy: no errors in the last 30s');
    });

    it('respects crashIsBroken=false', () => {
      const capture = new MockCapture([makeReactError('React crash', 1000)]);
      const report = computeHealthReport(capture, { crashIsBroken: false });

      // With crashIsBroken=false, a single crash doesn't force broken status.
      // It has 0 errors, so it stays healthy (crashes alone don't hit error thresholds).
      expect(report.status).toBe('healthy');
      expect(report.score).toBe(60); // Still deducted 40 for the crash
    });

    it('respects custom degradedThreshold', () => {
      const capture = new MockCapture([makeConsoleError('e1', 1000), makeConsoleError('e2', 2000)]);

      // Default threshold is 3, so 2 errors = healthy
      expect(computeHealthReport(capture).status).toBe('healthy');

      // Custom threshold of 2 makes it degraded
      expect(computeHealthReport(capture, { degradedThreshold: 2 }).status).toBe('degraded');
    });

    it('respects custom brokenThreshold', () => {
      const capture = new MockCapture(
        Array.from({ length: 5 }, (_, i) => makeConsoleError(`error ${i}`, i * 100))
      );

      // Default broken threshold is 8, so 5 errors = degraded
      expect(computeHealthReport(capture).status).toBe('degraded');

      // Custom broken threshold of 5 makes it broken
      expect(computeHealthReport(capture, { brokenThreshold: 5 }).status).toBe('broken');
    });

    it('combines crashIsBroken=false with error thresholds', () => {
      const events: AnyCapturedEvent[] = [
        makeReactError('crash1', 1000),
        ...Array.from({ length: 8 }, (_, i) => makeConsoleError(`e${i}`, i * 100 + 2000)),
      ];
      const capture = new MockCapture(events);

      // crashIsBroken=false, but 8 errors still makes it broken
      const report = computeHealthReport(capture, { crashIsBroken: false });
      expect(report.status).toBe('broken');
    });
  });

  // -------------------------------------------------------------------------
  // errorRate calculation
  // -------------------------------------------------------------------------

  describe('errorRate', () => {
    it('computes errors per minute (crashes + errors)', () => {
      const capture = new MockCapture([
        makeReactError('crash', 1000), // 1 crash
        makeConsoleError('e1', 2000), // 1 error
        makeConsoleError('e2', 3000), // 1 error
        makeConsoleWarn('w1', 4000), // warning (not counted)
      ]);

      // Default window = 60s = 1 minute, so errorRate = (1 crash + 2 errors) / 1 = 3
      const report = computeHealthReport(capture);
      expect(report.errorRate).toBe(3);
    });

    it('scales correctly with custom windowMs', () => {
      const capture = new MockCapture([makeConsoleError('e1', 1000), makeConsoleError('e2', 2000)]);

      // Window = 30 seconds = 0.5 minutes, 2 errors / 0.5 = 4 per minute
      const report = computeHealthReport(capture, { windowMs: 30_000 });
      expect(report.errorRate).toBe(4);
    });

    it('returns 0 with no errors or crashes', () => {
      const capture = new MockCapture([makeConsoleWarn('just a warning', 1000)]);
      const report = computeHealthReport(capture);
      expect(report.errorRate).toBe(0);
    });

    it('rounds to two decimal places', () => {
      // 1 error in a 7-second window = 1 / (7/60) = 8.5714..., rounded to 8.57
      const capture = new MockCapture([makeConsoleError('e1', 1000)]);
      const report = computeHealthReport(capture, { windowMs: 7000 });

      expect(report.errorRate).toBe(Math.round((1 / (7000 / 60_000)) * 100) / 100);
    });
  });

  // -------------------------------------------------------------------------
  // topIssue
  // -------------------------------------------------------------------------

  describe('topIssue', () => {
    it('is undefined when there are no events', () => {
      const capture = new MockCapture([]);
      const report = computeHealthReport(capture);
      expect(report.topIssue).toBeUndefined();
    });

    it('is undefined when all events are noise', () => {
      const capture = new MockCapture([
        {
          type: 'navigation' as const,
          from: '/',
          to: '/about',
          trigger: 'pushState' as const,
          timestamp: Date.now() - 1000,
          url: BASE_URL,
        },
      ]);
      const report = computeHealthReport(capture);
      expect(report.topIssue).toBeUndefined();
    });

    it('picks the most critical (lowest rank) event', () => {
      const capture = new MockCapture([
        makeConsoleWarn('A warning', 3000),
        makeConsoleError('An error', 2000),
        makeReactError('A crash', 1000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.topIssue).toBeDefined();
      expect(report.topIssue!.severity).toBe('crash');
      expect(report.topIssue!.message).toBe('A crash');
    });

    it('picks the most recent among equal severity events', () => {
      const capture = new MockCapture([
        makeConsoleError('Older error', 5000),
        makeConsoleError('Newer error', 1000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.topIssue).toBeDefined();
      expect(report.topIssue!.severity).toBe('error');
      expect(report.topIssue!.message).toBe('Newer error');
    });

    it('picks a crash over a more recent error', () => {
      const capture = new MockCapture([
        makeReactError('Old crash', 10000),
        makeConsoleError('Recent error', 100),
      ]);
      const report = computeHealthReport(capture);

      expect(report.topIssue!.severity).toBe('crash');
      expect(report.topIssue!.message).toBe('Old crash');
    });

    it('includes the correct timestamp', () => {
      const capture = new MockCapture([makeConsoleError('Some error', 2000)]);
      const report = computeHealthReport(capture);

      expect(report.topIssue).toBeDefined();
      expect(report.topIssue!.timestamp).toBeGreaterThan(0);
      expect(report.topIssue!.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('extracts message from different event types', () => {
      // Test React error message extraction
      const capture1 = new MockCapture([makeReactError('Component failed', 1000)]);
      expect(computeHealthReport(capture1).topIssue!.message).toBe('Component failed');

      // Test resource error message extraction
      const capture2 = new MockCapture([
        makeResourceError('script', 'https://cdn.example.com/app.js', 1000),
      ]);
      expect(computeHealthReport(capture2).topIssue!.message).toBe(
        'Failed to load script: https://cdn.example.com/app.js'
      );

      // Test network error message extraction
      const capture3 = new MockCapture([makeNetworkError('/api/data', 1000)]);
      expect(computeHealthReport(capture3).topIssue!.message).toBe('GET /api/data \u2192 500');
    });
  });

  // -------------------------------------------------------------------------
  // Events outside window are excluded
  // -------------------------------------------------------------------------

  describe('window filtering', () => {
    it('excludes events outside the assessment window', () => {
      // Event from 2 minutes ago, default window is 1 minute
      const capture = new MockCapture([makeConsoleError('old error', 120_000)]);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(100);
      expect(report.breakdown.errors).toBe(0);
    });

    it('includes events within the assessment window', () => {
      const capture = new MockCapture([makeConsoleError('recent error', 30_000)]);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(90);
      expect(report.breakdown.errors).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles a single warning event with correct pluralization', () => {
      const capture = new MockCapture([makeConsoleWarn('lone warning', 1000)]);
      const report = computeHealthReport(capture);

      expect(report.summary).toBe('Healthy: 1 warning in the last 1m');
    });

    it('handles a single error event with correct pluralization', () => {
      const capture = new MockCapture([
        makeConsoleError('e1', 1000),
        makeConsoleError('e2', 2000),
        makeConsoleError('e3', 3000),
        makeConsoleError('e4', 4000),
      ]);
      const report = computeHealthReport(capture);

      expect(report.summary).toBe('Degraded: 4 errors in the last 1m');
    });

    it('handles a single crash event with correct pluralization', () => {
      const capture = new MockCapture([makeReactError('single crash', 1000)]);
      const report = computeHealthReport(capture);

      expect(report.summary).toBe('Broken: 1 crash in the last 1m');
    });

    it('score never goes below 0', () => {
      const events: AnyCapturedEvent[] = [
        ...Array.from({ length: 5 }, (_, i) => makeReactError(`crash${i}`, i * 100)),
        ...Array.from({ length: 10 }, (_, i) => makeConsoleError(`error${i}`, i * 100 + 500)),
      ];
      const capture = new MockCapture(events);
      const report = computeHealthReport(capture);

      expect(report.score).toBe(0);
    });

    it('correctly counts resource errors that classify as errors vs warnings', () => {
      const capture = new MockCapture([
        makeResourceError('script', '/app.js', 1000), // error
        makeResourceError('img', '/photo.png', 2000), // warning
      ]);
      const report = computeHealthReport(capture);

      expect(report.breakdown.errors).toBe(1);
      expect(report.breakdown.warnings).toBe(1);
      expect(report.score).toBe(88); // 100 - 10 - 2
    });

    it('correctly counts HMR errors vs warnings', () => {
      const capture = new MockCapture([
        {
          type: 'hmr' as const,
          level: 'error' as const,
          message: 'Compilation failed',
          timestamp: Date.now() - 1000,
          url: BASE_URL,
        },
        {
          type: 'hmr' as const,
          level: 'warning' as const,
          message: 'Minor hmr warning',
          timestamp: Date.now() - 2000,
          url: BASE_URL,
        },
      ]);
      const report = computeHealthReport(capture);

      expect(report.breakdown.errors).toBe(1);
      expect(report.breakdown.warnings).toBe(1);
    });

    it('handles network 4xx as warnings', () => {
      const capture = new MockCapture([makeNetwork4xx('/api/resource', 1000)]);
      const report = computeHealthReport(capture);

      expect(report.breakdown.warnings).toBe(1);
      expect(report.breakdown.errors).toBe(0);
      expect(report.score).toBe(98);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: computeHealthScore
// ---------------------------------------------------------------------------

describe('computeHealthScore', () => {
  it('returns just the numeric score', () => {
    const capture = new MockCapture([]);
    const score = computeHealthScore(capture);

    expect(typeof score).toBe('number');
    expect(score).toBe(100);
  });

  it('reflects deductions from errors', () => {
    const capture = new MockCapture([makeConsoleError('e1', 1000), makeConsoleError('e2', 2000)]);
    const score = computeHealthScore(capture);

    expect(score).toBe(80);
  });

  it('passes config through', () => {
    // Event outside a short custom window
    const capture = new MockCapture([makeConsoleError('old', 30_000)]);
    const score = computeHealthScore(capture, { windowMs: 10_000 });

    expect(score).toBe(100);
  });

  it('matches the score from computeHealthReport', () => {
    const capture = new MockCapture([
      makeReactError('crash', 1000),
      makeConsoleError('e1', 2000),
      makeConsoleWarn('w1', 3000),
    ]);
    const config: HealthScoreConfig = { windowMs: 60_000 };

    const report = computeHealthReport(capture, config);
    const score = computeHealthScore(capture, config);

    expect(score).toBe(report.score);
  });
});

// ---------------------------------------------------------------------------
// Tests: computeHealthStatus
// ---------------------------------------------------------------------------

describe('computeHealthStatus', () => {
  it('returns just the status string', () => {
    const capture = new MockCapture([]);
    const status = computeHealthStatus(capture);

    expect(typeof status).toBe('string');
    expect(status).toBe('healthy');
  });

  it('returns degraded when there are enough errors', () => {
    const capture = new MockCapture([
      makeConsoleError('e1', 1000),
      makeConsoleError('e2', 2000),
      makeConsoleError('e3', 3000),
    ]);

    expect(computeHealthStatus(capture)).toBe('degraded');
  });

  it('returns broken when crashIsBroken=true and crash is present', () => {
    const capture = new MockCapture([makeReactError('crash', 1000)]);
    expect(computeHealthStatus(capture)).toBe('broken');
  });

  it('passes config through', () => {
    const capture = new MockCapture([makeReactError('crash', 1000)]);
    expect(computeHealthStatus(capture, { crashIsBroken: false })).toBe('healthy');
  });

  it('matches the status from computeHealthReport', () => {
    const capture = new MockCapture([makeReactError('crash', 1000), makeConsoleError('e1', 2000)]);
    const config: HealthScoreConfig = { crashIsBroken: true };

    const report = computeHealthReport(capture, config);
    const status = computeHealthStatus(capture, config);

    expect(status).toBe(report.status);
  });
});
