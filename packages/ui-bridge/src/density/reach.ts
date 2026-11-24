/**
 * Reach: what it costs a role to reach the answer to each of its asks.
 *
 * For an answering leaf, in document space at scroll 0 (`ledger.ts`,
 * `densityPlacedRects`):
 *
 * - `scrollPx = max(0, min(bottom, top + lineHeightPx) − (H − pinBottom))`:
 *   the scroll that brings the leaf's first line above the bottom pin;
 * - `gestures = ceil(scrollPx / (0.8 · Hu))`;
 * - `interactions`: the closed disclosures, inactive tabs and closed menus
 *   around the leaf (read from the parent chain and the `controls` edges),
 *   else the ask's declared `via`; plus 1 for a truncated answer whose full
 *   form is recoverable; plus 1 to focus a find field (`findChars > 0`);
 * - `keystrokes = findChars`;
 * - `actions = gestures + interactions`;
 * - `foreignPx`: the height of chrome and of unclaimed blocks above the leaf
 *   in its column.
 *
 * Interactions are read from structure and ARIA state; no control is
 * operated (`interactionsBasis: static`).
 *
 * An answer is AVAILABLE only when it is drawn legibly once reached: not
 * occluded, not truncated without a recoverable form, its text drawn (never an
 * aria-label / title the serializer substituted for absent text), and at or
 * above the caller's floors when floors are given. Each condition the capture
 * cannot settle makes availability unknown, never true.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 5).
 */

import { resolveDensityMatchers, type DensityUnresolvedReason } from './match';
import { densitySubtree } from './repeats';
import type {
  DensityAsk,
  DensityAskKind,
  DensityCapture,
  DensityItem,
  DensityRect,
  DensityVisibility,
} from './schema';
import {
  densityChildren,
  densityIntervalUnion,
  densityPinnedIds,
  densitySameColumn,
  type DensityLeaves,
  type DensityPins,
} from './structure';

/** The legibility floors a caller may hold an answer to (the budget's `floors`). */
export interface DensityFloors {
  /** Smallest font size, px. */
  fontPx: number;
  /** Smallest line height as a multiple of the font size. */
  lineHeightRatio: number;
  /** Smallest side of a control, px. */
  targetPx: number;
  /** Vertical padding of a list row, px (read by the planning half). */
  rowPadPx: number;
}

/** A condition that makes an answer unavailable. */
export type DensityUnavailableReason =
  | 'occluded'
  | 'truncated-unrecoverable'
  | 'text-not-drawn'
  | 'below-font-floor'
  | 'below-line-height-floor'
  | 'below-target-floor';

/** A condition of availability the capture cannot settle. */
export type DensityAvailabilityUnknownReason =
  /** The capture gives no visibility for the item. */
  | 'visibility-unknown'
  /** Hidden at capture time: its legibility is read once it is shown, which a static read cannot do. */
  | 'not-rendered'
  /** Truncation was not measurable, or a truncated item has no evidence of a full form. */
  | 'truncation-unknown'
  /** Whether its text is drawn is unknown (redacted, or an old serializer). */
  | 'text-drawn-unknown'
  /** Floors were given and the item's font size, line height or size is unknown. */
  | 'floor-unknown';

/** Where `interactions` came from. */
export type DensityInteractionsBy = 'structure' | 'declared' | 'none' | 'unknown';

/** What reaching one answering item costs. */
export interface DensityItemReach {
  id: string;
  visibility: DensityVisibility | null;
  /** `null` when the item has no place (no rect, or hidden with no area) or sits in a nested scroller. */
  scrollPx: number | null;
  /** `line-height`: the first line's bottom; `element-bottom`: no line height, so the whole item (an upper bound). */
  lineBasis: 'line-height' | 'element-bottom';
  gestures: number | null;
  /** Ids of the closed disclosures, inactive tabs and closed menus around the item. */
  closedAround: string[];
  interactions: number | null;
  interactionsBy: DensityInteractionsBy;
  keystrokes: number;
  actions: number | null;
  /** Chrome and unclaimed-block height above the item in its column; `null` until computed, or with no place. */
  foreignPx: number | null;
  available: boolean | null;
  unavailableBy: DensityUnavailableReason[];
  availabilityUnknownBy: DensityAvailabilityUnknownReason[];
}

