/**
 * The region an element's ancestors let it paint into — ONE clip walk, shared
 * by the visibility verdict (`core/element-state.ts`) and the action layer's
 * scroll-aware visibility check (`control/scroll-visibility.ts`).
 *
 * An ancestor's `overflow` clip is not a property of the ancestor chain; it is
 * a property of the CONTAINING-BLOCK chain (CSS 2.1 §11.1.1, css-overflow-3 §3,
 * css-position-3 §2.1). An ancestor's overflow clip applies to every
 * descendant except those whose containing block is the viewport or lies
 * above that ancestor. So a `position: fixed` toast inside a scrolled sidebar
 * is not clipped by the sidebar, and an `absolute` popover inside a
 * non-positioned scroller escapes it to its positioned grandparent. A
 * `parentElement` walk that clips by every overflow ancestor reports both as
 * cut off when the compositor paints them whole.
 *
 * The walk (going up the flat tree, from the element to, but not including,
 * `<html>`; `mode` starts as the element's own computed `position`):
 *
 * - `static` / `relative` / `sticky`: every ancestor is a candidate clipper.
 * - `absolute`: skip ancestors until one establishes an absolute containing
 *   block (`position` ≠ `static`; `transform` / `perspective` / `filter` /
 *   `backdrop-filter` ≠ `none`; `contain` includes `layout` or `paint`, or is
 *   `strict` / `content`; `will-change` names `transform` / `perspective` /
 *   `filter`; `container-type` ≠ `normal`). That ancestor is the containing
 *   block and itself a candidate clipper.
 * - `fixed`: as `absolute`, except `position` alone never establishes it.
 * - After reaching the containing block, continue with that ancestor's own
 *   `position` as the new mode.
 *
 * A candidate clips when its computed `overflow-x` or `overflow-y` is not
 * `visible`, or `contain` includes `paint`, on each axis separately: an axis
 * left `visible` clips anyway when the other axis is `hidden` / `auto` /
 * `scroll` (it then computes to `auto`), so only a `visible`/`clip` pair
 * leaves one axis open. The clip region is the padding box — client metrics
 * offset from the border box — unless the ancestor is transformed, when the
 * untransformed client metrics do not describe what is painted and its
 * bounding rect is used instead.
 *
 * `<body>` is skipped when `<html>` is `visible` on both axes: its overflow
 * then propagates to the viewport, which the caller's viewport check already
 * covers (same predicate as `control/page-scroll-container.ts`).
 */

/** A viewport-space box. An axis a clipper leaves open is ±Infinity. */
export interface ClipRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** One ancestor whose overflow clips the element. */
export interface Clipper {
  element: HTMLElement;
  /** Its clip region; an open axis is ±Infinity. */
  box: ClipRect;
  /** It clips horizontally. */
  clipsX: boolean;
  /** It clips vertically. */
  clipsY: boolean;
  /** The horizontal clip is `auto`/`scroll` — the user can scroll content into it. */
  scrollsX: boolean;
  /** The vertical clip is `auto`/`scroll`. */
  scrollsY: boolean;
  /**
   * The horizontal clip belongs to a scroll container (`hidden`, `auto` or
   * `scroll`), which script and `scrollIntoView` can scroll even when the user
   * cannot. `false` for `clip` and for paint containment alone.
   */
  scrollContainerX: boolean;
  /** As {@link scrollContainerX}, vertically. */
  scrollContainerY: boolean;
}

export interface ClipBox {
  /**
   * The intersection of every applicable clipper's region, or `null` when no
   * ancestor clips the element at all. An empty intersection is a box with
   * `left >= right` or `top >= bottom`, not `null`.
   */
  box: ClipRect | null;
  /**
   * The applicable clippers, nearest first. Whether a clipped part is
   * reachable by scrolling is a per-sample question: {@link clipScrollableAt}.
   */
  clippers: Clipper[];
}

/**
 * The properties a `will-change` list names, compared whole: a word match
 * would read `scroll-position` as `position` and `transform-style` as
 * `transform`.
 */
function willChangeNames(willChange: string | undefined, ...props: string[]): boolean {
  if (!willChange) return false;
  const names = willChange.split(',').map((t) => t.trim());
  return props.some((p) => names.includes(p));
}

function nonNone(v: string | undefined | null): boolean {
  return !!v && v !== 'none';
}

/** `contain` includes `layout` or `paint`, or is `strict` / `content`. */
function containEstablishes(contain: string | undefined): boolean {
  if (!contain) return false;
  return /\b(layout|paint|strict|content)\b/.test(contain);
}

/** `contain` that clips on its own: `paint`, or the shorthands that include it. */
function containPaints(contain: string | undefined): boolean {
  if (!contain) return false;
  return /\b(paint|strict|content)\b/.test(contain);
}

/** `content-visibility: auto | hidden` applies paint (and layout) containment. */
function contentVisibilityContains(v: string | undefined): boolean {
  return v === 'auto' || v === 'hidden';
}

