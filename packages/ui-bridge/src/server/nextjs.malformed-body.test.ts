/**
 * The Next.js adapter reads a request body by the standalone server's rules
 * (`request-body.ts`): a body declared JSON — or declared as nothing — that
 * does not parse is a 400 `UB-VALIDATION-ERROR`, never a handler call with
 * `{}`. An empty body is no body, and a body declared as another type that
 * does not parse is no body too.
 *
 * Before this, both the catch-all and the named helpers turned an unparseable
 * body into `{}` and ran the handler on it.
 */

import { describe, expect, it, vi } from 'vitest';
import { createControlHandlers, createNextRouteHandlers } from './nextjs';
import type { UIBridgeServerHandlers } from './types';

interface NextRequestLike extends Request {
  nextUrl: URL;
}

function makeRequest(
  path: string,
  body: string,
  contentType?: string,
  extraHeaders: Record<string, string> = {}
): NextRequestLike {
  const url = `https://test.local/api/ui-bridge${path}`;
  const headers: Record<string, string> = { ...extraHeaders };
  if (contentType) headers['Content-Type'] = contentType;
  const req = new Request(url, {
    method: 'POST',
    headers,
    // Bytes, not a string: a string body is given `text/plain` by `Request`.
    body: new TextEncoder().encode(body),
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(url), writable: false });
  return req as NextRequestLike;
}

const ok = { success: true as const, data: {} as never, timestamp: 0 };

function catchAll() {
  const find = vi.fn(async (..._args: unknown[]) => ok);
  const routes = createNextRouteHandlers({ find } as Partial<UIBridgeServerHandlers>);
  const params = { path: 'control/find'.split('/') as unknown as string };
  const post = (body: string, contentType?: string, headers?: Record<string, string>) =>
    routes.POST(makeRequest('/control/find', body, contentType, headers), { params });
  const postRequest = (request: NextRequestLike) => routes.POST(request, { params });
  return { find, post, postRequest };
}

describe('Next.js catch-all · request body', () => {
  it('refuses a body declared JSON that does not parse, without calling the handler', async () => {
    const { find, post } = catchAll();
    const res = await post('{"text":', 'application/json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'UB-VALIDATION-ERROR' });
    expect(find).not.toHaveBeenCalled();
  });

  it('refuses an undeclared body that does not parse', async () => {
    const { find, post } = catchAll();
    const res = await post('not json');
    expect(res.status).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });

  it('passes an unparseable body declared as another type on as no body', async () => {
    const { find, post } = catchAll();
    const res = await post('a=1', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(200);
    expect(find.mock.calls[0][0]).toEqual({});
  });

  it('passes an empty body on as no body', async () => {
    const { find, post } = catchAll();
    const res = await post('', 'application/json');
    expect(res.status).toBe(200);
    expect(find.mock.calls[0][0]).toEqual({});
  });

  it('passes a valid body through, multi-byte text intact', async () => {
    const { find, post } = catchAll();
    const res = await post(JSON.stringify({ text: 'Größe ✓' }), 'application/json');
    expect(res.status).toBe(200);
    expect(find.mock.calls[0][0]).toEqual({ text: 'Größe ✓' });
  });
});

describe('Next.js catch-all · the synthesized body', () => {
  const scoped = { 'X-UI-Bridge-Tab-Id': 'tab-7', 'X-Caller-User-Id': 'user-1' };

  it('still carries tabId and the caller when the body is empty', async () => {
    const { find, post } = catchAll();
    expect((await post('', undefined, scoped)).status).toBe(200);
    expect(find.mock.calls[0][0]).toEqual({ tabId: 'tab-7', __callerUserId: 'user-1' });
  });

  it('still carries tabId and the caller when a non-JSON body does not parse', async () => {
    const { find, post } = catchAll();
    expect((await post('a=1', 'application/x-www-form-urlencoded', scoped)).status).toBe(200);
    expect(find.mock.calls[0][0]).toEqual({ tabId: 'tab-7', __callerUserId: 'user-1' });
  });
});

describe('Next.js catch-all · unreadable and oversized bodies', () => {
  it('refuses a body whose stream was already consumed', async () => {
    const { find, postRequest } = catchAll();
    const request = makeRequest('/control/find', '{"text":"x"}', 'application/json');
    await request.text();
    const res = await postRequest(request);
    expect(res.status).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });

  it('refuses a body over 10 MB with a 413', async () => {
    const { find, post } = catchAll();
    const big = JSON.stringify({ text: 'x'.repeat(10 * 1024 * 1024) });
    const res = await post(big, 'application/json');
    expect(res.status).toBe(413);
    expect(find).not.toHaveBeenCalled();
  });

  it('refuses a declared Content-Length over 10 MB before reading', async () => {
    const { find, post } = catchAll();
    const res = await post('{}', 'application/json', {
      'Content-Length': String(11 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    expect(find).not.toHaveBeenCalled();
  });
});

describe('Next.js named helpers · request body', () => {
  it('refuses a malformed JSON body, without calling the handler', async () => {
    const find = vi.fn(async (..._args: unknown[]) => ok);
    const control = createControlHandlers({ find } as unknown as UIBridgeServerHandlers);
    const res = await control.find.POST(makeRequest('/control/find', '{', 'application/json'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'UB-VALIDATION-ERROR' });
    expect(find).not.toHaveBeenCalled();
  });

  it('still reads a missing body as an empty request', async () => {
    const find = vi.fn(async (..._args: unknown[]) => ok);
    const control = createControlHandlers({ find } as unknown as UIBridgeServerHandlers);
    const res = await control.find.POST(makeRequest('/control/find', ''));
    expect(res.status).toBe(200);
    expect(find.mock.calls[0][0]).toEqual({});
  });
});
