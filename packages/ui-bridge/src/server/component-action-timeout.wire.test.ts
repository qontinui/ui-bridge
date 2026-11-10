/**
 * `ComponentActionRequest.timeoutMs` must survive EVERY wire entry point
 * (pre-PR review #1, qontinui/ui-bridge#163).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 3.
 *
 * `control/types.ts` calls `timeoutMs` *"the wire-reachable half of
 * cancellation"* — an `AbortSignal` cannot be JSON-serialized, so it is the
 * ONLY way an out-of-process caller can call off a hung handler. Every entry
 * point nonetheless rebuilt a closed `{ action, params }` literal and dropped
 * it, so no HTTP or WebSocket caller could set a timeout at all. That is the
 * PR's own headline defect — a declared field that never arrives at runtime —
 * reproduced inside the PR that fixes it.
 *
 * Nothing pinned the forwarding, which is exactly why it went missing. This
 * does, one test per seam, against a recording executor: whatever the seam
 * hands the executor is what a real handler would see.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { createControlHandlers } from './nextjs';
import { UIBridgeWSHandler } from './websocket-handler';
import type { createRelayHandlers } from './relay-handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';
import type { UIBridgeServerHandlers } from './types';
import { asIfARequestField, relayDispatchingTo } from '../react/__tests__/relay-into-listener';

/** Every request the executor was handed, in order. */
let seen: Array<Record<string, unknown>>;

function recordingExecutor() {
  return {
    executeAction: async () => ({ success: true }),
    executeComponentAction: async (id: string, request: Record<string, unknown>) => {
      seen.push({ id, ...request });
      return { success: true, result: 'ok', durationMs: 1, timestamp: 0 };
    },
  };
}

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

beforeEach(() => {
  seen = [];
  resetGlobalRegistry();
  getGlobalRegistry().registerComponent('login-form', {
    name: 'Login Form',
    actions: [{ id: 'submit', handler: () => 'submitted' }],
  });
});

describe('direct HTTP handlers (server/handlers.ts)', () => {
  it('forwards timeoutMs to the executor', async () => {
    const handlers = createHandlers(makeRegistryLike(), recordingExecutor() as never);

    await handlers.executeComponentAction('login-form', {
      action: 'submit',
      params: {},
      timeoutMs: 5000,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ id: 'login-form', action: 'submit', params: {}, timeoutMs: 5000 });
  });

  it('leaves timeoutMs undefined when the caller omits it', async () => {
    const handlers = createHandlers(makeRegistryLike(), recordingExecutor() as never);

    await handlers.executeComponentAction('login-form', { action: 'submit', params: {} });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: {},
      timeoutMs: undefined,
    });
  });
});

describe('direct HTTP handlers forward verifyEffect and requestId', () => {
  it('executeComponentAction forwards both to the executor', async () => {
    const handlers = createHandlers(makeRegistryLike(), recordingExecutor() as never);

    await handlers.executeComponentAction('login-form', {
      action: 'submit',
      params: {},
      verifyEffect: false,
      requestId: 'req-d',
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: {},
      verifyEffect: false,
      requestId: 'req-d',
    });
  });

  it('invokeComponentAction hoists verifyEffect out of the body', async () => {
    const handlers = createHandlers(makeRegistryLike(), recordingExecutor() as never);

    await handlers.invokeComponentAction('login-form', 'submit', {
      user: 'ada',
      verifyEffect: true,
      requestId: 'req-i',
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: { user: 'ada' },
      verifyEffect: true,
      requestId: 'req-i',
    });
  });
});

describe('Next.js route adapter (server/nextjs.ts)', () => {
  it('carries timeoutMs from the POST body through to the executor', async () => {
    const handlers = createHandlers(
      makeRegistryLike(),
      recordingExecutor() as never
    ) as unknown as UIBridgeServerHandlers;
    const control = createControlHandlers(handlers);

    const request = new Request('https://test.local/control/component/login-form/action/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { user: 'ada' }, timeoutMs: 2500 }),
    });

    await control.component.POST(request as never, {
      params: { id: 'login-form', actionId: 'submit' },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: { user: 'ada' },
      timeoutMs: 2500,
    });
  });
});

