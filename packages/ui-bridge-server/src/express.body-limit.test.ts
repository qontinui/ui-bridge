/**
 * The Express adapter reads a request body up to the same 10 MB the
 * standalone server and the Next.js adapter read to.
 *
 * Express's own `express.json()` default is 100 KB, so before the adapter
 * passed `MAX_BODY_BYTES` a body between 100 KB and 10 MB was a 413 through
 * Express and accepted everywhere else. The adapter now reads a body by the
 * standalone server's rules, and a refused body is answered with the JSON
 * envelope, not Express's default HTML error page.
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
): Promise<{ status: number; body: string; connection: string | null }> {
  const response = await fetch(`http://127.0.0.1:${port}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
  return {
    status: response.status,
    body: await response.text(),
    connection: response.headers.get('connection'),
  };
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
    expect(response.connection).toBe('close');
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

  it('reads a whitespace-only JSON body as no body', async () => {
    const port = await start();
    expect((await post(port, '   \n')).status).toBe(200);
    expect(received?.[1]).toEqual({});
  });

  it('parses a +json body', async () => {
    const port = await start();
    const body = JSON.stringify({ action: 'click' });
    expect((await post(port, body, 'application/vnd.test+json')).status).toBe(200);
    expect(received?.[1]).toMatchObject({ action: 'click' });
  });

  it('reads an unparseable body declared as another type as no body', async () => {
    const port = await start();
    expect((await post(port, 'not json', 'text/plain')).status).toBe(200);
    expect(received?.[1]).toEqual({});
  });

  it('refuses an over-limit body sent without a Content-Length', async () => {
    const port = await start();
    const chunk = new TextEncoder().encode('x'.repeat(1024 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_BODY_BYTES) controller.close();
        else {
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        }
      },
    });
    const response = await fetch(`http://127.0.0.1:${port}${PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(JSON.parse(await response.text())).toMatchObject({ error: 'Request body too large' });
    expect(received).toBeUndefined();
  });

  it('hands an empty JSON POST to the handler as {}', async () => {
    const port = await start();
    expect((await post(port, '')).status).toBe(200);
    expect(received?.[1]).toEqual({});
  });
  it('refuses an unparseable body with no Content-Type with a JSON 400', async () => {
    const port = await start();
    const response = await fetch(`http://127.0.0.1:${port}${PATH}`, {
      method: 'POST',
      body: new TextEncoder().encode('{"action": '),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(await response.text())).toMatchObject({
      error: 'Request body is not valid JSON',
    });
    expect(received).toBeUndefined();
  });
});

/** The request as a host middleware sees it. */
type HostReq = NodeJS.ReadableStream & { body?: unknown; _body?: boolean };

describe('a body a host parser already handled', () => {
  async function hostApp(
    host: (req: HostReq, res: unknown, next: () => void) => void
  ): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const express = require('express');
    const app = express();
    app.use(host);
    app.use(BASE, createExpressRouter(handlers, { useBodyParser: true }));
    return listen(app);
  }

  it('is left alone when the host parser set req.body', async () => {
    // The host marks the body read without draining the stream, so only the
    // `_body` check keeps the adapter from reading it again.
    const port = await hostApp((req, _res, next) => {
      req.body = { action: 'from-host' };
      req._body = true;
      next();
    });
    expect((await post(port, '{"action":"from-client"}')).status).toBe(200);
    expect(received?.[1]).toMatchObject({ action: 'from-host' });
  });

  it('does not hang when the host paused the stream', async () => {
    const port = await hostApp((req, _res, next) => {
      req.pause();
      next();
    });
    expect((await post(port, '{"action":"click"}')).status).toBe(200);
    expect(received?.[1]).toMatchObject({ action: 'click' });
  });

  it('does not hang when the host consumed the stream without marking it', async () => {
    const port = await hostApp((req, _res, next) => {
      req.on('data', () => undefined);
      req.on('end', () => next());
    });
    expect((await post(port, '{"action":"click"}')).status).toBe(200);
    expect(received?.[1]).toEqual({});
  });
});
