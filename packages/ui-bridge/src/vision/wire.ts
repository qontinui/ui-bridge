/**
 * Wire shapes of the runner-served `/vision/*` routes.
 *
 * The runner implements these routes, in
 * `qontinui-runner/src-tauri/src/mcp/ui_bridge/vision_routes.rs`, over the
 * `qontinui-vision-core` types in qontinui-schemas. They are declared here so a
 * TypeScript consumer gets a compile-time shape instead of `unknown`. The SDK's
 * handlers answer every route but one with `RUNNER_REQUIRED` →
 * `UB-CAPABILITY-UNAVAILABLE`. The exception is `vision/assert`: the SDK
 * evaluates the five snapshot-reading kinds in the tab
 * (`./dom-assertions`, a port of vision-core held to it by a shared
 * conformance fixture) and answers every other kind per result with
 * `unknown{capability_unavailable_in_build}`.
 *
 * Field names are the runner's camelCase wire names; enum VALUES are
 * snake_case (vision-core convention). `vision/extract` and `vision/describe`
 * answer in the {@link Observation} envelope; `vision/analyze` and
 * `vision/assert` keep their own verdict vocabulary and carry the envelope's
 * provenance block beside it (plan 2026-09-20-ui-bridge-observations-…, D1).
 *
 * **Producer ids** (`provenance.producer.id`):
 *
 * | Route / field | Producer |
 * |---|---|
 * | `vision/extract` | `runner/vision-extract` |
 * | `vision/describe` | `runner/vision-describe` |
 * | `vision/analyze` | `vision-core/<analyzer>` (e.g. `vision-core/layout`) |
 * | `vision/assert` (runner) | `vision-core/assertions` |
 * | `vision/assert` (SDK, in the tab) | `sdk/vision-assertions` |
 * | `frame` on analyze / assert | `runner/vision-frame` |
 * | `control/page-health` (runner) | `runner/page-health` |
 *
 * **Code semantics shared by every frame-consuming route:**
 *
 * - a capture was ATTEMPTED and failed → `unknown{producer_failed}` (the
 *   detail says "frame capture failed" vs. a model-call failure);
 * - an unknown `target` (like an unknown `element`) is a MALFORMED REQUEST and
 *   answers HTTP 404 on every vision route — it is not an observation, so it
 *   carries no unknown code. A target that WAS valid but went away (device
 *   unplugged, app heartbeat expired) also answers 404: re-list targets before
 *   assuming a typo.
 * - There is no frame-level `input_missing`: `input_missing` is reserved for
 *   inputs the page or caller did not supply (no bbox, no `elements`, no
 *   geometry).
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

/** An overlay rectangle drawn onto a capture (`vision/annotate`, `annotations`). */
export interface VisionAnnotationRequest {
  region: VisionRegion;
  label?: string;
  /** RGBA border color, e.g. `[255, 51, 51, 255]`. Defaults to red. */
  borderColor?: [number, number, number, number];
  /** Border thickness in pixels. Defaults to 2. */
  borderThickness?: number;
  /** Optional RGBA fill color. */
  fillColor?: [number, number, number, number];
}

/**
 * Per-region pixel obfuscation applied before the capture is encoded. The
 * runner's serde renames only the variant tags, so `block_size` stays
 * snake_case on the wire.
 */
export type VisionRedactRequest =
  | { kind: 'blur'; region: VisionRegion; sigma: number }
  | { kind: 'pixelate'; region: VisionRegion; block_size: number }
  | { kind: 'fill'; region: VisionRegion; color: [number, number, number, number] };

/** One named output of a multi-output capture (`captures: [...]`). */
export interface VisionNamedCapture {
  name: string;
  region?: VisionRegion;
  element?: string;
  contract?: string;
  annotations?: VisionAnnotationRequest[];
  redact?: VisionRedactRequest[];
}

/**
 * Inline-bytes opt-in for `vision/capture`, `vision/annotate` and `vision/raw`.
 * When `true`, the response also carries the encoded image as `base64`,
 * saving the `GET url` round-trip. Default `false`.
 *
 * Runner contract this type targets (plan
 * 2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary,
 * Phase 3 — a runner that predates it ignores `inline`): the inline size is
 * capped at a fixed 5 MiB (`INLINE_MAX_BYTES`), and over the cap the runner
 * answers HTTP 413 `INLINE_TOO_LARGE` whose `hint` carries `url`, `bytes`
 * and `maxBytes`, never a truncated string.
 */
export interface VisionInlineOption {
  inline?: boolean;
}

