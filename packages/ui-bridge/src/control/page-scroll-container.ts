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
