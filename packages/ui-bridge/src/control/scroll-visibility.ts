/**
 * Scroll-aware visibility and verified scrolling, shared by the executor
 * (`action-executor.ts`) and the relay (`react/commandHandlers.ts`).
 *
 * A window-only "is it on screen" check reads an element clipped by an inner
 * `overflow: auto` container as visible, and a bare native `scrollIntoView`
 * can be a real no-op (an `overflow: hidden` ancestor). Both used to be
 * reported as `success: true`; these helpers measure instead.
 */

import { clipBoxOf } from '../core/clip-box';

/** Error code a scroll action carries when it provably moved nothing. */
export const NO_SCROLL_EFFECT = 'NO_SCROLL_EFFECT';

const TOLERANCE = 0.5;

/**
 * The element is fully inside the viewport AND inside its clip box — the
 * region its containing-block chain lets it paint into (`core/clip-box.ts`,
 * the same walk the visibility verdict uses). An inner scroll container
 * clips it; a `fixed` element or an `absolute` one whose containing block
 * lies above that container is not clipped by it.
 */
export function isVisibleInScrollContext(el: Element): boolean {
  if (typeof window === 'undefined' || typeof el.getBoundingClientRect !== 'function') {
    return false;
  }
  if (window.innerWidth <= 0 || window.innerHeight <= 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  // Fully inside the box; an element larger than the box on an axis can never
  // be, so there it counts when it covers the whole box (nothing more to reveal).
  const axisOk = (lo: number, hi: number, boxLo: number, boxHi: number): boolean =>
    hi - lo > boxHi - boxLo + TOLERANCE
      ? lo <= boxLo + TOLERANCE && hi >= boxHi - TOLERANCE
      : lo >= boxLo - TOLERANCE && hi <= boxHi + TOLERANCE;
  const inViewport =
    axisOk(rect.top, rect.bottom, 0, window.innerHeight) &&
    axisOk(rect.left, rect.right, 0, window.innerWidth);
  if (!inViewport) return false;
  // Each clipper separately, not their intersection: an element larger than
  // the intersection may still stick out of one of the wider clippers. An axis
  // a clipper leaves open is ±Infinity, which `axisOk` always accepts.
  //
  // The question is "could a scroll reveal more". The element must fit inside
  // a clipper on each axis that some scroll could still move toward the cut:
  // `auto` / `scroll`, and `hidden` too, which `scrollIntoView` and script do
  // scroll. Where no scroll can (a `clip` cut, paint containment, or a
  // container with no scroll range left in the direction the element sticks
  // out — a child bleeding over a card's border), overlapping the clip region
  // is as visible as it gets. An element entirely outside it stays not
  // visible; its scrollIntoView then moves nothing and fails with
  // NO_SCROLL_EFFECT.
  const overlaps = (lo: number, hi: number, boxLo: number, boxHi: number): boolean =>
    hi > boxLo + TOLERANCE && lo < boxHi - TOLERANCE;
  //
  // The scroll range is [0, extent], except where the scroll origin sits at the
  // right or bottom (RTL, row-reverse, column-reverse), where it is
  // [-extent, 0]. scrollHeight / clientHeight are rounded while scrollTop can
  // be fractional, so the range edges take a whole pixel of slack.
  const RANGE_SLACK = 1;
  const axis = (
    container: boolean,
    pos: number,
    extent: number,
    reversed: boolean,
    lo: number,
    hi: number,
    boxLo: number,
    boxHi: number
  ): boolean => {
    if (axisOk(lo, hi, boxLo, boxHi)) return true;
    const min = reversed ? -extent : 0;
    const max = reversed ? 0 : extent;
    const canScroll = container && extent > RANGE_SLACK;
    const reachBefore = canScroll && lo < boxLo - TOLERANCE && pos > min + RANGE_SLACK;
    const reachAfter = canScroll && hi > boxHi + TOLERANCE && pos < max - RANGE_SLACK;
    return !reachBefore && !reachAfter && overlaps(lo, hi, boxLo, boxHi);
  };
  return clipBoxOf(el).clippers.every((c) => {
    const s = c.element;
    let reversedX = false;
    let reversedY = false;
    try {
      const cs = getComputedStyle(s);
      reversedX = (cs.direction === 'rtl') !== (cs.flexDirection === 'row-reverse');
      reversedY = cs.flexDirection === 'column-reverse';
    } catch {
      // No computed style: read the range as [0, extent].
    }
    return (
      axis(
        c.scrollContainerY,
        s.scrollTop || 0,
        (s.scrollHeight || 0) - (s.clientHeight || 0),
        reversedY,
        rect.top,
        rect.bottom,
        c.box.top,
        c.box.bottom
      ) &&
      axis(
        c.scrollContainerX,
        s.scrollLeft || 0,
        (s.scrollWidth || 0) - (s.clientWidth || 0),
        reversedX,
        rect.left,
        rect.right,
        c.box.left,
        c.box.right
      )
    );
  });
}

/** Every ancestor's scroll offsets plus the window's, as one comparable string. */
export function scrollContextSignature(el: Element): string {
  const parts: string[] = [];
  let p: Element | null = el.parentElement;
  while (p) {
    parts.push(`${(p as HTMLElement).scrollTop}:${(p as HTMLElement).scrollLeft}`);
    p = p.parentElement;
  }
  if (typeof window !== 'undefined') parts.push(`w${window.scrollX}:${window.scrollY}`);
  return parts.join('|');
}

/**
 * Wait for the scroll position to stop moving, bounded. Uses `setTimeout`, not
 * `requestAnimationFrame`, which does not fire in a backgrounded tab.
 *
 * A smooth scroll can start a frame or more after the call, so it is never
 * judged settled before a minimum wait has elapsed, however still it looks.
 */
export async function settleScroll(read: () => string, smooth: boolean): Promise<void> {
  const tick = 16;
  const needStable = smooth ? 3 : 1;
  const minMs = smooth ? 100 : 0;
  const maxMs = smooth ? 1000 : 100;
  let last = read();
  let stable = 0;
  let waited = 0;
  while (waited < maxMs) {
    await new Promise<void>((r) => setTimeout(r, tick));
    waited += tick;
    const now = read();
    if (now === last) {
      stable++;
      if (stable >= needStable && waited >= minMs) return;
    } else {
      stable = 0;
      last = now;
    }
  }
}

export interface VerifiedScrollIntoView {
  /** Visible in the scroll context before any scrolling; nothing was called. */
  alreadyVisible: boolean;
  /**
   * The element is visible after scrolling. Ancestor movement alone does not
   * count: a scroll that left the element hidden is not a success.
   */
  scrolled: boolean;
  /** Visible in the scroll context after the scroll (true when already visible). */
  visible: boolean;
}

/**
 * `scrollIntoView` that measures: short-circuits when the element is already
 * visible in its scroll context, otherwise calls the native method, settles,
 * and reports whether anything actually moved or became visible.
 */
export async function scrollIntoViewVerified(
  el: Element,
  opts: {
    smooth: boolean;
    block?: ScrollLogicalPosition;
    inline?: ScrollLogicalPosition;
  }
): Promise<VerifiedScrollIntoView> {
  if (isVisibleInScrollContext(el)) {
    return { alreadyVisible: true, scrolled: false, visible: true };
  }
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({
      behavior: opts.smooth ? 'smooth' : 'auto',
      block: opts.block ?? 'center',
      inline: opts.inline ?? 'nearest',
    });
  }
  await settleScroll(() => scrollContextSignature(el), opts.smooth);
  const visible = isVisibleInScrollContext(el);
  return { alreadyVisible: false, scrolled: visible, visible };
}

/** The message of the NO_SCROLL_EFFECT failure for a scrollIntoView. */
export function noScrollIntoViewMessage(): string {
  return (
    'scrollIntoView had no effect: no scroll offset changed and the element is still not ' +
    'visible within its scroll containers (an ancestor may be overflow:hidden, or the element ' +
    'may be hidden or have no layout)'
  );
}
