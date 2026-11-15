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
import { readPlaceholderAttr } from '../core/a11y';
import { resolvePageSentinel } from '../core/page-sentinel';
import { trustDeveloperContent, verdictFromState, verdictOf } from '../core/redaction';

/**
 * Stable `UB-ASSERT-*` diagnostic code for a FAILED assertion — one that
 * compared a value and found it wrong.
 *
 * Plan Phase 1 / §2.1: every non-passing `AssertionResult` carries a machine
 * code alongside its prose `failureReason`. A check that could not compare
 * anything is not a failure of the page: it is `outcome: 'unmeasured'`, and
 * its code is set where it is produced (`unmeasuredResult`), never here — the
 * `UB-OBS-*` code of why the value could not be read (no live node, no layout
 * rect, a §4.6 boundary), or `UB-VALIDATION-ERROR` for an assertion that names
 * nothing to compare (no `relatedTarget` for a spatial check, no class, a
 * `type` the executor does not know). For a failure, the mapping is
 * deterministic from the assertion type and (for element-resolution / timeout
 * failures) the failure reason text:
 *
 * - element could not be resolved / "not found" / "does not exist"
 *   / related target not found  → `UB-ASSERT-ELEMENT-MISSING`
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

/**
 * The checks that read a value through the projection — and so the only ones a
 * page sentinel (`document`, which names `<html>`) can be the operand of.
 */
const PROJECTED_CHECKS: ReadonlySet<AssertionType> = new Set<AssertionType>([
  'attribute',
  'cssProperty',
  'cssPropertyInSet',
  'cssPropertyRange',
  'tokenCompliance',
]);

/**
 * Every type the executor checks. A `Record` over the union, so a type added to
 * `AssertionType` without a key here fails to compile. A request whose `type`
 * is not a key compares nothing: it is refused before dispatch, unmeasured.
 */
const ASSERTION_TYPES: Readonly<Record<AssertionType, true>> = {
  visible: true,
  hidden: true,
  enabled: true,
  disabled: true,
  focused: true,
  checked: true,
  unchecked: true,
  hasText: true,
  containsText: true,
  hasValue: true,
  hasClass: true,
  exists: true,
  notExists: true,
  count: true,
  attribute: true,
  cssProperty: true,
  cssPropertyInSet: true,
  cssPropertyRange: true,
  tokenCompliance: true,
  noOverlap: true,
  minSpacing: true,
};

/** The checks that compare the target with a second element, `relatedTarget`. */
const SPATIAL_CHECKS: ReadonlySet<AssertionType> = new Set<AssertionType>([
  'noOverlap',
  'minSpacing',
]);

/**
 * The `relatedTarget` a spatial check compares with, or `undefined` when the
 * request names none: absent, blank, or not an element id, description or
 * search criteria. Searching for `undefined` searches with empty criteria, so
 * it compared the target with an arbitrary element, or with none.
 */
function namedRelatedTarget(request: AssertionRequest): string | SearchCriteria | undefined {
  const related: unknown = request.relatedTarget;
  if (typeof related === 'string') return related.trim() === '' ? undefined : related;
  if (typeof related === 'object' && related !== null && !Array.isArray(related)) {
    return related as SearchCriteria;
  }
  return undefined;
}

/**
 * Why `request` names nothing a check could compare, or `null` when it is
 * well-formed: a `type` the executor does not know, or a spatial check with no
 * `relatedTarget`. Checked before dispatch, so the answer is the same whether
 * or not the target resolves — the request itself is what is wrong.
 */
function invalidRequest(request: AssertionRequest): UnmeasuredRead | null {
  const type: unknown = request.type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(ASSERTION_TYPES, type)) {
    return {
      code: 'no_expectation',
      detail:
        `the assertion's \`type\` ${JSON.stringify(type) ?? String(type)} is not one of ` +
        Object.keys(ASSERTION_TYPES).join(', '),
      failureCode: 'UB-VALIDATION-ERROR',
    };
  }
  if (SPATIAL_CHECKS.has(type as AssertionType) && namedRelatedTarget(request) === undefined) {
    return {
      code: 'no_expectation',
      detail: `the assertion names no \`relatedTarget\`: a ${type} check compares the target with it`,
      failureCode: 'UB-VALIDATION-ERROR',
    };
  }
  return null;
}

/**
 * A spatial check whose operand has no layout rect: there is no geometry to
 * compare, so the check is unmeasured, not a failure of the page.
 */
