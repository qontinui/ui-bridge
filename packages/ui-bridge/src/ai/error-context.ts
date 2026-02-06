/**
 * Error Context
 *
 * Creates rich error context for AI agents to understand and recover
 * from failures during UI automation.
 */

import type { RegisteredElement, ElementState } from '../core/types';
import type { DiscoveredElement } from '../control/types';
import type {
  AIErrorContext,
  RecoverySuggestion,
  SearchCriteria,
  SearchResult,
  AIDiscoveredElement,
} from './types';

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
 * Standard error codes
 */
export const ErrorCodes = {
  // Parsing errors
  PARSE_ERROR: 'PARSE_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // Element errors
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  ELEMENT_NOT_VISIBLE: 'ELEMENT_NOT_VISIBLE',
  ELEMENT_DISABLED: 'ELEMENT_DISABLED',
  ELEMENT_BLOCKED: 'ELEMENT_BLOCKED',
  MULTIPLE_ELEMENTS: 'MULTIPLE_ELEMENTS',

  // Search errors
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  AMBIGUOUS_MATCH: 'AMBIGUOUS_MATCH',

  // Action errors
  ACTION_FAILED: 'ACTION_FAILED',
  ACTION_TIMEOUT: 'ACTION_TIMEOUT',
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',

  // State errors
  UNEXPECTED_STATE: 'UNEXPECTED_STATE',
  STALE_ELEMENT: 'STALE_ELEMENT',

  // Page errors
  PAGE_LOAD_ERROR: 'PAGE_LOAD_ERROR',
  NAVIGATION_ERROR: 'NAVIGATION_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Error messages for each error code
 */
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  PARSE_ERROR: 'Could not parse the natural language instruction',
  VALIDATION_ERROR: 'The parsed action failed validation',
  ELEMENT_NOT_FOUND: 'No element matching the description could be found',
  ELEMENT_NOT_VISIBLE: 'The element exists but is not visible',
  ELEMENT_DISABLED: 'The element is disabled and cannot be interacted with',
  ELEMENT_BLOCKED: 'The element is blocked by another element',
  MULTIPLE_ELEMENTS: 'Multiple elements match the description',
  LOW_CONFIDENCE: 'The best match has low confidence',
  AMBIGUOUS_MATCH: 'Multiple elements match with similar confidence',
  ACTION_FAILED: 'The action could not be completed',
  ACTION_TIMEOUT: 'The action timed out waiting for a condition',
  UNSUPPORTED_ACTION: 'The requested action is not supported',
  UNEXPECTED_STATE: 'The element is in an unexpected state',
  STALE_ELEMENT: 'The element is no longer attached to the DOM',
  PAGE_LOAD_ERROR: 'The page failed to load correctly',
  NAVIGATION_ERROR: 'Navigation to the target page failed',
};

/**
 * Recovery suggestions for each error code
 */
const ERROR_SUGGESTIONS: Record<ErrorCode, RecoverySuggestion[]> = {
  PARSE_ERROR: [
    {
      action: 'Use a simpler instruction format like "click Submit button"',
      confidence: 0.8,
      priority: 1,
    },
    {
      action: 'Use specific element names visible on the page',
      confidence: 0.7,
      priority: 2,
    },
  ],
  VALIDATION_ERROR: [
    {
      action: 'Provide required parameters for the action',
      confidence: 0.9,
      priority: 1,
    },
    {
      action: 'Check the instruction format',
      confidence: 0.7,
      priority: 2,
    },
  ],
  ELEMENT_NOT_FOUND: [
    {
      action: 'Wait for the page to fully load',
      command: 'wait for page to load',
      confidence: 0.7,
      priority: 1,
    },
    {
      action: 'Use a different description for the element',
      confidence: 0.8,
      priority: 2,
    },
    {
      action: 'Scroll the page to reveal the element',
      command: 'scroll down',
      confidence: 0.6,
      priority: 3,
    },
  ],
  ELEMENT_NOT_VISIBLE: [
    {
      action: 'Scroll to make the element visible',
      command: 'scroll to element',
      confidence: 0.9,
      priority: 1,
    },
    {
      action: 'Close any overlaying elements',
      confidence: 0.7,
      priority: 2,
    },
    {
      action: 'Wait for loading to complete',
      command: 'wait for loading',
      confidence: 0.6,
      priority: 3,
    },
  ],
  ELEMENT_DISABLED: [
    {
      action: 'Fill in required fields first',
      confidence: 0.8,
      priority: 1,
    },
    {
      action: 'Complete prerequisite steps',
      confidence: 0.7,
      priority: 2,
    },
    {
      action: 'Wait for the element to become enabled',
      command: 'wait for element to be enabled',
      confidence: 0.6,
      priority: 3,
    },
  ],
  ELEMENT_BLOCKED: [
    {
      action: 'Close the modal or popup',
      command: 'click close button',
      confidence: 0.9,
      priority: 1,
    },
    {
      action: 'Dismiss the overlay',
      confidence: 0.8,
      priority: 2,
    },
    {
      action: 'Wait for the blocking element to disappear',
      confidence: 0.6,
      priority: 3,
    },
  ],
  MULTIPLE_ELEMENTS: [
    {
      action: 'Use a more specific description',
      confidence: 0.9,
      priority: 1,
    },
    {
      action: 'Include the element position (first, second, etc.)',
      confidence: 0.8,
      priority: 2,
    },
    {
      action: 'Use the element ID directly',
      confidence: 0.7,
      priority: 3,
    },
  ],
  LOW_CONFIDENCE: [
    {
      action: 'Use the exact text shown on the element',
      confidence: 0.9,
      priority: 1,
    },
    {
      action: 'Lower the confidence threshold if the match is correct',
      confidence: 0.7,
      priority: 2,
    },
    {
      action: 'Try a different way to describe the element',
      confidence: 0.6,
      priority: 3,
    },
  ],
  AMBIGUOUS_MATCH: [
    {
      action: 'Be more specific about which element you mean',
      confidence: 0.9,
      priority: 1,
    },
    {
      action: 'Include the section or form name',
      confidence: 0.8,
      priority: 2,
    },
  ],
  ACTION_FAILED: [
    {
      action: 'Check if the element is interactable',
      confidence: 0.7,
      priority: 1,
    },
    {
      action: 'Wait and retry the action',
      command: 'wait 1 second then retry',
      confidence: 0.6,
      priority: 2,
    },
  ],
  ACTION_TIMEOUT: [
    {
      action: 'Increase the timeout duration',
      confidence: 0.8,
      priority: 1,
    },
    {
      action: 'Check if the condition can ever be met',
      confidence: 0.7,
      priority: 2,
    },
  ],
  UNSUPPORTED_ACTION: [
    {
      action: 'Use a different action type',
      confidence: 0.9,
      priority: 1,
    },
    {
      action: 'Break down into simpler actions',
      confidence: 0.7,
      priority: 2,
    },
  ],
  UNEXPECTED_STATE: [
    {
      action: 'Refresh the page state',
      command: 'refresh',
      confidence: 0.7,
      priority: 1,
    },
    {
      action: 'Wait for state to stabilize',
      command: 'wait 2 seconds',
      confidence: 0.6,
      priority: 2,
    },
  ],
  STALE_ELEMENT: [
    {
      action: 'Re-find the element',
      confidence: 0.9,
      priority: 1,
    },
    {
      action: 'Wait for page to stabilize',
      command: 'wait 1 second',
      confidence: 0.7,
      priority: 2,
    },
  ],
  PAGE_LOAD_ERROR: [
    {
      action: 'Refresh the page',
      command: 'refresh page',
      confidence: 0.8,
      priority: 1,
    },
    {
      action: 'Check network connectivity',
      confidence: 0.6,
      priority: 2,
    },
  ],
  NAVIGATION_ERROR: [
    {
      action: 'Try the navigation again',
      confidence: 0.7,
      priority: 1,
    },
    {
      action: 'Check if the URL is correct',
      confidence: 0.6,
      priority: 2,
    },
  ],
};

