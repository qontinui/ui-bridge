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
  AssertionType,
  BatchAssertionRequest,
  BatchAssertionResult,
  SearchCriteria,
  SearchResult,
  AIDiscoveredElement,
} from './types';
import { UNKNOWN_CODE_DIAGNOSTICS, type UiBridgeErrorCode } from '../diagnostics';
import type { UnknownCode } from '../observation/observation';
import {
  cssPropertyName,
  isProjectionRequestError,
  liveElementOf,
  parseProjectionRequest,
  projectElement,
  type ElementProjectionRequest,
} from '../core/element-projection';

/**
 * Stable `UB-ASSERT-*` diagnostic code for a failed assertion.
 *
 * Plan Phase 1 / §2.1: every failed `AssertionResult` carries a machine
 * code alongside its prose `failureReason`. The mapping is deterministic
 * from the assertion type and (for element-resolution / timeout failures)
 * the failure reason text:
 *
 * - element could not be resolved / "not found" / "does not exist"
 *   / related target missing  → `UB-ASSERT-ELEMENT-MISSING`
 * - timeout / wait failures                                  → `UB-ASSERT-TIMEOUT`
 * - `visible` `hidden` `enabled` `disabled` `focused`
 *   `checked` `unchecked` (element-state predicates)          → `UB-ASSERT-VISIBILITY`
 * - `hasText` `containsText` `hasValue` `attribute` `count`
 *   (text / value content predicates)                        → `UB-ASSERT-TEXT-MISMATCH`
 * - `hasClass` `cssProperty` `cssPropertyInSet`
 *   `cssPropertyRange` `tokenCompliance` `noOverlap`
 *   `minSpacing` (geometry / style predicates)               → `UB-ASSERT-LAYOUT`
 *
 * `UB-ASSERT-CONTRAST` is in the catalog for the dedicated contrast
 * assertion surface (visual-audit); the AssertionExecutor has no
 * `contrast` assertion type, so it is not produced here.
 */
export function resolveAssertionFailureCode(
  type: AssertionType,
  failureReason?: string
): UiBridgeErrorCode {
  const reason = (failureReason ?? '').toLowerCase();

  if (
    reason.includes('not be found') ||
    reason.includes('not found') ||
    reason.includes('does not exist') ||
    reason.includes('exists but should not') ||
    reason.includes('element could not be found')
  ) {
    return 'UB-ASSERT-ELEMENT-MISSING';
  }

  if (reason.includes('timeout') || reason.includes('timed out')) {
    return 'UB-ASSERT-TIMEOUT';
  }

  switch (type) {
    case 'visible':
    case 'hidden':
    case 'enabled':
    case 'disabled':
    case 'focused':
    case 'checked':
    case 'unchecked':
      return 'UB-ASSERT-VISIBILITY';

    case 'hasText':
    case 'containsText':
    case 'hasValue':
    case 'attribute':
    case 'count':
      return 'UB-ASSERT-TEXT-MISMATCH';

    case 'hasClass':
    case 'cssProperty':
    case 'cssPropertyInSet':
    case 'cssPropertyRange':
    case 'tokenCompliance':
    case 'noOverlap':
    case 'minSpacing':
      return 'UB-ASSERT-LAYOUT';

    case 'exists':
    case 'notExists':
      return 'UB-ASSERT-ELEMENT-MISSING';

    default:
      return 'UB-ASSERT-ELEMENT-MISSING';
  }
}
import { SearchEngine } from './search-engine';
import { find } from './find';

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
 * Why a style or attribute check could not read the value it judges: the
 * observation `code`, the prose, and the diagnostic code the result carries.
 */
interface UnmeasuredRead {
  code: UnknownCode;
  detail: string;
  failureCode: UiBridgeErrorCode;
}

