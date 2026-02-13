/**
 * Comparison Report
 *
 * Orchestrates all cross-app analysis modules to produce a unified
 * comparison report with scores, issues, and a summary.
 */

import type {
  SemanticSnapshot,
  CrossAppComparisonReport,
  ComparisonIssue,
  ComponentInfo,
} from './types';
import { extractPageData } from './data-extraction';
import { segmentPageRegions } from './region-segmentation';
import { computeCrossAppDiff } from './cross-app-diff';
import { analyzeActionParity } from './action-parity';
import { buildNavigationMap } from './navigation-map';
import { compareComponents } from './component-comparison';
import { compareLayouts } from './layout-comparison';
import { compareContent } from './content-comparison';

export interface ComparisonReportConfig {
  /** Include component comparison (requires separate ComponentInfo arrays) */
  includeComponents: boolean;
}

export const DEFAULT_COMPARISON_REPORT_CONFIG: ComparisonReportConfig = {
  includeComponents: false,
};

/**
 * Generate a comprehensive cross-app comparison report.
 *
 * @param source - Source page semantic snapshot
 * @param target - Target page semantic snapshot
 * @param options - Optional configuration and component data
 * @returns Full comparison report with scores, issues, and summary
 */
export function generateComparisonReport(
  source: SemanticSnapshot,
  target: SemanticSnapshot,
  options?: {
    config?: ComparisonReportConfig;
    sourceComponents?: ComponentInfo[];
    targetComponents?: ComponentInfo[];
  }
): CrossAppComparisonReport {
  const startTime = Date.now();
  const config = { ...DEFAULT_COMPARISON_REPORT_CONFIG, ...options?.config };

  const srcElements = source.elements;
  const tgtElements = target.elements;

  // 1. Cross-app diff (element matching + data comparison)
  const diff = computeCrossAppDiff(srcElements, tgtElements);

  // 2. Navigation map
  const navigation = buildNavigationMap(srcElements, tgtElements);

  // 3. Region segmentation
  const sourceRegions = segmentPageRegions(srcElements);
  const targetRegions = segmentPageRegions(tgtElements);

  // 4. Layout comparison
  const layout = compareLayouts(srcElements, tgtElements, sourceRegions, targetRegions);

  // 5. Action parity
  const actionParityResults = analyzeActionParity(diff.matchedPairs, srcElements, tgtElements);

  // 6. Component comparison (optional)
  const componentComparison =
    config.includeComponents && options?.sourceComponents && options?.targetComponents
      ? compareComponents(options.sourceComponents, options.targetComponents)
      : null;

  // 7. Content comparison (headings, metrics, statuses, labels, tables)
  const contentComparison = compareContent(srcElements, tgtElements);

  // --- Compute Scores ---

  // Data completeness: how many source data fields are matched in target
  const sourceData = extractPageData(srcElements);
  const _targetData = extractPageData(tgtElements);
  const sourceFieldCount = Object.keys(sourceData.values).length;
  const matchedDataCount = diff.dataComparisons.length;
  const dataCompleteness =
    sourceFieldCount > 0 ? Math.round((matchedDataCount / sourceFieldCount) * 100) / 100 : 1;

  // Format alignment: fraction of matched fields with same format
  const formatMatchCount = diff.dataComparisons.filter((c) => c.formatsMatch).length;
  const formatAlignment =
    matchedDataCount > 0 ? Math.round((formatMatchCount / matchedDataCount) * 100) / 100 : 1;

  // Presentation alignment: layout similarity
  const presentationAlignment = layout.similarity;

  // Navigation parity
  const totalNavItems = navigation.pairs.length + navigation.sourceOnly.length;
  const navigationParity =
    totalNavItems > 0 ? Math.round((navigation.pairs.length / totalNavItems) * 100) / 100 : 1;

  // Action parity
  const totalActionChecks = actionParityResults.length;
  const fullParityCount = actionParityResults.filter((r) => r.missingInTarget.length === 0).length;
  const actionParity =
    totalActionChecks > 0 ? Math.round((fullParityCount / totalActionChecks) * 100) / 100 : 1;

  // Content parity
  const contentParity = contentComparison.contentParity;

  // Overall score (weighted average, includes content parity)
  const overallScore =
    Math.round(
      (dataCompleteness * 0.2 +
        formatAlignment * 0.1 +
        presentationAlignment * 0.15 +
        navigationParity * 0.15 +
        actionParity * 0.15 +
        contentParity * 0.25) *
        100
    ) / 100;

  // --- Collect Issues ---

  const issues: ComparisonIssue[] = [];

  // Missing data fields
  for (const srcId of diff.unmatchedSourceIds) {
    const srcVal = Object.values(sourceData.values).find((v) => v.elementId === srcId);
    if (srcVal) {
      issues.push({
        severity: 'warning',
        category: 'missing-data',
        description: `Data field "${srcVal.label}" (${srcVal.dataType}) exists in source but has no match in target`,
        sourceElementId: srcId,
      });
    }
  }

  // Value mismatches
  for (const comp of diff.dataComparisons) {
    if (!comp.valuesMatch) {
      issues.push({
        severity: 'error',
        category: 'value-mismatch',
        description: `Value mismatch for "${comp.label}": source="${comp.sourceValue}", target="${comp.targetValue}"`,
      });
    }
  }

  // Format mismatches
  for (const fm of diff.formatMismatches) {
    issues.push({
      severity: fm.severity,
      category: 'format-mismatch',
      description: fm.description,
    });
  }

  // Missing actions
  for (const ap of actionParityResults) {
    for (const action of ap.missingInTarget) {
      issues.push({
        severity: 'warning',
        category: 'missing-action',
        description: `Action "${action}" available on source element "${ap.pair.sourceLabel}" is missing in target`,
        sourceElementId: ap.pair.sourceId,
        targetElementId: ap.pair.targetId,
      });
    }
  }

  // Navigation gaps
  for (const srcId of navigation.sourceOnly) {
    issues.push({
      severity: 'warning',
      category: 'navigation-gap',
      description: `Navigation item "${srcId}" in source has no match in target`,
      sourceElementId: srcId,
    });
  }

  // Layout differences (only if significant)
  if (layout.similarity < 0.5) {
    issues.push({
      severity: 'warning',
      category: 'layout-difference',
      description: `Layout similarity is low (${layout.similarity}). Grid: ${layout.gridDiff.sourceGrid.columnCount} cols vs ${layout.gridDiff.targetGrid.columnCount} cols`,
    });
  }

  // Component mismatches
  if (componentComparison) {
    for (const src of componentComparison.sourceOnly) {
      issues.push({
        severity: 'info',
        category: 'component-mismatch',
        description: `Component "${src.name}" (${src.type}) exists in source but not target`,
      });
    }
    for (const match of componentComparison.matches) {
      if (match.stateKeyDiff.missing.length > 0) {
        issues.push({
          severity: 'warning',
          category: 'component-mismatch',
          description: `Component "${match.source.name}": state keys missing in target: ${match.stateKeyDiff.missing.join(', ')}`,
        });
      }
    }
  }

  // Content differences
  for (const heading of contentComparison.headings.sourceOnly) {
    issues.push({
      severity: 'warning',
      category: 'content-difference',
      description: `Heading "${heading}" exists in source but not in target`,
    });
  }
  for (const heading of contentComparison.headings.targetOnly) {
    issues.push({
      severity: 'info',
      category: 'content-difference',
      description: `Heading "${heading}" exists in target but not in source`,
    });
  }
  for (const change of contentComparison.headings.changed) {
    issues.push({
      severity: 'warning',
      category: 'content-difference',
      description: `Heading changed: "${change.source}" -> "${change.target}"`,
    });
  }
  for (const change of contentComparison.metrics.changed) {
    issues.push({
      severity: 'warning',
      category: 'content-difference',
      description: `Metric "${change.label}" value differs: "${change.sourceValue}" vs "${change.targetValue}"`,
    });
  }
  for (const label of contentComparison.metrics.sourceOnly) {
    issues.push({
      severity: 'warning',
      category: 'content-difference',
      description: `Metric "${label}" exists in source but not in target`,
    });
  }
  for (const change of contentComparison.statuses.changed) {
    issues.push({
      severity: 'warning',
      category: 'content-difference',
      description: `Status "${change.label}" differs: "${change.sourceStatus}" vs "${change.targetStatus}"`,
    });
  }
  for (const table of contentComparison.tables) {
    if (!table.columnsMatch) {
      issues.push({
        severity: 'warning',
        category: 'content-difference',
        description: `Table "${table.sourceLabel}" column mismatch: source-only=[${table.sourceOnlyColumns.join(', ')}], target-only=[${table.targetOnlyColumns.join(', ')}]`,
      });
    }
    if (table.sourceRowCount !== table.targetRowCount) {
      issues.push({
        severity: 'info',
        category: 'content-difference',
        description: `Table "${table.sourceLabel}" row count differs: ${table.sourceRowCount} vs ${table.targetRowCount}`,
      });
    }
    if (table.cellDifferences.length > 0) {
      issues.push({
        severity: 'warning',
        category: 'content-difference',
        description: `Table "${table.sourceLabel}" has ${table.cellDifferences.length} cell value difference(s)`,
      });
    }
  }

  // Sort issues: error > warning > info
  const severityOrder = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // --- Build Summary ---

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  const summaryLines = [
    `Cross-app comparison: ${source.page.url} vs ${target.page.url}`,
    `Overall score: ${(overallScore * 100).toFixed(0)}%`,
    `Matched elements: ${diff.matchedPairs.length}`,
    `Unmatched: ${diff.unmatchedSourceIds.length} source, ${diff.unmatchedTargetIds.length} target`,
    `Navigation: ${navigation.pairs.length} matched, ${navigation.sourceOnly.length} source-only, ${navigation.targetOnly.length} target-only`,
  ];

  if (componentComparison) {
    summaryLines.push(
      `Components: ${componentComparison.matches.length} matched, ${componentComparison.sourceOnly.length} source-only, ${componentComparison.targetOnly.length} target-only`
    );
  }

  // Content summary
  const hMatched = contentComparison.headings.matched.length;
  const hChanged = contentComparison.headings.changed.length;
  const hSrcOnly = contentComparison.headings.sourceOnly.length;
  const hTgtOnly = contentComparison.headings.targetOnly.length;
  const mMatched = contentComparison.metrics.matched.length;
  const mChanged = contentComparison.metrics.changed.length;
  const sMatched = contentComparison.statuses.matched.length;
  const sChanged = contentComparison.statuses.changed.length;
  const totalContent =
    hMatched + hChanged + hSrcOnly + hTgtOnly + mMatched + mChanged + sMatched + sChanged;

  if (totalContent > 0) {
    summaryLines.push(
      `Content: headings=${hMatched} matched/${hChanged} changed/${hSrcOnly + hTgtOnly} unmatched, ` +
        `metrics=${mMatched} matched/${mChanged} changed, ` +
        `statuses=${sMatched} matched/${sChanged} changed, ` +
        `parity=${(contentParity * 100).toFixed(0)}%`
    );
  }

  summaryLines.push(`Issues: ${errorCount} errors, ${warningCount} warnings, ${infoCount} info`);

  const summary = summaryLines.join('\n');

  const report: CrossAppComparisonReport = {
    sourceUrl: source.page.url,
    targetUrl: target.page.url,
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
    scores: {
      dataCompleteness,
      formatAlignment,
      presentationAlignment,
      navigationParity,
      actionParity,
      overallScore,
    },
    diff,
    navigation,
    layout,
    contentComparison,
    issues,
    summary,
  };

  if (componentComparison) {
    report.components = componentComparison;
  }

  return report;
}
