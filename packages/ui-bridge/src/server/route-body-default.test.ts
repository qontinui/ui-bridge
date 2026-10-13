/**
 * A route that takes a body hands its handler an object even when the
 * request carries none, through every adapter.
 *
 * Handlers read fields off their request (`request.label`, `request.text`),
 * so an `undefined` body throws inside the handler. The Next.js adapter
 * synthesizes `{}` for a missing or unparseable body and the standalone
 * server starts from `{}`; Express leaves `req.body` undefined, so its
 * adapter supplies the object itself. Every `bodyRequired` route is checked,
 * from the route table.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createNextRouteHandlers } from './nextjs';
import { createExpressApp } from './express';
import { createStandaloneServer, type StandaloneServer } from './standalone';
import { UI_BRIDGE_ROUTES, type UIBridgeServerHandlers } from './types';

const BASE = '/api/ui-bridge';
const BODY_ROUTES = UI_BRIDGE_ROUTES.filter((route) => route.bodyRequired);

/** route handler name -> the arguments its stub last received. */
let received: Map<string, unknown[]>;

function stubHandlers(): UIBridgeServerHandlers {
  const stubs: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const route of BODY_ROUTES) {
    stubs[route.handler] = async (...args: unknown[]) => {
      received.set(route.handler, args);
      return { success: true, data: null, timestamp: 0 };
    };
  }
  return stubs as unknown as UIBridgeServerHandlers;
}

const concretePath = (path: string) => path.replace(/:[A-Za-z]+/g, 'p1');

/** The payload slot: the argument after the route's URL params. */
function payloadOf(route: (typeof BODY_ROUTES)[number]): unknown {
  return received.get(route.handler)?.[route.params?.length ?? 0];
}

function expectObjectPayloads() {
  const problems = BODY_ROUTES.filter((route) => {
    const payload = payloadOf(route);
    return payload === null || typeof payload !== 'object';
  }).map((route) => `${route.method} ${route.path} -> ${route.handler}`);
  expect(problems).toEqual([]);
}

it('checks a real set of routes', () => {
  expect(BODY_ROUTES.length).toBeGreaterThan(50);
});

describe('a body route with no body still gets an object', () => {
  beforeEach(() => {
    received = new Map();
  });

  it('through the Next.js adapter', async () => {
    const routes = createNextRouteHandlers(stubHandlers());
    for (const route of BODY_ROUTES) {
      const url = `http://app.test${BASE}${concretePath(route.path)}`;
      const nextUrl = new URL(url);
      const request = Object.assign(new Request(url, { method: route.method }), { nextUrl });
      const method = route.method as 'POST' | 'PUT';
      await routes[method](request, { params: { path: nextUrl.pathname.slice(BASE.length + 1) } });
    }
    expectObjectPayloads();
  });

  describe('over HTTP', () => {
    let server: Server | undefined;
    let standalone: StandaloneServer | undefined;

    afterEach(async () => {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      if (standalone) await standalone.stop();
      server = undefined;
      standalone = undefined;
    });

    async function sendAll(port: number) {
      for (const route of BODY_ROUTES) {
        const response = await fetch(`http://127.0.0.1:${port}${BASE}${concretePath(route.path)}`, {
          method: route.method,
        });
        await response.text();
      }
    }

    it('through the Express adapter', async () => {
      const app = createExpressApp(stubHandlers(), { basePath: BASE }) as Parameters<
        typeof createServer
      >[1];
      server = createServer(app);
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      await sendAll((server.address() as AddressInfo).port);
      expectObjectPayloads();
    });

    it('through the standalone server', async () => {
      standalone = await createStandaloneServer(stubHandlers(), {
        host: '127.0.0.1',
        port: 0,
        basePath: BASE,
        log: () => {},
      });
      await sendAll(standalone.getAddress()!.port);
      expectObjectPayloads();
    });
  });
});
