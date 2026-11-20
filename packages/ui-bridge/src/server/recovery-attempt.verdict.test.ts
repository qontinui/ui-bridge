/**
 * `attemptRecovery` states ONE verdict field, `attemptSucceeded`, on every
 * arm, and its envelope `success` agrees with it.
 *
 * Plan 2026-11-18-the-journey-ledger-never-records-an-unknown-action-verdict-
 * as-a-success-or-a-failure, D4. The runner's SDK twin
 * (`/ui-bridge/sdk/ai/recovery/attempt`) forwards a `success: true` body
 * verbatim (it rebuilds a `success: false` body as `{success: false, error}`)
 * and records its journey edge from the top-level `success`, so the handler
 * used to record a success edge for an attempt that recovered nothing
 * (`success: true, data: {recovered: false}`). The field name and the
 * 200-on-acted / 400-on-did-not-act split mirror the runner's own
 * `/ai/recovery/attempt` (`ai_analyze.rs` `as_recovery_failure`).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import { NLActionExecutor } from '../ai/nl-action-executor';
import { parseNLInstruction } from '../ai/nl-action-parser';
import type { NLActionResponse, StructuredFailureInfo } from '../ai/types';

beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

function makeRegistryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    getComponentState: (id) => reg.getComponentState?.(id) ?? null,
    createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

const executor = {
  executeAction: async () => ({ success: false, error: 'no element' }),
  executeComponentAction: async () => ({ success: false }),
};

const failure: StructuredFailureInfo = {
  errorCode: 'UB-ELEM-NOT-VISIBLE',
  message: 'element is not visible',
  elementId: 'btn',
  suggestedActions: [
    {
      suggestion: 'Scroll to the element',
      command: 'scroll to btn',
      confidence: 0.9,
      retryable: true,
      priority: 1,
    },
  ],
  retryRecommended: true,
};

function nlResponse(success: boolean): NLActionResponse {
  return {
    success,
    executedAction: 'click',
    confidence: 0.9,
    durationMs: 1,
    timestamp: Date.now(),
    ...(success ? {} : { error: 'still hidden' }),
  } as NLActionResponse;
}

describe('attemptRecovery · one verdict field (attemptSucceeded)', () => {
  beforeEach(() => resetGlobalRegistry());
  afterEach(() => {
    vi.restoreAllMocks();
    resetGlobalRegistry();
  });

  it('a strategy that acts answers envelope success with attemptSucceeded: true', async () => {
    vi.spyOn(NLActionExecutor.prototype, 'execute').mockResolvedValue(nlResponse(true));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 2,
    });

    expect(res.success).toBe(true);
    expect(res.httpStatus).toBeUndefined();
    expect(res.data!.attemptSucceeded).toBe(true);
    expect(res.data!.strategiesAttempted).toEqual(['Scroll to the element']);
    expect(res.data!.originalActionPerformed, 'a scroll command acted, not the original').toBe(
      false
    );
    expect(res.data).not.toHaveProperty('recovered');
  });

  it('the direct-instruction fallback that acts also answers attemptSucceeded: true', async () => {
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValueOnce(nlResponse(false))
      .mockResolvedValueOnce(nlResponse(true));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    // The fallback counts against the budget: one suggestion + the fallback
    // needs maxRetries: 2.
    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 2,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.success).toBe(true);
    expect(res.data!.attemptSucceeded).toBe(true);
    expect(res.data!.strategiesAttempted).toEqual(['Scroll to the element', 'direct-instruction']);
    expect(
      res.data!.originalActionPerformed,
      'the direct-instruction fallback is the original action'
    ).toBe(true);
    expect(res.data!.originalActionAttempted).toBe(true);
  });

  it('an attempt in which no strategy reported success answers envelope success: false, 400, RECOVERY_FAILED', async () => {
    vi.spyOn(NLActionExecutor.prototype, 'execute').mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 2,
    });

    expect(res.success).toBe(false);
    expect(res.httpStatus).toBe(400);
    expect(res.code).toBe('UB-ACTION-FAILED');
    expect(res.error).toMatch(/^RECOVERY_FAILED: /);
    expect(res.data!.attemptSucceeded).toBe(false);
    expect(res.data!.originalActionPerformed).toBe(false);
    expect(res.data!.error).toBe(res.error);
    expect(res.data!.strategiesAttempted).toEqual(['Scroll to the element', 'direct-instruction']);
    expect(res.data!.originalActionAttempted, 'the fallback ran the original').toBe(true);
    expect(res.data).not.toHaveProperty('recovered');
  });

  // A throw out of execute() is pre-action: NLActionExecutor.execute catches
  // its own performAction / scrollPage and answers UB-ACTION-FAILED, so only
  // parsing, validation or search can throw (see the comment at the strategy
  // loop's catch in `attemptRecovery`, handlers.ts).
  it('strategies that throw are not-acted, not a success', async () => {
    vi.spyOn(NLActionExecutor.prototype, 'execute').mockRejectedValue(new Error('boom'));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 1,
    });

    expect(res.success).toBe(false);
    expect(res.httpStatus).toBe(400);
    expect(res.data!.attemptSucceeded).toBe(false);
    expect(res.data!.originalActionPerformed).toBe(false);
  });

  it('a server fault outside any strategy still states the verdict, on a 500', async () => {
    // A genuine server-side throw: the registry fails while the handler
    // refreshes its elements, before any strategy runs.
    const registry = {
      ...makeRegistryLike(),
      getAllElements: () => {
        throw new Error('registry unavailable');
      },
    };
    const spy = vi.spyOn(NLActionExecutor.prototype, 'execute');
    const handlers = createHandlers(registry, executor as never);

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 1,
    });

    expect(spy).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.httpStatus).toBe(500);
    expect(res.error).toBe('registry unavailable');
    expect(res.data!.attemptSucceeded).toBe(false);
    expect(res.data!.originalActionPerformed).toBe(false);
    expect(res.data!.originalActionAttempted).toBe(false);
    expect(res.data!.strategiesAttempted).toEqual([]);
  });

  it('a fault after a strategy ran reports the strategies that already ran', async () => {
    // Both strategies run and report failure. The executor's second call
    // (the direct-instruction fallback) arms a ONE-SHOT clock fault, so the
    // next Date.now() — the handler computing `durationMs` for its failure
    // answer, outside every per-strategy try — throws into the 500 arm.
    //
    // Why the clock: no other call the handler makes after a strategy is
    // outside the per-strategy try. The registry is read once, before any
    // strategy, and the executor is only called inside the try. The seam is
    // stable because every answer of attemptRecovery computes `durationMs`
    // from Date.now(), so the failure answer's first act after the last
    // strategy is that call.
    let calls = 0;
    vi.spyOn(NLActionExecutor.prototype, 'execute').mockImplementation(async () => {
      calls += 1;
      const response = nlResponse(false);
      if (calls === 2) {
        vi.spyOn(Date, 'now').mockImplementationOnce(() => {
          throw new Error('clock failed');
        });
      }
      return response;
    });
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 2,
    });

    expect(calls, 'both strategies ran before the fault').toBe(2);
    expect(res.httpStatus, 'a fault outside any strategy is the 500 arm').toBe(500);
    expect(res.success).toBe(false);
    expect(res.error).toBe('clock failed');
    expect(res.data!.attemptSucceeded).toBe(false);
    expect(res.data!.originalActionPerformed).toBe(false);
    expect(
      res.data!.strategiesAttempted,
      'the 500 lists the strategies that ran before the fault'
    ).toEqual(['Scroll to the element', 'direct-instruction']);
    expect(res.data!.originalActionAttempted, 'the fallback had run the original').toBe(true);
    expect(
      res.data!.finalResult?.success,
      'the non-acted 500 still reports the last strategy that ran'
    ).toBe(false);
  });

  it('a throw while building the success answer is a 500 that still states the success, and no further strategy runs', async () => {
    // The first strategy reports success; building its answer then throws
    // (a one-shot clock fault armed as execute returns). The success answer is
    // built OUTSIDE the per-strategy try, so the throw is not taken for a
    // pre-action strategy failure and the loop does not move on.
    const spy = vi.spyOn(NLActionExecutor.prototype, 'execute').mockImplementation(async () => {
      const response = nlResponse(true);
      vi.spyOn(Date, 'now').mockImplementationOnce(() => {
        throw new Error('clock failed');
      });
      return response;
    });
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          { suggestion: 'First', command: 'scroll a', confidence: 0.9, retryable: true },
          { suggestion: 'Second', command: 'scroll b', confidence: 0.8, retryable: true },
        ],
      },
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 5,
    });

    expect(spy, 'no strategy runs after one reported success').toHaveBeenCalledTimes(1);
    expect(res.success).toBe(false);
    expect(res.httpStatus).toBe(500);
    expect(res.error).toBe('clock failed');
    expect(res.data!.attemptSucceeded, 'the strategy DID report success').toBe(true);
    expect(res.data!.originalActionPerformed).toBe(false);
    expect(res.data!.originalActionAttempted).toBe(false);
    expect(res.data!.strategiesAttempted).toEqual(['First']);
    expect(res.data!.finalResult?.success).toBe(true);
  });

  it('two commandless suggestions run the original instruction exactly once, and no fallback', async () => {
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          { suggestion: 'Wait', confidence: 0.6, retryable: true },
          { suggestion: 'Try again', confidence: 0.5, retryable: true },
        ],
      },
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 5,
    });

    const originalRuns = spy.mock.calls.filter(([r]) => r.instruction === 'click btn').length;
    expect(originalRuns, 'the original instruction runs at most once per attempt').toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.data!.strategiesAttempted).toEqual(['Wait']);
    expect(res.data!.originalActionAttempted).toBe(true);
    expect(res.data!.originalActionPerformed).toBe(false);
  });

  it('a failed command equal to the instruction is not re-run by the fallback', async () => {
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          { suggestion: 'Same', command: 'click btn', confidence: 0.9, retryable: true },
        ],
      },
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 5,
    });

    expect(spy, 'no direct-instruction fallback after the original ran').toHaveBeenCalledTimes(1);
    expect(res.data!.strategiesAttempted).toEqual(['Same']);
    expect(res.data!.originalActionAttempted).toBe(true);
  });

  it('a whitespace variant of the instruction counts as the original', async () => {
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          { suggestion: 'Variant', command: '  click   btn ', confidence: 0.9, retryable: true },
          { suggestion: 'Plain', confidence: 0.5, retryable: true },
        ],
      },
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 5,
    });

    expect(
      spy,
      'the variant ran the original; neither the commandless suggestion nor the fallback runs it again'
    ).toHaveBeenCalledTimes(1);
    expect(res.data!.strategiesAttempted).toEqual(['Variant']);
    expect(res.data!.originalActionAttempted).toBe(true);
  });

  it('a differently worded instruction for the same action counts as the original (parsed comparison)', async () => {
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          {
            suggestion: 'Worded',
            command: 'Click the Submit button',
            confidence: 0.9,
            retryable: true,
          },
        ],
      },
      instruction: 'click Submit',
      elementId: 'btn',
      maxRetries: 5,
    });

    expect(spy, 'the original action runs once; no fallback replays it').toHaveBeenCalledTimes(1);
    expect(res.data!.strategiesAttempted).toEqual(['Worded']);
    expect(res.data!.originalActionAttempted).toBe(true);
  });

  it('an unparsed command differing only in case or spacing counts as the original', async () => {
    expect(
      parseNLInstruction('recover from error state'),
      'precondition: it does not parse'
    ).toBeNull();
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          {
            suggestion: 'Upper',
            command: '  RECOVER  from Error state ',
            confidence: 0.9,
            retryable: true,
          },
        ],
      },
      instruction: 'recover from error state',
      elementId: 'btn',
      maxRetries: 5,
    });

    expect(spy, 'the original runs once; no fallback replays it').toHaveBeenCalledTimes(1);
    expect(res.data!.originalActionAttempted).toBe(true);
  });

  it('a wait condition differing only in case is the same action', async () => {
    const a = parseNLInstruction('wait for the dialog to be Visible');
    const b = parseNLInstruction('wait for the dialog to be visible');
    expect(a?.waitCondition, 'precondition: the wait condition parses').toBeTruthy();
    expect(a?.waitCondition).not.toBe(b?.waitCondition);
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          {
            suggestion: 'Wait',
            command: 'wait for the dialog to be Visible',
            confidence: 0.9,
            retryable: true,
          },
        ],
      },
      instruction: 'wait for the dialog to be visible',
      elementId: 'btn',
      maxRetries: 5,
    });

    expect(spy, 'the original runs once; no fallback replays it').toHaveBeenCalledTimes(1);
  });

  it('a typed value differing only in case is a different action', async () => {
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          {
            suggestion: 'Upper',
            command: "type 'ABC' into name",
            confidence: 0.9,
            retryable: true,
          },
        ],
      },
      instruction: "type 'abc' into name",
      elementId: 'btn',
      maxRetries: 5,
    });

    expect(spy.mock.calls.map(([r]) => r.instruction)).toEqual([
      "type 'ABC' into name",
      "type 'abc' into name",
    ]);
    expect(res.data!.strategiesAttempted).toEqual(['Upper', 'direct-instruction']);
  });

  it('a case variant is a DIFFERENT command (typed text is case-significant)', async () => {
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          { suggestion: 'Variant', command: "type 'Hello'", confidence: 0.9, retryable: true },
        ],
      },
      instruction: "type 'hello'",
      elementId: 'btn',
      maxRetries: 5,
    });

    // The variant is not the original, so the fallback still runs the
    // original — once.
    expect(spy.mock.calls.map(([r]) => r.instruction)).toEqual(["type 'Hello'", "type 'hello'"]);
    expect(res.data!.strategiesAttempted).toEqual(['Variant', 'direct-instruction']);
  });

  it('a successful case variant of the TARGET is the original performed (targets compare case-insensitively)', async () => {
    vi.spyOn(NLActionExecutor.prototype, 'execute').mockResolvedValue(nlResponse(true));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          { suggestion: 'Variant', command: 'Click Btn', confidence: 0.9, retryable: true },
        ],
      },
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 1,
    });

    expect(res.data!.originalActionPerformed).toBe(true);
    expect(res.data!.originalActionAttempted).toBe(true);
  });

  it('commandless fails, then a non-retryable command succeeds: attempted but not performed', async () => {
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValueOnce(nlResponse(false))
      .mockResolvedValueOnce(nlResponse(true));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          // Commandless sorts first by confidence; the command is non-retryable.
          { suggestion: 'Wait', confidence: 0.9, retryable: true },
          { suggestion: 'Dismiss', command: 'click close', confidence: 0.1, retryable: false },
        ],
      },
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 5,
    });

    expect(spy.mock.calls.map(([r]) => r.instruction)).toEqual(['click btn', 'click close']);
    expect(res.success).toBe(true);
    expect(res.data!.attemptSucceeded).toBe(true);
    expect(res.data!.originalActionPerformed).toBe(false);
    expect(
      res.data!.originalActionAttempted,
      'the caller must learn the original already ran, so it does not re-run it'
    ).toBe(true);
  });

  it.each([1, 2, 3])('maxRetries: %i performs at most that many executions', async (n) => {
    const spy = vi
      .spyOn(NLActionExecutor.prototype, 'execute')
      .mockResolvedValue(nlResponse(false));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    await handlers.attemptRecovery({
      failure: {
        ...failure,
        suggestedActions: [
          { suggestion: 'a', command: 'scroll a', confidence: 0.9, retryable: true },
          { suggestion: 'b', command: 'scroll b', confidence: 0.8, retryable: true },
          { suggestion: 'c', command: 'scroll c', confidence: 0.7, retryable: true },
        ],
      },
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: n,
    });

    expect(spy.mock.calls.length, 'total executions, the fallback included').toBeLessThanOrEqual(n);
    expect(spy).toHaveBeenCalledTimes(n);
  });

  it.each<[string, string | undefined, string, boolean]>([
    ['a commandless suggestion', undefined, 'click btn', true],
    ['a suggestion whose command IS the original instruction', 'click btn', 'click btn', true],
    ['a command-bearing suggestion', 'scroll to btn', 'scroll to btn', false],
  ])(
    '%s that acts states originalActionPerformed accordingly',
    async (_label, command, executed, performed) => {
      const spy = vi
        .spyOn(NLActionExecutor.prototype, 'execute')
        .mockResolvedValue(nlResponse(true));
      const handlers = createHandlers(makeRegistryLike(), executor as never);

      const res = await handlers.attemptRecovery({
        failure: {
          ...failure,
          suggestedActions: [
            {
              suggestion: 'only',
              confidence: 0.5,
              retryable: true,
              ...(command ? { command } : {}),
            },
          ],
        },
        instruction: 'click btn',
        elementId: 'btn',
        maxRetries: 1,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].instruction).toBe(executed);
      expect(res.success).toBe(true);
      expect(res.data!.attemptSucceeded).toBe(true);
      expect(res.data!.originalActionPerformed).toBe(performed);
      expect(res.data!.finalResult?.success).toBe(true);
    }
  );

  it.each<[string, unknown]>([
    ['an absent failure', { instruction: 'click btn', maxRetries: 1 }],
    ['a null failure', { failure: null, instruction: 'click btn', maxRetries: 1 }],
    ['an array failure', { failure: [], instruction: 'click btn', maxRetries: 1 }],
    [
      'a non-iterable suggestedActions',
      { failure: { ...failure, suggestedActions: 7 }, instruction: 'click btn', maxRetries: 1 },
    ],
    [
      'a string suggestedActions',
      {
        failure: { ...failure, suggestedActions: 'scroll' },
        instruction: 'click btn',
        maxRetries: 1,
      },
    ],
    [
      'a null suggestion',
      {
        failure: { ...failure, suggestedActions: [null] },
        instruction: 'click btn',
        maxRetries: 1,
      },
    ],
    [
      'a non-object suggestion',
      {
        failure: { ...failure, suggestedActions: [failure.suggestedActions![0], 'x'] },
        instruction: 'click btn',
        maxRetries: 1,
      },
    ],
    ['an absent instruction', { failure, maxRetries: 1 }],
    ['a non-string instruction', { failure, instruction: 42, maxRetries: 1 }],
    ['an empty instruction', { failure, instruction: '   ', maxRetries: 1 }],
    ['an absent maxRetries', { failure, instruction: 'click btn' }],
    ['a string maxRetries', { failure, instruction: 'click btn', maxRetries: '3' }],
    ['a NaN maxRetries', { failure, instruction: 'click btn', maxRetries: Number.NaN }],
    [
      'an infinite maxRetries',
      { failure, instruction: 'click btn', maxRetries: Number.POSITIVE_INFINITY },
    ],
    [
      'a non-string command',
      {
        failure: { ...failure, suggestedActions: [{ suggestion: 's', command: 7 }] },
        instruction: 'click btn',
        maxRetries: 1,
      },
    ],
    ['a negative maxRetries', { failure, instruction: 'click btn', maxRetries: -1 }],
    ['a zero maxRetries (no budget)', { failure, instruction: 'click btn', maxRetries: 0 }],
    ['a fractional maxRetries', { failure, instruction: 'click btn', maxRetries: 1.5 }],
    [
      'a non-string failure.errorCode',
      { failure: { ...failure, errorCode: 7 }, instruction: 'click btn', maxRetries: 1 },
    ],
    [
      'a non-string failure.message',
      { failure: { ...failure, message: {} }, instruction: 'click btn', maxRetries: 1 },
    ],
    [
      'a non-string suggestion',
      {
        failure: { ...failure, suggestedActions: [{ suggestion: 3 }] },
        instruction: 'click btn',
        maxRetries: 1,
      },
    ],
    [
      'a string confidence',
      {
        failure: { ...failure, suggestedActions: [{ suggestion: 's', confidence: '0.9' }] },
        instruction: 'click btn',
        maxRetries: 1,
      },
    ],
    [
      'a NaN priority',
      {
        failure: { ...failure, suggestedActions: [{ suggestion: 's', priority: Number.NaN }] },
        instruction: 'click btn',
        maxRetries: 1,
      },
    ],
    [
      'a string retryable',
      {
        failure: { ...failure, suggestedActions: [{ suggestion: 's', retryable: 'yes' }] },
        instruction: 'click btn',
        maxRetries: 1,
      },
    ],
  ])('%s is a 400 validation refusal that did not act', async (_label, payload) => {
    const spy = vi.spyOn(NLActionExecutor.prototype, 'execute');
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery(payload as never);

    expect(spy).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.httpStatus).toBe(400);
    expect(res.code).toBe('UB-VALIDATION-ERROR');
    expect(res.error).toMatch(/^Invalid recovery request: /);
    expect(res.data!.attemptSucceeded).toBe(false);
    expect(res.data!.originalActionPerformed).toBe(false);
    expect(res.data!.originalActionAttempted).toBe(false);
    expect(res.data!.strategiesAttempted).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['a null command', [{ suggestion: 's', command: null }]],
    ['a null confidence and priority', [{ suggestion: 's', confidence: null, priority: null }]],
    ['a null retryable and suggestion', [{ suggestion: null, retryable: null }]],
  ])('%s is valid (null is absent)', async (_label, suggestedActions) => {
    vi.spyOn(NLActionExecutor.prototype, 'execute').mockResolvedValue(nlResponse(true));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: { ...failure, suggestedActions },
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 1,
    } as never);

    expect(res.success).toBe(true);
    expect(res.data!.attemptSucceeded).toBe(true);
    expect(res.data!.originalActionPerformed, 'every suggestion here is commandless').toBe(true);
  });

  it('accepts the exact payload the Python clients send (every unset optional is null)', async () => {
    // `StructuredFailureInfo.model_dump(by_alias=True)` of a failure with one
    // commandless suggestion, from ui-bridge-python (the same fixture as
    // `PYTHON_FAILURE_DUMP` in tests/test_recovery_verdict.py), wrapped the
    // way `execute_with_recovery` posts it.
    const pythonPayload = {
      failure: {
        errorCode: 'ELEMENT_NOT_VISIBLE',
        message: 'Not visible',
        elementId: null,
        selectorsTried: null,
        partialMatches: null,
        elementState: null,
        screenshotContext: null,
        suggestedActions: [
          { suggestion: 'Wait for the element', command: null, confidence: 0.6, retryable: true },
          {
            suggestion: 'Scroll to the element',
            command: 'scroll to btn-1',
            confidence: 0.9,
            retryable: true,
          },
        ],
        retryRecommended: true,
        context: null,
        durationMs: null,
        timeoutMs: null,
      },
      instruction: 'click Submit',
      elementId: 'btn-1',
      maxRetries: 2,
    };
    const spy = vi.spyOn(NLActionExecutor.prototype, 'execute').mockResolvedValue(nlResponse(true));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery(pythonPayload as never);

    expect(res.success).toBe(true);
    expect(res.data!.attemptSucceeded).toBe(true);
    // The command-bearing suggestion is tried first; it acted.
    expect(res.data!.strategiesAttempted).toEqual(['Scroll to the element']);
    expect(res.data!.originalActionPerformed).toBe(false);
    expect(spy.mock.calls[0][0].instruction).toBe('scroll to btn-1');
  });

  it('a maxRetries of 1 runs (the smallest budget)', async () => {
    const spy = vi.spyOn(NLActionExecutor.prototype, 'execute').mockResolvedValue(nlResponse(true));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 1,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    expect(res.data!.attemptSucceeded).toBe(true);
  });

  it.each<[string, Partial<StructuredFailureInfo>]>([
    ['absent', {}],
    ['null', { suggestedActions: null as unknown as StructuredFailureInfo['suggestedActions'] }],
  ])('a %s suggestedActions is valid (nothing to sort)', async (_label, extra) => {
    vi.spyOn(NLActionExecutor.prototype, 'execute').mockResolvedValue(nlResponse(true));
    const handlers = createHandlers(makeRegistryLike(), executor as never);

    const res = await handlers.attemptRecovery({
      failure: { errorCode: 'UB-ELEM-NOT-VISIBLE', message: 'm', retryRecommended: true, ...extra },
      instruction: 'click btn',
      elementId: 'btn',
      maxRetries: 1,
    });

    expect(res.success).toBe(true);
    expect(res.data!.attemptSucceeded).toBe(true);
    expect(res.data!.strategiesAttempted).toEqual(['direct-instruction']);
    expect(res.data!.originalActionPerformed).toBe(true);
  });
});
