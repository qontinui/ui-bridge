/**
 * Affordances: the controls that let a user change what a page shows —
 * disclosures, tabs, menus, search, filters and pagers — and the two ways a
 * page shortens text in place, truncation and abbreviation. Each one is
 * reported with the rule that detected it ({@link DENSITY_AFFORDANCE_RULES}).
 *
 * The rules read structure and ARIA state only; no control is operated
 * (`interactionsBasis: static`). What a closed control hides (`hides`) is
 * measured by the document walk (release 3) and is
 * `unknown{input_missing}` from a snapshot. Search in snapshot mode is
 * `role: searchbox`: the snapshot row carries no `type` attribute, and
 * `dom-accessibility-api` answers `searchbox` for `input[type=search]`.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 4).
 */

import {
  densityCentreY,
  densityDeclaresAnotherRepeat,
  densityInnermostRepeats,
  densityNavPrefix,
  isDensityChrome,
  isDensityHeaderToggle,
  densityNearestRepeats,
  densityRepeatScopes,
  densityTakesSpace,
  isDensityFilterControl,
  isDensityNavControl,
  densityRepeatTargets,
  densityRepeats,
  type DensityRepeat,
  type DensityUnknownQuantity,
} from './repeats';
import type { DensityCapture, DensityItem, DensityTargets } from './schema';
import {
  densityBlocks,
  densityChildren,
  densityLeaves,
  type DensityBlocks,
  type DensityLeaves,
} from './structure';

export type DensityAffordanceKind =
  | 'disclosure'
  | 'tab'
  | 'menu'
  | 'search'
  | 'filter'
  | 'pager'
  | 'truncation'
  | 'abbreviation';

export const DENSITY_AFFORDANCE_KINDS: readonly DensityAffordanceKind[] = [
  'disclosure',
  'tab',
  'menu',
  'search',
  'filter',
  'pager',
  'truncation',
  'abbreviation',
];

export type DensityAffordanceRule =
  | 'summary'
  | 'aria-expanded'
  | 'role-tab'
  | 'role-menu'
  | 'role-menuitem'
  | 'role-searchbox'
  | 'declared-filters'
  | 'declared-controls'
  | 'control-above-repeat'
  | 'nav-after-repeat'
  | 'scroll-width'
  | 'abbr'
  | 'title';

/** Every detection rule, the affordance it detects and what it reads. Closed. */
export const DENSITY_AFFORDANCE_RULES: Readonly<
  Record<DensityAffordanceRule, { kind: DensityAffordanceKind; definition: string }>
> = {
  summary: { kind: 'disclosure', definition: 'a `summary` element (the toggle of a `details`)' },
  'aria-expanded': {
    kind: 'disclosure',
    definition:
      'an item that states `aria-expanded`, other than a combobox (whose popup is its options)',
  },
  'role-tab': { kind: 'tab', definition: 'role `tab`' },
  'role-menu': { kind: 'menu', definition: 'role `menu` or `menubar` (the design names `menu`)' },
  'role-menuitem': {
    kind: 'menu',
    definition: 'role `menuitem`, `menuitemcheckbox` or `menuitemradio`',
  },
  'role-searchbox': {
    kind: 'search',
    definition: 'role `searchbox` (what an `input[type=search]` computes to)',
  },
  'declared-filters': {
    kind: 'filter',
    definition:
      'a select, combobox, checkbox or radio with a declared `filters` relationship to a repeat, its parent or a row',
  },
  'declared-controls': {
    kind: 'filter',
    definition:
      'a select, combobox, checkbox or radio with a declared `controls` or `toggles` relationship to a repeat, its parent or a row',
  },
  'control-above-repeat': {
    kind: 'filter',
    definition:
      "a select, combobox, checkbox or radio in the repeat's scope (its block, else a near ancestor; never another repeat's rows), centred above its first row, and nearer that repeat than any other",
  },
  'nav-after-repeat': {
    kind: 'pager',
    definition:
      "an interactive item in a `nav` (tag or navigation landmark), in the repeat's scope, centred below its last row, nearer it than any other repeat and within one viewport height of it: one entry per control, not per pager",
  },
  'scroll-width': {
    kind: 'truncation',
    definition: '`scrollWidth > clientWidth + 1` with a horizontal `overflow` other than `visible`',
  },
  abbr: { kind: 'abbreviation', definition: 'an `abbr` element' },
  title: {
    kind: 'abbreviation',
    definition:
      'a leaf with text whose accessible name comes from its `title` (the full form on hover); a snapshot row carries no `title` attribute, so a leaf named by its content that also has one is not seen',
  },
};

/** What a closed control hides; measured by the document walk only. */
export type DensityHides =
  | { items: number; values: number; chars: number }
  | DensityUnknownQuantity;

/**
 * `open` / `closed` for a disclosure (from `aria-expanded`) or a menu (from
 * its visibility); `active` / `inactive` for a tab (from `aria-selected`);
 * `null` when the capture does not state it, or for a kind with no state.
 */
export type DensityAffordanceState = 'open' | 'closed' | 'active' | 'inactive' | null;

