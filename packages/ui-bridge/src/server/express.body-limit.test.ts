/**
 * The Express adapter reads a request body up to the same 10 MB the
 * standalone server and the Next.js adapter read to.
 *
 * Express's own `express.json()` default is 100 KB, so before the adapter
 * passed `MAX_BODY_BYTES` a body between 100 KB and 10 MB was a 413 through
 * Express and accepted everywhere else. A refused body is answered with the
 * JSON envelope, not Express's default HTML error page.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createExpressApp, createExpressRouter } from './express';
import { MAX_BODY_BYTES } from './request-body';
import type { UIBridgeServerHandlers } from './types';

const BASE = '/ui-bridge';
const PATH = `${BASE}/control/element/el1/action`;

let received: unknown[] | undefined;
const handlers = {
  executeElementAction: async (...args: unknown[]) => {
    received = args;
    return { success: true, data: null, timestamp: 0 };
  },
} as unknown as UIBridgeServerHandlers;

/** A JSON body of about `bytes` bytes. */
const bodyOf = (bytes: number) => JSON.stringify({ action: 'type', text: 'x'.repeat(bytes) });

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  received = undefined;
});

async function listen(app: Parameters<typeof createServer>[1]): Promise<number> {
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function post(
  port: number,
  body: string,
  contentType = 'application/json'
): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
  return { status: response.status, body: await response.text() };
}

/** createExpressRouter with its own body parser, mounted on a bare app. */
async function routerApp(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  const app = express();
  app.use(BASE, createExpressRouter(handlers, { useBodyParser: true }));
  return listen(app);
}

describe.each([
  [
    'createExpressApp',
    () => listen(createExpressApp(handlers) as Parameters<typeof createServer>[1]),
  ],
  ['createExpressRouter({ useBodyParser: true })', routerApp],
])('the Express adapter body limit (%s)', (_name, start) => {
  it('accepts a 1 MB body, past Express’s 100 KB default', async () => {
    const port = await start();
    expect((await post(port, bodyOf(1024 * 1024))).status).toBe(200);
    expect((received?.[1] as { text: string }).text).toHaveLength(1024 * 1024);
  });

  it('refuses a body over 10 MB with a 413 before any handler runs', async () => {
    const port = await start();
    const response = await post(port, bodyOf(MAX_BODY_BYTES + 1));
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: 'Request body too large',
      code: 'UB-VALIDATION-ERROR',
    });
    expect(received).toBeUndefined();
  });

  it('refuses a malformed JSON body with a JSON 400, not an HTML page', async () => {
    const port = await start();
    const response = await post(port, '{"action": ');
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: 'Request body is not valid JSON',
      code: 'UB-VALIDATION-ERROR',
    });
    expect(received).toBeUndefined();
  });
  it('answers an unsupported charset with a JSON 415', async () => {
    const port = await start();
    const response = await post(port, '{}', 'application/json; charset=koi8-r');
    expect(response.status).toBe(415);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      code: 'UB-VALIDATION-ERROR',
    });
    expect(received).toBeUndefined();
  });
});
