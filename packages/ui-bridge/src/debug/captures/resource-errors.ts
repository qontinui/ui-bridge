/**
 * Resource Error Capture Sub-module
 *
 * Listens for resource load failures (img, script, link) using the
 * window 'error' event in capture phase (these don't bubble).
 */

import type { AnyCapturedEvent } from '../browser-capture-types';

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
