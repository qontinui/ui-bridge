/**
 * The standalone server survives hostile or awkward requests, and reads what
 * the client sent.
 *
 * - A malformed `Host` header used to throw outside every try block. The
 *   rejection was unhandled and Node exited.
 * - A multi-byte UTF-8 character split across two body chunks was decoded
 *   chunk by chunk, so `héllo` reached the handler as `h��llo`.
 * - Path params reached the handler percent-encoded (`form%20submit`), where
 *   Express decodes them.
 * - A body that was not JSON reached the handler as `{}`.
 * - `websocketPort` defaulted to 9876 rather than to `port`, so the WebSocket
 *   server bound a second listener instead of sharing the HTTP one.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { connect } from 'node:net';
import { WebSocket } from 'ws';
import { StandaloneServer } from './standalone';
import type { UIBridgeServerHandlers } from './types';

type Call = { handler: string; args: unknown[] };

function recordingHandlers(calls: Call[]): UIBridgeServerHandlers {
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        typeof name === 'string'
          ? async (...args: unknown[]) => {
              calls.push({ handler: name, args });
              return { success: true, data: null, timestamp: 0 };
            }
          : undefined,
    }
  ) as UIBridgeServerHandlers;
}

let server: StandaloneServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  lastRequestEnded = undefined;
});

/** Settles when the server has read the last request it received to its end. */
let lastRequestEnded: Promise<void> | undefined;

/**
 * Whether the server read the last request's upload to its end within `ms`:
 * a request it stopped reading (paused) never ends, and its connection never
 * goes idle.
 */
async function uploadReadOffWithin(ms: number): Promise<boolean> {
  const timedOut = new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));
  return Promise.race([lastRequestEnded!.then(() => true as const), timedOut]);
}

async function start(calls: Call[], config: Record<string, unknown> = {}) {
  server = new StandaloneServer(recordingHandlers(calls), {
    host: '127.0.0.1',
    port: 0,
    log: () => {},
    ...config,
  });
  await server.start();
  // The Node server the StandaloneServer listens with.
  const http = (server as unknown as { server: import('node:http').Server }).server;
  http.on('request', (req) => {
    lastRequestEnded = new Promise((resolve) => req.on('end', resolve));
  });
  const port = server.getAddress()!.port;
  return { port, base: `http://127.0.0.1:${port}/ui-bridge` };
}

/** Send raw bytes, one write per part, and resolve with the status code. */
function rawRequest(port: number, parts: Buffer[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let response = '';
    socket.on('data', (d) => (response += d.toString('latin1')));
    socket.on('error', reject);
    socket.on('close', () => resolve(Number(response.split(' ')[1])));
    socket.on('connect', async () => {
      for (const part of parts) {
        socket.write(part);
        await new Promise((r) => setTimeout(r, 20));
      }
    });
  });
}

describe('the standalone server stays up', () => {
  it('answers a request whose Host header is not a valid URL host', async () => {
    const { port, base } = await start([]);
    const status = await rawRequest(port, [
      Buffer.from('GET /health HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n'),
    ]);
    expect(status).toBe(200);
    // Still serving.
    expect((await fetch(`${base.replace('/ui-bridge', '')}/health`)).status).toBe(200);
  });
});

