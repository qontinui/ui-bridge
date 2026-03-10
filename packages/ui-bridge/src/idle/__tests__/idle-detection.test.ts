/**
 * Idle Detection Tests
 *
 * Tests for the idle detection system: NetworkIdleDetector, DOMSettlingDetector,
 * LoadingIndicatorDetector, and CompositeIdleDetector.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NetworkIdleDetector } from '../network-idle';
import { DOMSettlingDetector } from '../dom-settling';
import { LoadingIndicatorDetector } from '../loading-indicators';
import { CompositeIdleDetector } from '../composite-idle';

// ============================================================================
// NetworkIdleDetector
// ============================================================================

describe('NetworkIdleDetector', () => {
  let detector: NetworkIdleDetector;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // Install a mock fetch that returns controllable promises
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    detector?.destroy();
    vi.useRealTimers();
  });

  function createDetector(
    config: Parameters<typeof NetworkIdleDetector.prototype.constructor>[0] = {}
  ) {
    detector = new NetworkIdleDetector({ trackXHR: false, ...config });
    detector.install();
    return detector;
  }

  it('should start idle with no pending requests', () => {
    createDetector();
    expect(detector.isIdle()).toBe(true);
    const status = detector.getStatus();
    expect(status.idle).toBe(true);
    expect(status.pendingCount).toBe(0);
    expect(status.pendingRequests).toHaveLength(0);
  });

  it('should have name "network"', () => {
    createDetector();
    expect(detector.name).toBe('network');
  });

  it('should have default weight of 0.9', () => {
    detector = new NetworkIdleDetector();
    expect(detector.weight).toBe(0.9);
  });

  it('should accept custom weight', () => {
    detector = new NetworkIdleDetector({ weight: 0.5 });
    expect(detector.weight).toBe(0.5);
  });

  it('should transition to busy when fetch is called', () => {
    createDetector();

    // Set up a fetch that never resolves (stays pending)
    let resolveResponse!: (value: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    // Call the intercepted fetch
    globalThis.fetch('https://api.example.com/data');

    expect(detector.isIdle()).toBe(false);
    const status = detector.getStatus();
    expect(status.pendingCount).toBe(1);
    expect(status.pendingRequests[0].url).toBe('https://api.example.com/data');
    expect(status.pendingRequests[0].method).toBe('GET');

    // Clean up
    resolveResponse(new Response('ok'));
  });

  it('should transition back to idle after debounce when fetch completes', async () => {
    createDetector({ debounceMs: 200 });

    let resolveResponse!: (value: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    const fetchPromise = globalThis.fetch('https://api.example.com/data');
    expect(detector.isIdle()).toBe(false);

    // Complete the request
    resolveResponse(new Response('ok', { status: 200 }));
    await fetchPromise;

    // Not idle yet - debounce hasn't elapsed
    expect(detector.isIdle()).toBe(false);

    // Advance past debounce
    vi.advanceTimersByTime(200);

    expect(detector.isIdle()).toBe(true);
    expect(detector.getStatus().pendingCount).toBe(0);
  });

  it('should track multiple concurrent requests and only idle when ALL complete', async () => {
    createDetector({ debounceMs: 100 });

    let resolve1!: (value: Response) => void;
    let resolve2!: (value: Response) => void;
    let resolve3!: (value: Response) => void;

    mockFetch
      .mockReturnValueOnce(
        new Promise<Response>((r) => {
          resolve1 = r;
        })
      )
      .mockReturnValueOnce(
        new Promise<Response>((r) => {
          resolve2 = r;
        })
      )
      .mockReturnValueOnce(
        new Promise<Response>((r) => {
          resolve3 = r;
        })
      );

    const p1 = globalThis.fetch('https://api.example.com/a');
    const p2 = globalThis.fetch('https://api.example.com/b');
    const p3 = globalThis.fetch('https://api.example.com/c');

    expect(detector.getStatus().pendingCount).toBe(3);
    expect(detector.isIdle()).toBe(false);

    // Complete first request
    resolve1(new Response('a'));
    await p1;
    expect(detector.getStatus().pendingCount).toBe(2);
    expect(detector.isIdle()).toBe(false);

    // Complete second request
    resolve2(new Response('b'));
    await p2;
    expect(detector.getStatus().pendingCount).toBe(1);
    expect(detector.isIdle()).toBe(false);

    // Even after debounce, still busy because one request pending
    vi.advanceTimersByTime(100);
    expect(detector.isIdle()).toBe(false);

    // Complete last request
    resolve3(new Response('c'));
    await p3;
    expect(detector.getStatus().pendingCount).toBe(0);

    // Still not idle until debounce
    expect(detector.isIdle()).toBe(false);

    vi.advanceTimersByTime(100);
    expect(detector.isIdle()).toBe(true);
  });

  it('should include pending request details in getStatus()', () => {
    createDetector();

    let resolveResponse!: (value: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    globalThis.fetch('https://api.example.com/users', { method: 'POST' });

    const status = detector.getStatus();
    expect(status.pendingCount).toBe(1);
    expect(status.pendingRequests).toHaveLength(1);
    expect(status.pendingRequests[0].url).toBe('https://api.example.com/users');
    expect(status.pendingRequests[0].method).toBe('POST');
    expect(status.pendingRequests[0].startedAt).toBeGreaterThan(0);
    expect(status.pendingRequests[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof status.timestamp).toBe('number');

    resolveResponse(new Response('ok'));
  });

  it('should resolve waitForIdle() when network settles', async () => {
    createDetector({ debounceMs: 100 });

    let resolveResponse!: (value: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    globalThis.fetch('https://api.example.com/data');

    const waitPromise = detector.waitForIdle({ timeout: 5000 });

    // Complete request
    resolveResponse(new Response('ok'));

    // Advance time for fetch microtask + polling intervals + debounce
    // waitForIdle polls every 50ms, so we need to tick through
    await vi.advanceTimersByTimeAsync(50); // poll check
    await vi.advanceTimersByTimeAsync(100); // debounce fires
    await vi.advanceTimersByTimeAsync(50); // next poll sees idle

    const status = await waitPromise;
    expect(status.idle).toBe(true);
    expect(status.pendingCount).toBe(0);
  });

  it('should reject waitForIdle() on timeout', async () => {
    createDetector({ debounceMs: 100 });

    // Create a fetch that never resolves
    mockFetch.mockReturnValueOnce(new Promise<Response>(() => {}));
    globalThis.fetch('https://api.example.com/slow');

    const waitPromise = detector.waitForIdle({ timeout: 500 });

    // Attach the rejection handler BEFORE advancing timers so it doesn't
    // surface as an unhandled rejection.
    const assertion = expect(waitPromise).rejects.toThrow('Network idle timeout after 500ms');

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(600);

    await assertion;
  });

  it('should fire onTransition callback on idle->busy transition', () => {
    createDetector();
    const callback = vi.fn();
    detector.onTransition(callback);

    let resolveResponse!: (value: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    globalThis.fetch('https://api.example.com/data');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      false,
      expect.objectContaining({
        idle: false,
        pendingCount: 1,
      })
    );

    resolveResponse(new Response('ok'));
  });

  it('should fire onTransition callback on busy->idle transition', async () => {
    createDetector({ debounceMs: 100 });
    const callback = vi.fn();
    detector.onTransition(callback);

    let resolveResponse!: (value: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    const p = globalThis.fetch('https://api.example.com/data');
    expect(callback).toHaveBeenCalledTimes(1); // idle->busy

    resolveResponse(new Response('ok'));
    await p;

    vi.advanceTimersByTime(100); // debounce

    expect(callback).toHaveBeenCalledTimes(2); // busy->idle
    expect(callback).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({
        idle: true,
        pendingCount: 0,
      })
    );
  });

  it('should allow unsubscribing from onTransition', () => {
    createDetector();
    const callback = vi.fn();
    const unsub = detector.onTransition(callback);

    unsub();

    mockFetch.mockReturnValueOnce(new Promise<Response>(() => {}));
    globalThis.fetch('https://api.example.com/data');

    expect(callback).not.toHaveBeenCalled();
  });

  it('should ignore URLs matching ignorePatterns', () => {
    createDetector({ ignorePatterns: ['/health', '\\.svg$'] });

    mockFetch.mockReturnValue(new Promise<Response>(() => {}));

    globalThis.fetch('https://api.example.com/health');
    expect(detector.getStatus().pendingCount).toBe(0);
    expect(detector.isIdle()).toBe(true);

    globalThis.fetch('https://cdn.example.com/icon.svg');
    expect(detector.getStatus().pendingCount).toBe(0);
    expect(detector.isIdle()).toBe(true);

    // Non-matching URL should be tracked
    globalThis.fetch('https://api.example.com/users');
    expect(detector.getStatus().pendingCount).toBe(1);
    expect(detector.isIdle()).toBe(false);
  });

  it('should restore original fetch on destroy()', () => {
    const originalFetch = globalThis.fetch;
    createDetector();

    // fetch was intercepted, so it's different now
    const interceptedFetch = globalThis.fetch;
    expect(interceptedFetch).not.toBe(originalFetch);

    detector.destroy();

    // After destroy, fetch should be restored to the mock we set
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('should not install twice when install() is called twice', () => {
    createDetector();
    const fetchAfterFirstInstall = globalThis.fetch;
    detector.install(); // second call should be no-op
    expect(globalThis.fetch).toBe(fetchAfterFirstInstall);
  });

  it('should handle fetch errors (rejected promises)', async () => {
    createDetector({ debounceMs: 100 });

    mockFetch.mockReturnValueOnce(Promise.reject(new Error('Network failure')));

    try {
      await globalThis.fetch('https://api.example.com/fail');
    } catch {
      // Expected rejection
    }

    // Request should have been tracked and completed (with error)
    expect(detector.getStatus().pendingCount).toBe(0);

    vi.advanceTimersByTime(100);
    expect(detector.isIdle()).toBe(true);
  });

  it('should track method from RequestInit', () => {
    createDetector();

    mockFetch.mockReturnValueOnce(new Promise<Response>(() => {}));
    globalThis.fetch('https://api.example.com/data', { method: 'DELETE' });

    expect(detector.getStatus().pendingRequests[0].method).toBe('DELETE');
  });

  it('should fire onRequestStart callback', () => {
    createDetector();
    const onStart = vi.fn();
    detector.onRequestStart = onStart;

    mockFetch.mockReturnValueOnce(new Promise<Response>(() => {}));
    globalThis.fetch('https://api.example.com/data', { method: 'PUT' });

    expect(onStart).toHaveBeenCalledWith({
      url: 'https://api.example.com/data',
      method: 'PUT',
      pendingCount: 1,
    });
  });

  it('should fire onRequestEnd callback', async () => {
    createDetector();
    const onEnd = vi.fn();
    detector.onRequestEnd = onEnd;

    let resolveResponse!: (value: Response) => void;
    mockFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    const p = globalThis.fetch('https://api.example.com/data');
    resolveResponse(new Response('ok', { status: 201 }));
    await p;

    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/data',
        method: 'GET',
        status: 201,
        pendingCount: 0,
      })
    );
    expect(onEnd.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should clear pending requests on destroy()', () => {
    createDetector();

    mockFetch.mockReturnValue(new Promise<Response>(() => {}));
    globalThis.fetch('https://api.example.com/a');
    globalThis.fetch('https://api.example.com/b');

    expect(detector.getStatus().pendingCount).toBe(2);

    detector.destroy();

    // After destroy, internal state is cleared
    // getStatus still works but returns empty state
    expect(detector.getStatus().pendingCount).toBe(0);
  });
});

// ============================================================================
// DOMSettlingDetector
// ============================================================================

describe('DOMSettlingDetector', () => {
  let detector: DOMSettlingDetector;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    detector?.destroy();
    vi.useRealTimers();
  });

  /**
   * jsdom's MutationObserver does fire callbacks on DOM changes, but within
   * the same microtask/macrotask boundary the timing can be tricky with fake
   * timers. We trigger mutations and flush promises to ensure callbacks fire.
   */

  function createDetector(
    config: Parameters<typeof DOMSettlingDetector.prototype.constructor>[0] = {}
  ) {
    detector = new DOMSettlingDetector(config);
    detector.install();
    return detector;
  }

  it('should start settled', () => {
    createDetector();
    expect(detector.isIdle()).toBe(true);
    expect(detector.getStatus().settled).toBe(true);
  });

  it('should have name "dom"', () => {
    createDetector();
    expect(detector.name).toBe('dom');
  });

  it('should have default weight of 0.8', () => {
    detector = new DOMSettlingDetector();
    expect(detector.weight).toBe(0.8);
  });

  it('should accept custom weight', () => {
    detector = new DOMSettlingDetector({ weight: 0.6 });
    expect(detector.weight).toBe(0.6);
  });

  it('should transition to mutating on DOM childList changes', async () => {
    createDetector({ settleMs: 200 });

    // Add a child element to trigger mutation
    const child = document.createElement('div');
    document.body.appendChild(child);

    // Flush microtasks so MutationObserver fires
    await vi.advanceTimersByTimeAsync(0);

    expect(detector.isIdle()).toBe(false);
    expect(detector.getStatus().settled).toBe(false);

    // Clean up
    document.body.removeChild(child);
  });

  it('should transition to mutating on attribute changes', async () => {
    createDetector({ settleMs: 200 });

    const el = document.createElement('div');
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(0);

    // Settle first
    vi.advanceTimersByTime(200);
    expect(detector.isIdle()).toBe(true);

    // Now change an attribute
    el.setAttribute('data-value', 'changed');
    await vi.advanceTimersByTimeAsync(0);

    expect(detector.isIdle()).toBe(false);

    // Clean up
    document.body.removeChild(el);
  });

  it('should transition back to settled after settleMs with no mutations', async () => {
    createDetector({ settleMs: 300 });

    const child = document.createElement('span');
    document.body.appendChild(child);
    await vi.advanceTimersByTimeAsync(0);

    expect(detector.isIdle()).toBe(false);

    // Wait for settle time
    vi.advanceTimersByTime(300);

    expect(detector.isIdle()).toBe(true);
    expect(detector.getStatus().settled).toBe(true);

    document.body.removeChild(child);
  });

  it('should reset settle timer on new mutations', async () => {
    createDetector({ settleMs: 200 });

    const child1 = document.createElement('div');
    document.body.appendChild(child1);
    await vi.advanceTimersByTimeAsync(0);

    expect(detector.isIdle()).toBe(false);

    // Wait 150ms (not enough to settle)
    vi.advanceTimersByTime(150);

    // Another mutation resets the timer
    const child2 = document.createElement('div');
    document.body.appendChild(child2);
    await vi.advanceTimersByTimeAsync(0);

    // Wait 150ms more (total 300ms since first, 150ms since second)
    vi.advanceTimersByTime(150);

    // Should still be mutating because settleMs is 200 and last mutation was 150ms ago
    expect(detector.isIdle()).toBe(false);

    // Wait 50ms more to reach 200ms since last mutation
    vi.advanceTimersByTime(50);

    expect(detector.isIdle()).toBe(true);

    document.body.removeChild(child1);
    document.body.removeChild(child2);
  });

  it('should include mutation count and timing in getStatus()', async () => {
    createDetector({ settleMs: 500 });

    const status1 = detector.getStatus();
    expect(status1.lastMutationAt).toBe(0);
    // When no mutations have occurred, msSinceLastMutation returns Date.now()
    // (time since epoch) to signal "never mutated" while remaining JSON-serializable.
    expect(status1.msSinceLastMutation).toBeGreaterThan(0);
    expect(Number.isFinite(status1.msSinceLastMutation)).toBe(true);
    expect(status1.recentMutationCount).toBe(0);

    const child = document.createElement('p');
    document.body.appendChild(child);
    await vi.advanceTimersByTimeAsync(0);

    const status2 = detector.getStatus();
    expect(status2.lastMutationAt).toBeGreaterThan(0);
    expect(status2.recentMutationCount).toBeGreaterThanOrEqual(1);
    expect(typeof status2.timestamp).toBe('number');

    document.body.removeChild(child);
  });

  it('should resolve waitForIdle() when settled', async () => {
    createDetector({ settleMs: 100 });

    // Already idle, should resolve immediately
    const status = await detector.waitForIdle({ timeout: 1000 });
    expect(status.settled).toBe(true);
  });

  it('should resolve waitForIdle() after mutations settle', async () => {
    createDetector({ settleMs: 100 });

    const child = document.createElement('div');
    document.body.appendChild(child);
    await vi.advanceTimersByTimeAsync(0);

    expect(detector.isIdle()).toBe(false);

    const waitPromise = detector.waitForIdle({ timeout: 5000 });

    // Advance past settle time + polling interval
    await vi.advanceTimersByTimeAsync(100); // settle timer fires
    await vi.advanceTimersByTimeAsync(50); // poll check

    const status = await waitPromise;
    expect(status.settled).toBe(true);

    document.body.removeChild(child);
  });

  it('should fire onTransition on settled->mutating', async () => {
    createDetector({ settleMs: 200 });
    const callback = vi.fn();
    detector.onTransition(callback);

    const child = document.createElement('div');
    document.body.appendChild(child);
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      false,
      expect.objectContaining({
        idle: false,
        settled: false,
      })
    );

    document.body.removeChild(child);
  });

  it('should fire onTransition on mutating->settled', async () => {
    createDetector({ settleMs: 100 });
    const callback = vi.fn();
    detector.onTransition(callback);

    const child = document.createElement('div');
    document.body.appendChild(child);
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledTimes(1); // mutating

    vi.advanceTimersByTime(100); // settle

    expect(callback).toHaveBeenCalledTimes(2); // settled
    expect(callback).toHaveBeenLastCalledWith(
      true,
      expect.objectContaining({
        idle: true,
        settled: true,
      })
    );

    document.body.removeChild(child);
  });

  it('should allow unsubscribing from onTransition', async () => {
    createDetector({ settleMs: 200 });
    const callback = vi.fn();
    const unsub = detector.onTransition(callback);

    unsub();

    const child = document.createElement('div');
    document.body.appendChild(child);
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).not.toHaveBeenCalled();

    document.body.removeChild(child);
  });

  it('should clean up observer on destroy()', async () => {
    createDetector({ settleMs: 200 });
    detector.destroy();

    // Mutations after destroy should not cause errors or state changes
    const child = document.createElement('div');
    document.body.appendChild(child);
    await vi.advanceTimersByTimeAsync(0);

    // isIdle should remain true (no observer tracking mutations)
    expect(detector.isIdle()).toBe(true);

    document.body.removeChild(child);
  });

  it('should not install twice when install() is called twice', () => {
    createDetector();
    // Should not throw
    detector.install();
  });

  it('should observe a custom root element', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    createDetector({ settleMs: 200, root });

    // Mutation inside root should be detected
    const child = document.createElement('span');
    root.appendChild(child);
    await vi.advanceTimersByTimeAsync(0);

    expect(detector.isIdle()).toBe(false);

    root.removeChild(child);
    document.body.removeChild(root);
  });
});

