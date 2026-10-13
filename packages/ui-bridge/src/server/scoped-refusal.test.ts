/**
 * Structures that name no tab or user are refused to a scoped caller, with a
 * typed 403, and served as before with no identity: the SSE event streams
 * through every adapter, and the server's CDP tab routes through Next.js.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createNextRouteHandlers } from './nextjs';
import { createExpressApp } from './express';
import { createStandaloneServer, type StandaloneServer } from './standalone';
import { SSEManager } from './sse-handler';
import { SCOPED_CALLER_UNSUPPORTED } from './scoped-refusal';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

const BASE = '/api/ui-bridge';
const STREAMS = ['/control/events/stream', '/control/changes/stream'];

/** Status and content type of a GET, aborted as soon as its headers arrive. */
async function head(
  url: string,
  headers: Record<string, string>,
  init?: { fetchImpl?: typeof fetch }
) {
  const controller = new AbortController();
  const response = await (init?.fetchImpl ?? fetch)(url, { headers, signal: controller.signal });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json') ? ((await response.json()) as { code?: string }) : null;
  controller.abort();
  return { status: response.status, contentType, code: body?.code };
}

describe('the Next.js adapter', () => {
  const routes = createNextRouteHandlers({}, { sseManager: new SSEManager() });
  async function get(path: string, caller?: string) {
    const url = `http://app.test${BASE}${path}`;
    const nextUrl = new URL(url);
    const controller = new AbortController();
    const request = Object.assign(
      new Request(url, {
        headers: caller ? { 'X-Caller-User-Id': caller } : {},
        signal: controller.signal,
      }),
      { nextUrl }
    );
    const response = await routes.GET(request, {
      params: { path: nextUrl.pathname.slice(BASE.length + 1) },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const code = contentType.includes('json')
      ? ((await response.json()) as { code?: string }).code
      : undefined;
    controller.abort();
    return { status: response.status, contentType, code };
  }

  for (const path of STREAMS) {
    it(`${path}: refused to a scoped caller, a stream with no identity`, async () => {
      expect(await get(path, 'user-b')).toMatchObject({
        status: 403,
        code: SCOPED_CALLER_UNSUPPORTED,
      });
      expect((await get(path)).contentType).toContain('text/event-stream');
    });
  }

  it('the CDP tab list is refused to a scoped caller, and answers as before with no identity', async () => {
    expect(await get('/tabs/cdp', 'user-b')).toMatchObject({
      status: 403,
      code: SCOPED_CALLER_UNSUPPORTED,
    });
    expect((await get('/tabs/cdp')).code).not.toBe(SCOPED_CALLER_UNSUPPORTED);
  });
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

  async function checkStreams(port: number) {
    for (const path of STREAMS) {
      const url = `http://127.0.0.1:${port}${BASE}${path}`;
      expect(await head(url, { 'X-Caller-User-Id': 'user-b' })).toMatchObject({
        status: 403,
        code: SCOPED_CALLER_UNSUPPORTED,
      });
      expect((await head(url, {})).contentType).toContain('text/event-stream');
    }
  }

  it('the Express adapter refuses the event streams to a scoped caller', async () => {
    const app = createExpressApp(
      {},
      { basePath: BASE, sseManager: new SSEManager() }
    ) as Parameters<typeof createServer>[1];
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    await checkStreams((server.address() as AddressInfo).port);
  });

  it("the standalone server sends a handler's httpStatus, as Next.js and Express do", async () => {
    const relay = new CommandRelay({
      globalPrefix: `__uiBridgeStatus_${Math.random().toString(36).slice(2, 10)}`,
      proactiveSnapshot: false,
    });
    try {
      standalone = await createStandaloneServer(createRelayHandlers(relay), {
        host: '127.0.0.1',
        port: 0,
        basePath: BASE,
        log: () => {},
      });
      const port = standalone.getAddress()!.port;
      const get = async (path: string) => {
        const response = await fetch(`http://127.0.0.1:${port}${BASE}${path}`, {
          headers: { 'X-Caller-User-Id': 'user-b' },
        });
        return {
          status: response.status,
          body: (await response.json()) as Record<string, unknown>,
        };
      };
      const refused = await get('/control/changes/since?since=0');
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe(SCOPED_CALLER_UNSUPPORTED);
      expect(refused.body).not.toHaveProperty('httpStatus');
      const pinned = await get('/control/elements?tabId=tab-x');
      expect(pinned.status).toBe(404);
      expect(pinned.body.code).toBe('TAB_NOT_FOUND');
    } finally {
      relay.destroy();
    }
  });

  it('the standalone server refuses the event streams to a scoped caller', async () => {
    standalone = await createStandaloneServer(
      {},
      {
        host: '127.0.0.1',
        port: 0,
        basePath: BASE,
        log: () => {},
      }
    );
    await checkStreams(standalone.getAddress()!.port);
  });
});
