/**
 * Type-level test for `BatchAssertionResult` (`ai/types.ts`). Typechecked by
 * `npm run typecheck` (tsconfig includes `.test-d.ts`; vitest does not run it)
 * — see `core/redaction.brand.test-d.ts` for the mechanism.
 *
 * `unmeasuredCount` is an OPTIONAL key: code that builds a
 * `BatchAssertionResult` of its own (a fixture, a proxy that re-wraps a batch)
 * keeps compiling without it. Every batch this SDK builds still sets it
 * (`ai/assertions.ts`, pinned by `ai/assertions.test.ts`). The assertion is on
 * the KEY, so declaring it required again fails it.
 */

import type { BatchAssertionResult } from './types';

/** Compiles only when `T` is exactly `true`. */
type Assert<T extends true> = T;

/** `true` when `K` is an optional key of `T`. */
type IsOptional<T, K extends keyof T> = object extends Pick<T, K> ? true : false;

type UnmeasuredCountOptional = Assert<IsOptional<BatchAssertionResult, 'unmeasuredCount'>>;
// `failedCount` stays required: an `'all'` batch's verdict is read from it.
type FailedCountRequired = Assert<
  IsOptional<BatchAssertionResult, 'failedCount'> extends false ? true : false
>;

// A result built outside the SDK, by code that never counted, compiles.
const rewrapped: BatchAssertionResult = {
  passed: false,
  results: [],
  passedCount: 0,
  failedCount: 1,
  durationMs: 0,
  timestamp: 0,
};

export type { UnmeasuredCountOptional, FailedCountRequired };
void rewrapped;