/** What reaching EVERY answering item costs (`need: all` reads this). */
export interface DensityAllReach {
  /** The item reached last (the largest scroll); `null` when no item has a known scroll. */
  lastItem: string | null;
  scrollPx: number | null;
  gestures: number | null;
  /** The distinct closed containers around all of them: opening one reveals every item inside it. */
  interactions: number | null;
  keystrokes: number;
  actions: number | null;
  foreignPx: number | null;
  /** True only when every item is available. */
  available: boolean | null;
  /** Items whose actions are unknown; while nonzero, `actions` is `null`. */
  unknownItems: number;
}

export type DensityAskState = 'rendered' | 'hidden' | 'unanswered' | 'unresolved';

/** Why an ask is unresolved, or partly so. */
export type DensityAskUnresolvedReason =
  | DensityUnresolvedReason
  | 'visibility-unknown'
  /** A resolved `text` matcher could not read some items (redacted), which may also answer. */
  | 'text-unevaluated';

/** The longest list of answer items one ask reports; the rest is counted. */
export const DENSITY_ANSWER_ITEM_CAP = 20;

/** One ask, as a role reaches it. */
export interface DensityAskReach {
  id: string;
  rank: number;
  weight: number;
  kind: DensityAskKind;
  need: 'any' | 'all';
  state: DensityAskState;
  /**
   * Why the answer is not resolved: each matcher that selected nothing
   * (`answer` order), or `visibility-unknown` when it selected only items
   * whose visibility the capture does not know. Empty when all resolved.
   */
  unresolvedBy: DensityAskUnresolvedReason[];
  /** Some matchers of the answer resolved and some did not: a nearer (or a missing) answer may be unseen. */
  partial: boolean;
  answerItems: {
    total: number;
    /** Items on the first screen as captured: rendered and needing no scroll. */
    firstScreen: number;
    shown: number;
    truncated: boolean;
    list: DensityItemReach[];
  };
  /**
   * The item reached first: the fewest actions among the items that can be
   * read, else among all of them; `null` with no answer item.
   */
  first: DensityItemReach | null;
  all: DensityAllReach | null;
  /** Of `first` for `need: any`, of `all` for `need: all`; `null` when unknown or there is no answer. */
  available: boolean | null;
}

/** The shared reading of one capture that reach needs. */
export interface DensityReachContext {
  capture: DensityCapture;
  pins: DensityPins;
  leaves: DensityLeaves;
  placed: ReadonlyMap<string, DensityRect>;
  floors: DensityFloors | null;
  byId: Map<string, DensityItem>;
  children: Map<string, string[]>;
  /** The items that control each id (`controls` / `toggles` edges). */
  controllers: Map<string, DensityItem[]>;
  /** Items whose scroll is unknown: inside a nested scroller. */
  scrollUnknown: Set<string>;
  /** Pinned items and everything inside one: on screen at every scroll position. */
  pinned: Set<string>;
}

export function densityReachContext(
  capture: DensityCapture,
  pins: DensityPins,
  leaves: DensityLeaves,
  placed: ReadonlyMap<string, DensityRect>,
  floors: DensityFloors | null = null
): DensityReachContext {
  const byId = new Map(capture.items.map((i) => [i.id, i]));
  const children = densityChildren(capture);
  const controllers = new Map<string, DensityItem[]>();
  for (const item of capture.items) {
    if (item.controls === null) continue;
    const list = controllers.get(item.controls);
    if (list) list.push(item);
    else controllers.set(item.controls, [item]);
  }
  let scrollUnknown = new Set<string>();
  const scroller = capture.bases.scroller;
  if (scroller !== null && scroller.by === 'scroll-info') {
    scrollUnknown = densitySubtree(capture, [scroller.id], children);
  } else if (scroller !== null) {
    // An unregistered scroller: the items it holds are those past the document's end.
    for (const item of capture.items) {
      const r = item.rect;
      if (r !== null && r.y + r.h > capture.viewport.documentHeight + 1) scrollUnknown.add(item.id);
    }
  }
  const pinned = densityPinnedIds(capture, pins);
  return {
    capture,
    pins,
    leaves,
    placed,
    floors,
    byId,
    children,
    controllers,
    scrollUnknown,
    pinned,
  };
}

