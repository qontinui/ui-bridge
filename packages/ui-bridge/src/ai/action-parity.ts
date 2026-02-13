/**
 * Action Parity
 *
 * Compares the interactive capabilities (available actions) of matched
 * element pairs to detect missing functionality between source and target.
 */

import type { AIDiscoveredElement, MatchedElementPair, InteractionParity } from './types';

export interface ActionParityConfig {
  /** Actions to ignore in comparison (e.g., framework-internal actions) */
  ignoreActions: string[];
}

export const DEFAULT_ACTION_PARITY_CONFIG: ActionParityConfig = {
  ignoreActions: [],
};

/**
 * Get the list of available actions for an element.
 */
function getActions(el: AIDiscoveredElement, ignoreActions: string[]): string[] {
  const actions = el.actions || el.suggestedActions || [];
  const ignoreSet = new Set(ignoreActions.map((a) => a.toLowerCase()));
  return actions
    .map((a: string | { action?: string; name?: string }) =>
      typeof a === 'string' ? a : a.action || a.name || ''
    )
    .filter((a: string) => a && !ignoreSet.has(a.toLowerCase()));
}

/**
 * Analyze action parity for all matched element pairs.
 */
export function analyzeActionParity(
  matchedPairs: MatchedElementPair[],
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: ActionParityConfig = DEFAULT_ACTION_PARITY_CONFIG
): InteractionParity[] {
  const sourceById = new Map(sourceElements.map((e) => [e.id, e]));
  const targetById = new Map(targetElements.map((e) => [e.id, e]));

  const results: InteractionParity[] = [];

  for (const pair of matchedPairs) {
    const src = sourceById.get(pair.sourceId);
    const tgt = targetById.get(pair.targetId);
    if (!src || !tgt) continue;

    const sourceActions = getActions(src, config.ignoreActions);
    const targetActions = getActions(tgt, config.ignoreActions);

    const sourceSet = new Set(sourceActions.map((a) => a.toLowerCase()));
    const targetSet = new Set(targetActions.map((a) => a.toLowerCase()));

    const missingInTarget = sourceActions.filter((a) => !targetSet.has(a.toLowerCase()));
    const missingInSource = targetActions.filter((a) => !sourceSet.has(a.toLowerCase()));

    results.push({
      pair,
      sourceActions,
      targetActions,
      missingInTarget,
      missingInSource,
    });
  }

  return results;
}
