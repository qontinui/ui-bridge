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
  // State machine section types
  SpecState,
  SpecStateShape,
  SpecTransition,
  SpecTransitionAction,
  SpecStateMachine,
  SpecStateMachineShape,
  // Discovered spec wrapper
  DiscoveredSpec,
  SpecValidationRollup,
  // Testing section types
  SpecTestingConfig,
  SpecGroupTesting,
  TestScenario,
  TestStep,
  TestFixture,
  TestDataAsset,
  AsyncStrategy,
  TestInfrastructureRequirements,
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
export type { SpecExecutorConfig } from './executor';

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

// Design-inspection requests: the one implementation both in-package transports
// (server handlers, browser command handlers) answer `/design/element/:id/styles`,
// `/design/snapshot`, `/design/responsive`, `/design/audit` and
// `/control/viewport-constraints` with. Exported so
// a host with its own dispatcher (the qontinui-runner webview's
// `useDesignEvents`) answers with the same model instead of a third copy. The
// root entry already exports the design inspector these functions call, so it
// gains no DOM code. The `./specs` subpath does: it now bundles the inspector,
// token and root-width modules. None of them touches `window` or `document` at
// module load, so a Node consumer of `./specs` still imports it safely; the
// cost is bundle size, accepted so the subpath and the root expose one model.
export {
  elementStylesOf,
  designSnapshotOf,
  responsiveSnapshotsOf,
  designAuditOf,
  viewportConstraintsOf,
  DesignRequestError,
  designFailureCode,
  DEFAULT_DESIGN_RECORD_BUDGET,
  DEFAULT_AUDIT_ELEMENT_LIMIT,
  DEFAULT_AUDIT_MAX_RESULTS,
  MAX_RESPONSIVE_VIEWPORTS,
} from './design-request';
export type {
  DesignElementSource,
  ViewportConstraintsResponse,
  ElementStylesResponse,
  AuditResultBounds,
  DesignSelectionReport,
  DesignSelectionBounds,
  DesignAuditBounds,
  DesignSnapshotRequest,
  DesignSnapshotResponse,
  ResponsiveSnapshotsRequest,
  ResponsiveSnapshotsResponse,
  DesignAuditRequest,
  DesignAuditResponse,
  StyleGuideDesignAuditReport,
  HeuristicDesignAuditReport,
  HeuristicDesignAuditIssue,
} from './design-request';

// `/design/evaluate*` requests over registered elements — the same shared
// implementation pattern, exported for the same reason.
export {
  evaluateRegisteredQuality,
  captureQualityBaseline,
  diffQualityBaseline,
  collectDesignData as collectRegisteredDesignData,
  QualityRequestError,
  qualityFailureCode,
} from './quality-request';
export type {
  QualityElementSource,
  QualityBaselineRequest,
  QualityDiffRequest,
  DesignCollectOptions,
} from './quality-request';

// Style inference (draft style guide + token drift from computed styles).
// Pure — no DOM access — so the native package reaches it through this entry.
export {
  STYLE_CATEGORIES,
  ORDINAL_PREFIX,
  DEFAULT_MAX_PER_CATEGORY,
  DEFAULT_COLOR_DELTA_E,
  DEFAULT_PX_TOLERANCE,
  DEFAULT_MAX_LISTED,
  COLOR_MATCH_DELTA_E,
  buildStyleInventory,
  inferStyleGuideFromInventory,
  computeTokenDrift,
  styleValuesEquivalent,
} from './style-inference';
export type {
  StyleCategory,
  StyleSample,
  StyleInventory,
  StyleInventoryOptions,
  InventoryEntry,
  CategoryTruncation,
  InferOptions,
  InferredStyleGuide,
  DeclaredTokenSet,
  DeepPartialTokens,
  DriftOptions,
  DriftTolerance,
  DriftVerdict,
  DriftUnit,
  NearestToken,
  UndeclaredValue,
  UnusedToken,
  UnresolvedToken,
  CategoryDrift,
  CategoryDriftStatus,
  ListTruncation,
  TokenDriftReport,
} from './style-inference';
export {
  DEFAULT_MAX_ELEMENTS,
  StyleInferenceRequestError,
  styleInferenceFailureCode,
  parseInferBody,
  parseDriftBody,
  loadedGuideTokens,
} from './style-inference-body';
export type {
  StyleSampleOptions,
  InferBody,
  DriftBody,
  DeclaredSourceSpec,
} from './style-inference-body';
export type {
  StyleCaptureReport,
  StyleInferenceResponse,
  TokenDriftResponse,
} from './style-inference-request';
export type { StyleSampleScope } from './style-inference-body';
// Wider than color-utils' parseColor (hsl, oklch, oklab, color(srgb), all named colours).
export { canonicalColor, deltaE2000 } from './style-color';

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
