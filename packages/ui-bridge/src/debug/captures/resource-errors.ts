/**
 * Resource Error Capture Sub-module
 *
 * Listens for resource load failures (img, script, link) using the
 * window 'error' event in capture phase (these don't bubble).
 */

import type { AnyCapturedEvent } from '../browser-capture-types';
import { elementReportKey, recordObservedReport } from '../observed-reports';

type Emit = (event: AnyCapturedEvent) => void;

const TRACKED_TAGS = new Set(['IMG', 'SCRIPT', 'LINK']);

export function installResourceErrorCapture(emit: Emit): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.tagName) return;
    if (!TRACKED_TAGS.has(target.tagName)) return;

    const resourceUrl =
      (target as HTMLImageElement).src ||
      (target as HTMLScriptElement).src ||
      (target as HTMLLinkElement).href ||
      '';

    if (!resourceUrl) return;

    // Reported here, so resource-status does not report it again.
    // Keyed on the source actually loaded: a responsive img loads `currentSrc`.
    const loaded = (target as HTMLImageElement).currentSrc || resourceUrl;
    recordObservedReport(elementReportKey(loaded, target.tagName));
    emit({
      type: 'resource-error',
      timestamp: Date.now(),
      url: window.location.href,
      resourceUrl,
      tagName: target.tagName,
    });
  };

  // Must use capture phase — resource errors don't bubble
  window.addEventListener('error', handler, true);

  return () => {
    window.removeEventListener('error', handler, true);
  };
}
