/**
 * The planning half's one primitive: `applyDensityEdits(capture, edits)`, the
 * reflow `column-shift@1`. A prediction is `measureDensity` of what this
 * returns — the same function that measures a real capture — so a prediction
 * and its re-measurement share every definition.
 *
 * **`column-shift@1`.** When a subject's height changes by Δ, every item below
 * it whose x-range overlaps the subject's by more than half the narrower width
 * moves by Δ; an item that encloses the subject (a wrapper, a list, `main`)
 * grows by Δ instead. Nothing else moves: no width changes, so no text rewraps
 * (`no-rewrap`), and one column is assumed to flow independently of its
 * neighbours (`single-column`). The reflow DECLINES — the edit answers
 * `unknown{not_attempted_by_policy}` — where those assumptions visibly fail:
 *
 * - **columns rebalance**: an item that would move also lies below an item
 *   standing beside the subject in another column (a full-width footer under a
 *   main column and a sidebar is placed by the taller of the two, which a
 *   shift of one cannot tell);
 * - an item **overlaps the subject in its column** without being part of it
 *   or enclosing it (moving one would split the other);
 * - the subject holds a **pinned** item (a fixed or sticky bar is not in the
 *   flow the shift models).
 *
 * The subject of an edit is the ids it names, every registered item below
 * them, and every ancestor whose rect lies inside their extent (a list row's
 * container). Its extent is the union of those items' rects.
 *
 * Edits (all in document space; ids are the capture's):
 *
 * - `resize` — the subject's slot changes height by `deltaPx`: the items below
 *   move, the subject's containers spanning its whole extent take the change,
 *   and its leaves keep their size;
 * - `move` — the subject is taken out of the flow (what followed it moves up
 *   by its pitch: its top to the top of the next item below it in its column
 *   inside its enclosing container; as a container's last item, its height
 *   plus the gap above it, so the container keeps its padding; at the top
 *   level with nothing below, its height) and put back in front of whatever
 *   followed `below` inside `below`'s container (or, when nothing does, under
 *   `below`'s extent with the subject's trailing gap between them). Its roots
 *   take `below`'s parent;
 * - `collapse` — the subject goes behind a toggle: a summary row of
 *   `summaryPx` (the new control `toggle`, `aria-expanded=false`, controlling
 *   the new container `container` that holds the subject) takes its place,
 *   and its items are hidden where they would sit once it is opened. Every ask
 *   answered inside it gains the one interaction of opening it;
 * - `line-up` — a row's leaves are placed side by side on its first line,
 *   `gapPx` apart, keeping their sizes; the row's slot shrinks by the line
 *   bands it no longer needs. Refused when they do not fit the row's width;
 * - `abbreviate` — a label is narrowed to `widthPx`, its full form recoverable
 *   (it reads as truncated, recoverable);
 * - `insert` — a new control `id` of role `searchbox`, `widthPx` × `heightPx`,
 *   is put directly above `above` (a finder above a list's first row);
 * - `remove` — the subject is deleted; what followed it in its column moves up
 *   by its pitch (as for `move`), unless a sibling beside it in its row holds
 *   its band (a control inline with text frees no height; a sidebar in
 *   another column is not in the row).
 *
 * The document's height follows its lowest laid-out item: a shift in a column
 * that does not reach the page's bottom (a main column beside a taller
 * sidebar) leaves it alone. No edit changes a font size or a line height.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 7).
 */

import type { UnknownCode } from '../observation/observation';
import type { DensityCapture, DensityItem, DensityRect } from './schema';
import { densityPinnedIds, densityPins } from './structure';

/** The reflow every prediction is made under. */
export const DENSITY_REFLOW = 'column-shift@1' as const;

/** What a prediction under {@link DENSITY_REFLOW} assumes. */
export type DensityEditAssumption = 'single-column' | 'no-rewrap';

/** Every prediction names both. */
export const DENSITY_EDIT_ASSUMPTIONS: readonly DensityEditAssumption[] = [
  'single-column',
  'no-rewrap',
];

/** One edit of a capture. */
export type DensityEdit =
  | { op: 'resize'; subject: string[]; deltaPx: number }
  | { op: 'move'; subject: string[]; below: string[] }
  | { op: 'collapse'; subject: string[]; summaryPx: number; toggle: string; container: string }
  | { op: 'line-up'; row: string[]; gapPx: number }
  | { op: 'abbreviate'; item: string; widthPx: number }
  | {
      op: 'insert';
      id: string;
      role: 'searchbox';
      above: string[];
      widthPx: number;
      heightPx: number;
    }
  | { op: 'remove'; subject: string[] };

