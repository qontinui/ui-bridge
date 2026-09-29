/**
 * Wire shapes of the runner-served `/vision/*` routes.
 *
 * The SDK does not implement these routes (its handlers answer
 * `RUNNER_REQUIRED` → `UB-CAPABILITY-UNAVAILABLE`); the runner does, in
 * `qontinui-runner/src-tauri/src/mcp/ui_bridge/vision_routes.rs`, over the
 * `qontinui-vision-core` types in qontinui-schemas. They are declared here so a
 * TypeScript consumer gets a compile-time shape instead of `unknown`.
 *
 * Field names are the runner's camelCase wire names; enum VALUES are
 * snake_case (vision-core convention). `vision/extract` and `vision/describe`
 * answer in the {@link Observation} envelope; `vision/analyze` and
 * `vision/assert` keep their own verdict vocabulary and carry the envelope's
 * provenance block beside it (plan 2026-09-20-ui-bridge-observations-…, D1).
 */

import type { Observation, ObservationProvenance, UnknownCode } from '../observation/observation';

// ============================================================================
// Shared geometry
// ============================================================================

/** A pixel-space region (vision-core `Region`). `x`/`y` may be negative (off-frame geometry). */
export interface VisionRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ============================================================================
// vision/capture, vision/annotate, vision/diff, vision/raw
// ============================================================================

/** One captured image written to the runner's vision cache. */
export interface VisionCaptureResult {
  /** `tmp_vision_cache/<sha256>.<ext>` (relative to the runner CWD). */
  path: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  /** Lower-case extension: `jpeg` | `webp` | `png`. */
  format: string;
  /** Output contract used, e.g. `claude_vision_v1`. */
  contract: string;
  /** `Webview2CapturePreview` | `MonitorCrop`; omitted for device / synthetic frames. */
  captureBackend?: string;
}

/**
 * `vision/capture` / `vision/annotate`: a flat result for a single-output
 * request, or `{ captures: { name: result } }` when the request carried
 * `captures: [...]`. Dispatch on the presence of `captures`.
 */
export type VisionCaptureResponse =
  | VisionCaptureResult
  | { captures: Record<string, VisionCaptureResult> };

/** `vision/diff`. */
export interface VisionDiffResponse extends VisionCaptureResult {
  /** Fraction of pixels that differ above the per-channel tolerance. */
  pixelDeltaRatio: number;
  /** Bounding rectangle(s) of all changed pixels. */
  changedRegions: VisionRegion[];
}

/** `vision/raw` answers with the same shape as a single capture. */
export type VisionRawResponse = VisionCaptureResult;

// ============================================================================
// vision/health, vision/mutation-occurred, vision/cache/:sha256
// ============================================================================

/** `vision/health`. */
export interface VisionHealthResponse {
  pipelineVersion: string;
  /** Live capture-semaphore permits, 0 to 2. */
  availableSlots: number;
  cacheSizeBytes: number;
  cacheEntryCount: number;
  /** Cumulative since process start. */
  cacheHits: number;
  cacheMisses: number;
  cacheEvictions: number;
  cacheMaxBytes: number;
  /** Monotonic mutation counter — bumped by control/click, control/type, control/navigate. */
  mutationId: number;
  visionCapturePreviewCount: number;
  visionMonitorCropCount: number;
  /** Most recent CapturePreview → monitor-crop fallback reason; omitted if none occurred. */
  visionLastFallbackReason?: string;
  /** RFC3339 time of that fallback; omitted if none occurred. */
  visionLastFallbackAt?: string;
}

/** `vision/mutation-occurred`. */
export interface VisionMutationOccurredResponse {
  /** The new mutation id after the bump. */
  mutationId: number;
}

/**
 * `vision/cache/:sha256` streams the cached image bytes; its JSON body only
 * exists on the error path, so the success payload is opaque binary.
 */
export type VisionCacheStreamResponse = never;

// ============================================================================
// vision/extract (OCR)
// ============================================================================

/** One OCR text block. */
export interface OcrBlock {
  bbox: VisionRegion;
  text: string;
  confidence: number;
}

/** What the OCR producer dropped before answering — never silently. */
export interface ExtractDropped {
  /** Blocks under the request's `minConfidence`. */
  belowConfidence: number;
  /** Whitespace-only blocks. */
  emptyText: number;
  /** Duplicate blocks collapsed into one. */
  deduplicated: number;
}

/** The `value` of a `measured` `vision/extract` observation. */
export interface ExtractValue {
  blocks: OcrBlock[];
  /** Block texts joined by newline in scan order (top-to-bottom). */
  aggregateText: string;
  dropped: ExtractDropped;
}

