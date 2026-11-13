/**
 * `POST /vision/assert` request validation — the one boundary every transport
 * checks a body at.
 *
 * The relay handler (`server/relay-handlers.ts`) calls
 * {@link parseVisionAssertRequest} BEFORE it queues anything on the relay, so
 * a malformed body is refused with `UB-VALIDATION-ERROR` and never reaches a
 * tab. The tab (`react/commandHandlers.ts`, `case 'visionAssert'`) and the
 * in-process handlers (`server/handlers.ts`) call it again through
 * `evaluateVisionAssertions`, because a WebSocket client can dispatch the
 * command without passing through the relay handler.
 *
 * For `assertions`, what it accepts is what vision-core's serde deserializer
 * accepts for an `AssertRequest` (`qontinui-runner` `vision_routes.rs`), so the
 * runner and the SDK refuse the same assertion lists. The runner also types
 * top-level inputs this evaluator does not read (`target`, `timelineRef`,
 * `ocrBlocks`, `textHiddenFrame`); the SDK ignores them, so a body the runner
 * refuses for a malformed one of those is answered here:
 *
 * - `assertions` is required and is an array (an EMPTY array is legal: it
 *   answers `unknown{no_results}`, never a pass).
 * - each assertion is one of the 23 variants of vision-core's `Assertion`
 *   (`rust-vision-core/src/assertions/mod.rs`), with every field typed as there:
 *   `[String; 2]` is exactly two strings, `u32` / `u64` / `u8` / `i32` are
 *   integers in range, an `Option` field takes `null`, and a defaulted
 *   non-`Option` field (`require_overlap`, `level`, `kind`, `dimensions`) may be
 *   left out but not sent as `null`;
 * - a key vision-core does not read is ignored, inside an assertion as at the
 *   top level (the adapters add `tabId`), exactly as serde ignores it.
 *
 * One refusal is the SDK's own: a caller-supplied `snapshot`. The in-tab
 * evaluator measures the live page and reads no caller snapshot, and the five
 * kinds it evaluates are exactly the ones a snapshot would decide — so
 * accepting one would compute an answer on an input other than the one the
 * caller sent. The other runner-only inputs (`ocr_blocks`, `timelineRef`,
 * `target`, the text-hidden frame) feed only kinds the SDK answers
 * `unknown{capability_unavailable_in_build}`, so they are accepted and not read.
 *
 * The parsed assertion is NORMALIZED to the echo vision-core serializes: every
 * optional field present (`null` when not given), every default filled in.
 */

import type {
  TextMatchKind,
  TypographyDimension,
  VisionAssertion,
  VisionAssertionKind,
  VisionNaturalRegion,
  VisionRegion,
  VisionRgb,
  WcagLevel,
} from './wire';

/** Every assertion `type`, in vision-core's declaration order (`mod.rs:70-310`). */
export const VISION_ASSERTION_KINDS: readonly VisionAssertionKind[] = [
  'no_overlap',
  'element_above',
  'contains_text',
  'text_fits_container',
  'aligned_horizontally',
  'aligned_vertically',
  'color_within',
  'typography_consistent',
  'no_layout_shift_since',
  'no_clipping',
  'animation_settled',
  'settled_within',
  'state_entered_within',
  'contrast_meets_wcag',
  'image_palette_within',
  'no_near_duplicate_images',
  'no_placeholder_images',
  'image_focal_visible',
  'transparent_image_legible',
  'salience_order',
  'image_sharpness_at_least',
  'image_blockiness_within',
  'text_over_image_contrast',
] as const;

/**
 * The most assertions one in-tab request evaluates. The relay gives a command
 * 8 s by default; a contrast measurement costs a hit test and a few style
 * reads, so a batch this size stays well inside it. A larger batch is refused,
 * loudly, rather than left to time out half-measured.
 */
export const MAX_VISION_ASSERTIONS = 2000;

const ROUTE = '/vision/assert';

/**
 * A `/vision/assert` body that vision-core would not deserialize, or that the
 * in-tab evaluator cannot honour. Every transport answers it with
 * `UB-VALIDATION-ERROR` (pattern: `specs/quality-request.ts`
 * `QualityRequestError`).
 */
