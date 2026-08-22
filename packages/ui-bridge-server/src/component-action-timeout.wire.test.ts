/**
 * `ComponentActionRequest.timeoutMs` must survive every entry point in THIS
 * package too (pre-PR review #1, qontinui/ui-bridge#163).
 *
 * Plan: `2026-08-20-ui-bridge-action-declaration-shape.md`, Phase 3.
 *
 * `@qontinui/ui-bridge-server` carries byte-identical twins of `ui-bridge`'s
 * HTTP handler and WebSocket handler, and both rebuilt a closed
 * `{ action, params }` literal — dropping the only cancellation an
 * out-of-process caller has, since an `AbortSignal` cannot be JSON-serialized.
 * A twin that is not tested is a twin that drifts.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { createControlHandlers } from './nextjs';
import { UIBridgeWSHandler } from './websocket-handler';
import type { UIBridgeServerHandlers } from './types';

let seen: Array<Record<string, unknown>>;

function recordingExecutor() {
  return {
    executeAction: async () => ({ success: true }),
    executeComponentAction: async (id: string, request: Record<string, unknown>) => {
      seen.push({ id, ...request });
      return { success: true, result: 'ok', durationMs: 0, timestamp: 0 };
    },
  };
}

function emptyRegistry(): RegistryLike {
  return {
    getAllElements: () => [],
    getElement: () => undefined,
    getAllComponents: () => [],
    getComponent: () => ({ id: 'login-form', name: 'Login Form', actions: [] }),
    createSnapshot: () =>
      ({
        timestamp: 0,
        elements: [],
        components: [],
        workflows: [],
        activeRuns: [],
      }) as unknown as ReturnType<RegistryLike['createSnapshot']>,
  };
}

function makeHandlers(): UIBridgeServerHandlers {
  return createHandlers(emptyRegistry(), recordingExecutor() as never);
}

beforeEach(() => {
  seen = [];
});

describe('direct HTTP handlers (handlers.ts)', () => {
  it('forwards timeoutMs to the executor', async () => {
    await makeHandlers().executeComponentAction('login-form', {
      action: 'submit',
      params: {},
      timeoutMs: 4200,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ id: 'login-form', action: 'submit', params: {}, timeoutMs: 4200 });
  });

  it('leaves timeoutMs undefined when the caller omits it', async () => {
    await makeHandlers().executeComponentAction('login-form', {
      action: 'submit',
      params: {},
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: {},
      timeoutMs: undefined,
    });
  });
});

describe('Next.js route adapter (nextjs.ts)', () => {
  it('carries timeoutMs from the POST body through to the executor', async () => {
    const control = createControlHandlers(makeHandlers());

    const request = new Request('https://test.local/control/component/login-form/action/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { user: 'ada' }, timeoutMs: 1500 }),
    });

    await control.component.POST(
      request as never,
      {
        params: Promise.resolve({ id: 'login-form', actionId: 'submit' }),
      } as never
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: { user: 'ada' },
      timeoutMs: 1500,
    });
  });
});

describe('WebSocket handler (websocket-handler.ts)', () => {
  it('forwards the payload timeoutMs', async () => {
    const ws = new UIBridgeWSHandler(makeHandlers());

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
      data: JSON.stringify({
        id: 'req-1',
        type: 'executeComponentAction',
        timestamp: 0,
        payload: {
          componentId: 'login-form',
          action: 'submit',
          params: { user: 'ada' },
          timeoutMs: 900,
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      id: 'login-form',
      action: 'submit',
      params: { user: 'ada' },
      timeoutMs: 900,
    });
  });
});
