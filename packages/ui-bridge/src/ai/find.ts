/**
 * Unified Find API
 *
 * High-level natural language element finder that combines:
 * - Target description decomposition
 * - Two-pass spatial reference resolution
 * - Modal-aware scoring
 * - Container scoping
 * - Disambiguation for ambiguous matches
 *
 * Usage:
 *   const result = find("close button near Terminal 1 tab", engine);
 *   const result = find({ text: "save", role: "button" }, engine);
 */

import type { SearchCriteria, SearchResult, AIDiscoveredElement } from './types';
import type { SearchEngine } from './search-engine';
import { decomposeTarget } from './target-decomposer';
import type { DecomposedTarget } from './target-decomposer';

// ============================================================================
// Types
// ============================================================================

/**
 * Context for scoping and biasing search results
 */
export interface FindContext {
  /** ID of the currently active modal (elements inside it get priority) */
  activeModalId?: string;
  /** ID of the element last interacted with (for recency bias) */
  lastInteractedElement?: string;
  /** Current page section hint (e.g., "sidebar", "settings") */
  sectionHint?: string;
}

/**
 * Options for the find operation
 */
export interface FindOptions {
  /** Context for scoping and biasing */
  context?: FindContext;
  /** If true, always return the best match even when ambiguous (default: true) */
  pickFirst?: boolean;
  /** Minimum confidence threshold (default: 0.5) */
  confidenceThreshold?: number;
  /** Maximum results to return in ambiguous case (default: 5) */
  maxResults?: number;
}

/**
 * Successful find result
 */
export interface FindResultMatch {
  found: true;
  ambiguous: false;
  /** The matched element */
  element: AIDiscoveredElement;
  /** Element ID for use with action APIs */
  elementId: string;
  /** Match confidence 0-1 */
  confidence: number;
  /** Human-readable reasons for the match */
  matchReasons: string[];
  /** Other candidates that were considered */
  alternatives: FindCandidate[];
  /** Decomposed query (useful for debugging) */
  decomposed: DecomposedTarget;
  /** Search duration in ms */
  durationMs: number;
}

/**
 * Ambiguous find result (multiple high-confidence matches)
 */
export interface FindResultAmbiguous {
  found: true;
  ambiguous: true;
  /** Top candidates with differentiators */
  candidates: FindCandidate[];
  /** Human-readable suggestion for disambiguation */
  suggestion: string;
  /** Decomposed query (useful for debugging) */
  decomposed: DecomposedTarget;
  /** Search duration in ms */
  durationMs: number;
}

/**
 * No match found
 */
export interface FindResultNotFound {
  found: false;
  ambiguous: false;
  /** Why no match was found */
  reason: string;
  /** Partial matches that were below threshold */
  partialMatches: FindCandidate[];
  /** How many elements were considered before filtering. Helps agents
   *  distinguish "searched 200 elements, none matched" from "searched
   *  10 elements (snapshot truncated / auto-register incomplete)". */
  consideredCount: number;
  /** Decomposed query (useful for debugging) */
  decomposed: DecomposedTarget;
  /** Search duration in ms */
  durationMs: number;
}

export type FindResult = FindResultMatch | FindResultAmbiguous | FindResultNotFound;

/**
 * A candidate element with disambiguation info
 */
export interface FindCandidate {
  /** The element */
  element: AIDiscoveredElement;
  /** Element ID */
  elementId: string;
  /** Match confidence */
  confidence: number;
  /** Match reasons */
  matchReasons: string[];
  /** Human-readable differentiator (e.g., "in the sidebar", "in the dialog") */
  differentiator: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FIND_OPTIONS: Required<FindOptions> = {
  context: {},
  pickFirst: true,
  confidenceThreshold: 0.5,
  maxResults: 5,
};

/** Confidence gap threshold — if top two results are within this gap, it's ambiguous */
const AMBIGUITY_GAP = 0.1;

/** Penalty multiplier for elements behind an active modal */
const MODAL_PENALTY = 0.3;

/** Bonus for elements near the last-interacted element */
const RECENCY_BONUS = 0.05;

// ============================================================================
// Main API
// ============================================================================

/**
 * Find an element by natural language description or structured criteria.
 *
 * @param query - Natural language string or structured SearchCriteria
 * @param engine - The search engine to use
 * @param options - Find options (context, thresholds, etc.)
 */
export function find(
  query: string | SearchCriteria,
  engine: SearchEngine,
  options?: FindOptions
): FindResult {
  const startTime = performance.now();
  const opts = { ...DEFAULT_FIND_OPTIONS, ...options };
  // Guard against NaN threshold (e.g., from undefined override in spread)
  if (typeof opts.confidenceThreshold !== 'number' || Number.isNaN(opts.confidenceThreshold)) {
    opts.confidenceThreshold = DEFAULT_FIND_OPTIONS.confidenceThreshold;
  }

  // Parse the query
  let criteria: SearchCriteria;
  let decomposed: DecomposedTarget;

  if (typeof query === 'string') {
    decomposed = decomposeTarget(query);
    criteria = resolveCriteria(decomposed, engine, opts);
  } else {
    // Structured query — pass through, create a synthetic decomposed for debugging
    criteria = query;
    decomposed = {
      elementText: query.text || query.accessibleName || '',
      elementType: query.type,
    };
  }

  // Execute search
  const searchResponse = engine.search(criteria);

  // Apply context-aware adjustments
  let results = applyContextScoring(searchResponse.results, opts.context || {}, engine);

  // Apply state filter if decomposed has one
  if (decomposed.stateFilter) {
    results = applyStateFilter(results, decomposed.stateFilter);
  }

  // Apply ordinal filter
  if (decomposed.ordinal) {
    results = applyOrdinalFilter(results, decomposed.ordinal);
  }

  // Filter by confidence threshold
  const viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);