export class VisionAssertRequestError extends Error {
  /** The internal code every transport maps onto `UB-VALIDATION-ERROR`. */
  readonly code = 'INVALID_REQUEST';

  constructor(message: string) {
    super(message);
    this.name = 'VisionAssertRequestError';
  }
}

/** A validated `/vision/assert` request. */
export interface ParsedVisionAssertRequest {
  /** The assertions, normalized to the echo vision-core serializes. */
  assertions: VisionAssertion[];
}

type Body = Record<string, unknown>;

function isObject(value: unknown): value is Body {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(path: string, what: string): never {
  throw new VisionAssertRequestError(`${ROUTE}: ${path} ${what}`);
}

const U32_MAX = 4_294_967_295;
const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;

/** A required string. */
function str(body: Body, key: string, path: string): string {
  const v = body[key];
  if (typeof v !== 'string') refuse(`${path}.${key}`, 'must be a string');
  return v;
}

/** An `Option<String>`: absent and `null` are `null`. */
function optStr(body: Body, key: string, path: string): string | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') refuse(`${path}.${key}`, 'must be a string or null');
  return v;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/** A required `u32`. */
function u32(body: Body, key: string, path: string): number {
  const v = body[key];
  if (!isInt(v, 0, U32_MAX)) refuse(`${path}.${key}`, `must be an integer from 0 to ${U32_MAX}`);
  return v;
}

/** An `Option<u32>`. */
function optU32(body: Body, key: string, path: string): number | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  return u32(body, key, path);
}

/**
 * A `u64`. JSON numbers past 2^53 lose precision in JavaScript, so the bound
 * here is `Number.MAX_SAFE_INTEGER` — a millisecond count that size is ~285,000
 * years, so no real `ms` is refused by it.
 */
function u64(body: Body, key: string, path: string): number {
  const v = body[key];
  if (!isInt(v, 0, Number.MAX_SAFE_INTEGER)) {
    refuse(`${path}.${key}`, `must be an integer from 0 to ${Number.MAX_SAFE_INTEGER}`);
  }
  return v;
}

/** A required `f64` (JSON has no non-finite number, so any number). */
function f64(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) refuse(path, 'must be a number');
  return value;
}

/** An `Option<f64>`. */
function optF64(body: Body, key: string, path: string): number | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  return f64(v, `${path}.${key}`);
}

/** A `bool` with a serde default: absent takes the default, `null` is refused. */
function boolWithDefault(body: Body, key: string, path: string, fallback: boolean): boolean {
  const v = body[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') refuse(`${path}.${key}`, 'must be a boolean');
  return v;
}

/** `[String; 2]`. */
function pair(body: Body, key: string, path: string): [string, string] {
  const v = body[key];
  if (!Array.isArray(v) || v.length !== 2 || !v.every((s) => typeof s === 'string')) {
    refuse(`${path}.${key}`, 'must be an array of exactly 2 strings');
  }
  return [v[0] as string, v[1] as string];
}

/** `Vec<String>`. */
function strings(body: Body, key: string, path: string): string[] {
  const v = body[key];
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
    refuse(`${path}.${key}`, 'must be an array of strings');
  }
  return [...(v as string[])];
}

/** vision-core `Region`: `{x, y}` are `i32`, `{w, h}` are `u32`. */
function region(value: unknown, path: string): VisionRegion {
  if (
    !isObject(value) ||
    !isInt(value.x, I32_MIN, I32_MAX) ||
    !isInt(value.y, I32_MIN, I32_MAX) ||
    !isInt(value.w, 0, U32_MAX) ||
    !isInt(value.h, 0, U32_MAX)
  ) {
    refuse(path, 'must be a region { x, y, w, h } of integers, with w and h not negative');
  }
  return { x: value.x as number, y: value.y as number, w: value.w as number, h: value.h as number };
}

/** An `Option<Region>`. */
function optRegion(body: Body, key: string, path: string): VisionRegion | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  return region(v, `${path}.${key}`);
}

/** vision-core `Rgb`: three `u8`. */
function rgb(value: unknown, path: string): VisionRgb {
  if (
    !isObject(value) ||
    !isInt(value.r, 0, 255) ||
    !isInt(value.g, 0, 255) ||
    !isInt(value.b, 0, 255)
  ) {
    refuse(path, 'must be a colour { r, g, b } of integers from 0 to 255');
  }
  return { r: value.r as number, g: value.g as number, b: value.b as number };
}

