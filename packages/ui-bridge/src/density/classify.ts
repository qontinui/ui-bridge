/**
 * Kinds: what each leaf of a capture is, and which rule said so.
 *
 * The first rule that applies decides, and `kindBy` records which:
 *
 * 1. `declared` — a `classify` matcher of the targets file;
 * 2. `landmark` — a banner, navigation or contentinfo landmark (the item's own
 *    or an ancestor's), or a pinned item or one inside a pinned item: `chrome`;
 * 3. `role` — a heading: `heading`; `dt`, `th`, `label`, role `columnheader`
 *    or `rowheader`: `label`; `dd`, `td`, role `definition`, `cell` or
 *    `gridcell`: `value`; interactive: `control`; `p`, role
 *    `note` or `status`: `prose`; `img`, `svg`, `video`: `media`;
 * 4. `author-id` — a non-interactive leaf that carries an author-declared id
 *    (`authorId` as the capture defines it: a `hook` registration,
 *    `data-ui-bridge-content` or `data-ui-bridge-test-id`, never the
 *    auto-registrar's `data-ui-bridge-id` stamp): `value`;
 * 5. `shape` — text shaped like a number, date, currency amount or identifier:
 *    `value`, counted apart because it is the weakest basis;
 * 6. `other`.
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change (Phase 3).
 */

import { resolveDensityMatcher, type DensityUnresolvedReason } from './match';
import type { DensityCapture, DensityItem, DensityItemKind, DensityTargets } from './schema';
import {
  densityBlocks,
  densityLeaves,
  densityPinnedIds,
  densityPins,
  densityUnattributedChars,
  densityHeadingLevel,
  isDensityHeading,
  isDensityMedia,
  type DensityBlockBy,
  type DensityLeaves,
  type DensityPins,
} from './structure';

/** The rule that decided an item's kind. */
export type DensityKindBy = 'declared' | 'landmark' | 'role' | 'author-id' | 'shape' | 'other';

/** The bases in rule order. */
export const DENSITY_KIND_BASES: readonly DensityKindBy[] = [
  'declared',
  'landmark',
  'role',
  'author-id',
  'shape',
  'other',
];

export interface DensityItemClass {
  id: string;
  kind: DensityItemKind;
  kindBy: DensityKindBy;
}

/** A `classify` rule whose matcher selected nothing that can be relied on. */
export interface DensityUnresolvedClassify {
  /** Index in the targets' `classify` list. */
  index: number;
  reason: DensityUnresolvedReason;
}

export interface DensityClassification {
  /** One entry per leaf, in capture order. */
  items: DensityItemClass[];
  unresolved: DensityUnresolvedClassify[];
}

const LABEL_TAGS = new Set(['dt', 'th', 'label']);
const VALUE_TAGS = new Set(['dd', 'td']);
const VALUE_ROLES = new Set(['definition', 'cell', 'gridcell']);
const LABEL_ROLES = new Set(['columnheader', 'rowheader']);
const PROSE_ROLES = new Set(['note', 'status']);
const VALUE_SHAPES = new Set(['number', 'date', 'currency', 'identifier']);
const CHROME_LANDMARKS = new Set(['banner', 'navigation', 'contentinfo']);

/** Rule 3: the kind an item's tag, role or interactivity names, if any. */
function kindByRole(item: DensityItem): DensityItemKind | null {
  if (isDensityHeading(item)) return 'heading';
  if (LABEL_TAGS.has(item.tag) || (item.role !== null && LABEL_ROLES.has(item.role)))
    return 'label';
  if (VALUE_TAGS.has(item.tag) || (item.role !== null && VALUE_ROLES.has(item.role)))
    return 'value';
  if (item.interactive) return 'control';
  if (item.tag === 'p' || (item.role !== null && PROSE_ROLES.has(item.role))) return 'prose';
  if (isDensityMedia(item)) return 'media';
  return null;
}

/**
 * Classify every leaf of `capture`. `targets` supplies the declared rules;
 * `pins` and `leaves` default to the capture's own.
 */
export function classifyDensityItems(
  capture: DensityCapture,
  targets: DensityTargets | null,
  leaves: DensityLeaves = densityLeaves(capture),
  pins: DensityPins = densityPins(capture)
): DensityClassification {
  const byId = new Map(capture.items.map((i) => [i.id, i]));

  // Rule 1: the first declared rule that selects an item decides it.
  const declared = new Map<string, DensityItemKind>();
  const unresolved: DensityUnresolvedClassify[] = [];
  (targets?.classify ?? []).forEach((rule, index) => {
    const res = resolveDensityMatcher(capture, rule.match);
    if (res.status === 'unresolved') {
      unresolved.push({ index, reason: res.reason });
      return;
    }
    for (const id of res.ids) if (!declared.has(id)) declared.set(id, rule.kind);
  });

  // Rule 2: pinned, or inside a pinned item (parent links read from the xpath).
  const pinned = densityPinnedIds(capture, pins);

  const items = leaves.ids.map((id): DensityItemClass => {
    const item = byId.get(id)!;
    const d = declared.get(id);
    if (d !== undefined) return { id, kind: d, kindBy: 'declared' };
    if ((item.landmark !== null && CHROME_LANDMARKS.has(item.landmark)) || pinned.has(id)) {
      return { id, kind: 'chrome', kindBy: 'landmark' };
    }
    const byRole = kindByRole(item);
    if (byRole !== null) return { id, kind: byRole, kindBy: 'role' };
    if (!item.interactive && item.authorId) return { id, kind: 'value', kindBy: 'author-id' };
    if (item.shape !== null && VALUE_SHAPES.has(item.shape)) {
      return { id, kind: 'value', kindBy: 'shape' };
    }
    return { id, kind: 'other', kindBy: 'other' };
  });
  return { items, unresolved };
}

