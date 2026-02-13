/**
 * Navigation Map
 *
 * Identifies navigation elements in both source and target pages
 * and maps them to each other for parity analysis.
 */

import type { AIDiscoveredElement, NavigationPair, NavigationMap } from './types';
import { jaroWinklerSimilarity, normalizeString } from './fuzzy-matcher';

export interface NavigationMapConfig {
  /** Minimum similarity for label matching */
  labelMatchThreshold: number;
}

export const DEFAULT_NAVIGATION_MAP_CONFIG: NavigationMapConfig = {
  labelMatchThreshold: 0.8,
};

/**
 * Determine whether an element is a navigation link/item.
 */
export function isNavigationElement(el: AIDiscoveredElement): boolean {
  const role = (el.role || '').toLowerCase();
  const type = (el.type || '').toLowerCase();
  const semanticType = (el.semanticType || '').toLowerCase();

  // Explicit navigation roles
  if (['link', 'menuitem', 'tab'].includes(role)) return true;

  // Element types
  if (['link', 'menuitem'].includes(type)) return true;

  // Semantic type hints
  if (
    semanticType.includes('nav') ||
    semanticType.includes('menu') ||
    semanticType.includes('tab')
  ) {
    return true;
  }

  // Check if element is inside a navigation context
  const context = (el.parentContext || '').toLowerCase();
  if (context.includes('nav') || context.includes('menu') || context.includes('sidebar')) {
    if (role === 'button' || type === 'button' || role === 'link' || type === 'link') {
      return true;
    }
  }

  return false;
}

/**
 * Extract the navigation label from an element.
 */
function getNavLabel(el: AIDiscoveredElement): string {
  return el.accessibleName || el.labelText || el.label || el.description || el.id;
}

/**
 * Extract the href/destination from an element.
 */
function getHref(el: AIDiscoveredElement): string | undefined {
  // href is not on ElementState; check for it via unknown cast
  const state = el.state as unknown as Record<string, unknown>;
  return (state?.href as string) || undefined;
}

/**
 * Check if two href values point to equivalent destinations.
 */
function hrefsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  // Normalize: strip trailing slashes, protocol, and port differences
  const normalize = (h: string) =>
    h
      .replace(/^https?:\/\//, '')
      .replace(/localhost:\d+/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  return normalize(a) === normalize(b);
}

/**
 * Build a navigation map comparing source and target pages.
 */
export function buildNavigationMap(
  sourceElements: AIDiscoveredElement[],
  targetElements: AIDiscoveredElement[],
  config: NavigationMapConfig = DEFAULT_NAVIGATION_MAP_CONFIG
): NavigationMap {
  const sourceNav = sourceElements.filter(isNavigationElement);
  const targetNav = targetElements.filter(isNavigationElement);

  const pairs: NavigationPair[] = [];
  const matchedTargetIds = new Set<string>();

  for (const src of sourceNav) {
    const srcLabel = getNavLabel(src);
    const srcNorm = normalizeString(srcLabel);
    let bestTarget: AIDiscoveredElement | null = null;
    let bestScore = 0;

    for (const tgt of targetNav) {
      if (matchedTargetIds.has(tgt.id)) continue;

      const tgtLabel = getNavLabel(tgt);
      const tgtNorm = normalizeString(tgtLabel);

      // Exact match
      if (srcNorm === tgtNorm) {
        bestTarget = tgt;
        bestScore = 1.0;
        break;
      }

      // Fuzzy match
      const similarity = jaroWinklerSimilarity(srcNorm, tgtNorm);
      if (similarity > bestScore && similarity >= config.labelMatchThreshold) {
        bestScore = similarity;
        bestTarget = tgt;
      }
    }

    if (bestTarget) {
      matchedTargetIds.add(bestTarget.id);
      const srcHref = getHref(src);
      const tgtHref = getHref(bestTarget);
      pairs.push({
        sourceId: src.id,
        targetId: bestTarget.id,
        label: srcLabel,
        sourceHref: srcHref,
        targetHref: tgtHref,
        destinationMatch: hrefsMatch(srcHref, tgtHref),
      });
    }
  }

  const sourceOnly = sourceNav
    .filter((s) => !pairs.some((p) => p.sourceId === s.id))
    .map((s) => s.id);
  const targetOnly = targetNav.filter((t) => !matchedTargetIds.has(t.id)).map((t) => t.id);

  return { pairs, sourceOnly, targetOnly };
}