const MENU_ROLES = new Set(['menu', 'menubar']);

/**
 * Whether `x` is closed to a user: a controller states it shut (a disclosure
 * with `aria-expanded=false`, a tab with `aria-selected=false`), or it is a
 * menu that is not shown.
 */
function isClosed(ctx: DensityReachContext, x: DensityItem): boolean {
  for (const c of ctx.controllers.get(x.id) ?? []) {
    if (c.role === 'tab' ? c.selected === false : c.expanded === false) return true;
  }
  return (
    x.role !== null &&
    MENU_ROLES.has(x.role) &&
    (x.visibility === 'hidden' || x.visibility === 'no-layout')
  );
}

/** The closed containers on the item's parent chain, the item itself included, innermost first. */
function closedAround(ctx: DensityReachContext, item: DensityItem): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: DensityItem | undefined = item;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (isClosed(ctx, cur)) out.push(cur.id);
    cur = cur.parent === null ? undefined : ctx.byId.get(cur.parent);
  }
  return out;
}

function isNotShown(v: DensityVisibility | null): boolean {
  return v === 'hidden' || v === 'no-layout';
}

/** Gestures for a scroll: `ceil(scrollPx / (0.8 · Hu))`; `null` when the usable height is 0. */
function gesturesFor(scrollPx: number | null, usableHeightPx: number): number | null {
  if (scrollPx === null) return null;
  if (scrollPx === 0) return 0;
  return usableHeightPx > 0 ? Math.ceil(scrollPx / (0.8 * usableHeightPx)) : null;
}

/** The scroll that brings an item's first line above the bottom pin. */
function scrollOf(
  ctx: DensityReachContext,
  item: DensityItem
): { scrollPx: number | null; lineBasis: 'line-height' | 'element-bottom' } {
  const lineBasis = item.lineHeightPx !== null ? 'line-height' : 'element-bottom';
  const rect = ctx.placed.get(item.id);
  if (rect === undefined || ctx.scrollUnknown.has(item.id)) return { scrollPx: null, lineBasis };
  // A pinned item (a fixed footer, a sticky bar) is on screen at every scroll position.
  if (ctx.pinned.has(item.id)) return { scrollPx: 0, lineBasis };
  // A hidden item with no area has no place yet: where it will appear is unknown.
  if (isNotShown(item.visibility) && rect.w * rect.h === 0) return { scrollPx: null, lineBasis };
  const bottom = rect.y + rect.h;
  const firstLine =
    item.lineHeightPx !== null ? Math.min(bottom, rect.y + item.lineHeightPx) : bottom;
  const H = ctx.capture.viewport.height;
  return { scrollPx: Math.max(0, firstLine - (H - ctx.pins.pinBottomPx)), lineBasis };
}

