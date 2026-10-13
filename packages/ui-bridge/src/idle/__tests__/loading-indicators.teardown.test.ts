/**
 * A debounced rescan that fires after its document is gone is a no-op.
 *
 * `LoadingIndicatorDetector` debounces DOM mutations into a 100 ms rescan
 * timer. When the realm it watched is torn down first (a test environment
 * between files, a page unloading), the timer still fires. `scan()` used to
 * read `document` regardless and throw from inside the timer: an unhandled
 * error. On a loaded box the SDK suite counted 2-17 of them per run
 * (`ReferenceError: document is not defined`, loading-indicators.ts:248) and
 * vitest exited 1 with every test passing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadingIndicatorDetector } from '../loading-indicators';

describe('LoadingIndicatorDetector · rescan after teardown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('a debounced rescan that fires with no document does nothing and throws nothing', async () => {
    vi.useFakeTimers();
    // Default config, as CompositeIdleDetector builds it: the animation check
    // is the read that threw (`document.getAnimations`).
    const detector = new LoadingIndicatorDetector();
    detector.install();
    expect(detector.isIdle()).toBe(true);

    // A mutation schedules the debounced rescan. MutationObserver callbacks
    // are microtasks, which fake timers leave alone.
    document.body.appendChild(document.createElement('div'));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // The realm goes away before the timer fires.
    vi.stubGlobal('document', undefined);
    expect(() => vi.advanceTimersByTime(150)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);

    vi.unstubAllGlobals();
    expect(detector.isIdle()).toBe(true);
    detector.destroy();
  });
});
