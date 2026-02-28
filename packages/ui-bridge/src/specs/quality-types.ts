/**
 * Quality Evaluator Types
 *
 * Type definitions for the holistic UI quality evaluation system.
 * Metrics measure density, spacing, color, typography, and cross-element consistency.
 */

import type { ElementDesignData } from '../core/types';

// ============================================================================
// Viewport
// ============================================================================

export interface ViewportDimensions {
  width: number;
  height: number;
}

// ============================================================================
// Metric IDs
// ============================================================================

export type QualityMetricCategory = 'density' | 'spacing' | 'color' | 'typography' | 'consistency';

export type QualityMetricId =
  // Density & Layout (6)
  | 'elementDensity'
  | 'whitespaceRatio'
  | 'localDensityBalance'
  | 'horizontalBalance'
  | 'verticalBalance'
  | 'alignmentConsistency'
  // Spacing (4)
  | 'spacingScaleAdherence'
  | 'spacingConsistency'
  | 'lineHeightRatio'
  | 'interGroupSpacingRatio'
  // Color (4)
  | 'uniqueColorCount'
  | 'wcagContrastCompliance'
  | 'colorHarmony'
  | 'saturationConsistency'
  // Typography (4)
  | 'typeScaleAdherence'
  | 'fontWeightConsistency'
  | 'headingHierarchy'
  | 'fontFamilyCount'
  // Consistency (4)
  | 'buttonConsistency'
  | 'cardConsistency'
  | 'inputConsistency'
  | 'touchTargetCompliance';

// ============================================================================
// Metric Results
// ============================================================================

export type MetricFindingSeverity = 'error' | 'warning' | 'info';

export interface MetricFinding {
  severity: MetricFindingSeverity;
  message: string;
  recommendation?: string;
  elementIds?: string[];
}

export interface MetricResult {
  metricId: QualityMetricId;
  score: number; // 0-100
  label: string;
  category: QualityMetricCategory;
  enabled: boolean;
  weight: number;
  findings: MetricFinding[];
  rawData?: Record<string, unknown>;
}

// ============================================================================
// Quality Contexts
// ============================================================================

export interface MetricContextConfig {
  enabled: boolean;
  weight: number; // 0-1
  thresholds: {
    good: number; // score >= good → no issue
    warning: number; // score >= warning → warning, else error
  };
}

export interface QualityContext {
  name: string;
  description: string;
  metrics: Partial<Record<QualityMetricId, MetricContextConfig>>;
}

// ============================================================================
// Evaluation Report
// ============================================================================

export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface QualityEvaluationReport {
  overallScore: number; // 0-100 weighted average
  grade: QualityGrade;
  contextName: string;
  metrics: MetricResult[];
  topIssues: MetricFinding[];
  totalElements: number;
  viewport: ViewportDimensions;
  timestamp: number;
  durationMs: number;
}

// ============================================================================
// Snapshot Diff
// ============================================================================

export interface SnapshotBaseline {
  elements: ElementDesignData[];
  viewport: ViewportDimensions;
  timestamp: number;
  label?: string;
}

export interface StyleChange {
  property: string;
  oldValue: string;
  newValue: string;
}

export interface LayoutShift {
  dx: number;
  dy: number;
  dWidth: number;
  dHeight: number;
}

export interface ElementDiff {
  elementId: string;
  changeType: 'added' | 'removed' | 'modified';
  styleChanges?: StyleChange[];
  layoutShift?: LayoutShift;
}

export interface SnapshotDiffReport {
  added: ElementDiff[];
  removed: ElementDiff[];
  modified: ElementDiff[];
  cumulativeLayoutShift: number;
  hasSignificantChanges: boolean;
}

// ============================================================================
// Metric Function Signature
// ============================================================================

export type MetricFunction = (
  elements: ElementDesignData[],
  viewport: ViewportDimensions
) => MetricResult;

// ============================================================================
// Evaluate Request (for server handlers)
// ============================================================================

export interface EvaluateRequest {
  context?: string;
  customContext?: QualityContext;
  elementIds?: string[];
  viewport?: ViewportDimensions;
}
