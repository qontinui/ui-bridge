/**
 * Quality Evaluator
 *
 * Orchestrator that runs quality metrics, applies context weights,
 * and produces a comprehensive evaluation report.
 */

import type { ElementDesignData } from '../core/types';
import type {
  ViewportDimensions,
  QualityContext,
  QualityMetricId,
  QualityEvaluationReport,
  QualityGrade,
  MetricResult,
  MetricFinding,
} from './quality-types';
import { METRIC_FUNCTIONS } from './quality-metrics';
import { getContext, BUILT_IN_CONTEXTS } from './quality-contexts';

// ============================================================================
// Grade Assignment
// ============================================================================

function assignGrade(score: number): QualityGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ============================================================================
// Context Resolution
// ============================================================================

function resolveContext(context?: QualityContext | string): QualityContext {
  if (!context) return BUILT_IN_CONTEXTS['general'];
  if (typeof context === 'string') {
    const found = getContext(context);
    if (!found)
      throw new Error(
        `Unknown quality context: "${context}". Available: ${Object.keys(BUILT_IN_CONTEXTS).join(', ')}`
      );
    return found;
  }
  return context;
}

// ============================================================================
// Evaluator
// ============================================================================

/**
 * Run a holistic UI quality evaluation.
 *
 * @param elements - Design data for all elements to evaluate
 * @param viewport - Viewport dimensions
 * @param context - Context name (string) or custom context object. Defaults to 'general'.
 * @returns Complete evaluation report with scores, grades, and actionable findings
 */
export function evaluateQuality(
  elements: ElementDesignData[],
  viewport: ViewportDimensions,
  context?: QualityContext | string
): QualityEvaluationReport {
  const startTime = Date.now();
  const ctx = resolveContext(context);

  const metricResults: MetricResult[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  const metricIds = Object.keys(METRIC_FUNCTIONS) as QualityMetricId[];

  for (const metricId of metricIds) {
    const config = ctx.metrics[metricId];
    const enabled = config?.enabled ?? true;
    const weight = config?.weight ?? 0.045;

    if (!enabled) {
      metricResults.push({
        metricId,
        score: 0,
        label: metricId,
        category: getCategoryForMetric(metricId),
        enabled: false,
        weight: 0,
        findings: [],
      });
      continue;
    }

    const fn = METRIC_FUNCTIONS[metricId];
    const result = fn(elements, viewport);

    // Apply context weight
    result.weight = weight;
    result.enabled = true;

    // Apply threshold-based severity to findings
    if (config?.thresholds) {
      for (const finding of result.findings) {
        if (result.score < config.thresholds.warning) {
          finding.severity = 'error';
        } else if (result.score < config.thresholds.good) {
          finding.severity = finding.severity === 'error' ? 'error' : 'warning';
        }
      }
    }

    metricResults.push(result);
    weightedSum += result.score * weight;
    totalWeight += weight;
  }

  // Normalize weighted score
  const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 100;

  // Compute UX sub-score
  const uxMetrics = metricResults.filter(
    (r) => r.enabled && getCategoryForMetric(r.metricId) === 'ux'
  );
  let uxWeightedSum = 0;
  let uxTotalWeight = 0;
  for (const r of uxMetrics) {
    uxWeightedSum += r.score * r.weight;
    uxTotalWeight += r.weight;
  }
  const uxScore = uxTotalWeight > 0 ? Math.round(uxWeightedSum / uxTotalWeight) : 100;

  // Collect top issues: findings from non-good metrics, sorted by weight
  const allFindings: Array<MetricFinding & { _weight: number }> = [];
  for (const result of metricResults) {
    if (!result.enabled) continue;
    for (const finding of result.findings) {
      allFindings.push({ ...finding, _weight: result.weight });
    }
  }

  // Sort: errors first, then by metric weight descending
  allFindings.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2 };
    const sDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sDiff !== 0) return sDiff;
    return b._weight - a._weight;
  });

  const topIssues: MetricFinding[] = allFindings
    .slice(0, 10)
    .map(({ _weight, ...finding }) => finding);

  return {
    overallScore,
    grade: assignGrade(overallScore),
    uxScore,
    uxGrade: assignGrade(uxScore),
    contextName: ctx.name,
    metrics: metricResults,
    topIssues,
    totalElements: elements.length,
    viewport,
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// Metric Category Lookup
// ============================================================================

const METRIC_CATEGORIES: Record<QualityMetricId, MetricResult['category']> = {
  contentOverflow: 'ux',
  aboveFoldRatio: 'ux',
  informationDensity: 'ux',
  containerEfficiency: 'ux',
  viewportUtilization: 'ux',
  elementDensity: 'density',
  whitespaceRatio: 'density',
  localDensityBalance: 'density',
  horizontalBalance: 'density',
  verticalBalance: 'density',
  alignmentConsistency: 'density',
  spacingScaleAdherence: 'spacing',
  spacingConsistency: 'spacing',
  lineHeightRatio: 'spacing',
  interGroupSpacingRatio: 'spacing',
  uniqueColorCount: 'color',
  wcagContrastCompliance: 'color',
  colorHarmony: 'color',
  saturationConsistency: 'color',
  typeScaleAdherence: 'typography',
  fontWeightConsistency: 'typography',
  headingHierarchy: 'typography',
  fontFamilyCount: 'typography',
  buttonConsistency: 'consistency',
  cardConsistency: 'consistency',
  inputConsistency: 'consistency',
  touchTargetCompliance: 'consistency',
};

function getCategoryForMetric(metricId: QualityMetricId): MetricResult['category'] {
  return METRIC_CATEGORIES[metricId] ?? 'density';
}
