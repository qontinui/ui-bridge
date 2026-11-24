/**
 * Repeats: lists, tables and card stacks — three or more rows of one kind of
 * item — and the quantities that say how compactly each row is drawn.
 *
 * A repeat is found by path, else by geometry:
 *
 * - **by: path** — DOM siblings (one `siblingKey`: the same parent element,
 *   registered or not) of one tag: those of one width (within
 *   {@link DENSITY_REPEAT_TOLERANCE_PX}) grouped into columns and aligned
 *   columns merged into a grid, as below; leaves of different widths (a
 *   fit-content list) grouped by left edge; stacked containers of different
 *   widths are layout, not rows; a run of paragraphs (every member a `prose`
 *   leaf) is text, not rows. Items inside repeated rows nobody registered
 *   (`ul > li[k] > a` with only the links registered) share a `cousinKey`
 *   instead, and form a repeat by it;
 * - **by: geometry** — items with no such chain (`structureBy: geometry`), of
 *   one parent, tag and role, whose left edge and width agree within
 *   {@link DENSITY_REPEAT_TOLERANCE_PX} of the first item of a column; columns
 *   of equal width whose rows line up are one grid (a short last column of a
 *   ragged grid included).
 *
 * Either way the members are arranged in ROWS: members whose tops agree within
 * the tolerance share a row (a grid of cards holds several per row), and a
 * group is a repeat when it spans at least {@link DENSITY_REPEAT_MIN_ROWS}
 * rows. Siblings side by side in a single row (the cells of one table row, a
 * tab strip, a pager) are not a repeat: none of the row quantities describes
 * them. Members with no rect, no area, or a `hidden` / `no-layout` visibility
 * take no space and are left out. A row holding an item whose text or rect
 * cannot be read is not estimated: its lines, values and fill are unknown,
 * never zero.
 *
 * Line bands are ESTIMATED in snapshot mode (`linesBasis: estimated`): a
 * leaf's text is assumed to wrap at {@link DENSITY_CHAR_WIDTH_EM} em per
 * character over its own width. The document walk (release 3) measures them.
 * `renderedOf` — how many rows exist beyond those rendered — is unknown from a
 * snapshot, which carries only what is registered.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 4).
 */

import type { UnknownCode } from '../observation/observation';
import { classifyDensityItems, type DensityClassification } from './classify';
import type { DensityCapture, DensityItem, DensityTargets } from './schema';
import {
  densityBlocks,
  densityChildren,
  densityLeaves,
  densityPinnedIds,
  densityPins,
  type DensityBlocks,
  type DensityLeaves,
  type DensityPins,
} from './structure';

/** The fewest rows a group must span to be a repeat. */
export const DENSITY_REPEAT_MIN_ROWS = 3;

/** How far, in px, two members' left edges, widths (by geometry) or tops (one row) may differ. */
export const DENSITY_REPEAT_TOLERANCE_PX = 2;

/** The average glyph advance, in em, that the snapshot-mode line estimate assumes. */
export const DENSITY_CHAR_WIDTH_EM = 0.5;

/** A quantity that could not be read, with the closed unknown code that says why. */
export interface DensityUnknownQuantity {
  unknown: UnknownCode;
  reason: string;
}

export type DensityRepeatBy = 'path' | 'geometry';

/**
 * Where the controls that act on a repeat were looked for: `block`, the
 * innermost block holding a first-row leaf and a control outside the repeat;
 * `ancestor`, the subtree of the nearest of the repeat's first
 * {@link DENSITY_REPEAT_SCOPE_LEVELS} ancestors that holds such a control.
 */
export type DensityRepeatScopeBy = 'block' | 'ancestor';

/** How many ancestors above a repeat its scope may climb (never into `main`, `body` or `html`). */
export const DENSITY_REPEAT_SCOPE_LEVELS = 3;

/** A finder: a control that narrows or locates rows of a repeat. */
export interface DensityRepeatFinder {
  id: string;
  /**
   * `position`: the text, search, select or combobox control (a listbox, too:
   * a `select` with a `size`) nearest above the repeat's first row in its
   * scope. `relationship`: a declared `filters` or `controls` edge from
   * such a control to the repeat.
   */
  by: 'position' | 'relationship';
}

export interface DensityRepeatRowBand {
  topPx: number;
  bottomPx: number;
}

