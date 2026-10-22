/**
 * Occlusion reporting on `ElementState` (core/registry.ts).
 *
 * The hit-test that detects "another element is painting over this one" has
 * always existed here, but it sampled ONE point (the element's centre) and
 * DISCARDED the identity of whatever it hit. Two consequences, both of which
 * these tests pin against regression:
 *
 *   1. Partial occlusion was invisible. A widget clipping the end of a wide
 *      label leaves the centre clear, so `visible` came back `true` and the
 *      element reported as perfectly fine while a human could not read its
 *      name. This is the shape of the defect that motivated the work.
 *   2. Full occlusion was detected but unattributable — `visible: false` with
 *      no way to learn WHAT was on top, which is the half that makes it
 *      fixable.
 *
 * jsdom implements neither layout nor `elementFromPoint`, so both are stubbed:
 * `getBoundingClientRect` per element, and a `document.elementFromPoint` that
 * resolves a point against the stubbed rects honouring paint order.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../registry';

interface Box {
  el: HTMLElement;
  rect: { x: number; y: number; w: number; h: number };
  /** Later in this array = painted on top. */
}

let boxes: Box[] = [];
const realElementFromPoint = document.elementFromPoint;

function place(id: string, x: number, y: number, w: number, h: number, text = ''): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-ui-bridge-id', id);
  if (text) el.textContent = text;
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({
      x, y, width: w, height: h,
      top: y, left: x, right: x + w, bottom: y + h,
      toJSON: () => ({}),
    }) as DOMRect;
  boxes.push({ el, rect: { x, y, w, h } });
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  boxes = [];
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  // Topmost (last-placed) box wins the point, mirroring paint order.
  document.elementFromPoint = ((px: number, py: number) => {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const { el, rect } = boxes[i];
      if (px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h) {
        return el;
      }
    }
    return null;
  }) as typeof document.elementFromPoint;
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
});

function stateOf(registry: UIBridgeRegistry, id: string) {
  const found = registry.getAllElements().find((e) => e.id === id);
  if (!found) throw new Error(`element ${id} not registered`);
  return found.getState() as ReturnType<typeof found.getState> & {
    occludedBy?: string;
    occludedPct?: number;
    visibilityReason?: string;
    scrollWidth?: number;
    clientWidth?: number;
  };
}