/** `vision/capture` / `vision/annotate` request body. */
export interface VisionCaptureRequest extends VisionInlineOption {
  /** Pixel-space rect to crop after capture. */
  region?: VisionRegion;
  /** Element id; resolved to its bbox via the runner's snapshot. */
  element?: string;
  /** Output contract: `claude` (default), `webp`, or `png_strict`. */
  contract?: string;
  /** Overlay rectangles + labels. */
  annotations?: VisionAnnotationRequest[];
  /** Per-region pixel obfuscation. */
  redact?: VisionRedactRequest[];
  /** Bypass the read-side cache (still updates on write). */
  force?: boolean;
  /**
   * Multi-output fan-out: one frame feeds N derived outputs; the top-level
   * region/element fields are ignored and the response becomes
   * `{ captures: { name: result } }`.
   */
  captures?: VisionNamedCapture[];
  /** Frame source: a device / app id. Omitted = the runner's own window. */
  target?: string;
  // `annotateElements` (runner `CaptureRequest.annotate_elements`) is
  // DELIBERATELY omitted: `vision/annotate` rejects it with HTTP 400
  // ("annotate_elements selector is not implemented") and `vision/capture`
  // silently ignores it, so typing it would advertise a request that never
  // does anything. Add it when the runner implements the selector.
}

/** Why a `vision/raw` capture was taken — the runner 400s on anything else. */
export type VisionRawReason = 'vga_grounding' | 'regression_baseline';

/** `vision/raw` request body. */
export interface VisionRawRequest extends VisionInlineOption {
  region?: VisionRegion;
  element?: string;
  /** Audit reason, required: the runner answers 400 when it is absent or unlisted. */
  reason: VisionRawReason;
  /** Frame source: a device / app id. Omitted = the runner's own window. */
  target?: string;
}

/** One captured image written to the runner's vision cache. */
export interface VisionCaptureResult {
  /**
   * Relative HTTP path that serves this capture's bytes:
   * `/ui-bridge/vision/cache/<sha256>`. It works through every door
   * (loopback, relay, remote) — resolve it against the runner base you called.
   * The response never names a host file path.
   */
  url: string;
  /**
   * The encoded image, base64. Present only when the request set
   * `inline: true` (see {@link VisionInlineOption}).
   */
  base64?: string;
  /**
   * Hex sha256 of the route's CACHE KEY, not of the image bytes (for
   * `capture`/`annotate` the key is `v=1|mut=<mutation counter>|req=<request>`;
   * `raw` and `diff` use their own keys). It addresses the cache entry `url`
   * points at.
   */
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
 * `vision/extract` — producer `runner/vision-extract`.
 *
 * - `absent` = the model returned no text at all, OR every block it returned
 *   was whitespace-only or a duplicate — no text survived, and nothing was
 *   dropped for low confidence.
 * - `unknown{below_confidence_floor}` = it returned text and every surviving
 *   block fell under the floor (see `provenance.coverage.unmeasured`).
 * - `unknown{model_reply_unparseable}` = the OCR reply could not be parsed.
 * - `unknown{producer_failed}` = the capture was attempted and failed, or the
 *   OCR call failed (transport, HTTP status, timeout).
 * - An unknown `target` / `element` is a malformed request (HTTP 404), not an
 *   observation.
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
   * The frame as an observation (producer `runner/vision-frame`) — one field,
   * three states, replacing the old `frame` + `frameError` pair. A capture
   * that was attempted and failed is `unknown{producer_failed}`; an unknown
   * `target` never reaches this field — it is an HTTP 404.
   */
  frame: Observation<AnalyzedFrameInfo>;
  /** RFC3339 — when the analyzer finished. Never absent. */
  evaluatedAt: string;
  snapshotAttribution: SnapshotAttribution;
  /** Envelope provenance (producer `vision-core/<analyzer>`). */
  provenance: ObservationProvenance;
}

// ============================================================================
// vision/assert
// ============================================================================

export type AssertionOutcome = 'passed' | 'failed' | 'unknown';

export type TextMatchKind = 'contains' | 'exact' | 'regex';
export type WcagLevel = 'aa' | 'aaa';
export type TypographyDimension = 'font_family' | 'font_size' | 'line_height';

/** An sRGB colour, each channel an integer 0-255 (vision-core `Rgb`). */
export interface VisionRgb {
  r: number;
  g: number;
  b: number;
}

/**
 * A rectangle in an image's NATURAL frame, as fractions (0 to 1) of its width
 * and height (vision-core `NaturalRegion`).
 */
