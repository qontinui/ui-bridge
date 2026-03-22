/**
 * AI Module
 *
 * AI-native interface for UI Bridge providing:
 * - Natural language element search
 * - Natural language action execution
 * - Semantic snapshots and diffs
 * - Assertion/verification API
 * - Rich error context
 */

// Types
export type {
  // Search types
  SearchCriteria,
  SearchResult,
  SearchResponse,

  // AI Element types
  AIDiscoveredElement,
  AIFindResponse,
  PageContext,
  FormAnalysis,
  FormFieldAnalysis,

  // NL Action types
  NLActionRequest,
  NLActionResponse,
  ParsedAction,

  // Assertion types
  AssertionType,
  AssertionRequest,
  AssertionResult,
  BatchAssertionRequest,
  BatchAssertionResult,

  // Snapshot types
  SemanticSnapshot,
  FormState,
  FormFieldState,
  FormsResponse,
  ModalState,

  // Diff types
  SemanticDiff,
  ElementChange,
  ElementModification,
  ContentChanges,
  TextChange,
  MetricChange,
  StatusChange,

  // Change tracking types
  ChangeCategory,
  CategorizedDiff,
  ActionWithDiffRequest,
  ActionDiffResult,
  ChangePredicate,
  WaitForChangeOptions,
  BufferedChange,
  ChangeBufferDrainResult,
  SnapshotBookmark,
  ChangeTimeline,
  TimelineEvent,
  DiffSummaryOptions,
  StructuredChangeAnalysis,
  TableChangeAnalysis,
  ListChangeAnalysis,

  // Error types
  AIErrorContext,
  RecoverySuggestion,

  // Registration types
  AIElementRegistrationOptions,

  // Screen analysis types
  CompactElement,
  GroupedElements,
  CompactModal,
  CompactToast,
  AggregatedErrors,
  LoadingState,
  ScreenAnalysis,

  // Semantic search types
  SemanticSearchCriteria,
  SemanticSearchResult,
  SemanticSearchResponse,

  // Intent types
  Intent,
  IntentParam,
  IntentSearchResponse,
  IntentExecutionResult,

  // Recovery types
  RecoveryAttemptRequest,
  RecoveryAttemptResult,

  // Cross-app comparison types
  DataType,
  ExtractedDataValue,
  PageDataMap,
  RegionType,
  PageRegion,
  PageRegionMap,
  TableColumn,
  TableSchema,
  ListItemField,
  ListSchema,
  StructuredDataExtraction,
  FormatDescriptor,
  FormatMismatch,
  MatchedElementPair,
  DataValueComparison,
  CrossAppDiff,
  InteractionParity,
  NavigationPair,
  NavigationMap,
  ComponentInfo,
  ComponentMatch,
  ComponentComparison,
  GridStructure,
  GridDiff,
  HierarchyDiff,
  DensityComparison,
  LayoutComparison,
  ComparisonIssue,
  CrossAppComparisonReport,

  // Content comparison types
  HeadingMatch,
  HeadingChange,
  MetricMatch,
  CrossAppMetricChange,
  StatusMatch,
  CrossAppStatusChange,
  HeadingLevelComparison,
  TableComparison,
  ContentComparison,
} from './types';

// Fuzzy Matcher
export {
  levenshteinDistance,
  levenshteinSimilarity,
  jaroSimilarity,
  jaroWinklerSimilarity,
  generateNgrams,
  ngramSimilarity,
  normalizeString,
  fuzzyMatch,
  findBestMatch,
  findAllMatches,
  fuzzyContains,
  wordSimilarity,
  tokenize,
  tokenSimilarity,
  DEFAULT_FUZZY_CONFIG,
} from './fuzzy-matcher';
export type { FuzzyMatchConfig, FuzzyMatchResult } from './fuzzy-matcher';

// Alias Generator
export {
  generateAliases,
  generateDescription,
  generatePurpose,
  generateSuggestedActions,
  getSynonyms,
  areSynonyms,
  DEFAULT_ALIAS_CONFIG,
} from './alias-generator';
export type { AliasGeneratorConfig, AliasGeneratorInput } from './alias-generator';

// Search Engine
export { SearchEngine, createSearchEngine, DEFAULT_SEARCH_CONFIG } from './search-engine';
export type { SearchEngineConfig } from './search-engine';

// Summary Generator
export {
  generatePageSummary,
  generateElementDescription,
  generateSnapshotSummary,
  generateDiffSummary,
  inferPageType,
} from './summary-generator';
export type { SummaryConfig } from './summary-generator';

// Validation scanner
export { scanValidationErrors } from './validation-scanner';
export type { DetectedValidationError } from './validation-scanner';

// Form Discovery
export { discoverForms } from './form-discovery';
export type { FormDiscoveryElement } from './form-discovery';

// NL Assertion Parser
export { parseNLAssertion } from './nl-assertion-parser';
export type { NLAssertionInput, NLAssertionOutput } from './nl-assertion-parser';

// NL Action Parser
export {
  parseNLInstruction,
  parseNLInstructions,
  splitCompoundInstruction,
  extractModifiers,
  validateParsedAction,
  describeAction,
} from './nl-action-parser';

// NL Action Executor
export {
  NLActionExecutor,
  createNLActionExecutor,
  DEFAULT_EXECUTOR_CONFIG,
} from './nl-action-executor';
export type { NLActionExecutorConfig } from './nl-action-executor';

// Assertions
export { AssertionExecutor, createAssertionExecutor, DEFAULT_ASSERTION_CONFIG } from './assertions';
export type { AssertionConfig } from './assertions';

