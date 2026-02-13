/**
 * Content Comparison
 *
 * Compares content elements (headings, metrics, labels, statuses, table data)
 * between source and target semantic snapshots. Produces a structured
 * ContentComparison result alongside the existing interactive element comparison.
 */

import type {
  AIDiscoveredElement,
  ContentComparison,
  HeadingMatch,
  HeadingChange,
  MetricMatch,
  CrossAppMetricChange,
  StatusMatch,
  CrossAppStatusChange,
  TableComparison,
  HeadingLevelComparison,
} from './types';
import { jaroWinklerSimilarity, normalizeString } from './fuzzy-matcher';
import { extractStructuredData } from './table-extraction';

export interface ContentComparisonConfig {
  /** Minimum fuzzy similarity to consider two labels as matching */
  labelMatchThreshold: number;
  /** Minimum fuzzy similarity to consider two headings as matching */
  headingMatchThreshold: number;
  /** Maximum cell differences to report per table */
  maxCellDifferences: number;
}

export const DEFAULT_CONTENT_COMPARISON_CONFIG: ContentComparisonConfig = {
  labelMatchThreshold: 0.8,
  headingMatchThreshold: 0.75,
  maxCellDifferences: 50,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the text content of an element for comparison.
 */
function getElementText(el: AIDiscoveredElement): string {
  return (
    el.accessibleName ||
    el.labelText ||
    el.label ||
    el.state?.textContent ||
    el.description ||
    ''
  ).trim();
}

/**
 * Get the content role from an element, checking both contentMetadata and
 * type-based heuristics.
 */
function getContentRole(el: AIDiscoveredElement): string | null {
  if (el.contentMetadata?.contentRole) {
    return el.contentMetadata.contentRole;
  }
  // Fall back to element type for common content types
  const t = (el.type || '').toLowerCase();
  if (t === 'heading' || (t.startsWith('h') && /^h[1-6]$/.test(t))) return 'heading';
  if (t === 'metric-value' || t === 'metric') return 'metric';
  if (t === 'status-message' || t === 'status') return 'status';
  if (t === 'label') return 'label';
  if (t === 'badge') return 'badge';
  if (t === 'table-cell') return 'table-cell';
  if (t === 'table-header') return 'table-header';
  if (t === 'caption') return 'caption';
  return null;
}

/**
 * Get heading level from element metadata or type.
 */
function getHeadingLevel(el: AIDiscoveredElement): number | undefined {
  if (el.contentMetadata?.headingLevel) {
    return el.contentMetadata.headingLevel;
  }
  // Check tagName or type like 'h1', 'h2', etc.
  const tag = (el.tagName || el.type || '').toLowerCase();
  const match = /^h([1-6])$/.exec(tag);
  if (match) return parseInt(match[1], 10);
  return undefined;
}

/**
 * Check if an element is a content element (not interactive).
 */
function isContentElement(el: AIDiscoveredElement): boolean {
  if (el.category === 'content') return true;
  if (el.contentMetadata) return true;
  const role = getContentRole(el);
  return role !== null;
}

/**
 * Normalize text for fuzzy comparison: lowercase, collapse whitespace, trim.
 */
function normalizeText(text: string): string {
  return normalizeString(text, { caseSensitive: false, ignoreWhitespace: true });
}

/**
 * Check if two texts match with fuzzy threshold.
 */
function _textsMatch(a: string, b: string, threshold: number): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return jaroWinklerSimilarity(na, nb) >= threshold;
}

/**
 * Extract the numeric or data portion from a metric/status element.
 * For elements like "Total: 42", returns { label: "Total", value: "42" }.
 * If no separator found, the full text is the value and the element label is used.
 */
function parseMetricText(el: AIDiscoveredElement): { label: string; value: string } {
  const text = getElementText(el);
  // Try common separator patterns: "Label: Value", "Label - Value"
  const colonMatch = text.match(/^(.+?):\s*(.+)$/);
  if (colonMatch) {
    return { label: colonMatch[1].trim(), value: colonMatch[2].trim() };
  }
  const dashMatch = text.match(/^(.+?)\s*[-]\s*(.+)$/);
  if (dashMatch) {
    return { label: dashMatch[1].trim(), value: dashMatch[2].trim() };
  }
  // Use the element's own label/accessibleName as the label, text as value
  const elLabel = el.accessibleName || el.labelText || el.label || el.id;
  return { label: elLabel, value: text };
}

