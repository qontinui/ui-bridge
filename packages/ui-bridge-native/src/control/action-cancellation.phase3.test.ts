/**
 * Phase 3 — cancellation threaded through the ui-bridge-native
 * action-invocation seam.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 3.
 *
 * Covers the phase's three required arms:
 *   (a) a handler that OBSERVES its signal aborts promptly;
 *   (b) a handler that IGNORES its signal is still abandoned by the executor;
 *   (c) the normal, non-aborted path is unchanged.
 *
 * This tree's `ComponentActionResponse` has no `failureDetails` field and this
 * tree ships no diagnostics module, so the cancellation is asserted on the
 * prose `error` — deliberately, not by omission. Giving the native channel
 * structured failure details is a separate change.
 *
 * Every expectation below is a hand-written literal; nothing is asserted via
 * `satisfies`, a type assertion, or a constant from the code under test.
 */

import { describe, it, expect } from 'vitest';
import { DefaultNativeActionExecutor } from './action-executor';
import { NativeUIBridgeRegistry } from '../core/registry';

/** A promise that never settles — the "hung handler" the feature exists for. */
function hang(): Promise<never> {
  return new Promise<never>(() => {});
}

describe('Phase 3 — ui-bridge-native executor: caller-supplied AbortSignal', () => {
  it('(c) normal path is unchanged: no signal, no timeout, handler result returned', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [{ id: 'go', handler: (params) => ({ echoed: params }) }],
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const res = await executor.executeComponentAction('cmp', {
      action: 'go',
      params: { a: 1 },
      requestId: 'req-normal',
    });

    expect(res.success).toBe(true);
    expect(res.result).toEqual({ echoed: { a: 1 } });
    expect(res.error).toBeUndefined();
    expect(res.requestId).toBe('req-normal');
  });

  it('the executor hands the handler a live AbortSignal as its second argument', async () => {
    const seen: { signalKind: string; aborted: boolean | null } = {
      signalKind: 'MISSING',
      aborted: null,
    };
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'go',
          handler: (_params, options) => {
            const signal = options?.signal;
            seen.signalKind = signal instanceof AbortSignal ? 'AbortSignal' : typeof signal;
            seen.aborted = signal ? signal.aborted : null;
            return 'ok';
          },
        },
      ],
    });
    const executor = new DefaultNativeActionExecutor(registry);

    await executor.executeComponentAction('cmp', { action: 'go' });

    expect(seen.signalKind).toBe('AbortSignal');
    expect(seen.aborted).toBe(false);
  });

  it('(a) a handler that OBSERVES the signal aborts promptly', async () => {
    const controller = new AbortController();
    let observed = false;
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'slow',
          handler: (_params, options) =>
            new Promise<string>((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () => {
                observed = true;
                reject(new Error('handler observed abort'));
              });
            }),
        },
      ],
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const pending = executor.executeComponentAction(
      'cmp',
      { action: 'slow', requestId: 'req-observed' },
      { signal: controller.signal }
    );
    controller.abort();
    const res = await pending;

    expect(observed).toBe(true);
    expect(res.success).toBe(false);
    expect(res.requestId).toBe('req-observed');
    expect(res.result).toBeUndefined();
    expect(res.error).toBe(
      'Action "slow" on component "cmp" was cancelled by the caller\'s abort signal.'
    );
  });

  it('(b) a handler that IGNORES the signal is still abandoned by the executor', async () => {
    const controller = new AbortController();
    let invoked = false;
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'hung',
          handler: () => {
            invoked = true;
            return hang();
          },
        },
      ],
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const pending = executor.executeComponentAction(
      'cmp',
      { action: 'hung', requestId: 'req-ignored' },
      { signal: controller.signal }
    );
    controller.abort();
    const res = await pending;

    expect(invoked).toBe(true);
    expect(res.success).toBe(false);
    expect(res.requestId).toBe('req-ignored');
    expect(res.result).toBeUndefined();
    expect(res.error).toBe(
      'Action "hung" on component "cmp" was cancelled by the caller\'s abort signal.'
    );
  });

  it('an already-aborted signal never invokes the handler at all', async () => {
    const controller = new AbortController();
    controller.abort();
    let invoked = false;
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'go',
          handler: () => {
            invoked = true;
            return 'ok';
          },
        },
      ],
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const res = await executor.executeComponentAction(
      'cmp',
      { action: 'go' },
      { signal: controller.signal }
    );

    expect(invoked).toBe(false);
    expect(res.success).toBe(false);
    expect(res.error).toContain('cancelled by the caller');
  });
});

describe('Phase 3 — ui-bridge-native executor: wire-reachable request timeout', () => {
  it('(b) a hung handler is abandoned by request.timeoutMs', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [{ id: 'hung', handler: () => hang() }],
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const res = await executor.executeComponentAction('cmp', {
      action: 'hung',
      timeoutMs: 10,
      requestId: 'req-timeout',
    });

    expect(res.success).toBe(false);
    expect(res.requestId).toBe('req-timeout');
    expect(res.error).toBe(
      'Action "hung" on component "cmp" was abandoned after its 10ms timeout elapsed.'
    );
  });

  it('(c) a handler that finishes inside the timeout is unaffected', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'quick',
          handler: () => new Promise<string>((resolve) => setTimeout(() => resolve('fast'), 1)),
        },
      ],
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const res = await executor.executeComponentAction('cmp', {
      action: 'quick',
      timeoutMs: 2000,
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('fast');
    expect(res.error).toBeUndefined();
  });

  it('a handler that throws is reported as an error, NOT as a cancellation', async () => {
    const registry = new NativeUIBridgeRegistry();
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'boom',
          handler: () => {
            throw new Error('handler exploded');
          },
        },
      ],
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const res = await executor.executeComponentAction('cmp', { action: 'boom', timeoutMs: 5000 });

    expect(res.success).toBe(false);
    expect(res.error).toBe('handler exploded');
  });
});

describe('Phase 3 — ui-bridge-native registerComponent round-trip (the silent-drop trap)', () => {
  it('a two-arity handler survives registerComponent and receives its options bag', async () => {
    const registry = new NativeUIBridgeRegistry();
    const received: Array<{ params: unknown; hasSignal: boolean }> = [];
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'go',
          handler: (params, options) => {
            received.push({ params, hasSignal: options?.signal instanceof AbortSignal });
            return 'ok';
          },
        },
      ],
    });
    const executor = new DefaultNativeActionExecutor(registry);

    const stored = registry.getComponent('cmp');
    expect(stored?.actions.map((a) => a.id)).toEqual(['go']);
    expect(typeof stored?.actions[0].handler).toBe('function');

    const res = await executor.executeComponentAction('cmp', { action: 'go', params: { z: 9 } });

    expect(res.success).toBe(true);
    expect(received).toEqual([{ params: { z: 9 }, hasSignal: true }]);
  });
});
