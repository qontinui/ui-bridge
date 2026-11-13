/**
 * Style Validator Module
 *
 * Validates element design data against a style guide configuration.
 * Resolves design tokens, evaluates constraints, and produces audit reports.
 */

import type { ElementDesignData, ExtendedComputedStyles } from '../core/types';
import { answersToNamedType } from '../core/element-kind';
import type {
  DesignTokens,
  StyleGuideConfig,
  StyleRule,
  StyleConstraint,
  StyleConstraintResult,
  StyleValidationResult,
  StyleAuditReport,
} from './style-types';
import { styleValuesEquivalent } from './style-inference';

// ============================================================================
// Token Resolution
// ============================================================================

/**
 * Resolve a dot-path token reference to its value from design tokens.
 *
 * @param tokenPath - Dot-separated path like "colors.primary" or "typography.fontSizes.lg"
 * @param tokens - The design tokens object
 * @returns The resolved value, or null if not found
 */
export function resolveTokenValue(tokenPath: string, tokens: DesignTokens): string | null {
  const parts = tokenPath.split('.');
  let current: unknown = tokens;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === 'string') {
    return current;
  }
  if (typeof current === 'number') {
    return String(current);
  }
  return null;
}

// ============================================================================
// Constraint Evaluation
// ============================================================================

/**
 * Evaluate a single style constraint against an element's computed styles.
 */
export function evaluateConstraint(
  constraint: StyleConstraint,
  styles: ExtendedComputedStyles,
  tokens: DesignTokens,
  customProperties?: Record<string, string>
): StyleConstraintResult {
  const isCustomProp = constraint.property.startsWith('--');
  const actualValue = isCustomProp
    ? (customProperties?.[constraint.property] ?? '')
    : styles[constraint.property as keyof ExtendedComputedStyles] || '';

  switch (constraint.type) {
    case 'exact': {
      const passed = sameStyleValue(actualValue, constraint.value, constraint.property, styles);
      return {
        passed,
        constraint,
        actualValue,
        expectedValue: constraint.value,
        message: passed
          ? undefined
          : `Expected ${constraint.property} to be "${constraint.value}", got "${actualValue}"`,
      };
    }

    case 'oneOf': {
      const passed = constraint.values.some((v) =>
        sameStyleValue(actualValue, v, constraint.property, styles)
      );
      return {
        passed,
        constraint,
        actualValue,
        expectedValue: `one of [${constraint.values.join(', ')}]`,
        message: passed
          ? undefined
          : `Expected ${constraint.property} to be one of [${constraint.values.join(', ')}], got "${actualValue}"`,
      };
    }

    case 'tokenRef': {
      const tokenValue = resolveTokenValue(constraint.tokenPath, tokens);
      if (tokenValue === null) {
        return {
          passed: false,
          constraint,
          actualValue,
          expectedValue: `token(${constraint.tokenPath})`,
          message: `Token "${constraint.tokenPath}" not found in design tokens`,
        };
      }
      const passed = sameStyleValue(actualValue, tokenValue, constraint.property, styles);
      return {
        passed,
        constraint,
        actualValue,
        expectedValue: `${tokenValue} (token: ${constraint.tokenPath})`,
        message: passed
          ? undefined
          : `Expected ${constraint.property} to match token "${constraint.tokenPath}" (${tokenValue}), got "${actualValue}"`,
      };
    }

    case 'range': {
      const numericValue = parseFloat(actualValue);
      if (isNaN(numericValue)) {
        return {
          passed: false,
          constraint,
          actualValue,
          expectedValue: `${constraint.min ?? '∞'} - ${constraint.max ?? '∞'}${constraint.unit || ''}`,
          message: `Cannot parse "${actualValue}" as a number for range check on ${constraint.property}`,
        };
      }
      const aboveMin = constraint.min === undefined || numericValue >= constraint.min;
      const belowMax = constraint.max === undefined || numericValue <= constraint.max;
      const passed = aboveMin && belowMax;
      return {
        passed,
        constraint,
        actualValue,
        expectedValue: `${constraint.min ?? '∞'} - ${constraint.max ?? '∞'}${constraint.unit || ''}`,
        message: passed
          ? undefined
          : `Expected ${constraint.property} to be in range [${constraint.min ?? '∞'}, ${constraint.max ?? '∞'}], got ${numericValue}`,
      };
    }

    case 'responsive': {
      // For responsive constraints, just check the first breakpoint as a basic validation
      // Full responsive checking is done via captureResponsiveSnapshots
      const firstBreakpoint = Object.keys(constraint.breakpoints)[0];
      const expectedVal = constraint.breakpoints[firstBreakpoint];
      if (typeof expectedVal === 'string') {
        const passed = normalizeStyleValue(actualValue) === normalizeStyleValue(expectedVal);
        return {
          passed,
          constraint,
          actualValue,
          expectedValue: `${expectedVal} (at ${firstBreakpoint})`,
          message: passed
            ? undefined
            : `Expected ${constraint.property} to be "${expectedVal}" at ${firstBreakpoint}, got "${actualValue}"`,
        };
      }
      // Nested constraint
      return evaluateConstraint(expectedVal, styles, tokens, customProperties);
    }
  }
}

