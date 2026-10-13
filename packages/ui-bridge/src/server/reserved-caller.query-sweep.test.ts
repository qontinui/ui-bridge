/**
 * Every route that hands its handler the query object, through every
 * adapter: no `__callerUserId` from the query string reaches the handler,
 * however it is spelled, and the verified context follows the query.
 *
 * The spellings: a repeated key, a percent-encoded key, and, under Express's
 * extended query parser, the bracket forms `request[__callerUserId]` (a
 * nested object) and `__callerUserId[]` (an array). The routes come from the
 * route table, so a new query route is covered when it is added.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createNextRouteHandlers } from './nextjs';
import { createExpressApp, createExpressRouter } from './express';
import { createStandaloneServer, type StandaloneServer } from './standalone';
import { UI_BRIDGE_ROUTES, type UIBridgeServerHandlers } from './types';

const BASE = '/api/ui-bridge';
const QUERY_ROUTES = UI_BRIDGE_ROUTES.filter((route) => route.queryRequired);
const FLAT = 'keep=1&__callerUserId=user-a&__callerUserId=user-c&%5F%5FcallerUserId=user-d';
const BRACKETS = 'request%5B__callerUserId%5D=user-e&__callerUserId%5B%5D=user-f';

/** route handler name -> the arguments its stub last received. */
let received: Map<string, unknown[]>;

function stubHandlers(): UIBridgeServerHandlers {
  const stubs: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const route of QUERY_ROUTES) {
    stubs[route.handler] = async (...args: unknown[]) => {
      received.set(route.handler, args);
      return { success: true, data: null, timestamp: 0 };
    };
  }
  return stubs as unknown as UIBridgeServerHandlers;
}

const concretePath = (path: string) => path.replace(/:[A-Za-z]+/g, 'p1');

/** Every exact `__callerUserId` key in `value`, at any depth: the only spelling the relay reads. */
function reservedKeys(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  return Object.entries(value).reduce(
    (n, [key, item]) => n + (key === '__callerUserId' ? 1 : 0) + reservedKeys(item),
    0
  );
}

function problemsIn(): string[] {
  const problems: string[] = [];
  for (const route of QUERY_ROUTES) {
    const args = received.get(route.handler);
    const at = route.params?.length ?? 0;
    const where = `GET ${route.path} -> ${route.handler}`;
    if (!args) {
      problems.push(`${where}: never called`);
      continue;
    }
    const query = JSON.stringify(args[at]);
    if (reservedKeys(args[at]) > 0 || /user-[acd]/.test(query)) {
      problems.push(`${where}: query ${query}`);
    }
    if ((args[at] as { keep?: unknown })?.keep !== '1')
      problems.push(`${where}: lost a plain parameter`);
    if (JSON.stringify(args[at + 1]) !== JSON.stringify({ callerUserId: 'user-b' })) {
      problems.push(`${where}: context ${JSON.stringify(args[at + 1])}`);
    }
  }
  return problems;
}

it('checks a real set of query routes', () => {
  expect(QUERY_ROUTES.length).toBeGreaterThan(20);
});

describe('a query cannot carry the reserved key to any query route', () => {
  let server: Server | undefined;
  let standalone: StandaloneServer | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (standalone) await standalone.stop();
    server = undefined;
    standalone = undefined;
  });

  async function sendAll(port: number, query: string) {
    for (const route of QUERY_ROUTES) {
      const response = await fetch(
        `http://127.0.0.1:${port}${BASE}${concretePath(route.path)}?${query}`,
        { headers: { 'X-Caller-User-Id': 'user-b' } }
      );
      await response.text();
    }
  }

  it('through the Next.js adapter', async () => {
    received = new Map();
    const routes = createNextRouteHandlers(stubHandlers());
    for (const route of QUERY_ROUTES) {
      const url = `http://app.test${BASE}${concretePath(route.path)}?${FLAT}`;
      const nextUrl = new URL(url);
      const request = Object.assign(
        new Request(url, { headers: { 'X-Caller-User-Id': 'user-b' } }),
        { nextUrl }
      );
      await routes.GET(request, { params: { path: nextUrl.pathname.slice(BASE.length + 1) } });
    }
    expect(problemsIn()).toEqual([]);
  });

  it('through the Express adapter, bracket forms included', async () => {
    received = new Map();
    const app = createExpressApp(stubHandlers(), { basePath: BASE }) as Parameters<
      typeof createServer
    >[1];
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    await sendAll((server.address() as AddressInfo).port, `${FLAT}&${BRACKETS}`);
    expect(problemsIn()).toEqual([]);
  });

  it('through an Express app on the extended query parser, where brackets nest', async () => {
    received = new Map();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const express = require('express');
    const app = express();
    app.set('query parser', 'extended');
    app.use(BASE, createExpressRouter(stubHandlers()));
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    await sendAll((server.address() as AddressInfo).port, `${FLAT}&${BRACKETS}`);
    expect(problemsIn()).toEqual([]);
  });

  it('through the standalone server', async () => {
    received = new Map();
    standalone = await createStandaloneServer(stubHandlers(), {
      host: '127.0.0.1',
      port: 0,
      basePath: BASE,
      log: () => {},
    });
    await sendAll(standalone.getAddress()!.port, FLAT);
    expect(problemsIn()).toEqual([]);
  });
});
