/**
 * Over HTTP, a caller's command reaches only that caller's own tab, and
 * nothing in a request can supply the caller identity.
 *
 * The adapters call a handler positionally: URL params, then the payload (the
 * body, or the GET query) when the route takes one, then the context carrying
 * the identity the consumer's auth gate verified (`X-Caller-User-Id`). The
 * relay enforces per-user tab scoping (§4.2) from that context. When a route's
 * declared shape disagrees with its handler's parameters, the context slides
 * into a request slot, and the command goes to whichever tab is primary.
 * Alternatively, request data lands in the context slot and names the
 * identity itself. `route-argument-alignment.test.ts` pins the declarations;
 * these tests observe the effect end to end through each adapter.
 *
 * The setup: two tabs on one relay. tab-b belongs to user-b and connects
 * first. tab-a belongs to user-a, connects second, and so is the primary tab.
 * Every request is made as user-b, so any answer from tab-a is a command run
 * on another user's tab.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';
import { createNextRouteHandlers } from './nextjs';
import { createExpressApp } from './express';
import { createStandaloneServer, type StandaloneServer } from './standalone';

const BASE = '/api/ui-bridge';

interface Seen {
  tab: string;
  action: string;
  payload: unknown;
}

/** A relay with tab-b (user-b) and then tab-a (user-a, primary) connected. */
function twoUserRelay(seen: Seen[]): CommandRelay {
  const relay = new CommandRelay({
    globalPrefix: `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`,
  });
  for (const [tab, userId] of [
    ['tab-b', 'user-b'],
    ['tab-a', 'user-a'],
  ] as const) {
    relay.subscribeToCommands((command) => {
      seen.push({ tab, action: command.action, payload: command.payload });
      setTimeout(
        () =>
          relay.resolveCommand(
            command.commandId,
            { tab, elements: [], components: [], workflows: [], timestamp: Date.now() },
            tab
          ),
        0
      );
    }, tab);
    relay.receiveHeartbeat(tab, { url: 'http://app.test/', title: tab, visibility: 'visible' });
    relay.recordRegistration(tab, { userId, sessionId: `session-${tab}` });
  }
  return relay;
}

type Call = (
  method: 'GET' | 'POST',
  path: string,
  options?: { body?: unknown; caller?: string | null }
) => Promise<{ status: number; json: Record<string, unknown> }>;

function headers(caller: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (caller !== null) h['X-Caller-User-Id'] = caller ?? 'user-b';
  return h;
}

/** Requests through the Next.js catch-all, in process. */
function nextCall(relay: CommandRelay): Call {
  const routes = createNextRouteHandlers(createRelayHandlers(relay), { relay });
  return async (method, path, options = {}) => {
    const url = `http://app.test${BASE}${path}`;
    const init: RequestInit = { method, headers: headers(options.caller) };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    const nextUrl = new URL(url);
    const request = Object.assign(new Request(url, init), { nextUrl });
    const params = { path: nextUrl.pathname.slice(BASE.length + 1) };
    const response = await routes[method](request, { params });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };
}

/** Requests through the Express app, over a loopback socket. */
async function expressCall(relay: CommandRelay, servers: Server[]): Promise<Call> {
  const app = createExpressApp(createRelayHandlers(relay), { basePath: BASE }) as Parameters<
    typeof createServer
  >[1];
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return async (method, path, options = {}) => {
    const init: RequestInit = { method, headers: headers(options.caller) };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    const response = await fetch(`http://127.0.0.1:${port}${BASE}${path}`, init);
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };
}

describe('per-user tab scoping over the Next.js adapter', () => {
  let seen: Seen[];
  let relay: CommandRelay;

  beforeEach(() => {
    seen = [];
    relay = twoUserRelay(seen);
  });

  afterEach(() => relay.destroy());

  it('without a caller identity a command goes to the primary tab (the setup tells the tabs apart)', async () => {
    await nextCall(relay)('GET', '/control/element/save/state', { caller: null });
    expect(seen.at(-1)?.tab).toBe('tab-a');
  });

  it('POST /control/find reaches the caller own tab with the criteria the caller sent', async () => {
    const res = await nextCall(relay)('POST', '/control/find', {
      body: { text: 'Save', includeMedia: true },
    });
    expect(res.status).toBe(200);
    expect(seen.at(-1)?.tab).toBe('tab-b');
    expect(seen.at(-1)?.payload).toMatchObject({ text: 'Save', includeMedia: true });
    expect(seen.at(-1)?.payload).not.toHaveProperty('callerUserId');
  });

  it('GET /control/snapshot with no query reaches the caller own tab', async () => {
    await nextCall(relay)('GET', '/control/snapshot');
    expect(seen.at(-1)?.tab).toBe('tab-b');
  });

  it('a query string cannot name the caller: GET element state stays on the caller tab', async () => {
    await nextCall(relay)('GET', '/control/element/save/state?callerUserId=user-a');
    expect(seen.at(-1)?.tab).toBe('tab-b');
  });

  it('a body cannot name the caller: the named intent runs on the caller tab with its params', async () => {
    await nextCall(relay)('POST', '/control/intent/demo/execute', {
      body: { callerUserId: 'user-a', params: { size: 2 } },
    });
    expect(seen.at(-1)?.tab).toBe('tab-b');
    expect(seen.at(-1)?.payload).toEqual({ intentId: 'demo', params: { size: 2 } });
  });

  it('a component action runs on the caller tab and no routing field reaches its params', async () => {
    await nextCall(relay)('POST', '/control/component/save/action/click', {
      body: { params: { label: 'Save' }, timeoutMs: 500 },
    });
    expect(seen.at(-1)?.tab).toBe('tab-b');
    expect(seen.at(-1)?.payload).toEqual({
      id: 'save',
      request: { action: 'click', params: { label: 'Save' }, timeoutMs: 500 },
    });
  });
});

