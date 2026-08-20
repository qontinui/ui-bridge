/**
 * The Next.js App Router `params` contract, pinned in both directions.
 *
 * `createUIBridgeHandler()` and `createNextRouteHandlers()` are the two
 * handlers `docs-site/docs/server/nextjs.md` tells a reader to export from
 * `app/api/ui-bridge/[...path]/route.ts`. Until this test existed they were
 * typed `context: { params: Record<string, string> }`, which is wrong on BOTH
 * halves of this package's declared `next` peer range
 * (`^13 || ^14 || ^15 || ^16`):
 *
 *   - from Next 13.4 `params` is a PROMISE, so `next build` failed the
 *     generated route validator in `.next/types/validator.ts` — a hard build
 *     failure, not a warning, reproduced in `examples/nextjs-app`;
 *   - a catch-all segment yields `string[]`, never `string`, so the declared
 *     value type contradicted the handler's own `Array.isArray` branch.
 *
 * Both shapes are asserted at RUNTIME here. The type-level half is covered by
 * `examples/nextjs-app`, whose `next build` runs Next's own validator against
 * the real exported handler — the only check that can speak for Next's
 * expectations rather than for our restatement of them.
 */

import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { createUIBridgeHandler } from './nextjs';

/**
 * A catch-all route request, as Next constructs it for `/api/ui-bridge/*`.
 * `nextUrl` is the one thing Next adds over a plain `Request` that the handler
 * reads (for GET query params), so it is supplied rather than stubbed away.
 */
function request(path: string, method = 'GET'): NextRequest {
  const url = `http://localhost:3000/api/ui-bridge${path}`;
  const req = new Request(url, { method });
  Object.defineProperty(req, 'nextUrl', { value: new URL(url) });
  return req as unknown as NextRequest;
}

describe('Next.js route params', () => {
  const handler = createUIBridgeHandler();

  it('resolves a catch-all path when params is a Promise (Next >= 13.4)', async () => {
    const res = await handler(request('/control/elements'), {
      params: Promise.resolve({ path: ['control', 'elements'] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });

  it('resolves the same path when params is a plain object (Next < 13.4)', async () => {
    const res = await handler(request('/control/elements'), {
      params: { path: ['control', 'elements'] },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });

  it('serves route discovery through the awaited params, not around it', async () => {
    const res = await handler(request('/_routes'), {
      params: Promise.resolve({ path: ['_routes'] }),
    });

    const body = (await res.json()) as { success: boolean; data: { count: number } };
    expect(body.success).toBe(true);
    // Discovery is only reachable once `path` resolved to `/_routes`; a
    // params shape the handler cannot read would 404 here instead.
    expect(body.data.count).toBeGreaterThan(0);
  });

  it('answers /health, keeping parity with the express and standalone adapters', async () => {
    const res = await handler(request('/health'), {
      params: Promise.resolve({ path: ['health'] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('404s an unknown path rather than mistaking it for the catch-all root', async () => {
    const res = await handler(request('/nope'), {
      params: Promise.resolve({ path: ['nope'] }),
    });

    expect(res.status).toBe(404);
  });
});
