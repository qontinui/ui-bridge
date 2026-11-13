/**
 * `POST /vision/assert` evaluated in the tab: validate, measure, evaluate.
 *
 * ONE implementation for both SDK transports (the pattern of
 * `specs/quality-request.ts` `evaluateRegisteredQuality`): the relay's
 * browser-side dispatcher (`react/commandHandlers.ts`, `case 'visionAssert'`)
 * and the in-process handlers (`server/handlers.ts`, `visionAssert`) both call
 * {@link evaluateVisionAssertions}, so a relay harness with no runner gets the
 * same answer whichever transport reaches the page.
 *
 * Three layers, kept apart so the evaluation can be pinned to vision-core:
 *  1. `./assertion-request` validates the body (the relay handler also runs it
 *     before dispatch, so a malformed body never reaches a tab);
 *  2. this module MEASURES the live DOM into vision-core's snapshot model —
 *     each element once per request, with one shared `getComputedStyle` cache;
 *  3. `./assertion-eval` evaluates that model with a pure port of vision-core,
 *     which the vendored conformance fixture holds to vision-core case by case.
 *
 * What the tab measures, per kind (plan
 * 2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab, Phase 1):
 *
 * - `contrast_meets_wcag` — the text colour and the opaque backdrop under the
 *   element's first rendered text run, composited bottom-up over the paint
 *   stack at that point: the DOM ancestors, every element
 *   `document.elementsFromPoint` shows beneath the text, and each layer's
 *   `::before` / `::after` background. That hit test retargets shadow
 *   content to its host, so beneath the text a shadow tree's own elements
 *   are read only where they hold the text's slot: an open shadow host
 *   beneath light-DOM text laid over it is read by its own box alone, and a
 *   layer of the tree beside the slot is not seen, whatever either paints
 *   beneath the text. A background image
 *   (gradients included), `filter`, `backdrop-filter`, `mix-blend-mode`,
 *   replaced content (`<img>`, `<video>`, `<canvas>`, …), a layer's border,
 *   scrollbar or inset box-shadow where it reaches the text, the glyphs of a
 *   `::before` / `::after` positioned there, or a
 *   `pointer-events: none` layer the hit test cannot order, anywhere the
 *   text could show it, makes the colour
 *   `unknown{input_missing}`; so does an ancestor with `opacity < 1` that
 *   contains the first opaque layer. A `pointer-events: none` layer is looked
 *   for anywhere on the page, open shadow roots included, by one walk of the
 *   composed tree per request that measures contrast — its background, its
 *   frame, its own text and its `::before` / `::after` alike: one
 *   positioned onto the text from inside an element whose own box misses it
 *   (a fixed scrim in a sticky header) is found too. A translucent colour or
 *   an opacity group above the first opaque layer is composited exactly.
 *   With no opaque layer, the base is the `Canvas` colour under the root's
 *   `color-scheme`. Every layer the hit
 *   test shows ABOVE the text (a scrim, an overlay, a sheet), open shadow
 *   roots included, is read too: a plain translucent colour is composited
 *   over the text and its backdrop alike, so a white 80% scrim over black
 *   text is ~1.6:1, not 21:1; one that covers the text (opaque), or paints
 *   over it in a way the DOM cannot read (an image, a filter, a
 *   backdrop-filter, a blend, replaced or generated content, its own text,
 *   its border, a scrollbar or an inset box-shadow over the text, a custom
 *   element with no open shadow root), is `unknown{input_missing}` naming
 *   the layer. A layer listed above for what it paints outside its own box
 *   (a stretched link's `::after` across its card) paints its own
 *   background only inside that box. An outer box-shadow and an outline are
 *   read nowhere: one cast over the text by an element whose box misses it,
 *   and an outline a negative `outline-offset` pulls inside its box, are not
 *   seen. A positioned `::before` / `::after` is read where its 2D transform
 *   (its `transform`, `translate`, `rotate` and `scale`) places it, the
 *   text's point taken into its own box; one in normal flow is looked for
 *   only in its element's box, as its relative offsets and its own transform
 *   move it, so one that overflows that box is not seen past it; one at
 *   `opacity: 0` paints nothing. A transparent one of the text's own element
 *   or of a layer beneath the text, whose box the computed style does not
 *   pin down (one its relative offsets nudge, a 3D transform, a motion
 *   path), is taken to paint nothing, so its glyphs and its frame are not
 *   seen, over the text as well. A click-through `::before` / `::after`
 *   outside its element's box is not seen when the hit test can see that
 *   element, or when its box is not pinned down. An ANCESTOR of the text
 *   the hit test lists above it paints its own box beneath its content, so
 *   only what it draws over the text is read — a positioned `::before` /
 *   `::after` (a stretched link), its open shadow tree's elements above the
 *   text — unless a negative `z-index` sinks the text past it, and then all
 *   of it is a layer above. One listed above with neither (a closed shadow
 *   tree's overlay) is `unknown{input_missing}`. The text's own element
 *   listed twice with layers between — for its text and for its own
 *   positioned `::before` / `::after`, a stretched link under a veil — is
 *   `unknown{hit_test_unmeasurable}`: which listing is the text's is not
 *   known.
 *
 * ROUNDING (plan 2026-11-09 Phase 0's contract): every box below is handed to
 * the evaluator UNROUNDED, and the evaluator rounds it as its kind does —
 * `text_fits_container`'s comparison box UP, the geometry kinds' boxes and
 * clips edge by edge to the NEAREST pixel. Nothing here rounds a box.
 *
 * - `text_fits_container` — a block-level element's `scrollWidth` /
 *   `scrollHeight`, with its borders and scrollbars added back, against its
 *   border box (vision-core's comparison); strictly greater fails. Both sides
 *   are LAYOUT sizes (the used `width` / `height`, `scroll*`, `client*`), so a
 *   CSS transform neither reads as overflow nor rounds one away. An inline
 *   element is measured by its own line fragments (`getClientRects`) against
 *   the content box of the block it lays out in, brought back to layout
 *   pixels by the block's scale, so a sibling's overflow is not its own; when
 *   it exposes no fragment, the block's extents stand in only if it is all
 *   the block holds, else `unknown{input_missing}`. No text is
 *   `unknown{input_missing}`.
 * - `no_overlap` — border boxes (`getBoundingClientRect`), each edge rounded
 *   to the nearest pixel by the evaluator and never up, or adjacent
 *   fractional boxes would read as overlapping.
 * - `element_above` — paint order from `document.elementsFromPoint` at sample
 *   points inside both the pair's intersection and the viewport. The
 *   evaluator never scrolls; no sample showing both is
 *   `unknown{hit_test_unmeasurable}`.
 * - `no_clipping` — each registered element's border box against the padding
 *   box of its nearest ancestor that clips that axis (`overflow-x` /
 *   `overflow-y` of `hidden` or `clip`, or `contain: paint`), following the
 *   containing-block chain, so an absolutely or fixed positioned element is
 *   not checked against an ancestor that does not clip it. A scroll container
 *   (`overflow` `auto` or `scroll`) clips on one side only: content scrolled
 *   out past its far side is reachable, while content past the edge it
 *   scrolls from (its block-start and inline-start edges as `writing-mode`
 *   and `direction` place them: the top and the left by default; in a
 *   vertical writing mode the block-start edge is the right one under
 *   `vertical-rl` and `sideways-rl` and the left one under `vertical-lr` and
 *   `sideways-lr`, and the inline-start edge the top one, the bottom one
 *   under `sideways-lr`; `direction: rtl` moves the inline-start edge to the
 *   opposite side; a reversed flex container swaps them along its reversed
 *   axes) is out of reach at every scroll position, as a badge
 *   pulled above a scroll container's top edge is. So the nearest scroll
 *   container settles that axis with that one edge, and an ancestor further
 *   out is compared with the scroll container's own box instead. The
 *   element set is the registry's — the same set every UI Bridge read and
 *   the runner path see. An element nothing clips is not a compared pair;
 *   zero compared pairs is `unknown{input_missing}`.
 *
 * SECURITY SURFACE: this executes no caller-supplied code. It is a fixed
 * evaluator over a typed, validated assertion list; the only caller input
 * that reaches the DOM is an element id, used as a registry key. It reads the
 * tab and writes nothing to it.
 *
 * REDACTION (§4.6): element text reaches a result only through
 * `scrubContentByVerdict`, against the element's own verdict — inside a
 * `data-bridge-redact` boundary it is `[REDACTED]`. Geometry, colours and ids
 * are not content.
 */

import {
  Observation,
  type ObservationProducer,
  type UnknownCode,
  type UnmeasuredDimension,
} from '../observation/observation';
import { parseColor, type RGBA } from '../specs/color-utils';
import { computeVisibleText, isInteractionBlocked, readInteractionBlockers } from '../core/a11y';
import { classList } from '../core/class-name';
import {
  containsRedactionBoundary,
  REDACTED_VALUE,
  scrubContentByVerdict,
  verdictOf,
} from '../core/redaction';
import { parseVisionAssertRequest } from './assertion-request';
import {
  evaluateVisionAssertion,
  foldVisionOutcomes,
  isInTabAssertionKind,
  paintOrderKey,
  snapshotCoverageOf,
  type ClipBounds,
  type MeasuredElement,
  type MeasuredUnknown,
  type PaintOrderEvidence,
  type VisionEvalInput,
} from './assertion-eval';
import type {
  SnapshotAttribution,
  VisionAssertResponse,
  VisionAssertion,
  VisionAssertionResult,
  VisionRegion,
  VisionRgb,
} from './wire';

declare const __SDK_VERSION__: string;

/** Producer id of the SDK's in-tab vision assertions (never `vision-core/assertions`). */
export const SDK_VISION_ASSERTIONS_PRODUCER_ID = 'sdk/vision-assertions';

/**
 * The registry the evaluation reads. `UIBridgeRegistry` and the in-process
 * handlers' `RegistryLike` both satisfy it.
 */
export interface VisionAssertSource {
  /** Every registered element, in registry order: page-wide `no_clipping`'s element set. */
  getAllElements(): readonly unknown[];
  /** Exact registry lookup of an operand id. */
  getElement(id: string): unknown;
  /** The snapshot whose `snapshotId` attributes the evaluation, when the registry mints one. */
  createSnapshot?(): unknown;
}

export interface EvaluateVisionAssertionsOptions {
  /**
   * Resolve an operand id to its live element. Defaults to the registry
   * lookup. A resolver answering `null` / `undefined` means the operand is not
   * in the snapshot (vision-core's missing operand, `unknown{input_missing}`).
   */
  resolveOperand?: (id: string) => Element | null | undefined;
  /** Clock, for tests. */
  now?: () => number;
}

function sdkVersion(): string {
  return typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'unknown';
}

function producer(): ObservationProducer {
  return { id: SDK_VISION_ASSERTIONS_PRODUCER_ID, version: sdkVersion() };
}

/** A registry element's live DOM element, if it has one. */
function elementOf(registered: unknown): Element | null {
  if (typeof registered !== 'object' || registered === null) return null;
  const el = (registered as { element?: unknown }).element;
  return typeof Element !== 'undefined' && el instanceof Element ? el : null;
}

