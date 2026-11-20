/**
 * The Express adapter reads a request body up to the same 10 MB the
 * standalone server and the Next.js adapter read to.
 *
 * Express's own `express.json()` default is 100 KB, so before the adapter
 * passed `MAX_BODY_BYTES` a body between 100 KB and 10 MB was a 413 through
 * Express and accepted everywhere else. The adapter now reads a body by the
 * standalone server's rules, and a refused body is answered with the JSON
 * envelope, not Express's default HTML error page.
 *
 * An over-limit body is answered 413 while the client may still be uploading.
 * The adapter used to send `Connection: close` with it, and Node's close with
 * request bytes still unread was a TCP reset, which on Windows destroyed the
 * 413 before `fetch` read it (`ECONNRESET`). The 413 tests therefore assert
 * the connection is kept (`keep-alive`) and the rest of the upload is read
 * off to its end: a forced close fails the first, a paused, never-drained
 * request the second, on every OS.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { createExpressApp, createExpressRouter } from './express';
import { DISCARD_MAX_BYTES, MAX_BODY_BYTES } from './request-body';
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
  if (server) {
    const closed = new Promise<void>((resolve) => server!.close(() => resolve()));
    // A kept-alive connection would otherwise hold close() until it times out.
    server.closeAllConnections();
    await closed;
  }
  server = undefined;
  lastRequestEnded = undefined;
  received = undefined;
});

/** Settles when the server has read the last request it received to its end. */
let lastRequestEnded: Promise<void> | undefined;

/**
 * Whether the server read the last request's upload to its end within `ms`.
 * A request the server stops reading (paused) never ends, and neither does
 * one whose connection was closed under it; only then is the connection
 * reusable rather than stuck or reset.
 */
async function uploadReadOffWithin(ms: number): Promise<boolean> {
  const timedOut = new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));
  return Promise.race([lastRequestEnded!.then(() => true as const), timedOut]);
}

