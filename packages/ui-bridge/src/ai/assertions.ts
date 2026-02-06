/**
 * Assertions Module
 *
 * Provides verification/assertion API for AI agents to validate
 * page state without writing Playwright tests.
 */

import type { ElementState } from '../core/types';
import type { DiscoveredElement } from '../control/types';
import type {
  AssertionRequest,
  AssertionResult,
  BatchAssertionRequest,
  BatchAssertionResult,
  SearchCriteria,
  AIDiscoveredElement,
} from './types';
import { SearchEngine } from './search-engine';

/**
 * Configuration for assertions
 */
export interface AssertionConfig {
  /** Default timeout for wait-based assertions */
  defaultTimeout: number;
  /** Polling interval for wait-based assertions */
  pollInterval: number;
  /** Default fuzzy threshold for element search */
  fuzzyThreshold: number;
  /** Include suggestions in failure messages */
  includeSuggestions: boolean;
}

/**
 * Default assertion configuration
 */
export const DEFAULT_ASSERTION_CONFIG: AssertionConfig = {
  defaultTimeout: 5000,
  pollInterval: 100,
  fuzzyThreshold: 0.7,
  includeSuggestions: true,
};

/**
 * Assertion executor class
 */
export class AssertionExecutor {
  private config: AssertionConfig;
  private searchEngine: SearchEngine;
  private elements: Array<DiscoveredElement | AIDiscoveredElement> = [];

  constructor(config: Partial<AssertionConfig> = {}) {
    this.config = { ...DEFAULT_ASSERTION_CONFIG, ...config };
    this.searchEngine = new SearchEngine({ fuzzyThreshold: this.config.fuzzyThreshold });
  }

  /**
   * Update available elements for assertions
   */
  updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void {
    this.elements = elements;
    this.searchEngine.updateElements(elements);
  }

  /**
   * Execute a single assertion
   */
  async assert(request: AssertionRequest): Promise<AssertionResult> {
    const startTime = performance.now();
    const timeout = request.timeout ?? this.config.defaultTimeout;

    // Find the target element
    const element = await this.findElement(request.target, request.fuzzy !== false);

    if (!element && request.type !== 'notExists') {
      return this.createResult(
        false,
        typeof request.target === 'string' ? request.target : JSON.stringify(request.target),
        'element not found',
        request.type === 'exists' ? true : request.expected,
        null,
        'Element could not be found',
        this.config.includeSuggestions
          ? 'Check if the element exists and is properly labeled'
          : undefined,
        startTime
      );
    }

    // Execute the assertion based on type
    return this.executeAssertion(request, element, timeout, startTime);
  }

  /**
   * Execute multiple assertions
   */
  async assertBatch(request: BatchAssertionRequest): Promise<BatchAssertionResult> {
    const startTime = performance.now();
    const results: AssertionResult[] = [];
    let passedCount = 0;
    let failedCount = 0;

    for (const assertion of request.assertions) {
      const result = await this.assert(assertion);
      results.push(result);

      if (result.passed) {
        passedCount++;
      } else {
        failedCount++;

        // Stop on first failure if configured
        if (request.stopOnFailure) {
          // Mark remaining assertions as skipped
          break;
        }
      }
    }

    // Determine overall pass/fail
    const passed = request.mode === 'all' ? failedCount === 0 : passedCount > 0;

    return {
      passed,
      results,
      passedCount,
      failedCount,
      durationMs: performance.now() - startTime,
      timestamp: Date.now(),
    };
  }

