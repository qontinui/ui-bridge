/**
 * Pre-PR review remediation at the WEB action-invocation seam
 * (qontinui/ui-bridge#163).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phases 2-3.
 *
 * Three things the review found here:
 *
 *   - **#2** — four seams called a handler with ONE argument, so a handler
 *     written the way `ActionHandlerOptions` documents (`(params, { signal })`)
 *     threw `Cannot destructure property 'signal' of 'undefined'` before
 *     running a line of its own. The custom ELEMENT action seam is the one in
 *     this file.
 *   - **#9** — nothing wrapped `validateActionParams`, so a validator fault
 *     landed in the generic catch and was mislabelled `UB-ACTION-FAILED`: a
 *     validator bug reported as a handler failure.
 *   - **#10** — the catalog already carries `UB-ACTION-TIMEOUT`, and a
 *     consumer matching on it never saw a component-action timeout.
 *
 * Plus the executor half of **#1**: `timeoutMs` is now caller-controlled, so
 * it is validated and clamped before it can reach a timer.
 *
 * Every expectation is a hand-written literal — no `satisfies`, no type
 * assertion, nothing read back out of the module under test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';
import {
  setDefaultParamValidationMode,
  resetDefaultParamValidationMode,
} from '../core/param-schema';

/** A promise that never settles — the "hung handler" cancellation exists for. */
function hang(): Promise<never> {
  return new Promise<never>(() => {});
}

describe('every handler gets an options bag (review #2)', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
  });

  it('a custom ELEMENT action handler is handed a real options bag', async () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    // Three distinguishable outcomes, so a failure says WHICH one happened.
    // Note the deliberate absence of `= {}` / `options?.signal`: a default or
    // an optional chain on the BAG would paper over exactly the absence under
    // test. A real consumer writes `(params, { signal }) => …` — the shape
    // `ActionHandlerOptions` documents — and that shape throws
    // "Cannot destructure property 'signal' of 'undefined'" outright.
    let seen: unknown = 'HANDLER-NOT-CALLED';

    registry.registerElement('btn', el, {
      type: 'button',
      actions: ['click'],
      customActions: {
        summon: {
          id: 'summon',
          handler: (_params, options) => {
            seen = options === undefined ? 'NO-OPTIONS-BAG' : options.signal;
            return 'summoned';
          },
        },
      },
    });

    const res = await executor.executeAction('btn', { action: 'summon' });

    expect(res.success).toBe(true);
    expect(res.result).toBe('summoned');
    // A real signal object, not `undefined` and not a missing bag. Element
    // actions have no cancellation source, so it is `inertAbortSignal()` —
    // never aborted.
    expect(seen).toBeInstanceOf(AbortSignal);
    expect((seen as AbortSignal).aborted).toBe(false);

    el.remove();
  });

  it('a one-arity custom element handler still works unchanged', async () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    registry.registerElement('btn2', el, {
      type: 'button',
      actions: ['click'],
      customActions: {
        legacy: { id: 'legacy', handler: (params) => ({ echoed: params }) },
      },
    });

    const res = await executor.executeAction('btn2', {
      action: 'legacy',
      params: { a: 1 },
    });

    expect(res.success).toBe(true);
    expect(res.result).toEqual({ echoed: { a: 1 } });

    el.remove();
  });

  it('a COMPONENT action handler is handed a real options bag', async () => {
    let seen: unknown = 'HANDLER-NOT-CALLED';
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'go',
          handler: (_params, options) => {
            seen = options === undefined ? 'NO-OPTIONS-BAG' : options.signal;
            return 'done';
          },
        },
      ],
    });

    const res = await executor.executeComponentAction('cmp', { action: 'go' });

    expect(res.success).toBe(true);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect((seen as AbortSignal).aborted).toBe(false);
  });
});

describe('a timeout reports UB-ACTION-TIMEOUT (review #10)', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [{ id: 'hung', handler: () => hang() }],
    });
  });

  it('uses the dedicated timeout code, and still carries cancelReason', async () => {
    const res = await executor.executeComponentAction('cmp', {
      action: 'hung',
      timeoutMs: 5,
    });

    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-TIMEOUT');
    expect(res.failureDetails?.cancelReason).toBe('timeout');
    expect(res.failureDetails?.timeoutMs).toBe(5);
    expect(res.error).toBe(
      'Action "hung" on component "cmp" was abandoned after its 5ms timeout elapsed.'
    );
  });

  it('renders the timeout code’s recovery placeholders instead of leaving them raw', async () => {
    const res = await executor.executeComponentAction('cmp', {
      action: 'hung',
      timeoutMs: 7,
    });

    const suggestions = res.failureDetails?.suggestedActions ?? [];
    const rendered = suggestions.map((s) => s.suggestion);
    expect(rendered).toContain('Increase the timeout duration (the wait gave up after 7ms)');
    expect(rendered).toContain(
      'Check if the condition \'action "hung" to resolve\' can ever be met'
    );
    // No placeholder survives into agent-facing text.
    expect(rendered.some((s) => s.includes('${'))).toBe(false);
  });

  it('the SIGNAL arm keeps UB-ACTION-FAILED, discriminated by cancelReason', async () => {
    const controller = new AbortController();
    const running = executor.executeComponentAction(
      'cmp',
      { action: 'hung' },
      { signal: controller.signal }
    );
    controller.abort();
    const res = await running;

    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(res.failureDetails?.cancelReason).toBe('signal');
  });

  it('a handler that THROWS is UB-ACTION-FAILED with no cancelReason', async () => {
    registry.registerComponent('boom', {
      name: 'Boom',
      actions: [
        {
          id: 'go',
          handler: () => {
            throw new Error('kaboom');
          },
        },
      ],
    });

    const res = await executor.executeComponentAction('boom', { action: 'go' });
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(res.failureDetails?.cancelReason).toBeUndefined();
  });
});

