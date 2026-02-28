/**
 * Style Spec Types
 *
 * Type definitions for the design token and style guide system.
 * Used to validate computed styles against project-wide design standards.
 */

import type { QualityContext } from './quality-types';

// ============================================================================
// Design Tokens
// ============================================================================

/**
 * Project-wide design tokens defining the visual language.
 */
export interface DesignTokens {
  /** Named color palette: e.g. { "primary": "#3b82f6", "error": "#ef4444" } */
  colors: Record<string, string>;
  /** Typography scale */
  typography: {
    fontFamilies: Record<string, string>;
    fontSizes: Record<string, string>;
    fontWeights: Record<string, string>;
    lineHeights: Record<string, string>;
    letterSpacings: Record<string, string>;
  };
  /** Spacing scale: e.g. { "sm": "8px", "md": "16px", "lg": "24px" } */
  spacing: Record<string, string>;
  /** Border radius tokens */
  borderRadius: Record<string, string>;
  /** Box shadow tokens */
  shadows: Record<string, string>;
  /** Responsive breakpoints (in px): e.g. { "sm": 640, "md": 768, "lg": 1024 } */
  breakpoints: Record<string, number>;
}

// ============================================================================
// Style Constraints
// ============================================================================

/**
 * A constraint on a CSS property value.
 */
export type StyleConstraint =
  | {
      /** Property must exactly equal this value */
      type: 'exact';
      property: string;
      value: string;
    }
  | {
      /** Property must be one of these allowed values */
      type: 'oneOf';
      property: string;
      values: string[];
    }
  | {
      /** Property must match a named design token */
      type: 'tokenRef';
      property: string;
      /** Dot-path into DesignTokens: e.g. "colors.primary", "typography.fontSizes.lg" */
      tokenPath: string;
    }
  | {
      /** Numeric property value must be within a range */
      type: 'range';
      property: string;
      min?: number;
      max?: number;
      /** Unit for display purposes (e.g. "px", "rem") */
      unit?: string;
    }
  | {
      /** Different expected values per breakpoint */
      type: 'responsive';
      property: string;
      /** Breakpoint name → expected value or constraint */
      breakpoints: Record<string, string | StyleConstraint>;
    };

// ============================================================================
// Style Rules
// ============================================================================

/**
 * A rule targeting specific elements with style constraints.
 */
export interface StyleRule {
  /** Rule identifier */
  id: string;
  /** Human-readable description */
  description?: string;
  /** CSS selector to match elements (evaluated against element type/class) */
  selector?: string;
  /** Element type to match (matches RegisteredElement.type) */
  elementType?: string;
  /** Constraints to validate for matched elements */
  constraints: StyleConstraint[];
  /** Severity of violations */
  severity?: 'error' | 'warning' | 'info';
}

// ============================================================================
// Style Guide Config (file format)
// ============================================================================

/**
 * Style guide configuration file format (.styleguide.uibridge.json)
 */
export interface StyleGuideConfig {
  /** File format version */
  version: string;
  /** Style guide name */
  name: string;
  /** Style guide description */
  description?: string;
  /** Design tokens */
  tokens: DesignTokens;
  /** Validation rules */
  rules: StyleRule[];
  /** Custom quality evaluation contexts */
  qualityContexts?: Record<string, QualityContext>;
  /** Page-specific overrides */
  pageOverrides?: Record<string, Partial<StyleGuideConfig>>;
}

// ============================================================================
// Validation Results
// ============================================================================

/**
 * Result of validating a single constraint
 */
export interface StyleConstraintResult {
  /** Whether the constraint passed */
  passed: boolean;
  /** The constraint that was evaluated */
  constraint: StyleConstraint;
  /** Actual CSS value */
  actualValue: string;
  /** Expected value (resolved) */
  expectedValue: string;
  /** Human-readable failure message */
  message?: string;
}

/**
 * Result of validating all constraints for an element
 */
export interface StyleValidationResult {
  /** Element identifier */
  elementId: string;
  /** Rule that was applied */
  ruleId: string;
  /** Whether all constraints passed */
  passed: boolean;
  /** Individual constraint results */
  constraintResults: StyleConstraintResult[];
  /** Severity from the rule */
  severity: 'error' | 'warning' | 'info';
}

/**
 * Full style audit report
 */
export interface StyleAuditReport {
  /** Style guide name */
  guideName: string;
  /** Total elements audited */
  totalElements: number;
  /** Total rules evaluated */
  totalRules: number;
  /** Number of passed rules */
  passedCount: number;
  /** Number of failed rules */
  failedCount: number;
  /** Validation results for each element */
  results: StyleValidationResult[];
  /** Summary grouped by severity */
  summary: {
    errors: StyleValidationResult[];
    warnings: StyleValidationResult[];
    info: StyleValidationResult[];
  };
  /** Timestamp */
  timestamp: number;
  /** Duration in milliseconds */
  durationMs: number;
}

// ============================================================================
// Constants
// ============================================================================

export const STYLE_GUIDE_FILE_EXTENSION = '.styleguide.uibridge.json';
export const STYLE_GUIDE_VERSION = '1.0.0';