async function listen(app: Parameters<typeof createServer>[1]): Promise<number> {
  server = createServer(app);
  server.on('request', (req) => {
    lastRequestEnded = new Promise((resolve) => req.on('end', resolve));
  });
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

/**
 * Whether the server reads a declared over-limit upload off to its end
 * within `ms`, driven by a raw socket that always sends the whole body.
 *
 * `fetch` cannot answer this on every OS: on Linux undici stops uploading
 * and closes the socket as soon as the 413 arrives, so the request never
 * ends whatever the server does, while on Windows it keeps sending. A raw
 * client sends every byte, so the request ends only if the server keeps
 * reading: a request stopped after reading began, or a connection closed
 * under the upload, still fails this. (A request nobody began reading is
 * drained by Node itself once its response finishes, so it passes.)
 * The raw request must also be answered 413.
 */
async function rawUploadReadOffWithin(port: number, length: number, ms: number): Promise<boolean> {
  const ended = new Promise<true>((resolve) =>
    server!.once('request', (req) => req.on('end', () => resolve(true)))
  );
  const socket = connect(port, '127.0.0.1');
  let answer = '';
  const answered = new Promise<true>((resolve) =>
    socket.on('data', (d) => {
      answer += d.toString('latin1');
      if (answer.includes('\r\n')) resolve(true);
    })
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  // Writes after the final destroy below are absorbed here.
  socket.on('error', () => {});
  socket.write(
    `POST ${PATH} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${length}\r\n\r\n`
  );
  const chunk = Buffer.alloc(64 * 1024, 0x78);
  void (async () => {
    for (let sent = 0; sent < length && socket.writable; sent += chunk.length) {
      if (!socket.write(chunk.subarray(0, Math.min(chunk.length, length - sent)))) {
        await new Promise<void>((resolve) => {
          const done = () => {
            socket.off('drain', done);
            socket.off('close', done);
            resolve();
          };
          socket.once('drain', done);
          socket.once('close', done);
        });
      }
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  // Both, within `ms`: the server read the upload to its end, and the raw
  // request's own status line arrived (it can trail the request's 'end').
  const readOff = await Promise.race([Promise.all([ended, answered]).then(() => true), timedOut]);
  clearTimeout(timer);
  socket.destroy();
  return readOff && answer.split('\r\n')[0] === 'HTTP/1.1 413 Payload Too Large';
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
    expect(response.connection).toBe('keep-alive');
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      error: 'Request body too large',
      code: 'UB-VALIDATION-ERROR',
    });
    expect(received).toBeUndefined();
    expect(await rawUploadReadOffWithin(port, MAX_BODY_BYTES + 1, 3000)).toBe(true);
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
    expect(response.headers.get('connection')).toBe('keep-alive');
    expect(JSON.parse(await response.text())).toMatchObject({ error: 'Request body too large' });
    expect(received).toBeUndefined();
    expect(await uploadReadOffWithin(3000)).toBe(true);
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

  it('hands an empty JSON POST to the handler as {}', async () => {
    const port = await start();
    expect((await post(port, '')).status).toBe(200);
    expect(received?.[1]).toEqual({});
  });
});

/** The request as a host middleware sees it. */
type HostReq = NodeJS.ReadableStream & { body?: unknown; _body?: boolean };

/*
 * The same over-limit refusal against each entry point called directly, so
 * the body-limit path is reached through the call a host makes rather than
 * through the table above.
 */
describe('a 413 keeps the connection, called through each Express entry point', () => {
  it('createExpressApp answers an over-limit body with a keep-alive 413 and reads the upload off', async () => {
    const port = await listen(createExpressApp(handlers) as Parameters<typeof createServer>[1]);
    const response = await post(port, bodyOf(MAX_BODY_BYTES + 1));
    expect(response.status).toBe(413);
    expect(response.connection).toBe('keep-alive');
    expect(received).toBeUndefined();
    expect(await rawUploadReadOffWithin(port, MAX_BODY_BYTES + 1, 3000)).toBe(true);
  });

  it('createExpressRouter answers an over-limit body with a keep-alive 413 and reads the upload off', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const express = require('express');
    const app = express();
    app.use(BASE, createExpressRouter(handlers, { useBodyParser: true }));
    const port = await listen(app);
    const response = await post(port, bodyOf(MAX_BODY_BYTES + 1));
    expect(response.status).toBe(413);
    expect(response.connection).toBe('keep-alive');
    expect(received).toBeUndefined();
    expect(await rawUploadReadOffWithin(port, MAX_BODY_BYTES + 1, 3000)).toBe(true);
  });
});

/*
 * A request pipelined behind an over-limit upload arrives on a connection
 * discardRest has ended (or decided to end). Node still parses and dispatches it, so
 * without the adapter's guard its handler ran (side effects included) and
 * its response was lost on the ended socket.
 */
describe.each([
  [
    'createExpressApp',
    (h: UIBridgeServerHandlers) =>
      listen(createExpressApp(h) as Parameters<typeof createServer>[1]),
  ],
  [
    'createExpressRouter({ useBodyParser: true })',
    (h: UIBridgeServerHandlers) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const express = require('express');
      const app = express();
      app.use(BASE, createExpressRouter(h, { useBodyParser: true }));
      return listen(app);
    },
  ],
])('a request pipelined behind a refused upload (%s)', (_name, start) => {
  it('is not dispatched, and the 413 is still received', async () => {
    let gets = 0;
    const counting = {
      ...handlers,
      getElements: async () => {
        gets += 1;
        return { success: true, data: [], timestamp: 0 };
      },
    } as unknown as UIBridgeServerHandlers;
    const port = await start(counting);
    let requests = 0;
    server!.on('request', () => (requests += 1));

    // Declared past the read-off cap, so the 413 ends the connection at once;
    // the whole body is still sent, then a GET right behind it.
    const declared = DISCARD_MAX_BYTES + 1;
    const socket = connect(port, '127.0.0.1');
    let response = '';
    socket.on('data', (d) => (response += d.toString('latin1')));
    socket.on('error', () => undefined);
    const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
    socket.write(
      `POST ${PATH} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${declared}\r\n\r\n`
    );
    socket.write(Buffer.alloc(declared, 0x78));
    socket.write(`GET ${BASE}/control/elements HTTP/1.1\r\nHost: x\r\n\r\n`);

    // Node did hand the pipelined GET to the app: the guard, not the parser,
    // is what keeps its handler from running.
    await expect.poll(() => requests, { timeout: 5000 }).toBe(2);
    await closed;
    expect(response.startsWith('HTTP/1.1 413')).toBe(true);
    expect(response.match(/HTTP\/1\.1 /g)).toHaveLength(1);
    expect(gets).toBe(0);
  });
});

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