describe('the standalone server reads the request the client sent', () => {
  it('decodes a multi-byte character split across two body chunks', async () => {
    const calls: Call[] = [];
    const { port } = await start(calls);
    const body = Buffer.from(JSON.stringify({ action: 'type', params: { text: 'héllo' } }));
    const split = body.indexOf(Buffer.from('é')) + 1; // between the two bytes of é
    const head = Buffer.from(
      'POST /ui-bridge/control/element/e1/action HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
        `Content-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`
    );
    const status = await rawRequest(port, [head, body.subarray(0, split), body.subarray(split)]);
    expect(status).toBe(200);
    const call = calls.find((c) => c.handler === 'executeElementAction')!;
    expect((call.args[1] as { params: { text: string } }).params.text).toBe('héllo');
  });

  it('decodes path params, as Express does', async () => {
    const calls: Call[] = [];
    const { base } = await start(calls);
    const res = await fetch(`${base}/control/element/form%20submit`);
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.handler === 'getElement')!.args[0]).toBe('form submit');
  });

  it('refuses a malformed percent-escape in a path param with a 400', async () => {
    const calls: Call[] = [];
    const { base } = await start(calls);
    const res = await fetch(`${base}/control/element/%E0%A4%A`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('UB-VALIDATION-ERROR');
    expect(calls).toEqual([]);
  });

  it('refuses a body that is not JSON instead of handing the handler {}', async () => {
    const calls: Call[] = [];
    const { base } = await start(calls);
    const res = await fetch(`${base}/control/element/e1/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"action": "click"',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('UB-VALIDATION-ERROR');
    expect(calls).toEqual([]);
  });

  it('does not refuse a body declared as another type, as express.json() skips it', async () => {
    const calls: Call[] = [];
    const { base } = await start(calls);
    const res = await fetch(`${base}/control/element/e1/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.handler === 'executeElementAction')!.args[1]).toEqual({});
  });

  it('reads a request target starting with // as a path, not as a host', async () => {
    const calls: Call[] = [];
    const { port } = await start(calls);
    const status = await rawRequest(port, [
      Buffer.from(
        'GET //x/ui-bridge/control/element/e1 HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
      ),
    ]);
    expect(status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('answers OPTIONS * as a preflight', async () => {
    const { port } = await start([]);
    const status = await rawRequest(port, [
      Buffer.from('OPTIONS * HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'),
    ]);
    expect(status).toBe(204);
  });

  it('still reads an empty body as {}', async () => {
    const calls: Call[] = [];
    const { base } = await start(calls);
    const res = await fetch(`${base}/control/element/e1/action`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.handler === 'executeElementAction')!.args[1]).toEqual({});
  });

  it('refuses a body over the limit with a 413', async () => {
    const calls: Call[] = [];
    const { base } = await start(calls);
    const res = await fetch(`${base}/control/element/e1/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(10 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
    expect(res.headers.get('connection')).toBe('keep-alive');
    expect(calls).toEqual([]);
    expect(await uploadReadOffWithin(3000)).toBe(true);
  });

  it('answers a streamed over-limit body with a 413 rather than a reset', async () => {
    // The client is still uploading when the 413 is written. Closing the
    // connection then (`Connection: close`) was a TCP reset, which on Windows
    // lost the 413 to ECONNRESET; the server now discards the rest instead.
    const calls: Call[] = [];
    const { base } = await start(calls);
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > 10 * 1024 * 1024) controller.close();
        else {
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        }
      },
    });
    const res = await fetch(`${base}/control/element/e1/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(res.headers.get('connection')).toBe('keep-alive');
    expect(JSON.parse(await res.text())).toMatchObject({ error: 'Request body too large' });
    expect(calls).toEqual([]);
    // The rest of the upload is read off, so the connection can go idle.
    expect(await uploadReadOffWithin(3000)).toBe(true);
  });

  /**
   * A client that asked to close, and that does not read until it has sent
   * its whole over-limit upload: the 413 is only still there if the server
   * kept reading until the upload was done and then ended the connection
   * (FIN), rather than closing it, and so resetting it, mid-upload.
   */
  async function uploadThenRead(port: number, requestLine: string, extraHeaders: string) {
    const length = 15 * 1024 * 1024;
    const socket = connect(port, '127.0.0.1');
    socket.pause();
    let received = '';
    let error: string | undefined;
    socket.on('data', (d) => (received += d.toString('latin1')));
    socket.on('error', (e: NodeJS.ErrnoException) => (error = e.code));
    const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.write(
      `POST /ui-bridge/control/element/e1/action ${requestLine}\r\nHost: x\r\n${extraHeaders}` +
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
    return { received, error };
  }

  it('answers an HTTP/1.0 client with a 413 rather than a reset', async () => {
    // HTTP/1.0 cannot be chunked, so the 413 keeps its connection (and the
    // client its 413) only because it declares a Content-Length.
    const calls: Call[] = [];
    const { port } = await start(calls);
    const { received, error } = await uploadThenRead(port, 'HTTP/1.0', '');
    expect(received.split('\r\n')[0]).toBe('HTTP/1.1 413 Payload Too Large');
    expect(error).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('answers a Connection: close client with a 413 rather than a reset', async () => {
    const calls: Call[] = [];
    const { port } = await start(calls);
    const { received, error } = await uploadThenRead(port, 'HTTP/1.1', 'Connection: close\r\n');
    expect(received.split('\r\n')[0]).toBe('HTTP/1.1 413 Payload Too Large');
    expect(error).toBeUndefined();
    expect(calls).toEqual([]);
  });
});

describe('a request pipelined behind a refused upload', () => {
  it('is not dispatched, and the 413 is still received', async () => {
    // A request behind an over-limit upload arrives on a connection
    // discardRest has ended (or decided to end). Node still parses and dispatches it, so
    // without the guard its handler ran and its response was lost.
    const calls: Call[] = [];
    const { port } = await start(calls);
    let requests = 0;
    (server as unknown as { server: import('node:http').Server }).server.on(
      'request',
      () => (requests += 1)
    );

    // Past the limit plus the read-off cap, plus 1 MiB, so the bytes still to
    // come after the refusal are past the cap whatever chunk tripped it: the
    // connection is ended at once. The whole body is sent, then a GET.
    const declared = 30 * 1024 * 1024 + 1024 * 1024 + 1;
    const socket = connect(port, '127.0.0.1');
    let response = '';
    socket.on('data', (d) => (response += d.toString('latin1')));
    socket.on('error', () => undefined);
    const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
    socket.write(
      'POST /ui-bridge/control/element/e1/action HTTP/1.1\r\nHost: x\r\n' +
        `Content-Type: application/json\r\nContent-Length: ${declared}\r\n\r\n`
    );
    socket.write(Buffer.alloc(declared, 0x78));
    socket.write('GET /ui-bridge/control/elements HTTP/1.1\r\nHost: x\r\n\r\n');

    // Node did hand the pipelined GET to the server: the guard, not the
    // parser, is what keeps its handler from running.
    await expect.poll(() => requests, { timeout: 5000 }).toBe(2);
    await closed;
    expect(response.startsWith('HTTP/1.1 413')).toBe(true);
    expect(response.match(/HTTP\/1\.1 /g)).toHaveLength(1);
    expect(calls).toEqual([]);
  });
});

describe('websocketPort defaults to port', () => {
  it('serves the WebSocket on the HTTP listener when websocketPort is not set', async () => {
    const { port } = await start([], { websocket: true });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const first = await new Promise<string>((resolve, reject) => {
      ws.on('message', (data) => resolve(data.toString()));
      ws.on('error', reject);
    });
    ws.close();
    expect(JSON.parse(first).type).toBe('welcome');
  });
});

describe('a handler result that stringifies to undefined', () => {
  it('is answered 200 with an empty body and a Content-Length of 0', async () => {
    // A function stringifies to undefined; sendJSON must still declare a
    // length (Buffer.byteLength(undefined) throws), and not turn it into a 500.
    server = new StandaloneServer(
      {
        executeElementAction: async () => () => undefined,
      } as unknown as UIBridgeServerHandlers,
      { host: '127.0.0.1', port: 0, log: () => {} }
    );
    await server.start();
    const port = server.getAddress()!.port;
    const response = await fetch(`http://127.0.0.1:${port}/ui-bridge/control/element/e1/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('0');
    expect(await response.text()).toBe('');
  });
});
