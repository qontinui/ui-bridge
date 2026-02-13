/**
 * Cross-App Diff
 *
 * Matches elements between source and target pages and computes
 * a structured diff of data values, formats, and unmatched elements.
 */

import type {
  AIDiscoveredElement,
  MatchedElementPair,
  DataValueComparison,
  CrossAppDiff,
} from './types';
import { jaroWinklerSimilarity, normalizeString } from './fuzzy-matcher';
import { extractPageData, normalizeValue, classifyDataType } from './data-extraction';
import { analyzePageFormats, compareFormats } from './format-analysis';

export interface CrossAppDiffConfig {
  /** Minimum confidence to consider a match */
  matchThreshold: number;
  /** Weight for accessible name matching */
  accessibleNameWeight: number;
  /** Weight for text matching */
  textWeight: number;
  /** Weight for role + position matching */
  rolePositionWeight: number;
}

export const DEFAULT_CROSS_APP_DIFF_CONFIG: CrossAppDiffConfig = {
  matchThreshold: 0.5,
  accessibleNameWeight: 1.0,
  textWeight: 0.95,
  rolePositionWeight: 0.7,
};

/**
 * Get the displayable text from an element.
 */
function getElementText(el: AIDiscoveredElement): string {
  return (
    el.accessibleName || el.labelText || el.label || el.state?.textContent || el.description || ''
  );
}

/**
 * Get the role of an element.
 */
function getRole(el: AIDiscoveredElement): string {
  return (el.role || el.type || '').toLowerCase();
}

/**
 * Get the center position of an element.
 */
function getCenter(el: AIDiscoveredElement): { x: number; y: number } | null {
  const rect = el.state?.rect;
  if (!rect) return null;
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/**
 * Compute a match score between two elements using multiple strategies.
 * Returns { score, strategy } where strategy describes the best match.
 */
function computeMatchScore(
  source: AIDiscoveredElement,
  target: AIDiscoveredElement,
  config: CrossAppDiffConfig
): { score: number; strategy: string } {
  let bestScore = 0;
  let bestStrategy = 'none';

  // Strategy 1: Exact accessible name match
  const srcName = (source.accessibleName || '').trim();
  const tgtName = (target.accessibleName || '').trim();
  if (srcName && tgtName && srcName.toLowerCase() === tgtName.toLowerCase()) {
    return { score: config.accessibleNameWeight, strategy: 'accessible-name-exact' };
  }

  // Strategy 2: Exact text match
  const srcText = getElementText(source);
  const tgtText = getElementText(target);
  if (srcText && tgtText && srcText.toLowerCase() === tgtText.toLowerCase()) {
    const score = config.textWeight;
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = 'text-exact';
    }
  }

  // Strategy 3: Fuzzy text match via Jaro-Winkler
  if (srcText && tgtText) {
    const srcNorm = normalizeString(srcText);
    const tgtNorm = normalizeString(tgtText);
    const similarity = jaroWinklerSimilarity(srcNorm, tgtNorm);
    const score = similarity * 0.85;
    if (score > bestScore) {
      bestScore = score;
      bestStrategy = 'text-fuzzy';
    }
  }

  // Strategy 4: Same role + similar position
  const srcRole = getRole(source);
  const tgtRole = getRole(target);
  if (srcRole && srcRole === tgtRole) {
    const srcCenter = getCenter(source);
    const tgtCenter = getCenter(target);
    if (srcCenter && tgtCenter) {
      // Normalized position similarity (assume 1920x1080 viewport)
      const dx = Math.abs(srcCenter.x - tgtCenter.x) / 1920;
      const dy = Math.abs(srcCenter.y - tgtCenter.y) / 1080;
      const posSimilarity = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const score = config.rolePositionWeight * posSimilarity;
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = 'role-position';
      }
    }
  }

  // Strategy 5: Data overlap (same normalized value)
  const srcVal = source.state?.value ?? source.state?.textContent ?? '';
  const tgtVal = target.state?.value ?? target.state?.textContent ?? '';
  if (srcVal && tgtVal) {
    const srcType = classifyDataType(srcVal).type;
    const tgtType = classifyDataType(tgtVal).type;
    const srcNorm = normalizeValue(srcVal, srcType);
    const tgtNorm = normalizeValue(tgtVal, tgtType);
    if (srcNorm === tgtNorm && srcNorm !== '') {
      const score = 0.6;
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = 'data-overlap';
      }
    }
  }

  return { score: bestScore, strategy: bestStrategy };
}

