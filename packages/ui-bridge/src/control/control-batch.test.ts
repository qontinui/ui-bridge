/**
 * `controlBatch` — the pure grammar and runner (`./control-batch.ts`).
 *
 * Every request spelling, every step spelling and every error arm, with
 * literal expectations. The deps are fakes: `runAction` answers from a table,
 * `snapshot` returns a fixed object and `now` is a counter, so each
 * `durationMs` is a known literal.
 *
 * Plan: 2026-11-08-relayed-ui-bridge-actions-have-no-browser-case (Phase 1, D2).
 */

import { describe, expect, it } from 'vitest';
import {
  CONTROL_BATCH_REQUEST_SHAPE,
  CONTROL_BATCH_STEP_SHAPE,
  MAX_BATCH_TOTAL_WAIT_MS,
  MAX_BATCH_WAIT_MS,
  readControlBatchRequest,
  runControlBatch,
  type ControlBatchDeps,
} from './control-batch';
import type { ElementActionCommandPayload } from '../react/element-command-payload';

const SNAPSHOT = { elements: [{ id: 'dom-go' }], timestamp: 1 };

/** A failed action answer, as the dispatcher's `createActionFailure` shapes it. */
function notFound(id: string) {
  return {
    success: false,
    error: `Element ${id} not found`,
    failureDetails: { errorCode: 'ELEMENT_NOT_FOUND', elementId: id },
  };
}

/** Deps whose clock advances by 1 per read; `runAction` records what it ran. */
function fakeDeps(answer: (p: ElementActionCommandPayload) => unknown = () => ({ success: true })) {
  const ran: ElementActionCommandPayload[] = [];
  let t = 0;
  const deps: ControlBatchDeps = {
    runAction: async (p) => {
      ran.push(p);
      return answer(p);
    },
    snapshot: () => SNAPSHOT,
    now: () => t++,
  };
  return { deps, ran };
}

async function run(payload: unknown, answer?: (p: ElementActionCommandPayload) => unknown) {
  const { deps, ran } = fakeDeps(answer);
  const response = await runControlBatch(readControlBatchRequest(payload), deps);
  return { response, ran };
}

const CLICK = { type: 'action', id: 'dom-go', request: { action: 'click' } };

describe('controlBatch request grammar', () => {
  it('"actions" carries the steps', async () => {
    const { response, ran } = await run({ actions: [CLICK] });
    expect(response.success).toBe(true);
    expect(response.total).toBe(1);
    expect(ran).toEqual([{ id: 'dom-go', request: { action: 'click' } }]);
  });

  it('"steps" is an alias of "actions"', async () => {
    const { response, ran } = await run({ steps: [CLICK] });
    expect(response.success).toBe(true);
    expect(response.total).toBe(1);
    expect(response.completed).toBe(1);
    expect(ran).toEqual([{ id: 'dom-go', request: { action: 'click' } }]);
  });

  it('"actions" wins when both are present', async () => {
    const { response } = await run({ actions: [], steps: [CLICK] });
    expect(response.total).toBe(0);
  });

  it.each([
    [{}, 'carries no "actions" array (alias "steps")'],
    [{ stop_on_error: true }, 'carries no "actions" array (alias "steps")'],
    [{ actions: 'click' }, '"actions" must be an array of steps, got a string'],
    [{ steps: { type: 'wait' } }, '"steps" must be an array of steps, got an object'],
    [[CLICK], 'must be a JSON object, got an array'],
    [null, 'must be a JSON object, got null'],
    [undefined, 'must be a JSON object, got nothing'],
  ])('%j is refused with INVALID_REQUEST (UB-VALIDATION-ERROR)', async (payload, problem) => {
    const reading = readControlBatchRequest(payload);
    expect(reading.ok).toBe(false);
    const { response, ran } = await run(payload);
    expect(response).toEqual({
      success: false,
      results: [],
      completed: 0,
      total: 0,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 1,
      error: expect.stringContaining(problem),
      code: 'UB-VALIDATION-ERROR',
    });
    expect(response.error).toContain('controlBatch request refused');
    expect(response.error).toContain('{"actions":[<step>, …]} (alias "steps")');
    expect(ran).toEqual([]);
  });

  it('"actions": [] is a requested empty batch: success, total 0', async () => {
    const { response } = await run({ actions: [] });
    expect(response).toEqual({
      success: true,
      results: [],
      completed: 0,
      total: 0,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 1,
    });
  });

  const FAIL_THEN_CLICK = [{ type: 'action', id: 'missing', request: { action: 'click' } }, CLICK];
  const answerMissing = (p: ElementActionCommandPayload) =>
    p.id === 'missing' ? notFound('missing') : { success: true };

  it.each([['stop_on_error'], ['stopOnError'], ['stopOnFailure']])(
    '"%s": false runs every step',
    async (key) => {
      const { response, ran } = await run(
        { actions: FAIL_THEN_CLICK, [key]: false },
        answerMissing
      );
      expect(ran.map((p) => p.id)).toEqual(['missing', 'dom-go']);
      expect(response.completed).toBe(2);
      expect(response.skippedCount).toBe(0);
    }
  );

  it.each([['stop_on_error'], ['stopOnError'], ['stopOnFailure']])(
    '"%s": true stops at the failure',
    async (key) => {
      const { response, ran } = await run({ actions: FAIL_THEN_CLICK, [key]: true }, answerMissing);
      expect(ran.map((p) => p.id)).toEqual(['missing']);
      expect(response.skippedCount).toBe(1);
    }
  );

  it('the default is stop-on-error', async () => {
    const { response, ran } = await run({ actions: FAIL_THEN_CLICK }, answerMissing);
    expect(ran.map((p) => p.id)).toEqual(['missing']);
    expect(response.completed).toBe(1);
    expect(response.skippedCount).toBe(1);
  });

  it('a non-boolean stop flag is ignored, as the runner ignores it', async () => {
    const { ran } = await run({ actions: FAIL_THEN_CLICK, stop_on_error: 'no' }, answerMissing);
    expect(ran.map((p) => p.id)).toEqual(['missing']);
  });

  it('the first boolean spelling wins', async () => {
    const { ran } = await run(
      { actions: FAIL_THEN_CLICK, stop_on_error: false, stopOnError: true },
      answerMissing
    );
    expect(ran.map((p) => p.id)).toEqual(['missing', 'dom-go']);
  });
});

