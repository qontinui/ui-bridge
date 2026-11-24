/**
 * The inspector does not report its own target occluded by its own panel —
 * plan `2026-11-23-ui-bridge-element-state-collapse-follow-ups`, D3.
 *
 * The info panel is a fixed box (bottom-right, z-index 999998, pointer events
 * on), so the canonical, occlusion-aware `visible` counted it as an occluder:
 * an element under the panel read "Visible: No" because of the inspector. The
 * panel now reads the state with its own root at `pointer-events: none`, so a
 * target under the panel alone is visible, and a target under another overlay
 * is still reported, with that overlay named.
 *
 * jsdom has neither layout nor `elementFromPoint`; both are stubbed as in
 * `core/element-state.parity.test.ts`, with one addition the test depends on:
 * like a browser's hit-test, the stub SKIPS a box with `pointer-events: none`
 * on itself or an ancestor. Without that the panel toggle would change nothing
 * and the first test could not pass.
 *
 * The panel root is laid out from the moment React creates it (a prototype
 * `getBoundingClientRect` for any `INSPECTOR_PANEL_ATTR` element) and paints
 * above the page and below its own children. While it shows its "Reading
 * state" placeholder it is a short strip along the bottom of its final box, so
 * a reading taken then cannot see a target under the full panel.
 *
 * `requestAnimationFrame` is stubbed with a queue the tests flush by hand, so
 * every re-read (which the panel coalesces through one frame) is deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { InfoPanel, readInspectorState } from './inspector';
import { INSPECTOR_PANEL_ATTR } from '../core/inspector-panel';

interface Box {
  el: HTMLElement;
  rect: { x: number; y: number; w: number; h: number };
}

/** Later in this array = painted on top. */
let boxes: Box[] = [];
const realElementFromPoint = document.elementFromPoint;
const realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
/** Where every inspector panel root is laid out, when set. */
let panelRect: Box['rect'] | null = null;

function domRect({ x, y, w, h }: Box['rect']): DOMRect {
  return {
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
  } as DOMRect;
}

/** How many times each stubbed element's box was read — one per state read. */
const rectReads = new Map<HTMLElement, number>();

/** True when `el` or an ancestor is `display: none` (so it has no box, as in a browser). */
function inDisplayNone(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.style.display === 'none') return true;
  }
  return false;
}

function stubRect(el: HTMLElement, x: number, y: number, w: number, h: number): void {
  el.getBoundingClientRect = () => {
    rectReads.set(el, (rectReads.get(el) ?? 0) + 1);
    return domRect(inDisplayNone(el) ? { x: 0, y: 0, w: 0, h: 0 } : { x, y, w, h });
  };
  boxes.push({ el, rect: { x, y, w, h } });
}

function place(id: string, x: number, y: number, w: number, h: number): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.textContent = id;
  document.body.appendChild(el);
  stubRect(el, x, y, w, h);
  return el;
}

function hitTestable(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (window.getComputedStyle(n).pointerEvents === 'none') return false;
  }
  return true;
}

/** The text of the value span that follows the `<key>` label span. */
function field(container: HTMLElement, key: string): string | undefined {
  const label = Array.from(container.querySelectorAll('span')).find(
    (s) => s.textContent === `${key}:`
  );
  return label?.nextElementSibling?.textContent ?? undefined;
}

/** Queued animation-frame callbacks; the panel coalesces every re-read through one. */
let frames: Array<{ id: number; cb: FrameRequestCallback }> = [];

/** Run every queued frame (and any a frame queues), inside `act`. */
function flushFrames(): void {
  act(() => {
    for (let round = 0; frames.length > 0 && round < 10; round++) {
      for (const { cb } of frames.splice(0)) cb(0);
    }
  });
}

