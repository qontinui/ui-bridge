/**
 * F2 — Network Stub Registry integration tests.
 *
 * Exercises the full `executeCommand` path so we confirm:
 *   - `registerNetworkStub` attaches the fetch interceptor.
 *   - A stubbed fetch resolves without hitting the real network.
 *   - `times: 1` consumes and the second call passes through.
 *   - Overlapping patterns: first-registered wins.
 *   - `deleteNetworkStub` makes subsequent matches miss.
 *   - `clearNetworkStubs` empties the registry.
 *   - Unmatched requests bypass stubs entirely.
 *   - Matched requests appear in the network-requests tracker with `stubId`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { __resetGlobalStubRegistryForTest } from '../network/stubs';

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

/**
 * The interceptor installed by `installNetworkInterceptor` captures
 * `window.fetch` at install time and never re-reads it. We therefore pin a
 * single "real fetch" BEFORE the first `registerNetworkStub` call (which
 * triggers the install), then mutate `realSpy` between tests instead of
 * re-swapping `globalThis.fetch`. That keeps the interceptor wrapping a
 * stable function whose behaviour we control per test.
 */
const realSpy = vi.fn<(input: RequestInfo | URL) => Promise<Response>>();

beforeAll(() => {
  globalThis.fetch = realSpy as unknown as typeof fetch;
});

beforeEach(() => {
  __resetGlobalStubRegistryForTest();
  realSpy.mockReset();
  realSpy.mockImplementation(async () => new Response('REAL_NETWORK_RESPONSE', { status: 200 }));
});

afterEach(async () => {
  await executeCommand('clearNetworkStubs', {}, emptyBridge);
});

/** Register a stub via the command path and return the id. */
async function register(spec: Record<string, unknown>): Promise<string> {
  const res = (await executeCommand('registerNetworkStub', spec, emptyBridge)) as {
    success: boolean;
    id?: string;
    error?: string;
  };
  if (!res.success) throw new Error(res.error ?? 'register failed');
  return res.id!;
}

describe('executeCommand · F2 network stubs', () => {
  it('registered stub short-circuits fetch (no real network call)', async () => {
    await register({
      urlPattern: '/api/fleet',
      response: { bodyJson: { items: [1, 2, 3] } },
    });

    const resp = await fetch('/api/fleet');
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toBe('application/json');
    expect(await resp.json()).toEqual({ items: [1, 2, 3] });
    // The fake "real network" spy must not have been called for /api/fleet.
    expect(realSpy.mock.calls.filter(([u]) => String(u).includes('/api/fleet'))).toHaveLength(0);
  });

  it('times: 1 consumes after first match — second call goes to real fetch', async () => {
    await register({
      urlPattern: '/api/once',
      response: { body: 'STUBBED' },
      times: 1,
    });

    const first = await fetch('/api/once');
    expect(await first.text()).toBe('STUBBED');

    const second = await fetch('/api/once');
    expect(await second.text()).toBe('REAL_NETWORK_RESPONSE');
    expect(realSpy.mock.calls.filter(([u]) => String(u).includes('/api/once'))).toHaveLength(1);
  });

  it('overlapping patterns: first-registered wins', async () => {
    await register({ urlPattern: '/api/x', response: { body: 'FIRST' } });
    await register({ urlPattern: '/api/x', response: { body: 'SECOND' } });

    const resp = await fetch('/api/x/y');
    expect(await resp.text()).toBe('FIRST');
  });

  it('deleteNetworkStub by id makes subsequent matches miss', async () => {
    const id = await register({ urlPattern: '/api/del', response: { body: 'HIT' } });

    expect(await (await fetch('/api/del')).text()).toBe('HIT');

    const del = (await executeCommand('deleteNetworkStub', { id }, emptyBridge)) as {
      success: boolean;
    };
    expect(del.success).toBe(true);

    expect(await (await fetch('/api/del')).text()).toBe('REAL_NETWORK_RESPONSE');
  });

  it('deleteNetworkStub with unknown id returns NOT_FOUND', async () => {
    const res = (await executeCommand('deleteNetworkStub', { id: 'stub_nope' }, emptyBridge)) as {
      success: boolean;
      code?: string;
    };
    expect(res.success).toBe(false);
    expect(res.code).toBe('NOT_FOUND');
  });

  it('clearNetworkStubs clears everything', async () => {
    await register({ urlPattern: '/a', response: { body: 'A' } });
    await register({ urlPattern: '/b', response: { body: 'B' } });

    const res = (await executeCommand('clearNetworkStubs', {}, emptyBridge)) as {
      success: boolean;
      cleared: number;
    };
    expect(res.success).toBe(true);
    expect(res.cleared).toBe(2);

    const list = (await executeCommand('listNetworkStubs', {}, emptyBridge)) as {
      stubs: unknown[];
    };
    expect(list.stubs).toHaveLength(0);
  });

  it('unmatched request bypasses the stub registry', async () => {
    await register({ urlPattern: '/api/matched', response: { body: 'NO' } });

    const resp = await fetch('/api/other');
    expect(await resp.text()).toBe('REAL_NETWORK_RESPONSE');
  });

  it('method constraint rejects wrong method and falls through', async () => {
    await register({
      urlPattern: '/api/m',
      method: 'POST',
      response: { body: 'STUBBED' },
    });

    expect(await (await fetch('/api/m', { method: 'GET' })).text()).toBe('REAL_NETWORK_RESPONSE');
    expect(await (await fetch('/api/m', { method: 'POST' })).text()).toBe('STUBBED');
  });

  it('matched requests appear in network-requests tracker with stubId', async () => {
    const id = await register({ urlPattern: '/api/track', response: { body: 'X' } });

    await fetch('/api/track');

    const tracked = (await executeCommand(
      'getNetworkRequests',
      { urlPattern: '/api/track' },
      emptyBridge
    )) as { requests: Array<{ url: string; stubId?: string }> };
    const match = tracked.requests.find((r) => r.url.includes('/api/track'));
    expect(match).toBeDefined();
    expect(match!.stubId).toBe(id);
  });

  it('listNetworkStubs returns registration metadata', async () => {
    const id = await register({
      urlPattern: '/api/list',
      method: 'POST',
      response: { body: 'X' },
      times: 3,
    });
    const res = (await executeCommand('listNetworkStubs', {}, emptyBridge)) as {
      stubs: Array<{ id: string; urlPattern: string; method: string; timesRemaining: unknown }>;
    };
    const mine = res.stubs.find((s) => s.id === id);
    expect(mine).toMatchObject({
      urlPattern: '/api/list',
      method: 'POST',
      timesRemaining: 3,
    });
  });

  it('invalid body returns a structured error (no throw)', async () => {
    const res = (await executeCommand(
      'registerNetworkStub',
      { urlPattern: '/bad' }, // missing response
      emptyBridge
    )) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/response/);
  });
});

