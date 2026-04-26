import { ag as ElementDesignData } from './types-svkOxfrJ.js';

/**
 * Quality Evaluator Types
 *
 * Type definitions for the holistic UI quality evaluation system.
 * Metrics measure density, spacing, color, typography, and cross-element consistency.
 */

interface ViewportDimensions {
    width: number;
    height: number;
}
type QualityMetricCategory = 'ux' | 'density' | 'spacing' | 'color' | 'typography' | 'consistency';
type QualityMetricId = 'contentOverflow' | 'aboveFoldRatio' | 'informationDensity' | 'containerEfficiency' | 'viewportUtilization' | 'elementDensity' | 'whitespaceRatio' | 'localDensityBalance' | 'horizontalBalance' | 'verticalBalance' | 'alignmentConsistency' | 'spacingScaleAdherence' | 'spacingConsistency' | 'lineHeightRatio' | 'interGroupSpacingRatio' | 'uniqueColorCount' | 'wcagContrastCompliance' | 'colorHarmony' | 'saturationConsistency' | 'typeScaleAdherence' | 'fontWeightConsistency' | 'headingHierarchy' | 'fontFamilyCount' | 'buttonConsistency' | 'cardConsistency' | 'inputConsistency' | 'touchTargetCompliance' | 'customPropertyConsistency';
type MetricFindingSeverity = 'error' | 'warning' | 'info';
interface MetricFinding {
    severity: MetricFindingSeverity;
    message: string;
    recommendation?: string;
    elementIds?: string[];
}
interface MetricResult {
    metricId: QualityMetricId;
    score: number;
    label: string;
    category: QualityMetricCategory;
    enabled: boolean;
    weight: number;
    findings: MetricFinding[];
    rawData?: Record<string, unknown>;
}
interface MetricContextConfig {
    enabled: boolean;
    weight: number;
    thresholds: {
        good: number;
        warning: number;
    };
}
interface QualityContext {
    name: string;
    description: string;
    metrics: Partial<Record<QualityMetricId, MetricContextConfig>>;
}
type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'F';
interface QualityEvaluationReport {
    overallScore: number;
    grade: QualityGrade;
    uxScore: number;
    uxGrade: QualityGrade;
    contextName: string;
    metrics: MetricResult[];
    topIssues: MetricFinding[];
    totalElements: number;
    viewport: ViewportDimensions;
    timestamp: number;
    durationMs: number;
}
interface SnapshotBaseline {
    elements: ElementDesignData[];
    viewport: ViewportDimensions;
    timestamp: number;
    label?: string;
}
interface StyleChange {
    property: string;
    oldValue: string;
    newValue: string;
}
interface LayoutShift {
    dx: number;
    dy: number;
    dWidth: number;
    dHeight: number;
}
interface ElementDiff {
    elementId: string;
    changeType: 'added' | 'removed' | 'modified';
    styleChanges?: StyleChange[];
    layoutShift?: LayoutShift;
}
interface SnapshotDiffReport {
    added: ElementDiff[];
    removed: ElementDiff[];
    modified: ElementDiff[];
    cumulativeLayoutShift: number;
    hasSignificantChanges: boolean;
}
type MetricFunction = (elements: ElementDesignData[], viewport: ViewportDimensions) => MetricResult;
interface EvaluateRequest {
    context?: string;
    customContext?: QualityContext;
    elementIds?: string[];
    viewport?: ViewportDimensions;
}

/**
 * Style Spec Types
 *
 * Type definitions for the design token and style guide system.
 * Used to validate computed styles against project-wide design standards.
 */

/**
 * Project-wide design tokens defining the visual language.
 */
interface DesignTokens {
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
/**
 * A constraint on a CSS property value.
 */
type StyleConstraint = {
    /** Property must exactly equal this value */
    type: 'exact';
    property: string;
    value: string;
} | {
    /** Property must be one of these allowed values */
    type: 'oneOf';
    property: string;
    values: string[];
} | {
    /** Property must match a named design token */
    type: 'tokenRef';
    property: string;
    /** Dot-path into DesignTokens: e.g. "colors.primary", "typography.fontSizes.lg" */
    tokenPath: string;
} | {
    /** Numeric property value must be within a range */
    type: 'range';
    property: string;
    min?: number;
    max?: number;
    /** Unit for display purposes (e.g. "px", "rem") */
    unit?: string;
} | {
    /** Different expected values per breakpoint */
    type: 'responsive';
    property: string;
    /** Breakpoint name → expected value or constraint */
    breakpoints: Record<string, string | StyleConstraint>;
};
/**
 * A rule targeting specific elements with style constraints.
 */
interface StyleRule {
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
/**
 * Style guide configuration file format (.styleguide.uibridge.json)
 */
interface StyleGuideConfig {
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
/**
 * Result of validating a single constraint
 */
interface StyleConstraintResult {
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
interface StyleValidationResult {
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
interface StyleAuditReport {
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
declare const STYLE_GUIDE_FILE_EXTENSION = ".styleguide.uibridge.json";
declare const STYLE_GUIDE_VERSION = "1.0.0";

export { type DesignTokens as D, type EvaluateRequest as E, type LayoutShift as L, type MetricContextConfig as M, type QualityEvaluationReport as Q, type StyleGuideConfig as S, type ViewportDimensions as V, type StyleAuditReport as a, type SnapshotDiffReport as b, type ElementDiff as c, type MetricFinding as d, type MetricFindingSeverity as e, type MetricFunction as f, type MetricResult as g, type QualityContext as h, type QualityGrade as i, type QualityMetricCategory as j, type QualityMetricId as k, STYLE_GUIDE_FILE_EXTENSION as l, STYLE_GUIDE_VERSION as m, type SnapshotBaseline as n, type StyleChange as o, type StyleConstraint as p, type StyleConstraintResult as q, type StyleRule as r, type StyleValidationResult as s };