function registeredId(registered: unknown): string | undefined {
  if (typeof registered !== 'object' || registered === null) return undefined;
  const id = (registered as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

/** The DOM is the thing measured: without one, nothing can be. */
function hasDom(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

/**
 * Validate `request`, measure the tab, and evaluate. Throws
 * `VisionAssertRequestError` (→ `UB-VALIDATION-ERROR`) on a malformed body;
 * every other condition is an ANSWER — an `unknown` result with a code — not
 * a thrown error.
 */
export function evaluateVisionAssertions(
  source: VisionAssertSource,
  request: unknown,
  options: EvaluateVisionAssertionsOptions = {}
): VisionAssertResponse {
  const { assertions } = parseVisionAssertRequest(request);
  const now = options.now ?? Date.now;

  if (!hasDom()) {
    const detail =
      'this handler runs without a DOM (no `document`), so nothing was measured. Serve ' +
      '/vision/assert from the page (the SDK relay), or send the request to the runner ' +
      '(POST /ui-bridge/vision/assert).';
    const results = assertions.map((a) => noDomResult(a, detail));
    return envelope(results, [], { state: 'absent' }, null, now());
  }

  const observedAt = now();
  const attribution = snapshotAttributionOf(source);
  const measurement = new TabMeasurement(source, options.resolveOperand);
  // `no_clipping` reads the whole registry, in registry order: measure it
  // first, so the snapshot's element order IS the registry's and the first
  // offender reported is the one vision-core would report.
  if (assertions.some((a) => a.type === 'no_clipping')) measurement.measureClipsOfRegistry();
  for (const a of assertions) measurement.measureFor(a);
  const input = measurement.input();
  const results = assertions.map((a) => evaluateVisionAssertion(a, input));
  return envelope(results, input.elements, attribution, observedAt, now());
}

function noDomResult(assertion: VisionAssertion, detail: string): VisionAssertionResult {
  // A kind the tab does not implement keeps its own, more specific answer.
  if (!isInTabAssertionKind(assertion.type)) return evaluateVisionAssertion(assertion, null);
  return {
    passed: false,
    outcome: 'unknown',
    code: 'capability_unavailable_in_build',
    detail,
    confidence: null,
    assertion,
  };
}

/** `attributed` with the registry snapshot's id; `unattributed` when none is minted. */
function snapshotAttributionOf(source: VisionAssertSource): SnapshotAttribution {
  if (typeof source.createSnapshot !== 'function') return { state: 'unattributed' };
  try {
    const snapshot = source.createSnapshot();
    const id = (snapshot as { snapshotId?: unknown } | null)?.snapshotId;
    return typeof id === 'string' && id.length > 0
      ? { state: 'attributed', snapshotId: id }
      : { state: 'unattributed' };
  } catch {
    return { state: 'unattributed' };
  }
}

/** The response envelope (`VisionAssertResponse`, `vision/wire.ts`). */
function envelope(
  results: VisionAssertionResult[],
  measured: readonly MeasuredElement[],
  attribution: SnapshotAttribution,
  observedAt: number | null,
  evaluatedAtMs: number
): VisionAssertResponse {
  const fold = foldVisionOutcomes(results);
  const evaluatedAt = new Date(evaluatedAtMs).toISOString();
  const unmeasured = new Map<string, UnmeasuredDimension>();
  for (const r of results) {
    if (r.outcome !== 'unknown' || r.code === undefined) continue;
    const key = `${r.assertion.type}\u0000${r.code}`;
    const entry = unmeasured.get(key);
    if (entry) entry.count += 1;
    else unmeasured.set(key, { dimension: r.assertion.type, count: 1, code: r.code });
  }
  const provenance = Observation.provenance({
    producer: producer(),
    observedAt,
    evaluatedAt: evaluatedAtMs,
    coverage: {
      considered: results.length,
      measured: fold.outcomeCounts.passed + fold.outcomeCounts.failed,
      unmeasured: [...unmeasured.values()],
    },
    confidence: null,
    cache: null,
    source: attribution.state === 'attributed' ? { snapshotId: attribution.snapshotId } : null,
  });
  const frame = Observation.unknown<never>(
    'capability_unavailable_in_build',
    'the in-tab evaluator captures no frame; no assertion it evaluates reads one. The runner ' +
      '(POST /ui-bridge/vision/assert) captures one for the pixel-reading kinds.',
    Observation.provenance({ producer: producer(), evaluatedAt: evaluatedAtMs })
  );
  return {
    results,
    outcomeCounts: fold.outcomeCounts,
    outcome: fold.outcome,
    unknownCodes: fold.unknownCodes,
    frame,
    coverage: snapshotCoverageOf(measured),
    evaluatedAt,
    snapshotAttribution: attribution,
    provenance,
  };
}

// ============================================================================
// DOM helpers
// ============================================================================

/** The parent in the flat (composed) tree: the slot of a slotted node, the host past a shadow root. */
function composedParent(el: Element): Element | null {
  const slot = (el as Element & { assignedSlot?: Element | null }).assignedSlot;
  if (slot) return slot;
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode as (Node & { host?: Element }) | null;
  return root && root.host instanceof Element ? root.host : null;
}

/** `ancestor` is `el` or one of its composed-tree ancestors. */
function containsComposed(ancestor: Element, el: Element): boolean {
  for (let x: Element | null = el; x; x = composedParent(x)) if (x === ancestor) return true;
  return false;
}

/** A border box in viewport CSS pixels, or undefined when the element generates no box. */
function boxOf(el: Element): VisionRegion | undefined {
  if (el.getClientRects().length === 0) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function viewport(): VisionRegion {
  const root = document.documentElement;
  const w = root.clientWidth || window.innerWidth;
  const h = root.clientHeight || window.innerHeight;
  return { x: 0, y: 0, w, h };
}

function intersect(a: VisionRegion, b: VisionRegion): VisionRegion | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return x < right && y < bottom ? { x, y, w: right - x, h: bottom - y } : null;
}

function pointIn(p: { x: number; y: number }, r: VisionRegion): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

/** The smallest upright box holding every one of `boxes` given, or null for none. */
function unionOf(boxes: ReadonlyArray<VisionRegion | undefined>): VisionRegion | null {
  const present = boxes.filter((b): b is VisionRegion => b !== undefined);
  if (present.length === 0) return null;
  const left = Math.min(...present.map((b) => b.x));
  const top = Math.min(...present.map((b) => b.y));
  const right = Math.max(...present.map((b) => b.x + b.w));
  const bottom = Math.max(...present.map((b) => b.y + b.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** `r` grown by `by` on every side. */
function grown(r: VisionRegion, by: number): VisionRegion {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

/**
 * `read`, called once and its answer kept: the page does not change while
 * one request is evaluated, so a layer's geometry is read at most once.
 */
function once<T>(read: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = read();
      done = true;
    }
    return value;
  };
}

/** A resolved `px` length, or NaN. */
function pxValue(v: string): number {
  return v.endsWith('px') ? Number(v.slice(0, -2)) : NaN;
}

/**
 * How far in from the padding box's edge the inset shadows of a computed
 * `box-shadow` can paint: the larger offset plus the blur and the spread,
 * for the widest-reaching inset shadow whose colour is not transparent. 0
 * when there is none. A colour that cannot be read counts as painting.
 */
function insetShadowReach(boxShadow: string): number {
  let reach = 0;
  // The commas between shadows, not the ones inside a colour function.
  for (const shadow of boxShadow.split(/,(?![^(]*\))/)) {
    if (!/\binset\b/.test(shadow)) continue;
    const colour = shadow.match(/[a-z-]+\([^)]*\)|#[0-9a-f]{3,8}\b/i);
    const rgba = colour ? parseColor(colour[0]) : null;
    if (rgba && rgba.a === 0) continue;
    const lengths = (shadow.match(/-?[\d.]+(?:e[+-]?\d+)?px/gi) ?? []).map((v) => pxValue(v) || 0);
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    reach = Math.max(reach, Math.max(Math.abs(x), Math.abs(y)) + blur + Math.max(0, spread));
  }
  return reach;
}

/** An edge-to-edge box in viewport pixels. */
type Edges = { left: number; top: number; right: number; bottom: number };

/** A border box inset by the border widths its style resolves, unscaled. */
function insetByBorders(r: VisionRegion, st: CSSStyleDeclaration): Edges {
  const side = (s: string): number => pxValue(st.getPropertyValue(`border-${s}-width`)) || 0;
  return {
    left: r.x + side('left'),
    top: r.y + side('top'),
    right: r.x + r.w - side('right'),
    bottom: r.y + r.h - side('bottom'),
  };
}

/**
 * What of a box's frame lies at `p`, a point inside its border box, over its
 * background: its border or a scrollbar where `p` lies outside its padding
 * box `pad`, else an inset box-shadow that reaches `p` from the padding
 * box's edge. `scale` turns the shadow's CSS pixels into the viewport's.
 * Null when neither does. Neither is composited: a border's colour is not
 * read and a shadow's blur is not modelled.
 */
function frameAt(
  st: CSSStyleDeclaration,
  pad: Edges,
  scale: number,
  p: { x: number; y: number }
): string | null {
  if (p.x < pad.left || p.x >= pad.right || p.y < pad.top || p.y >= pad.bottom) {
    return 'border or scrollbar';
  }
  const depth = Math.min(p.x - pad.left, pad.right - p.x, p.y - pad.top, pad.bottom - p.y);
  return depth < insetShadowReach(st.boxShadow ?? '') * scale ? 'inset box-shadow' : null;
}

/**
 * Whether a box draws a frame anywhere — a border side with a width and a
 * colour that is not transparent, or an inset box-shadow — for a box whose
 * geometry is not known, so neither is where its frame lies. A colour that
 * cannot be read counts as painting.
 */
function hasFrame(st: CSSStyleDeclaration): boolean {
  const side = (s: string): boolean =>
    (pxValue(st.getPropertyValue(`border-${s}-width`)) || 0) > 0 &&
    parseColor(st.getPropertyValue(`border-${s}-color`))?.a !== 0;
  return ['top', 'right', 'bottom', 'left'].some(side) || insetShadowReach(st.boxShadow ?? '') > 0;
}

/** Whether a box can show a scrollbar: it scrolls on an axis. */
function scrolls(st: CSSStyleDeclaration): boolean {
  return /auto|scroll|overlay/.test(`${st.overflowX} ${st.overflowY}`);
}

/**
 * Where a positioned `::before` / `::after` paints: its border box as laid
 * out before any transform, and `toLocal`, which takes a viewport point to
 * where that point lies in that box's own coordinates (the inverse of its
 * transform; the point itself when there is none), or null where nothing of
 * the box can lie (a transform that flattens it). A point lies in the
 * painted box when its local point lies in `box`, and its frame is read at
 * the local point, so a turned box is read as exactly as an upright one.
 * `bounds` is the upright box in the viewport that holds the painted one,
 * a pixel wider on each side, outside which no point lies in it.
 */
interface PseudoExtent {
  box: VisionRegion;
  bounds: VisionRegion;
  toLocal: (p: { x: number; y: number }) => { x: number; y: number } | null;
}

/**
 * The 2D transform functions a box's computed `translate`, `rotate`, `scale`
 * and `transform` apply, in the order CSS applies them, a percentage
 * `translate` resolved against the box's `size`: '' for none, null for one
 * that is not 2D (a 3D rotation, a z translation or scale, a `matrix3d`) or
 * not read here (a `calc()` translate).
 */
function transformList(st: CSSStyleDeclaration, size: { w: number; h: number }): string | null {
  const value = (prop: string): string[] => {
    const v = st.getPropertyValue(prop).trim();
    return v === '' || v === 'none' ? [] : v.split(/\s+/);
  };
  // A translate length in px; a percentage is of the box's size on its axis.
  const length = (v: string, along: number): string | null => {
    const n = v.endsWith('%') ? (Number(v.slice(0, -1)) * along) / 100 : pxValue(v);
    return Number.isFinite(n) ? `${n}px` : null;
  };
  const fns: string[] = [];
  const t = value('translate');
  if (t.length > 2 && pxValue(t[2]) !== 0) return null;
  if (t.length > 0) {
    const x = length(t[0], size.w);
    const y = length(t[1] ?? '0px', size.h);
    if (x === null || y === null) return null;
    fns.push(`translate(${x}, ${y})`);
  }
  const r = value('rotate');
  if (r.length > 1 && !(r.length === 2 && r[0] === 'z')) return null;
  if (r.length > 0) fns.push(`rotate(${r[r.length - 1]})`);
  const s = value('scale');
  if (s.length > 2 && Number(s[2]) !== 1) return null;
  if (s.length > 0) fns.push(`scale(${s[0]}, ${s[1] ?? s[0]})`);
  const transform = st.transform ?? '';
  if (transform.startsWith('matrix3d')) return null;
  if (transform !== '' && transform !== 'none') fns.push(transform);
  return fns.join(' ');
}

/**
 * `box`, a border box laid out before its transform, with the map from the
 * viewport into its own coordinates: the inverse of its computed
 * `translate`, `rotate`, `scale` and `transform` about its
 * `transform-origin`. Null when that cannot be read here: a motion path
 * (`offset-path`), a 3D transform, a `calc()` translate, one about a box
 * other than the border box (`transform-box`), a value `DOMMatrixReadOnly`
 * does not parse, or no `DOMMatrixReadOnly` at all.
 */
function pseudoExtent(box: VisionRegion, st: CSSStyleDeclaration): PseudoExtent | null {
  const path = st.getPropertyValue('offset-path').trim();
  if (path !== '' && path !== 'none') return null;
  const list = transformList(st, box);
  if (list === null) return null;
  if (list === '') return { box, bounds: grown(box, 1), toLocal: (p) => p };
  const reference = st.getPropertyValue('transform-box').trim();
  if (reference === 'content-box' || reference === 'fill-box') return null;
  if (typeof DOMMatrixReadOnly === 'undefined') return null;
  let matrix: DOMMatrixReadOnly;
  let inverse: DOMMatrixReadOnly;
  try {
    matrix = new DOMMatrixReadOnly(list);
    inverse = matrix.inverse();
  } catch {
    return null;
  }
  const [ox, oy] = st.transformOrigin.split(' ').map(pxValue);
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
  const cx = box.x + ox;
  const cy = box.y + oy;
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ].map(([x, y]) => matrix.transformPoint({ x: x - cx, y: y - cy }));
  const xs = corners.map((q) => q.x + cx);
  const ys = corners.map((q) => q.y + cy);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    box,
    bounds: grown({ x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top }, 1),
    toLocal: (p) => {
      const q = inverse.transformPoint({ x: p.x - cx, y: p.y - cy });
      return Number.isFinite(q.x) && Number.isFinite(q.y) ? { x: q.x + cx, y: q.y + cy } : null;
    },
  };
}

/** A box size in CSS pixels, unrounded. */
type FitSize = { w: number; h: number };

/**
 * The layers above the text at `p`, top first: each hit-stack entry above the
 * owner and, directly above it, whatever an OPEN shadow root it hosts places
 * above the text at `p`, at any depth ({@link shadowAbove}) —
 * `document.elementsFromPoint` retargets shadow content to its host, so a
 * scrim inside a custom element (or one nested in another) would otherwise go
 * unseen. A host's shadow content paints over the host's own background, so
 * it is listed before the host: the order is paint order, which compositing
 * the translucent ones needs. A CLOSED shadow root cannot be read; the caller
 * treats a custom element with no open root lying over the text as
 * unmeasurable.
 */
function coversAbove(
  above: readonly Element[],
  owner: Element,
  p: { x: number; y: number }
): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const visit = (el: Element): void => {
    if (seen.has(el)) return;
    seen.add(el);
    for (const inner of shadowAbove(el, owner, p)) visit(inner);
    out.push(el);
  };
  for (const el of above) visit(el);
  return out;
}

/**
 * The elements of `host`'s OPEN shadow root at `p` that paint above the
 * text's owner, top first. A shadow root's hit test lists the light-DOM
 * owner too, in paint order, so the ones after it paint beneath the text:
 * the ones its text is slotted into, among them.
 */
function shadowAbove(host: Element, owner: Element, p: { x: number; y: number }): Element[] {
  const root = host.shadowRoot;
  if (!root || typeof root.elementsFromPoint !== 'function') return [];
  const out: Element[] = [];
  for (const inner of root.elementsFromPoint(p.x, p.y)) {
    if (inner === owner) break;
    if (inner !== host && inner.getRootNode() === root) out.push(inner);
  }
  return out;
}

/** A defined custom element whose shadow tree, if any, is not open to reads. */
function isClosedCustomElement(el: Element): boolean {
  if (el.shadowRoot) return false;
  const registry = typeof customElements === 'undefined' ? undefined : customElements;
  return registry?.get(el.localName) !== undefined;
}

/** The hit test, or null when this DOM does not implement it. */
function hitStack(x: number, y: number): Element[] | null {
  const fn = (document as Document & { elementsFromPoint?: Document['elementsFromPoint'] })
    .elementsFromPoint;
  if (typeof fn !== 'function') return null;
  return fn.call(document, x, y);
}

/** Whether `el` holds a text node of its own that is not just whitespace. */
function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ''));
}

