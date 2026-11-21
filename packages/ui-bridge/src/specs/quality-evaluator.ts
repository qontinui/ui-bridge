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
  MetricResult,
  MetricFinding,
} from './quality-types';
import { METRIC_FUNCTIONS } from './quality-metrics';
import { getContext, BUILT_IN_CONTEXTS } from './quality-contexts';

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
  assertUsableContext(context);
  return context;
}

const isObjectLike = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** `null` and `undefined` are "not given": the evaluator uses its default. */
const isGivenValue = (v: unknown): boolean => v !== undefined && v !== null;
const isScore = (n: unknown): boolean =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

/**
 * What is wrong with a quality context, or `null` when the evaluator can use
 * it. The ONE shape rule for every transport: the web request model (custom
 * and style-guide-declared contexts) and the native server both apply it. The
 * answer is a suffix to the caller's own name for the value, e.g.
 * `" must be an object …"` or `".metrics.contentOverflow must be …"`.
 *
 * A metric's fields may each be left out (or `null`) — the evaluator supplies
 * the default — but a given one must be usable: `enabled` a boolean (a string
 * "false" would otherwise run the metric), `weight` a finite number >= 0 (it
 * orders `topIssues`), and `thresholds` `{ good, warning }` in 0-100 (scores
 * run 0-100, so an out-of-range threshold would raise the findings of a metric
 * that scored 100).
 */
export function qualityContextProblem(value: unknown): string | null {
  if (!isObjectLike(value) || typeof value.name !== 'string' || !isObjectLike(value.metrics)) {
    return ' must be an object with a string name and a metrics object';
  }
  for (const [metricId, config] of Object.entries(value.metrics)) {
    // A metric id the evaluator does not run (a typo) would be ignored while
    // the real metric ran at its defaults.
    if (!Object.prototype.hasOwnProperty.call(METRIC_FUNCTIONS, metricId)) {
      return `.metrics.${metricId} is not a quality metric (known: ${Object.keys(METRIC_FUNCTIONS).join(', ')})`;
    }
    const usable =
      isObjectLike(config) &&
      (!isGivenValue(config.enabled) || typeof config.enabled === 'boolean') &&
      (!isGivenValue(config.weight) ||
        (typeof config.weight === 'number' &&
          Number.isFinite(config.weight) &&
          config.weight >= 0)) &&
      (!isGivenValue(config.thresholds) ||
        (isObjectLike(config.thresholds) &&
          isScore(config.thresholds.good) &&
          isScore(config.thresholds.warning) &&
          // A good bar below the warning bar would leave no warning band.
          (config.thresholds.good as number) >= (config.thresholds.warning as number)));
    if (!usable) {
      return (
        `.metrics.${metricId} must be an object whose enabled is a boolean, weight a finite ` +
        'number >= 0, and thresholds { good, warning } numbers from 0 to 100 with good >= warning'
      );
    }
  }
  return null;
}

/** Throw when `context` is not a usable quality context (`qualityContextProblem`). */
export function assertUsableContext(context: unknown): void {
  const problem = qualityContextProblem(context);
  if (problem !== null) throw new Error(`Quality context${problem}`);
}

/**
 * Whether `context` runs `metricId`. A metric the context does not configure
 * runs; this is the evaluator's own rule, shared so a caller deciding what to
 * collect cannot drift from it.
 */
export function isMetricEnabled(context: QualityContext, metricId: QualityMetricId): boolean {
  return context.metrics[metricId]?.enabled ?? true;
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
 * @returns Complete evaluation report: per-metric scores and weights, and actionable
 *   findings. Values, not verdicts — the report carries no grade and no aggregate score
 *   (no weighted overall, no UX sub-score): the standard a score is judged against, and
 *   any combination of scores, belongs to the caller.
 */
export function evaluateQuality(
  elements: ElementDesignData[],
  viewport: ViewportDimensions,
  context?: QualityContext | string
): QualityEvaluationReport {
  const startTime = Date.now();
  const ctx = resolveContext(context);

  const metricResults: MetricResult[] = [];

  const metricIds = Object.keys(METRIC_FUNCTIONS) as QualityMetricId[];

  for (const metricId of metricIds) {
    const config = ctx.metrics[metricId];
    const enabled = isMetricEnabled(ctx, metricId);
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
  }

  // Collect top issues: findings from enabled metrics, ordered by severity then metric weight
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
  customPropertyConsistency: 'consistency',
};

function getCategoryForMetric(metricId: QualityMetricId): MetricResult['category'] {
  return METRIC_CATEGORIES[metricId] ?? 'density';
}
