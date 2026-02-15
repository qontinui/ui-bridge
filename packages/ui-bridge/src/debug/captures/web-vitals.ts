/**
 * Web Vitals Capture Sub-module
 *
 * Captures LCP (Largest Contentful Paint) and CLS (Cumulative Layout Shift)
 * using PerformanceObserver. Simplified implementation — no npm dependency.
 */

import type { AnyCapturedEvent } from '../browser-capture-types';

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

  // CLS — accumulate layout shift values
  try {
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Only count shifts without recent input
        if (!(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput) {
          clsValue += (entry as PerformanceEntry & { value?: number }).value ?? 0;
        }
      }
      emit({
        type: 'web-vital',
        timestamp: Date.now(),
        url: window.location.href,
        metric: 'CLS',
        value: Math.round(clsValue * 1000) / 1000,
      });
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
    observers.push(clsObserver);
  } catch {
    // Not supported
  }

  return () => {
    for (const obs of observers) {
      obs.disconnect();
    }
  };
}
