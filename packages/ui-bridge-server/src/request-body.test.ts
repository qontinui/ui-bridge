import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createServer,
  IncomingMessage,
  request as httpRequest,
  ServerResponse,
  type Server,
} from 'node:http';
import { connect, Socket, type AddressInfo } from 'node:net';
import { createExpressApp } from './express';
import { discardRest, dropIfConnectionEnded, interpretJsonBody } from './request-body';

// The one body rule every adapter (standalone, Express, Next.js) ends in.
describe('interpretJsonBody', () => {
  it.each([
    ['', 'application/json'],
    ['  \n\t', 'application/json'],
    ['', undefined],
  ])('reads %j (%s) as no body', (text, type) => {
    expect(interpretJsonBody(text, type)).toEqual({ ok: true, body: undefined });
  });

  it.each([
    ['{"a":1}', 'application/json', { a: 1 }],
    ['[1,2]', 'application/vnd.api+json', [1, 2]],
    ['42', null, 42],
    ['null', 'application/json', null],
    ['"s"', 'text/plain', 's'],
  ])('parses %j (%s)', (text, type, body) => {
    expect(interpretJsonBody(text, type)).toEqual({ ok: true, body });
  });

  it.each([['application/json'], ['application/problem+json; charset=utf-8'], [undefined], [null]])(
    'refuses a body that does not parse when declared %s',
    (type) => {
      expect(interpretJsonBody('{oops', type)).toEqual({
        ok: false,
        status: 400,
        message: 'Request body is not valid JSON',
      });
    }
  );

  it('reads an unparseable body declared as another type as no body', () => {
    expect(interpretJsonBody('a=1&b=2', 'application/x-www-form-urlencoded')).toEqual({
      ok: true,
      body: undefined,
    });
  });
});

/*
 * discardRest against a real Node server, driven over a raw socket so the
 * client controls exactly how (and how slowly) the upload arrives.
 */
