/**
 * Pre-PR review remediation at the ui-bridge/native invocation seam
 * (qontinui/ui-bridge#163).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phases 2-3.
 *
 * `packages/ui-bridge/src/native/**` is **type-checked by nothing** — the
 * package `tsconfig.json` lists it in `exclude` and tsup builds those entries
 * with `dts: false` — so a test is the only gate this tree has. Three review
 * findings land here:
 *
 *   - **#1** — `timeoutMs` is wire data, so it is validated and clamped before
 *     it can reach a timer;
 *   - **#2** — a custom ELEMENT action handler was called with ONE argument;
 *   - **#9** — a validator fault was indistinguishable from a handler fault.
 *
 * This tree's `ComponentActionResponse` carries no `failureDetails` (and this
 * subpath ships no diagnostics module), so failures are asserted on the prose
 * `error`. Every expectation is a hand-written literal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DefaultNativeActionExecutor } from './action-executor';
import { NativeUIBridgeRegistry } from '../core/registry';
import {
  setDefaultParamValidationMode,
  resetDefaultParamValidationMode,
} from '../../core/param-schema';

function hang(): Promise<never> {
  return new Promise<never>(() => {});
}

/** Minimal ref stand-in — the native registry only stores it. */
function fakeRef() {
  return { current: null } as never;
}

describe('every native handler gets an options bag (review #2)', () => {
  it('a custom ELEMENT action handler is handed a real options bag', async () => {
    let seen: unknown = 'HANDLER-NOT-CALLED';
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('btn', fakeRef(), {
      type: 'button',
      actions: ['press'],
      customActions: {
        summon: {
          id: 'summon',
          // No `= {}` default and no optional chain on the BAG: either would
          // paper over exactly the absence under test.
          handler: (_params, options) => {
            seen = options === undefined ? 'NO-OPTIONS-BAG' : options.signal;
            return 'summoned';
          },
        },
      },
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const res = await executor.executeAction('btn', { action: 'summon' });

    expect(res.success).toBe(true);
    expect(res.result).toBe('summoned');
    expect(seen).toBeInstanceOf(AbortSignal);
    expect((seen as AbortSignal).aborted).toBe(false);
  });

  it('a one-arity custom element handler still works unchanged', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerElement('btn2', fakeRef(), {
      type: 'button',
      actions: ['press'],
      customActions: {
        legacy: { id: 'legacy', handler: (params) => ({ echoed: params }) },
      },
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const res = await executor.executeAction('btn2', {
      action: 'legacy',
      params: { a: 1 },
    });

    expect(res.success).toBe(true);
    expect(res.result).toEqual({ echoed: { a: 1 } });
  });
});

describe('native timeoutMs is validated at the executor (review #1)', () => {
  let registry: NativeUIBridgeRegistry;
  let executor: DefaultNativeActionExecutor;
  let calls: number;

  beforeEach(() => {
    registry = new NativeUIBridgeRegistry();
    executor = new DefaultNativeActionExecutor(registry);
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
    expect(res.error).toBe(
      'Action "go" on component "cmp" was rejected: timeoutMs must not be negative, received -1.'
    );
    expect(calls).toBe(0);
  });

  it('refuses a numeric STRING without running the handler', async () => {
    const res = await executor.executeComponentAction('cmp', {
      action: 'go',
      timeoutMs: '5000' as unknown as number,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      'Action "go" on component "cmp" was rejected: timeoutMs must be a number of milliseconds, received "5000".'
    );
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

  it('reports the CLAMPED value when an over-large timeout fires', async () => {
    registry.registerComponent('hungcmp', {
      name: 'Hung',
      actions: [{ id: 'hung', handler: () => hang() }],
    });
    vi.useFakeTimers();
    try {
      const running = executor.executeComponentAction('hungcmp', {
        action: 'hung',
        // Past the 32-bit setTimeout boundary — unclamped it fires at once.
        timeoutMs: 9_999_999_999,
      });
      await vi.advanceTimersByTimeAsync(86_400_000);
      const res = await running;

      expect(res.success).toBe(false);
      expect(res.error).toBe(
        'Action "hung" on component "hungcmp" was abandoned after its 86400000ms timeout elapsed.'
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a native validator fault is not reported as a handler failure (review #9)', () => {
  let registry: NativeUIBridgeRegistry;
  let executor: DefaultNativeActionExecutor;
  let handlerCalls: number;

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
    registry = new NativeUIBridgeRegistry();
    executor = new DefaultNativeActionExecutor(registry);
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

  it('in enforce mode: the failure names the SCHEMA, and the handler never runs', async () => {
    setDefaultParamValidationMode('enforce');

    const res = await executor.executeComponentAction('cmp', { action: 'go', params: {} });

    expect(res.success).toBe(false);
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
      '[ui-bridge-native] Action "go" on component "cmp": its declared paramSchema could not be evaluated (schema exploded).'
    );
  });
});
