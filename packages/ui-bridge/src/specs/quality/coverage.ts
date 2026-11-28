/**
 * Viewport coverage — `elementDensity` and `whitespaceRatio`.
 *
 * Coverage is the area of the UNION of the rendered leaf elements' rects,
 * clipped to the viewport, divided by the viewport's area. A container and the
 * children inside it, and two registered elements with the same box, cover
 * the same pixels once; hidden, transparent, zero-size and off-screen elements
 * cover nothing. Coverage is therefore in `[0, 1]`, and whitespace is its
 * complement.
 *
 * Until 2026-11 both metrics summed every registered element's area, so a page
 * of nested registered containers read a coverage above 1 (2.67 on one
 * measured page) and scored 0 whatever its layout (coord caveat
 * 7ac36d9e-134c-4586-bd72-3b484dc028c3).
 */

import type { ElementDesignData } from '../../core/types';
import type { MetricFinding, MetricFunction, ViewportDimensions } from '../quality-types';
import type { Rect } from './geometry';
import { clip, exclusionReason, renderedLeaves, unionArea, viewportRect } from './geometry';
import { makeResult } from './metric-result';

/** Tunable: the coverage band `elementDensity` scores 100 in. */
export const COVERAGE_BAND = { min: 0.3, max: 0.7 } as const;
/** Tunable: the whitespace band `whitespaceRatio` scores 100 in. */
export const WHITESPACE_BAND = { min: 0.25, max: 0.75 } as const;
/** Tunable: a leaf this much painted over (percent) covers nothing of its own. */
export const OCCLUDED_EXCLUDE_PCT = 90;

export interface ViewportCoverage {
  /** Union of rendered leaf rects inside the viewport / viewport area, in [0, 1]. */
  coverage: number;
  coveredArea: number;
  viewportArea: number;
  /** Rendered leaves counted (inside the viewport, not occluded). */
  leafCount: number;
  /** Rendered elements that contain another rendered element. */
  containerCount: number;
  /** Elements left out because they are not rendered (hidden, no layout, clipped away, detached). */
  excludedHidden: number;
  /** Rendered leaves with no pixel inside the viewport. */
  excludedOffViewport: number;
  /** Rendered leaves at least `OCCLUDED_EXCLUDE_PCT` painted over. */
  excludedOccluded: number;
  /** Excluded elements by reason. */
  excludedByReason: Record<string, number>;
  method: 'union-of-rendered-leaves';
  /** How containers were told from leaves. */
  leafBy: 'parentId' | 'geometry';
}

export function measureViewportCoverage(
  elements: readonly ElementDesignData[],
  viewport: ViewportDimensions
): ViewportCoverage {
  const excludedByReason: Record<string, number> = {};
  let excludedHidden = 0;
  for (const el of elements) {
    const reason = exclusionReason(el);
    if (reason) {
      excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
      excludedHidden++;
    }
  }
  const rendered = elements.filter((el) => exclusionReason(el) === null).length;
  const leaves = renderedLeaves(elements);
  const vp = viewportRect(viewport);
  let excludedOffViewport = 0;
  let excludedOccluded = 0;
  const inside: Rect[] = [];
  for (const el of leaves) {
    const r = clip(el.rect, vp);
    if (!r) {
      excludedOffViewport++;
      continue;
    }
    if ((el.structure?.occludedPct ?? 0) >= OCCLUDED_EXCLUDE_PCT) {
      excludedOccluded++;
      continue;
    }
    inside.push(r);
  }
  const viewportArea = viewport.width * viewport.height;
  const coveredArea = unionArea(inside);
  return {
    coverage: viewportArea > 0 ? Math.min(1, coveredArea / viewportArea) : 0,
    coveredArea,
    viewportArea,
    leafCount: inside.length,
    containerCount: rendered - leaves.length,
    excludedHidden,
    excludedOffViewport,
    excludedOccluded,
    excludedByReason,
    method: 'union-of-rendered-leaves',
    leafBy: leaves.length > 0 && leaves.every((el) => el.structure) ? 'parentId' : 'geometry',
  };
}

function coverageRaw(c: ViewportCoverage): Record<string, unknown> {
  return { ...c };
}

export const elementDensity: MetricFunction = (elements, viewport) => {
  if (viewport.width * viewport.height === 0)
    return makeResult('elementDensity', 'Element Density', 'density', null, [], {
      unmeasured: 'viewport has no area',
    });

  const c = measureViewportCoverage(elements, viewport);
  const { coverage } = c;
  const findings: MetricFinding[] = [];
  let score: number;
  if (coverage >= COVERAGE_BAND.min && coverage <= COVERAGE_BAND.max) {
    score = 100;
  } else if (coverage < COVERAGE_BAND.min) {
    score = (coverage / COVERAGE_BAND.min) * 100;
    findings.push({
      severity: 'warning',
      message: `Rendered content covers ${(coverage * 100).toFixed(1)}% of the viewport. Page may feel empty.`,
      recommendation: 'Consider adding content or reducing whitespace.',
    });
  } else {
    score = Math.max(0, 100 - ((coverage - COVERAGE_BAND.max) / (1 - COVERAGE_BAND.max)) * 100);
    findings.push({
      severity: 'warning',
      message: `Rendered content covers ${(coverage * 100).toFixed(1)}% of the viewport. Page may feel cluttered.`,
      recommendation: 'Consider reducing content density or increasing spacing.',
    });
  }
  return makeResult('elementDensity', 'Element Density', 'density', score, findings, coverageRaw(c));
};

export const whitespaceRatio: MetricFunction = (elements, viewport) => {
  if (viewport.width * viewport.height === 0)
    return makeResult('whitespaceRatio', 'Whitespace Ratio', 'density', null, [], {
      unmeasured: 'viewport has no area',
    });

  const c = measureViewportCoverage(elements, viewport);
  const ratio = 1 - c.coverage;
  const findings: MetricFinding[] = [];
  let score: number;
  if (ratio >= WHITESPACE_BAND.min && ratio <= WHITESPACE_BAND.max) {
    score = 100;
  } else if (ratio < WHITESPACE_BAND.min) {
    score = (ratio / WHITESPACE_BAND.min) * 100;
    findings.push({
      severity: 'warning',
      message: `Very low whitespace (${(ratio * 100).toFixed(1)}%). UI feels cramped.`,
      recommendation: 'Increase padding and margins between elements.',
    });
  } else {
    score = Math.max(0, 100 - ((ratio - WHITESPACE_BAND.max) / (1 - WHITESPACE_BAND.max)) * 100);
    findings.push({
      severity: 'info',
      message: `Very high whitespace (${(ratio * 100).toFixed(1)}%). Page may feel sparse.`,
      recommendation: 'Consider whether the empty space serves a purpose.',
    });
  }
  return makeResult('whitespaceRatio', 'Whitespace Ratio', 'density', score, findings, {
    ratio,
    ...coverageRaw(c),
  });
};
