/**
 * Quality geometry — the pure helpers the structural quality metrics share:
 * which registered elements are rendered, which are leaves, the area of a
 * union of rects (so nested and identical boxes count once), and where the
 * first screen ends. No DOM.
 */

import type { ElementDesignData } from '../../core/types';
import type { ViewportDimensions } from '../quality-types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Why an element is not rendered. `hidden` and `no-layout` are the canonical
 * visibility verdict's; `clipped` is an element an ancestor clips away
 * entirely with no scroll to recover it (the visually-hidden pattern);
 * `detached` is off the document. An element outside the viewport is NOT here:
 * off-screen is a position, measured by geometry.
 */
export type ExclusionReason = 'hidden' | 'no-layout' | 'clipped' | 'detached';

/**
 * Why the element is not rendered, or null when it is. The collected
 * structure (`/design/evaluate`) carries the canonical verdict, which sees
 * hidden ancestors and clipping; design data without it falls back to the
 * element's own styles and rect.
 */
export function exclusionReason(el: ElementDesignData): ExclusionReason | null {
  if (el.structure) return el.structure.visible ? null : (el.structure.hiddenReason ?? 'hidden');
  const s = el.styles;
  if (s?.display === 'none' || s?.visibility === 'hidden' || s?.visibility === 'collapse')
    return 'hidden';
  if (parseFloat(s?.opacity ?? '') === 0) return 'hidden';
  if (!(el.rect.width > 0) || !(el.rect.height > 0)) return 'no-layout';
  return null;
}

/** Rendered: not hidden, has a box, not clipped away. Off-screen counts as rendered. */
export function isRendered(el: ElementDesignData): boolean {
  return exclusionReason(el) === null;
}

/** `outer` contains `inner` (2 px tolerance). */
export function contains(outer: Rect, inner: Rect, tolerance = 2): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/**
 * The rendered leaves: rendered elements with no rendered registered
 * descendant. With collected structure the descendant test is the
 * `parentId` chain; without it, geometric containment (a rendered element that
 * contains another rendered element's rect, and is not the same box, is a
 * container). Two elements with the same box keep one of them.
 */
export function renderedLeaves(elements: readonly ElementDesignData[]): ElementDesignData[] {
  const rendered = elements.filter(isRendered);
  const haveStructure = rendered.length > 0 && rendered.every((el) => el.structure !== undefined);
  const containers = new Set<string>();
  if (haveStructure) {
    const renderedIds = new Set(rendered.map((el) => el.elementId));
    // The parent chain runs through EVERY element, so a hidden middle parent
    // does not cut a rendered grandparent off from its rendered descendants.
    const parentOf = new Map(elements.map((el) => [el.elementId, el.structure?.parentId]));
    for (const el of rendered) {
      // Every rendered ancestor of a rendered element is a container.
      let parent = parentOf.get(el.elementId);
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        if (renderedIds.has(parent)) containers.add(parent);
        parent = parentOf.get(parent) ?? undefined;
      }
    }
  } else {
    for (const outer of rendered) {
      for (const inner of rendered) {
        if (inner === outer) continue;
        if (!contains(outer.rect, inner.rect)) continue;
        // The same box: keep the later one as the leaf.
        if (contains(inner.rect, outer.rect) && rendered.indexOf(outer) > rendered.indexOf(inner))
          continue;
        containers.add(outer.elementId);
        break;
      }
    }
  }
  return rendered.filter((el) => !containers.has(el.elementId));
}

/** Clip a rect to another; null when they do not overlap. */
export function clip(rect: Rect, to: Rect): Rect | null {
  const x1 = Math.max(rect.x, to.x);
  const y1 = Math.max(rect.y, to.y);
  const x2 = Math.min(rect.x + rect.width, to.x + to.width);
  const y2 = Math.min(rect.y + rect.height, to.y + to.height);
  if (!Number.isFinite(x1 + y1 + x2 + y2)) return null;
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * The area of the union of the rects: every point covered by one or more
 * rects counts once. A sweep over the x boundaries, merging the y intervals of
 * the rects that span each strip.
 */
export function unionArea(rects: readonly Rect[]): number {
  const boxes = rects.filter((r) => r.width > 0 && r.height > 0);
  if (boxes.length === 0) return 0;
  const xs = Array.from(new Set(boxes.flatMap((r) => [r.x, r.x + r.width]))).sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const left = xs[i];
    const right = xs[i + 1];
    const intervals: Array<[number, number]> = [];
    for (const r of boxes) {
      if (r.x <= left && r.x + r.width >= right) intervals.push([r.y, r.y + r.height]);
    }
    if (intervals.length === 0) continue;
    intervals.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let [start, end] = intervals[0];
    for (let k = 1; k < intervals.length; k++) {
      const [s, e] = intervals[k];
      if (s > end) {
        covered += end - start;
        start = s;
        end = e;
      } else if (e > end) {
        end = e;
      }
    }
    covered += end - start;
    area += covered * (right - left);
  }
  return area;
}

/** The viewport as a rect in viewport coordinates. */
export function viewportRect(viewport: ViewportDimensions): Rect {
  return { x: 0, y: 0, width: viewport.width, height: viewport.height };
}

/**
 * A rect in document coordinates: rect `y` plus the page's vertical scroll
 * (zero when the scroll is not measured).
 */
export function documentTop(rect: Rect, viewport: ViewportDimensions): number {
  return rect.y + (viewport.scrollY ?? 0);
}

/** The rect's height inside the first screen (document `y` in `[0, height)`). */
export function firstScreenHeight(rect: Rect, viewport: ViewportDimensions): number {
  const top = documentTop(rect, viewport);
  return Math.max(0, Math.min(top + rect.height, viewport.height) - Math.max(top, 0));
}

/** The rect starts at or below the end of the first screen. */
export function entirelyBelowFirstScreen(rect: Rect, viewport: ViewportDimensions): boolean {
  return documentTop(rect, viewport) >= viewport.height;
}

/**
 * The rendered leaves that reach the viewport, each with its rect clipped to
 * it: what a reader of the first screen actually sees, for the balance metrics.
 */
export function visibleLeaves(
  elements: readonly ElementDesignData[],
  viewport: ViewportDimensions
): ElementDesignData[] {
  const vp = viewportRect(viewport);
  const out: ElementDesignData[] = [];
  for (const el of renderedLeaves(elements)) {
    const r = clip(el.rect, vp);
    if (r) out.push({ ...el, rect: r });
  }
  return out;
}
