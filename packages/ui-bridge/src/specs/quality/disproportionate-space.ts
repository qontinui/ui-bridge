/**
 * `informationDensity` category 2 — disproportionate space for one function:
 * a group of controls (a search, a filter form, a toolbar) that takes more of
 * the first screen than the fields it holds can justify.
 *
 * Adjacent control groups (a search above a filter form) are judged as one
 * CLUSTER, and only a cluster with at least one control on the first screen is
 * judged at all. Three hit kinds, each naming the groups and their controls:
 *
 *  - `stacked-singletons` — at least `STACK_MIN_CONTROLS` fields, each alone
 *    in its row and each at least `FULL_WIDTH_SHARE` of the cluster's width;
 *  - `mergeable-rows` — two consecutive control rows whose controls would fit
 *    side by side in one row of the cluster's width (the general form of "the
 *    search and the status filter could share a row");
 *  - `out-of-proportion` — the cluster covers at least `CONTROL_SHARE_MAX` of
 *    the first screen and either `CONTROL_TO_PRIMARY_RATIO` times the primary
 *    content's (the largest table) share, or the primary content does not
 *    reach the first screen at all.
 */

import type { ViewportDimensions } from '../quality-types';
import { clip, documentTop, viewportRect } from './geometry';
import type { Rect } from './geometry';
import type { FunctionalGroup } from './functional-groups';
import { bandRows, describeGroup, unionRect } from './functional-groups';

/** Tunable: control groups closer than this (px, vertically) are one cluster. */
export const CLUSTER_GAP_PX = 32;
/** Tunable: stacked singletons need at least this many fields... */
export const STACK_MIN_CONTROLS = 3;
/** Tunable: ...each at least this share of the cluster's width. */
export const FULL_WIDTH_SHARE = 0.6;
/** Tunable: a cluster at this share of the first screen's area or more... */
export const CONTROL_SHARE_MAX = 0.35;
/** Tunable: ...and this many times the primary content's share, is out of proportion. */
export const CONTROL_TO_PRIMARY_RATIO = 1.5;
/** Tunable: the gap assumed between controls placed side by side. */
export const MERGE_GAP_PX = 12;
/** Tunable: points each hit kind costs. */
export const DISPROPORTION_PENALTIES = {
  'stacked-singletons': 25,
  'mergeable-rows': 20,
  'out-of-proportion': 35,
} as const;

export type DisproportionKind = keyof typeof DISPROPORTION_PENALTIES;

export interface DisproportionHit {
  kind: DisproportionKind;
  groupKeys: string[];
  elementIds: string[];
  firstScreenShare: number;
  rect: Rect;
  reason: string;
}

export interface DisproportionResult {
  score: number | null;
  hits: DisproportionHit[];
  groups: Array<{ key: string; kind: string; label: string | null; firstScreenShare: number; fields: number; buttons: number }>;
  primaryContent: { key: string; firstScreenShare: number } | null;
}

/** The share of the first screen's area a rect covers (document coordinates). */
function firstScreenShare(rect: Rect, viewport: ViewportDimensions): number {
  const area = viewport.width * viewport.height;
  if (area <= 0) return 0;
  const docRect = { ...rect, y: documentTop(rect, viewport) };
  const c = clip(docRect, viewportRect(viewport));
  return c ? (c.width * c.height) / area : 0;
}

function horizontalOverlap(a: Rect, b: Rect): number {
  const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  return overlap / Math.max(1, Math.min(a.width, b.width));
}

const round3 = (n: number) => Number(n.toFixed(3));

