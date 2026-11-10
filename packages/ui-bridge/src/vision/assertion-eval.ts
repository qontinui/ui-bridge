/**
 * The vision assertion evaluator, ported from vision-core: a PURE function of
 * a measured snapshot. No DOM, no I/O.
 *
 * vision-core (`qontinui-schemas` `rust-vision-core/src/assertions/mod.rs`) is
 * the reference model, and this is a port of it, not a second model. Served
 * `domain_spec/ui-bridge` behaviour (7) forbids a second, differently shaped
 * model: the runner path and the relay path must give the same answer for the
 * same element. The port is held to vision-core by the conformance fixture
 * vision-core owns (`rust-vision-core/tests/fixtures/
 * vision_assertions_conformance.json`, vendored to `./conformance/` by
 * `scripts/sync-vision-conformance.mjs`): {@link evalInputFromVisionCoreSnapshot}
 * reads a fixture case's ElementSnapshot into the {@link VisionEvalInput} this
 * module evaluates, and every case must come out with vision-core's outcome
 * and code. Where a case and this port disagree, the port is wrong.
 *
 * Two layers sit on top of this one:
 *  - `./dom-assertions` MEASURES the live tab into a {@link VisionEvalInput} —
 *    the in-tab producer of the snapshot vision-core reads — and then calls
 *    {@link evaluateVisionAssertion}.
 *  - the conformance test feeds it vision-core snapshots through the adapter.
 *
 * The measured model is vision-core's `Element`, plus four things the tab can
 * measure that a snapshot cannot carry, each of which a vision-core snapshot
 * maps onto exactly:
 *  - `fitBox` — the box `text_fits_container` compares the scroll extents
 *    against. The tab measures the nearest block box's client (padding) box;
 *    a snapshot has only `bbox`, which the adapter uses.
 *  - `clip` — the clip `no_clipping` checks an element against. The tab
 *    measures the padding box of the nearest ancestor that clips each axis; a
 *    snapshot has only `parent_id`, whose bbox the adapter uses, as vision-core
 *    does.
 *  - `paintOrder` evidence for `element_above`, from the tab's hit test
 *    (`document.elementsFromPoint`). A snapshot carries `occluded_by` and
 *    `z_index` instead, which are consulted exactly as vision-core consults
 *    them.
 *  - `unmeasured` reasons, so an `unknown` from the tab names what it could
 *    not measure (a background image under the text, no block box) instead of
 *    a generic "the snapshot carries no bg_color".
 *
 * Five kinds are evaluated here — the five that read only a snapshot and that
 * the tab can measure: `contrast_meets_wcag`, `text_fits_container`,
 * `no_overlap`, `element_above`, `no_clipping`. Every other kind answers
 * `unknown{capability_unavailable_in_build}`, naming where it IS evaluated.
 */

import { contrastRatio } from '../specs/color-utils';
import type { UnknownCode } from '../observation/observation';
import type {
  AssertionOutcome,
  SnapshotCoverage,
  VisionAssertion,
  VisionAssertionKind,
  VisionAssertionResult,
  VisionRegion,
  VisionRgb,
  WcagLevel,
} from './wire';

// ============================================================================
// The measured model
// ============================================================================

/** The five kinds the in-tab evaluator implements. */
export const IN_TAB_ASSERTION_KINDS = [
  'contrast_meets_wcag',
  'text_fits_container',
  'no_overlap',
  'element_above',
  'no_clipping',
] as const satisfies readonly VisionAssertionKind[];

export type InTabAssertionKind = (typeof IN_TAB_ASSERTION_KINDS)[number];

/** Is `kind` one the in-tab evaluator implements? */
export function isInTabAssertionKind(kind: VisionAssertionKind): kind is InTabAssertionKind {
  return (IN_TAB_ASSERTION_KINDS as readonly string[]).includes(kind);
}

/** Why a value an assertion reads could not be measured. */
export interface MeasuredUnknown {
  code: UnknownCode;
  /** Names what was not measured and why. */
  detail: string;
}

/**
 * The clip `no_clipping` checks an element's box against: the padding box of
 * the nearest ancestor that clips each axis. An axis no ancestor clips is
 * unbounded (`±Infinity`). `byX` / `byY` complete "extends past …" for the
 * failure detail.
 */
export interface ClipBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  byX: string;
  byY: string;
}