  /**
   * Convenience method: assert element is visible
   */
  async assertVisible(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult> {
    return this.assert({ target, type: 'visible', timeout });
  }

  /**
   * Convenience method: assert element is hidden
   */
  async assertHidden(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult> {
    return this.assert({ target, type: 'hidden', timeout });
  }

  /**
   * Convenience method: assert element is enabled
   */
  async assertEnabled(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult> {
    return this.assert({ target, type: 'enabled', timeout });
  }

  /**
   * Convenience method: assert element is disabled
   */
  async assertDisabled(
    target: string | SearchCriteria,
    timeout?: number
  ): Promise<AssertionResult> {
    return this.assert({ target, type: 'disabled', timeout });
  }

  /**
   * Convenience method: assert element has text
   */
  async assertHasText(
    target: string | SearchCriteria,
    text: string,
    timeout?: number
  ): Promise<AssertionResult> {
    return this.assert({ target, type: 'hasText', expected: text, timeout });
  }

  /**
   * Convenience method: assert element contains text
   */
  async assertContainsText(
    target: string | SearchCriteria,
    text: string,
    timeout?: number
  ): Promise<AssertionResult> {
    return this.assert({ target, type: 'containsText', expected: text, timeout });
  }

  /**
   * Convenience method: assert element has value
   */
  async assertHasValue(
    target: string | SearchCriteria,
    value: string,
    timeout?: number
  ): Promise<AssertionResult> {
    return this.assert({ target, type: 'hasValue', expected: value, timeout });
  }

  /**
   * Convenience method: assert element exists
   */
  async assertExists(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult> {
    return this.assert({ target, type: 'exists', timeout });
  }

  /**
   * Convenience method: assert element does not exist
   */
  async assertNotExists(
    target: string | SearchCriteria,
    timeout?: number
  ): Promise<AssertionResult> {
    return this.assert({ target, type: 'notExists', timeout });
  }

  /**
   * Convenience method: assert checkbox is checked
   */
  async assertChecked(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult> {
    return this.assert({ target, type: 'checked', timeout });
  }

  /**
   * Convenience method: assert checkbox is unchecked
   */
  async assertUnchecked(
    target: string | SearchCriteria,
    timeout?: number
  ): Promise<AssertionResult> {
    return this.assert({ target, type: 'unchecked', timeout });
  }

  /**
   * Convenience method: assert element count
   */
  async assertCount(
    target: SearchCriteria,
    expectedCount: number,
    timeout?: number
  ): Promise<AssertionResult> {
    return this.assert({ target, type: 'count', expected: expectedCount, timeout });
  }

  /**
   * Find element by target (string or criteria).
   * Public for use by condition evaluation in SpecExecutor.
   */
  public async findElement(
    target: string | SearchCriteria,
    fuzzy: boolean = true
  ): Promise<AIDiscoveredElement | null> {
    const criteria: SearchCriteria =
      typeof target === 'string' ? { text: target, fuzzy } : { ...target, fuzzy };

    const searchResult = this.searchEngine.findBest(criteria);

    if (searchResult && searchResult.confidence >= this.config.fuzzyThreshold) {
      return searchResult.element;
    }

    return null;
  }

  /**
   * Execute the actual assertion
   */
  private async executeAssertion(
    request: AssertionRequest,
    element: AIDiscoveredElement | null,
    timeout: number,
    startTime: number
  ): Promise<AssertionResult> {
    const targetStr =
      typeof request.target === 'string' ? request.target : JSON.stringify(request.target);

    const elementDescription = element?.description || targetStr;

    switch (request.type) {
      case 'visible':
        return this.assertVisibility(
          element!,
          true,
          elementDescription,
          request.message,
          startTime
        );

      case 'hidden':
        return this.assertVisibility(
          element!,
          false,
          elementDescription,
          request.message,
          startTime
        );

      case 'enabled':
        return this.assertEnabledState(
          element!,
          true,
          elementDescription,
          request.message,
          startTime
        );

      case 'disabled':
        return this.assertEnabledState(
          element!,
          false,
          elementDescription,
          request.message,
          startTime
        );

      case 'focused':
        return this.assertFocused(element!, elementDescription, request.message, startTime);

      case 'checked':
        return this.assertCheckedState(
          element!,
          true,
          elementDescription,
          request.message,
          startTime
        );

      case 'unchecked':
        return this.assertCheckedState(
          element!,
          false,
          elementDescription,
          request.message,
          startTime
        );

      case 'hasText':
        return this.assertTextMatch(
          element!,
          request.expected as string,
          true,
          elementDescription,
          request.message,
          startTime
        );

      case 'containsText':
        return this.assertTextMatch(
          element!,
          request.expected as string,
          false,
          elementDescription,
          request.message,
          startTime
        );

      case 'hasValue':
        return this.assertValue(
          element!,
          request.expected as string,
          elementDescription,
          request.message,
          startTime
        );

      case 'exists':
        return this.createResult(
          element !== null,
          targetStr,
          elementDescription,
          true,
          element !== null,
          element === null ? 'Element does not exist' : undefined,
          undefined,
          startTime,
          element?.state
        );

      case 'notExists':
        return this.createResult(
          element === null,
          targetStr,
          elementDescription,
          false,
          element === null,
          element !== null ? 'Element exists but should not' : undefined,
          undefined,
          startTime,
          element?.state
        );

      case 'count':
        return this.assertElementCount(
          request.target as SearchCriteria,
          request.expected as number,
          targetStr,
          request.message,
          startTime
        );

      case 'attribute':
        return this.assertAttribute(
          element!,
          request.attributeName!,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );

      case 'hasClass':
        return this.assertHasClass(
          element!,
          request.expected as string,
          elementDescription,
          request.message,
          startTime
        );

      case 'cssProperty':
        return this.assertCssProperty(
          element!,
          request.propertyName!,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );

      default:
        return this.createResult(
          false,
          targetStr,
          elementDescription,
          undefined,
          undefined,
          `Unknown assertion type: ${request.type}`,
          undefined,
          startTime
        );
    }
  }

  /**
   * Assert visibility state
   */
  private assertVisibility(
    element: AIDiscoveredElement,
    expectedVisible: boolean,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const isVisible = element.state.visible;
    const passed = isVisible === expectedVisible;

    return this.createResult(
      passed,
      element.id,
      description,
      expectedVisible,
      isVisible,
      passed
        ? undefined
        : message ||
            `Element is ${isVisible ? 'visible' : 'hidden'} but expected ${expectedVisible ? 'visible' : 'hidden'}`,
      passed ? undefined : 'Check if element is covered by another element or has display:none',
      startTime,
      element.state
    );
  }

  /**
   * Assert enabled state
   */
  private assertEnabledState(
    element: AIDiscoveredElement,
    expectedEnabled: boolean,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const isEnabled = element.state.enabled;
    const passed = isEnabled === expectedEnabled;

    return this.createResult(
      passed,
      element.id,
      description,
      expectedEnabled,
      isEnabled,
      passed
        ? undefined
        : message ||
            `Element is ${isEnabled ? 'enabled' : 'disabled'} but expected ${expectedEnabled ? 'enabled' : 'disabled'}`,
      passed ? undefined : 'Check if the element has a disabled attribute or aria-disabled',
      startTime,
      element.state
    );
  }

  /**
   * Assert focused state
   */
  private assertFocused(
    element: AIDiscoveredElement,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const isFocused = element.state.focused;

    return this.createResult(
      isFocused,
      element.id,
      description,
      true,
      isFocused,
      isFocused ? undefined : message || 'Element is not focused',
      isFocused ? undefined : 'Click or focus the element first',
      startTime,
      element.state
    );
  }

  /**
   * Assert checked state
   */
  private assertCheckedState(
    element: AIDiscoveredElement,
    expectedChecked: boolean,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const isChecked = element.state.checked ?? false;
    const passed = isChecked === expectedChecked;

    return this.createResult(
      passed,
      element.id,
      description,
      expectedChecked,
      isChecked,
      passed
        ? undefined
        : message ||
            `Element is ${isChecked ? 'checked' : 'unchecked'} but expected ${expectedChecked ? 'checked' : 'unchecked'}`,
      passed ? undefined : 'Click the checkbox to change its state',
      startTime,
      element.state
    );
  }

  /**
   * Assert text content
   */
  private assertTextMatch(
    element: AIDiscoveredElement,
    expectedText: string,
    exact: boolean,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const actualText = element.state.textContent || '';
    const passed = exact ? actualText === expectedText : actualText.includes(expectedText);

    return this.createResult(
      passed,
      element.id,
      description,
      expectedText,
      actualText,
      passed
        ? undefined
        : message ||
            (exact
              ? `Text "${actualText}" does not match expected "${expectedText}"`
              : `Text "${actualText}" does not contain "${expectedText}"`),
      passed ? undefined : 'Verify the element contains the expected text',
      startTime,
      element.state
    );
  }

  /**
   * Assert input value
   */
  private assertValue(
    element: AIDiscoveredElement,
    expectedValue: string,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const actualValue = element.state.value || '';
    const passed = actualValue === expectedValue;

    return this.createResult(
      passed,
      element.id,
      description,
      expectedValue,
      actualValue,
      passed
        ? undefined
        : message || `Value "${actualValue}" does not match expected "${expectedValue}"`,
      passed ? undefined : 'Type the expected value into the input',
      startTime,
      element.state
    );
  }

  /**
   * Assert element count
   */
  private assertElementCount(
    criteria: SearchCriteria,
    expectedCount: number,
    targetStr: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const searchResponse = this.searchEngine.search(criteria);
    const actualCount = searchResponse.results.length;
    const passed = actualCount === expectedCount;

    return this.createResult(
      passed,
      targetStr,
      `${actualCount} elements matching criteria`,
      expectedCount,
      actualCount,
      passed ? undefined : message || `Found ${actualCount} elements but expected ${expectedCount}`,
      passed ? undefined : 'Adjust search criteria or wait for elements to load',
      startTime
    );
  }

  /**
   * Assert attribute value (placeholder for DOM attribute assertions)
   */
  private assertAttribute(
    element: AIDiscoveredElement,
    attributeName: string,
    expectedValue: unknown,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    // Note: Would need DOM access for actual attribute checking
    // For now, handle known attributes from state
    let actualValue: unknown;

    switch (attributeName.toLowerCase()) {
      case 'placeholder':
        actualValue = element.placeholder;
        break;
      case 'title':
        actualValue = element.title;
        break;
      default:
        return this.createResult(
          false,
          element.id,
          description,
          expectedValue,
          undefined,
          `Cannot check attribute "${attributeName}" without DOM access`,
          'Use the server API to check element attributes',
          startTime,
          element.state
        );
    }

    const passed = actualValue === expectedValue;

    return this.createResult(
      passed,
      element.id,
      description,
      expectedValue,
      actualValue,
      passed
        ? undefined
        : message ||
            `Attribute "${attributeName}" is "${actualValue}" but expected "${expectedValue}"`,
      undefined,
      startTime,
      element.state
    );
  }

  /**
   * Assert element has CSS class
   */
  private assertHasClass(
    element: AIDiscoveredElement,
    className: string,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    // Note: Would need DOM access for actual class checking
    return this.createResult(
      false,
      element.id,
      description,
      className,
      undefined,
      'Cannot check CSS classes without DOM access',
      'Use the server API to check element classes',
      startTime,
      element.state
    );
  }

  /**
   * Assert CSS property value
   */
  private assertCssProperty(
    element: AIDiscoveredElement,
    propertyName: string,
    expectedValue: unknown,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const computedStyles = element.state.computedStyles;
    if (!computedStyles) {
      return this.createResult(
        false,
        element.id,
        description,
        expectedValue,
        undefined,
        'Computed styles not available',
        'Request element state with computed styles',
        startTime,
        element.state
      );
    }

    const styleKey = propertyName as keyof typeof computedStyles;
    const actualValue = computedStyles[styleKey];
    const passed = actualValue === expectedValue;

    return this.createResult(
      passed,
      element.id,
      description,
      expectedValue,
      actualValue,
      passed
        ? undefined
        : message ||
            `CSS property "${propertyName}" is "${actualValue}" but expected "${expectedValue}"`,
      undefined,
      startTime,
      element.state
    );
  }

  /**
   * Create an assertion result
   */
  private createResult(
    passed: boolean,
    target: string,
    targetDescription: string,
    expected: unknown,
    actual: unknown,
    failureReason?: string,
    suggestion?: string,
    startTime: number = performance.now(),
    elementState?: ElementState
  ): AssertionResult {
    return {
      passed,
      target,
      targetDescription,
      expected,
      actual,
      failureReason,
      suggestion: this.config.includeSuggestions ? suggestion : undefined,
      elementState,
      durationMs: performance.now() - startTime,
      timestamp: Date.now(),
    };
  }
}

/**
 * Create a default assertion executor
 */
export function createAssertionExecutor(config?: Partial<AssertionConfig>): AssertionExecutor {
  return new AssertionExecutor(config);
}
