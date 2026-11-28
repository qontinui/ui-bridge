/**
 * `informationDensity` category 3 — a primary action below the fold: a
 * function the page exists to offer that lies ENTIRELY below the first screen
 * while other functional groups sit on it, so a user must scroll to find it.
 *
 * Candidates, by structure alone (no words are read):
 *
 *  - a data-entry form: a `form` group holding at least one text-entry field
 *    and a submit control (a search, or a filter form of choices, is a control
 *    for the content around it, not a function of its own);
 *  - a prominent button: one whose visible background differs from the most
 *    common button background on the page, outside navigation and outside
 *    such a form.
 *
 * A candidate is a hit when every one of its rendered members starts at or
 * below the first screen's end (document coordinates) and at least one other
 * non-navigation group has a member on the first screen.
 */

import type { ElementDesignData } from '../../core/types';
import type { ViewportDimensions } from '../quality-types';
import { parseColor, isVisibleColor } from '../color-utils';
import { documentTop, entirelyBelowFirstScreen } from './geometry';
import type { FunctionalGroup } from './functional-groups';
import { describeGroup, isButton, isSubmit, isTextEntry } from './functional-groups';

/** Tunable: points each primary function below the fold costs. */
export const PRIMARY_BELOW_FOLD_PENALTY = 40;
const ID_CAP = 30;

export interface PrimaryBelowFoldHit {
  kind: 'form' | 'prominent-button';
  groupKey: string | null;
  elementIds: string[];
  groupsAbove: string[];
  topPx: number;
  screensBelow: number;
  reason: string;
}

export interface PrimaryBelowFoldResult {
  score: number | null;
  hits: PrimaryBelowFoldHit[];
  candidates: number;
}

function backgroundKey(el: ElementDesignData): string | null {
  const c = parseColor(el.styles?.backgroundColor);
  if (!isVisibleColor(c)) return null;
  return `${c.r},${c.g},${c.b}`;
}

function label(el: ElementDesignData): string {
  return el.structure?.text ? `"${el.structure.text}"` : el.elementId;
}

export function primaryActionBelowFold(
  rendered: readonly ElementDesignData[],
  groups: Map<string, FunctionalGroup>,
  viewport: ViewportDimensions,
  haveStructure: boolean
): PrimaryBelowFoldResult {
  if (!haveStructure) return { score: null, hits: [], candidates: 0 };
  const H = viewport.height;
  const above = Array.from(groups.values()).filter(
    (g) => g.kind !== 'nav' && g.members.some((m) => !entirelyBelowFirstScreen(m.rect, viewport))
  );
  const hits: PrimaryBelowFoldHit[] = [];
  const covered = new Set<string>();
  let candidates = 0;

  const hit = (
    kind: PrimaryBelowFoldHit['kind'],
    groupKey: string | null,
    elementIds: string[],
    top: number,
    what: string
  ) => {
    const others = above.filter((a) => a.key !== groupKey);
    if (others.length === 0) return;
    hits.push({
      kind,
      groupKey,
      elementIds: elementIds.slice(0, ID_CAP),
      groupsAbove: others.map((g) => g.key),
      topPx: Math.round(top),
      screensBelow: Number(((top - H) / H).toFixed(2)),
      reason: `${what} starts at ${Math.round(top)}px, entirely below the ${H}px first screen, while ${others
        .slice(0, 3)
        .map(describeGroup)
        .join(', ')} ${others.length === 1 ? 'is' : 'are'} on it.`,
    });
  };

  for (const g of groups.values()) {
    if (g.kind !== 'form') continue;
    const entry = g.fields.filter(isTextEntry);
    const submits = g.buttons.filter(isSubmit);
    if (entry.length === 0 || submits.length === 0) continue;
    candidates++;
    for (const m of g.members) covered.add(m.elementId);
    if (!g.members.every((m) => entirelyBelowFirstScreen(m.rect, viewport))) continue;
    const top = Math.min(...g.members.map((m) => documentTop(m.rect, viewport)));
    hit(
      'form',
      g.key,
      [g.key, ...submits.map((b) => b.elementId), ...g.fields.map((f) => f.elementId)],
      top,
      `${describeGroup(g)} (${g.fields.length} field(s), submit ${submits.map(label).join(', ')})`
    );
  }

  const buttons = rendered.filter((el) => isButton(el) && el.structure?.group?.kind !== 'nav');
  const counts = new Map<string, number>();
  for (const b of buttons) {
    const k = backgroundKey(b);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const common = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  for (const b of buttons) {
    if (covered.has(b.elementId)) continue;
    const k = backgroundKey(b);
    if (!k || k === common) continue;
    // A submit in a form with no text entry belongs to that search or filter.
    const groupKind = b.structure?.group?.kind;
    if ((isSubmit(b) && groupKind === 'form') || groupKind === 'search') continue;
    candidates++;
    if (!entirelyBelowFirstScreen(b.rect, viewport)) continue;
    const g = b.structure?.group ? groups.get(b.structure.group.key) : undefined;
    if (g && g.members.some((m) => !entirelyBelowFirstScreen(m.rect, viewport))) continue;
    hit('prominent-button', g?.key ?? null, [b.elementId], documentTop(b.rect, viewport), `The prominent button ${label(b)}`);
  }

  return {
    score: Math.max(0, 100 - hits.length * PRIMARY_BELOW_FOLD_PENALTY),
    hits,
    candidates,
  };
}
