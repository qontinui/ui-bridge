/**
 * `contentOverflow` — content that does not fit where it is put.
 *
 * Four kinds, each reported with the elements involved (a capped list plus a
 * count) and its own penalty:
 *
 *  1. `pageHorizontalScroll` — the document is wider than the viewport
 *     (`viewport.documentWidth`; not measured when that is absent);
 *  2. `pastViewportX` — rendered elements extending past the viewport's left
 *     or right edge, outside any ancestor that scrolls or clips horizontally;
 *  3. `clippedContent` — elements whose own content is cut off: `overflow`
 *     hidden or clip with a scroll extent larger than the box (an ellipsis
 *     truncation included). Each reports `recoverable` — whether a `title`,
 *     `aria-label` or `<abbr>` carries the full value — or `null` when that was
 *     not collected;
 *  4. `childPastClippingParent` — registered elements drawn past their nearest
 *     registered ancestor where that ancestor clips, so part of them is hidden.
 *
 * Vertical page length is NOT overflow: a document taller than the viewport
 * scrolls, which is how pages work, and `aboveFoldRatio` already measures how
 * much sits below the fold. Until 2026-11 this metric measured exactly that
 * (max element bottom minus viewport height), so a 1161 px page lost 43 points
 * and a page two viewports tall scored 0 (coord caveat
 * 7ac36d9e-134c-4586-bd72-3b484dc028c3). `pageScrollsVertically` is reported
 * for context only.
 */

import type { ElementDesignData } from '../../core/types';
import type { MetricFinding, MetricFunction } from '../quality-types';
import { isRendered } from './geometry';
import { makeResult } from './metric-result';

/** Tunable tolerance in px before an extent counts as overflow. */
export const OVERFLOW_TOLERANCE_PX = 1;
/** Tunable: points each kind costs (per element where it is per-element) and its cap. */
export const OVERFLOW_PENALTIES = {
  pageHorizontalScroll: { base: 40, cap: 40 },
  pastViewportX: { each: 10, cap: 30 },
  clippedContent: { each: 8, cap: 24 },
  childPastClippingParent: { each: 4, cap: 16 },
} as const;
/** Element ids listed per kind, at most. */
const ID_CAP = 20;

const CLIPPING = new Set(['hidden', 'clip']);
const SCROLLING = new Set(['auto', 'scroll', 'hidden', 'clip', 'overlay']);

/**
 * The computed overflow on one axis. `overflowX` / `overflowY` are read when
 * collected; otherwise the shorthand (`"hidden auto"` is x then y; one value is
 * both).
 */
function axisOverflow(el: ElementDesignData, axis: 'x' | 'y'): string {
  const own = axis === 'x' ? el.styles?.overflowX : el.styles?.overflowY;
  if (own) return own;
  const parts = (el.styles?.overflow ?? '').trim().split(/\s+/).filter(Boolean);
  return (axis === 'x' ? parts[0] : (parts[1] ?? parts[0])) ?? '';
}

const clipsAxis = (el: ElementDesignData, axis: 'x' | 'y') => CLIPPING.has(axisOverflow(el, axis));
/**
 * The element hides or scrolls its x overflow. A computed `auto` / `scroll` x
 * axis counts only when it actually scrolls on x: CSS computes `overflow-x:
 * auto` for any `overflow-y: auto` pane, and such a pane is not a horizontal
 * scroller.
 */
const scrollsOrClipsX = (el: ElementDesignData) => {
  if (clipsAxis(el, 'x')) return true;
  if (!SCROLLING.has(axisOverflow(el, 'x'))) return false;
  const s = el.structure;
  return s !== undefined && s.scrollWidth > s.clientWidth + OVERFLOW_TOLERANCE_PX;
};

function isPageRoot(el: ElementDesignData): boolean {
  const tag = el.structure?.tagName;
  return tag === 'html' || tag === 'body';
}

function recoverable(el: ElementDesignData): boolean | null {
  const r = el.structure?.fullValueRecovery;
  if (!r) return null;
  return r.title || r.ariaLabel || r.abbr;
}