/** `background-color` → `backgroundColor`: the key `ElementState.computedStyles` uses. */
function computedStylesKey(cssName: string): string {
  return cssName.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Assertion executor class
 */
export class AssertionExecutor {
  private config: AssertionConfig;
  private searchEngine: SearchEngine;
  private elements: Array<DiscoveredElement | AIDiscoveredElement> = [];
  /**
   * The live node behind each element that has one (a registry element's
   * `.element`), keyed by id: what the style and attribute checks read through
   * the projection. Elements that crossed a wire carry none.
   */
  private liveNodes = new Map<string, Element>();

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
    this.liveNodes = new Map();
    for (const el of elements as Array<{ id?: unknown; element?: unknown }>) {
      const node = liveElementOf(el.element);
      if (node && typeof el.id === 'string') this.liveNodes.set(el.id, node);
    }
  }

  /**
   * Execute a single assertion
   */
  async assert(request: AssertionRequest): Promise<AssertionResult> {
    const startTime = performance.now();
    const timeout = request.timeout ?? this.config.defaultTimeout;

    // Find the target element with full search metadata
    const searchResult = this.findElementDetailed(request.target, request.fuzzy !== false);
    const element = searchResult?.element ?? null;
    const searchDetails = searchResult
      ? {
          confidence: searchResult.confidence,
          matchReasons: searchResult.matchReasons,
          candidateCount: this.elements.length,
        }
      : undefined;

    if (!element && request.type !== 'notExists') {
      const result = this.createResult(
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
      // Attach search details even for not-found (candidateCount helps AI understand scope)
      if (searchDetails) {
        result.searchDetails = searchDetails;
      }
      return this.withFailureCode(result, request.type);
    }

    // Execute the assertion based on type
    const result = await this.executeAssertion(request, element, timeout, startTime);
    // Attach search details to the result
    if (searchDetails) {
      result.searchDetails = searchDetails;
    }
    return this.withFailureCode(result, request.type);
  }

  /**
   * Ensure a failed assertion result carries a stable `UB-ASSERT-*` code
   * (plan Phase 1 — required whenever `passed: false`). Passing results are
   * returned unchanged. Idempotent: an already-set `failureCode` is kept.
   */
  private withFailureCode(
    result: AssertionResult,
    type: AssertionType
  ): AssertionResult {
    if (!result.passed && !result.failureCode) {
      result.failureCode = resolveAssertionFailureCode(type, result.failureReason);
    }
    return result;
  }

  /**
   * Execute multiple assertions
   */
  async assertBatch(request: BatchAssertionRequest): Promise<BatchAssertionResult> {
    const startTime = performance.now();
    const results: AssertionResult[] = [];
    let passedCount = 0;
    let failedCount = 0;
    let unmeasuredCount = 0;

    for (const assertion of request.assertions) {
      const result = await this.assert(assertion);
      results.push(result);

      if (result.passed) {
        passedCount++;
      } else {
        // An unmeasured check is neither a pass nor a failure of the page.
        if (result.outcome === 'unmeasured') unmeasuredCount++;
        else failedCount++;

        // Stop on the first result that keeps an 'all' batch from passing.
        if (request.stopOnFailure) {
          // Mark remaining assertions as skipped
          break;
        }
      }
    }

    // Determine overall pass/fail. An unmeasured check never passes an 'all'
    // batch: what could not be read was not shown to hold.
    const passed =
      request.mode === 'all' ? failedCount === 0 && unmeasuredCount === 0 : passedCount > 0;

    return {
      passed,
      results,
      passedCount,
      failedCount,
      unmeasuredCount,
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
   * Find element by target with full search metadata.
   * Returns the SearchResult (including confidence, matchReasons, scores)
   * or null if no match above the fuzzy threshold.
   *
   * Uses the unified find() function for element resolution — the same path
   * used by aiFind — to ensure consistent matching behavior.
   */
  private findElementDetailed(
    target: string | SearchCriteria,
    fuzzy: boolean = true
  ): SearchResult | null {
    // For string targets, try a literal text search first to avoid the
    // target decomposer misinterpreting words like "Hidden" or "Disabled"
    // as state filters (e.g., "Hidden Content" → stateFilter:"hidden", text:"Content").
    if (typeof target === 'string') {
      const directResult = this.searchEngine.search({
        text: target,
        fuzzy,
        fuzzyThreshold: this.config.fuzzyThreshold,
      });
      if (
        directResult.bestMatch &&
        directResult.bestMatch.confidence >= this.config.fuzzyThreshold
      ) {
        return directResult.bestMatch;
      }
    }

    const query: string | SearchCriteria =
      typeof target === 'string' ? target : { ...target, fuzzy };

    const findResult = find(query, this.searchEngine, {
      confidenceThreshold: this.config.fuzzyThreshold,
      pickFirst: true,
    });

    if (findResult.found && !findResult.ambiguous) {
      return {
        element: findResult.element,
        confidence: findResult.confidence,
        matchReasons: findResult.matchReasons,
        scores: {},
      };
    }

    if (findResult.found && findResult.ambiguous && findResult.candidates.length > 0) {
      const best = findResult.candidates[0];
      return {
        element: best.element,
        confidence: best.confidence,
        matchReasons: best.matchReasons,
        scores: {},
      };
    }

    return null;
  }

  /**
   * Find element by target (string or criteria).
   * Public for use by condition evaluation in SpecExecutor.
   */
  public async findElement(
    target: string | SearchCriteria,
    fuzzy: boolean = true
  ): Promise<AIDiscoveredElement | null> {
    const result = this.findElementDetailed(target, fuzzy);
    return result?.element ?? null;
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
          request.attributeName,
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
          request.propertyName,
          request.expected,
          elementDescription,
          request.message,
          startTime
        );

      case 'cssPropertyInSet':
        return this.assertCssPropertyInSet(
          element!,
          request.propertyName,
          request.allowedValues || [],
          elementDescription,
          request.message,
          startTime
        );

      case 'cssPropertyRange':
        return this.assertCssPropertyRange(
          element!,
          request.propertyName,
          request.range || {},
          elementDescription,
          request.message,
          startTime
        );

      case 'tokenCompliance':
        return this.assertTokenCompliance(
          element!,
          request.propertyName,
          request.tokenPath || '',
          request.expected,
          elementDescription,
          request.message,
          startTime
        );

      case 'noOverlap': {
        const relatedResult = this.findElementDetailed(
          request.relatedTarget!,
          request.fuzzy !== false
        );
        if (!relatedResult) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            'no overlap',
            null,
            'Related target element not found',
            'Check if the related target element exists and is properly labeled',
            startTime,
            element?.state
          );
        }
        const rectA = element!.state.rect;
        const rectB = relatedResult.element.state.rect;
        if (!rectA || !rectB) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            'no overlap',
            null,
            'Rect data not available for one or both elements',
            'Ensure elements have rect data in their state',
            startTime,
            element?.state
          );
        }
        const overlaps =
          rectA.right > rectB.left &&
          rectA.left < rectB.right &&
          rectA.bottom > rectB.top &&
          rectA.top < rectB.bottom;
        const overlapDesc = overlaps
          ? `elements overlap (A: ${rectA.left},${rectA.top}-${rectA.right},${rectA.bottom} B: ${rectB.left},${rectB.top}-${rectB.right},${rectB.bottom})`
          : `no overlap (gap exists)`;
        return this.createResult(
          !overlaps,
          targetStr,
          elementDescription,
          'no overlap',
          overlapDesc,
          overlaps ? 'Elements overlap when they should not' : undefined,
          overlaps ? 'Adjust element positions or sizes to remove overlap' : undefined,
          startTime,
          element?.state
        );
      }

      case 'minSpacing': {
        const relatedResult2 = this.findElementDetailed(
          request.relatedTarget!,
          request.fuzzy !== false
        );
        if (!relatedResult2) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            `min gap ${request.minGap ?? 0}px`,
            null,
            'Related target element not found',
            'Check if the related target element exists and is properly labeled',
            startTime,
            element?.state
          );
        }
        const rA = element!.state.rect;
        const rB = relatedResult2.element.state.rect;
        if (!rA || !rB) {
          return this.createResult(
            false,
            targetStr,
            elementDescription,
            `min gap ${request.minGap ?? 0}px`,
            null,
            'Rect data not available for one or both elements',
            'Ensure elements have rect data in their state',
            startTime,
            element?.state
          );
        }
        const gapLeft = rB.left - rA.right;
        const gapRight = rA.left - rB.right;
        const gapTop = rB.top - rA.bottom;
        const gapBottom = rA.top - rB.bottom;
        const actualGap = Math.max(gapLeft, gapRight, gapTop, gapBottom);
        const requiredGap = request.minGap ?? 0;
        const spacingPassed = actualGap >= requiredGap;
        return this.createResult(
          spacingPassed,
          targetStr,
          elementDescription,
          `min gap ${requiredGap}px`,
          `${actualGap}px`,
          spacingPassed
            ? undefined
            : `Spacing is ${actualGap}px but expected at least ${requiredGap}px`,
          spacingPassed ? undefined : 'Increase margin or padding between elements',
          startTime,
          element?.state
        );
      }

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
   * Assert attribute value.
   *
   * `placeholder` is read off the element's search projection (already
   * §4.6-scrubbed). Every other name is read through the request-scoped
   * projection (`core/element-projection.ts`) off the element's live node — the
   * same allow-list and the same scrub as `/control/find`'s `attributes` — so an
   * absent attribute is a measured `null`, and a name the projection refuses or
   * cannot read makes the check UNMEASURED, never a failure with no value.
   */
  private assertAttribute(
    element: AIDiscoveredElement,
    attributeName: string | undefined,
    expectedValue: unknown,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    let actualValue: unknown;
    if (attributeName?.toLowerCase() === 'placeholder') {
      actualValue = element.placeholder;
    } else {
      const read = this.readProjected(element, 'attribute', attributeName);
      if ('unmeasured' in read) {
        return this.unmeasuredResult(
          element,
          description,
          expectedValue,
          `attribute "${attributeName ?? ''}"`,
          read.unmeasured,
          startTime
        );
      }
      actualValue = read.value;
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
            `Attribute "${attributeName}" is ${actualValue === null ? 'absent' : `"${String(actualValue)}"`} but expected "${String(expectedValue)}"`,
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
   * Read one CSS property or attribute of `element` for a check.
   *
   * With a live node: through the projection (`core/element-projection.ts`) —
   * the computed value (`var()` resolved) of any standard, camel-cased or
   * custom property, and the allow-listed attributes, §4.6-scrubbed. Without
   * one (an element that crossed a wire): the fixed `ElementState.computedStyles`
   * subset for a property it carries, and the search projection's `title`.
   * Anything else, and any name the projection refuses or cannot read, comes
   * back UNMEASURED with its code — never as `''`.
   */
  private readProjected(
    element: AIDiscoveredElement,
    kind: 'property' | 'attribute',
    name: string | undefined
  ): { value: string | null } | { unmeasured: UnmeasuredRead } {
    const option = kind === 'property' ? 'propertyName' : 'attributeName';
    if (typeof name !== 'string' || name === '') {
      return {
        unmeasured: {
          code: 'no_expectation',
          detail: `the assertion names no \`${option}\``,
          failureCode: 'UB-VALIDATION-ERROR',
        },
      };
    }
    let request: ElementProjectionRequest | undefined;
    try {
      request = parseProjectionRequest(
        kind === 'property' ? { properties: [name] } : { attributes: [name] },
        'body'
      );
    } catch (err) {
      if (!isProjectionRequestError(err)) throw err;
      // A name the projection refuses cannot be judged: the assertion itself is
      // malformed. Unmeasured, coded as the validation failure it is.
      return {
        unmeasured: { code: 'no_expectation', detail: err.message, failureCode: err.code },
      };
    }

    const node = this.liveNodes.get(element.id);
    if (node && request) {
      const projection = projectElement(node, request);
      const miss = projection.unmeasured[0];
      if (miss) {
        return {
          unmeasured: {
            code: miss.code,
            detail: miss.detail,
            failureCode: UNKNOWN_CODE_DIAGNOSTICS[miss.code],
          },
        };
      }
      const value =
        kind === 'property' ? projection.properties?.[name] : projection.attributes?.[name];
      if (value !== undefined) return { value };
    }

    // No live node: what the element's serialized state carries.
    if (kind === 'property') {
      const key = computedStylesKey(cssPropertyName(name));
      const styles = element.state?.computedStyles as Record<string, unknown> | undefined;
      const value = styles?.[key];
      if (typeof value === 'string' && value !== '') return { value };
    } else if (name.toLowerCase() === 'title' && typeof element.title === 'string') {
      return { value: element.title };
    }
    return {
      unmeasured: {
        code: 'capability_unavailable_in_build',
        detail:
          `${kind === 'property' ? 'computed style' : 'attribute'} \`${name}\` not available: ` +
          'this element has no live DOM node to read it from' +
          (kind === 'property' ? ', and its state carries no such computed style' : ''),
        failureCode: 'UB-OBS-CAPABILITY-UNAVAILABLE-IN-BUILD',
      },
    };
  }

  /**
   * The result of a check that could not read its value: `outcome:
   * 'unmeasured'`, `passed: false` (it never passes a gate), no `actual`, and
   * the code that says why — never a failure with `actual: ''`.
   */
  private unmeasuredResult(
    element: AIDiscoveredElement,
    description: string,
    expected: unknown,
    what: string,
    unmeasured: UnmeasuredRead,
    startTime: number
  ): AssertionResult {
    const result = this.createResult(
      false,
      element.id,
      description,
      expected,
      undefined,
      `Cannot check ${what}: ${unmeasured.detail}`,
      unmeasured.failureCode === 'UB-VALIDATION-ERROR'
        ? 'Name a CSS property or an allow-listed attribute (lang, dir, id, role, title, alt, href, aria-*)'
        : 'The value could not be read here: assert against an element with a live DOM node',
      startTime,
      element.state
    );
    result.outcome = 'unmeasured';
    result.unmeasured = { code: unmeasured.code, detail: unmeasured.detail };
    result.failureCode = unmeasured.failureCode;
    return result;
  }

  /**
   * Assert CSS property value is in a set of allowed values
   */
  private assertCssPropertyInSet(
    element: AIDiscoveredElement,
    propertyName: string | undefined,
    allowedValues: string[],
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const read = this.readProjected(element, 'property', propertyName);
    if ('unmeasured' in read) {
      return this.unmeasuredResult(
        element,
        description,
        allowedValues,
        `CSS property "${propertyName ?? ''}"`,
        read.unmeasured,
        startTime
      );
    }
    const actualValue = read.value ?? '';
    const normalizedActual = actualValue.trim().toLowerCase();
    const passed = allowedValues.some((v) => v.trim().toLowerCase() === normalizedActual);

    return this.createResult(
      passed,
      element.id,
      description,
      allowedValues,
      actualValue,
      passed
        ? undefined
        : message ||
            `CSS property "${propertyName}" is "${actualValue}" but expected one of [${allowedValues.join(', ')}]`,
      undefined,
      startTime,
      element.state
    );
  }

  /**
   * Assert CSS property numeric value is within a range
   */
  private assertCssPropertyRange(
    element: AIDiscoveredElement,
    propertyName: string | undefined,
    range: { min?: number; max?: number },
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const read = this.readProjected(element, 'property', propertyName);
    if ('unmeasured' in read) {
      return this.unmeasuredResult(
        element,
        description,
        range,
        `CSS property "${propertyName ?? ''}"`,
        read.unmeasured,
        startTime
      );
    }
    const actualValue = read.value ?? '';
    const numericValue = parseFloat(actualValue);

    if (isNaN(numericValue)) {
      // Measured, and not a number: the range does not hold.
      return this.createResult(
        false,
        element.id,
        description,
        range,
        actualValue,
        `Cannot parse "${actualValue}" as a number for range check`,
        undefined,
        startTime,
        element.state
      );
    }

    const aboveMin = range.min === undefined || numericValue >= range.min;
    const belowMax = range.max === undefined || numericValue <= range.max;
    const passed = aboveMin && belowMax;

    return this.createResult(
      passed,
      element.id,
      description,
      range,
      numericValue,
      passed
        ? undefined
        : message ||
            `CSS property "${propertyName}" is ${numericValue} but expected range [${range.min ?? '-∞'}, ${range.max ?? '∞'}]`,
      undefined,
      startTime,
      element.state
    );
  }

  /**
   * Assert CSS property matches a design token value.
   * Note: Token resolution requires the token value to be provided as `expected`.
   */
  private assertTokenCompliance(
    element: AIDiscoveredElement,
    propertyName: string | undefined,
    tokenPath: string,
    expectedTokenValue: unknown,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    if (expectedTokenValue === undefined) {
      return this.createResult(
        false,
        element.id,
        description,
        undefined,
        undefined,
        `Token value not provided for "${tokenPath}"`,
        'Provide the resolved token value in the expected field',
        startTime,
        element.state
      );
    }

    const read = this.readProjected(element, 'property', propertyName);
    if ('unmeasured' in read) {
      return this.unmeasuredResult(
        element,
        description,
        expectedTokenValue,
        `CSS property "${propertyName ?? ''}"`,
        read.unmeasured,
        startTime
      );
    }
    const actualValue = (read.value ?? '').trim().toLowerCase();
    const expectedStr = String(expectedTokenValue).trim().toLowerCase();
    const passed = actualValue === expectedStr;

    return this.createResult(
      passed,
      element.id,
      description,
      `${expectedTokenValue} (token: ${tokenPath})`,
      actualValue,
      passed
        ? undefined
        : message ||
            `CSS property "${propertyName}" is "${actualValue}" but expected token "${tokenPath}" (${expectedTokenValue})`,
      undefined,
      startTime,
      element.state
    );
  }

  /**
   * Assert CSS property value
   */
  private assertCssProperty(
    element: AIDiscoveredElement,
    propertyName: string | undefined,
    expectedValue: unknown,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const read = this.readProjected(element, 'property', propertyName);
    if ('unmeasured' in read) {
      return this.unmeasuredResult(
        element,
        description,
        expectedValue,
        `CSS property "${propertyName ?? ''}"`,
        read.unmeasured,
        startTime
      );
    }
    const actualValue = read.value;
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
      outcome: passed ? 'passed' : 'failed',
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
