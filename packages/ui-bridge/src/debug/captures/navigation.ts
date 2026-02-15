/**
 * Navigation Capture Sub-module
 *
 * Patches history.pushState/replaceState and listens for popstate events
 * to emit navigation events with from/to URLs and trigger type.
 */

import type { NavigationCapturedEvent, AnyCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

export function installNavigationCapture(emit: Emit): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') {
    return () => {};
  }

  let lastUrl = window.location.href;

  function emitNav(to: string, trigger: NavigationCapturedEvent['trigger']) {
    const from = lastUrl;
    lastUrl = to;
    if (from === to) return;
    emit({
      type: 'navigation',
      timestamp: Date.now(),
      url: to,
      from,
      to,
      trigger,
    });
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    originalPushState.apply(this, args);
    emitNav(window.location.href, 'pushState');
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    originalReplaceState.apply(this, args);
    emitNav(window.location.href, 'replaceState');
  };

  const popstateHandler = () => {
    emitNav(window.location.href, 'popstate');
  };
  window.addEventListener('popstate', popstateHandler);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', popstateHandler);
  };
}