// ============================================================================
// Element Validation
// ============================================================================

/**
 * Check if a rule matches an element.
 */
function ruleMatchesElement(rule: StyleRule, elementData: ElementDesignData): boolean {
  // A rule names a type; it applies to the name's whole family (`input` also
  // an ARIA `textbox`, `select` also a `combobox`) — `core/element-kind`.
  if (rule.elementType && !answersToNamedType(elementData.type, rule.elementType)) {
    return false;
  }
  if (rule.selector) {
    // Simple selector matching: check if element ID or type contains the selector pattern
    // Full CSS selector matching would require DOM access
    const id = elementData.elementId.toLowerCase();
    const sel = rule.selector.toLowerCase();
    if (sel.startsWith('.')) {
      const targetClass = sel.slice(1);
      if (elementData.classes) {
        return elementData.classes.some((c) => c.toLowerCase() === targetClass);
      }
      return id.includes(targetClass);
    }
    if (sel.startsWith('#') && id !== sel.slice(1)) {
      return false;
    }
    if (
      !sel.startsWith('.') &&
      !sel.startsWith('#') &&
      !answersToNamedType(elementData.type, sel)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Validate an element's design data against a set of rules.
 */
export function validateElement(
  data: ElementDesignData,
  rules: StyleRule[],
  tokens: DesignTokens
): StyleValidationResult[] {
  const results: StyleValidationResult[] = [];

  for (const rule of rules) {
    if (!ruleMatchesElement(rule, data)) continue;

    const constraintResults: StyleConstraintResult[] = [];
    let allPassed = true;

    for (const constraint of rule.constraints) {
      const result = evaluateConstraint(constraint, data.styles, tokens, data.customProperties);
      constraintResults.push(result);
      if (!result.passed) allPassed = false;
    }

    results.push({
      elementId: data.elementId,
      ruleId: rule.id,
      passed: allPassed,
      constraintResults,
      severity: rule.severity || 'warning',
    });
  }

  return results;
}

// ============================================================================
// Full Audit
// ============================================================================

/**
 * Run a complete style audit against a style guide.
 */
export function runStyleAudit(
  elements: ElementDesignData[],
  guide: StyleGuideConfig
): StyleAuditReport {
  const startTime = Date.now();
  const allResults: StyleValidationResult[] = [];

  for (const element of elements) {
    const results = validateElement(element, guide.rules, guide.tokens);
    allResults.push(...results);
  }

  const passedCount = allResults.filter((r) => r.passed).length;
  const failedCount = allResults.filter((r) => !r.passed).length;

  return {
    guideName: guide.name,
    totalElements: elements.length,
    totalRules: guide.rules.length,
    passedCount,
    failedCount,
    results: allResults,
    summary: {
      errors: allResults.filter((r) => !r.passed && r.severity === 'error'),
      warnings: allResults.filter((r) => !r.passed && r.severity === 'warning'),
      info: allResults.filter((r) => !r.passed && r.severity === 'info'),
    },
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Whether a computed value satisfies an expected one: equal after trimming and
 * lowercasing, or equivalent once both are canonicalised (colours as hex,
 * lengths as px, font-relative line heights and letter spacings as ratios —
 * `styleValuesEquivalent`). Chrome computes colours as `rgb()`, so before the
 * fallback a `tokenRef` to a hex token could never pass.
 */
function sameStyleValue(
  actual: string,
  expected: string,
  property: string,
  styles: ExtendedComputedStyles
): boolean {
  if (normalizeStyleValue(actual) === normalizeStyleValue(expected)) return true;
  // Custom properties are compared literally: their values carry no type.
  if (property.startsWith('--')) return false;
  return styleValuesEquivalent(
    actual,
    expected,
    property,
    styles as unknown as Record<string, string>
  );
}

/**
 * Normalize a CSS value for comparison (trim whitespace, lowercase).
 */
function normalizeStyleValue(value: string): string {
  return value.trim().toLowerCase();
}
