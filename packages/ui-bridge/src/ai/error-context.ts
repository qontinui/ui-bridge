/**
 * Error Context
 *
 * Creates rich error context for AI agents to understand and recover
 * from failures during UI automation.
 *
 * The code vocabulary, per-code recovery templates, and the canonical
 * `RecoverySuggestion` shape (D6) all come from the generated diagnostics
 * catalog (`../diagnostics`), which is generated from
 * `diagnostics/codes.json`. The former hand-maintained `ErrorCodes` /
 * `ERROR_SUGGESTIONS` here are deleted (plan D2/D6 — single source).
 */

import type { RegisteredElement, ElementState } from '../core/types';
import type { DiscoveredElement } from '../control/types';
import type { AIErrorContext, SearchCriteria, SearchResult, AIDiscoveredElement } from './types';
import type { UiBridgeErrorCode, RecoverySuggestion } from '../diagnostics';
import { DIAGNOSTICS, ERROR_SUGGESTIONS } from '../diagnostics';

export type { UiBridgeErrorCode, RecoverySuggestion } from '../diagnostics';
export { ERROR_SUGGESTIONS, getRecoverySuggestions, DIAGNOSTICS } from '../diagnostics';

/**
 * Any element type that can be used with error context
 */
type AnyElement = DiscoveredElement | AIDiscoveredElement | RegisteredElement;

/**
 * Helper to get element state from any element type
 * DiscoveredElement has a `state` property, RegisteredElement has a `getState()` method
 */