/**
 * One element as the evaluator sees it: vision-core's `Element`
 * (`element_snapshot.rs`), camelCase, plus the tab-measured fields described
 * in the module doc. Every field is optional because a producer may not
 * measure it, and an unmeasured field is UNKNOWN to the evaluator, never zero.
 */
export interface MeasuredElement {
  id: string;
  /** Border box in CSS pixels, viewport coordinates (vision-core `bbox`). */
  bbox?: VisionRegion;
  /** Visible text, scrubbed by its redaction verdict (vision-core `text`). */
  text?: string;
  /** vision-core `interactable`; counted by {@link snapshotCoverageOf} only. */
  interactable?: boolean;
  /** The text colour as painted, composited onto the backdrop (vision-core `fg_color`). */
  fgColor?: VisionRgb;
  /** The opaque backdrop the text renders against (vision-core `bg_color`). */
  bgColor?: VisionRgb;
  fontSizePx?: number;
  /** Numeric font weight (vision-core `font_weight`, added by the large-text rule). */
  fontWeight?: number;
  lineHeightPx?: number;
  /** vision-core `z_index`: a GLOBAL paint rank, never a CSS `z-index`. */
  zIndex?: number;
  /** vision-core `occluded_by`: the producer's attributed occluder. */
  occludedBy?: string;
  /**
   * Laid-out content width in the same border-box terms as the box it is
   * compared with (vision-core `scroll_width_px`).
   */
  scrollWidthPx?: number;
  /** Laid-out content height, likewise (vision-core `scroll_height_px`). */
  scrollHeightPx?: number;
  /** vision-core `text_overflow`; sharpens a finding's wording only. */
  textOverflow?: string;
  /**
   * The box the scroll extents are compared against: the border box of the
   * box the text lays out in, its size `Math.ceil`'d (the producer contract).
   * The tab measures the nearest block box, which for an inline element is
   * an ancestor, so it cannot be the element's own `bbox`; absent, `bbox` is
   * used, as vision-core compares a snapshot's `scroll_width_px` with
   * `bbox.w`. Kept apart from `bbox` on purpose: a ceil'd size is the right
   * rounding for a fit (an integer extent never fails against a fractional
   * box) and the wrong one for geometry (it inflates every box, so adjacent
   * fractional boxes would read as overlapping), so `bbox` stays exact.
   */
  fitBox?: { w: number; h: number };
  /**
   * The clip `no_clipping` checks this element against. `undefined`: the
   * element's clip ancestry was not measured (a snapshot without `parent_id`).
   * `null`: measured, and nothing clips it (or its clip ancestor has no box).
   */
  clip?: ClipBounds | null;
  /** What the tab could not measure, per facet, so an unknown can name it. */
  unmeasured?: {
    /** `contrast_meets_wcag`: why `fgColor` / `bgColor` are absent. */
    color?: MeasuredUnknown;
    /** `text_fits_container`: why the scroll extents are absent. */
    textFit?: MeasuredUnknown;
  };
}

/** The tab's hit-test evidence for one `element_above` pair. */
export type PaintOrderEvidence =
  /** `elements[0]` painted above `elements[1]` at every sample point that showed both. */
  | { kind: 'above'; samples: number }
  /** At `at`, `elements[1]` painted above `elements[0]`. */
  | { kind: 'below'; at: { x: number; y: number }; samples: number }
  /** Both operands are one element. */
  | { kind: 'equal' }
  /** The hit test could not show both elements at any point. */
  | { kind: 'unmeasurable'; detail: string };

/** What {@link evaluateVisionAssertion} reads: a measured snapshot. */
export interface VisionEvalInput {
  /** In snapshot order; `no_clipping` reports the first offender in this order. */
  elements: readonly MeasuredElement[];
  /** `element_above` hit-test evidence, keyed by {@link paintOrderKey}. */
  paintOrder?: ReadonlyMap<string, PaintOrderEvidence>;
}

/** The {@link VisionEvalInput.paintOrder} key for `[above, below]`. */
export function paintOrderKey(above: string, below: string): string {
  return `${above}\u0000${below}`;
}

// ============================================================================
// Results
// ============================================================================

