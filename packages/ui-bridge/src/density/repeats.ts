/**
 * Repeats: lists, tables and card stacks — three or more rows of one kind of
 * item — and the quantities that say how compactly each row is drawn.
 *
 * A repeat is found by path, else by geometry:
 *
 * - **by: path** — siblings with one parent, one ancestor path and one tag,
 *   whose parent link was read from the xpath (`structureBy: xpath`);
 * - **by: geometry** — items with no such chain (`structureBy: geometry`), of
 *   one parent, tag and role, whose left edge and width agree within
 *   {@link DENSITY_REPEAT_TOLERANCE_PX} of the first item of the group.
 *
 * Either way the members are arranged in ROWS: members whose tops agree within
 * the tolerance share a row (a grid of cards holds several per row), and a
 * group is a repeat when it spans at least {@link DENSITY_REPEAT_MIN_ROWS}
 * rows. Siblings side by side in a single row (the cells of one table row, a
 * tab strip, a pager) are not a repeat: none of the row quantities describes
 * them. Members with no rect, no area, or a `hidden` / `no-layout` visibility
 * take no space and are left out.
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

/** Where the controls that act on a repeat were looked for. */
export type DensityRepeatScopeBy = 'block' | 'parent' | 'block+parent';

/** A finder: a control that narrows or locates rows of a repeat. */
export interface DensityRepeatFinder {
  id: string;
  /**
   * `position`: a text, search, select or combobox control in the repeat's
   * scope above its first row. `relationship`: a declared `filters` edge from
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
  /** The most members any one row holds (1 for a list, the column count for a grid). */
  perRow: number;
  /** The first and the last row's extent, document px. */
  firstRow: DensityRepeatRowBand;
  lastRow: DensityRepeatRowBand;
  /** Median top-to-top distance between consecutive rows, px. */
  rowPitchPx: number;
  /** How the line quantities were obtained. */
  linesBasis: 'estimated';
  /** Median count of distinct leaf line bands per row; `null` when no row could be estimated. */
  linesPerRow: number | null;
  /** Median height of a row's text line bands, px; `null` when no row could be estimated. */
  rowTextPx: number | null;
  /** `rowTextPx / rowPitchPx`; `null` with `rowTextPx`. */
  rowFill: number | null;
  /** Rows whose line bands could be estimated; the rest lacked a font size, a line height, a width or a readable text length. */
  rowsEstimated: number;
  /** Median count of `value` leaves per row. */
  valuesPerRow: number;
  /** Median share of a row's width its leaves cover; `null` when no row has leaves with rects. */
  widthFill: number | null;
  /** `Hu / rowPitchPx`: rows that fit the usable viewport height. */
  rowsPerScreen: number;
  /** From the first row's top to the lowest member's bottom, px. */
  extentPx: number;
  /** The extent projected at the declared row volume, or why it cannot be. */
  extentAtVolume: { volume: number; px: number } | DensityUnknownQuantity;
  /** Where the finder, filters and pager were looked for; `null` when the repeat has no block and no parent. */
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
function takesSpace(item: DensityItem): boolean {
  const r = item.rect;
  if (r === null || r.w <= 0 || r.h <= 0) return false;
  return item.visibility !== 'hidden' && item.visibility !== 'no-layout';
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Members split into rows: bands whose tops agree within the tolerance. */
function rowsOf(members: readonly DensityItem[]): DensityItem[][] {
  const sorted = members.slice().sort((a, b) => a.rect!.y - b.rect!.y);
  const rows: DensityItem[][] = [];
  let bandTop = -Infinity;
  for (const m of sorted) {
    if (rows.length > 0 && m.rect!.y - bandTop <= DENSITY_REPEAT_TOLERANCE_PX) {
      rows[rows.length - 1].push(m);
    } else {
      rows.push([m]);
      bandTop = m.rect!.y;
    }
  }
  return rows;
}

/**
 * A row's estimated line bands: `null` when a text leaf lacks a readable text
 * length, a font size, a line height or a width.
 */
function rowLines(leaves: readonly DensityItem[]): { lines: number; textPx: number } | null {
  const tops: Array<{ top: number; lh: number }> = [];
  for (const leaf of leaves) {
    const r = leaf.rect;
    if (r === null) continue;
    const n = leaf.ownChars;
    if (n === null) return null;
    if (n === 0) continue;
    if (leaf.fontPx === null || leaf.lineHeightPx === null || r.w <= 0) return null;
    const lines = Math.max(1, Math.ceil((n * DENSITY_CHAR_WIDTH_EM * leaf.fontPx) / r.w));
    for (let k = 0; k < lines; k++)
      tops.push({ top: r.y + k * leaf.lineHeightPx, lh: leaf.lineHeightPx });
  }
  tops.sort((a, b) => a.top - b.top);
  let lines = 0;
  let textPx = 0;
  let bandTop = -Infinity;
  let bandLh = 0;
  for (const t of tops) {
    // A line whose top falls within half a line of the band's is the same band.
    if (lines > 0 && t.top - bandTop < bandLh / 2) {
      if (t.lh > bandLh) {
        textPx += t.lh - bandLh;
        bandLh = t.lh;
      }
      continue;
    }
    lines++;
    textPx += t.lh;
    bandTop = t.top;
    bandLh = t.lh;
  }
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
export function densitySubtree(capture: DensityCapture, ids: Iterable<string>): Set<string> {
  const children = densityChildren(capture);
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

/** A text, search, select or combobox control. */
export function isDensityFinderControl(item: DensityItem): boolean {
  return item.tag === 'select' || (item.role !== null && FINDER_ROLES.has(item.role));
}

function centreY(item: DensityItem): number | null {
  return item.rect === null ? null : item.rect.y + item.rect.h / 2;
}

/**
 * The items in which a repeat's finder, filters and pager are looked for: the
 * block that holds a leaf of its first row, and the subtree of its parent,
 * less the repeat's own subtree. `by` is `null` when it has neither.
 */
export function densityRepeatScope(
  capture: DensityCapture,
  repeat: Pick<DensityRepeat, 'members' | 'parent' | 'firstRow'>,
  blocks: DensityBlocks
): { by: DensityRepeatScopeBy | null; ids: Set<string>; own: Set<string> } {
  const own = densitySubtree(capture, repeat.members);
  const byId = new Map(capture.items.map((i) => [i.id, i]));
  const firstRowIds = repeat.members.filter((id) => {
    const r = byId.get(id)?.rect ?? null;
    return r !== null && r.y - repeat.firstRow.topPx <= DENSITY_REPEAT_TOLERANCE_PX;
  });
  const firstRowSubtree = densitySubtree(capture, firstRowIds);
  const ids = new Set<string>();
  let fromBlock = false;
  let fromParent = false;
  // The innermost block holding a first-row leaf: the one with the fewest members.
  const holding = blocks.blocks
    .filter((b) => b.members.some((m) => firstRowSubtree.has(m)))
    .sort((a, b) => a.members.length - b.members.length)[0];
  if (holding) {
    fromBlock = true;
    holding.members.forEach((m) => ids.add(m));
  }
  if (repeat.parent !== null) {
    fromParent = true;
    densitySubtree(capture, [repeat.parent]).forEach((m) => ids.add(m));
    ids.delete(repeat.parent);
  }
  for (const id of own) ids.delete(id);
  const by: DensityRepeatScopeBy | null =
    fromBlock && fromParent ? 'block+parent' : fromBlock ? 'block' : fromParent ? 'parent' : null;
  return { by, ids, own };
}

/** The ids a control names when it acts on the repeat: its parent, its members and their subtrees. */
export function densityRepeatTargets(
  capture: DensityCapture,
  repeat: Pick<DensityRepeat, 'members' | 'parent'>
): Set<string> {
  const out = densitySubtree(capture, repeat.members);
  if (repeat.parent !== null) out.add(repeat.parent);
  return out;
}

interface Group {
  by: DensityRepeatBy;
  parent: string | null;
  tag: string;
  members: DensityItem[];
}

/**
 * Every repeat of `capture`, in document order. `targets` supplies the
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
  const byId = new Map(capture.items.map((i) => [i.id, i]));
  const captureIndex = new Map(capture.items.map((it, i) => [it.id, i]));

  const eligible = capture.items.filter(takesSpace);
  const groups: Group[] = [];

  // ---- by path: one parent, one ancestor path, one tag ----
  const byPath = new Map<string, Group>();
  for (const item of eligible) {
    if (item.structureBy !== 'xpath' || item.path === null) continue;
    const key = `${item.parent ?? ''}\u0000${item.path.join('/')}\u0000${item.tag}`;
    const g = byPath.get(key);
    if (g) g.members.push(item);
    else byPath.set(key, { by: 'path', parent: item.parent, tag: item.tag, members: [item] });
  }
  const inPathRepeat = new Set<string>();
  for (const g of byPath.values()) {
    if (rowsOf(g.members).length < DENSITY_REPEAT_MIN_ROWS) continue;
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
    const clusters: DensityItem[][] = [];
    for (const item of list) {
      const r = item.rect!;
      const home = clusters.find((c) => {
        const a = c[0].rect!;
        return (
          Math.abs(a.x - r.x) <= DENSITY_REPEAT_TOLERANCE_PX &&
          Math.abs(a.w - r.w) <= DENSITY_REPEAT_TOLERANCE_PX
        );
      });
      if (home) home.push(item);
      else clusters.push([item]);
    }
    for (const c of clusters) {
      if (rowsOf(c).length < DENSITY_REPEAT_MIN_ROWS) continue;
      groups.push({ by: 'geometry', parent: c[0].parent, tag: c[0].tag, members: c });
    }
  }

  const children = densityChildren(capture);
  /** The leaves at or below an item. */
  const leavesUnder = (id: string): DensityItem[] => {
    const out: DensityItem[] = [];
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      // A leaf that takes no space (a closed menu's items) draws no line in the row.
      if (leafSet.has(cur) && takesSpace(byId.get(cur)!)) out.push(byId.get(cur)!);
      for (const c of children.get(cur) ?? []) stack.push(c);
    }
    return out;
  };

  const usable = pins.usableHeightPx;
  const volume =
    inputs.volume !== undefined && Number.isInteger(inputs.volume) && inputs.volume >= 1
      ? inputs.volume
      : null;

  const repeats = groups.map((g): DensityRepeat => {
    const rows = rowsOf(g.members);
    const ordered = rows.flatMap((row) =>
      row.slice().sort((a, b) => captureIndex.get(a.id)! - captureIndex.get(b.id)!)
    );
    const bands = rows.map((row) => ({
      topPx: Math.min(...row.map((m) => m.rect!.y)),
      bottomPx: Math.max(...row.map((m) => m.rect!.y + m.rect!.h)),
    }));
    const pitches: number[] = [];
    for (let i = 1; i < bands.length; i++) pitches.push(bands[i].topPx - bands[i - 1].topPx);
    const rowPitchPx = median(pitches)!;

    const lineCounts: number[] = [];
    const textPx: number[] = [];
    const values: number[] = [];
    const fills: number[] = [];
    for (const row of rows) {
      const rowLeaves = row.flatMap((m) => leavesUnder(m.id));
      const est = rowLines(rowLeaves);
      if (est !== null) {
        lineCounts.push(est.lines);
        textPx.push(est.textPx);
      }
      values.push(rowLeaves.filter((l) => kindOf.get(l.id) === 'value').length);
      const left = Math.min(...row.map((m) => m.rect!.x));
      const right = Math.max(...row.map((m) => m.rect!.x + m.rect!.w));
      const fill = widthFillOf(rowLeaves, left, right);
      if (fill !== null) fills.push(fill);
    }
    const rowTextPx = median(textPx);
    const first = bands[0];
    const last = bands[bands.length - 1];
    const bottom = Math.max(...g.members.map((m) => m.rect!.y + m.rect!.h));
    const extentPx = bottom - first.topPx;
    return {
      id: `repeat:${ordered[0].id}`,
      by: g.by,
      parent: g.parent,
      tag: g.tag,
      members: ordered.map((m) => m.id),
      rows: rows.length,
      perRow: Math.max(...rows.map((r) => r.length)),
      firstRow: first,
      lastRow: last,
      rowPitchPx,
      linesBasis: 'estimated',
      linesPerRow: median(lineCounts),
      rowTextPx,
      rowFill: rowTextPx === null ? null : rowTextPx / rowPitchPx,
      rowsEstimated: lineCounts.length,
      valuesPerRow: median(values)!,
      widthFill: median(fills),
      rowsPerScreen: usable / rowPitchPx,
      extentPx,
      extentAtVolume:
        volume === null
          ? {
              unknown: 'no_expectation',
              reason:
                'no row volume was declared (the budget names the rows each list is judged at)',
            }
          : { volume, px: extentPx + (volume - rows.length) * rowPitchPx },
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
  for (const rep of repeats) {
    const scope = densityRepeatScope(capture, rep, blocks);
    rep.scope = scope.by;
    const aimed = densityRepeatTargets(capture, rep);
    let finder: DensityRepeatFinder | null = null;
    for (const item of capture.items) {
      if (scope.own.has(item.id) || !isDensityFinderControl(item)) continue;
      if (item.filters !== null && aimed.has(item.filters)) {
        finder = { id: item.id, by: 'relationship' };
        break;
      }
    }
    if (finder === null) {
      const above = capture.items
        .filter((i) => scope.ids.has(i.id) && i.interactive && isDensityFinderControl(i))
        .filter((i) => {
          const y = centreY(i);
          return y !== null && y < rep.firstRow.topPx;
        })
        .sort((a, b) => a.rect!.y - b.rect!.y || captureIndex.get(a.id)! - captureIndex.get(b.id)!);
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
  | {
      structureResolved: true;
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
  const all = repeats ?? densityRepeats(capture, targets);
  const byBasis: Record<DensityRepeatBy, number> = { path: 0, geometry: 0 };
  for (const r of all) byBasis[r.by]++;
  const list = all
    .slice(0, Math.max(0, cap))
    .map((r): DensityRepeatSummary => ({ ...r, members: r.members.length }));
  return {
    structureResolved: true,
    byBasis,
    shown: list.length,
    total: all.length,
    truncated: list.length < all.length,
    list,
  };
}
