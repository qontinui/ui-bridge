/**
 * CTR Self-Healing
 *
 * When a primary selector fails, falls through to secondary selectors.
 * Promotes successful selectors and demotes failed ones based on confidence scores.
 */

import type { CtrEntry, CtrSelector, CtrEvent } from './types';
import {
  CONFIDENCE_BOOST,
  CONFIDENCE_PENALTY,
  MIN_CONFIDENCE_THRESHOLD,
} from './types';

/**
 * Promote a selector that resolved successfully.
 * Increases confidence and may decrease priority (making it tried earlier).
 */
export function promoteSelector(entry: CtrEntry, selector: CtrSelector): CtrEvent | null {
  const idx = entry.selectors.indexOf(selector);
  if (idx === -1) return null;

  const oldConfidence = selector.confidence;
  selector.confidence = Math.min(1, selector.confidence + CONFIDENCE_BOOST);

  // If this selector now has higher confidence than the one before it, swap priorities
  if (idx > 0) {
    const prev = entry.selectors[idx - 1];
    if (selector.confidence > prev.confidence) {
      const tmpPriority = prev.priority;
      prev.priority = selector.priority;
      selector.priority = tmpPriority;
      // Re-sort by priority
      entry.selectors.sort((a, b) => a.priority - b.priority);
    }
  }

  if (selector.confidence !== oldConfidence) {
    return {
      type: 'ctr:selector-promoted',
      logicalName: entry.logicalName,
      selector,
      timestamp: Date.now(),
    };
  }
  return null;
}

/**
 * Demote a selector that failed to resolve.
 * Decreases confidence.
 */
export function demoteSelector(entry: CtrEntry, selector: CtrSelector): CtrEvent | null {
  const idx = entry.selectors.indexOf(selector);
  if (idx === -1) return null;

  const oldConfidence = selector.confidence;
  selector.confidence = Math.max(0, selector.confidence - CONFIDENCE_PENALTY);

  if (selector.confidence !== oldConfidence) {
    return {
      type: 'ctr:selector-demoted',
      logicalName: entry.logicalName,
      selector,
      timestamp: Date.now(),
    };
  }
  return null;
}

/**
 * Get selectors sorted by priority, filtered to those above the minimum confidence threshold.
 */
export function getViableSelectors(entry: CtrEntry): CtrSelector[] {
  return entry.selectors
    .filter((s) => s.confidence >= MIN_CONFIDENCE_THRESHOLD)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Check if an entry has any viable selectors remaining.
 */
export function hasViableSelectors(entry: CtrEntry): boolean {
  return entry.selectors.some((s) => s.confidence >= MIN_CONFIDENCE_THRESHOLD);
}