/** What applying a list of edits answers. */
export type DensityEditResult =
  | {
      ok: true;
      capture: DensityCapture;
      reflow: typeof DENSITY_REFLOW;
      assumptions: DensityEditAssumption[];
      /** Items moved or resized, summed over the edits. */
      shifted: number;
    }
  | {
      ok: false;
      /** The index of the edit that could not be applied. */
      edit: number;
      unknown: UnknownCode;
      reason: string;
    };

/** Half a pixel: the tolerance every edge comparison takes. */
const EPS = 0.5;

class Decline extends Error {
  constructor(
    readonly code: UnknownCode,
    message: string
  ) {
    super(message);
  }
}

interface State {
  items: DensityItem[];
  byId: Map<string, DensityItem>;
  /** Pinned items of the ORIGINAL capture (and everything inside one): never moved. */
  pinned: Set<string>;
  documentHeight: number;
  shifted: number;
}

/** Whether `b` shifts with a subject of extent `a`: x-ranges overlapping by more than half the narrower width. */
function shareColumn(a: DensityRect, b: DensityRect): boolean {
  const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return overlap > 0.5 * Math.min(a.w, b.w);
}

function bottomOf(r: DensityRect): number {
  return r.y + r.h;
}

function extentOf(rects: readonly DensityRect[]): DensityRect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map(bottomOf));
  return { x, y, w: right - x, h: bottom - y };
}

function contains(outer: DensityRect, inner: DensityRect): boolean {
  return (
    outer.x <= inner.x + EPS &&
    outer.y <= inner.y + EPS &&
    outer.x + outer.w >= inner.x + inner.w - EPS &&
    bottomOf(outer) >= bottomOf(inner) - EPS
  );
}

function childrenOf(state: State): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const item of state.items) {
    if (item.parent === null) continue;
    const list = out.get(item.parent);
    if (list) list.push(item.id);
    else out.set(item.parent, [item.id]);
  }
  return out;
}

function lookup(state: State, id: string, what: string): DensityItem {
  const item = state.byId.get(id);
  if (!item)
    throw new Decline('input_missing', `${what} names ${id}, which the capture does not hold`);
  return item;
}

/** Ids, their registered descendants, and every ancestor that lies inside their extent. */
function closure(state: State, ids: readonly string[], what: string): Set<string> {
  if (ids.length === 0) throw new Decline('input_missing', `${what} names no item`);
  const children = childrenOf(state);
  const out = new Set<string>();
  const addSubtree = (id: string) => {
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (out.has(cur)) continue;
      out.add(cur);
      for (const c of children.get(cur) ?? []) stack.push(c);
    }
  };
  for (const id of ids) {
    lookup(state, id, what);
    addSubtree(id);
  }
  const ext = extentOf(rectsOf(state, out));
  if (ext !== null) {
    for (const id of [...out]) {
      const seen = new Set<string>();
      let parent = state.byId.get(id)?.parent ?? null;
      while (parent !== null && !seen.has(parent)) {
        seen.add(parent);
        const p = state.byId.get(parent);
        if (!p || p.rect === null || !contains(ext, p.rect)) break;
        addSubtree(parent);
        parent = p.parent;
      }
    }
  }
  return out;
}

function rectsOf(state: State, ids: Iterable<string>): DensityRect[] {
  const out: DensityRect[] = [];
  for (const id of ids) {
    const r = state.byId.get(id)?.rect;
    if (r) out.push(r);
  }
  return out;
}

function subjectExtent(state: State, subject: Set<string>, what: string): DensityRect {
  for (const id of subject) {
    if (state.pinned.has(id)) {
      throw new Decline(
        'not_attempted_by_policy',
        `${what} holds the pinned item ${id}, which ${DENSITY_REFLOW} does not move`
      );
    }
  }
  const ext = extentOf(rectsOf(state, subject));
  if (ext === null) throw new Decline('input_missing', `${what} has no item with a rect`);
  return ext;
}

function isLaidOut(item: DensityItem): boolean {
  return item.visibility !== 'hidden' && item.visibility !== 'no-layout';
}

