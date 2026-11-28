/**
 * A disabled metric is not run, so it has no score: `null`, never a 0 that
 * reads like a measurement (coord caveat 7ac36d9e: `data-dense` printed
 * `elementDensity 0`, `whitespaceRatio 0`).
 */

import { describe, expect, it } from 'vitest';
import { evaluateQuality } from '../quality-evaluator';
import type { QualityContext } from '../quality-types';
import { DESKTOP, el } from './quality/fixtures';

const page = () => [
  el('h', 'heading', { x: 0, y: 0, width: 400, height: 50 }, { tagName: 'h1', text: 'Aufträge' }),
  el('p', 'paragraph', { x: 0, y: 60, width: 400, height: 200 }, { tagName: 'p', text: 'Offene Lieferungen der Woche.' }),
];

describe('evaluateQuality: a disabled metric', () => {
  it('a disabled metric reports score null, not 0', () => {
    const report = evaluateQuality(page(), DESKTOP, 'data-dense');
    for (const id of ['elementDensity', 'whitespaceRatio']) {
      const m = report.metrics.find((x) => x.metricId === id)!;
      expect(m.enabled).toBe(false);
      expect(m.score).toBeNull();
    }
  });

  it('applies to a custom context that disables contentOverflow, and an enabled metric still scores', () => {
    const custom: QualityContext = {
      name: 'custom',
      description: 'contentOverflow off',
      metrics: { contentOverflow: { enabled: false, weight: 0, thresholds: { good: 80, warning: 50 } } },
    };
    const report = evaluateQuality(page(), DESKTOP, custom);
    const overflow = report.metrics.find((m) => m.metricId === 'contentOverflow')!;
    expect(overflow.score).toBeNull();
    const density = report.metrics.find((m) => m.metricId === 'elementDensity')!;
    expect(typeof density.score).toBe('number');
  });
});
