/**
 * bbox-tracker tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { trackElementBbox, pollForTaggedElement, UI_BRIDGE_ID_ATTR } from './bbox-tracker';

describe('trackElementBbox', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('pushes an initial bbox into the registry synchronously', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    // JSDOM getBoundingClientRect returns 0s by default — good enough to
    // prove the path fires; we just care that bbox/visible are populated.
    const untrack = trackElementBbox(registry, 'btn', el);

    const entry = registry.getElement('btn')!;
    expect(entry.bbox).toBeDefined();
    expect(entry.bbox!.x).toBe(0);
    expect(entry.bbox!.y).toBe(0);
    // zero-size rect ⇒ visible false
    expect(entry.visible).toBe(false);

    untrack();
  });

  it('returns an untrack function that disconnects cleanup', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    const untrack = trackElementBbox(registry, 'btn', el);
    expect(typeof untrack).toBe('function');
    // Should not throw.
    untrack();
    untrack();
  });

  it('clears bbox when tracked element detaches from the document', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    const untrack = trackElementBbox(registry, 'btn', el);
    expect(registry.getElement('btn')!.bbox).toBeDefined();

    // Detach the element. Re-measure by tearing down + re-tracking —
    // production path relies on ResizeObserver / scroll listener fires
    // which jsdom doesn't simulate, but the detach-safety branch can be
    // verified by re-tracking: since the node isn't connected, it writes
    // undefined.
    container.removeChild(el);
    untrack();
    trackElementBbox(registry, 'btn', el);

    const entry = registry.getElement('btn')!;
    expect(entry.bbox).toBeUndefined();
    expect(entry.visible).toBeUndefined();
  });
});

describe('trackElementBbox lazy mode', () => {
  let registry: UIBridgeRegistry;
  let container: HTMLDivElement;
  let observedElements: Element[];
  let intersectionCallback:
    | ((entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void)
    | null;

  // Mock IntersectionObserver so we can drive viewport entry/exit
  // deterministically. JSDOM doesn't ship one out of the box, and even if
  // it did we wouldn't want its scheduling here.
  class MockIntersectionObserver {
    constructor(
      cb: (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void
    ) {
      intersectionCallback = cb;
    }
    observe = vi.fn((el: Element) => {
      observedElements.push(el);
    });
    unobserve = vi.fn((el: Element) => {
      const idx = observedElements.indexOf(el);
      if (idx >= 0) observedElements.splice(idx, 1);
    });
    disconnect = vi.fn(() => {
      observedElements.length = 0;
      intersectionCallback = null;
    });
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = '';
    thresholds: ReadonlyArray<number> = [0];
  }

  function fireIntersection(el: Element, isIntersecting: boolean): void {
    if (!intersectionCallback) return;
    const entry = {
      target: el,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: el.getBoundingClientRect(),
      intersectionRect: el.getBoundingClientRect(),
      rootBounds: null,
      time: Date.now(),
    } as IntersectionObserverEntry;
    intersectionCallback([entry], {} as IntersectionObserver);
  }

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    observedElements = [];
    intersectionCallback = null;
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.unstubAllGlobals();
  });

  it('does not measure synchronously — bbox absent until viewport entry', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    trackElementBbox(registry, 'btn', el, { lazy: true });

    // Before any IntersectionObserver callback fires, the registry entry
    // must not have a bbox — that's the cost lazy mode exists to avoid.
    expect(registry.getElement('btn')!.bbox).toBeUndefined();
    expect(registry.getElement('btn')!.visible).toBeUndefined();
    // The element should be observed by the IntersectionObserver.
    expect(observedElements).toContain(el);
  });

  it('measures on viewport entry and clears resize observer on exit', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    trackElementBbox(registry, 'btn', el, { lazy: true });
    expect(registry.getElement('btn')!.bbox).toBeUndefined();

    // Enter viewport — measurement happens.
    fireIntersection(el, true);
    expect(registry.getElement('btn')!.bbox).toBeDefined();

    // Leave viewport — ResizeObserver is detached, but the last-known
    // bbox stays in the registry so snapshot queries keep returning it
    // (the runner's visibility check will still gate clicks).
    fireIntersection(el, false);
    expect(registry.getElement('btn')!.bbox).toBeDefined();
  });

  it('untrack unobserves from IntersectionObserver', () => {
    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    const untrack = trackElementBbox(registry, 'btn', el, { lazy: true });
    expect(observedElements).toContain(el);

    untrack();
    expect(observedElements).not.toContain(el);
  });

  it('handles many lazy trackers without attaching ResizeObserver for off-screen ones', () => {
    // Simulated scenario: 100 auto-registered elements, only 5 in viewport.
    // After track + selective IO entries, only the 5 visible ones should
    // have received measurement writes.
    const elements: HTMLButtonElement[] = [];
    for (let i = 0; i < 100; i++) {
      const el = document.createElement('button');
      el.textContent = `btn-${i}`;
      container.appendChild(el);
      registry.registerElement(`btn-${i}`, el);
      trackElementBbox(registry, `btn-${i}`, el, { lazy: true });
      elements.push(el);
    }

    // None measured yet (no IO callbacks fired).
    for (let i = 0; i < 100; i++) {
      expect(registry.getElement(`btn-${i}`)!.bbox).toBeUndefined();
    }

    // Fire intersection for 5 elements.
    for (let i = 0; i < 5; i++) {
      fireIntersection(elements[i], true);
    }

    // Those 5 should now have bboxes; the other 95 should still be
    // unmeasured.
    for (let i = 0; i < 5; i++) {
      expect(registry.getElement(`btn-${i}`)!.bbox).toBeDefined();
    }
    for (let i = 5; i < 100; i++) {
      expect(registry.getElement(`btn-${i}`)!.bbox).toBeUndefined();
    }
  });

  it('falls back to eager measurement when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    const el = document.createElement('button');
    container.appendChild(el);
    registry.registerElement('btn', el);

    trackElementBbox(registry, 'btn', el, { lazy: true });

    // Without IO, the tracker must still produce a bbox — correctness
    // takes precedence over the perf optimization.
    expect(registry.getElement('btn')!.bbox).toBeDefined();
  });
});

describe('pollForTaggedElement', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('finds an element already in the DOM', async () => {
    const el = document.createElement('div');
    el.setAttribute(UI_BRIDGE_ID_ATTR, 'my-id');
    container.appendChild(el);

    const found = await pollForTaggedElement('my-id', 1, 10);
    expect(found).toBe(el);
  });

  it('resolves with null when the element never appears', async () => {
    const found = await pollForTaggedElement('missing', 2, 5);
    expect(found).toBeNull();
  });

  it('finds an element that appears after mount', async () => {
    const promise = pollForTaggedElement('late', 5, 20);
    setTimeout(() => {
      const el = document.createElement('div');
      el.setAttribute(UI_BRIDGE_ID_ATTR, 'late');
      container.appendChild(el);
    }, 30);

    const found = await promise;
    expect(found?.getAttribute(UI_BRIDGE_ID_ATTR)).toBe('late');
  });

  it('escapes ids that contain CSS-selector-sensitive characters', async () => {
    const el = document.createElement('div');
    el.setAttribute(UI_BRIDGE_ID_ATTR, 'weird.id:with/chars');
    container.appendChild(el);

    const found = await pollForTaggedElement('weird.id:with/chars', 1, 10);
    expect(found).toBe(el);
  });
});