function rectMissing(which: string): UnmeasuredRead {
  return {
    code: 'input_missing',
    detail: `no layout rect for ${which}, so there is no geometry to compare`,
    failureCode: UNKNOWN_CODE_DIAGNOSTICS.input_missing,
  };
}

/** `background-color` → `backgroundColor`: the key `ElementState.computedStyles` uses. */
function computedStylesKey(cssName: string): string {
  return cssName.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * The read of a value §4.6 withheld: the element sits in a `data-bridge-redact`
 * boundary and `what` can carry page content, so the read holds the redaction
 * sentinel (or nothing), not the page's value. Comparing it would report the
 * page as failing a check nobody could measure, with `actual: "[REDACTED]"`.
 * The policy withheld the comparison: `not_attempted_by_policy`.
 */
function withheldByRedaction(what: string): UnmeasuredRead {
  return {
    code: 'not_attempted_by_policy',
    detail:
      `the element sits in a \`data-bridge-redact\` boundary, and ${what} can carry page ` +
      'content, so §4.6 withholds its value',
    failureCode: UNKNOWN_CODE_DIAGNOSTICS.not_attempted_by_policy,
  };
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
  /** The node behind an operand that is no registered element: a page sentinel's `<html>`. */
  private operandNodes = new WeakMap<AIDiscoveredElement, Element>();

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

    // A request that names nothing to compare is refused before dispatch, the
    // same whether or not its target resolves: unmeasured, never a failure.
    const invalid = invalidRequest(request);
    if (invalid) return this.invalidResult(request, invalid, startTime);

    // The `document` page sentinel names `<html>`, which has no registration:
    // a style or attribute check reads it through the projection.
    const page = this.pageSentinelOperand(request);
    if (page) {
      return this.withFailureCode(
        await this.executeAssertion(request, page, timeout, startTime),
        request.type
      );
    }

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
   * The operand for a check whose target is a `read` page sentinel
   * (`document` → `<html>`, `core/page-sentinel.ts`), or `null`. Only the
   * checks that read through the projection take one.
   *
   * A target here is a search, not an id, so the sentinel yields to whatever
   * that search resolves: an element whose id, label or text matches —
   * `Document` finds a link labelled "Documents" — is the operand, as it was
   * before the sentinel existed. `<html>` answers only a target that resolves
   * to no element at all.
   */
  private pageSentinelOperand(request: AssertionRequest): AIDiscoveredElement | null {
    const target = request.target;
    if (!PROJECTED_CHECKS.has(request.type) || typeof target !== 'string') return null;
    const node = resolvePageSentinel(target, 'read');
    if (!node) return null;
    if (this.findElementDetailed(target, false)) return null;
    const operand = {
      id: target,
      type: 'document',
      tagName: 'html',
      actions: [],
      registered: false,
      description: trustDeveloperContent('the page (<html>)'),
      aliases: [],
      suggestedActions: [],
    } as unknown as AIDiscoveredElement;
    this.operandNodes.set(operand, node);
    return operand;
  }

  /**
   * Ensure a failed assertion result carries a stable `UB-ASSERT-*` code
   * (plan Phase 1 — required whenever `passed: false`). Passing results are
   * returned unchanged. Idempotent: an already-set `failureCode` is kept.
   */
  private withFailureCode(result: AssertionResult, type: AssertionType): AssertionResult {
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
        // `failedCount` counts every result that did not pass, an unmeasured
        // one included; `unmeasuredCount` says how many of those could not
        // read the value they judge. A subset, never a second tally.
        failedCount++;
        if (result.outcome === 'unmeasured') unmeasuredCount++;

        // Stop on the first result that keeps an 'all' batch from passing.
        if (request.stopOnFailure) {
          // Mark remaining assertions as skipped
          break;
        }
      }
    }

    // Determine overall pass/fail. An unmeasured check is in `failedCount`, so
    // it never passes an 'all' batch: what could not be read was not shown to
    // hold.
    const passed = request.mode === 'all' ? failedCount === 0 : passedCount > 0;

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
          request.expected,
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
        const related = namedRelatedTarget(request);
        if (related === undefined)
          return this.invalidResult(request, invalidRequest(request)!, startTime);
        const relatedResult = this.findElementDetailed(related, request.fuzzy !== false);
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
          return this.unmeasuredResult(
            element!,
            elementDescription,
            'no overlap',
            'no overlap',
            rectMissing(!rectA ? 'the target' : 'the related target'),
            startTime,
            'Assert against elements that are laid out (a rendered element has a rect)'
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
        const related = namedRelatedTarget(request);
        if (related === undefined)
          return this.invalidResult(request, invalidRequest(request)!, startTime);
        const relatedResult2 = this.findElementDetailed(related, request.fuzzy !== false);
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
          return this.unmeasuredResult(
            element!,
            elementDescription,
            `min gap ${request.minGap ?? 0}px`,
            'min spacing',
            rectMissing(!rA ? 'the target' : 'the related target'),
            startTime,
            'Assert against elements that are laid out (a rendered element has a rect)'
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
        // Refused before dispatch (`invalidRequest`); kept so an unknown type
        // can never fall through to a comparison.
        return this.invalidResult(
          request,
          invalidRequest(request) ?? {
            code: 'no_expectation',
            detail: `the executor has no check for \`type\` ${String(request.type)}`,
            failureCode: 'UB-VALIDATION-ERROR',
          },
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
   * `placeholder` is not on the projection's allow-list: `readPlaceholder`
   * reads it off the live node, UNMEASURED by policy inside a redaction
   * boundary (§4.6), and unmeasured, never compared with nothing, when there is
   * no node in the document to read it from. Every other name is read through
   * the request-scoped projection (`core/element-projection.ts`) off the
   * element's live node — the same allow-list and the same scrub as
   * `/control/find`'s `attributes` — so an absent attribute is a measured
   * `null`, and a name the projection refuses or cannot read, or a value it
   * scrubbed, makes the check UNMEASURED, never a failure with no value or with
   * the sentinel as its value.
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
      const read = this.readPlaceholder(element);
      if ('unmeasured' in read) {
        return this.unmeasuredResult(
          element,
          description,
          expectedValue,
          'attribute "placeholder"',
          read.unmeasured,
          startTime
        );
      }
      actualValue = read.value;
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
   * Assert element has CSS class (`expected`, one class token).
   *
   * The class list is read off the element's live node, by the rules
   * {@link readLiveNode} applies: withheld by policy inside a redaction
   * boundary (§4.6 — `class` is not one of the structural attributes the
   * scrub keeps), unmeasured with no node to read (an element that crossed a
   * wire) or a node out of the document. A request naming no class compares
   * nothing: unmeasured, `UB-VALIDATION-ERROR`.
   */
  private assertHasClass(
    element: AIDiscoveredElement,
    className: unknown,
    description: string,
    message?: string,
    startTime: number = performance.now()
  ): AssertionResult {
    const wanted = typeof className === 'string' ? className.trim() : '';
    if (wanted === '' || /\s/.test(wanted)) {
      return this.unmeasuredResult(
        element,
        description,
        className,
        'CSS class',
        {
          code: 'no_expectation',
          detail: 'the assertion names no single class in `expected`',
          failureCode: 'UB-VALIDATION-ERROR',
        },
        startTime,
        'Name one class token in `expected` (e.g. "btn-primary")'
      );
    }
    const read = this.readLiveNode(element, 'class list', (node) => node.getAttribute('class'));
    if ('unmeasured' in read) {
      return this.unmeasuredResult(
        element,
        description,
        wanted,
        `CSS class "${wanted}"`,
        read.unmeasured,
        startTime
      );
    }
    const classAttr = read.value ?? '';
    const passed = classAttr.split(/\s+/).includes(wanted);
    return this.createResult(
      passed,
      element.id,
      description,
      wanted,
      classAttr,
      passed
        ? undefined
        : message || `Element's classes are "${classAttr}" but expected class "${wanted}"`,
      undefined,
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
   * back UNMEASURED with its code — never as `''`. So does a value §4.6
   * withheld (`not_attempted_by_policy`): one the projection reports in
   * `redacted`, or the search projection's `title` of a content-redacted
   * element, which it drops. The sentinel is never judged as the page's value.
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

    const node = this.operandNodes.get(element) ?? this.liveNodes.get(element.id);
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
      // A value the scrub replaced is the sentinel, not the page's: the
      // projection names it, so it is never read here as measured.
      if (projection.redacted?.some((r) => r.kind === kind && r.name === name)) {
        return { unmeasured: withheldByRedaction(`${kind} \`${name}\``) };
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
    } else if (name.toLowerCase() === 'title') {
      // The search projection drops a content-redacted element's title.
      if (this.contentRedacted(element)) {
        return { unmeasured: withheldByRedaction('attribute `title`') };
      }
      if (typeof element.title === 'string') return { value: element.title };
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
   * The `placeholder` an attribute check judges. It is not on the projection's
   * allow-list, so it is read here by the projection's rules for an attribute:
   * withheld by policy inside a redaction boundary (§4.6), read off the live
   * node (so an absent placeholder is a measured `null`), and not read off a
   * node out of the document, which can no longer see the boundary it sat in.
   * An element with no node (one that crossed a wire) has nothing to read it
   * from, and its search projection carries none, so the check is UNMEASURED
   * rather than judged against `undefined`.
   */
  private readPlaceholder(
    element: AIDiscoveredElement
  ): { value: string | null } | { unmeasured: UnmeasuredRead } {
    return this.readLiveNode(element, 'attribute `placeholder`', readPlaceholderAttr);
  }

  /**
   * Read `what` off `element`'s live node with `read`, by the projection's
   * rules for a value that can carry page content: withheld by policy inside a
   * redaction boundary (§4.6), unmeasured with no node to read it from (an
   * element that crossed a wire), and unmeasured off a node out of the
   * document, which can no longer see the boundary it sat in.
   */
  private readLiveNode<T>(
    element: AIDiscoveredElement,
    what: string,
    read: (node: Element) => T
  ): { value: T } | { unmeasured: UnmeasuredRead } {
    if (this.contentRedacted(element)) {
      return { unmeasured: withheldByRedaction(what) };
    }
    const node = this.operandNodes.get(element) ?? this.liveNodes.get(element.id);
    if (!node) {
      return {
        unmeasured: {
          code: 'capability_unavailable_in_build',
          detail: `${what} not available: this element has no live DOM node to read it from`,
          failureCode: UNKNOWN_CODE_DIAGNOSTICS.capability_unavailable_in_build,
        },
      };
    }
    if (!node.isConnected) {
      return {
        unmeasured: {
          code: 'input_missing',
          detail:
            'the element is not in the document, so the redaction boundary it sat in cannot be seen from it',
          failureCode: UNKNOWN_CODE_DIAGNOSTICS.input_missing,
        },
      };
    }
    return { value: read(node) };
  }

  /**
   * The §4.6 CONTENT verdict of `element`: off its live node when it has one,
   * else off the `redaction` provenance its state was stamped with (an element
   * that crossed a wire) — never by matching the sentinel string.
   */
  private contentRedacted(element: AIDiscoveredElement): boolean {
    const node = this.operandNodes.get(element) ?? this.liveNodes.get(element.id);
    if (node) return verdictOf(node as HTMLElement).content;
    return element.state ? verdictFromState(element.state).content : false;
  }

  /**
   * The result of a check that could not read its value: `outcome:
   * 'unmeasured'`, `passed: false` (it never passes a gate), no `actual`, and
   * the code that says why — never a failure with `actual: ''`.
   */
  private unmeasuredResult(
    element: { id: string; state?: ElementState },
    description: string,
    expected: unknown,
    what: string,
    unmeasured: UnmeasuredRead,
    startTime: number,
    suggestion?: string
  ): AssertionResult {
    const result = this.createResult(
      false,
      element.id,
      description,
      expected,
      undefined,
      `Cannot check ${what}: ${unmeasured.detail}`,
      suggestion ??
        (unmeasured.failureCode === 'UB-VALIDATION-ERROR'
          ? 'Name a CSS property or an allow-listed attribute (lang, dir, id, role, title, alt, href, aria-*)'
          : unmeasured.code === 'not_attempted_by_policy'
            ? 'The page withholds this value (§4.6 data-bridge-redact): check a structural value — a colour, a length, an ARIA token — or an element outside the boundary'
            : 'The value could not be read here: assert against an element with a live DOM node'),
      startTime,
      element.state
    );
    result.outcome = 'unmeasured';
    result.unmeasured = { code: unmeasured.code, detail: unmeasured.detail };
    result.failureCode = unmeasured.failureCode;
    return result;
  }

  /**
   * The answer to a request {@link invalidRequest} refuses: unmeasured,
   * `UB-VALIDATION-ERROR`, with no operand — nothing was compared, so no
   * element was looked at. In a batch it is one result among the others.
   */
  private invalidResult(
    request: AssertionRequest,
    invalid: UnmeasuredRead,
    startTime: number
  ): AssertionResult {
    const target =
      typeof request.target === 'string' ? request.target : JSON.stringify(request.target);
    return this.unmeasuredResult(
      { id: target },
      target,
      request.expected,
      `${JSON.stringify(request.type) ?? String(request.type)} assertion`,
      invalid,
      startTime,
      `Send a \`type\` from: ${Object.keys(ASSERTION_TYPES).join(', ')}; noOverlap and minSpacing also need a \`relatedTarget\``
    );
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