/** Availability of an item as the answer to an ask of `kind`. */
function availabilityOf(
  ctx: DensityReachContext,
  item: DensityItem,
  kind: DensityAskKind
): Pick<DensityItemReach, 'available' | 'unavailableBy' | 'availabilityUnknownBy'> {
  const unavailableBy: DensityUnavailableReason[] = [];
  const unknownBy: DensityAvailabilityUnknownReason[] = [];
  if (item.visibility === null) unknownBy.push('visibility-unknown');
  else if (item.visibility === 'occluded') unavailableBy.push('occluded');
  else if (isNotShown(item.visibility)) unknownBy.push('not-rendered');

  if (item.truncated === null) unknownBy.push('truncation-unknown');
  else if (item.truncated) {
    if (item.recoverable === false) unavailableBy.push('truncated-unrecoverable');
    else if (item.recoverable === null) unknownBy.push('truncation-unknown');
  }

  // An action is answered by the control itself; every other ask by text a user reads.
  if (kind !== 'action') {
    if (item.charsDrawn === false) unavailableBy.push('text-not-drawn');
    else if (item.charsDrawn === null) unknownBy.push('text-drawn-unknown');
  }

  const f = ctx.floors;
  if (f !== null) {
    const textual = (item.chars ?? 0) > 0 || item.chars === null;
    if (textual) {
      if (item.fontPx === null) unknownBy.push('floor-unknown');
      else if (item.fontPx < f.fontPx) unavailableBy.push('below-font-floor');
      if (item.fontPx !== null && item.lineHeightPx !== null) {
        if (item.lineHeightPx / item.fontPx < f.lineHeightRatio)
          unavailableBy.push('below-line-height-floor');
      } else if (!unknownBy.includes('floor-unknown')) {
        unknownBy.push('floor-unknown');
      }
    }
    if (kind === 'action' && item.interactive) {
      const r = item.rect;
      if (r === null) {
        if (!unknownBy.includes('floor-unknown')) unknownBy.push('floor-unknown');
      } else if (Math.min(r.w, r.h) < f.targetPx) unavailableBy.push('below-target-floor');
    }
  }
  const available = unavailableBy.length > 0 ? false : unknownBy.length > 0 ? null : true;
  return { available, unavailableBy, availabilityUnknownBy: unknownBy };
}

/** The base interactions around an item: its closed containers, else the declared `via`. */
function baseInteractions(
  item: DensityItem,
  closed: readonly string[],
  ask: DensityAsk
): { n: number | null; by: DensityInteractionsBy } {
  if (closed.length > 0) return { n: closed.length, by: 'structure' };
  if (ask.via.length > 0) return { n: ask.via.length, by: 'declared' };
  // Hidden, with nothing around it that says how it is opened: unknown, never 0.
  if (isNotShown(item.visibility)) return { n: null, by: 'unknown' };
  return { n: 0, by: 'none' };
}

/** One answering item's reach (`foreignPx` is filled in once the blocks are known). */
export function densityItemReach(
  ctx: DensityReachContext,
  item: DensityItem,
  ask: DensityAsk
): DensityItemReach {
  const { scrollPx, lineBasis } = scrollOf(ctx, item);
  const gestures = gesturesFor(scrollPx, ctx.pins.usableHeightPx);
  const closed = closedAround(ctx, item);
  const base = baseInteractions(item, closed, ask);
  const extra =
    (item.truncated === true && item.recoverable === true ? 1 : 0) + (ask.findChars > 0 ? 1 : 0);
  const interactions = base.n === null ? null : base.n + extra;
  return {
    id: item.id,
    visibility: item.visibility,
    scrollPx,
    lineBasis,
    gestures,
    closedAround: closed,
    interactions,
    interactionsBy: base.by,
    keystrokes: ask.findChars,
    actions: gestures === null || interactions === null ? null : gestures + interactions,
    foreignPx: null,
    ...availabilityOf(ctx, item, ask.kind),
  };
}

/** The items that answer an ask, before any reach is computed. */
export interface DensityAskAnswer {
  ask: DensityAsk;
  state: DensityAskState;
  unresolvedBy: DensityAskUnresolvedReason[];
  partial: boolean;
  /** Answering items, capture order: the leaves at or below each matched item, else the matched items. */
  items: string[];
}

