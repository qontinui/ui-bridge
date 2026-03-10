/**
 * ErrorSnapshotBuffer Tests
 */

import { describe, it, expect } from 'vitest';
import { ErrorSnapshotBuffer, extractMessage } from './error-snapshot';
import type { ErrorSnapshotPageState } from './error-snapshot';
import type {
  AnyCapturedEvent,
  ConsoleCapturedEvent,
  NetworkCapturedEvent,
  ReactErrorCapturedEvent,
  ResourceErrorCapturedEvent,
  HmrCapturedEvent,
  WsDisconnectionCapturedEvent,
  LongTaskCapturedEvent,
  LoafCapturedEvent,
  NavigationCapturedEvent,
  WebVitalCapturedEvent,
  MemoryCapturedEvent,
} from './browser-capture-types';

// ---------------------------------------------------------------------------
// Mock event helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3000';

function makeConsoleError(message: string, stack?: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'error',
    message,
    stack,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeConsoleWarn(message: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'warn',
    message,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeUnhandledRejection(message: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'unhandledrejection',
    message,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeReactError(message: string, stack?: string): ReactErrorCapturedEvent {
  return {
    type: 'react-error',
    message,
    stack,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeNetworkError(
  method: string,
  requestUrl: string,
  opts?: { status?: number; kind?: NetworkCapturedEvent['kind']; errorMessage?: string }
): NetworkCapturedEvent {
  return {
    type: 'network',
    method,
    requestUrl,
    status: opts?.status,
    durationMs: 100,
    kind: opts?.kind ?? 'http-error',
    errorMessage: opts?.errorMessage,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeResourceError(tagName: string, resourceUrl: string): ResourceErrorCapturedEvent {
  return {
    type: 'resource-error',
    tagName,
    resourceUrl,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeHmrEvent(level: 'error' | 'warning', message: string): HmrCapturedEvent {
  return {
    type: 'hmr',
    level,
    message,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeWsDisconnection(
  previousState: string,
  newState: string
): WsDisconnectionCapturedEvent {
  return {
    type: 'ws-disconnection',
    previousState,
    newState,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeLongTask(durationMs: number): LongTaskCapturedEvent {
  return {
    type: 'long-task',
    durationMs,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeLoaf(durationMs: number, blockingDurationMs: number): LoafCapturedEvent {
  return {
    type: 'long-animation-frame',
    durationMs,
    blockingDurationMs,
    scripts: [],
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeNavigation(from: string, to: string): NavigationCapturedEvent {
  return {
    type: 'navigation',
    from,
    to,
    trigger: 'pushState',
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeWebVital(metric: 'LCP' | 'CLS', value: number): WebVitalCapturedEvent {
  return {
    type: 'web-vital',
    metric,
    value,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

function makeMemory(usedMB: number): MemoryCapturedEvent {
  return {
    type: 'memory',
    usedJSHeapSize: usedMB * 1024 * 1024,
    totalJSHeapSize: 512 * 1024 * 1024,
    jsHeapSizeLimit: 1024 * 1024 * 1024,
    timestamp: Date.now(),
    url: BASE_URL,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErrorSnapshotBuffer', () => {
  describe('processEvent()', () => {
    it('returns an ErrorSnapshot for error severity events', () => {
      const buffer = new ErrorSnapshotBuffer();
      const event = makeConsoleError('Something failed');
      const snapshot = buffer.processEvent(event);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.id).toMatch(/^snap-/);
      expect(snapshot!.error.message).toBe('Something failed');
      expect(snapshot!.error.severity).toBe('error');
      expect(snapshot!.error.fingerprint).toBeDefined();
      expect(snapshot!.error.timestamp).toBe(event.timestamp);
      expect(snapshot!.capturedAt).toBeGreaterThan(0);
    });

    it('returns an ErrorSnapshot for crash severity events', () => {
      const buffer = new ErrorSnapshotBuffer();
      const event = makeUnhandledRejection('Promise rejected');
      const snapshot = buffer.processEvent(event);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.error.severity).toBe('crash');
    });

    it('returns an ErrorSnapshot for react-error events (crash severity)', () => {
      const buffer = new ErrorSnapshotBuffer();
      const event = makeReactError('Component crashed');
      const snapshot = buffer.processEvent(event);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.error.severity).toBe('crash');
      expect(snapshot!.error.message).toBe('Component crashed');
    });

    it('returns null for warning severity events', () => {
      const buffer = new ErrorSnapshotBuffer();
      const event = makeConsoleWarn('Just a warning');
      const snapshot = buffer.processEvent(event);

      expect(snapshot).toBeNull();
    });

    it('returns null for noise severity events', () => {
      const buffer = new ErrorSnapshotBuffer();
      const event = makeNavigation('/a', '/b');
      const snapshot = buffer.processEvent(event);

      expect(snapshot).toBeNull();
    });

    it('deduplicates by fingerprint by default', () => {
      const buffer = new ErrorSnapshotBuffer();
      const event1 = makeConsoleError('Duplicate error');
      const event2 = makeConsoleError('Duplicate error');

      const snap1 = buffer.processEvent(event1);
      const snap2 = buffer.processEvent(event2);

      expect(snap1).not.toBeNull();
      expect(snap2).toBeNull();
    });

    it('allows duplicates when deduplicateByFingerprint is false', () => {
      const buffer = new ErrorSnapshotBuffer({ deduplicateByFingerprint: false });
      const event1 = makeConsoleError('Same error');
      const event2 = makeConsoleError('Same error');

      const snap1 = buffer.processEvent(event1);
      const snap2 = buffer.processEvent(event2);

      expect(snap1).not.toBeNull();
      expect(snap2).not.toBeNull();
    });

    it('triggers only on configured triggerSeverities', () => {
      const buffer = new ErrorSnapshotBuffer({ triggerSeverities: ['crash'] });

      // error severity should NOT trigger
      const errorEvent = makeConsoleError('Just an error');
      expect(buffer.processEvent(errorEvent)).toBeNull();

      // crash severity SHOULD trigger
      const crashEvent = makeUnhandledRejection('Unhandled');
      expect(buffer.processEvent(crashEvent)).not.toBeNull();
    });

    it('includes sourceLocation from stack traces', () => {
      const buffer = new ErrorSnapshotBuffer();
      // Use SpiderMonkey-style stack frames (func@file:line:col)
      // because extractSourceLocation trims lines before matching,
      // which strips leading whitespace that V8 frames require.
      const stack = [
        'Error: Broken',
        'handleClick@http://localhost:3000/src/components/Button.tsx:42:10',
      ].join('\n');

      const event = makeConsoleError('Broken', stack);
      const snapshot = buffer.processEvent(event);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.error.sourceLocation).toBeDefined();
      expect(snapshot!.error.sourceLocation).toContain('Button.tsx');
      expect(snapshot!.error.stack).toBe(stack);
    });

    it('uses empty page state when no capturePageState callback is provided', () => {
      const buffer = new ErrorSnapshotBuffer();
      const snapshot = buffer.processEvent(makeConsoleError('Test'));

      expect(snapshot).not.toBeNull();
      expect(snapshot!.pageState).toEqual({
        url: '',
        title: '',
        elementCount: 0,
        visibleErrors: [],
      });
    });

    it('uses empty recentActions when no getRecentActions callback is provided', () => {
      const buffer = new ErrorSnapshotBuffer();
      const snapshot = buffer.processEvent(makeConsoleError('Test'));

      expect(snapshot).not.toBeNull();
      expect(snapshot!.recentActions).toEqual([]);
    });
  });

  describe('processEvents()', () => {
    it('returns an array of snapshots for triggering events', () => {
      const buffer = new ErrorSnapshotBuffer();
      const events: AnyCapturedEvent[] = [
        makeConsoleError('Error A'),
        makeConsoleWarn('Warning (skipped)'),
        makeConsoleError('Error B'),
      ];

      const snapshots = buffer.processEvents(events);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].error.message).toBe('Error A');
      expect(snapshots[1].error.message).toBe('Error B');
    });

    it('applies deduplication across the batch', () => {
      const buffer = new ErrorSnapshotBuffer();
      const events: AnyCapturedEvent[] = [
        makeConsoleError('Same error'),
        makeConsoleError('Same error'),
        makeConsoleError('Same error'),
      ];

      const snapshots = buffer.processEvents(events);
      expect(snapshots).toHaveLength(1);
    });

    it('returns empty array when no events trigger snapshots', () => {
      const buffer = new ErrorSnapshotBuffer();
      const events: AnyCapturedEvent[] = [makeConsoleWarn('Warning 1'), makeNavigation('/a', '/b')];

      const snapshots = buffer.processEvents(events);
      expect(snapshots).toHaveLength(0);
    });
  });

  describe('getAll()', () => {
    it('returns all captured snapshots', () => {
      const buffer = new ErrorSnapshotBuffer();
      buffer.processEvent(makeConsoleError('Error alpha'));
      buffer.processEvent(makeConsoleError('Error bravo'));
      buffer.processEvent(makeConsoleError('Error charlie'));

      const all = buffer.getAll();
      expect(all).toHaveLength(3);
    });

    it('returns a copy (not the internal array)', () => {
      const buffer = new ErrorSnapshotBuffer();
      buffer.processEvent(makeConsoleError('Test'));

      const all = buffer.getAll();
      all.pop();

      expect(buffer.getAll()).toHaveLength(1);
    });

    it('returns empty array when no snapshots exist', () => {
      const buffer = new ErrorSnapshotBuffer();
      expect(buffer.getAll()).toEqual([]);
    });
  });

  describe('getRecent()', () => {
    it('returns the most recent N snapshots', () => {
      const buffer = new ErrorSnapshotBuffer();
      buffer.processEvent(makeConsoleError('Error alpha'));
      buffer.processEvent(makeConsoleError('Error bravo'));
      buffer.processEvent(makeConsoleError('Error charlie'));
      buffer.processEvent(makeConsoleError('Error delta'));

      const recent = buffer.getRecent(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].error.message).toBe('Error charlie');
      expect(recent[1].error.message).toBe('Error delta');
    });

    it('returns all snapshots if N exceeds total', () => {
      const buffer = new ErrorSnapshotBuffer();
      buffer.processEvent(makeConsoleError('Only one'));

      const recent = buffer.getRecent(10);
      expect(recent).toHaveLength(1);
    });

    it('defaults to 10 when N is not specified', () => {
      const buffer = new ErrorSnapshotBuffer({ maxSnapshots: 50 });
      // Use alphabetic labels to avoid fingerprint collisions from number normalization
      const labels = [
        'alpha',
        'bravo',
        'charlie',
        'delta',
        'echo',
        'foxtrot',
        'golf',
        'hotel',
        'india',
        'juliet',
        'kilo',
        'lima',
        'mike',
        'november',
        'oscar',
      ];
      for (const label of labels) {
        buffer.processEvent(makeConsoleError(`Error ${label}`));
      }

      const recent = buffer.getRecent();
      expect(recent).toHaveLength(10);
    });
  });

  describe('getByFingerprint()', () => {
    it('finds a snapshot by its error fingerprint', () => {
      const buffer = new ErrorSnapshotBuffer();
      const snapshot = buffer.processEvent(makeConsoleError('Unique error'))!;

      const found = buffer.getByFingerprint(snapshot.error.fingerprint);
      expect(found).toBeDefined();
      expect(found!.id).toBe(snapshot.id);
    });

    it('returns undefined for unknown fingerprint', () => {
      const buffer = new ErrorSnapshotBuffer();
      buffer.processEvent(makeConsoleError('Some error'));

      expect(buffer.getByFingerprint('nonexistent-fingerprint')).toBeUndefined();
    });
  });

  describe('clear()', () => {
    it('clears all snapshots', () => {
      const buffer = new ErrorSnapshotBuffer();
      buffer.processEvent(makeConsoleError('Error A'));
      buffer.processEvent(makeConsoleError('Error B'));

      buffer.clear();
      expect(buffer.getAll()).toHaveLength(0);
    });

    it('clears the dedup set so previously seen errors can be captured again', () => {
      const buffer = new ErrorSnapshotBuffer();
      buffer.processEvent(makeConsoleError('Same error'));

      // Duplicate is suppressed before clear
      expect(buffer.processEvent(makeConsoleError('Same error'))).toBeNull();

      buffer.clear();

      // After clear, same fingerprint should be allowed again
      const snapshot = buffer.processEvent(makeConsoleError('Same error'));
      expect(snapshot).not.toBeNull();
    });
  });

  describe('buffer trimming', () => {
    it('removes oldest snapshots when exceeding maxSnapshots', () => {
      const buffer = new ErrorSnapshotBuffer({ maxSnapshots: 3 });
      buffer.processEvent(makeConsoleError('Error alpha'));
      buffer.processEvent(makeConsoleError('Error bravo'));
      buffer.processEvent(makeConsoleError('Error charlie'));
      buffer.processEvent(makeConsoleError('Error delta'));

      const all = buffer.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].error.message).toBe('Error bravo');
      expect(all[1].error.message).toBe('Error charlie');
      expect(all[2].error.message).toBe('Error delta');
    });

    it('allows re-capture of fingerprints from removed snapshots', () => {
      const buffer = new ErrorSnapshotBuffer({ maxSnapshots: 2 });

      // Fill with 2 errors
      buffer.processEvent(makeConsoleError('Error A'));
      buffer.processEvent(makeConsoleError('Error B'));

      // Adding a third evicts 'Error A'
      buffer.processEvent(makeConsoleError('Error C'));

      // 'Error A' fingerprint should be eligible for re-capture
      const snapshot = buffer.processEvent(makeConsoleError('Error A'));
      expect(snapshot).not.toBeNull();
    });
  });

  describe('capturePageState callback', () => {
    it('includes page state from the callback in the snapshot', () => {
      const mockPageState: ErrorSnapshotPageState = {
        url: 'http://localhost:3000/dashboard',
        title: 'Dashboard',
        elementCount: 42,
        visibleErrors: ['Something went wrong'],
      };

      const buffer = new ErrorSnapshotBuffer({
        capturePageState: () => mockPageState,
      });

      const snapshot = buffer.processEvent(makeConsoleError('Test error'));
      expect(snapshot).not.toBeNull();
      expect(snapshot!.pageState).toEqual(mockPageState);
    });
  });

  describe('getRecentActions callback', () => {
    it('includes recent actions from the callback in the snapshot', () => {
      const mockActions = ['Clicked button "Save"', 'Typed in "email" field'];

      const buffer = new ErrorSnapshotBuffer({
        getRecentActions: () => mockActions,
      });

      const snapshot = buffer.processEvent(makeConsoleError('Test error'));
      expect(snapshot).not.toBeNull();
      expect(snapshot!.recentActions).toEqual(mockActions);
    });
  });
});

describe('extractMessage()', () => {
  it('extracts message from console events', () => {
    const event = makeConsoleError('Something broke');
    expect(extractMessage(event)).toBe('Something broke');
  });

  it('extracts errorMessage from network events when available', () => {
    const event = makeNetworkError('POST', 'http://api.example.com/data', {
      status: 500,
      errorMessage: 'Internal Server Error',
    });
    expect(extractMessage(event)).toBe('Internal Server Error');
  });

  it('builds a fallback message for network events without errorMessage', () => {
    const event = makeNetworkError('GET', 'http://api.example.com/users', { status: 404 });
    expect(extractMessage(event)).toBe('GET http://api.example.com/users \u2192 404');
  });

  it('shows "no response" for network events without status', () => {
    const event = makeNetworkError('GET', 'http://api.example.com/timeout', {
      kind: 'timeout',
    });
    expect(extractMessage(event)).toBe('GET http://api.example.com/timeout \u2192 no response');
  });

  it('extracts message from react-error events', () => {
    const event = makeReactError('Component blew up');
    expect(extractMessage(event)).toBe('Component blew up');
  });

  it('builds message from resource-error events', () => {
    const event = makeResourceError('script', 'http://cdn.example.com/app.js');
    expect(extractMessage(event)).toBe('Failed to load script: http://cdn.example.com/app.js');
  });

  it('extracts message from hmr events', () => {
    const event = makeHmrEvent('error', 'Compilation failed');
    expect(extractMessage(event)).toBe('Compilation failed');
  });

  it('builds message from ws-disconnection events', () => {
    const event = makeWsDisconnection('connected', 'disconnected');
    expect(extractMessage(event)).toBe('WebSocket connected \u2192 disconnected');
  });

  it('builds message from long-task events', () => {
    const event = makeLongTask(250);
    expect(extractMessage(event)).toBe('Long task: 250ms');
  });

  it('builds message from long-animation-frame events', () => {
    const event = makeLoaf(300, 150);
    expect(extractMessage(event)).toBe('Long animation frame: 300ms (blocking: 150ms)');
  });

  it('builds message from navigation events', () => {
    const event = makeNavigation('/home', '/dashboard');
    expect(extractMessage(event)).toBe('Navigation: /home \u2192 /dashboard');
  });

  it('builds message from web-vital events', () => {
    const event = makeWebVital('LCP', 2500);
    expect(extractMessage(event)).toBe('LCP: 2500');
  });

  it('builds message from memory events', () => {
    const event = makeMemory(128);
    expect(extractMessage(event)).toBe('Memory: 128MB used');
  });
});