  const durationMs = performance.now() - startTime;

  // No results
  if (viableResults.length === 0) {
    return {
      found: false,
      ambiguous: false,
      reason:
        results.length > 0
          ? `Best match confidence (${(results[0].confidence * 100).toFixed(0)}%) below threshold (${(opts.confidenceThreshold * 100).toFixed(0)}%)`
          : `No elements matching "${decomposed.elementText}" found`,
      partialMatches: results.slice(0, opts.maxResults).map((r) => toCandidate(r)),
      // Diagnostic: how many elements were considered before filtering.
      // Helps agents distinguish "searched 200 elements, none matched" from
      // "searched 10 elements (snapshot truncated?)".
      consideredCount: searchResponse.results.length,
      decomposed,
      durationMs,
    };
  }

  // Check for ambiguity
  const isAmbiguous =
    viableResults.length >= 2 &&
    viableResults[0].confidence - viableResults[1].confidence < AMBIGUITY_GAP;

  if (isAmbiguous && !opts.pickFirst) {
    const candidates = viableResults.slice(0, opts.maxResults).map((r) => toCandidate(r));
    return {
      found: true,
      ambiguous: true,
      candidates,
      suggestion: generateDisambiguationSuggestion(candidates, decomposed),
      decomposed,
      durationMs,
    };
  }

  // Single best match
  const best = viableResults[0];
  const alternatives = viableResults.slice(1, opts.maxResults).map((r) => toCandidate(r));

