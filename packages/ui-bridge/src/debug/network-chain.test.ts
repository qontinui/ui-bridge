/**
 * NetworkChainTracker — Query & Correlation Tests
 *
 * Tests the data-manipulation methods (getSince, getRecent, getFailures,
 * getByUrl, findByRequestId, correlateErrors, clear, trim) by injecting
 * chains directly. Install/uninstall require real browser APIs and are
 * not covered here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NetworkChainTracker,
  type NetworkChain,
  type NetworkRequest,
  type NetworkResponse,
} from './network-chain';
import type { AnyCapturedEvent } from './browser-capture-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  idCounter++;
  return {
    id: `req-${idCounter}`,
    method: 'GET',
    url: `http://localhost:3000/api/items/${idCounter}`,
    startTime: Date.now(),
    ...overrides,
  };
}

function makeResponse(overrides: Partial<NetworkResponse> = {}): NetworkResponse {
  return {
    status: 200,
    statusText: 'OK',
    durationMs: 50,
    ...overrides,
  };
}

function makeChain(overrides: Partial<NetworkChain> = {}): NetworkChain {
  const request = overrides.request ?? makeRequest();
  return {
    request,
    response: makeResponse(),
    correlatedErrors: [],
    isFailure: false,
    timestamp: request.startTime,
    ...overrides,
  };
}

function makeFailureChain(status: number, overrides: Partial<NetworkChain> = {}): NetworkChain {
  const request = overrides.request ?? makeRequest();
  return {
    request,
    response: makeResponse({ status, statusText: `Error ${status}`, durationMs: 80 }),
    correlatedErrors: [],
    isFailure: true,
    timestamp: request.startTime,
    ...overrides,
  };
}

function makeNetworkErrorChain(
  errorMsg: string,
  overrides: Partial<NetworkChain> = {}
): NetworkChain {
  const request = overrides.request ?? makeRequest();
  return {
    request,
    error: errorMsg,
    correlatedErrors: [],
    isFailure: true,
    timestamp: request.startTime,
    ...overrides,
  };
}

function makeConsoleError(message: string, ts: number): AnyCapturedEvent {
  return {
    type: 'console',
    level: 'error',
    message,
    timestamp: ts,
    url: 'http://localhost:3000/',
  };
}

/**
 * Push chains into the tracker's internal buffer by accessing the private
 * `chains` array. This avoids needing to go through install().
 */
