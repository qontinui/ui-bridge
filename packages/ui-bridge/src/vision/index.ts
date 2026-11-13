/**
 * Vision pipeline SDK helpers. The mutation-occurred signal, the in-tab
 * evaluator of `vision/assert` (`./dom-assertions`, a port of vision-core),
 * plus the wire types of the runner-served `/vision/*` routes (`./wire`).
 */

export { mutationOccurred, installAutoMutationOccurred } from './mutation';
export type { MutationOccurredOptions, MutationOccurredResult } from './mutation';

// `vision/assert` evaluated in the tab, with no runner: the request
// validator, the DOM measurement + envelope, and the pure port of vision-core.
export {
  MAX_VISION_ASSERTIONS,
  VISION_ASSERTION_KINDS,
  VisionAssertRequestError,
  parseVisionAssertRequest,
  parseVisionAssertion,
} from './assertion-request';
export type { ParsedVisionAssertRequest } from './assertion-request';
export { SDK_VISION_ASSERTIONS_PRODUCER_ID, evaluateVisionAssertions } from './dom-assertions';
export type { EvaluateVisionAssertionsOptions, VisionAssertSource } from './dom-assertions';
export {
  IN_TAB_ASSERTION_KINDS,
  VisionCoreSnapshotError,
  evalInputFromVisionCoreSnapshot,
  evaluateVisionAssertion,
  foldVisionOutcomes,
  isInTabAssertionKind,
  isLargeText,
  paintOrderKey,
  snapshotCoverageOf,
  wcagMinimumRatio,
} from './assertion-eval';
export type {
  ClipBounds,
  FoldedVisionOutcome,
  InTabAssertionKind,
  MeasuredElement,
  MeasuredUnknown,
  PaintOrderEvidence,
  VisionEvalInput,
} from './assertion-eval';

export type {
  VisionRegion,
  VisionAnnotationRequest,
  VisionRedactRequest,
  VisionNamedCapture,
  VisionInlineOption,
  VisionCaptureRequest,
  VisionRawRequest,
  VisionRawReason,
  VisionCaptureResult,
  VisionCaptureResponse,
  VisionDiffResponse,
  VisionRawResponse,
  VisionHealthResponse,
  VisionMutationOccurredResponse,
  VisionCacheStreamResponse,
  OcrBlock,
  ExtractDropped,
  ExtractValue,
  VisionExtractResponse,
  VlmElementState,
  VlmElement,
  VlmModal,
  VlmOverlay,
  VlmLayout,
  VlmStructuredSummary,
  DescribeValue,
  VisionDescribeResponse,
  VisionAnalyzer,
  VisionSeverity,
  VisionFinding,
  AnalyzerVerdict,
  SnapshotCoverage,
  AnalyzedFrameInfo,
  SnapshotAttribution,
  VisionAnalyzeResponse,
  AssertionOutcome,
  TextMatchKind,
  WcagLevel,
  TypographyDimension,
  VisionRgb,
  VisionNaturalRegion,
  VisionAssertion,
  VisionAssertionKind,
  VisionAssertionResult,
  VisionAssertResponse,
  VisionBaselineCreateResponse,
  VisionBaselineEntry,
  VisionBaselineListResponse,
} from './wire';