export interface DensityAffordance {
  kind: DensityAffordanceKind;
  rule: DensityAffordanceRule;
  id: string;
  state: DensityAffordanceState;
  /** The id the item controls or toggles, from the capture's relationships. */
  controls: string | null;
  /** The repeat a filter or pager acts on; `null` for the other kinds. */
  repeat: string | null;
  /** Truncation and abbreviation: whether the full form is reachable; `null` when there is no evidence. */
  recoverable: boolean | null;
  hides: DensityHides;
}

export interface DensityAffordanceInputs {
  leaves?: DensityLeaves;
  blocks?: DensityBlocks;
  repeats?: readonly DensityRepeat[];
}

const HIDES_FROM_SNAPSHOT: DensityUnknownQuantity = {
  unknown: 'input_missing',
  reason:
    'what a control hides is measured by the document walk; a snapshot of registered elements does not carry it',
};

const centreY = densityCentreY;

const MENU_ROLES = new Set(['menu', 'menubar']);
const MENU_ITEM_ROLES = new Set(['menuitem', 'menuitemcheckbox', 'menuitemradio']);

function menuState(item: DensityItem): DensityAffordanceState {
  if (item.visibility === 'hidden' || item.visibility === 'no-layout') return 'closed';
  if (item.visibility === 'rendered' || item.visibility === 'occluded') return 'open';
  return null;
}

function openClosed(expanded: boolean | null): DensityAffordanceState {
  return expanded === null ? null : expanded ? 'open' : 'closed';
}

/**
 * Every affordance of `capture`, in capture order, filters and pagers after
 * the item-local kinds. An item may answer more than one kind (a truncated
 * label with a `title` is a truncation and an abbreviation); within one kind it
 * is listed once, under the first rule in {@link DENSITY_AFFORDANCE_RULES}
 * order that matched — except filters and pagers, which are listed once per
 * repeat they act on.
 */
export function densityAffordances(
  capture: DensityCapture,
  targets: DensityTargets | null,
  inputs: DensityAffordanceInputs = {}
): DensityAffordance[] {
  const leaves = inputs.leaves ?? densityLeaves(capture);
  const blocks = inputs.blocks ?? densityBlocks(capture, targets, leaves);
  const repeats = inputs.repeats ?? densityRepeats(capture, targets, { leaves, blocks });
  const leafSet = new Set(leaves.ids);
  const byId = new Map(capture.items.map((i) => [i.id, i]));
  /**
   * A menu item is as open as the nearest `menu` it sits in (by parent links);
   * `null` with no such ancestor, since an item's own visibility does not say
   * whether its menu is open.
   */
  const itemMenuState = (item: DensityItem): DensityAffordanceState => {
    const seen = new Set<string>();
    let cur = item.parent === null ? undefined : byId.get(item.parent);
    while (cur && !seen.has(cur.id)) {
      if (cur.role !== null && MENU_ROLES.has(cur.role)) return menuState(cur);
      seen.add(cur.id);
      cur = cur.parent === null ? undefined : byId.get(cur.parent);
    }
    return null;
  };
  const out: DensityAffordance[] = [];
  const add = (
    item: DensityItem,
    rule: DensityAffordanceRule,
    state: DensityAffordanceState,
    extra: Partial<Pick<DensityAffordance, 'repeat' | 'recoverable'>> = {}
  ) => {
    out.push({
      kind: DENSITY_AFFORDANCE_RULES[rule].kind,
      rule,
      id: item.id,
      state,
      controls: item.controls,
      repeat: extra.repeat ?? null,
      recoverable: extra.recoverable ?? null,
      hides: HIDES_FROM_SNAPSHOT,
    });
  };

  for (const item of capture.items) {
    // disclosure
    if (item.tag === 'summary') add(item, 'summary', openClosed(item.expanded));
    // A combobox states aria-expanded for its popup: it is a select-like
    // control (a finder or a filter), not a disclosure of content.
    else if (item.expanded !== null && item.role !== 'combobox') {
      add(item, 'aria-expanded', openClosed(item.expanded));
    }
    // tab
    if (item.role === 'tab') {
      add(item, 'role-tab', item.selected === null ? null : item.selected ? 'active' : 'inactive');
    }
    // menu
    if (item.role !== null && MENU_ROLES.has(item.role)) add(item, 'role-menu', menuState(item));
    else if (item.role !== null && MENU_ITEM_ROLES.has(item.role)) {
      add(item, 'role-menuitem', itemMenuState(item));
    }
    // search
    if (item.role === 'searchbox') add(item, 'role-searchbox', null);
    // truncation
    // Text cut short in place: a leaf. A container that overflows (a scroll
    // pane around a wide table) is a scroller, not a truncation.
    if (item.truncated === true && leafSet.has(item.id)) {
      add(item, 'scroll-width', null, { recoverable: item.recoverable });
    }
    // abbreviation
    if (item.tag === 'abbr') add(item, 'abbr', null, { recoverable: item.recoverable });
    else if (leafSet.has(item.id) && item.recoverable === true && (item.chars ?? 0) > 0) {
      add(item, 'title', null, { recoverable: true });
    }
  }

  // filters and pagers: per repeat
  const children = densityChildren(capture);
  const scopes = densityRepeatScopes(capture, repeats, blocks);
  // By position a control acts on the nearest repeat only.
  const nearestBelow = densityNearestRepeats(capture, repeats, scopes, 'below');
  const nearestAbove = densityNearestRepeats(capture, repeats, scopes, 'above');
  const innermost = densityInnermostRepeats(capture, repeats, children);
  const H = capture.viewport.height;
  for (const rep of repeats) {
    const scope = scopes.get(rep.id)!;
    const aimed = densityRepeatTargets(capture, rep, children);
    const firstMember = capture.items.find((i) => i.id === rep.members[0]);
    const repNav = firstMember ? densityNavPrefix(firstMember) : null;
    const repInChrome = firstMember ? isDensityChrome(firstMember) : false;
    for (const item of capture.items) {
      if (scope.own.has(item.id)) continue;
      // A filter is a laid-out, interactive select, combobox, checkbox or radio.
      // A checkbox or radio in a table header selects rows, it filters nothing.
      const headerToggle = isDensityHeaderToggle(item);
      const filterControl =
        isDensityFilterControl(item) &&
        item.interactive &&
        densityTakesSpace(item) &&
        !headerToggle;
      // filter (a search box with a `filters` edge is the repeat's finder, not a filter)
      if (
        filterControl &&
        item.filters !== null &&
        aimed.has(item.filters) &&
        innermost.get(item.filters) === rep.id
      ) {
        add(item, 'declared-filters', null, { repeat: rep.id });
      } else if (
        filterControl &&
        item.controls !== null &&
        aimed.has(item.controls) &&
        innermost.get(item.controls) === rep.id
      ) {
        add(item, 'declared-controls', null, { repeat: rep.id });
      } else if (
        scope.ids.has(item.id) &&
        item.interactive &&
        filterControl &&
        nearestBelow.get(item.id) === rep.id &&
        // A declared edge names the repeat the control acts on.
        !densityDeclaresAnotherRepeat(item, rep.id, innermost)
      ) {
        add(item, 'control-above-repeat', null, { repeat: rep.id });
      }
      // pager: in a `nav` (tag or landmark), below the last row and within a screen of it
      const cy = centreY(item);
      if (
        scope.ids.has(item.id) &&
        isDensityNavControl(item) &&
        densityTakesSpace(item) &&
        nearestAbove.get(item.id) === rep.id &&
        // A link at the foot of the nav the list's own rows sit in is more of
        // that nav, not its pager.
        (repNav === null || densityNavPrefix(item) !== repNav) &&
        // A site footer's or header's links are page chrome, not this list's
        // pager, unless the list itself sits in that chrome.
        (!isDensityChrome(item) || repInChrome) &&
        cy !== null &&
        cy <= rep.lastRow.bottomPx + H
      ) {
        add(item, 'nav-after-repeat', null, { repeat: rep.id });
      }
    }
  }
  return out;
}