function result(
  assertion: VisionAssertion,
  outcome: AssertionOutcome,
  detail: string | undefined,
  code?: UnknownCode
): VisionAssertionResult {
  return {
    passed: outcome === 'passed',
    outcome,
    ...(code !== undefined ? { code } : {}),
    ...(detail !== undefined ? { detail } : {}),
    // Every verdict here is a deduction over exact inputs: no estimated input
    // reaches it (vision-core `AssertionResult::confidence`), and the key is
    // always sent, as `null`.
    confidence: null,
    assertion,
  };
}

const pass = (a: VisionAssertion, detail?: string): VisionAssertionResult =>
  result(a, 'passed', detail);
const fail = (a: VisionAssertion, detail: string): VisionAssertionResult =>
  result(a, 'failed', detail);
const unknown = (a: VisionAssertion, code: UnknownCode, detail: string): VisionAssertionResult =>
  result(a, 'unknown', detail, code);

/**
 * vision-core `missing_operand`: an operand the snapshot does not contain is
 * an UNKNOWN — a wrong id is the author's, an unregistered surface the
 * producer's.
 */
function missingOperand(id: string, consequence: string): string {
  return (
    `element '${id}' is not in the snapshot, so ${consequence}. Either the id is wrong, or ` +
    'the surface is not registered with the producer.'
  );
}

/** A number for a detail line: integers as-is, anything else to two places. */
function px(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// ============================================================================
// Geometry (vision-core `element_snapshot.rs`)
// ============================================================================

/** Any overlap at all; touching edges do not overlap. */
function regionsOverlap(a: VisionRegion, b: VisionRegion): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function intersection(a: VisionRegion, b: VisionRegion): VisionRegion | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return x < right && y < bottom ? { x, y, w: right - x, h: bottom - y } : null;
}

/** vision-core `inset_region`: the inset is bounded by half each extent (floored, as `u32 / 2`). */
function insetRegion(r: VisionRegion, inset: number): VisionRegion {
  const i = Math.min(inset, Math.floor(r.w / 2), Math.floor(r.h / 2));
  return { x: r.x + i, y: r.y + i, w: r.w - 2 * i, h: r.h - 2 * i };
}

// ============================================================================
// The evaluator
// ============================================================================

/** First element per id, as vision-core's `ElementSnapshot::get` finds it. */
function indexById(input: VisionEvalInput): Map<string, MeasuredElement> {
  const byId = new Map<string, MeasuredElement>();
  for (const el of input.elements) if (!byId.has(el.id)) byId.set(el.id, el);
  return byId;
}

const NO_SNAPSHOT = 'no ElementSnapshot supplied, so this assertion was never evaluated';

/**
 * Evaluate one validated assertion against a measured snapshot, or against
 * none (`null`: every snapshot-reading kind is then `unknown{input_missing}`,
 * vision-core `require_snapshot`). Pure.
 */
export function evaluateVisionAssertion(
  assertion: VisionAssertion,
  input: VisionEvalInput | null
): VisionAssertionResult {
  if (!isInTabAssertionKind(assertion.type)) return notInTab(assertion);
  if (input === null) return unknown(assertion, 'input_missing', NO_SNAPSHOT);
  const byId = indexById(input);
  switch (assertion.type) {
    case 'no_overlap':
      return evalNoOverlap(assertion, byId);
    case 'element_above':
      return evalElementAbove(assertion, byId, input.paintOrder);
    case 'text_fits_container':
      return evalTextFits(assertion, byId);
    case 'no_clipping':
      return evalNoClipping(assertion, input);
    case 'contrast_meets_wcag':
      return evalContrast(assertion, byId);
    default:
      return notInTab(assertion);
  }
}

/** A kind the in-tab evaluator does not implement: unknown, never refused, never passed. */
function notInTab(assertion: VisionAssertion): VisionAssertionResult {
  return unknown(
    assertion,
    'capability_unavailable_in_build',
    `\`${assertion.type}\` is not one of the five kinds the in-tab evaluator implements ` +
      `(${IN_TAB_ASSERTION_KINDS.join(', ')}), so it was not evaluated here. vision-core ` +
      'evaluates it: send the assertion to the runner (POST /ui-bridge/vision/assert), or ' +
      'evaluate it runner-less with `vision-audit assert` over an ElementSnapshot.'
  );
}

type Of<K extends VisionAssertionKind> = Extract<VisionAssertion, { type: K }>;

