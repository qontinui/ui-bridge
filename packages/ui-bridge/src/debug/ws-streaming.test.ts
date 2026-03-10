/**
 * BrowserEventStream Tests
 */

import { describe, it, expect } from 'vitest';
import { BrowserEventStream } from './ws-streaming';
import type {
  AnyCapturedEvent,
  ConsoleCapturedEvent,
  NetworkCapturedEvent,
  NavigationCapturedEvent,
} from './browser-capture-types';

// ---------------------------------------------------------------------------
// Mock event helpers
// ---------------------------------------------------------------------------

function makeConsoleError(message: string, stack?: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'error',
    message,
    stack,
    timestamp: Date.now(),
    url: 'http://localhost:3000',
  };
}

function makeConsoleWarn(message: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'warn',
    message,
    timestamp: Date.now(),
    url: 'http://localhost:3000',
  };
}

function makeUnhandledRejection(message: string): ConsoleCapturedEvent {
  return {
    type: 'console',
    level: 'unhandledrejection',
    message,
    timestamp: Date.now(),
    url: 'http://localhost:3000',
  };
}

function makeNetworkError(
  method: string,
  requestUrl: string,
  status?: number
): NetworkCapturedEvent {
  return {
    type: 'network',
    method,
    requestUrl,
    status,
    durationMs: 150,
    kind: status && status >= 500 ? 'http-error' : 'network-error',
    timestamp: Date.now(),
    url: 'http://localhost:3000',
  };
}