/**
 * The column shift: the subject (extent `ext`, which may be a line of height 0
 * for an insertion point) changes height by `delta`. Items below it in its
 * column move; items enclosing it grow. Declines on a rebalance or an overlap.
 */
function shift(
  state: State,
  subject: ReadonlySet<string>,
  ext: DensityRect,
  delta: number,
  what: string,
  /** Items that enclose an insertion point even when their top is on it (the anchor's ancestors). */
  ancestors: ReadonlySet<string> = new Set()
): void {
  if (delta === 0) return;
  const bottom = bottomOf(ext);
  const point = ext.h === 0;
  const moved: DensityItem[] = [];
  const grown: DensityItem[] = [];
  const beside: DensityItem[] = [];
  for (const item of state.items) {
    const r = item.rect;
    if (r === null || subject.has(item.id) || state.pinned.has(item.id)) continue;
    const encloses = point
      ? r.x <= ext.x + EPS &&
        r.x + r.w >= ext.x + ext.w - EPS &&
        (r.y < ext.y || (ancestors.has(item.id) && r.y <= ext.y + EPS)) &&
        bottomOf(r) > ext.y
      : contains(r, ext);
    if (encloses) {
      grown.push(item);
      continue;
    }
    if (r.y >= bottom - EPS) {
      if (shareColumn(ext, r)) moved.push(item);
      continue;
    }
    const overlapsBand = point
      ? r.y < ext.y && bottomOf(r) > ext.y
      : r.y < bottom && bottomOf(r) > ext.y;
    if (!overlapsBand) continue;
    if (shareColumn(ext, r)) {
      throw new Decline(
        'not_attempted_by_policy',
        `${what}: ${item.id} overlaps the subject in its column without being part of it, which ${DENSITY_REFLOW} cannot split`
      );
    }
    if (isLaidOut(item) && r.w * r.h > 0) beside.push(item);
  }
  for (const m of moved) {
    for (const s of beside) {
      if (shareColumn(s.rect!, m.rect!) && m.rect!.y >= bottomOf(s.rect!) - EPS) {
        throw new Decline(
          'not_attempted_by_policy',
          `${what}: columns rebalance — ${m.id} lies below both the subject and ${s.id} beside it, so where it lands depends on which column is taller`
        );
      }
    }
  }
  for (const m of moved) m.rect = { ...m.rect!, y: m.rect!.y + delta };
  for (const g of grown) g.rect = { ...g.rect!, h: Math.max(0, g.rect!.h + delta) };
  state.shifted += moved.length + grown.length;
}

/** The top of the first item below `ext` in its column, among those not in `skip`. */
function nextBelow(state: State, ext: DensityRect, skip: ReadonlySet<string>): number | null {
  let next: number | null = null;
  for (const item of state.items) {
    const r = item.rect;
    if (r === null || skip.has(item.id) || state.pinned.has(item.id)) continue;
    if (r.y < bottomOf(ext) - EPS || !shareColumn(ext, r)) continue;
    if (next === null || r.y < next) next = r.y;
  }
  return next;
}

/** The smallest item, outside the subject, whose rect holds the subject's extent; `null` at the top level. */
function enclosingOf(
  state: State,
  subject: ReadonlySet<string>,
  ext: DensityRect
): DensityRect | null {
  let best: DensityRect | null = null;
  for (const item of state.items) {
    const r = item.rect;
    if (r === null || subject.has(item.id) || state.pinned.has(item.id) || !contains(r, ext))
      continue;
    if (best === null || r.w * r.h < best.w * best.h) best = r;
  }
  return best;
}

/**
 * The height the subject frees when it leaves the flow: its top to the top of
 * the next item below it in its column INSIDE its enclosing container; when
 * it is the container's last item, its height plus the gap above it (to the
 * item before it in the container, else none), so the container keeps its own
 * padding. At the top level, the next item anywhere below, else its height.
 */