function evalNoOverlap(a: Of<'no_overlap'>, byId: Map<string, MeasuredElement>) {
  const [id0, id1] = a.elements;
  const e0 = byId.get(id0);
  if (!e0) return unknown(a, 'input_missing', missingOperand(id0, 'the pair was never compared'));
  const e1 = byId.get(id1);
  if (!e1) return unknown(a, 'input_missing', missingOperand(id1, 'the pair was never compared'));
  const noGeometry = (id: string) =>
    `element '${id}' carries no geometry (bbox), so overlap was never measured`;
  if (!e0.bbox) return unknown(a, 'input_missing', noGeometry(id0));
  if (!e1.bbox) return unknown(a, 'input_missing', noGeometry(id1));
  const tol = a.tolerance_px ?? 0;
  if (regionsOverlap(insetRegion(e0.bbox, tol), e1.bbox)) {
    const i = intersection(e0.bbox, e1.bbox);
    const area = i ? i.w * i.h : 0;
    return fail(a, `${id0} and ${id1} overlap by ${px(area)} px² (tolerance ${tol} px)`);
  }
  return pass(a);
}

/**
 * vision-core `eval_element_above`. Check order is load-bearing: operands,
 * then (when required) geometry, then ordering evidence — so an author who
 * named two disjoint elements hears about THAT. Evidence in precedence: the
 * producer's `occluded_by` attribution, then the tab's hit test, then the
 * resolved `z_index` rank, then unknown.
 */
function evalElementAbove(
  a: Of<'element_above'>,
  byId: Map<string, MeasuredElement>,
  paintOrder: ReadonlyMap<string, PaintOrderEvidence> | undefined
) {
  const [aboveId, belowId] = a.elements;
  const tag = `element_above[${aboveId}, ${belowId}]`;
  const above = byId.get(aboveId);
  if (!above) {
    return unknown(a, 'input_missing', missingOperand(aboveId, 'no ordering verdict was reached'));
  }
  const below = byId.get(belowId);
  if (!below) {
    return unknown(a, 'input_missing', missingOperand(belowId, 'no ordering verdict was reached'));
  }

  const requireOverlap = a.require_overlap ?? true;
  if (requireOverlap) {
    if (!above.bbox || !below.bbox) {
      const which =
        !above.bbox && !below.bbox
          ? `both '${aboveId}' and '${belowId}'`
          : !above.bbox
            ? `'${aboveId}'`
            : `'${belowId}'`;
      return unknown(
        a,
        'input_missing',
        `${tag}: no geometry (bbox) on ${which}, so the required overlap could not be checked. ` +
          'Set `require_overlap: false` to assert stacking order without it.'
      );
    }
    if (!regionsOverlap(above.bbox, below.bbox)) {
      return fail(
        a,
        `${tag}: the two elements do not overlap, so which one paints on top is not a question ` +
          'they answer. Set `require_overlap: false` if the ordering matters anyway.'
      );
    }
  }

  // The producer's own attribution — strongest evidence, answers both ways.
  if (below.occludedBy === aboveId) {
    return pass(a, `${tag}: confirmed by the producer's own attribution (\`occluded_by\`)`);
  }
  if (above.occludedBy === belowId) {
    return fail(
      a,
      `${tag}: the producer attributed the occlusion the OTHER WAY — '${aboveId}' is ` +
        `occluded_by '${belowId}', so '${belowId}' paints on top.`
    );
  }

  // The tab's hit test: the paint order the browser itself reports.
  const evidence = paintOrder?.get(paintOrderKey(aboveId, belowId));
  if (evidence) {
    switch (evidence.kind) {
      case 'above':
        return pass(
          a,
          `${tag}: '${aboveId}' paints above '${belowId}' at all ${evidence.samples} sample ` +
            "point(s) where the tab's hit test (document.elementsFromPoint) found both"
        );
      case 'below':
        return fail(
          a,
          `${tag}: at (${px(evidence.at.x)}, ${px(evidence.at.y)}) the tab's hit test ` +
            `(document.elementsFromPoint) finds '${belowId}' painted above '${aboveId}'`
        );
      case 'equal':
        return fail(
          a,
          `${tag}: both operands are the same element, so neither paints above the other`
        );
      case 'unmeasurable':
        return unknown(a, 'hit_test_unmeasurable', `${tag}: ${evidence.detail}`);
    }
  }

  // The producer's RESOLVED, GLOBAL paint rank.
  const az = above.zIndex;
  const bz = below.zIndex;
  if (az === undefined || bz === undefined) {
    const which =
      az === undefined && bz === undefined
        ? `both '${aboveId}' and '${belowId}'`
        : az === undefined
          ? `'${aboveId}'`
          : `'${belowId}'`;
    return unknown(
      a,
      'input_missing',
      `${tag}: CANNOT ANSWER — no ordering verdict was reached. Neither element carries an ` +
        `\`occluded_by\` attribution, and \`z_index\` is missing on ${which}. Reported as ` +
        '`unknown`, not as a failure: nothing was measured, so nothing is known — and not as a ' +
        'pass either, because a vacuous pass would silently hide the very stacking bug this ' +
        "assertion exists to catch. Note `z_index` is the producer's RESOLVED, GLOBAL paint " +
        'rank: a raw CSS `z-index` value is NOT a substitute and must not be projected in its place.'
    );
  }
  if (az === bz) {
    return fail(
      a,
      `${tag}: EQUAL resolved stacking order (z_index ${az} on both), so neither paints above ` +
        'the other. At equal z the painting order falls to document order, which a snapshot ' +
        'does not carry reliably.'
    );
  }
  if (az < bz) {
    return fail(
      a,
      `${tag}: '${aboveId}' paints BELOW '${belowId}' (resolved z_index ${az} < ${bz}).`
    );
  }
  return pass(a, `${tag}: resolved z_index ${az} > ${bz}`);
}

