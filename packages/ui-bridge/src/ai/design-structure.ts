/**
 * Design structure — the in-page half of the structural quality metrics
 * (`specs/quality/*`, which are pure). For `/design/evaluate` only
 * (`collectDesignData` with `structure: true`), it reads per element:
 *
 *  - the canonical visibility verdict (`readElementVisibility`, one
 *    `withVisibilityPass` for the batch), so "rendered" means what the control
 *    snapshot means by it — with off-screen counted as rendered;
 *  - the nearest REGISTERED ancestor (`parentId`), across unregistered wrappers;
 *  - the nearest functional group ancestor (form, search, table, toolbar,
 *    dialog, nav, else a sectioning region), registered or not;
 *  - scroll extent, tag, computed role, a button/input `type`;
 *  - the text of text-bearing elements, through the redaction-safe reader only.
 *
 * and, per page, the document's scroll extent (`pageViewportContext`) and the
 * visible text blocks no registered element carries.
 */

import type { ElementStructure, QualityGroupKind, QualityHiddenReason } from '../core/types';
import { computeAriaLabel, computeRoleSafe, readAriaLabelAttr, readTitleAttr } from '../core/a11y';
import { readScrubbedText, scrubContent } from '../core/redaction';
import { readElementVisibility, withVisibilityPass } from '../core/element-state';
import { pageViewportContext } from '../control/page-scroll-container';
import type { QualityTextBlock, ViewportDimensions } from '../specs/quality-types';

/** Tunable: the longest text read per element. */
export const STRUCTURE_TEXT_MAX = 300;
/** Tunable: an unregistered element's own text must be at least this long to count as a text block. */
export const TEXT_BLOCK_MIN_CHARS = 12;
/** Tunable: unregistered text blocks are read down to this many viewport heights. */
export const TEXT_BLOCK_SCREENS = 2;
/** Text blocks read per page, at most. */
const TEXT_BLOCK_CAP = 200;

/** Elements whose own text the metrics read. */
const TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'th',
  'label',
  'legend',
  'caption',
  'figcaption',
  'dt',
  'button',
  'a',
  'summary',
  'select',
]);
const TEXT_ROLES = new Set(['heading', 'columnheader', 'rowheader', 'button', 'link']);

/** Functional group ancestors; `closest` returns the nearest of any. */
const GROUP_SELECTOR = [
  'form',
  '[role="search"]',
  '[role="form"]',
  'table',
  '[role="table"]',
  '[role="grid"]',
  '[role="treegrid"]',
  '[role="toolbar"]',
  'dialog',
  '[role="dialog"]',
  '[role="alertdialog"]',
  'nav',
  '[role="navigation"]',
].join(',');
const REGION_SELECTOR = 'section,[role="region"],article,aside,main,[role="main"]';

/** Elements whose content is never a text block of its own. */
const NON_TEXT_BLOCK = 'script,style,noscript,template,svg,button,a,select,option,textarea,input';

function groupKind(el: Element): QualityGroupKind {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') ?? '').toLowerCase();
  if (role === 'search') return 'search';
  if (tag === 'form' || role === 'form') return 'form';
  if (tag === 'table' || role === 'table' || role === 'grid' || role === 'treegrid') return 'table';
  if (role === 'toolbar') return 'toolbar';
  if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') return 'dialog';
  if (tag === 'nav' || role === 'navigation') return 'nav';
  return 'region';
}

function labelOf(el: Element): string | undefined {
  const label = computeAriaLabel(el);
  if (!label) return undefined;
  const scrubbed = scrubContent(label.replace(/\s+/g, ' ').trim(), el as HTMLElement);
  return scrubbed ? String(scrubbed).slice(0, 120) : undefined;
}

