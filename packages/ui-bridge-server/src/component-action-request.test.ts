/**
 * This package's component-action hops take the request out of a payload by
 * one field list, the same list `@qontinui/ui-bridge` reads.
 *
 * Plan `2026-11-10-ui-bridge-relay-and-assert-batch-drop-fields-and-headless-leaks-chromium`,
 * Phase 5. Fix A (`c0140c4`) made the direct handler and the WebSocket handler
 * carry `verifyEffect` and `requestId` by naming them in two hand-written
 * picks, so the next `ComponentActionRequest` field would have been dropped at
 * both. The tests below add a field to the list and expect both hops to carry
 * it with no edit of their own.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  COMPONENT_ACTION_REQUEST_FIELDS,
  componentActionRequestFields,
} from './component-action-request';
// The engine's list, read from source: this package resolves
// `@qontinui/ui-bridge` by range, and no published version exports it.
import { COMPONENT_ACTION_REQUEST_FIELDS as ENGINE_FIELDS } from '../../ui-bridge/src/server/component-action-invocation';
import { createHandlers, type RegistryLike } from './handlers';
import { UIBridgeWSHandler } from './websocket-handler';

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

/** Run `run` as if `name` were a `ComponentActionRequest` field, listed here. */
async function asIfARequestField<T>(name: string, run: () => Promise<T>): Promise<T> {
  const fields = COMPONENT_ACTION_REQUEST_FIELDS as Record<string, true>;
  fields[name] = true;
  try {
    return await run();
  } finally {
    delete fields[name];
  }
}

function sendOverWebSocket(ws: UIBridgeWSHandler, payload: Record<string, unknown>): void {
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

beforeEach(() => {
  seen = [];
});

describe('COMPONENT_ACTION_REQUEST_FIELDS', () => {
  it('lists every ComponentActionRequest field', () => {
    expect(Object.keys(COMPONENT_ACTION_REQUEST_FIELDS).sort()).toEqual([
      'action',
      'params',
      'requestId',
      'timeoutMs',
      'verifyEffect',
    ]);
  });

  it('is the list @qontinui/ui-bridge reads', () => {
    expect(Object.keys(COMPONENT_ACTION_REQUEST_FIELDS).sort()).toEqual(
      Object.keys(ENGINE_FIELDS).sort()
    );
  });
});

describe('componentActionRequestFields', () => {
  it('takes each listed field as it is and leaves every other key behind', () => {
    expect(
      componentActionRequestFields({
        componentId: 'login-form',
        action: 'submit',
        params: {},
        timeoutMs: 'soon',
        verifyEffect: 'yes',
        requestId: 7,
        unlisted: 'x',
      })
    ).toEqual({
      action: 'submit',
      params: {},
      timeoutMs: 'soon',
      verifyEffect: 'yes',
      requestId: 7,
    });
  });
});

describe('a request field added to the list reaches the executor', () => {
  it('through the direct handler (handlers.ts executeComponentAction)', async () => {
    const handlers = createHandlers(emptyRegistry(), recordingExecutor() as never);
    const request = { action: 'submit', params: {}, futureOptIn: 'x' };

    await asIfARequestField('futureOptIn', () =>
      handlers.executeComponentAction('login-form', request)
    );

    expect(seen).toEqual([{ id: 'login-form', action: 'submit', params: {}, futureOptIn: 'x' }]);
  });

  it('through the WebSocket handler (websocket-handler.ts), leaving componentId behind', async () => {
    const ws = new UIBridgeWSHandler(createHandlers(emptyRegistry(), recordingExecutor() as never));

    await asIfARequestField('futureOptIn', async () => {
      sendOverWebSocket(ws, {
        componentId: 'login-form',
        action: 'submit',
        params: {},
        futureOptIn: 'x',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(seen).toEqual([{ id: 'login-form', action: 'submit', params: {}, futureOptIn: 'x' }]);
  });
});
