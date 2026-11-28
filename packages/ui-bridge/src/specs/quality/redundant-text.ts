/**
 * `informationDensity` category 1 — redundant text: headings, intro and
 * subtitle copy, and structural labels (table column headers, form labels) on
 * the first screen that state the same terms again.
 *
 * Candidates are rendered text units whose top lies within the first screen:
 * headings; paragraphs, captions and descriptions; and labels — where the
 * column headers of one table, or the labels of one form, are ONE unit (a
 * header set), every member still named. A `rowheader` is a data cell, not a
 * label. Unregistered text blocks the page collected (`QualityPageData`) are
 * candidates too, under their synthetic `dom:` ids, so a subtitle in a bare
 * `<span>` is read like a registered paragraph.
 *
 * Every pair of units is compared on the whole first screen — not only within
 * one region: restating a page's subtitle in its intro and its table headers is
 * exactly the redundancy across regions this category exists to find. A pair
 * is redundant when it shares at least `REDUNDANCY_MIN_SHARED` term stems and
 * those are at least `REDUNDANCY_PAIR_MIN` of the smaller unit's stems; pairs
 * join into clusters, and each cluster of two or more units is one hit.
 */

import type { ElementDesignData } from '../../core/types';
import { REDACTED_VALUE } from '../../core/redaction';
import type { QualityTextBlock, ViewportDimensions } from '../quality-types';
import { documentTop, isRendered } from './geometry';
import type { Rect } from './geometry';
import { sharedStems, termStems } from './text-terms';

/** Tunable: a pair is redundant at this share of the smaller unit's stems... */
export const REDUNDANCY_PAIR_MIN = 0.5;
/** Tunable: ...and at least this many shared stems. */
export const REDUNDANCY_MIN_SHARED = 2;
/** Tunable: how hard redundant characters cost against first-screen text. */
export const REDUNDANCY_PENALTY_SCALE = 2;

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const PROSE_TAGS = new Set(['p', 'caption', 'figcaption']);
const LABEL_TAGS = new Set(['label', 'legend', 'dt']);
const ID_CAP = 30;

export type TextUnitKind = 'heading' | 'prose' | 'labels';

interface TextUnit {
  kind: TextUnitKind;
  elementIds: string[];
  stems: string[];
  chars: number;
  top: number;
  rect: Rect;
}

export interface RedundancyHit {
  elementIds: string[];
  units: Array<{ kind: TextUnitKind; elementIds: string[]; rect: Rect }>;
  sharedTerms: string[];
  redundantChars: number;
  reason: string;
}

export interface RedundantTextResult {
  /** 0-100, or null when no candidate carried text. */
  score: number | null;
  hits: RedundancyHit[];
  unitsCompared: number;
  firstViewportTextChars: number;
}

function textKind(el: ElementDesignData): 'heading' | 'prose' | 'label' | null {
  const tag = el.structure?.tagName ?? '';
  const role = el.structure?.role ?? '';
  const type = el.type.toLowerCase();
  if (role === 'rowheader') return null;
  if (HEADING_TAGS.has(tag) || role === 'heading' || type === 'heading') return 'heading';
  if (tag === 'th' || role === 'columnheader' || type === 'table-header') return 'label';
  if (LABEL_TAGS.has(tag) || type === 'label') return 'label';
  if (PROSE_TAGS.has(tag) || type === 'paragraph' || type === 'description-text' || type === 'caption')
    return 'prose';
  return null;
}

