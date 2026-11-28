/**
 * The one constructor every quality metric builds its result with.
 */

import type { MetricFinding, MetricResult, QualityMetricId } from '../quality-types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * A metric result. `score` null means the metric could not measure what it
 * names from the data it was given (`rawData.unmeasured` says what was
 * missing) — never a perfect score it did not earn.
 */
export function makeResult(
  metricId: QualityMetricId,
  label: string,
  category: MetricResult['category'],
  score: number | null,
  findings: MetricFinding[],
  rawData?: Record<string, unknown>
): MetricResult {
  return {
    metricId,
    score: score === null ? null : Math.round(clamp(score, 0, 100)),
    label,
    category,
    enabled: true,
    weight: 0, // set by evaluator from context
    findings,
    rawData,
  };
}
