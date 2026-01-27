/**
 * Natural Language Action Executor
 *
 * Executes parsed natural language actions by searching for elements
 * and performing the requested actions with confidence scoring.
 */

import type { RegisteredElement, ElementState, StandardAction } from '../core/types';
import type { DiscoveredElement, ActionExecutor } from '../control/types';
import type {
  NLActionRequest,
  NLActionResponse,
  ParsedAction,
  SearchCriteria,
  AIDiscoveredElement,
  AIErrorContext,
  SearchResult,
} from './types';
import { parseNLInstruction, describeAction, validateParsedAction } from './nl-action-parser';
import { SearchEngine, type SearchEngineConfig } from './search-engine';
import { createErrorContext, ErrorCodes } from './error-context';

/**
 * Configuration for the NL action executor
 */
export interface NLActionExecutorConfig {
  /** Default confidence threshold for element matching */
  defaultConfidenceThreshold: number;
  /** Default timeout for actions */
  defaultTimeout: number;
  /** Maximum alternatives to return on failure */
  maxAlternatives: number;
  /** Search engine configuration */
  searchConfig?: Partial<SearchEngineConfig>;
  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Default executor configuration
 */
export const DEFAULT_EXECUTOR_CONFIG: NLActionExecutorConfig = {
  defaultConfidenceThreshold: 0.7,
  defaultTimeout: 5000,
  maxAlternatives: 3,
  verbose: false,
};

/**
 * Natural Language Action Executor
 */
export class NLActionExecutor {
  private config: NLActionExecutorConfig;
  private searchEngine: SearchEngine;
  private actionExecutor: ActionExecutor | null = null;
  private elements: Array<DiscoveredElement | RegisteredElement> = [];

  constructor(config: Partial<NLActionExecutorConfig> = {}) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    this.searchEngine = new SearchEngine(this.config.searchConfig);
  }

  /**
   * Set the action executor for performing DOM actions
   */
  setActionExecutor(executor: ActionExecutor): void {
    this.actionExecutor = executor;
  }

  /**
   * Update available elements for search
   */
  updateElements(elements: Array<DiscoveredElement | RegisteredElement>): void {
    this.elements = elements;
    this.searchEngine.updateElements(elements);
  }

