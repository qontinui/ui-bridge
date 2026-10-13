import { describe, it, expect } from 'vitest';
import { returnedFailureError, isReturnedFailure, thrownError } from '../src/action-outcome.js';
import { WrapperTransportError } from '../src/types.js';

/**
 * Regression guard for the CLI's return-vs-throw asymmetry.
 *
 * `ui-bridge-inject --exec` used to map only a THROWN `WrapperTransportError`
 * onto its `{action, error}` output key. The in-page dispatcher *returns* its
 * structured failures — a missing, invisible or disabled element all come back
 * as `{ success: false, error, failureDetails: { errorCode } }` — so a failed
 * action was printed under `result` and the process exited 0. Measured on
 * 0.7.1 against a real page:
 *
 *   {"action":"executeElementAction","result":{"success":false,
 *     "error":"Element no-such-element not found",
 *     "failureDetails":{"errorCode":"ELEMENT_NOT_FOUND",...}}}
 *   exit=0
 *
 * A consumer that scripts a click and then snapshots therefore got a
 * successful-looking run in which the click never happened, and reported a
 * clean verdict for a state the page was never in. (Hit for real while building
 * qontinui-claude-config/scripts/verify-page-verdict.sh, whose first cut
 * reported PASS on exactly that.)
 *
 * The unit tests here pin the classifier. The browser test, which executes the
 * BUILT bin against a real page because the defect lived in the bin's exit code
 * and stdout (neither of which any in-process test observes), is
 * `returned-failure-smoke.test.ts`: a real-Chromium test lives in a `*-smoke`
 * file, so ci.yml's browser-smokes job runs it.
 */

// ---------------------------------------------------------------------------
// Unit: the classifier itself (no browser, always runs)
// ---------------------------------------------------------------------------

describe('returnedFailureError', () => {
  const failure = {
    success: false,
    error: 'Element no-such-element not found',
    failureDetails: {
      errorCode: 'ELEMENT_NOT_FOUND',
      message: 'Element no-such-element not found',
      elementId: 'no-such-element',
      retryRecommended: false,
    },
  };

  it('lifts errorCode and message out of a createActionFailure envelope', () => {
    const e = returnedFailureError('executeElementAction', failure);
    expect(e).not.toBeNull();
    expect(e?.code).toBe('ELEMENT_NOT_FOUND');
    expect(e?.message).toBe('Element no-such-element not found');
    expect(e?.source).toBe('returned');
  });

  it('keeps failureDetails structured rather than flattening it to a string', () => {
    const e = returnedFailureError('executeElementAction', failure);
    // The whole point: a caller must still be able to branch on the code and
    // read the diagnostics, not parse a message.
    expect(e?.details).toEqual(failure.failureDetails);
    expect((e?.details as { retryRecommended: boolean }).retryRecommended).toBe(false);
  });

  it.each(['ELEMENT_NOT_FOUND', 'ELEMENT_NOT_VISIBLE', 'ELEMENT_NOT_ENABLED'])(
    'preserves %s as a machine-readable code',
    (errorCode) => {
      const e = returnedFailureError('executeElementAction', {
        success: false,
        error: 'nope',
        failureDetails: { errorCode },
      });
      expect(e?.code).toBe(errorCode);
    }
  );

  it('reads the CommandResponse shape ({success,error:{code,message}}) too', () => {
    const e = returnedFailureError('act', {
      success: false,
      error: { code: 'ACTION_TIMEOUT', message: 'timed out' },
    });
    expect(e?.code).toBe('ACTION_TIMEOUT');
    expect(e?.message).toBe('timed out');
  });

  it('falls back to ACTION_FAILED when the handler named no code', () => {
    const e = returnedFailureError('act', { success: false });
    expect(e?.code).toBe('ACTION_FAILED');
    expect(e?.message).toContain('act');
    expect(e?.details).toBeUndefined();
  });

  it('returns null for anything that is not an explicit success:false', () => {
    // Every successful action runs through this, so a false positive here
    // would fail clean runs. `success` absent is NOT a failure.
    for (const ok of [
      { success: true, durationMs: 1 },
      { elements: [], route: '/x' },
      { id: 'dom-a', visible: true },
      [],
      null,
      undefined,
      'ok',
      0,
      { success: 'false' },
      { success: undefined },
    ]) {
      expect(isReturnedFailure(ok), JSON.stringify(ok)).toBe(false);
      expect(returnedFailureError('a', ok)).toBeNull();
    }
  });
});

describe('thrownError', () => {
  it('carries a WrapperTransportError code, message and details through', () => {
    const e = thrownError(
      new WrapperTransportError('INJECTED_EXPECT_SELECTOR_UNMET', 'never appeared', {
        details: { elementCount: 0 },
      })
    );
    expect(e).toEqual({
      code: 'INJECTED_EXPECT_SELECTOR_UNMET',
      message: 'never appeared',
      source: 'thrown',
      details: { elementCount: 0 },
    });
  });

  it('maps a plain error to UNKNOWN', () => {
    expect(thrownError(new Error('boom'))).toEqual({
      code: 'UNKNOWN',
      message: 'boom',
      source: 'thrown',
    });
  });
});