function rectOf(el: Element): { x: number; y: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Rendered, from the canonical verdict: off-screen and partly occluded count as rendered. */
function renderVerdict(
  el: HTMLElement,
  style: CSSStyleDeclaration | undefined
): {
  visible: boolean;
  hiddenReason?: QualityHiddenReason;
  occludedPct?: number;
} {
  if (!el.isConnected) return { visible: false, hiddenReason: 'detached' };
  const v = readElementVisibility(el);
  if (v.visibilityReason === 'hidden') return { visible: false, hiddenReason: 'hidden' };
  if (v.visibilityReason === 'no-layout') return { visible: false, hiddenReason: 'no-layout' };
  // Clipped away entirely by an ancestor that cannot scroll it back: the
  // visually-hidden pattern (a skip link, screen-reader-only table headers).
  if (v.visibilityReason === 'clipped' && (v.clippedPct ?? 0) >= 100 && !v.clipScrollable)
    return { visible: false, hiddenReason: 'clipped' };
  if (isVisuallyHidden(el, style)) return { visible: false, hiddenReason: 'clipped' };
  return { visible: true, occludedPct: v.occludedPct };
}

/**
 * The screen-reader-only pattern: a box of at most `VISUALLY_HIDDEN_MAX_PX` on
 * a side, or one clipped to nothing by `clip: rect(0 0 0 0)` or a
 * `clip-path: inset(50%)` / `inset(100%)`. The element stays in the
 * accessibility tree and paints nothing, so it is not page content.
 */
function isVisuallyHidden(el: HTMLElement, style: CSSStyleDeclaration | undefined): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= VISUALLY_HIDDEN_MAX_PX || r.height <= VISUALLY_HIDDEN_MAX_PX) return true;
  if (!style) return false;
  const clip = style.clip.replace(/\s|,/g, '');
  if (clip === 'rect(0px0px0px0px)' || clip === 'rect(0000)') return true;
  return /inset\(\s*(50|100)%/.test(style.clipPath);
}

/** Tunable: a box this small on either side is the visually-hidden pattern, not content. */
export const VISUALLY_HIDDEN_MAX_PX = 1.5;

interface GroupIndex {
  groupOf(el: Element): ElementStructure['group'];
}

/** Groups, keyed by their registered id or numbered per kind in document order. */
function buildGroupIndex(elements: readonly Element[], idOf: Map<Element, string>): GroupIndex {
  const groupEls = new Set<Element>();
  const groupOfEl = new Map<Element, Element | null>();
  for (const element of elements) {
    const g = element.closest(GROUP_SELECTOR) ?? element.closest(REGION_SELECTOR);
    groupOfEl.set(element, g);
    if (g) groupEls.add(g);
  }
  const ordered = Array.from(groupEls).sort((a, b) =>
    a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
  const counters = new Map<QualityGroupKind, number>();
  const info = new Map<Element, NonNullable<ElementStructure['group']>>();
  for (const g of ordered) {
    const kind = groupKind(g);
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    const region = g.parentElement?.closest(REGION_SELECTOR);
    info.set(g, {
      key: idOf.get(g) ?? `${kind}#${n}`,
      kind,
      rect: rectOf(g),
      label: labelOf(g) ?? (region ? labelOf(region) : undefined),
    });
  }
  return {
    groupOf: (el) => {
      const g = groupOfEl.get(el);
      return g ? info.get(g) : undefined;
    },
  };
}

function nearestRegistered(el: Element, idOf: Map<Element, string>): string | undefined {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const id = idOf.get(p);
    if (id !== undefined) return id;
  }
  return undefined;
}

/**
 * The structure of every element in the batch, keyed by its id, plus the
 * page's unregistered text blocks.
 */
