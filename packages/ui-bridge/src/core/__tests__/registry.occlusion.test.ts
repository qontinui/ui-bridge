/**
 * Occlusion and clip reporting on `ElementState` (computed in
 * core/element-state.ts, driven here through `UIBridgeRegistry`).
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
import { buildVisibilityReport } from '../../server/visibility-report';

interface Box {
  el: HTMLElement;
  rect: { x: number; y: number; w: number; h: number };
  /** Later in this array = painted on top. */
}

let boxes: Box[] = [];
const realElementFromPoint = document.elementFromPoint;

function place(id: string, x: number, y: number, w: number, h: number, text = ''): HTMLElement {
  return placeIn(document.body, id, x, y, w, h, { text });
}

/**
 * `place` under an explicit parent. `hittable: false` keeps the element out of
 * the stubbed `elementFromPoint`, which is how a CLIPPED region is modelled: a
 * browser never returns the clipped element there, it returns whatever paints
 * beneath it. `style` sets inline longhands, which jsdom's `getComputedStyle`
 * reflects.
 */
function placeIn(
  parent: HTMLElement,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { text?: string; hittable?: boolean; style?: Record<string, string> } = {}
): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-ui-bridge-id', id);
  if (opts.text) el.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.style ?? {})) el.style.setProperty(k, v);
  parent.appendChild(el);
  el.getBoundingClientRect = () =>
    ({
      x,
      y,
      width: w,
      height: h,
      top: y,
      left: x,
      right: x + w,
      bottom: y + h,
      toJSON: () => ({}),
    }) as DOMRect;
  if (opts.hittable !== false) boxes.push({ el, rect: { x, y, w, h } });
  return el;
}

/**
 * jsdom returns 0 for every client/offset metric, so a clipper's padding box
 * has to be stated. `offsetWidth` matches the stubbed rect width, so the
 * clipper reads as untransformed and the padding box (not the border box) is
 * what clips.
 */
