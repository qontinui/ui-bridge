/**
 * How this package reads a component-action request off its transports, and
 * the route that serves one.
 *
 * Plan `2026-11-10-ui-bridge-relay-and-assert-batch-drop-fields-and-headless-leaks-chromium`,
 * Phase 5, and the review of its diff:
 *   - A1: `POST /control/component/:id/action/:actionId` was routed to
 *     `executeComponentAction` with the URL params `id` and `actionId`, so
 *     every adapter called it as `(id, actionId, body)` and the executor was
 *     handed nothing. It now has its own handler, `invokeComponentAction`.
 *   - A4: this package resolves `@qontinui/ui-bridge` by range, and no released
 *     executor validates `requestId`. So the hops here drop a non-string
 *     `requestId` and a non-boolean `verifyEffect` themselves.
 *   - A5: the whole-request hops hand the request on minus their own keys, not
 *     by a field list, so a field that a later `@qontinui/ui-bridge` adds is
 *     carried even though this package's list predates it.
 *
 * Every expectation is a hand-written literal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { COMPONENT_ACTION_REQUEST_FIELDS } from './component-action-request';
// The engine's list, read from source: this package resolves
// `@qontinui/ui-bridge` by range, and no published version exports it.
import { COMPONENT_ACTION_REQUEST_FIELDS as ENGINE_FIELDS } from '../../ui-bridge/src/server/component-action-invocation';
import { createHandlers, type RegistryLike } from './handlers';
import { UIBridgeWSHandler } from './websocket-handler';
import { createExpressApp, createExpressRouter } from './express';
import { createNextRouteHandlers } from './nextjs';
import { StandaloneServer } from './standalone';
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

async function sendOverWebSocket(payload: Record<string, unknown>): Promise<void> {
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
    data: JSON.stringify({ id: 'req-ws', type: 'executeComponentAction', timestamp: 0, payload }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
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

describe('the whole-request hops hand the request on whole', () => {
  it('the direct handler (handlers.ts executeComponentAction) carries a field no list holds', async () => {
    const request = { action: 'submit', params: {}, futureOptIn: 'x' };

    await makeHandlers().executeComponentAction('login-form', request);

    expect(seen).toEqual([{ id: 'login-form', action: 'submit', params: {}, futureOptIn: 'x' }]);
  });

  it('the WebSocket handler carries it too, and leaves componentId behind', async () => {
    await sendOverWebSocket({
      componentId: 'login-form',
      action: 'submit',
      params: {},
      futureOptIn: 'x',
    });

    expect(seen).toEqual([{ id: 'login-form', action: 'submit', params: {}, futureOptIn: 'x' }]);
  });
});

describe('requestId and verifyEffect are checked here as well as at the executor', () => {
  const malformed = { requestId: 42, verifyEffect: 'true' };

  it('the direct handler drops a non-string requestId and a non-boolean verifyEffect', async () => {
    const request = { action: 'submit', params: {}, ...malformed };

    await makeHandlers().executeComponentAction('login-form', request as never);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ id: 'login-form', action: 'submit', params: {} });
    expect('requestId' in seen[0]).toBe(false);
    expect('verifyEffect' in seen[0]).toBe(false);
  });

  it('the WebSocket handler drops them', async () => {
    await sendOverWebSocket({ componentId: 'login-form', action: 'submit', ...malformed });

    expect(seen).toHaveLength(1);
    expect('requestId' in seen[0]).toBe(false);
    expect('verifyEffect' in seen[0]).toBe(false);
  });

  it('the route drops them, and never makes them params', async () => {
    await makeHandlers().invokeComponentAction('login-form', 'submit', { ...malformed, a: 1 });

    expect(seen).toEqual([{ id: 'login-form', action: 'submit', params: { a: 1 } }]);
    expect('requestId' in seen[0]).toBe(false);
    expect('verifyEffect' in seen[0]).toBe(false);
  });

  it('keeps a string requestId and a boolean verifyEffect', async () => {
    await makeHandlers().executeComponentAction('login-form', {
      action: 'submit',
      requestId: 'req-k',
      verifyEffect: false,
    });

    expect(seen).toEqual([
      { id: 'login-form', action: 'submit', requestId: 'req-k', verifyEffect: false },
    ]);
  });
});

describe('the route body becomes the request (invokeComponentAction)', () => {
  it('hoists the request fields and makes every other key a param, an explicit params winning', async () => {
    await makeHandlers().invokeComponentAction('login-form', 'submit', {
      user: 'ada',
      size: 1,
      params: { size: 2 },
      timeoutMs: 900,
      requestId: 'req-r',
      verifyEffect: true,
    });

    expect(seen).toEqual([
      {
        id: 'login-form',
        action: 'submit',
        params: { user: 'ada', size: 2 },
        timeoutMs: 900,
        requestId: 'req-r',
        verifyEffect: true,
      },
    ]);
  });

  it('keeps a body key named action as a param, the route naming the action', async () => {
    await makeHandlers().invokeComponentAction('login-form', 'dispatch', { action: 'increment' });

    expect(seen).toEqual([
      { id: 'login-form', action: 'dispatch', params: { action: 'increment' } },
    ]);
  });

  it('hoists a field added to the list instead of merging it into params', async () => {
    await asIfARequestField('futureOptIn', () =>
      makeHandlers().invokeComponentAction('login-form', 'submit', { futureOptIn: 'x', a: 1 })
    );

    expect(seen).toEqual([
      { id: 'login-form', action: 'submit', params: { a: 1 }, futureOptIn: 'x' },
    ]);
  });
});

describe('POST /control/component/:id/action/:actionId reaches the action through every adapter', () => {
  const BASE = '/ui-bridge';
  const PATH = `${BASE}/control/component/login-form/action/submit`;
  const BODY = { user: 'ada', timeoutMs: 900, requestId: 'req-h' };
  const EXPECTED = {
    id: 'login-form',
    action: 'submit',
    params: { user: 'ada' },
    timeoutMs: 900,
    requestId: 'req-h',
  };

  let server: Server | undefined;
  let standalone: StandaloneServer | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    await standalone?.stop();
    standalone = undefined;
  });

  async function listen(app: Parameters<typeof createServer>[1]): Promise<number> {
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  /** createExpressRouter with its own body parser, mounted on a bare app. */
  async function routerApp(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const express = require('express');
    const app = express();
    app.use(BASE, createExpressRouter(makeHandlers(), { useBodyParser: true }));
    return listen(app);
  }

  /**
   * StandaloneServer, which serves the same route table with its own router,
   * on a port the OS picks. The port is given explicitly because the default
   * is 9876, the live runner's.
   */
  async function standaloneServer(): Promise<number> {
    standalone = new StandaloneServer(makeHandlers(), {
      host: '127.0.0.1',
      port: 0,
      log: () => {},
    });
    await standalone.start();
    return standalone.getAddress()!.port;
  }

  it.each([
    [
      'createExpressApp',
      () => listen(createExpressApp(makeHandlers()) as Parameters<typeof createServer>[1]),
    ],
    ['createExpressRouter({ useBodyParser: true })', routerApp],
    ['StandaloneServer', standaloneServer],
  ])('through %s', async (_name, start) => {
    const port = await start();

    const response = await fetch(`http://127.0.0.1:${port}${PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as Record<string, unknown>).success).toBe(true);
    expect(seen).toEqual([EXPECTED]);
  });

  it('through the Next.js catch-all (createNextRouteHandlers)', async () => {
    const routes = createNextRouteHandlers(makeHandlers());
    const url = `http://localhost/api/ui-bridge/control/component/login-form/action/submit`;
    const request = Object.assign(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(BODY),
      }),
      { nextUrl: new URL(url) }
    );

    const response = await routes.POST(
      request as never,
      { params: { path: ['control', 'component', 'login-form', 'action', 'submit'] } } as never
    );

    expect(((await response.json()) as Record<string, unknown>).success).toBe(true);
    expect(seen).toEqual([EXPECTED]);
  });
});
