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
import { decomposeTarget, isSoftTypeHint } from './target-decomposer';
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
  /**
   * If true, populate `FindResultNotFound.alternatives` with the closest
   * sub-threshold candidates so callers can see which elements were
   * considered but scored below the confidence gate. Behind a flag because
   * generating the diagnostic requires an extra search pass with a relaxed
   * threshold and inflates response size — production callers stay lean.
   */
  debug?: boolean;
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
  /** Partial matches that were below the find-API threshold but still
   *  cleared the underlying engine's fuzzy gate. Always populated when any
   *  element scored above the engine's internal floor. */
  partialMatches: FindCandidate[];
  /** How many elements were considered before filtering. Helps agents
   *  distinguish "searched 200 elements, none matched" from "searched
   *  10 elements (snapshot truncated / auto-register incomplete)". */
  consideredCount: number;
  /** Decomposed query (useful for debugging) */
  decomposed: DecomposedTarget;
  /** Search duration in ms */
  durationMs: number;
  /**
   * Top-3 closest candidates with sub-threshold scores. Populated only when
   * the caller passed `debug: true` in `FindOptions`. Differs from
   * `partialMatches` in that it relaxes the engine's internal fuzzy gate to
   * surface candidates that scored *anything* > 0, so agents can see "we
   * considered element X with placeholder Y but it scored 0.12 — far below
   * the 0.5 threshold". Sorted by confidence descending.
   */
  alternatives?: FindCandidate[];
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
  debug: false,
};

/**
 * Floor for the debug-only relaxed engine pass. Anything that scored even a
 * little above zero is worth surfacing as a "we considered this element"
 * diagnostic; we don't want to flood the response with elements the matcher
 * never seriously evaluated, so we keep a tiny non-zero threshold.
 */
const DEBUG_ALTERNATIVES_THRESHOLD = 0.01;