function pitchOf(state: State, subject: ReadonlySet<string>, ext: DensityRect): number {
  const box = enclosingOf(state, subject, ext);
  const inBox = (r: DensityRect) => box === null || contains(box, r);
  let next: number | null = null;
  let prevBottom: number | null = null;
  for (const item of state.items) {
    const r = item.rect;
    if (r === null || subject.has(item.id) || state.pinned.has(item.id) || !inBox(r)) continue;
    if (box !== null && contains(r, ext)) continue;
    if (!shareColumn(ext, r)) continue;
    if (r.y >= bottomOf(ext) - EPS) {
      if (next === null || r.y < next) next = r.y;
    } else if (bottomOf(r) <= ext.y + EPS) {
      if (prevBottom === null || bottomOf(r) > prevBottom) prevBottom = bottomOf(r);
    }
  }
  if (next !== null) return next - ext.y;
  if (box === null) return ext.h;
  return ext.h + (prevBottom === null ? 0 : ext.y - prevBottom);
}

/** Every registered ancestor of some roots. */
function ancestorsOf(state: State, roots: readonly DensityItem[]): Set<string> {
  const out = new Set<string>();
  for (const r of roots) {
    let cur = r.parent;
    while (cur !== null && !out.has(cur)) {
      out.add(cur);
      cur = state.byId.get(cur)?.parent ?? null;
    }
  }
  return out;
}

/**
 * The lowest bottom of the laid-out items that size the document: what the
 * document's height follows. `sizes` says which do; it is decided once, from
 * the capture as given (see {@link applyDensityEdits}), so an item an edit
 * pushes past the old end still counts.
 */
function lowestBottom(
  items: readonly DensityItem[],
  sizes: (item: DensityItem) => boolean
): number | null {
  let low: number | null = null;
  for (const i of items) {
    if (i.rect === null || !isLaidOut(i) || !sizes(i)) continue;
    if (low === null || bottomOf(i.rect) > low) low = bottomOf(i.rect);
  }
  return low;
}

/** The nearest registered item that is an ancestor of every root, or `null`. */
function commonParent(state: State, roots: readonly DensityItem[]): string | null {
  const chain = (id: string | null): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    let cur = id;
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = state.byId.get(cur)?.parent ?? null;
    }
    return out;
  };
  const chains = roots.map((r) => new Set(chain(r.parent)));
  for (const candidate of chain(roots[0]?.parent ?? null)) {
    if (chains.every((c) => c.has(candidate))) return candidate;
  }
  return null;
}

