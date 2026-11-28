/**
 * Quality Evaluator Types
 *
 * Type definitions for the holistic UI quality evaluation system.
 * Metrics measure density, spacing, color, typography, and cross-element consistency.
 */

import type { ElementDesignData, ElementStructure } from '../core/types';

// ============================================================================
// Viewport
// ============================================================================

export interface ViewportDimensions {
  width: number;
  height: number;
  /**
   * The page's scrollable extent and scroll offset, when measured
   * (`/design/evaluate` reads them from the live document). Absent, the
   * structural metrics read the first screen as rect `y` in `[0, height)` and
   * report horizontal page scroll as not measured.
   */
  documentWidth?: number;
  documentHeight?: number;
  scrollX?: number;
  scrollY?: number;
}

// ============================================================================
// Metric IDs
// ============================================================================

export type QualityMetricCategory =
  | 'ux'
  | 'density'
  | 'spacing'
  | 'color'
  | 'typography'
  | 'consistency';

export type QualityMetricId =
  // UX (5)
  | 'contentOverflow'
  | 'aboveFoldRatio'
  | 'informationDensity'
  | 'containerEfficiency'
  | 'viewportUtilization'
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
  | 'touchTargetCompliance'
  // Custom Properties
  | 'customPropertyConsistency';

// ============================================================================
// Metric Results
// ============================================================================

export type MetricFindingSeverity = 'error' | 'warning' | 'info';

export interface MetricFinding {
  severity: MetricFindingSeverity;
  message: string;
  recommendation?: string;
  /** Registered element ids the finding is about. */
  elementIds?: string[];
  /**
   * Regions the finding is about that no evaluated element carries: a
   * functional group's synthetic key (`<kind>#<n>`; a group with a registered
   * id is reported in `elementIds`) or an unregistered text block
   * (`dom:<tag>.<class>#<n>`). Keys
   * are stable within one report only — `<kind>#<n>` is numbered over the
   * evaluated batch. The matching `rawData` hit carries each one's rect.
   */
  regionIds?: string[];
}

export interface MetricResult {
  metricId: QualityMetricId;
  /** 0-100; null when the metric is disabled, or could not measure what it names (`rawData.unmeasured`). */
  score: number | null;
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

/**
 * The `/design/evaluate` report. Values, not verdicts: scores and findings only.
 * There is deliberately no letter grade and no aggregate score (no weighted
 * overall, no UX sub-score) — a grade or a total is a judgment, and the standard a
 * score is judged against belongs to the caller (`domain_spec/ui-bridge`
 * behaviour (3)). Judge the per-metric `score`, `weight` and `findings`.
 */
export interface QualityEvaluationReport {
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

/**
 * A visible run of text on the page that no registered element carries — a
 * subtitle in a `<span>`, an intro in an untagged `<div>`. Read in the page
 * (scrubbed) so the redundant-text check sees what a reader sees, not only
 * what the registry holds. `id` is synthetic (`dom:<tag>.<class>#<n>`, in
 * document order) and `rect` is viewport-relative, so a finding still maps to
 * a region of the frame.
 */
export interface QualityTextBlock {
  id: string;
  tagName: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  /** The nearest registered ancestor, when one exists. */
  parentId?: string;
  group?: ElementStructure['group'];
}

/** Page-level data beside the registered elements (`/design/evaluate` collects it). */
export interface QualityPageData {
  /** Unregistered text blocks within the first two screens. Absent: not collected. */
  textBlocks?: QualityTextBlock[];
}

export type MetricFunction = (
  elements: ElementDesignData[],
  viewport: ViewportDimensions,
  page?: QualityPageData
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