/** How many top sub-threshold candidates to surface when debug is on. */
const DEBUG_ALTERNATIVES_LIMIT = 3;

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
    // Structured query — pass through, create a synthetic decomposed for debugging.
    // Mirror probe-target fields from the structured criteria when present so
    // callers get a consistent shape across both query forms.
    criteria = query;
    const elementText = query.text || query.textContent || query.accessibleName || '';
    decomposed = {
      elementText,
      elementType: query.type,
      label: elementText || undefined,
      ariaLabel: query.accessibleName || elementText || undefined,
      placeholder: query.placeholder || elementText || undefined,
      name: elementText || undefined,
    };
  }

  // Execute search
  let searchResponse = engine.search(criteria);

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
  let viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);

  // -----------------------------------------------------------------------
  // Soft-type fallback
  //
  // If the decomposer flagged the elementType as a soft hint (e.g., bare
  // "toggle" → switch, "details" → disclosure) AND no viable results came
  // back, retry without the type constraint. This preserves label-driven
  // matches when the verb-to-type guess is wrong (e.g., "Advanced details
  // toggle" should land on a `type: disclosure` element even though the
  // hint pointed at `switch`).
  //
  // Important: only retry when we actually narrowed by type. If the user
  // gave structured criteria and pinned `type` themselves, we don't relax
  // it — they meant it.
  //
  // B4 — Extended fallback for hard-pinned synonyms.
  //
  // Multi-word phrases like "details toggle" hit the disclosure synonym
  // table without the soft-hint flag, so the soft-fallback above never
  // fires. If the type guess turns out to be wrong for the page (e.g.,
  // "details toggle" → disclosure but the page has only buttons), the
  // type-narrowed search returns nothing forever. The cache check below
  // catches that situation: when the cached elements contain no element of
  // the criteria.type, the type guess is unhelpful in this context — so we
  // retry without it. This relaxes only when the type isn't even present
  // on the page; structured callers who pinned `type` against an
  // intentionally empty page still get found:false (their decomposed
  // shape never has elementType set, so the gate's `criteria.type` clause
  // is never true for them).
  // -----------------------------------------------------------------------
  if (
    viableResults.length === 0 &&
    typeof query === 'string' &&
    isSoftTypeHint(decomposed) &&
    criteria.type
  ) {
    const relaxed: SearchCriteria = { ...criteria };
    delete relaxed.type;
    searchResponse = engine.search(relaxed);
    results = applyContextScoring(searchResponse.results, opts.context || {}, engine);
    if (decomposed.stateFilter) {
      results = applyStateFilter(results, decomposed.stateFilter);
    }
    if (decomposed.ordinal) {
      results = applyOrdinalFilter(results, decomposed.ordinal);
    }
    viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);
  }

  // B4: hard-pinned synonym fallback — relax `criteria.type` when no
  // element of that type exists on the page at all. Only triggers for
  // free-form NL queries (typeof query === 'string'); structured callers
  // who pinned `type` themselves never had a `decomposed.elementType` set
  // in the first place, so this branch is gated on the type having come
  // from the decomposer.
  if (
    viableResults.length === 0 &&
    typeof query === 'string' &&
    criteria.type &&
    decomposed.elementType
  ) {
    const cachedTypeLower = String(criteria.type).toLowerCase();
    const cachedSummaries = engine.getCachedElementSummaries();
    const typeIsPresent = cachedSummaries.some((el) => el.type.toLowerCase() === cachedTypeLower);
    if (!typeIsPresent) {
      const relaxed: SearchCriteria = { ...criteria };
      delete relaxed.type;
      searchResponse = engine.search(relaxed);
      results = applyContextScoring(searchResponse.results, opts.context || {}, engine);
      if (decomposed.stateFilter) {
        results = applyStateFilter(results, decomposed.stateFilter);
      }
      if (decomposed.ordinal) {
        results = applyOrdinalFilter(results, decomposed.ordinal);
      }
      viableResults = results.filter((r) => r.confidence >= opts.confidenceThreshold);
    }
  }

  const durationMs = performance.now() - startTime;

  // No results
  if (viableResults.length === 0) {
    // Debug pass: when the caller asked for diagnostics, run a second
    // engine search with a near-zero fuzzy threshold so we can surface
    // sub-threshold candidates the primary search dropped on the floor.
    // Without this, callers see `{found: false, partialMatches: []}` and
    // can't tell whether (a) the matcher considered element X at score
    // 0.12 or (b) element X was never even scanned.
    let alternatives: FindCandidate[] | undefined;
    if (opts.debug) {
      const debugResponse = engine.search({
        ...criteria,
        fuzzyThreshold: DEBUG_ALTERNATIVES_THRESHOLD,
      });
      // Re-apply the same context/state/ordinal filters so the debug list
      // reflects the same view the primary search saw.
      let debugResults = applyContextScoring(
        debugResponse.results,
        opts.context || {},
        engine
      );
      if (decomposed.stateFilter) {
        debugResults = applyStateFilter(debugResults, decomposed.stateFilter);
      }
      if (decomposed.ordinal) {
        debugResults = applyOrdinalFilter(debugResults, decomposed.ordinal);
      }
      // Sort by confidence (applyContextScoring already sorts, but state /
      // ordinal filters can disturb order) and take the top N.
      debugResults.sort((a, b) => b.confidence - a.confidence);
      alternatives = debugResults
        .slice(0, DEBUG_ALTERNATIVES_LIMIT)
        .map((r) => toCandidate(r));
    }

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
      ...(alternatives !== undefined ? { alternatives } : {}),
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
 *
 * B1 — Mirror non-redundant decomposed source-signal fields into the
 * structured criteria. The decomposer fills `label`/`ariaLabel`/`placeholder`/
 * `name` for free-form NL queries, but for single-word fallbacks every mirror
 * carries the exact same string as `elementText`. Forwarding identical mirrors
 * inflates `totalWeight` in the scoring loop without adding any new signal —
 * we only forward a mirror when it carries a value that differs from
 * `elementText`. Multi-token decomposition (rare today, but possible as the
 * decomposer evolves) gets the richer matching it deserves; trivial
 * single-word queries don't pay the dilution tax.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    criteria.type = decomposed.elementType as any;
  }

  // B1: lift accessibleName / placeholder mirrors when they carry distinct
  // signal. The decomposer mirrors `elementText` into all four source fields
  // for free-form queries, so we skip mirrors that are exactly equal to the
  // primary text — they would only re-probe the same string against the same
  // sources without adding any extra information.
  if (decomposed.label && decomposed.label !== decomposed.elementText) {
    criteria.accessibleName = decomposed.label;
  } else if (
    decomposed.ariaLabel &&
    decomposed.ariaLabel !== decomposed.elementText &&
    !criteria.accessibleName
  ) {
    criteria.accessibleName = decomposed.ariaLabel;
  }
  if (decomposed.placeholder && decomposed.placeholder !== decomposed.elementText) {
    criteria.placeholder = decomposed.placeholder;
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