/**
 * vision-core `eval_text_fits`, with the measured vertical arm and the
 * unmeasured-arm rule of plan 2026-11-09 Phase 0: an arm that measured
 * nothing is `unknown{input_missing}`, never a qualified pass.
 */
function evalTextFits(a: Of<'text_fits_container'>, byId: Map<string, MeasuredElement>) {
  const id = a.element;
  const el = byId.get(id);
  if (!el) return unknown(a, 'input_missing', missingOperand(id, 'text fit was never checked'));
  // No text is nothing to fit: unknown, never a vacuous pass (plan 2026-11-09
  // Phase 0, revised on review).
  if (el.text === undefined) {
    return unknown(
      a,
      'input_missing',
      `element '${id}' carries no text, so there is no text to fit and nothing was checked`
    );
  }
  const bbox = el.bbox;
  if (!bbox) {
    return unknown(
      a,
      'input_missing',
      `element '${id}' carries no geometry (bbox), so text fit was never checked`
    );
  }
  if (el.unmeasured?.textFit) {
    return unknown(a, el.unmeasured.textFit.code, el.unmeasured.textFit.detail);
  }
  const box = el.fitBox ?? { w: bbox.w, h: bbox.h };

  // Horizontal: a measurement (the laid-out width against the box).
  const sw = el.scrollWidthPx;
  if (sw !== undefined && sw > box.w) {
    const how =
      el.textOverflow === 'ellipsis'
        ? 'ellipsised'
        : el.textOverflow === 'clip'
          ? 'clipped'
          : 'truncated';
    return fail(
      a,
      `text is ${how}: content is ${px(sw)}px wide but the box is only ${px(box.w)}px ` +
        `(${px(sw - box.w)}px hidden). Full text: ${JSON.stringify((el.text ?? '').trim())}`
    );
  }

  // Vertical: measured when the producer sent the laid-out height — and then
  // the measurement decides alone — else vision-core's estimate from the font
  // size, else not at all.
  const sh = el.scrollHeightPx;
  let vertical: 'measured' | 'estimated' | 'unmeasured' = 'unmeasured';
  if (sh !== undefined) {
    if (sh > box.h) {
      return fail(
        a,
        `text overflows vertically: content is ${px(sh)}px tall but the box is only ` +
          `${px(box.h)}px (${px(sh - box.h)}px hidden). Full text: ` +
          JSON.stringify((el.text ?? '').trim())
      );
    }
    vertical = 'measured';
  } else if (el.fontSizePx !== undefined) {
    // `(size * 1.5).ceil() as u32` on vision-core's `f32`: computed in f32,
    // and a negative product saturates to 0.
    const needed = Math.max(0, Math.ceil(Math.fround(Math.fround(el.fontSizePx) * 1.5)));
    if (bbox.h < needed) {
      return fail(
        a,
        `element height ${px(bbox.h)} px is less than ~1.5×${px(el.fontSizePx)}px font ` +
          `(${needed} px expected) — text likely clipped`
      );
    }
    vertical = 'estimated';
  }

  // Neither arm failed. Pass only when both of them looked.
  const horizontalMeasured = sw !== undefined;
  if (horizontalMeasured && vertical === 'measured') return pass(a);
  if (horizontalMeasured && vertical === 'estimated') {
    return pass(
      a,
      'horizontal fit measured; vertical fit ESTIMATED from the font size (~1.5x), because ' +
        'the snapshot carries no `scroll_height_px` for this element'
    );
  }
  const unmeasured = [
    horizontalMeasured ? null : 'horizontal fit (no `scroll_width_px`)',
    vertical === 'unmeasured'
      ? 'vertical fit (neither `scroll_height_px` nor `font_size_px`)'
      : null,
  ].filter((s): s is string => s !== null);
  return unknown(
    a,
    'input_missing',
    `element '${id}': the snapshot does not measure its ${unmeasured.join(' or its ')}, so ` +
      'that was never checked, and nothing it did measure failed'
  );
}