/** Resolve an ask's `answer` to the items that answer it, and the ask's state. */
export function densityAskAnswer(ctx: DensityReachContext, ask: DensityAsk): DensityAskAnswer {
  if (ask.answer === null) {
    return { ask, state: 'unanswered', unresolvedBy: [], partial: false, items: [] };
  }
  const matchers = Array.isArray(ask.answer) ? ask.answer : [ask.answer];
  const { ids, results } = resolveDensityMatchers(ctx.capture, matchers);
  const unresolvedBy: DensityAskUnresolvedReason[] = results.flatMap(
    (r): DensityAskUnresolvedReason[] =>
      r.status === 'unresolved' ? [r.reason] : r.textUnevaluated > 0 ? ['text-unevaluated'] : []
  );
  if (ids.length === 0) {
    return { ask, state: 'unresolved', unresolvedBy, partial: false, items: [] };
  }
  const leafLike = new Set([...ctx.leaves.ids, ...ctx.leaves.unknown]);
  const subtree = densitySubtree(ctx.capture, ids, ctx.children);
  let items = ctx.capture.items
    .filter((i) => subtree.has(i.id) && leafLike.has(i.id))
    .map((i) => i.id);
  if (items.length === 0) items = ids;
  const vis = items.map((id) => ctx.byId.get(id)!.visibility);
  const state: DensityAskState = vis.some((v) => v === 'rendered' || v === 'occluded')
    ? 'rendered'
    : vis.some(isNotShown)
      ? 'hidden'
      : 'unresolved';
  return {
    ask,
    state,
    unresolvedBy: state === 'unresolved' ? [...unresolvedBy, 'visibility-unknown'] : unresolvedBy,
    partial: state !== 'unresolved' && unresolvedBy.length > 0,
    items,
  };
}

/**
 * The order an ask's items are reached in: an item known to be readable
 * first, then one whose availability is unknown, then one known not to be;
 * within each, the fewest actions, the least scroll, the highest on the page.
 */
