/**
 * Live Bounding-Box Tracker
 *
 * Watches DOM elements for layout changes (resize, scroll, viewport resize)
 * and pushes fresh viewport-relative bounding boxes into the UI Bridge
 * registry. Used by `useUIElement` and `useAutoRegister` so runner steps can
 * target SDK-registered elements by DOM coordinates and skip VLM pixel
 * grounding.
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
 * - **Lazy mode for auto-registered elements.** The `useAutoRegister`
 *   scanner may tag hundreds of elements on a single page (every row in a
 *   data table, every nav item in a sidebar). Eager tracking — one
 *   `ResizeObserver` per element forever — does not scale past a few
 *   hundred. In lazy mode we keep a single shared `IntersectionObserver`
 *   per group; only elements currently intersecting the viewport get an
 *   active `ResizeObserver`. Active observers stay bounded by visible
 *   element count regardless of total DOM size. Off-screen lazy elements
 *   retain their last-known bbox in the registry (so snapshot queries
 *   still see a value), and the runner's click resolution already checks
 *   `visible` before using it — so a stale off-screen bbox can't cause a
 *   wrong click, it just fails the visibility gate.
 */

import type { UIBridgeRegistry } from '../core/registry';

/** Marker attribute the hook stamps on elements for fallback resolution. */
export const UI_BRIDGE_ID_ATTR = 'data-ui-bridge-id';

interface Tracked {
  /** Registered element ID. */
  id: string;
  /** DOM node being observed. */
  element: HTMLElement;
  /** Per-element ResizeObserver. In eager mode, created once on track().
   *  In lazy mode, created when the element enters the viewport and torn
   *  down when it leaves. */
  resizeObserver: ResizeObserver | null;
  /** True when the consumer opted into lazy viewport-gated tracking. */
  lazy: boolean;
  /** True when the element is currently intersecting the viewport. Always
   *  true for eager trackers; set by the shared IntersectionObserver for
   *  lazy trackers. */
  inViewport: boolean;
}

/**
 * Internal: bucket of trackers keyed by element id, plus one set of shared
 * observers (window scroll/resize + IntersectionObserver) that fan out to
 * every tracker in this registry.
 */
class BboxTrackerGroup {
  private tracked = new Map<string, Tracked>();
  /** Reverse lookup so IntersectionObserver callbacks can find the tracker
   *  for a given DOM element in O(1). */
  private byElement = new WeakMap<Element, Tracked>();
  private scrollListener: (() => void) | null = null;
  private resizeListener: (() => void) | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private rafHandle: number | null = null;

  constructor(private readonly registry: UIBridgeRegistry) {}

  /**
   * Start tracking `element` under `id`. If the id is already tracked, the
   * previous tracker is torn down first (covers mid-mount node swaps).
   *
   * @param lazy When true, defer ResizeObserver creation until the element
   *             enters the viewport; tear it down when it leaves. Use for
   *             scanner-registered elements where total count may exceed
   *             what eager tracking can afford.
   */
  track(id: string, element: HTMLElement, lazy = false): void {
    this.untrack(id);

    const entry: Tracked = {
      id,
      element,
      resizeObserver: null,
      lazy,
      // Eager trackers behave as if always in viewport. Lazy trackers flip
      // to true once the IntersectionObserver reports them as intersecting.
      inViewport: !lazy,
    };
    this.tracked.set(id, entry);
    this.byElement.set(element, entry);
    this.ensureGlobalListeners();

    if (lazy) {
      this.ensureIntersectionObserver();
      if (this.intersectionObserver) {
        this.intersectionObserver.observe(element);
        // Initial measurement is deferred to the first IntersectionObserver
        // callback (fires on the next microtask for elements that start in
        // the viewport). We do NOT measure synchronously here — doing so
        // would force layout on every auto-registered element at mount
        // time, which is exactly the cost lazy mode exists to avoid.
      } else {
        // No IntersectionObserver available (SSR, bare JSDOM). Fall back
        // to eager tracking so consumers never end up with trackers that
        // silently never measure. This is strictly worse-perf than real
        // lazy mode, but correct: every tracker produces a bbox.
        entry.inViewport = true;
        this.attachResizeObserver(entry);
        this.measure(id);
      }
    } else {
      // Eager: attach ResizeObserver immediately and take an initial
      // measurement so the first snapshot after register already has a
      // bbox. Subsequent measurements are rAF-debounced via shared
      // scroll/resize listeners.
      this.attachResizeObserver(entry);
      this.measure(id);
    }
  }