describe('ElementState occlusion reporting', () => {
  it('reports a corner widget clipping a wide label — the centre-probe blind spot', () => {
    const registry = new UIBridgeRegistry();
    // A 400px-wide header whose centre (x=200) is nowhere near the widget.
    const header = place('zone-header', 0, 0, 400, 20, 'Zone 8: qontinui-web');
    place('minimap', 272, 0, 128, 20);

    registry.registerElement('zone-header', header, { type: 'generic' });

    const st = stateOf(registry, 'zone-header');
    // A single centre probe returns the header itself and concludes "fine".
    // The corner samples are what see the widget.
    expect(st.occludedBy).toBe('minimap');
    expect(st.occludedPct).toBeGreaterThan(0);
    // Partially covered is still on screen — collapsing this into
    // `visible: false` would break every consumer filtering on `visible`.
    expect(st.visible).toBe(true);
  });

  it('names the occluder when an element is fully covered', () => {
    const registry = new UIBridgeRegistry();
    const label = place('label', 0, 0, 100, 20, 'important');
    place('cover', 0, 0, 400, 400);
    registry.registerElement('label', label, { type: 'generic' });

    const st = stateOf(registry, 'label');
    expect(st.visible).toBe(false);
    expect(st.visibilityReason).toBe('occluded');
    expect(st.occludedBy).toBe('cover');
    expect(st.occludedPct).toBe(100);
  });

  it('does not blame anything when nothing overlaps', () => {
    const registry = new UIBridgeRegistry();
    const a = place('a', 0, 0, 100, 20, 'hello');
    place('b', 500, 500, 100, 20);
    registry.registerElement('a', a, { type: 'generic' });

    const st = stateOf(registry, 'a');
    expect(st.visible).toBe(true);
    expect(st.occludedBy).toBeUndefined();
  });

  it('distinguishes off-screen from occluded', () => {
    // `visible: false` folded six causes together; a consumer could not tell
    // "scrolled away" from "a widget is on top of it" — opposite bugs.
    const registry = new UIBridgeRegistry();
    const off = place('off', -400, 0, 100, 20, 'drawer');
    registry.registerElement('off', off, { type: 'generic' });

    const st = stateOf(registry, 'off');
    expect(st.visible).toBe(false);
    expect(st.visibilityReason).toBe('off-screen');
    expect(st.occludedBy).toBeUndefined();
  });

  it('carries scrollWidth/clientWidth for every element, not just scroll containers', () => {
    // A `truncate`d label is overflow:hidden with no scrollbar, so it never
    // qualified as a scroll container and its overflow went unrecorded
    // anywhere — which is why horizontal truncation was undetectable.
    const registry = new UIBridgeRegistry();
    const label = place('narrow', 0, 0, 80, 20, 'qontinui-web-frontend');
    Object.defineProperty(label, 'scrollWidth', { value: 160, configurable: true });
    Object.defineProperty(label, 'clientWidth', { value: 80, configurable: true });
    registry.registerElement('narrow', label, { type: 'generic' });

    const st = stateOf(registry, 'narrow');
    expect(st.scrollWidth).toBe(160);
    expect(st.clientWidth).toBe(80);
  });

  it('probes only the centre for small elements — the hot-path guard', () => {
    // `getElementState` recomputes live on every `getState()`, and callers
    // iterate the whole registry, so nine probes unconditionally would be a
    // 9x multiplier on every snapshot. A 24x24 icon gains nothing from
    // perimeter samples: an overlay covering part of it covers essentially
    // all of it.
    const registry = new UIBridgeRegistry();
    const icon = place('icon', 0, 0, 24, 24, 'x');
    registry.registerElement('icon', icon, { type: 'generic' });

    let probes = 0;
    const inner = document.elementFromPoint;
    document.elementFromPoint = ((x: number, y: number) => {
      probes++;
      return inner.call(document, x, y);
    }) as typeof document.elementFromPoint;

    stateOf(registry, 'icon');
    document.elementFromPoint = inner;
    expect(probes).toBe(1);
  });

  it('probes the full perimeter for a wide element', () => {
    const registry = new UIBridgeRegistry();
    const header = place('wide', 0, 0, 400, 20, 'a wide label');
    registry.registerElement('wide', header, { type: 'generic' });

    let probes = 0;
    const inner = document.elementFromPoint;
    document.elementFromPoint = ((x: number, y: number) => {
      probes++;
      return inner.call(document, x, y);
    }) as typeof document.elementFromPoint;

    stateOf(registry, 'wide');
    document.elementFromPoint = inner;
    // Wide on one axis is enough — that is exactly the label-clipped-at-the-
    // end case, where height is small and width is not.
    expect(probes).toBe(9);
  });

});

/** Count `elementFromPoint` calls made while reading `id`'s state. */
function probesFor(registry: UIBridgeRegistry, id: string): number {
  let probes = 0;
  const inner = document.elementFromPoint;
  document.elementFromPoint = ((x: number, y: number) => {
    probes++;
    return inner.call(document, x, y);
  }) as typeof document.elementFromPoint;
  try {
    stateOf(registry, id);
  } finally {
    document.elementFromPoint = inner;
  }
  return probes;
}