describe('controlBatch step grammar', () => {
  it('a wait step sleeps and answers {waited_ms}', async () => {
    const { response } = await run({ actions: [{ type: 'wait', ms: 5 }] });
    expect(response.results).toEqual([
      { index: 0, type: 'wait', success: true, durationMs: 1, data: { waited_ms: 5 } },
    ]);
  });

  it('a snapshot step answers the snapshot', async () => {
    const { response } = await run({ actions: [{ type: 'snapshot' }] });
    expect(response.results).toEqual([
      { index: 0, type: 'snapshot', success: true, durationMs: 1, data: SNAPSHOT },
    ]);
  });

  it.each([
    ['{id, request}', { type: 'action', id: 'dom-go', request: { action: 'type', text: 'hi' } }],
    [
      '{elementId, request}',
      { type: 'action', elementId: 'dom-go', request: { action: 'type', text: 'hi' } },
    ],
    ['flat', { type: 'action', id: 'dom-go', action: 'type', text: 'hi' }],
    ['element_id (flat)', { type: 'action', element_id: 'dom-go', action: 'type', text: 'hi' }],
    [
      'element_id with request',
      { type: 'action', element_id: 'dom-go', request: { action: 'type', text: 'hi' } },
    ],
  ])('an action step in the %s spelling runs {id, request}', async (_name, step) => {
    const { response, ran } = await run({ actions: [{ ...step, label: 'typed' }] });
    expect(ran).toEqual([{ id: 'dom-go', request: { action: 'type', text: 'hi' } }]);
    expect(response.results).toEqual([
      {
        index: 0,
        type: 'action',
        label: 'typed',
        success: true,
        durationMs: 1,
        data: { success: true },
      },
    ]);
  });

  it("the SDK's historical {element_id, action, params} step keeps its params", async () => {
    const { ran } = await run({
      actions: [{ type: 'action', element_id: 'dom-go', action: 'scroll', params: { y: 10 } }],
    });
    expect(ran).toEqual([{ id: 'dom-go', request: { action: 'scroll', params: { y: 10 } } }]);
  });

  /** Run one malformed step beside a valid one; assert it failed as itself. */
  async function refusedStep(step: unknown, problem: string, type: string) {
    const { response, ran } = await run({
      actions: [step, { type: 'snapshot' }],
      stop_on_error: false,
    });
    const [bad, good] = response.results;
    expect(bad).toEqual({
      index: 0,
      type,
      success: false,
      durationMs: 1,
      error: expect.stringContaining(problem),
      code: 'UB-VALIDATION-ERROR',
      data: {
        success: false,
        error: bad.error,
        failureDetails: {
          errorCode: 'INVALID_REQUEST',
          message: bad.error,
          elementId: expect.any(String),
          expectedPayload: CONTROL_BATCH_STEP_SHAPE,
        },
      },
    });
    expect(bad.error).toContain('controlBatch step 0 refused');
    expect(bad.error).toContain(CONTROL_BATCH_STEP_SHAPE);
    // The batch ran on: a malformed step is a failed step, never a thrown batch.
    expect(good).toMatchObject({ index: 1, type: 'snapshot', success: true });
    expect(ran).toEqual([]);
    expect(response.success).toBe(false);
    expect(response.failedCount).toBe(1);
  }

  it('an unknown type fails as that step', () =>
    refusedStep({ type: 'teleport' }, 'unknown step type "teleport"', 'teleport'));

  it('a step with no type fails as that step', () =>
    refusedStep({ ms: 5 }, 'names no "type"', 'invalid'));

  it('a non-string type fails as that step', () =>
    refusedStep({ type: 7 }, '"type" must be a string, got a number', 'invalid'));

  it('a non-object step fails as that step', () =>
    refusedStep('click', 'must be a JSON object, got a string', 'invalid'));

  it('an action step with no action fails as that step (the dispatcher grammar names it)', () =>
    refusedStep(
      { type: 'action', id: 'dom-go' },
      'names no action: "request.action" (or a flat top-level "action") is missing',
      'action'
    ));

  it('an action step with no element fails as that step', () =>
    refusedStep(
      { type: 'action', request: { action: 'click' } },
      'names no element: "id" (or "elementId") is missing',
      'action'
    ));

  it('an action step naming its element twice fails as that step', () =>
    refusedStep(
      { type: 'action', id: 'a', element_id: 'a', action: 'click' },
      'names its element twice',
      'action'
    ));

  it('a key beside "request" that nothing reads fails as that step', () =>
    refusedStep(
      { type: 'action', id: 'dom-go', request: { action: 'type' }, text: 'x' },
      '"text" is at the top level beside "request"',
      'action'
    ));

  it.each([[-1], [Number.NaN], ['5'], [undefined]])('a wait with ms %j fails as that step', (ms) =>
    refusedStep({ type: 'wait', ms }, '"ms" must be a finite, non-negative number', 'wait')
  );

  it.each([[MAX_BATCH_WAIT_MS + 1], [2 ** 31], [Number.MAX_SAFE_INTEGER]])(
    'a wait with ms %j, above the cap, fails as that step',
    (ms) =>
      refusedStep(
        { type: 'wait', ms },
        `"ms" must be at most 60000 (the longest one wait step may wait), got ${ms}`,
        'wait'
      )
  );

  it.each([[Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY], [-0.5]])(
    'a wait with ms %j fails as that step',
    (ms) => refusedStep({ type: 'wait', ms }, '"ms" must be a finite, non-negative number', 'wait')
  );

  it('a batch whose waits total more than the batch-wide cap is refused before any step runs', async () => {
    const { response, ran } = await run({
      actions: [
        CLICK,
        { type: 'wait', ms: 30_000 },
        { type: 'wait', ms: 30_000 },
        { type: 'wait', ms: 1 },
      ],
    });
    expect(ran).toEqual([]);
    expect(response).toMatchObject({
      success: false,
      results: [],
      total: 0,
      code: 'UB-VALIDATION-ERROR',
      error:
        `controlBatch request refused: its wait steps total 60001 ms, more than the 60000 ms one ` +
        `batch may wait. Expected ${CONTROL_BATCH_REQUEST_SHAPE}.`,
    });
  });

  it('waits totalling exactly the batch-wide cap are accepted', () => {
    const reading = readControlBatchRequest({
      actions: [
        { type: 'wait', ms: 30_000 },
        { type: 'wait', ms: MAX_BATCH_TOTAL_WAIT_MS - 30_000 },
      ],
    });
    expect(reading.ok).toBe(true);
  });

  it('a wait step refused on its own does not count toward the batch-wide total', () => {
    const reading = readControlBatchRequest({
      actions: [
        { type: 'wait', ms: MAX_BATCH_WAIT_MS },
        { type: 'wait', ms: MAX_BATCH_WAIT_MS + 1 },
      ],
    });
    expect(reading.ok).toBe(true);
  });

  it('a wait of exactly the cap is a wait step', () => {
    expect(readControlBatchRequest({ actions: [{ type: 'wait', ms: MAX_BATCH_WAIT_MS }] })).toEqual(
      {
        ok: true,
        steps: [{ kind: 'wait', type: 'wait', ms: MAX_BATCH_WAIT_MS }],
        stopOnError: true,
      }
    );
  });

  it('a wait with a key it does not read fails as that step', () =>
    refusedStep({ type: 'wait', ms: 1, seconds: 2 }, '"seconds" not read by a wait step', 'wait'));

  it('a snapshot with a key it does not read fails as that step', () =>
    refusedStep(
      { type: 'snapshot', scope: 'x' },
      '"scope" not read by a snapshot step',
      'snapshot'
    ));

  it('a non-string label fails as that step', () =>
    refusedStep(
      { type: 'snapshot', label: 3 },
      '"label" must be a string, got a number',
      'snapshot'
    ));
});