describe('WebSocket handler (server/websocket-handler.ts)', () => {
  it('forwards the payload timeoutMs', async () => {
    const handlers = createHandlers(makeRegistryLike(), recordingExecutor() as never);
    const ws = new UIBridgeWSHandler(handlers as unknown as Partial<UIBridgeServerHandlers>);

    const sent: string[] = [];
    const socket = {
      send: (data: string) => sent.push(data),
      close: () => {},
      readyState: 1,
      onmessage: undefined as ((event: { data: string }) => void) | undefined,
      onclose: undefined,
      onerror: undefined,
    };
    ws.handleConnection(socket);

    socket.onmessage?.({
      data: JSON.stringify({
        id: 'req-1',
        type: 'executeComponentAction',
        timestamp: 0,
        payload: {
          componentId: 'login-form',
          action: 'submit',
          params: { user: 'ada' },
          timeoutMs: 750,
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: { user: 'ada' },
      timeoutMs: 750,
    });
  });
});

describe('relay handlers, HTTP route arm (invokeComponentAction)', () => {
  /**
   * `POST /control/component/:id/action/:actionId` calls the route's handler
   * as `(id, actionId, body, context)` and merges flat body keys into
   * `params`. Without an exclusion list `timeoutMs` arrived as a PARAMETER
   * named `timeoutMs`, which both loses the cancellation and, under
   * `additionalProperties: false`, fails the action's own schema.
   */
  function relayCapture(): {
    handlers: ReturnType<typeof createRelayHandlers>;
    dispatched: Array<Record<string, unknown>>;
  } {
    const dispatched: Array<Record<string, unknown>> = [];
    // Intercept at the dispatch boundary: `queueCommand` is what carries the
    // normalized request to the browser, so whatever lands here is what the
    // in-page handler receives.
    const handlers = relayDispatchingTo(async (action, payload) => {
      dispatched.push({ action, ...payload });
      return { success: true };
    });
    return { handlers, dispatched };
  }

  it('hoists timeoutMs onto the request instead of merging it into params', async () => {
    const { handlers, dispatched } = relayCapture();

    await handlers.invokeComponentAction('login-form', 'submit', {
      layoutId: 'single',
      timeoutMs: 1234,
      requestId: 'req-9',
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].id).toBe('login-form');
    expect(dispatched[0].request).toEqual({
      action: 'submit',
      params: { layoutId: 'single' },
      timeoutMs: 1234,
      requestId: 'req-9',
    });
  });

  it('still merges ordinary flat body keys into params', async () => {
    const { handlers, dispatched } = relayCapture();

    await handlers.invokeComponentAction('login-form', 'submit', {
      layoutId: 'single',
      mode: 'fast',
    });

    expect(dispatched[0].request).toEqual({
      action: 'submit',
      params: { layoutId: 'single', mode: 'fast' },
      timeoutMs: undefined,
      requestId: undefined,
    });
  });
});

describe('WebSocket handler forwards verifyEffect and requestId', () => {
  function send(ws: UIBridgeWSHandler, payload: Record<string, unknown>): void {
    const socket = {
      send: () => {},
      close: () => {},
      readyState: 1,
      onmessage: undefined as ((event: { data: string }) => void) | undefined,
      onclose: undefined,
      onerror: undefined,
    };
    ws.handleConnection(socket);
    socket.onmessage?.({
      data: JSON.stringify({ id: 'req-ws', type: 'executeComponentAction', timestamp: 0, payload }),
    });
  }

  it('forwards a boolean verifyEffect and a string requestId', async () => {
    const ws = new UIBridgeWSHandler(
      createHandlers(
        makeRegistryLike(),
        recordingExecutor() as never
      ) as unknown as Partial<UIBridgeServerHandlers>
    );

    send(ws, {
      componentId: 'login-form',
      action: 'submit',
      params: {},
      verifyEffect: false,
      requestId: 'req-7',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: {},
      verifyEffect: false,
      requestId: 'req-7',
    });
  });

  // The hop does not filter it. The executor is the one place that decides what
  // a request field means, and it treats only a boolean `verifyEffect` as an
  // instruction ("a non-boolean verifyEffect is not forwarded as an
  // instruction" in `react/commandHandlers.effectVerification.relay.test.ts`
  // drives the real executor).
  it('hands a non-boolean verifyEffect on as it is, for the executor to judge', async () => {
    const ws = new UIBridgeWSHandler(
      createHandlers(
        makeRegistryLike(),
        recordingExecutor() as never
      ) as unknown as Partial<UIBridgeServerHandlers>
    );

    send(ws, { componentId: 'login-form', action: 'submit', verifyEffect: 'true' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual([{ id: 'login-form', action: 'submit', verifyEffect: 'true' }]);
  });

  it('carries a request field added to the list, and leaves componentId behind', async () => {
    const ws = new UIBridgeWSHandler(
      createHandlers(
        makeRegistryLike(),
        recordingExecutor() as never
      ) as unknown as Partial<UIBridgeServerHandlers>
    );

    await asIfARequestField('futureOptIn', async () => {
      send(ws, { componentId: 'login-form', action: 'submit', params: {}, futureOptIn: 'x' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(seen).toEqual([{ id: 'login-form', action: 'submit', params: {}, futureOptIn: 'x' }]);
  });
});