/** Let MutationObserver callbacks (microtasks) run, inside `act`. */
async function flushMutations(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Where a panel root is laid out: its final box, or a strip while it shows the placeholder. */
function panelBox(panel: HTMLElement): Box['rect'] {
  const full = panelRect!;
  if (!(panel.textContent ?? '').includes('Reading state')) return full;
  return { x: full.x, y: full.y + full.h - 40, w: full.w, h: 40 };
}

/** Lay every inspector panel root out at (`x`, `y`), render the panel for `target`, flush its frames. */
function renderPanelOver(target: HTMLElement, x: number, y: number) {
  panelRect = { x, y, w: 400, h: 300 };
  const result = render(<InfoPanel element={target} onClose={() => {}} />);
  flushFrames();
  return result;
}

beforeEach(() => {
  document.body.innerHTML = '';
  boxes = [];
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  panelRect = null;
  frames = [];
  let nextFrame = 1;
  const raf = (cb: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.push({ id, cb });
    return id;
  };
  const caf = (id: number) => {
    frames = frames.filter((frame) => frame.id !== id);
  };
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = caf;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (panelRect && this.hasAttribute(INSPECTOR_PANEL_ATTR)) return domRect(panelBox(this));
    return realGetBoundingClientRect.call(this);
  };
  document.elementFromPoint = ((px: number, py: number) => {
    // Paint order, bottom to top: the page, the panel roots, the panels' children.
    const inPanel = (b: Box) => b.el.closest(`[${INSPECTOR_PANEL_ATTR}]`) !== null;
    const panels: Box[] = panelRect
      ? Array.from(document.querySelectorAll<HTMLElement>(`[${INSPECTOR_PANEL_ATTR}]`)).map(
          (el) => ({ el, rect: panelBox(el) })
        )
      : [];
    const painted = [...boxes.filter((b) => !inPanel(b)), ...panels, ...boxes.filter(inPanel)];
    for (let i = painted.length - 1; i >= 0; i--) {
      const { el, rect } = painted[i];
      if (!el.isConnected || !hitTestable(el)) continue;
      if (px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h) {
        return el;
      }
    }
    return null;
  }) as typeof document.elementFromPoint;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  frames = [];
  rectReads.clear();
  document.elementFromPoint = realElementFromPoint;
  HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
  panelRect = null;
  document.body.innerHTML = '';
});

describe('InfoPanel — its own panel is not an occluder', () => {
  it('a target fully under the inspector panel does not read Visible No because of the panel', () => {
    const target = place('target', 900, 500, 80, 24);
    const { container } = renderPanelOver(target, 860, 400);

    expect(field(container, 'Visible')).toBe('Yes');
    expect(container.textContent).toContain('(covered by inspector panel)');
    expect(field(container, 'Occluded by')).toBe('-');
    // The panel's own pointer events are restored after the read.
    const panel = container.querySelector<HTMLElement>(`[${INSPECTOR_PANEL_ATTR}]`)!;
    expect(panel.style.pointerEvents).toBe('');
  });

  it('a target under another overlay still reads Visible No, naming that overlay', () => {
    const target = place('target', 900, 500, 80, 24);
    place('overlay', 880, 480, 200, 100);
    // The panel covers the target too: the verdict must still name the overlay.
    const { container } = renderPanelOver(target, 860, 400);

    expect(field(container, 'Visible')).toBe('No');
    expect(field(container, 'Visibility reason')).toBe('occluded');
    expect(field(container, 'Occluded by')).toBe('div#overlay (100%)');
  });

  it('a target clear of everything reads Visible Yes with no panel note', () => {
    const target = place('target', 10, 10, 80, 24);
    const { container } = renderPanelOver(target, 860, 400);

    expect(field(container, 'Visible')).toBe('Yes');
    expect(container.textContent).not.toContain('covered by inspector panel');
    expect(field(container, 'Visibility reason')).toBe('-');
  });
});

describe('InfoPanel — the reading follows the page', () => {
  it('re-reads on resize, so an overlay that arrives later is reported', () => {
    const target = place('target', 900, 500, 80, 24);
    const { container } = renderPanelOver(target, 860, 400);
    expect(field(container, 'Visible')).toBe('Yes');

    place('late-overlay', 880, 480, 200, 100);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    flushFrames();
    expect(field(container, 'Visible')).toBe('No');
    expect(field(container, 'Occluded by')).toBe('div#late-overlay (100%)');
  });
});

