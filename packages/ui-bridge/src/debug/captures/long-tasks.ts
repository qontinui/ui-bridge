/**
 * Long Task Capture Sub-module
 *
 * Captures long tasks through the shared `perf/` observer (the same one the
 * change tracker's timeline uses). Graceful no-op where the webview cannot
 * observe the `longtask` entry type.
 */

import type { AnyCapturedEvent } from '../browser-capture-types';
import { observeLongTasks } from '../../perf';

type Emit = (event: AnyCapturedEvent) => void;

export function installLongTaskCapture(emit: Emit): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handle = observeLongTasks(
    (samples) => {
      for (const sample of samples) {
        emit({
          type: 'long-task',
          timestamp: Date.now(),
          url: window.location.href,
          durationMs: Math.round(sample.duration),
        });
      }
    },
    { buffered: true }
  );

  return () => {
    handle?.disconnect();
  };
}