function orderKey(r: DensityItemReach, placed: ReadonlyMap<string, DensityRect>): number[] {
  return [
    r.available === true ? 0 : r.available === null ? 1 : 2,
    r.actions ?? Infinity,
    r.scrollPx ?? Infinity,
    placed.get(r.id)?.y ?? Infinity,
  ];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Reach for every answering item of one ask, and the ask's first and all
 * reach. `items` is every item's reach (the report lists at most `cap`).
 */
export function densityAskReach(
  ctx: DensityReachContext,
  answer: DensityAskAnswer,
  cap: number = DENSITY_ANSWER_ITEM_CAP
): { reach: DensityAskReach; items: DensityItemReach[] } {
  const { ask } = answer;
  const reaches = answer.items.map((id) => densityItemReach(ctx, ctx.byId.get(id)!, ask));
  const sorted = reaches
    .map((r, i) => ({ r, i }))
    .sort((a, b) => compareKeys(orderKey(a.r, ctx.placed), orderKey(b.r, ctx.placed)) || a.i - b.i)
    .map((x) => x.r);
  const first = sorted[0] ?? null;

  let all: DensityAllReach | null = null;
  if (reaches.length > 0) {
    const unknownItems = reaches.filter((r) => r.actions === null).length;
    const scrolls = reaches.map((r) => r.scrollPx);
    const scrollPx = scrolls.some((s) => s === null) ? null : Math.max(...(scrolls as number[]));
    // The item reached last: the largest scroll, then the lowest on the page.
    let last: DensityItemReach | null = null;
    const topOf = (r: DensityItemReach) => ctx.placed.get(r.id)?.y ?? -Infinity;
    for (const r of reaches) {
      if (r.scrollPx === null) continue;
      if (
        last === null ||
        r.scrollPx > (last.scrollPx as number) ||
        (r.scrollPx === last.scrollPx && topOf(r) > topOf(last))
      ) {
        last = r;
      }
    }
    // One open reveals everything inside it: the distinct closed containers.
    // An item outside every closed container is reached by the declared
    // `via`, which is walked once however many items need it.
    const union = new Set(reaches.flatMap((r) => r.closedAround));
    const viaWalked = reaches.some((r) => r.interactionsBy === 'declared');
    const anyUnknownBase = reaches.some((r) => r.interactionsBy === 'unknown');
    const truncations = reaches.filter((r) => {
      const item = ctx.byId.get(r.id)!;
      return item.truncated === true && item.recoverable === true;
    }).length;
    const interactions = anyUnknownBase
      ? null
      : union.size + (viaWalked ? ask.via.length : 0) + truncations + (ask.findChars > 0 ? 1 : 0);
    const gestures = gesturesFor(scrollPx, ctx.pins.usableHeightPx);
    const avail = reaches.map((r) => r.available);
    all = {
      lastItem: last?.id ?? null,
      scrollPx,
      gestures,
      interactions,
      keystrokes: ask.findChars,
      actions:
        unknownItems > 0 || gestures === null || interactions === null
          ? null
          : gestures + interactions,
      foreignPx: null,
      available: avail.some((a) => a === false)
        ? false
        : avail.some((a) => a === null)
          ? null
          : true,
      unknownItems,
    };
  }

  const list = sorted.slice(0, Math.max(0, cap));
  const reach: DensityAskReach = {
    id: ask.id,
    rank: ask.rank,
    weight: ask.weight,
    kind: ask.kind,
    need: ask.need,
    state: answer.state,
    unresolvedBy: answer.unresolvedBy,
    partial: answer.partial,
    answerItems: {
      total: reaches.length,
      firstScreen: reaches.filter(
        (r) => r.scrollPx === 0 && (r.visibility === 'rendered' || r.visibility === 'occluded')
      ).length,
      shown: list.length,
      truncated: list.length < reaches.length,
      list,
    },
    first,
    all,
    available: ask.need === 'all' ? (all?.available ?? null) : (first?.available ?? null),
  };
  return { reach, items: sorted };
}

/**
 * Whether an ask is answered within `k` actions: `lo` when it certainly is,
 * `hi` when it may be. An unanswered ask is neither; an unresolved one may be.
 * A `need: any` ask is answered when some available item is reached within k;
 * a `need: all` ask when every item is, at once.
 */
export function densityAnsweredWithin(
  reach: DensityAskReach,
  k: number,
  answerItems: readonly DensityItemReach[]
): { lo: boolean; hi: boolean } {
  if (reach.state === 'unanswered') return { lo: false, hi: false };
  if (reach.state === 'unresolved') return { lo: false, hi: true };
  const within = (a: number | null) => a !== null && a <= k;
  const may = (a: number | null) => a === null || a <= k;
  if (reach.need === 'all') {
    const all = reach.all;
    if (all === null) return { lo: false, hi: true };
    const lo = !reach.partial && within(all.actions) && all.available === true;
    const hi = may(all.actions) && all.available !== false;
    return { lo, hi };
  }
  const lo = answerItems.some((r) => within(r.actions) && r.available === true);
  // A matcher that resolved nothing may hold a nearer answer.
  const hi = reach.partial || answerItems.some((r) => may(r.actions) && r.available !== false);
  return { lo, hi };
}

/**
 * Chrome and unclaimed-block height above an item in its column: the union
 * of those items' vertical extents above the item's top. `null` with no place.
 */
export function densityForeignPx(
  ctx: DensityReachContext,
  id: string,
  foreignIds: ReadonlySet<string>
): number | null {
  const rect = ctx.placed.get(id);
  if (rect === undefined) return null;
  const intervals: Array<[number, number]> = [];
  for (const other of foreignIds) {
    if (other === id) continue;
    const o = ctx.placed.get(other);
    const item = ctx.byId.get(other);
    if (o === undefined || !item || isNotShown(item.visibility)) continue;
    if (o.y >= rect.y || !densitySameColumn(rect, o)) continue;
    intervals.push([o.y, Math.min(o.y + o.h, rect.y)]);
  }
  return densityIntervalUnion(intervals);
}
