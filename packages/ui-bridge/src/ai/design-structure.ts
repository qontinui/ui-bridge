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
function renderVerdict(el: HTMLElement): {
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
  if (isVisuallyHidden(el)) return { visible: false, hiddenReason: 'clipped' };
  return { visible: true, occludedPct: v.occludedPct };
}

/**
 * The screen-reader-only pattern: a box of at most `VISUALLY_HIDDEN_MAX_PX` on
 * a side, or one clipped to nothing by `clip: rect(0 0 0 0)` or a
 * `clip-path: inset(50%)` / `inset(100%)`. The element stays in the
 * accessibility tree and paints nothing, so it is not page content.
 */
function isVisuallyHidden(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= VISUALLY_HIDDEN_MAX_PX || r.height <= VISUALLY_HIDDEN_MAX_PX) return true;
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
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

    const blockEls = findTextBlockElements(idOf);
    const groups = buildGroupIndex([...live.map((l) => l.element), ...blockEls], idOf);

    const structure = new Map<string, ElementStructure>();
    for (const { id, element } of live) {
      if (structure.has(id)) continue;
      const tagName = element.tagName.toLowerCase();
      const role = computeRoleSafe(element);
      const verdict = renderVerdict(element);
      const wantsText = TEXT_TAGS.has(tagName) || (role !== undefined && TEXT_ROLES.has(role));
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
        textOverflow: element.ownerDocument?.defaultView?.getComputedStyle(element).textOverflow || undefined,
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
 * order. An element inside a control, or inside a registered element that is
 * itself text-bearing (whose text already counts), is skipped.
 */
function findTextBlockElements(idOf: Map<Element, string>): Element[] {
  if (typeof document === 'undefined' || !document.body) return [];
  const limit = window.innerHeight * TEXT_BLOCK_SCREENS;
  const out: Element[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node && out.length < TEXT_BLOCK_CAP; node = walker.nextNode()) {
    const el = node as HTMLElement;
    if (idOf.has(el) || el.closest(NON_TEXT_BLOCK)) continue;
    if (ownTextLength(el) < TEXT_BLOCK_MIN_CHARS) continue;
    const textAncestor = registeredTextAncestor(el, idOf);
    if (textAncestor) continue;
    const rect = el.getBoundingClientRect();
    if (rect.y >= limit || rect.width <= 2 || rect.height <= 2) continue;
    if (!renderVerdict(el).visible) continue;
    out.push(el);
  }
  return out;
}

function registeredTextAncestor(el: Element, idOf: Map<Element, string>): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (!idOf.has(p)) continue;
    const tag = p.tagName.toLowerCase();
    if (TEXT_TAGS.has(tag)) return true;
  }
  return false;
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
