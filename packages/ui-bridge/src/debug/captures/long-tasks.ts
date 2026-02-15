/**
 * Long Task Capture Sub-module
 *
 * Uses PerformanceObserver to capture long tasks (>50ms).
 * Graceful no-op if PerformanceObserver or the 'longtask' type is not supported.
 */

import type { AnyCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

export function installLongTaskCapture(emit: Emit): () => void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => {};
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        emit({
          type: 'long-task',
          timestamp: Date.now(),
          url: window.location.href,
          durationMs: Math.round(entry.duration),
        });
      }
    });

    observer.observe({ type: 'longtask', buffered: true });

    return () => {
      observer.disconnect();
    };
  } catch {
    // 'longtask' type not supported in this browser
    return () => {};
  }
}