export function collectStructure(live: ReadonlyArray<{ id: string; element: HTMLElement }>): {
  structure: Map<string, ElementStructure>;
  textBlocks: QualityTextBlock[];
} {
  return withVisibilityPass(() => {
    const idOf = new Map<Element, string>();
    for (const { id, element } of live) if (!idOf.has(element)) idOf.set(element, id);

    const scan = textScan(idOf);
    const blockEls = findTextBlockElements(idOf, scan);
    const groups = buildGroupIndex([...live.map((l) => l.element), ...blockEls], idOf);

    const structure = new Map<string, ElementStructure>();
    const scrollerMemo = new Map<Element, boolean>();
    for (const { id, element } of live) {
      if (structure.has(id)) continue;
      const tagName = element.tagName.toLowerCase();
      const role = scan.roleOf(element);
      const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
      const verdict = renderVerdict(element, style);
      const wantsText = scan.isTextBearing(element);
      const text = wantsText
        ? readScrubbedText(element, undefined, {
            normalizeWhitespace: true,
            maxLen: STRUCTURE_TEXT_MAX,
          })
        : undefined;
      structure.set(id, {
        tagName,
        role,
        parentId: nearestRegistered(element, idOf),
        visible: verdict.visible,
        hiddenReason: verdict.hiddenReason,
        occludedPct: verdict.occludedPct,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        textOverflow: style?.textOverflow || undefined,
        insideHorizontalScroller: insideHorizontalScroller(element, scrollerMemo),
        fullValueRecovery: {
          title: readTitleAttr(element) !== null,
          ariaLabel: readAriaLabelAttr(element) !== null,
          abbr: element.closest('abbr') !== null,
        },
        text: text ? String(text) : undefined,
        controlType:
          tagName === 'button' || tagName === 'input'
            ? (element.getAttribute('type') ?? '').toLowerCase()
            : undefined,
        group: groups.groupOf(element),
      });
    }

    const counters = new Map<string, number>();
    const textBlocks: QualityTextBlock[] = [];
    for (const el of blockEls) {
      const text = readScrubbedText(el, undefined, {
        normalizeWhitespace: true,
        maxLen: STRUCTURE_TEXT_MAX,
      });
      if (!text) continue;
      const tag = el.tagName.toLowerCase();
      const cls = el.classList.item(0);
      const base = cls ? `${tag}.${cls}` : tag;
      const n = (counters.get(base) ?? 0) + 1;
      counters.set(base, n);
      textBlocks.push({
        id: `dom:${base}#${n}`,
        tagName: tag,
        text: String(text),
        rect: rectOf(el),
        parentId: nearestRegistered(el, idOf),
        group: groups.groupOf(el),
      });
    }
    return { structure, textBlocks };
  });
}

/** Direct text of an element: its own text nodes, not its children's. */
function ownTextLength(el: Element): number {
  let n = 0;
  for (const node of Array.from(el.childNodes)) {
    // A text node's `data` is read only for its LENGTH here; the text itself
    // is read through `readScrubbedText` by the caller.
    if (node.nodeType === Node.TEXT_NODE) n += (node as Text).data.trim().length;
  }
  return n;
}

/**
 * Unregistered, rendered elements carrying at least `TEXT_BLOCK_MIN_CHARS` of
 * their own text within the first `TEXT_BLOCK_SCREENS` screens, in document
 * order. Skipped: an element inside a control; one inside, or wrapping, a
 * registered text-bearing element (whose text already counts — a wrapper's own
 * text is then not read at all, the trade against reading text twice); one
 * inside a block already kept.
 */
