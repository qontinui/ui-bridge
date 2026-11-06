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
});

async function start(calls: Call[], config: Record<string, unknown> = {}) {
  server = new StandaloneServer(recordingHandlers(calls), {
    host: '127.0.0.1',
    port: 0,
    log: () => {},
    ...config,
  });
  await server.start();
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
    expect((await res.json()).code).toBe('UB-VALIDATION-ERROR');
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
    expect((await res.json()).code).toBe('UB-VALIDATION-ERROR');
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