describe('executeCommand · N3 verifyNetworkStub (non-consuming)', () => {
  it('verify returns matched=true with stubId + response for a registered stub', async () => {
    const id = await register({
      urlPattern: '/api/verify-hit',
      response: { status: 418, headers: { 'x-test': '1' }, bodyJson: { stubbed: true } },
    });

    const res = (await executeCommand(
      'verifyNetworkStub',
      { urlPattern: '/api/verify-hit' },
      emptyBridge
    )) as {
      success: boolean;
      data: {
        matched: boolean;
        stubId: string | null;
        response: { status: number; headers: Record<string, string>; body: string } | null;
        stubEntry: { id: string; hitCount: number; timesRemaining: number | 'always' } | null;
      };
    };

    expect(res.success).toBe(true);
    expect(res.data.matched).toBe(true);
    expect(res.data.stubId).toBe(id);
    expect(res.data.response).not.toBeNull();
    expect(res.data.response!.status).toBe(418);
    expect(res.data.response!.headers['x-test']).toBe('1');
    expect(res.data.response!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(res.data.response!.body)).toEqual({ stubbed: true });
    expect(res.data.stubEntry).not.toBeNull();
    expect(res.data.stubEntry!.id).toBe(id);
  });

  it('verify returns matched=false for a URL that no stub matches', async () => {
    await register({
      urlPattern: '/api/only-this',
      response: { body: 'NO' },
    });

    const res = (await executeCommand(
      'verifyNetworkStub',
      { urlPattern: '/api/nothing-matches-this' },
      emptyBridge
    )) as {
      success: boolean;
      data: {
        matched: boolean;
        stubId: string | null;
        response: unknown;
        stubEntry: unknown;
      };
    };
    expect(res.success).toBe(true);
    expect(res.data.matched).toBe(false);
    expect(res.data.stubId).toBeNull();
    expect(res.data.response).toBeNull();
    expect(res.data.stubEntry).toBeNull();
  });

  it('verify does NOT consume a times: 1 stub', async () => {
    await register({
      urlPattern: '/api/once-only',
      response: { body: 'ONE' },
      times: 1,
    });

    // Verify 5 times; the stub must still be there afterwards.
    for (let i = 0; i < 5; i++) {
      const res = (await executeCommand(
        'verifyNetworkStub',
        { urlPattern: '/api/once-only' },
        emptyBridge
      )) as { data: { matched: boolean } };
      expect(res.data.matched).toBe(true);
    }

    // The real fetch must now resolve from the stub (not the real network
    // spy). Confirm the stub survived all the verifies by actually firing
    // the fetch once.
    const resp = await fetch('/api/once-only');
    expect(await resp.text()).toBe('ONE');
  });

  it('verify respects the method filter', async () => {
    await register({
      urlPattern: '/api/post-only',
      method: 'POST',
      response: { body: 'P' },
    });

    const gotGet = (await executeCommand(
      'verifyNetworkStub',
      { urlPattern: '/api/post-only', method: 'GET' },
      emptyBridge
    )) as { data: { matched: boolean } };
    expect(gotGet.data.matched).toBe(false);

    const gotPost = (await executeCommand(
      'verifyNetworkStub',
      { urlPattern: '/api/post-only', method: 'POST' },
      emptyBridge
    )) as { data: { matched: boolean } };
    expect(gotPost.data.matched).toBe(true);
  });

  it('verify rejects missing or empty urlPattern', async () => {
    const missing = (await executeCommand('verifyNetworkStub', {}, emptyBridge)) as {
      success: boolean;
      error?: string;
    };
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/urlPattern/);

    const empty = (await executeCommand('verifyNetworkStub', { urlPattern: '' }, emptyBridge)) as {
      success: boolean;
      error?: string;
    };
    expect(empty.success).toBe(false);
    expect(empty.error).toMatch(/urlPattern/);
  });
});