// ---------------------------------------------------------------------------
// Filter elements by content role
// ---------------------------------------------------------------------------

function filterHeadings(elements: AIDiscoveredElement[]): AIDiscoveredElement[] {
  return elements.filter((el) => getContentRole(el) === 'heading');
}

function filterMetrics(elements: AIDiscoveredElement[]): AIDiscoveredElement[] {
  return elements.filter((el) => getContentRole(el) === 'metric');
}

function filterStatuses(elements: AIDiscoveredElement[]): AIDiscoveredElement[] {
  return elements.filter((el) => {
    const role = getContentRole(el);
    return role === 'status' || role === 'badge';
  });
}

function filterLabels(elements: AIDiscoveredElement[]): AIDiscoveredElement[] {
  return elements.filter((el) => {
    const role = getContentRole(el);
    return role === 'label' || role === 'caption';
  });
}

// ---------------------------------------------------------------------------
// Greedy bipartite matching with fuzzy text
// ---------------------------------------------------------------------------

interface MatchCandidate {
  sourceIdx: number;
  targetIdx: number;
  score: number;
}

/**
 * Match two lists of texts using greedy bipartite assignment.
 * Returns arrays of matched indices and unmatched indices.
 */
function matchTexts(
  sourceTexts: string[],
  targetTexts: string[],
  threshold: number
): {
  matched: Array<{ sourceIdx: number; targetIdx: number; score: number }>;
  unmatchedSource: number[];
  unmatchedTarget: number[];
} {
  const candidates: MatchCandidate[] = [];

  for (let si = 0; si < sourceTexts.length; si++) {
    const sNorm = normalizeText(sourceTexts[si]);
    if (!sNorm) continue;
    for (let ti = 0; ti < targetTexts.length; ti++) {
      const tNorm = normalizeText(targetTexts[ti]);
      if (!tNorm) continue;
      const score = sNorm === tNorm ? 1.0 : jaroWinklerSimilarity(sNorm, tNorm);
      if (score >= threshold) {
        candidates.push({ sourceIdx: si, targetIdx: ti, score });
      }
    }
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);

  const usedSource = new Set<number>();
  const usedTarget = new Set<number>();
  const matched: Array<{ sourceIdx: number; targetIdx: number; score: number }> = [];

  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);
    matched.push(c);
  }

  const unmatchedSource = sourceTexts.map((_, i) => i).filter((i) => !usedSource.has(i));
  const unmatchedTarget = targetTexts.map((_, i) => i).filter((i) => !usedTarget.has(i));

  return { matched, unmatchedSource, unmatchedTarget };
}

// ---------------------------------------------------------------------------
// Heading comparison
// ---------------------------------------------------------------------------

function compareHeadings(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: ContentComparisonConfig
): ContentComparison['headings'] {
  const srcHeadings = filterHeadings(sourceElements);
  const tgtHeadings = filterHeadings(targetElements);

  const srcTexts = srcHeadings.map(getElementText);
  const tgtTexts = tgtHeadings.map(getElementText);

  const { matched, unmatchedSource, unmatchedTarget } = matchTexts(
    srcTexts,
    tgtTexts,
    config.headingMatchThreshold
  );

  const headingMatched: HeadingMatch[] = [];
  const headingChanged: HeadingChange[] = [];

  for (const m of matched) {
    const srcText = srcTexts[m.sourceIdx];
    const tgtText = tgtTexts[m.targetIdx];
    const srcLevel = getHeadingLevel(srcHeadings[m.sourceIdx]);
    const tgtLevel = getHeadingLevel(tgtHeadings[m.targetIdx]);

    if (normalizeText(srcText) === normalizeText(tgtText)) {
      headingMatched.push({
        source: srcText,
        target: tgtText,
        level: srcLevel,
      });
    } else {
      headingChanged.push({
        source: srcText,
        target: tgtText,
        level: srcLevel ?? tgtLevel,
      });
    }
  }

  return {
    matched: headingMatched,
    sourceOnly: unmatchedSource.map((i) => srcTexts[i]),
    targetOnly: unmatchedTarget.map((i) => tgtTexts[i]),
    changed: headingChanged,
  };
}

