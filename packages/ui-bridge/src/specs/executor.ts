/**
 * Spec Executor
 *
 * Converts SpecAssertions to AssertionRequests and delegates
 * to the existing AssertionExecutor from ui-bridge/ai.
 */

import type { AssertionRequest, SearchCriteria } from '../ai/types';
import { AssertionExecutor, type AssertionConfig } from '../ai/assertions';
import type { DiscoveredElement } from '../control/types';
import type { AIDiscoveredElement } from '../ai/types';
import type {
  SpecConfig,
  SpecGroup,
  SpecAssertion,
  SpecTarget,
  SpecAssertionResult,
  SpecGroupResult,
  SpecExecutionResult,
  SpecExecutionOptions,
  AssertionCondition,
} from './types';
import { SPEC_CONFIG_VERSION } from './types';

// =============================================================================
// Target Resolution
// =============================================================================

/**
 * Resolve a SpecTarget to an AssertionRequest target.
 *
 * For elementId targets, returns a SearchCriteria with idPattern for exact
 * ID matching rather than a raw string (which would be treated as a text search).
 */
export function resolveTarget(target: SpecTarget): string | SearchCriteria {
  switch (target.type) {
    case 'elementId':
      // Use exact ID pattern match instead of text search.
      // A raw string would become { text: "id-value", fuzzy: true } which fails
      // for elements with no matching text content (e.g. container elements).
      return { idPattern: target.elementId, fuzzy: false };
    case 'search':
      return target.criteria;
  }
}

// =============================================================================
// Executor
// =============================================================================

export class SpecExecutor {
  private assertionExecutor: AssertionExecutor;

  constructor(config?: Partial<AssertionConfig>) {
    this.assertionExecutor = new AssertionExecutor(config);
  }

  /**
   * Update the element registry (pass-through to AssertionExecutor).
   */
  updateElements(elements: Array<DiscoveredElement | AIDiscoveredElement>): void {
    this.assertionExecutor.updateElements(elements);
  }

  /**
   * Convert a SpecAssertion to an AssertionRequest.
   */
  toAssertionRequest(assertion: SpecAssertion): AssertionRequest {
    return {
      target: resolveTarget(assertion.target),
      type: assertion.assertionType,
      expected: assertion.expected,
      attributeName: assertion.attributeName,
      propertyName: assertion.propertyName,
      timeout: assertion.timeout,
      message: assertion.message,
    };
  }

  /**
   * Evaluate a condition to determine if an assertion should be executed.
   * Returns true if the condition is met (assertion should run),
   * false if condition is not met (assertion should skip/pass).
   */
  private async evaluateCondition(condition: AssertionCondition): Promise<boolean> {
    const target = resolveTarget(condition.target);
    // Use non-fuzzy search for conditions to prevent false positives
    // (e.g. "Connected" fuzzy-matching "Disconnected")
    const element = await this.assertionExecutor.findElement(target, false);

    switch (condition.type) {
      case 'exists':
        return element !== null;
      case 'notExists':
        return element === null;
      case 'hasText': {
        if (!element) return false;
        // Check state.textContent first (actual element text), then accessible properties
        const textContent =
          element.state?.textContent ||
          element.accessibleName ||
          element.label ||
          element.description ||
          '';
        return textContent.toLowerCase().includes(condition.text.toLowerCase());
      }
      default:
        // Unknown condition type - evaluate the assertion
        return true;
    }
  }

