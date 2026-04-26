import { am as DiscoveredElement, an as AIDiscoveredElement, K as AssertionRequest, L as AssertionResult, M as BatchAssertionRequest, O as BatchAssertionResult, G as SearchCriteria } from './types-X8pyInrK.mjs';

/**
 * Assertions Module
 *
 * Provides verification/assertion API for AI agents to validate
 * page state without writing Playwright tests.
 */

/**
 * Configuration for assertions
 */
interface AssertionConfig {
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
declare const DEFAULT_ASSERTION_CONFIG: AssertionConfig;
/**
 * Assertion executor class
 */
declare class AssertionExecutor {
    private config;
    private searchEngine;
    private elements;
    constructor(config?: Partial<AssertionConfig>);
    /**
     * Update available elements for assertions
     */
    updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void;
    /**
     * Execute a single assertion
     */
    assert(request: AssertionRequest): Promise<AssertionResult>;
    /**
     * Execute multiple assertions
     */
    assertBatch(request: BatchAssertionRequest): Promise<BatchAssertionResult>;
    /**
     * Convenience method: assert element is visible
     */
    assertVisible(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert element is hidden
     */
    assertHidden(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert element is enabled
     */
    assertEnabled(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert element is disabled
     */
    assertDisabled(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert element has text
     */
    assertHasText(target: string | SearchCriteria, text: string, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert element contains text
     */
    assertContainsText(target: string | SearchCriteria, text: string, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert element has value
     */
    assertHasValue(target: string | SearchCriteria, value: string, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert element exists
     */
    assertExists(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert element does not exist
     */
    assertNotExists(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert checkbox is checked
     */
    assertChecked(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert checkbox is unchecked
     */
    assertUnchecked(target: string | SearchCriteria, timeout?: number): Promise<AssertionResult>;
    /**
     * Convenience method: assert element count
     */
    assertCount(target: SearchCriteria, expectedCount: number, timeout?: number): Promise<AssertionResult>;
    /**
     * Find element by target with full search metadata.
     * Returns the SearchResult (including confidence, matchReasons, scores)
     * or null if no match above the fuzzy threshold.
     *
     * Uses the unified find() function for element resolution — the same path
     * used by aiFind — to ensure consistent matching behavior.
     */
    private findElementDetailed;
    /**
     * Find element by target (string or criteria).
     * Public for use by condition evaluation in SpecExecutor.
     */
    findElement(target: string | SearchCriteria, fuzzy?: boolean): Promise<AIDiscoveredElement | null>;
    /**
     * Execute the actual assertion
     */
    private executeAssertion;
    /**
     * Assert visibility state
     */
    private assertVisibility;
    /**
     * Assert enabled state
     */
    private assertEnabledState;
    /**
     * Assert focused state
     */
    private assertFocused;
    /**
     * Assert checked state
     */
    private assertCheckedState;
    /**
     * Assert text content
     */
    private assertTextMatch;
    /**
     * Assert input value
     */
    private assertValue;
    /**
     * Assert element count
     */
    private assertElementCount;
    /**
     * Assert attribute value (placeholder for DOM attribute assertions)
     */
    private assertAttribute;
    /**
     * Assert element has CSS class
     */
    private assertHasClass;
    /**
     * Assert CSS property value is in a set of allowed values
     */
    private assertCssPropertyInSet;
    /**
     * Assert CSS property numeric value is within a range
     */
    private assertCssPropertyRange;
    /**
     * Assert CSS property matches a design token value.
     * Note: Token resolution requires the token value to be provided as `expected`.
     */
    private assertTokenCompliance;
    /**
     * Assert CSS property value
     */
    private assertCssProperty;
    /**
     * Create an assertion result
     */
    private createResult;
}
/**
 * Create a default assertion executor
 */
declare function createAssertionExecutor(config?: Partial<AssertionConfig>): AssertionExecutor;

export { type AssertionConfig as A, DEFAULT_ASSERTION_CONFIG as D, AssertionExecutor as a, createAssertionExecutor as c };
