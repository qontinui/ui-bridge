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
 *   `::before` / `::after` background. A background image (gradients
 *   included), `filter`, `backdrop-filter`, `mix-blend-mode`, replaced content
 *   (`<img>`, `<video>`, `<canvas>`, …) or a `pointer-events: none` layer the
 *   hit test cannot order, anywhere the text could show it, makes the colour
 *   `unknown{input_missing}`; so does an ancestor with `opacity < 1` that
 *   contains the first opaque layer. A translucent colour or an opacity group
 *   above that layer is composited exactly. With no opaque layer, the base is
 *   the `Canvas` colour under the root's `color-scheme`.
 * - `text_fits_container` — a block-level element's `scrollWidth` /
 *   `scrollHeight`, with its borders and scrollbars added back, against its
 *   border box with the size `Math.ceil`'d (vision-core's comparison and the
 *   producer contract); strictly greater fails. Both sides are LAYOUT sizes
 *   (`offset*` / `scroll*` / `client*`), so a CSS transform does not read as
 *   overflow. An inline element is measured by its own line fragments
 *   (`getClientRects`) against the content box of the block it lays out in,
 *   so a sibling's overflow is not its own; when it exposes no fragment, the
 *   block's extents stand in only if it is all the block holds, else
 *   `unknown{input_missing}`. No text is `unknown{input_missing}`.
 * - `no_overlap` — border boxes (`getBoundingClientRect`), exact: geometry is
 *   never rounded up, or adjacent fractional boxes would read as overlapping.
 * - `element_above` — paint order from `document.elementsFromPoint` at sample
 *   points inside both the pair's intersection and the viewport. The
 *   evaluator never scrolls; no sample showing both is
 *   `unknown{hit_test_unmeasurable}`.
 * - `no_clipping` — each registered element's border box against the padding
 *   box of its nearest ancestor that clips that axis (`overflow-x` /
 *   `overflow-y` of `hidden` or `clip`, or `contain: paint`), following the
 *   containing-block chain, so an absolutely or fixed positioned element is
 *   not checked against an ancestor that does not clip it. A scroll container
 *   (`overflow` `auto` or `scroll`) is not a clip: content scrolled out of it
 *   is reachable, so the nearest scroll container settles that axis as
 *   unclipped, and an ancestor further out is compared with the scroll
 *   container's own box instead. The element set is the registry's — the
 *   same set every UI Bridge read and the runner path see. An element nothing
 *   clips is not a compared pair; zero compared pairs is
 *   `unknown{input_missing}`.
 *
 * SECURITY SURFACE: this executes no caller-supplied code. It is a fixed
 * evaluator over a typed, validated assertion list; the only caller input
 * that reaches the DOM is an element id, used as a registry key. It reads the
 * tab and writes nothing to it.
 *
 * REDACTION (§4.6): element text reaches a result only through
 * `readScrubbedVisibleText` (core/a11y.ts), which mints it through
 * `scrubContentByVerdict`: inside a `data-bridge-redact` boundary it is
 * `[REDACTED]`, and so is every boundary INSIDE the element, so a container's
 * text cannot carry a redacted child out. Geometry, colours and ids are not
 * content.
 */

import {
  Observation,
  type ObservationProducer,
  type UnknownCode,
  type UnmeasuredDimension,
} from '../observation/observation';
import { parseColor, type RGBA } from '../specs/color-utils';
import {
  isInteractionBlocked,
  readInteractionBlockers,
  readScrubbedVisibleText,
} from '../core/a11y';
import { classList } from '../core/class-name';
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

/** A resolved `px` length, or NaN. */
function pxValue(v: string): number {
  return v.endsWith('px') ? Number(v.slice(0, -2)) : NaN;
}