// ============================================================================
// LoadingIndicatorDetector
// ============================================================================

describe('LoadingIndicatorDetector', () => {
  let detector: LoadingIndicatorDetector;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    detector?.destroy();
    // Clean up any test elements left in the body
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  function createDetector(
    config: Parameters<typeof LoadingIndicatorDetector.prototype.constructor>[0] = {}
  ) {
    detector = new LoadingIndicatorDetector({
      checkAnimations: false,
      checkCursor: false,
      ...config,
    });
    detector.install();
    return detector;
  }

  /**
   * Helper to make an element "visible" in jsdom.
   * jsdom's getBoundingClientRect returns 0x0 by default, and getComputedStyle
   * returns default values. We need to mock visibility for the detector.
   */
  function makeVisible(el: HTMLElement) {
    // Override getBoundingClientRect to return non-zero dimensions
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      top: 0,
      right: 100,
      bottom: 50,
      left: 0,
      toJSON: () => ({}),
    });
  }

  it('should start idle when no loading indicators present', () => {
    createDetector();
    expect(detector.isIdle()).toBe(true);
    expect(detector.getStatus().loading).toBe(false);
    expect(detector.getStatus().indicators).toHaveLength(0);
  });

  it('should have name "loading-indicators"', () => {
    createDetector();
    expect(detector.name).toBe('loading-indicators');
  });

  it('should have default weight of 0.7', () => {
    detector = new LoadingIndicatorDetector();
    expect(detector.weight).toBe(0.7);
  });

  it('should detect aria-busy="true" elements', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-busy', 'true');
    document.body.appendChild(el);
    makeVisible(el);

    createDetector();

    expect(detector.isIdle()).toBe(false);
    const status = detector.getStatus();
    expect(status.loading).toBe(true);
    expect(status.indicators.length).toBeGreaterThanOrEqual(1);

    const ariaBusyIndicator = status.indicators.find((i) => i.type === 'aria-busy');
    expect(ariaBusyIndicator).toBeDefined();
  });

  it('should detect elements with loading-related CSS classes', () => {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    document.body.appendChild(spinner);
    makeVisible(spinner);

    createDetector();

    expect(detector.isIdle()).toBe(false);
    const status = detector.getStatus();
    expect(status.indicators.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect .loading class', () => {
    const el = document.createElement('div');
    el.className = 'loading';
    document.body.appendChild(el);
    makeVisible(el);

    createDetector();

    expect(detector.isIdle()).toBe(false);
  });

  it('should detect .skeleton class', () => {
    const el = document.createElement('div');
    el.className = 'skeleton';
    document.body.appendChild(el);
    makeVisible(el);

    createDetector();

    expect(detector.isIdle()).toBe(false);
  });

  it('should detect .shimmer class', () => {
    const el = document.createElement('div');
    el.className = 'shimmer';
    document.body.appendChild(el);
    makeVisible(el);

    createDetector();

    expect(detector.isIdle()).toBe(false);
  });

  it('should detect progress elements', () => {
    const progress = document.createElement('progress');
    progress.value = 50;
    progress.max = 100;
    document.body.appendChild(progress);
    makeVisible(progress);

    createDetector();

    // progress element without value="100" or value="1" should be detected
    expect(detector.isIdle()).toBe(false);
  });

  it('should detect data-loading="true" elements', () => {
    const el = document.createElement('div');
    el.setAttribute('data-loading', 'true');
    document.body.appendChild(el);
    makeVisible(el);

    createDetector();

    expect(detector.isIdle()).toBe(false);
  });

  it('should detect data-state="loading" elements', () => {
    const el = document.createElement('div');
    el.setAttribute('data-state', 'loading');
    document.body.appendChild(el);
    makeVisible(el);

    createDetector();

    expect(detector.isIdle()).toBe(false);
  });

  it('should detect framework-specific classes (MuiCircularProgress)', () => {
    const el = document.createElement('div');
    el.className = 'MuiCircularProgress-root';
    document.body.appendChild(el);
    makeVisible(el);

    createDetector();

    expect(detector.isIdle()).toBe(false);
  });

  it('should ignore hidden loading indicators (display: none)', () => {
    const el = document.createElement('div');
    el.className = 'spinner';
    el.style.display = 'none';
    document.body.appendChild(el);
    // getBoundingClientRect returns 0x0 by default in jsdom, so it's "hidden"

    createDetector();

    expect(detector.isIdle()).toBe(true);
  });

  it('should ignore loading indicators with zero dimensions', () => {
    const el = document.createElement('div');
    el.className = 'loading';
    document.body.appendChild(el);
    // Default getBoundingClientRect in jsdom returns 0x0, making it invisible

    createDetector();

    expect(detector.isIdle()).toBe(true);
  });

  it('should report idle when no indicators are present', () => {
    // Just a normal div, no loading classes
    const el = document.createElement('div');
    el.className = 'content';
    document.body.appendChild(el);

    createDetector();

    expect(detector.isIdle()).toBe(true);
    expect(detector.getStatus().indicators).toHaveLength(0);
  });

  it('should detect multiple loading indicators simultaneously', () => {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    document.body.appendChild(spinner);
    makeVisible(spinner);

    const busy = document.createElement('div');
    busy.setAttribute('aria-busy', 'true');
    document.body.appendChild(busy);
    makeVisible(busy);

    createDetector();

    expect(detector.isIdle()).toBe(false);
    expect(detector.getStatus().indicators.length).toBeGreaterThanOrEqual(2);
  });

  it('should support additional custom selectors', () => {
    const el = document.createElement('div');
    el.className = 'my-custom-loader';
    document.body.appendChild(el);
    makeVisible(el);

    createDetector({ additionalSelectors: ['.my-custom-loader'] });

    expect(detector.isIdle()).toBe(false);
  });

  it('should fire onTransition when loading indicators appear', async () => {
    createDetector();
    const callback = vi.fn();
    detector.onTransition(callback);

    expect(detector.isIdle()).toBe(true);

    // Add a loading indicator
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    document.body.appendChild(spinner);
    makeVisible(spinner);

    // The observer fires on DOM change, triggering a debounced scan
    await vi.advanceTimersByTimeAsync(0); // MutationObserver fires
    await vi.advanceTimersByTimeAsync(100); // scan debounce fires

    expect(callback).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(
      false,
      expect.objectContaining({
        idle: false,
        loading: true,
      })
    );
  });

  it('should fire onTransition when loading indicators disappear', async () => {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    document.body.appendChild(spinner);
    makeVisible(spinner);

    createDetector();

    expect(detector.isIdle()).toBe(false);

    const callback = vi.fn();
    detector.onTransition(callback);

    // Remove the loading indicator
    document.body.removeChild(spinner);

    // Wait for observer + scan debounce
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(callback).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        idle: true,
        loading: false,
      })
    );
  });

  it('should resolve waitForIdle() immediately when already idle', async () => {
    createDetector();
    const status = await detector.waitForIdle({ timeout: 1000 });
    expect(status.idle).toBe(true);
  });

  it('should resolve waitForIndicatorCleared() when selector disappears', async () => {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    document.body.appendChild(spinner);
    makeVisible(spinner);

    createDetector();

    const waitPromise = detector.waitForIndicatorCleared('.spinner', 5000);

    // Remove the spinner
    document.body.removeChild(spinner);

    // Advance past polling interval
    await vi.advanceTimersByTimeAsync(100);

    const status = await waitPromise;
    expect(status).toBeDefined();
  });

  it('should reject waitForIndicatorCleared() on timeout', async () => {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    document.body.appendChild(spinner);
    makeVisible(spinner);

    createDetector();

    const waitPromise = detector.waitForIndicatorCleared('.spinner', 500);

    // Attach the rejection handler BEFORE advancing timers
    const assertion = expect(waitPromise).rejects.toThrow(
      'Indicator ".spinner" still present after 500ms'
    );

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(600);

    await assertion;
  });

  it('should include element identification in indicator details', () => {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'main-spinner');
    el.className = 'spinner';
    document.body.appendChild(el);
    makeVisible(el);

    createDetector();

    const indicator = detector.getStatus().indicators.find((i) => i.element === 'main-spinner');
    expect(indicator).toBeDefined();
  });

  it('should use id as fallback for element identification', () => {
    const el = document.createElement('div');
    el.id = 'my-loader';
    el.className = 'loader';
    document.body.appendChild(el);
    makeVisible(el);

    createDetector();

    const indicator = detector.getStatus().indicators.find((i) => i.element === 'my-loader');
    expect(indicator).toBeDefined();
  });

  it('should clean up on destroy()', () => {
    createDetector();
    detector.destroy();
    // Should not throw when queried after destroy
    expect(detector.isIdle()).toBe(true);
  });
});