describe('InfoPanel — the first reading is taken against the full panel', () => {
  it('the placeholder read misses the target; the re-read after the sections render covers it', () => {
    const target = place('target', 900, 500, 80, 24);
    panelRect = { x: 860, y: 400, w: 400, h: 300 };
    const { container } = render(<InfoPanel element={target} onClose={() => {}} />);
    // Read at commit against the placeholder strip (y 660-700): no panel overlap yet.
    expect(container.textContent).not.toContain('covered by inspector panel');

    flushFrames();
    expect(field(container, 'Visible')).toBe('Yes');
    expect(container.textContent).toContain('(covered by inspector panel)');
  });
});

describe('InfoPanel — re-reads are coalesced', () => {
  it('a burst of scroll and resize events schedules one frame', () => {
    const target = place('target', 10, 10, 80, 24);
    renderPanelOver(target, 860, 400);
    expect(frames).toHaveLength(0);
    act(() => {
      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'));
      for (let i = 0; i < 3; i++) document.body.dispatchEvent(new Event('scroll'));
    });
    expect(frames).toHaveLength(1);
  });
});

describe('InfoPanel — the reading follows the selected element', () => {
  function placeInput(): HTMLInputElement {
    const input = document.createElement('input');
    input.id = 'name';
    input.value = 'before';
    document.body.appendChild(input);
    stubRect(input, 10, 10, 120, 24);
    return input;
  }

  it('a typed value updates the panel without scrolling', () => {
    const input = placeInput();
    const { container } = renderPanelOver(input, 860, 400);
    expect(field(container, 'Value')).toBe('"before"');

    input.value = 'after';
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    flushFrames();
    expect(field(container, 'Value')).toBe('"after"');
  });

  it('a disabled attribute updates the panel without scrolling', async () => {
    const input = placeInput();
    const { container } = renderPanelOver(input, 860, 400);
    expect(field(container, 'Enabled')).toBe('Yes');

    input.setAttribute('disabled', '');
    await flushMutations();
    flushFrames();
    expect(field(container, 'Enabled')).toBe('No');
  });

  it('with the body selected, the panel toggle and in-panel DOM writes schedule no re-read', async () => {
    const other = place('other', 10, 10, 80, 24);
    // Selecting the body puts the panel inside the observed subtree.
    renderPanelOver(document.body, 860, 400);
    await flushMutations();
    flushFrames();
    await flushMutations();
    expect(frames).toHaveLength(0);
    // A read of an element outside the panel toggles the panel root; nothing
    // outside the panel changes.
    readInspectorState(other);
    const panel = document.querySelector<HTMLElement>(`[${INSPECTOR_PANEL_ATTR}]`)!;
    expect(panel).not.toBeNull();
    await flushMutations();
    expect(frames).toHaveLength(0);
    // The panel's own content changing (as a re-render writes it) is not a
    // change of the selected element either, so it cannot feed a re-read.
    panel.querySelector('span')!.textContent = 'UI Bridge Inspector (re-rendered)';
    await flushMutations();
    expect(frames).toHaveLength(0);
    // A real page change inside the body still is.
    other.setAttribute('title', 'changed');
    await flushMutations();
    expect(frames).toHaveLength(1);
  });
});