// ---------------------------------------------------------------------------
// Metric comparison
// ---------------------------------------------------------------------------

function compareMetrics(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: ContentComparisonConfig
): ContentComparison['metrics'] {
  const srcMetrics = filterMetrics(sourceElements);
  const tgtMetrics = filterMetrics(targetElements);

  const srcParsed = srcMetrics.map(parseMetricText);
  const tgtParsed = tgtMetrics.map(parseMetricText);

  const srcLabels = srcParsed.map((p) => p.label);
  const tgtLabels = tgtParsed.map((p) => p.label);

  const { matched, unmatchedSource, unmatchedTarget } = matchTexts(
    srcLabels,
    tgtLabels,
    config.labelMatchThreshold
  );

  const metricMatched: MetricMatch[] = [];
  const metricChanged: CrossAppMetricChange[] = [];

  for (const m of matched) {
    const src = srcParsed[m.sourceIdx];
    const tgt = tgtParsed[m.targetIdx];

    if (normalizeText(src.value) === normalizeText(tgt.value)) {
      metricMatched.push({
        label: src.label,
        sourceValue: src.value,
        targetValue: tgt.value,
      });
    } else {
      metricChanged.push({
        label: src.label,
        sourceValue: src.value,
        targetValue: tgt.value,
      });
    }
  }

  return {
    matched: metricMatched,
    changed: metricChanged,
    sourceOnly: unmatchedSource.map((i) => srcParsed[i].label),
    targetOnly: unmatchedTarget.map((i) => tgtParsed[i].label),
  };
}

// ---------------------------------------------------------------------------
// Status comparison
// ---------------------------------------------------------------------------

function compareStatuses(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: ContentComparisonConfig
): ContentComparison['statuses'] {
  const srcStatuses = filterStatuses(sourceElements);
  const tgtStatuses = filterStatuses(targetElements);

  const srcParsed = srcStatuses.map(parseMetricText);
  const tgtParsed = tgtStatuses.map(parseMetricText);

  const srcLabels = srcParsed.map((p) => p.label);
  const tgtLabels = tgtParsed.map((p) => p.label);

  const { matched } = matchTexts(srcLabels, tgtLabels, config.labelMatchThreshold);

  const statusMatched: StatusMatch[] = [];
  const statusChanged: CrossAppStatusChange[] = [];

  for (const m of matched) {
    const src = srcParsed[m.sourceIdx];
    const tgt = tgtParsed[m.targetIdx];

    if (normalizeText(src.value) === normalizeText(tgt.value)) {
      statusMatched.push({
        label: src.label,
        sourceStatus: src.value,
        targetStatus: tgt.value,
      });
    } else {
      statusChanged.push({
        label: src.label,
        sourceStatus: src.value,
        targetStatus: tgt.value,
      });
    }
  }

  return {
    matched: statusMatched,
    changed: statusChanged,
  };
}

// ---------------------------------------------------------------------------
// Label / text comparison
// ---------------------------------------------------------------------------

function compareLabels(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: ContentComparisonConfig
): ContentComparison['labels'] {
  const srcLabels = filterLabels(sourceElements);
  const tgtLabels = filterLabels(targetElements);

  const srcTexts = srcLabels.map(getElementText);
  const tgtTexts = tgtLabels.map(getElementText);

  const { matched, unmatchedSource, unmatchedTarget } = matchTexts(
    srcTexts,
    tgtTexts,
    config.labelMatchThreshold
  );

  return {
    matched: matched.map((m) => srcTexts[m.sourceIdx]),
    sourceOnly: unmatchedSource.map((i) => srcTexts[i]),
    targetOnly: unmatchedTarget.map((i) => tgtTexts[i]),
  };
}

// ---------------------------------------------------------------------------
// Table comparison
// ---------------------------------------------------------------------------