/**
 * `vision/extract` — producer `runner/vision-extract`. `absent` = the model
 * returned no text at all; `unknown{below_confidence_floor}` = it returned
 * text and every block fell under the floor (see `value`-less
 * `provenance.coverage.unmeasured`); `unknown{model_reply_unparseable}` /
 * `producer_failed` / `input_missing` for the failure arms.
 *
 * **Runner build requirement:** this shape matches qontinui-runner builds
 * carrying plan 2026-09-20-ui-bridge-observations-distinguish-cannot-see-from-
 * not-present-and-carry-provenance Phase 2. Older runners serve the previous
 * bare shape (`{ blocks, aggregateText, model, cached, captureBackend? }`),
 * so check the runner build before relying on this type.
 */
export type VisionExtractResponse = Observation<ExtractValue>;

// ============================================================================
// vision/describe (VLM)
// ============================================================================

export type VlmElementState = 'disabled' | 'loading' | 'selected' | 'focused';

export interface VlmElement {
  role: string;
  text?: string;
  state?: VlmElementState[];
  color?: string;
  bbox?: VisionRegion;
}

export interface VlmModal {
  kind: 'confirm' | 'alert' | 'form';
  title?: string;
  ctas?: string[];
}

export interface VlmOverlay {
  kind: 'tooltip' | 'dropdown' | 'menu';
  text?: string;
}

export type VlmLayout = 'centered' | 'split' | 'list' | 'grid' | 'custom';

/** Closed-schema machine twin of a VLM description. */
export interface VlmStructuredSummary {
  elements: VlmElement[];
  modals: VlmModal[];
  overlays: VlmOverlay[];
  layout: VlmLayout;
  confidence: number;
}

/** The `value` of a `measured` `vision/describe` observation. */
export interface DescribeValue {
  /** Human-readable caption. */
  description: string;
  /**
   * The structured twin as its OWN observation: `absent` on a prose-only
   * reply, `unknown{model_reply_unparseable}` when strict validation failed —
   * two answers that used to be one missing key.
   */
  structured: Observation<VlmStructuredSummary>;
}

/**
 * `vision/describe` — producer `runner/vision-describe`.
 *
 * **Runner build requirement:** this shape matches qontinui-runner builds
 * carrying plan 2026-09-20-ui-bridge-observations-distinguish-cannot-see-from-
 * not-present-and-carry-provenance Phase 2. Older runners serve the previous
 * bare shape (`{ description, structured?, tokens, model, cached }`),
 * so check the runner build before relying on this type.
 */
export type VisionDescribeResponse = Observation<DescribeValue>;

// ============================================================================
// vision/analyze
// ============================================================================

export type VisionAnalyzer = 'layout' | 'typography' | 'color' | 'dynamic' | 'elements';

export type VisionSeverity = 'info' | 'warning' | 'critical';

/** One analyzer finding (vision-core `Finding`). */
export interface VisionFinding {
  kind: string;
  severity: VisionSeverity;
  /** Which analyzer produced it; stamped by the runner. */
  analyzer?: VisionAnalyzer;
  region?: VisionRegion;
  detail: string;
  /** Element ids involved; omitted when none. */
  elements?: string[];
  /** Always present: `null` = a deduction, not an estimate. */
  confidence: number | null;
}

/**
 * The analyzer's own verdict on whether its preconditions were met. Read it
 * BEFORE `findings`: an empty list under `checked` is a clean page, under
 * `blocked` it answers nothing. `degraded`/`blocked` carry a typed `code`
 * beside the human `reason`.
 */
export type AnalyzerVerdict =
  | { state: 'checked' }
  | { state: 'degraded'; reason: string; code: UnknownCode }
  | { state: 'blocked'; reason: string; code: UnknownCode };

/** What a snapshot-consuming evaluator had to work with (vision-core `SnapshotCoverage`). */
export interface SnapshotCoverage {
  elements: number;
  withGeometry: number;
  withStacking: number;
  withText: number;
  interactable: number;
}

/** Provenance of the frame a vision call captured. */
export interface AnalyzedFrameInfo {
  width: number;
  height: number;
  /** RFC3339 — when the capture backend produced the frame. Dates the FRAME only. */
  capturedAt: string;
  /** Device pixel ratio of the capture (1.0 unscaled, 2.0 Retina). */
  scaleFactor: number;
  /** Where the frame came from (snake_case `FrameSourceKind`, e.g. `window`). */
  kind: string;
  /** Present iff `kind === "window"`. */
  captureBackend?: string;
}

/** Identity of the snapshot a vision call consumed — three states, not an optional id. */
export type SnapshotAttribution =
  | { state: 'attributed'; snapshotId: string }
  | { state: 'unattributed' }
  | { state: 'absent' };

/**
 * `vision/analyze`.
 *
 * **Runner build requirement:** this shape matches qontinui-runner builds
 * carrying plan 2026-09-20-ui-bridge-observations-distinguish-cannot-see-from-
 * not-present-and-carry-provenance Phase 2. Older runners serve the previous
 * bare shape (`frame?` + `frameError?`, no `provenance`, an uncoded verdict),
 * so check the runner build before relying on this type.
 */