describe('discardRest', () => {
  let server: Server | undefined;
  const sockets: Socket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    if (server) {
      const closed = new Promise<void>((resolve) => server!.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    }
    server = undefined;
  });

  async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  /** A raw client: what it received, and when the server ended or dropped it. */
  function client(port: number) {
    const socket = connect(port, '127.0.0.1');
    sockets.push(socket);
    let received = '';
    socket.on('data', (d) => (received += d.toString('latin1')));
    socket.on('error', () => undefined);
    const ended = new Promise<void>((resolve) => {
      socket.on('end', () => resolve());
      socket.on('close', () => resolve());
    });
    return { socket, received: () => received, ended };
  }

  const head = (length: number) =>
    `POST / HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${length}\r\n\r\n`;

  /** Whether `promise` settles within `ms`. */
  const within = (promise: Promise<unknown>, ms: number) =>
    Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);

  /** Answer 413, then discard the rest of the upload under `limits`. */
  const refuse =
    (limits: Parameters<typeof discardRest>[2], ended?: () => void) =>
    (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET') {
        res.end('again');
        return;
      }
      req.on('end', () => ended?.());
      discardRest(req, res, limits);
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('too large');
    };

  it('leaves a destroyed request alone: no timer, no listeners, no throw', () => {
    vi.useFakeTimers();
    try {
      const socket = new Socket();
      const req = new IncomingMessage(socket);
      req.headers['content-length'] = String(64 * 1024 * 1024);
      const res = new ServerResponse(req);
      req.destroy();
      expect(() => discardRest(req, res, { maxBytes: 1 })).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
      expect(req.listenerCount('data')).toBe(0);
      expect(res.listenerCount('finish')).toBe(0);
      expect(socket.writableEnded).toBe(false);
      expect(dropIfConnectionEnded(req)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the connection so a request pipelined behind it is dropped', async () => {
    let behind: boolean | undefined;
    const port = await serve((req, res) => {
      if (req.method === 'GET') {
        behind = dropIfConnectionEnded(req);
        if (!behind) res.end('again');
        return;
      }
      expect(dropIfConnectionEnded(req)).toBe(false);
      discardRest(req, res, { maxBytes: 1024 * 1024, graceMs: 200 });
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('too large');
    });
    const c = client(port);
    const length = 2 * 1024 * 1024;
    c.socket.write(head(length));
    c.socket.write(Buffer.alloc(length, 0x78));
    c.socket.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
    await expect.poll(() => behind, { timeout: 3000 }).toBe(true);
    await c.ended;
    expect(c.received()).toContain('413');
    expect(c.received()).not.toContain('again');
  });

  it('reads a paused request to its end', async () => {
    // Nothing else reads this request: no response has been written (so Node
    // does not dump it), and the request was paused after its first chunk.
    const port = await serve((req, res) => {
      req.once('data', () => {
        req.pause();
        discardRest(req, res);
        req.on('end', () => res.end('read off'));
      });
    });
    const c = client(port);
    c.socket.write(head(256 * 1024) + 'x'.repeat(256 * 1024));
    await expect.poll(() => c.received(), { timeout: 3000 }).toContain('read off');
  });

  it('keeps the connection for an over-limit upload under both caps', async () => {
    let requestEnded = false;
    const port = await serve(
      refuse({ maxBytes: 1024 * 1024, maxMs: 5000 }, () => (requestEnded = true))
    );
    const c = client(port);
    c.socket.write(head(512 * 1024) + 'x'.repeat(512 * 1024));
    await expect.poll(() => requestEnded, { timeout: 3000 }).toBe(true);
    expect(c.received()).toContain('413');
    // The same connection serves the next request.
    c.socket.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
    await expect.poll(() => c.received(), { timeout: 3000 }).toContain('again');
  });

  it('cuts off a trickling client once the time cap passes', async () => {
    const port = await serve(refuse({ maxBytes: 1024 * 1024, maxMs: 200 }));
    const c = client(port);
    c.socket.write(head(1024 * 1024));
    const trickle = setInterval(() => c.socket.writable && c.socket.write('x'.repeat(10)), 50);
    try {
      const started = Date.now();
      expect(await within(c.ended, 3000)).toBe(true);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      clearInterval(trickle);
    }
    expect(c.received()).toContain('413');
  });

  it('cuts off a chunked upload that sends more than the byte cap', async () => {
    const port = await serve(refuse({ maxBytes: 64 * 1024, maxMs: 10_000 }));
    const c = client(port);
    c.socket.write('POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n');
    await expect.poll(() => c.received(), { timeout: 3000 }).toContain('413');
    expect(await within(c.ended, 300)).toBe(false);
    c.socket.write('20000\r\n' + 'x'.repeat(0x20000) + '\r\n');
    expect(await within(c.ended, 3000)).toBe(true);
  });

  it('ends the connection after the 413 when the declared body still to come is past the cap', async () => {
    const maxBytes = 1024;
    const port = await serve(refuse({ maxBytes, maxMs: 10_000 }));
    const c = client(port);
    c.socket.write(head(maxBytes + 1));
    expect(await within(c.ended, 3000)).toBe(true);
    expect(c.received()).toContain('413');
    expect(c.received()).toContain('too large');
  });

  it('ends a connection whose client asked to close once its upload is read off', async () => {
    // The 413 advertises keep-alive (so Node does not destroy the socket while
    // the upload still arrives); the close the client asked for is then ours.
    const port = await serve(refuse({ maxBytes: 1024 * 1024, maxMs: 10_000 }));
    const c = client(port);
    const length = 256 * 1024;
    c.socket.write(
      `POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: ${length}\r\n\r\n`
    );
    await expect.poll(() => c.received(), { timeout: 3000 }).toContain('413');
    expect(c.received()).toMatch(/connection: keep-alive/i);
    expect(await within(c.ended, 300)).toBe(false);
    c.socket.write(Buffer.alloc(length, 120));
    expect(await within(c.ended, 2000)).toBe(true);
  });

  it('counts the bytes already read against the declared length', async () => {
    // 1 MB declared, 512 KB already read: 512 KB is still to come, under the
    // 768 KB cap, so the connection is kept rather than ended at once.
    const port = await serve(
      refuse({ maxBytes: 768 * 1024, maxMs: 10_000, alreadyRead: 512 * 1024 })
    );
    const c = client(port);
    c.socket.write(head(1024 * 1024));
    await expect.poll(() => c.received(), { timeout: 3000 }).toContain('413');
    expect(await within(c.ended, 500)).toBe(false);
  });

  /**
   * A client that does not read until it has sent its whole upload: whatever
   * the server does meanwhile, the 413 is only still there if the connection
   * was ended (FIN) rather than reset, since a reset discards unread data.
   */
  async function uploadThenRead(port: number, preamble: string, frames: Buffer[]) {
    const c = client(port);
    c.socket.pause();
    let error: string | undefined;
    c.socket.on('error', (e: NodeJS.ErrnoException) => (error = e.code));
    c.socket.write(preamble);
    for (const frame of frames) {
      if (!c.socket.writable) break;
      if (!c.socket.write(frame)) await new Promise((resolve) => c.socket.once('drain', resolve));
    }
    c.socket.resume();
    expect(await within(c.ended, 5000)).toBe(true);
    return { received: c.received(), error };
  }

  it('keeps the 413 readable when a declared upload keeps coming after the FIN', async () => {
    const port = await serve(refuse({ maxBytes: 64 * 1024, maxMs: 10_000 }));
    const length = 4 * 1024 * 1024;
    const { received, error } = await uploadThenRead(port, head(length), [
      Buffer.alloc(length, 120),
    ]);
    expect(received).toContain('413');
    expect(error).toBeUndefined();
  });

  it('keeps the 413 readable when a chunked upload trips the byte cap', async () => {
    const port = await serve(refuse({ maxBytes: 64 * 1024, maxMs: 10_000 }));
    const chunk = Buffer.alloc(256 * 1024, 120);
    const frame = Buffer.concat([Buffer.from('40000\r\n'), chunk, Buffer.from('\r\n')]);
    const { received, error } = await uploadThenRead(
      port,
      'POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n',
      Array.from({ length: 16 }, () => frame)
    );
    expect(received).toContain('413');
    expect(error).toBeUndefined();
  });

  it('keeps the 413 readable for a declared upload that finishes after the grace, within the time cap', async () => {
    // Past the byte cap from the start, so the FIN goes out at once; the
    // client then takes ~800 ms, eight times the grace, to finish uploading.
    // The declared length bounds the read-off, not the byte cap, so the
    // connection is not destroyed the grace period after the cap.
    const port = await serve(refuse({ maxBytes: 64 * 1024, maxMs: 10_000, graceMs: 100 }));
    const frame = Buffer.alloc(64 * 1024, 120);
    const frames = 16;
    const c = client(port);
    c.socket.pause();
    let error: string | undefined;
    c.socket.on('error', (e: NodeJS.ErrnoException) => (error = e.code));
    c.socket.write(head(frames * frame.length));
    for (let i = 0; i < frames && c.socket.writable; i++) {
      c.socket.write(frame);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    c.socket.resume();
    expect(await within(c.ended, 5000)).toBe(true);
    expect(c.received()).toContain('413');
    expect(error).toBeUndefined();
  });

  describe('behind an earlier pipelined response still pending', () => {
    // GET /slow answers after 300 ms; the over-limit POST behind it is refused
    // at once, so its 413 is queued behind the slow response. Ending the
    // socket before the 413 owns it would cut both responses.
    let counted = 0;
    // Body bytes of the refused POST read before /slow answered.
    let readBeforeSlow = 0;
    let read = 0;
    const slowThenRefuse = (limits: Parameters<typeof discardRest>[2]) =>
      serve((req, res) => {
        if (dropIfConnectionEnded(req)) return;
        if (req.url === '/slow') {
          setTimeout(() => {
            readBeforeSlow = read;
            res.end('slow-ok');
          }, 300);
          return;
        }
        if (req.url === '/count') {
          counted++;
          res.end('counted');
          return;
        }
        read = 0;
        req.on('data', (chunk: Buffer) => (read += chunk.length));
        discardRest(req, res, limits);
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('too large');
      });

    it('delivers both responses when the declared body is past the cap', async () => {
      const port = await slowThenRefuse({ maxBytes: 64 * 1024, maxMs: 10_000 });
      const c = client(port);
      c.socket.write('GET /slow HTTP/1.1\r\nHost: x\r\n\r\n' + head(41_943_040));
      c.socket.write(Buffer.alloc(1024));
      expect(await within(c.ended, 3000)).toBe(true);
      expect(c.received()).toContain('slow-ok');
      expect(c.received()).toContain('413');
    });

    it('delivers both responses when a chunked upload trips the byte cap first', async () => {
      const port = await slowThenRefuse({ maxBytes: 64 * 1024, maxMs: 10_000, graceMs: 200 });
      const c = client(port);
      c.socket.write(
        'GET /slow HTTP/1.1\r\nHost: x\r\n\r\n' +
          'POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n' +
          '20000\r\n' +
          'x'.repeat(0x20000) +
          '\r\n'
      );
      expect(await within(c.ended, 3000)).toBe(true);
      expect(c.received()).toContain('slow-ok');
      expect(c.received()).toContain('413');
    });

    it('stops reading an upload that tripped a cap until the FIN can go out', async () => {
      const port = await slowThenRefuse({ maxBytes: 64 * 1024, maxMs: 10_000, graceMs: 200 });
      const c = client(port);
      const frame = '10000\r\n' + 'x'.repeat(0x10000) + '\r\n';
      c.socket.write(
        'GET /slow HTTP/1.1\r\nHost: x\r\n\r\n' +
          'POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n' +
          frame.repeat(64)
      );
      expect(await within(c.ended, 3000)).toBe(true);
      expect(c.received()).toContain('413');
      // 4 MiB were sent; reading stopped just past the 64 KiB cap.
      expect(readBeforeSlow).toBeGreaterThan(64 * 1024);
      expect(readBeforeSlow).toBeLessThan(1024 * 1024);
    });

    it('runs no request pipelined behind the refused one before the FIN', async () => {
      // The whole declared body arrives while /slow is still pending, so
      // /count is parsed before the socket is ended: it is still dropped.
      counted = 0;
      const port = await slowThenRefuse({ maxBytes: 64 * 1024, maxMs: 10_000 });
      const c = client(port);
      const length = 128 * 1024;
      c.socket.write('GET /slow HTTP/1.1\r\nHost: x\r\n\r\n' + head(length));
      c.socket.write(Buffer.alloc(length, 120));
      c.socket.write('GET /count HTTP/1.1\r\nHost: x\r\n\r\n');
      expect(await within(c.ended, 3000)).toBe(true);
      expect(c.received()).toContain('slow-ok');
      expect(c.received()).toContain('413');
      expect(c.received()).not.toContain('counted');
      expect(counted).toBe(0);
    });
  });

  describe('through createExpressApp, a declared upload between the limit and the limit plus the cap', () => {
    // Express refuses a declared length before reading a byte, so all of a
    // 25 MB upload is still to come: past the 20 MiB cap, the connection is
    // ended (FIN) after the 413 and the rest read off until it is in, within
    // DISCARD_MAX_MS, rather than reset when 20 MiB have arrived.
    const length = 25_000_000;
    const body = Buffer.alloc(length, 120);
    const path = '/ui-bridge/control/snapshot';

    async function serveExpress() {
      // The empty handler table only logs each unrouted route; the 413 is
      // decided by the body reader before any route.
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const app = createExpressApp({} as Parameters<typeof createExpressApp>[0]);
      return serve(app as (req: IncomingMessage, res: ServerResponse) => void);
    }

    afterEach(() => vi.restoreAllMocks());

    it('keeps the 413 readable for a client that reads only after uploading', async () => {
      const port = await serveExpress();
      const { received, error } = await uploadThenRead(
        port,
        `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${length}\r\n\r\n`,
        [body]
      );
      expect(received).toContain('413');
      expect(error).toBeUndefined();
    });

    it('answers fetch with a 413 every time', async () => {
      // A reset loses the 413 only intermittently (fetch: ECONNRESET, about
      // 1 in 25 on Windows loopback), hence the loop. What is guaranteed is a
      // 413 to a client that finishes its upload within DISCARD_MAX_MS (5 s)
      // of the refusal, which a loopback 25 MB upload does even under load;
      // cutting it at the byte cap plus a 1 s grace did not (2 in 9 runs).
      const port = await serveExpress();
      const outcomes: string[] = [];
      for (let i = 0; i < 100; i++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          });
          await response.text();
          outcomes.push(String(response.status));
        } catch (e) {
          const cause = (e as { cause?: { code?: string } }).cause;
          outcomes.push(cause?.code ?? String(e));
        }
      }
      expect(outcomes.filter((o) => o !== '413')).toEqual([]);
    }, 120_000);

    it('answers a client that asked to close with a 413 every time', async () => {
      // `Connection: close` would mark the 413 last, and Node would destroy
      // the socket once it is flushed while the upload still arrives: a reset
      // (9 in 10 lost before discardRest kept such a connection open). 15 MB
      // is within the cap, so the upload is read off to its end and the
      // connection then ended, honouring the close.
      const port = await serveExpress();
      const size = 15 * 1024 * 1024;
      const chunk = Buffer.alloc(64 * 1024, 120);
      const outcomes: string[] = [];
      for (let i = 0; i < 10; i++) {
        outcomes.push(
          await new Promise<string>((resolve) => {
            const rq = httpRequest({
              host: '127.0.0.1',
              port,
              method: 'POST',
              path,
              agent: false,
              headers: {
                connection: 'close',
                'content-type': 'application/json',
                'content-length': size,
              },
            });
            let status: string | undefined;
            rq.on('response', (res) => {
              status = String(res.statusCode);
              res.resume();
            });
            rq.on('error', (e: NodeJS.ErrnoException) => resolve(status ?? e.code ?? String(e)));
            rq.on('close', () => resolve(status ?? 'closed without a response'));
            let sent = 0;
            const write = () => {
              while (sent < size) {
                sent += chunk.length;
                if (!rq.write(chunk)) {
                  rq.once('drain', write);
                  return;
                }
              }
              rq.end();
            };
            write();
          })
        );
      }
      expect(outcomes.filter((o) => o !== '413')).toEqual([]);
    }, 60_000);
  });
});