function paddingBox(
  el: HTMLElement,
  m: { width: number; height: number; clientLeft?: number; clientTop?: number }
): void {
  const define = (k: string, v: number) =>
    Object.defineProperty(el, k, { value: v, configurable: true });
  const border = { left: m.clientLeft ?? 0, top: m.clientTop ?? 0 };
  define('clientLeft', border.left);
  define('clientTop', border.top);
  define('clientWidth', m.width - 2 * border.left);
  define('clientHeight', m.height - 2 * border.top);
  define('offsetWidth', el.getBoundingClientRect().width);
  define('offsetHeight', el.getBoundingClientRect().height);
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
    clippedPct?: number;
    clipScrollable?: boolean;
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

/**
 * Clipping by an ancestor's `overflow` is its own reason, not occlusion.
 *
 * The hit-test used to blame whatever `elementFromPoint` returned at a point
 * the element's own scroller had cut off — the bottom-pinned footer under a
 * scrolled sidebar nav, the page content past a `truncate` parent — and the
 * sweep then reported "footer occludes Gates". Nothing covered those elements.
 * Each case below is the production shape (finding 13a6c6ab) or a
 * containing-block rule that decides whether an ancestor clips at all.
 */
describe('ElementState clip reporting', () => {
  /** The sidebar scroller: visible box y 143-623, 256 wide. */
  function sidebar(): HTMLElement {
    const nav = placeIn(document.body, 'sidebar-nav', 0, 143, 256, 480, {
      style: { 'overflow-y': 'auto', 'overflow-x': 'visible' },
    });
    paddingBox(nav, { width: 256, height: 480 });
    return nav;
  }

  it('(a) a nav item scrolled below its scroller reads clipped and blames no footer', () => {
    const registry = new UIBridgeRegistry();
    const nav = sidebar();
    const item = placeIn(nav, 'button-gates-12', 0, 640, 256, 40, { text: 'Gates' });
    // The bottom-pinned runner-status footer is what elementFromPoint returns
    // under the clipped item.
    place('runner-status-footer', 0, 630, 256, 90);
    registry.registerElement('button-gates-12', item, { type: 'button' });

    const st = stateOf(registry, 'button-gates-12');
    expect(st.visible).toBe(false);
    expect(st.visibilityReason).toBe('clipped');
    expect(st.occludedBy).toBeUndefined();
    expect(st.occludedPct).toBeUndefined();
    expect(st.clippedPct).toBe(100);
    // A user reaches it by scrolling the nav.
    expect(st.clipScrollable).toBe(true);
  });

  it('(b) text cut off by an overflow:hidden parent is partly clipped, still visible, blames nothing', () => {
    const registry = new UIBridgeRegistry();
    // The `truncate` parent's padding box ends at x=150 — 75% of the span.
    const parent = placeIn(document.body, 'truncate-parent', 0, 0, 150, 20, {
      style: { 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
    });
    paddingBox(parent, { width: 150, height: 20 });
    const span = placeIn(parent, 'not-confirmed', 0, 0, 200, 20, {
      text: '· not confirmed on this machine',
    });
    // Main content paints past the parent's edge.
    place('main-content', 150, 0, 400, 100);
    registry.registerElement('not-confirmed', span, { type: 'generic' });

    const st = stateOf(registry, 'not-confirmed');
    expect(st.visible).toBe(true);
    expect(st.visibilityReason).toBeUndefined();
    // Three columns of samples; the 0.94 column (x=188) is past x=150.
    expect(st.clippedPct).toBe(33);
    expect(st.occludedBy).toBeUndefined();
    // `hidden` is not scrollable: the user cannot reveal the rest.
    expect(st.clipScrollable).toBe(false);
  });

  it('(c) a real overlay inside the clip box still reads occluded and names it', () => {
    const registry = new UIBridgeRegistry();
    const scroller = placeIn(document.body, 'scroller', 0, 0, 400, 400, {
      style: { 'overflow-y': 'auto', 'overflow-x': 'auto' },
    });
    paddingBox(scroller, { width: 400, height: 400 });
    const label = placeIn(scroller, 'label', 0, 0, 100, 20, { text: 'important' });
    place('cover', 0, 0, 400, 400);
    registry.registerElement('label', label, { type: 'generic' });

    const st = stateOf(registry, 'label');
    expect(st.visible).toBe(false);
    expect(st.visibilityReason).toBe('occluded');
    expect(st.occludedBy).toBe('cover');
    expect(st.occludedPct).toBe(100);
    expect(st.clippedPct).toBeUndefined();
  });

  it('(d) a position:fixed element under a scroller is not clipped by it', () => {
    const registry = new UIBridgeRegistry();
    const nav = sidebar();
    const fixed = placeIn(nav, 'fixed-toast', 0, 640, 256, 40, {
      text: 'Saved',
      style: { position: 'fixed' },
    });
    // Something genuinely paints over it, so the clip box is consulted.
    place('cover', 0, 630, 256, 90);
    registry.registerElement('fixed-toast', fixed, { type: 'generic' });

    const st = stateOf(registry, 'fixed-toast');
    // Its containing block is the viewport: the scroller cannot clip it, so
    // the cover really does cover it.
    expect(st.visibilityReason).toBe('occluded');
    expect(st.occludedBy).toBe('cover');
    expect(st.clippedPct).toBeUndefined();
  });

  it('(e) the report lists clipped elements in clipped[], not occlusions[], and reads clear', () => {
    const registry = new UIBridgeRegistry();
    const nav = sidebar();
    const item = placeIn(nav, 'button-gates-12', 0, 640, 256, 40, { text: 'Gates' });
    place('runner-status-footer', 0, 630, 256, 90);
    const parent = placeIn(document.body, 'truncate-parent', 300, 0, 150, 20, {
      style: { 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
    });
    paddingBox(parent, { width: 150, height: 20 });
    const span = placeIn(parent, 'not-confirmed', 300, 0, 200, 20, {
      text: '· not confirmed on this machine',
    });
    place('main-content', 450, 0, 400, 100);
    registry.registerElement('button-gates-12', item, { type: 'button' });
    registry.registerElement('not-confirmed', span, { type: 'generic' });

    // The in-page handler's projection (server/handlers.ts).
    const report = buildVisibilityReport({
      elements: registry.getAllElements().map((el) => {
        const s = el.getState() as ReturnType<typeof el.getState> & {
          clippedPct?: number;
          clipScrollable?: boolean;
        };
        return {
          id: el.id,
          label: el.label,
          occludedBy: s.occludedBy,
          occludedPct: s.occludedPct,
          clippedPct: s.clippedPct,
          clipScrollable: s.clipScrollable,
          textContent: s.textContent,
        };
      }),
    });

    expect(report.occlusions).toEqual([]);
    expect(report.verdict).toBe('clear');
    expect(report.clipped).toEqual([
      expect.objectContaining({ element: 'button-gates-12', ratio: 1, scrollReachable: true }),
      expect.objectContaining({ element: 'not-confirmed', ratio: 0.33, scrollReachable: false }),
    ]);
  });

  /**
   * (f)/(g): an `absolute` child escapes every ancestor between it and its
   * containing block — the nearest positioned ancestor. Whether the scroller
   * clips it depends on whether the scroller IS that block.
   */
  function absoluteUnder(scrollerStyle: Record<string, string>): HTMLElement {
    const grandparent = place('app-shell', 0, 0, 1280, 720);
    grandparent.style.setProperty('position', 'relative');
    const scroller = placeIn(grandparent, 'scroller', 0, 0, 200, 200, {
      style: { 'overflow-x': 'auto', 'overflow-y': 'auto', ...scrollerStyle },
    });
    paddingBox(scroller, { width: 200, height: 200 });
    // Laid out outside the scroller's box. Not hittable: where it is clipped
    // the browser returns what paints beneath — the app shell, its ancestor.
    return placeIn(scroller, 'popover', 300, 300, 100, 20, {
      text: 'popover',
      hittable: false,
      style: { position: 'absolute' },
    });
  }

  it('(f) an absolute child of a non-positioned scroller escapes it', () => {
    const registry = new UIBridgeRegistry();
    const child = absoluteUnder({});
    place('cover', 300, 300, 100, 20);
    registry.registerElement('popover', child, { type: 'generic' });

    const st = stateOf(registry, 'popover');
    // Its containing block is the unclipped `relative` grandparent, so the
    // scroller does not clip it and the cover really is on top of it.
    expect(st.visibilityReason).toBe('occluded');
    expect(st.occludedBy).toBe('cover');
    expect(st.clippedPct).toBeUndefined();
  });

  it('(g) the same child under a position:relative overflow:hidden scroller is clipped', () => {
    const registry = new UIBridgeRegistry();
    const child = absoluteUnder({
      position: 'relative',
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
    });
    registry.registerElement('popover', child, { type: 'generic' });

    const st = stateOf(registry, 'popover');
    expect(st.visible).toBe(false);
    expect(st.visibilityReason).toBe('clipped');
    expect(st.clippedPct).toBe(100);
    expect(st.clipScrollable).toBe(false);
    expect(st.occludedBy).toBeUndefined();
  });

  it('(h) a fully clipped element whose clipped points return its own ancestor is not visible', () => {
    // An ANCESTOR hit counted as "our own box is transparent here", so an
    // element entirely outside its clipper — whose clipped points return the
    // app shell around it — read `visible: true`.
    const registry = new UIBridgeRegistry();
    const shell = place('app-shell', 0, 0, 1280, 720);
    const clipper = placeIn(shell, 'clipper', 0, 0, 300, 100, {
      style: { 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
    });
    paddingBox(clipper, { width: 300, height: 100 });
    const lost = placeIn(clipper, 'lost', 0, 200, 300, 40, { text: 'lost', hittable: false });
    registry.registerElement('lost', lost, { type: 'generic' });

    const st = stateOf(registry, 'lost');
    expect(st.visible).toBe(false);
    expect(st.visibilityReason).toBe('clipped');
    expect(st.clippedPct).toBe(100);
    expect(st.occludedBy).toBeUndefined();
  });

  it('(i) a partly clipped, partly covered element computes occludedPct over the in-clip points', () => {
    // 3 of 9 samples are past the clipper's edge; the other 6 are covered.
    // occludedPct is covered / inClip (6/6), not covered / sampled (6/9).
    const registry = new UIBridgeRegistry();
    const parent = placeIn(document.body, 'truncate-parent', 0, 0, 150, 20, {
      style: { 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
    });
    paddingBox(parent, { width: 150, height: 20 });
    const span = placeIn(parent, 'half', 0, 0, 200, 20, { text: 'half clipped, half covered' });
    place('main-content', 150, 0, 400, 100);
    place('cover', 0, 0, 150, 20);
    registry.registerElement('half', span, { type: 'generic' });

    const st = stateOf(registry, 'half');
    expect(st.visible).toBe(false);
    expect(st.visibilityReason).toBe('occluded');
    expect(st.occludedBy).toBe('cover');
    expect(st.occludedPct).toBe(100);
    expect(st.clippedPct).toBe(33);
  });

  it('(j) an inline overflow:hidden ancestor clips nothing — overflow does not apply to it', () => {
    // Whatever client box the inline link reports (here a narrow one that the
    // icon sits outside), its display alone decides: overflow does not apply.
    const registry = new UIBridgeRegistry();
    const link = placeIn(document.body, 'inline-link', 100, 100, 200, 20, {
      style: { display: 'inline', 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
    });
    paddingBox(link, { width: 40, height: 20 });
    const icon = placeIn(link, 'icon', 150, 100, 20, 20, { hittable: false });
    registry.registerElement('icon', icon, { type: 'generic' });

    const st = stateOf(registry, 'icon');
    // Its centre returns the parent link: an ancestor hit, so visible.
    expect(st.visible).toBe(true);
    expect(st.visibilityReason).toBeUndefined();
    expect(st.clippedPct).toBeUndefined();
  });

  it('(k) a block box whose client area is 0×0 clips everything inside it', () => {
    // A scroller whose client area is all scrollbar (or a bordered empty box):
    // a genuine empty clip, not "no clip".
    const registry = new UIBridgeRegistry();
    const tiny = placeIn(document.body, 'all-scrollbar', 100, 100, 30, 30, {
      style: { 'overflow-x': 'auto', 'overflow-y': 'auto' },
    });
    paddingBox(tiny, { width: 0, height: 0 });
    const inner = placeIn(tiny, 'inner', 100, 100, 30, 30, { hittable: false });
    place('under', 0, 0, 400, 400);
    registry.registerElement('inner', inner, { type: 'generic' });

    const st = stateOf(registry, 'inner');
    expect(st.visibilityReason).toBe('clipped');
    expect(st.clippedPct).toBe(100);
    expect(st.occludedBy).toBeUndefined();
  });

  it('(l) a clipper transformed on one axis only clips at its bounding rect', () => {
    // scaleY(0.5): width unchanged, height halved. The untransformed padding
    // box (height 200) would leave the item inside; the painted box (100) does not.
    const registry = new UIBridgeRegistry();
    const scroller = placeIn(document.body, 'squashed', 0, 0, 300, 100, {
      style: { 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
    });
    paddingBox(scroller, { width: 300, height: 200 });
    Object.defineProperty(scroller, 'offsetHeight', { value: 200, configurable: true });
    const item = placeIn(scroller, 'below-fold', 0, 140, 300, 40, { hittable: false });
    place('under', 0, 100, 300, 200);
    registry.registerElement('below-fold', item, { type: 'generic' });

    const st = stateOf(registry, 'below-fold');
    expect(st.visibilityReason).toBe('clipped');
    expect(st.clippedPct).toBe(100);
  });

  it('(m) a fractional rect beside a snapped offsetWidth is not read as a transform', () => {
    // Chrome snaps offsetWidth from the box edges: rect 100.7 wide, offsetWidth
    // 100. Read as untransformed, the 5px border is excluded, so a sliver
    // between the padding edge (x=95) and the border edge is clipped.
    const registry = new UIBridgeRegistry();
    const card = placeIn(document.body, 'fractional', 0, 0, 100.7, 100, {
      style: { 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
    });
    paddingBox(card, { width: 100, height: 100, clientLeft: 5, clientTop: 5 });
    Object.defineProperty(card, 'offsetWidth', { value: 100, configurable: true });
    const sliver = placeIn(card, 'sliver', 96, 20, 4, 4, { hittable: false });
    registry.registerElement('sliver', sliver, { type: 'generic' });

    const st = stateOf(registry, 'sliver');
    expect(st.visibilityReason).toBe('clipped');
    expect(st.clippedPct).toBe(100);
  });
});
