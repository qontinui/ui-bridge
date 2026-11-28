/**
 * `informationDensity` combines its three category components as a weighted
 * mean over the components that were measured.
 */

import { describe, expect, it } from 'vitest';
import { informationDensity } from '../../quality-metrics';
import { combineComponents } from '../../quality/information-density';
import { DESKTOP, category, el, orderListPage } from './fixtures';

describe('informationDensity: the combined score', () => {
  it('is 100 when every component is clean', () => {
    expect(combineComponents({ redundantText: 100, disproportionateSpace: 100, primaryActionBelowFold: 100 })).toBe(100);
  });

  it('weights the components 0.4 / 0.35 / 0.25', () => {
    expect(combineComponents({ redundantText: 50, disproportionateSpace: 40, primaryActionBelowFold: 60 })).toBe(49);
  });

  it('renormalises over the measured components', () => {
    // 0.35 * 40 + 0.25 * 60 = 29, over a weight of 0.6.
    expect(combineComponents({ redundantText: null, disproportionateSpace: 40, primaryActionBelowFold: 60 })).toBeCloseTo(48.333, 3);
  });

  it('is null when no component was measured', () => {
    expect(combineComponents({ redundantText: null, disproportionateSpace: null, primaryActionBelowFold: null })).toBeNull();
  });

  it('reports every category with findings that carry the same element ids', () => {
    const result = informationDensity(orderListPage(), DESKTOP);
    const raw = result.rawData;
    const ids = ['redundantText', 'disproportionateSpace', 'primaryActionBelowFold'].flatMap((name) =>
      category(raw, name).hits.map((h) => h.elementIds)
    );
    expect(result.findings.map((f) => f.elementIds)).toEqual(ids);
    expect(result.findings).toHaveLength(4);
    // Redundant text: 118 redundant of 274 first-screen characters, x2 -> 13.87;
    // disproportionate space 40; below the fold 60. 0.4*13.87 + 0.35*40 + 0.25*60 = 34.55.
    expect(category(raw, 'redundantText').score).toBe(14);
    expect(result.score).toBe(35);
  });

  it('reports not measured (null), never 100, for design data without structure', () => {
    const result = informationDensity([el('a', 'heading', { x: 0, y: 0, width: 400, height: 50 })], DESKTOP);
    expect(result.score).toBeNull();
    expect((result.rawData?.unmeasured as Array<{ input: string }>).map((u) => u.input)).toContain('redundantText');
  });
});