  return {
    found: true,
    ambiguous: false,
    element: best.element,
    elementId: best.element.id,
    confidence: best.confidence,
    matchReasons: best.matchReasons,
    alternatives,
    decomposed,
    durationMs,
  };
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Convert a decomposed target into structured SearchCriteria,
 * resolving spatial references via two-pass search.
 */
function resolveCriteria(
  decomposed: DecomposedTarget,
  engine: SearchEngine,
  opts: Required<FindOptions>
): SearchCriteria {
  const criteria: SearchCriteria = {
    fuzzy: true,
    fuzzyThreshold: opts.confidenceThreshold,
  };

  // Set the primary search text
  if (decomposed.elementText) {
    criteria.text = decomposed.elementText;
  }

  // Set element type
  if (decomposed.elementType) {
    criteria.type = decomposed.elementType as any;
  }

  // Two-pass: resolve spatial reference
  if (decomposed.spatial) {
    const refResult = engine.findBest({
      text: decomposed.spatial.referenceDescription,
      fuzzy: true,
      fuzzyThreshold: 0.5,
    });
    if (refResult && refResult.confidence >= 0.5) {
      criteria.near = refResult.element.id;
    }
  }

  // Two-pass: resolve container reference
  if (decomposed.container) {
    const containerResult = engine.findBest({
      text: decomposed.container,
      fuzzy: true,
      fuzzyThreshold: 0.4,
    });
    if (containerResult && containerResult.confidence >= 0.4) {
      criteria.within = containerResult.element.id;
    }
  }

  return criteria;
}

// ============================================================================
// Context-Aware Scoring
// ============================================================================

/**
 * Apply context-aware adjustments to search results
 */
function applyContextScoring(
  results: SearchResult[],
  context: FindContext,
  engine: SearchEngine
): SearchResult[] {
  if (!context.activeModalId && !context.lastInteractedElement) {
    return results;
  }

  return results
    .map((result) => {
      let adjustedConfidence = result.confidence;
      const extraReasons = [...result.matchReasons];

      // Modal-aware penalty: if a modal is open, deprioritize elements outside it
      if (context.activeModalId) {
        const inModal = isElementInContainer(result.element, context.activeModalId, engine);
        if (!inModal) {
          adjustedConfidence *= MODAL_PENALTY;
          extraReasons.push('penalty: outside active modal');
        } else {
          extraReasons.push('boost: inside active modal');
        }
      }

      // Recency bias: small boost for elements near the last-interacted element
      if (context.lastInteractedElement) {
        const nearLastInteracted = isNearElement(
          result.element,
          context.lastInteractedElement,
          engine,
          300
        );
        if (nearLastInteracted) {
          adjustedConfidence = Math.min(1, adjustedConfidence + RECENCY_BONUS);
          extraReasons.push('boost: near last interacted');
        }
      }

      return {
        ...result,
        confidence: adjustedConfidence,
        matchReasons: extraReasons,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Check if an element is inside a container (by DOM or spatial containment)
 */
function isElementInContainer(
  element: AIDiscoveredElement,
  containerId: string,
  engine: SearchEngine
): boolean {
  // Check parentContext if available
  if (element.parentContext && element.parentContext.includes(containerId)) {
    return true;
  }

  // Spatial containment check using the engine's cached elements
  const containerResults = engine.findByText(containerId, false);
  if (containerResults.length === 0) return false;

  const containerRect = containerResults[0].element.state.rect;
  const elementRect = element.state.rect;

  return (
    elementRect.x >= containerRect.x &&
    elementRect.y >= containerRect.y &&
    elementRect.x + elementRect.width <= containerRect.x + containerRect.width &&
    elementRect.y + elementRect.height <= containerRect.y + containerRect.height
  );
}

/**
 * Check if an element is near another element
 */
function isNearElement(
  element: AIDiscoveredElement,
  referenceId: string,
  engine: SearchEngine,
  maxDistance: number
): boolean {
  const refResults = engine.findByText(referenceId, false);
  if (refResults.length === 0) return false;

  const refRect = refResults[0].element.state.rect;
  const elRect = element.state.rect;

  const dx = elRect.x + elRect.width / 2 - (refRect.x + refRect.width / 2);
  const dy = elRect.y + elRect.height / 2 - (refRect.y + refRect.height / 2);
  const distance = Math.sqrt(dx * dx + dy * dy);

  return distance <= maxDistance;
}

// ============================================================================
// Filters
// ============================================================================

/**
 * Filter results by element state
 */
function applyStateFilter(results: SearchResult[], stateFilter: string): SearchResult[] {
  return results.filter((r) => {
    const state = r.element.state;
    switch (stateFilter) {
      case 'disabled':
        return !state.enabled;
      case 'enabled':
        return state.enabled;
      case 'focused':
        return state.focused;
      case 'visible':
        return state.visible;
      case 'hidden':
        return !state.visible;
      case 'checked':
        return state.checked === true;
      case 'selected':
        return state.ariaSelected === true;
      case 'active':
        return state.focused || state.ariaSelected === true;
      default:
        return true;
    }
  });
}

/**
 * Filter/reorder results by ordinal position
 */
function applyOrdinalFilter(results: SearchResult[], ordinal: number): SearchResult[] {
  if (results.length === 0) return results;

  // Sort by DOM position (top-to-bottom, left-to-right) for ordinal resolution
  const sorted = [...results].sort((a, b) => {
    const aRect = a.element.state.rect;
    const bRect = b.element.state.rect;
    const yDiff = aRect.y - bRect.y;
    if (Math.abs(yDiff) > 10) return yDiff; // Different rows
    return aRect.x - bRect.x; // Same row, sort by X
  });

  if (ordinal === -1) {
    // "last"
    return [sorted[sorted.length - 1]];
  }

  // 1-based index
  const index = ordinal - 1;
  if (index >= 0 && index < sorted.length) {
    return [sorted[index]];
  }

  return results; // Ordinal out of range, return all
}

// ============================================================================
// Disambiguation
// ============================================================================

/**
 * Convert a SearchResult to a FindCandidate with a differentiator
 */
function toCandidate(result: SearchResult): FindCandidate {
  return {
    element: result.element,
    elementId: result.element.id,
    confidence: result.confidence,
    matchReasons: result.matchReasons,
    differentiator: generateDifferentiator(result.element),
  };
}

/**
 * Generate a human-readable differentiator for an element
 */
function generateDifferentiator(element: AIDiscoveredElement): string {
  const parts: string[] = [];

  // Parent context
  if (element.parentContext) {
    parts.push(`in ${element.parentContext}`);
  }

  // Region classification
  const rect = element.state.rect;
  if (rect.y < 80) {
    parts.push('at the top of the page');
  } else if (rect.y > 800) {
    parts.push('near the bottom of the page');
  }
  if (rect.x < 250) {
    parts.push('in the left panel');
  } else if (rect.x > 1000) {
    parts.push('in the right panel');
  }

  // State-based
  if (!element.state.enabled) {
    parts.push('(disabled)');
  }
  if (element.state.focused) {
    parts.push('(focused)');
  }

  // Semantic type
  if (element.semanticType && element.semanticType !== element.type) {
    parts.push(`[${element.semanticType}]`);
  }

  return parts.length > 0 ? parts.join(', ') : `ID: ${element.id}`;
}

/**
 * Generate a disambiguation suggestion message
 */
function generateDisambiguationSuggestion(
  candidates: FindCandidate[],
  decomposed: DecomposedTarget
): string {
  const lines = [`Found ${candidates.length} matching "${decomposed.elementText}" elements:`];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const desc = c.element.description || c.element.label || c.elementId;
    lines.push(`  ${i + 1}. "${desc}" — ${c.differentiator} (${(c.confidence * 100).toFixed(0)}%)`);
  }

  lines.push('');
  lines.push('Try adding spatial context: "... near X" or "... in the Y"');

  return lines.join('\n');
}