  /**
   * Execute a single SpecAssertion.
   */
  async executeAssertion(assertion: SpecAssertion): Promise<SpecAssertionResult> {
    if (!assertion.enabled) {
      return {
        assertionId: assertion.id,
        severity: assertion.severity,
        category: assertion.category,
        skipped: true,
        result: null,
      };
    }

    // Check condition if present - skip assertion if condition is not met
    // This implements "A when B" logic: only evaluate A if B is true
    if (assertion.condition) {
      const conditionMet = await this.evaluateCondition(assertion.condition);
      if (!conditionMet) {
        // Condition not met - skip this assertion (no opinion)
        return {
          assertionId: assertion.id,
          severity: assertion.severity,
          category: assertion.category,
          skipped: true,
          skipReason: 'condition_not_met',
          result: null,
        };
      }
    }

    const request = this.toAssertionRequest(assertion);
    const result = await this.assertionExecutor.assert(request);

    return {
      assertionId: assertion.id,
      severity: assertion.severity,
      category: assertion.category,
      skipped: false,
      result,
    };
  }

  /**
   * Execute all assertions in a SpecGroup.
   */
  async executeGroup(group: SpecGroup, options?: SpecExecutionOptions): Promise<SpecGroupResult> {
    const startTime = Date.now();
    const assertionResults: SpecAssertionResult[] = [];
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const assertion of group.assertions) {
      if (shouldSkip(assertion, options)) {
        assertionResults.push({
          assertionId: assertion.id,
          groupId: group.id,
          severity: assertion.severity,
          category: assertion.category,
          skipped: true,
          result: null,
        });
        skippedCount++;
        continue;
      }

      const result = await this.executeAssertion(assertion);
      result.groupId = group.id;
      assertionResults.push(result);

      if (result.skipped) {
        skippedCount++;
      } else if (result.result?.passed) {
        passedCount++;
      } else {
        failedCount++;
        if (options?.stopOnFailure) break;
      }
    }

    return {
      groupId: group.id,
      groupName: group.name,
      assertionResults,
      passedCount,
      failedCount,
      skippedCount,
      passed: failedCount === 0,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  /**
   * Execute a full SpecConfig.
   */
  async execute(config: SpecConfig, options?: SpecExecutionOptions): Promise<SpecExecutionResult> {
    const startTime = Date.now();

    // Execute groups
    const groupResults: SpecGroupResult[] = [];
    for (const group of config.groups) {
      if (options?.groupIds && !options.groupIds.includes(group.id)) continue;

      const groupResult = await this.executeGroup(group, options);
      groupResults.push(groupResult);

      if (options?.stopOnFailure && !groupResult.passed) break;
    }

    // Execute ungrouped assertions
    const ungroupedResults: SpecAssertionResult[] = [];
    if (config.assertions) {
      for (const assertion of config.assertions) {
        if (shouldSkip(assertion, options)) {
          ungroupedResults.push({
            assertionId: assertion.id,
            severity: assertion.severity,
            category: assertion.category,
            skipped: true,
            result: null,
          });
          continue;
        }

        const result = await this.executeAssertion(assertion);
        ungroupedResults.push(result);

        if (options?.stopOnFailure && !result.skipped && !result.result?.passed) break;
      }
    }

    // Aggregate counts
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const gr of groupResults) {
      passedCount += gr.passedCount;
      failedCount += gr.failedCount;
      skippedCount += gr.skippedCount;
    }
    for (const ur of ungroupedResults) {
      if (ur.skipped) skippedCount++;
      else if (ur.result?.passed) passedCount++;
      else failedCount++;
    }

    return {
      specVersion: config.version ?? SPEC_CONFIG_VERSION,
      groupResults,
      ungroupedResults,
      totalAssertions: passedCount + failedCount + skippedCount,
      passedCount,
      failedCount,
      skippedCount,
      passed: failedCount === 0,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function shouldSkip(assertion: SpecAssertion, options?: SpecExecutionOptions): boolean {
  if (!assertion.enabled) return true;
  if (options?.assertionIds && !options.assertionIds.includes(assertion.id)) return true;
  if (options?.categories && !options.categories.includes(assertion.category)) return true;
  if (options?.severities && !options.severities.includes(assertion.severity)) return true;
  if (options?.skipUnreviewed && !assertion.reviewed) return true;
  return false;
}