export function redundantText(
  elements: readonly ElementDesignData[],
  viewport: ViewportDimensions,
  textBlocks: readonly QualityTextBlock[] = []
): RedundantTextResult {
  const H = viewport.height;
  const units: TextUnit[] = [];
  const labelSets = new Map<string, TextUnit>();
  let sawText = false;

  const add = (
    kind: 'heading' | 'prose' | 'label',
    id: string,
    text: string,
    rect: Rect,
    setKey: string
  ) => {
    sawText = true;
    const top = documentTop(rect, viewport);
    if (top >= H) return;
    const stems = termStems(text);
    if (stems.length === 0) return;
    if (kind === 'label') {
      const set = labelSets.get(setKey);
      if (set) {
        set.elementIds.push(id);
        for (const s of stems) if (!set.stems.includes(s)) set.stems.push(s);
        set.chars += text.length;
        set.top = Math.min(set.top, top);
        const x = Math.min(set.rect.x, rect.x);
        const y = Math.min(set.rect.y, rect.y);
        set.rect = {
          x,
          y,
          width: Math.max(set.rect.x + set.rect.width, rect.x + rect.width) - x,
          height: Math.max(set.rect.y + set.rect.height, rect.y + rect.height) - y,
        };
        return;
      }
      const unit: TextUnit = { kind: 'labels', elementIds: [id], stems: [...stems], chars: text.length, top, rect };
      labelSets.set(setKey, unit);
      units.push(unit);
      return;
    }
    units.push({ kind, elementIds: [id], stems, chars: text.length, top, rect });
  };

  for (const el of elements) {
    const text = el.structure?.text;
    if (!text || text === REDACTED_VALUE || !isRendered(el)) continue;
    const kind = textKind(el);
    if (!kind) continue;
    add(kind, el.elementId, text, el.rect, el.structure?.group?.key ?? el.structure?.parentId ?? el.elementId);
  }
  for (const b of textBlocks) {
    if (!b.text || b.text === REDACTED_VALUE) continue;
    add(HEADING_TAGS.has(b.tagName) ? 'heading' : 'prose', b.id, b.text, b.rect, b.id);
  }

  if (!sawText) return { score: null, hits: [], unitsCompared: 0, firstViewportTextChars: 0 };

  // Pairs, then clusters (union-find).
  const parent = units.map((_, i) => i);
  const rootOf = (i: number): number => (parent[i] === i ? i : (parent[i] = rootOf(parent[i])));
  const termsOf = new Map<number, Set<string>>();
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const shared = sharedStems(units[i].stems, units[j].stems);
      const smaller = Math.min(units[i].stems.length, units[j].stems.length);
      if (shared.length >= REDUNDANCY_MIN_SHARED && shared.length / smaller >= REDUNDANCY_PAIR_MIN) {
        parent[rootOf(i)] = rootOf(j);
        for (const k of [i, j]) {
          const set = termsOf.get(k) ?? new Set<string>();
          for (const s of shared) set.add(s);
          termsOf.set(k, set);
        }
      }
    }
  }
  const clusters = new Map<number, number[]>();
  units.forEach((_, i) => {
    if (!termsOf.has(i)) return;
    const root = rootOf(i);
    clusters.set(root, [...(clusters.get(root) ?? []), i]);
  });

  const hits: RedundancyHit[] = Array.from(clusters.values()).map((members) => {
    members.sort((a, b) => units[a].top - units[b].top);
    const terms = new Set<string>();
    for (const m of members) for (const s of termsOf.get(m) ?? []) terms.add(s);
    const longest = Math.max(...members.map((m) => units[m].chars));
    const redundantChars = members.reduce((s, m) => s + units[m].chars, 0) - longest;
    const kinds = members.map((m) => units[m].kind);
    return {
      elementIds: members.flatMap((m) => units[m].elementIds).slice(0, ID_CAP),
      units: members.map((m) => ({ kind: units[m].kind, elementIds: units[m].elementIds, rect: units[m].rect })),
      sharedTerms: Array.from(terms),
      redundantChars,
      reason: `${members.length} text blocks on the first screen (${kinds.join(', ')}) state the same terms again: ${Array.from(terms).join(', ')}.`,
    };
  });

  const total = units.reduce((s, u) => s + u.chars, 0);
  const redundant = hits.reduce((s, h) => s + h.redundantChars, 0);
  const score = total > 0 ? 100 * (1 - Math.min(1, (redundant / total) * REDUNDANCY_PENALTY_SCALE)) : 100;
  return { score, hits, unitsCompared: units.length, firstViewportTextChars: total };
}