export interface VisionAnalyzeResponse {
  analyzer: VisionAnalyzer;
  findings: VisionFinding[];
  verdict: AnalyzerVerdict;
  /** Omitted when the analyzer takes no snapshot or none was supplied — read `snapshotAttribution`. */
  coverage?: SnapshotCoverage;
  /**
   * The frame as an observation — one field, three states, replacing the old
   * `frame` + `frameError` pair.
   */
  frame: Observation<AnalyzedFrameInfo>;
  /** RFC3339 — when the analyzer finished. Never absent. */
  evaluatedAt: string;
  snapshotAttribution: SnapshotAttribution;
  /** Envelope provenance (`producer: vision-core/<analyzer>`). */
  provenance: ObservationProvenance;
}

// ============================================================================
// vision/assert
// ============================================================================

export type AssertionOutcome = 'passed' | 'failed' | 'unknown';

export type TextMatchKind = 'contains' | 'exact' | 'regex';
export type WcagLevel = 'aa' | 'aaa';
export type TypographyDimension = 'font_family' | 'font_size' | 'line_height';

/**
 * One assertion of the 12-type DSL (vision-core `Assertion`), echoed back on
 * each result. Variant tags and field names are snake_case on the wire.
 */
export type VisionAssertion =
  | { type: 'no_overlap'; elements: [string, string]; tolerance_px?: number | null }
  | { type: 'element_above'; elements: [string, string]; require_overlap?: boolean }
  | {
      type: 'contains_text';
      target: { element: string } | { region: VisionRegion };
      text: string;
      kind?: TextMatchKind;
    }
  | { type: 'text_fits_container'; element: string }
  | { type: 'aligned_horizontally'; elements: string[]; axis_tolerance_px?: number | null }
  | { type: 'aligned_vertically'; elements: string[]; axis_tolerance_px?: number | null }
  | {
      type: 'color_within';
      element: string;
      expected: { r: number; g: number; b: number };
      delta_e_max?: number | null;
    }
  | { type: 'typography_consistent'; elements: string[]; dimensions?: TypographyDimension[] }
  | { type: 'no_layout_shift_since'; baseline: string; tolerance_px?: number | null }
  | { type: 'no_clipping'; region?: VisionRegion | null }
  | { type: 'animation_settled'; region?: VisionRegion | null; settle_frames?: number | null }
  | { type: 'contrast_meets_wcag'; element: string; level?: WcagLevel };

/** One evaluated assertion. */
export interface VisionAssertionResult {
  /** `outcome === "passed"`. `unknown` is NOT a pass. */
  passed: boolean;
  outcome: AssertionOutcome;
  detail?: string;
  assertion: VisionAssertion;
}

/**
 * `vision/assert`.
 *
 * **Runner build requirement:** this shape matches qontinui-runner builds
 * carrying plan 2026-09-20-ui-bridge-observations-distinguish-cannot-see-from-
 * not-present-and-carry-provenance Phase 2. Older runners serve the previous
 * bare shape (`allPassed` + `frameError?` + `frame?`, no `outcomeCounts`/`outcome`/`provenance`),
 * so check the runner build before relying on this type.
 */
export interface VisionAssertResponse {
  results: VisionAssertionResult[];
  /** How many results landed in each outcome. */
  outcomeCounts: { passed: number; failed: number; unknown: number };
  /** Roll-up with fixed precedence failed > unknown > passed. */
  outcome: AssertionOutcome;
  /** The frame this call captured, as an observation (no assertion reads it). */
  frame: Observation<AnalyzedFrameInfo>;
  /** Present exactly when a snapshot was supplied. */
  coverage?: SnapshotCoverage;
  /** RFC3339 — when the assertions finished evaluating. Never absent. */
  evaluatedAt: string;
  snapshotAttribution: SnapshotAttribution;
  /** Envelope provenance. */
  provenance: ObservationProvenance;
}

// ============================================================================
// vision/baseline, vision/baselines
// ============================================================================

/** `POST vision/baseline`. */
export interface VisionBaselineCreateResponse {
  name: string;
  sha256: string;
  width: number;
  height: number;
  registeredAtUnixMs: number;
}

/** One registered baseline. */
export interface VisionBaselineEntry {
  name: string;
  sha256: string;
  width: number;
  height: number;
  registeredAtUnixMs: number;
  elementBboxes: Record<string, VisionRegion>;
  /** Omitted for a baseline registered from an unattributed snapshot. */
  snapshotId?: string;
}

/** `GET vision/baselines`. */
export interface VisionBaselineListResponse {
  baselines: VisionBaselineEntry[];
}
