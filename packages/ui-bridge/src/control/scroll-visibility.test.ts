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

  it('a filtered inline wrapper IS a containing block (filters apply to inline boxes)', () => {
    const child = scrollerWithChild({ position: 'absolute' });
    const scroller = child.parentElement as HTMLElement;
    const wrapper = document.createElement('span');
    wrapper.style.display = 'inline';
    wrapper.style.filter = 'blur(1px)';
    scroller.insertBefore(wrapper, child);
    wrapper.appendChild(child);
    // The wrapper sits inside the scroller, so the scroller clips the child.
    expect(isVisibleInScrollContext(child)).toBe(false);
  });

  it('a display:contents wrapper with a position does not change the mode', () => {
    const child = scrollerWithChild({});
    const scroller = child.parentElement as HTMLElement;
    const wrapper = document.createElement('div');
    wrapper.style.display = 'contents';
    wrapper.style.position = 'fixed';
    scroller.insertBefore(wrapper, child);
    wrapper.appendChild(child);
    // In-flow child: the scroller still clips it.
    expect(isVisibleInScrollContext(child)).toBe(false);
  });

  it('a position:absolute child of a positioned scroller is clipped by it', () => {
    const child = scrollerWithChild({ position: 'absolute' });
    (child.parentElement as HTMLElement).style.position = 'relative';
    expect(isVisibleInScrollContext(child)).toBe(false);
  });
});

describe('isVisibleInScrollContext — only a scrollable cut needs a scroll', () => {
  it('a child bleeding 1px over an overflow:hidden card is already as visible as it gets', () => {
    const card = document.createElement('div');
    card.style.overflowX = 'hidden';
    card.style.overflowY = 'hidden';
    document.body.appendChild(card);
    rect(card, 100, 100, 300, 200);
    const child = document.createElement('div');
    card.appendChild(child);
    // -m-px: one pixel past every edge of the card's padding box.
    rect(child, 99, 99, 302, 40);
    expect(isVisibleInScrollContext(child)).toBe(true);
  });

  it('the same child of an overflow:auto scroller still needs a scroll', () => {
    const scroller = document.createElement('div');
    scroller.style.overflowX = 'auto';
    scroller.style.overflowY = 'auto';
    document.body.appendChild(scroller);
    rect(scroller, 100, 100, 300, 200);
    const child = document.createElement('div');
    scroller.appendChild(child);
    rect(child, 100, 280, 300, 40);
    // Content runs past the box, so there is scroll range toward the cut.
    Object.defineProperty(scroller, 'scrollHeight', { value: 400, configurable: true });
    expect(isVisibleInScrollContext(child)).toBe(false);
  });

  it('a half-cut child of an overflow:hidden container with scroll range still needs a scroll', () => {
    // `hidden` is a scroll container: scrollIntoView and script scroll it.
    const box = document.createElement('div');
    box.style.overflowX = 'hidden';
    box.style.overflowY = 'hidden';
    document.body.appendChild(box);
    rect(box, 100, 100, 300, 200);
    Object.defineProperty(box, 'scrollHeight', { value: 400, configurable: true });
    const child = document.createElement('div');
    box.appendChild(child);
    rect(child, 100, 280, 300, 40);
    expect(isVisibleInScrollContext(child)).toBe(false);
  });

  it('the same half-cut child under overflow:clip is already as visible as it gets', () => {
    const box = document.createElement('div');
    box.style.overflowX = 'clip';
    box.style.overflowY = 'clip';
    document.body.appendChild(box);
    rect(box, 100, 100, 300, 200);
    Object.defineProperty(box, 'scrollHeight', { value: 400, configurable: true });
    const child = document.createElement('div');
    box.appendChild(child);
    rect(child, 100, 280, 300, 40);
    expect(isVisibleInScrollContext(child)).toBe(true);
  });

  it('a propagating <body> is ignored, and a non-propagating one clips', () => {
    const child = document.createElement('div');
    document.body.appendChild(child);
    rect(document.body, 0, 0, 400, 300);
    document.body.style.overflowY = 'auto';
    rect(child, 0, 350, 100, 40);
    // <html> overflow visible: <body>'s overflow belongs to the viewport.
    expect(isVisibleInScrollContext(child)).toBe(true);
    document.documentElement.style.overflowY = 'hidden';
    try {
      expect(isVisibleInScrollContext(child)).toBe(false);
    } finally {
      document.documentElement.style.overflowY = '';
      document.body.style.overflowY = '';
    }
  });
});

describe('isVisibleInScrollContext — the scroll range, in every direction', () => {
  function hiddenBox(opts: { rtl?: boolean; scrollTop?: number; scrollLeft?: number }) {
    const box = document.createElement('div');
    box.style.overflowX = 'hidden';
    box.style.overflowY = 'hidden';
    if (opts.rtl) box.style.direction = 'rtl';
    document.body.appendChild(box);
    rect(box, 108, 100, 200, 200);
    for (const [k, v] of [
      ['scrollHeight', 400],
      ['scrollWidth', 400],
      ['scrollTop', opts.scrollTop ?? 0],
      ['scrollLeft', opts.scrollLeft ?? 0],
    ] as const) {
      Object.defineProperty(box, k, { value: v, configurable: true });
    }
    const child = document.createElement('div');
    box.appendChild(child);
    return { box, child };
  }

  it('a child cut at the top of a container scrolled down can be scrolled back into view', () => {
    const { child } = hiddenBox({ scrollTop: 120 });
    rect(child, 108, 80, 200, 40);
    expect(isVisibleInScrollContext(child)).toBe(false);
  });

  it('the same child at scrollTop 0 has nothing above to scroll to', () => {
    const { child } = hiddenBox({ scrollTop: 0 });
    rect(child, 108, 80, 200, 40);
    expect(isVisibleInScrollContext(child)).toBe(true);
  });

  it('RTL: a child cut at the left (start) side at scrollLeft 0 can still be scrolled into view', () => {
    // RTL scrollLeft runs [-extent, 0]; at 0 there is range to the left.
    const { child } = hiddenBox({ rtl: true, scrollLeft: 0 });
    rect(child, 58, 150, 100, 20);
    expect(isVisibleInScrollContext(child)).toBe(false);
  });

  it('RTL: a child bleeding past the right edge at scrollLeft 0 is as visible as it gets', () => {
    const { child } = hiddenBox({ rtl: true, scrollLeft: 0 });
    rect(child, 250, 150, 100, 20);
    expect(isVisibleInScrollContext(child)).toBe(true);
  });

  it('will-change: scroll-position is not will-change: position', () => {
    const child = scrollerWithChild({ position: 'absolute' });
    (child.parentElement as HTMLElement).style.willChange = 'scroll-position';
    // Still not a containing block: the absolute child escapes the scroller.
    expect(isVisibleInScrollContext(child)).toBe(true);
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
