/**
 * Specs Module
 *
 * Declarative specification system for UI Bridge elements.
 * Specs define expected element behavior as assertions that can
 * be authored, stored, executed, and used for regression testing.
 */

// Types
export type {
  SpecCategory,
  SpecSeverity,
  SpecSource,
  SpecTarget,
  SpecAssertion,
  SpecGroup,
  SpecConfig,
  SpecMetadata,
  SpecAssertionResult,
  SpecGroupResult,
  SpecExecutionResult,
  SpecExecutionOptions,
  SpecCoverage,
  SpecEventType,
  SpecEvent,
  AssertionCondition,
  SetupAction,
} from './types';

// Re-export AI types used in spec assertions
export type { AssertionType, SearchCriteria } from '../ai/types';

export {
  SPEC_CONFIG_VERSION,
  SPEC_FILE_EXTENSION,
  VALID_ASSERTION_TYPES,
  VALID_SPEC_CATEGORIES,
  VALID_SPEC_SEVERITIES,
  VALID_SPEC_SOURCES,
} from './types';

// Validator
export {
  validateSpecConfig,
  validateSpecGroup,
  validateSpecAssertion,
  isValidAssertionType,
  isValidSpecCategory,
  isValidSpecSeverity,
  isValidSpecSource,
} from './validator';
export type { ValidationResult, ValidationError } from './validator';

// Migration
export {
  migrateFromTestGeneratorOutput,
  migrateLegacyAssertion,
  migrateLegacyTarget,
  coerceAssertionType,
} from './migration';
export type {
  LegacyTestGeneratorOutput,
  LegacyTestSpecification,
  LegacyTestAssertion,
  LegacyTestTarget,
} from './migration';

// Store
export { SpecStore, getGlobalSpecStore, resetGlobalSpecStore } from './store';
export type { SpecListener, SpecFilterOptions } from './store';

// Executor
export { SpecExecutor, resolveTarget } from './executor';

// Style types
export type {
  DesignTokens,
  StyleConstraint,
  StyleRule,
  StyleGuideConfig,
  StyleConstraintResult,
  StyleValidationResult,
  StyleAuditReport,
} from './style-types';
export { STYLE_GUIDE_FILE_EXTENSION, STYLE_GUIDE_VERSION } from './style-types';

// Style validator
export {
  validateElement,
  resolveTokenValue,
  runStyleAudit,
  evaluateConstraint,
} from './style-validator';

// Quality evaluator types
export type {
  ViewportDimensions,
  QualityMetricCategory,
  QualityMetricId,
  MetricFindingSeverity,
  MetricFinding,
  MetricResult,
  MetricContextConfig,
  QualityContext,
  QualityGrade,
  QualityEvaluationReport,
  SnapshotBaseline,
  StyleChange,
  LayoutShift,
  ElementDiff,
  SnapshotDiffReport,
  MetricFunction,
  EvaluateRequest,
} from './quality-types';

// Color utilities
export {
  parseColor,
  rgbToHsl,
  relativeLuminance,
  contrastRatio,
  colorDistance,
  clusterColors,
  isGrayscale,
  hueDistance,
} from './color-utils';
export type { RGBA, HSL } from './color-utils';

// Quality metrics
export { METRIC_FUNCTIONS } from './quality-metrics';

// Quality contexts
export { BUILT_IN_CONTEXTS, getContext, listContexts, mergeContext } from './quality-contexts';

// Quality evaluator
export { evaluateQuality } from './quality-evaluator';

// Snapshot diff
export { createBaseline, diffSnapshots } from './quality-diff';

// Architecture spec types
export type {
  TechStackEntry,
  DirectoryEntry,
  ArchitecturePattern,
  ArchitectureConstraint,
  FeatureDependency,
  FeatureSpec,
  ArchitectureConfig,
} from './architecture-types';
export { ARCHITECTURE_FILE_EXTENSION, ARCHITECTURE_CONFIG_VERSION } from './architecture-types';

// API spec types
export type { HttpMethod, SchemaField, ApiEndpoint, DataModel, ApiConfig } from './api-types';
export { API_FILE_EXTENSION, API_CONFIG_VERSION } from './api-types';

// Data spec types
export type {
  ColumnType,
  DataColumn,
  DataIndex,
  DataRelation,
  DataEntity,
  DataSeed,
  DataMigration,
  DataConfig,
} from './data-types';
export { DATA_FILE_EXTENSION, DATA_CONFIG_VERSION } from './data-types';

// Dependency spec types
export type {
  ArtifactKind,
  ArtifactRef,
  DependencyLink,
  ModuleRef,
  DependencyCluster,
  DependencyConfig,
} from './dependency-types';
export { DEPENDENCY_FILE_EXTENSION, DEPENDENCY_CONFIG_VERSION } from './dependency-types';

// Constraint spec types
export type {
  PerformanceBudget,
  BundleBudget,
  BrowserTarget,
  ResponsiveBreakpoint,
  AccessibilityTarget,
  CapacityConstraint,
  ConstraintConfig,
} from './constraint-types';
export { CONSTRAINT_FILE_EXTENSION, CONSTRAINT_CONFIG_VERSION } from './constraint-types';
