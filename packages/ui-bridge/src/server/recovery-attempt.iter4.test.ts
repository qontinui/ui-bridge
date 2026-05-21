/**
 * Manual-test iter-4 remediation tests for `attemptRecovery`.
 *
 * Item A — Operator-contract codes pass through unchanged.
 *
 * Iter-3 added HTTP 400 + `WRONG_TYPE_PARAM` / `MISSING_PARAM` codes to
 * `relay-handlers.executeElementAction` so that `{action:"type",
 * params:{value:"foo"}}` (wrong param name) surfaces as a contract bug
 * instead of being relayed to the browser. But callers that pipe that
 * failure into `attemptRecovery` were getting silent "recovery" — the
 * NL-based fallback path synthesized a command that ended up typing the
 * literal string "text" into the field, masking the operator's misuse as
 * a successful action.
 *
 * The fix: short-circuit recovery for `WRONG_TYPE_PARAM` and
 * `MISSING_PARAM`. These are operator-contract errors; they need to
 * surface as failures so the call site can fix the payload.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import type { StructuredFailureInfo } from '../ai/types';

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
    createSnapshot: () =>
      reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

function makeActionExecutor() {
  // The executor should NOT be called when the failure carries an
  // operator-contract code. Tests assert that explicitly.
  return {
    executeAction: async () => {
      throw new Error(
        'executor.executeAction must not be called for operator-contract codes'
      );
    },
    executeComponentAction: async () => {
      throw new Error(
        'executor.executeComponentAction must not be called for operator-contract codes'
      );
    },
  };
}

describe('attemptRecovery · iter-4 Item A — operator-contract pass-through', () => {
  beforeEach(() => resetGlobalRegistry());
  afterEach(() => resetGlobalRegistry());

  it('short-circuits when failure.errorCode === WRONG_TYPE_PARAM', async () => {
    const handlers = createHandlers(
      makeRegistryLike(),
      makeActionExecutor() as never
    );

    const failure: StructuredFailureInfo = {
      errorCode: 'WRONG_TYPE_PARAM',
      message:
        "type action takes 'text' parameter; got 'value'. Did you mean setValue?",
      retryRecommended: false,
    };

    const res = await handlers.attemptRecovery({
      failure,
      instruction: "type 'foo' into input",
      elementId: 'input-id',
      maxRetries: 3,
    });

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data!.recovered).toBe(false);
    expect(res.data!.strategiesAttempted).toEqual([]);
    expect(res.data!.error).toContain('WRONG_TYPE_PARAM');
    expect(res.data!.error).toContain('not recoverable');
  });

  it('short-circuits when failure.errorCode === MISSING_PARAM', async () => {
    const handlers = createHandlers(
      makeRegistryLike(),
      makeActionExecutor() as never
    );

    const failure: StructuredFailureInfo = {
      errorCode: 'MISSING_PARAM',
      message: "type action requires 'text' string parameter",
      retryRecommended: false,
    };

    const res = await handlers.attemptRecovery({
      failure,
      instruction: "type into input",
      elementId: 'input-id',
      maxRetries: 3,
    });

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();
    expect(res.data!.recovered).toBe(false);
    expect(res.data!.strategiesAttempted).toEqual([]);
    expect(res.data!.error).toContain('MISSING_PARAM');
    expect(res.data!.error).toContain('not recoverable');
  });

  it('does NOT call the NL executor for WRONG_TYPE_PARAM (no literal-"text" synthesis)', async () => {
    // The makeActionExecutor() helper throws if invoked; if the
    // short-circuit logic is wrong and the recovery path reaches the
    // executor, the test fails with the throw message rather than a
    // graceful pass.
    const handlers = createHandlers(
      makeRegistryLike(),
      makeActionExecutor() as never
    );

    const failure: StructuredFailureInfo = {
      errorCode: 'WRONG_TYPE_PARAM',
      message: 'wrong param',
      // Include a suggestedActions array — without the short-circuit, the
      // recovery loop would iterate this and call nlExecutor.execute.
      suggestedActions: [
        {
          suggestion: 'Type the text into the input',
          command: 'type text into input',
          confidence: 0.9,
          retryable: true,
          priority: 1,
        },
      ],
      retryRecommended: true,
    };

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'type text',
      elementId: 'input-id',
      maxRetries: 3,
    });

    // The test passes only if the executor was NEVER called — the
    // short-circuit returned before reaching the recovery loop.
    expect(res.success).toBe(true);
    expect(res.data!.recovered).toBe(false);
    expect(res.data!.strategiesAttempted).toEqual([]);
  });

  it('still runs recovery for non-operator-contract failures (regression guard)', async () => {
    // A non-operator-contract failure (e.g. UB-ELEM-NOT-VISIBLE) must
    // still reach the recovery loop. We supply a passing executor to
    // confirm the loop body actually runs.
    const handlers = createHandlers(
      makeRegistryLike(),
      {
        executeAction: async () => ({ success: false, error: 'no element' }),
        executeComponentAction: async () => ({ success: false }),
      } as never
    );

    const failure: StructuredFailureInfo = {
      errorCode: 'UB-ELEM-NOT-VISIBLE',
      message: 'element is not visible',
      elementId: 'hidden',
      suggestedActions: [
        {
          suggestion: 'Scroll to the element',
          command: 'scroll to hidden',
          confidence: 0.9,
          retryable: true,
          priority: 1,
        },
      ],
      retryRecommended: true,
    };

    const res = await handlers.attemptRecovery({
      failure,
      instruction: 'click hidden',
      elementId: 'hidden',
      maxRetries: 1,
    });

    expect(res.success).toBe(true);
    // Non-operator-contract codes DO reach the loop, so at least one
    // strategy is attempted (and recorded) even if it fails on an empty
    // registry.
    expect(res.data!.strategiesAttempted.length).toBeGreaterThan(0);
  });
});
