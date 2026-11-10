/**
 * A component action crosses every hop whole: the request on the way in, and
 * the response on the way out.
 *
 * Plan `2026-11-10-ui-bridge-relay-and-assert-batch-drop-fields-and-headless-leaks-chromium`,
 * Phase 5 (D1, option B). Fix A (`54e3d71`, `c0140c4`, `de78b84`) made the
 * relay carry `verifyEffect` by adding it to typed picks and to a hand-listed
 * response envelope, one field at a time. The next field added to
 * `ComponentActionRequest` or `ComponentActionResponse` would have been dropped
 * the same way, and the envelope already dropped `stack`.
 *
 * So these tests use fields that no hop has ever heard of. A hop passes only
 * when it forwards whole, or when it reads the one field list,
 * `COMPONENT_ACTION_REQUEST_FIELDS`, which the compiler keeps exhaustive.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import { resetGlobalEffectStore } from '../control/effect-store';
import { resetGlobalActionWindowRegistry } from '../control/action-window-registry';
import { createHandlers, type RegistryLike } from '../server/handlers';
import {
  asIfARequestField,
  listener,
  overTheWire,
  relayIntoListener,
  relayQueueingInto,
} from './__tests__/relay-into-listener';
import { createRelayHandlers } from '../server/relay-handlers';

function registryLike(): RegistryLike {
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

/** Every request a recording executor was handed, with the component it named. */
let seen: Array<{ id: string; request: Record<string, unknown> }>;

function recordingExecutor() {
  return {
    executeAction: async () => ({ success: true }),
    executeComponentAction: async (id: string, request: Record<string, unknown>) => {
      seen.push({ id, request });
      return { success: true, result: 'ok', durationMs: 1, timestamp: 0 };
    },
  };
}

beforeEach(() => {
  seen = [];
  resetGlobalRegistry();
  resetGlobalEffectStore();
  resetGlobalActionWindowRegistry();
  getGlobalRegistry().registerComponent('plain', {
    name: 'Plain',
    actions: [{ id: 'go', handler: () => 'went' }],
  });
});

afterEach(() => {
  resetGlobalEffectStore();
  resetGlobalActionWindowRegistry();
  vi.restoreAllMocks();
});

describe('the listener hands the executor the wire request whole', () => {
  it('executeComponentAction (relay spelling) passes on a field it has never heard of', async () => {
    const spy = vi.spyOn(DefaultActionExecutor.prototype, 'executeComponentAction');

    await listener('executeComponentAction', {
      id: 'plain',
      request: { action: 'go', params: { size: 2 }, futureOptIn: 'x' },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('plain');
    expect(spy.mock.calls[0][1]).toEqual({ action: 'go', params: { size: 2 }, futureOptIn: 'x' });
  });

  it('executeComponentAction reads the action from actionId, and actionId stays behind', async () => {
    const spy = vi.spyOn(DefaultActionExecutor.prototype, 'executeComponentAction');

    await listener('executeComponentAction', {
      id: 'plain',
      request: { actionId: 'go', futureOptIn: 'x' },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({ action: 'go', futureOptIn: 'x' });
  });

  it('execute_component_action (IPC spelling) passes on a field it has never heard of, and leaves its routing keys behind', async () => {
    const spy = vi.spyOn(DefaultActionExecutor.prototype, 'executeComponentAction');

    await listener('execute_component_action', {
      componentId: 'plain',
      actionId: 'go',
      params: { size: 2 },
      futureOptIn: 'x',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('plain');
    expect(spy.mock.calls[0][1]).toEqual({ action: 'go', params: { size: 2 }, futureOptIn: 'x' });
  });
});

describe('POST /control/component/:id/action/:actionId carries a new request field to the executor', () => {
  it('over the relay: invokeComponentAction, then componentActionInvocation, then the listener', async () => {
    const spy = vi.spyOn(DefaultActionExecutor.prototype, 'executeComponentAction');
    // Entered through createRelayHandlers, the server half the relay route uses,
    // with only the tab replaced by the listener.
    const handlers = createRelayHandlers(
      relayQueueingInto((action, payload) => listener(action, overTheWire(payload)))
    );

    const res = overTheWire(
      await asIfARequestField('futureOptIn', () =>
        handlers.invokeComponentAction('plain', 'go', { layoutId: 'single', futureOptIn: 'x' })
      )
    );

    expect(res.success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({
      action: 'go',
      params: { layoutId: 'single' },
      futureOptIn: 'x',
    });
  });

  it('on the direct route (server/handlers.ts invokeComponentAction)', async () => {
    const handlers = createHandlers(registryLike(), recordingExecutor() as never);

    await asIfARequestField('futureOptIn', () =>
      handlers.invokeComponentAction('plain', 'go', { layoutId: 'single', futureOptIn: 'x' })
    );

    expect(seen).toEqual([
      {
        id: 'plain',
        request: { action: 'go', params: { layoutId: 'single' }, futureOptIn: 'x' },
      },
    ]);
  });

  it('the direct whole-request handler (server/handlers.ts executeComponentAction) passes on a field it has never heard of', async () => {
    const handlers = createHandlers(registryLike(), recordingExecutor() as never);
    const request = { action: 'go', params: {}, futureOptIn: 'x' };

    await handlers.executeComponentAction('plain', request);

    expect(seen).toEqual([
      { id: 'plain', request: { action: 'go', params: {}, futureOptIn: 'x' } },
    ]);
  });
});

describe('the listener hands the relay caller the executor response whole', () => {
  it('a response field the listener has never heard of reaches the caller', async () => {
    const response = {
      success: true,
      result: 'went',
      durationMs: 3,
      timestamp: 4,
      futureVerdict: { settled: true },
    };
    vi.spyOn(DefaultActionExecutor.prototype, 'executeComponentAction').mockResolvedValue(response);

    const res = overTheWire(await relayIntoListener().invokeComponentAction('plain', 'go', {}));

    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      success: true,
      result: 'went',
      durationMs: 3,
      timestamp: 4,
      futureVerdict: { settled: true },
    });
  });

  it('a throwing handler’s stack reaches the caller, as it already does on the direct route', async () => {
    getGlobalRegistry().registerComponent('broken', {
      name: 'Broken',
      actions: [
        {
          id: 'go',
          handler: () => {
            throw new Error('handler blew up');
          },
        },
      ],
    });

    // Control: the direct route answers with the executor's response whole.
    const direct = overTheWire(
      await createHandlers(
        registryLike(),
        new DefaultActionExecutor(getGlobalRegistry())
      ).invokeComponentAction('broken', 'go', {})
    );
    expect((direct.data as Record<string, unknown>).stack).toContain('Error: handler blew up');

    const relayed = overTheWire(
      await relayIntoListener().invokeComponentAction('broken', 'go', {})
    );
    const data = relayed.data as Record<string, unknown>;

    expect(relayed.success).toBe(false);
    expect(data.success).toBe(false);
    expect(data.error).toBe('handler blew up');
    expect(typeof data.stack).toBe('string');
    expect(data.stack).toContain('Error: handler blew up');
  });
});