/** Whether `inner` lies within `clip` (vision-core `region_contains`). */
function within(inner: VisionRegion, clip: ClipBounds): boolean {
  return (
    inner.x >= clip.left &&
    inner.y >= clip.top &&
    inner.x + inner.w <= clip.right &&
    inner.y + inner.h <= clip.bottom
  );
}

/**
 * vision-core `eval_no_clipping`, with plan 2026-11-09 Phase 0's rule: a pair
 * is COMPARED only when the child is in scope, has a box, and its clip
 * (vision-core: its `parent_id`'s bbox) is known. Zero compared pairs answers
 * nothing, so it is `unknown{input_missing}` rather than a vacuous pass —
 * whether no element carries a parent, none in scope does, or none has a box.
 */
function evalNoClipping(a: Of<'no_clipping'>, input: VisionEvalInput) {
  const scope = a.region ?? null;
  let compared = 0;
  for (const el of input.elements) {
    const box = el.bbox;
    const clip = el.clip;
    if (!box || !clip) continue;
    if (scope && !regionsOverlap(scope, box)) continue;
    compared += 1;
    if (!within(box, clip)) {
      const horizontal = box.x < clip.left || box.x + box.w > clip.right;
      const vertical = box.y < clip.top || box.y + box.h > clip.bottom;
      const by =
        horizontal && vertical && clip.byX !== clip.byY
          ? `${clip.byX} and ${clip.byY}`
          : horizontal
            ? clip.byX
            : clip.byY;
      return fail(a, `element '${el.id}' extends past ${by}`);
    }
  }
  if (compared === 0) {
    return unknown(
      a,
      'input_missing',
      `no child/parent pair was compared: no element${scope ? ' in the region' : ''} has both ` +
        'a box and a clip ancestor (vision-core: a `parent_id` element) with a box, so nothing ' +
        'was checked'
    );
  }
  return pass(a);
}

/**
 * WCAG 2 large-scale text (vision-core `TextScale::of`): at least 18pt (24
 * CSS px), or at least 14pt (taken at 18.66 CSS px) bold (weight 700 or
 * more). An unmeasured size or weight never makes text large — that is the
 * lenient direction. The comparisons run on vision-core's `f32`, so they are
 * made on `Math.fround` values here, and an input at a threshold's `f32`
 * rounding boundary lands on the same side in both.
 */
export function isLargeText(
  fontSizePx: number | undefined,
  fontWeight: number | undefined
): boolean {
  if (fontSizePx === undefined) return false;
  const size = Math.fround(fontSizePx);
  const bold = fontWeight !== undefined && Math.fround(fontWeight) >= Math.fround(700);
  return size >= Math.fround(24) || (bold && size >= Math.fround(18.66));
}

/** The WCAG minimum contrast ratio for a level and text size. */
export function wcagMinimumRatio(level: WcagLevel, largeText: boolean): number {
  if (level === 'aaa') return largeText ? 4.5 : 7;
  return largeText ? 3 : 4.5;
}

