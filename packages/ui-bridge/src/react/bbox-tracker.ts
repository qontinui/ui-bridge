/**
 * Live Bounding-Box Tracker
 *
 * Watches DOM elements for layout changes (resize, scroll, viewport resize)
 * and pushes fresh viewport-relative bounding boxes into the UI Bridge
 * registry. Used by `useUIElement` so runner steps can target SDK-registered
 * elements by DOM coordinates and skip VLM pixel grounding.
 *
 * Key design points:
 *
 * - **One shared scroll/resize listener for the whole process.** Pages with
 *   hundreds of registered elements cannot afford per-element listeners on
 *   the `scroll` (capture) + `resize` events; we coalesce via rAF and fan
 *   out to every tracked element once per frame.
 * - **`ResizeObserver` per element**, because that's already coalesced by
 *   the browser and there's no cheaper way to notice a single element's box
 *   changing due to content reflow that doesn't touch `window` scroll.
 * - **Writes go through `UIBridgeRegistry.updateElementBbox`**, which does
 *   NOT emit events or bump `storeVersion`. Every scroll would otherwise
 *   wake `useSyncExternalStore` consumers and cascade into render loops
 *   (React error #185).
 */

import type { UIBridgeRegistry } from '../core/registry';

/** Marker attribute the hook stamps on elements for fallback resolution. */
export const UI_BRIDGE_ID_ATTR = 'data-ui-bridge-id';

interface Tracked {
  /** Registered element ID. */
  id: string;
  /** DOM node being observed. */
  element: HTMLElement;
  /** Per-element ResizeObserver, so we can disconnect on untrack. */
  resizeObserver: ResizeObserver | null;
}

/**
 * Internal: bucket of trackers keyed by element id, plus one pair of
 * window-level listeners shared across all trackers in this registry.
 */
class BboxTrackerGroup {
  private tracked = new Map<string, Tracked>();
  private scrollListener: (() => void) | null = null;
  private resizeListener: (() => void) | null = null;
  private rafHandle: number | null = null;

  constructor(private readonly registry: UIBridgeRegistry) {}

  /**
   * Start tracking `element` under `id`. If the id is already tracked, the
   * previous tracker is torn down first (covers mid-mount node swaps).
   */
  track(id: string, element: HTMLElement): void {
    this.untrack(id);

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.measure(id)) : null;
    observer?.observe(element);

    this.tracked.set(id, { id, element, resizeObserver: observer });
    this.ensureGlobalListeners();

    // Initial measurement — fire synchronously so the first snapshot after
    // register already has a bbox. Subsequent measurements are rAF-debounced.
    this.measure(id);
  }

  /** Stop tracking `id`. Safe to call with an unknown id. */
  untrack(id: string): void {
    const entry = this.tracked.get(id);
    if (!entry) return;
    entry.resizeObserver?.disconnect();
    this.tracked.delete(id);

    if (this.tracked.size === 0) {
      this.teardownGlobalListeners();
    }
  }

  /** Tear everything down (e.g. on provider unmount). */
  clear(): void {
    for (const entry of this.tracked.values()) {
      entry.resizeObserver?.disconnect();
    }
    this.tracked.clear();
    this.teardownGlobalListeners();
  }

  /**
   * Measure a single element and push the result into the registry. Writes
   * `undefined` if the element is detached from the document.
   */
  private measure(id: string): void {
    const entry = this.tracked.get(id);
    if (!entry) return;

    if (!entry.element.isConnected) {
      this.registry.updateElementBbox(id, undefined, undefined);
      return;
    }

    const rect = entry.element.getBoundingClientRect();
    const bbox = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
    const visible = rect.width > 0 && rect.height > 0;
    this.registry.updateElementBbox(id, bbox, visible);
  }

  /** rAF-debounced measurement of every tracked element. */
  private measureAllScheduled(): void {
    if (this.rafHandle !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      // SSR or pathological environment — do it synchronously.
      this.measureAll();
      return;
    }
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.measureAll();
    });
  }

  private measureAll(): void {
    for (const id of this.tracked.keys()) {
      this.measure(id);
    }
  }

  private ensureGlobalListeners(): void {
    if (typeof window === 'undefined') return;
    if (this.scrollListener) return;

    const handler = () => this.measureAllScheduled();
    this.scrollListener = handler;
    this.resizeListener = handler;

    // `scroll` in capture phase catches scrolls on any ancestor container,
    // not just the document. Passive because we never preventDefault.
    window.addEventListener('scroll', handler, { capture: true, passive: true });
    window.addEventListener('resize', handler, { passive: true });
  }

  private teardownGlobalListeners(): void {
    if (typeof window === 'undefined') return;
    if (!this.scrollListener) return;

    window.removeEventListener('scroll', this.scrollListener, true);
    window.removeEventListener('resize', this.resizeListener!);
    this.scrollListener = null;
    this.resizeListener = null;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }
}

/**
 * One shared tracker group per registry instance. Most apps have a single
 * registry so there's a single group for the whole process.
 */
const groups = new WeakMap<UIBridgeRegistry, BboxTrackerGroup>();

function getGroup(registry: UIBridgeRegistry): BboxTrackerGroup {
  let group = groups.get(registry);
  if (!group) {
    group = new BboxTrackerGroup(registry);
    groups.set(registry, group);
  }
  return group;
}

/**
 * Start tracking `element` under `id` in the given registry. Returns an
 * untrack function.
 */
export function trackElementBbox(
  registry: UIBridgeRegistry,
  id: string,
  element: HTMLElement
): () => void {
  const group = getGroup(registry);
  group.track(id, element);
  return () => group.untrack(id);
}

/**
 * Poll the DOM for an element tagged with `[data-ui-bridge-id="<id>"]` a few
 * times after mount. Resolves with the element, or `null` if not found
 * within the budget.
 *
 * Used by `useUIElement` as a fallback when the consumer doesn't (or can't)
 * attach the returned ref — e.g. portals, headless/context components that
 * compose multiple underlying elements, or SDKs that stamp the attribute
 * directly via `data-*` spreads.
 */
export function pollForTaggedElement(
  id: string,
  attempts = 3,
  intervalMs = 100
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const selector = `[${UI_BRIDGE_ID_ATTR}="${cssEscape(id)}"]`;
    let remaining = attempts;

    const tick = () => {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) {
        resolve(el);
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        resolve(null);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * CSS.escape fallback — some JSDOM versions don't ship it. Good enough for
 * the subset of characters IDs realistically contain.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}