// Semantic Snapshot
export {
  SemanticSnapshotManager,
  createSnapshotManager,
  DEFAULT_SNAPSHOT_CONFIG,
} from './semantic-snapshot';
export type { SemanticSnapshotConfig } from './semantic-snapshot';

// Semantic Diff
export {
  computeDiff,
  SemanticDiffManager,
  createDiffManager,
  hasSignificantChanges,
  describeDiff,
  parseNumericValue,
  classifyStatusDirection,
  DEFAULT_DIFF_CONFIG,
} from './semantic-diff';
export type { SemanticDiffConfig } from './semantic-diff';

// Change Tracker
export { ChangeTracker, createChangeTracker, analyzeStructuredChanges } from './change-tracker';
export type { ChangeTrackerDeps, ChangeTrackerConfig } from './change-tracker';

// Error Context
export {
  ErrorCodes,
  createErrorContext,
  formatErrorContext,
  createSimpleError,
  isRecoverableError,
  getBestRecoverySuggestion,
} from './error-context';
export type { ErrorCode } from './error-context';

// Data Extraction
export {
  extractPageData,
  classifyDataType,
  normalizeValue,
  DEFAULT_DATA_EXTRACTION_CONFIG,
} from './data-extraction';
export type { DataExtractionConfig } from './data-extraction';

// Region Segmentation
export {
  segmentPageRegions,
  classifyRegionType,
  DEFAULT_REGION_SEGMENTATION_CONFIG,
} from './region-segmentation';
export type { RegionSegmentationConfig } from './region-segmentation';

// Table Extraction
export {
  extractStructuredData,
  detectTable,
  detectList,
  DEFAULT_TABLE_EXTRACTION_CONFIG,
} from './table-extraction';
export type { TableExtractionConfig } from './table-extraction';

// Format Analysis
export {
  analyzeFormat,
  compareFormats,
  analyzePageFormats,
  detectFormatPattern,
  DEFAULT_FORMAT_ANALYSIS_CONFIG,
} from './format-analysis';
export type { FormatAnalysisConfig } from './format-analysis';

// Cross-App Diff
export {
  computeCrossAppDiff,
  matchElements,
  DEFAULT_CROSS_APP_DIFF_CONFIG,
} from './cross-app-diff';
export type { CrossAppDiffConfig } from './cross-app-diff';

// Action Parity
export { analyzeActionParity, DEFAULT_ACTION_PARITY_CONFIG } from './action-parity';
export type { ActionParityConfig } from './action-parity';

// Navigation Map
export {
  buildNavigationMap,
  isNavigationElement,
  DEFAULT_NAVIGATION_MAP_CONFIG,
} from './navigation-map';
export type { NavigationMapConfig } from './navigation-map';

// Component Comparison
export { compareComponents, DEFAULT_COMPONENT_COMPARISON_CONFIG } from './component-comparison';
export type { ComponentComparisonConfig } from './component-comparison';

// Layout Comparison
export {
  compareLayouts,
  detectGridStructure,
  computeProminence,
  DEFAULT_LAYOUT_COMPARISON_CONFIG,
} from './layout-comparison';
export type { LayoutComparisonConfig } from './layout-comparison';

// Content Comparison
export { compareContent, DEFAULT_CONTENT_COMPARISON_CONFIG } from './content-comparison';
export type { ContentComparisonConfig } from './content-comparison';

// Comparison Report
export { generateComparisonReport, DEFAULT_COMPARISON_REPORT_CONFIG } from './comparison-report';
export type { ComparisonReportConfig } from './comparison-report';

// Design Inspector
export {
  getExtendedComputedStyles,
  getElementDesignData,
  getCSSCustomProperties,
  captureStateVariations,
  captureResponsiveSnapshots,
  computeContrastRatio,
  checkContrastCompliance,
  DEFAULT_VIEWPORTS,
} from './design-inspector';
export type { DesignRegistryLike } from './design-inspector';

// Form Diff Tracking
export { captureFormSnapshot, diffFormSnapshots, summarizeFormDiff } from './form-diff';
export type { FormSnapshot, FormFieldDiff, FormDiff } from './form-diff';

// Target Decomposer
export { decomposeTarget } from './target-decomposer';
export type { DecomposedTarget, SpatialRelation } from './target-decomposer';

// Media Queries
export {
  createMediaFindRequest,
  createBrokenImagesFindRequest,
  createMissingAltFindRequest,
  createOversizedImagesFindRequest,
  buildAccessibilityAudit,
  buildPerformanceAudit,
} from './media-queries';
export type { MediaAccessibilityAudit, MediaPerformanceAudit } from './media-queries';

// Media Snapshot & Visual Regression
export {
  captureMediaSnapshot,
  compareMediaSnapshots,
  captureElementScreenshot,
  compareVisualRegression,
} from './media-snapshot';
export type {
  MediaSnapshotData,
  MediaComparisonResult,
  ElementCaptureOptions,
  VisualRegressionOptions,
  VisualRegressionResult,
} from './media-snapshot';

// Media Analysis
export { analyzeMediaElement, analyzeMediaBatch, analyzeMediaPage } from './media-analysis';
export type {
  MediaAnalysisResult,
  MediaAnalyzeRequest,
  MediaAnalyzeBatchRequest,
  MediaAnalyzePageRequest,
} from './media-analysis';

// Unified Find API
export { find } from './find';
export type {
  FindContext,
  FindOptions,
  FindResult,
  FindResultMatch,
  FindResultAmbiguous,
  FindResultNotFound,
  FindCandidate,
} from './find';