/** Replaced content: its pixels are not CSS colours the DOM can read. */
const REPLACED_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'PICTURE']);

function isReplaced(el: Element): boolean {
  if (REPLACED_TAGS.has(el.tagName.toUpperCase())) return true;
  // An <svg> draws shapes in colours a background read does not see; the
  // outermost one is the box to treat as unreadable.
  return el.tagName.toLowerCase() === 'svg' && !(el.parentElement?.closest('svg') ?? null);
}

/** Chrome's `Canvas` system colours, light and dark. */
const CANVAS_LIGHT: RGBA = { r: 255, g: 255, b: 255, a: 1 };
const CANVAS_DARK: RGBA = { r: 18, g: 18, b: 18, a: 1 };

/** Premultiplied colour plus the share of it painted by an UNKNOWN layer. */
interface Paint {
  r: number;
  g: number;
  b: number;
  a: number;
  /** Alpha contributed by layers whose colour could not be read. */
  taint: number;
}

function premultiply(c: RGBA): Paint {
  return { r: c.r * c.a, g: c.g * c.a, b: c.b * c.a, a: c.a, taint: 0 };
}

/** An unreadable layer: opaque for coverage, all of it taint. */
const UNREADABLE: Paint = { r: 0, g: 0, b: 0, a: 1, taint: 1 };

/** Porter-Duff source-over, premultiplied. */
function over(src: Paint, dst: Paint): Paint {
  const k = 1 - src.a;
  return {
    r: src.r + dst.r * k,
    g: src.g + dst.g * k,
    b: src.b + dst.b * k,
    a: src.a + dst.a * k,
    taint: src.taint + dst.taint * k,
  };
}

function scale(p: Paint, f: number): Paint {
  return { r: p.r * f, g: p.g * f, b: p.b * f, a: p.a * f, taint: p.taint * f };
}

/** One paint operation at the sample point, bottom-up. */
interface PaintItem {
  /** The colour painted, or null for a layer whose colour cannot be read. */
  color: RGBA | null;
  /** The element whose opacity groups the paint belongs to. */
  owner: Element;
  /** Names the layer in an unknown's detail. */
  label: string;
}

/**
 * A layer the hit test cannot see: `bounds`, a box outside which it paints
 * nothing (read once, or null where it paints nowhere), and what it paints
 * at a point: a phrase naming it ("a background", "its inset box-shadow"),
 * or null where it paints nothing.
 */
type HitHidden = {
  layer: Element;
  bounds: () => VisionRegion | null;
  paintsAt: (p: { x: number; y: number }) => string | null;
};

/** What an element does to its content's overflow on one axis. */
type Overflow = 'clip' | 'scroll' | null;

/** The edge a scroll container scrolls from, per axis: `start` is left or top. */
type ScrollEdge = 'start' | 'end';

/** A padding box in viewport pixels, with the scale its element is drawn at. */
type PaddingBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  sx: number;
  sy: number;
};

/** Why a colour measurement stopped: returned instead of a colour. */
class ColorUnmeasured {
  constructor(readonly reason: MeasuredUnknown) {}
}

// ============================================================================
// The measurement
// ============================================================================

/**
 * One request's measurement of the tab. Each element is measured once per
 * facet, every computed style is read once, and the records come out in the
 * order they were first measured — the registry's, when `no_clipping` asked
 * for the whole registry first.
 */
class TabMeasurement {
  private readonly styles = new Map<Element, CSSStyleDeclaration>();
  private readonly pseudoStyles = new Map<
    Element,
    Partial<Record<'::before' | '::after', CSSStyleDeclaration>>
  >();
  private readonly records = new Map<string, MeasuredElement>();
  private readonly live = new Map<string, Element | null>();
  private readonly paintOrder = new Map<string, PaintOrderEvidence>();
  private readonly colorDone = new Set<string>();
  private readonly fitDone = new Set<string>();
  private readonly clipDone = new Set<string>();
  private registryIds: Map<Element, string> | null = null;
  private hitHidden: readonly HitHidden[] | null = null;
  private canvas: { paint: Paint; label: string } | null = null;
  private canvasFrom: Element | null = null;

  constructor(
    private readonly source: VisionAssertSource,
    private readonly resolveOperand?: (id: string) => Element | null | undefined
  ) {}

  /** The snapshot the pure evaluator reads. */
  input(): VisionEvalInput {
    return { elements: [...this.records.values()], paintOrder: this.paintOrder };
  }

  style(el: Element): CSSStyleDeclaration {
    let st = this.styles.get(el);
    if (!st) {
      st = window.getComputedStyle(el);
      this.styles.set(el, st);
    }
    return st;
  }

  private pseudoStyle(el: Element, which: '::before' | '::after'): CSSStyleDeclaration {
    let pair = this.pseudoStyles.get(el);
    if (!pair) {
      pair = {};
      this.pseudoStyles.set(el, pair);
    }
    let st = pair[which];
    if (!st) {
      st = window.getComputedStyle(el, which);
      pair[which] = st;
    }
    return st;
  }

  /** Measure what `assertion` reads. Kinds the tab does not implement read nothing. */
  measureFor(assertion: VisionAssertion): void {
    switch (assertion.type) {
      case 'no_overlap':
        for (const id of assertion.elements) this.base(id);
        return;
      case 'element_above':
        this.measurePair(assertion.elements[0], assertion.elements[1]);
        return;
      case 'text_fits_container':
        this.measureTextFit(assertion.element);
        return;
      case 'contrast_meets_wcag':
        this.measureColor(assertion.element);
        return;
      default:
        return;
    }
  }

  // ---- Identity and geometry -------------------------------------------------

  private resolve(id: string): { found: boolean; el: Element | null } {
    if (this.live.has(id)) return { found: true, el: this.live.get(id) ?? null };
    if (this.resolveOperand) {
      const el = this.resolveOperand(id);
      return el ? { found: true, el } : { found: false, el: null };
    }
    const registered = this.source.getElement(id);
    if (registered === undefined || registered === null) return { found: false, el: null };
    return { found: true, el: elementOf(registered) };
  }

  /** The element's base record (id, box, interactable), or undefined when it is not in the snapshot. */
  private base(
    id: string,
    known?: { el: Element | null; registered: unknown }
  ): { record: MeasuredElement; el: Element | null } | undefined {
    const existing = this.records.get(id);
    if (existing) return { record: existing, el: this.live.get(id) ?? null };
    const resolved = known ? { found: true, el: known.el } : this.resolve(id);
    if (!resolved.found) return undefined;
    const el = resolved.el;
    const record: MeasuredElement = { id };
    if (el) {
      const box = boxOf(el);
      if (box) record.bbox = box;
      record.interactable = this.interactable(el, known?.registered ?? this.source.getElement(id));
    }
    this.records.set(id, record);
    this.live.set(id, el);
    return { record, el };
  }

  /** vision-core `interactable`, as the ElementSnapshot projector derives it. */
  private interactable(el: Element, registered: unknown): boolean {
    if (isInteractionBlocked(readInteractionBlockers(el, this.style(el)))) return false;
    if (typeof registered !== 'object' || registered === null) return false;
    const r = registered as { category?: unknown; actions?: unknown; customActions?: unknown };
    if (r.category === 'interactive') return true;
    const actions = Array.isArray(r.actions) && r.actions.length > 0;
    const custom =
      typeof r.customActions === 'object' &&
      r.customActions !== null &&
      Object.keys(r.customActions).length > 0;
    return actions || custom;
  }

  /** A short, content-free name for an element in a detail: its registry id, else tag#id.class. */
  describe(el: Element): string {
    if (!this.registryIds) {
      this.registryIds = new Map();
      for (const r of this.source.getAllElements()) {
        const e = elementOf(r);
        const id = registeredId(r);
        if (e && id !== undefined && !this.registryIds.has(e)) this.registryIds.set(e, id);
      }
    }
    const registered = this.registryIds.get(el);
    if (registered !== undefined) return `'${registered}'`;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = classList(el)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('');
    return `<${tag}${id}${classes}>`;
  }

  // ---- element_above ---------------------------------------------------------

  /**
   * Hit-test the pair at up to nine points inside their intersection clipped
   * to the viewport. The evaluator never scrolls, so a pair whose shared area
   * is off-screen is unmeasurable, not guessed.
   */
  private measurePair(aboveId: string, belowId: string): void {
    const above = this.base(aboveId);
    const below = this.base(belowId);
    const key = paintOrderKey(aboveId, belowId);
    if (!above || !below || this.paintOrder.has(key)) return;
    if (above.el && above.el === below.el) {
      this.paintOrder.set(key, { kind: 'equal' });
      return;
    }
    const unmeasurable = (detail: string): void => {
      this.paintOrder.set(key, { kind: 'unmeasurable', detail });
    };
    if (!above.el || !below.el || !above.record.bbox || !below.record.bbox) {
      unmeasurable('one of the two elements generates no box, so no point shows both');
      return;
    }
    const shared = intersect(above.record.bbox, below.record.bbox);
    if (!shared) {
      unmeasurable(
        'the two boxes do not intersect, so no point shows both and the hit test cannot ' +
          'order them'
      );
      return;
    }
    const visible = intersect(shared, viewport());
    if (!visible) {
      unmeasurable(
        'their shared area lies outside the viewport, and the evaluator never scrolls; scroll ' +
          'it into view and assert again'
      );
      return;
    }
    let shown = 0;
    let belowAt: { x: number; y: number } | null = null;
    for (const fx of [1 / 6, 1 / 2, 5 / 6]) {
      for (const fy of [1 / 6, 1 / 2, 5 / 6]) {
        const p = { x: visible.x + visible.w * fx, y: visible.y + visible.h * fy };
        const stack = hitStack(p.x, p.y);
        if (stack === null) {
          unmeasurable(
            'this DOM implements no document.elementsFromPoint, so nothing was hit-tested'
          );
          return;
        }
        const ia = stack.indexOf(above.el);
        const ib = stack.indexOf(below.el);
        if (ia < 0 || ib < 0) continue;
        shown += 1;
        if (ib < ia && belowAt === null) belowAt = p;
      }
    }
    if (shown === 0) {
      const blind = [above.el, below.el]
        .filter((e) => readInteractionBlockers(e, this.style(e)).pointerEventsNone)
        .map((e) => this.describe(e));
      unmeasurable(
        'no sample point inside their visible intersection showed both elements in the hit ' +
          'test' +
          (blind.length > 0
            ? ` (${blind.join(' and ')} compute pointer-events: none, which the hit test skips)`
            : ' (one is covered there, or not hit-testable)')
      );
      return;
    }
    this.paintOrder.set(
      key,
      belowAt ? { kind: 'below', at: belowAt, samples: shown } : { kind: 'above', samples: shown }
    );
  }

  // ---- text_fits_container ---------------------------------------------------

  /** The nearest box that is not inline-level: the element itself, else its nearest such ancestor. */
  private nearestBlockBox(el: Element): Element | null {
    for (let x: Element | null = el; x; x = composedParent(x)) {
      const display = this.style(x).display;
      if (display === 'none') return null;
      if (display !== 'inline' && display !== 'contents' && display !== 'inline flow') return x;
    }
    return null;
  }