/**
 * Match elements between source and target using greedy assignment.
 * Elements are matched by descending confidence.
 */
export function matchElements(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: CrossAppDiffConfig = DEFAULT_CROSS_APP_DIFF_CONFIG
): MatchedElementPair[] {
  // Compute all pairwise scores
  const candidates: Array<{
    sourceIdx: number;
    targetIdx: number;
    score: number;
    strategy: string;
  }> = [];

  for (let si = 0; si < sourceElements.length; si++) {
    for (let ti = 0; ti < targetElements.length; ti++) {
      const { score, strategy } = computeMatchScore(sourceElements[si], targetElements[ti], config);
      if (score >= config.matchThreshold) {
        candidates.push({ sourceIdx: si, targetIdx: ti, score, strategy });
      }
    }
  }

  // Greedy assignment: sort descending by score, assign first-come
  candidates.sort((a, b) => b.score - a.score);

  const usedSource = new Set<number>();
  const usedTarget = new Set<number>();
  const pairs: MatchedElementPair[] = [];

  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);

    const src = sourceElements[c.sourceIdx];
    const tgt = targetElements[c.targetIdx];

    pairs.push({
      sourceId: src.id,
      targetId: tgt.id,
      sourceLabel: getElementText(src) || src.id,
      targetLabel: getElementText(tgt) || tgt.id,
      confidence: Math.round(c.score * 100) / 100,
      matchStrategy: c.strategy,
    });
  }

  return pairs;
}

/**
 * Compute a full cross-app diff between source and target element sets.
 */
export function computeCrossAppDiff(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: CrossAppDiffConfig = DEFAULT_CROSS_APP_DIFF_CONFIG
): CrossAppDiff {
  // Match elements
  const matchedPairs = matchElements(sourceElements, targetElements, config);
  const matchedSourceIds = new Set(matchedPairs.map((p) => p.sourceId));
  const matchedTargetIds = new Set(matchedPairs.map((p) => p.targetId));

  const unmatchedSourceIds = sourceElements
    .filter((e) => !matchedSourceIds.has(e.id))
    .map((e) => e.id);
  const unmatchedTargetIds = targetElements
    .filter((e) => !matchedTargetIds.has(e.id))
    .map((e) => e.id);

  // Data comparisons for matched pairs
  const sourceData = extractPageData(sourceElements);
  const targetData = extractPageData(targetElements);

  const dataComparisons: DataValueComparison[] = [];
  for (const pair of matchedPairs) {
    // Find data values by element ID
    const srcEntry = Object.values(sourceData.values).find((v) => v.elementId === pair.sourceId);
    const tgtEntry = Object.values(targetData.values).find((v) => v.elementId === pair.targetId);

    if (srcEntry && tgtEntry) {
      dataComparisons.push({
        label: pair.sourceLabel,
        sourceValue: srcEntry.rawValue,
        targetValue: tgtEntry.rawValue,
        valuesMatch: srcEntry.normalizedValue === tgtEntry.normalizedValue,
        formatsMatch: srcEntry.dataType === tgtEntry.dataType,
      });
    }
  }

  // Format mismatches
  const sourceFormats = analyzePageFormats(sourceElements);
  const targetFormats = analyzePageFormats(targetElements);
  const formatMismatches = compareFormats(sourceFormats, targetFormats);

  return {
    matchedPairs,
    unmatchedSourceIds,
    unmatchedTargetIds,
    dataComparisons,
    formatMismatches,
  };
}