export interface VisionNaturalRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One assertion of the 23-type DSL (vision-core `Assertion`,
 * `rust-vision-core/src/assertions/mod.rs`), echoed back on each result.
 * Variant tags and field names are snake_case on the wire.
 *
 * Integer fields are vision-core's unsigned types (`tolerance_px`,
 * `axis_tolerance_px`, `max_hamming` are `u32`; `ms` is `u64`; `Rgb` channels
 * are `u8`), so a negative or fractional value is refused, as vision-core's
 * deserializer refuses it. On the echo every optional field is present —
 * `null` when it was not given, or its default (`require_overlap: true`,
 * `level: "aa"`, `kind: "contains"`, `dimensions: []`) — because that is how
 * vision-core serializes the variant back.
 *
 * **Breaking** (plan
 * 2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab): the
 * union widened from the 12 types it declared to vision-core's 23, so an
 * exhaustive `switch` over `type` must now handle `settled_within`,
 * `state_entered_within` and the nine image kinds; and `animation_settled` no
 * longer declares `settle_frames`, a count no caller ever supplied.
 * vision-core ignores that key if sent, and so does the SDK's validator.
 * There is no deprecated alias for either.
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
      expected: VisionRgb;
      delta_e_max?: number | null;
    }
  | { type: 'typography_consistent'; elements: string[]; dimensions?: TypographyDimension[] }
  | { type: 'no_layout_shift_since'; baseline: string; tolerance_px?: number | null }
  | { type: 'no_clipping'; region?: VisionRegion | null }
  | { type: 'animation_settled'; region?: VisionRegion | null }
  | { type: 'settled_within'; ms: number }
  | { type: 'state_entered_within'; state: string; ms: number }
  | { type: 'contrast_meets_wcag'; element: string; level?: WcagLevel }
  | {
      type: 'image_palette_within';
      element: string;
      palette: VisionRgb[];
      max_delta_e?: number | null;
      min_coverage?: number | null;
    }
  | { type: 'no_near_duplicate_images'; max_hamming?: number | null }
  | { type: 'no_placeholder_images'; element?: string | null }
  | { type: 'image_focal_visible'; element: string; focal: VisionNaturalRegion }
  | { type: 'transparent_image_legible'; element: string; min_ratio?: number | null }
  | { type: 'salience_order'; cta_id: string }
  | { type: 'image_sharpness_at_least'; element: string; min_sharpness?: number | null }
  | { type: 'image_blockiness_within'; element: string; max_blockiness?: number | null }
  | { type: 'text_over_image_contrast'; min_ratio?: number | null; percentile?: number | null };

/** Every {@link VisionAssertion} `type`, in vision-core's declaration order. */
export type VisionAssertionKind = VisionAssertion['type'];

/** One evaluated assertion. */
export interface VisionAssertionResult {
  /** `outcome === "passed"`. `unknown` is NOT a pass. */
  passed: boolean;
  outcome: AssertionOutcome;
  /** Why the assertion could not be evaluated. Present iff `outcome === "unknown"`. */
  code?: UnknownCode;
  detail?: string;
  /** Always sent: finite in `[0, 1]`, or `null` = a deduction, not an estimate. */
  confidence: number | null;
  assertion: VisionAssertion;
}

/**
 * `vision/assert`.
 *
 * Two producers answer it. The runner evaluates vision-core over a
 * caller-supplied snapshot (producer `vision-core/assertions`). The SDK
 * (`createRelayHandlers` / `createHandlers`, no runner) measures the live tab
 * and evaluates the five snapshot-reading kinds — `contrast_meets_wcag`,
 * `text_fits_container`, `no_overlap`, `element_above`, `no_clipping` — with a
 * port of vision-core (producer `sdk/vision-assertions`). Every other kind is
 * answered per result with `unknown{capability_unavailable_in_build}`: never
 * refused, never passed. The SDK captures no frame, so its `frame` is
 * `unknown{capability_unavailable_in_build}`.
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
  /**
   * Roll-up with fixed precedence failed > unknown > passed. An EMPTY
   * assertion list is `unknown` with `unknownCodes: ["no_results"]`, never
   * `passed`.
   */
  outcome: AssertionOutcome;
  /**
   * The distinct codes of the `unknown` results, in first-seen order;
   * `["no_results"]` for an empty assertion list, `[]` when nothing was
   * unknown. The shape of vision-core's shared outcome fold. The SDK always
   * sends it; a runner serves it only from the build carrying plan
   * 2026-11-07-the-runner-vision-assert-reads-an-empty-assertion-list-as-unknown.
   */
  unknownCodes?: UnknownCode[];
  /**
   * The frame this call captured, as an observation (producer
   * `runner/vision-frame`; no assertion reads it). Same codes as on analyze:
   * attempted-and-failed capture → `producer_failed`; an unknown `target` is
   * an HTTP 404. The SDK's in-tab evaluator captures none:
   * `unknown{capability_unavailable_in_build}`.
   */
  frame: Observation<AnalyzedFrameInfo>;
  /**
   * Present exactly when a snapshot was supplied (runner), or — from the
   * SDK — counted over the elements the tab measured.
   */
  coverage?: SnapshotCoverage;
  /** RFC3339 — when the assertions finished evaluating. Never absent. */
  evaluatedAt: string;
  snapshotAttribution: SnapshotAttribution;
  /**
   * Envelope provenance (producer `vision-core/assertions` from the runner,
   * `sdk/vision-assertions` from the SDK).
   */
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