  private measureTextFit(id: string): void {
    const base = this.base(id);
    if (!base || this.fitDone.has(id)) return;
    this.fitDone.add(id);
    const { record, el } = base;
    if (!el) return;
    const text = this.scrubbedText(el);
    if (text !== undefined) record.text = text;
    const fontSize = pxValue(this.style(el).fontSize);
    if (Number.isFinite(fontSize)) record.fontSizePx = fontSize;
    if (!record.bbox) return;
    const display = this.style(el).display;
    if (display !== 'inline' && display !== 'inline flow') {
      this.fitOwnBox(el, record);
      return;
    }
    const block = this.nearestBlockBox(el);
    if (!block) {
      record.unmeasured = {
        ...record.unmeasured,
        textFit: {
          code: 'input_missing',
          detail:
            `element '${id}' has no block-level box up its ancestry (display: none or ` +
            'contents), so its text has no box to fit against and was not checked',
        },
      };
      return;
    }
    this.fitInlineFragments(id, el, block, record);
  }

  /**
   * A block-level element is its own fit box. vision-core compares the scroll
   * extents with the BORDER box, strictly, rounded UP — and the evaluator does
   * that rounding (plan 2026-11-09 Phase 0's contract), so the box is handed
   * over unrounded: {@link layoutSizes}, fractional, where `offsetWidth` would
   * already be the browser's integer rounding of it. Both sides are LAYOUT
   * sizes, which a CSS transform does not change: `getBoundingClientRect` is
   * the transformed box, and scaling the integer extents into it would round
   * a one-pixel overflow away under a scale below 0.5. The extents are the
   * DOM's integer `scrollWidth` / `scrollHeight`, which measure only the
   * padding box, so the borders and scrollbars (`offset*` - `client*`) are
   * added back: without them an overflow narrower than the borders plus a
   * scrollbar would pass.
   */
  private fitOwnBox(el: Element, record: MeasuredElement): void {
    const html = el as HTMLElement;
    if (typeof html.offsetWidth === 'number' && typeof html.offsetHeight === 'number') {
      record.fitBox = this.layoutSizes(el)?.border ?? { w: html.offsetWidth, h: html.offsetHeight };
      record.scrollWidthPx = el.scrollWidth + Math.max(0, html.offsetWidth - el.clientWidth);
      record.scrollHeightPx = el.scrollHeight + Math.max(0, html.offsetHeight - el.clientHeight);
    } else {
      // No layout sizes (an SVG element): its own box, untransformed only if
      // it is not transformed — the best this DOM exposes.
      const r = el.getBoundingClientRect();
      record.fitBox = { w: r.width, h: r.height };
      record.scrollWidthPx = el.scrollWidth;
      record.scrollHeightPx = el.scrollHeight;
    }
    const overflow = this.style(el).textOverflow;
    if (overflow) record.textOverflow = overflow;
  }

  /**
   * `el`'s border-box and padding-box sizes in LAYOUT pixels, unrounded: the
   * used `width` / `height` (fractional, and not changed by a CSS transform),
   * with the padding, borders and scrollbars added back under
   * `box-sizing: content-box`. The browser resolves a content-box `width` to
   * the client width less the padding, so a scrollbar lies outside it; its
   * size is what the integer `offset*` and `client*` sizes leave beside the
   * borders. `null` when the computed style does not resolve a size to
   * pixels.
   */
  private layoutSizes(el: Element): { border: FitSize; padding: FitSize } | null {
    const st = this.style(el);
    const w = pxValue(st.width);
    const h = pxValue(st.height);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    const html = el as HTMLElement;
    const px = (v: string): number => pxValue(v) || 0;
    const framesX = px(st.borderLeftWidth) + px(st.borderRightWidth);
    const framesY = px(st.borderTopWidth) + px(st.borderBottomWidth);
    const barX = Math.max(0, (html.offsetWidth ?? 0) - el.clientWidth - Math.round(framesX));
    const barY = Math.max(0, (html.offsetHeight ?? 0) - el.clientHeight - Math.round(framesY));
    const border =
      st.boxSizing === 'border-box'
        ? { w, h }
        : {
            w: w + px(st.paddingLeft) + px(st.paddingRight) + framesX + barX,
            h: h + px(st.paddingTop) + px(st.paddingBottom) + framesY + barY,
          };
    return {
      border,
      padding: { w: border.w - framesX - barX, h: border.h - framesY - barY },
    };
  }

  /**
   * An inline element's text is measured by its OWN line fragments
   * (`getClientRects`) against the content box of the block it lays out in.
   * The block's scroll extents alone would answer for every sibling in it: a
   * short label beside a long one would read as overflowing. They still decide
   * that an axis does NOT overflow; where it does, the fragments say whose
   * text overflows. Both sides are in LAYOUT pixels, as the block-level arm
   * measures ({@link fitOwnBox}): the fit box is the content box's layout
   * size, unrounded (the evaluator rounds it up), and how far the fragments
   * reach past it — a distance between viewport rectangles — is divided by
   * the block's scale. In viewport pixels a one-pixel overflow under
   * `scale(0.4)` would round away. The extent is rounded to an integer as the
   * DOM's scroll extents are, so sub-pixel layout noise is not overflow.
   */
  private fitInlineFragments(
    id: string,
    el: Element,
    block: Element,
    record: MeasuredElement
  ): void {
    const fragments = Array.from(el.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
    const content = this.contentBox(block);
    if (fragments.length === 0 || !content) {
      // Its own boxes cannot be compared. The block's extents stand in only
      // when this element is all the block holds.
      if (this.hasOtherInFlowChildren(block, el)) {
        record.unmeasured = {
          ...record.unmeasured,
          textFit: {
            code: 'input_missing',
            detail:
              `inline element '${id}' exposes no box of its own to compare, and the block it ` +
              `lays out in (${this.describe(block)}) holds other content, so the block's ` +
              'overflow does not say whether this text fits; it was not checked',
          },
        };
        return;
      }
      this.fitOwnBox(block, record);
      return;
    }
    const left = Math.min(...fragments.map((r) => r.left));
    const right = Math.max(...fragments.map((r) => r.right));
    const top = Math.min(...fragments.map((r) => r.top));
    const bottom = Math.max(...fragments.map((r) => r.bottom));
    // A block that does not overflow an axis cuts no line on it, whatever
    // its fragments' sub-pixel and font-metric rounding say; where it does,
    // the fragments say whether THIS element's text is what overflows.
    const overX =
      block.scrollWidth > block.clientWidth
        ? Math.max(0, right - content.right, content.left - left) / content.sx
        : 0;
    const overY =
      block.scrollHeight > block.clientHeight
        ? Math.max(0, bottom - content.bottom, content.top - top) / content.sy
        : 0;
    record.fitBox = { w: content.w, h: content.h };
    record.scrollWidthPx = Math.round(content.w + overX);
    record.scrollHeightPx = Math.round(content.h + overY);
    const overflow = this.style(block).textOverflow;
    if (overflow) record.textOverflow = overflow;
  }

  /**
   * The content box of `el` — its border box less borders, padding and
   * scrollbars — in viewport pixels (`left` … `bottom`, scaled like the box
   * when it is transformed), its size in LAYOUT pixels (`w`, `h`, unrounded)
   * and that scale (`sx`, `sy`: viewport pixels per layout pixel). The layout
   * size is read, never divided back out of the viewport box, so a whole
   * width stays whole for the evaluator's ceiling. Null when the box has no
   * layout size to scale by.
   */
  private contentBox(el: Element): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    w: number;
    h: number;
    sx: number;
    sy: number;
  } | null {
    const html = el as HTMLElement;
    if (typeof html.offsetWidth !== 'number' || html.offsetWidth <= 0 || html.offsetHeight <= 0) {
      return null;
    }
    const sizes = this.layoutSizes(el);
    const border = sizes?.border ?? { w: html.offsetWidth, h: html.offsetHeight };
    const padding = sizes?.padding ?? { w: el.clientWidth, h: el.clientHeight };
    if (!(border.w > 0) || !(border.h > 0)) return null;
    const r = el.getBoundingClientRect();
    const st = this.style(el);
    const sx = r.width / border.w;
    const sy = r.height / border.h;
    if (!(sx > 0) || !(sy > 0)) return null;
    const px = (v: string): number => pxValue(v) || 0;
    const w = Math.max(0, padding.w - px(st.paddingLeft) - px(st.paddingRight));
    const h = Math.max(0, padding.h - px(st.paddingTop) - px(st.paddingBottom));
    const left = r.left + (px(st.borderLeftWidth) + px(st.paddingLeft)) * sx;
    const top = r.top + (px(st.borderTopWidth) + px(st.paddingTop)) * sy;
    return { left, top, right: left + w * sx, bottom: top + h * sy, w, h, sx, sy };
  }