export const contentOverflow: MetricFunction = (elements, viewport) => {
  const byId = new Map(elements.map((el) => [el.elementId, el]));
  const rendered = elements.filter(isRendered);
  const haveStructure = rendered.length > 0 && rendered.every((el) => el.structure);
  const unmeasured: Array<{ input: string; reason: string }> = [];

  /** An ancestor (by the parentId chain) scrolls or clips. */
  const insideScroller = (el: ElementDesignData): boolean => {
    let parent = el.structure?.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const p = byId.get(parent);
      if (!p) return false;
      if (!isPageRoot(p) && scrollsOrClipsX(p)) return true;
      parent = p.structure?.parentId;
    }
    return false;
  };

  // 1. Horizontal page scroll.
  const documentWidth = viewport.documentWidth;
  const horizontalScrollPx =
    documentWidth === undefined ? null : Math.max(0, documentWidth - viewport.width);
  if (horizontalScrollPx === null)
    unmeasured.push({ input: 'pageHorizontalScroll', reason: 'viewport.documentWidth absent' });
  const pageHorizontalScroll =
    horizontalScrollPx !== null && horizontalScrollPx > OVERFLOW_TOLERANCE_PX;

  // 2. Elements past the viewport's left or right edge.
  if (!haveStructure)
    unmeasured.push({
      input: 'pastViewportX.scrollContainment',
      reason: 'no structure: an element inside a horizontal scroller cannot be told apart',
    });
  const pastViewportX = rendered.filter((el) => {
    if (isPageRoot(el) || el.structure?.insideHorizontalScroller || insideScroller(el)) return false;
    return (
      el.rect.x < -OVERFLOW_TOLERANCE_PX ||
      el.rect.x + el.rect.width > viewport.width + OVERFLOW_TOLERANCE_PX
    );
  });

  // 3. Clipped content.
  if (!haveStructure)
    unmeasured.push({ input: 'clippedContent', reason: 'no element carries structure' });
  const clipped = haveStructure
    ? rendered.filter((el) => {
        const s = el.structure!;
        if (isPageRoot(el)) return false;
        return (
          (clipsAxis(el, 'x') && s.scrollWidth > s.clientWidth + OVERFLOW_TOLERANCE_PX) ||
          (clipsAxis(el, 'y') && s.scrollHeight > s.clientHeight + OVERFLOW_TOLERANCE_PX)
        );
      })
    : [];
  if (clipped.some((el) => recoverable(el) === null))
    unmeasured.push({
      input: 'textTruncationRecovery',
      reason: 'fullValueRecovery not collected for a clipped element',
    });

  // 4. Children drawn past a clipping registered parent.
  if (!haveStructure)
    unmeasured.push({ input: 'childPastClippingParent', reason: 'no element carries structure' });
  const pastParent = haveStructure
    ? rendered.filter((el) => {
        const parent = el.structure?.parentId ? byId.get(el.structure.parentId) : undefined;
        if (!parent || !isRendered(parent) || isPageRoot(parent)) return false;
        const t = OVERFLOW_TOLERANCE_PX + 1;
        const p = parent.rect;
        const r = el.rect;
        const pastX = r.x < p.x - t || r.x + r.width > p.x + p.width + t;
        const pastY = r.y < p.y - t || r.y + r.height > p.y + p.height + t;
        // Only an axis that CLIPS hides the excess; a scrolling axis shows it on scroll.
        return (clipsAxis(parent, 'x') && pastX) || (clipsAxis(parent, 'y') && pastY);
      })
    : [];

  const P = OVERFLOW_PENALTIES;
  const penalties = {
    pageHorizontalScroll: pageHorizontalScroll ? P.pageHorizontalScroll.base : 0,
    pastViewportX: Math.min(P.pastViewportX.cap, pastViewportX.length * P.pastViewportX.each),
    clippedContent: Math.min(P.clippedContent.cap, clipped.length * P.clippedContent.each),
    childPastClippingParent: Math.min(
      P.childPastClippingParent.cap,
      pastParent.length * P.childPastClippingParent.each
    ),
  };
  const total = Object.values(penalties).reduce((s, v) => s + v, 0);

  const ids = (list: ElementDesignData[]) => list.slice(0, ID_CAP).map((el) => el.elementId);
  const findings: MetricFinding[] = [];
  if (pageHorizontalScroll) {
    findings.push({
      severity: 'error',
      message: `The page scrolls horizontally: the document is ${Math.round(documentWidth!)}px wide in a ${viewport.width}px viewport.`,
      recommendation:
        'Find the element forcing the width (pastViewportX) and let it wrap, shrink or scroll inside its own container.',
      elementIds: ids(pastViewportX),
    });
  } else if (pastViewportX.length > 0) {
    findings.push({
      severity: 'warning',
      message: `${pastViewportX.length} element(s) extend past the viewport's left or right edge.`,
      recommendation:
        'Constrain their width, let them wrap, or put them in a horizontally scrolling container.',
      elementIds: ids(pastViewportX),
    });
  }
  if (clipped.length > 0) {
    const unrecoverable = clipped.filter((el) => recoverable(el) === false).length;
    findings.push({
      severity: 'warning',
      message: `${clipped.length} element(s) clip their content (overflow hidden with content larger than the box)${unrecoverable ? `, ${unrecoverable} with no title, aria-label or abbr carrying the full value` : ''}.`,
      recommendation:
        'Give the content room, or make the clipped part recoverable (wrap, scroll, title, expand).',
      elementIds: ids(clipped),
    });
  }
  if (pastParent.length > 0) {
    findings.push({
      severity: 'warning',
      message: `${pastParent.length} element(s) are drawn past a container that clips them, so part of each is hidden.`,
      recommendation: "Widen the container, let the child wrap, or let the container scroll.",
      elementIds: ids(pastParent),
    });
  }

  return makeResult('contentOverflow', 'Content Overflow', 'ux', 100 - total, findings, {
    kinds: {
      pageHorizontalScroll: {
        measured: horizontalScrollPx !== null,
        px: horizontalScrollPx,
        documentWidth: documentWidth ?? null,
      },
      pastViewportX: { count: pastViewportX.length, elementIds: ids(pastViewportX) },
      clippedContent: {
        measured: haveStructure,
        count: clipped.length,
        elementIds: ids(clipped),
        elements: clipped.slice(0, ID_CAP).map((el) => ({
          elementId: el.elementId,
          textOverflow: el.structure?.textOverflow ?? null,
          recoverable: recoverable(el),
        })),
      },
      childPastClippingParent: {
        measured: haveStructure,
        count: pastParent.length,
        elementIds: ids(pastParent),
      },
    },
    penalties,
    unmeasured,
    // Context only: vertical length is not overflow.
    pageScrollsVertically:
      viewport.documentHeight === undefined ? null : viewport.documentHeight > viewport.height + 1,
    documentHeight: viewport.documentHeight ?? null,
    viewportHeight: viewport.height,
  });
};
