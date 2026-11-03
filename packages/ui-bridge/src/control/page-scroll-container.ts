import type { SnapshotViewportContext } from './types';

/**
 * Which element scrolls the page.
 *
 * Under CSS overflow propagation, `<body>` is its own scroll container only
 * when `<html>` does not propagate overflow to the viewport (its computed
 * overflow is not `visible`) AND `<body>` itself is `auto`/`scroll`. That is
 * the SPA / Tauri layout (`html, body { height: 100%; overflow: … }`). In
 * every other layout the viewport scrolls, and `body.scrollBy` is a no-op —
 * even when the body's content overflows it, which is why "the body
 * overflows" is not a test for "the body scrolls".
 *
 * The viewport is driven through `document.scrollingElement` (the root
 * element in standards mode, `<body>` in quirks mode), falling back to
 * `<html>`.
 */
export function pageScrollContainer(): HTMLElement {
  const body = document.body;
  const root = document.documentElement;
  if (body && body !== root) {
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(body);
    const scrolls = (v: string) => v === 'auto' || v === 'scroll';
    const rootPropagates = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible';
    if (
      !rootPropagates &&
      (scrolls(bodyStyle.overflowY) || scrolls(bodyStyle.overflowX)) &&
      (body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth)
    ) {
      return body;
    }
  }
  return (document.scrollingElement as HTMLElement | null) ?? root;
}

/**
 * The page's viewport and scroll context, read from the container that
 * actually scrolls the page (see {@link pageScrollContainer}).
 *
 * Where the viewport scrolls, this is the window's offsets against the root's
 * scroll extent. Where `<body>` scrolls itself (the SPA / Tauri layout) the
 * window never moves and the root is exactly viewport-sized, so a window-only
 * read reports `scrollY: 0` and `canScrollDown: false` on a page that does
 * scroll — the body's own offsets and extent are the truth there.
 */
export function pageViewportContext(): Required<SnapshotViewportContext> {
  const container = pageScrollContainer();
  const viewport =
    container === ((document.scrollingElement as HTMLElement | null) ?? document.documentElement);
  if (viewport) {
    const docEl = document.documentElement;
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentWidth: docEl.scrollWidth,
      documentHeight: docEl.scrollHeight,
      canScrollDown: window.scrollY + window.innerHeight < docEl.scrollHeight - 1,
      canScrollRight: window.scrollX + window.innerWidth < docEl.scrollWidth - 1,
      container: 'viewport',
    };
  }
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollX: container.scrollLeft,
    scrollY: container.scrollTop,
    documentWidth: container.scrollWidth,
    documentHeight: container.scrollHeight,
    canScrollDown: container.scrollTop + container.clientHeight < container.scrollHeight - 1,
    canScrollRight: container.scrollLeft + container.clientWidth < container.scrollWidth - 1,
    container: 'body',
  };
}