export function disproportionateSpace(
  groups: Map<string, FunctionalGroup>,
  viewport: ViewportDimensions,
  haveStructure: boolean
): DisproportionResult {
  if (!haveStructure) return { score: null, hits: [], groups: [], primaryContent: null };
  const all = Array.from(groups.values());
  const summary = all
    .map((g) => ({
      key: g.key,
      kind: g.kind,
      label: g.label ?? null,
      firstScreenShare: round3(firstScreenShare(g.rect, viewport)),
      fields: g.fields.length,
      buttons: g.buttons.length,
    }))
    .sort((a, b) => b.firstScreenShare - a.firstScreenShare)
    .slice(0, 12);

  const tables = all.filter((g) => g.kind === 'table');
  const primary = tables.sort((a, b) => b.members.length - a.members.length)[0];
  const primaryShare = primary ? firstScreenShare(primary.rect, viewport) : 0;

  const controlGroups = all
    .filter(
      (g) =>
        (g.kind === 'search' || g.kind === 'form' || g.kind === 'toolbar') &&
        g.fields.length >= 1 &&
        g.fields.length + g.buttons.length >= 2
    )
    .sort((a, b) => a.rect.y - b.rect.y);
  const clusters: FunctionalGroup[][] = [];
  for (const g of controlGroups) {
    const last = clusters[clusters.length - 1];
    if (last) {
      const box = last.map((x) => x.rect).reduce(unionRect);
      const gap = g.rect.y - (box.y + box.height);
      if (gap <= CLUSTER_GAP_PX && horizontalOverlap(box, g.rect) > 0.5) {
        last.push(g);
        continue;
      }
    }
    clusters.push([g]);
  }

  const hits: DisproportionHit[] = [];
  for (const cluster of clusters) {
    const rect = cluster.map((g) => g.rect).reduce(unionRect);
    const share = firstScreenShare(rect, viewport);
    const fields = cluster.flatMap((g) => g.fields);
    const buttons = cluster.flatMap((g) => g.buttons);
    // Only a cluster with a control ON the first screen spends first-screen space.
    if (share <= 0 || [...fields, ...buttons].every((c) => documentTop(c.rect, viewport) >= viewport.height))
      continue;
    const groupKeys = cluster.map((g) => g.key);
    const elementIds = [...groupKeys, ...fields.map((f) => f.elementId), ...buttons.map((b) => b.elementId)];
    const names = cluster.map(describeGroup).join(' + ');
    const base = { groupKeys, firstScreenShare: round3(share), rect };

    const fieldRows = bandRows(fields);
    if (
      fields.length >= STACK_MIN_CONTROLS &&
      fieldRows.length === fields.length &&
      fields.every((f) => f.rect.width >= FULL_WIDTH_SHARE * rect.width)
    ) {
      hits.push({
        ...base,
        kind: 'stacked-singletons',
        elementIds,
        reason: `${fields.length} fields in ${names} each take a full-width row of their own.`,
      });
    }

    const rows = bandRows([...fields, ...buttons]);
    const mergeable: string[] = [];
    let pairs = 0;
    for (let i = 0; i + 1 < rows.length; i++) {
      const both = [...rows[i], ...rows[i + 1]];
      const needed = both.reduce((s, el) => s + el.rect.width, 0) + MERGE_GAP_PX * (both.length - 1);
      if (needed <= rect.width) {
        pairs++;
        for (const el of both) if (!mergeable.includes(el.elementId)) mergeable.push(el.elementId);
      }
    }
    if (pairs > 0) {
      hits.push({
        ...base,
        kind: 'mergeable-rows',
        elementIds: [...groupKeys, ...mergeable],
        reason: `${names} spends ${rows.length} rows on ${fields.length} field(s) and ${buttons.length} button(s); ${pairs} pair(s) of adjacent rows would fit side by side in its ${Math.round(rect.width)}px width.`,
      });
    }

    if (
      share >= CONTROL_SHARE_MAX &&
      (primaryShare === 0 || share >= CONTROL_TO_PRIMARY_RATIO * primaryShare)
    ) {
      const versus = primary
        ? primaryShare === 0
          ? `the ${describeGroup(primary)} does not reach the first screen`
          : `the ${describeGroup(primary)} gets ${(primaryShare * 100).toFixed(0)}%`
        : 'there is no table';
      hits.push({
        ...base,
        kind: 'out-of-proportion',
        elementIds,
        reason: `${names} covers ${(share * 100).toFixed(0)}% of the first screen for ${fields.length} field(s), while ${versus}.`,
      });
    }
  }

  const penalty = hits.reduce((s, h) => s + DISPROPORTION_PENALTIES[h.kind], 0);
  return {
    score: Math.max(0, 100 - penalty),
    hits,
    groups: summary,
    primaryContent: primary ? { key: primary.key, firstScreenShare: round3(primaryShare) } : null,
  };
}