/** The longest affordance list a summary prints; the rest is counted. */
export const DENSITY_AFFORDANCE_LIST_CAP = 100;

export type DensityAffordancesReport =
  | { structureResolved: false; reason: string }
  | { structureResolved: true; repeatKeysResolved: false; reason: string }
  | {
      structureResolved: true;
      repeatKeysResolved: true;
      /** No control was operated: interaction counts are read from structure and ARIA state. */
      interactionsBasis: 'static';
      byKind: Record<DensityAffordanceKind, number>;
      byRule: Partial<Record<DensityAffordanceRule, number>>;
      shown: number;
      total: number;
      truncated: boolean;
      list: DensityAffordance[];
    };

/** What `measure` reports about a capture's affordances. Holds no page text. */
export function summarizeDensityAffordances(
  capture: DensityCapture,
  targets: DensityTargets | null,
  affordances?: readonly DensityAffordance[],
  cap: number = DENSITY_AFFORDANCE_LIST_CAP
): DensityAffordancesReport {
  if (!capture.structureResolved) {
    return {
      structureResolved: false,
      reason:
        'filters, pagers and abbreviations are read from parent links, which this capture has not resolved',
    };
  }
  if (!capture.repeatKeysResolved) {
    return {
      structureResolved: true,
      repeatKeysResolved: false,
      reason:
        'filters and pagers act on repeats, whose sibling and cousin keys this capture predates (repeatKeysResolved: false); capture it again',
    };
  }
  const all = affordances ?? densityAffordances(capture, targets);
  const byKind = Object.fromEntries(DENSITY_AFFORDANCE_KINDS.map((k) => [k, 0])) as Record<
    DensityAffordanceKind,
    number
  >;
  const byRule: Partial<Record<DensityAffordanceRule, number>> = {};
  for (const a of all) {
    byKind[a.kind]++;
    byRule[a.rule] = (byRule[a.rule] ?? 0) + 1;
  }
  const list = all.slice(0, Math.max(0, cap));
  return {
    structureResolved: true,
    repeatKeysResolved: true,
    interactionsBasis: 'static',
    byKind,
    byRule,
    shown: list.length,
    total: all.length,
    truncated: list.length < all.length,
    list,
  };
}