function commonPrefix(paths: ReadonlyArray<string[] | null>): string[] | null {
  if (paths.length === 0 || paths.some((p) => p === null)) return null;
  const first = paths[0]!;
  let n = first.length;
  for (const p of paths) {
    let i = 0;
    while (i < n && i < p!.length && p![i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n);
}

function sameOrNull<T>(values: readonly T[]): T | null {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : null;
}

/** A synthetic item placed by an edit: every unknown field is stated as `null`. */
function syntheticItem(
  fields: Pick<
    DensityItem,
    'id' | 'parent' | 'path' | 'structureBy' | 'tag' | 'role' | 'interactive' | 'landmark' | 'rect'
  > &
    Partial<DensityItem>
): DensityItem {
  return {
    authorId: false,
    visibility: 'rendered',
    chars: 0,
    ownChars: 0,
    charsDrawn: true,
    blockKey: null,
    siblingKey: null,
    cousinKey: null,
    cousinRowKey: null,
    textHash: null,
    shape: null,
    fontPx: null,
    lineHeightPx: null,
    position: 'static',
    truncated: false,
    recoverable: null,
    expanded: null,
    controls: null,
    selected: null,
    filters: null,
    href: null,
    ...fields,
  };
}

function insertBefore(state: State, beforeId: string, added: DensityItem[]): void {
  const at = state.items.findIndex((i) => i.id === beforeId);
  state.items.splice(at < 0 ? state.items.length : at, 0, ...added);
  for (const a of added) {
    if (state.byId.has(a.id)) {
      throw new Decline(
        'input_missing',
        `the new item ${a.id} would reuse an id the capture holds`
      );
    }
    state.byId.set(a.id, a);
  }
}

function rootsOf(state: State, subject: ReadonlySet<string>): DensityItem[] {
  return state.items.filter(
    (i) => subject.has(i.id) && (i.parent === null || !subject.has(i.parent))
  );
}

/** Leaves of a set: what has no registered child in the capture. */
function leavesIn(state: State, ids: ReadonlySet<string>): DensityItem[] {
  const children = childrenOf(state);
  return state.items.filter((i) => ids.has(i.id) && !children.has(i.id));
}

/**
 * Containers of the subject that span its whole extent take a change of its
 * height, never shrinking above the bottom of the leaves they hold (leaves
 * keep their size and place).
 */
function growSpanning(
  state: State,
  subject: ReadonlySet<string>,
  ext: DensityRect,
  delta: number
): void {
  const leafItems = leavesIn(state, subject);
  const leaves = new Set(leafItems.map((l) => l.id));
  const leafBottom = Math.max(
    -Infinity,
    ...leafItems.filter((l) => l.rect !== null).map((l) => bottomOf(l.rect!))
  );
  for (const id of subject) {
    const item = state.byId.get(id)!;
    const r = item.rect;
    if (r === null || leaves.has(id)) continue;
    if (Math.abs(r.y - ext.y) <= EPS && Math.abs(bottomOf(r) - bottomOf(ext)) <= EPS) {
      item.rect = { ...r, h: Math.max(0, r.h + delta, leafBottom - r.y) };
    }
  }
}

function positive(n: number, what: string): void {
  if (!Number.isFinite(n) || n <= 0)
    throw new Decline('input_missing', `${what} must be a positive number of px`);
}

function applyOne(state: State, edit: DensityEdit, what: string): void {
  switch (edit.op) {
    case 'resize': {
      if (!Number.isFinite(edit.deltaPx))
        throw new Decline('input_missing', `${what}: deltaPx must be finite`);
      const s = closure(state, edit.subject, what);
      const ext = subjectExtent(state, s, what);
      shift(state, s, ext, edit.deltaPx, what);
      growSpanning(state, s, ext, edit.deltaPx);
      return;
    }
    case 'move': {
      const s = closure(state, edit.subject, what);
      const ext = subjectExtent(state, s, what);
      const p = pitchOf(state, s, ext);
      const anchorIds = closure(state, edit.below, `${what} (below)`);
      for (const id of anchorIds) {
        if (s.has(id)) {
          throw new Decline('input_missing', `${what}: ${id} is both the subject and the anchor`);
        }
      }
      // Out of the flow.
      shift(state, s, ext, -p, what);
      // Back in, in front of whatever followed the anchor inside the anchor's
      // own container; when nothing does, under the anchor with the subject's
      // own trailing gap between them.
      const anchor = subjectExtent(state, anchorIds, `${what} (below)`);
      const anchorRoots = rootsOf(state, anchorIds);
      const box = enclosingOf(state, new Set([...s, ...anchorIds]), anchor);
      const below = { x: ext.x, y: anchor.y, w: ext.w, h: anchor.h };
      const nextTop = nextBelow(state, below, new Set([...s, ...anchorIds]));
      const next =
        nextTop !== null && (box === null || nextTop < bottomOf(box) - EPS) ? nextTop : null;
      const y = next ?? bottomOf(anchor) + (p - ext.h);
      const newAncestors = ancestorsOf(state, anchorRoots);
      shift(state, s, { x: ext.x, y, w: ext.w, h: 0 }, p, what, newAncestors);
      const dy = y - ext.y;
      for (const id of s) {
        const item = state.byId.get(id)!;
        if (item.rect) item.rect = { ...item.rect, y: item.rect.y + dy };
      }
      // A container with no padding below the anchor ends where the anchor
      // did: it grows to hold the subject it now holds.
      const placedBottom = y + ext.h;
      for (const id of newAncestors) {
        const a = state.byId.get(id);
        if (!a || a.rect === null || state.pinned.has(id)) continue;
        if (bottomOf(a.rect) < placedBottom) a.rect = { ...a.rect, h: placedBottom - a.rect.y };
      }
      // The subject now sits in the anchor's parent.
      const parent = commonParent(state, anchorRoots);
      for (const r of rootsOf(state, s)) r.parent = parent;
      state.shifted += s.size;
      return;
    }
    case 'collapse': {
      positive(edit.summaryPx, `${what}: summaryPx`);
      const s = closure(state, edit.subject, what);
      const ext = subjectExtent(state, s, what);
      shift(state, s, ext, edit.summaryPx - ext.h, what);
      const roots = rootsOf(state, s);
      const parent = commonParent(state, roots);
      const path = commonPrefix(roots.map((r) => r.path));
      const structureBy = roots.every((r) => r.structureBy === 'xpath') ? 'xpath' : 'geometry';
      const landmark = sameOrNull(roots.map((r) => r.landmark));
      const blockKey = sameOrNull(leavesIn(state, s).map((l) => l.blockKey));
      const container = syntheticItem({
        id: edit.container,
        parent,
        path,
        structureBy,
        tag: 'div',
        role: null,
        interactive: false,
        landmark,
        rect: { x: ext.x, y: ext.y + edit.summaryPx, w: ext.w, h: ext.h },
        visibility: 'hidden',
        charsDrawn: null,
      });
      const toggle = syntheticItem({
        id: edit.toggle,
        parent,
        path,
        structureBy,
        tag: 'button',
        role: 'button',
        interactive: true,
        landmark,
        rect: { x: ext.x, y: ext.y, w: ext.w, h: edit.summaryPx },
        blockKey,
        expanded: false,
        controls: edit.container,
      });
      for (const id of s) {
        const item = state.byId.get(id)!;
        item.visibility = 'hidden';
        if (item.rect) item.rect = { ...item.rect, y: item.rect.y + edit.summaryPx };
      }
      for (const r of roots) r.parent = edit.container;
      insertBefore(state, roots[0].id, [toggle, container]);
      state.shifted += s.size;
      return;
    }
    case 'line-up': {
      if (!Number.isFinite(edit.gapPx) || edit.gapPx < 0) {
        throw new Decline('input_missing', `${what}: gapPx must be 0 or more`);
      }
      const s = closure(state, edit.row, what);
      const ext = subjectExtent(state, s, what);
      const leaves = leavesIn(state, s)
        .filter((l) => l.rect !== null)
        .sort((a, b) => a.rect!.y - b.rect!.y || a.rect!.x - b.rect!.x);
      if (leaves.length === 0)
        throw new Decline('input_missing', `${what}: the row has no leaf with a rect`);
      const top = Math.min(...leaves.map((l) => l.rect!.y));
      const oldBand = Math.max(...leaves.map((l) => bottomOf(l.rect!))) - top;
      const width =
        leaves.reduce((sum, l) => sum + l.rect!.w, 0) + edit.gapPx * (leaves.length - 1);
      if (width > ext.w + EPS) {
        throw new Decline(
          'not_attempted_by_policy',
          `${what}: the row's leaves need ${width} px side by side and the row is ${ext.w} px wide`
        );
      }
      const delta = Math.max(...leaves.map((l) => l.rect!.h)) - oldBand;
      shift(state, s, ext, delta, what);
      let x = ext.x;
      for (const l of leaves) {
        l.rect = { ...l.rect!, x, y: top };
        x += l.rect.w + edit.gapPx;
      }
      // After the leaves are in place: the row's containers shrink to what they now hold.
      growSpanning(state, s, ext, delta);
      state.shifted += leaves.length;
      return;
    }
    case 'abbreviate': {
      const item = lookup(state, edit.item, what);
      positive(edit.widthPx, `${what}: widthPx`);
      if (item.rect === null) throw new Decline('input_missing', `${what}: ${item.id} has no rect`);
      if (edit.widthPx >= item.rect.w) {
        throw new Decline('input_missing', `${what}: ${item.id} is already ${item.rect.w} px wide`);
      }
      item.rect = { ...item.rect, w: edit.widthPx };
      item.truncated = true;
      item.recoverable = true;
      state.shifted++;
      return;
    }
    case 'insert': {
      positive(edit.heightPx, `${what}: heightPx`);
      positive(edit.widthPx, `${what}: widthPx`);
      const a = closure(state, edit.above, what);
      const ext = subjectExtent(state, a, what);
      shift(
        state,
        new Set(),
        { x: ext.x, y: ext.y, w: ext.w, h: 0 },
        edit.heightPx,
        what,
        ancestorsOf(state, rootsOf(state, a))
      );
      // The anchor itself is at the insertion point, so it moved down with what follows.
      const roots = rootsOf(state, a);
      const parent = commonParent(state, roots);
      const finder = syntheticItem({
        id: edit.id,
        parent,
        path: commonPrefix(roots.map((r) => r.path)),
        structureBy: roots.every((r) => r.structureBy === 'xpath') ? 'xpath' : 'geometry',
        tag: 'input',
        role: edit.role,
        interactive: true,
        landmark: sameOrNull(roots.map((r) => r.landmark)),
        rect: { x: ext.x, y: ext.y, w: edit.widthPx, h: edit.heightPx },
        blockKey: sameOrNull(leavesIn(state, a).map((l) => l.blockKey)),
      });
      insertBefore(state, roots[0].id, [finder]);
      return;
    }
    case 'remove': {
      const s = closure(state, edit.subject, what);
      const ext = subjectExtent(state, s, what);
      // A sibling beside the subject in its row (one parent, a band no taller
      // than half again the subject's) holds that band's height: removing a
      // control inline with text frees none. A sidebar in another column is
      // not in the row and holds nothing.
      const parents = new Set(rootsOf(state, s).map((r) => r.parent));
      const held = state.items.some((i) => {
        const r = i.rect;
        if (r === null || s.has(i.id) || !isLaidOut(i) || contains(r, ext)) return false;
        if (!parents.has(i.parent) || r.h > 1.5 * ext.h) return false;
        const overlap = Math.min(bottomOf(r), bottomOf(ext)) - Math.max(r.y, ext.y);
        return overlap > 0.5 * ext.h && !shareColumn(ext, r);
      });
      if (!held) shift(state, s, ext, -pitchOf(state, s, ext), what);
      state.items = state.items.filter((i) => !s.has(i.id));
      for (const id of s) state.byId.delete(id);
      state.shifted += s.size;
      return;
    }
  }
}

/**
 * Apply edits to a capture under `column-shift@1`. Answers the edited capture
 * (a new object; the input is not changed) or the unknown that stopped it:
 * `input_missing` for an edit naming what the capture lacks,
 * `not_attempted_by_policy` where the reflow declines (columns rebalance, an
 * overlap it cannot split, a pinned subject).
 */
export function applyDensityEdits(
  capture: DensityCapture,
  edits: readonly DensityEdit[]
): DensityEditResult {
  if (!capture.structureResolved) {
    return {
      ok: false,
      edit: 0,
      unknown: 'input_missing',
      reason:
        'the capture has no resolved structure (structureResolved: false), so its subjects cannot be found',
    };
  }
  const items = capture.items.map((i) => ({ ...i, rect: i.rect ? { ...i.rect } : null }));
  const state: State = {
    items,
    byId: new Map(items.map((i) => [i.id, i])),
    pinned: densityPinnedIds(capture, densityPins(capture)),
    documentHeight: capture.viewport.documentHeight,
    shifted: 0,
  };
  // Items that size the document: those inside it as captured (content past
  // its end is an inner scroller's), and every item an edit adds.
  const docEnd = capture.viewport.documentHeight + 1;
  const original = new Set(capture.items.map((i) => i.id));
  const inside = new Set(
    capture.items.filter((i) => i.rect !== null && bottomOf(i.rect) <= docEnd).map((i) => i.id)
  );
  const sizes = (i: DensityItem) => inside.has(i.id) || !original.has(i.id);
  const lowBefore = lowestBottom(state.items, sizes);
  for (let n = 0; n < edits.length; n++) {
    try {
      applyOne(state, edits[n], `edit ${n} (${edits[n].op})`);
    } catch (err) {
      if (err instanceof Decline)
        return { ok: false, edit: n, unknown: err.code, reason: err.message };
      throw err;
    }
  }
  // The document follows its lowest laid-out item: a shift in a column that
  // does not reach the bottom (a main column beside a taller sidebar) leaves
  // the document's height alone.
  const lowAfter = lowestBottom(state.items, sizes);
  const documentHeight =
    lowBefore !== null && lowAfter !== null
      ? Math.max(0, state.documentHeight + (lowAfter - lowBefore))
      : state.documentHeight;
  return {
    ok: true,
    capture: {
      ...capture,
      viewport: { ...capture.viewport, documentHeight },
      items: state.items,
    },
    reflow: DENSITY_REFLOW,
    assumptions: [...DENSITY_EDIT_ASSUMPTIONS],
    shifted: state.shifted,
  };
}

/** Every item id an edit acts on (its subject, row, item, anchor): what two proposals conflict over. */
export function densityEditSubjects(edit: DensityEdit): string[] {
  switch (edit.op) {
    case 'resize':
    case 'collapse':
    case 'remove':
      return [...edit.subject];
    case 'move':
      return [...edit.subject, ...edit.below];
    case 'line-up':
      return [...edit.row];
    case 'abbreviate':
      return [edit.item];
    case 'insert':
      return [...edit.above];
  }
}