/** vision-core `NaturalRegion`: four `f64`. */
function naturalRegion(value: unknown, path: string): VisionNaturalRegion {
  if (!isObject(value)) refuse(path, 'must be an object { x, y, width, height } of numbers');
  return {
    x: f64(value.x, `${path}.x`),
    y: f64(value.y, `${path}.y`),
    width: f64(value.width, `${path}.width`),
    height: f64(value.height, `${path}.height`),
  };
}

/** A snake_case enum with a serde default: absent takes it, `null` is refused. */
function enumWithDefault<T extends string>(
  body: Body,
  key: string,
  path: string,
  allowed: readonly T[],
  fallback: T
): T {
  const v = body[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    refuse(`${path}.${key}`, `must be one of ${allowed.join(', ')}`);
  }
  return v as T;
}

const TEXT_MATCH_KINDS: readonly TextMatchKind[] = ['contains', 'exact', 'regex'];
const WCAG_LEVELS: readonly WcagLevel[] = ['aa', 'aaa'];
const TYPOGRAPHY_DIMENSIONS: readonly TypographyDimension[] = [
  'font_family',
  'font_size',
  'line_height',
];

/**
 * vision-core's `TextTarget` is an UNTAGGED enum tried in order: `{element}`
 * first, then `{region}`. A body carrying both is read as the element target,
 * because serde ignores the unread `region` key.
 */
function textTarget(body: Body, path: string): { element: string } | { region: VisionRegion } {
  const target = body.target;
  const where = `${path}.target`;
  if (!isObject(target)) refuse(where, 'must be { element } or { region }');
  if (typeof target.element === 'string') return { element: target.element };
  if (target.region !== undefined) return { region: region(target.region, `${where}.region`) };
  return refuse(where, 'must be { element } or { region }');
}

/**
 * Validate and normalize ONE assertion. `path` names it in a refusal
 * (`assertions[3]`).
 */
