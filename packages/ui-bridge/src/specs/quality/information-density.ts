/**
 * `informationDensity` — how much of what a page puts on its first screen is
 * information, read as three general categories of low yield. Each category is
 * a component score (0-100, 100 = no hit; `null` when its input was not
 * measured) with hits that name the elements involved and give a reason, so a
 * reader can map a finding to a region of a frame:
 *
 *  1. `redundantText` — the same terms stated again by headings, intro copy and
 *     structural labels (`redundant-text.ts`);
 *  2. `disproportionateSpace` — a control group whose share of the first
 *     screen is out of proportion to its fields (`disproportionate-space.ts`);
 *  3. `primaryActionBelowFold` — a primary function entirely below the first
 *     screen while other groups sit on it (`primary-action.ts`).
 *
 * The score is the weighted mean of the components that were measured
 * (`INFORMATION_DENSITY_WEIGHTS`, renormalised over them), and `null` when none
 * was. Every threshold is an exported constant in its category's module.
 *
 * The checks are deterministic and role-free: they read geometry, structure
 * and scrubbed text, never an audience. Which content a given role comes for,
 * and how far away it is, is the density tool's question (`src/density/`,
 * `ui-bridge-density`; plan
 * 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change).
 * The id `informationDensity` is kept as part of the evaluator's report
 * contract; renaming it is recorded as plan-library follow-up edge
 * 1df890f7-d2b3-4566-86f6-339198475f7b on that plan.
 *
 * It reads `ElementDesignData.structure`, which `/design/evaluate` collects;
 * design data without it is reported as not measured.
 */

import type { MetricFinding, MetricFunction } from '../quality-types';
import { isRendered } from './geometry';
import { makeResult } from './metric-result';
import { collectGroups } from './functional-groups';
import { redundantText } from './redundant-text';
import { disproportionateSpace } from './disproportionate-space';
import { primaryActionBelowFold } from './primary-action';

/** Tunable: each component's weight in the combined score (renormalised over measured components). */
export const INFORMATION_DENSITY_WEIGHTS = {
  redundantText: 0.4,
  disproportionateSpace: 0.35,
  primaryActionBelowFold: 0.25,
} as const;

type Component = keyof typeof INFORMATION_DENSITY_WEIGHTS;

/** The weighted mean of the non-null components, or null when every component is null. */
export function combineComponents(scores: Record<Component, number | null>): number | null {
  let weight = 0;
  let sum = 0;
  for (const key of Object.keys(INFORMATION_DENSITY_WEIGHTS) as Component[]) {
    const s = scores[key];
    if (s === null) continue;
    weight += INFORMATION_DENSITY_WEIGHTS[key];
    sum += INFORMATION_DENSITY_WEIGHTS[key] * s;
  }
  return weight > 0 ? sum / weight : null;
}

export const informationDensity: MetricFunction = (elements, viewport, page) => {
  const haveStructure = elements.some((el) => el.structure);
  const rendered = elements.filter(isRendered);
  const groups = collectGroups(rendered);
  const redundant = redundantText(elements, viewport, page?.textBlocks);
  const space = disproportionateSpace(groups, viewport, haveStructure);
  const fold = primaryActionBelowFold(rendered, groups, viewport, haveStructure);

  const unmeasured: Array<{ input: string; reason: string }> = [];
  if (redundant.score === null)
    unmeasured.push({ input: 'redundantText', reason: 'no candidate text element carries structure.text' });
  if (!haveStructure) {
    unmeasured.push({ input: 'disproportionateSpace', reason: 'no element carries structure (functional groups)' });
    unmeasured.push({ input: 'primaryActionBelowFold', reason: 'no element carries structure (functional groups)' });
  }
  if (page?.textBlocks === undefined)
    unmeasured.push({ input: 'unregisteredTextBlocks', reason: 'page text blocks were not collected' });

  const score = combineComponents({
    redundantText: redundant.score,
    disproportionateSpace: space.score,
    primaryActionBelowFold: fold.score,
  });

  const findings: MetricFinding[] = [];
  for (const h of redundant.hits) {
    findings.push({
      severity: 'warning',
      message: `Redundant text: ${h.reason}`,
      recommendation: 'Say it once: drop or merge the copy that restates the heading and the labels.',
      elementIds: h.elementIds,
    });
  }
  for (const h of space.hits) {
    findings.push({
      severity: 'warning',
      message: `Disproportionate space: ${h.reason}`,
      recommendation:
        h.kind === 'out-of-proportion'
          ? 'Compact the controls (one row, a toolbar, a disclosure) so the primary content reaches the first screen.'
          : 'Put the controls side by side, or move a sort into the table headers.',
      elementIds: h.elementIds,
    });
  }
  for (const h of fold.hits) {
    findings.push({
      severity: 'warning',
      message: `Primary action below the fold: ${h.reason}`,
      recommendation:
        'Bring the action onto the first screen (a header button that opens the form, or the form above the list).',
      elementIds: h.elementIds,
    });
  }

  const round = (n: number | null) => (n === null ? null : Math.round(n));
  return makeResult('informationDensity', 'Information Density', 'ux', score, findings, {
    categories: {
      redundantText: {
        score: round(redundant.score),
        weight: INFORMATION_DENSITY_WEIGHTS.redundantText,
        unitsCompared: redundant.unitsCompared,
        firstViewportTextChars: redundant.firstViewportTextChars,
        hits: redundant.hits,
      },
      disproportionateSpace: {
        score: round(space.score),
        weight: INFORMATION_DENSITY_WEIGHTS.disproportionateSpace,
        primaryContent: space.primaryContent,
        groups: space.groups,
        hits: space.hits,
      },
      primaryActionBelowFold: {
        score: round(fold.score),
        weight: INFORMATION_DENSITY_WEIGHTS.primaryActionBelowFold,
        candidates: fold.candidates,
        hits: fold.hits,
      },
    },
    unmeasured,
    firstViewport: { width: viewport.width, height: viewport.height, scrollY: viewport.scrollY ?? null },
  });
};