  /** Stop tracking `id`. Safe to call with an unknown id. */
  untrack(id: string): void {
    const entry = this.tracked.get(id);
    if (!entry) return;

    entry.resizeObserver?.disconnect();
    this.intersectionObserver?.unobserve(entry.element);
    this.byElement.delete(entry.element);
    this.tracked.delete(id);

    if (this.tracked.size === 0) {
      this.teardownGlobalListeners();
      this.teardownIntersectionObserver();
    }
  }

  /** Tear everything down (e.g. on provider unmount). */
  clear(): void {
    for (const entry of this.tracked.values()) {
      entry.resizeObserver?.disconnect();
    }
    this.tracked.clear();
    this.byElement = new WeakMap();
    this.teardownGlobalListeners();
    this.teardownIntersectionObserver();
  }

  /** Attach a ResizeObserver to the tracked element. No-op in SSR. */
  private attachResizeObserver(entry: Tracked): void {
    if (entry.resizeObserver) return;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => this.measure(entry.id));
    observer.observe(entry.element);
    entry.resizeObserver = observer;
  }

  /** Detach the ResizeObserver for a tracked element (lazy-mode eviction). */
  private detachResizeObserver(entry: Tracked): void {
    if (!entry.resizeObserver) return;
    entry.resizeObserver.disconnect();
    entry.resizeObserver = null;
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
    for (const entry of this.tracked.values()) {
      // Skip off-screen lazy trackers — their ResizeObserver is detached
      // and their last-known bbox in the registry is fine. The next
      // viewport entry will re-measure.
      if (entry.lazy && !entry.inViewport) continue;
      this.measure(entry.id);
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

  private ensureIntersectionObserver(): void {
    if (this.intersectionObserver) return;
    if (typeof IntersectionObserver === 'undefined') {
      // SSR or JSDOM without polyfill — fall back to treating lazy
      // trackers as always-in-viewport so they still produce bboxes,
      // just without the viewport gating. Attach resize observers and
      // take an initial measurement on next scroll/resize.
      return;
    }

    this.intersectionObserver = new IntersectionObserver(
      (entries) => this.handleIntersections(entries),
      // threshold: 0 = fire when any part of the element enters or leaves
      // the viewport. rootMargin stays at default (0px) — no point
      // pre-attaching observers before the element is actually visible.
      { threshold: 0 }
    );
  }

  private teardownIntersectionObserver(): void {
    if (!this.intersectionObserver) return;
    this.intersectionObserver.disconnect();
    this.intersectionObserver = null;
  }

  private handleIntersections(entries: IntersectionObserverEntry[]): void {
    for (const io of entries) {
      const entry = this.byElement.get(io.target);
      if (!entry) continue;

      const wasInViewport = entry.inViewport;
      entry.inViewport = io.isIntersecting;

      if (io.isIntersecting && !wasInViewport) {
        // Entered viewport: attach ResizeObserver and take an initial
        // measurement so the registry bbox reflects the current layout
        // as soon as the element becomes visible.
        this.attachResizeObserver(entry);
        this.measure(entry.id);
      } else if (!io.isIntersecting && wasInViewport) {
        // Left viewport: tear down the ResizeObserver to cap active
        // observer count at visible-element count. The last-known bbox
        // stays in the registry — runner's click resolution checks
        // `visible` (and viewport intersection implicitly) via the same
        // snapshot read, so a stale off-screen bbox can't cause a wrong
        // click; it just fails the visibility gate.
        this.detachResizeObserver(entry);
      }
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

/** Options for {@link trackElementBbox}. */
export interface TrackElementBboxOptions {
  /**
   * When true, defer ResizeObserver attachment until the element enters the
   * viewport. Only active elements pay the observer cost, so this scales to
   * thousands of registered elements (large tables, long lists, etc.).
   * Use for scanner-registered (`origin: 'auto'`) elements.
   *
   * Defaults to false. Hook-registered (`useUIElement`) elements stay eager
   * because they're usually few, always-interesting, and expected to report
   * a bbox immediately after mount.
   */
  lazy?: boolean;
}

/**
 * Start tracking `element` under `id` in the given registry. Returns an
 * untrack function.
 */
export function trackElementBbox(
  registry: UIBridgeRegistry,
  id: string,
  element: HTMLElement,
  options: TrackElementBboxOptions = {}
): () => void {
  const group = getGroup(registry);
  group.track(id, element, options.lazy ?? false);
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
