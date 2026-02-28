/**
 * Style Validator Tests
 *
 * Tests for resolveTokenValue, evaluateConstraint, validateElement, and runStyleAudit.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveTokenValue,
  evaluateConstraint,
  validateElement,
  runStyleAudit,
} from '../style-validator';
import type { DesignTokens, StyleConstraint, StyleRule, StyleGuideConfig } from '../style-types';
import type { ElementDesignData, ExtendedComputedStyles } from '../../core/types';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockTokens(overrides: Partial<DesignTokens> = {}): DesignTokens {
  return {
    colors: {
      primary: '#3b82f6',
      secondary: '#6366f1',
      error: '#ef4444',
      white: '#ffffff',
      black: '#000000',
    },
    typography: {
      fontFamilies: {
        sans: 'Inter, sans-serif',
        mono: '"Fira Code", monospace',
      },
      fontSizes: {
        sm: '14px',
        md: '16px',
        lg: '18px',
        xl: '24px',
      },
      fontWeights: {
        normal: '400',
        bold: '700',
      },
      lineHeights: {
        tight: '1.25',
        normal: '1.5',
        relaxed: '1.75',
      },
      letterSpacings: {
        tight: '-0.025em',
        normal: '0',
        wide: '0.05em',
      },
    },
    spacing: {
      xs: '4px',
      sm: '8px',
      md: '16px',
      lg: '24px',
      xl: '32px',
    },
    borderRadius: {
      sm: '4px',
      md: '8px',
      lg: '12px',
      full: '9999px',
    },
    shadows: {
      sm: '0 1px 2px rgba(0,0,0,0.05)',
      md: '0 4px 6px rgba(0,0,0,0.1)',
    },
    breakpoints: {
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
    },
    ...overrides,
  };
}

function createMockStyles(overrides: Partial<ExtendedComputedStyles> = {}): ExtendedComputedStyles {
  return {
    display: 'flex',
    position: 'relative',
    boxSizing: 'border-box',
    width: '200px',
    height: '40px',
    minWidth: '0px',
    maxWidth: 'none',
    minHeight: '0px',
    maxHeight: 'none',
    margin: '0px',
    marginTop: '0px',
    marginRight: '0px',
    marginBottom: '0px',
    marginLeft: '0px',
    padding: '8px 16px',
    paddingTop: '8px',
    paddingRight: '16px',
    paddingBottom: '8px',
    paddingLeft: '16px',
    overflow: 'visible',
    overflowX: 'visible',
    overflowY: 'visible',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'auto',
    gap: '0px',
    gridTemplateColumns: 'none',
    gridTemplateRows: 'none',
    fontFamily: 'Inter, sans-serif',
    fontSize: '16px',
    fontWeight: '700',
    lineHeight: '1.5',
    letterSpacing: '0',
    textAlign: 'center',
    textTransform: 'none',
    textDecoration: 'none',
    color: '#3b82f6',
    backgroundColor: '#ffffff',
    backgroundImage: 'none',
    border: '1px solid #3b82f6',
    borderRadius: '8px',
    boxShadow: 'none',
    opacity: '1',
    outline: 'none',
    transform: 'none',
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    zIndex: 'auto',
    visibility: 'visible',
    pointerEvents: 'auto',
    ...overrides,
  };
}

function createMockElementDesignData(
  id: string,
  type: string,
  styleOverrides: Partial<ExtendedComputedStyles> = {}
): ElementDesignData {
  return {
    elementId: id,
    label: `Mock ${type}`,
    type,
    styles: createMockStyles(styleOverrides),
    rect: { x: 0, y: 0, width: 200, height: 40 },
  };
}

// ============================================================================
// resolveTokenValue
// ============================================================================

describe('resolveTokenValue', () => {
  const tokens = createMockTokens();

  it('resolves a top-level token path', () => {
    expect(resolveTokenValue('colors.primary', tokens)).toBe('#3b82f6');
  });

  it('resolves a deeply nested token path', () => {
    expect(resolveTokenValue('typography.fontSizes.lg', tokens)).toBe('18px');
  });

  it('resolves another deeply nested token path', () => {
    expect(resolveTokenValue('typography.fontFamilies.sans', tokens)).toBe('Inter, sans-serif');
  });

  it('resolves spacing tokens', () => {
    expect(resolveTokenValue('spacing.md', tokens)).toBe('16px');
  });

  it('resolves borderRadius tokens', () => {
    expect(resolveTokenValue('borderRadius.full', tokens)).toBe('9999px');
  });

  it('returns null for missing top-level key', () => {
    expect(resolveTokenValue('nonexistent.foo', tokens)).toBeNull();
  });

  it('returns null for missing nested key', () => {
    expect(resolveTokenValue('colors.tertiary', tokens)).toBeNull();
  });

  it('returns null for deeply missing nested key', () => {
    expect(resolveTokenValue('typography.fontSizes.xxl', tokens)).toBeNull();
  });

  it('returns null for empty path', () => {
    expect(resolveTokenValue('', tokens)).toBeNull();
  });

  it('returns null when path resolves to an object (not a leaf value)', () => {
    // "typography.fontSizes" resolves to a Record, not a string or number
    expect(resolveTokenValue('typography.fontSizes', tokens)).toBeNull();
  });

  it('converts numeric values to strings', () => {
    // breakpoints are numbers
    expect(resolveTokenValue('breakpoints.sm', tokens)).toBe('640');
    expect(resolveTokenValue('breakpoints.lg', tokens)).toBe('1024');
  });

  it('returns null when traversal encounters a non-object', () => {
    // "colors.primary.deep" - colors.primary is a string, cannot descend further
    expect(resolveTokenValue('colors.primary.deep', tokens)).toBeNull();
  });
});

// ============================================================================
// evaluateConstraint
// ============================================================================

describe('evaluateConstraint', () => {
  const tokens = createMockTokens();

  describe('exact constraint', () => {
    it('passes when value exactly matches', () => {
      const styles = createMockStyles({ fontSize: '16px' });
      const constraint: StyleConstraint = {
        type: 'exact',
        property: 'fontSize',
        value: '16px',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('passes when match is case-insensitive', () => {
      const styles = createMockStyles({ color: 'Red' });
      const constraint: StyleConstraint = {
        type: 'exact',
        property: 'color',
        value: 'red',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('passes when match ignores leading/trailing whitespace', () => {
      const styles = createMockStyles({ fontFamily: '  Inter, sans-serif  ' });
      const constraint: StyleConstraint = {
        type: 'exact',
        property: 'fontFamily',
        value: 'Inter, sans-serif',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('fails when value does not match', () => {
      const styles = createMockStyles({ fontSize: '14px' });
      const constraint: StyleConstraint = {
        type: 'exact',
        property: 'fontSize',
        value: '16px',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe('14px');
      expect(result.expectedValue).toBe('16px');
      expect(result.message).toContain('fontSize');
      expect(result.message).toContain('16px');
      expect(result.message).toContain('14px');
    });

    it('uses empty string as actual value when property is missing/falsy', () => {
      // ExtendedComputedStyles has all fields as string, but an empty string
      // is falsy and the code uses `|| ''`
      const styles = createMockStyles({ zIndex: '' });
      const constraint: StyleConstraint = {
        type: 'exact',
        property: 'zIndex',
        value: '1',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe('');
    });
  });

  describe('oneOf constraint', () => {
    it('passes when value is in allowed list', () => {
      const styles = createMockStyles({ display: 'flex' });
      const constraint: StyleConstraint = {
        type: 'oneOf',
        property: 'display',
        values: ['block', 'flex', 'grid'],
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('passes with case-insensitive matching', () => {
      const styles = createMockStyles({ textTransform: 'Uppercase' });
      const constraint: StyleConstraint = {
        type: 'oneOf',
        property: 'textTransform',
        values: ['none', 'uppercase', 'lowercase'],
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('fails when value is not in allowed list', () => {
      const styles = createMockStyles({ display: 'inline' });
      const constraint: StyleConstraint = {
        type: 'oneOf',
        property: 'display',
        values: ['block', 'flex', 'grid'],
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe('inline');
      expect(result.expectedValue).toContain('block');
      expect(result.expectedValue).toContain('flex');
      expect(result.expectedValue).toContain('grid');
      expect(result.message).toContain('one of');
    });

    it('fails when values list is empty', () => {
      const styles = createMockStyles({ display: 'flex' });
      const constraint: StyleConstraint = {
        type: 'oneOf',
        property: 'display',
        values: [],
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
    });
  });

  describe('tokenRef constraint', () => {
    it('passes when actual value matches the resolved token', () => {
      const styles = createMockStyles({ color: '#3b82f6' });
      const constraint: StyleConstraint = {
        type: 'tokenRef',
        property: 'color',
        tokenPath: 'colors.primary',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
      expect(result.expectedValue).toContain('#3b82f6');
      expect(result.expectedValue).toContain('colors.primary');
    });

    it('passes with case-insensitive matching for token values', () => {
      const styles = createMockStyles({ color: '#3B82F6' });
      const constraint: StyleConstraint = {
        type: 'tokenRef',
        property: 'color',
        tokenPath: 'colors.primary',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('fails when actual value does not match token', () => {
      const styles = createMockStyles({ color: '#ef4444' });
      const constraint: StyleConstraint = {
        type: 'tokenRef',
        property: 'color',
        tokenPath: 'colors.primary',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe('#ef4444');
      expect(result.message).toContain('colors.primary');
      expect(result.message).toContain('#3b82f6');
    });

    it('fails when token path does not exist', () => {
      const styles = createMockStyles({ color: '#3b82f6' });
      const constraint: StyleConstraint = {
        type: 'tokenRef',
        property: 'color',
        tokenPath: 'colors.nonexistent',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('not found');
      expect(result.message).toContain('colors.nonexistent');
    });

    it('matches resolved nested token (typography.fontSizes.lg)', () => {
      const styles = createMockStyles({ fontSize: '18px' });
      const constraint: StyleConstraint = {
        type: 'tokenRef',
        property: 'fontSize',
        tokenPath: 'typography.fontSizes.lg',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });
  });

  describe('range constraint', () => {
    it('passes when numeric value is within range', () => {
      const styles = createMockStyles({ fontSize: '16px' });
      const constraint: StyleConstraint = {
        type: 'range',
        property: 'fontSize',
        min: 12,
        max: 24,
        unit: 'px',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('passes when value equals the min boundary', () => {
      const styles = createMockStyles({ fontSize: '12px' });
      const constraint: StyleConstraint = {
        type: 'range',
        property: 'fontSize',
        min: 12,
        max: 24,
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('passes when value equals the max boundary', () => {
      const styles = createMockStyles({ fontSize: '24px' });
      const constraint: StyleConstraint = {
        type: 'range',
        property: 'fontSize',
        min: 12,
        max: 24,
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('passes with only min specified', () => {
      const styles = createMockStyles({ opacity: '0.5' });
      const constraint: StyleConstraint = {
        type: 'range',
        property: 'opacity',
        min: 0,
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('passes with only max specified', () => {
      const styles = createMockStyles({ opacity: '0.8' });
      const constraint: StyleConstraint = {
        type: 'range',
        property: 'opacity',
        max: 1,
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('fails when value is below min', () => {
      const styles = createMockStyles({ fontSize: '10px' });
      const constraint: StyleConstraint = {
        type: 'range',
        property: 'fontSize',
        min: 12,
        max: 24,
        unit: 'px',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('range');
      expect(result.message).toContain('10');
    });

    it('fails when value is above max', () => {
      const styles = createMockStyles({ fontSize: '30px' });
      const constraint: StyleConstraint = {
        type: 'range',
        property: 'fontSize',
        min: 12,
        max: 24,
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
    });

    it('fails when value is not parseable as a number', () => {
      const styles = createMockStyles({ fontSize: 'auto' });
      const constraint: StyleConstraint = {
        type: 'range',
        property: 'fontSize',
        min: 12,
        max: 24,
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Cannot parse');
      expect(result.message).toContain('auto');
    });

    it('includes unit in expectedValue when provided', () => {
      const styles = createMockStyles({ fontSize: '16px' });
      const constraint: StyleConstraint = {
        type: 'range',
        property: 'fontSize',
        min: 12,
        max: 24,
        unit: 'px',
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.expectedValue).toContain('px');
    });
  });

  describe('responsive constraint', () => {
    it('passes when value matches the first breakpoint string value', () => {
      const styles = createMockStyles({ fontSize: '14px' });
      const constraint: StyleConstraint = {
        type: 'responsive',
        property: 'fontSize',
        breakpoints: {
          sm: '14px',
          md: '16px',
          lg: '18px',
        },
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
      expect(result.expectedValue).toContain('14px');
      expect(result.expectedValue).toContain('sm');
    });

    it('fails when value does not match the first breakpoint', () => {
      const styles = createMockStyles({ fontSize: '20px' });
      const constraint: StyleConstraint = {
        type: 'responsive',
        property: 'fontSize',
        breakpoints: {
          sm: '14px',
          md: '16px',
          lg: '18px',
        },
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('14px');
      expect(result.message).toContain('sm');
    });

    it('delegates to nested constraint when breakpoint value is a constraint', () => {
      const styles = createMockStyles({ fontSize: '16px' });
      const constraint: StyleConstraint = {
        type: 'responsive',
        property: 'fontSize',
        breakpoints: {
          sm: {
            type: 'range',
            property: 'fontSize',
            min: 12,
            max: 20,
          },
        },
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });

    it('fails when nested constraint fails', () => {
      const styles = createMockStyles({ fontSize: '30px' });
      const constraint: StyleConstraint = {
        type: 'responsive',
        property: 'fontSize',
        breakpoints: {
          sm: {
            type: 'range',
            property: 'fontSize',
            min: 12,
            max: 20,
          },
        },
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(false);
    });

    it('handles case-insensitive match on first breakpoint string', () => {
      const styles = createMockStyles({ textAlign: 'Center' });
      const constraint: StyleConstraint = {
        type: 'responsive',
        property: 'textAlign',
        breakpoints: {
          sm: 'center',
          lg: 'left',
        },
      };
      const result = evaluateConstraint(constraint, styles, tokens);
      expect(result.passed).toBe(true);
    });
  });
});

// ============================================================================
// validateElement
// ============================================================================

describe('validateElement', () => {
  const tokens = createMockTokens();

  describe('rule matching by elementType', () => {
    it('matches rule when elementType matches element type', () => {
      const element = createMockElementDesignData('btn-1', 'button', { fontSize: '16px' });
      const rules: StyleRule[] = [
        {
          id: 'btn-font-size',
          elementType: 'button',
          constraints: [{ type: 'exact', property: 'fontSize', value: '16px' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
      expect(results[0].ruleId).toBe('btn-font-size');
      expect(results[0].elementId).toBe('btn-1');
    });

    it('skips rule when elementType does not match', () => {
      const element = createMockElementDesignData('input-1', 'input');
      const rules: StyleRule[] = [
        {
          id: 'btn-font-size',
          elementType: 'button',
          constraints: [{ type: 'exact', property: 'fontSize', value: '16px' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(0);
    });
  });

  describe('rule matching by selector', () => {
    it('matches class selector when element ID contains the class name', () => {
      const element = createMockElementDesignData('primary-btn', 'button');
      const rules: StyleRule[] = [
        {
          id: 'primary-rule',
          selector: '.primary',
          constraints: [{ type: 'exact', property: 'display', value: 'flex' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it('skips class selector when element ID does not contain the class name', () => {
      const element = createMockElementDesignData('secondary-btn', 'button');
      const rules: StyleRule[] = [
        {
          id: 'primary-rule',
          selector: '.primary',
          constraints: [{ type: 'exact', property: 'display', value: 'flex' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(0);
    });

    it('matches ID selector when element ID exactly matches (after #)', () => {
      const element = createMockElementDesignData('main-header', 'custom');
      const rules: StyleRule[] = [
        {
          id: 'header-rule',
          selector: '#main-header',
          constraints: [{ type: 'exact', property: 'display', value: 'flex' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(1);
    });

    it('skips ID selector when element ID does not match', () => {
      const element = createMockElementDesignData('side-header', 'custom');
      const rules: StyleRule[] = [
        {
          id: 'header-rule',
          selector: '#main-header',
          constraints: [{ type: 'exact', property: 'display', value: 'flex' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(0);
    });

    it('matches plain tag selector against element type', () => {
      const element = createMockElementDesignData('btn-submit', 'button');
      const rules: StyleRule[] = [
        {
          id: 'tag-rule',
          selector: 'button',
          constraints: [{ type: 'exact', property: 'cursor', value: 'pointer' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it('skips plain tag selector when element type does not match', () => {
      const element = createMockElementDesignData('some-input', 'input');
      const rules: StyleRule[] = [
        {
          id: 'tag-rule',
          selector: 'button',
          constraints: [{ type: 'exact', property: 'cursor', value: 'pointer' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(0);
    });
  });

  describe('rule matching with both elementType and selector', () => {
    it('requires both elementType and selector to match', () => {
      const element = createMockElementDesignData('primary-btn', 'button');
      const rules: StyleRule[] = [
        {
          id: 'both-rule',
          elementType: 'button',
          selector: '.primary',
          constraints: [{ type: 'exact', property: 'display', value: 'flex' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(1);
    });

    it('skips when elementType matches but selector does not', () => {
      const element = createMockElementDesignData('secondary-btn', 'button');
      const rules: StyleRule[] = [
        {
          id: 'both-rule',
          elementType: 'button',
          selector: '.primary',
          constraints: [{ type: 'exact', property: 'display', value: 'flex' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(0);
    });
  });

  describe('rule with no elementType and no selector (matches all)', () => {
    it('matches any element when neither elementType nor selector is specified', () => {
      const element = createMockElementDesignData('anything', 'custom');
      const rules: StyleRule[] = [
        {
          id: 'global-rule',
          constraints: [{ type: 'exact', property: 'boxSizing', value: 'border-box' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });
  });

  describe('multiple constraints in a rule', () => {
    it('passes when all constraints pass', () => {
      const element = createMockElementDesignData('btn-1', 'button', {
        fontSize: '16px',
        fontWeight: '700',
      });
      const rules: StyleRule[] = [
        {
          id: 'multi-constraint',
          elementType: 'button',
          constraints: [
            { type: 'exact', property: 'fontSize', value: '16px' },
            { type: 'exact', property: 'fontWeight', value: '700' },
          ],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
      expect(results[0].constraintResults).toHaveLength(2);
      expect(results[0].constraintResults[0].passed).toBe(true);
      expect(results[0].constraintResults[1].passed).toBe(true);
    });

    it('fails when any constraint fails', () => {
      const element = createMockElementDesignData('btn-1', 'button', {
        fontSize: '14px',
        fontWeight: '700',
      });
      const rules: StyleRule[] = [
        {
          id: 'multi-constraint',
          elementType: 'button',
          constraints: [
            { type: 'exact', property: 'fontSize', value: '16px' },
            { type: 'exact', property: 'fontWeight', value: '700' },
          ],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].constraintResults[0].passed).toBe(false);
      expect(results[0].constraintResults[1].passed).toBe(true);
    });
  });

  describe('severity', () => {
    it('uses the rule severity when provided', () => {
      const element = createMockElementDesignData('btn-1', 'button');
      const rules: StyleRule[] = [
        {
          id: 'error-rule',
          elementType: 'button',
          severity: 'error',
          constraints: [{ type: 'exact', property: 'fontSize', value: '99px' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results[0].severity).toBe('error');
    });

    it('defaults severity to warning when not provided', () => {
      const element = createMockElementDesignData('btn-1', 'button');
      const rules: StyleRule[] = [
        {
          id: 'no-sev-rule',
          elementType: 'button',
          constraints: [{ type: 'exact', property: 'fontSize', value: '99px' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results[0].severity).toBe('warning');
    });

    it('uses info severity when specified', () => {
      const element = createMockElementDesignData('btn-1', 'button');
      const rules: StyleRule[] = [
        {
          id: 'info-rule',
          elementType: 'button',
          severity: 'info',
          constraints: [{ type: 'exact', property: 'fontSize', value: '99px' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results[0].severity).toBe('info');
    });
  });

  describe('multiple rules', () => {
    it('returns results for all matching rules', () => {
      const element = createMockElementDesignData('btn-primary', 'button', {
        fontSize: '16px',
        color: '#3b82f6',
      });
      const rules: StyleRule[] = [
        {
          id: 'font-rule',
          elementType: 'button',
          constraints: [{ type: 'exact', property: 'fontSize', value: '16px' }],
        },
        {
          id: 'color-rule',
          selector: '.primary',
          constraints: [{ type: 'tokenRef', property: 'color', tokenPath: 'colors.primary' }],
        },
      ];
      const results = validateElement(element, rules, tokens);
      expect(results).toHaveLength(2);
      expect(results[0].ruleId).toBe('font-rule');
      expect(results[0].passed).toBe(true);
      expect(results[1].ruleId).toBe('color-rule');
      expect(results[1].passed).toBe(true);
    });
  });
});

// ============================================================================
// runStyleAudit
// ============================================================================

describe('runStyleAudit', () => {
  it('produces a correct audit report with passing and failing elements', () => {
    const tokens = createMockTokens();
    const guide: StyleGuideConfig = {
      version: '1.0.0',
      name: 'Test Guide',
      tokens,
      rules: [
        {
          id: 'btn-color',
          elementType: 'button',
          severity: 'error',
          constraints: [{ type: 'tokenRef', property: 'color', tokenPath: 'colors.primary' }],
        },
        {
          id: 'input-font',
          elementType: 'input',
          severity: 'warning',
          constraints: [{ type: 'exact', property: 'fontSize', value: '14px' }],
        },
        {
          id: 'global-box-sizing',
          severity: 'info',
          constraints: [{ type: 'exact', property: 'boxSizing', value: 'border-box' }],
        },
      ],
    };

    const elements: ElementDesignData[] = [
      createMockElementDesignData('btn-1', 'button', { color: '#3b82f6' }),
      createMockElementDesignData('btn-2', 'button', { color: '#ef4444' }),
      createMockElementDesignData('input-1', 'input', { fontSize: '14px' }),
      createMockElementDesignData('input-2', 'input', { fontSize: '18px' }),
    ];

    const report = runStyleAudit(elements, guide);

    expect(report.guideName).toBe('Test Guide');
    expect(report.totalElements).toBe(4);
    expect(report.totalRules).toBe(3);

    // btn-1: btn-color passes, global-box-sizing passes => 2 passes
    // btn-2: btn-color fails, global-box-sizing passes => 1 pass, 1 fail
    // input-1: input-font passes, global-box-sizing passes => 2 passes
    // input-2: input-font fails, global-box-sizing passes => 1 pass, 1 fail
    // Total: 6 passed, 2 failed
    expect(report.passedCount).toBe(6);
    expect(report.failedCount).toBe(2);

    expect(report.results.length).toBe(8);

    // Summary grouping
    expect(report.summary.errors).toHaveLength(1); // btn-2 btn-color
    expect(report.summary.errors[0].elementId).toBe('btn-2');
    expect(report.summary.errors[0].ruleId).toBe('btn-color');

    expect(report.summary.warnings).toHaveLength(1); // input-2 input-font
    expect(report.summary.warnings[0].elementId).toBe('input-2');
    expect(report.summary.warnings[0].ruleId).toBe('input-font');

    expect(report.summary.info).toHaveLength(0); // all global-box-sizing passed

    // Timestamp and duration
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles empty elements list', () => {
    const tokens = createMockTokens();
    const guide: StyleGuideConfig = {
      version: '1.0.0',
      name: 'Empty Guide',
      tokens,
      rules: [
        {
          id: 'some-rule',
          constraints: [{ type: 'exact', property: 'display', value: 'block' }],
        },
      ],
    };

    const report = runStyleAudit([], guide);
    expect(report.totalElements).toBe(0);
    expect(report.totalRules).toBe(1);
    expect(report.passedCount).toBe(0);
    expect(report.failedCount).toBe(0);
    expect(report.results).toHaveLength(0);
    expect(report.summary.errors).toHaveLength(0);
    expect(report.summary.warnings).toHaveLength(0);
    expect(report.summary.info).toHaveLength(0);
  });

  it('handles empty rules list', () => {
    const tokens = createMockTokens();
    const guide: StyleGuideConfig = {
      version: '1.0.0',
      name: 'No Rules Guide',
      tokens,
      rules: [],
    };

    const elements: ElementDesignData[] = [createMockElementDesignData('btn-1', 'button')];

    const report = runStyleAudit(elements, guide);
    expect(report.totalElements).toBe(1);
    expect(report.totalRules).toBe(0);
    expect(report.passedCount).toBe(0);
    expect(report.failedCount).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  it('correctly groups multiple failures by severity in summary', () => {
    const tokens = createMockTokens();
    const guide: StyleGuideConfig = {
      version: '1.0.0',
      name: 'Multi Severity Guide',
      tokens,
      rules: [
        {
          id: 'error-rule',
          severity: 'error',
          constraints: [{ type: 'exact', property: 'display', value: 'NONEXISTENT' }],
        },
        {
          id: 'warning-rule',
          severity: 'warning',
          constraints: [{ type: 'exact', property: 'position', value: 'NONEXISTENT' }],
        },
        {
          id: 'info-rule',
          severity: 'info',
          constraints: [{ type: 'exact', property: 'cursor', value: 'NONEXISTENT' }],
        },
      ],
    };

    const elements: ElementDesignData[] = [
      createMockElementDesignData('el-1', 'custom'),
      createMockElementDesignData('el-2', 'custom'),
    ];

    const report = runStyleAudit(elements, guide);

    // Each element matches all 3 rules, all fail
    expect(report.failedCount).toBe(6);
    expect(report.passedCount).toBe(0);

    expect(report.summary.errors).toHaveLength(2);
    expect(report.summary.warnings).toHaveLength(2);
    expect(report.summary.info).toHaveLength(2);
  });

  it('summary only includes failed results, not passed ones', () => {
    const tokens = createMockTokens();
    const guide: StyleGuideConfig = {
      version: '1.0.0',
      name: 'Mixed Guide',
      tokens,
      rules: [
        {
          id: 'pass-rule',
          severity: 'error',
          constraints: [{ type: 'exact', property: 'display', value: 'flex' }],
        },
        {
          id: 'fail-rule',
          severity: 'error',
          constraints: [{ type: 'exact', property: 'display', value: 'grid' }],
        },
      ],
    };

    const elements: ElementDesignData[] = [
      createMockElementDesignData('el-1', 'custom', { display: 'flex' }),
    ];

    const report = runStyleAudit(elements, guide);
    expect(report.passedCount).toBe(1);
    expect(report.failedCount).toBe(1);

    // Only the failed error result appears in summary
    expect(report.summary.errors).toHaveLength(1);
    expect(report.summary.errors[0].ruleId).toBe('fail-rule');
  });

  it('provides correct guideName from the config', () => {
    const tokens = createMockTokens();
    const guide: StyleGuideConfig = {
      version: '1.0.0',
      name: 'Acme Design System v2',
      tokens,
      rules: [],
    };

    const report = runStyleAudit([], guide);
    expect(report.guideName).toBe('Acme Design System v2');
  });
});
