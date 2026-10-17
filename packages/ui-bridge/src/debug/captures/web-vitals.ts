/**
 * Web Vitals Capture Sub-module
 *
 * Captures LCP (Largest Contentful Paint) and CLS (Cumulative Layout Shift)
 * using PerformanceObserver. Simplified implementation — no npm dependency.
 * Layout shifts come from the shared `perf/` observer.
 */

import type { AnyCapturedEvent } from '../browser-capture-types';
import { observeLayoutShifts } from '../../perf';

type Emit = (event: AnyCapturedEvent) => void;

export function installWebVitalsCapture(emit: Emit): () => void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => {};
  }

  const observers: PerformanceObserver[] = [];

  // LCP — report the last entry (largest contentful paint)
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        emit({
          type: 'web-vital',
          timestamp: Date.now(),
          url: window.location.href,
          metric: 'LCP',
          value: Math.round(last.startTime),
        });
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    observers.push(lcpObserver);
  } catch {
    // Not supported
  }

  // CLS — accumulate layout shift values. The layout-shift observer is the
  // shared one in `perf/` (also feeding the change tracker's timeline); a
  // webview without the entry type yields no CLS event at all, never a 0.
  let clsValue = 0;
  const cls = observeLayoutShifts(
    (sample) => {
      // Only count shifts without recent input
      if (!sample.hadRecentInput) clsValue += sample.value;
      emit({
        type: 'web-vital',
        timestamp: Date.now(),
        url: window.location.href,
        metric: 'CLS',
        value: Math.round(clsValue * 1000) / 1000,
      });
    },
    { buffered: true }
  );

  // INP — track worst-case interaction duration
  try {
    let worstInp = 0;
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = entry.duration;
        if (duration > worstInp) {
          worstInp = duration;
          emit({
            type: 'web-vital',
            timestamp: Date.now(),
            url: window.location.href,
            metric: 'INP',
            value: Math.round(duration),
          });
        }
      }
    });
    inpObserver.observe({
      type: 'event',
      durationThreshold: 104,
      buffered: true,
    } as PerformanceObserverInit);
    observers.push(inpObserver);
  } catch {
    // Not supported
  }

  return () => {
    for (const obs of observers) {
      obs.disconnect();
    }
    cls?.disconnect();
  };
}
