/**
 * Registration-poll auth (U4).
 *
 * The `<uiBridgeBase>/tabs` poll runs in NODE, not in the page — so it needs the
 * bearer separately from the page-side relay client. Without it, an auth-gated
 * relay answers 401, which the poll loop cannot distinguish from "no tab yet":
 * it spins to the deadline and reports `tabId: null`. The tab HAD registered;
 * only the poll was anonymous — making a healthy launch look broken.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForUiBridgeRegistration } from './launcher.js';

const BASE = 'http://relay.local/api/ui-bridge';

type FetchCall = { url: string; headers: Record<string, string> };

/** Stub `fetch`: 401 unless a bearer is presented, mimicking a gated relay. */
function gatedRelay(validToken: string, tabId = 'tab-42') {
  const calls: FetchCall[] = [];
  const stub = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    const headers = init?.headers ?? {};
    calls.push({ url, headers });
    if (headers.Authorization !== `Bearer ${validToken}`) {
      return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { tabs: [{ tabId }] } }),
    } as unknown as Response;
  });
  return { stub, calls };
}

describe('waitForUiBridgeRegistration · auth (U4)', () => {
  const realFetch = globalThis.fetch;
  let stderr: ReturnType<typeof vi.spyOn>;

  /** Everything the poll wrote to stderr, flattened. */
  const stderrText = (): string =>
    (stderr.mock.calls as unknown as unknown[][]).map((c) => String(c[0])).join('');

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    stderr.mockRestore();
    vi.restoreAllMocks();
  });

  it('THE FIX: with the auth token, a gated relay reports the REAL tabId', async () => {
    const { stub, calls } = gatedRelay('tok-abc', 'tab-real');
    globalThis.fetch = stub as unknown as typeof fetch;

    const result = await waitForUiBridgeRegistration(BASE, 2_000, { authToken: 'tok-abc' });

    expect(result).toEqual({ tabId: 'tab-real', ok: true });
    expect(calls[0]!.url).toBe(`${BASE}/tabs`);
    expect(calls[0]!.headers.Authorization).toBe('Bearer tok-abc');
  });

  it('REGRESSION: without the token, the gated relay 401s → tabId null (the reported bug)', async () => {
    const { stub } = gatedRelay('tok-abc');
    globalThis.fetch = stub as unknown as typeof fetch;

    const result = await waitForUiBridgeRegistration(BASE, 600);

    expect(result).toEqual({ tabId: null, ok: false });
    // …and the 401 is surfaced rather than masquerading as "no tab registered".
    const written = stderrText();
    expect(written).toContain('401');
    expect(written).toContain('--auth-token');
  });

  it('forwards X-Caller-User-Id so per-user tab scoping returns the caller OWN tab', async () => {
    const { stub, calls } = gatedRelay('tok-abc', 'tab-mine');
    globalThis.fetch = stub as unknown as typeof fetch;

    const result = await waitForUiBridgeRegistration(BASE, 2_000, {
      authToken: 'tok-abc',
      callerUserId: 'alice',
    });

    expect(result.tabId).toBe('tab-mine');
    expect(calls[0]!.headers['X-Caller-User-Id']).toBe('alice');
  });

  it('an UNgated relay still works with no auth (anonymous poll, unchanged)', async () => {
    const stub = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { tabs: [{ tabId: 'tab-open' }] } }),
    })) as unknown as typeof fetch;
    globalThis.fetch = stub;

    const result = await waitForUiBridgeRegistration(BASE, 2_000);
    expect(result).toEqual({ tabId: 'tab-open', ok: true });
  });

  it('a rejected token says so explicitly', async () => {
    const { stub } = gatedRelay('tok-good');
    globalThis.fetch = stub as unknown as typeof fetch;

    const result = await waitForUiBridgeRegistration(BASE, 600, { authToken: 'tok-BAD' });

    expect(result.ok).toBe(false);
    expect(stderrText()).toContain('auth token was rejected');
  });
});