  /**
   * Execute a natural language instruction
   */
  async execute(request: NLActionRequest): Promise<NLActionResponse> {
    const startTime = performance.now();
    const threshold = request.confidenceThreshold ?? this.config.defaultConfidenceThreshold;

    // Parse the instruction
    const parsed = parseNLInstruction(request.instruction);

    if (!parsed) {
      return this.createFailureResponse(
        startTime,
        'PARSE_ERROR',
        `Could not parse instruction: "${request.instruction}"`,
        request.instruction,
        [],
        threshold
      );
    }

    // Validate the parsed action
    const validation = validateParsedAction(parsed);
    if (!validation.valid) {
      return this.createFailureResponse(
        startTime,
        'VALIDATION_ERROR',
        validation.errors.join('; '),
        request.instruction,
        [],
        threshold
      );
    }

    // Build search criteria from parsed action
    const searchCriteria = this.buildSearchCriteria(parsed);

    // Search for the target element
    const searchResponse = this.searchEngine.search(searchCriteria);

    if (!searchResponse.bestMatch) {
      return this.createFailureResponse(
        startTime,
        'ELEMENT_NOT_FOUND',
        `Could not find element matching: "${parsed.targetDescription}"`,
        request.instruction,
        searchResponse.results,
        threshold,
        searchCriteria
      );
    }

    // Check confidence threshold
    if (searchResponse.bestMatch.confidence < threshold) {
      const alternatives = searchResponse.results.slice(0, this.config.maxAlternatives);
      return this.createFailureResponse(
        startTime,
        'LOW_CONFIDENCE',
        `Best match confidence (${(searchResponse.bestMatch.confidence * 100).toFixed(0)}%) is below threshold (${(threshold * 100).toFixed(0)}%)`,
        request.instruction,
        alternatives,
        threshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }

    // Execute the action
    try {
      const result = await this.performAction(
        parsed,
        searchResponse.bestMatch.element,
        request.timeout ?? this.config.defaultTimeout
      );

      return {
        success: true,
        executedAction: describeAction(parsed),
        elementUsed: searchResponse.bestMatch.element,
        confidence: searchResponse.bestMatch.confidence,
        elementState: result.elementState,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const alternatives = searchResponse.results
        .filter((r) => r !== searchResponse.bestMatch)
        .slice(0, this.config.maxAlternatives);

      return this.createFailureResponse(
        startTime,
        'ACTION_FAILED',
        errorMessage,
        request.instruction,
        alternatives,
        threshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
  }

  /**
   * Execute a parsed action directly (skip parsing)
   */
  async executeParsed(parsed: ParsedAction, threshold?: number): Promise<NLActionResponse> {
    const startTime = performance.now();
    const confidenceThreshold = threshold ?? this.config.defaultConfidenceThreshold;

    // Build search criteria
    const searchCriteria = this.buildSearchCriteria(parsed);

    // Search for element
    const searchResponse = this.searchEngine.search(searchCriteria);

    if (!searchResponse.bestMatch) {
      return this.createFailureResponse(
        startTime,
        'ELEMENT_NOT_FOUND',
        `Could not find element: "${parsed.targetDescription}"`,
        parsed.rawInstruction,
        [],
        confidenceThreshold,
        searchCriteria
      );
    }

    if (searchResponse.bestMatch.confidence < confidenceThreshold) {
      return this.createFailureResponse(
        startTime,
        'LOW_CONFIDENCE',
        `Best match confidence too low`,
        parsed.rawInstruction,
        searchResponse.results.slice(0, this.config.maxAlternatives),
        confidenceThreshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }

    // Execute
    try {
      const result = await this.performAction(
        parsed,
        searchResponse.bestMatch.element,
        this.config.defaultTimeout
      );

      return {
        success: true,
        executedAction: describeAction(parsed),
        elementUsed: searchResponse.bestMatch.element,
        confidence: searchResponse.bestMatch.confidence,
        elementState: result.elementState,
        durationMs: performance.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      return this.createFailureResponse(
        startTime,
        'ACTION_FAILED',
        error instanceof Error ? error.message : String(error),
        parsed.rawInstruction,
        searchResponse.results
          .filter((r) => r !== searchResponse.bestMatch)
          .slice(0, this.config.maxAlternatives),
        confidenceThreshold,
        searchCriteria,
        searchResponse.bestMatch
      );
    }
  }

  /**
   * Build search criteria from a parsed action
   */
  private buildSearchCriteria(parsed: ParsedAction): SearchCriteria {
    const criteria: SearchCriteria = {
      text: parsed.targetDescription,
      fuzzy: true,
      fuzzyThreshold: this.config.defaultConfidenceThreshold,
    };

    // Add type hints based on action
    switch (parsed.action) {
      case 'click':
      case 'doubleClick':
      case 'rightClick':
        // Could be button or link
        break;
      case 'type':
      case 'clear':
        // Should be an input
        criteria.type = 'input';
        break;
      case 'select':
        criteria.type = 'select';
        break;
      case 'check':
      case 'uncheck':
        criteria.type = 'checkbox';
        break;
    }

    return criteria;
  }

  /**
   * Perform the actual action on an element
   */
  private async performAction(
    parsed: ParsedAction,
    element: AIDiscoveredElement,
    timeout: number
  ): Promise<{ elementState: ElementState }> {
    if (!this.actionExecutor) {
      throw new Error('No action executor configured');
    }

    // Map parsed action to standard action
    const actionMap: Record<ParsedAction['action'], StandardAction | null> = {
      click: 'click',
      doubleClick: 'doubleClick',
      rightClick: 'rightClick',
      type: 'type',
      select: 'select',
      check: 'check',
      uncheck: 'uncheck',
      scroll: 'scroll',
      wait: null, // Special handling
      assert: null, // Special handling
      hover: 'hover',
      focus: 'focus',
      clear: 'clear',
    };

    const standardAction = actionMap[parsed.action];

    if (!standardAction) {
      // Handle special actions
      if (parsed.action === 'wait') {
        const waitResult = await this.actionExecutor.waitFor(element.id, {
          visible: true,
          timeout,
        });
        if (!waitResult.met) {
          throw new Error(waitResult.error || 'Wait condition not met');
        }
        return { elementState: waitResult.state! };
      }

      if (parsed.action === 'assert') {
        // Assertions are handled by the assertions module
        throw new Error('Use the assertions module for assert actions');
      }

      throw new Error(`Unsupported action: ${parsed.action}`);
    }

    // Build action request
    const actionRequest: {
      action: StandardAction;
      params?: Record<string, unknown>;
      waitOptions?: { visible?: boolean; enabled?: boolean; timeout?: number };
    } = {
      action: standardAction,
      waitOptions: {
        visible: true,
        enabled: true,
        timeout,
      },
    };

    // Add action-specific params
    if (standardAction === 'type' && parsed.value) {
      actionRequest.params = { text: parsed.value };
    } else if (standardAction === 'select' && parsed.value) {
      actionRequest.params = { value: parsed.value };
    } else if (standardAction === 'scroll' && parsed.scrollDirection) {
      actionRequest.params = { direction: parsed.scrollDirection };
    }

    // Execute the action
    const response = await this.actionExecutor.executeAction(element.id, actionRequest);

    if (!response.success) {
      throw new Error(response.error || 'Action failed');
    }

    return { elementState: response.elementState! };
  }

  /**
   * Create a failure response with suggestions
   */
  private createFailureResponse(
    startTime: number,
    errorCode: string,
    errorMessage: string,
    instruction: string,
    alternatives: SearchResult[],
    threshold: number,
    searchCriteria?: SearchCriteria,
    nearestMatch?: SearchResult
  ): NLActionResponse {
    // Generate suggestions
    const suggestions = this.generateSuggestions(
      errorCode,
      instruction,
      alternatives,
      nearestMatch
    );

    // Create a dummy element for the response
    const dummyElement: AIDiscoveredElement = nearestMatch?.element || {
      id: 'not-found',
      type: 'unknown',
      tagName: 'unknown',
      actions: [],
      state: {
        visible: false,
        enabled: false,
        focused: false,
        rect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 },
      },
      registered: false,
      description: 'Element not found',
      aliases: [],
      suggestedActions: [],
    };

    return {
      success: false,
      executedAction: instruction,
      elementUsed: dummyElement,
      confidence: nearestMatch?.confidence || 0,
      elementState: dummyElement.state,
      durationMs: performance.now() - startTime,
      timestamp: Date.now(),
      error: errorMessage,
      errorCode,
      suggestions,
      alternatives: alternatives.slice(0, this.config.maxAlternatives),
    };
  }

  /**
   * Generate recovery suggestions
   */
  private generateSuggestions(
    errorCode: string,
    instruction: string,
    alternatives: SearchResult[],
    nearestMatch?: SearchResult
  ): string[] {
    const suggestions: string[] = [];

    switch (errorCode) {
      case 'PARSE_ERROR':
        suggestions.push('Try using a simpler phrase like "click Submit button"');
        suggestions.push('Ensure the instruction follows patterns like "click X" or "type Y into X"');
        break;

      case 'ELEMENT_NOT_FOUND':
        if (alternatives.length > 0) {
          suggestions.push(`Did you mean: "${alternatives[0].element.description}"?`);
        }
        suggestions.push('Check if the element is visible on the page');
        suggestions.push('Try using a more specific description');
        break;

      case 'LOW_CONFIDENCE':
        if (nearestMatch) {
          suggestions.push(
            `Found "${nearestMatch.element.description}" with ${(nearestMatch.confidence * 100).toFixed(0)}% confidence`
          );
        }
        suggestions.push('Try using the exact text shown on the element');
        suggestions.push('Lower the confidence threshold if this match is correct');
        break;

      case 'ACTION_FAILED':
        suggestions.push('Check if the element is enabled');
        suggestions.push('Wait for any loading to complete');
        suggestions.push('Ensure no modal or overlay is blocking the element');
        break;

      default:
        suggestions.push('Try a different approach or check the page state');
    }

    return suggestions;
  }

  /**
   * Get rich error context for debugging
   */
  getErrorContext(
    errorCode: string,
    instruction: string,
    searchCriteria?: SearchCriteria,
    nearestMatch?: SearchResult
  ): AIErrorContext {
    return createErrorContext(
      errorCode as keyof typeof ErrorCodes,
      instruction,
      this.elements,
      searchCriteria,
      nearestMatch
    );
  }
}

/**
 * Create a default NL action executor
 */
export function createNLActionExecutor(
  config?: Partial<NLActionExecutorConfig>
): NLActionExecutor {
  return new NLActionExecutor(config);
}
