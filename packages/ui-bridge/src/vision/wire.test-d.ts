/**
 * Type-level test for the `vision/capture` wire shape (plan
 * 2026-10-22-runner-ui-bridge-makes-an-agent-guess-its-own-vocabulary, Phase 7).
 * Typechecked by `npm run typecheck` (tsconfig includes `.test-d.ts`; vitest
 * does not run it) — see `core/redaction.brand.test-d.ts` for the mechanism.
 *
 * Each assertion is on the KEY, not on a value, so an optional re-addition
 * (`path?: string`) fails exactly like a required one.
 */

import type {
  VisionAssertion,
  VisionAssertionKind,
  VisionCaptureRequest,
  VisionCaptureResult,
  VisionRawReason,
  VisionRawRequest,
} from './wire';

/** Compiles only when `T` is exactly `true`. */
type Assert<T extends true> = T;

/** `true` when `K` is an optional key of `T`. */
type IsOptional<T, K extends keyof T> = object extends Pick<T, K> ? true : false;

// `path` was deleted: it named a file in the runner's checkout. Present in any
// form (required or optional), `'path' extends keyof …` turns `true` and the
// assertion fails.
type NoPath = Assert<'path' extends keyof VisionCaptureResult ? false : true>;

// `url` is a required key; `base64` is an optional one (present only on
// `inline: true`). Making `base64` required, or `url` optional, fails these.
type UrlRequired = Assert<IsOptional<VisionCaptureResult, 'url'> extends false ? true : false>;
type Base64Optional = Assert<IsOptional<VisionCaptureResult, 'base64'>>;

// `inline` is an optional key of both request bodies.
type CaptureInline = Assert<IsOptional<VisionCaptureRequest, 'inline'>>;
type RawInline = Assert<IsOptional<VisionRawRequest, 'inline'>>;

// `vision/raw`'s `reason` is required and limited to the runner's two values.
type RawReasonRequired = Assert<
  IsOptional<VisionRawRequest, 'reason'> extends false ? true : false
>;
type RawReasonValues = Assert<
  [VisionRawReason] extends ['vga_grounding' | 'regression_baseline']
    ? ['vga_grounding' | 'regression_baseline'] extends [VisionRawReason]
      ? true
      : false
    : false
>;

// `vision/assert` (plan 2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab):
// the union is vision-core's 23 kinds, exactly — no fewer, and no SDK-only one.
type VisionCore23 =
  | 'no_overlap'
  | 'element_above'
  | 'contains_text'
  | 'text_fits_container'
  | 'aligned_horizontally'
  | 'aligned_vertically'
  | 'color_within'
  | 'typography_consistent'
  | 'no_layout_shift_since'
  | 'no_clipping'
  | 'animation_settled'
  | 'settled_within'
  | 'state_entered_within'
  | 'contrast_meets_wcag'
  | 'image_palette_within'
  | 'no_near_duplicate_images'
  | 'no_placeholder_images'
  | 'image_focal_visible'
  | 'transparent_image_legible'
  | 'salience_order'
  | 'image_sharpness_at_least'
  | 'image_blockiness_within'
  | 'text_over_image_contrast';
type AssertionKinds = Assert<
  [VisionAssertionKind] extends [VisionCore23]
    ? [VisionCore23] extends [VisionAssertionKind]
      ? true
      : false
    : false
>;

// `settle_frames` was dropped from `animation_settled` with no alias: present
// in any form, required or optional, this assertion fails.
type AnimationSettled = Extract<VisionAssertion, { type: 'animation_settled' }>;
type NoSettleFrames = Assert<'settle_frames' extends keyof AnimationSettled ? false : true>;

const settled: VisionAssertion = { type: 'animation_settled', region: null };
// @ts-expect-error `settle_frames` is no longer a field of the assertion
const withFrames: VisionAssertion = { type: 'animation_settled', settle_frames: 3 };

const rawReq: VisionRawRequest = { inline: true, reason: 'regression_baseline' };
// @ts-expect-error an unlisted reason is rejected by the runner, so by the type too
const badReason: VisionRawRequest = { reason: 'audit' };

export type {
  NoPath,
  UrlRequired,
  Base64Optional,
  CaptureInline,
  RawInline,
  RawReasonRequired,
  RawReasonValues,
  AssertionKinds,
  NoSettleFrames,
};
void rawReq;
void badReason;
void settled;
void withFrames;
