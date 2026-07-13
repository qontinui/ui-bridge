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

/**
 * REGRESSION (U2, P1 security): `/health` spreads the FULL transport
 * diagnostics. It was authenticated but NOT scoped, while `/tabs` next to it
 * scoped correctly — so any authenticated user could route around the `/tabs`
 * gate and enumerate every other user's tab ids (plus their urls/titles via
 * `tabMetadata`, their `{userId, sessionId}` via `tabOwnership`, and their
 * in-flight `pendingCommandIds`, which `POST /commands` settles by id).
 *
 * `/health` must now scope by `X-Caller-User-Id` through the same mechanism
 * `/tabs` uses. No-header (admin / discovery-scanner) callers still get the
 * full view.
 */
describe('Next.js · GET /health is scoped per-user (§4.2 · U2 regression)', () => {
  let relay: CommandRelay;
  let routes: ReturnType<typeof createNextRouteHandlers>;

  interface HealthData {
    responsive: boolean;
    lastHeartbeat: number;
    connectedTabs: string[];
    activeTabs: string[];
    demotedTabs: string[];
    wsClientIds: string[];
    commandListenerCount: number;
    wsClientCount: number;
    primaryTabId: string | null;
    pendingCommandIds: string[];
    pendingCommandCount: number;
    tabHeartbeats: Record<string, number>;
    tabMetadata: Record<string, unknown>;
    tabOwnership: Record<string, { userId: string; sessionId: string }>;
  }

  async function getHealth(path: 'health' | 'status', userId?: string): Promise<HealthData> {
    const req = makeRequest('GET', `/${path}`, {
      headers: userId ? { 'X-Caller-User-Id': userId } : undefined,
    });
    const res = await routes.GET(req, { params: { path: [path] } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: HealthData };
    return json.data;
  }

  beforeEach(() => {
    relay = freshRelay();
    routes = createNextRouteHandlers({}, { relay });
    relay.subscribeToCommands(() => {}, 'tab-alice');
    relay.recordRegistration('tab-alice', { userId: 'alice', sessionId: 'sess-alice' });
    relay.receiveHeartbeat('tab-alice', {
      url: 'https://app.local/alice',
      title: "Alice's page",
      visibility: 'visible',
    });
    relay.subscribeToCommands(() => {}, 'tab-bob');
    relay.recordRegistration('tab-bob', { userId: 'bob', sessionId: 'sess-bob' });
    relay.receiveHeartbeat('tab-bob', {
      url: 'https://app.local/bobs-secret-workspace',
      title: "Bob's page",
      visibility: 'visible',
    });
  });

  afterEach(() => {
    relay.destroy();
  });

  it("THE LEAK: bob's tab id is ABSENT from alice's /health", async () => {
    const data = await getHealth('health', 'alice');

    // Every tab-id-bearing field: alice's tab only, bob's nowhere.
    expect(data.connectedTabs).toEqual(['tab-alice']);
    expect(data.connectedTabs).not.toContain('tab-bob');
    expect(data.activeTabs).not.toContain('tab-bob');
    expect(data.demotedTabs).not.toContain('tab-bob');
    expect(data.wsClientIds).not.toContain('tab-bob');
    expect(Object.keys(data.tabHeartbeats)).toEqual(['tab-alice']);
    expect(Object.keys(data.tabMetadata)).toEqual(['tab-alice']);
    expect(Object.keys(data.tabOwnership)).toEqual(['tab-alice']);

    // Nothing of bob's anywhere in the serialized body — id, url, or session.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('tab-bob');
    expect(serialized).not.toContain('sess-bob');
    expect(serialized).not.toContain('bobs-secret-workspace');
  });

  it('/status (the /health alias) is scoped identically', async () => {
    const data = await getHealth('status', 'alice');
    expect(data.connectedTabs).toEqual(['tab-alice']);
    expect(JSON.stringify(data)).not.toContain('tab-bob');
  });

  it('eve (authenticated, zero tabs) can enumerate nothing', async () => {
    const data = await getHealth('health', 'eve');
    expect(data.connectedTabs).toEqual([]);
    expect(data.activeTabs).toEqual([]);
    expect(data.wsClientIds).toEqual([]);
    expect(data.tabHeartbeats).toEqual({});
    expect(data.tabMetadata).toEqual({});
    expect(data.tabOwnership).toEqual({});
    expect(data.primaryTabId).toBeNull();
    expect(data.commandListenerCount).toBe(0);
    expect(data.wsClientCount).toBe(0);
    // ...and no liveness bleed from someone else's heartbeat.
    expect(data.responsive).toBe(false);
    expect(data.lastHeartbeat).toBe(0);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('tab-alice');
    expect(serialized).not.toContain('tab-bob');
  });

  it('primaryTabId is nulled for a caller who does not own the primary', async () => {
    // Whichever tab the relay elected primary, only its OWNER may see its id —
    // `primaryTabId` is a tab id like any other.
    const primary = relay.getTransportDiagnostics().primaryTabId;
    expect(primary).not.toBeNull();
    const owner = relay.getOwnership(primary!)!.userId;
    const other = owner === 'alice' ? 'bob' : 'alice';

    expect((await getHealth('health', owner)).primaryTabId).toBe(primary);
    expect((await getHealth('health', other)).primaryTabId).toBeNull();
    expect((await getHealth('health', 'eve')).primaryTabId).toBeNull();
  });

  it('pendingCommandIds are withheld from a scoped view (POST /commands settles by id)', async () => {
    // In-flight command, never resolved — a pending entry exists.
    void relay.queueCommand('snapshot', {}, { targetTabId: 'tab-bob' });
    await new Promise((r) => setTimeout(r, 0));
    expect(relay.getTransportDiagnostics().pendingCommandIds.length).toBeGreaterThan(0);

    const alice = await getHealth('health', 'alice');
    expect(alice.pendingCommandIds).toEqual([]);
    // The bare count is a non-identifying aggregate — still reported.
    expect(alice.pendingCommandCount).toBeGreaterThan(0);
  });

  it('WITHOUT the header, /health keeps the full admin view (discovery scanner)', async () => {
    const data = await getHealth('health');
    expect(data.connectedTabs.sort()).toEqual(['tab-alice', 'tab-bob']);
    expect(Object.keys(data.tabOwnership).sort()).toEqual(['tab-alice', 'tab-bob']);
    expect(data.responsive).toBe(true);
  });

  it("a foreign user cannot see another's tab even when they own one themselves", async () => {
    const bob = await getHealth('health', 'bob');
    expect(bob.connectedTabs).toEqual(['tab-bob']);
    expect(JSON.stringify(bob)).not.toContain('tab-alice');
    expect(JSON.stringify(bob)).not.toContain('sess-alice');
  });
});