describe('paintsText registration option', () => {
  it('surfaces paintsText: true on the state when registered with it', () => {
    const registry = new UIBridgeRegistry();
    const term = place('terminal-surface-a', 0, 0, 600, 400);
    registry.registerElement('terminal-surface-a', term, { type: 'canvas', paintsText: true });

    expect(stateOf(registry, 'terminal-surface-a').paintsText).toBe(true);
    expect(registry.getElement('terminal-surface-a')?.paintsText).toBe(true);
  });

  it('leaves paintsText absent for an ordinary registration', () => {
    const registry = new UIBridgeRegistry();
    const label = place('plain', 0, 0, 200, 20, 'text');
    registry.registerElement('plain', label, { type: 'generic' });

    const st = stateOf(registry, 'plain');
    expect('paintsText' in st).toBe(false);
    expect(registry.getElement('plain')?.paintsText).toBeUndefined();
  });

  it('treats a registered <canvas> as implicitly paintsText, unless told otherwise', () => {
    const registry = new UIBridgeRegistry();
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    registry.registerElement('chart', canvas, { type: 'canvas' });
    expect(registry.getElement('chart')?.paintsText).toBe(true);
    expect(stateOf(registry, 'chart').paintsText).toBe(true);

    const decorative = document.createElement('canvas');
    document.body.appendChild(decorative);
    registry.registerElement('bg', decorative, { type: 'canvas', paintsText: false });
    expect(registry.getElement('bg')?.paintsText).toBeUndefined();
  });

  it('samples a paintsText element on the dense grid: 1 + 8x8 + two 8-point edge rows', () => {
    const registry = new UIBridgeRegistry();
    const term = place('term', 0, 0, 600, 400);
    registry.registerElement('term', term, { type: 'canvas', paintsText: true });
    expect(probesFor(registry, 'term')).toBe(1 + 64 + 16);
  });

  it('sees a thin strip over the bottom edge of a tall paintsText surface; the nine-point grid does not', () => {
    // The nine-point grid probes at 94% of 700px = y 658, leaving the last
    // 42px unprobed, so a 16px status strip at y 684..700 is invisible to it.
    // The dense grid's bottom edge row sits min(8px, 2%) = 8px in, at y 692.
    const registry = new UIBridgeRegistry();
    const term = place('term', 0, 0, 600, 700);
    const plain = place('plain', 700, 0, 500, 700);
    place('strip', 0, 684, 1280, 16);
    registry.registerElement('term', term, { type: 'canvas', paintsText: true });
    registry.registerElement('plain', plain, { type: 'generic' });

    expect(stateOf(registry, 'term').occludedBy).toBe('strip');
    expect(stateOf(registry, 'plain').occludedBy).toBeUndefined();
  });

  it('counts a hit on a descendant canvas layer as the surface itself', () => {
    const registry = new UIBridgeRegistry();
    const term = place('term', 0, 0, 600, 400);
    const layer = document.createElement('canvas');
    layer.className = 'xterm-link-layer';
    term.appendChild(layer);
    // The layer covers the whole surface and is painted on top of it.
    boxes.push({ el: layer, rect: { x: 0, y: 0, w: 600, h: 400 } });
    registry.registerElement('term', term, { type: 'canvas', paintsText: true });

    const st = stateOf(registry, 'term');
    expect(st.occludedBy).toBeUndefined();
    expect(st.visible).toBe(true);
  });
});