function injectChains(tracker: NetworkChainTracker, chains: NetworkChain[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (tracker as any).chains = chains;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NetworkChainTracker', () => {
  let tracker: NetworkChainTracker;

  beforeEach(() => {
    idCounter = 0;
    tracker = new NetworkChainTracker();
  });

  // -------------------------------------------------------------------------
  // getAll
  // -------------------------------------------------------------------------

  describe('getAll', () => {
    it('returns an empty array when no chains exist', () => {
      expect(tracker.getAll()).toEqual([]);
    });

    it('returns a copy of all chains', () => {
      const chains = [makeChain(), makeChain()];
      injectChains(tracker, chains);

      const result = tracker.getAll();
      expect(result).toHaveLength(2);
      // Verify it is a copy, not the same reference
      expect(result).not.toBe(chains);
      expect(result[0]).toBe(chains[0]);
    });
  });

  // -------------------------------------------------------------------------
  // getSince
  // -------------------------------------------------------------------------

  describe('getSince', () => {
    it('returns chains at or after the given timestamp', () => {
      const t1 = 1000;
      const t2 = 2000;
      const t3 = 3000;

      const chains = [
        makeChain({ request: makeRequest({ startTime: t1 }), timestamp: t1 }),
        makeChain({ request: makeRequest({ startTime: t2 }), timestamp: t2 }),
        makeChain({ request: makeRequest({ startTime: t3 }), timestamp: t3 }),
      ];
      injectChains(tracker, chains);

      const result = tracker.getSince(2000);
      expect(result).toHaveLength(2);
      expect(result[0].timestamp).toBe(2000);
      expect(result[1].timestamp).toBe(3000);
    });

    it('returns all chains when timestamp is 0', () => {
      injectChains(tracker, [makeChain(), makeChain(), makeChain()]);
      expect(tracker.getSince(0)).toHaveLength(3);
    });

    it('returns empty when all chains are before the given timestamp', () => {
      const chains = [makeChain({ request: makeRequest({ startTime: 100 }), timestamp: 100 })];
      injectChains(tracker, chains);
      expect(tracker.getSince(9999)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getRecent
  // -------------------------------------------------------------------------

  describe('getRecent', () => {
    it('returns the last N chains', () => {
      const chains = Array.from({ length: 10 }, () => makeChain());
      injectChains(tracker, chains);

      const result = tracker.getRecent(3);
      expect(result).toHaveLength(3);
      expect(result[0].request.id).toBe(chains[7].request.id);
      expect(result[2].request.id).toBe(chains[9].request.id);
    });

    it('returns all chains when fewer than N exist', () => {
      injectChains(tracker, [makeChain(), makeChain()]);
      expect(tracker.getRecent(50)).toHaveLength(2);
    });

    it('defaults to 50', () => {
      const chains = Array.from({ length: 60 }, () => makeChain());
      injectChains(tracker, chains);
      expect(tracker.getRecent()).toHaveLength(50);
    });
  });

  // -------------------------------------------------------------------------
  // getFailures
  // -------------------------------------------------------------------------

  describe('getFailures', () => {
    it('returns only failure chains', () => {
      const chains = [
        makeChain(), // success
        makeFailureChain(404), // failure
        makeChain(), // success
        makeNetworkErrorChain('Network error'), // failure
        makeFailureChain(500), // failure
      ];
      injectChains(tracker, chains);

      const failures = tracker.getFailures();
      expect(failures).toHaveLength(3);
      expect(failures[0].response?.status).toBe(404);
      expect(failures[1].error).toBe('Network error');
      expect(failures[2].response?.status).toBe(500);
    });

    it('returns empty when no failures exist', () => {
      injectChains(tracker, [makeChain(), makeChain()]);
      expect(tracker.getFailures()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getByUrl
  // -------------------------------------------------------------------------

  describe('getByUrl', () => {
    it('returns chains whose URL contains the pattern', () => {
      const chains = [
        makeChain({ request: makeRequest({ url: 'http://localhost/api/users' }) }),
        makeChain({ request: makeRequest({ url: 'http://localhost/api/items' }) }),
        makeChain({ request: makeRequest({ url: 'http://localhost/api/users/123' }) }),
      ];
      injectChains(tracker, chains);

      const result = tracker.getByUrl('/api/users');
      expect(result).toHaveLength(2);
      expect(result[0].request.url).toBe('http://localhost/api/users');
      expect(result[1].request.url).toBe('http://localhost/api/users/123');
    });

    it('returns empty when no URLs match', () => {
      injectChains(tracker, [
        makeChain({ request: makeRequest({ url: 'http://localhost/api/items' }) }),
      ]);
      expect(tracker.getByUrl('/api/orders')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // findByRequestId
  // -------------------------------------------------------------------------

  describe('findByRequestId', () => {
    it('finds a chain by its request ID', () => {
      const chains = [
        makeChain({ requestId: 'abc-123' }),
        makeChain({ requestId: 'def-456' }),
        makeChain(), // no requestId
      ];
      injectChains(tracker, chains);

      const found = tracker.findByRequestId('def-456');
      expect(found).toBeDefined();
      expect(found?.requestId).toBe('def-456');
    });

    it('returns undefined when no match', () => {
      injectChains(tracker, [makeChain({ requestId: 'abc-123' })]);
      expect(tracker.findByRequestId('nonexistent')).toBeUndefined();
    });

    it('returns the first match when duplicates exist', () => {
      const first = makeChain({ requestId: 'dup-id' });
      const second = makeChain({ requestId: 'dup-id' });
      injectChains(tracker, [first, second]);

      expect(tracker.findByRequestId('dup-id')).toBe(first);
    });
  });

  // -------------------------------------------------------------------------
  // correlateErrors
  // -------------------------------------------------------------------------

  describe('correlateErrors', () => {
    it('correlates by URL mention (pathname match)', () => {
      const t = 1000;
      const chain = makeFailureChain(500, {
        request: makeRequest({
          url: 'http://localhost:3000/api/users',
          startTime: t,
        }),
        timestamp: t,
      });
      injectChains(tracker, [chain]);

      tracker.correlateErrors([
        makeConsoleError('Failed to load /api/users: server error', t + 100),
      ]);

      expect(chain.correlatedErrors).toHaveLength(1);
      expect(chain.correlatedErrors[0].correlationType).toBe('url-mention');
    });

    it('correlates by full URL mention', () => {
      const t = 1000;
      const chain = makeFailureChain(500, {
        request: makeRequest({
          url: '/relative/path',
          startTime: t,
        }),
        timestamp: t,
      });
      injectChains(tracker, [chain]);

      // Full URL cannot be parsed as a valid URL (relative), so pathname
      // extraction fails. The fallback full-URL check should match.
      tracker.correlateErrors([makeConsoleError('Error at /relative/path endpoint', t + 50)]);

      expect(chain.correlatedErrors).toHaveLength(1);
      expect(chain.correlatedErrors[0].correlationType).toBe('url-mention');
    });

    it('correlates by request ID', () => {
      const t = 1000;
      const chain = makeChain({
        request: makeRequest({
          url: 'http://localhost:3000/api/data',
          startTime: t,
        }),
        requestId: 'trace-xyz-789',
        isFailure: false,
        timestamp: t,
      });
      injectChains(tracker, [chain]);

      tracker.correlateErrors([
        makeConsoleError('Request trace-xyz-789 failed validation', t + 300),
      ]);

      expect(chain.correlatedErrors).toHaveLength(1);
      expect(chain.correlatedErrors[0].correlationType).toBe('request-id');
    });

    it('correlates by timing for failure chains', () => {
      const t = 1000;
      const durationMs = 50;
      const chain = makeFailureChain(500, {
        request: makeRequest({
          url: 'http://localhost:3000/api/unique-endpoint',
          startTime: t,
        }),
        timestamp: t,
      });
      // Set a known duration so response time = t + durationMs
      chain.response!.durationMs = durationMs;
      injectChains(tracker, [chain]);

      // Error occurs within 200ms (default window) of response time
      const responseTime = t + durationMs;
      tracker.correlateErrors([makeConsoleError('Something went wrong', responseTime + 100)]);

      expect(chain.correlatedErrors).toHaveLength(1);
      expect(chain.correlatedErrors[0].correlationType).toBe('timing');
    });

    it('does NOT correlate by timing for successful chains', () => {
      const t = 1000;
      const chain = makeChain({
        request: makeRequest({
          url: 'http://localhost:3000/api/unique-success',
          startTime: t,
        }),
        isFailure: false,
        timestamp: t,
      });
      chain.response!.durationMs = 50;
      injectChains(tracker, [chain]);

      tracker.correlateErrors([makeConsoleError('Unrelated error', t + 60)]);

      expect(chain.correlatedErrors).toHaveLength(0);
    });

    it('does not double-count the same error on the same chain', () => {
      const t = 1000;
      const chain = makeFailureChain(500, {
        request: makeRequest({
          url: 'http://localhost:3000/api/items',
          startTime: t,
        }),
        timestamp: t,
      });
      injectChains(tracker, [chain]);

      const error = makeConsoleError('Error at /api/items', t + 10);

      tracker.correlateErrors([error]);
      tracker.correlateErrors([error]); // second pass

      expect(chain.correlatedErrors).toHaveLength(1);
    });

    it('ignores non-console events', () => {
      const t = 1000;
      const chain = makeFailureChain(500, {
        request: makeRequest({ startTime: t }),
        timestamp: t,
      });
      injectChains(tracker, [chain]);

      const networkEvent: AnyCapturedEvent = {
        type: 'network',
        method: 'GET',
        requestUrl: 'http://localhost/fail',
        status: 500,
        statusText: 'Internal Server Error',
        durationMs: 100,
        kind: 'http-error',
        timestamp: t + 50,
        url: 'http://localhost/',
      };

      tracker.correlateErrors([networkEvent]);
      expect(chain.correlatedErrors).toHaveLength(0);
    });

    it('handles empty event array', () => {
      injectChains(tracker, [makeChain()]);
      // Should not throw
      tracker.correlateErrors([]);
      expect(tracker.getAll()[0].correlatedErrors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe('clear', () => {
    it('removes all buffered chains', () => {
      injectChains(tracker, [makeChain(), makeChain(), makeChain()]);
      expect(tracker.getAll()).toHaveLength(3);

      tracker.clear();
      expect(tracker.getAll()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // trim (via maxChains config)
  // -------------------------------------------------------------------------

  describe('trim', () => {
    it('respects maxChains by dropping oldest entries', () => {
      const smallTracker = new NetworkChainTracker({ maxChains: 3 });

      const chains = Array.from({ length: 5 }, (_, i) =>
        makeChain({
          request: makeRequest({ startTime: i * 100 }),
          timestamp: i * 100,
        })
      );
      injectChains(smallTracker, chains);

      // Manually invoke trim via a public method that triggers it internally.
      // Since trim is private, we simulate by accessing it through the prototype.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (smallTracker as any).trim();

      const result = smallTracker.getAll();
      expect(result).toHaveLength(3);
      // Should keep the 3 most recent (timestamps 200, 300, 400)
      expect(result[0].timestamp).toBe(200);
      expect(result[1].timestamp).toBe(300);
      expect(result[2].timestamp).toBe(400);
    });

    it('does not trim when under the limit', () => {
      const smallTracker = new NetworkChainTracker({ maxChains: 10 });
      const chains = [makeChain(), makeChain()];
      injectChains(smallTracker, chains);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (smallTracker as any).trim();

      expect(smallTracker.getAll()).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Combined queries
  // -------------------------------------------------------------------------

  describe('combined query scenarios', () => {
    it('getFailures + getByUrl can narrow results', () => {
      const chains = [
        makeChain({ request: makeRequest({ url: 'http://localhost/api/users' }) }),
        makeFailureChain(404, {
          request: makeRequest({ url: 'http://localhost/api/users/999' }),
        }),
        makeFailureChain(500, {
          request: makeRequest({ url: 'http://localhost/api/items' }),
        }),
        makeNetworkErrorChain('ECONNREFUSED', {
          request: makeRequest({ url: 'http://localhost/api/users' }),
        }),
      ];
      injectChains(tracker, chains);

      const userFailures = tracker
        .getFailures()
        .filter((c) => c.request.url.includes('/api/users'));
      expect(userFailures).toHaveLength(2);
    });

    it('getSince + getRecent compose correctly', () => {
      const now = Date.now();
      const chains = Array.from({ length: 20 }, (_, i) =>
        makeChain({
          request: makeRequest({ startTime: now - 2000 + i * 100 }),
          timestamp: now - 2000 + i * 100,
        })
      );
      injectChains(tracker, chains);

      // Get chains from the last second
      const recent = tracker.getSince(now - 1000);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent.length).toBeLessThan(20);
      // All should have timestamp >= now - 1000
      for (const c of recent) {
        expect(c.timestamp).toBeGreaterThanOrEqual(now - 1000);
      }
    });
  });
});
