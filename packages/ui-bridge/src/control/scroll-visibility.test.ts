/**
 * `isVisibleInScrollContext` is built on `core/clip-box.ts`, so it honours the
 * containing-block chain: an ancestor's overflow clips only the descendants it
 * actually contains. jsdom has no layout, so rects and client metrics are
 * stubbed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isVisibleInScrollContext } from './scroll-visibility';

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

  it('a position:absolute child of a positioned scroller is clipped by it', () => {
    const child = scrollerWithChild({ position: 'absolute' });
    (child.parentElement as HTMLElement).style.position = 'relative';
    expect(isVisibleInScrollContext(child)).toBe(false);
  });
});