/** One repeat. Holds no page text. */
export interface DensityRepeat {
  /** `repeat:<id of the first member>`. */
  id: string;
  by: DensityRepeatBy;
  /** The members' common parent; `null` at the root. */
  parent: string | null;
  tag: string;
  /** Member ids in document order (top, then capture order). */
  members: string[];
  /** Rows: bands of members whose tops agree within the tolerance. */
  rows: number;
  /**
   * Columns: the most left-edge clusters any one row holds (1 for a list of
   * single items, the column count for a grid; an icon beside a label in
   * unregistered list items counts 2).
   */
  perRow: number;
  /** The first and the last row's extent, document px. */
  firstRow: DensityRepeatRowBand;
  lastRow: DensityRepeatRowBand;
  /** Median top-to-top distance between consecutive rows, px. */
  rowPitchPx: number;
  /** How the line quantities were obtained. */
  linesBasis: 'estimated';
  /**
   * Median over estimated rows of the row's text height (`rowTextPx`) in lines
   * of its tallest line height; `null` when no row could be estimated.
   */
  linesPerRow: number | null;
  /** Median over estimated rows of the union of the row's line intervals, px; `null` when none could be. */
  rowTextPx: number | null;
  /** Median over estimated rows of a row's text height over its own pitch; `null` with `rowTextPx`. */
  rowFill: number | null;
  /**
   * Rows whose line bands could be estimated; the rest lacked a font size, a
   * line height, a width or a readable text length (a redacted leaf).
   */
  rowsEstimated: number;
  /** Median count of `value` leaves per row, over rows with no unreadable item; `null` when every row has one. */
  valuesPerRow: number | null;
  /** Median share of a row's width its leaves cover, over rows with no unreadable item; `null` when none qualifies. */
  widthFill: number | null;
  /** `Hu / rowPitchPx`: rows that fit the usable viewport height. */
  rowsPerScreen: number;
  /** `upper-bound` while an item's pin status is unknown (`Hu` is then an upper bound). */
  rowsPerScreenBasis: 'measured' | 'upper-bound';
  /** From the first row's top to the lowest member's bottom, px. */
  extentPx: number;
  /** The extent projected at the declared row volume, or why it cannot be. */
  extentAtVolume: { volume: number; px: number } | DensityUnknownQuantity;
  /**
   * Where the finder, filters and pager were looked for; `null` when no block
   * and no ancestor in reach holds a control outside the repeat (then nothing
   * acts on it by position).
   */
  scope: DensityRepeatScopeBy | null;
  finder: DensityRepeatFinder | null;
  /** Of how many rows the rendered ones are; unknown from a snapshot. */
  renderedOf: DensityUnknownQuantity;
}

/** What {@link densityRepeats} can reuse instead of computing it again. */
export interface DensityRepeatInputs {
  leaves?: DensityLeaves;
  pins?: DensityPins;
  blocks?: DensityBlocks;
  classes?: DensityClassification;
  /** The number of rows each list is judged at (the budget's `volume`). */
  volume?: number;
}

/** Whether a member takes space: a rect with area, and a visibility that lays it out. */
export function densityTakesSpace(item: DensityItem): boolean {
  return takesSpace(item);
}

function takesSpace(item: DensityItem): boolean {
  const r = item.rect;
  if (r === null || r.w <= 0 || r.h <= 0) return false;
  return item.visibility !== 'hidden' && item.visibility !== 'no-layout';
}

/** The largest value, by a loop (a spread argument list has a length ceiling). */
function maxOf(values: readonly number[]): number {
  let out = -Infinity;
  for (const v of values) if (v > out) out = v;
  return out;
}

