/**
 * Long Animation Frame (LoAF) Capture Sub-module
 *
 * Uses PerformanceObserver to capture long animation frames (Chrome 123+)
 * with per-script attribution: which script file, function, and duration.
 * Graceful no-op if unsupported.
 */

import type { AnyCapturedEvent, LoafScriptAttribution } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

export function installLoafCapture(emit: Emit): () => void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => {};
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const scripts: LoafScriptAttribution[] = (
          (entry as unknown as { scripts?: unknown[] }).scripts ?? []
        ).map((s: unknown) => {
          const script = s as Record<string, unknown>;
          return {
            invoker: (script.invoker as string) ?? '',
            sourceURL: (script.sourceURL as string) ?? '',
            sourceFunctionName: (script.sourceFunctionName as string) ?? '',
            sourceCharPosition: (script.sourceCharPosition as number) ?? 0,
            duration: Math.round((script.duration as number) ?? 0),
          };
        });

        emit({
          type: 'long-animation-frame',
          timestamp: Date.now(),
          url: window.location.href,
          durationMs: Math.round(entry.duration),
          blockingDurationMs: Math.round(
            (entry as unknown as { blockingDuration?: number }).blockingDuration ?? 0
          ),
          scripts,
        });
      }
    });

    observer.observe({ type: 'long-animation-frame' as string, buffered: true });

    return () => {
      observer.disconnect();
    };
  } catch {
    // 'long-animation-frame' type not supported in this browser
    return () => {};
  }
}