function makeNavigation(from: string, to: string): NavigationCapturedEvent {
  return {
    type: 'navigation',
    from,
    to,
    trigger: 'pushState',
    timestamp: Date.now(),
    url: 'http://localhost:3000',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrowserEventStream', () => {
  describe('subscribe()', () => {
    it('creates a subscription with an auto-generated ID', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe();

      expect(sub.id).toBeDefined();
      expect(sub.id).toMatch(/^stream-/);
    });

    it('creates a subscription with custom options', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe({
        minSeverity: 'warning',
        eventTypes: ['console'],
        deduplicate: true,
      });

      expect(sub.minSeverity).toBe('warning');
      expect(sub.eventTypes).toEqual(['console']);
      expect(sub.deduplicate).toBe(true);
    });

    it('throws when maxSubscriptions is exceeded', () => {
      const stream = new BrowserEventStream({ maxSubscriptions: 2 });
      stream.subscribe();
      stream.subscribe();

      expect(() => stream.subscribe()).toThrow(/Maximum subscriptions reached/);
    });

    it('generates unique IDs for each subscription', () => {
      const stream = new BrowserEventStream();
      const sub1 = stream.subscribe();
      const sub2 = stream.subscribe();

      expect(sub1.id).not.toBe(sub2.id);
    });
  });

  describe('unsubscribe()', () => {
    it('removes an existing subscription and returns true', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe();

      const result = stream.unsubscribe(sub.id);
      expect(result).toBe(true);
      expect(stream.getSubscriptions()).toHaveLength(0);
    });

    it('returns false for a non-existent subscription', () => {
      const stream = new BrowserEventStream();
      const result = stream.unsubscribe('nonexistent-id');
      expect(result).toBe(false);
    });

    it('allows a new subscription after unsubscribing at capacity', () => {
      const stream = new BrowserEventStream({ maxSubscriptions: 1 });
      const sub = stream.subscribe();
      stream.unsubscribe(sub.id);

      // Should not throw
      const newSub = stream.subscribe();
      expect(newSub.id).toBeDefined();
    });
  });

  describe('getSubscriptions()', () => {
    it('returns all active subscriptions', () => {
      const stream = new BrowserEventStream();
      const sub1 = stream.subscribe();
      const sub2 = stream.subscribe({ minSeverity: 'error' });

      const subs = stream.getSubscriptions();
      expect(subs).toHaveLength(2);
      expect(subs.map((s) => s.id)).toContain(sub1.id);
      expect(subs.map((s) => s.id)).toContain(sub2.id);
    });

    it('returns empty array when no subscriptions exist', () => {
      const stream = new BrowserEventStream();
      expect(stream.getSubscriptions()).toEqual([]);
    });

    it('reflects unsubscriptions', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe();
      stream.unsubscribe(sub.id);

      expect(stream.getSubscriptions()).toHaveLength(0);
    });
  });

  describe('processEvent()', () => {
    it('delivers to all subscriptions when no filters are set', () => {
      const stream = new BrowserEventStream();
      const sub1 = stream.subscribe();
      const sub2 = stream.subscribe();

      const event = makeConsoleError('Something broke');
      const results = stream.processEvent(event);

      expect(results.size).toBe(2);
      expect(results.has(sub1.id)).toBe(true);
      expect(results.has(sub2.id)).toBe(true);
    });

    it('returns a Map with subscription-id keys and BrowserEventStreamMessage values', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe();

      const event = makeConsoleError('Test error');
      const results = stream.processEvent(event);

      const message = results.get(sub.id)!;
      expect(message).toBeDefined();
      expect(message.event).toBe(event);
      expect(message.severity).toBe('error');
      expect(message.reason).toBeDefined();
      expect(typeof message.fingerprint).toBe('string');
      expect(message.fingerprint.length).toBeGreaterThan(0);
    });

    it('includes sourceLocation when event has a stack trace', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe();

      // Use SpiderMonkey-style stack frames (func@file:line:col)
      // because extractSourceLocationFromStack trims lines before matching,
      // which strips leading whitespace that V8 frames require.
      const event = makeConsoleError(
        'Error with stack',
        [
          'Error: Error with stack',
          'handleClick@http://localhost:3000/src/components/Button.tsx:42:10',
        ].join('\n')
      );

      const results = stream.processEvent(event);
      const message = results.get(sub.id)!;
      expect(message.sourceLocation).toBeDefined();
      expect(message.sourceLocation).toContain('Button.tsx');
    });

    it('omits sourceLocation when event has no stack trace', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe();

      const event = makeConsoleWarn('No stack here');
      const results = stream.processEvent(event);
      const message = results.get(sub.id)!;
      expect(message.sourceLocation).toBeUndefined();
    });

    describe('minSeverity filter', () => {
      it('delivers events at or above the minimum severity', () => {
        const stream = new BrowserEventStream();
        const sub = stream.subscribe({ minSeverity: 'error' });

        // crash (severity 0) should pass minSeverity 'error' (rank 1)
        const crashEvent = makeUnhandledRejection('Unhandled promise');
        const crashResults = stream.processEvent(crashEvent);
        expect(crashResults.has(sub.id)).toBe(true);

        // error (severity 1) should pass minSeverity 'error' (rank 1)
        const errorEvent = makeConsoleError('An error');
        const errorResults = stream.processEvent(errorEvent);
        expect(errorResults.has(sub.id)).toBe(true);
      });

      it('suppresses events below the minimum severity', () => {
        const stream = new BrowserEventStream();
        const sub = stream.subscribe({ minSeverity: 'error' });

        // warning (rank 2) should NOT pass minSeverity 'error' (rank 1)
        const warnEvent = makeConsoleWarn('Just a warning');
        const warnResults = stream.processEvent(warnEvent);
        expect(warnResults.has(sub.id)).toBe(false);

        // noise (rank 3) should NOT pass minSeverity 'error' (rank 1)
        const navEvent = makeNavigation('/a', '/b');
        const navResults = stream.processEvent(navEvent);
        expect(navResults.has(sub.id)).toBe(false);
      });

      it('delivers all events when minSeverity is noise', () => {
        const stream = new BrowserEventStream();
        const sub = stream.subscribe({ minSeverity: 'noise' });

        const navEvent = makeNavigation('/a', '/b');
        const results = stream.processEvent(navEvent);
        expect(results.has(sub.id)).toBe(true);
      });
    });

    describe('eventTypes filter', () => {
      it('only delivers matching event types', () => {
        const stream = new BrowserEventStream();
        const sub = stream.subscribe({ eventTypes: ['console'] });

        const consoleEvent = makeConsoleError('Error');
        const consoleResults = stream.processEvent(consoleEvent);
        expect(consoleResults.has(sub.id)).toBe(true);

        const navEvent = makeNavigation('/a', '/b');
        const navResults = stream.processEvent(navEvent);
        expect(navResults.has(sub.id)).toBe(false);
      });

      it('supports multiple event types', () => {
        const stream = new BrowserEventStream();
        const sub = stream.subscribe({ eventTypes: ['console', 'network'] });

        const consoleEvent = makeConsoleError('Error');
        expect(stream.processEvent(consoleEvent).has(sub.id)).toBe(true);

        const networkEvent = makeNetworkError('GET', 'http://localhost:3000/api/test', 500);
        expect(stream.processEvent(networkEvent).has(sub.id)).toBe(true);

        const navEvent = makeNavigation('/a', '/b');
        expect(stream.processEvent(navEvent).has(sub.id)).toBe(false);
      });
    });

    describe('deduplicate filter', () => {
      it('suppresses events with already-seen fingerprints', () => {
        const stream = new BrowserEventStream();
        const sub = stream.subscribe({ deduplicate: true });

        const event1 = makeConsoleError('Duplicate error');
        const event2 = makeConsoleError('Duplicate error');

        const results1 = stream.processEvent(event1);
        expect(results1.has(sub.id)).toBe(true);

        const results2 = stream.processEvent(event2);
        expect(results2.has(sub.id)).toBe(false);
      });

      it('allows events with different fingerprints through', () => {
        const stream = new BrowserEventStream();
        const sub = stream.subscribe({ deduplicate: true });

        const event1 = makeConsoleError('Error A');
        const event2 = makeConsoleError('Error B');

        expect(stream.processEvent(event1).has(sub.id)).toBe(true);
        expect(stream.processEvent(event2).has(sub.id)).toBe(true);
      });

      it('dedup is per-subscription', () => {
        const stream = new BrowserEventStream();
        const subDedup = stream.subscribe({ deduplicate: true });
        const subNoDedup = stream.subscribe({ deduplicate: false });

        const event = makeConsoleError('Shared error');

        // First occurrence: both get it
        const r1 = stream.processEvent(event);
        expect(r1.has(subDedup.id)).toBe(true);
        expect(r1.has(subNoDedup.id)).toBe(true);

        // Second occurrence: only non-dedup subscriber gets it
        const r2 = stream.processEvent(makeConsoleError('Shared error'));
        expect(r2.has(subDedup.id)).toBe(false);
        expect(r2.has(subNoDedup.id)).toBe(true);
      });

      it('evicts oldest fingerprints when LRU is full', () => {
        const stream = new BrowserEventStream({ maxRecentFingerprints: 2 });
        const sub = stream.subscribe({ deduplicate: true });

        // Fill the LRU with 2 fingerprints: order = [Alpha, Bravo]
        stream.processEvent(makeConsoleError('Error Alpha'));
        stream.processEvent(makeConsoleError('Error Bravo'));

        // Both are now seen; duplicates should be suppressed
        expect(stream.processEvent(makeConsoleError('Error Alpha')).has(sub.id)).toBe(false);
        expect(stream.processEvent(makeConsoleError('Error Bravo')).has(sub.id)).toBe(false);

        // Add a 3rd fingerprint which evicts Alpha: order = [Bravo, Charlie]
        stream.processEvent(makeConsoleError('Error Charlie'));

        // Alpha was evicted, so it should be allowed through again
        const result = stream.processEvent(makeConsoleError('Error Alpha'));
        expect(result.has(sub.id)).toBe(true);
        // After re-adding Alpha, LRU evicted Bravo: order = [Charlie, Alpha]

        // Charlie is still in the LRU, so it should be suppressed
        expect(stream.processEvent(makeConsoleError('Error Charlie')).has(sub.id)).toBe(false);
      });
    });

    describe('combined filters', () => {
      it('applies minSeverity AND eventTypes together', () => {
        const stream = new BrowserEventStream();
        const sub = stream.subscribe({
          minSeverity: 'error',
          eventTypes: ['console'],
        });

        // console + error severity: passes both
        expect(stream.processEvent(makeConsoleError('Error')).has(sub.id)).toBe(true);

        // console + warning severity: fails minSeverity
        expect(stream.processEvent(makeConsoleWarn('Warning')).has(sub.id)).toBe(false);

        // network + error severity: fails eventTypes
        const networkEvent = makeNetworkError('GET', 'http://localhost/api', 500);
        expect(stream.processEvent(networkEvent).has(sub.id)).toBe(false);
      });
    });

    it('returns empty map when there are no subscriptions', () => {
      const stream = new BrowserEventStream();
      const event = makeConsoleError('Nobody listening');
      const results = stream.processEvent(event);
      expect(results.size).toBe(0);
    });
  });

  describe('processEvents()', () => {
    it('returns a Map of subscription-id to message arrays', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe();

      const events: AnyCapturedEvent[] = [
        makeConsoleError('Error alpha'),
        makeConsoleWarn('Warning beta'),
        makeConsoleError('Error gamma'),
      ];

      const results = stream.processEvents(events);
      expect(results.has(sub.id)).toBe(true);

      const messages = results.get(sub.id)!;
      expect(messages).toHaveLength(3);
      expect(messages[0].severity).toBe('error');
      expect(messages[1].severity).toBe('warning');
      expect(messages[2].severity).toBe('error');
    });

    it('respects filters across the batch', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe({ minSeverity: 'error' });

      const events: AnyCapturedEvent[] = [
        makeConsoleError('Error alpha'),
        makeConsoleWarn('Warning (filtered out)'),
        makeUnhandledRejection('Crash happened'),
      ];

      const results = stream.processEvents(events);
      const messages = results.get(sub.id)!;
      expect(messages).toHaveLength(2);
      expect(messages[0].severity).toBe('error');
      expect(messages[1].severity).toBe('crash');
    });

    it('applies deduplication across the batch', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe({ deduplicate: true });

      const events: AnyCapturedEvent[] = [
        makeConsoleError('Same error'),
        makeConsoleError('Same error'),
        makeConsoleError('Same error'),
      ];

      const results = stream.processEvents(events);
      const messages = results.get(sub.id)!;
      expect(messages).toHaveLength(1);
    });

    it('returns empty map for empty event array', () => {
      const stream = new BrowserEventStream();
      stream.subscribe();
      const results = stream.processEvents([]);
      expect(results.size).toBe(0);
    });

    it('omits subscriptions that received no events from the map', () => {
      const stream = new BrowserEventStream();
      const sub = stream.subscribe({ eventTypes: ['network'] });

      const events: AnyCapturedEvent[] = [makeConsoleError('Console only')];

      const results = stream.processEvents(events);
      expect(results.has(sub.id)).toBe(false);
    });
  });
});