describe('per-user tab scoping over the Express adapter', () => {
  let seen: Seen[];
  let relay: CommandRelay;
  let call: Call;
  const servers: Server[] = [];

  beforeEach(async () => {
    seen = [];
    relay = twoUserRelay(seen);
    call = await expressCall(relay, servers);
  });

  afterEach(async () => {
    relay.destroy();
    await Promise.all(
      servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
    );
  });

  it('Express: without a caller identity a command goes to the primary tab', async () => {
    await call('GET', '/control/element/save/state', { caller: null });
    expect(seen.at(-1)?.tab).toBe('tab-a');
  });

  it('Express: POST /control/find reaches the caller own tab with its criteria', async () => {
    const res = await call('POST', '/control/find', { body: { text: 'Save', includeMedia: true } });
    expect(res.status).toBe(200);
    expect(seen.at(-1)?.tab).toBe('tab-b');
    expect(seen.at(-1)?.payload).toMatchObject({ text: 'Save', includeMedia: true });
  });

  it('Express: GET /control/snapshot with no query reaches the caller own tab', async () => {
    await call('GET', '/control/snapshot');
    expect(seen.at(-1)?.tab).toBe('tab-b');
  });

  it('Express: a query string cannot name the caller', async () => {
    await call('GET', '/control/element/save/state?callerUserId=user-a');
    expect(seen.at(-1)?.tab).toBe('tab-b');
  });

  it('Express: a body cannot name the caller on the named-intent route', async () => {
    await call('POST', '/control/intent/demo/execute', {
      body: { callerUserId: 'user-a', params: { size: 2 } },
    });
    expect(seen.at(-1)?.tab).toBe('tab-b');
    expect(seen.at(-1)?.payload).toEqual({ intentId: 'demo', params: { size: 2 } });
  });

  it('Express: a component action runs on the caller tab with clean params', async () => {
    await call('POST', '/control/component/save/action/click', {
      body: { params: { label: 'Save' }, timeoutMs: 500 },
    });
    expect(seen.at(-1)?.tab).toBe('tab-b');
    expect(seen.at(-1)?.payload).toEqual({
      id: 'save',
      request: { action: 'click', params: { label: 'Save' }, timeoutMs: 500 },
    });
  });
});

describe('per-user tab scoping over the standalone server', () => {
  let seen: Seen[];
  let relay: CommandRelay;
  let server: StandaloneServer;
  let call: Call;

  beforeEach(async () => {
    seen = [];
    relay = twoUserRelay(seen);
    server = await createStandaloneServer(createRelayHandlers(relay), {
      host: '127.0.0.1',
      port: 0,
      basePath: BASE,
      log: () => {},
    });
    const port = server.getAddress()!.port;
    call = async (method, path, options = {}) => {
      const init: RequestInit = { method, headers: headers(options.caller) };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      const response = await fetch(`http://127.0.0.1:${port}${BASE}${path}`, init);
      return { status: response.status, json: (await response.json()) as Record<string, unknown> };
    };
  });

  afterEach(async () => {
    relay.destroy();
    await server.stop();
  });

  it('standalone: without a caller identity a command goes to the primary tab', async () => {
    await call('GET', '/control/element/save/state', { caller: null });
    expect(seen.at(-1)?.tab).toBe('tab-a');
  });

  it('standalone: POST /control/find reaches the caller own tab with its criteria', async () => {
    await call('POST', '/control/find', { body: { text: 'Save', includeMedia: true } });
    expect(seen.at(-1)?.tab).toBe('tab-b');
    expect(seen.at(-1)?.payload).toMatchObject({ text: 'Save', includeMedia: true });
  });

  it('standalone: GET /control/snapshot with no query reaches the caller own tab', async () => {
    await call('GET', '/control/snapshot');
    expect(seen.at(-1)?.tab).toBe('tab-b');
  });

  it('standalone: a query string cannot name the caller', async () => {
    await call('GET', '/control/element/save/state?callerUserId=user-a');
    expect(seen.at(-1)?.tab).toBe('tab-b');
  });
});
