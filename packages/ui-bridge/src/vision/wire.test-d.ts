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
};
void rawReq;
void badReason;
