/**
 * Next.js HTTP-layer test for per-user tab scoping (§4.2).
 *
 * Strict mode for `POST /heartbeat`: missing `registrationMetadata` →
 * HTTP 400 with `code: MISSING_REGISTRATION_METADATA`, no listener
 * entry / metadata created, no tab present in the relay's diagnostics.
 *
 * `GET /tabs` & `/tabs/wait` filter by the `X-Caller-User-Id` request
 * header. The header is consumer-trusted (qontinui-web sets it from
 * the auth gate, NEVER from a browser-supplied value) — without the
 * header the response is the unfiltered admin view.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRelay } from './command-relay';
import { createNextRouteHandlers } from './nextjs';

interface NextRequestLike extends Request {
  nextUrl: URL;
}

/** Build a NextRequest-shaped Request for the route handlers. */
function makeRequest(
  method: string,
  path: string,
  init?: { body?: unknown; headers?: Record<string, string>; query?: string },
): NextRequestLike {
  const url = `https://test.local${path}${init?.query ? `?${init.query}` : ''}`;
  const req = new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    body:
      init?.body !== undefined && method !== 'GET' && method !== 'HEAD'
        ? JSON.stringify(init.body)
        : undefined,
  });
  // Attach `nextUrl` to satisfy the route handler's type.
  Object.defineProperty(req, 'nextUrl', {
    value: new URL(url),
    writable: false,
  });
  return req as NextRequestLike;
}

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeNextScopingTest_${Math.random().toString(36).slice(2, 10)}`;
  return new CommandRelay({ globalPrefix: prefix });
}

describe('Next.js · POST /heartbeat strict mode (§4.2)', () => {
  let relay: CommandRelay;
  let routes: ReturnType<typeof createNextRouteHandlers>;

  beforeEach(() => {
    relay = freshRelay();
    routes = createNextRouteHandlers({}, { relay });
  });

  afterEach(() => {
    relay.destroy();
  });

  it('rejects heartbeat without body → 400 MISSING_REGISTRATION_METADATA', async () => {
    const req = makeRequest('POST', '/heartbeat', { body: undefined });
    const res = await routes.POST(req, { params: { path: ['heartbeat'] } });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe('MISSING_REGISTRATION_METADATA');
  });

  it('rejects heartbeat without registrationMetadata → 400 MISSING_REGISTRATION_METADATA', async () => {
    const req = makeRequest('POST', '/heartbeat', {
      body: { tabId: 'tab-a', url: 'https://x' },
    });
    const res = await routes.POST(req, { params: { path: ['heartbeat'] } });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe('MISSING_REGISTRATION_METADATA');
    // CRITICAL: the rejection MUST NOT have created an ownership / metadata
    // entry for the half-valid tab.
    expect(relay.getOwnership('tab-a')).toBeNull();
  });

  it('rejects heartbeat with empty userId → 400', async () => {
    const req = makeRequest('POST', '/heartbeat', {
      body: {
        tabId: 'tab-a',
        registrationMetadata: { userId: '   ', sessionId: 's' },
      },
    });
    const res = await routes.POST(req, { params: { path: ['heartbeat'] } });
    expect(res.status).toBe(400);
    expect(relay.getOwnership('tab-a')).toBeNull();
  });

  it('rejects heartbeat with empty sessionId → 400', async () => {
    const req = makeRequest('POST', '/heartbeat', {
      body: {
        tabId: 'tab-a',
        registrationMetadata: { userId: 'alice', sessionId: '' },
      },
    });
    const res = await routes.POST(req, { params: { path: ['heartbeat'] } });
    expect(res.status).toBe(400);
    expect(relay.getOwnership('tab-a')).toBeNull();
  });

  it('accepts heartbeat with full metadata and records ownership', async () => {
    const req = makeRequest('POST', '/heartbeat', {
      body: {
        tabId: 'tab-a',
        registrationMetadata: { userId: 'alice', sessionId: 'sess-1' },
        url: 'https://x',
        title: 't',
        visibility: 'visible',
      },
    });
    const res = await routes.POST(req, { params: { path: ['heartbeat'] } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { received: boolean; tabRegistered: boolean };
    };
    expect(json.success).toBe(true);
    expect(json.data.received).toBe(true);
    // tabRegistered is false here because the SSE listener was never
    // opened — that's correct: the heartbeat path doesn't subscribe.
    expect(json.data.tabRegistered).toBe(false);

    const owner = relay.getOwnership('tab-a');
    expect(owner).not.toBeNull();
    expect(owner!.userId).toBe('alice');
    expect(owner!.sessionId).toBe('sess-1');
  });
});

describe('Next.js · GET /tabs filters by X-Caller-User-Id (§4.2)', () => {
  let relay: CommandRelay;
  let routes: ReturnType<typeof createNextRouteHandlers>;

  beforeEach(() => {
    relay = freshRelay();
    routes = createNextRouteHandlers({}, { relay });
    // Two owned tabs across two users.
    relay.subscribeToCommands(() => {}, 'tab-a');
    relay.recordRegistration('tab-a', { userId: 'alice', sessionId: 's' });
    relay.subscribeToCommands(() => {}, 'tab-b');
    relay.recordRegistration('tab-b', { userId: 'bob', sessionId: 's' });
  });

  afterEach(() => {
    relay.destroy();
  });

  it('without X-Caller-User-Id, returns ALL tabs (admin / trusted server-side view)', async () => {
    const req = makeRequest('GET', '/tabs');
    const res = await routes.GET(req, { params: { path: ['tabs'] } });
    const json = (await res.json()) as { data: { tabs: Array<{ tabId: string }> } };
    const ids = json.data.tabs.map((t) => t.tabId).sort();
    expect(ids).toEqual(['tab-a', 'tab-b']);
  });

  it('with X-Caller-User-Id=alice, only alice\'s tab is returned', async () => {
    const req = makeRequest('GET', '/tabs', {
      headers: { 'X-Caller-User-Id': 'alice' },
    });
    const res = await routes.GET(req, { params: { path: ['tabs'] } });
    const json = (await res.json()) as { data: { tabs: Array<{ tabId: string }> } };
    expect(json.data.tabs.map((t) => t.tabId)).toEqual(['tab-a']);
  });

  it('with X-Caller-User-Id=eve (no tabs), the list is empty (no enumeration of others)', async () => {
    const req = makeRequest('GET', '/tabs', {
      headers: { 'X-Caller-User-Id': 'eve' },
    });
    const res = await routes.GET(req, { params: { path: ['tabs'] } });
    const json = (await res.json()) as { data: { tabs: Array<{ tabId: string }> } };
    expect(json.data.tabs).toEqual([]);
  });
});