/**
 * Overflow does not apply to every box. A non-replaced inline box, a
 * `display: contents` element (no box at all) and the table-internal boxes
 * other than cells ignore it, although `getComputedStyle` still reports the
 * declared value.
 */
const NO_OVERFLOW_DISPLAY = new Set([
  'inline',
  'contents',
  'none',
  'table-row',
  'table-row-group',
  'table-header-group',
  'table-footer-group',
  'table-column',
  'table-column-group',
  'ruby',
  'ruby-base',
  'ruby-text',
  'ruby-base-container',
  'ruby-text-container',
]);

function overflowApplies(style: CSSStyleDeclaration): boolean {
  return !NO_OVERFLOW_DISPLAY.has(style.display || '');
}

/** Does `style` establish a containing block for a descendant of this `mode`? */
function establishesContainingBlock(
  style: CSSStyleDeclaration,
  mode: 'absolute' | 'fixed'
): boolean {
  const display = style.display || '';
  // No box, no containing block.
  if (display === 'contents' || display === 'none') return false;
  const s = style as CSSStyleDeclaration & Record<string, string | undefined>;
  if (mode === 'absolute') {
    const pos = style.position || 'static';
    if (pos !== 'static') return true;
    // A will-change naming a property that would establish one establishes it.
    if (willChangeNames(s.willChange, 'position')) return true;
  }
  // Filters apply to every element (Filter Effects 1), inline boxes included.
  if (nonNone(style.filter) || nonNone(s.backdropFilter) || nonNone(s.webkitBackdropFilter)) {
    return true;
  }
  if (willChangeNames(s.willChange, 'filter', 'backdrop-filter')) return true;
  // Transforms and containment do not apply to a non-replaced inline box, so
  // they cannot make it a containing block.
  if (display === 'inline') return false;
  if (nonNone(style.transform) || nonNone(style.perspective)) return true;
  if (s.transformStyle === 'preserve-3d') return true;
  // The individual transform properties (Tailwind v4 emits them) and
  // `offset-path` establish one exactly as `transform` does.
  if (nonNone(s.translate) || nonNone(s.rotate) || nonNone(s.scale)) return true;
  if (nonNone(s.offsetPath)) return true;
  if (containEstablishes(s.contain)) return true;
  if (contentVisibilityContains(s.contentVisibility)) return true;
  if (willChangeNames(s.willChange, 'transform', 'perspective', 'translate', 'rotate', 'scale')) {
    return true;
  }
  const containerType = s.containerType;
  if (containerType && containerType !== 'normal') return true;
  return false;
}

/** jsdom and an unset longhand both read `''`; that is the initial value. */
function overflowOf(v: string | undefined): string {
  return v ? v : 'visible';
}

const scrolls = (v: string) => v === 'auto' || v === 'scroll';

/**
 * Per-axis clip of one candidate, or `null` when it clips neither axis.
 * `visible` on one axis computes to `auto` when the other is neither
 * `visible` nor `clip`.
 */
function axisClip(style: CSSStyleDeclaration): Omit<Clipper, 'element' | 'box'> | null {
  let ox = overflowOf(style.overflowX);
  let oy = overflowOf(style.overflowY);
  const opensWith = (v: string) => v === 'visible' || v === 'clip';
  if (ox === 'visible' && !opensWith(oy)) ox = 'auto';
  if (oy === 'visible' && !opensWith(ox)) oy = 'auto';
  const cs = style as CSSStyleDeclaration & { contain?: string; contentVisibility?: string };
  const paint = containPaints(cs.contain) || contentVisibilityContains(cs.contentVisibility);
  const clipsX = ox !== 'visible' || paint;
  const clipsY = oy !== 'visible' || paint;
  if (!clipsX && !clipsY) return null;
  const container = (v: string) => v === 'hidden' || scrolls(v);
  return {
    clipsX,
    clipsY,
    scrollsX: clipsX && scrolls(ox),
    scrollsY: clipsY && scrolls(oy),
    scrollContainerX: clipsX && container(ox),
    scrollContainerY: clipsY && container(oy),
  };
}

/**
 * The clipper's region: its padding box, or its bounding rect when transformed.
 * A 0×0 client box on a laid-out rect (a bordered empty box, a scroller whose
 * client area is all scrollbar) is a genuine empty clip: everything inside it
 * is cut off. Boxes overflow does not apply to never reach here
 * ({@link overflowApplies}).
 */