// ============================================================================
// CompositeIdleDetector
// ============================================================================

describe('CompositeIdleDetector', () => {
  let composite: CompositeIdleDetector;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    composite?.destroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  /**
   * A minimal mock IdleSignal for testing composite behavior without
   * needing real DOM or network activity.
   */
  function createMockSignal(name: string, weight: number, idle = true) {
    const listeners: Array<(idle: boolean, status: { idle: boolean; timestamp: number }) => void> =
      [];
    let _idle = idle;

    return {
      name,
      weight,
      isIdle: () => _idle,
      getStatus: () => ({ idle: _idle, timestamp: Date.now() }),
      waitForIdle: vi.fn().mockImplementation(
        () =>
          _idle ? Promise.resolve({ idle: true, timestamp: Date.now() }) : new Promise(() => {}) // never resolves if not idle
      ),
      onTransition: vi
        .fn()
        .mockImplementation(
          (cb: (idle: boolean, status: { idle: boolean; timestamp: number }) => void) => {
            listeners.push(cb);
            return () => {
              const idx = listeners.indexOf(cb);
              if (idx >= 0) listeners.splice(idx, 1);
            };
          }
        ),
      install: vi.fn(),
      destroy: vi.fn(),
      // Test helpers
      setIdle(value: boolean) {
        _idle = value;
        for (const cb of listeners) {
          cb(value, { idle: value, timestamp: Date.now() });
        }
      },
      _listeners: listeners,
    };
  }

  it('should return individual signals by name via getSignal()', () => {
    composite = new CompositeIdleDetector();
    const signal = createMockSignal('network', 0.9);
    composite.addSignal(signal);

    expect(composite.getSignal('network')).toBe(signal);
    expect(composite.getSignal('nonexistent')).toBeUndefined();
  });

  it('should list all signal names via getSignalNames()', () => {
    composite = new CompositeIdleDetector();
    composite.addSignal(createMockSignal('network', 0.9));
    composite.addSignal(createMockSignal('dom', 0.8));
    composite.addSignal(createMockSignal('loading-indicators', 0.7));

    const names = composite.getSignalNames();
    expect(names).toContain('network');
    expect(names).toContain('dom');
    expect(names).toContain('loading-indicators');
    expect(names).toHaveLength(3);
  });

  it('should include per-signal breakdown in getStatus()', () => {
    composite = new CompositeIdleDetector();
    composite.addSignal(createMockSignal('network', 0.9, true));
    composite.addSignal(createMockSignal('dom', 0.8, false));

    const status = composite.getStatus();
    expect(status.signals).toHaveProperty('network');
    expect(status.signals).toHaveProperty('dom');
    expect(status.signals.network.idle).toBe(true);
    expect(status.signals.network.weight).toBe(0.9);
    expect(status.signals.dom.idle).toBe(false);
    expect(status.signals.dom.weight).toBe(0.8);
  });

  it('should compute idleScore as weighted average', () => {
    composite = new CompositeIdleDetector();
    composite.addSignal(createMockSignal('a', 0.9, true)); // idle
    composite.addSignal(createMockSignal('b', 0.1, false)); // busy

    const status = composite.getStatus();
    // idleScore = 0.9 / (0.9 + 0.1) = 0.9
    expect(status.idleScore).toBeCloseTo(0.9, 5);
  });

  it('should require all critical (weight >= 0.8) signals idle for composite idle', () => {
    composite = new CompositeIdleDetector();

    const network = createMockSignal('network', 0.9, true);
    const dom = createMockSignal('dom', 0.8, true);
    const loading = createMockSignal('loading', 0.3, true);

    composite.addSignal(network);
    composite.addSignal(dom);
    composite.addSignal(loading);

    expect(composite.isIdle()).toBe(true);

    // Make a critical signal busy
    dom.setIdle(false);
    expect(composite.isIdle()).toBe(false);

    // Non-critical signal busy doesn't block idle (if score is high enough)
    dom.setIdle(true);
    loading.setIdle(false);
    // idleScore = (0.9 + 0.8) / (0.9 + 0.8 + 0.3) = 1.7/2.0 = 0.85 > 0.7
    expect(composite.isIdle()).toBe(true);
  });

  it('should not be idle when idleScore is below minIdleScore', () => {
    composite = new CompositeIdleDetector({ minIdleScore: 0.9 });

    const a = createMockSignal('a', 0.5, true);
    const b = createMockSignal('b', 0.5, false);

    composite.addSignal(a);
    composite.addSignal(b);

    // idleScore = 0.5 / 1.0 = 0.5 < 0.9
    // Also no critical signals, so allCriticalIdle is true
    // But idleScore < minIdleScore, so not idle
    expect(composite.isIdle()).toBe(false);
  });

  it('should be idle when all signals are idle', () => {
    composite = new CompositeIdleDetector();
    composite.addSignal(createMockSignal('network', 0.9, true));
    composite.addSignal(createMockSignal('dom', 0.8, true));
    composite.addSignal(createMockSignal('loading', 0.7, true));

    expect(composite.isIdle()).toBe(true);
    expect(composite.getStatus().idleScore).toBe(1);
  });

  it('should report idle when no signals are registered', () => {
    composite = new CompositeIdleDetector();
    expect(composite.isIdle()).toBe(true);
    expect(composite.getStatus().idleScore).toBe(1); // totalWeight = 0 => 1
  });

  describe('waitFor() with subset of signals', () => {
    it('should resolve when specified signals are idle', async () => {
      composite = new CompositeIdleDetector();
      const network = createMockSignal('network', 0.9, true);
      const dom = createMockSignal('dom', 0.8, false); // busy
      composite.addSignal(network);
      composite.addSignal(dom);

      // Wait for only 'network' (which is already idle)
      const result = await composite.waitFor(['network'], { timeout: 1000 });
      expect(result.network.idle).toBe(true);
    });

    it('should wait until specified signals become idle', async () => {
      composite = new CompositeIdleDetector();
      const network = createMockSignal('network', 0.9, false);
      composite.addSignal(network);

      const waitPromise = composite.waitFor(['network'], { timeout: 5000 });

      // Become idle after some time
      await vi.advanceTimersByTimeAsync(100);
      network.setIdle(true);
      await vi.advanceTimersByTimeAsync(50); // polling interval

      const result = await waitPromise;
      expect(result.network.idle).toBe(true);
    });

    it('should support indicator targets', async () => {
      composite = new CompositeIdleDetector();

      // No spinner element present
      const result = await composite.waitFor([{ indicator: '.spinner' }], { timeout: 1000 });
      expect(result['indicator:.spinner'].idle).toBe(true);
    });

    it('should timeout when signals do not become idle', async () => {
      composite = new CompositeIdleDetector();
      const network = createMockSignal('network', 0.9, false);
      composite.addSignal(network);

      const waitPromise = composite.waitFor(['network'], { timeout: 500 });

      // Attach the rejection handler BEFORE advancing timers
      const assertion = expect(waitPromise).rejects.toThrow('Selective wait timeout after 500ms');

      await vi.advanceTimersByTimeAsync(600);

      await assertion;
    });
  });

  describe('waitForSignal()', () => {
    it('should delegate to individual signal waitForIdle', async () => {
      composite = new CompositeIdleDetector();
      const network = createMockSignal('network', 0.9, true);
      composite.addSignal(network);

      await composite.waitForSignal('network', { timeout: 1000 });

      expect(network.waitForIdle).toHaveBeenCalledWith({ timeout: 1000 });
    });

    it('should throw if signal not found', async () => {
      composite = new CompositeIdleDetector();

      await expect(composite.waitForSignal('nonexistent')).rejects.toThrow(
        'Signal not found: nonexistent'
      );
    });
  });

  describe('waitForIdle()', () => {
    it('should resolve when composite is idle', async () => {
      composite = new CompositeIdleDetector();
      composite.addSignal(createMockSignal('network', 0.9, true));
      composite.addSignal(createMockSignal('dom', 0.8, true));

      // minStableMs defaults to 500
      const waitPromise = composite.waitForIdle({ timeout: 5000, minStableMs: 0 });
      const status = await waitPromise;
      expect(status.idle).toBe(true);
    });

    it('should wait for minStableMs', async () => {
      composite = new CompositeIdleDetector();
      composite.addSignal(createMockSignal('network', 0.9, true));

      const waitPromise = composite.waitForIdle({ timeout: 5000, minStableMs: 200 });

      // Need to advance time for stable period + polling
      await vi.advanceTimersByTimeAsync(250);

      const status = await waitPromise;
      expect(status.idle).toBe(true);
    });

    it('should support exclude option', async () => {
      composite = new CompositeIdleDetector();
      composite.addSignal(createMockSignal('network', 0.9, true));
      composite.addSignal(createMockSignal('dom', 0.8, false)); // busy

      // Excluding 'dom' means only 'network' matters
      const waitPromise = composite.waitForIdle({
        timeout: 5000,
        minStableMs: 0,
        exclude: ['dom'],
      });

      const status = await waitPromise;
      expect(status.idle).toBe(true);
      expect(status.signals).not.toHaveProperty('dom');
    });

    it('should timeout with busy signal names in error', async () => {
      composite = new CompositeIdleDetector();
      composite.addSignal(createMockSignal('network', 0.9, false));
      composite.addSignal(createMockSignal('dom', 0.8, false));

      const waitPromise = composite.waitForIdle({ timeout: 300, minStableMs: 0 });

      // Attach the rejection handler BEFORE advancing timers
      const assertion = expect(waitPromise).rejects.toThrow(/Busy signals: network, dom/);

      await vi.advanceTimersByTimeAsync(400);

      await assertion;
    });
  });

  describe('onTransition()', () => {
    it('should fire when composite transitions from idle to busy', () => {
      composite = new CompositeIdleDetector();
      const network = createMockSignal('network', 0.9, true);
      composite.addSignal(network);

      const callback = vi.fn();
      composite.onTransition(callback);

      // Initially idle. Make busy.
      network.setIdle(false);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ idle: false }));
    });

    it('should fire when composite transitions from busy to idle', () => {
      composite = new CompositeIdleDetector();
      const network = createMockSignal('network', 0.9, false);
      composite.addSignal(network);

      const callback = vi.fn();
      composite.onTransition(callback);

      // Make idle
      network.setIdle(true);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ idle: true }));
    });

    it('should not fire when idle state does not change', () => {
      composite = new CompositeIdleDetector();
      const a = createMockSignal('a', 0.9, true);
      const b = createMockSignal('b', 0.3, true);
      composite.addSignal(a);
      composite.addSignal(b);

      // Trigger first evaluation to set lastIdle
      a.setIdle(true);

      const callback = vi.fn();
      composite.onTransition(callback);

      // Make non-critical signal busy - composite stays idle
      b.setIdle(false);

      // Should not fire because composite idle state didn't change
      // (idleScore = 0.9/1.2 = 0.75 > 0.7, all critical still idle)
      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow unsubscribing', () => {
      composite = new CompositeIdleDetector();
      const network = createMockSignal('network', 0.9, true);
      composite.addSignal(network);

      const callback = vi.fn();
      const unsub = composite.onTransition(callback);
      unsub();

      network.setIdle(false);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('CompositeIdleDetector.create()', () => {
    it('should create a detector with default configuration (all signals enabled)', () => {
      // Mock fetch for network detector
      globalThis.fetch = vi.fn();

      composite = CompositeIdleDetector.create();

      const names = composite.getSignalNames();
      expect(names).toContain('network');
      expect(names).toContain('dom');
      expect(names).toContain('loading-indicators');
      expect(names).toContain('form-mutation');
      expect(names).toHaveLength(4);
    });

    it('should allow disabling individual signals', () => {
      globalThis.fetch = vi.fn();

      composite = CompositeIdleDetector.create({
        network: { enabled: false },
        dom: { enabled: true },
        loadingIndicators: { enabled: false },
      });

      const names = composite.getSignalNames();
      expect(names).not.toContain('network');
      expect(names).toContain('dom');
      expect(names).not.toContain('loading-indicators');
    });

    it('should apply custom weights', () => {
      globalThis.fetch = vi.fn();

      composite = CompositeIdleDetector.create({
        network: { weight: 0.5 },
        dom: { weight: 0.3 },
        loadingIndicators: { weight: 0.2 },
      });

      const networkSignal = composite.getSignal('network');
      const domSignal = composite.getSignal('dom');
      const loadingSignal = composite.getSignal('loading-indicators');

      expect(networkSignal?.weight).toBe(0.5);
      expect(domSignal?.weight).toBe(0.3);
      expect(loadingSignal?.weight).toBe(0.2);
    });

    it('should apply custom minIdleScore', () => {
      globalThis.fetch = vi.fn();

      composite = CompositeIdleDetector.create({ minIdleScore: 0.95 });

      // All signals are idle by default, score should be 1
      expect(composite.isIdle()).toBe(true);
    });

    it('should pass network config through', () => {
      globalThis.fetch = vi.fn();

      composite = CompositeIdleDetector.create({
        network: {
          debounceMs: 1000,
          ignorePatterns: ['/health'],
          trackXHR: false,
        },
      });

      const network = composite.getSignal<NetworkIdleDetector>('network');
      expect(network).toBeDefined();
      // The detector was created with the config, we verify it exists
      expect(network?.name).toBe('network');
    });
  });

  describe('addSignal() and removeSignal()', () => {
    it('should install signal on add', () => {
      composite = new CompositeIdleDetector();
      const signal = createMockSignal('test', 0.5);
      composite.addSignal(signal);

      expect(signal.install).toHaveBeenCalled();
    });

    it('should subscribe to signal transitions on add', () => {
      composite = new CompositeIdleDetector();
      const signal = createMockSignal('test', 0.5);
      composite.addSignal(signal);

      expect(signal.onTransition).toHaveBeenCalled();
    });

    it('should remove and destroy signal', () => {
      composite = new CompositeIdleDetector();
      const signal = createMockSignal('test', 0.5);
      composite.addSignal(signal);

      const removed = composite.removeSignal('test');
      expect(removed).toBe(true);
      expect(signal.destroy).toHaveBeenCalled();
      expect(composite.getSignal('test')).toBeUndefined();
    });

    it('should return false when removing nonexistent signal', () => {
      composite = new CompositeIdleDetector();
      expect(composite.removeSignal('nonexistent')).toBe(false);
    });
  });

  describe('destroy()', () => {
    it('should destroy all signals and clear listeners', () => {
      composite = new CompositeIdleDetector();
      const s1 = createMockSignal('a', 0.9);
      const s2 = createMockSignal('b', 0.8);
      composite.addSignal(s1);
      composite.addSignal(s2);

      const callback = vi.fn();
      composite.onTransition(callback);

      composite.destroy();

      expect(s1.destroy).toHaveBeenCalled();
      expect(s2.destroy).toHaveBeenCalled();
      expect(composite.getSignalNames()).toHaveLength(0);
    });
  });

  describe('getSignalStatus()', () => {
    it('should return status for a known signal', () => {
      composite = new CompositeIdleDetector();
      composite.addSignal(createMockSignal('network', 0.9, true));

      const status = composite.getSignalStatus('network');
      expect(status).toBeDefined();
      expect(status?.idle).toBe(true);
    });

    it('should return undefined for unknown signal', () => {
      composite = new CompositeIdleDetector();
      expect(composite.getSignalStatus('nonexistent')).toBeUndefined();
    });
  });

  describe('installAll()', () => {
    it('should install all registered signals', () => {
      composite = new CompositeIdleDetector();
      const s1 = createMockSignal('a', 0.5);
      const s2 = createMockSignal('b', 0.5);
      composite.addSignal(s1);
      composite.addSignal(s2);

      // install is called once by addSignal; installAll calls it again
      composite.installAll();

      expect(s1.install).toHaveBeenCalledTimes(2);
      expect(s2.install).toHaveBeenCalledTimes(2);
    });
  });
});