describe('timeoutMs is validated at the executor (review #1)', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let calls: number;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    calls = 0;
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'go',
          handler: () => {
            calls += 1;
            return 'ok';
          },
        },
      ],
    });
  });

  it('refuses a negative timeout WITHOUT running the handler', async () => {
    const res = await executor.executeComponentAction('cmp', {
      action: 'go',
      timeoutMs: -1,
    });

    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-VALIDATION-ERROR');
    expect(res.error).toBe(
      'Action "go" on component "cmp" was rejected: timeoutMs must not be negative, received -1.'
    );
    expect(calls).toBe(0);
  });

  it('refuses a non-numeric timeout', async () => {
    const res = await executor.executeComponentAction('cmp', {
      action: 'go',
      timeoutMs: '5000' as unknown as number,
    });

    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-VALIDATION-ERROR');
    expect(res.error).toBe(
      'Action "go" on component "cmp" was rejected: timeoutMs must be a number of milliseconds, received "5000".'
    );
    expect(calls).toBe(0);
  });

  it('refuses NaN', async () => {
    const res = await executor.executeComponentAction('cmp', {
      action: 'go',
      timeoutMs: Number.NaN,
    });
    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-VALIDATION-ERROR');
    expect(calls).toBe(0);
  });

  it('accepts a well-formed timeout and runs the handler', async () => {
    const res = await executor.executeComponentAction('cmp', {
      action: 'go',
      timeoutMs: 5000,
    });
    expect(res.success).toBe(true);
    expect(res.result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('reports the CLAMPED value, not the caller’s, when a timeout fires', async () => {
    registry.registerComponent('hungcmp', {
      name: 'Hung',
      actions: [{ id: 'hung', handler: () => hang() }],
    });
    vi.useFakeTimers();
    try {
      const running = executor.executeComponentAction('hungcmp', {
        action: 'hung',
        // Past the 32-bit setTimeout boundary. Unclamped this fires at once.
        timeoutMs: 9_999_999_999,
      });
      await vi.advanceTimersByTimeAsync(86_400_000);
      const res = await running;

      expect(res.failureDetails?.errorCode).toBe('UB-ACTION-TIMEOUT');
      expect(res.failureDetails?.timeoutMs).toBe(86400000);
      expect(res.error).toBe(
        'Action "hung" on component "hungcmp" was abandoned after its 86400000ms timeout elapsed.'
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a validator fault is not reported as a handler failure (review #9)', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let handlerCalls: number;

  /**
   * A `paramSchema` that throws the moment the validator reads a key off it.
   * Stands in for any validator fault — the two known real routes (a
   * self-referential schema, a backtracking `pattern`) are bounded inside
   * `param-schema.ts`, so this forces the arm directly.
   */
  function explodingSchema(): Record<string, unknown> {
    return new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'type') return 'object';
          throw new Error('schema exploded');
        },
        ownKeys() {
          throw new Error('schema exploded');
        },
      }
    ) as Record<string, unknown>;
  }

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    handlerCalls = 0;
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'go',
          paramSchema: explodingSchema(),
          handler: () => {
            handlerCalls += 1;
            return 'ok';
          },
        },
      ],
    });
  });

  afterEach(() => {
    resetDefaultParamValidationMode();
    vi.restoreAllMocks();
  });

  it('in enforce mode: UB-VALIDATION-ERROR naming the SCHEMA, not UB-ACTION-FAILED', async () => {
    setDefaultParamValidationMode('enforce');

    const res = await executor.executeComponentAction('cmp', { action: 'go', params: {} });

    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-VALIDATION-ERROR');
    expect(res.error).toBe(
      'Action "go" on component "cmp": its declared paramSchema could not be evaluated (schema exploded).'
    );
    expect(handlerCalls).toBe(0);
  });

  it('in warn mode: logs and runs the handler anyway', async () => {
    setDefaultParamValidationMode('warn');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await executor.executeComponentAction('cmp', { action: 'go', params: {} });

    expect(res.success).toBe(true);
    expect(res.result).toBe('ok');
    expect(handlerCalls).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      '[ui-bridge] Action "go" on component "cmp": its declared paramSchema could not be evaluated (schema exploded).'
    );
  });
});