function compareTables(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: ContentComparisonConfig
): TableComparison[] {
  const srcData = extractStructuredData(sourceElements);
  const tgtData = extractStructuredData(targetElements);

  const srcTables = srcData.tables;
  const tgtTables = tgtData.tables;

  if (srcTables.length === 0 || tgtTables.length === 0) {
    return [];
  }

  // Match tables by label similarity
  const srcTableLabels = srcTables.map((t) => t.label || '');
  const tgtTableLabels = tgtTables.map((t) => t.label || '');

  const { matched } = matchTexts(srcTableLabels, tgtTableLabels, config.labelMatchThreshold);

  // If label matching finds nothing, try matching by column similarity
  const tablePairs: Array<{ srcIdx: number; tgtIdx: number }> = [];
  if (matched.length > 0) {
    for (const m of matched) {
      tablePairs.push({ srcIdx: m.sourceIdx, tgtIdx: m.targetIdx });
    }
  } else if (srcTables.length === 1 && tgtTables.length === 1) {
    // Single table in both -- assume they correspond
    tablePairs.push({ srcIdx: 0, tgtIdx: 0 });
  }

  const comparisons: TableComparison[] = [];

  for (const pair of tablePairs) {
    const srcTable = srcTables[pair.srcIdx];
    const tgtTable = tgtTables[pair.tgtIdx];

    const srcHeaders = srcTable.columns.map((c) => c.header);
    const tgtHeaders = tgtTable.columns.map((c) => c.header);

    const srcHeaderSet = new Set(srcHeaders.map(normalizeText));
    const tgtHeaderSet = new Set(tgtHeaders.map(normalizeText));

    const sourceOnlyColumns = srcHeaders.filter((h) => !tgtHeaderSet.has(normalizeText(h)));
    const targetOnlyColumns = tgtHeaders.filter((h) => !srcHeaderSet.has(normalizeText(h)));
    const columnsMatch = sourceOnlyColumns.length === 0 && targetOnlyColumns.length === 0;

    // Compare cell values for matching columns
    const cellDifferences: TableComparison['cellDifferences'] = [];
    const commonHeaders = srcHeaders.filter((h) => tgtHeaderSet.has(normalizeText(h)));

    const minRows = Math.min(srcTable.rows.length, tgtTable.rows.length);
    for (let row = 0; row < minRows; row++) {
      if (cellDifferences.length >= config.maxCellDifferences) break;

      for (const header of commonHeaders) {
        const srcColIdx = srcHeaders.indexOf(header);
        const tgtColIdx = tgtHeaders.findIndex((h) => normalizeText(h) === normalizeText(header));

        if (srcColIdx < 0 || tgtColIdx < 0) continue;

        const srcValue = srcTable.rows[row]?.[srcColIdx] ?? '';
        const tgtValue = tgtTable.rows[row]?.[tgtColIdx] ?? '';

        if (normalizeText(srcValue) !== normalizeText(tgtValue)) {
          cellDifferences.push({
            row,
            column: header,
            sourceValue: srcValue,
            targetValue: tgtValue,
          });
        }
      }
    }

    comparisons.push({
      sourceLabel: srcTable.label,
      targetLabel: tgtTable.label,
      columnsMatch,
      sourceOnlyColumns,
      targetOnlyColumns,
      sourceRowCount: srcTable.rows.length,
      targetRowCount: tgtTable.rows.length,
      cellDifferences,
    });
  }

  return comparisons;
}

// ---------------------------------------------------------------------------
// Heading hierarchy comparison
// ---------------------------------------------------------------------------

