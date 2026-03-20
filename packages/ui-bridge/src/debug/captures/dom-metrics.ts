/**
 * DOM Metrics Capture Sub-module
 *
 * Periodically counts DOM nodes to detect unbounded DOM growth.
 * Uses requestIdleCallback (with setTimeout fallback) to avoid
 * the counting itself causing jank.
 */

import type { AnyCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

function countAndEmit(emit: Emit): void {
  const schedule =
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 0);

  schedule(() => {
    const nodeCount = document.querySelectorAll('*').length;
    const listenerCount = document.querySelectorAll(
      'button, a, input, select, textarea, [onclick], [onchange], [onkeydown]'
    ).length;
    emit({
      type: 'dom-metrics',
      timestamp: Date.now(),
      url: window.location.href,
      nodeCount,
      listenerCount,
    });
  });
}

export function installDomMetricsCapture(emit: Emit, intervalMs = 10000): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  // Emit initial snapshot immediately
  countAndEmit(emit);

  const id = setInterval(() => {
    countAndEmit(emit);
  }, intervalMs);

  return () => {
    clearInterval(id);
  };
}
