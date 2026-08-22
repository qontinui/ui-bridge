/**
 * Phase 3 — cancellation threaded through the WEB action-invocation seam.
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 3.
 *
 * Covers, per the phase's three required arms:
 *   (a) a handler that OBSERVES its signal aborts promptly;
 *   (b) a handler that IGNORES its signal is still abandoned by the executor;
 *   (c) the normal, non-aborted path is unchanged.
 *
 * Every expectation is a hand-written literal. Nothing here is asserted via
 * `satisfies`, a type assertion, or a constant imported from the code under
 * test — a test written against its own subject pins nothing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

/** A promise that never settles — the "hung handler" the feature exists for. */
function hang(): Promise<never> {
  return new Promise<never>(() => {});
}

describe('Phase 3 — web executor: caller-supplied AbortSignal', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
  });

  it('(c) normal path is unchanged: no signal, no timeout, handler result returned', async () => {
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [{ id: 'go', handler: (params) => ({ echoed: params }) }],
    });

    const res = await executor.executeComponentAction('cmp', {
      action: 'go',
      params: { a: 1 },
      requestId: 'req-normal',
    });

    expect(res.success).toBe(true);
    expect(res.result).toEqual({ echoed: { a: 1 } });
    expect(res.error).toBeUndefined();
    expect(res.failureDetails).toBeUndefined();
    expect(res.requestId).toBe('req-normal');
  });

  it('(c) normal path is unchanged when a signal is supplied but never aborted', async () => {
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [{ id: 'go', handler: () => 'done' }],
    });
    const controller = new AbortController();

    const res = await executor.executeComponentAction(
      'cmp',
      { action: 'go' },
      { signal: controller.signal }
    );

    expect(res.success).toBe(true);
    expect(res.result).toBe('done');
    expect(res.failureDetails).toBeUndefined();
  });

  it('the executor hands the handler a live AbortSignal as its second argument', async () => {
    const seen: { signalKind: string; aborted: boolean | null } = {
      signalKind: 'MISSING',
      aborted: null,
    };
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

    await executor.executeComponentAction('cmp', { action: 'go' });

    expect(seen.signalKind).toBe('AbortSignal');
    expect(seen.aborted).toBe(false);
  });

  it('(a) a handler that OBSERVES the signal aborts promptly', async () => {
    const controller = new AbortController();
    let observed = false;

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
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(res.failureDetails?.cancelReason).toBe('signal');
    expect(res.error).toContain('cancelled by the caller');
  });

  it('(b) a handler that IGNORES the signal is still abandoned by the executor', async () => {
    const controller = new AbortController();
    let invoked = false;

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
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(res.failureDetails?.cancelReason).toBe('signal');
    expect(res.failureDetails?.context).toEqual({ action: 'hung', cancelReason: 'signal' });
  });

  it('an already-aborted signal never invokes the handler at all', async () => {
    const controller = new AbortController();
    controller.abort();
    let invoked = false;

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

    const res = await executor.executeComponentAction(
      'cmp',
      { action: 'go' },
      { signal: controller.signal }
    );

    expect(invoked).toBe(false);
    expect(res.success).toBe(false);
    expect(res.failureDetails?.cancelReason).toBe('signal');
  });
});

describe('Phase 3 — web executor: wire-reachable request timeout', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
  });

  it('(b) a hung handler is abandoned by request.timeoutMs with cancelReason "timeout"', async () => {
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [{ id: 'hung', handler: () => hang() }],
    });

    const res = await executor.executeComponentAction('cmp', {
      action: 'hung',
      timeoutMs: 10,
      requestId: 'req-timeout',
    });

    expect(res.success).toBe(false);
    expect(res.requestId).toBe('req-timeout');
    // The TIMEOUT arm carries the catalog's dedicated timeout code (the
    // pre-PR review's finding #10); the SIGNAL arm above keeps
    // `UB-ACTION-FAILED`, because caller cancellation has no code of its own.
    // `cancelReason` is set on both, so it stays the reliable
    // "was this abandoned?" test.
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-TIMEOUT');
    expect(res.failureDetails?.cancelReason).toBe('timeout');
    expect(res.failureDetails?.timeoutMs).toBe(10);
    expect(res.error).toContain('10ms timeout');
  });

  it('(c) a handler that finishes inside the timeout is unaffected', async () => {
    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [
        {
          id: 'quick',
          handler: () => new Promise<string>((resolve) => setTimeout(() => resolve('fast'), 1)),
        },
      ],
    });

    const res = await executor.executeComponentAction('cmp', {
      action: 'quick',
      timeoutMs: 2000,
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('fast');
    expect(res.failureDetails).toBeUndefined();
  });

  it('a handler that throws is still UB-ACTION-FAILED but carries NO cancelReason', async () => {
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

    const res = await executor.executeComponentAction('cmp', { action: 'boom', timeoutMs: 5000 });

    expect(res.success).toBe(false);
    expect(res.failureDetails?.errorCode).toBe('UB-ACTION-FAILED');
    expect(res.failureDetails?.cancelReason).toBeUndefined();
    expect(res.error).toBe('handler exploded');
  });
});

describe('Phase 3 — registerComponent round-trip (the silent-drop trap)', () => {
  it('a two-arity handler survives registerComponent and receives its options bag', async () => {
    const registry = new UIBridgeRegistry();
    const executor = new DefaultActionExecutor(registry);
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

    // The registration re-maps the action into a fresh object literal with a
    // closed field list; assert the handler that comes back out is the one we
    // put in, at runtime, not merely that the types line up.
    const stored = registry.getComponent('cmp');
    expect(stored?.actions.map((a) => a.id)).toEqual(['go']);
    expect(typeof stored?.actions[0].handler).toBe('function');

    const res = await executor.executeComponentAction('cmp', { action: 'go', params: { z: 9 } });

    expect(res.success).toBe(true);
    expect(received).toEqual([{ params: { z: 9 }, hasSignal: true }]);
  });

  it('a two-arity handler survives updateComponent as well', async () => {
    const registry = new UIBridgeRegistry();
    const executor = new DefaultActionExecutor(registry);
    let sawSignal = false;

    registry.registerComponent('cmp', {
      name: 'Cmp',
      actions: [{ id: 'old', handler: () => 'old' }],
    });

    const updated = registry.updateComponent('cmp', {
      actions: [
        {
          id: 'new',
          handler: (_params, options) => {
            sawSignal = options?.signal instanceof AbortSignal;
            return 'new';
          },
        },
      ],
    });

    expect(updated).toBe(true);
    expect(registry.getComponent('cmp')?.actions.map((a) => a.id)).toEqual(['new']);

    const res = await executor.executeComponentAction('cmp', { action: 'new' });

    expect(res.success).toBe(true);
    expect(res.result).toBe('new');
    expect(sawSignal).toBe(true);
  });
});
