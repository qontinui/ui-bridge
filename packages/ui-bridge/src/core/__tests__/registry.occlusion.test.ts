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
});
