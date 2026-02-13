/**
 * Component Comparison
 *
 * Compares registered components between source and target apps,
 * matching by name/type and diffing state keys and actions.
 */

import type { ComponentInfo, ComponentMatch, ComponentComparison } from './types';
import { jaroWinklerSimilarity, normalizeString } from './fuzzy-matcher';

export interface ComponentComparisonConfig {
  /** Minimum similarity for name matching */
  nameMatchThreshold: number;
}

export const DEFAULT_COMPONENT_COMPARISON_CONFIG: ComponentComparisonConfig = {
  nameMatchThreshold: 0.75,
};

/**
 * Compute match score between two components based on name and type.
 */
function computeComponentMatchScore(source: ComponentInfo, target: ComponentInfo): number {
  // Exact name match
  if (source.name.toLowerCase() === target.name.toLowerCase()) return 1.0;

  // Same type + similar name
  let score = 0;

  if (source.type === target.type) {
    score += 0.3;
  }

  const nameSimilarity = jaroWinklerSimilarity(
    normalizeString(source.name),
    normalizeString(target.name)
  );
  score += nameSimilarity * 0.7;

  return score;
}

/**
 * Compare components between source and target apps.
 *
 * Note: ComponentInfo is not part of SemanticSnapshot. The caller must
 * fetch component lists separately from /control/components endpoint.
 */
export function compareComponents(
  sourceComponents: ComponentInfo[],
  targetComponents: ComponentInfo[],
  config: ComponentComparisonConfig = DEFAULT_COMPONENT_COMPARISON_CONFIG
): ComponentComparison {
  // Compute all pairwise match scores
  const candidates: Array<{
    sourceIdx: number;
    targetIdx: number;
    score: number;
  }> = [];

  for (let si = 0; si < sourceComponents.length; si++) {
    for (let ti = 0; ti < targetComponents.length; ti++) {
      const score = computeComponentMatchScore(sourceComponents[si], targetComponents[ti]);
      if (score >= config.nameMatchThreshold) {
        candidates.push({ sourceIdx: si, targetIdx: ti, score });
      }
    }
  }

  // Greedy assignment
  candidates.sort((a, b) => b.score - a.score);
  const usedSource = new Set<number>();
  const usedTarget = new Set<number>();
  const matches: ComponentMatch[] = [];

  for (const c of candidates) {
    if (usedSource.has(c.sourceIdx) || usedTarget.has(c.targetIdx)) continue;
    usedSource.add(c.sourceIdx);
    usedTarget.add(c.targetIdx);

    const src = sourceComponents[c.sourceIdx];
    const tgt = targetComponents[c.targetIdx];

    // Compute state key diff
    const srcKeys = new Set(src.stateKeys);
    const tgtKeys = new Set(tgt.stateKeys);
    const missingKeys = src.stateKeys.filter((k) => !tgtKeys.has(k));
    const extraKeys = tgt.stateKeys.filter((k) => !srcKeys.has(k));

    // Compute action diff
    const srcActions = new Set(src.actions.map((a) => a.toLowerCase()));
    const tgtActions = new Set(tgt.actions.map((a) => a.toLowerCase()));
    const missingActions = src.actions.filter((a) => !tgtActions.has(a.toLowerCase()));
    const extraActions = tgt.actions.filter((a) => !srcActions.has(a.toLowerCase()));

    matches.push({
      source: src,
      target: tgt,
      confidence: Math.round(c.score * 100) / 100,
      stateKeyDiff: { missing: missingKeys, extra: extraKeys },
      actionDiff: { missing: missingActions, extra: extraActions },
    });
  }

  const sourceOnly = sourceComponents.filter((_, i) => !usedSource.has(i));
  const targetOnly = targetComponents.filter((_, i) => !usedTarget.has(i));

  return { matches, sourceOnly, targetOnly };
}