function regionOf(el: HTMLElement, clipsX: boolean, clipsY: boolean): ClipRect {
  const rect = el.getBoundingClientRect();
  const offsetWidth = typeof el.offsetWidth === 'number' ? el.offsetWidth : NaN;
  const offsetHeight = typeof el.offsetHeight === 'number' ? el.offsetHeight : NaN;
  // Client metrics are untransformed: a transformed ancestor (or one with no
  // offset metrics at all, an SVG element) paints where its bounding rect is.
  // Either axis can betray a transform (`scaleY` leaves the width alone).
  const transformed =
    !(Math.abs(rect.width - offsetWidth) < 1) || !(Math.abs(rect.height - offsetHeight) < 1);
  let box: ClipRect;
  if (transformed) {
    box = { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
  } else {
    const cw = el.clientWidth || 0;
    const ch = el.clientHeight || 0;
    const left = rect.left + (el.clientLeft || 0);
    const top = rect.top + (el.clientTop || 0);
    box = { left, top, right: left + cw, bottom: top + ch };
  }
  if (!clipsX) {
    box.left = -Infinity;
    box.right = Infinity;
  }
  if (!clipsY) {
    box.top = -Infinity;
    box.bottom = Infinity;
  }
  return box;
}

/** The flat-tree parent: slot assignment, then the DOM parent, then a shadow host. */
function flatParent(el: Element): Element | null {
  const slot = (el as Element & { assignedSlot?: Element | null }).assignedSlot;
  if (slot) return slot;
  if (el.parentElement) return el.parentElement;
  const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
  const host = root && (root as ShadowRoot).host;
  return host ?? null;
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  try {
    return getComputedStyle(el);
  } catch {
    return null;
  }
}

/** `<html>`'s overflow propagates to the viewport, taking `<body>`'s with it. */
function bodyPropagates(): boolean {
  const root = document.documentElement;
  const rs = root ? styleOf(root) : null;
  if (!rs) return true;
  return overflowOf(rs.overflowX) === 'visible' && overflowOf(rs.overflowY) === 'visible';
}

/** The ancestors whose overflow clips `element`, nearest first. */
export function clippersOf(element: Element): Clipper[] {
  const own = styleOf(element);
  type Mode = 'flow' | 'absolute' | 'fixed';
  const modeOf = (pos: string | undefined): Mode =>
    pos === 'absolute' ? 'absolute' : pos === 'fixed' ? 'fixed' : 'flow';
  let mode: Mode = modeOf(own?.position);
  const html = document.documentElement;
  const body = document.body;
  let skipBody: boolean | undefined;
  const out: Clipper[] = [];

  for (let p = flatParent(element); p && p !== html; p = flatParent(p)) {
    const style = styleOf(p);
    if (!style) continue;
    if (mode !== 'flow') {
      if (!establishesContainingBlock(style, mode)) continue;
      // `p` is the containing block: a candidate, and the new mode is its own.
    }
    // A box that does not exist (`contents`, `none`) has no position of its own.
    const display = style.display || '';
    if (display !== 'contents' && display !== 'none') mode = modeOf(style.position);
    if (p === body) {
      skipBody ??= bodyPropagates();
      if (skipBody) continue;
    }
    if (!overflowApplies(style)) continue;
    const axes = axisClip(style);
    if (!axes || !(p instanceof HTMLElement)) continue;
    out.push({ element: p, box: regionOf(p, axes.clipsX, axes.clipsY), ...axes });
  }
  return out;
}

function intersect(clippers: Clipper[]): ClipRect | null {
  if (clippers.length === 0) return null;
  const box: ClipRect = { top: -Infinity, left: -Infinity, bottom: Infinity, right: Infinity };
  for (const c of clippers) {
    box.top = Math.max(box.top, c.box.top);
    box.left = Math.max(box.left, c.box.left);
    box.bottom = Math.min(box.bottom, c.box.bottom);
    box.right = Math.min(box.right, c.box.right);
  }
  return box;
}

/** A point is inside a clip box (half-open, like `elementFromPoint`'s hit box). */
export function insideClip(box: ClipRect, x: number, y: number): boolean {
  return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
}

/**
 * The per-sample `scrollable`: true iff every clipper that excluded at least
 * one of `points` is `auto`/`scroll` on the axis it excluded it on. `false`
 * when no point was excluded. A bound, not a proof: content cut on the
 * negative side of a scroller's scroll origin (above or left of it) reads
 * scrollable although no scroll can reveal it.
 */
export function clipScrollableAt(
  clippers: Clipper[],
  points: ReadonlyArray<readonly [number, number]>
): boolean {
  let excludedAny = false;
  for (const [x, y] of points) {
    for (const c of clippers) {
      const outX = x < c.box.left || x >= c.box.right;
      const outY = y < c.box.top || y >= c.box.bottom;
      if (!outX && !outY) continue;
      excludedAny = true;
      if ((outX && !c.scrollsX) || (outY && !c.scrollsY)) return false;
    }
  }
  return excludedAny;
}

/**
 * The clip box of `element`: what its containing-block chain lets it paint
 * into. See the module comment for the rule.
 */
export function clipBoxOf(element: Element): ClipBox {
  const clippers = clippersOf(element);
  return { box: intersect(clippers), clippers };
}