describe('controlBatch outcomes', () => {
  const STEPS = [
    { type: 'action', id: 'dom-go', request: { action: 'click' }, label: 'go' },
    { type: 'action', id: 'missing', request: { action: 'click' }, label: 'gone' },
    { type: 'wait', ms: 0, label: 'pause' },
    { type: 'snapshot', label: 'after' },
  ];
  const answer = (p: ElementActionCommandPayload) =>
    p.id === 'missing' ? notFound('missing') : { success: true, elementId: p.id };

  it('stop-on-error true: the steps after a failure are skipped, with literal counts', async () => {
    const { response } = await run({ actions: STEPS }, answer);
    expect(response).toEqual({
      success: false,
      results: [
        {
          index: 0,
          type: 'action',
          label: 'go',
          success: true,
          durationMs: 1,
          data: { success: true, elementId: 'dom-go' },
        },
        {
          index: 1,
          type: 'action',
          label: 'gone',
          success: false,
          durationMs: 1,
          data: notFound('missing'),
          error: 'Element missing not found',
          code: 'UB-ELEM-NOT-FOUND',
        },
      ],
      completed: 2,
      total: 4,
      succeededCount: 1,
      failedCount: 1,
      skippedCount: 2,
      durationMs: 5,
      error:
        'controlBatch: 1 of 4 steps failed (first: step 1 (action): Element missing not found); 2 skipped after it (stop_on_error)',
      code: 'UB-ELEM-NOT-FOUND',
    });
  });

  it('stop-on-error false: every step runs, and the batch still fails', async () => {
    const { response } = await run({ actions: STEPS, stop_on_error: false }, answer);
    expect(response.results.map((r) => [r.index, r.type, r.label, r.success])).toEqual([
      [0, 'action', 'go', true],
      [1, 'action', 'gone', false],
      [2, 'wait', 'pause', true],
      [3, 'snapshot', 'after', true],
    ]);
    expect(response.completed).toBe(4);
    expect(response.succeededCount).toBe(3);
    expect(response.failedCount).toBe(1);
    expect(response.skippedCount).toBe(0);
    expect(response.success).toBe(false);
    expect(response.error).toBe(
      'controlBatch: 1 of 4 steps failed (first: step 1 (action): Element missing not found)'
    );
  });

  it('every step succeeding is the only success', async () => {
    const { response } = await run({ actions: [STEPS[0], STEPS[2], STEPS[3]] }, answer);
    expect(response.success).toBe(true);
    expect(response.succeededCount).toBe(3);
    expect(response.error).toBeUndefined();
    expect(response.code).toBeUndefined();
    expect(response.results.map((r) => r.label)).toEqual(['go', 'pause', 'after']);
  });

  it("a failing step's hoisted code is kept verbatim; its full answer is in data", async () => {
    const custom = {
      success: false,
      error: 'terminal has exited',
      code: 'TERMINAL_EXITED',
      exitCode: 1,
    };
    const { response } = await run({ actions: [CLICK] }, () => custom);
    expect(response.results[0]).toEqual({
      index: 0,
      type: 'action',
      success: false,
      durationMs: 1,
      data: custom,
      error: 'terminal has exited',
      code: 'TERMINAL_EXITED',
    });
    expect(response.code).toBe('TERMINAL_EXITED');
  });

  it('a throwing action fails as that step, keeping a typed code', async () => {
    const { response } = await run({ actions: [CLICK] }, () => {
      throw Object.assign(new Error('boom'), { code: 'KABOOM' });
    });
    expect(response.results[0]).toEqual({
      index: 0,
      type: 'action',
      success: false,
      durationMs: 1,
      data: { success: false, error: 'boom', code: 'KABOOM' },
      error: 'boom',
      code: 'KABOOM',
    });
  });

  it('a throwing snapshot fails as that step', async () => {
    const { deps } = fakeDeps();
    deps.snapshot = () => {
      throw new Error('registry gone');
    };
    const response = await runControlBatch(
      readControlBatchRequest({ actions: [{ type: 'snapshot' }] }),
      deps
    );
    expect(response.results[0]).toMatchObject({
      success: false,
      error: 'registry gone',
      code: 'UB-UNKNOWN-ERROR',
      data: { success: false, error: 'registry gone' },
    });
    expect(response.success).toBe(false);
  });

  it('a failing answer with no message gets one naming the step', async () => {
    const { response } = await run({ actions: [CLICK] }, () => ({ success: false }));
    expect(response.results[0].error).toBe(
      'controlBatch step 0 (action) failed but supplied no error message.'
    );
  });
});