/*
 * An HTTP/1.0 client, and one sending `Connection: close`, that read only
 * after sending the whole over-limit upload. HTTP/1.0 cannot be chunked, so
 * the 413 keeps its connection (and the client its 413) only because
 * `res.json` declares a Content-Length; this pins that dependency.
 *
 * The 413 says `Connection: keep-alive` even to a client that asked to close.
 * That is deliberate: a `close` response makes Node end the socket mid-upload,
 * which is the reset this file exists to prevent. The server still closes the
 * connection itself once the upload is read off (see `discardRest`).
 */
describe('a 413 reaches a client that asked to close, through each Express entry point', () => {
  async function uploadThenRead(port: number, requestLine: string, extraHeaders: string) {
    const length = 15 * 1024 * 1024;
    const socket = connect(port, '127.0.0.1');
    socket.pause();
    let text = '';
    let error: string | undefined;
    socket.on('data', (d) => (text += d.toString('latin1')));
    socket.on('error', (e: NodeJS.ErrnoException) => (error = e.code));
    const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.write(
      `POST ${PATH} ${requestLine}\r\nHost: x\r\n${extraHeaders}` +
        `Content-Type: application/json\r\nContent-Length: ${length}\r\n\r\n`
    );
    const chunk = Buffer.alloc(64 * 1024, 0x78);
    for (let sent = 0; sent < length && socket.writable; sent += chunk.length) {
      if (!socket.write(chunk.subarray(0, Math.min(chunk.length, length - sent)))) {
        await new Promise<void>((resolve) => {
          const done = () => {
            socket.off('drain', done);
            socket.off('close', done);
            resolve();
          };
          socket.once('drain', done);
          socket.once('close', done);
        });
      }
    }
    socket.resume();
    await closed;
    return { text, error };
  }

  const entryPoints: Array<[string, () => Parameters<typeof createServer>[1]]> = [
    ['createExpressApp', () => createExpressApp(handlers) as Parameters<typeof createServer>[1]],
    [
      'createExpressRouter',
      () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const express = require('express');
        const app = express();
        app.use(BASE, createExpressRouter(handlers, { useBodyParser: true }));
        return app;
      },
    ],
  ];

  for (const [name, build] of entryPoints) {
    it(`${name} answers an HTTP/1.0 client with a 413 rather than a reset`, async () => {
      const port = await listen(build());
      const { text, error } = await uploadThenRead(port, 'HTTP/1.0', '');
      expect(text.split('\r\n')[0]).toBe('HTTP/1.1 413 Payload Too Large');
      expect(error).toBeUndefined();
      expect(received).toBeUndefined();
    });

    it(`${name} answers a Connection: close client with a 413 rather than a reset`, async () => {
      const port = await listen(build());
      const { text, error } = await uploadThenRead(port, 'HTTP/1.1', 'Connection: close\r\n');
      expect(text.split('\r\n')[0]).toBe('HTTP/1.1 413 Payload Too Large');
      expect(error).toBeUndefined();
      expect(received).toBeUndefined();
    });
  }
});