export function parseVisionAssertion(raw: unknown, path = 'assertion'): VisionAssertion {
  if (!isObject(raw)) refuse(path, 'must be an object with a `type`');
  const type = raw.type;
  if (typeof type !== 'string' || !(VISION_ASSERTION_KINDS as readonly string[]).includes(type)) {
    refuse(
      `${path}.type`,
      `must be one of ${VISION_ASSERTION_KINDS.join(', ')} (got ${JSON.stringify(type)})`
    );
  }
  const kind = type as VisionAssertionKind;
  switch (kind) {
    case 'no_overlap':
      return {
        type: kind,
        elements: pair(raw, 'elements', path),
        tolerance_px: optU32(raw, 'tolerance_px', path),
      };
    case 'element_above':
      return {
        type: kind,
        elements: pair(raw, 'elements', path),
        require_overlap: boolWithDefault(raw, 'require_overlap', path, true),
      };
    case 'contains_text':
      return {
        type: kind,
        target: textTarget(raw, path),
        text: str(raw, 'text', path),
        kind: enumWithDefault(raw, 'kind', path, TEXT_MATCH_KINDS, 'contains'),
      };
    case 'text_fits_container':
      return { type: kind, element: str(raw, 'element', path) };
    case 'aligned_horizontally':
    case 'aligned_vertically':
      return {
        type: kind,
        elements: strings(raw, 'elements', path),
        axis_tolerance_px: optU32(raw, 'axis_tolerance_px', path),
      };
    case 'color_within':
      return {
        type: kind,
        element: str(raw, 'element', path),
        expected: rgb(raw.expected, `${path}.expected`),
        delta_e_max: optF64(raw, 'delta_e_max', path),
      };
    case 'typography_consistent': {
      const dims = raw.dimensions;
      let dimensions: TypographyDimension[] = [];
      if (dims !== undefined) {
        if (
          !Array.isArray(dims) ||
          !dims.every((d) => (TYPOGRAPHY_DIMENSIONS as readonly unknown[]).includes(d))
        ) {
          refuse(`${path}.dimensions`, `must be an array of ${TYPOGRAPHY_DIMENSIONS.join(', ')}`);
        }
        dimensions = [...(dims as TypographyDimension[])];
      }
      return { type: kind, elements: strings(raw, 'elements', path), dimensions };
    }
    case 'no_layout_shift_since':
      return {
        type: kind,
        baseline: str(raw, 'baseline', path),
        tolerance_px: optU32(raw, 'tolerance_px', path),
      };
    case 'no_clipping':
      return { type: kind, region: optRegion(raw, 'region', path) };
    case 'animation_settled':
      return { type: kind, region: optRegion(raw, 'region', path) };
    case 'settled_within':
      return { type: kind, ms: u64(raw, 'ms', path) };
    case 'state_entered_within':
      return { type: kind, state: str(raw, 'state', path), ms: u64(raw, 'ms', path) };
    case 'contrast_meets_wcag':
      return {
        type: kind,
        element: str(raw, 'element', path),
        level: enumWithDefault(raw, 'level', path, WCAG_LEVELS, 'aa'),
      };
    case 'image_palette_within': {
      const palette = raw.palette;
      if (!Array.isArray(palette)) refuse(`${path}.palette`, 'must be an array of colours');
      return {
        type: kind,
        element: str(raw, 'element', path),
        palette: palette.map((c, i) => rgb(c, `${path}.palette[${i}]`)),
        max_delta_e: optF64(raw, 'max_delta_e', path),
        min_coverage: optF64(raw, 'min_coverage', path),
      };
    }
    case 'no_near_duplicate_images':
      return { type: kind, max_hamming: optU32(raw, 'max_hamming', path) };
    case 'no_placeholder_images':
      return { type: kind, element: optStr(raw, 'element', path) };
    case 'image_focal_visible':
      return {
        type: kind,
        element: str(raw, 'element', path),
        focal: naturalRegion(raw.focal, `${path}.focal`),
      };
    case 'transparent_image_legible':
      return {
        type: kind,
        element: str(raw, 'element', path),
        min_ratio: optF64(raw, 'min_ratio', path),
      };
    case 'salience_order':
      return { type: kind, cta_id: str(raw, 'cta_id', path) };
    case 'image_sharpness_at_least':
      return {
        type: kind,
        element: str(raw, 'element', path),
        min_sharpness: optF64(raw, 'min_sharpness', path),
      };
    case 'image_blockiness_within':
      return {
        type: kind,
        element: str(raw, 'element', path),
        max_blockiness: optF64(raw, 'max_blockiness', path),
      };
    case 'text_over_image_contrast':
      return {
        type: kind,
        min_ratio: optF64(raw, 'min_ratio', path),
        percentile: optF64(raw, 'percentile', path),
      };
  }
}

/**
 * Validate a `/vision/assert` body. Throws {@link VisionAssertRequestError};
 * every transport answers it with `UB-VALIDATION-ERROR`.
 */
export function parseVisionAssertRequest(request: unknown): ParsedVisionAssertRequest {
  if (!isObject(request)) {
    throw new VisionAssertRequestError(
      `${ROUTE}: the request body must be a JSON object with an \`assertions\` array`
    );
  }
  if (request.snapshot !== undefined && request.snapshot !== null) {
    throw new VisionAssertRequestError(
      `${ROUTE}: \`snapshot\` is a runner input. The in-tab evaluator measures the live page ` +
        'and reads no caller snapshot, so it would answer about a different input than the one ' +
        'sent. Omit `snapshot`, or send the request to the runner (POST /ui-bridge/vision/assert) ' +
        'or to `vision-audit assert`, which evaluate a supplied snapshot.'
    );
  }
  const raw = request.assertions;
  if (!Array.isArray(raw)) {
    throw new VisionAssertRequestError(`${ROUTE}: \`assertions\` is required and must be an array`);
  }
  if (raw.length > MAX_VISION_ASSERTIONS) {
    throw new VisionAssertRequestError(
      `${ROUTE}: ${raw.length} assertions exceed the in-tab limit of ${MAX_VISION_ASSERTIONS} ` +
        'per request; split the batch'
    );
  }
  return { assertions: raw.map((a, i) => parseVisionAssertion(a, `assertions[${i}]`)) };
}