// ============================================================================
// Integration: Real signals in composite
// ============================================================================

describe('CompositeIdleDetector (integration with real signals)', () => {
  let composite: CompositeIdleDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    composite?.destroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('should integrate real NetworkIdleDetector and DOMSettlingDetector', async () => {
    composite = CompositeIdleDetector.create({
      network: { debounceMs: 100, trackXHR: false },
      dom: { settleMs: 100 },
      loadingIndicators: { enabled: false },
    });

    // Initially idle
    expect(composite.isIdle()).toBe(true);

    // Trigger a DOM mutation
    const child = document.createElement('div');
    document.body.appendChild(child);
    await vi.advanceTimersByTimeAsync(0);

    // DOM signal should be busy
    const domSignal = composite.getSignal('dom');
    expect(domSignal?.isIdle()).toBe(false);

    // Composite should be busy (dom is critical at weight 0.8)
    expect(composite.isIdle()).toBe(false);

    // Wait for DOM to settle
    vi.advanceTimersByTime(100);

    expect(domSignal?.isIdle()).toBe(true);
    expect(composite.isIdle()).toBe(true);

    document.body.removeChild(child);
  });

  it('should become busy when network fetch starts and idle when it completes', async () => {
    const mockFetchFn = vi.fn();
    globalThis.fetch = mockFetchFn;

    composite = CompositeIdleDetector.create({
      network: { debounceMs: 50, trackXHR: false },
      dom: { enabled: false },
      loadingIndicators: { enabled: false },
    });

    expect(composite.isIdle()).toBe(true);

    let resolveResponse!: (value: Response) => void;
    mockFetchFn.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    const p = globalThis.fetch('https://api.example.com/data');

    expect(composite.isIdle()).toBe(false);

    resolveResponse(new Response('ok'));
    await p;

    vi.advanceTimersByTime(50);

    expect(composite.isIdle()).toBe(true);
  });
});
