/**
 * The adapters never hand a handler a request-supplied `__callerUserId`.
 *
 * Each adapter strips the reserved key from the body and the query it builds,
 * then splices in the verified identity (`X-Caller-User-Id`) where the route
 * takes a body. These tests read the arguments a stub handler receives, so
 * they observe the adapter boundary alone; `route-scoping.test.ts` covers the
 * relay's own ranking of the context above a payload identity.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RESERVED_CALLER_KEY, withoutReservedCaller } from './reserved-caller';
import { createNextRouteHandlers } from './nextjs';
import { createExpressApp } from './express';
import { createStandaloneServer, type StandaloneServer } from './standalone';
import type { UIBridgeServerHandlers } from './types';

describe('withoutReservedCaller', () => {
  it('drops the key and keeps every other field, without mutating its input', () => {
    const body = { text: 'Save', [RESERVED_CALLER_KEY]: 'user-a' };
    expect(withoutReservedCaller(body)).toEqual({ text: 'Save' });
    expect(body).toEqual({ text: 'Save', __callerUserId: 'user-a' });
  });

  it('returns the same object when the key is absent', () => {
    const body = { text: 'Save' };
    expect(withoutReservedCaller(body)).toBe(body);
  });

  it('passes a primitive, or a value without the key, through unchanged', () => {
    expect(withoutReservedCaller(null)).toBeNull();
    expect(withoutReservedCaller('text')).toBe('text');
    const clean = { request: { action: 'click' }, list: [{ id: 1 }] };
    expect(withoutReservedCaller(clean)).toBe(clean);
  });

  it('drops the key at every depth, inside arrays too', () => {
    expect(
      withoutReservedCaller({
        request: { action: 'click', __callerUserId: 'user-a' },
        params: { inner: { __callerUserId: 'user-a', keep: 1 } },
        list: [{ __callerUserId: 'user-a', id: 1 }, 'text'],
      })
    ).toEqual({
      request: { action: 'click' },
      params: { inner: { keep: 1 } },
      list: [{ id: 1 }, 'text'],
    });
    expect(withoutReservedCaller([{ __callerUserId: 'user-a' }])).toEqual([{}]);
  });

  it('keeps an own __proto__ key an own property, never a prototype', () => {
    const body = JSON.parse('{"__proto__":{"__callerUserId":"user-a"},"text":"x"}') as Record<
      string,
      unknown
    >;
    const out = withoutReservedCaller(body) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(out.__callerUserId).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
  });
});

/** Arguments each stub handler was called with, in order. */
let received: unknown[][];

function stubHandlers(): Partial<UIBridgeServerHandlers> {
  const record = async (...args: unknown[]) => {
    received.push(args);
    return { success: true as const, data: null, timestamp: 0 };
  };
  return {
    getControlSnapshot: record as never,
    find: record as never,
  };
}

const BASE = '/api/ui-bridge';

type Call = (
  method: 'GET' | 'POST',
  path: string,
  options?: { body?: unknown; caller?: string }
) => Promise<void>;

function init(method: string, options: { body?: unknown; caller?: string }): RequestInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.caller) headers['X-Caller-User-Id'] = options.caller;
  return {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  };
}

/** The same four checks, through whichever adapter `call` drives. */
function boundaryChecks(adapter: string, getCall: () => Call) {
  it(`${adapter}: a GET query loses the key and the verified context follows it`, async () => {
    await getCall()('GET', '/control/snapshot?recency=any&__callerUserId=user-a', {
      caller: 'user-b',
    });
    expect(received.at(-1)).toEqual([{ recency: 'any' }, { callerUserId: 'user-b' }]);
  });

  it(`${adapter}: a body's key is replaced by the verified identity`, async () => {
    await getCall()('POST', '/control/find', {
      body: { text: 'Save', __callerUserId: 'user-a' },
      caller: 'user-b',
    });
    expect(received.at(-1)?.[0]).toEqual({ text: 'Save', __callerUserId: 'user-b' });
  });

  it(`${adapter}: with no verified identity, a body's key is dropped`, async () => {
    await getCall()('POST', '/control/find', { body: { text: 'Save', __callerUserId: 'user-a' } });
    expect(received.at(-1)?.[0]).toEqual({ text: 'Save' });
  });

  it(`${adapter}: with no verified identity, a query's key is dropped`, async () => {
    await getCall()('GET', '/control/snapshot?__callerUserId=user-a');
    expect(received.at(-1)?.[0]).toEqual({});
  });
}

describe('the Next.js adapter strips the reserved key', () => {
  let call: Call;
  beforeEach(() => {
    received = [];
    const routes = createNextRouteHandlers(stubHandlers());
    call = async (method, path, options = {}) => {
      const url = `http://app.test${BASE}${path}`;
      const nextUrl = new URL(url);
      const request = Object.assign(new Request(url, init(method, options)), { nextUrl });
      await routes[method](request, { params: { path: nextUrl.pathname.slice(BASE.length + 1) } });
    };
  });
  boundaryChecks('Next.js', () => call);
});

describe('the Express adapter strips the reserved key', () => {
  let call: Call;
  let server: Server;
  beforeEach(async () => {
    received = [];
    const app = createExpressApp(stubHandlers() as UIBridgeServerHandlers, {
      basePath: BASE,
    }) as Parameters<typeof createServer>[1];
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    call = async (method, path, options = {}) => {
      await (await fetch(`http://127.0.0.1:${port}${BASE}${path}`, init(method, options))).text();
    };
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  boundaryChecks('Express', () => call);
});

describe('the standalone server strips the reserved key', () => {
  let call: Call;
  let server: StandaloneServer;
  beforeEach(async () => {
    received = [];
    server = await createStandaloneServer(stubHandlers() as UIBridgeServerHandlers, {
      host: '127.0.0.1',
      port: 0,
      basePath: BASE,
      log: () => {},
    });
    const port = server.getAddress()!.port;
    call = async (method, path, options = {}) => {
      await (await fetch(`http://127.0.0.1:${port}${BASE}${path}`, init(method, options))).text();
    };
  });
  afterEach(async () => {
    await server.stop();
  });
  boundaryChecks('standalone', () => call);
});