/** The hit test, or null when this DOM does not implement it. */
function hitStack(x: number, y: number): Element[] | null {
  const fn = (document as Document & { elementsFromPoint?: Document['elementsFromPoint'] })
    .elementsFromPoint;
  if (typeof fn !== 'function') return null;
  return fn.call(document, x, y);
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

/** What an element does to its content's overflow on one axis. */
type Overflow = 'clip' | 'scroll' | null;

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
  private pointerNoneLayers: Element[] | null = null;
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
   * extents with the BORDER box, strictly, and the producer contract (plan
   * 2026-11-09 Phase 0) takes that box's size rounded UP, so an integer extent
   * never fails against a fractional box. Both sides come from LAYOUT sizes
   * (`offset*` / `scroll*` / `client*`), which a CSS transform does not change
   * — `getBoundingClientRect` is the transformed box, and a `scale(0.5)` card
   * would otherwise read as overflowing by half. `scroll*` measures only the
   * padding box, so the borders and scrollbars (`offset*` - `client*`) are
   * added back: without them an overflow narrower than the borders plus a
   * scrollbar would pass.
   */
  private fitOwnBox(el: Element, record: MeasuredElement): void {
    const html = el as HTMLElement;
    if (typeof html.offsetWidth === 'number' && typeof html.offsetHeight === 'number') {
      record.fitBox = { w: Math.ceil(html.offsetWidth), h: Math.ceil(html.offsetHeight) };
      record.scrollWidthPx = el.scrollWidth + Math.max(0, html.offsetWidth - el.clientWidth);
      record.scrollHeightPx = el.scrollHeight + Math.max(0, html.offsetHeight - el.clientHeight);
    } else {
      // No layout sizes (an SVG element): its own box, untransformed only if
      // it is not transformed — the best this DOM exposes.
      const r = el.getBoundingClientRect();
      record.fitBox = { w: Math.ceil(r.width), h: Math.ceil(r.height) };
      record.scrollWidthPx = el.scrollWidth;
      record.scrollHeightPx = el.scrollHeight;
    }
    const overflow = this.style(el).textOverflow;
    if (overflow) record.textOverflow = overflow;
  }

  /**
   * An inline element's text is measured by its OWN line fragments
   * (`getClientRects`) against the content box of the block it lays out in.
   * The block's scroll extents alone would answer for every sibling in it: a
   * short label beside a long one would read as overflowing. They still decide
   * that an axis does NOT overflow; where it does, the fragments say whose
   * text overflows. Fragments and box are both viewport rectangles, so a
   * transform scales them alike. The fit box is the content box rounded up;
   * the extent is how far the fragments reach, rounded, so sub-pixel layout
   * noise is not overflow.
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
    const w = content.right - content.left;
    const h = content.bottom - content.top;
    const fitW = Math.ceil(w);
    const fitH = Math.ceil(h);
    // A block that does not overflow an axis cuts no line on it, whatever
    // its fragments' sub-pixel and font-metric rounding say; where it does,
    // the fragments say whether THIS element's text is what overflows.
    const overX =
      block.scrollWidth > block.clientWidth
        ? Math.max(0, right - content.right, content.left - left)
        : 0;
    const overY =
      block.scrollHeight > block.clientHeight
        ? Math.max(0, bottom - content.bottom, content.top - top)
        : 0;
    record.fitBox = { w: fitW, h: fitH };
    record.scrollWidthPx = Math.round(fitW + overX);
    record.scrollHeightPx = Math.round(fitH + overY);
    const overflow = this.style(block).textOverflow;
    if (overflow) record.textOverflow = overflow;
  }

  /**
   * The content box of `el` in viewport pixels: its border box less borders,
   * padding and scrollbars, scaled like the box when it is transformed. Null
   * when the box has no layout size to scale by.
   */
  private contentBox(
    el: Element
  ): { left: number; top: number; right: number; bottom: number } | null {
    const html = el as HTMLElement;
    if (typeof html.offsetWidth !== 'number' || html.offsetWidth <= 0 || html.offsetHeight <= 0) {
      return null;
    }
    const r = el.getBoundingClientRect();
    const st = this.style(el);
    const sx = r.width / html.offsetWidth;
    const sy = r.height / html.offsetHeight;
    const px = (v: string): number => pxValue(v) || 0;
    return {
      left: r.left + (px(st.borderLeftWidth) + px(st.paddingLeft)) * sx,
      right: r.left + (px(st.borderLeftWidth) + el.clientWidth - px(st.paddingRight)) * sx,
      top: r.top + (px(st.borderTopWidth) + px(st.paddingTop)) * sy,
      bottom: r.top + (px(st.borderTopWidth) + el.clientHeight - px(st.paddingBottom)) * sy,
    };
  }

  /** Does `block` lay out anything besides `el`: another element child in flow, or text? */
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
    }
    return false;
  }

  /** The element's visible text, scrubbed — its own boundary and every boundary inside it. */
  private scrubbedText(el: Element): string | undefined {
    return readScrubbedVisibleText(el);
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
    // Only `hidden` and `clip` (or `contain: paint`) cut content off. `scroll`
    // and `auto` make a scroll container, whose overflow is reachable by
    // scrolling: a row scrolled out of a list is not clipped.
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
   * transformed. Half a pixel of slack absorbs the layout's sub-pixel rounding,
   * which is not clipping anyone can see.
   */
  private clipBox(el: Element, st: CSSStyleDeclaration): ClipBounds {
    const r = el.getBoundingClientRect();
    const html = el as HTMLElement;
    const ow = html.offsetWidth || r.width;
    const oh = html.offsetHeight || r.height;
    const sx = ow > 0 ? r.width / ow : 1;
    const sy = oh > 0 ? r.height / oh : 1;
    const bl = pxValue(st.borderLeftWidth) || 0;
    const bt = pxValue(st.borderTopWidth) || 0;
    const left = r.left + bl * sx;
    const top = r.top + bt * sy;
    const SLACK = 0.5;
    return {
      left: left - SLACK,
      top: top - SLACK,
      right: left + el.clientWidth * sx + SLACK,
      bottom: top + el.clientHeight * sy + SLACK,
      byX: '',
      byY: '',
    };
  }

  /**
   * The clip of `el`: per axis, the padding box of its nearest ancestor that
   * clips that axis, walking only the ancestors that can clip it — an
   * absolutely positioned element skips the ancestors below its containing
   * block, a fixed one every ancestor below one that contains fixed
   * descendants. A scroll container met first settles that axis as unclipped:
   * what overflows it is reachable by scrolling, and its own box — not the
   * content scrolled inside it — is what an ancestor further out can cut off.
   * `null` when nothing clips it.
   */
  private clipOf(el: Element): ClipBounds | null {
    let need: 'all' | 'absolute' | 'fixed' = this.positionMode(this.style(el));
    type Side = { box: ClipBounds; by: Element } | 'scrolls' | null;
    let x: Side = null;
    let y: Side = null;
    for (let a = composedParent(el); a && !(x && y); a = composedParent(a)) {
      const st = this.style(a);
      const eligible =
        need === 'all' ||
        (need === 'absolute' && this.absoluteContainer(st)) ||
        (need === 'fixed' && this.fixedContainer(st));
      if (!eligible) continue;
      const axes = this.overflowAxes(a, st);
      const box = axes.x === 'clip' || axes.y === 'clip' ? this.clipBox(a, st) : null;
      if (!x && axes.x) x = box && axes.x === 'clip' ? { box, by: a } : 'scrolls';
      if (!y && axes.y) y = box && axes.y === 'clip' ? { box, by: a } : 'scrolls';
      need = this.positionMode(st);
    }
    if (x === 'scrolls') x = null;
    if (y === 'scrolls') y = null;
    if (!x && !y) return null;
    const label = (side: { by: Element } | null, axis: string, prop: string): string =>
      side
        ? `the ${axis} clip of ${this.describe(side.by)}, its nearest ancestor clipping ${prop} ` +
          `(${this.clipReason(side.by, prop)})`
        : '';
    return {
      left: x ? x.box.left : -Infinity,
      right: x ? x.box.right : Infinity,
      top: y ? y.box.top : -Infinity,
      bottom: y ? y.box.bottom : Infinity,
      byX: label(x, 'horizontal', 'overflow-x'),
      byY: label(y, 'vertical', 'overflow-y'),
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

  /**
   * The first rendered run of text inside `el` and the element that owns it,
   * or null when `el` holds no rendered text. A run of 1 px or less is a
   * visually hidden (`sr-only`) label, not the text a reader sees.
   */
  private firstTextRun(el: Element): { owner: Element; rect: DOMRect } | null {
    const doc = el.ownerDocument;
    // A DOM without text geometry (jsdom has no Range#getClientRects) cannot
    // place the text; the element's own box stands in for it.
    if (typeof doc.createRange !== 'function') return null;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!/\S/.test(node.nodeValue ?? '')) continue;
      const range = doc.createRange();
      if (typeof range.getClientRects !== 'function') return null;
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
    const run = this.firstTextRun(el);
    const owner = run?.owner ?? el;
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

    // The paint stack under the text, top first: the hit stack beneath the
    // text's owner, plus the DOM ancestors the hit test skipped
    // (pointer-events: none), each placed above the first entry outside it.
    const layers = stack.slice(at);
    for (let a = composedParent(owner); a; a = composedParent(a)) {
      if (layers.includes(a)) continue;
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
        `${this.describe(unplaceable)} paints a background at the text's position but computes ` +
          'pointer-events: none, so the hit test cannot place it in the paint order'
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

    const canvas = this.canvasPaint();
    const bg = this.composite(items, canvas.paint);
    const fg = this.composite([...items, { color: fill, owner, label: 'the text' }], canvas.paint);
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
   * A non-ancestor layer the hit test cannot see (pointer-events: none) that
   * paints at `p`: its place in the paint order is unknown, so whether it lies
   * under or over the text is too. Scanned once per request.
   */
  private unplaceableLayerAt(
    p: { x: number; y: number },
    owner: Element,
    layers: readonly Element[]
  ): Element | null {
    if (this.pointerNoneLayers === null) {
      this.pointerNoneLayers = [];
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      for (
        let node = walker.currentNode as Element | null;
        node;
        node = walker.nextNode() as Element | null
      ) {
        const st = this.style(node);
        if (!readInteractionBlockers(node, st).pointerEventsNone) continue;
        if (st.visibility === 'hidden' || st.opacity === '0' || st.display === 'none') continue;
        const bg = parseColor(st.backgroundColor);
        if ((bg && bg.a > 0) || st.backgroundImage !== 'none' || isReplaced(node)) {
          this.pointerNoneLayers.push(node);
        }
      }
    }
    for (const layer of this.pointerNoneLayers) {
      if (layers.includes(layer) || containsComposed(layer, owner)) continue;
      const box = boxOf(layer);
      if (box && pointIn(p, box)) return layer;
    }
    return null;
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
   * `backdrop-filter` hides, its own background, and a negative-z positioned
   * pseudo-element under its content. A layer whose paint cannot be read
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
   * misses `p` contributes nothing; one with a negative `z-index` paints under
   * its element's content, so it joins the backdrop; any other positioned
   * pseudo there may paint over the text, and the measurement stops.
   */
  private pseudoPaint(
    layer: Element,
    layerSt: CSSStyleDeclaration,
    which: '::before' | '::after',
    p: { x: number; y: number }
  ): PaintItem[] | null | ColorUnmeasured {
    const ps = this.pseudoStyle(layer, which);
    if (
      ps.content === 'none' ||
      ps.content === 'normal' ||
      ps.content === '' ||
      ps.display === 'none'
    ) {
      return null;
    }
    const bg = parseColor(ps.backgroundColor);
    const image = ps.backgroundImage !== 'none' && ps.backgroundImage !== '';
    if (!image && bg && bg.a === 0) return null;
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
    const box = this.pseudoBox(layer, ps);
    if (box && !pointIn(p, box)) return null;
    const z = ps.zIndex === 'auto' ? NaN : Number(ps.zIndex);
    if (box && Number.isFinite(z) && z < 0 && this.isStackingContext(layer, layerSt)) {
      const items: PaintItem[] = [];
      if (bg && bg.a > 0) items.push({ color: bg, owner: layer, label });
      if (image)
        items.push({ color: null, owner: layer, label: `the background-image of ${label}` });
      if (!bg) items.push({ color: null, owner: layer, label });
      return items;
    }
    return new ColorUnmeasured({
      code: 'input_missing',
      detail:
        `${label} is a positioned box that ${box ? 'covers' : 'may cover'} the text's position, ` +
        'and its paint order relative to the text is not resolved in the tab',
    });
  }

  /**
   * The border box of an absolutely or fixed positioned pseudo-element, from
   * its resolved insets and size against its containing block; null when the
   * computed style does not pin it down.
   */
  private pseudoBox(layer: Element, ps: CSSStyleDeclaration): VisionRegion | null {
    if (ps.transform && ps.transform !== 'none') return null;
    let cb: { left: number; top: number } | null = null;
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
    const extra = (a: string, b: string, c: string, d: string): number =>
      ps.boxSizing === 'border-box'
        ? 0
        : [a, b, c, d].reduce((sum, prop) => sum + (pxValue(ps.getPropertyValue(prop)) || 0), 0);
    return {
      x: cb.left + left + (pxValue(ps.marginLeft) || 0),
      y: cb.top + top + (pxValue(ps.marginTop) || 0),
      w: width + extra('padding-left', 'padding-right', 'border-left-width', 'border-right-width'),
      h: height + extra('padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width'),
    };
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