function getElementState(el: AnyElement): ElementState | undefined {
  if ('state' in el && el.state) {
    return el.state;
  }
  if ('getState' in el && typeof el.getState === 'function') {
    try {
      return el.getState();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Human-readable message for a diagnostic code (its catalog description).
 */
function messageFor(errorCode: UiBridgeErrorCode): string {
  return DIAGNOSTICS[errorCode]?.description ?? 'An unknown error occurred';
}

/**
 * Create a rich error context
 */
export function createErrorContext(
  errorCode: UiBridgeErrorCode,
  attemptedAction: string,
  availableElements: AnyElement[],
  searchCriteria?: SearchCriteria,
  nearestMatch?: SearchResult
): AIErrorContext {
  // Get base message and suggestions
  const message = messageFor(errorCode);
  const baseSuggestions = ERROR_SUGGESTIONS[errorCode] || [];

  // Detect possible blockers
  const possibleBlockers = detectPossibleBlockers(availableElements);

  // Count visible elements
  const visibleElements = availableElements.filter((el) => {
    const state = getElementState(el);
    return state?.visible ?? false;
  }).length;

  // Build enhanced suggestions
  const suggestions = enhanceSuggestions(baseSuggestions, errorCode, nearestMatch, possibleBlockers);

  return {
    code: errorCode,
    message,
    attemptedAction,
    searchCriteria,
    searchResults: {
      candidatesFound: availableElements.length,
      nearestMatch: nearestMatch
        ? {
            element: nearestMatch.element,
            confidence: nearestMatch.confidence,
            whyNotSelected: determineWhyNotSelected(errorCode, nearestMatch),
          }
        : undefined,
    },
    pageContext: {
      url: typeof window !== 'undefined' ? window.location.href : '',
      title: typeof document !== 'undefined' ? document.title : '',
      visibleElements,
      possibleBlockers,
    },
    suggestions,
    timestamp: Date.now(),
  };
}

/**
 * Detect possible blocking elements
 */
function detectPossibleBlockers(elements: AnyElement[]): string[] {
  const blockers: string[] = [];

  for (const el of elements) {
    const state = getElementState(el);
    if (!state) continue;

    // Check for modals
    if (el.type === 'dialog' && state.visible) {
      blockers.push(`Modal dialog: ${el.id}`);
    }

    // Check for overlays (heuristic based on computed styles)
    if (state.computedStyles?.pointerEvents === 'none') {
      continue; // Non-blocking overlay
    }

    // Check for full-screen elements (would need rect comparison)
  }

  return blockers;
}

/**
 * Enhance suggestions based on context
 */
function enhanceSuggestions(
  baseSuggestions: RecoverySuggestion[],
  errorCode: UiBridgeErrorCode,
  nearestMatch?: SearchResult,
  possibleBlockers?: string[]
): RecoverySuggestion[] {
  const suggestions = [...baseSuggestions];

  // Add blocker-specific suggestions
  if (possibleBlockers && possibleBlockers.length > 0) {
    suggestions.unshift({
      suggestion: `Close the blocking element: ${possibleBlockers[0]}`,
      command: 'click close button',
      confidence: 0.85,
      retryable: true,
      priority: 0,
    });
  }

  // Add nearest match suggestion
  if (nearestMatch && errorCode === 'UB-LOW-CONFIDENCE') {
    suggestions.unshift({
      suggestion: `Did you mean: "${nearestMatch.element.description}"?`,
      command: `click "${nearestMatch.element.description}"`,
      confidence: nearestMatch.confidence,
      retryable: true,
      priority: 0,
    });
  }

  // Sort by priority (entries without an explicit priority sort last)
  suggestions.sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));

  return suggestions;
}

/**
 * Determine why the nearest match was not selected
 */
function determineWhyNotSelected(
  errorCode: UiBridgeErrorCode,
  nearestMatch: SearchResult
): string {
  switch (errorCode) {
    case 'UB-LOW-CONFIDENCE':
      return `Confidence (${(nearestMatch.confidence * 100).toFixed(0)}%) below threshold`;

    case 'UB-ELEM-NOT-VISIBLE':
      return 'Element is not visible';

    case 'UB-ELEM-DISABLED':
    case 'UB-ELEM-NOT-ENABLED':
      return 'Element is disabled';

    case 'UB-AMBIGUOUS-MATCH':
      return 'Multiple elements with similar confidence';

    default:
      return 'Did not meet selection criteria';
  }
}

/**
 * Format error context for display
 */
export function formatErrorContext(context: AIErrorContext): string {
  const lines: string[] = [];

  lines.push(`Error: ${context.code}`);
  lines.push(`Message: ${context.message}`);
  lines.push(`Attempted: ${context.attemptedAction}`);
  lines.push('');

  if (context.searchResults.nearestMatch) {
    const match = context.searchResults.nearestMatch;
    lines.push(
      `Nearest match: "${match.element.description}" (${(match.confidence * 100).toFixed(0)}% confidence)`
    );
    lines.push(`Why not used: ${match.whyNotSelected}`);
    lines.push('');
  }

  lines.push(`Page: ${context.pageContext.title || context.pageContext.url}`);
  lines.push(`Visible elements: ${context.pageContext.visibleElements}`);

  if (context.pageContext.possibleBlockers.length > 0) {
    lines.push(`Possible blockers: ${context.pageContext.possibleBlockers.join(', ')}`);
  }

  lines.push('');
  lines.push('Suggestions:');
  for (const suggestion of context.suggestions.slice(0, 3)) {
    lines.push(`  - ${suggestion.suggestion}`);
    if (suggestion.command) {
      lines.push(`    Command: ${suggestion.command}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create a simple error response
 */
export function createSimpleError(
  code: UiBridgeErrorCode,
  message?: string
): { code: string; message: string } {
  return {
    code,
    message: message || messageFor(code),
  };
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(code: UiBridgeErrorCode): boolean {
  const unrecoverableErrors: UiBridgeErrorCode[] = [
    'UB-UNSUPPORTED-ACTION',
    'UB-PAGE-LOAD-ERROR',
    'UB-NAVIGATION-ERROR',
  ];

  return !unrecoverableErrors.includes(code);
}

/**
 * Get the best recovery suggestion for an error
 */
export function getBestRecoverySuggestion(context: AIErrorContext): RecoverySuggestion | null {
  if (context.suggestions.length === 0) return null;

  // Return highest confidence suggestion
  const sorted = [...context.suggestions].sort((a, b) => b.confidence - a.confidence);
  return sorted[0];
}