/** How many leaves took each kind, per basis. */
export type DensityKindCounts = Record<DensityKindBy, Partial<Record<DensityItemKind, number>>>;

/** One block as the summary reports it: its members are counted, not listed. */
export interface DensityBlockSummary {
  id: string;
  by: DensityBlockBy;
  members: number;
  topPx: number | null;
  heightPx: number | null;
  pitchPx: number | null;
  parent: string | null;
}

/** The longest block list a summary prints; the rest is counted. */
export const DENSITY_BLOCK_LIST_CAP = 50;

/** What `measure` reports about a capture's structure. Holds no page text. */
export type DensityStructureSummary =
  | {
      structureResolved: false;
      reason: string;
    }
  | {
      structureResolved: true;
      /** How many items took each parent basis. */
      structureBy: { xpath: number; geometry: number };
      /**
       * `geometryOwnChars`: containers whose `ownChars` subtracted a child
       * whose parent link was read from geometry, assumed (not known) to be a
       * DOM descendant.
       */
      leaves: { count: number; unknown: number; geometryOwnChars: number };
      /** Text on containers that the registry does not see; `null` when a term is unreadable. */
      unattributedChars: number | null;
      /** `unknown`: items whose pin status could not be read; while nonzero the pin heights are lower bounds. */
      pins: {
        pinTopPx: number;
        pinBottomPx: number;
        usableHeightPx: number;
        items: number;
        unknown: number;
      };
      kinds: { byBasis: DensityKindCounts; unresolvedRules: DensityUnresolvedClassify[] };
      blocks: {
        byBasis: Record<DensityBlockBy, number>;
        /** Headings (role `heading` on a non-`h` tag) whose level the capture does not carry. */
        headingLevelUnknown: number;
        shown: number;
        total: number;
        truncated: boolean;
        list: DensityBlockSummary[];
        unresolved: Array<{ id: string; reason: DensityUnresolvedReason }>;
        unblockedLeaves: number;
      };
    };

/** The structure summary of a capture: leaves, kinds by basis, blocks, and the structure bases. */
export function summarizeDensityStructure(
  capture: DensityCapture,
  targets: DensityTargets | null,
  cap: number = DENSITY_BLOCK_LIST_CAP
): DensityStructureSummary {
  if (!capture.structureResolved) {
    return {
      structureResolved: false,
      reason:
        'the capture was written before its structure was resolved (structureResolved: false)',
    };
  }
  const leaves = densityLeaves(capture);
  const pins = densityPins(capture);
  const classes = classifyDensityItems(capture, targets, leaves, pins);
  const blocks = densityBlocks(capture, targets, leaves, densityPinnedIds(capture, pins));

  const byBasis = Object.fromEntries(
    DENSITY_KIND_BASES.map((b) => [b, {} as Partial<Record<DensityItemKind, number>>])
  ) as DensityKindCounts;
  for (const c of classes.items) {
    const counts = byBasis[c.kindBy];
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  }
  const blockBasis: Record<DensityBlockBy, number> = { declared: 0, path: 0, heading: 0 };
  for (const b of blocks.blocks) blockBasis[b.by]++;
  const list = blocks.blocks.slice(0, Math.max(0, cap)).map(
    (b): DensityBlockSummary => ({
      id: b.id,
      by: b.by,
      members: b.members.length,
      topPx: b.topPx,
      heightPx: b.heightPx,
      pitchPx: b.pitchPx,
      parent: b.parent,
    })
  );

  return {
    structureResolved: true,
    structureBy: {
      xpath: capture.items.filter((i) => i.structureBy === 'xpath').length,
      geometry: capture.items.filter((i) => i.structureBy === 'geometry').length,
    },
    leaves: {
      count: leaves.ids.length,
      unknown: leaves.unknown.length,
      geometryOwnChars: new Set(
        capture.items
          .filter((i) => i.parent !== null && i.structureBy === 'geometry' && (i.chars ?? 0) > 0)
          .map((i) => i.parent as string)
      ).size,
    },
    unattributedChars: densityUnattributedChars(capture),
    pins: {
      pinTopPx: pins.pinTopPx,
      pinBottomPx: pins.pinBottomPx,
      usableHeightPx: pins.usableHeightPx,
      items: pins.ids.length,
      unknown: pins.unknown.length,
    },
    kinds: { byBasis, unresolvedRules: classes.unresolved },
    blocks: {
      byBasis: blockBasis,
      headingLevelUnknown: capture.items.filter(
        (i) => isDensityHeading(i) && densityHeadingLevel(i) === null
      ).length,
      shown: list.length,
      total: blocks.blocks.length,
      truncated: list.length < blocks.blocks.length,
      list,
      unresolved: blocks.unresolved,
      unblockedLeaves: blocks.unblocked.length,
    },
  };
}