/**
 * Create a rich error context
 */
export function createErrorContext(
  errorCode: ErrorCode,
  attemptedAction: string,
  availableElements: AnyElement[],
  searchCriteria?: SearchCriteria,
  nearestMatch?: SearchResult
): AIErrorContext {
  // Get base message and suggestions
  const message = ERROR_MESSAGES[errorCode] || 'An unknown error occurred';
  const baseSuggestions = ERROR_SUGGESTIONS[errorCode] || [];

  // Detect possible blockers
  const possibleBlockers = detectPossibleBlockers(availableElements);

  // Count visible elements
  const visibleElements = availableElements.filter((el) => {
    const state = getElementState(el);
    return state?.visible ?? false;
  }).length;

  // Build enhanced suggestions
  const suggestions = enhanceSuggestions(
    baseSuggestions,
    errorCode,
    nearestMatch,
    possibleBlockers
  );

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
  errorCode: ErrorCode,
  nearestMatch?: SearchResult,
  possibleBlockers?: string[]
): RecoverySuggestion[] {
  const suggestions = [...baseSuggestions];

  // Add blocker-specific suggestions
  if (possibleBlockers && possibleBlockers.length > 0) {
    suggestions.unshift({
      action: `Close the blocking element: ${possibleBlockers[0]}`,
      command: 'click close button',
      confidence: 0.85,
      priority: 0,
    });
  }

  // Add nearest match suggestion
  if (nearestMatch && errorCode === 'LOW_CONFIDENCE') {
    suggestions.unshift({
      action: `Did you mean: "${nearestMatch.element.description}"?`,
      command: `click "${nearestMatch.element.description}"`,
      confidence: nearestMatch.confidence,
      priority: 0,
    });
  }

  // Sort by priority
  suggestions.sort((a, b) => a.priority - b.priority);

  return suggestions;
}

/**
 * Determine why the nearest match was not selected
 */
function determineWhyNotSelected(errorCode: ErrorCode, nearestMatch: SearchResult): string {
  switch (errorCode) {
    case 'LOW_CONFIDENCE':
      return `Confidence (${(nearestMatch.confidence * 100).toFixed(0)}%) below threshold`;

    case 'ELEMENT_NOT_VISIBLE':
      return 'Element is not visible';

    case 'ELEMENT_DISABLED':
      return 'Element is disabled';

    case 'AMBIGUOUS_MATCH':
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
    lines.push(`  - ${suggestion.action}`);
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
  code: ErrorCode,
  message?: string
): { code: string; message: string } {
  return {
    code,
    message: message || ERROR_MESSAGES[code] || 'Unknown error',
  };
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(code: ErrorCode): boolean {
  const unrecoverableErrors: ErrorCode[] = [
    'UNSUPPORTED_ACTION',
    'PAGE_LOAD_ERROR',
    'NAVIGATION_ERROR',
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