function findTextBlockElements(idOf: Map<Element, string>, scan: TextScan): Element[] {
  if (typeof document === 'undefined' || !document.body) return [];
  const limit = window.innerHeight * TEXT_BLOCK_SCREENS;
  const out: Element[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let lastKept: Element | null = null;
  for (let node = walker.nextNode(); node && out.length < TEXT_BLOCK_CAP; node = walker.nextNode()) {
    const el = node as HTMLElement;
    // A block's text already includes every descendant's (document order puts
    // descendants right after their ancestor).
    if (lastKept?.contains(el)) continue;
    if (idOf.has(el) || el.closest(NON_TEXT_BLOCK)) continue;
    if (ownTextLength(el) < TEXT_BLOCK_MIN_CHARS) continue;
    if (scan.insideRegisteredText(el)) continue;
    // Its text would include a registered text element's, read on its own.
    if (scan.wrapsRegisteredText.has(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.y >= limit || rect.width <= 2 || rect.height <= 2) continue;
    if (!renderVerdict(el, el.ownerDocument?.defaultView?.getComputedStyle(el)).visible) continue;
    out.push(el);
    lastKept = el;
  }
  return out;
}

interface TextScan {
  /** `computeRoleSafe`, computed once per element within one collection. */
  roleOf(el: Element): string | undefined;
  /** An element whose own text the metrics read: a text tag, or a text role. */
  isTextBearing(el: Element): boolean;
  /** A registered, text-bearing ancestor already reads this element's text. */
  insideRegisteredText(el: Element): boolean;
  /** Every ancestor of a registered, text-bearing element. */
  wrapsRegisteredText: Set<Element>;
}

/**
 * Per-collection text helpers. The role memo lives for one collection only: a
 * role depends on attributes and ancestry a framework may patch between
 * reports.
 */
function textScan(idOf: Map<Element, string>): TextScan {
  const roles = new Map<Element, string | undefined>();
  const roleOf = (el: Element) => {
    if (!roles.has(el)) roles.set(el, computeRoleSafe(el));
    return roles.get(el);
  };
  const isTextBearing = (el: Element) => {
    if (TEXT_TAGS.has(el.tagName.toLowerCase())) return true;
    const role = roleOf(el);
    return role !== undefined && TEXT_ROLES.has(role);
  };
  const registeredText = new Set<Element>();
  for (const el of idOf.keys()) if (isTextBearing(el)) registeredText.add(el);
  const wrapsRegisteredText = new Set<Element>();
  for (const el of registeredText) {
    for (let p = el.parentElement; p && !wrapsRegisteredText.has(p); p = p.parentElement) wrapsRegisteredText.add(p);
  }
  const insideRegisteredText = (el: Element) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (registeredText.has(p)) return true;
    return false;
  };
  return { roleOf, isTextBearing, insideRegisteredText, wrapsRegisteredText };
}

const CLIPS_X = new Set(['hidden', 'clip']);
const SCROLLS_X = new Set(['auto', 'scroll', 'overlay']);

/**
 * The element hides its x overflow, or is a horizontal scroller: it scrolls on
 * x and not on y. A computed `auto` alone is not enough — CSS computes
 * `overflow-x: auto` for any `overflow-y: auto` pane, and a wide child raises
 * such a pane's `scrollWidth` too.
 */
function scrollsOrClipsX(el: Element, view: Window): boolean {
  const style = view.getComputedStyle(el);
  if (CLIPS_X.has(style.overflowX)) return true;
  if (!SCROLLS_X.has(style.overflowX) || el.scrollWidth <= el.clientWidth + 1) return false;
  // Scrolls on x: a horizontal scroller when its y axis clips or does not
  // scroll. A pane scrolling on both axes is a page's main pane whose wide
  // child forced the x scroll, not a carousel.
  return CLIPS_X.has(style.overflowY) || el.scrollHeight <= el.clientHeight + 1;
}

/**
 * Some ancestor below the page root scrolls or clips horizontally (a carousel,
 * a wide-table wrapper), registered or not: content past the viewport edge
 * inside it is not page overflow.
 */
function insideHorizontalScroller(el: Element, memo: Map<Element, boolean>): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  const doc = el.ownerDocument;
  const p = el.parentElement;
  if (!p || p === doc.body || p === doc.documentElement) return false;
  const known = memo.get(p);
  if (known !== undefined) return known;
  const answer = scrollsOrClipsX(p, view) || insideHorizontalScroller(p, memo);
  memo.set(p, answer);
  return answer;
}

/**
 * The window's viewport with the page's scroll extent and offset, read from
 * the page's scroll container (`pageViewportContext`, which follows a
 * self-scrolling `<body>`). The extent is expressed as the viewport plus how
 * far the page scrolls past it, so a vertical scrollbar (in `innerWidth`, not
 * in `scrollWidth`) never reads as horizontal overflow.
 */
export function measuredViewport(): ViewportDimensions {
  const ctx = pageViewportContext();
  const root =
    ctx.container === 'viewport'
      ? document.documentElement
      : (document.body as HTMLElement | null) ?? document.documentElement;
  return {
    width: ctx.viewportWidth,
    height: ctx.viewportHeight,
    documentWidth: ctx.viewportWidth + Math.max(0, root.scrollWidth - root.clientWidth),
    documentHeight: ctx.viewportHeight + Math.max(0, root.scrollHeight - root.clientHeight),
    scrollX: ctx.scrollX,
    scrollY: ctx.scrollY,
  };
}
