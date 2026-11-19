/**
 * Test-only: an inner `overflow:auto` container with one child, with jsdom's
 * missing layout modelled. The child's rect is derived from the container's
 * `scrollTop`, so a scroll moves it exactly as a browser would.
 */
import { vi } from 'vitest';

export interface InnerScrollFixture {
  container: HTMLDivElement;
  child: HTMLDivElement;
  /** Remove the fixture from the document. */
  remove(): void;
}

function rectOf(top: number, left: number, height: number, width: number): DOMRect {
  return {
    top,
    left,
    bottom: top + height,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Container: 200px tall at y=100, scrollable (content 1000px). Child: 40px tall,
 * at content offset `childOffset`, so it sits at `100 + childOffset - scrollTop`.
 * `native` decides whether the child's `scrollIntoView` scrolls the container.
 */
export function innerScrollFixture(opts: {
  childOffset: number;
  native: 'scrolls' | 'noop';
  overflow?: 'auto' | 'hidden';
}): InnerScrollFixture {
  const container = document.createElement('div');
  container.style.overflowY = opts.overflow ?? 'auto';
  container.style.overflowX = 'visible';
  const child = document.createElement('div');
  container.appendChild(child);
  document.body.appendChild(container);

  let scrollTop = 0;
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, Math.min(800, v));
    },
  });
  vi.spyOn(container, 'scrollHeight', 'get').mockReturnValue(1000);
  vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(200);
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => rectOf(100, 0, 200, 300));
  vi.spyOn(child, 'getBoundingClientRect').mockImplementation(() =>
    rectOf(100 + opts.childOffset - scrollTop, 0, 40, 300)
  );
  Object.defineProperty(child, 'offsetParent', { configurable: true, get: () => container });
  Object.defineProperty(container, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
  Object.defineProperty(child, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(() => {
      if (opts.native === 'scrolls') scrollTop = Math.max(0, opts.childOffset - 80);
    }),
  });
  return { container, child, remove: () => container.remove() };
}

/**
 * A `scrollBy` for jsdom (which has none) that moves the scroll offsets, as a
 * browser would. A scroll that moves nothing is a NO_SCROLL_EFFECT failure, so a
 * test that only needs a successful scroll installs this instead of a no-op.
 */
export function movingScrollBy(this: Element, o?: ScrollToOptions | number): void {
  const top = typeof o === 'object' ? (o.top ?? 0) : 0;
  const left = typeof o === 'object' ? (o.left ?? 0) : 0;
  Object.defineProperty(this, 'scrollTop', {
    configurable: true,
    value: (this.scrollTop || 0) + top,
  });
  Object.defineProperty(this, 'scrollLeft', {
    configurable: true,
    value: (this.scrollLeft || 0) + left,
  });
}

/**
 * A `scrollIntoView` for jsdom that brings the element on screen: it gives the
 * element an in-viewport rect (jsdom has no layout), as a real scroll would.
 */
export function movingScrollIntoView(this: Element): void {
  const rect = { top: 10, left: 10, bottom: 30, right: 30, width: 20, height: 20, x: 10, y: 10 };
  Object.defineProperty(this, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ ...rect, toJSON: () => ({}) }),
  });
}