describe('collapsed disclosure is hidden, not occluded', () => {
  /** A closed <details> holding `child`, with a canvas-like box painted under the child. */
  function closedDetailsWithChild(): { details: HTMLDetailsElement; child: HTMLElement } {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'counts';
    details.appendChild(summary);
    document.body.appendChild(details);
    const child = document.createElement('div');
    child.textContent = 'dead: 0';
    details.appendChild(child);
    child.getBoundingClientRect = () =>
      ({
        x: 0, y: 0, width: 200, height: 40,
        top: 0, left: 0, right: 200, bottom: 40,
        toJSON: () => ({}),
      }) as DOMRect;
    // What the measured run blamed: the terminal link layer beneath it.
    place('canvas-under', 0, 0, 400, 400);
    return { details, child };
  }

  type WithCheckVisibility = { checkVisibility?: unknown };
  let savedCheckVisibility: PropertyDescriptor | undefined;
  beforeEach(() => {
    savedCheckVisibility = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'checkVisibility');
  });
  afterEach(() => {
    if (savedCheckVisibility) {
      Object.defineProperty(HTMLElement.prototype, 'checkVisibility', savedCheckVisibility);
    } else {
      delete (HTMLElement.prototype as WithCheckVisibility).checkVisibility;
    }
  });
  const stubCheckVisibility = (answer: boolean): void => {
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
      value: () => answer,
      configurable: true,
      writable: true,
    });
  };

  it('reports a closed <details> child as hidden with no occluder (checkVisibility absent)', () => {
    delete (HTMLElement.prototype as WithCheckVisibility).checkVisibility;
    const registry = new UIBridgeRegistry();
    const { child } = closedDetailsWithChild();
    registry.registerElement('code-block', child, { type: 'generic' });

    const st = stateOf(registry, 'code-block');
    expect(st.visible).toBe(false);
    expect(st.visibilityReason).toBe('hidden');
    expect(st.occludedBy).toBeUndefined();
  });

  it('walks the ancestors even when checkVisibility exists and answers true', () => {
    stubCheckVisibility(true);
    const registry = new UIBridgeRegistry();
    const { child } = closedDetailsWithChild();
    registry.registerElement('code-block', child, { type: 'generic' });

    const st = stateOf(registry, 'code-block');
    expect(st.visibilityReason).toBe('hidden');
    expect(st.occludedBy).toBeUndefined();
  });

  it('honours checkVisibility answering false outside any <details>', () => {
    stubCheckVisibility(false);
    const registry = new UIBridgeRegistry();
    const label = place('cv-hidden', 0, 0, 200, 20, 'text');
    place('over', 0, 0, 400, 400);
    registry.registerElement('cv-hidden', label, { type: 'generic' });

    const st = stateOf(registry, 'cv-hidden');
    expect(st.visibilityReason).toBe('hidden');
    expect(st.occludedBy).toBeUndefined();
  });

  it('hit-tests the child again once the <details> is opened', () => {
    delete (HTMLElement.prototype as WithCheckVisibility).checkVisibility;
    const registry = new UIBridgeRegistry();
    const { details, child } = closedDetailsWithChild();
    registry.registerElement('code-block', child, { type: 'generic' });
    details.setAttribute('open', '');

    const st = stateOf(registry, 'code-block');
    expect(st.visibilityReason).toBe('occluded');
    expect(st.occludedBy).toBe('canvas-under');
  });

  it('does not hide the closed <details> own <summary>', () => {
    delete (HTMLElement.prototype as WithCheckVisibility).checkVisibility;
    const registry = new UIBridgeRegistry();
    const { details } = closedDetailsWithChild();
    const summary = details.querySelector('summary') as HTMLElement;
    summary.getBoundingClientRect = () =>
      ({
        x: 500, y: 500, width: 100, height: 20,
        top: 500, left: 500, right: 600, bottom: 520,
        toJSON: () => ({}),
      }) as DOMRect;
    registry.registerElement('summary', summary, { type: 'generic' });

    const st = stateOf(registry, 'summary');
    expect(st.visible).toBe(true);
    expect(st.visibilityReason).toBeUndefined();
  });
});

describe('registry membership and the data-ui-bridge-id stamp', () => {
  it('stamps data-ui-bridge-id on a directly registered node that has none', () => {
    const registry = new UIBridgeRegistry();
    const div = document.createElement('div');
    document.body.appendChild(div);
    registry.registerElement('direct', div, { type: 'generic' });
    expect(div.getAttribute('data-ui-bridge-id')).toBe('direct');
  });

  it('never overwrites an existing stamp', () => {
    const registry = new UIBridgeRegistry();
    const div = document.createElement('div');
    div.setAttribute('data-ui-bridge-id', 'developer-id');
    document.body.appendChild(div);
    registry.registerElement('other-id', div, { type: 'generic' });
    expect(div.getAttribute('data-ui-bridge-id')).toBe('developer-id');
  });

  it('names a directly registered occluder by its registry id', () => {
    const registry = new UIBridgeRegistry();
    const label = place('label', 0, 0, 100, 20, 'important');
    const card = document.createElement('div');
    card.className = 'error-card';
    document.body.appendChild(card);
    boxes.push({ el: card, rect: { x: 0, y: 0, w: 400, h: 400 } });
    registry.registerElement('label', label, { type: 'generic' });
    registry.registerElement('app-error-card', card, { type: 'generic' });

    expect(stateOf(registry, 'label').occludedBy).toBe('app-error-card');
  });

  it('getRegisteredAncestor resolves by membership, not by the attribute', () => {
    const registry = new UIBridgeRegistry();
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    const leaf = document.createElement('canvas');
    outer.appendChild(inner);
    inner.appendChild(leaf);
    document.body.appendChild(outer);
    registry.registerElement('outer', outer, { type: 'generic' });
    // A stale stamp on an unregistered node is not membership, and a
    // registered node whose stamp was removed is still a member.
    inner.setAttribute('data-ui-bridge-id', 'stale');
    outer.removeAttribute('data-ui-bridge-id');

    expect(registry.getRegisteredAncestor(leaf)?.id).toBe('outer');
    expect(registry.getRegisteredAncestor(outer)?.id).toBe('outer');
    expect(registry.getRegisteredAncestor(document.body)).toBeUndefined();
  });
});