function evalContrast(a: Of<'contrast_meets_wcag'>, byId: Map<string, MeasuredElement>) {
  const id = a.element;
  const el = byId.get(id);
  if (!el) return unknown(a, 'input_missing', missingOperand(id, 'contrast was never computed'));
  const fg = el.fgColor;
  const bg = el.bgColor;
  if (!fg || !bg) {
    if (el.unmeasured?.color) {
      return unknown(a, el.unmeasured.color.code, el.unmeasured.color.detail);
    }
    const which = !fg && !bg ? '`fg_color` and `bg_color`' : !fg ? '`fg_color`' : '`bg_color`';
    return unknown(
      a,
      'input_missing',
      `the snapshot carries no ${which} for this element, so contrast was never computed`
    );
  }
  const ratio = contrastRatio({ ...fg, a: 1 }, { ...bg, a: 1 });
  const level = a.level ?? 'aa';
  const large = isLargeText(el.fontSizePx, el.fontWeight);
  const needed = wcagMinimumRatio(level, large);
  const levelName = level === 'aaa' ? 'Aaa' : 'Aa';
  const scale = large ? 'large' : 'normal';
  if (ratio < needed) {
    return fail(
      a,
      `contrast ratio ${ratio.toFixed(2)}:1 below WCAG ${levelName} minimum ` +
        `${needed.toFixed(1)}:1 for ${scale} text`
    );
  }
  return pass(
    a,
    `contrast ratio ${ratio.toFixed(2)}:1 (WCAG ${levelName} needs ${needed.toFixed(1)}:1 for ` +
      `${scale} text)`
  );
}

// ============================================================================
// Roll-up and coverage
// ============================================================================

/** The roll-up of a result list: the shape of vision-core's shared outcome fold. */
export interface FoldedVisionOutcome {
  outcome: AssertionOutcome;
  outcomeCounts: { passed: number; failed: number; unknown: number };
  /** Distinct codes of the unknown results, first-seen order; `["no_results"]` for none. */
  unknownCodes: UnknownCode[];
}

/**
 * Fold results with fixed precedence failed > unknown > passed. An EMPTY list
 * is `unknown` with `["no_results"]` — nothing was judged, so it is never a
 * pass. Kept to this one function so it can be swapped for the shared
 * `foldOutcomes` when plan
 * 2026-11-07-the-runner-vision-assert-reads-an-empty-assertion-list-as-unknown
 * lands its SDK half; it mirrors vision-core's `fold_results`
 * (`assertions/fold.rs`, qontinui-schemas#308).
 */
export function foldVisionOutcomes(
  results: readonly Pick<VisionAssertionResult, 'outcome' | 'code'>[]
): FoldedVisionOutcome {
  const outcomeCounts = { passed: 0, failed: 0, unknown: 0 };
  if (results.length === 0) {
    return { outcome: 'unknown', outcomeCounts, unknownCodes: ['no_results'] };
  }
  const unknownCodes: UnknownCode[] = [];
  for (const r of results) {
    outcomeCounts[r.outcome] += 1;
    if (r.outcome === 'unknown' && r.code !== undefined && !unknownCodes.includes(r.code)) {
      unknownCodes.push(r.code);
    }
  }
  const outcome: AssertionOutcome =
    outcomeCounts.failed > 0 ? 'failed' : outcomeCounts.unknown > 0 ? 'unknown' : 'passed';
  return { outcome, outcomeCounts, unknownCodes };
}

/** vision-core `SnapshotCoverage::of`: presence counts over the measured elements. */
export function snapshotCoverageOf(elements: readonly MeasuredElement[]): SnapshotCoverage {
  const c: SnapshotCoverage = {
    elements: elements.length,
    withGeometry: 0,
    withStacking: 0,
    withText: 0,
    interactable: 0,
  };
  for (const el of elements) {
    if (el.bbox) c.withGeometry += 1;
    if (el.zIndex !== undefined) c.withStacking += 1;
    if (el.text !== undefined) c.withText += 1;
    if (el.interactable === true) c.interactable += 1;
  }
  return c;
}

// ============================================================================
// The vision-core snapshot adapter
// ============================================================================

/** Thrown when a vision-core ElementSnapshot JSON does not have vision-core's shape. */
export class VisionCoreSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionCoreSnapshotError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optNumber(raw: Record<string, unknown>, key: string, where: string): number | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new VisionCoreSnapshotError(`${where}.${key} is not a number`);
  }
  return v;
}

function optString(raw: Record<string, unknown>, key: string, where: string): string | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new VisionCoreSnapshotError(`${where}.${key} is not a string`);
  return v;
}

