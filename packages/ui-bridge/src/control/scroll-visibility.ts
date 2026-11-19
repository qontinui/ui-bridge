/**
 * Scroll-aware visibility and verified scrolling, shared by the executor
 * (`action-executor.ts`) and the relay (`react/commandHandlers.ts`).
 *
 * A window-only "is it on screen" check reads an element clipped by an inner
 * `overflow: auto` container as visible, and a bare native `scrollIntoView`
 * can be a real no-op (an `overflow: hidden` ancestor). Both used to be
 * reported as `success: true`; these helpers measure instead.
 */

/** Error code a scroll action carries when it provably moved nothing. */
export const NO_SCROLL_EFFECT = 'NO_SCROLL_EFFECT';

interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

const TOLERANCE = 0.5;

function clipsOverflow(value: string): boolean {
  return value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip';
}

/**
 * Whether an ancestor clips its descendants' painting to its own box:
 * `auto`/`scroll` always; `hidden`/`clip` only when it really has overflowing
 * content (otherwise nothing of a descendant is cut off by it).
 */
function clipsDescendants(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  const x = style.overflowX;
  const y = style.overflowY;
  if (!clipsOverflow(x) && !clipsOverflow(y)) return false;
  if (x === 'auto' || x === 'scroll' || y === 'auto' || y === 'scroll') return true;
  return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
}

/**
 * The element is fully inside the viewport AND inside the clip box of every
 * clipping ancestor (an inner scroll container included).
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
  const inside = (box: Box): boolean =>
    axisOk(rect.top, rect.bottom, box.top, box.bottom) &&
    axisOk(rect.left, rect.right, box.left, box.right);

  if (!inside({ top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth })) {
    return false;
  }
  let p: HTMLElement | null = el.parentElement;
  while (p && p !== document.documentElement) {
    if (clipsDescendants(p)) {
      const c = p.getBoundingClientRect();
      if (!inside({ top: c.top, left: c.left, bottom: c.bottom, right: c.right })) return false;
    }
    p = p.parentElement;
  }
  return true;
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