  /**
   * Does `block` lay out anything besides `el`: another element in flow, or
   * text? A wrapper that holds `el` is looked into, so text beside `el`
   * inside it counts too.
   */
  private hasOtherInFlowChildren(block: Element, el: Element): boolean {
    for (const child of Array.from(block.childNodes)) {
      if (child === el) continue;
      if (child.nodeType === 3) {
        if (/\S/.test(child.nodeValue ?? '')) return true;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const st = this.style(child as Element);
      if (st.display === 'none' || st.position === 'absolute' || st.position === 'fixed') {
        continue;
      }
      if (!containsComposed(child as Element, el)) return true;
      if (this.hasOtherInFlowChildren(child as Element, el)) return true;
    }
    return false;
  }

  /**
   * The element's visible text, scrubbed by its own redaction verdict — and
   * redacted whole when a `data-bridge-redact` boundary sits anywhere in its
   * subtree, since the text read here is the container's whole innerText.
   */
  private scrubbedText(el: Element): string | undefined {
    const raw = computeVisibleText(el);
    if (raw && containsRedactionBoundary(el)) return REDACTED_VALUE;
    return scrubContentByVerdict(raw, verdictOf(el as HTMLElement));
  }

  // ---- no_clipping -----------------------------------------------------------

  /** Measure every registered element's box and clip, in registry order. */
  measureClipsOfRegistry(): void {
    for (const registered of this.source.getAllElements()) {
      const id = registeredId(registered);
      if (id === undefined) continue;
      const el = elementOf(registered);
      const base = this.base(id, { el, registered });
      if (!base || this.clipDone.has(id)) continue;
      this.clipDone.add(id);
      if (el && base.record.bbox) base.record.clip = this.clipOf(el);
    }
  }

  /** Does `st` establish a containing block for an absolutely positioned descendant? */
  private absoluteContainer(st: CSSStyleDeclaration): boolean {
    return st.position !== 'static' || this.fixedContainer(st);
  }

  /** Does `st` establish a containing block for a fixed-position descendant? */
  private fixedContainer(st: CSSStyleDeclaration): boolean {
    return (
      (st.transform !== '' && st.transform !== 'none') ||
      (st.perspective !== '' && st.perspective !== 'none') ||
      (st.filter !== '' && st.filter !== 'none') ||
      !['', 'none'].includes(st.getPropertyValue('backdrop-filter')) ||
      /\b(paint|layout|strict|content)\b/.test(st.contain ?? '') ||
      /\b(transform|perspective|filter)\b/.test(st.willChange ?? '')
    );
  }

  /**
   * What `el` does, per axis, to the content that overflows it: cuts it off
   * (`clip`), keeps it reachable by scrolling (`scroll`), or neither (null).
   * The root does neither: its overflow is the viewport's, which scrolls.
   */
  private overflowAxes(el: Element, st: CSSStyleDeclaration): { x: Overflow; y: Overflow } {
    const none = { x: null, y: null };
    const root = document.documentElement;
    if (el === root) return none;
    if (el === document.body) {
      // The body's overflow propagates to the viewport when the root's is
      // visible on both axes, and then the body itself clips nothing.
      const rootSt = this.style(root);
      if (rootSt.overflowX === 'visible' && rootSt.overflowY === 'visible') return none;
    }
    // Overflow applies to block containers, not to an inline box or to an
    // element that generates none.
    if (st.display === 'inline' || st.display === 'contents' || st.display === 'none') {
      return none;
    }
    // Only `hidden` and `clip` (or `contain: paint`) cut content off on every
    // side. `scroll` and `auto` make a scroll container, whose overflow past
    // its far side is reachable by scrolling: a row scrolled out of a list is
    // not clipped ({@link clipOf} keeps the edge it scrolls from).
    const paint = /\b(paint|strict|content)\b/.test(st.contain ?? '');
    const axis = (v: string): Overflow =>
      v === 'auto' || v === 'scroll'
        ? 'scroll'
        : v === 'hidden' || v === 'clip' || paint
          ? 'clip'
          : null;
    return { x: axis(st.overflowX), y: axis(st.overflowY) };
  }

  /**
   * The padding box an ancestor clips its content to, in viewport pixels:
   * the border box minus borders and scrollbars, scaled when the element is
   * transformed, with that scale (`sx`, `sy`). Unrounded, from the fractional
   * layout sizes ({@link layoutSizes}) rather than the integer `offset*` /
   * `client*`, whose rounding would read as a scale. The evaluator rounds
   * each edge of the clip and of the box it bounds to the nearest pixel,
   * which is what absorbs the layout's sub-pixel noise: no slack is added
   * here.
   *
   * A scrollbar usually lies past the padding box's right and bottom edges,
   * but Chromium draws the vertical one on the LEFT under `direction: rtl`,
   * and then the padding box starts past it. `clientLeft` (`clientTop`)
   * counts such a scrollbar with the border, so it says which side the
   * scrollbar is on. Its width is the border box less the borders and the
   * padding box, but no more than `clientLeft` counts past the border:
   * under `scrollbar-gutter: stable both-edges` a gutter as wide is
   * reserved on the other side too.
   */
  private clipBox(el: Element, st: CSSStyleDeclaration): PaddingBox {
    const r = el.getBoundingClientRect();
    const html = el as HTMLElement;
    const sizes = this.layoutSizes(el);
    const ow = sizes?.border.w ?? (html.offsetWidth || r.width);
    const oh = sizes?.border.h ?? (html.offsetHeight || r.height);
    const pw = sizes?.padding.w ?? el.clientWidth;
    const ph = sizes?.padding.h ?? el.clientHeight;
    const sx = ow > 0 ? r.width / ow : 1;
    const sy = oh > 0 ? r.height / oh : 1;
    const bl = pxValue(st.borderLeftWidth) || 0;
    const bt = pxValue(st.borderTopWidth) || 0;
    const br = pxValue(st.borderRightWidth) || 0;
    const bb = pxValue(st.borderBottomWidth) || 0;
    const barLeft =
      el.clientLeft - bl >= 1 ? Math.max(0, Math.min(el.clientLeft - bl, ow - pw - bl - br)) : 0;
    const barTop =
      el.clientTop - bt >= 1 ? Math.max(0, Math.min(el.clientTop - bt, oh - ph - bt - bb)) : 0;
    const left = r.left + (bl + barLeft) * sx;
    const top = r.top + (bt + barTop) * sy;
    return { left, top, right: left + pw * sx, bottom: top + ph * sy, sx, sy };
  }

  /**
   * The edge each axis of a scroll container scrolls from: `start` (left,
   * top) or `end` (right, bottom). What overflows the far edge is scrolled
   * into view; what overflows this one is out of reach at every scroll
   * position. A scroll offset away from zero shows the side directly — the
   * offset runs from 0 at this edge, negative when it is the right or bottom
   * one. At zero the layout decides: the inline-start and block-start edges
   * (`direction`, `writing-mode`), which a flex container swaps for its
   * main-start (`*-reverse`) and cross-start (`wrap-reverse`) edges. Each
   * case was measured in Chromium.
   */
  private scrollOrigin(el: Element, st: CSSStyleDeclaration): { x: ScrollEdge; y: ScrollEdge } {
    const flip = (edge: ScrollEdge): ScrollEdge => (edge === 'start' ? 'end' : 'start');
    const mode = st.writingMode || 'horizontal-tb';
    const inline: 'x' | 'y' = mode === 'horizontal-tb' ? 'x' : 'y';
    const block: 'x' | 'y' = inline === 'x' ? 'y' : 'x';
    let inlineStart: ScrollEdge = st.direction === 'rtl' ? 'end' : 'start';
    // sideways-lr runs its lines bottom to top.
    if (mode === 'sideways-lr') inlineStart = flip(inlineStart);
    const blockStart: ScrollEdge =
      mode === 'vertical-rl' || mode === 'sideways-rl' ? 'end' : 'start';
    const origin = { x: 'start' as ScrollEdge, y: 'start' as ScrollEdge };
    origin[inline] = inlineStart;
    origin[block] = blockStart;
    if (/\bflex\b/.test(st.display)) {
      const column = (st.flexDirection ?? '').startsWith('column');
      const main = column ? block : inline;
      const cross = column ? inline : block;
      if ((st.flexDirection ?? '').endsWith('-reverse')) origin[main] = flip(origin[main]);
      if (st.flexWrap === 'wrap-reverse') origin[cross] = flip(origin[cross]);
    }
    const bySign = (offset: number, fallback: ScrollEdge): ScrollEdge =>
      offset > 0 ? 'start' : offset < 0 ? 'end' : fallback;
    return { x: bySign(el.scrollLeft, origin.x), y: bySign(el.scrollTop, origin.y) };
  }

  /**
   * The clip of `el`: per axis, the padding box of its nearest ancestor that
   * clips that axis, walking only the ancestors that can clip it — an
   * absolutely positioned element skips the ancestors below its containing
   * block, a fixed one every ancestor below one that contains fixed
   * descendants. A scroll container met first settles that axis too, on one
   * side only: what overflows it past the edge it scrolls from
   * ({@link scrollOrigin}) is cut off at every scroll position, where that
   * edge lay at scroll position 0, while what overflows the far side is
   * reachable by scrolling, so that side is open. Its own box — not the
   * content scrolled inside it — is what an ancestor further out can cut
   * off. `null` when nothing clips it.
   */
  private clipOf(el: Element): ClipBounds | null {
    let need: 'all' | 'absolute' | 'fixed' = this.positionMode(this.style(el));
    type Side = { lo: number; hi: number; by: string };
    let x: Side | null = null;
    let y: Side | null = null;
    for (let a = composedParent(el); a && !(x && y); a = composedParent(a)) {
      const st = this.style(a);
      const eligible =
        need === 'all' ||
        (need === 'absolute' && this.absoluteContainer(st)) ||
        (need === 'fixed' && this.fixedContainer(st));
      if (!eligible) continue;
      const axes = this.overflowAxes(a, st);
      if ((!x && axes.x) || (!y && axes.y)) {
        const box = this.clipBox(a, st);
        const origin = axes.x === 'scroll' || axes.y === 'scroll' ? this.scrollOrigin(a, st) : null;
        const clipped = (axis: string, prop: string): string =>
          `the ${axis} clip of ${this.describe(a)}, its nearest ancestor clipping ${prop} ` +
          `(${this.clipReason(a, prop)})`;
        const unreachable = (edge: string, prop: string): string =>
          `the ${edge} edge of the scrollable area of ${this.describe(a)} ` +
          `(${this.clipReason(a, prop)}), which no scroll position reaches past`;
        if (!x && axes.x) {
          const shift = a.scrollLeft * box.sx;
          x =
            axes.x === 'clip' || !origin
              ? { lo: box.left, hi: box.right, by: clipped('horizontal', 'overflow-x') }
              : origin.x === 'start'
                ? { lo: box.left - shift, hi: Infinity, by: unreachable('left', 'overflow-x') }
                : { lo: -Infinity, hi: box.right - shift, by: unreachable('right', 'overflow-x') };
        }
        if (!y && axes.y) {
          const shift = a.scrollTop * box.sy;
          y =
            axes.y === 'clip' || !origin
              ? { lo: box.top, hi: box.bottom, by: clipped('vertical', 'overflow-y') }
              : origin.y === 'start'
                ? { lo: box.top - shift, hi: Infinity, by: unreachable('top', 'overflow-y') }
                : {
                    lo: -Infinity,
                    hi: box.bottom - shift,
                    by: unreachable('bottom', 'overflow-y'),
                  };
        }
      }
      need = this.positionMode(st);
    }
    if (!x && !y) return null;
    return {
      left: x ? x.lo : -Infinity,
      right: x ? x.hi : Infinity,
      top: y ? y.lo : -Infinity,
      bottom: y ? y.hi : Infinity,
      byX: x ? x.by : '',
      byY: y ? y.by : '',
    };
  }

  private clipReason(el: Element, prop: string): string {
    const st = this.style(el);
    if (/\b(paint|strict|content)\b/.test(st.contain ?? '')) return `contain: ${st.contain}`;
    return `${prop}: ${st.getPropertyValue(prop)}`;
  }

  private positionMode(st: CSSStyleDeclaration): 'all' | 'absolute' | 'fixed' {
    return st.position === 'absolute' ? 'absolute' : st.position === 'fixed' ? 'fixed' : 'all';
  }

  // ---- contrast_meets_wcag ---------------------------------------------------

  private measureColor(id: string): void {
    const base = this.base(id);
    if (!base || this.colorDone.has(id)) return;
    this.colorDone.add(id);
    const { record, el } = base;
    if (!el) return;
    const measured = this.colorAt(el, record);
    if (measured instanceof ColorUnmeasured) {
      record.unmeasured = { ...record.unmeasured, color: measured.reason };
      return;
    }
    record.fgColor = measured.fg;
    record.bgColor = measured.bg;
  }

  /** The product of `opacity` from `el` up its composed ancestry. */
  private effectiveOpacity(el: Element): number {
    let product = 1;
    for (let a: Element | null = el; a; a = composedParent(a)) {
      const o = Number(this.style(a).opacity);
      if (Number.isFinite(o)) product *= o;
      if (product === 0) return 0;
    }
    return product;
  }

  /**
   * The first rendered run of text inside `el` and the element that owns it,
   * or null when `el` holds no rendered text. A run of 1 px or less is a
   * visually hidden (`sr-only`) label, not the text a reader sees.
   */
  private firstTextRun(el: Element): { owner: Element; rect: DOMRect } | null | 'no-geometry' {
    const doc = el.ownerDocument;
    // A DOM without text geometry (jsdom has no Range#getClientRects) cannot
    // place the text; the caller lets the element's own box stand in for it,
    // but only when the element holds text at all.
    if (typeof doc.createRange !== 'function') return 'no-geometry';
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!/\S/.test(node.nodeValue ?? '')) continue;
      const range = doc.createRange();
      if (typeof range.getClientRects !== 'function') return 'no-geometry';
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 1 && rect.height > 1) {
          return { owner: node.parentElement ?? el, rect };
        }
      }
    }
    return null;
  }

  private colorAt(
    el: Element,
    record: MeasuredElement
  ): { fg: VisionRgb; bg: VisionRgb } | ColorUnmeasured {
    const missing = (code: UnknownCode, detail: string) =>
      new ColorUnmeasured({
        code,
        detail: `contrast of '${record.id}' was not computed: ${detail}`,
      });
    const found = this.firstTextRun(el);
    // No rendered text is nothing to measure: an icon-only control or an
    // empty box is unknown, never a contrast "measured" with its CSS colour.
    if (found === null || (found === 'no-geometry' && !/\S/.test(computeVisibleText(el) ?? ''))) {
      return missing(
        'input_missing',
        'it holds no rendered text (an icon-only control, an empty box, or a form value the ' +
          'DOM does not expose as text), so there is no text whose contrast could be measured'
      );
    }
    const run = found === 'no-geometry' ? null : found;
    const owner = run?.owner ?? el;
    // Text slotted into an OPEN shadow tree is painted by the shadow elements
    // around its slot, not by the host the light-DOM text node sits in, so the
    // host's colour and backdrop would measure the wrong layers. A CLOSED root
    // cannot be detected (a light-DOM custom element looks the same), so a host
    // whose root is closed is measured as light DOM — a documented limit.
    if (owner.shadowRoot) {
      return missing(
        'input_missing',
        `its text sits in ${this.describe(owner)}, a shadow host that slots it into a ` +
          'shadow tree whose own elements paint it, so its colours were not measured'
      );
    }
    const ownerSt = this.style(owner);
    const fontSize = pxValue(ownerSt.fontSize);
    if (Number.isFinite(fontSize)) record.fontSizePx = fontSize;
    const weight = Number(ownerSt.fontWeight);
    if (Number.isFinite(weight)) record.fontWeight = weight;

    const fillValue = ownerSt.getPropertyValue('-webkit-text-fill-color');
    const fill = (fillValue && parseColor(fillValue)) || parseColor(ownerSt.color);
    if (!fill) {
      return missing(
        'input_missing',
        `its text colour ${JSON.stringify(fillValue || ownerSt.color)} could not be read`
      );
    }

    // The sample point: the middle of the visible part of the text run (or of
    // the element's box when it holds no text).
    const area = run
      ? { x: run.rect.left, y: run.rect.top, w: run.rect.width, h: run.rect.height }
      : record.bbox;
    if (!area) return missing('input_missing', 'the element generates no box');
    const visible = intersect(area, viewport());
    if (!visible) {
      return missing(
        'hit_test_unmeasurable',
        'its text lies outside the viewport, and the layers painted beneath it can only be ' +
          'ordered by hit-testing a visible point; the evaluator never scrolls, so scroll it ' +
          'into view and assert again'
      );
    }
    const p = { x: visible.x + visible.w / 2, y: visible.y + visible.h / 2 };
    const stack = hitStack(p.x, p.y);
    if (stack === null) {
      return missing(
        'hit_test_unmeasurable',
        'this DOM implements no document.elementsFromPoint, so the layers beneath the text ' +
          'cannot be ordered'
      );
    }
    const at = stack.indexOf(owner);
    if (at < 0) {
      return missing(
        'hit_test_unmeasurable',
        `${this.describe(owner)} is not hit-testable at (${Math.round(p.x)}, ${Math.round(p.y)}) ` +
          '(pointer-events: none, or visibility: hidden), so the layers beneath its text cannot ' +
          'be ordered'
      );
    }
    // The hit test lists a ::before / ::after as the element it belongs to,
    // so the owner's own positioned one (a stretched link's ::after on
    // z-index 1) lists the owner a second time, apart from its text. With
    // other layers between the listings, which one is the text's, and so
    // whether those layers lie over the text or beneath it, is not known.
    const again = stack.indexOf(owner, at + 1);
    if (again > at + 1) {
      return missing(
        'hit_test_unmeasurable',
        `the hit test lists ${this.describe(owner)} more than once at (${Math.round(p.x)}, ` +
          `${Math.round(p.y)}), for its text and for a ::before / ::after of its, with ` +
          `${this.describe(stack[at + 1])} between, so whether that lies over the text or ` +
          'beneath it cannot be told'
      );
    }

    // Layers the hit test places ABOVE the text's owner at the sample point
    // paint over the text (a scrim, a sticky header, a tooltip) and change the
    // colours a reader sees. A plain translucent colour is composited over the
    // text and its backdrop alike; a layer that covers the text, or paints
    // over it in a way the DOM cannot read, leaves contrast unknown, named
    // ({@link paintAbove}). A layer at effective opacity 0 paints nothing and
    // is skipped. The document hit test retargets shadow content to its host,
    // so an open shadow root above the owner is hit-tested too.
    //
    // An ANCESTOR of the owner listed there paints its own box beneath its
    // content, so it is listed for what it draws over that content — a
    // positioned ::before / ::after, its shadow tree — and its own background
    // is not composited over the text ({@link generatedAbove}). Unless a
    // negative z-index sinks the text past it ({@link sunkBeneath}): then all
    // of it paints over the text. An element the hit test lists beneath the
    // text as well paints its own box there too, and is read the same way.
    const beneath = stack.slice(at);
    const sunkPast = new Set<Element>();
    const covers: PaintItem[][] = [];
    for (const cover of coversAbove(stack.slice(0, at), owner, p)) {
      if (this.effectiveOpacity(cover) === 0) continue;
      if (isClosedCustomElement(cover)) {
        return missing(
          'input_missing',
          `${this.describe(cover)} is a defined custom element over the text with no open ` +
            'shadow root; it may have a closed shadow tree, and what that paints there cannot be read'
        );
      }
      const holds = containsComposed(cover, owner);
      const sunk = holds && this.sunkBeneath(owner, cover);
      if (sunk) sunkPast.add(cover);
      const ownBoxBeneath = holds ? !sunk : beneath.includes(cover);
      const coverItems = ownBoxBeneath
        ? this.generatedAbove(cover, owner, p, holds)
        : this.paintAbove(cover, owner, p);
      if (coverItems instanceof ColorUnmeasured) {
        return missing(coverItems.reason.code, coverItems.reason.detail);
      }
      covers.push(coverItems);
    }
    // Bottom-up paint operations OVER the text: the covers, lowest first.
    const overItems: PaintItem[] = [];
    for (let i = covers.length - 1; i >= 0; i--) overItems.push(...covers[i]);

    // The paint stack under the text, top first: the hit stack beneath the
    // text's owner, plus the DOM ancestors it does not list there — the ones
    // the hit test skipped (pointer-events: none), and one it lists only
    // above the owner for its generated content or shadow tree — each placed
    // above the first entry outside it. An ancestor the text sinks beneath
    // (a negative z-index) paints over the text, as a cover, so it is not
    // added beneath it too.
    const layers = [...beneath];
    for (let a = composedParent(owner); a; a = composedParent(a)) {
      if (layers.includes(a) || sunkPast.has(a)) continue;
      const after = layers.findIndex((l, i) => i > 0 && !containsComposed(a, l));
      if (after < 0) layers.push(a);
      else layers.splice(after, 0, a);
    }

    const blocked = this.textAffectedBy(owner);
    if (blocked) return missing('input_missing', blocked);
    const unplaceable = this.unplaceableLayerAt(p, owner, layers);
    if (unplaceable) {
      return missing(
        'input_missing',
        `${this.describe(unplaceable.layer)} paints ${unplaceable.what} at the text's position ` +
          'but computes pointer-events: none, so the hit test cannot place it in the paint order'
      );
    }

    // Bottom-up paint operations under the text.
    const items: PaintItem[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const layerItems = this.paintOf(layers[i], owner, p);
      if (layerItems instanceof ColorUnmeasured) {
        return missing(layerItems.reason.code, layerItems.reason.detail);
      }
      items.push(...layerItems);
    }

    // A translucent layer over the text tints the text and its backdrop alike.
    const canvas = this.canvasPaint();
    const bg = this.composite([...items, ...overItems], canvas.paint);
    const fg = this.composite(
      [...items, { color: fill, owner, label: 'the text' }, ...overItems],
      canvas.paint
    );
    if (bg.taint > 1e-6 || fg.taint > 1e-6) {
      // Name the topmost unreadable layer: the one that shows through.
      const unreadable = [...items].reverse().find((it) => it.color === null);
      return missing(
        'input_missing',
        `${unreadable ? unreadable.label : canvas.label} lies beneath the text where the ` +
          'backdrop shows through, and its colour cannot be read from the DOM'
      );
    }

    const ancestorGroup = this.translucentGroupOverOpaque(owner, items);
    if (ancestorGroup) {
      return missing(
        'input_missing',
        `${this.describe(ancestorGroup)} has opacity ` +
          `${this.style(ancestorGroup).opacity} and contains the first opaque layer under the ` +
          'text, so the text and that layer are blended with whatever lies beneath it'
      );
    }
    const rgb = (c: Paint): VisionRgb => ({
      r: Math.round(c.r),
      g: Math.round(c.g),
      b: Math.round(c.b),
    });
    return { fg: rgb(fg), bg: rgb(bg) };
  }

  /**
   * What a layer the hit test shows ABOVE the text paints over it at `p`,
   * bottom-up. Only a plain colour the text shows through is composited —
   * over the text and its backdrop alike, at the opacity of the groups that
   * hold the layer and not the text. A layer that covers the text (an opaque
   * colour), or whose paint over it the DOM cannot read (an image, a filter,
   * a backdrop-filter, a blend, replaced content, its border, a scrollbar or
   * an inset box-shadow there, generated content, its own text), stops the
   * measurement, named. A layer that paints nothing there — a transparent
   * overlay, an empty stretched link — contributes nothing, and so does its
   * background where its own box misses `p`: a stretched link is listed
   * across its card for its `::after`, while its own background (a button's
   * fill) lies only on the link.
   */
  private paintAbove(
    layer: Element,
    owner: Element,
    p: { x: number; y: number }
  ): PaintItem[] | ColorUnmeasured {
    let fade = 1;
    for (const group of this.groupsOf(layer)) {
      if (!containsComposed(group, owner)) fade *= Number(this.style(group).opacity);
    }
    if (!(fade > 0)) return [];
    const st = this.style(layer);
    const stop = (how: string): ColorUnmeasured => this.coverStop(layer, p, how);
    const backdrop =
      st.getPropertyValue('backdrop-filter') || st.getPropertyValue('-webkit-backdrop-filter');
    if (backdrop && backdrop !== 'none') {
      return stop(`with backdrop-filter: ${backdrop}, which alters the text beneath it`);
    }
    if (st.mixBlendMode && st.mixBlendMode !== 'normal') {
      return stop(`and blends with it (mix-blend-mode: ${st.mixBlendMode})`);
    }
    if (st.filter && st.filter !== 'none') return stop(`with filter: ${st.filter}`);
    if (isReplaced(layer)) return stop('with pixels the DOM cannot read');
    const items: PaintItem[] = [];
    // The root's or body's background is painted on the canvas, beneath
    // everything, and a box that is not rendered paints none. A box paints
    // its background inside itself only: one listed here for what lies
    // outside it (a stretched link's ::after across its card) paints none
    // at a point its box misses.
    this.canvasPaint();
    const paintsBackground =
      this.canvasFrom !== layer &&
      st.visibility !== 'hidden' &&
      st.display !== 'contents' &&
      this.boxHolds(layer, st, p);
    const clip =
      st.getPropertyValue('background-clip') || st.getPropertyValue('-webkit-background-clip');
    // A background clipped to the glyphs paints only where the layer's own
    // text is, which the text check below answers.
    if (paintsBackground && clip !== 'text') {
      if (st.backgroundImage !== 'none') return stop('with a background-image');
      const bg = parseColor(st.backgroundColor);
      if (!bg) {
        return stop(`with a background colour ${JSON.stringify(st.backgroundColor)} not read`);
      }
      if (bg.a > 0) {
        if (bg.a * fade >= 1 - 1e-6) {
          return stop(`with an opaque background (${st.backgroundColor}) that covers it`);
        }
        items.push({ color: bg, owner: layer, label: this.describe(layer) });
      }
    }
    // Over its background a box paints its frame: a border, a scrollbar, an
    // inset box-shadow.
    if (st.visibility !== 'hidden' && st.display !== 'contents') {
      const frame = this.frameOf(layer, st, p);
      if (frame) return stop(`with its ${frame}`);
    }
    if (this.ownTextAt(layer, p)) return stop('with its own text at the same position');
    const generated = this.generatedOver(layer, p, false);
    if (generated instanceof ColorUnmeasured) return generated;
    return items;
  }

  /**
   * What a layer listed ABOVE the text paints over it when its own box paints
   * beneath the text: an ancestor of the text's owner, which paints its
   * background and borders before its content, or an element the hit test
   * lists beneath the text as well. Such a layer is listed above the text for
   * what it draws over that content — a positioned `::before` / `::after`
   * ({@link generatedOver}), or its open shadow tree, whose elements over the
   * text {@link coversAbove} lists as layers of their own — so its own
   * background is never composited over the text. When neither explains the
   * listing (a closed shadow tree may), what lies over the text is not known,
   * and the measurement stops. For an element that is not an ancestor
   * (`holds` false), the listing beneath may be its negative-z `::before`
   * instead, and its own box the one above, so the stop says only that it is
   * listed on both sides.
   */
  private generatedAbove(
    layer: Element,
    owner: Element,
    p: { x: number; y: number },
    holds: boolean
  ): PaintItem[] | ColorUnmeasured {
    const generated = this.generatedOver(layer, p, true);
    if (generated instanceof ColorUnmeasured) return generated;
    if (generated || shadowAbove(layer, owner, p).length > 0) return [];
    const at = `at (${Math.round(p.x)}, ${Math.round(p.y)})`;
    const listed = holds
      ? `above the text ${at}, but its own box paints beneath the text,`
      : `both above the text and beneath it ${at}, so a part of it paints over the text,`;
    const may = holds ? 'a closed shadow tree may' : 'its own box or a closed shadow tree may';
    return new ColorUnmeasured({
      code: 'input_missing',
      detail:
        `the hit test lists ${this.describe(layer)} ${listed} and neither a positioned ` +
        `::before / ::after nor an open shadow tree of its paints there (${may}), so the ` +
        'colours a reader sees there were not measured',
    });
  }

  /**
   * Whether `layer`'s `::before` / `::after` lies over the text at `p`. One
   * that paints anything there — a background colour or image, glyphs, its
   * border or an inset box-shadow — stops the measurement, named, and so
   * does one that paints any of them when the computed style does not pin
   * its box down, since it may lie there — though one in normal flow lies
   * only where it can reach from its element's box ({@link flowReach}). One
   * at `visibility: hidden` is not there, and one at `opacity: 0` (a hover
   * tint at rest) paints nothing there. `true` when the only ones there are
   * transparent (an empty stretched link) or at `opacity: 0`, `false` when
   * none is. `positionedOnly` reads only the ones that can lie over their
   * own element's content: positioned, with a z-index that is not negative.
   * One in normal flow is laid out beside that content, and one with a
   * negative z-index paints beneath it.
   */
  private generatedOver(
    layer: Element,
    p: { x: number; y: number },
    positionedOnly: boolean
  ): boolean | ColorUnmeasured {
    const stop = (how: string): ColorUnmeasured => this.coverStop(layer, p, how);
    let transparentThere = false;
    for (const which of ['::before', '::after'] as const) {
      const ps = this.pseudoStyle(layer, which);
      if (!this.pseudoShown(ps)) continue;
      if (positionedOnly && (ps.position === 'static' || Number(ps.zIndex) < 0)) continue;
      const bg = parseColor(ps.backgroundColor);
      const image = ps.backgroundImage !== 'none' && ps.backgroundImage !== '';
      const glyphs = ps.content !== '""' && ps.content !== "''";
      const extent = this.pseudoBox(layer, ps);
      const local = extent ? extent.toLocal(p) : null;
      if (extent && (!local || !pointIn(local, extent.box))) continue;
      const reach = extent ? null : this.flowReach(layer, ps);
      if (reach && !pointIn(p, reach)) continue;
      // Its frame (a border, an inset box-shadow) is read where its box is
      // known; where it is not, a frame anywhere may lie there.
      const framed =
        extent && local
          ? frameAt(ps, insetByBorders(extent.box, ps), 1, local) !== null
          : hasFrame(ps);
      const fades = Number(ps.opacity) === 0;
      if (fades || (!image && !glyphs && bg && bg.a === 0 && !framed)) {
        if (extent) transparentThere = true;
        continue;
      }
      return stop(`with ${which} generated content that ${extent ? 'covers' : 'may cover'} it`);
    }
    return transparentThere;
  }

  /** Stops the measurement at a layer that paints over the text in a way not composited. */
  private coverStop(layer: Element, p: { x: number; y: number }, how: string): ColorUnmeasured {
    return new ColorUnmeasured({
      code: 'input_missing',
      detail:
        `${this.describe(layer)} paints over the text at (${Math.round(p.x)}, ` +
        `${Math.round(p.y)}) ${how}, so the colours a reader sees there were not measured`,
    });
  }

  /**
   * What of `layer`'s frame lies at `p` over its background ({@link frameAt}),
   * or null. A box with no border or inset box-shadow that paints ({@link
   * hasFrame}), and no scrollbar since it does not scroll, has none. An
   * inline box draws its frame around each of its line fragments, so the
   * fragment `p` lies in is read as a box of its own, with all four borders.
   */
  private frameOf(
    layer: Element,
    st: CSSStyleDeclaration,
    p: { x: number; y: number }
  ): string | null {
    if (!hasFrame(st) && !scrolls(st)) return null;
    if (st.display === 'inline') {
      for (const r of Array.from(layer.getClientRects())) {
        const fragment = { x: r.left, y: r.top, w: r.width, h: r.height };
        if (pointIn(p, fragment)) return frameAt(st, insetByBorders(fragment, st), 1, p);
      }
      return null;
    }
    const box = boxOf(layer);
    if (!box || !pointIn(p, box)) return null;
    // The viewport's scrollbars are not the frame of the element that
    // scrolls it, whose client sizes are the viewport's: its frame is its
    // border and inset box-shadow alone.
    if (layer === document.documentElement || layer === document.scrollingElement) {
      return frameAt(st, insetByBorders(box, st), 1, p);
    }
    const pad = this.clipBox(layer, st);
    return frameAt(st, pad, Math.max(pad.sx, pad.sy), p);
  }

  /**
   * Whether the text sinks beneath `ancestor`, an ancestor of its owner: an
   * element from the owner up to `ancestor` (not included) has a negative
   * z-index, and nothing from that element up to `ancestor`, `ancestor`
   * included, starts a stacking context, so the one it sinks in holds
   * `ancestor` too. A stacking context paints its negative z-index layers
   * before the boxes of its other descendants (CSS 2.1 Appendix E), so
   * `ancestor` paints over the text. Otherwise `ancestor` paints its own box
   * beneath its content.
   */
  private sunkBeneath(owner: Element, ancestor: Element): boolean {
    for (let e: Element | null = owner; e && e !== ancestor; e = composedParent(e)) {
      const st = this.style(e);
      if (!(Number(st.zIndex) < 0)) continue;
      const parent = composedParent(e);
      // A z-index applies to a positioned box, and to a flex or grid item.
      const applies =
        st.position !== 'static' ||
        (parent !== null && /flex|grid/.test(this.style(parent).display));
      if (!applies) continue;
      let s = parent;
      while (s && s !== ancestor && !this.isStackingContext(s, this.style(s))) {
        s = composedParent(s);
      }
      if (s === ancestor && !this.isStackingContext(ancestor, this.style(ancestor))) return true;
    }
    return false;
  }

  /** Whether `p` lies in `layer`'s border box — an inline box's, in one of its line fragments. */
  private boxHolds(layer: Element, st: CSSStyleDeclaration, p: { x: number; y: number }): boolean {
    if (st.display !== 'inline') {
      const box = boxOf(layer);
      return box !== undefined && pointIn(p, box);
    }
    return Array.from(layer.getClientRects()).some((r) =>
      pointIn(p, { x: r.left, y: r.top, w: r.width, h: r.height })
    );
  }

  /** Does one of `layer`'s own text runs (not a descendant element's) paint at `p`? */
  private ownTextAt(layer: Element, p: { x: number; y: number }): boolean {
    return this.ownTextRects(layer).some((r) => pointIn(p, r));
  }

  /** The line boxes of `layer`'s own text runs (not a descendant element's). */
  private ownTextRects(layer: Element): VisionRegion[] {
    const doc = layer.ownerDocument;
    if (typeof doc.createRange !== 'function') return [];
    const rects: VisionRegion[] = [];
    for (const child of Array.from(layer.childNodes)) {
      if (child.nodeType !== 3 || !/\S/.test(child.nodeValue ?? '')) continue;
      const range = doc.createRange();
      if (typeof range.getClientRects !== 'function') return rects;
      range.selectNodeContents(child);
      for (const r of Array.from(range.getClientRects())) {
        rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    return rects;
  }

  /**
   * A filter, blend or background-clipped glyph fill on the text's owner or
   * any ancestor alters the text itself: no backdrop read can say what it
   * paints. Returns the detail, or null.
   */
  private textAffectedBy(owner: Element): string | null {
    for (let a: Element | null = owner; a; a = composedParent(a)) {
      const st = this.style(a);
      if (st.filter && st.filter !== 'none') {
        return `${this.describe(a)} applies filter: ${st.filter} to the text`;
      }
      if (st.mixBlendMode && st.mixBlendMode !== 'normal') {
        return `${this.describe(a)} blends the text with mix-blend-mode: ${st.mixBlendMode}`;
      }
      const clip =
        st.getPropertyValue('background-clip') || st.getPropertyValue('-webkit-background-clip');
      if (clip === 'text') {
        return `${this.describe(a)} fills the glyphs with its background (background-clip: text)`;
      }
    }
    return null;
  }

  /**
   * A layer the hit test cannot see (pointer-events: none) that paints at `p`
   * and does not hold the text, with what it paints there: its place in the
   * paint order is unknown, so whether it lies under the text or over it is
   * too. Every such layer of the page is a candidate ({@link
   * hitHiddenLayers}), wherever it hangs in the tree: a fixed scrim inside a
   * sticky header whose own box misses the text covers the text all the same.
   */
  private unplaceableLayerAt(
    p: { x: number; y: number },
    owner: Element,
    layers: readonly Element[]
  ): { layer: Element; what: string } | null {
    for (const { layer, bounds, paintsAt } of this.hitHiddenLayers()) {
      // Most such layers lie nowhere near the text: their kept bounds settle
      // that without reading the layout again.
      const reach = bounds();
      if (!reach || !pointIn(p, reach)) continue;
      if (layers.includes(layer) || containsComposed(layer, owner)) continue;
      const what = paintsAt(p);
      if (what) return { layer, what };
    }
    return null;
  }

  /**
   * Every element of the page that the hit test cannot see (it computes
   * `pointer-events: none`) and that paints, with what it paints at a
   * point: unless it is `visibility: hidden`, a background colour or image
   * or replaced content anywhere in its box, else its border, a scrollbar or
   * an inset box-shadow where that frame lies ({@link frameOf}) and its own
   * text where that text lies; and a `::before` / `::after` of its that
   * paints ({@link hitHiddenPseudo}). One walk of the composed tree per
   * request, open shadow roots included, reading each element's computed
   * style once, and the pseudo-elements' only for an element that computes
   * `pointer-events: none`; it does not descend into a subtree that renders
   * nothing (`display: none`) or paints nothing (`opacity: 0`). Only a
   * request that measures contrast walks it. Each layer's bounds — its box,
   * and its own text's line boxes, which may overflow it — are read once,
   * at the first point tested against it.
   */
  private hitHiddenLayers(): readonly HitHidden[] {
    if (this.hitHidden) return this.hitHidden;
    const found: HitHidden[] = [];
    const pending: Element[] = document.documentElement ? [document.documentElement] : [];
    while (pending.length > 0) {
      const el = pending.pop()!;
      const st = this.style(el);
      if (st.display === 'none' || st.opacity === '0') continue;
      const hidden = st.visibility === 'hidden' || st.visibility === 'collapse';
      if (st.pointerEvents === 'none') {
        // A box at visibility: hidden paints nothing; its pseudo-elements may.
        if (!hidden) {
          const bg = parseColor(st.backgroundColor);
          const replaced = isReplaced(el);
          if ((bg && bg.a > 0) || st.backgroundImage !== 'none' || replaced) {
            const box = once(() => boxOf(el) ?? null);
            const what = replaced ? 'replaced content' : 'a background';
            found.push({
              layer: el,
              bounds: box,
              paintsAt: (p) => {
                const b = box();
                return b && pointIn(p, b) ? what : null;
              },
            });
          } else {
            const framed = hasFrame(st) || scrolls(st);
            const text = hasOwnText(el);
            if (framed || text) {
              found.push({
                layer: el,
                bounds: once(() =>
                  unionOf([...(framed ? [boxOf(el)] : []), ...(text ? this.ownTextRects(el) : [])])
                ),
                paintsAt: (p) => {
                  const frame = framed ? this.frameOf(el, st, p) : null;
                  if (frame) return `its ${frame}`;
                  return text && this.ownTextAt(el, p) ? 'its own text' : null;
                },
              });
            }
          }
        }
        for (const which of ['::before', '::after'] as const) {
          const generated = this.hitHiddenPseudo(el, which);
          if (generated) found.push(generated);
        }
      }
      // Children last to first, so the walk visits them in document order.
      const children = [...Array.from(el.shadowRoot?.children ?? []), ...Array.from(el.children)];
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
    this.hitHidden = found;
    return found;
  }

  /**
   * `el`'s `::before` / `::after` as a layer the hit test cannot see: one
   * that computes `pointer-events: none`, is not `visibility: hidden` or at
   * `opacity: 0`, and paints a background colour or image, glyphs or a
   * frame ({@link hasFrame}). Where the computed style pins its box down (a
   * 2D transform included) it is read in that box, at the point `p` maps to
   * — a frame alone only where it lies there. One in normal flow is read
   * where it can reach ({@link flowReach}); elsewhere anywhere in `el`'s
   * box, which one moved by a 3D transform usually stays near.
   */
  private hitHiddenPseudo(el: Element, which: '::before' | '::after'): HitHidden | null {
    const ps = this.pseudoStyle(el, which);
    if (!this.pseudoShown(ps) || ps.pointerEvents !== 'none' || Number(ps.opacity) === 0) {
      return null;
    }
    const bg = parseColor(ps.backgroundColor);
    const image = ps.backgroundImage !== 'none' && ps.backgroundImage !== '';
    const glyphs = ps.content !== '""' && ps.content !== "''";
    const frameOnly = !image && !glyphs && bg !== null && bg.a === 0;
    if (frameOnly && !hasFrame(ps)) return null;
    const positioned = ps.position === 'absolute' || ps.position === 'fixed';
    const known = once(() => (positioned ? this.pseudoBox(el, ps) : null));
    const near = once(() => (positioned ? null : this.flowReach(el, ps)) ?? boxOf(el) ?? null);
    return {
      layer: el,
      bounds: () => known()?.bounds ?? near(),
      paintsAt: (p) => {
        const extent = known();
        if (extent) {
          const local = extent.toLocal(p);
          if (!local || !pointIn(local, extent.box)) return null;
          if (frameOnly && !frameAt(ps, insetByBorders(extent.box, ps), 1, local)) return null;
          return `its ${which}`;
        }
        const box = near();
        return box && pointIn(p, box) ? `its ${which}` : null;
      },
    };
  }

  /**
   * Whether a `::before` / `::after` is generated and shown: it has content,
   * is rendered, and is not `visibility: hidden`. One at `opacity: 0` (a
   * hover tint at rest) is shown and paints nothing; the hit test still
   * sees it.
   */
  private pseudoShown(ps: CSSStyleDeclaration): boolean {
    if (['none', 'normal', ''].includes(ps.content) || ps.display === 'none') return false;
    return ps.visibility !== 'hidden' && ps.visibility !== 'collapse';
  }

  /**
   * Where a `::before` / `::after` of `layer` in normal flow (static, or
   * relatively positioned) can paint: `layer`'s box, which it is laid out
   * in, grown by how far its relative offsets and its own transform move it
   * from there. A transform does not apply to a plain inline box; another's
   * 2D transform is read from the computed style against its own size, as
   * the farthest its corners move. Null when that is not known: a 3D
   * transform or a motion path, a size the computed style does not give, a
   * `display: contents` element, or a box that is not in flow. One that
   * overflows `layer`'s box is not seen past it.
   */
  private flowReach(layer: Element, ps: CSSStyleDeclaration): VisionRegion | null {
    if (ps.position !== 'static' && ps.position !== 'relative') return null;
    if (this.style(layer).display === 'contents') return null;
    const box = boxOf(layer);
    if (!box) return null;
    let by = 0;
    if (ps.position === 'relative') {
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const offset = pxValue(ps.getPropertyValue(side));
        if (Number.isFinite(offset)) by += Math.abs(offset);
      }
    }
    if (ps.display !== 'inline') {
      const w = pxValue(ps.width) + this.pseudoExtra(ps, 'left', 'right');
      const h = pxValue(ps.height) + this.pseudoExtra(ps, 'top', 'bottom');
      if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
      const extent = pseudoExtent({ x: 0, y: 0, w, h }, ps);
      if (!extent) return null;
      const b = extent.bounds;
      by += Math.max(0, -b.x, -b.y, b.x + b.w - w, b.y + b.h - h);
    }
    return grown(box, by);
  }

  /**
   * The base the page paints on: the root's background, else the body's —
   * one of them is propagated to the canvas — over the `Canvas` colour of the
   * root's used `color-scheme`. A page background the DOM cannot read (an
   * image, an unparseable colour) is an unreadable base: it decides nothing
   * where an opaque layer covers it.
   */
  private canvasPaint(): { paint: Paint; label: string } {
    if (this.canvas) return this.canvas;
    const base = this.prefersDarkCanvas() ? CANVAS_DARK : CANVAS_LIGHT;
    let result = { paint: premultiply(base), label: 'the canvas' };
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const st = this.style(el);
      const bg = parseColor(st.backgroundColor);
      if (st.backgroundImage !== 'none' || !bg) {
        const what = !bg
          ? `colour ${JSON.stringify(st.backgroundColor)}`
          : `image of ${this.describe(el)}`;
        result = { paint: UNREADABLE, label: `the page background ${what}` };
        this.canvasFrom = el;
        break;
      }
      if (bg.a > 0) {
        result = { paint: over(premultiply(bg), premultiply(base)), label: this.describe(el) };
        this.canvasFrom = el;
        break;
      }
    }
    this.canvas = result;
    return result;
  }

  /** Whether the root's used colour scheme is dark (its `color-scheme`, else the meta tag). */
  private prefersDarkCanvas(): boolean {
    let tokens = (this.style(document.documentElement).colorScheme ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0 || tokens.includes('normal')) {
      const meta = document.querySelector('meta[name="color-scheme"]');
      tokens = (meta?.getAttribute('content') ?? '')
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean);
    }
    const dark = tokens.includes('dark');
    const light = tokens.includes('light');
    if (dark && !light) return true;
    if (dark && light) {
      return typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
    }
    return false;
  }

  /** Does `el` start a stacking context? (The subset that decides a negative-z pseudo's place.) */
  private isStackingContext(el: Element, st: CSSStyleDeclaration): boolean {
    if (el === document.documentElement) return true;
    if (st.position === 'fixed' || st.position === 'sticky') return true;
    if (st.zIndex !== 'auto' && st.position !== 'static') return true;
    const parent = composedParent(el);
    if (parent && st.zIndex !== 'auto') {
      const display = this.style(parent).display;
      if (/flex|grid/.test(display)) return true;
    }
    return (
      Number(st.opacity) < 1 ||
      st.isolation === 'isolate' ||
      (st.mixBlendMode !== '' && st.mixBlendMode !== 'normal') ||
      this.fixedContainer(st)
    );
  }

  /**
   * The paint operations one layer contributes at `p`, bottom-up: what its
   * `backdrop-filter` hides, its own background, its frame over that
   * background ({@link frameOf}), and a negative-z positioned pseudo-element
   * under its content. A layer whose paint cannot be read
   * contributes an UNREADABLE operation, which matters only where nothing
   * opaque covers it. A pseudo that may paint OVER the text stops the
   * measurement instead.
   */
  private paintOf(
    layer: Element,
    owner: Element,
    p: { x: number; y: number }
  ): PaintItem[] | ColorUnmeasured {
    const st = this.style(layer);
    const name = this.describe(layer);
    const items: PaintItem[] = [];
    const isOwnerOrAncestor = containsComposed(layer, owner);

    const backdrop =
      st.getPropertyValue('backdrop-filter') || st.getPropertyValue('-webkit-backdrop-filter');
    if (backdrop && backdrop !== 'none') {
      items.push({ color: null, owner: layer, label: `the backdrop-filter of ${name}` });
    }

    // The root's or body's background is painted on the canvas instead, and a
    // `display: contents` element has no box to paint one on.
    this.canvasPaint();
    const propagated = this.canvasFrom === layer;
    if (!propagated && st.visibility !== 'hidden' && st.display !== 'contents') {
      if (layer !== owner && isReplaced(layer)) {
        items.push({ color: null, owner: layer, label: `the pixels of ${name}` });
      } else if (!isOwnerOrAncestor && st.filter && st.filter !== 'none') {
        items.push({ color: null, owner: layer, label: `${name} (filter: ${st.filter})` });
      } else if (!isOwnerOrAncestor && st.mixBlendMode && st.mixBlendMode !== 'normal') {
        items.push({
          color: null,
          owner: layer,
          label: `${name} (mix-blend-mode: ${st.mixBlendMode})`,
        });
      } else {
        const bg = parseColor(st.backgroundColor);
        const clip =
          st.getPropertyValue('background-clip') || st.getPropertyValue('-webkit-background-clip');
        if (clip !== 'text') {
          if (!bg) {
            items.push({
              color: null,
              owner: layer,
              label: `the background colour ${JSON.stringify(st.backgroundColor)} of ${name}`,
            });
          } else if (bg.a > 0) {
            items.push({ color: bg, owner: layer, label: name });
          }
          if (st.backgroundImage !== 'none') {
            items.push({ color: null, owner: layer, label: `the background-image of ${name}` });
          }
        }
      }
    }
    // Over its background a box paints its frame — a border, a scrollbar,
    // an inset box-shadow — which is not composited.
    if (st.visibility !== 'hidden' && st.display !== 'contents') {
      const frame = this.frameOf(layer, st, p);
      if (frame) items.push({ color: null, owner: layer, label: `the ${frame} of ${name}` });
    }

    for (const which of ['::before', '::after'] as const) {
      const pseudo = this.pseudoPaint(layer, st, which, p);
      if (pseudo instanceof ColorUnmeasured) return pseudo;
      if (pseudo) items.push(...pseudo);
    }
    return items;
  }

  /**
   * A pseudo-element's paint at `p`, under the plan's rule that each layer's
   * `::before` / `::after` background joins the backdrop. In normal flow a
   * pseudo-element is laid out beside the text, never under it, so only a
   * POSITIONED one can sit at the text's position. One whose box provably
   * misses `p`, or that paints nothing there, contributes nothing; so does a
   * transparent one whose box the computed style does not pin down (one its
   * relative offsets nudge, a 3D transform), whose glyphs and frame are not
   * known to reach `p`. One a 2D transform places is read in its own box at
   * the point `p` maps to.
   * One at `opacity: 0` or `visibility: hidden` paints nothing.
   * One with a negative `z-index` paints under its element's content, so it
   * joins the backdrop — its colour faded by its own opacity, its glyphs and
   * its frame (a border, an inset box-shadow) as unreadable operations; any
   * other positioned pseudo that paints there may paint over the text, and
   * the measurement stops.
   */
  private pseudoPaint(
    layer: Element,
    layerSt: CSSStyleDeclaration,
    which: '::before' | '::after',
    p: { x: number; y: number }
  ): PaintItem[] | null | ColorUnmeasured {
    const ps = this.pseudoStyle(layer, which);
    if (!this.pseudoShown(ps) || Number(ps.opacity) === 0) return null;
    const bg = parseColor(ps.backgroundColor);
    const image = ps.backgroundImage !== 'none' && ps.backgroundImage !== '';
    const glyphs = ps.content !== '""' && ps.content !== "''";
    // A transparent one paints only its glyphs and its frame.
    const clear = !image && bg !== null && bg.a === 0;
    if (clear && !glyphs && !hasFrame(ps)) return null;
    const label = `${this.describe(layer)}${which}`;
    const position = ps.position;
    const offsetsZero = ['top', 'left', 'bottom', 'right'].every((side) => {
      const v = ps.getPropertyValue(side);
      return v === 'auto' || v === '0px' || v === '';
    });
    if (
      position === 'static' ||
      ((position === 'relative' || position === 'sticky') && offsetsZero)
    ) {
      return null;
    }
    const extent = this.pseudoBox(layer, ps);
    const local = extent ? extent.toLocal(p) : null;
    if (extent && (!local || !pointIn(local, extent.box))) return null;
    // A transparent one whose box is not pinned down is taken to paint
    // nothing here: read as lying anywhere, an arrow its relative offsets
    // nudge would stop every text of its element. Where its box is known,
    // turned or not, its frame is read at the point `p` maps to.
    if (clear && !extent) return null;
    const frame = extent && local ? frameAt(ps, insetByBorders(extent.box, ps), 1, local) : null;
    if (clear && !glyphs && !frame) return null;
    const z = ps.zIndex === 'auto' ? NaN : Number(ps.zIndex);
    if (extent && Number.isFinite(z) && z < 0 && this.isStackingContext(layer, layerSt)) {
      const items: PaintItem[] = [];
      // Its own opacity fades its one colour.
      const opacity = Number(ps.opacity);
      if (bg && bg.a > 0) {
        const color = opacity < 1 ? { ...bg, a: bg.a * opacity } : bg;
        items.push({ color, owner: layer, label });
      }
      if (image)
        items.push({ color: null, owner: layer, label: `the background-image of ${label}` });
      if (!bg) items.push({ color: null, owner: layer, label });
      if (frame) items.push({ color: null, owner: layer, label: `the ${frame} of ${label}` });
      if (glyphs) {
        items.push({ color: null, owner: layer, label: `the generated content of ${label}` });
      }
      return items;
    }
    return new ColorUnmeasured({
      code: 'input_missing',
      detail:
        `${label} is a positioned box that ${extent ? 'covers' : 'may cover'} the text's position, ` +
        'and its paint order relative to the text is not resolved in the tab',
    });
  }

  /**
   * Where an absolutely or fixed positioned pseudo-element paints: its border
   * box from its resolved insets and size against its containing block, as
   * its own transform places it ({@link pseudoExtent}); null when the
   * computed style does not pin it down.
   */
  private pseudoBox(layer: Element, ps: CSSStyleDeclaration): PseudoExtent | null {
    let cb: { left: number; top: number };
    if (ps.position === 'fixed') {
      for (let a: Element | null = layer; a; a = composedParent(a)) {
        if (this.fixedContainer(this.style(a))) return null;
      }
      cb = { left: 0, top: 0 };
    } else if (ps.position === 'absolute') {
      let container: Element | null = layer;
      while (container && !this.absoluteContainer(this.style(container))) {
        container = composedParent(container);
      }
      if (!container) return null;
      const st = this.style(container);
      const r = container.getBoundingClientRect();
      cb = {
        left: r.left + (pxValue(st.borderLeftWidth) || 0) - container.scrollLeft,
        top: r.top + (pxValue(st.borderTopWidth) || 0) - container.scrollTop,
      };
    } else {
      return null;
    }
    const left = pxValue(ps.left);
    const top = pxValue(ps.top);
    const width = pxValue(ps.width);
    const height = pxValue(ps.height);
    if (![left, top, width, height].every(Number.isFinite)) return null;
    return pseudoExtent(
      {
        x: cb.left + left + (pxValue(ps.marginLeft) || 0),
        y: cb.top + top + (pxValue(ps.marginTop) || 0),
        w: width + this.pseudoExtra(ps, 'left', 'right'),
        h: height + this.pseudoExtra(ps, 'top', 'bottom'),
      },
      ps
    );
  }

  /**
   * What a `::before` / `::after` adds to its computed `width` / `height`
   * along one axis to make its border box: its padding and borders on the
   * two sides, or nothing under `box-sizing: border-box`.
   */
  private pseudoExtra(ps: CSSStyleDeclaration, a: string, b: string): number {
    if (ps.boxSizing === 'border-box') return 0;
    return [`padding-${a}`, `padding-${b}`, `border-${a}-width`, `border-${b}-width`].reduce(
      (sum, prop) => sum + (pxValue(ps.getPropertyValue(prop)) || 0),
      0
    );
  }

  /** The `opacity < 1` ancestors-or-self of `el`, outermost first. */
  private groupsOf(el: Element): Element[] {
    const groups: Element[] = [];
    for (let a: Element | null = el; a; a = composedParent(a)) {
      if (Number(this.style(a).opacity) < 1) groups.unshift(a);
    }
    return groups;
  }

  /**
   * The plan's opacity rule: an ancestor of the text with `opacity < 1` that
   * contains the first opaque layer under the text blends that layer, and the
   * text, with what lies beneath it — the measurement does not go there.
   */
  private translucentGroupOverOpaque(owner: Element, items: readonly PaintItem[]): Element | null {
    let firstOpaque: PaintItem | undefined;
    for (let i = items.length - 1; i >= 0; i--) {
      const c = items[i].color;
      if (c !== null && c.a >= 1) {
        firstOpaque = items[i];
        break;
      }
    }
    if (!firstOpaque) return null;
    for (const group of this.groupsOf(owner)) {
      if (containsComposed(group, firstOpaque.owner)) return group;
    }
    return null;
  }

  /**
   * Composite the paint operations bottom-up over the canvas, honouring
   * opacity groups: each `opacity < 1` element's subtree is composited on its
   * own and blended in at its opacity, as the browser paints it.
   */
  private composite(items: readonly PaintItem[], canvas: Paint): Paint {
    const frames: Array<{ group: Element | null; paint: Paint }> = [{ group: null, paint: canvas }];
    const close = (): void => {
      const frame = frames.pop()!;
      const opacity = Number(this.style(frame.group!).opacity);
      const parent = frames[frames.length - 1];
      parent.paint = over(scale(frame.paint, opacity), parent.paint);
    };
    for (const item of items) {
      const groups = this.groupsOf(item.owner);
      // Close the open groups this item is not inside, then open its own.
      let depth = 1;
      while (depth < frames.length && frames[depth].group === groups[depth - 1]) depth += 1;
      while (frames.length > depth) close();
      for (let g = depth - 1; g < groups.length; g++) {
        frames.push({ group: groups[g], paint: { r: 0, g: 0, b: 0, a: 0, taint: 0 } });
      }
      const top = frames[frames.length - 1];
      top.paint = over(item.color === null ? UNREADABLE : premultiply(item.color), top.paint);
    }
    while (frames.length > 1) close();
    return frames[0].paint;
  }
}
