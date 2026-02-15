/**
 * Memory Capture Sub-module
 *
 * Periodically snapshots performance.memory (Chrome-only, non-standard).
 * No-op if the API is unavailable.
 */

import type { AnyCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export function installMemoryCapture(emit: Emit, intervalMs = 30000): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const perf = performance as Performance & { memory?: PerformanceMemory };
  if (!perf.memory) {
    return () => {};
  }

  const tick = () => {
    const mem = perf.memory;
    if (!mem) return;
    emit({
      type: 'memory',
      timestamp: Date.now(),
      url: window.location.href,
      usedJSHeapSize: mem.usedJSHeapSize,
      totalJSHeapSize: mem.totalJSHeapSize,
      jsHeapSizeLimit: mem.jsHeapSizeLimit,
    });
  };

  // Emit initial snapshot immediately
  tick();
  const id = setInterval(tick, intervalMs);

  return () => {
    clearInterval(id);
  };
}