function compareHeadingHierarchy(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[]
): HeadingLevelComparison[] {
  const srcHeadings = filterHeadings(sourceElements);
  const tgtHeadings = filterHeadings(targetElements);

  const srcByLevel = new Map<number, number>();
  const tgtByLevel = new Map<number, number>();

  for (const el of srcHeadings) {
    const level = getHeadingLevel(el) ?? 0;
    srcByLevel.set(level, (srcByLevel.get(level) ?? 0) + 1);
  }
  for (const el of tgtHeadings) {
    const level = getHeadingLevel(el) ?? 0;
    tgtByLevel.set(level, (tgtByLevel.get(level) ?? 0) + 1);
  }

  const allLevels = new Set([...srcByLevel.keys(), ...tgtByLevel.keys()]);
  const result: HeadingLevelComparison[] = [];

  for (const level of [...allLevels].sort()) {
    result.push({
      level,
      sourceCount: srcByLevel.get(level) ?? 0,
      targetCount: tgtByLevel.get(level) ?? 0,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main comparison function
// ---------------------------------------------------------------------------

/**
 * Compare content elements between source and target.
 *
 * Analyzes headings, metrics, statuses, labels, and table data,
 * producing a structured ContentComparison result.
 */
export function compareContent(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: ContentComparisonConfig = DEFAULT_CONTENT_COMPARISON_CONFIG
): ContentComparison {
  // Filter to content elements only (but include all for table extraction
  // since tables may contain interactive elements mixed with content)
  const srcContent = sourceElements.filter(isContentElement);
  const tgtContent = targetElements.filter(isContentElement);

  const headings = compareHeadings(srcContent, tgtContent, config);
  const metrics = compareMetrics(srcContent, tgtContent, config);
  const statuses = compareStatuses(srcContent, tgtContent, config);
  const labels = compareLabels(srcContent, tgtContent, config);
  const tables = compareTables(sourceElements, targetElements, config);
  const headingHierarchy = compareHeadingHierarchy(srcContent, tgtContent);

  // Calculate content parity score
  const contentParity = calculateContentParity(headings, metrics, statuses, labels, tables);

  return {
    headings,
    metrics,
    statuses,
    labels,
    tables,
    headingHierarchy,
    contentParity,
  };
}

/**
 * Calculate a content parity score (0-1) from all content comparison results.
 */
function calculateContentParity(
  headings: ContentComparison['headings'],
  metrics: ContentComparison['metrics'],
  statuses: ContentComparison['statuses'],
  labels: ContentComparison['labels'],
  tables: TableComparison[]
): number {
  const scores: number[] = [];

  // Heading parity
  const totalHeadings =
    headings.matched.length +
    headings.changed.length +
    headings.sourceOnly.length +
    headings.targetOnly.length;
  if (totalHeadings > 0) {
    scores.push(headings.matched.length / totalHeadings);
  }

  // Metric parity
  const totalMetrics =
    metrics.matched.length +
    metrics.changed.length +
    metrics.sourceOnly.length +
    metrics.targetOnly.length;
  if (totalMetrics > 0) {
    // Matched metrics (same value) get full score, changed get half
    const metricScore = (metrics.matched.length + metrics.changed.length * 0.5) / totalMetrics;
    scores.push(metricScore);
  }

  // Status parity
  const totalStatuses = statuses.matched.length + statuses.changed.length;
  if (totalStatuses > 0) {
    scores.push(statuses.matched.length / totalStatuses);
  }

  // Label parity
  const totalLabels = labels.matched.length + labels.sourceOnly.length + labels.targetOnly.length;
  if (totalLabels > 0) {
    scores.push(labels.matched.length / totalLabels);
  }

  // Table parity
  if (tables.length > 0) {
    let tableScore = 0;
    for (const table of tables) {
      let tScore = table.columnsMatch ? 0.5 : 0;
      if (table.sourceRowCount > 0) {
        const rowRatio = Math.min(
          table.targetRowCount / table.sourceRowCount,
          table.sourceRowCount / table.targetRowCount
        );
        tScore += rowRatio * 0.3;
      } else {
        tScore += 0.3;
      }
      // Penalize cell differences
      const totalCells =
        Math.max(table.sourceRowCount, 1) *
        Math.max(
          table.sourceOnlyColumns.length +
            table.targetOnlyColumns.length +
            (table.columnsMatch ? 1 : 0),
          1
        );
      const diffRatio =
        totalCells > 0 ? 1 - Math.min(table.cellDifferences.length / totalCells, 1) : 1;
      tScore += diffRatio * 0.2;
      tableScore += tScore;
    }
    scores.push(tableScore / tables.length);
  }

  if (scores.length === 0) return 1; // No content elements to compare
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
}
