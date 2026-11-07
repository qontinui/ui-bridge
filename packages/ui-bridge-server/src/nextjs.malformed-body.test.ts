/**
 * The Next.js adapter reads a request body by the standalone server's rules
 * (`request-body.ts`): a body declared JSON — or declared as nothing — that
 * does not parse is a 400 `UB-VALIDATION-ERROR`, never a handler call with
 * `{}`. An empty body is no body (`{}`), as is a body declared as another type
 * that does not parse.
 *
 * Before this, the catch-all turned an unparseable body into `{}`, and the
 * named helpers threw on any body that was not JSON, an empty one included.
 */

import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createControlHandlers, createNextRouteHandlers } from './nextjs';
import type { UIBridgeServerHandlers } from './types';

function makeRequest(
  path: string,
  body: string,
  contentType?: string,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  const url = `http://localhost:3000/api/ui-bridge${path}`;
  const headers: Record<string, string> = { ...extraHeaders };
  if (contentType) headers['Content-Type'] = contentType;
  const req = new Request(url, {
    method: 'POST',
    headers,
    // Bytes, not a string: a string body is given `text/plain` by `Request`.
    body: new TextEncoder().encode(body),
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(url) });
  return req as unknown as NextRequest;
}

const ok = { success: true as const, data: {} as never, timestamp: 0 };

function setup() {
  const find = vi.fn(async (..._args: unknown[]) => ok);
  const handlers = { find } as unknown as UIBridgeServerHandlers;
  const routes = createNextRouteHandlers(handlers);
  const post = (body: string, contentType?: string) =>
    routes.POST(makeRequest('/control/find', body, contentType), {
      params: Promise.resolve({ path: ['control', 'find'] }),
    });
  return { find, post, control: createControlHandlers(handlers) };
}

describe('Next.js catch-all · request body', () => {
  it('refuses a body declared JSON that does not parse, without calling the handler', async () => {
    const { find, post } = setup();
    const res = await post('{"text":', 'application/json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'UB-VALIDATION-ERROR' });
    expect(find).not.toHaveBeenCalled();
  });

  it('refuses an undeclared body that does not parse', async () => {
    const { find, post } = setup();
    expect((await post('not json')).status).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });

  it('passes an unparseable body declared as another type on as {}', async () => {
    const { find, post } = setup();
    expect((await post('a=1', 'text/plain')).status).toBe(200);
    expect(find.mock.calls[0][0]).toEqual({});
  });

  it('passes an empty body on as {} and a valid one through', async () => {
    const { find, post } = setup();
    expect((await post('', 'application/json')).status).toBe(200);
    expect(find.mock.calls[0][0]).toEqual({});
    expect((await post('{"text":"Größe ✓"}', 'application/json')).status).toBe(200);
    expect(find.mock.calls[1][0]).toEqual({ text: 'Größe ✓' });
  });
});

describe('Next.js catch-all · unreadable and oversized bodies', () => {
  it('refuses a body whose stream was already consumed', async () => {
    const { find, control } = setup();
    const request = makeRequest('/control/find', '{"text":"x"}', 'application/json');
    await request.text();
    expect((await control.find.POST(request)).status).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });

  it('refuses a body over 10 MB with a 413', async () => {
    const { find, post } = setup();
    const res = await post(
      JSON.stringify({ text: 'x'.repeat(10 * 1024 * 1024) }),
      'application/json'
    );
    expect(res.status).toBe(413);
    expect(find).not.toHaveBeenCalled();
  });
});

describe('Next.js named helpers · declared length', () => {
  it('refuses a declared Content-Length over 10 MB before reading', async () => {
    const { find, control } = setup();
    const request = makeRequest('/control/find', '{}', 'application/json', {
      'Content-Length': String(11 * 1024 * 1024),
    });
    expect((await control.find.POST(request)).status).toBe(413);
    expect(find).not.toHaveBeenCalled();
  });
});

describe('Next.js named helpers · request body', () => {
  it('refuses a malformed JSON body with a 400 instead of throwing', async () => {
    const { find, control } = setup();
    const res = await control.find.POST(makeRequest('/control/find', '{', 'application/json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'UB-VALIDATION-ERROR' });
    expect(find).not.toHaveBeenCalled();
  });

  it('reads an empty body as {} instead of throwing', async () => {
    const { find, control } = setup();
    const res = await control.find.POST(makeRequest('/control/find', ''));
    expect(res.status).toBe(200);
    expect(find.mock.calls[0][0]).toEqual({});
  });
});
