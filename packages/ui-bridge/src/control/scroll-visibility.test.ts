/**
 * `isVisibleInScrollContext` is built on `core/clip-box.ts`, so it honours the
 * containing-block chain: an ancestor's overflow clips only the descendants it
 * actually contains. jsdom has no layout, so rects and client metrics are
 * stubbed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isVisibleInScrollContext, scrollIntoViewVerified } from './scroll-visibility';

function rect(el: HTMLElement, x: number, y: number, w: number, h: number): void {
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
  for (const [k, v] of [
    ['offsetWidth', w],
    ['offsetHeight', h],
    ['clientWidth', w],
    ['clientHeight', h],
  ] as const) {
    Object.defineProperty(el, k, { value: v, configurable: true });
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
});

function scrollerWithChild(childStyle: Record<string, string>): HTMLElement {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  document.body.appendChild(scroller);
  rect(scroller, 0, 100, 300, 200);
  const child = document.createElement('div');
  for (const [k, v] of Object.entries(childStyle)) child.style.setProperty(k, v);
  scroller.appendChild(child);
  // Below the scroller's padding box, inside the viewport.
  rect(child, 0, 400, 300, 40);
  return child;
}

describe('isVisibleInScrollContext — the containing-block chain', () => {
  it('an in-flow child outside its scroller is not visible', () => {
    expect(isVisibleInScrollContext(scrollerWithChild({}))).toBe(false);
  });

  it('a position:fixed child escapes the scroller and is visible', () => {
    expect(isVisibleInScrollContext(scrollerWithChild({ position: 'fixed' }))).toBe(true);
  });

  it('a position:absolute child escapes a non-positioned scroller', () => {
    expect(isVisibleInScrollContext(scrollerWithChild({ position: 'absolute' }))).toBe(true);
  });

  it('a transformed display:contents wrapper is not a containing block', () => {
    const child = scrollerWithChild({ position: 'absolute' });
    const scroller = child.parentElement as HTMLElement;
    const wrapper = document.createElement('div');
    wrapper.style.display = 'contents';
    wrapper.style.transform = 'translateX(0)';
    scroller.insertBefore(wrapper, child);
    wrapper.appendChild(child);
    // No box, no containing block: the child still escapes the scroller.
    expect(isVisibleInScrollContext(child)).toBe(true);
  });

  it('a position:absolute child of a positioned scroller is clipped by it', () => {
    const child = scrollerWithChild({ position: 'absolute' });
    (child.parentElement as HTMLElement).style.position = 'relative';
    expect(isVisibleInScrollContext(child)).toBe(false);
  });
});

describe('isVisibleInScrollContext — overflow that clips nothing', () => {
  it('a child at the edge of a non-overflowing overflow:hidden card is visible', () => {
    const card = document.createElement('div');
    card.style.overflowX = 'hidden';
    card.style.overflowY = 'hidden';
    document.body.appendChild(card);
    rect(card, 0, 0, 300, 200);
    const child = document.createElement('div');
    card.appendChild(child);
    // Flush with the card's bottom-right corner, inside its padding box.
    rect(child, 200, 160, 100, 40);
    expect(isVisibleInScrollContext(child)).toBe(true);
  });

  it('an inline overflow:hidden parent does not make its child invisible', () => {
    const link = document.createElement('a');
    link.style.display = 'inline';
    link.style.overflowX = 'hidden';
    link.style.overflowY = 'hidden';
    document.body.appendChild(link);
    rect(link, 100, 100, 200, 20);
    // Even a reported client box the icon sits outside is ignored: overflow
    // does not apply to an inline box.
    Object.defineProperty(link, 'clientWidth', { value: 40, configurable: true });
    const icon = document.createElement('b');
    link.appendChild(icon);
    rect(icon, 150, 100, 20, 20);
    expect(isVisibleInScrollContext(icon)).toBe(true);
  });
});

describe('scrollIntoViewVerified — the action path reads the same chain', () => {
  it('does not scroll a position:fixed child its scroller does not clip', async () => {
    const child = scrollerWithChild({ position: 'fixed' });
    let scrolled = false;
    child.scrollIntoView = () => {
      scrolled = true;
    };
    const result = await scrollIntoViewVerified(child, { smooth: false });
    expect(result).toEqual({ alreadyVisible: true, scrolled: false, visible: true });
    expect(scrolled).toBe(false);
  });
});
