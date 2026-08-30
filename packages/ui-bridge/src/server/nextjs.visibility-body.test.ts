/**
 * Wire-level: `POST /control/visibility` must actually RECEIVE its request body.
 *
 * The adapters only pass a body to routes that declare `bodyRequired: true`
 * (`nextjs.ts`: "POST routes WITHOUT `bodyRequired:true` are context-only
 * handlers ... Stick to the route table"). `/control/visibility` declared no
 * body, so the handler was invoked with NO arguments and every knob it
 * accepts — `minRatio`, `includeExpected`, `recency` — was silently
 * unreachable over HTTP while remaining fully functional when the handler was
 * called directly from a unit test.
 *
 * That gap is invisible from either side on its own: the handler tests pass
 * (they pass params in directly) and the route exists and returns 200 (so a
 * smoke test passes too). Only a wire-level call with a NON-DEFAULT parameter
 * shows it, which is what this file does. Measured against a live Chromium
 * tab before the fix: `{"minRatio":0.9}` came back as `minRatio: 0.02`.
 *
 * `recency` is the sharpest of the three, because its failure is silent AND
 * misleading: it forces a fresh snapshot, so losing it makes the endpoint
 * answer occlusion questions from an arbitrarily old cache while reporting
 * `stale: false`.
 */

import { describe, expect, it, vi } from 'vitest';
import { createNextRouteHandlers } from './nextjs';
import { UI_BRIDGE_ROUTES } from './types';

interface NextRequestLike extends Request {
  nextUrl: URL;
}

function makeRequest(path: string, body: unknown): NextRequestLike {
  const url = `https://test.local${path}`;
  const req = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(url), writable: false });
  return req as NextRequestLike;
}

describe('POST /control/visibility · request body reaches the handler', () => {
  it('declares bodyRequired in the route table (the adapters read this, not the signature)', () => {
    const route = UI_BRIDGE_ROUTES.find(
      (r) => r.path === '/control/visibility' && r.method === 'POST',
    );
    expect(route).toBeDefined();
    expect(route!.bodyRequired).toBe(true);
  });

  it('forwards minRatio / includeExpected / recency verbatim', async () => {
    const visibility = vi.fn(async () => ({
      success: true as const,
      data: {} as never,
      timestamp: Date.now(),
    }));
    const routes = createNextRouteHandlers({ visibility });

    await routes.POST(
      makeRequest('/control/visibility', {
        minRatio: 0.9,
        includeExpected: true,
        recency: 'current',
      }),
      { params: { path: ['control', 'visibility'] } as never },
    );

    expect(visibility).toHaveBeenCalledTimes(1);
    expect(visibility.mock.calls[0][0]).toMatchObject({
      minRatio: 0.9,
      includeExpected: true,
      recency: 'current',
    });
  });

  it('still works with an empty body (every knob is optional)', async () => {
    const visibility = vi.fn(async () => ({
      success: true as const,
      data: {} as never,
      timestamp: Date.now(),
    }));
    const routes = createNextRouteHandlers({ visibility });

    const res = await routes.POST(makeRequest('/control/visibility', {}), {
      params: { path: ['control', 'visibility'] } as never,
    });

    expect(res.status).toBe(200);
    expect(visibility).toHaveBeenCalledTimes(1);
  });
});