describe('InfoPanel — the reading follows the page without a scroll', () => {
  it('an ancestor set to display none turns Visible to No', async () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const target = document.createElement('div');
    target.id = 'target';
    wrapper.appendChild(target);
    stubRect(target, 10, 10, 80, 24);
    const { container } = renderPanelOver(target, 860, 400);
    expect(field(container, 'Visible')).toBe('Yes');

    wrapper.style.display = 'none';
    await flushMutations();
    flushFrames();
    expect(field(container, 'Visible')).toBe('No');
    expect(field(container, 'Visibility reason')).toBe('no-layout');
  });

  it('an overlay inserted over the target is reported as its occluder', async () => {
    const target = place('target', 10, 10, 80, 24);
    const { container } = renderPanelOver(target, 860, 400);
    expect(field(container, 'Visible')).toBe('Yes');

    place('modal', 0, 0, 300, 200);
    await flushMutations();
    flushFrames();
    expect(field(container, 'Visible')).toBe('No');
    expect(field(container, 'Occluded by')).toBe('div#modal (100%)');
  });

  it('a programmatic value set shows after the next re-render', () => {
    const input = document.createElement('input');
    input.id = 'name';
    input.value = 'before';
    document.body.appendChild(input);
    stubRect(input, 10, 10, 120, 24);
    const noop = () => {};
    const { container, rerender } = renderPanelOver(input, 860, 400);
    expect(field(container, 'Value')).toBe('"before"');

    // No event and no mutation: only a re-render (a hover, say) can notice it.
    input.value = 'programmatic';
    rerender(<InfoPanel element={input} onClose={noop} />);
    flushFrames();
    expect(field(container, 'Value')).toBe('"programmatic"');
  });
});

describe('InfoPanel — an animated element does not re-read forever', () => {
  it('stops scheduling frames once the displayed fields stop changing', () => {
    const target = place('pulsing', 10, 10, 80, 24);
    // A CSS animation: the computed opacity is different on every read, and it
    // writes nothing to the DOM, so no observer sees it.
    const realGetComputedStyle = window.getComputedStyle;
    let tick = 0;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = realGetComputedStyle.call(window, el, pseudo);
      if (el !== target) return style;
      return new Proxy(style, {
        get(obj, key) {
          if (key === 'opacity') return String(0.5 + (tick++ % 40) / 100);
          const value = Reflect.get(obj, key, obj);
          return typeof value === 'function' ? value.bind(obj) : value;
        },
      });
    });
    renderPanelOver(target, 860, 400);
    // A hover re-render, then a scroll: each re-reads once and then settles.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    flushFrames();
    expect(tick).toBeGreaterThan(2);
    expect(frames).toHaveLength(0);
  });
});

describe('InfoPanel — teardown', () => {
  it('switching the selected element while a frame is pending cancels it and reads the new one', () => {
    const first = place('first', 10, 10, 80, 24);
    const second = place('second', 10, 60, 80, 24);
    const noop = () => {};
    const { container, rerender } = renderPanelOver(first, 860, 400);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(frames).toHaveLength(1);
    const pendingId = frames[0].id;

    rerender(<InfoPanel element={second} onClose={noop} />);
    // The old frame is gone and a frame for the new element is queued.
    expect(frames.map((f) => f.id)).not.toContain(pendingId);
    expect(frames).toHaveLength(1);
    const firstReads = rectReads.get(first);
    const secondReads = rectReads.get(second) ?? 0;

    flushFrames();
    expect(rectReads.get(first)).toBe(firstReads);
    expect(rectReads.get(second)).toBeGreaterThan(secondReads);
    expect(field(container, 'Position')).toBe('(10, 60)');
  });

  it('unmounting with a frame pending stores nothing and throws nothing', () => {
    const target = place('target', 10, 10, 80, 24);
    const { unmount } = renderPanelOver(target, 860, 400);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(frames).toHaveLength(1);
    const readsBefore = rectReads.get(target);

    unmount();
    expect(frames).toHaveLength(0);
    expect(() => flushFrames()).not.toThrow();
    expect(rectReads.get(target)).toBe(readsBefore);
  });

  it('after the selection moves, the old element no longer triggers a re-read', async () => {
    const first = document.createElement('input');
    first.id = 'first';
    document.body.appendChild(first);
    stubRect(first, 10, 10, 120, 24);
    const second = place('second', 10, 60, 120, 24);
    const noop = () => {};
    const { rerender } = renderPanelOver(first, 860, 400);
    rerender(<InfoPanel element={second} onClose={noop} />);
    flushFrames();
    await flushMutations();
    flushFrames();
    expect(frames).toHaveLength(0);

    act(() => {
      first.dispatchEvent(new Event('input', { bubbles: true }));
    });
    first.setAttribute('title', 'changed');
    await flushMutations();
    expect(frames).toHaveLength(0);
  });

  it('after unmount, page mutations queue nothing', async () => {
    const target = place('target', 10, 10, 80, 24);
    const { unmount } = renderPanelOver(target, 860, 400);
    unmount();
    expect(frames).toHaveLength(0);

    document.body.appendChild(document.createElement('div'));
    target.className = 'moved';
    await flushMutations();
    expect(frames).toHaveLength(0);
  });
});

