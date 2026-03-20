/**
 * Freeze Detector Capture Sub-module
 *
 * Detects UI freezes by monitoring main thread responsiveness.
 * Uses a periodic tick to measure gaps — if the gap between ticks
 * exceeds the threshold, a freeze event is emitted.
 */

import type { AnyCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

export function installFreezeDetectorCapture(
  emit: Emit,
  intervalMs = 200,
  thresholdMs = 3000
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let lastTick = performance.now();

  const id = setInterval(() => {
    const now = performance.now();
    const gap = now - lastTick;

    if (gap > thresholdMs) {
      emit({
        type: 'freeze',
        timestamp: Date.now(),
        url: window.location.href,
        gapMs: Math.round(gap),
        expectedMs: intervalMs,
      });
    }

    lastTick = now;
  }, intervalMs);

  return () => {
    clearInterval(id);
  };
}