/** The smallest value, by a loop. */
function minOf(values: readonly number[]): number {
  let out = Infinity;
  for (const v of values) if (v < out) out = v;
  return out;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Members split into rows: bands whose tops agree within the tolerance. */
function rowsOf(members: readonly DensityItem[]): DensityItem[][] {
  return bandByOverlap(members.map((m) => [m]));
}

/**
 * Groups (each with rects) banded into visual rows by vertical overlap: a
 * group whose top lies above the current band's bottom (less the tolerance)
 * joins it, so items of different heights centred on one line (a logo, two
 * links and a button) are one row; rows that only touch are two.
 */
function bandByOverlap(groups: DensityItem[][]): DensityItem[][] {
  const top = (g: DensityItem[]) => minOf(g.map((m) => m.rect!.y));
  const bottom = (g: DensityItem[]) => maxOf(g.map((m) => m.rect!.y + m.rect!.h));
  const sorted = groups.slice().sort((a, b) => top(a) - top(b));
  const bands: DensityItem[][] = [];
  let bandTop = -Infinity;
  let bandBottom = -Infinity;
  for (const g of sorted) {
    const t = top(g);
    const sameRow =
      bands.length > 0 &&
      (t - bandTop <= DENSITY_REPEAT_TOLERANCE_PX || t < bandBottom - DENSITY_REPEAT_TOLERANCE_PX);
    if (sameRow) {
      bands[bands.length - 1].push(...g);
      bandBottom = Math.max(bandBottom, bottom(g));
    } else {
      bands.push(g.slice());
      bandTop = t;
      bandBottom = bottom(g);
    }
  }
  return bands;
}

/**
 * A row's estimated line bands: `null` when a text leaf lacks a readable text
 * length, a font size, a line height or a width.
 */
function rowLines(
  leaves: readonly DensityItem[],
  containers: ReadonlySet<string>
): { lines: number; textPx: number } | null {
  const spans: Array<{ top: number; lh: number }> = [];
  for (const leaf of leaves) {
    // A container's own text sits somewhere among its children's lines, which
    // the capture does not say: the row cannot be estimated.
    if (containers.has(leaf.id)) return null;
    const r = leaf.rect;
    if (r === null) return null;
    const n = leaf.ownChars;
    if (n === null) return null;
    if (n === 0) continue;
    if (leaf.fontPx === null || leaf.lineHeightPx === null || leaf.lineHeightPx <= 0 || r.w <= 0)
      return null;
    // The estimate never exceeds what the measured height can hold, and a
    // truncated leaf (nowrap, ellipsis) is one line.
    const wrapped = Math.max(1, Math.ceil((n * DENSITY_CHAR_WIDTH_EM * leaf.fontPx) / r.w));
    // Whole lines only (padding is not a line), with room for sub-pixel heights.
    const fits = Math.max(1, Math.floor(r.h / leaf.lineHeightPx + 0.01));
    const lines = leaf.truncated === true ? 1 : Math.min(wrapped, fits);
    for (let k = 0; k < lines; k++)
      spans.push({ top: r.y + k * leaf.lineHeightPx, lh: leaf.lineHeightPx });
  }
  // The text's height is the UNION of the line intervals [top, top + lh), so
  // lines of leaves side by side (a centred date beside a two-line title)
  // never add up to more than the row draws; the line count is that height in
  // lines of the row's tallest line height.
  spans.sort((a, b) => a.top - b.top);
  let textPx = 0;
  let maxLh = 0;
  let curTop = -Infinity;
  let curBottom = -Infinity;
  for (const t of spans) {
    maxLh = Math.max(maxLh, t.lh);
    if (t.top < curBottom) {
      curBottom = Math.max(curBottom, t.top + t.lh);
      continue;
    }
    if (curBottom > curTop) textPx += curBottom - curTop;
    curTop = t.top;
    curBottom = t.top + t.lh;
  }
  if (curBottom > curTop) textPx += curBottom - curTop;
  const lines = textPx > 0 && maxLh > 0 ? Math.max(1, Math.round(textPx / maxLh)) : 0;
  return { lines, textPx };
}

/** The share of `[left, right)` that the leaves' x-ranges cover. */
function widthFillOf(leaves: readonly DensityItem[], left: number, right: number): number | null {
  if (right <= left) return null;
  const spans = leaves
    .map((l) => l.rect)
    .filter((r): r is NonNullable<DensityItem['rect']> => r !== null)
    .map((r): [number, number] => [Math.max(left, r.x), Math.min(right, r.x + r.w)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  if (spans.length === 0) return null;
  let covered = 0;
  let curS = spans[0][0];
  let curE = spans[0][1];
  for (const [s, e] of spans.slice(1)) {
    if (s > curE) {
      covered += curE - curS;
      curS = s;
      curE = e;
    } else if (e > curE) {
      curE = e;
    }
  }
  covered += curE - curS;
  return covered / (right - left);
}

/** Items of the capture that are `id` or below it, following parent links. */
export function densitySubtree(
  capture: DensityCapture,
  ids: Iterable<string>,
  children: Map<string, string[]> = densityChildren(capture)
): Set<string> {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return out;
}

const FINDER_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox']);

/** A text, search, select or combobox control (`listbox`: a `select` with a `size`). */
export function isDensityFinderControl(item: DensityItem): boolean {
  return item.tag === 'select' || (item.role !== null && FINDER_ROLES.has(item.role));
}

const FILTER_ROLES = new Set(['combobox', 'checkbox', 'radio']);

/** A select, combobox, checkbox or radio. */
export function isDensityFilterControl(item: DensityItem): boolean {
  // A `select` with a `size` computes to `listbox`: a finder, not a filter.
  if (item.role === 'listbox') return false;
  return item.tag === 'select' || (item.role !== null && FILTER_ROLES.has(item.role));
}

/** An interactive item in a `nav` (by tag in its path, or the navigation landmark). */
export function isDensityNavControl(item: DensityItem): boolean {
  return (
    item.interactive &&
    ((item.path !== null && item.path.includes('nav')) || item.landmark === 'navigation')
  );
}

/** A checkbox or radio in a table header: it selects rows, it acts on no list. */
export function isDensityHeaderToggle(item: DensityItem): boolean {
  return (
    (item.role === 'checkbox' || item.role === 'radio') &&
    item.path !== null &&
    item.path.includes('thead')
  );
}

/** The path up to and including the innermost `nav` tag, or `null` outside one. */
export function densityNavPrefix(item: DensityItem): string | null {
  if (item.path === null) return null;
  const at = item.path.lastIndexOf('nav');
  return at < 0 ? null : item.path.slice(0, at + 1).join('/');
}

/** A control a repeat's scope is looked for by: a laid-out finder, filter or nav control. */
function isScopeControl(item: DensityItem): boolean {
  return (
    item.interactive &&
    takesSpace(item) &&
    !isDensityHeaderToggle(item) &&
    (isDensityFinderControl(item) || isDensityFilterControl(item) || isDensityNavControl(item))
  );
}

/** The vertical centre of an item's rect, document px; `null` with no rect. */
export function densityCentreY(item: DensityItem): number | null {
  return item.rect === null ? null : item.rect.y + item.rect.h / 2;
}

const centreY = densityCentreY;

/** What a repeat's controls are looked for in. */
export interface DensityRepeatScope {
  by: DensityRepeatScopeBy | null;
  /** The items in scope: never the repeat's own subtree, never another repeat's rows. */
  ids: Set<string>;
  /** The repeat's own subtree. */
  own: Set<string>;
}

const SCOPE_CEILING_TAGS = new Set(['main', 'body', 'html']);

/**
 * The scope of every repeat, by repeat id. A repeat's controls are looked
 * for, in order:
 *
 * 1. in the innermost block that holds a leaf of its first row AND a finder,
 *    filter or nav control outside the repeat (`by: block`) — a list whose
 *    rows open their own block (a table, article cards) skips that block;
 * 2. in the subtree of the nearest of its first
 *    {@link DENSITY_REPEAT_SCOPE_LEVELS} ancestors (by parent links, from the
 *    repeat's parent up, never `main`, `body` or `html`) that holds such a
 *    control outside the repeat (`by: ancestor`);
 * 3. nowhere (`by: null`, an empty scope).
 *
 * Every scope excludes the repeat's own subtree and the rows of every OTHER
 * repeat (a per-row control acts on its own row), except a row this repeat
 * sits inside.
 */
export function densityRepeatScopes(
  capture: DensityCapture,
  repeats: ReadonlyArray<Pick<DensityRepeat, 'id' | 'members' | 'parent' | 'firstRow'>>,
  blocks: DensityBlocks
): Map<string, DensityRepeatScope> {
  const children = densityChildren(capture);
  const byId = new Map(capture.items.map((i) => [i.id, i]));
  const rowSubtree = new Map<string, Set<string>>();
  /** For each item inside some repeat's row: the rows (member ids) it is in. */
  const rowsHolding = new Map<string, string[]>();
  const repeatOfMember = new Map<string, string>();
  for (const r of repeats) {
    for (const m of r.members) {
      repeatOfMember.set(m, r.id);
      if (rowSubtree.has(m)) continue;
      const sub = densitySubtree(capture, [m], children);
      rowSubtree.set(m, sub);
      for (const id of sub) {
        const list = rowsHolding.get(id);
        if (list) list.push(m);
        else rowsHolding.set(id, [m]);
      }
    }
  }
  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let cur = byId.get(id)?.parent ?? null;
    while (cur !== null && !seen.has(cur)) {
      out.push(cur);
      seen.add(cur);
      cur = byId.get(cur)?.parent ?? null;
    }
    return out;
  };
  const out = new Map<string, DensityRepeatScope>();
  for (const rep of repeats) {
    const own = new Set<string>();
    for (const m of rep.members) rowSubtree.get(m)!.forEach((id) => own.add(id));
    // Rows of other repeats, less a row this repeat sits inside.
    const inside = new Set(ancestorsOf(rep.members[0]));
    // In another repeat's row (one this repeat does not sit inside): read
    // per candidate, so the cost follows the scope, not the repeat count.
    const foreign = (id: string): boolean =>
      (rowsHolding.get(id) ?? []).some(
        (m) => repeatOfMember.get(m) !== rep.id && !inside.has(m) && !own.has(m)
      );
    const usable = (ids: Iterable<string>): Set<string> => {
      const set = new Set<string>();
      for (const id of ids) if (!own.has(id) && !foreign(id)) set.add(id);
      return set;
    };
    // Only a control this repeat looks for qualifies: a sort button in a
    // table's header is no reason to stop at the table.
    const hasControl = (set: Set<string>): boolean => {
      for (const id of set) {
        const item = byId.get(id);
        if (item && isScopeControl(item)) return true;
      }
      return false;
    };

    // The first band's members: banded by overlap, so a centred member whose
    // top lies below the band's top is in it too.
    const firstRow = rep.members.filter((id) => {
      const r = byId.get(id)?.rect ?? null;
      return r !== null && r.y < rep.firstRow.bottomPx - DENSITY_REPEAT_TOLERANCE_PX;
    });
    const firstRowSubtree = densitySubtree(capture, firstRow, children);
    let scope: DensityRepeatScope = { by: null, ids: new Set(), own };
    const holding = blocks.blocks
      .filter((b) => b.members.some((m) => firstRowSubtree.has(m)))
      .sort((a, b) => a.members.length - b.members.length);
    for (const b of holding) {
      const ids = usable(b.members);
      if (hasControl(ids)) {
        scope = { by: 'block', ids, own };
        break;
      }
    }
    if (scope.by === null) {
      const ancestors = rep.parent === null ? [] : [rep.parent, ...ancestorsOf(rep.parent)];
      for (const a of ancestors.slice(0, DENSITY_REPEAT_SCOPE_LEVELS)) {
        if (SCOPE_CEILING_TAGS.has(byId.get(a)?.tag ?? '')) break;
        const sub = densitySubtree(capture, [a], children);
        sub.delete(a);
        const ids = usable(sub);
        if (hasControl(ids)) {
          scope = { by: 'ancestor', ids, own };
          break;
        }
      }
    }
    out.set(rep.id, scope);
  }
  return out;
}

/**
 * For each control in some repeat's scope, the one repeat it acts on by
 * position: `below`, the repeat whose first row is nearest below the control's
 * centre (a finder or filter); `above`, the repeat whose last row is nearest
 * above it (a pager). A control above two stacked lists belongs to the nearer.
 */
export function densityNearestRepeats(
  capture: DensityCapture,
  repeats: ReadonlyArray<Pick<DensityRepeat, 'id' | 'firstRow' | 'lastRow'>>,
  scopes: Map<string, DensityRepeatScope>,
  direction: 'below' | 'above'
): Map<string, string> {
  const byId = new Map(capture.items.map((i) => [i.id, i]));
  const best = new Map<string, { id: string; gap: number }>();
  for (const rep of repeats) {
    const scope = scopes.get(rep.id);
    if (!scope) continue;
    for (const id of scope.ids) {
      const item = byId.get(id);
      const cy = item ? centreY(item) : null;
      if (cy === null) continue;
      const gap = direction === 'below' ? rep.firstRow.topPx - cy : cy - rep.lastRow.bottomPx;
      if (gap <= 0) continue;
      const cur = best.get(id);
      if (!cur || gap < cur.gap) best.set(id, { id: rep.id, gap });
    }
  }
  return new Map([...best].map(([k, v]) => [k, v.id]));
}

/**
 * For each id a declared edge may aim at (a repeat's parent, rows and their
 * subtrees), the innermost repeat it belongs to: an edge to an inner list is
 * that list's, not every enclosing one's.
 */
export function densityInnermostRepeats(
  capture: DensityCapture,
  repeats: ReadonlyArray<Pick<DensityRepeat, 'id' | 'members' | 'parent'>>,
  children: Map<string, string[]> = densityChildren(capture)
): Map<string, string> {
  const targets = repeats.map((r) => ({
    id: r.id,
    set: densityRepeatTargets(capture, r, children),
  }));
  // Larger first, so a smaller (inner) repeat overwrites.
  targets.sort((a, b) => b.set.size - a.set.size);
  const out = new Map<string, string>();
  for (const t of targets) for (const id of t.set) out.set(id, t.id);
  return out;
}

/** The tag of a cousin row (`li`, `tr`) from its key's last segment. */
function rowTagOf(rowKey: string | null): string | null {
  if (rowKey === null) return null;
  const last = rowKey.split('/').pop() ?? '';
  const tag = last.replace(/\[\d+\]$/, '');
  return tag === '' || tag.startsWith('@') ? null : tag;
}

/** Whether the item's declared `filters` or `controls` edge names a repeat other than `repId`. */
export function densityDeclaresAnotherRepeat(
  item: DensityItem,
  repId: string,
  innermost: ReadonlyMap<string, string>
): boolean {
  const names = (target: string | null) =>
    target !== null && innermost.has(target) && innermost.get(target) !== repId;
  return names(item.filters) || names(item.controls);
}

function finderRank(item: DensityItem): number {
  return item.role === 'searchbox' ? 0 : item.role === 'textbox' ? 1 : 2;
}

/** The ids a control names when it acts on the repeat: its parent, its members and their subtrees. */
export function densityRepeatTargets(
  capture: DensityCapture,
  repeat: Pick<DensityRepeat, 'members' | 'parent'>,
  children: Map<string, string[]> = densityChildren(capture)
): Set<string> {
  const out = densitySubtree(capture, repeat.members, children);
  if (repeat.parent !== null) out.add(repeat.parent);
  return out;
}

/** Items split into clusters whose `key` agrees within the tolerance of the cluster's first. */
function clusterBy(
  items: readonly DensityItem[],
  key: (r: NonNullable<DensityItem['rect']>) => number
): DensityItem[][] {
  const clusters: DensityItem[][] = [];
  for (const item of items) {
    const v = key(item.rect!);
    const home = clusters.find((c) => Math.abs(key(c[0].rect!) - v) <= DENSITY_REPEAT_TOLERANCE_PX);
    if (home) home.push(item);
    else clusters.push([item]);
  }
  return clusters;
}

/**
 * Columns (equal left edges) of one width, merged into one grid when their
 * rows line up: the shorter column's row tops are, within the tolerance, the
 * first tops of the longer one (a ragged grid's short last columns).
 */
function gridsOf(sameWidth: readonly DensityItem[]): DensityItem[][] {
  const grids: Array<{ tops: number[]; members: DensityItem[] }> = [];
  for (const column of clusterBy(sameWidth, (r) => r.x)) {
    const tops = rowsOf(column).map((row) => row[0].rect!.y);
    const home = grids.find((g) => {
      const [short, long] = g.tops.length <= tops.length ? [g.tops, tops] : [tops, g.tops];
      return short.every((t, i) => Math.abs(t - long[i]) <= DENSITY_REPEAT_TOLERANCE_PX);
    });
    if (home) {
      home.members.push(...column);
      if (tops.length > home.tops.length) home.tops = tops;
    } else {
      grids.push({ tops, members: column.slice() });
    }
  }
  return grids.map((g) => g.members);
}

interface Group {
  by: DensityRepeatBy;
  parent: string | null;
  tag: string;
  members: DensityItem[];
  /** Cousins are gathered by the unregistered row they sit in before banding by top. */
  byRowKey?: boolean;
}

/**
 * A group's rows. Cousins are first gathered by the unregistered row they sit
 * in (`cousinRowKey`), and those rows are then banded by their tops like any
 * other members: list items side by side (a horizontal nav, a card grid) are
 * one visual row. Other groups are bands of tops.
 */
function rowsFor(g: Pick<Group, 'members' | 'byRowKey'>): DensityItem[][] {
  if (!g.byRowKey) return rowsOf(g.members);
  const byRow = new Map<string, DensityItem[]>();
  for (const m of g.members) {
    const key = m.cousinRowKey ?? m.id;
    const row = byRow.get(key);
    if (row) row.push(m);
    else byRow.set(key, [m]);
  }
  return bandByOverlap([...byRow.values()]);
}

const FORM_TAGS = new Set(['input', 'textarea', 'select', 'label']);

/** A form field or its label: stacked, they are a form, not a list. */
function isFormPart(item: DensityItem): boolean {
  return (
    FORM_TAGS.has(item.tag) ||
    (item.interactive && (isDensityFinderControl(item) || isDensityFilterControl(item)))
  );
}

/**
 * Whether a left-edge column is only the line starts of a wrapped run (chips,
 * tags): some row holding a column member also holds a sibling outside it.
 */
function wrappedRun(column: readonly DensityItem[], rows: readonly DensityItem[][]): boolean {
  const inColumn = new Set(column.map((m) => m.id));
  return rows.some(
    (row) => row.some((m) => inColumn.has(m.id)) && row.some((m) => !inColumn.has(m.id))
  );
}

/** Tags whose stacked siblings inside one row of another repeat are still rows (a nested list). */
const NESTED_ROW_TAGS = new Set(['li', 'tr']);

/**
 * Every repeat of `capture`, in document order. Precondition: the capture's
 * structure and repeat keys are resolved (`structureResolved`,
 * `repeatKeysResolved`); otherwise the answer is `[]` for want of keys, not
 * for want of repeats, and {@link summarizeDensityRepeats} says so. `targets` supplies the
 * declared blocks and kinds; `inputs` reuses what the caller already computed
 * and carries the row `volume` the extent is projected at.
 */
export function densityRepeats(
  capture: DensityCapture,
  targets: DensityTargets | null,
  inputs: DensityRepeatInputs = {}
): DensityRepeat[] {
  const leaves = inputs.leaves ?? densityLeaves(capture);
  const pins = inputs.pins ?? densityPins(capture);
  const blocks =
    inputs.blocks ?? densityBlocks(capture, targets, leaves, densityPinnedIds(capture, pins));
  const classes = inputs.classes ?? classifyDensityItems(capture, targets, leaves, pins);
  const kindOf = new Map(classes.items.map((c) => [c.id, c.kind]));
  const leafSet = new Set(leaves.ids);
  const unknownLeaves = new Set(leaves.unknown);
  const byId = new Map(capture.items.map((i) => [i.id, i]));
  const captureIndex = new Map(capture.items.map((it, i) => [it.id, i]));

  const eligible = capture.items.filter(takesSpace);
  const groups: Group[] = [];

  const children = densityChildren(capture);
  const containers = new Set(children.keys());
  const pathGroups: Group[] = [];
  const claimed = new Set<string>();
  /**
   * One test for every arm: a run of paragraphs, or of headings, is text; a
   * form's fields or their labels are a form. Neither is a list of rows.
   */
  const rejectsAsRows = (members: readonly DensityItem[]): boolean =>
    members.every((m) => kindOf.get(m.id) === 'prose') ||
    members.every((m) => kindOf.get(m.id) === 'heading') ||
    members.every(isFormPart);
  const accept = (g: Group, members: DensityItem[]): boolean => {
    if (rowsFor({ members, byRowKey: g.byRowKey }).length < DENSITY_REPEAT_MIN_ROWS) return false;
    if (rejectsAsRows(members)) return false;
    pathGroups.push({ ...g, members });
    members.forEach((m) => claimed.add(m.id));
    return true;
  };

  // ---- by cousin: one place inside repeated rows nobody registered (first,
  // so the lines inside each such row are not taken for rows) ----
  const byCousin = new Map<string, Group>();
  for (const item of eligible) {
    if (item.cousinKey === null) continue;
    const g = byCousin.get(item.cousinKey);
    if (g) g.members.push(item);
    else
      byCousin.set(item.cousinKey, {
        by: 'path',
        parent: item.parent,
        tag: rowTagOf(item.cousinRowKey) ?? item.tag,
        members: [item],
        byRowKey: true,
      });
  }
  for (const g of byCousin.values()) accept(g, g.members);

  // ---- by path: DOM siblings (one parent element) of one tag ----
  const byPath = new Map<string, Group>();
  for (const item of eligible) {
    if (item.siblingKey === null) continue;
    const key = `${item.siblingKey}\u0000${item.tag}`;
    const g = byPath.get(key);
    if (g) g.members.push(item);
    else byPath.set(key, { by: 'path', parent: item.parent, tag: item.tag, members: [item] });
  }
  const sameWidth = (members: readonly DensityItem[]): boolean =>
    members.every((m) => Math.abs(m.rect!.w - members[0].rect!.w) <= DENSITY_REPEAT_TOLERANCE_PX);
  for (const g of byPath.values()) {
    // 1. A grid: columns of one width whose rows line up, more than one column.
    const unclaimed = g.members.filter((m) => !claimed.has(m.id));
    for (const oneWidth of clusterBy(unclaimed, (r) => r.w)) {
      for (const c of gridsOf(oneWidth)) {
        if (clusterBy(c, (r) => r.x).length > 1) accept(g, c);
      }
    }
    // 2. One column, by left edge: of one width, or all leaves (a fit-content
    //    list); stacked containers of different widths are layout, not rows.
    const rest = g.members.filter((m) => !claimed.has(m.id));
    const siblingRows = rowsOf(g.members);
    for (const c of clusterBy(rest, (r) => r.x)) {
      if (wrappedRun(c, siblingRows)) continue;
      if (sameWidth(c) || c.every((m) => leafSet.has(m.id))) accept(g, c);
    }
  }

  // The lines inside one row of another repeat (a title, a subtitle and a date
  // stacked in each list item) are that row's content, not a list of their own.
  const parentOf = new Map(capture.items.map((i) => [i.id, i.parent]));
  const memberOf = new Map<string, Group>();
  for (const g of pathGroups) for (const m of g.members) memberOf.set(m.id, g);
  const enclosingRow = (id: string, own: Group): string | null => {
    const seen = new Set<string>();
    let cur = parentOf.get(id) ?? null;
    while (cur !== null && !seen.has(cur)) {
      const g = memberOf.get(cur);
      if (g && g !== own) return cur;
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    return null;
  };
  // Only a single column of leaves inside one row is that row's lines: a
  // grid, or a column of containers (cards, comments), is a list of its own.
  const linesOfOneRow = (g: Group): boolean => {
    // A cousin group's tag is its row's (li / tr), so it is never dropped here.
    if (NESTED_ROW_TAGS.has(g.tag)) return false;
    if (!g.members.every((m) => leafSet.has(m.id))) return false;
    if (maxOf(rowsFor(g).map((r) => r.length)) > 1) return false;
    const row = enclosingRow(g.members[0].id, g);
    return row !== null && g.members.every((m) => enclosingRow(m.id, g) === row);
  };
  const inPathRepeat = new Set<string>();
  for (const g of pathGroups) {
    if (linesOfOneRow(g)) continue;
    groups.push(g);
    g.members.forEach((m) => inPathRepeat.add(m.id));
  }

  // ---- by geometry: one parent, tag and role; equal left edge and width ----
  const byType = new Map<string, DensityItem[]>();
  for (const item of eligible) {
    if (item.structureBy !== 'geometry' || inPathRepeat.has(item.id)) continue;
    const key = `${item.parent ?? ''}\u0000${item.tag}\u0000${item.role ?? ''}`;
    const list = byType.get(key);
    if (list) list.push(item);
    else byType.set(key, [item]);
  }
  for (const list of byType.values()) {
    for (const sameWidth of clusterBy(list, (r) => r.w)) {
      for (const c of gridsOf(sameWidth)) {
        if (rowsOf(c).length < DENSITY_REPEAT_MIN_ROWS) continue;
        // Text or a form, not rows.
        if (rejectsAsRows(c)) continue;
        const g: Group = { by: 'geometry', parent: c[0].parent, tag: c[0].tag, members: c };
        if (linesOfOneRow(g)) continue;
        for (const m of c) memberOf.set(m.id, g);
        groups.push(g);
      }
    }
    // Leaves of different widths at one left edge (fit-content links).
    const placed = new Set<string>();
    for (const g of groups) for (const m of g.members) placed.add(m.id);
    const rest = list.filter((m) => !placed.has(m.id) && leafSet.has(m.id));
    const typeRows = rowsOf(list);
    for (const c of clusterBy(rest, (r) => r.x)) {
      if (wrappedRun(c, typeRows)) continue;
      if (rowsOf(c).length < DENSITY_REPEAT_MIN_ROWS) continue;
      if (rejectsAsRows(c)) continue;
      const g: Group = { by: 'geometry', parent: c[0].parent, tag: c[0].tag, members: c };
      if (linesOfOneRow(g)) continue;
      for (const m of c) memberOf.set(m.id, g);
      groups.push(g);
    }
  }

  /**
   * The leaves at or below an item, and whether any laid-out item there could
   * not be read: no rect, or `ownChars` null (redacted text).
   */
  const leavesUnder = (id: string): { leaves: DensityItem[]; unreadable: boolean } => {
    const out: DensityItem[] = [];
    let unreadable = false;
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const item = byId.get(cur)!;
      // A leaf that takes no space (a closed menu's items) draws no line in the
      // row; one whose rect is unknown, or whose text is, makes the row unknown.
      const laidOut = item.visibility !== 'hidden' && item.visibility !== 'no-layout';
      if (laidOut && item.rect === null) unreadable = true;
      else if (takesSpace(item)) {
        if (leafSet.has(cur)) out.push(item);
        else if (unknownLeaves.has(cur)) unreadable = true;
      }
      for (const c of children.get(cur) ?? []) stack.push(c);
    }
    return { leaves: out, unreadable };
  };

  const usable = pins.usableHeightPx;
  const volumeValid =
    inputs.volume !== undefined && Number.isInteger(inputs.volume) && inputs.volume >= 1;
  const volume = volumeValid ? inputs.volume! : null;
  const noVolume: DensityUnknownQuantity =
    inputs.volume === undefined
      ? {
          unknown: 'no_expectation',
          reason: 'no row volume was declared (the budget names the rows each list is judged at)',
        }
      : {
          unknown: 'input_missing',
          reason: 'the declared row volume is not a positive integer',
        };

  const repeats = groups.map((g): DensityRepeat => {
    const rows = rowsFor(g);
    const ordered = rows.flatMap((row) =>
      row.slice().sort((a, b) => captureIndex.get(a.id)! - captureIndex.get(b.id)!)
    );
    const bands = rows.map((row) => ({
      topPx: minOf(row.map((m) => m.rect!.y)),
      bottomPx: maxOf(row.map((m) => m.rect!.y + m.rect!.h)),
    }));
    const pitches: number[] = [];
    for (let i = 1; i < bands.length; i++) pitches.push(bands[i].topPx - bands[i - 1].topPx);
    const rowPitchPx = median(pitches)!;

    const lineCounts: number[] = [];
    const textPx: number[] = [];
    /** Per row: its text height over its own pitch (to the next row; the median for the last). */
    const rowFills: number[] = [];
    const values: number[] = [];
    const fills: number[] = [];
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const under = row.map((m) => leavesUnder(m.id));
      // A row holding an unreadable item is not estimated: its lines, values
      // and fill are unknown, never zero.
      if (under.some((u) => u.unreadable)) continue;
      const rowLeaves = under.flatMap((u) => u.leaves);
      const est = rowLines(rowLeaves, containers);
      if (est !== null) {
        lineCounts.push(est.lines);
        textPx.push(est.textPx);
        const pitch = ri + 1 < bands.length ? bands[ri + 1].topPx - bands[ri].topPx : rowPitchPx;
        rowFills.push(est.textPx / pitch);
      }
      values.push(rowLeaves.filter((l) => kindOf.get(l.id) === 'value').length);
      const left = minOf(row.map((m) => m.rect!.x));
      const right = maxOf(row.map((m) => m.rect!.x + m.rect!.w));
      const fill = widthFillOf(rowLeaves, left, right);
      if (fill !== null) fills.push(fill);
    }
    const rowTextPx = median(textPx);
    const first = bands[0];
    const last = bands[bands.length - 1];
    const bottom = maxOf(g.members.map((m) => m.rect!.y + m.rect!.h));
    const extentPx = bottom - first.topPx;
    return {
      id: `repeat:${ordered[0].id}`,
      by: g.by,
      parent: g.parent,
      tag: g.tag,
      members: ordered.map((m) => m.id),
      rows: rows.length,
      // Columns, by left edge: two lines stacked in one list item are one column.
      perRow: maxOf(rows.map((r) => clusterBy(r, (x) => x.x).length)),
      firstRow: first,
      lastRow: last,
      rowPitchPx,
      linesBasis: 'estimated',
      linesPerRow: median(lineCounts),
      rowTextPx,
      rowFill: median(rowFills),
      rowsEstimated: lineCounts.length,
      valuesPerRow: median(values),
      widthFill: median(fills),
      rowsPerScreen: usable / rowPitchPx,
      rowsPerScreenBasis: pins.unknown.length > 0 ? 'upper-bound' : 'measured',
      extentPx,
      extentAtVolume:
        volume === null
          ? noVolume
          : {
              volume,
              // Fewer rows than rendered: the measured extent of the first
              // `volume` rows; more: the measured extent plus whole pitches.
              px:
                volume <= rows.length
                  ? bands[volume - 1].bottomPx - first.topPx
                  : extentPx + (volume - rows.length) * rowPitchPx,
            },
      scope: null,
      finder: null,
      renderedOf: {
        unknown: 'input_missing',
        reason:
          'a snapshot carries only the rows that are registered; how many exist is measured by the document walk',
      },
    };
  });

  // ---- finder: in the repeat's scope above its first row, or a declared `filters` edge ----
  const scopes = densityRepeatScopes(capture, repeats, blocks);
  const nearestBelow = densityNearestRepeats(capture, repeats, scopes, 'below');
  const innermost = densityInnermostRepeats(capture, repeats, children);
  // A control whose declared edge names a repeat acts on that one, never on
  // another by position.
  const declaresAnother = (i: DensityItem, repId: string): boolean =>
    densityDeclaresAnotherRepeat(i, repId, innermost);
  for (const rep of repeats) {
    const scope = scopes.get(rep.id)!;
    rep.scope = scope.by;
    const aimed = densityRepeatTargets(capture, rep, children);
    let finder: DensityRepeatFinder | null = null;
    // A declared edge: a search box first, then a text field, then the rest.
    const declared = capture.items
      .filter(
        (i) =>
          !scope.own.has(i.id) &&
          i.interactive &&
          takesSpace(i) &&
          isDensityFinderControl(i) &&
          // A `filters` edge, or `controls` / `toggles` (aria-controls from a
          // search box to its results), naming this repeat.
          ((i.filters !== null && aimed.has(i.filters) && innermost.get(i.filters) === rep.id) ||
            (i.controls !== null && aimed.has(i.controls) && innermost.get(i.controls) === rep.id))
      )
      .sort((a, b) => finderRank(a) - finderRank(b));
    if (declared.length > 0) finder = { id: declared[0].id, by: 'relationship' };
    if (finder === null) {
      const above = capture.items
        .filter(
          (i) =>
            scope.ids.has(i.id) &&
            i.interactive &&
            takesSpace(i) &&
            isDensityFinderControl(i) &&
            nearestBelow.get(i.id) === rep.id &&
            !declaresAnother(i, rep.id)
        )
        .filter((i) => {
          const y = centreY(i);
          return y !== null && y < rep.firstRow.topPx;
        })
        // A search box first, then a text field, then the rest; within a rank
        // the nearest above the first row (the lowest centre), then capture order.
        .sort(
          (a, b) =>
            finderRank(a) - finderRank(b) ||
            centreY(b)! - centreY(a)! ||
            captureIndex.get(a.id)! - captureIndex.get(b.id)!
        );
      if (above.length > 0) finder = { id: above[0].id, by: 'position' };
    }
    rep.finder = finder;
  }

  return repeats.sort((a, b) => a.firstRow.topPx - b.firstRow.topPx || (a.id < b.id ? -1 : 1));
}

/** One repeat as `measure` reports it: its members are counted, not listed. */
export type DensityRepeatSummary = Omit<DensityRepeat, 'members'> & {
  members: number;
};

/** The longest repeat list a summary prints; the rest is counted. */
export const DENSITY_REPEAT_LIST_CAP = 50;

export type DensityRepeatsReport =
  | { structureResolved: false; reason: string }
  | { structureResolved: true; repeatKeysResolved: false; reason: string }
  | {
      structureResolved: true;
      repeatKeysResolved: true;
      byBasis: Record<DensityRepeatBy, number>;
      shown: number;
      total: number;
      truncated: boolean;
      list: DensityRepeatSummary[];
    };

/** What `measure` reports about a capture's repeats. Holds no page text. */
export function summarizeDensityRepeats(
  capture: DensityCapture,
  targets: DensityTargets | null,
  repeats?: readonly DensityRepeat[],
  cap: number = DENSITY_REPEAT_LIST_CAP
): DensityRepeatsReport {
  if (!capture.structureResolved) {
    return {
      structureResolved: false,
      reason: 'repeats are read from parent links, which this capture has not resolved',
    };
  }
  if (!capture.repeatKeysResolved) {
    return {
      structureResolved: true,
      repeatKeysResolved: false,
      reason:
        'this capture predates the sibling and cousin keys repeats are read from (repeatKeysResolved: false); capture it again',
    };
  }
  const all = repeats ?? densityRepeats(capture, targets);
  const byBasis: Record<DensityRepeatBy, number> = { path: 0, geometry: 0 };
  for (const r of all) byBasis[r.by]++;
  const list = all
    .slice(0, Math.max(0, cap))
    .map((r): DensityRepeatSummary => ({ ...r, members: r.members.length }));
  return {
    structureResolved: true,
    repeatKeysResolved: true,
    byBasis,
    shown: list.length,
    total: all.length,
    truncated: list.length < all.length,
    list,
  };
}