describe('InfoPanel — an element inside the panel', () => {
  it('a panel child is read as it is, not occluded and not covered by inspector panel', () => {
    const target = place('outside', 10, 10, 80, 24);
    // Page content painted BELOW the panel, where the child sits. Hiding the
    // child's own panel from the hit-test would hand its points to this.
    place('underlay', 850, 450, 300, 200);
    const noop = () => {};
    const { container, rerender } = renderPanelOver(target, 860, 400);
    const panel = container.querySelector<HTMLElement>(`[${INSPECTOR_PANEL_ATTR}]`)!;
    // A child of the panel, painted above the panel root as a real child is.
    const child = document.createElement('span');
    child.id = 'panel-child';
    panel.appendChild(child);
    stubRect(child, 900, 500, 80, 24);

    const reading = readInspectorState(child);
    expect(reading.state.visible).toBe(true);
    expect(reading.state.visibilityReason).toBeUndefined();
    expect(reading.coveredByPanel).toBe(false);

    rerender(<InfoPanel element={child} onClose={noop} />);
    expect(field(container, 'Visible')).toBe('Yes');
    expect(container.textContent).not.toContain('covered by inspector panel');
  });
});

describe('readInspectorState — restores the panel root inline pointer-events exactly', () => {
  function panelRoot(inline: string | null, priority: '' | 'important'): HTMLElement {
    const panel = document.createElement('div');
    panel.setAttribute(INSPECTOR_PANEL_ATTR, '');
    if (inline !== null) panel.style.setProperty('pointer-events', inline, priority);
    document.body.appendChild(panel);
    stubRect(panel, 860, 400, 400, 300);
    return panel;
  }

  it('restores an inline value without important', () => {
    const panel = panelRoot('auto', '');
    const target = place('target', 900, 500, 80, 24);
    expect(readInspectorState(target).state.visible).toBe(true);
    expect(panel.style.getPropertyValue('pointer-events')).toBe('auto');
    expect(panel.style.getPropertyPriority('pointer-events')).toBe('');
  });

  it('restores an inline value with important', () => {
    const panel = panelRoot('visiblepainted', 'important');
    const target = place('target', 900, 500, 80, 24);
    expect(readInspectorState(target).state.visible).toBe(true);
    expect(panel.style.getPropertyValue('pointer-events')).toBe('visiblepainted');
    expect(panel.style.getPropertyPriority('pointer-events')).toBe('important');
  });

  it('restores the inline value and surfaces the error when the read throws', () => {
    const panel = panelRoot('auto', 'important');
    const target = place('target', 900, 500, 80, 24);
    // The plain read succeeds; the panel-free read (panel at pointer-events: none) throws.
    target.getBoundingClientRect = () => {
      if (panel.style.getPropertyValue('pointer-events') === 'none') throw new Error('layout gone');
      return domRect({ x: 900, y: 500, w: 80, h: 24 });
    };
    expect(() => readInspectorState(target)).toThrow('layout gone');
    expect(panel.style.getPropertyValue('pointer-events')).toBe('auto');
    expect(panel.style.getPropertyPriority('pointer-events')).toBe('important');
  });

  it('removes the property again when there was no inline value', () => {
    const panel = panelRoot(null, '');
    const target = place('target', 900, 500, 80, 24);
    expect(readInspectorState(target).state.visible).toBe(true);
    expect(panel.style.getPropertyValue('pointer-events')).toBe('');
    expect(panel.getAttribute('style') ?? '').not.toContain('pointer-events');
  });
});
