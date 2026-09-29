/**
 * Vision pipeline SDK helpers. The mutation-occurred signal, plus the
 * wire types of the runner-served `/vision/*` routes (`./wire`).
 */

export { mutationOccurred, installAutoMutationOccurred } from './mutation';
export type { MutationOccurredOptions, MutationOccurredResult } from './mutation';

export type {
  VisionRegion,
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
  VisionAssertion,
  VisionAssertionResult,
  VisionAssertResponse,
  VisionBaselineCreateResponse,
  VisionBaselineEntry,
  VisionBaselineListResponse,
} from './wire';