function optRegion(
  raw: Record<string, unknown>,
  key: string,
  where: string
): VisionRegion | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (!isRecord(v) || [v.x, v.y, v.w, v.h].some((n) => typeof n !== 'number')) {
    throw new VisionCoreSnapshotError(`${where}.${key} is not a region { x, y, w, h }`);
  }
  return { x: v.x as number, y: v.y as number, w: v.w as number, h: v.h as number };
}

function optRgb(raw: Record<string, unknown>, key: string, where: string): VisionRgb | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (!isRecord(v) || [v.r, v.g, v.b].some((n) => typeof n !== 'number')) {
    throw new VisionCoreSnapshotError(`${where}.${key} is not a colour { r, g, b }`);
  }
  return { r: v.r as number, g: v.g as number, b: v.b as number };
}

/**
 * Read a vision-core `ElementSnapshot` (its serde JSON: snake_case element
 * fields, `snapshotId`) into the evaluator's input. `null` / `undefined` is
 * "no snapshot supplied". Throws {@link VisionCoreSnapshotError} on a shape
 * vision-core would not deserialize.
 *
 * The mapping is the identity on every field vision-core's five kinds read,
 * plus the two vision-core semantics the measured model generalizes:
 * `no_clipping`'s clip is the `parent_id` element's bbox (the LAST element with
 * that id that has one, as vision-core's id → bbox map keeps it; no such
 * element → `null`, which vision-core skips), and the text-fit box is `bbox`.
 */
export function evalInputFromVisionCoreSnapshot(snapshot: unknown): VisionEvalInput | null {
  if (snapshot === undefined || snapshot === null) return null;
  if (!isRecord(snapshot) || !Array.isArray(snapshot.elements)) {
    throw new VisionCoreSnapshotError('an ElementSnapshot is an object with an `elements` array');
  }
  const raws = snapshot.elements as unknown[];
  const bboxById = new Map<string, VisionRegion>();
  raws.forEach((raw, i) => {
    if (!isRecord(raw) || typeof raw.id !== 'string') {
      throw new VisionCoreSnapshotError(`elements[${i}] is not an element with a string id`);
    }
    const bbox = optRegion(raw, 'bbox', `elements[${i}]`);
    if (bbox) bboxById.set(raw.id, bbox);
  });
  const elements = raws.map((value, i): MeasuredElement => {
    const raw = value as Record<string, unknown>;
    const where = `elements[${i}]`;
    const parentId = optString(raw, 'parent_id', where);
    let clip: ClipBounds | null | undefined;
    if (parentId !== undefined) {
      const parentBox = bboxById.get(parentId);
      const by = `its parent '${parentId}'`;
      clip = parentBox
        ? {
            left: parentBox.x,
            top: parentBox.y,
            right: parentBox.x + parentBox.w,
            bottom: parentBox.y + parentBox.h,
            byX: by,
            byY: by,
          }
        : null;
    }
    const interactable = raw.interactable;
    if (interactable !== undefined && typeof interactable !== 'boolean') {
      throw new VisionCoreSnapshotError(`${where}.interactable is not a boolean`);
    }
    const el: MeasuredElement = { id: raw.id as string };
    const bbox = optRegion(raw, 'bbox', where);
    if (bbox) el.bbox = bbox;
    const text = optString(raw, 'text', where);
    if (text !== undefined) el.text = text;
    if (interactable === true) el.interactable = true;
    const fg = optRgb(raw, 'fg_color', where);
    if (fg) el.fgColor = fg;
    const bg = optRgb(raw, 'bg_color', where);
    if (bg) el.bgColor = bg;
    const numbers: Array<[keyof MeasuredElement, string]> = [
      ['fontSizePx', 'font_size_px'],
      ['fontWeight', 'font_weight'],
      ['lineHeightPx', 'line_height_px'],
      ['zIndex', 'z_index'],
      ['scrollWidthPx', 'scroll_width_px'],
      ['scrollHeightPx', 'scroll_height_px'],
    ];
    for (const [field, key] of numbers) {
      const n = optNumber(raw, key, where);
      if (n !== undefined) (el as unknown as Record<string, number>)[field] = n;
    }
    const occludedBy = optString(raw, 'occluded_by', where);
    if (occludedBy !== undefined) el.occludedBy = occludedBy;
    const textOverflow = optString(raw, 'text_overflow', where);
    if (textOverflow !== undefined) el.textOverflow = textOverflow;
    if (clip !== undefined) el.clip = clip;
    return el;
  });
  return { elements };
}
