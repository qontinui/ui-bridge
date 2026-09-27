/**
 * `describeInnerFailure` — the one derivation of an envelope's `error` / `code`
 * from an inner result, shared by the relay lift and the direct transport.
 *
 * Code precedence: a hoisted `code` (a handler's own vocabulary, kept
 * verbatim) → hoisted `errorCode` → `failureDetails.errorCode` →
 * `failureInfo.errorCode`; the last three map onto the canonical `UB-*` family.
 */

import { describe, it, expect } from 'vitest';
import { describeInnerFailure } from './inner-failure';

// A message with none of `mapInternalErrorCode`'s heuristic keywords, so any
// code below comes from a carrier and never from the prose.
const MSG = 'boom';
const FALLBACK = 'fallback message';

const all = {
  error: MSG,
  code: 'TERMINAL_EXITED',
  errorCode: 'VALIDATION_ERROR',
  failureDetails: { errorCode: 'UB-ACTION-TIMEOUT' },
  failureInfo: { errorCode: 'ELEMENT_NOT_FOUND' },
};

describe('describeInnerFailure · code precedence', () => {
  it('a hoisted `code` wins and is kept verbatim (not mapped)', () => {
    expect(describeInnerFailure(all, FALLBACK)).toEqual({ message: MSG, code: 'TERMINAL_EXITED' });
  });

  it('without `code`, a hoisted `errorCode` wins and is mapped', () => {
    const { code: _c, ...rest } = all;
    expect(describeInnerFailure(rest, FALLBACK).code).toBe('UB-VALIDATION-ERROR');
  });

  it('then `failureDetails.errorCode`', () => {
    const { code: _c, errorCode: _e, ...rest } = all;
    expect(describeInnerFailure(rest, FALLBACK).code).toBe('UB-ACTION-TIMEOUT');
  });

  it('then `failureInfo.errorCode`', () => {
    const { code: _c, errorCode: _e, failureDetails: _d, ...rest } = all;
    expect(describeInnerFailure(rest, FALLBACK).code).toBe('UB-ELEM-NOT-FOUND');
  });

  it('with no carrier at all, the code is UB-UNKNOWN-ERROR', () => {
    expect(describeInnerFailure({ error: MSG }, FALLBACK).code).toBe('UB-UNKNOWN-ERROR');
  });

  it('empty-string carriers are skipped, not taken', () => {
    const r = {
      error: MSG,
      code: '',
      errorCode: '',
      failureInfo: { errorCode: 'ELEMENT_NOT_FOUND' },
    };
    expect(describeInnerFailure(r, FALLBACK).code).toBe('UB-ELEM-NOT-FOUND');
  });
});

describe('describeInnerFailure · message', () => {
  it('uses the inner `error` when present', () => {
    expect(describeInnerFailure({ error: MSG }, FALLBACK).message).toBe(MSG);
  });

  it('falls back when `error` is absent or empty, and for a non-object result', () => {
    expect(describeInnerFailure({ error: '' }, FALLBACK).message).toBe(FALLBACK);
    expect(describeInnerFailure(undefined, FALLBACK)).toEqual({
      message: FALLBACK,
      code: 'UB-UNKNOWN-ERROR',
    });
    expect(describeInnerFailure([1, 2], FALLBACK).message).toBe(FALLBACK);
  });
});
